/**
 * Why a memory was archived, in plain words — the one table the health tab's
 * archive bar, the memories list and the home count all read.
 *
 * `many` names a group ("old handoff notes cleared · 12"); `one` names a single
 * row on its card. A reason not in the table still gets words, from
 * `unmappedArchiveWords`, so nothing archived is ever left unsaid.
 *
 * The GROUP is not decided here (2026-09-30): it is `core/leaving.ts`'s — the
 * one table of what counts as having left, which the `status` census reads
 * too — so the home tile and the census cannot disagree.
 */
import { CORRECTED_REASON } from "../../../../core/contradictions.js";
import { DREAM_MERGE_REASON, DREAM_UNDONE_REASON } from "../../../../core/dream/index.js";
import { EPISODE_REGROWN_REASON, LEAVING, REMOVED_BY_OWNER, leftAs } from "../../../../core/leaving.js";
import type { LeftAs } from "../../../../core/leaving.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../../../../core/schemas/index.js";
import { MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON } from "../../../../core/sleep/index.js";

/** `owner-op-seam.ts#REMOVED_REASON`, spelled in `core/leaving.ts` because that
 *  module is the store's WRITE seam and this directory imports no write seam. */
export { REMOVED_BY_OWNER };

/**
 * What kind of leaving it was, for the home page's "replaced" tile (2026-09-26,
 * an experiment): an older reading REPLACED by a newer one (nothing forgotten),
 * a memory LET GO because it faded, or one REMOVED by the owner.
 */
export type ArchiveGroup = LeftAs;

export interface ArchiveReasonWords {
  readonly reason: string;
  readonly many: string;
  readonly one: string;
  readonly group: ArchiveGroup;
}

/** The group `core/leaving.ts` gives a reason this table names. */
function groupOf(reason: string): ArchiveGroup {
  const group = LEAVING[reason];
  if (group === undefined) throw new Error(`archive-words: "${reason}" has no group in core/leaving.ts`);
  return group;
}

/** EVERY `archived_reason` the code writes, in the order the health bar draws them. */
export const ARCHIVE_WORDS: readonly ArchiveReasonWords[] = [
  { reason: "handoff-cleared", many: "old handoff notes cleared", one: "old handoff note cleared", group: groupOf("handoff-cleared") },
  { reason: "handoff-duplicate", many: "duplicate handoff notes retired", one: "a repeated handoff note, cleared", group: groupOf("handoff-duplicate") },
  { reason: SCHEMA_TUNABLES.REVISED_REASON, many: "revised", one: "revised — a newer version replaced it", group: groupOf(SCHEMA_TUNABLES.REVISED_REASON) },
  { reason: SCHEMA_TUNABLES.REPLACED_REASON, many: "replaced by a correction", one: "replaced by a correction", group: groupOf(SCHEMA_TUNABLES.REPLACED_REASON) },
  { reason: CORRECTED_REASON, many: "corrected by a newer memory", one: "corrected — a newer memory holds; this one stays readable", group: groupOf(CORRECTED_REASON) },
  { reason: "supersede", many: "replaced by a newer version", one: "replaced by a newer version", group: groupOf("supersede") },
  { reason: EPISODE_REGROWN_REASON, many: "rebuilt from the journal", one: "replaced by a newer version", group: groupOf(EPISODE_REGROWN_REASON) },
  { reason: SCHEMA_TUNABLES.FADE_REASON, many: "faded from use", one: "faded away — nothing mentions it any more", group: groupOf(SCHEMA_TUNABLES.FADE_REASON) },
  { reason: PRUNE_ARCHIVE_REASON, many: "let go at the floor", one: "let go at the floor — too weak for too long", group: groupOf(PRUNE_ARCHIVE_REASON) },
  { reason: MERGE_ARCHIVE_REASON, many: "merged duplicates", one: "merged into a near-duplicate", group: groupOf(MERGE_ARCHIVE_REASON) },
  { reason: DREAM_MERGE_REASON, many: "merged in a dream", one: "merged in a dream into a near-copy", group: groupOf(DREAM_MERGE_REASON) },
  // What an undone dream had made (a merged memory or a gist): the originals
  // it was made from stand again, so nothing is forgotten — "replaced", not
  // "removed by you" (a dream can be undone by the session as well as by you).
  { reason: DREAM_UNDONE_REASON, many: "undone with their dream", one: "made in a dream that was undone — the originals stand", group: groupOf(DREAM_UNDONE_REASON) },
  { reason: REMOVED_BY_OWNER, many: "removed by you", one: "removed by you", group: groupOf(REMOVED_BY_OWNER) },
];

/** `[reason, many]` pairs, in the bar's order. */
export const ARCHIVE_PHRASES: readonly (readonly [string, string])[] = ARCHIVE_WORDS.map((w) => [w.reason, w.many] as const);

const BY_REASON = new Map(ARCHIVE_WORDS.map((w) => [w.reason, w]));

/** The table's entry for a reason, or undefined when the table has none. */
export function archiveEntry(reason: string | null): ArchiveReasonWords | undefined {
  return reason === null ? undefined : BY_REASON.get(reason);
}

/** The one fallback: a reason nobody mapped keeps its own name; no reason says so. */
export function unmappedArchiveWords(reason: string | null): string {
  return reason === null || reason.length === 0 ? "archived, no reason recorded" : `archived (${reason})`;
}

/** One archived row, in words, for its card or list line. */
export function archiveWords(reason: string | null, superseded: boolean): string {
  const entry = archiveEntry(reason);
  if (entry !== undefined) return entry.one;
  if (superseded) return "revised — a newer version replaced it";
  return unmappedArchiveWords(reason);
}

/** Which group an archived row falls in — `core/leaving.ts#leftAs`: a reason
 *  nobody mapped counts as replaced only when a newer version superseded it;
 *  otherwise it stays apart (`null`), so the tile never files it under a word it
 *  has not earned. */
export function archiveGroup(reason: string | null, superseded = false): ArchiveGroup | null {
  return leftAs(reason, superseded);
}
