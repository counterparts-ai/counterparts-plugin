/**
 * The edge arithmetic — increment, cap, decay by lived day, homeostasis.
 *
 * It lives HERE rather than on `physics/`'s page by the module map's 2026-08-25
 * ruling: edge-level arithmetic keeps `physics/` one page. What it does NOT do is
 * define a second decay CURVE — `decayCurve` is imported from physics and given
 * this module's own stability constant (`S_EDGE`). One curve family, two
 * constants, which is what "a physics-family curve, own constants" means.
 *
 * Everything in this file is pure. Nothing reads a store, nothing writes one, and
 * every state-changing operation returns the NEXT rows for the caller to persist —
 * the same shape physics uses, for the same reason: the flush ordering that makes
 * at-most-once true (index.ts) can only be reasoned about if the arithmetic has no
 * say in when it lands.
 */
import { decayCurve } from "../physics/index.js";
import type { AssociateTunables } from "./tunables.js";

/** One directed edge as this module sees it. Mirrors `store.EdgeRow`, without
 *  binding the arithmetic to the row shape. */
export interface EdgeState {
  readonly src: string;
  readonly dst: string;
  readonly weight: number;
  readonly lastDay: number;
}

/** An accumulated co-activation delta for one UNORDERED pair. */
export interface PairDelta {
  readonly a: string;
  readonly b: string;
  /** The delta for a → b — and for b → a too, unless `back` says otherwise. */
  readonly delta: number;
  /**
   * The delta for b → a when it DIFFERS from a → b (2026-09-28): temporal
   * contiguity's forward bias, where the earlier memory's link to the later
   * one is stronger than the link back. Absent for a co-use, which is
   * symmetric — and absent is what every delta was before it.
   */
  readonly back?: number;
}

/** An edge pushed out by the per-node count cap (§10 G3, scar §2.17). */
export interface Eviction {
  readonly src: string;
  readonly dst: string;
  /** The weight it held when it was evicted — the part that would otherwise be
   *  the only lost record. Carried in the flush report and the event. */
  readonly priorWeight: number;
  readonly reason: "count-cap" | "below-floor";
}

export interface FlushPlan {
  /** Absolute next rows — never deltas. A partially-applied plan is impossible
   *  because the caller writes them in ONE transaction. */
  readonly rows: readonly EdgeState[];
  readonly evictions: readonly Eviction[];
  /** Nodes whose outgoing total was scaled back by synaptic scaling. */
  readonly renormalized: readonly string[];
  readonly nodesTouched: number;
}

/** Canonical unordered-pair key. `a|b` with the ids sorted, so one pair has one
 *  buffer slot however the caller ordered it. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * An edge's weight AT a lived day — the decay, applied lazily and idempotently.
 * A pure function of (stored weight, stored day, asked day), so there is no step
 * to run twice (physics guarantee 5's shape, scar E8).
 */
export function edgeWeightAt(e: EdgeState, day: number, t: AssociateTunables): number {
  const elapsed = day - e.lastDay;
  if (elapsed <= 0) return e.weight;
  return e.weight * decayCurve(elapsed, t.S_EDGE, t.EDGE_DECAY_SHAPE);
}

/** Dead edges conduct nothing. The floor is where an edge stops being an
 *  association and becomes a rounding error. */
export function conducts(weight: number, t: AssociateTunables): boolean {
  return weight > t.EDGE_FLOOR;
}

/** A row that carries nothing any more: zeroed by an eviction, or decayed to
 *  the floor. What the flush's sweep removes (2026-09-28). */
export function isDead(e: EdgeState, day: number, t: AssociateTunables): boolean {
  return !conducts(edgeWeightAt(e, day, t), t);
}

/** Increment, capped. The cap is the per-edge half of homeostasis (§10 G2). */
export function strengthen(current: number, delta: number, t: AssociateTunables): number {
  const next = current + Math.max(0, delta);
  return next > t.EDGE_CAP ? t.EDGE_CAP : next;
}

/**
 * One node's outgoing edges, after the deltas: cap the LIVE edge count (weakest
 * evicted), then bound the total outgoing weight by PROPORTIONAL renormalization.
 *
 * Order matters and is deliberate: evict first, scale second. Scaling first would
 * shrink edges that are about to be evicted anyway and let the survivors keep more
 * weight than the bound allows.
 */
