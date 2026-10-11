/**
 * Every constant the cycle has, in one visible place, and the two pure
 * configuration checks that are mechanized guarantees rather than taste.
 *
 * CAL = calibration-required: ships with a recorded measurement, or ships
 * disabled (scar §2.8). The budgets below are NOT calibrated — they are sized to
 * be generous on a personal store and to make the "a budget is not a debt"
 * behavior reachable in a test, which is the honest reason to state a number.
 */

import type { MemorySource } from "../types.js";
import type { Phase } from "./types.js";

export const TUNABLES = {
  /** Auto-consolidation cadence, in LIVED days [v0: every 3 days]. */
  CONSOLIDATION_EVERY_DAYS: 3,

  /**
   * At most this many memories become core in one sleep, strongest first
   * (owner decision 2026-09-26: "~3 per sleep"). The rest stay eligible and
   * wait for the next consolidation, counted as `promotion:cap` — a rail so a
   * store that has just grown a lane of eligible memories does not rewrite
   * who it is overnight. CAL.
   */
  CORE_MAX_PER_SLEEP: 3,

  /**
   * Below this change in cached strength, the row is left alone — CALM BY
   * DEFAULT (§3, v1 §11 G8). Exponential decay moves a floor memory by ~1e-9 a
   * day; without a quantum every quiet day would rewrite the whole cache and
   * "almost no motion" would be a claim rather than a measurement.
   */
  DECAY_QUANTUM: 1e-4,

  /** Per-phase work budgets. Unspent budget carries NO obligation. */
  BUDGETS: {
    clock: 1,
    decay: 20_000,
    consolidate: 5_000,
    prune: 1_000,
    /** Entity cards examined per fade sweep. Sized so a personal store's cards all fit in one pass. */
    fade: 5_000,
    dedup: 1_000,
    versions: 1,
    briefing: 1,
    /**
     * The log sweep's cap: unlatched event rows deleted per pass, oldest first.
     * A store swept for the first time takes its backlog a cap's worth a day
     * rather than in one long transaction — a budget is not a debt, and the
     * rows left are reported as `skippedForBudget`, not carried as arrears.
     * NOT calibrated (CAL): sized so one pass is milliseconds on SQLite (on a
     * 100,000-row log, a 5,000-row capped delete measured 17 ms warm and
     * 177 ms cold; 20,000 rows, 35 ms — NOTES.md §15) and so a day's inflow
     * on a busy store — hundreds of `recall.decision` and `adapter.*` rows —
     * clears in one pass with room to spare.
     */
    log: 5_000,
  } as const satisfies Record<Phase, number>,

  /** Cadence in lived days per phase. 1 = every lived day. */
  CADENCE: {
    clock: 1,
    decay: 1,
    consolidate: 3,
    prune: 1,
    /** Every third lived day: the fade floors are months long, so a card that
     *  fades a day or two late costs nothing, and the sweep reads every card. */
    fade: 3,
    dedup: 1,
    versions: 1,
    briefing: 1,
    log: 1,
  } as const satisfies Record<Phase, number>,
} as const;

/** A marker that has never been written. Reads as "due", which is forward-safe. */
export const MARKER_UNSET = -1;

/** Box-2 meta key prefixes. See INTERFACE-GAPS.md §3 — these want real tables. */
export const MARKER_PREFIX = "sleep.marker.";
/** Where a budgeted phase stopped, so the next run resumes there (`markers.ts`). */
export const CURSOR_PREFIX = "sleep.cursor.";
export const PRUNE_RECORD_PREFIX = "sleep.pruned.";
export const PROMOTION_RECORD_PREFIX = "sleep.promoted.";
export const MERGE_RECORD_PREFIX = "sleep.merged.";

/** The archive reason the floor prune writes. Archival, never deletion. */
export const PRUNE_ARCHIVE_REASON = "pruned";
/** The archive reason a merged duplicate carries. */
export const MERGE_ARCHIVE_REASON = "merged";

/**
 * The channel a revision's successor is minted on (`types.ts#MEMORY_SOURCES`),
 * named here because `dedup.ts` reads it to recognize one. Typed against the
 * vocabulary so a rename in `types.ts` breaks the build rather than silently
 * turning the refusal off.
 */
export const ACCOMMODATION_SOURCE: MemorySource = "accommodation";

export type WatchdogReason =
  | "OK"
  | "SOFT_NOT_FINITE"
  | "HARD_NOT_FINITE"
  | "LEASE_NOT_FINITE"
  | "SOFT_NOT_BEFORE_HARD"
  | "HARD_KILL_AFTER_LEASE_RECLAIMABLE";

/**
 * CONTRACT §5 G2 — the cross-key invariant, as arithmetic instead of a doc line.
 *
 * The single-writer lease depends on a wedged runner DYING BEFORE ITS LOCK CAN BE
 * TAKEN. If the hard kill can land after the lease becomes reclaimable, a second
 * runner takes the lock while the first is still alive, and v1's double-ticked
 * clock is back. Configuration refuses that setting; it does not warn about it.
 *
 * Pure arithmetic on three numbers — the lock itself belongs to the adapter that
 * spawns the cycle (INTERFACE-GAPS.md §6), but the check belongs here, with the
 * numbers it is about.
 */
export function validateWatchdog(
  softMs: number,
  hardMs: number,
  leaseMs: number,
): { ok: boolean; reason: WatchdogReason } {
  if (!Number.isFinite(softMs) || softMs <= 0) return { ok: false, reason: "SOFT_NOT_FINITE" };
  if (!Number.isFinite(hardMs) || hardMs <= 0) return { ok: false, reason: "HARD_NOT_FINITE" };
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) return { ok: false, reason: "LEASE_NOT_FINITE" };
  if (softMs >= hardMs) return { ok: false, reason: "SOFT_NOT_BEFORE_HARD" };
  if (hardMs >= leaseMs) return { ok: false, reason: "HARD_KILL_AFTER_LEASE_RECLAIMABLE" };
  return { ok: true, reason: "OK" };
}

export type SpawnReason = "spawn" | "observer";

/**
 * CONTRACT §5 G10 — an observer session SPAWNS NO CYCLE. A cycle advances the
 * clock, materializes decay, and rewrites the briefing: the instrument mutating
 * what it measures (scar E7).
 *
 * `runCycle` under an observer store still produces a full read-only REPORT —
 * that is the dashboard's and the replay scorer's path, and it writes nothing.
 * This predicate is the spawner's question, and its answer is no.
 */
export function shouldSpawn(store: { observer: boolean }): {
  spawn: boolean;
  reason: SpawnReason;
} {
  return store.observer ? { spawn: false, reason: "observer" } : { spawn: true, reason: "spawn" };
}
