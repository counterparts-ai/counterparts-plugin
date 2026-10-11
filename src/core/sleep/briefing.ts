/**
 * The wake briefing re-render — the cycle's LAST content write.
 *
 * `self/` owns the briefing: what goes in it, the composed byte budget, the trim
 * order, the header/sentinel counts, and the atomic publish (`self/CONTRACT.md`
 * §5 G1–G3). `sleep/` owns exactly one thing about it: that it happens LAST,
 * after revision, so it sees this boundary's own supersedes, promotions, merges,
 * and prunes (CONTRACT §3 G5).
 *
 * `self/` is being built in parallel, so this module DOES NOT IMPORT IT. The
 * seam is an injected `RenderFn`; a test asserts sleep imports nothing from
 * `../self/`. When self's render export exists, the wiring is one line at the
 * coordinator — see INTERFACE-GAPS.md §2.
 *
 * A missing renderer is `did-not-run` with reason `no-render-fn`, NOT a failure
 * and NOT "ran and found nothing" (§5 G6, scar §2.4). The three are different
 * records and a wake that never got re-rendered must be visible as such.
 *
 * Zero generative calls: this module calls the function it was handed and counts
 * bytes. Whatever the renderer does is the renderer's contract, and the launch
 * ruling is that it renders WITHOUT a model (module-map ruling 3).
 */

import type { PhaseCtx, PhaseOutcome, SleepStore } from "./types.js";
import { emptyOutcome } from "./types.js";

export interface BriefingContext {
  readonly store: SleepStore;
  readonly day: number;
  /** Always false when the renderer is actually invoked — see `runBriefing`. */
  readonly observer: boolean;
  /**
   * The HOST's reported injection ceiling, in bytes (SEAMS item G, scar §2.18).
   * `sleep/` has no business inventing one and does not: it carries the number
   * the adapter handed `runCycle` and hands it to the renderer unread. Absent
   * means the host reported none, and the renderer decides what that means —
   * `self/` REQUIRES it, so its adapter refuses rather than guessing.
   */
  readonly budgetBytes?: number;
}

export interface BriefingOutcome {
  /** Composed size of the published briefing. Counts, never the text. */
  readonly bytes?: number;
  /** How many elements survived the trim order. */
  readonly elements?: number;
}

export type RenderFn = (ctx: BriefingContext) => BriefingOutcome | void;

export interface BriefingResult extends PhaseOutcome {
  readonly rendered: boolean;
  readonly bytes: number;
  readonly elements: number;
}

export function runBriefing(
  ctx: PhaseCtx,
  render: RenderFn | undefined,
  budgetBytes?: number,
): BriefingResult {
  const out = emptyOutcome();
  if (render === undefined) {
    out.skipped["no-render-fn"] = 1;
    return { ...out, rendered: false, bytes: 0, elements: 0 };
  }
  out.examined = 1;
  if (!ctx.apply) {
    // An observer never invokes the renderer: publishing a briefing is a content
    // write, and the whole point of the read-only report is that it makes none.
    out.skipped["observer-report"] = 1;
    return { ...out, rendered: false, bytes: 0, elements: 0 };
  }
  const result =
    render({
      store: ctx.store,
      day: ctx.day,
      observer: false,
      ...(budgetBytes === undefined ? {} : { budgetBytes }),
    }) ?? ({} as BriefingOutcome);
  out.changed = 1;
  const bytes = result.bytes ?? 0;
  const elements = result.elements ?? 0;
  ctx.event("sleep.briefing.rendered", undefined, { bytes, elements, day: ctx.day });
  return { ...out, rendered: true, bytes, elements };
}
