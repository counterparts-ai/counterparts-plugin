/**
 * WHAT COUNTS AS HAVING LEFT — the one table every reader of an archived row
 * asks (2026-09-30, U13; the owner asked for one module owning "nothing was
 * dropped").
 *
 * An archived row left the live store one of three ways:
 *
 *   `replaced` — a newer reading carries it: a revision, a correction, a
 *                chapter's copy rebuilt when the chapter grew, duplicates
 *                merged (by sleep or in a dream) into a row that is still live,
 *                what an undone dream had made (its originals stand again).
 *                Nothing was forgotten.
 *   `let-go`   — it faded: pruned at the floor, or a card nothing mentions.
 *   `removed`  — the owner removed it.
 *
 * Only the last two are EXITS. The census (the `status` tool) counted every
 * archived row as one until 2026-09-30, so a store whose chapters kept growing
 * read as forgetting its self-kind memories: 72 of 74 self exits on the live
 * store were `episode-regrown`. The dashboard's archive words
 * (`archive-words.ts`) take their groups from here, so the census and the
 * dashboard cannot disagree.
 *
 * A DREAM MERGE IS `replaced` (decided 2026-09-30, as the dashboard already
 * filed it): the originals' content lives on in the merged row, and undoing
 * the dream brings them back. The U13 note called the two on the live store
 * "real exits"; by this table's one test — does a live row still carry it? —
 * they are not.
 *
 * `sleep/cycle.ts#census` is a different count and is left as it is: it tallies
 * the cycle's own curation ACTIONS (prune, merge, fade) so a path that never
 * fires shows up (§5 G13), and a regrown copy — archived at ingestion, not in
 * the cycle — never reached it.
 *
 * A reason the code writes but this table does not name is not guessed at:
 * `leftAs` files it `replaced` only when a newer version superseded the row,
 * and otherwise returns null — which the census counts as an exit, so an
 * unknown leaving is never hidden under "nothing was forgotten".
 */
import { CORRECTED_REASON } from "./contradictions.js";
import { DREAM_MERGE_REASON, DREAM_UNDONE_REASON } from "./dream/index.js";
import { TUNABLES as SCHEMA_TUNABLES } from "./schemas/index.js";
import { MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON } from "./sleep/index.js";

export type LeftAs = "replaced" | "let-go" | "removed";

/** `store/owner-op-seam.ts#REMOVED_REASON`, spelled here so no reader of this
 *  table imports the store's write seam; a test holds the two equal. */
export const REMOVED_BY_OWNER = "removed-by-owner";

/** The copy archived when its chapter grew (`self/index.ts#ingestEpisode`). */
export const EPISODE_REGROWN_REASON = "episode-regrown";

/** EVERY `archived_reason` the code writes, and how the row left. */
export const LEAVING: Readonly<Record<string, LeftAs>> = {
  "handoff-cleared": "replaced",
  "handoff-duplicate": "replaced",
  [SCHEMA_TUNABLES.REVISED_REASON]: "replaced",
  [SCHEMA_TUNABLES.REPLACED_REASON]: "replaced",
  // A contradiction settled `corrected` (2026-09-29): the memory that holds is
  // live, and the corrected one stays readable by its own id.
  [CORRECTED_REASON]: "replaced",
  supersede: "replaced",
  [EPISODE_REGROWN_REASON]: "replaced",
  [SCHEMA_TUNABLES.FADE_REASON]: "let-go",
  [PRUNE_ARCHIVE_REASON]: "let-go",
  [MERGE_ARCHIVE_REASON]: "replaced",
  [DREAM_MERGE_REASON]: "replaced",
  [DREAM_UNDONE_REASON]: "replaced",
  [REMOVED_BY_OWNER]: "removed",
};

/** How an archived row left, or null when its reason is unknown and nothing superseded it. */
export function leftAs(reason: string | null, superseded = false): LeftAs | null {
  const group = reason !== null && Object.hasOwn(LEAVING, reason) ? LEAVING[reason] : undefined;
  if (group !== undefined) return group;
  return superseded ? "replaced" : null;
}
