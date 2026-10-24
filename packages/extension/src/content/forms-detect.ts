/** Pure helpers for the point-of-harm interrupt: which inputs on a page take a password
 *  or a one-time code, and what brand the page claims to be. No side effects. */

const HINT = /\b(code|otp|one[- ]time|verification|passcode|2fa|mfa|token)\b/i;
const SKIP_TYPES = new Set(["hidden", "search", "email", "url", "checkbox", "radio", "submit", "button", "file", "range", "color", "date", "time"]);

export interface SensitiveFields {
  password: HTMLInputElement[];
  otp: HTMLInputElement[];
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? "";
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function maxLength(input: HTMLInputElement): number {
  const raw = attr(input, "maxlength");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : -1;
}

/** Text that labels this input: attributes, associated labels, and the nearest preceding
 *  heading or paragraph inside the same form. */
function labelText(input: HTMLInputElement, doc: Document | ParentNode): string {
  const parts: string[] = [attr(input, "name"), attr(input, "id"), attr(input, "placeholder"), attr(input, "aria-label"), attr(input, "title")];
  const byIds = attr(input, "aria-labelledby").split(/\s+/).filter(Boolean);
  const root = (input.ownerDocument ?? doc) as Document;
  for (const id of byIds) parts.push(text(root.getElementById(id)));
  if (input.id) {
    for (const lab of root.querySelectorAll("label")) if (attr(lab, "for") === input.id) parts.push(text(lab));
  }
  parts.push(text(input.closest("label")));
  const scope: Element = input.closest("form") ?? input.closest("fieldset, section, main") ?? root.body ?? root.documentElement;
  if (scope) {
    const candidates = scope.querySelectorAll("h1,h2,h3,h4,h5,h6,p,legend,label,span,div");
    let nearest: Element | null = null;
    for (const c of candidates) {
      if (c === input || c.contains(input)) continue;
      const t = text(c);
      if (!t || t.length > 160) continue;
      if (c.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) nearest = c;
    }
    parts.push(text(nearest));
  }
  return parts.join(" | ");
}

function visibleInputs(root: ParentNode): HTMLInputElement[] {
  const out: HTMLInputElement[] = [];
  for (const el of root.querySelectorAll("input")) {
    const input = el as HTMLInputElement;
    const type = (attr(input, "type") || "text").toLowerCase();
    if (SKIP_TYPES.has(type)) continue;
    if (input.disabled) continue;
    if (attr(input, "aria-hidden") === "true") continue;
    out.push(input);
  }
  return out;
}

export function findSensitiveFields(root: ParentNode): SensitiveFields {
  const password: HTMLInputElement[] = [];
  const otp: HTMLInputElement[] = [];
  const seen = new Set<HTMLInputElement>();
  const inputs = visibleInputs(root);

  for (const input of inputs) {
    const type = (attr(input, "type") || "text").toLowerCase();
    if (type === "password") { password.push(input); seen.add(input); }
  }

  // Groups of 4-8 single-character boxes in one container: the classic OTP entry.
  const byParent = new Map<Element, HTMLInputElement[]>();
  for (const input of inputs) {
    if (seen.has(input) || maxLength(input) !== 1) continue;
    const parent = input.parentElement;
    if (!parent) continue;
    const list = byParent.get(parent) ?? [];
    list.push(input);
    byParent.set(parent, list);
  }
  for (const group of byParent.values()) {
    if (group.length >= 4 && group.length <= 8) for (const i of group) { otp.push(i); seen.add(i); }
  }

  for (const input of inputs) {
    if (seen.has(input)) continue;
    const type = (attr(input, "type") || "text").toLowerCase();
    const autocomplete = attr(input, "autocomplete").toLowerCase();
    if (autocomplete === "one-time-code") { otp.push(input); seen.add(input); continue; }
    const inputmode = attr(input, "inputmode").toLowerCase();
    const numericish = inputmode === "numeric" || inputmode === "tel" || type === "tel" || type === "number" || type === "text";
    const ml = maxLength(input);
    if (!numericish || ml < 1 || ml > 8) continue;
    if (HINT.test(labelText(input, root))) { otp.push(input); seen.add(input); }
  }
  return { password, otp };
}

/** What the page says it is: title, site name, first heading, logo alts, brand/logo text. */
export function collectBrandText(doc: Document): string {
  const parts: string[] = [];
  parts.push(doc.title ?? "");
  parts.push(attr(doc.querySelector('meta[property="og:site_name"]') ?? doc.createElement("meta"), "content"));
  parts.push(text(doc.querySelector("h1, h2")));
  for (const img of doc.querySelectorAll('header img[alt], nav img[alt], [class*="logo" i] img[alt], [id*="logo" i] img[alt], img[class*="logo" i][alt], img[id*="logo" i][alt]')) {
    parts.push(attr(img, "alt"));
  }
  for (const el of doc.querySelectorAll('[class*="logo" i], [class*="brand" i], [id*="logo" i], [id*="brand" i]')) {
    const t = text(el);
    if (t) parts.push(t.slice(0, 100));
  }
  const seen = new Set<string>();
  const joined = parts
    .map((p) => p.replace(/\s+/g, " ").trim().toLowerCase())
    .filter((p) => p && !seen.has(p) && seen.add(p))
    .join(" | ");
  return joined.slice(0, 600);
}

/** The host to judge. A demo page served from localhost sets a pretend host. */
export function pageHost(): string {
  const override = (globalThis as unknown as { __guardDemoHost?: string }).__guardDemoHost;
  return (override || (typeof location !== "undefined" ? location.hostname : "")).toLowerCase();
}
