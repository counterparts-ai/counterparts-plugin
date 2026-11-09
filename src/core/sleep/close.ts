/**
 * The close phase (2026-11-07, SO1 step 1): the night closes an open item a
 * later memory plainly shows done — one rule, a later release in the same
 * series closing the earlier release steps (`open-close.ts`) — and lists what
 * it would not close as "may be done". Right after `interfere`, every lived
 * day.
 *
 * `open-close.ts` owns the verdict and the write (`closeThread`'s write, with
 * who closed it and why, and a durable `thread.night.closed` row each);
 * `sleep/` owns the cadence and the budget (`BUDGETS.close` closes a night).
 * Like `interfere`, the work is handed in by the composition root as a
 * `CloseFn`: this module does not import it. A missing fn is `did-not-run`
 * with reason `no-close-fn`; the switch off is a run that did nothing,
 * counted `switched-off`. Under observer it counts and writes nothing.
 */

import type { PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome } from "./types.js";

export interface CloseInput {
  readonly day: number;
  /** False under observer: write nothing, count what a night would do. */
  readonly apply: boolean;
  /** Closes a night at most. */
  readonly budget: number;
}

/** One close: the item, the memory that showed it done, and the rule. Ids only. */
export interface ClosedRecord {
  readonly id: string;
  readonly shows: string;
  readonly rule: string;
}

export interface CloseSweepOutcome {
  /** False when the sweep is switched off. */
  readonly on: boolean;
  readonly examined: number;
  readonly closed: readonly ClosedRecord[];
  /** How many it listed as "may be done" instead. */
  readonly mayBeDone: readonly unknown[];
  readonly skipped: Readonly<Record<string, number>>;
  readonly skippedForLimit: number;
}

export type CloseFn = (input: CloseInput) => CloseSweepOutcome;

export interface CloseResult extends PhaseOutcome {
  readonly closed: readonly ClosedRecord[];
  readonly mayBeDone: number;
}

export function runClose(ctx: PhaseCtx, close: CloseFn | undefined): CloseResult {
  const out = emptyOutcome();
  if (close === undefined) {
    out.skipped["no-close-fn"] = 1;
    return { ...out, closed: [], mayBeDone: 0 };
  }
  const r = close({ day: ctx.day, apply: ctx.apply, budget: ctx.budget });
  if (!r.on) {
    countSkip(out, "switched-off", 1);
    return { ...out, closed: [], mayBeDone: 0 };
  }
  for (const [reason, n] of Object.entries(r.skipped)) countSkip(out, reason, n);
  out.examined = r.examined;
  out.changed = r.closed.length;
  out.budgetExhausted = r.skippedForLimit > 0;
  out.skippedForBudget = r.skippedForLimit;
  ctx.event("sleep.close.sweep", undefined, {
    day: ctx.day,
    examined: r.examined,
    closed: r.closed.length,
    mayBeDone: r.mayBeDone.length,
    skippedForLimit: r.skippedForLimit,
  });
  return { ...out, closed: r.closed.map((c) => ({ id: c.id, shows: c.shows, rule: c.rule })), mayBeDone: r.mayBeDone.length };
}
