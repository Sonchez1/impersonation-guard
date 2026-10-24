/** The analysis core shared by the service worker and the demo page: given a settings
 *  store and a flagged-host store, analyze messages and check pages. No chrome.* here. */

import {
  Detector, LLMIntentClassifier, LookalikeDetector, OllamaBackend, RuleIntentClassifier, SenderScorer,
  explainVerdict, extractHosts, registrable, type Message, type Verdict,
} from "@impersonation-guard/engine";
import { resolveProtected, resolveProtectedForPage } from "./protected";
import type { AnalyzeResponse, CheckPageResponse, Level, Request, Settings, VerdictLite } from "./protocol";

export const LEVEL: Record<Verdict["action"], Level> = { allow: "ok", warn: "caution", hold: "likely_scam", block: "scam" };

export interface Flag { at: number; level: Level; from: string }

export interface Stores {
  getSettings(): Promise<Settings>;
  getFlags(): Promise<Record<string, Flag>>;
  setFlags(flags: Record<string, Flag>): Promise<void>;
}

export function rank(l: Level): number {
  return { ok: 0, caution: 1, likely_scam: 2, scam: 3 }[l];
}

export function toLite(v: Verdict): VerdictLite {
  return {
    risk: v.risk, action: v.action, reasons: v.reasons,
    senderProbability: v.senderScore?.probability ?? null,
    senderFeatures: Object.fromEntries(Object.entries(v.senderScore?.features ?? {}).filter(([, x]) => x)),
    linkScores: Object.fromEntries(Object.entries(v.linkScores).map(([h, s]) => [h, s.probability])),
    lookalikes: v.lookalikes.map((m) => ({ candidate: m.candidate, protected: m.protected, reasons: m.reasons })),
    intent: v.intent ? { label: v.intent.label, confidence: v.intent.confidence, signals: v.intent.signals, rationale: v.intent.rationale, backend: v.intent.backend } : null,
    hosts: v.hosts, senderFacts: v.senderFacts,
  };
}