export function homeostasis(
  src: string,
  weights: ReadonlyMap<string, number>,
  t: AssociateTunables,
): { next: Map<string, number>; evictions: Eviction[]; renormalized: boolean } {
  const next = new Map(weights);
  const evictions: Eviction[] = [];

  // Live edges, strongest first; ties broken by id so the plan is deterministic.
  const live = [...next.entries()]
    .filter(([, w]) => conducts(w, t))
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));

  for (const [dst, w] of live.slice(t.MAX_EDGES_PER_NODE)) {
    // Eviction writes a ZEROED weight here; the flush's sweep (`sweepEdges`,
    // 2026-09-28) then deletes the zeroed row after the write lands. The
    // eviction is reported and evented, but no durable archive of which pair
    // was evicted exists — a store gap (INTERFACE-GAPS.md §2).
    next.set(dst, 0);
    evictions.push({ src, dst, priorWeight: w, reason: "count-cap" });
  }

  const kept = live.slice(0, t.MAX_EDGES_PER_NODE);
  const total = kept.reduce((sum, [, w]) => sum + w, 0);
  let renormalized = false;
  if (total > t.MAX_OUT_WEIGHT && total > 0) {
    const factor = t.MAX_OUT_WEIGHT / total;
    for (const [dst, w] of kept) next.set(dst, w * factor);
    renormalized = true;
  }
  return { next, evictions, renormalized };
}

/**
 * The whole flush, as arithmetic: current rows + buffered deltas + a lived day
 * → the absolute next rows.
 *
 * Two properties the caller depends on:
 *
 * 1. **Symmetric by construction.** One unordered pair mints two directed rows,
 *    because the store's edge table is keyed (src, dst) and a traversal reads
 *    `edgesFrom` only. Renormalization can later make the two directions differ
 *    in magnitude — a hub's edge to a quiet node is scaled while the quiet node's
 *    edge back is not — and that asymmetry is real, not a bug (NOTES.md §5).
 *    A delta that carries `back` (temporal contiguity's forward bias,
 *    2026-09-28) writes the two directions with their own deltas.
 * 2. **Decay is REALIZED, not merely observed.** Every row a touched node writes
 *    carries its decayed-to-`day` weight and `lastDay = day`. Exact for the
 *    exponential family, which is why the shape is pinned (NOTES.md §4).
 */
export function planFlush(
  deltas: readonly PairDelta[],
  day: number,
  edgesFrom: (id: string) => readonly EdgeState[],
  t: AssociateTunables,
): FlushPlan {
  return plan(deltas, day, edgesFrom, t, (current, delta) => strengthen(current, delta, t));
}

/** One proposed pair's fate. */
export type ProposalOutcome = "landed" | "no-room";

export interface ProposalPlan {
  /** Absolute rows for the pairs that landed — only those pairs' two edges;
   *  no other row is touched. */
  readonly rows: readonly EdgeState[];
  /** Per pair, in the order proposed. */
  readonly outcomes: readonly { a: string; b: string; outcome: ProposalOutcome }[];
}

/**
 * A PROPOSED link (a dream's `link`, a gist's sources — 2026-09-28) lands ONLY
 * WHERE THERE IS ROOM. The dream proposes, waking use confirms: a proposal
 * never evicts an edge and never scales one down, so nothing use has learned
 * is ever paid for by a dream. Homeostasis stays the Hebbian flush's.
 *
 * Each direction is raised to at least `weight` from its DECAYED weight at
 * `day` (never the stored one — re-proposing an old pair must not resurrect
 * what it weighed before it faded). A pair lands only if BOTH endpoints have
 * room: a new live edge must fit under `MAX_EDGES_PER_NODE`, and the node's
 * live outgoing sum after the raise must stay within `MAX_OUT_WEIGHT`.
 * Otherwise the pair is `no-room` and nothing about it is written. Pairs are
 * taken in the order given, so when room runs out the first named are kept.
 */
