/**
 * Spreading activation — a PURE traversal.
 *
 * Seeds plus edge data in, activation contributions out. It reads no store, calls
 * no model, and writes nothing: the graph arrives as two functions the caller
 * supplies (`edgesFrom`, `conducts`), which is what makes the erase test
 * expressible at all — "a removed id stops conducting" is a property of the
 * predicate, not of a deletion that has to be chased through a cache.
 *
 * `recall/` consumes this as its hop channel (wired by `core/retrieval.ts`):
 * contributions modulate candidates the conversation reached, and since
 * 2026-09-28 a memory only the graph reached may become a quiet pointer — that
 * decision is recall's gate's, not this module's (INTERFACE-GAPS.md §1).
 *
 * Bounds:
 *   - **depth** — `HOPS` hops, and a node is expanded once;
 *   - **fan** — a node passes activation in proportion to each edge's ABSOLUTE
 *     weight against the homeostatic bound (`MAX_OUT_WEIGHT`), and never more
 *     than its whole outgoing weight allows, so a hub cannot flood
 *     (`FAN_NORMALIZATION`, NOTES.md §6, 2026-09-28);
 *   - **threshold** — a node is expanded only while it carries at least
 *     `SPREAD_MIN_FRACTION` of the strongest seed (2026-09-28);
 *   - **size** — `MAX_SPREAD_NODES` expansions, a host-cost backstop, and the
 *     result says when it bound instead of quietly returning less.
 *
 * ORDER: best-first across depths (2026-09-28, association build 2) — one
 * queue over what each node carries, so the budget goes where activation is,
 * not to whichever seed or depth happened to come first (see `spread()`).
 */
import { conducts, edgeWeightAt } from "./edges.js";
import type { EdgeState } from "./edges.js";
import type { AssociateTunables } from "./tunables.js";

export interface Seed {
  readonly id: string;
  /** The activation this memory already has from the caller's own channels. */
  readonly activation: number;
}

export interface SpreadInput {
  readonly seeds: readonly Seed[];
  /** Lived day (scar E8) — edges are decayed to it before anything conducts. */
  readonly day: number;
  readonly edgesFrom: (id: string) => readonly EdgeState[];
  /**
   * Does this id conduct? FALSE for anything that is not live memory: removed
   * (deny-listed), archived, or superseded. Non-conducting nodes neither receive
   * a contribution nor pass one along, and they are not in the fan denominator
   * either — an erased id must not even shape the arithmetic between its former
   * neighbours (contract G8, scar §2.2).
   */
  readonly conducts: (id: string) => boolean;
}

export interface Contribution {
  readonly id: string;
  /** The added activation, summed over every path that reached it. */
  readonly activation: number;
  /** Shallowest hop at which it was reached. */
  readonly depth: number;
  readonly paths: number;
  /**
   * Who passed it what: each EXPANDED node whose edge reached it, and the
   * activation that edge carried (2026-09-28). For a first-hop contribution
   * these are seeds. Recall reads it to show a quiet pointer only beside a
   * memory the turn actually shows — pattern completion of something that came
   * to mind, not of a candidate the gate turned away.
   */
  readonly from: Readonly<Record<string, number>>;
}

/**
 * Why the walk stopped. `exhausted`: nothing left to expand. `hop-limit`:
 * nothing left within `HOPS`, and the graph went on past it. `threshold`: the
 * strongest node still waiting carried less than `SPREAD_MIN_FRACTION` of the
 * strongest seed — the ordinary stop since 2026-09-28. `node-limit`: the
 * `MAX_SPREAD_NODES` backstop bound first, with `waiting` nodes above the
 * threshold left unexpanded.
 */
export type SpreadStop = "exhausted" | "hop-limit" | "threshold" | "node-limit";

export interface SpreadResult {
  readonly contributions: readonly Contribution[];
  /** Nodes whose edges were read. */
  readonly expanded: number;
  /** Seeds and destinations refused by `conducts`. */
  readonly blocked: number;
  readonly stop: SpreadStop;
  /** The deepest hop at which a node was EXPANDED (0: nothing was). Depth 1 is
   *  the seeds themselves; 2 means the traversal got past them. Measured
   *  2026-09-28, so a turn can say how far spreading actually reached. */
  readonly depth: number;
  /** Nodes at or above the threshold still waiting when the walk stopped —
   *  non-zero only when the node budget bound (2026-09-28). What the backstop
   *  cost, counted rather than silent. */
  readonly waiting: number;
}

/**
 * BEST-FIRST ACROSS DEPTHS (association build 2, 2026-09-28). One queue over
 * what each node CARRIES — seeds by their own activation, a reached node by
 * the sum of everything that arrived at it — and the strongest node is
 * expanded next, whatever its depth. So a strong first-hop node is expanded
 * before a weak seed, and the node budget goes where activation is. The walk
 * stops at the first node under the threshold (`SPREAD_MIN_FRACTION` of the
 * strongest seed); `MAX_SPREAD_NODES` is a backstop behind it.
 *
 * A node is expanded ONCE, at the carried it had when it came to the head of
 * the queue; a path that arrives after that still adds to its contribution
 * (contributions sum over every path, NOTES §6) but does not re-queue it. Its
 * `depth` is the shallowest arrival, and a node first reached at the hop limit
 * is expanded only if a shorter path reaches it before its turn.
 */
