import { CORRECTED_REASON, PRESSURE_UNDONE_REASON } from "./reconsolidation.js";
import { DREAM_MERGE_REASON, DREAM_UNDONE_REASON } from "./dream/index.js";
import { TUNABLES as SCHEMA_TUNABLES } from "./schemas/index.js";
import { MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON } from "./sleep/index.js";
export const REMOVED_BY_OWNER = "removed-by-owner";
export const EPISODE_REGROWN_REASON = "episode-regrown";
export const LEAVING = {
  "handoff-cleared": "replaced",
  "handoff-duplicate": "replaced",
  [SCHEMA_TUNABLES.REVISED_REASON]: "replaced",
  [SCHEMA_TUNABLES.REPLACED_REASON]: "replaced",
  [CORRECTED_REASON]: "replaced",
  [PRESSURE_UNDONE_REASON]: "replaced",
  supersede: "replaced",
  [EPISODE_REGROWN_REASON]: "replaced",
  [SCHEMA_TUNABLES.FADE_REASON]: "let-go",
  [PRUNE_ARCHIVE_REASON]: "let-go",
  [MERGE_ARCHIVE_REASON]: "replaced",
  [DREAM_MERGE_REASON]: "replaced",
  [DREAM_UNDONE_REASON]: "replaced",
  [REMOVED_BY_OWNER]: "removed"
};
export function leftAs(reason, superseded = false) {
  const group = reason !== null && Object.hasOwn(LEAVING, reason) ? LEAVING[reason] : undefined;
  if (group !== undefined)
    return group;
  return superseded ? "replaced" : null;
}
