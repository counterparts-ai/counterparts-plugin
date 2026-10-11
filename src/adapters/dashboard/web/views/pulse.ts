/**
 * `/api/pulse`.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import type { DashboardSource } from "../../source.js";
import { activityView } from "./activity.js";
import { memoriesHeld } from "./shared.js";

export function pulse(src: DashboardSource): { day: number; memories: number; events: number; lastSeq: number } {
  const activity = activityView(src, { limit: 1 });
  return {
    day: src.store.livedDay(),
    memories: memoriesHeld(src),
    events: activity.total,
    lastSeq: activity.lastSeq,
  };
}
