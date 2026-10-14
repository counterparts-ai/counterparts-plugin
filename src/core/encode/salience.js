import { clampSalienceAtSeam, novelty as physicsNovelty } from "../physics/index.js";
export function computeNovelty(chunkVector, contextVectors) {
  const context = (contextVectors ?? []).filter((v) => v.length > 0);
  if (chunkVector === null || chunkVector === undefined || chunkVector.length === 0) {
    return { novelty: null, reason: "no-chunk-vector", blind: true, contextCount: context.length };
  }
  if (context.length === 0) {
    return { novelty: null, reason: "blind-no-context", blind: true, contextCount: 0 };
  }
  const usable = context.filter((v) => v.length === chunkVector.length);
  if (usable.length === 0) {
    return {
      novelty: null,
      reason: "vector-dimension-mismatch",
      blind: true,
      contextCount: context.length
    };
  }
  const value = physicsNovelty(chunkVector, usable);
  return {
    novelty: value,
    reason: value === null ? "blind-no-context" : "computed",
    blind: value === null,
    contextCount: usable.length
  };
}
export function tagSalience(dimensions, claimedSalience, noveltyResult) {
  const dims = {
    novelty: noveltyResult.novelty,
    relevance: dimensions?.relevance ?? 0,
    emotional: dimensions?.emotional ?? 0,
    predictive: dimensions?.predictive ?? 0
  };
  const clamped = clampSalienceAtSeam(dims, claimedSalience ?? null);
  return { ...clamped, novelty: noveltyResult };
}
