/**
 * The retrieval composition root — SEAMS items C, D and L close here.
 *
 * `recall/` owns the gate and imports none of its neighbours; `schemas/` owns the
 * alias index; `prospective/` owns temporal arrivals; `associate/` owns the edge
 * graph. Each of them exports what recall needs and none of them may hand it over
 * directly. This file is the one place they meet, so a caller cannot forget one of
 * them and silently lose the safety half that rides along with it — which is
 * precisely what `recall/INTERFACE-GAPS.md` §2 warned about:
 *
 *   > a caller that forgets the map silently loses the safety half — which is
 *   > exactly the scar §2.6 shape, so this gap is the one to close first.
 *
 * The three wirings, and the constraint each carries:
 *
 *   C. **Aliases** — `schemas.aliasMap()` becomes `Turn.aliases`. A handle that
 *      resolves to two live entities fires at `AMBIGUOUS_WEIGHT` and sets
 *      `trains: false`, which `Recall.resolveUse` enforces as a refusal (§9 G5).
 *   D. **Temporal cues** — `prospective.arrivals()` becomes
 *      `Turn.temporal`, folded into `cueScore` alongside the token postings and
 *      COUNTED AS CUE by `cueFraction`. It is emphatically NOT recall's `arrival`
 *      (a recency multiplier): wiring it there would turn a modulator into an
 *      admission channel and break hard gate (a) for every dated memory.
 *   L. **Spreading activation** — `associate.spreadFrom()` becomes `Turn.spread`.
 *      Hops MODULATE candidates the conversation already reached, and since
 *      2026-09-28 (association build 2, option (b) of `associate/`'s gap §1) a
 *      memory ONLY links reached may join the turn as a quiet pointer — a few,
 *      over a threshold, footnote tier only; recall's gate names that one lane
 *      and keeps every other uncued memory dark. Excluded from `cueFraction`
 *      entirely (2026-09-28: it was in the denominator, which let a hop take the
 *      loud tier away), so hop weight can neither buy nor revoke the loud tier.
 *      The traversal's own account of itself — expanded, stop, depth — rides
 *      through to the turn's record.
 */
import type { RecallResult, Turn } from "./recall/index.js";
import type { Recall } from "./recall/index.js";

/** Structural, not nominal: this file imports no neighbour's class. */
export interface AliasSource {
  aliasMap(): ReadonlyMap<string, readonly string[]>;
}

/** `prospective.arrivals()`'s shape, structurally: `at` is a CALENDAR date and is
 *  required, `day` is the lived day, and the list comes back under `.arrivals`. */
export interface TemporalSource {
  arrivals(input: { at: string; day?: number; sessionId?: string }): {
    arrivals: readonly { memoryId: string; cueWeight: number }[];
  };
}

/** Structurally `Associate.spreadFrom`. */
export interface SpreadSource {
  spreadFrom(
    seeds: readonly { id: string; activation: number }[],
    day?: number,
  ): {
    contributions: readonly { id: string; activation: number }[];
    expanded?: number;
    stop?: string;
    depth?: number;
  };
}

export interface RetrievalSources {
  schemas?: AliasSource;
  prospective?: TemporalSource;
  associate?: SpreadSource;
  /** The CALENDAR date the temporal source asks about — an argument, never a
   *  clock read, so "was this arriving on July 5th?" is the same code path.
   *  Without it there is no temporal wiring: a lived day is not a date. */
  at?: string;
}

/**
 * Compose one turn. Every source is optional and its absence is a MISSING
 * CHANNEL, never a silently permissive one: no alias map means no handle is
 * ambiguous (the conservative direction is to train, which is why the map's
 * source had to stop being borrowed), no temporal source means no dated memory
 * is cued, and no edge source means no hop contributes.
 */
export function composeTurn(turn: Turn, sources: RetrievalSources): Turn {
  const out: Turn = { ...turn };
  if (sources.schemas !== undefined && turn.aliases === undefined) {
    out.aliases = sources.schemas.aliasMap();
  }
  if (sources.prospective !== undefined && sources.at !== undefined && turn.temporal === undefined) {
    const result = sources.prospective.arrivals({
      at: sources.at,
      ...(turn.day === undefined ? {} : { day: turn.day }),
      // The once-per-session brake lives in `prospective/` and needs this.
      sessionId: turn.sessionId,
    });
    out.temporal = result.arrivals.map((a) => ({ id: a.memoryId, weight: a.cueWeight }));
  }
  if (sources.associate !== undefined && turn.spread === undefined) {
    const source = sources.associate;
    out.spread = (seeds, day) => source.spreadFrom(seeds, day);
  }
  return out;
}

/** The one-line call site the gap files name, with the sources bound. */
export function recallTurn(recall: Recall, turn: Turn, sources: RetrievalSources): RecallResult {
  return recall.recall(composeTurn(turn, sources));
}
