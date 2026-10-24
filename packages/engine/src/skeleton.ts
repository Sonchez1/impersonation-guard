/** UTS #39 section 4 confusable detection: skeleton() and confusable(). */

import confusablesJson from "../data/confusables.json";
import { casefold, nfd } from "./unicode";

const TABLE: Record<string, string> = confusablesJson as Record<string, string>;

export function confusables(): Record<string, string> {
  return TABLE;
}

/** NFD, map each character to its confusable prototype, NFD again. */
export function skeleton(text: string): string {
  let mapped = "";
  for (const ch of nfd(text)) mapped += TABLE[ch] ?? ch;
  return nfd(mapped);
}

/** Case-insensitive skeleton: casefold, skeleton, casefold again. */
export function foldSkeleton(text: string): string {
  return casefold(skeleton(casefold(text)));
}

export function confusable(a: string, b: string): boolean {
  return skeleton(a) === skeleton(b);
}