export function createCore(stores: Stores) {
  async function flagHosts(hosts: string[], level: Level, from: string): Promise<void> {
    if (level === "ok") return;
    const flags = await stores.getFlags();
    const now = Date.now();
    for (const h of hosts) {
      const reg = registrable(h);
      if (!reg) continue;
      const prev = flags[reg];
      if (!prev || rank(level) >= rank(prev.level)) flags[reg] = { at: now, level, from };
    }
    const entries = Object.entries(flags).sort((a, b) => b[1].at - a[1].at).slice(0, 500);
    await stores.setFlags(Object.fromEntries(entries));
  }

  /** Long marketing mail is analyzed in full for links but the engine's intent layer caps
   *  its own text at 6,000 characters; beyond this the extra text only costs time. */
  const MAX_ANALYZED_BODY = 20000;

  const ASK_SIGNALS = ["credential_request", "payment_request", "personal_data_request", "off_platform_move", "too_good_to_be_true"];

  /** Consumer mode: the engine was tuned for a platform that knows every domain it owns,
   *  where any brand-affixed link host is suspect. A person does not know every domain
   *  their employer or bank owns (argocd.acmecorp-internal.com may be real). So a link
   *  whose address merely resembles a brand, with nothing else wrong, is "be careful",
   *  not "scam". Blocking needs corroboration: a lookalike or suspicious sender, a
   *  sensitive request, or an injection attempt. */
  function requireCorroboration(verdict: Verdict): boolean {
    if (verdict.action === "allow" || verdict.action === "warn") return false;
    const signals = new Set(verdict.intent?.signals ?? []);
    if (ASK_SIGNALS.some((s) => signals.has(s)) || signals.has("injection_attempt")) return false;
    if (verdict.lookalikes.length) return false;
    if ((verdict.senderScore?.probability ?? 0) >= 0.5) return false;
    const linkDriven = Object.values(verdict.linkScores).some((s) => s.probability >= 0.5);
    if (!linkDriven) return false;
    verdict.risk = Math.min(verdict.risk, 0.45);
    verdict.action = "warn";
    verdict.reasons.push("consumer mode: link-only evidence without a sensitive request is capped at caution");
    return true;
  }

  async function analyze(input: Message, source: string): Promise<AnalyzeResponse> {
    const t0 = Date.now();
    const settings = await stores.getSettings();
    const message: Message = input.body.length > MAX_ANALYZED_BODY ? { ...input, body: input.body.slice(0, MAX_ANALYZED_BODY) } : input;
    const hosts = extractHosts(`${message.subject ?? ""}\n${message.body}`, message.links ?? []);
    const protectedNames = resolveProtected(settings, message, hosts);
    let intent: RuleIntentClassifier | LLMIntentClassifier = new RuleIntentClassifier();
    if (settings.ollama.enabled) intent = new LLMIntentClassifier(new OllamaBackend(settings.ollama.model, settings.ollama.host));
    const det = new Detector(protectedNames, { intent, registrableLookalike: true, brandOnOwnDomainIsBenign: true, skipProtectedSubdomains: true });
    let verdict = await det.analyze(message);
    if (verdict.intent?.label === "unknown" && verdict.intent.rationale.startsWith("backend error")) {
      verdict = await new Detector(protectedNames, { registrableLookalike: true, brandOnOwnDomainIsBenign: true, skipProtectedSubdomains: true }).analyze(message);
      verdict.reasons.push("local model unreachable; rule classifier used");
    }
    const capped = requireCorroboration(verdict);
    const explanation = explainVerdict(verdict, message, protectedNames);
    if (capped) {
      explanation.safeStep = "If you know this address is genuine, for example your employer's internal site, add it to the names you protect in Settings and it will not be flagged again. If you are not sure, do not click it; open the site by typing its address yourself.";
    }
    await flagHosts(verdict.hosts, LEVEL[verdict.action], source);
    return { verdict: toLite(verdict), explanation, protected: protectedNames, backend: verdict.intent?.backend ?? "rule", ms: Date.now() - t0 };
  }

  async function checkPage(req: Extract<Request, { type: "checkPage" }>): Promise<CheckPageResponse> {
    const settings = await stores.getSettings();
    const host = req.host.toLowerCase();
    const reg = registrable(host);
    const flags = await stores.getFlags();
    const items: CheckPageResponse["items"] = [];
    let level: Level = "ok";
    const bump = (l: Level) => { if (rank(l) > rank(level)) level = l; };

    const protectedNames = resolveProtectedForPage(settings, req.brandText, host);
    const isOwn = protectedNames.some((p) => p.includes(".") && registrable(p) === reg);

    if (!isOwn && protectedNames.length) {
      const la = new LookalikeDetector(protectedNames);
      const matches = la.check(host).concat(host === reg ? [] : la.check(reg));
      for (const m of matches) {
        bump("scam");
        const why = m.reasons.includes("confusable-skeleton")
          ? `uses characters that look identical to "${m.protected}" but are not the same letters`
          : `is one or two letters away from "${m.protected}"`;
        items.push({ text: `This page is at "${m.candidate}", which ${why}.`, evidence: m.candidate, detail: `L1 lookalike of ${m.protected}: ${m.reasons.join(", ")}` });
        break;
      }
      const s = new SenderScorer(protectedNames).scoreDomain(host);
      if (s.probability >= 0.5 && !items.length) {
        bump("likely_scam");
        const f = s.features;
        const why = f.domain_brand_affix ? "has a real brand name glued to other words" : f.domain_lure_words ? "is made only of words like login, secure or verify" : f.domain_brand_in_subdomain ? "puts a real brand name in front of a different site" : f.domain_tld_swap ? "uses the right name with the wrong ending" : "imitates a site you use";
        items.push({ text: `This page's address "${host}" ${why}.`, evidence: host, detail: `L2 domain p=${s.probability.toFixed(2)} ${Object.keys(f).filter((k) => f[k]).join(",")}` });
      }
    }
    const flag = flags[reg];
    if (flag && !isOwn) {
      bump(flag.level);
      items.push({ text: `You reached this page from a message that Impersonation Guard rated "${flag.level.replace("_", " ")}".`, evidence: reg, detail: `flagged host via ${flag.from} at ${new Date(flag.at).toISOString()}` });
    }
    if (req.referrer && !isOwn) {
      try {
        const rref = registrable(new URL(req.referrer).hostname);
        if (flags[rref] && rref !== reg) {
          bump(flags[rref].level);
          items.push({ text: `The page that sent you here (${rref}) was flagged in a message.`, evidence: rref, detail: "flagged referrer" });
        }
      } catch { /* ignore bad referrer */ }
    }

    const asking = req.fields.password || req.fields.otp;
    const interrupt = asking && level !== "ok";
    const what = req.fields.otp ? "a one-time code" : "a password";
    const headline = interrupt
      ? `Stop: this page is asking for ${what} and it does not look like the real site.`
      : level === "ok" ? "Nothing suspicious about this page." : "Be careful on this page.";
    return {
      interrupt, level, headline, items,
      safeStep: "Close this tab. Open the real site by typing its address yourself, then sign in there if you need to.",
    };
  }

  return { analyze, checkPage, flagHosts };
}
