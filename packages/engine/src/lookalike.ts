/** Layer 1: deterministic lookalike detection against a set of protected names. */

import { osaDistance } from "./distance";
import { isMixedScript, scriptsIn } from "./scripts";
import { foldSkeleton } from "./skeleton";
import { casefold, idnaToUnicode } from "./unicode";

export interface Match {
  candidate: string;
  protected: string;
  reasons: string[];
  distance: number;
}

export class LookalikeDetector {
  readonly protected: string[];
  readonly maxDistance: number;
  private skeletons: Map<string, string>;

  constructor(protectedNames: string[], maxDistance = 2) {
    this.protected = protectedNames.map((p) => p.trim()).filter((p) => p.length > 0);
    this.maxDistance = maxDistance;
    this.skeletons = new Map(this.protected.map((p) => [p, foldSkeleton(p)]));
  }

  private static decodeIdn(text: string): string {
    if (!casefold(text).includes("xn--")) return text;
    return idnaToUnicode(text);
  }

  private threshold(name: string): number {
    const n = Array.from(name).length;
    if (n <= 4) return 0;
    if (n <= 8) return Math.min(this.maxDistance, 1);
    return this.maxDistance;
  }

  check(candidate: string): Match[] {
    const shown = LookalikeDetector.decodeIdn(candidate);
    const folded = casefold(shown);
    const candSkel = foldSkeleton(shown);
    const mixed = isMixedScript(shown);
    const matches: Match[] = [];
    for (const [name, protSkel] of this.skeletons) {
      if (folded === casefold(name)) continue;
      const reasons: string[] = [];
      if (candSkel === protSkel) reasons.push("confusable-skeleton");
      const dist = osaDistance(candSkel, protSkel);
      const th = this.threshold(name);
      if (dist > 0 && dist <= th) reasons.push(`edit-distance<=${th}`);
      if (reasons.length && mixed) reasons.push("mixed-script:" + [...scriptsIn(shown)].sort().join("+"));
      if (reasons.length && shown !== candidate) reasons.push("punycode");
      if (reasons.length) matches.push({ candidate, protected: name, reasons, distance: dist });
    }
    matches.sort((a, b) => a.distance - b.distance || (a.protected < b.protected ? -1 : a.protected > b.protected ? 1 : 0));
    return matches;
  }

  isLookalike(candidate: string): boolean {
    return this.check(candidate).length > 0;
  }
}
