/** Layer 2 feature extraction. Port of impersonation_detector/features.py. */

import { osaDistance } from "./distance";
import {
  DOMAIN_LURE_WORDS, FREE_MAIL, ROLE_WORDS, brandTokens, embeddedDomain, hasInvisible,
  parseAddress, protectedDomains, registrable, sld, subdomainLabels, tokenize, unleet,
} from "./domains";
import { isMixedScript } from "./scripts";
import { foldSkeleton as skeleton } from "./skeleton";
import { casefold } from "./unicode";

export const FEATURE_NAMES = [
  "domain_is_protected", "domain_skeleton_match", "domain_close_typo", "domain_mixed_script",
  "domain_punycode", "domain_tld_swap", "domain_brand_affix", "domain_brand_in_subdomain",
  "domain_embeds_foreign_domain", "domain_lure_words", "domain_leet_match", "domain_free_mail",
  "domain_missing", "domain_invisible_chars",
  "display_brand_token", "display_brand_lookalike", "display_role_word",
  "display_claims_brand_off_domain", "display_invisible_chars", "display_mixed_script",
  "local_brand_token", "local_role_word", "local_brand_lookalike",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type Features = Record<string, number>;

export interface Sender {
  displayName: string;
  address: string;
}

export function senderParts(s: Sender): [string, string, string] {
  const [name, local, domain] = parseAddress(s.address);
  return [s.displayName || name, local, domain];
}

function zeroFeatures(prefix?: string): Features {
  const f: Features = {};
  for (const k of FEATURE_NAMES) if (!prefix || k.startsWith(prefix)) f[k] = 0;
  return f;
}

export class FeatureExtractor {
  readonly protected: string[];
  readonly maxDistance: number;
  readonly brands: Set<string>;
  readonly brandSkeletons: Map<string, string>;
  readonly domains: Set<string>;
  readonly domainSlds: Map<string, string>;
  readonly sldSkeletons: Map<string, string>;
  readonly nameSkeletons: Set<string>;
  /** Off by default to match impersonation-detector 0.3.0; see `extract`. */
  brandOnOwnDomainIsBenign = false;

  constructor(protectedNames: string[], maxDistance = 2) {
    this.protected = protectedNames.map((p) => p.trim()).filter((p) => p.length > 0);
    this.maxDistance = maxDistance;
    this.brands = brandTokens(this.protected);
    this.brandSkeletons = new Map([...this.brands].map((b) => [b, skeleton(b)]));
    this.domains = protectedDomains(this.protected);
    this.domainSlds = new Map([...this.domains].map((d) => [sld(d), d]));
    this.sldSkeletons = new Map([...this.domainSlds.keys()].map((s) => [s, skeleton(s)]));
    this.nameSkeletons = new Set(this.protected.map((p) => skeleton(p)));
  }

  private threshold(name: string): number {
    const n = Array.from(name).length;
    if (n <= 4) return 0;
    if (n <= 8) return Math.min(this.maxDistance, 1);
    return this.maxDistance;
  }

  private closestBrand(token: string): [string | null, number] {
    const sk = skeleton(token);
    let best: [string | null, number] = [null, 1e6];
    for (const [brand, bsk] of this.brandSkeletons) {
      const d = osaDistance(sk, bsk);
      if (d < best[1]) best = [brand, d];
    }
    return best;
  }

  private tokenIsBrand(token: string): boolean {
    if (this.brands.has(token)) return true;
    const sk = skeleton(token);
    for (const v of this.brandSkeletons.values()) if (v === sk) return true;
    return false;
  }

  private tokenIsLookalike(token: string): boolean {
    if (this.brands.has(token)) return false;
    const [brand, d] = this.closestBrand(token);
    if (brand === null) return false;
    if (d === 0) return true;
    return d > 0 && d <= this.threshold(brand);
  }

  private containsBrand(text: string): boolean {
    const t = skeleton(text);
    for (const bsk of this.brandSkeletons.values()) if (Array.from(bsk).length >= 4 && t.includes(bsk)) return true;
    return false;
  }

  domainFeatures(domain: string): Features {
    const f = zeroFeatures("domain_");
    if (!domain) {
      f.domain_missing = 1;
      return f;
    }
    const raw = domain;
    const reg = registrable(domain);
    const s = sld(domain);
    f.domain_invisible_chars = hasInvisible(raw) ? 1 : 0;
    f.domain_punycode = casefold(raw).includes("xn--") ? 1 : 0;
    f.domain_mixed_script = isMixedScript(reg) ? 1 : 0;
    f.domain_free_mail = FREE_MAIL.has(reg) ? 1 : 0;
    f.domain_embeds_foreign_domain = embeddedDomain(domain) !== null ? 1 : 0;
    const sldTokens = sld(domain).split(/[^a-z0-9]+/).filter((t) => t.length > 0);
    f.domain_lure_words =
      sldTokens.length > 0 && sldTokens.every((t) => DOMAIN_LURE_WORDS.has(t) || /^[0-9]+$/.test(t)) && !FREE_MAIL.has(reg)
        ? 1 : 0;
    if (this.domains.has(reg)) {
      f.domain_is_protected = 1;
      return f;
    }
    if (!s) return f;
    const ssk = skeleton(s);
    const targets = new Map<string, string>(this.sldSkeletons);
    for (const [k, v] of this.brandSkeletons) targets.set(k, v);
    let bestName: string | null = null, bestD = 1e6;
    for (const [name, nsk] of targets) {
      const d = osaDistance(ssk, nsk);
      if (d < bestD) { bestName = name; bestD = d; }
    }
    if (bestName !== null) {
      if (bestD === 0) {
        if (targets.has(s)) f.domain_tld_swap = 1;
        else f.domain_skeleton_match = 1;
      } else if (bestD <= this.threshold(bestName)) {
        f.domain_close_typo = 1;
      }
    }
    if (!f.domain_skeleton_match && !f.domain_tld_swap) {
      if (this.containsBrand(s)) f.domain_brand_affix = 1;
      else {
        const usk = skeleton(unleet(s));
        for (const v of targets.values()) if (v === usk) { f.domain_leet_match = 1; break; }
      }
    }
    const subs = subdomainLabels(domain);
    if (subs.some((lab) => this.tokenIsBrand(lab) || this.containsBrand(lab))) f.domain_brand_in_subdomain = 1;
    return f;
  }

  extract(sender: Sender): Features {
    const [display, local, domain] = senderParts(sender);
    const f = zeroFeatures();
    Object.assign(f, this.domainFeatures(domain));

    const dtoks = tokenize(display);
    f.display_invisible_chars = hasInvisible(display) ? 1 : 0;
    f.display_mixed_script = isMixedScript(display) ? 1 : 0;
    f.display_role_word = dtoks.some((t) => ROLE_WORDS.has(t)) ? 1 : 0;
    f.display_brand_token =
      dtoks.some((t) => this.tokenIsBrand(t)) || this.nameSkeletons.has(skeleton(display)) || dtoks.some((t) => this.containsBrand(t))
        ? 1 : 0;
    f.display_brand_lookalike = dtoks.some((t) => this.tokenIsLookalike(t)) ? 1 : 0;
    const claims = f.display_brand_token || f.display_brand_lookalike;
    f.display_claims_brand_off_domain = claims && !f.domain_is_protected ? 1 : 0;

    const ltoks = tokenize(local);
    f.local_role_word = ltoks.some((t) => ROLE_WORDS.has(t)) ? 1 : 0;
    f.local_brand_token = ltoks.some((t) => this.tokenIsBrand(t) || this.containsBrand(t)) ? 1 : 0;
    f.local_brand_lookalike = ltoks.some((t) => this.tokenIsLookalike(t)) ? 1 : 0;
    if (f.domain_is_protected && this.brandOnOwnDomainIsBenign) {
      // The brand's name on the brand's own domain (linkedin@e.linkedin.com) is not a
      // claim, it is the sender.
      f.display_brand_token = 0; f.display_brand_lookalike = 0;
      f.local_brand_token = 0; f.local_brand_lookalike = 0;
    }
    return f;
  }
}
