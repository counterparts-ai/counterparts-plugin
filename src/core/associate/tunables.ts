/**
 * Every knob in `associate/`, in one visible place — the shape `physics/` and
 * `recall/` use, for the same reason: a constant hiding in a function body cannot
 * be audited.
 *
 * **CAL = calibration-required** (scar §2.8: no threshold ships unmeasured against
 * the real space). Where v1 has a live calibration it is quoted as the starting
 * point, NOT a v2 measurement; where it has none, the entry says so out loud.
 * `tools/replay` is where these get re-earned.
 *
 * Structural (never tunable, never ablatable): the ignorable tier trains nothing;
 * the flush ordering (drain first, publish second) and its chosen failure
 * direction; the observer refusal; the conducting predicate that keeps a removed
 * or archived id from carrying activation.
 */
import type { DecayShape, UseTier } from "../physics/index.js";

export interface AssociateTunables {
  // ── the Hebbian update ───────────────────────────────────────────────────
  /**
   * The co-activation increment for a fully-credited pair — both endpoints
   * REFERENCED by the reply. CAL, and one of the few constants here with NO
   * ancestry at all: v1's harvest records the tier structure of credit (§10 G1)
   * and never the edge increment, so there is no number to inherit. At 0.1 a
   * pair reaches `EDGE_CAP` after ten co-activations that both mattered.
   */
  HEBB_RATE: number;
  /**
   * Edge credit for the WEAK tier — surfaced but unused. **Ships DISABLED (0)**
   * on purpose: contract §4 says weak credit's numeric weight is not inherited
   * and ships "bounded by fixtures naming what breaks on each side, or
   * disabled", and no such fixture exists yet. v1's reinforcement weight for the
   * weak tier was 0.25 (`physics.TUNABLES.W_SURFACED`) — recorded here as the
   * calibration to re-earn, deliberately NOT wired in. See NOTES.md §2. CAL.
   *
   * Considered again 2026-09-28 (association build 2) and LEFT AT 0, with the
   * fixture contract §4 asked for (`association-build2.test.ts` › "6."): at
   * 0.25 a referenced × surfaced pair (0.025) conducts on its first meeting —
   * "shown beside" linked to "thought with" at once, the squared factor not
   * binding for that pair type — while surfaced × surfaced (0.00625) is swept
   * at every flush and can never accumulate across boundaries. The credit pass
   * passes no `surfaced` member today in any case (`counterpart.ts`
   * `creditReferences` credits `referenced` only), and with one loud slot a
   * turn (`recall` `MAX_SURFACED` 1) surfaced × surfaced cannot occur in one
   * reply. The weak, ubiquitous signal is temporal contiguity now.
   */
  EDGE_WEAK_CREDIT: number;
  /** Per-edge ceiling. An edge is a readiness, not an unbounded counter. */
  EDGE_CAP: number;
  /** At or below this weight an edge is DEAD: it conducts nothing and is
   *  eligible for eviction. Also the "live edge" test for the count cap. CAL. */
  EDGE_FLOOR: number;

  // ── homeostasis (§10 G2) ─────────────────────────────────────────────────
  /** Cap on LIVE edges out of one node. Past it, the weakest are evicted. CAL. */
  MAX_EDGES_PER_NODE: number;
  /** Bound on the total outgoing weight of one node, enforced by PROPORTIONAL
   *  renormalization — synaptic scaling, not clipping: the node's edges keep
   *  their relative order and lose absolute weight together. CAL. */
  MAX_OUT_WEIGHT: number;

  // ── edge decay (physics family, own constants) ───────────────────────────
  /** Edge stability, in LIVED days (scar E8). Shorter than memory's `S_BASE`
   *  (60): an association that stops being used should fade faster than the
   *  memories it joins, or the graph becomes a fossil record of every
   *  coincidence. CAL, no ancestry. */
  S_EDGE: number;
  /**
   * The curve shape for edges. PINNED to exponential, and that is load-bearing
   * rather than a taste: decay is realized into the stored weight at flush time
   * (weight := decayed, last_day := d), which is exact only for a memoryless
   * curve. Changing this shape requires a separate "last reinforced day" column,
   * not a new constant (NOTES.md §4).
   */
  EDGE_DECAY_SHAPE: DecayShape;

