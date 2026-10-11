/**
 * Temporal contiguity — the weak, ubiquitous link (association build 2,
 * 2026-09-28). A PURE planner: a session's memories in write order in, pair
 * deltas out. It reads no store and writes nothing; `Associate.contiguity`
 * checks the endpoints and buffers the deltas, and the boundary's flush writes
 * them through the same plan, homeostasis and sweep as a co-use.
 *
 * The analog is the temporal context model (TCM): items lived next to each
 * other cue each other, the nearer the more, and forward more than back.
 * Three rules the code mechanizes:
 *
 *   1. **Adjacent only.** Each memory links to its `CONTIGUITY_WINDOW`
 *      neighbours in its session's write order (lag 1, lag 2), never to the
 *      whole session: a 30-memory session makes at most ~57 pairs, not 435.
 *   2. **Lag-weighted.** Lag 1 gets `CONTIGUITY_RATE`; each further lag keeps
 *      `CONTIGUITY_LAG_DECAY` of the one before.
 *   3. **Forward bias only where the order is real.** Most memories are written
 *      in one batch at session end, in the order the model listed them — not
 *      the order things happened. Two memories written more than
 *      `CONTIGUITY_BATCH_MS` apart have a real order (a note made mid-session,
 *      then the session's end): the earlier one's link forward gets the full
 *      delta and the link back `CONTIGUITY_BACKWARD` of it. Inside a batch the
 *      two directions get the same delta, the mean of those two.
 *
 * Only pairs with at least one NEW member are planned, so a boundary that
 * reads a session again (to find a new memory's older neighbours) never
 * re-credits the pairs an earlier boundary already made.
 */
import type { PairDelta } from "./edges.js";
import type { AssociateTunables } from "./tunables.js";

/** One memory in its session's write order. */
export interface ContiguityRow {
  readonly id: string;
  /** The moment it was written (UTC ms) — `memories.created_at`. */
  readonly at: number;
  /** Written since the last boundary's pass: only pairs touching one are new. */
  readonly fresh: boolean;
}

export interface ContiguityPlan {
  /** One per pair, a = the EARLIER memory; `back` set when the order is real. */
  readonly deltas: readonly PairDelta[];
  /** Pairs planned, and how many had a real order (forward bias) or were one batch (flat). */
  readonly pairs: number;
  readonly timed: number;
  readonly batch: number;
  /** Directed deltas at or under the conduct floor: on a pair with no live edge
   *  yet they are written and swept in the same flush; they only add to a pair
   *  that already has one. Counted so nobody mistakes them for links made. */
  readonly underFloor: number;
}

/** Plan one session's contiguity. `rows` must be in write order. */
export function planContiguity(rows: readonly ContiguityRow[], t: AssociateTunables): ContiguityPlan {
  const deltas: PairDelta[] = [];
  let timed = 0;
  let batch = 0;
  let underFloor = 0;
  const flat = (1 + t.CONTIGUITY_BACKWARD) / 2;
  for (let i = 0; i < rows.length; i++) {
    const earlier = rows[i] as ContiguityRow;
    for (let lag = 1; lag <= t.CONTIGUITY_WINDOW; lag++) {
      const later = rows[i + lag];
      if (later === undefined) break;
      if (!earlier.fresh && !later.fresh) continue;
      if (earlier.id === later.id) continue;
      const base = t.CONTIGUITY_RATE * Math.pow(t.CONTIGUITY_LAG_DECAY, lag - 1);
      const real = later.at - earlier.at > t.CONTIGUITY_BATCH_MS;
      const forward = real ? base : base * flat;
      const back = real ? base * t.CONTIGUITY_BACKWARD : base * flat;
      if (!(forward > 0) && !(back > 0)) continue;
      if (real) timed += 1;
      else batch += 1;
      if (forward <= t.EDGE_FLOOR) underFloor += 1;
      if (back <= t.EDGE_FLOOR) underFloor += 1;
      deltas.push(forward === back ? { a: earlier.id, b: later.id, delta: forward } : { a: earlier.id, b: later.id, delta: forward, back });
    }
  }
  return { deltas, pairs: deltas.length, timed, batch, underFloor };
}
