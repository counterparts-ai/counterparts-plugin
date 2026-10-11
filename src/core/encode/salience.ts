/**
 * Salience tagging at the proposal → memory seam, and novelty as prediction error.
 *
 * Four-dimensional salience is scored ONCE and fixed at birth [v0]. Three of the
 * dimensions are the author's; the fourth — novelty — is COMPUTED, because
 * prediction error is a number, not a model opinion (§3).
 *
 * The arithmetic is `physics/`'s and stays there: this module supplies the inputs
 * and the vocabulary of "why there is no number", which is the part `physics`
 * deliberately does not know about. **Vectors are supplied by the caller.**
 * Nothing here fetches an embedding, calls a model, or touches the store — the
 * failure modes below are all "the caller had nothing to give me".
 *
 * The claimed-salience FLOOR: v1's plain "remember this" note claimed a
 * high-salience floor ONLY IN ITS PROMPT, with no engine backstop — the one place
 * a stated guarantee had no enforcement (§5 G6). Here the claim is clamped by
 * `physics.clampSalienceAtSeam`, and any lift emits `salience.lifted`. The prompt
 * states nothing the engine does not enforce.
 */

import { clampSalienceAtSeam, novelty as physicsNovelty } from "../physics/index.js";
import type { SeamClamp } from "../physics/index.js";
import type { Salience } from "../types.js";
import type { ClaimedDimensions } from "./types.js";

/**
 * Why there is (or is not) a novelty number. `blind-no-context` is the countable
 * case scar §2.9 exists for: v1's residual blind rate was ~a fifth to a quarter of
 * chunks, and 7 blind chunks minted 16 real memories.
 */
export type NoveltyReason =
  | "computed"
  | "blind-no-context"
  | "no-chunk-vector"
  | "vector-dimension-mismatch";

export interface NoveltyResult {
  /** NULL when it could not be computed. Never defaulted to a number, in either
   *  direction — a defaulted 0 fakes "seen this before", a defaulted 1 fakes
   *  "brand new", and both are lies the rest of physics then believes. */
  novelty: number | null;
  reason: NoveltyReason;
  blind: boolean;
  /** How many context vectors were actually usable. */
  contextCount: number;
}

/**
 * novelty = 1 − max cos( v(chunk), v(e) ) over the supplied context.
 *
 * Degradable by construction: a missing vector, an empty context, or a dimension
 * mismatch yields NULL and a reason — never a throw, never a guess.
 */
export function computeNovelty(
  chunkVector: readonly number[] | null | undefined,
  contextVectors: readonly (readonly number[])[] | undefined,
): NoveltyResult {
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
      contextCount: context.length,
    };
  }
  // physics' `cosine` throws on a dimension mismatch; the filter above is why it
  // cannot throw here. Mismatched vectors are dropped, and the drop is countable.
  const value = physicsNovelty(chunkVector, usable);
  return {
    novelty: value,
    reason: value === null ? "blind-no-context" : "computed",
    blind: value === null,
    contextCount: usable.length,
  };
}

export interface SalienceTag extends SeamClamp {
  novelty: NoveltyResult;
}

/**
 * The seam itself. Dimensions are stored EXACTLY as authored; the claim is stored
 * beside them as a floor; a null novelty stays null. `physics` owns every one of
 * those rules — this function's whole job is to make sure the seam is crossed
 * once, in one place, with the event attached.
 */
export function tagSalience(
  dimensions: ClaimedDimensions | undefined,
  claimedSalience: number | null | undefined,
  noveltyResult: NoveltyResult,
): SalienceTag {
  const dims: Salience = {
    novelty: noveltyResult.novelty,
    relevance: dimensions?.relevance ?? 0,
    emotional: dimensions?.emotional ?? 0,
    predictive: dimensions?.predictive ?? 0,
  };
  const clamped = clampSalienceAtSeam(dims, claimedSalience ?? null);
  return { ...clamped, novelty: noveltyResult };
}