export function planProposal(
  pairs: readonly { a: string; b: string }[],
  weight: number,
  day: number,
  edgesFrom: (id: string) => readonly EdgeState[],
  t: AssociateTunables,
): ProposalPlan {
  const w = Math.min(t.EDGE_CAP, Math.max(0, weight));
  /** node -> (dst -> decayed weight at `day`), updated as pairs land. */
  const nodes = new Map<string, Map<string, number>>();
  const load = (id: string): Map<string, number> => {
    const have = nodes.get(id);
    if (have !== undefined) return have;
    const m = new Map<string, number>();
    for (const e of edgesFrom(id)) if (e.dst !== id) m.set(e.dst, edgeWeightAt(e, day, t));
    nodes.set(id, m);
    return m;
  };
  const room = (node: Map<string, number>, dst: string): boolean => {
    const current = node.get(dst) ?? 0;
    const next = Math.max(current, w);
    if (next === current) return true; // nothing to add
    let live = 0;
    let sum = 0;
    for (const v of node.values()) {
      if (!conducts(v, t)) continue;
      live += 1;
      sum += v;
    }
    const isNew = !conducts(current, t) && conducts(next, t);
    if (isNew && live + 1 > t.MAX_EDGES_PER_NODE) return false;
    const after = sum - (conducts(current, t) ? current : 0) + (conducts(next, t) ? next : 0);
    return after <= t.MAX_OUT_WEIGHT + 1e-12;
  };

  const rows = new Map<string, EdgeState>();
  const outcomes: { a: string; b: string; outcome: ProposalOutcome }[] = [];
  for (const p of pairs) {
    if (p.a === p.b) continue;
    const fwd = load(p.a);
    const back = load(p.b);
    if (!room(fwd, p.b) || !room(back, p.a)) {
      outcomes.push({ a: p.a, b: p.b, outcome: "no-room" });
      continue;
    }
    for (const [src, node, dst] of [
      [p.a, fwd, p.b],
      [p.b, back, p.a],
    ] as const) {
      const current = node.get(dst) ?? 0;
      const next = Math.max(current, w);
      if (next === current) continue;
      node.set(dst, next);
      rows.set(`${src}\u0000${dst}`, { src, dst, weight: next, lastDay: day });
    }
    outcomes.push({ a: p.a, b: p.b, outcome: "landed" });
  }
  return { rows: [...rows.values()], outcomes };
}

function plan(
  deltas: readonly PairDelta[],
  day: number,
  edgesFrom: (id: string) => readonly EdgeState[],
  t: AssociateTunables,
  combine: (current: number, delta: number) => number,
): FlushPlan {
  /** node -> (dst -> weight at `day`, deltas applied). */
  const nodes = new Map<string, Map<string, number>>();
  /** node -> (dst -> the row as stored), so unchanged rows are not rewritten. */
  const stored = new Map<string, Map<string, EdgeState>>();

  const load = (id: string): Map<string, number> => {
    const have = nodes.get(id);
    if (have !== undefined) return have;
    const decayed = new Map<string, number>();
    const raw = new Map<string, EdgeState>();
    for (const e of edgesFrom(id)) {
      decayed.set(e.dst, edgeWeightAt(e, day, t));
      raw.set(e.dst, e);
    }
    nodes.set(id, decayed);
    stored.set(id, raw);
    return decayed;
  };

  for (const d of deltas) {
    if (d.a === d.b) continue;
    const forward = load(d.a);
    const back = load(d.b);
    forward.set(d.b, combine(forward.get(d.b) ?? 0, d.delta));
    back.set(d.a, combine(back.get(d.a) ?? 0, d.back ?? d.delta));
  }

  const rows: EdgeState[] = [];
  const evictions: Eviction[] = [];
  const renormalized: string[] = [];
  for (const [src, weights] of [...nodes].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const settled = homeostasis(src, weights, t);
    evictions.push(...settled.evictions);
    if (settled.renormalized) renormalized.push(src);
    const raw = stored.get(src) ?? new Map<string, EdgeState>();
    for (const [dst, weight] of [...settled.next].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const before = raw.get(dst);
      if (before !== undefined && before.weight === weight && before.lastDay === day) continue;
      rows.push({ src, dst, weight, lastDay: day });
    }
  }
  return { rows, evictions, renormalized, nodesTouched: nodes.size };
}
