/**
 * The entity fade — where a card nobody has mentioned in a long while is
 * ARCHIVED. A state, not a deletion: the card keeps its id, stays resolvable,
 * and stops surfacing.
 *
 * `schemas/` owns the verdict (`Schemas#fadeSweep`: physics' prune verdict, the
 * attached-elements blocker, and gentle lived + calendar floors, slower for
 * people). `sleep/` owns only the cadence (schemas INTERFACE-GAPS §6). This
 * module does not import `schemas/`: the sweep is handed in as a `FadeFn`, the
 * same seam the briefing's `RenderFn` uses, and the composition root wires it.
 *
 * Entity cards leave ONLY through here. The floor prune skips them
 * (`types.ts#isEntityCard`) — before this phase existed, the prune was the
 * thing archiving them, at physics' 90 lived days and blind to the beliefs
 * still attached (NOTES §17).
 *
 * A missing sweep is `did-not-run` with reason `no-fade-fn`, not a failure and
 * not "ran and found nothing".
 */

import type { PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome } from "./types.js";

export interface FadeInput {
  readonly day: number;
  /** The cycle's calendar date — the calendar floors are counted to it. */
  readonly date: string;
  /** False under observer: compute every verdict, write nothing. */
  readonly apply: boolean;
  /** Cards to examine at most. */
  readonly budget: number;
}

export interface FadeSweepOutcome {
  readonly examined: number;
  /** Faded (or, when `apply` is false, would have). Ids only. */
  readonly faded: readonly string[];
  /** Every blocker, counted, across the cards that stayed. */
  readonly blocked: Readonly<Record<string, number>>;
  /** Calendar anchors written this sweep. */
  readonly anchored: number;
  readonly skippedForLimit: number;
}

export type FadeFn = (input: FadeInput) => FadeSweepOutcome;

export interface FadeResult extends PhaseOutcome {
  readonly faded: readonly string[];
  readonly anchored: number;
}

export function runFade(ctx: PhaseCtx, fade: FadeFn | undefined, date: string): FadeResult {
  const out = emptyOutcome();
  if (fade === undefined) {
    out.skipped["no-fade-fn"] = 1;
    return { ...out, faded: [], anchored: 0 };
  }
  const r = fade({ day: ctx.day, date, apply: ctx.apply, budget: ctx.budget });
  out.examined = r.examined;
  out.changed = r.faded.length;
  out.budgetExhausted = r.skippedForLimit > 0;
  out.skippedForBudget = r.skippedForLimit;
  // Mirrored under one namespace, like prune's `blocked:` — most of these are
  // "not yet" (the floors), not refusals.
  for (const [reason, n] of Object.entries(r.blocked)) countSkip(out, `blocked:${reason}`, n);
  for (const id of r.faded) {
    ctx.event("sleep.faded", id, { day: ctx.day, applied: ctx.apply });
  }
  ctx.event("sleep.fade.sweep", undefined, {
    day: ctx.day,
    examined: r.examined,
    faded: r.faded.length,
    anchored: r.anchored,
  });
  return { ...out, faded: r.faded, anchored: r.anchored };
}
