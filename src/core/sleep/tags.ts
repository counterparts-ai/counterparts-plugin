/**
 * The tags phase (wave 2 lane B, 2026-10-21; design §1): the night's tag
 * work that needs no model — the names of the cards a memory is linked to
 * written as its tags, stem merges, and merges no memory carries any more let
 * go. Right after `births`, so a card born tonight lends its name tonight.
 *
 * `schemas/` owns the work (`schemas/tags.ts#nightTagWork`, behind its
 * `TAGS_NIGHT` switch); `sleep/` owns the cadence and the budget (card-name
 * tags written a night). Like the births, the work is handed in as a
 * `TagsFn` by the composition root: this module does not import `schemas/`.
 * A missing fn is `did-not-run` with reason `no-tags-fn`; the switch off is a
 * run that did nothing, counted `switched-off`.
 */

import type { PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome } from "./types.js";

export interface TagsInput {
  readonly day: number;
  /** False under observer: write nothing, count what a night would do. */
  readonly apply: boolean;
  /** Card-name tags written at most. */
  readonly budget: number;
}

export interface TagsSweepOutcome {
  /** False when the work is switched off. */
  readonly on: boolean;
  readonly cardOffered: number;
  readonly cardTagged: number;
  readonly skippedForLimit: number;
  readonly stemMerged: number;
  readonly mergesPruned: number;
}

export type TagsFn = (input: TagsInput) => TagsSweepOutcome;

export function runTags(ctx: PhaseCtx, tags: TagsFn | undefined): PhaseOutcome {
  const out = emptyOutcome();
  if (tags === undefined) {
    out.skipped["no-tags-fn"] = 1;
    return out;
  }
  const r = tags({ day: ctx.day, apply: ctx.apply, budget: ctx.budget });
  if (!r.on) {
    countSkip(out, "switched-off", 1);
    return out;
  }
  out.examined = r.cardOffered;
  out.changed = r.cardTagged + r.stemMerged + r.mergesPruned;
  out.budgetExhausted = r.skippedForLimit > 0;
  out.skippedForBudget = r.skippedForLimit;
  ctx.event("sleep.tags.sweep", undefined, {
    day: ctx.day,
    cardOffered: r.cardOffered,
    cardTagged: r.cardTagged,
    stemMerged: r.stemMerged,
    mergesPruned: r.mergesPruned,
    skippedForLimit: r.skippedForLimit,
  });
  return out;
}
