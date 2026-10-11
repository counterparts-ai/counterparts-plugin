/**
 * FREEZE, BUT KEEP COUNTING — the lived-salience doctrine, as arithmetic.
 *
 * The ruling (v1, 2026-08-24, behavioral-spec §14.2): **identity strength comes
 * from lived salience only, never from transcript reading.** A model reading a
 * transcript of its own conduct and agreeing with its own schema is
 * self-narration, not evidence — the human analog is the rumination /
 * illusory-truth pathway, a documented bug of cognition rather than architecture
 * to copy. v1 measured ~30 identity reinforcements a day arriving that way,
 * including one case of the model confirming praise of itself in the span it was
 * reading.
 *
 * The mechanism is deliberately NOT "skip the call":
 *
 *   **The frozen arm runs the identical walk with identical guards, mutates
 *   nothing, and emits the same per-occasion event with a frozen marker. The
 *   event IS the measurement; the movement is what is withheld.**
 *
 * A frozen rate measured on a different denominator would not be comparable to
 * the live one, which is the entire reason for logging it — the decision keeps
 * generating the evidence that could overturn it. So `decide()` below is a pure
 * verdict on the SAME inputs both arms compute, and the caller (`Self`) walks the
 * same path either way, differing at exactly one line: whether `store.reinforce`
 * is called.
 *
 * Three boundaries the verdict must get right, all of them earned:
 *   - **G6 — softening is untouched, on every kind.** Freezing both directions
 *     would make the identity model unrevisable in both. The interpreter stays a
 *     reporter on identity: it softens, it never strengthens.
 *   - **G7 — claims about other people are ordinary memory.** Learning about
 *     someone from what they say is not self-narration.
 *   - **G8 — the freeze is decided on the RESOLVED element**, so a confirmation
 *     addressed to a superseded id still freezes. That resolution happens in
 *     `Self`, at the store seam, before this function is asked anything.
 */
import type { Kind } from "../types.js";

/**
 * Where the occasion came from. The doctrine names the legitimate identity
 * inputs — the moments where something mattered *while it happened* — and they
 * get no new gate, because they are the front door (§14.2 G8).
 */
export type ClaimSource =
  /** The crash-fallback transcript sweep: the frozen channel (contract §4). */
  | "fallback"
  /** The experiencer's own end-of-session authorship — v2's front door. */
  | "authored"
  /** The day's own narration. */
  | "episode"
  /** The core reshaped under sustained surprise. */
  | "accommodation";

/** Confirmations strengthen; softenings revise. Only one of them is frozen. */
export type ClaimDirection = "confirm" | "soften";

export type FreezeReason =
  /** Withheld: a fallback-authored confirmation against the self. */
  | "frozen-self-claim-repeat"
  /** Lived salience: the doctrine's own inputs, unfrozen by construction. */
  | "live-lived-salience"
  /** Softening moves on every kind, from every channel (§14.2 G3/G6). */
  | "live-softening"
  /** Ordinary memory: a claim about someone else is not self-narration (G7). */
  | "live-other-kind";

/**
 * The kinds the freeze covers. `self` is the identity core; `skill` is the
 * procedural self, which is still the self — v1 froze both, and the craft lane
 * is exactly the surface that would otherwise ratchet on self-praise.
 */
export const FROZEN_KINDS: readonly Kind[] = ["self", "skill"];

export interface FreezeVerdict {
  readonly frozen: boolean;
  readonly reason: FreezeReason;
}

/**
 * Pure, total, and deliberately tiny. The order of the tests is the doctrine:
 * softening first (it is never frozen), then channel (the front doors are never
 * frozen), then kind (only the self freezes).
 */
export function decide(
  kind: Kind,
  source: ClaimSource,
  direction: ClaimDirection,
): FreezeVerdict {
  if (direction === "soften") return { frozen: false, reason: "live-softening" };
  if (source !== "fallback") return { frozen: false, reason: "live-lived-salience" };
  if (!FROZEN_KINDS.includes(kind)) return { frozen: false, reason: "live-other-kind" };
  return { frozen: true, reason: "frozen-self-claim-repeat" };
}

/**
 * The counter's keyspace. One row per (kind, arm) so the frozen rate and the
 * live rate share a denominator and stay comparable — the property the whole
 * "keep counting" half exists to preserve.
 */
export function counterKey(kind: Kind, frozen: boolean): string {
  return `self.claims.${kind}.${frozen ? "frozen" : "live"}`;
}

export const COUNTER_PREFIX = "self.claims.";
