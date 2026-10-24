/** Small Unicode helpers that mirror the Python str methods the engine relies on. */

/** Approximation of Python's str.casefold(): full lower-casing plus the few
 *  one-to-many folds that matter for Latin text. */
export function casefold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss") // ß
    .replace(/ẞ/g, "ss") // ẞ
    .replace(/ſ/g, "s"); // ſ
}

export function nfd(text: string): string {
  return text.normalize("NFD");
}

export function nfkc(text: string): string {
  return text.normalize("NFKC");
}

/** Code points of a string, so indexing matches Python's per-character semantics. */
export function chars(text: string): string[] {
  return Array.from(text);
}

export function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) return false;
  return true;
}

export function isAsciiAlpha(ch: string): boolean {
  return /^[A-Za-z]$/.test(ch);
}

export function isDigitToken(tok: string): boolean {
  return /^\p{Nd}+$/u.test(tok);
}

export function isLower(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase();
}

export function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

// ---------------------------------------------------------------------------
// Punycode (RFC 3492) decoding, enough to render xn-- labels as Python's
// str.decode("idna") would.
// ---------------------------------------------------------------------------

const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - TMIN) * TMAX) >> 1) {
    delta = Math.floor(delta / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

function digitValue(cp: number): number {
  if (cp - 48 < 10) return cp - 22;
  if (cp - 65 < 26) return cp - 65;
  if (cp - 97 < 26) return cp - 97;
  return BASE;
}

export function punycodeDecode(input: string): string {
  const output: number[] = [];
  let basic = input.lastIndexOf("-");
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) {
    const cp = input.charCodeAt(j);
    if (cp >= 0x80) throw new Error("not-basic");
    output.push(cp);
  }
  let n = INITIAL_N, bias = INITIAL_BIAS, i = 0;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error("invalid-input");
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE) throw new Error("invalid-input");
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    n += Math.floor(i / out);
    i %= out;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** Decode every ``xn--`` label of a host; on any failure return the host unchanged
 *  (Python's ``.encode("ascii").decode("idna")`` raises and the caller falls back). */
export function idnaToUnicode(host: string): string {
  if (!isAscii(host)) return host;
  try {
    return host
      .split(".")
      .map((lab) => (lab.toLowerCase().startsWith("xn--") ? punycodeDecode(lab.slice(4)) : lab))
      .join(".");
  } catch {
    return host;
  }
}

// ---------------------------------------------------------------------------
// Python-compatible regex source: \b and \w in Python's re are Unicode-aware,
// JavaScript's are ASCII-only. Rewrite them so the cue patterns behave the same.
// ---------------------------------------------------------------------------

const WORD = "\\p{L}\\p{N}_";
const WB = "(?:(?<![" + WORD + "])(?=[" + WORD + "])|(?<=[" + WORD + "])(?![" + WORD + "]))";

/** Translate a JS regex source written with Python semantics in mind. Must be compiled with the u flag. */
export function pySource(src: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "b" && !inClass) out += WB;
      else if (next === "w") out += inClass ? WORD : "[" + WORD + "]";
      else out += ch + next;
      i++;
      continue;
    }
    if (ch === "[" && !inClass) inClass = true;
    else if (ch === "]" && inClass) inClass = false;
    out += ch;
  }
  return out;
}

export function pyRegExp(src: string, flags = ""): RegExp {
  return new RegExp(pySource(src), flags.includes("u") ? flags : flags + "u");
}
