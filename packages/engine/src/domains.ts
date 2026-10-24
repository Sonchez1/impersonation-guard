/** Domain, address, and token helpers shared by the sender scorer and the pipeline.
 *  Port of impersonation_detector/domains.py. */

import { casefold, idnaToUnicode, isDigitToken, nfkc } from "./unicode";

export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "pm.me", "mail.com", "yandex.com", "gmx.com", "gmx.net", "zoho.com", "tutanota.com",
  "fastmail.com", "hey.com", "mail.ru", "qq.com", "163.com",
]);

const MULTI_SUFFIX = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "edu.au",
  "co.nz", "co.jp", "ne.jp", "or.jp", "co.in", "net.in", "org.in", "co.za", "com.br",
  "com.mx", "com.ar", "com.sg", "com.hk", "com.tw", "co.kr", "com.cn", "com.tr", "com.ng",
  "co.il", "com.my", "com.ph", "com.pk", "com.eg", "com.sa",
]);

export const KNOWN_TLDS = new Set([
  "com", "net", "org", "edu", "gov", "mil", "int", "io", "co", "ai", "app", "dev", "me", "us",
  "uk", "ca", "de", "fr", "au", "in", "jp", "br", "nl", "se", "no", "es", "it", "ch", "ru", "cn",
  "info", "biz", "xyz", "online", "site", "top", "club", "shop", "store", "tech", "cloud",
  "live", "link", "click", "help", "support", "careers", "jobs", "work", "ly", "gl", "tv",
]);

export const INSTITUTIONAL_TLDS = ["edu", "gov", "mil", "ac.uk", "edu.au", "ac.jp", "ac.in"];

export const ROLE_WORDS = new Set([
  "support", "security", "help", "helpdesk", "verify", "verification", "account", "accounts",
  "admin", "administrator", "billing", "careers", "career", "recruit", "recruiter", "recruiting",
  "recruitment", "hr", "talent", "team", "official", "noreply", "no-reply", "donotreply", "alerts",
  "alert", "notifications", "notification", "service", "services", "it", "desk", "payroll",
  "compliance", "trust", "safety", "fraud", "update", "updates", "info", "contact", "onboarding",
  "hiring", "jobs", "employer", "employers",
]);

export const DOMAIN_LURE_WORDS = new Set([
  "verify", "verification", "login", "logon", "signin", "auth", "secure", "security", "account",
  "accounts", "update", "portal", "support", "helpdesk", "alert", "alerts", "notice", "check",
  "confirm", "validate", "recovery", "reset", "payroll", "billing", "invoice", "docs", "share",
  "mail", "webmail", "service", "services", "careers", "jobs", "hr", "talent", "connect", "hiring",
  "official", "team", "admin",
]);

const GENERIC = new Set([
  ...ROLE_WORDS,
  "com", "net", "org", "edu", "io", "co", "www", "mail", "email", "the", "inc", "llc", "corp",
  "ltd", "group", "global", "online", "app", "my", "get", "join", "use", "go", "login", "secure",
  "portal", "us", "usa",
]);

const INVISIBLE_CODEPOINTS: number[] = [
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad, 0x034f, 0x061c, 0x180e,
];
for (let c = 0x2061; c < 0x2065; c++) INVISIBLE_CODEPOINTS.push(c);
for (let c = 0x206a; c < 0x2070; c++) INVISIBLE_CODEPOINTS.push(c);
for (let c = 0xe0000; c < 0xe0080; c++) INVISIBLE_CODEPOINTS.push(c);
const INVISIBLE = new RegExp(
  "[" + INVISIBLE_CODEPOINTS.map((c) => "\\u{" + c.toString(16) + "}").join("") + "]",
  "u",
);
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
const EMAIL = /^\s*(?:"?([^"<]*?)"?\s*<([^\s<>@]+)@([^\s<>@]+)>|([^\s<>@]+)@([^\s<>@]+))\s*$/;

const LEET: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "|": "l", "!": "i" };
const LEET_I: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "|": "i", "!": "i" };

function translate(text: string, table: Record<string, string>): string {
  let out = "";
  for (const ch of text) out += table[ch] ?? ch;
  return out;
}

