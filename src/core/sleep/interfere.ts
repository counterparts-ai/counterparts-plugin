/**
 * The interference phase (2026-11-07, FD1 step 3): a newer routine work event
 * on the same subject fades the older one, as a write's `updates` does —
 * counted apart from the prune, so a read of the nights can tell a fade from
 * an age exit. Right after `tags`, every lived day.
 *
 * `interference.ts` owns the verdict and the write (through the one door,
 * `reconsolidation.ts#supersede`); `sleep/` owns the cadence and the budget
 * (`BUDGETS.interfere` fades a night). Like the tags, the work is handed in as
 * an `InterfereFn` by the composition root: this module does not import it. A
 * missing fn is `did-not-run` with reason `no-interfere-fn`; the switch off is
 * a run that did nothing, counted `switched-off`. Under observer it counts what
 * a night would fade and writes nothing.
 */

import type { PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome } from "./types.js";

export interface InterfereInput {
  readonly day: number;
  /** False under observer: write nothing, count what a night would do. */
  readonly apply: boolean;
  /** Fades a night at most. */
  readonly budget: number;
}

/** One fade: the older memory, the newer one it now sits under, and the rule that matched. Ids only. */
export interface InterferedRecord {
  readonly over: string;
  readonly holds: string;
  readonly rule: string;
}

export interface InterfereSweepOutcome {
  /** False when the sweep is switched off. */
  readonly on: boolean;
  readonly examined: number;
  readonly faded: readonly InterferedRecord[];
  /** Why each older memory kept its slow curve, by reason. */
  readonly skipped: Readonly<Record<string, number>>;
  readonly skippedForLimit: number;
}

export type InterfereFn = (input: InterfereInput) => InterfereSweepOutcome;

export interface InterfereResult extends PhaseOutcome {
  readonly interfered: readonly InterferedRecord[];
}

export function runInterfere(ctx: PhaseCtx, interfere: InterfereFn | undefined): InterfereResult {
  const out = emptyOutcome();
  if (interfere === undefined) {
    out.skipped["no-interfere-fn"] = 1;
    return { ...out, interfered: [] };
  }
  const r = interfere({ day: ctx.day, apply: ctx.apply, budget: ctx.budget });
  if (!r.on) {
    countSkip(out, "switched-off", 1);
    return { ...out, interfered: [] };
  }
  for (const [reason, n] of Object.entries(r.skipped)) countSkip(out, reason, n);
  out.examined = r.examined;
  out.changed = r.faded.length;
  out.budgetExhausted = r.skippedForLimit > 0;
  out.skippedForBudget = r.skippedForLimit;
  ctx.event("sleep.interfere.sweep", undefined, {
    day: ctx.day,
    examined: r.examined,
    faded: r.faded.length,
    skippedForLimit: r.skippedForLimit,
  });
  return { ...out, interfered: r.faded.map((f) => ({ over: f.over, holds: f.holds, rule: f.rule })) };
}
