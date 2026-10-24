/** The detector: combine Layers 1-3 into one explainable verdict per message.
 *  Port of impersonation_detector/pipeline.py (risk composition, fusion gate, actions). */

import {
  FREE_MAIL, embeddedDomain, isInstitutional, normalizeHost, registrable, sld, stripInvisible, tokenize,
} from "./domains";
import { Sender, senderParts } from "./features";
import {
  IntentClassifier, IntentResult, Message, RuleIntentClassifier, detectSignals, intentIsMalicious,
  intentRisk, normalizeText, textViews,
} from "./intent";
import { LookalikeDetector, Match } from "./lookalike";
import { SenderScore, SenderScorer, scoreReasons } from "./scorer";
import { pyRegExp } from "./unicode";

export const ACTIONS = ["allow", "warn", "hold", "block"] as const;
export type Action = (typeof ACTIONS)[number];

const URL_RX = /(?:https?:\/\/|www\.)([^\s/<>"')\]]+)/gi;
const BARE_DOMAIN_RX = pyRegExp(
  "\\b((?:[a-z0-9-]+\\.)+(?:com|net|org|io|co|app|xyz|top|site|online|click|link|info|me|us|cc" +
    "|live|help|support|careers|jobs|ly|gl|to|tv|ai|dev|sh|cloud|store|shop|work|biz|edu|gov))\\b",
  "gi",
);

export interface Thresholds {
  warn: number;
  hold: number;
  block: number;
  noiseFloor: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { warn: 0.3, hold: 0.6, block: 0.85, noiseFloor: 0.2 };

export interface Verdict {
  risk: number;
  action: Action;
  reasons: string[];
  senderScore: SenderScore | null;
  linkScores: Record<string, SenderScore>;
  lookalikes: Match[];
  intent: IntentResult | null;
  /** Hosts found in the message (links + bare domains), normalized. */
  hosts: string[];
  /** Sender facts handed to Layer 3 (empty when fusion did not run). */
  senderFacts: string[];
}

function pyRepr(s: string): string {
  // Python repr() for the strings the pipeline interpolates: single quotes unless the
  // string contains a single quote and no double quote.
  if (s.includes("'") && !s.includes('"')) return '"' + s + '"';
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

export function extractHosts(text: string, links: string[] = []): string[] {
  text = stripInvisible(text);
  const hosts: string[] = [];
  for (const link of links) {
    const rx = new RegExp(URL_RX.source, "iu");
    const m = rx.exec(link);
    hosts.push(normalizeHost(m ? m[1] : link));
  }
  for (const m of text.matchAll(new RegExp(URL_RX.source, "giu"))) hosts.push(normalizeHost(m[1]));
  for (const m of text.matchAll(new RegExp(BARE_DOMAIN_RX.source, "giu"))) hosts.push(normalizeHost(m[1]));
  const seen: string[] = [];
  for (let h of hosts) {
    if (h.startsWith("www.")) h = h.slice(4);
    if (h && !seen.includes(h)) seen.push(h);
  }
  return seen;
}

export function senderFacts(
  protectedDomainSet: Set<string>, senderDomain: string, displayClaimsBrand: boolean, hosts: string[],
  lookalikeHosts: Set<string>, lookalikeSender: boolean, freeMail: boolean,
): [string[], string[]] {
  const facts: string[] = [];
  const sreg = senderDomain ? registrable(senderDomain) : "";
  if (!senderDomain) facts.push("sender:no-domain");
  else if (protectedDomainSet.has(sreg)) facts.push("sender:platform-domain");
  else if (lookalikeSender) facts.push("sender:lookalike-domain");
  else if (isInstitutional(senderDomain)) facts.push("sender:institutional-domain");
  else if (freeMail) facts.push("sender:free-webmail");
  else facts.push("sender:unrelated-domain");
  if (displayClaimsBrand) facts.push("display:claims-platform-brand");
  const embedded: string[] = [];
  if (!hosts.length) facts.push("links:none");
  else {
    const off = hosts.filter((h) => !protectedDomainSet.has(registrable(h)));
    if (!off.length) facts.push("links:platform-only");
    else {
      facts.push("links:off-platform");
      if (sreg && off.every((h) => registrable(h) === sreg)) facts.push("links:same-as-sender");
    }
    if (hosts.some((h) => lookalikeHosts.has(h))) facts.push("links:lookalike");
    for (const h of hosts) {
      const inner = embeddedDomain(h);
      if (inner) {
        facts.push("links:embedded-domain");
        embedded.push(`${inner} inside ${registrable(h)}`);
      }
    }
  }
  const seen: string[] = [];
  for (const f of facts) if (!seen.includes(f)) seen.push(f);
  return [seen, embedded];
}

export interface DetectorOptions {
  intent?: IntentClassifier;
  thresholds?: Partial<Thresholds>;
  layers?: number[];
  blocklist?: string[];
  /** Also run the Layer 1 lookalike check on each link host's registrable domain, so
   *  ``link.northfieldstat.edu`` is judged as ``northfieldstat.edu`` against ``northfieldstate.edu``. Off by default to stay
   *  identical to impersonation-detector 0.3.0; the extension turns it on. */
  registrableLookalike?: boolean;
  /** Treat the brand's own name on the brand's own domain as the sender, not a claim
   *  (linkedin@e.linkedin.com). Off by default for parity; the extension turns it on. */
  brandOnOwnDomainIsBenign?: boolean;
  /** A sender or link host that is a subdomain of a protected domain (mail.example.com for
   *  example.com) is the genuine domain, never a Layer 1 lookalike of it. Off by default so
   *  verdicts match the Python package; the extension turns it on. */
  skipProtectedSubdomains?: boolean;
}

export class Detector {
  readonly protected: string[];
  readonly lookalike: LookalikeDetector;
  readonly scorer: SenderScorer;
  readonly intent: IntentClassifier;
  readonly thresholds: Thresholds;
  readonly layers: Set<number>;
  readonly blocklist: Set<string>;
  readonly protectedDomains: Set<string>;
  readonly registrableLookalike: boolean;
  readonly skipProtectedSubdomains: boolean;

  constructor(protectedNames: string[], opts: DetectorOptions = {}) {
    this.protected = protectedNames;
    this.registrableLookalike = opts.registrableLookalike ?? false;
    this.skipProtectedSubdomains = opts.skipProtectedSubdomains ?? false;
    this.lookalike = new LookalikeDetector(protectedNames);
    this.scorer = new SenderScorer(protectedNames);
    this.scorer.extractor.brandOnOwnDomainIsBenign = opts.brandOnOwnDomainIsBenign ?? false;
    this.intent = opts.intent ?? new RuleIntentClassifier();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
    this.layers = new Set(opts.layers ?? [1, 2, 3]);
    this.blocklist = new Set((opts.blocklist ?? []).map((d) => normalizeHost(d)));
    this.protectedDomains = new Set(
      protectedNames.filter((p) => p.includes(".") && !p.trim().includes(" ")).map((p) => registrable(p)),
    );
  }

  private action(risk: number): Action {
    const t = this.thresholds;
    if (risk >= t.block) return "block";
    if (risk >= t.hold) return "hold";
    if (risk >= t.warn) return "warn";
    return "allow";
  }

  async analyze(input: Message): Promise<Verdict> {
    let msg: Message = { ...input, links: input.links ?? [], senderFacts: input.senderFacts ?? [], embeddedDomains: input.embeddedDomains ?? [] };
    const reasons: string[] = [];
    const sender: Sender = { displayName: msg.senderName ?? "", address: msg.senderAddress ?? "" };
    const [, , senderDomain] = senderParts(sender);
    const hosts = extractHosts(`${msg.subject ?? ""}\n${msg.body}`, msg.links);
    const risks: number[] = [];
    let floor = 0;

    for (const host of [senderDomain, ...hosts]) {
      if (host && (this.blocklist.has(host) || this.blocklist.has(registrable(host)))) {
        floor = Math.max(floor, 0.95);
        reasons.push(`blocklisted domain ${pyRepr(host)} (lookalike-domain watch)`);
      }
    }

    const lookalikes: Match[] = [];
    const lookalikeHosts = new Set<string>();
    let lookalikeSender = false;
    if (this.layers.has(1)) {
      for (const c of [msg.senderName ?? "", senderDomain, ...hosts].filter((x) => x)) {
        // A subdomain of a protected domain is the genuine domain (mail.example.com is
        // example.com), never a lookalike of it.
        if (this.skipProtectedSubdomains && (c === senderDomain || hosts.includes(c)) && this.protectedDomains.has(registrable(c))) continue;
        const ms = this.lookalike.check(c);
        if (ms.length) {
          lookalikes.push(...ms);
          if (c === senderDomain) lookalikeSender = true;
          if (hosts.includes(c)) lookalikeHosts.add(c);
        }
      }
      if (this.registrableLookalike) {
        for (const h of hosts) {
          const reg = registrable(h);
          if (!reg || reg === h || lookalikeHosts.has(h) || this.protectedDomains.has(reg)) continue;
          const ms = this.lookalike.check(reg);
          if (ms.length) {
            lookalikes.push(...ms.map((m) => ({ ...m, candidate: h })));
            lookalikeHosts.add(h);
          }
        }
      }
      if (lookalikes.length) {
        floor = Math.max(floor, 0.85);
        for (const m of lookalikes.slice(0, 3)) {
          reasons.push(`L1 lookalike of ${pyRepr(m.protected)}: ${pyRepr(m.candidate)} [${m.reasons.join(", ")}]`);
        }
      }
      const senderSld = senderDomain ? sld(senderDomain) : "";
      for (const h of hosts) {
        const inner = embeddedDomain(h);
        if (inner) {
          floor = Math.max(floor, 0.85);
          const who = senderSld && sld(inner) === senderSld ? "the sender's own domain" : inner;
          reasons.push(`L1 link ${pyRepr(h)} embeds ${who} inside ${pyRepr(registrable(h))}`);
        }
      }
    }

    let senderScore: SenderScore | null = null;
    const linkScores: Record<string, SenderScore> = {};
    let displayClaimsBrand = false;
    if (this.layers.has(2)) {
      senderScore = this.scorer.score(sender);
      const f = senderScore.features;
      displayClaimsBrand = !!(f.display_brand_token || f.display_brand_lookalike);
      lookalikeSender = lookalikeSender || !!(f.domain_skeleton_match || f.domain_close_typo || f.domain_brand_affix || f.domain_tld_swap || f.domain_leet_match);
      risks.push(senderScore.probability);
      if (senderScore.probability >= this.thresholds.warn) {
        reasons.push("L2 sender " + scoreReasons(senderScore).slice(0, 3).join(", ") + ` (p=${senderScore.probability.toFixed(2)})`);
      }
      for (const h of hosts) {
        if (h === senderDomain && senderScore.probability >= 0.5) continue;
        const s = this.scorer.scoreDomain(h);
        linkScores[h] = s;
        risks.push(s.probability);
        if (s.probability >= this.thresholds.warn) {
          reasons.push(`L2 link ${pyRepr(h)} ` + scoreReasons(s).slice(0, 3).join(", ") + ` (p=${s.probability.toFixed(2)})`);
        }
        if (s.probability >= 0.5 && !s.features.domain_free_mail) lookalikeHosts.add(h);
      }
    }

    let intent: IntentResult | null = null;
    let fused = false;
    let facts: string[] = [];
    if (this.layers.has(3)) {
      if (this.layers.has(1) || this.layers.has(2)) {
        const [f, embedded] = senderFacts(
          this.protectedDomains, senderDomain, displayClaimsBrand, hosts, lookalikeHosts, lookalikeSender,
          senderDomain ? FREE_MAIL.has(registrable(senderDomain)) : false,
        );
        facts = f;
        msg = { ...msg, senderFacts: facts, embeddedDomains: embedded };
        fused = true;
      }
      intent = await this.intent.classify(msg);
      let risk3 = intentRisk(intent);
      if (fused && intentIsMalicious(intent)) {
        const fset = new Set(facts);
        const senderP = senderScore ? senderScore.probability : 0;
        const trusted = fset.has("sender:platform-domain") || fset.has("sender:institutional-domain");
        const ownOrg = fset.has("sender:unrelated-domain") && !displayClaimsBrand && senderP < 0.3;
        const peer = fset.has("sender:free-webmail") && !displayClaimsBrand && fset.has("links:none") && senderP < 0.3;
        const linksSafe = !(fset.has("links:lookalike") || fset.has("links:embedded-domain")) &&
          (!fset.has("links:off-platform") || fset.has("links:same-as-sender"));
        const asked = new Set<string>();
        for (const view of textViews(normalizeText(`${msg.subject ?? ""}\n${msg.body}`))) {
          for (const s of detectSignals(view)) asked.add(s);
        }
        const askSignals = ["credential_request", "payment_request", "personal_data_request", "off_platform_move", "too_good_to_be_true"];
        const detAsk = askSignals.some((s) => asked.has(s)) || intent.signals.includes("injection_attempt");
        const labelIsAsk = intent.label === "credential_phish" || intent.label === "payment_redirect";
        const modelAsk = askSignals.some((s) => intent!.signals.includes(s));
        const bodyTokens = new Set(tokenize(msg.body));
        let brandInBody = false;
        for (const b of this.scorer.extractor.brands) if (bodyTokens.has(b)) { brandInBody = true; break; }
        const claimsPlatformInBody = !trusted && brandInBody && (asked.has("authority_claim") || intent.label === "support_impersonation");
        let ok: boolean;
        if (trusted) ok = !detAsk && !modelAsk && !labelIsAsk && linksSafe;
        else if (ownOrg) ok = !detAsk && linksSafe && !claimsPlatformInBody;
        else if (peer) ok = !detAsk && !labelIsAsk && !claimsPlatformInBody;
        else ok = false;
        if (ok) {
          risk3 *= 0.25;
          const who = trusted ? "trusted sender" : ownOrg ? "organisation on its own domain" : "peer on webmail";
          reasons.push(`fusion: ${who}, no sensitive request, no foreign link; L3 ${intent.label} discounted`);
        }
      }
      risks.push(risk3);
      if (intentIsMalicious(intent)) {
        reasons.push(`L3 intent ${intent.label} (conf=${intent.confidence.toFixed(2)}; ` + intent.signals.join(", ") + ")");
      } else if (intent.label === "unknown") {
        reasons.push("L3 intent unknown: " + intent.rationale);
      }
      if (intent.signals.includes("injection_attempt")) {
        floor = Math.max(floor, 0.6);
        reasons.push("L3 prompt-injection attempt in message body");
      }
    }

    let survive = 1;
    for (let r of risks) {
      r = Math.max(0, Math.min(1, r));
      if (r >= this.thresholds.noiseFloor) survive *= 1 - r;
    }
    const risk = Math.max(1 - survive, floor);
    return { risk, action: this.action(risk), reasons, senderScore, linkScores, lookalikes, intent, hosts, senderFacts: facts };
  }
}
