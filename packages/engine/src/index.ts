/** @impersonation-guard/engine: TypeScript port of the impersonation-detector message
 *  engine. Layer 1 deterministic lookalike checks, Layer 2 explainable sender score,
 *  Layer 3 message intent (rule baseline or a local LLM), fused into one verdict. */

export { casefold, chars, idnaToUnicode, nfd, nfkc, pyRegExp, pySource } from "./unicode";
export * from "./domains";
export { osaDistance } from "./distance";
export { confusable, foldSkeleton, skeleton } from "./skeleton";
export { isMixedScript, scriptOf, scriptsIn } from "./scripts";
export { LookalikeDetector, type Match } from "./lookalike";
export { FEATURE_NAMES, FeatureExtractor, type Features, type Sender, senderParts } from "./features";
export { SenderScorer, type SenderScore, scoreReasons, defaultWeights } from "./scorer";
export * from "./intent";
export {
  ACTIONS, type Action, DEFAULT_THRESHOLDS, Detector, type DetectorOptions, type Thresholds, type Verdict,
  extractHosts, senderFacts,
} from "./pipeline";
export { explainVerdict, type Explanation, type EvidenceItem } from "./explain";

export const ENGINE_VERSION = "0.1.0";
export const UPSTREAM_VERSION = "impersonation-detector 0.3.0";
