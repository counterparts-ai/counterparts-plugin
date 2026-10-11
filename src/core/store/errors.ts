/**
 * One error type for the whole store, carrying a stable machine-readable code.
 *
 * Why a code and not a message: contract §5 G10 — telemetry is content-by-reference,
 * "error messages included". A code plus ids/counts can be logged; a message that
 * quotes prose cannot. Callers (and tests) assert the reason, never the prose.
 */
export type StoreErrorCode =
  | "OBSERVER_REFUSED"
  | "DATA_DIR_FORBIDDEN"
  /**
   * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` is set and nothing named a data dir —
   * no `dir`, no `COUNTERPARTS_DATA_DIR` — so `dataDir()` refused to hand back
   * `~/.counterparts/store` (`paths.ts`). `detail` carries `{ guard, dir, remedy }`:
   * the variable that refused, the directory it would have opened, and how to
   * name one. On the owner's machine that directory is his live memory, and on
   * 2026-09-05 a caller reached it by passing the wrong option name.
   */
  | "IMPLICIT_DEFAULT_DIR_REFUSED"
  /**
   * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` holds a value the guard will not guess
   * at — not blank, not one of `EXPLICIT_DIR_ARMING_VALUES`. Thrown at the
   * guard's decision point instead of falling open: the #80 review measured
   * `=true`, `=yes`, `=on` and `= 1` all silently resolving the default, which
   * is the one failure direction a safety guard may not have. `detail` carries
   * `{ guard, value, accepted }`.
   */
  | "EXPLICIT_DIR_GUARD_MALFORMED"
  /**
   * The row handed to a read is not the row that was asked for
   * (`walk-seam.ts`). Kept from the file floor, where a prose file and its row
   * could disagree about which memory it was; it is now the guard on the
   * caller-supplied `row` a walking read takes to save a second lookup.
   */
  | "PROSE_PAYLOAD_MISMATCH"
  | "PROSE_BODY_INVALID"
  | "PROSE_META_UNSERIALIZABLE"
  /**
   * The `meta` COLUMN does not parse as JSON. Only a hand-edited database can
   * hold one — every writer goes through `serializeMeta`.
   */
  | "MEMORY_META_MALFORMED"
  /**
   * **The row is there and its words are not**: `body` is empty while
   * `content_hash` still names the words that were in it.
   *
   * It replaces `PROSE_FILE_MISSING`, which said the same thing about a file.
   * The two halves of the test are the point: a blank body BESIDE a blank hash
   * is a tombstone — the owner removed this, and the deny-list answers by name
   * (`REMOVED`) — while a blank body beside a real hash is a row whose words
   * went missing underneath the store. No write path in this module produces
   * it; `put` and `revise` both refuse an empty body.
   *
   * `detail` carries `{ id }` and no path, because on this floor there is no
   * file to restore. Doctor's Store-open finding already has the no-path arm.
   */
  | "MEMORY_BODY_MISSING"
  /**
   * A reminder date (`PutInput.eventDate`, schema v7) that `time.ts` cannot
   * read as a day, month, year or range. Refused rather than stored: a date
   * nothing can parse is a reminder that silently never comes up.
   * `detail` carries `{ id, date }`.
   */
  | "EVENT_DATE_INVALID"
  /**
   * A feeling (`Store#addFeelings`, schema v7) that cannot be stored as given:
   * an unknown `whose` or `core`, a strength outside 0..1, a `beneath` that is
   * not on the same memory or loops. `detail` carries `{ index, reason }`; the
   * whole call wrote nothing. (Since 2026-09-28 a wheel word under another
   * core, and anything too long, is repaired, not refused — `repairs`.)
   * An emotion simply not on the wheel is NOT this — it is kept as `other`.
   */
  | "FEELING_INVALID"
  /**
   * A trait nudge (`Store#addTraits`, folded into schema v9) that cannot be
   * stored as given: an axis that is not one of the seven, a `toward` that is
   * not one of that axis's two poles, a strength outside 0..1, a `carried_by`
   * too long. `detail` carries `{ index, reason, allowed? }`; the whole call
   * wrote nothing.
   */
  | "TRAIT_INVALID"
  /** v9: an about-mark outside `ABOUT_MARKS`. `detail` carries `{ id, mark }`. */
  | "ABOUT_UNKNOWN"
  /** v9: an about-mark on a schema row or a removed memory. `detail` carries `{ id }`. */
  | "ABOUT_NOT_A_MEMORY"
  /** v10: a contradiction pair of a memory with itself. `detail` carries `{ id }`. */
  | "CONTRADICTION_SAME_MEMORY"
  /** v10: a settle named no pair and not both of its memories. */
  | "CONTRADICTION_PAIR_REQUIRED"
  /** v10: no contradiction pair has this id. `detail` carries `{ id }`. */
  | "CONTRADICTION_UNKNOWN"
  | "ID_MALFORMED"
  | "ID_UNKNOWN"
  | "ID_CYCLE"
  | "ID_CHAIN_TOO_DEEP"
  | "ID_DANGLING"
  | "ID_TAKEN"
  /**
   * The owner removed this id. The deny-list answering before the prose does —
   * a NAMED refusal, never the ENOENT of a chased file (§16 G12).
   * `detail` carries `{ id, by: "owner" }`: the code is the wire shape every
   * consumer switches on, the actor is the story it tells.
   */
  | "REMOVED"
  /** A chase was attempted on an id no removal record has taken dark (§16 G10). */
  | "REMOVAL_NOT_DARK"
  /** The owner-op capability was never granted for this store. */
  | "OWNER_OP_UNGRANTED"
  /**
   * A restore was attempted on a row the dedup pass did not archive. The
   * un-archive door exists to undo ONE thing — `archived_reason: "merged"` —
   * and a door that also un-archives prunes, revisions and removals would be
   * the general resurrection verb the store deliberately does not have.
   */
  | "UNMERGE_NOT_A_MERGE"
  /**
   * The row has a successor. Restoring it would put two live versions in one
   * revision chain, which is the state `resolve` exists to make impossible.
   */
  | "UNMERGE_SUPERSEDED"
  | "VERSION_UNKNOWN"
  | "CLOCK_BACKWARDS"
  /** An instrument opened a store that does not exist yet, or is a schema behind:
   *  initializing it would be writing at open, which an observer may not do. */
  | "STORE_UNINITIALIZED"
  /** A store written by a NEWER build: refused rather than stamped backwards. */
  | "SCHEMA_AHEAD"
  /**
   * **A store written before the floor**: `operational.sqlite`, `prose/` or
   * `versions/` is at its top level, so its words are in ~16,000 markdown files
   * this build has no code to read (schema v6, 2026-09-20).
   *
   * Refused BY NAME, in `Store`'s constructor, before any transaction and
   * before any directory is created — because the alternative is the one thing
   * in this rebuild that could make a store unreadable. `openOperational`
   * migrates anything below `SCHEMA_VERSION`; reaching it with a v5 store would
   * have added `body` NULL to every row, orphaned every prose file, stamped the
   * store v6, and left it unreadable by the build that CAN read it too.
   *
   * There is no migration, on purpose (owner ruling 6, 2026-09-18: the cut-over
   * carries nothing and he starts as a new user). `detail` carries
   * `{ dir, found, expected, readableBy }` — `readableBy` names the tag whose
   * build still opens it, so the sentence ends in a thing to do rather than in
   * a dead end. The old store is untouched and stays on disk.
   */
  | "STORE_PRE_ROWS"
  /**
   * The store needs a schema migration and the copy that comes before one
   * could not be made, so nothing was migrated: the store is still on its old
   * version and the build that wrote it still opens it. `detail` carries
   * `{ path, found, expected, dir, reason, remedy }`.
   */
  | "MIGRATION_SNAPSHOT_FAILED"
  /**
   * `counterparts rollback` put this store back on an older schema and left its
   * hold (`rollback-hold.ts`), so this build opens it neither to upgrade it nor
   * to read it: a read would build this build's cache beside the old store.
   * Refused in `Store`'s constructor before anything is created or opened.
   * `detail` carries `{ dir, from, to, at, snapshot, aside, halfway, remedy }`;
   * `halfway` is a hold over no database (the rollback stopped before its copy went in).
   */
  | "STORE_ROLLED_BACK"
  | "SQLITE_UNAVAILABLE"
  | "LAYOUT_UNCLASSIFIED";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  /** Ids / counts only. Never body text (contract §5 G10). */
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: StoreErrorCode,
    detail: Record<string, string | number | boolean | null> = {},
  ) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "StoreError";
    this.code = code;
    this.detail = detail;
  }
}

export function isStoreError(e: unknown, code?: StoreErrorCode): e is StoreError {
  return e instanceof StoreError && (code === undefined || e.code === code);
}
