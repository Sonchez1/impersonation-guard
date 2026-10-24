/** Layer 2: a learned, explainable impersonation score for senders and domains. */

import weightsJson from "../data/scorer_weights.json";
import { FEATURE_NAMES, FeatureExtractor, Features, Sender } from "./features";

const PAYLOAD = weightsJson as { weights: Record<string, number> };

export function defaultWeights(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(PAYLOAD.weights)) out[k] = Number(v);
  return out;
}

export interface SenderScore {
  probability: number;
  features: Features;
  contributions: Features;
}

/** Features that pushed the score up, strongest first. */
export function scoreReasons(s: SenderScore): string[] {
  return Object.entries(s.contributions)
    .filter(([k, v]) => v > 0 && (s.features[k] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

export class SenderScorer {
  readonly extractor: FeatureExtractor;
  readonly weights: Record<string, number>;
  readonly bias: number;

  constructor(protectedNames: string[], weights?: Record<string, number>, maxDistance = 2) {
    this.extractor = new FeatureExtractor(protectedNames, maxDistance);
    this.weights = weights ? { ...weights } : defaultWeights();
    const missing = FEATURE_NAMES.filter((k) => !(k in this.weights));
    if (missing.length) throw new Error(`weights missing features: ${missing.join(", ")}`);
    this.bias = Number(this.weights.bias ?? 0);
  }

  private scoreFeatures(feats: Features): SenderScore {
    const contrib: Features = {};
    let z = this.bias;
    for (const k of FEATURE_NAMES) {
      contrib[k] = this.weights[k] * feats[k];
      z += contrib[k];
    }
    const p = 1 / (1 + Math.exp(-z));
    return { probability: p, features: feats, contributions: contrib };
  }

  score(sender: Sender): SenderScore {
    return this.scoreFeatures(this.extractor.extract(sender));
  }

  scoreDomain(domain: string): SenderScore {
    const feats: Features = {};
    for (const k of FEATURE_NAMES) feats[k] = 0;
    Object.assign(feats, this.extractor.domainFeatures(domain));
    return this.scoreFeatures(feats);
  }
}
