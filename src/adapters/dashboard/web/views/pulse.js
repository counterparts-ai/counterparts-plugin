import { activityView } from "./activity.js";
import { memoriesHeld } from "./shared.js";
export function pulse(src) {
  const activity = activityView(src, { limit: 1 });
  return {
    day: src.store.livedDay(),
    memories: memoriesHeld(src),
    events: activity.total,
    lastSeq: activity.lastSeq
  };
}