export function hasInvisible(text: string): boolean {
  return INVISIBLE.test(text) || CONTROL.test(text);
}

export function stripInvisible(text: string): string {
  return text.replace(new RegExp(INVISIBLE.source, "gu"), "").replace(new RegExp(CONTROL.source, "g"), "");
}

export function decodeIdn(host: string): string {
  if (!casefold(host).includes("xn--")) return host;
  return idnaToUnicode(host);
}

export function normalizeHost(host: string): string {
  host = casefold(stripInvisible(host).trim().replace(/^\.+|\.+$/g, ""));
  return host.split("/", 1)[0].split(":", 1)[0];
}

export function labels(host: string): string[] {
  return decodeIdn(normalizeHost(host)).split(".").filter((l) => l.length > 0);
}

export function registrable(host: string): string {
  const labs = labels(host);
  if (labs.length <= 2) return labs.join(".");
  if (MULTI_SUFFIX.has(labs.slice(-2).join(".")) && labs.length >= 3) return labs.slice(-3).join(".");
  return labs.slice(-2).join(".");
}

export function sld(host: string): string {
  const reg = registrable(host);
  return reg ? reg.split(".", 1)[0] : "";
}

export function tld(host: string): string {
  const reg = registrable(host);
  const i = reg.indexOf(".");
  return i >= 0 ? reg.slice(i + 1) : "";
}

export function subdomainLabels(host: string): string[] {
  const labs = labels(host);
  const regLen = labs.length ? registrable(host).split(".").length : 0;
  return labs.slice(0, Math.max(0, labs.length - regLen));
}

/** Casefolded alphanumeric tokens, NFKC-normalized, invisibles removed. */
export function tokenize(text: string): string[] {
  const t = casefold(nfkc(stripInvisible(text)));
  return t.split(/[^\p{L}\p{N}_]+/u).filter((x) => x.length > 0);
}

export function unleet(text: string): string {
  return translate(text, LEET);
}

export function unleetI(text: string): string {
  return translate(text, LEET_I);
}

export function unconfuseAscii(text: string): string {
  return text.replace(/rn/g, "m").replace(/RN/g, "M").replace(/vv/g, "w").replace(/VV/g, "W").replace(/cl/g, "d");
}

export function brandTokens(protectedNames: string[]): Set<string> {
  const out = new Set<string>();
  for (const name of protectedNames) {
    for (const tok of tokenize(name)) {
      if (tok.length >= 4 && !GENERIC.has(tok) && !isDigitToken(tok)) out.add(tok);
    }
  }
  return out;
}

export function protectedDomains(protectedNames: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of protectedNames) if (p.includes(".") && !p.trim().includes(" ")) out.add(registrable(p));
  return out;
}

/** Split ``"Name" <local@domain>`` / ``local@domain`` / a bare handle. */
export function parseAddress(address: string): [string, string, string] {
  const m = EMAIL.exec(address || "");
  if (!m) return ["", (address || "").trim().replace(/^@+/, ""), ""];
  let name: string, local: string, domain: string;
  if (m[2] !== undefined) {
    name = m[1] || ""; local = m[2]; domain = m[3];
  } else {
    name = ""; local = m[4]; domain = m[5];
  }
  return [name.trim(), local.trim(), casefold(domain.trim().replace(/^\.+|\.+$/g, ""))];
}

export function embeddedDomain(host: string): string | null {
  const subs = subdomainLabels(host);
  for (let i = 1; i < subs.length; i++) {
    if (KNOWN_TLDS.has(subs[i]) && !KNOWN_TLDS.has(subs[i - 1])) {
      if (i + 1 < subs.length && MULTI_SUFFIX.has(`${subs[i]}.${subs[i + 1]}`)) {
        return subs.slice(i - 1, i + 2).join(".");
      }
      return `${subs[i - 1]}.${subs[i]}`;
    }
  }
  return null;
}

export function isInstitutional(host: string): boolean {
  const reg = registrable(host);
  return INSTITUTIONAL_TLDS.some((t) => reg === t || reg.endsWith("." + t));
}
