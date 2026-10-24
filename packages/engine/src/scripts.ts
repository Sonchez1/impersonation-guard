/** Script detection and mixed-script checks (UTS #39 section 5). */

import rangesJson from "../data/scripts.json";

const RANGES: [number, number, string][] = rangesJson as [number, number, string][];
const NEUTRAL = new Set(["Common", "Inherited", "Unknown"]);
const ALLOWED_COMBOS: Set<string>[] = [
  new Set(["Latin", "Han", "Hiragana", "Katakana"]),
  new Set(["Latin", "Han", "Bopomofo"]),
  new Set(["Latin", "Han", "Hangul"]),
];

export function scriptOf(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  let lo = 0, hi = RANGES.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (RANGES[mid][0] <= cp) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  if (i >= 0) {
    const [a, b, script] = RANGES[i];
    if (a <= cp && cp <= b) return script;
  }
  return "Unknown";
}

export function scriptsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const ch of text) {
    const s = scriptOf(ch);
    if (!NEUTRAL.has(s)) out.add(s);
  }
  return out;
}

export function isMixedScript(text: string): boolean {
  const found = scriptsIn(text);
  if (found.size <= 1) return false;
  return !ALLOWED_COMBOS.some((combo) => [...found].every((s) => combo.has(s)));
}
