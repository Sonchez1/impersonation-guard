/** Turn a Verdict into evidence a person can check: one plain sentence per finding,
 *  the specific thing to look at, and the safe next step. Two altitudes from one object:
 *  `headline` + `items[].text` for the user, `items[].detail` for an analyst. */

import { brandTokens, registrable, sld, tokenize } from "./domains";
import { senderParts } from "./features";
import { foldSkeleton } from "./skeleton";
import type { Verdict } from "./pipeline";
import type { Message } from "./intent";

/** The protected name whose brand token appears (by confusable skeleton) in `text`. */
function brandClaimedIn(text: string, protectedNames: string[]): string | null {
  const tsk = foldSkeleton(text);
  const toks = new Set(tokenize(text).map((t) => foldSkeleton(t)));
  for (const name of protectedNames) {
    for (const tok of brandTokens([name])) {
      const sk = foldSkeleton(tok);
      if (toks.has(sk) || (sk.length >= 4 && tsk.includes(sk))) return name.includes(".") ? displayBrand(name, protectedNames) : name;
    }
  }
  return null;
}

/** Prefer a non-domain spelling of the brand ("LinkedIn" over "linkedin.com") when one exists. */
function displayBrand(name: string, protectedNames: string[]): string {
  const toks = brandTokens([name]);
  const pretty = protectedNames.find((p) => !p.includes(".") && [...brandTokens([p])].some((t) => toks.has(t)));
  return pretty ?? name;
}

