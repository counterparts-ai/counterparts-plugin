/**
 * The health tab's "what fired" panel.
 *
 * A file of its own, and deliberately thin: the reading itself lives in
 * `adapters/fired.ts`, shared with `counterparts fired` and with doctor's
 * `Fired` finding so the three surfaces cannot disagree about what "silent"
 * means. All this does is hand the rows to the page in the shape it draws.
 *
 * It sits beside `views.ts` rather than inside it because `HealthView` is under
 * an unmerged exploratory redesign on another branch, and a panel bolted into
 * that interface would be a merge conflict in a file nobody wants one in. The
 * route is its own (`/api/fired`), so the two pages can move independently.
 *
 * Read-only, like everything in this directory.
 */
import { STATE_MEANING, STATE_ORDER, firedReport } from "../../fired.js";
import type { FiredReport } from "../../fired.js";
import type { DashboardSource } from "../source.js";

export interface FiredPanel extends FiredReport {
  /** The state vocabulary, in the order the panel draws its groups, with the
   *  one line each one means. On the payload so the page never restates it. */
  readonly vocabulary: { state: string; meaning: string }[];
  /**
   * The zone the window's days are read in (`store.zone()`: the
   * configuration's `timeZone`, else the machine's), so the footer names the
   * calendar it counts by. It said "(UTC)" until 2026-10-09, after the
   * reading itself had moved to the local day.
   */
  readonly zone: string;
}

export function firedPanel(src: DashboardSource, today: string): FiredPanel {
  return {
    ...firedReport(src.store, today),
    vocabulary: STATE_ORDER.map((state) => ({ state, meaning: STATE_MEANING[state] })),
    zone: src.store.zone(),
  };
}
