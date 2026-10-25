/**
 * The delta buffer — **the declared durability exemption** (§10 G6, contract G11).
 *
 * Per-turn co-activation deltas accumulate in fast mutable state and batch-flush
 * at the boundary. A crash therefore loses at most one session's reinforcement,
 * **never a memory**: everything in here is an increment to learned structure that
 * the next co-activation will re-earn, and nothing in here is the only copy of
 * anything. That is the whole content of the exemption, and this file plus
 * `associate/CONTRACT.md` §5 G11 are the ONLY places it may be declared — a second
 * module that buffers non-reconstructible state fails review.
 *
 * On a host whose credit pass and boundary are different processes the pass
 * drains this buffer to a file instead of publishing from it (`pending.ts`), so
 * what dies with that process is the pass in flight rather than the session's
 * reinforcement. The exemption is unchanged: the file holds the same
 * re-earnable increments, and the buffer is still where they accumulate.
 *
 * The drain is where at-most-once is decided, so it is a method with one job:
 *
 *   **`drain()` SWAPS the map, it does not clear it in place.** The returned batch
 *   is exactly what was read, and a delta that arrives during the flush lands in
 *   the fresh map and survives to the next one (§10 G5 — a concurrent arrival is
 *   never deleted unflushed).
 *
 * The caller's ordering — drain FIRST, publish SECOND, and never restore on a
 * failed publish — is what makes a crash drop one flush's deltas rather than
 * double-apply them. See index.ts.
 */
import { pairKey } from "./edges.js";
import type { CueDelta, PairDelta } from "./edges.js";

export class DeltaBuffer {
  private pairs = new Map<string, PairDelta>();

  /**
   * Accumulate one unordered pair's delta. Ordering of (a, b) never matters —
   * unless `back` is given (2026-09-28): then `delta` is a → b and `back` is
   * b → a, the one directed case (temporal contiguity's forward bias). The
   * slot stays canonical (a < b), with the two directions swapped to match.
   */
  add(a: string, b: string, delta: number, back: number = delta): void {
    if ((delta <= 0 && back <= 0) || a === b) return;
    const key = pairKey(a, b);
    const [lo, hi, ab, ba] = a < b ? [a, b, delta, back] : [b, a, back, delta];
    const have = this.pairs.get(key);
    const nextAb = (have?.delta ?? 0) + ab;
    const nextBa = (have === undefined ? 0 : have.back ?? have.delta) + ba;
    this.pairs.set(key, nextAb === nextBa ? { a: lo, b: hi, delta: nextAb } : { a: lo, b: hi, delta: nextAb, back: nextBa });
  }

  get size(): number {
    return this.pairs.size;
  }

  /** A read-only look at what is pending. Copies — the caller cannot mutate it. */
  pending(): PairDelta[] {
    return [...this.pairs.values()].map((p) => ({ ...p }));
  }

  /**
   * Take everything buffered, atomically with respect to this process: the map is
   * replaced, so what comes back is closed and what arrives next is separate.
   */
  drain(): PairDelta[] {
    const taken = this.pairs;
    this.pairs = new Map<string, PairDelta>();
    return [...taken.values()];
  }
}

/**
 * The CUE half of the same exemption (2026-10-24, R3 cue learning): per-turn
 * word-to-memory deltas, buffered and drained exactly as pair deltas are —
 * declared here, beside them, because this file is the one place the
 * exemption may be declared. Re-earnable by construction: the next credited
 * use of the same memory from the same word earns it again. SIGNED, unlike
 * pairs: a rating of 0 depresses (the pair floors at 0 in the flush), so it
 * is not a `DeltaBuffer`, whose `add` drops anything at or below 0.
 *
 * KEPT ONE BY ONE, NOT SUMMED (review of #613): the flush's update saturates
 * per use (`edges.ts#cueStrengthen`, `w + Δ(1 − w/CUE_W_CAP)`), which holds a
 * pair under its cap only for a Δ no larger than the cap. Summed, three uses
 * of a bare word that reached the worker together (Δ 0.5 each) arrived as one
 * Δ of 1.5 and wrote a pair of 1.5, past `CUE_W_CAP` 1. Kept apart, the flush
 * applies them in arrival order, as the same uses one at a time would be.
 */
export class CueBuffer {
  private cues: CueDelta[] = [];

  add(token: string, id: string, delta: number): void {
    if (!Number.isFinite(delta) || delta === 0 || token.length === 0 || id.length === 0) return;
    this.cues.push({ token, id, delta });
  }

  get size(): number {
    return this.cues.length;
  }

  pending(): CueDelta[] {
    return this.cues.map((c) => ({ ...c }));
  }

  /** Swap, as `DeltaBuffer#drain` does: what arrives during a flush survives to the next. */
  drain(): CueDelta[] {
    const taken = this.cues;
    this.cues = [];
    return taken;
  }
}