export function spread(input: SpreadInput, t: AssociateTunables): SpreadResult {
  const acc = new Map<string, { activation: number; depth: number; paths: number; from: Map<string, number> }>();
  /** Seeds receive NO contribution: their activation is the caller's own, and a
   *  round trip (a → b → a) would hand it back to them as new evidence. The
   *  contributions are what the graph ADDS, never an echo (NOTES.md §6). */
  const seedIds = new Set(input.seeds.map((s) => s.id));
  /** Waiting to be expanded: what the node carries, and the hop level it would
   *  be expanded at (1 for a seed, its shallowest arrival + 1 otherwise). */
  const queue = new Map<string, { carried: number; level: number }>();
  const expandedAt = new Set<string>();
  let blocked = 0;
  let expanded = 0;
  let reached = 0;
  /** A contribution arrived at the hop limit, on a node that is not expanded. */
  let pastHops = false;

  // One entry per seed id (a repeated seed carries its summed activation).
  for (const s of input.seeds) {
    if (!input.conducts(s.id)) {
      blocked += 1;
      continue;
    }
    if (!(s.activation > 0)) continue;
    const have = queue.get(s.id);
    queue.set(s.id, { carried: (have?.carried ?? 0) + s.activation, level: 1 });
  }
  let strongest = 0;
  for (const q of queue.values()) strongest = Math.max(strongest, q.carried);
  const threshold = strongest * t.SPREAD_MIN_FRACTION;

  let stop: SpreadStop = "exhausted";
  for (;;) {
    const next = head(queue);
    if (next === null) {
      stop = pastHops ? "hop-limit" : "exhausted";
      break;
    }
    if (next.carried < threshold) {
      stop = "threshold";
      break;
    }
    if (expanded >= t.MAX_SPREAD_NODES) {
      stop = "node-limit";
      break;
    }
    queue.delete(next.id);
    expandedAt.add(next.id);
    expanded += 1;
    if (next.level > reached) reached = next.level;

    const live: { dst: string; weight: number }[] = [];
    for (const e of input.edgesFrom(next.id)) {
      if (e.dst === next.id) continue;
      const w = edgeWeightAt(e, input.day, t);
      if (!conducts(w, t)) continue;
      if (!input.conducts(e.dst)) {
        blocked += 1;
        continue;
      }
      live.push({ dst: e.dst, weight: w });
    }
    if (live.length === 0) continue;

    // ABSOLUTE weight (2026-09-28): an edge passes `w / MAX_OUT_WEIGHT` of
    // what the node carries, before hop decay — a fresh 0.1 edge passes 2.5%
    // whether or not it has siblings. It used to be `w / (the node's live
    // sum)`, which let a lone 0.03 edge pass everything. The divisor never
    // drops below the node's own outgoing sum, so a node whose edges were
    // written outside homeostasis (a legacy dream gist) still passes at most
    // what it carries.
    const sum = live.reduce((total, e) => total + e.weight, 0);
    const fan = t.FAN_NORMALIZATION ? Math.max(t.MAX_OUT_WEIGHT, sum) : 1;
    if (!(fan > 0)) continue;
    for (const e of live) {
      if (seedIds.has(e.dst)) continue;
      const gain = next.carried * t.HOP_DECAY * (e.weight / fan);
      if (gain <= 0) continue;
      const have = acc.get(e.dst);
      if (have === undefined) {
        acc.set(e.dst, { activation: gain, depth: next.level, paths: 1, from: new Map([[next.id, gain]]) });
      } else {
        // Contributions SUM across paths — two co-active seeds pointing at the
        // same memory say more than one does — while `depth` keeps the
        // shallowest arrival (NOTES.md §6).
        have.activation += gain;
        have.paths += 1;
        have.from.set(next.id, (have.from.get(next.id) ?? 0) + gain);
        if (next.level < have.depth) have.depth = next.level;
      }
      if (expandedAt.has(e.dst)) continue;
      if (next.level >= t.HOPS) {
        pastHops = true;
        continue;
      }
      const waiting = queue.get(e.dst);
      if (waiting === undefined) queue.set(e.dst, { carried: gain, level: next.level + 1 });
      else {
        waiting.carried += gain;
        if (next.level + 1 < waiting.level) waiting.level = next.level + 1;
      }
    }
  }

  let waiting = 0;
  if (stop === "node-limit") for (const q of queue.values()) if (q.carried >= threshold) waiting += 1;
  const contributions = [...acc]
    .map(([id, v]) => ({ id, activation: v.activation, depth: v.depth, paths: v.paths, from: Object.fromEntries(v.from) }))
    .sort((a, b) => b.activation - a.activation || (a.id < b.id ? -1 : 1));
  return { contributions, expanded, blocked, stop, depth: reached, waiting };
}

/** The strongest node waiting; ties broken by id so a traversal is deterministic. */
function head(queue: ReadonlyMap<string, { carried: number; level: number }>): { id: string; carried: number; level: number } | null {
  let best: { id: string; carried: number; level: number } | null = null;
  for (const [id, q] of queue) {
    if (best === null || q.carried > best.carried || (q.carried === best.carried && id < best.id)) {
      best = { id, carried: q.carried, level: q.level };
    }
  }
  return best;
}
