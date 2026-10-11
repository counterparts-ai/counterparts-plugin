/**
 * The log sweep — bounded retention on the durable event log, the cycle's
 * LAST phase (CONTRACT §5 G16).
 *
 * `Store.pruneEvents()` existed, documented a 90-lived-day window, and had no
 * caller anywhere in `src/` (NOTES.md §13): every unlatched row ever written —
 * one `recall.decision` per turn, one `gate.deposit` per authored deposit, the
 * adapter's per-hook rows — was still there, and the dashboard's "I keep events
 * for N lived days; older ones are swept" was a sentence about a sweep that
 * never ran. This phase is the caller.
 *
 * Three decisions, each of which is a test:
 *
 *   1. **It is its own phase, not a line in `prune`.** The floor prune forgets
 *      MEMORIES; this drops TELEMETRY. One budget doing half of each would make
 *      "what the cycle forgot" and "what the log dropped" one number, and the
 *      created-versus-exited census (§5 G13) reads the first.
 *   2. **Bounded per pass, oldest first.** `ctx.budget` (`TUNABLES.BUDGETS.log`)
 *      caps the rows one pass deletes. A store swept for the first time takes
 *      its backlog a cap's worth a day; the rest is `skippedForBudget`, reported
 *      and never owed (§3: a budget is not a debt).
 *   3. **Kept by kind is a NUMBER.** Every record the store latches with a
 *      `dedup_key` — prune, promotion, merge, unmerge, pressure, gate-chunk,
 *      band-transition — is kept at any age by the store, not by a list here.
 *      Rows past the window that the latch kept are counted in `skipped.latched`
 *      so the report can say how many, rather than a reader inferring it.
 *
 * Under observer (`ctx.apply === false`) the phase reads the census and reports
 * the count that WOULD go; it never calls `pruneEvents`, so the read-only report
 * produces zero stand-downs — nothing was attempted (observer-mode.md G4).
 */

import type { PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome } from "./types.js";

/** Emitted once per applied sweep, counts only — never a payload's contents. */
export const LOG_SWEEP_EVENT = "sleep.log.swept";

/** The one named skip: rows past the window kept because a latch holds them. */
export const LOG_SWEEP_SKIPS = ["latched"] as const;
export type LogSweepSkip = (typeof LOG_SWEEP_SKIPS)[number];

export interface LogSweepResult extends PhaseOutcome {
  /** Unlatched rows past the window when the sweep began. */
  readonly eligible: number;
  /** Rows actually deleted this pass. Zero under observer; `changed` then carries the would-count. */
  readonly deleted: number;
  /** Eligible rows the cap left for the next pass. Zero means the window is clean. */
  readonly remaining: number;
  /** Latched rows past the window — kept by kind, and said so. */
  readonly keptLatched: number;
  readonly cutoffDay: number;
  readonly retentionDays: number;
}

export function runLogSweep(ctx: PhaseCtx): LogSweepResult {
  const { store } = ctx;
  // `cycle.ts` prechecks both and reports `no-durable-event-log` when either is
  // absent; reaching here without them is a programming error, and a thrown
  // phase (marker unmoved, retried tomorrow) is the honest record of one.
  if (store.pruneEvents === undefined || store.eventLogCensus === undefined) {
    throw Object.assign(new Error("log sweep on a port with no durable event log"), {
      code: "NO_DURABLE_EVENT_LOG",
    });
  }

  const out = emptyOutcome();
  // The census FIRST, on both paths: it is the only source of the kept-by-kind
  // count, and reading it before the delete means `examined` describes the
  // window as the phase found it.
  const census = store.eventLogCensus();
  const keptLatched = census.latchedPastCutoff;
  if (keptLatched > 0) countSkip(out, "latched" satisfies LogSweepSkip, keptLatched);

  if (!ctx.apply) {
    const would = Math.min(census.eligible, ctx.budget);
    out.examined = census.eligible + keptLatched;
    out.changed = would;
    out.skippedForBudget = census.eligible - would;
    out.budgetExhausted = out.skippedForBudget > 0;
    return {
      ...out,
      eligible: census.eligible,
      deleted: 0,
      remaining: census.eligible - would,
      keptLatched,
      cutoffDay: census.cutoffDay,
      retentionDays: census.retentionDays,
    };
  }

  const report = store.pruneEvents({ limit: ctx.budget });
  out.examined = report.eligible + keptLatched;
  out.changed = report.pruned;
  out.skippedForBudget = report.remaining;
  out.budgetExhausted = report.remaining > 0;
  ctx.event(LOG_SWEEP_EVENT, undefined, {
    day: ctx.day,
    count: report.pruned,
    eligible: report.eligible,
    remaining: report.remaining,
    keptLatched,
    budget: ctx.budget,
    cutoffDay: report.cutoffDay,
    retentionDays: report.retentionDays,
  });
  return {
    ...out,
    eligible: report.eligible,
    deleted: report.pruned,
    remaining: report.remaining,
    keptLatched,
    cutoffDay: report.cutoffDay,
    retentionDays: report.retentionDays,
  };
}
