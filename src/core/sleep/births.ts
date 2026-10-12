/**
 * The card births — where a name the memories keep saying becomes a card
 * (2026-10-11, Group 3 part D). The fade's mirror: the fade lets a card nobody
 * mentions go, this phase gives a card to a name everybody does.
 *
 * `schemas/` owns the verdict (`Schemas#birthsFromNames`: the name tally, then
 * `mention()`'s gates — the name in the source, no collision, never a second
 * self). `sleep/` owns only the cadence and the nightly budget. This module does
 * not import `schemas/`: the tally is handed in as a `BirthsFn`, the same seam
 * as the fade's `FadeFn`, and the composition root wires it.
 *
 * Cards are born ONLY through here. Awake, a write that names a card credits
 * it, and one that names a faded card brings it back, but a write never births
 * one (the title door is gone: an authored title is a sentence, and it never
 * once held a name).
 *
 * A missing tally is `did-not-run` with reason `no-births-fn`.
 */

import type { PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome } from "./types.js";

export interface BirthsInput {
  readonly day: number;
  /** False under observer: offer nothing, write nothing, count what a night would try. */
  readonly apply: boolean;
  /** Births at most. */
  readonly budget: number;
}

export interface BirthsSweepOutcome {
  /** Live memories the tally read. */
  readonly memories: number;
  /** Names over the bar that no card holds. */
  readonly offered: number;
  /** Born. Ids only; empty when `apply` is false. */
  readonly born: readonly string[];
  /** The gates' refusals by reason. */
  readonly refused: Readonly<Record<string, number>>;
  /** Names left for the next night by the budget. */
  readonly skippedForLimit: number;
}

export type BirthsFn = (input: BirthsInput) => BirthsSweepOutcome;

export interface BirthsResult extends PhaseOutcome {
  readonly born: readonly string[];
}

export function runBirths(ctx: PhaseCtx, births: BirthsFn | undefined): BirthsResult {
  const out = emptyOutcome();
  if (births === undefined) {
    out.skipped["no-births-fn"] = 1;
    return { ...out, born: [] };
  }
  const r = births({ day: ctx.day, apply: ctx.apply, budget: ctx.budget });
  out.examined = r.offered;
  // Under observer nothing is born, and `changed` is what a night would try.
  out.changed = ctx.apply ? r.born.length : Math.min(r.offered, ctx.budget);
  out.budgetExhausted = r.skippedForLimit > 0;
  out.skippedForBudget = r.skippedForLimit;
  for (const [reason, n] of Object.entries(r.refused)) countSkip(out, `refused:${reason}`, n);
  for (const id of r.born) {
    ctx.event("sleep.born", id, { day: ctx.day });
  }
  ctx.event("sleep.births.sweep", undefined, {
    day: ctx.day,
    memories: r.memories,
    offered: r.offered,
    born: r.born.length,
    skippedForLimit: r.skippedForLimit,
  });
  return { ...out, born: r.born };
}
