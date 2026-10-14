import { CORRECTED_REASON, PRESSURE_UNDONE_REASON } from "../../../../core/reconsolidation.js";
import { DREAM_MERGE_REASON, DREAM_UNDONE_REASON } from "../../../../core/dream/index.js";
import { EPISODE_REGROWN_REASON, LEAVING, REMOVED_BY_OWNER, leftAs } from "../../../../core/leaving.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../../../../core/schemas/index.js";
import { MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON } from "../../../../core/sleep/index.js";

export { REMOVED_BY_OWNER };
function groupOf(reason) {
  const group = LEAVING[reason];
  if (group === undefined)
    throw new Error(`archive-words: "${reason}" has no group in core/leaving.ts`);
  return group;
}
export const ARCHIVE_WORDS = [
  { reason: "handoff-cleared", many: "old handoff notes cleared", one: "old handoff note cleared", group: groupOf("handoff-cleared") },
  { reason: "handoff-duplicate", many: "duplicate handoff notes retired", one: "a repeated handoff note, cleared", group: groupOf("handoff-duplicate") },
  { reason: SCHEMA_TUNABLES.REVISED_REASON, many: "revised", one: "revised — a newer version replaced it", group: groupOf(SCHEMA_TUNABLES.REVISED_REASON) },
  { reason: SCHEMA_TUNABLES.REPLACED_REASON, many: "replaced by a correction", one: "replaced by a correction", group: groupOf(SCHEMA_TUNABLES.REPLACED_REASON) },
  { reason: CORRECTED_REASON, many: "corrected by a newer memory", one: "corrected — a newer memory holds; this one stays readable", group: groupOf(CORRECTED_REASON) },
  { reason: PRESSURE_UNDONE_REASON, many: "core changes undone", one: "a core change that was undone — the earlier one stands again", group: groupOf(PRESSURE_UNDONE_REASON) },
  { reason: "supersede", many: "replaced by a newer version", one: "replaced by a newer version", group: groupOf("supersede") },
  { reason: EPISODE_REGROWN_REASON, many: "rebuilt from the journal", one: "replaced by a newer version", group: groupOf(EPISODE_REGROWN_REASON) },
  { reason: SCHEMA_TUNABLES.FADE_REASON, many: "faded from use", one: "faded away — nothing mentions it any more", group: groupOf(SCHEMA_TUNABLES.FADE_REASON) },
  { reason: PRUNE_ARCHIVE_REASON, many: "let go at the floor", one: "let go at the floor — too weak for too long", group: groupOf(PRUNE_ARCHIVE_REASON) },
  { reason: MERGE_ARCHIVE_REASON, many: "merged duplicates", one: "merged into a near-duplicate", group: groupOf(MERGE_ARCHIVE_REASON) },
  { reason: DREAM_MERGE_REASON, many: "merged in a dream", one: "merged in a dream into a near-copy", group: groupOf(DREAM_MERGE_REASON) },
  { reason: DREAM_UNDONE_REASON, many: "undone with their dream", one: "made in a dream that was undone — the originals stand", group: groupOf(DREAM_UNDONE_REASON) },
  { reason: REMOVED_BY_OWNER, many: "removed by you", one: "removed by you", group: groupOf(REMOVED_BY_OWNER) }
];
export const ARCHIVE_PHRASES = ARCHIVE_WORDS.map((w) => [w.reason, w.many]);
const BY_REASON = new Map(ARCHIVE_WORDS.map((w) => [w.reason, w]));
export function archiveEntry(reason) {
  return reason === null ? undefined : BY_REASON.get(reason);
}
export function unmappedArchiveWords(reason) {
  return reason === null || reason.length === 0 ? "archived, no reason recorded" : `archived (${reason})`;
}
export function archiveWords(reason, superseded) {
  const entry = archiveEntry(reason);
  if (entry !== undefined)
    return entry.one;
  if (superseded)
    return "revised — a newer version replaced it";
  return unmappedArchiveWords(reason);
}
export function archiveGroup(reason, superseded = false) {
  return leftAs(reason, superseded);
}
