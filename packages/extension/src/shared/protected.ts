/** Decide which names a message is checked against. The engine scores everything
 *  relative to a protected set, so the set is built per message: the person's own list,
 *  their own domains, and any bundled brand the message mentions by name or links to. */

import { casefold, nfkc, registrable, stripInvisible, tokenize, type Message } from "@impersonation-guard/engine";
import brandsJson from "./brands.json";
import type { Settings } from "./protocol";

export interface Brand { name: string; domains: string[]; names: string[] }

export const BRANDS: Brand[] = (brandsJson as { brands: Brand[] }).brands;

function textOf(msg: Message): string {
  return casefold(nfkc(stripInvisible([msg.senderName ?? "", msg.senderAddress ?? "", msg.subject ?? "", msg.body, ...(msg.links ?? [])].join("\n"))));
}

/** Brands mentioned in the text by name (whole-token or phrase) or linked by domain. */
export function brandsMentioned(msg: Message, hosts: string[] = []): Brand[] {
  const text = textOf(msg);
  const tokens = new Set(tokenize(text));
  const hostRegs = new Set(hosts.map((h) => registrable(h)));
  const out: Brand[] = [];
  for (const b of BRANDS) {
    const byName = b.names.some((n) => (n.includes(" ") || n.includes(".") ? text.includes(n) : tokens.has(n)));
    const byDomain = b.domains.some((d) => hostRegs.has(d));
    if (byName || byDomain) out.push(b);
  }
  return out;
}

export function resolveProtected(settings: Settings, msg: Message, hosts: string[] = []): string[] {
  const set = new Set<string>();
  for (const p of settings.protected) if (p.trim()) set.add(p.trim());
  for (const d of settings.ownDomains) if (d.trim()) set.add(d.trim().toLowerCase());
  if (settings.useBundledBrands) {
    for (const b of brandsMentioned(msg, hosts)) {
      set.add(b.name);
      for (const d of b.domains) set.add(d);
    }
  }
  return [...set];
}

/** For a page (not a message): brands whose name appears in the page's title/visible brand text. */
export function resolveProtectedForPage(settings: Settings, brandText: string, host: string): string[] {
  const msg: Message = { body: brandText, subject: "" };
  const set = new Set(resolveProtected(settings, msg, []));
  // A page on a brand's own domain is that brand's; never treat it as a lookalike of itself.
  const reg = registrable(host);
  for (const b of BRANDS) if (b.domains.includes(reg)) { set.add(b.name); for (const d of b.domains) set.add(d); }
  return [...set];
}