  // ── spreading activation (§9 TUNABLE, v1's live calibration) ─────────────
  /** Hop limit. [v1: 2] CAL. */
  HOPS: number;
  /** Per-hop decay. [v1: 0.5] CAL. */
  HOP_DECAY: number;
  /** Fan normalization: an edge passes `w / max(MAX_OUT_WEIGHT, node's live
   *  sum)` of what its node carries, so a hub cannot flood and a weight means
   *  the same thing on a node with one edge as on a node with thirty
   *  (2026-09-28; it was `w / live sum`, relative to the siblings, which made a
   *  lone 0.03 edge pass everything). [v1: on] Structural-ish — off (raw
   *  weight) is an A/B arm, not a shipping mode. */
  FAN_NORMALIZATION: boolean;
  /** Nodes expanded in one traversal — since 2026-09-28 a host-cost BACKSTOP
   *  behind the threshold below, not the thing that normally stops the walk;
   *  when it binds, the turn's record says so (`stop: "node-limit"`, and how
   *  many nodes above the threshold were still waiting). CAL. */
  MAX_SPREAD_NODES: number;
  /**
   * The activation threshold of the best-first walk (association build 2,
   * 2026-09-28; ACT-R's retrieval threshold, in spirit): a node is expanded
   * only while what it carries is at least this fraction of the STRONGEST
   * seed's activation, and the walk stops at the first node under it. Relative
   * to the strongest seed because this module does not know recall's units —
   * the same fraction means the same thing on a small store and a big one. At
   * 0.02 a first hop from the strongest seed is expanded when its link weighs
   * about 0.16 or more (`0.5 · w / 4 ≥ 0.02`). CAL, unmeasured on a live store.
   */
  SPREAD_MIN_FRACTION: number;

  // ── temporal contiguity (association build 2, 2026-09-28) ────────────────
  /**
   * The weak, ubiquitous signal: memories one session made next to each other
   * get a small link (TCM — the temporal context model: recall of one item
   * cues its neighbours in the order they were lived, forward more than back).
   * This is the FORWARD lag-1 delta for a pair with a real order between them.
   * Co-use (`HEBB_RATE`, 0.1) stays the strong signal; at 0.06 a contiguity
   * link passes 0.75% of what its node carries — near silent until use
   * confirms it. How long each kind lives above the floor if nothing confirms
   * it (`S_EDGE` 30, floor 0.02; review of #281, finding 7): lag 1 forward
   * with a real order 0.06, 33 lived days; lag 1 in one batch 0.045, 24; lag 1
   * back 0.03, 12; lag 2 forward 0.03, 12; lag 2 in one batch 0.0225, 3.5;
   * lag 2 back 0.015, swept at once. Lag 2 in the common one-batch case is
   * close to inert (it passes 0.28% of its node) — whether it earns its rows
   * is the owner's call (associate NOTES §14). CAL, no ancestry.
   */
  CONTIGUITY_RATE: number;
  /** Neighbours on each side a memory links to: lag 1 and lag 2. Adjacent
   *  pairs only, never all pairs in a session. CAL. */
  CONTIGUITY_WINDOW: number;
  /** The backward delta as a fraction of the forward one (TCM's forward bias:
   *  in free recall a lag of +1 follows about twice as often as −1). CAL. */
  CONTIGUITY_BACKWARD: number;
  /** Each further lag keeps this fraction of the one before (lag 2 = half of
   *  lag 1). CAL. */
  CONTIGUITY_LAG_DECAY: number;
  /**
   * Two memories written closer together than this are ONE BATCH — most
   * memories are written in one go at session end, in the order the model
   * listed them, which is not the order things happened. Within a batch there
   * is no forward: the pair gets the same delta both ways, the mean of forward
   * and backward. Further apart, the write order is real time (a note made
   * mid-session, then the session's end) and the forward bias applies. CAL.
   */
  CONTIGUITY_BATCH_MS: number;
}

export const TUNABLES: AssociateTunables = {
  HEBB_RATE: 0.1,
  EDGE_WEAK_CREDIT: 0,
  EDGE_CAP: 1.0,
  EDGE_FLOOR: 0.02,

  MAX_EDGES_PER_NODE: 32,
  MAX_OUT_WEIGHT: 4.0,

  S_EDGE: 30,
  EDGE_DECAY_SHAPE: "exponential",

  HOPS: 2,
  HOP_DECAY: 0.5,
  FAN_NORMALIZATION: true,
  MAX_SPREAD_NODES: 64,
  SPREAD_MIN_FRACTION: 0.02,

  CONTIGUITY_RATE: 0.06,
  CONTIGUITY_WINDOW: 2,
  CONTIGUITY_BACKWARD: 0.5,
  CONTIGUITY_LAG_DECAY: 0.5,
  CONTIGUITY_BATCH_MS: 60_000,
};

export function withTunables(overrides: Partial<AssociateTunables> = {}): AssociateTunables {
  return { ...TUNABLES, ...overrides };
}

/**
 * The per-endpoint credit factor. **The ignorable tier is 0 and that is
 * structural** (§10 G1, contract G1): a footnote trains nothing, in either
 * direction, whatever the other endpoint did. The weak tier reads its factor
 * from the CAL table above, where it ships disabled.
 */
export function tierFactor(tier: UseTier, t: AssociateTunables): number {
  switch (tier) {
    case "referenced":
      return 1;
    case "surfaced":
      return t.EDGE_WEAK_CREDIT;
    case "footnoted":
    default:
      return 0;
  }
}

/** The co-activation delta for one pair: the rate, graded by BOTH endpoints. */
export function pairCredit(a: UseTier, b: UseTier, t: AssociateTunables): number {
  return t.HEBB_RATE * tierFactor(a, t) * tierFactor(b, t);
}