export interface EvidenceItem {
  /** Stable id for the kind of finding, for tests and analytics-free counting. */
  kind: string;
  /** One plain-language sentence. */
  text: string;
  /** The exact thing to look at (a domain, a name, a phrase). */
  evidence?: string;
  /** Technical detail: the feature, signal or layer that fired. */
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface Explanation {
  level: "ok" | "caution" | "likely_scam" | "scam";
  headline: string;
  items: EvidenceItem[];
  safeStep: string;
}

const LEVELS: Record<string, Explanation["level"]> = { allow: "ok", warn: "caution", hold: "likely_scam", block: "scam" };

const HEADLINES: Record<Explanation["level"], string> = {
  ok: "Nothing suspicious found in this message.",
  caution: "Be careful with this message.",
  likely_scam: "This message is likely a scam.",
  scam: "This message is a scam. Do not click, reply, or share anything.",
};

export function explainVerdict(v: Verdict, msg: Message, protectedNames: string[] = []): Explanation {
  const items: EvidenceItem[] = [];
  const [display, local, senderDomain] = senderParts({ displayName: msg.senderName ?? "", address: msg.senderAddress ?? "" });
  const level = LEVELS[v.action] ?? "ok";
  // The brand this sender claims to be, by display name or local part; falls back to the
  // first non-domain protected name only when nothing in the message points at one.
  const brand = brandClaimedIn(`${display} ${local}`, protectedNames)
    ?? brandClaimedIn(`${msg.subject ?? ""} ${msg.body}`, protectedNames)
    ?? protectedNames.find((p) => !p.includes(".")) ?? protectedNames[0] ?? "the organisation";

  // Layer 1: lookalikes
  const seen = new Set<string>();
  for (const m of v.lookalikes) {
    const key = `${m.candidate}|${m.protected}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isSender = m.candidate === senderDomain || m.candidate === (msg.senderName ?? "");
    const what = isSender ? "The sender" : "A link in this message";
    const why = m.reasons.includes("confusable-skeleton")
      ? `uses characters that look identical to "${m.protected}" but are not the same letters`
      : m.reasons.some((r) => r.startsWith("edit-distance"))
        ? `is one or two letters away from "${m.protected}"`
        : `imitates "${m.protected}"`;
    items.push({
      kind: "lookalike", severity: "high",
      text: `${what} is "${m.candidate}", which ${why}.`,
      evidence: m.candidate,
      detail: `L1 lookalike of ${m.protected}: ${m.reasons.join(", ")}`,
    });
  }
  for (const r of v.reasons) {
    if (r.startsWith("L1 link") && r.includes("embeds")) {
      const host = /L1 link '([^']+)'/.exec(r)?.[1] ?? "";
      items.push({
        kind: "embedded_domain", severity: "high",
        text: `The link goes to "${host}". The real site name is hidden inside a different address, which ends in "${registrable(host)}".`,
        evidence: host, detail: r,
      });
    }
    if (r.startsWith("blocklisted domain")) {
      items.push({ kind: "blocklisted", severity: "high", text: "This address is on a list of known impersonation domains.", detail: r });
    }
  }

  // Layer 2: sender features
  const f = v.senderScore?.features ?? {};
  if (f.display_claims_brand_off_domain) {
    items.push({
      kind: "brand_off_domain", severity: "high",
      text: `The name says "${display}" but the address is ${senderDomain || "missing"}, which ${brand} does not use.`,
      evidence: msg.senderAddress, detail: "L2 display_claims_brand_off_domain",
    });
  } else if (f.display_brand_lookalike) {
    items.push({ kind: "display_lookalike", severity: "medium", text: `The sender name "${display}" is a near-copy of ${brand}'s name.`, evidence: display, detail: "L2 display_brand_lookalike" });
  }
  if (f.domain_free_mail && (f.display_role_word || f.local_role_word)) {
    items.push({
      kind: "role_on_webmail", severity: "medium",
      text: `It claims an official role but comes from a free webmail address (${senderDomain}). Real support teams and recruiters write from their organisation's domain.`,
      evidence: msg.senderAddress, detail: "L2 domain_free_mail + role word",
    });
  }
  if (f.domain_lure_words) {
    items.push({ kind: "lure_domain", severity: "medium", text: `The address "${senderDomain}" is built only from words like verify, secure or portal, which real organisations do not use as their domain.`, evidence: senderDomain, detail: "L2 domain_lure_words" });
  }
  if (f.domain_invisible_chars || f.display_invisible_chars) {
    items.push({ kind: "invisible_chars", severity: "high", text: "The sender's name or address contains hidden characters, a trick to get past filters.", detail: "L2 invisible_chars" });
  }
  if (f.domain_brand_in_subdomain) {
    items.push({ kind: "brand_in_subdomain", severity: "medium", text: `"${brand}" appears at the start of the address, but the site is actually "${registrable(senderDomain)}".`, evidence: senderDomain, detail: "L2 domain_brand_in_subdomain" });
  }
  for (const [host, s] of Object.entries(v.linkScores)) {
    if (s.probability >= 0.5 && !v.lookalikes.some((m) => m.candidate === host)) {
      const lf = s.features;
      const linkBrand = brandClaimedIn(sld(host), protectedNames) ?? brand;
      const why = lf.domain_brand_affix ? `has "${linkBrand}" glued to other words` : lf.domain_lure_words ? "is made of lure words like verify or secure" : lf.domain_tld_swap ? "uses the right name with the wrong ending" : lf.domain_brand_in_subdomain ? `puts "${linkBrand}" in front of a different site` : "imitates a real site";
      items.push({ kind: "link_imitates", severity: "high", text: `A link goes to "${host}", which ${why}.`, evidence: host, detail: `L2 link p=${s.probability.toFixed(2)}` });
    }
  }

  // Layer 3: what the message asks for
  const sig = new Set(v.intent?.signals ?? []);
  const asks: [string, string, EvidenceItem["severity"]][] = [
    ["credential_request", "It asks you to enter, confirm or read back a password or a code. Real support teams never ask for these.", "high"],
    ["payment_request", "It asks for money, gift cards, crypto or bank details.", "high"],
    ["personal_data_request", "It asks for identity documents or personal details such as your SSN or ID.", "high"],
    ["off_platform_move", "It tries to move the conversation to WhatsApp, Telegram, text or a personal email, where there is no record.", "medium"],
    ["too_good_to_be_true", "The offer is far better than real offers: high pay with no interview or no experience.", "medium"],
    ["deceptive_link", "A link is disguised to look like it goes somewhere it does not.", "high"],
    ["injection_attempt", "The message contains hidden instructions aimed at automated filters.", "high"],
    ["homoglyph_chars", "Words are spelled with look-alike characters from other alphabets to dodge filters.", "medium"],
    ["invisible_chars", "The text contains invisible characters inserted to dodge filters.", "medium"],
  ];
  const linkAlreadyExplained = items.some((i) => i.kind === "lookalike" || i.kind === "link_imitates" || i.kind === "embedded_domain");
  for (const [s, text, sev] of asks) {
    if (!sig.has(s)) continue;
    // The deceptive-link signal is derived from the link findings above; say it once.
    if (s === "deceptive_link" && linkAlreadyExplained) continue;
    items.push({ kind: s, severity: sev, text, detail: `L3 signal ${s}` });
  }
  const pressure: string[] = [];
  if (sig.has("urgency")) pressure.push("a deadline");
  if (sig.has("threat_or_consequence")) pressure.push("a threat of losing something");
  if (sig.has("authority_claim")) pressure.push("a claim of authority");
  if (pressure.length && level !== "ok" && v.intent && v.intent.label !== "benign") {
    items.push({ kind: "pressure", severity: "low", text: `It pressures you with ${pressure.join(" and ")}. Pressure is the scammer's tool for stopping you from checking.`, detail: `L3 ${pressure.join(", ")}` });
  }

  const safeStep =
    level === "ok"
      ? "If anything still feels off, go to the site by typing its address yourself instead of clicking."
      : "Do not click the links or reply. Open the real site by typing its address yourself, or call the organisation using a number from their official site.";
  // Strongest evidence first, stable within a severity.
  const rank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { level, headline: HEADLINES[level], items, safeStep };
}
