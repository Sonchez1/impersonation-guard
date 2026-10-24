/** Damerau-Levenshtein distance (optimal string alignment variant), over code points. */

import { chars } from "./unicode";

export function osaDistance(aStr: string, bStr: string): number {
  const a = chars(aStr), b = chars(bStr);
  const la = a.length, lb = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= la; i++) {
    d.push(new Array(lb + 1).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j <= lb; j++) d[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[la][lb];
}
