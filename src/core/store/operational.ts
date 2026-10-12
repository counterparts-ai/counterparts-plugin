/**
 * Box 2 — the canonical operational database. One small SQLite file holding the
 * physics fields, the band cache, superseded-version rows, edges, prospective
 * entries, the removal record, and meta/clock state.
 *
 * Canonical, NOT a cache: it is backed up as a database and never "rebuilt". The
 * rebuild contract belongs to box 3 alone (contract §4, owner rescope 1).
 *
 * Every multi-row mutation is wrapped in a transaction by the seam in `index.ts`.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { remapV10Feeling } from "../feelings-wheel.js";
import { TUNABLES as PHYSICS_TUNABLES, defaultClaimFor, spacingWeight } from "../physics/index.js";
import { addDays, daysBetween, isDay, isRecurrence, occurrenceBetween, parseCalendarDate } from "../time.js";
import type { Band, DatedHold, Kind, MemoryPhysics, Salience } from "../types.js";
import type { Db, Row } from "./db.js";
import { openDb } from "./db.js";
import { StoreError } from "./errors.js";
import { PRE_ROWS_READABLE_BY } from "./paths.js";
import { preMigrationDir, snapshotBeforeMigration } from "./pre-migration.js";
import type { ProseType } from "./prose.js";

/**
 * Bumped to 12 (2026-10-03, the write side of deliberate recall): ADDITIVE,
 * through the same copy-first seam, and nothing re-filed. `memories` (and
 * `versions`, which mirror the words' own fields) gain three columns the
 * WRITER fills at write time: `occurred_on` (when the thing the memory is
 * about happened — the same day, month, range or year shapes `event_date`
 * takes, but the past or present, where `event_date` is a future date to be
 * reminded on and `happened_on` is the lived day of a write-up), `said_by`
 * (`owner`, `self` or `inferred`: who said it, not which channel wrote the
 * row) and `status` (`done`, `planned`, `proposed`, `asked`). NULL on every
 * row written before: they cannot be filled without a model. One table is
 * new, `memory_subjects`: a memory linked to the entity cards it names, filled
 * at write time from the alias index and once, after the upgrade, for the rows
 * already there (`Counterpart`'s backfill — this transaction has no alias
 * index). The upgrade records its moment (`V12_UPGRADE_KEY`), which is what
 * doctor's "since v12" reads. `store/NOTES.md` 2026-10-03.
 *
 * Bumped to 11 (2026-09-30, the feelings wheel v2): ADDITIVE, through the same
 * copy-first seam. The wheel's six cores become seven (happy, warm, calm,
 * curious, sad, uneasy, angry — `core/feelings-wheel.ts`), and `feelings`
 * gains three columns: `valence` (REAL, the writer's own reading; NULL = the
 * word's default, read when needed — no backfill) and `core_v10` /
 * `emotion_v10`, what the first wheel stored on a row the upgrade RE-FILED
 * (NULL on the rest). The upgrade re-files every feeling onto the seven
 * (`refileFeelingsV11`: fear → uneasy, anger and disgust → angry, sad → sad
 * but guilt → uneasy, happy and surprise and a writer's own word by the word),
 * keeping the old pair on the row so it can be put back
 * (`restoreFeelingsV10`); doctor says what it moved. `store/NOTES.md`
 * 2026-09-30.
 *
 * Bumped to 10 (2026-09-29, contradictions as a mechanism): ADDITIVE, through
 * the same copy-first seam. `memories` gains `fade` (REAL, default 1): the
 * multiplier a `changed` settle puts on strength (physics §5.12) — folded in
 * after the review of #284, before any store migrated. Two tables are new. `contradictions` holds a PAIR
 * of memories that disagree — flagged (a dream's `contradiction`, carried over
 * from `dream_changes` by the upgrade) or recorded when it was settled — with
 * its standing: `unsettled`, `settled` (`changed`, `corrected` or `open`, which
 * one holds and which one it is over), or `withdrawn` (the dream that flagged
 * it was undone). `contradiction_settles` is the TRAIL: every settle and every
 * undo, who did it (a session, a dream, a reflection, the page writer, the
 * owner), why in a short line, the ids, the day, and what undoing it needs
 * (ids and numbers). The upgrade carries every open dream flag onto a pair,
 * with the latch that said it was raised awake and the habituation "my mind"
 * kept for it, so nothing is raised twice or weighs anew the morning after;
 * doctor says what it carried. `store/NOTES.md` 2026-09-29.
 *
 * Bumped to 9 (2026-09-27, reflection + core by meaning): ADDITIVE, through the
 * same copy-first seam. `memories` gains `about` — WHAT A MEMORY IS ABOUT, a
 * neutral mark (`me`, `us`, `owner`, `work`, `world`, or NULL) an awake model
 * sets by meaning (the writer at `note` / `session_end`, or the reflection),
 * which replaces the kind-label reading as the core's first question — and
 * `about_by`, who set it. `feelings` gains `source` (`session`, `dream`,
 * `reflection`) and `recorded_later` — the calendar date a feeling was
 * recorded AFTER the moment, NULL for one felt at the time. One table is new,
 * `reflections` (the waking self's record: an optional dream id, the entry,
 * the morning share and whether it was told, what it cited). `returns` gains
 * a SOURCE, not a column: `reflection`, which the core lanes count beside
 * `awake` (physics §5.11). The upgrade CARRIES TODAY'S RULE: every `self`
 * memory is marked `me` and every `person` memory naming the owner `owner`,
 * `about_by = 'upgrade'`, so the core candidates are the same the morning
 * after as the night before; doctor says so. `store/NOTES.md` 2026-09-27.
 * Folded into v9 before any build published it: `traits` (a memory's trait
 * nudges — `store/traits.ts`), new and empty, so every memory starts untagged.
 * A development store already stamped v9 without it gains it at its next
 * writer open (`ensureCurrentTables`, below).
 *
 * Bumped to 8 (2026-09-26, dreaming + consolidation): ADDITIVE again, through
 * the same copy-first seam. `memories` gains `legacy` (every row the upgrade
 * finds keeps the old one-time consolidation path, so nothing drops a band)
 * and the RETURNS aggregate (`returns`, `return_days`, `first_return_day`,
 * `last_return_day`, `last_dream_day` — physics §5.11); six tables are new:
 * `returns` (the history behind that aggregate), `wake_display` (what the
 * wake's hints lane showed), `dreams` + `dream_changes` (a dream, its journal,
 * and every change it made, for undo), `dream_asks` (the once-a-day ask and
 * its snooze) and `core_events` (promotions with their lane, the owner's
 * demotions, a dream's nominations). `store/NOTES.md` 2026-09-26.
 *
 * Bumped to 7 (2026-09-25, docs/time.md): the first ADDITIVE migration since the
 * copy-before-migrating seam (#214) shipped. Every table that holds records
 * gains its MOMENTS — `created_at` / `updated_at`, UTC ms from `store.now()` —
 * and `memories` gains `model` (which model wrote the words) and `event_date`
 * (the calendar date the memory is ABOUT, as the person said it: a day, a
 * month, a year or a range). `versions` carries `created_at`, `model` and
 * `event_date` of the words it archived. All nullable, all through
 * `ADDED_COLUMNS`, so a v6 store migrates in one transaction after its copy is
 * taken, and rows written before carry NULL: the owner ruled old dates stay as
 * they are (docs/time.md rule 6). The table-by-table reasoning is in
 * `store/NOTES.md` 2026-09-25.
 *
 * Bumped to 6 (2026-09-20, the floor): **the memory IS the row.** `title`,
 * `body`, `meta` and `confidential` are columns on `memories`; a version row
 * carries its own `title`/`body`/`meta` plus the two provenance dates; and
 * `memories.prose_path` and `versions.path` are GONE, because there are no
 * files for them to name. Markdown became an export (`render.ts`).
 *
 * **There is no migration from v5, and there must not be one.** A v5 store's
 * bodies are ~16,000 markdown files this build cannot see; adding `body` through
 * `ADDED_COLUMNS` would "migrate" the owner's live memory into a store with
 * every body NULL, every prose file orphaned, stamped v6 — and unreadable by the
 * old build too. So a pre-rows store is refused BY NAME, before any transaction
 * and before any directory is created, in `Store`'s constructor
 * (`STORE_PRE_ROWS`). The cut-over carries nothing: the owner starts blank
 * (ruling 6, 2026-09-18), and the old store stays on disk, byte-identical.
 *
 * Version 5 (2026-09-05, finding I22) made the two path columns store-relative;
 * both columns are gone with this bump and the conversion with them. Version 4
 * (2026-08-29, the mint-source doctrine) added `source` + three `origin_*`
 * columns on `memories`. Version 3 was the box-2 chase (`removal_tombstone`);
 * version 2 was SEAMS items B + K (`gate_session` and `events`).
 *
 * Migration is still ADDITIVE and idempotent for whatever comes after v6: the
 * DDL below is `CREATE TABLE IF NOT EXISTS`, and columns added after a table
 * first shipped live in `ADDED_COLUMNS`, applied by `ensureAddedColumns` — a
 * `pragma table_info` check, then `ALTER TABLE ADD COLUMN` for whatever is
 * missing, inside the same one-transaction migrate-at-open. A fresh open and a
 * migrated open MUST converge on the identical schema; a test asserts
 * table_info equality.
 */
/*
 * Bumped to 13 (2026-10-10, the mechanisms review's ONE schema bump, synthesis
 * §3): additive only — new columns, one table, indexes and four triggers;
 * nothing dropped, nothing rewritten but the backfill of a new column. Groups
 * 1–4 are pre-provisioned so none of them bumps again: `memories.next_change_day`
 * (+ index, + the triggers that clear it; Group 1's turn-down),
 * `feelings.recorded_day` (Group 1, backfilled), `memories.dream_shown_day`
 * (+ index), `returns.session` and the `derivations` table (+ index on
 * `parent`) for Group 3, `edges.source` / `edges.reinforced` for Group 4, and
 * the indexes `memories(archived, birth_day)`, `feelings(created_at)`,
 * `edges(last_day)`, `edges(weight)`, `edges(dst)`. The copy is taken before
 * migrating, like every bump since v7 (`copyBeforeMigrating`); a build that
 * knows only v12 refuses the file `SCHEMA_AHEAD`, and the way back is that
 * copy (`store/NOTES.md` 2026-10-10).
 */
export const SCHEMA_VERSION = 13;
/**
 * The oldest schema an OBSERVER may open without a migration having run.
 *
 * v5 earned a floor below itself because its only change was the SPELLING of
 * two path columns, which every v5 reader resolved both ways. v6 has no such
 * exemption and cannot have one: a v5 store keeps its words in files this build
 * has no code to read, so an instrument opening one would report an empty store
 * rather than an unreadable one. The floor is therefore the version itself, and
 * the refusal a reader actually meets is `STORE_PRE_ROWS`, which names the last
 * build that CAN read it (`floor/v5-last`) instead of asking for a migration
 * that does not exist.
 *
 * Raised to 7 with v7 (2026-09-25): every read of a row now names the v7
 * columns, and a v6 file has none of them, so an instrument meets
 * `STORE_UNINITIALIZED` on a v6 store until the first WRITER opens it — the
 * next hook, which migrates it after taking its copy. A floor below the
 * version would mean every read tolerating missing columns, which is the
 * shape v5's exemption had and v6 dropped.
 *
 * Raised to 8 with v8 (2026-09-26), for the same reason: a row read names the
 * returns columns, and the new tables are read by instruments. On a v7 store
 * doctor and the dashboard say "not initialized" until the next hook opens it
 * as a writer, which copies it and migrates it.
 *
 * Raised to 9 with v9 (2026-09-27), for the same reason again: the
 * `reflections` table is read by instruments (doctor's reflection line), and a
 * v8 file has none.
 *
 * Raised to 10 with v10 (2026-09-29): recall's labels, doctor's Contradictions
 * line and the dashboard read `contradictions`, and a v9 file has none.
 *
 * Raised to 11 with v11 (2026-09-30): a v10 file's feelings are filed under
 * cores this build's readers do not draw (fear, surprise, disgust), and its
 * rows have no `valence`.
 *
 * NOT raised with v12 (2026-10-03). The question each raise answered yes to
 * is whether an instrument reading the older file gets a WRONG answer, and
 * for v12 it does not: rows are read `m.*`, so a v11 row simply has no
 * `occurred_on` / `said_by` / `status` (the row type carries them optional),
 * nothing re-filed what a v11 row says, and the one instrument that reads the
 * new fields — doctor's `Write fields` line — asks for the column and the
 * table first and says it is waiting for the upgrade. Keeping the floor keeps
 * doctor and the dashboard reading a v11 store between an install and the
 * first writer that opens it.
 *
 * NOT raised with v13 (2026-10-10), for v12's reason: rows are read `m.*`, a
 * v12 row simply has no `next_change_day` / `dream_shown_day` (nothing an
 * instrument reads), and a v12 feeling with no `recorded_day` softens from its
 * memory's birth (`feelings.ts#feltDay`) — what every build before v13 did.
 */
export const OBSERVER_READ_FLOOR = 11;
/** Retention for superseded-version rows, in LIVED days. TUNABLE (module-map ruling 2).
 *
 *  Owner ruling 1, 2026-09-18: the prune STAYS, at 90. It now deletes the words
 *  themselves rather than a note about a file — his steer was simple, elegant
 *  working-memory mechanics over keeping everything, and losing some history
 *  after a month or two is an acceptable price. Our own store sets it high for
 *  debugging. `store/NOTES.md` carries what changed underneath the number. */
export const DEFAULT_RETENTION_DAYS = 90;

/** Box-2 meta key prefix: the memory ids a card the owner removed had linked,
 *  written by the chase (`owner-op-seam.ts`), read by `Store#cardTombstoneLinks`.
 *  Ids only, never the name (§16 G9). Review of #429, 2026-10-11. */
export const CARD_TOMBSTONE_PREFIX = "removal.card.";

/**
 * THE TOMBSTONE SHAPE — what a chased row looks like once the owner-op seam has
 * blanked it (`owner-op-seam.ts#chaseRemoved`).
 *
 * It was "the pointers are blank" while the words were in a file; now the words
 * are the columns, so it is the columns that are blanked, and the pair is the
 * predicate: an empty body AND an empty content hash. Both halves matter. A row
 * whose body is empty while the hash still names words that were there is NOT a
 * tombstone — it is a row whose words went missing underneath the store, which
 * is the `MEMORY_BODY_MISSING` fault, and reading the two as one condition would
 * turn a disk event into a silent "the owner removed this".
 *
 * Spelled once, here, because three modules ask it: the store's own reads, the
 * console's removal read-back, and `schemas/index.ts`, whose skip is what keeps
 * a session starting after a removal (#139).
 */
export function rowTombstoned(row: Pick<MemoryRow, "body" | "content_hash">): boolean {
  return row.body === "" && row.content_hash === "";
}

export const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  // v7 (2026-09-25, docs/time.md) appends four columns to `memories`:
  // `created_at` / `updated_at` (MOMENTS, UTC ms from `store.now()` — the words
  // or state changing, not physics bookkeeping), `model` (the model id that
  // wrote the words; NULL when none was named) and `event_date` (the calendar
  // date the memory is ABOUT, as said). No SQL comment sits among them, on
  // purpose: SQLite's `ALTER TABLE ... DROP COLUMN` fails with "incomplete
  // input" on a last column preceded by `--` lines (measured building the v6
  // fixture in `test/store-v7.test.ts`), and a future migration may need one.
  `CREATE TABLE IF NOT EXISTS memories (
     id                TEXT PRIMARY KEY,
     type              TEXT NOT NULL,
     kind              TEXT NOT NULL,
     band              TEXT NOT NULL,
     band_day          INTEGER NOT NULL,
     novelty           REAL,
     relevance         REAL NOT NULL,
     emotional         REAL NOT NULL,
     predictive        REAL NOT NULL,
     claimed           REAL,
     birth_day         INTEGER NOT NULL,
     uses              REAL NOT NULL DEFAULT 0,
     last_used_day     INTEGER NOT NULL,
     reinforced_days   INTEGER NOT NULL DEFAULT 0,
     consolidated      INTEGER NOT NULL DEFAULT 0,
     promoted_identity INTEGER NOT NULL DEFAULT 0,
     protected         INTEGER NOT NULL DEFAULT 0,
     pressure          REAL NOT NULL DEFAULT 0,
     last_challenged_day INTEGER,
     archived          INTEGER NOT NULL DEFAULT 0,
     archived_reason   TEXT,
     superseded_by     TEXT REFERENCES memories(id),
     revision          INTEGER NOT NULL DEFAULT 0,
     content_hash      TEXT NOT NULL,
     learned_on        TEXT NOT NULL,
     happened_on       TEXT,
     source            TEXT,
     origin_session    TEXT,
     origin_scope      TEXT,
     origin_ref        TEXT,
     -- v6: the memory itself. prose_path is gone; there is no file.
     title             TEXT,
     body              TEXT NOT NULL,
     -- The payload's meta, VERBATIM JSON. One column, not columns: 28 distinct
     -- keys are in use across src/ and tools/, the set is open, and contract §3's
     -- "unrecognized fields survive parse -> serialize untouched" (G6, v1's named
     -- incident) is satisfied for free by storing the text as given.
     meta              TEXT NOT NULL DEFAULT '{}',
     -- The one key promoted OUT of that JSON, because it is a GATE: a gate that
     -- must parse JSON on every read is a gate that will one day fail open
     -- (confidentialByMeta, the one truth table, computes it at every write).
     confidential      INTEGER NOT NULL DEFAULT 0,
     created_at        INTEGER,
     updated_at        INTEGER,
     model             TEXT,
     event_date        TEXT,
     legacy            INTEGER NOT NULL DEFAULT 0,
     returns           REAL NOT NULL DEFAULT 0,
     return_days       INTEGER NOT NULL DEFAULT 0,
     first_return_day  INTEGER,
     last_return_day   INTEGER,
     last_dream_day    INTEGER,
     about             TEXT,
     about_by          TEXT,
     fade              REAL NOT NULL DEFAULT 1,
     occurred_on       TEXT,
     said_by           TEXT,
     status            TEXT,
     next_change_day   INTEGER,
     dream_shown_day   INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS memories_band ON memories (band, archived)`,
  `CREATE INDEX IF NOT EXISTS memories_kind ON memories (kind, archived)`,
  `CREATE TABLE IF NOT EXISTS versions (
     memory_id    TEXT NOT NULL REFERENCES memories(id),
     seq          INTEGER NOT NULL,
     reason       TEXT NOT NULL,
     version_day  INTEGER NOT NULL,
     archived_at  INTEGER NOT NULL,
     content_hash TEXT NOT NULL,
     successor_id TEXT REFERENCES memories(id),
     -- v6: the archived words themselves, where path used to name a file.
     title        TEXT,
     body         TEXT NOT NULL,
     meta         TEXT NOT NULL DEFAULT '{}',
     -- The two PROVENANCE dates as they stood in this version. Not in the floor
     -- plan; added because the code disagreed with it. revise({learnedOn}) is
     -- a change to canonical content and keeps its prior version like any other
     -- (see index.ts#revise), and with the dates taken from the LIVE row instead a
     -- corrected date would have silently rewritten every version behind it.
     learned_on   TEXT NOT NULL DEFAULT '',
     happened_on  TEXT,
     -- v7: the archived words' own moment (the head's updated_at, else its
     -- created_at, when they were archived — archived_at is when they STOPPED
     -- being current), the model that wrote them, and their event date.
     created_at   INTEGER,
     model        TEXT,
     event_date   TEXT,
     occurred_on  TEXT,
     said_by      TEXT,
     status       TEXT,
     PRIMARY KEY (memory_id, seq)
   )`,
  `CREATE TABLE IF NOT EXISTS edges (
     src      TEXT NOT NULL REFERENCES memories(id),
     dst      TEXT NOT NULL REFERENCES memories(id),
     weight   REAL NOT NULL,
     last_day INTEGER NOT NULL,
     -- v7 moments: first linked, last re-weighted.
     created_at INTEGER,
     updated_at INTEGER,
     -- v13 (pre-provisioned for Group 4): what laid the link, and how often
     -- it was reinforced since.
     source     TEXT,
     reinforced INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (src, dst)
   )`,
  `CREATE TABLE IF NOT EXISTS prospective (
     memory_id      TEXT NOT NULL REFERENCES memories(id),
     window_key     TEXT NOT NULL,
     event_date     TEXT NOT NULL,
     precision      TEXT NOT NULL,
     state          TEXT NOT NULL,
     fires          INTEGER NOT NULL DEFAULT 0,
     last_fired_day INTEGER,
     -- v7 moments: window first recorded, last changed state.
     created_at     INTEGER,
     updated_at     INTEGER,
     PRIMARY KEY (memory_id, window_key)
   )`,
  // v7 (2026-09-25, owner-approved): FEELINGS ON A MEMORY, one row each —
  // `store/feelings.ts` has the shape and the check. Content-bearing
  // (`carried_by`, `other_word`), so the owner's removal DELETES a memory's
  // rows, like its edges and windows. `beneath_id` points at another feeling on
  // the same memory (anger over fear). Moments are NOT NULL here: the table is
  // new, so no row predates them.
  `CREATE TABLE IF NOT EXISTS feelings (
     id          TEXT PRIMARY KEY,
     memory_id   TEXT NOT NULL REFERENCES memories(id),
     whose       TEXT NOT NULL,
     core        TEXT NOT NULL,
     emotion     TEXT NOT NULL,
     other_word  TEXT,
     strength    REAL NOT NULL,
     beneath_id  TEXT REFERENCES feelings(id),
     carried_by  TEXT NOT NULL DEFAULT '',
     model       TEXT,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL,
     source      TEXT,
     recorded_later TEXT,
     valence     REAL,
     core_v10    TEXT,
     emotion_v10 TEXT,
     recorded_day INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS feelings_memory ON feelings (memory_id)`,
  // v9, folded in before any build published it (2026-09-27, the owner's
  // design, held lightly): TRAIT NUDGES on a memory, one row each —
  // `store/traits.ts` has the vocabulary and the check. Content-bearing
  // (`carried_by`), so the owner's removal DELETES a memory's rows, as it
  // does its feelings. Display only: nothing in the core reads this table to
  // decide anything. Moments are NOT NULL: the table is new.
  `CREATE TABLE IF NOT EXISTS traits (
     id          TEXT PRIMARY KEY,
     memory_id   TEXT NOT NULL REFERENCES memories(id),
     axis        TEXT NOT NULL,
     toward      TEXT NOT NULL,
     strength    REAL NOT NULL,
     carried_by  TEXT NOT NULL DEFAULT '',
     source      TEXT,
     model       TEXT,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS traits_memory ON traits (memory_id)`,
  // v8 (2026-09-26, dreaming + consolidation): RETURNS, one row per counted
  // return — an awake credited use after a gap, or a dream replay. The history
  // behind the `returns` / `return_days` / `*_return_day` columns on
  // `memories`, which are recomputed FROM this table whenever it changes, so an
  // undone dream's replays leave no trace in the physics. Ids and numbers only.
  `CREATE TABLE IF NOT EXISTS returns (
     memory_id  TEXT NOT NULL REFERENCES memories(id),
     day        INTEGER NOT NULL,
     source     TEXT NOT NULL,
     weight     REAL NOT NULL,
     gap        INTEGER NOT NULL,
     dream_id   TEXT,
     at         INTEGER NOT NULL,
     session    TEXT,
     PRIMARY KEY (memory_id, day, source)
   )`,
  `CREATE INDEX IF NOT EXISTS returns_at ON returns (at)`,
  `CREATE INDEX IF NOT EXISTS returns_dream ON returns (dream_id) WHERE dream_id IS NOT NULL`,
  // v8: WHAT THE WAKE SHOWED in its hints ("Nearby") lane — one row per memory
  // a published bundle kept there: the first and last lived day of the current
  // showing, the day a publish dropped it (NULL while it is still showing), and
  // the habituation load `self/` keeps (#238, harvested). A use while a memory
  // is showing credits as always but is not a RETURN (physics §5.11). The
  // `ever_*` columns are the memory as it stood the FIRST time it was ever
  // shown — its uses and its last use — so the lane can score it on what came
  // back unprompted (`self/identity.ts#hintReading`).
  `CREATE TABLE IF NOT EXISTS wake_display (
     memory_id      TEXT PRIMARY KEY REFERENCES memories(id),
     lane           TEXT NOT NULL,
     first_day      INTEGER NOT NULL,
     shown_day      INTEGER NOT NULL,
     closed_day     INTEGER,
     load           REAL NOT NULL DEFAULT 0,
     ever_day       INTEGER NOT NULL,
     ever_uses      REAL NOT NULL DEFAULT 0,
     ever_last_used INTEGER NOT NULL,
     updated_at     INTEGER NOT NULL
   )`,
  // v8: DREAMS (`core/dream/`). One row per dream: when, for which session, its
  // state (`begun`, `journaled`, `undone`), and its JOURNAL — the dream's own
  // entry, kept here and never as a memory, so it can never be mistaken for a
  // lived event (no decay, no dedup, no prune, no recall). The latest row's day
  // is "last dreamed".
  `CREATE TABLE IF NOT EXISTS dreams (
     id          TEXT PRIMARY KEY,
     session     TEXT,
     scope       TEXT,
     day         INTEGER NOT NULL,
     date        TEXT,
     state       TEXT NOT NULL,
     started_at  INTEGER NOT NULL,
     finished_at INTEGER,
     undone_at   INTEGER,
     model       TEXT,
     title       TEXT,
     journal     TEXT,
     shown       TEXT NOT NULL DEFAULT '[]'
   )`,
  `CREATE INDEX IF NOT EXISTS dreams_day ON dreams (day)`,
  // v8: every change a dream made, in order, with what undoing it needs — ids
  // and numbers only in `detail`, never words. `undone` marks a reversed row.
  `CREATE TABLE IF NOT EXISTS dream_changes (
     dream_id TEXT NOT NULL REFERENCES dreams(id),
     seq      INTEGER NOT NULL,
     action   TEXT NOT NULL,
     ref      TEXT,
     ref2     TEXT,
     detail   TEXT NOT NULL DEFAULT '{}',
     at       INTEGER NOT NULL,
     undone   INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (dream_id, seq)
   )`,
  // v8: the dream ASK, one row per calendar day it was raised: `offered` when a
  // session was handed the line, `declined` when the owner said not today.
  `CREATE TABLE IF NOT EXISTS dream_asks (
     date    TEXT PRIMARY KEY,
     state   TEXT NOT NULL,
     session TEXT,
     day     INTEGER NOT NULL,
     at      INTEGER NOT NULL
   )`,
  // v8: the CORE's history — every promotion (with its lane), every owner
  // demotion (with the owner's reason) and every dream nomination. Not
  // foreign-keyed: the record outlives a merge. The owner's removal deletes a
  // memory's rows, because a reason is words about it.
  `CREATE TABLE IF NOT EXISTS core_events (
     seq       INTEGER PRIMARY KEY AUTOINCREMENT,
     memory_id TEXT NOT NULL,
     action    TEXT NOT NULL,
     day       INTEGER NOT NULL,
     at        INTEGER NOT NULL,
     lane      TEXT,
     reason    TEXT,
     dream_id  TEXT,
     actor     TEXT
   )`,
  // v9 (2026-09-27): REFLECTIONS — the waking self, usually after a dream
  // (`dream_id`, optional: reflecting is its own act). One row per reflection:
  // the questions it was asked, what it was shown, its entry (first person,
  // LIVED; when it cited anything, the entry is also a memory of source
  // `reflection`, `entry_id`), the morning share and what became of it
  // (`none`, `offered`, `carried`, `told`), the ids it cited, and the page
  // version it wrote. The owner's removal redacts an entry and a share that
  // cite or quote a removed memory.
  `CREATE TABLE IF NOT EXISTS reflections (
     id           TEXT PRIMARY KEY,
     dream_id     TEXT,
     session      TEXT,
     scope        TEXT,
     day          INTEGER NOT NULL,
     date         TEXT,
     state        TEXT NOT NULL,
     started_at   INTEGER NOT NULL,
     finished_at  INTEGER,
     model        TEXT,
     questions    TEXT NOT NULL DEFAULT '[]',
     shown        TEXT NOT NULL DEFAULT '[]',
     entry        TEXT,
     entry_id     TEXT,
     cites        TEXT NOT NULL DEFAULT '[]',
     share        TEXT,
     share_cites  TEXT NOT NULL DEFAULT '[]',
     share_state  TEXT NOT NULL DEFAULT 'none',
     share_at     INTEGER,
     share_session TEXT,
     page_version INTEGER,
     detail       TEXT NOT NULL DEFAULT '{}'
   )`,
  `CREATE INDEX IF NOT EXISTS reflections_day ON reflections (day)`,
  // v10 (2026-09-29): CONTRADICTIONS — a pair of memories that disagree, one
  // row per pair (`a` the older, `b` the newer). `state`: `unsettled` (flagged,
  // nobody has said which holds), `settled`, or `withdrawn` (the dream that
  // flagged it was undone). A settled pair says `how` — `changed` (both were
  // true at their time), `corrected` (one was wrong) or `open` (a real
  // disagreement, both kept) — and, for the first two, which memory `holds`
  // and which it is `over`. `via` names the pair whose settle closed this one
  // (a flagged pair closed by a new memory that `updates` one of its two).
  // Ids and numbers only; the words are in the trail. Not foreign-keyed: the
  // owner's removal deletes a removed memory's pairs itself.
  `CREATE TABLE IF NOT EXISTS contradictions (
     id          TEXT PRIMARY KEY,
     a           TEXT NOT NULL,
     b           TEXT NOT NULL,
     state       TEXT NOT NULL,
     how         TEXT,
     holds       TEXT,
     over        TEXT,
     via         TEXT,
     source      TEXT NOT NULL,
     dream_id    TEXT,
     dream_seq   INTEGER,
     flagged_day INTEGER NOT NULL,
     raised_day  INTEGER,
     settled_day INTEGER,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS contradictions_a ON contradictions (a)`,
  `CREATE INDEX IF NOT EXISTS contradictions_b ON contradictions (b)`,
  `CREATE INDEX IF NOT EXISTS contradictions_state ON contradictions (state)`,
  // v10: THE TRAIL — every settle and every undo of a pair, in order: who
  // (`actor`: session, dream, reflection, page-writer, owner; `actor_id` the
  // session / dream / reflection id), the kind, why (a short line in the
  // settler's words — content-bearing, so the owner's removal deletes the
  // rows of a removed memory's pairs), the ids, the lived day and the moment,
  // and in `detail` what undoing it needs (ids and numbers only).
  `CREATE TABLE IF NOT EXISTS contradiction_settles (
     seq      INTEGER PRIMARY KEY AUTOINCREMENT,
     pair_id  TEXT NOT NULL,
     action   TEXT NOT NULL,
     how      TEXT,
     holds    TEXT,
     over     TEXT,
     actor    TEXT NOT NULL,
     actor_id TEXT,
     why      TEXT,
     day      INTEGER NOT NULL,
     at       INTEGER NOT NULL,
     undone   INTEGER NOT NULL DEFAULT 0,
     detail   TEXT NOT NULL DEFAULT '{}'
   )`,
  `CREATE INDEX IF NOT EXISTS contradiction_settles_pair ON contradiction_settles (pair_id)`,
  `CREATE INDEX IF NOT EXISTS contradiction_settles_at ON contradiction_settles (at)`,
  // v13 (2026-10-10, pre-provisioned for Group 3 — the mechanisms review's
  // one schema bump): DERIVATIONS — one row per (child, parent, how): a gist
  // or a fold and each memory it was made from, a memory filed under another,
  // a merge, a citation. Reverse provenance, so a source can find what was
  // made of it without scanning every meta bag (`meaning.ts` does today).
  // Ids and a lived day only. Not foreign-keyed, like `contradictions`: the
  // owner's removal deletes a removed memory's rows itself. Nothing writes
  // it yet.
  `CREATE TABLE IF NOT EXISTS derivations (
     child  TEXT NOT NULL,
     parent TEXT NOT NULL,
     how    TEXT NOT NULL,
     day    INTEGER,
     PRIMARY KEY (child, parent, how)
   )`,
  `CREATE INDEX IF NOT EXISTS derivations_parent ON derivations (parent)`,
  // v12 (2026-10-03): WHAT A MEMORY NAMES — one row per memory and entity
  // card (schema `role: entity`) its title or body names as a whole word,
  // by the alias index's one rule (`schemas/aliases.ts`). `via` says how the
  // link was found: `write` (the memory's own write, or a revise of its
  // words), `birth` (a card born after the memory, which then looked for the
  // memories already naming it) or `backfill` (the one pass after the
  // upgrade). Ids only — a link is an address, never words. Not foreign-keyed,
  // like `contradictions`: the owner's removal deletes a removed memory's or
  // card's rows itself. Read both ways: a memory's subjects (the primary key)
  // and a subject's memories (`memory_subjects_subject`).
  `CREATE TABLE IF NOT EXISTS memory_subjects (
     memory_id  TEXT NOT NULL,
     subject_id TEXT NOT NULL,
     via        TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (memory_id, subject_id)
   )`,
  `CREATE INDEX IF NOT EXISTS memory_subjects_subject ON memory_subjects (subject_id, memory_id)`,
  `CREATE INDEX IF NOT EXISTS core_events_memory ON core_events (memory_id)`,
  `CREATE INDEX IF NOT EXISTS core_events_at ON core_events (at)`,
  `CREATE INDEX IF NOT EXISTS feelings_whose_core ON feelings (whose, core)`,
  `CREATE INDEX IF NOT EXISTS feelings_whose_emotion ON feelings (whose, emotion)`,
  // SEAMS item B — per-session gate state, ONE ROW PER RECORD.
  //
  // It replaces `recall/`'s `meta` row at `recall.gate.<sessionId>`, which was a
  // JSON document read-modify-written by two writers (a turn's `recall()` and a
  // late `resolveUse()` from the boundary, in different processes) — scar §2.1's
  // exact shape, arriving inside a transactional database because the transaction
  // was around the wrong span. A row per record means a late writer inserts ITS
  // record and can no longer drop anybody else's.
  //
  // `kind` is open on purpose: `surfaced` and `credited` are recall's, `window` is
  // where prospective's offered-window keys land (prospective/INTERFACE-GAPS.md §3
  // — brake 3 of four, currently in-process), and `scalar` carries the row-level
  // fields (turn counter, refractory, carried cues) that are not per-memory.
  `CREATE TABLE IF NOT EXISTS gate_session (
     session_id TEXT NOT NULL,
     kind       TEXT NOT NULL,
     ref        TEXT NOT NULL,
     turn       INTEGER NOT NULL,
     tier       TEXT,
     trains     INTEGER,
     value      TEXT,
     last_day   INTEGER NOT NULL,
     PRIMARY KEY (session_id, kind, ref)
   )`,
  `CREATE INDEX IF NOT EXISTS gate_session_day ON gate_session (last_day)`,
  // SEAMS item K — the durable event log.
  //
  // `schemas/`'s revision story kept its pressure increments in an in-memory ring:
  // the pressure number survived a restart and the story of how it got there did
  // not (schemas/INTERFACE-GAPS.md §1), and constitution line 16 says the owner
  // can see what changed and why. `sleep/`'s prune/promotion/merge records have the
  // same shape (sleep/INTERFACE-GAPS.md §3).
  //
  // `dedup_key` is what reconciles an APPEND-ONLY log with sleep's §5 G3 replay
  // idempotence: a record that must land at most once ever carries one, and the
  // partial unique index makes the second append a no-op. Telemetry passes null
  // (SQLite treats NULLs as distinct), so ordinary increments still accumulate.
  //
  // Payload is content-BY-REFERENCE: ids, hashes, counts, scores. Never body text.
  // memory_id/ref is deliberately NOT a foreign key — a record outlives its row.
  `CREATE TABLE IF NOT EXISTS events (
     seq       INTEGER PRIMARY KEY AUTOINCREMENT,
     at        INTEGER NOT NULL,
     day       INTEGER NOT NULL,
     name      TEXT NOT NULL,
     ref       TEXT,
     dedup_key TEXT,
     payload   TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS events_dedup ON events (dedup_key) WHERE dedup_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS events_name ON events (name, ref)`,
  `CREATE INDEX IF NOT EXISTS events_day ON events (day)`,
  // The removal record. Append-only, canonical, and deliberately carries NO body and
  // NO content hash (§16 G9: hashing low-entropy content would leak what was removed).
  // memory_id is deliberately NOT a foreign key — the record must outlive the row.
  `CREATE TABLE IF NOT EXISTS removal_record (
     seq       INTEGER PRIMARY KEY AUTOINCREMENT,
     memory_id TEXT NOT NULL,
     stage     TEXT NOT NULL,
     at        INTEGER NOT NULL,
     actor     TEXT NOT NULL,
     reason    TEXT
   )`,
  // What the chase leaves behind: the skeleton of a removed memory, so that
  // "everything permanent is enumerable and inspectable" survives the one
  // operation that ends permanence (scar §2.19 from the other side — a removed
  // protected element must show as `[removed]`, never vanish from the list).
  //
  // Same content rule as the record itself (§16 G9): ids, flags, counts and a
  // timestamp. NO title, NO body, NO content hash — a hash of low-entropy
  // content is brute-forceable, which would make the tombstone a leak of the
  // thing it marks. `superseded_by` is kept because an id is an address, not
  // content, and a successor's lineage must not dangle.
  //
  // Deliberately NOT foreign-keyed: the tombstone outlives the row it describes.
  `CREATE TABLE IF NOT EXISTS removal_tombstone (
     memory_id         TEXT PRIMARY KEY,
     type              TEXT NOT NULL,
     kind              TEXT NOT NULL,
     band              TEXT NOT NULL,
     protected         INTEGER NOT NULL,
     promoted_identity INTEGER NOT NULL,
     superseded_by     TEXT,
     versions          INTEGER NOT NULL,
     edges             INTEGER NOT NULL,
     prospective       INTEGER NOT NULL,
     gate_rows         INTEGER NOT NULL,
     at                INTEGER NOT NULL
   )`,
];

export interface MemoryRow extends Row {
  id: string;
  type: ProseType;
  kind: Kind;
  band: Band;
  band_day: number;
  novelty: number | null;
  relevance: number;
  emotional: number;
  predictive: number;
  claimed: number | null;
  birth_day: number;
  uses: number;
  last_used_day: number;
  reinforced_days: number;
  consolidated: number;
  promoted_identity: number;
  protected: number;
  pressure: number;
  last_challenged_day: number | null;
  archived: number;
  archived_reason: string | null;
  superseded_by: string | null;
  revision: number;
  content_hash: string;
  learned_on: string;
  happened_on: string | null;
  /** Who minted this memory (engine-set at the seam; mint.ts `ClaimChannel`,
   *  plus "migrated" from the v1 importer). NULL = a pre-v4 row whose
   *  provenance was never recorded — rendered "unrecorded", never defaulted. */
  source: string | null;
  origin_session: string | null;
  origin_scope: string | null;
  /** The proposal / trace id this memory was minted from. Ids only, never text. */
  origin_ref: string | null;
  /** v6: the memory itself, and the two fields that travel with it. */
  title: string | null;
  body: string;
  /** `ProseDoc.meta` as verbatim JSON (G6). Parsed once, at the read seam. */
  meta: string;
  /** `confidentialByMeta(meta)` at the last write. A column, never re-derived
   *  per call site: the confidentiality class is a gate (CONTRACT §5 G13). */
  confidential: number;
  /** v7 moments (UTC ms). NULL on a row written before v7. */
  created_at: number | null;
  updated_at: number | null;
  /** v7: the model that wrote the current words; NULL = not a named model. */
  model: string | null;
  /** v7: the calendar date the memory is about, as said (`time.ts`). */
  event_date: string | null;
  /** v8: 1 for every row the v8 upgrade found (the legacy consolidation path). */
  legacy: number;
  /** v8: the returns aggregate, recomputed from the `returns` table. */
  returns: number;
  return_days: number;
  first_return_day: number | null;
  last_return_day: number | null;
  last_dream_day: number | null;
  /**
   * v9: what the memory is about (`me`, `us`, `owner`, `work`, `world`), set
   * by an awake model that read it — the writer at `note` / `session_end`, or
   * the reflection — or by the v9 upgrade carrying the old kind rule. NULL =
   * unmarked. Only `me`, `us` and `owner` can become core
   * (`sleep/consolidate.ts#aboutMe`). Optional so a bare row built by a test
   * or a tool without the column still reads.
   */
  about: string | null;
  /** v9: who set `about` — `writer`, `reflection`, `owner`, `upgrade`, and (2026-10-11, no schema change) `self`. */
  about_by: string | null;
  /** v10: the strength multiplier a `changed` settle sets (physics §5.12); 1 otherwise. */
  fade: number;
  /**
   * v12: when the thing the memory is about happened, as the writer said it —
   * a day, a month, a year or a range (`time.ts#parseCalendarDate`). Not
   * `happened_on` (the lived day of a write-up) and not `event_date` (a
   * future date to be reminded on). A v11 file read before its upgrade has
   * no column, and reads undefined (`OBSERVER_READ_FLOOR`): read it `?? null`.
   */
  occurred_on: string | null;
  /** v12: who said it — `owner`, `self` or `inferred` (`SAID_BY`). */
  said_by: string | null;
  /** v12: what kind of thing it is — `done`, `planned`, `proposed`, `asked` (`STATUSES`). */
  status: string | null;
  /**
   * v13 (2026-10-10): the next lived day the nightly turn-down must look at
   * this row — when its band, reach or prune eligibility next changes
   * (`physics#nextChangeDay`). DERIVED, never an input: NULL means "look at it
   * on the next pass", and a trigger clears it whenever an input of the curve
   * is written. Undefined on a v12 file read before its upgrade.
   */
  next_change_day: number | null;
  /** v13 (pre-provisioned for Group 3): the last lived day a standing dream SHOWED it. Nothing writes it yet. */
  dream_shown_day: number | null;
}

export interface ReflectionRow extends Row {
  id: string;
  dream_id: string | null;
  session: string | null;
  scope: string | null;
  day: number;
  date: string | null;
  /** `begun`, `reflected`. */
  state: string;
  started_at: number;
  finished_at: number | null;
  model: string | null;
  /** JSON: the questions it was asked. */
  questions: string;
  /** JSON: the ids it was shown (the only ids it may cite, mark or feel). */
  shown: string;
  entry: string | null;
  /** The memory the entry became (source `reflection`), or null (nothing cited: "nothing much"). */
  entry_id: string | null;
  /** JSON: the ids the entry and the page rest on. */
  cites: string;
  share: string | null;
  /** JSON: the ids the share rests on (a telling records `told` on them). */
  share_cites: string;
  /** `none` (nothing to share), `offered`, `carried` (a later session was handed it), `told`. */
  share_state: string;
  share_at: number | null;
  share_session: string | null;
  page_version: number | null;
  /** JSON: counts and reasons, ids and numbers only. */
  detail: string;
}

/** v10: one pair of memories that disagree (`contradictions`). */
export interface ContradictionRow extends Row {
  id: string;
  /** The older of the two (by birth day, then moment, then id). */
  a: string;
  /** The newer. */
  b: string;
  /** `unsettled`, `settled` or `withdrawn`. */
  state: string;
  /** `changed`, `corrected` or `open`, once settled. */
  how: string | null;
  /** The one that holds (changed / corrected), else null. */
  holds: string | null;
  /** The one it is over (changed / corrected), else null. */
  over: string | null;
  /** The pair whose settle closed this one, when it was closed that way. */
  via: string | null;
  /** Who first recorded it: `dream` (a flag), `write` (a new memory's `updates`), `settle` (a settle of two memories no flag named). */
  source: string;
  dream_id: string | null;
  dream_seq: number | null;
  flagged_day: number;
  /** The lived day it was raised awake (the once-only line), or null. */
  raised_day: number | null;
  settled_day: number | null;
  created_at: number;
  updated_at: number;
}

/** v10: one settle or undo of a pair (`contradiction_settles`, the trail). */
export interface SettleRow extends Row {
  seq: number;
  pair_id: string;
  /** `settle` or `undo`. */
  action: string;
  how: string | null;
  holds: string | null;
  over: string | null;
  /** `session`, `dream`, `reflection`, `page-writer`, `owner`. */
  actor: string;
  actor_id: string | null;
  why: string | null;
  day: number;
  at: number;
  /** 1 once a later undo reversed this settle. */
  undone: number;
  /** JSON: what undoing it needs — ids and numbers only. */
  detail: string;
}

export interface ReturnRow extends Row {
  memory_id: string;
  day: number;
  source: string;
  weight: number;
  gap: number;
  dream_id: string | null;
  at: number;
  /** v13 (pre-provisioned for Group 3): the session it came back in — the
   *  recall session for an awake or engaged use, the reflection's id for a
   *  reflection's citation; written since 2026-10-11 (Group 3 part A), NULL
   *  before that and for a dream's replay. The core's recurrence lane counts it. */
  session: string | null;
}

export interface WakeDisplayRow extends Row {
  memory_id: string;
  lane: string;
  first_day: number;
  shown_day: number;
  closed_day: number | null;
  load: number;
  /** The first lived day it was EVER shown, and its uses / last use then. */
  ever_day: number;
  ever_uses: number;
  ever_last_used: number;
  updated_at: number;
}

export interface DreamRow extends Row {
  id: string;
  session: string | null;
  scope: string | null;
  day: number;
  date: string | null;
  state: string;
  started_at: number;
  finished_at: number | null;
  undone_at: number | null;
  model: string | null;
  title: string | null;
  journal: string | null;
  /** The ids the dream was SHOWN (its bundle), as JSON: the only ids it may change. */
  shown: string;
}

export interface DreamChangeRow extends Row {
  dream_id: string;
  seq: number;
  action: string;
  ref: string | null;
  ref2: string | null;
  detail: string;
  at: number;
  undone: number;
}

export interface DreamAskRow extends Row {
  date: string;
  state: string;
  session: string | null;
  day: number;
  at: number;
}

export interface CoreEventRow extends Row {
  seq: number;
  memory_id: string;
  action: string;
  day: number;
  at: number;
  lane: string | null;
  reason: string | null;
  dream_id: string | null;
  actor: string | null;
}

/**
 * NOT A COLUMN: the strongest recorded feeling on a memory, read beside the
 * row by `Store.row()` (`MAX(feelings.strength)`), null when it has none.
 * Optional, and kept off `MemoryRow` itself, so a bare `SELECT * FROM
 * memories` is still a row — such a read simply carries no feeling, and the
 * intensity falls back to the numeric `emotional` score (physics §5.10).
 */
export interface FeelingPeak {
  /**
   * NOT A COLUMN (2026-10-10): the store's calendar today (`meta.lastActiveDate`,
   * the date of `livedDay`), read beside the row so the dated hold
   * (`datedHold`) needs no second read. Absent on a bare `SELECT *`.
   */
  today_date?: string | null;
  /**
   * NOT A COLUMN (2026-10-10, the old-claims era): the store's
   * `claims.era.cutoff` meta value (UTC ms), read beside the row so the era
   * (`eraClaimOf`) needs no second read. Null when the era is off; absent on a
   * bare `SELECT *`, which then reads every claim as stored.
   */
  claims_era_cutoff?: string | null;
  feeling_peak?: number | null;
  /** v9: the same peak without the feelings a reflection recorded later. */
  feeling_peak_lived?: number | null;
}

export interface VersionRow extends Row {
  memory_id: string;
  seq: number;
  reason: string;
  version_day: number;
  archived_at: number;
  content_hash: string;
  successor_id: string | null;
  title: string | null;
  body: string;
  meta: string;
  learned_on: string;
  happened_on: string | null;
  created_at: number | null;
  model: string | null;
  event_date: string | null;
  /** v12: the writer's three fields as they stood on these words (undefined on a v11 file). */
  occurred_on: string | null;
  said_by: string | null;
  status: string | null;
}

export interface EdgeRow extends Row {
  src: string;
  dst: string;
  weight: number;
  last_day: number;
  created_at: number | null;
  updated_at: number | null;
  /** v13 (pre-provisioned for Group 4): what laid the link. Nothing writes it yet. */
  source: string | null;
  /** v13 (pre-provisioned for Group 4): how often it was reinforced. 0 until something does. */
  reinforced: number;
}

export interface ProspectiveRow extends Row {
  memory_id: string;
  window_key: string;
  event_date: string;
  precision: string;
  state: string;
  fires: number;
  last_fired_day: number | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface GateSessionRow extends Row {
  session_id: string;
  kind: string;
  ref: string;
  turn: number;
  tier: string | null;
  trains: number | null;
  value: string | null;
  last_day: number;
}

export interface EventRow extends Row {
  seq: number;
  at: number;
  day: number;
  name: string;
  ref: string | null;
  dedup_key: string | null;
  payload: string | null;
}

export interface RemovalRow extends Row {
  seq: number;
  memory_id: string;
  stage: string;
  at: number;
  actor: string;
  reason: string | null;
}

export interface TombstoneRow extends Row {
  memory_id: string;
  type: ProseType;
  kind: Kind;
  band: Band;
  protected: number;
  promoted_identity: number;
  superseded_by: string | null;
  versions: number;
  edges: number;
  prospective: number;
  gate_rows: number;
  at: number;
}

export interface OpenOperationalOptions {
  /**
   * May this open CREATE or MIGRATE the database? False for an instrument: an
   * observer that ran the DDL would be writing at open — which is both a
   * stand-down violation and, in the field, the reason `counterparts backup`
   * threw "database is locked" while a session held a write transaction
   * (live-verify 2026-08-25). Defaults to true.
   */
  readonly initialize?: boolean;
  /** Written once, at creation only. Ignored for an already-initialized store. */
  readonly retentionDays?: number;
  /**
   * Where the copy taken before a migration goes. Absent ⇒ the default beside
   * the store (`defaultSnapshotsDir`); a store with neither refuses to migrate.
   */
  readonly snapshotsDir?: string;
  /**
   * Take a NEW pre-migration copy even when one for the same upgrade from
   * today is on disk (`pre-migration.ts#reusableCopy`). Set by
   * `counterparts rollback --upgrade-again`: after a rollback the store has
   * lived on since that copy, and reusing it would make a second rollback
   * restore the first one's copy and lose what was written in between.
   */
  readonly freshMigrationCopy?: boolean;
  /** Told once, after a migration committed, what was copied and where. */
  readonly onMigrated?: (note: MigrationNote) => void;
  /**
   * The person's calendar day at this open (`YYYY-MM-DD`), for a migration
   * that moves dates onto the local calendar. v7 clamps `lastActiveDate` to it.
   */
  readonly localToday?: string;
}

/** What the open did to the schema, for the caller's record. */
export interface MigrationNote {
  readonly from: string;
  readonly to: number;
  /** The pre-migration copy's name inside `dir`. */
  readonly snapshot: string;
  /** True when a copy an earlier, failed attempt took was used again. */
  readonly reused: boolean;
  readonly dir: string;
}

/**
 * Does `memories` carry the column that holds a memory's words?
 *
 * The one question that tells a pre-rows database from a v6 one, whatever its
 * stamp says. A `PRAGMA` on an open handle; no rows read, nothing written.
 * A file with no `memories` table at all (a fresh one) answers false, which is
 * why the caller asks it only about a database that already has a version.
 */
function hasBodyColumn(db: Db): boolean {
  try {
    return db.all<{ name: string }>("PRAGMA table_info(memories)").some((c) => c.name === "body");
  } catch {
    return false;
  }
}

/**
 * Is the database at `path` a PRE-ROWS one wearing the current filename?
 *
 * The second lock's question, asked without a `Store` — for the two console
 * doors that open box 3 directly and so never meet `openOperational` at all
 * (`migrate-cache`, and `verify --rebuild`'s census). Review f5c measured both
 * running to completion on a v5 database renamed to `counterparts.sqlite`, and
 * `migrate-cache --apply` would rewrite and VACUUM ~17,000 documents' index in
 * a store this build has declared it cannot read.
 *
 * Opening it is safe HERE in a way it is not at the filename door: this file is
 * already named `counterparts.sqlite`, so it is not the owner's parked v5 store
 * with a `-wal` full of his words — that one is caught by name, before anything
 * opens. `wal: false`, one PRAGMA and one SELECT, closed immediately.
 *
 * False for a file that is not there, is not a database, or is a healthy v6 one.
 */
export function isPreRowsDatabase(path: string): boolean {
  let db;
  try {
    db = openDb(path, { wal: false });
    const found = readSchemaVersion(db);
    if (found === null) return false;
    const n = Number.parseInt(found, 10);
    return Number.isFinite(n) && n < SCHEMA_VERSION && !hasBodyColumn(db);
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      /* nothing to say about a handle that will not close */
    }
  }
}

/**
 * Is the database at `path` on an older schema that the next writer open will
 * migrate (and copy first)? `{ found }` when it is; null when it is absent,
 * current, ahead, unreadable, or a pre-rows database (refused, never migrated).
 * One short read on its own connection; nothing is written.
 */
export function pendingMigration(path: string): { found: string; expected: number } | null {
  if (!existsSync(path)) return null;
  let db;
  try {
    db = openDb(path, { wal: false });
    const found = readSchemaVersion(db);
    if (found === null || found === String(SCHEMA_VERSION)) return null;
    const n = Number.parseInt(found, 10);
    if (Number.isFinite(n) && n > SCHEMA_VERSION) return null;
    if (!hasBodyColumn(db)) return null;
    return { found, expected: SCHEMA_VERSION };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* nothing to say about a handle that will not close */
    }
  }
}

/** The schema version recorded in the file, or null if there is not one yet. */
function readSchemaVersion(db: Db): string | null {
  try {
    return db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schemaVersion'")?.value ?? null;
  } catch {
    return null; // no meta table: a fresh file
  }
}

/**
 * Open box 2, and write NOTHING when it is already current.
 *
 * The steady state is the common case — the same shape `openCache` uses — and it
 * matters more here, because a write at open takes SQLite's write lock, so a
 * read-only caller could be refused (or refuse someone else) purely by opening.
 */
export function openOperational(path: string, opts: OpenOperationalOptions = {}): Db {
  // A WRITER converts the file to WAL; an instrument reads the mode and leaves
  // it, for the same reason it does not run the DDL — changing the journal mode
  // takes the write lock (`db.ts#convertToWal`).
  const db = openDb(path, { wal: opts.initialize !== false });
  const found = readSchemaVersion(db);
  if (found === String(SCHEMA_VERSION)) {
    if (opts.initialize !== false) {
      try {
        ensureCurrentTables(db);
      } catch (err) {
        db.close();
        throw err;
      }
      // A stray first-wheel core, re-filed (v11). Never a reason to refuse an
      // open: a sweep that cannot run now runs at the next one.
      try {
        refileStrayV10Cores(db);
      } catch {
        /* the next writer open sweeps again */
      }
    }
    return db;
  }
  // A store from a NEWER build must never be stamped backwards: v4 is the
  // first version doing column surgery, and "migrating" a future file would
  // mean rewriting state this build does not understand (PR-2 review nit).
  if (found !== null && Number.parseInt(found, 10) > SCHEMA_VERSION) {
    db.close();
    throw new StoreError("SCHEMA_AHEAD", { path, expected: SCHEMA_VERSION, found });
  }
  if (opts.initialize === false) {
    // A store at or above the read floor is readable as it stands (see
    // OBSERVER_READ_FLOOR); the migration waits for a writer.
    if (found !== null && Number.parseInt(found, 10) >= OBSERVER_READ_FLOOR) return db;
    db.close();
    throw new StoreError("STORE_UNINITIALIZED", {
      path,
      expected: SCHEMA_VERSION,
      found: found ?? "none",
    });
  }
  // ── THE SECOND LOCK, and it is a real one ──────────────────────────────────
  //
  // The filename door in `Store`'s constructor is the FIRST lock, and it is the
  // only one that ever fires on a store that still has its directory. This one
  // catches the store that walked past it: a v5 database wearing the v6 NAME.
  // `mv operational.sqlite counterparts.sqlite` is the first thing a person
  // tries, and with `prose/` and `versions/` moved aside too the constructor
  // sees nothing to refuse.
  //
  // Past here the old code did what it does for anything below SCHEMA_VERSION:
  // ran the DDL (`CREATE TABLE IF NOT EXISTS`, so the v5 `memories` table keeps
  // its shape and gains NO `body` column), ran `ensureAddedColumns` (a no-op,
  // the list is empty) — and then STAMPED the file v6. After that this build
  // reads no body and the old build refuses it `SCHEMA_AHEAD` for ever;
  // recovering it means hand-editing `meta` with sqlite3. Reviewer A measured
  // exactly that (`adversarial-review-f5a`, MAJOR-2), and it is the one outcome
  // this whole phase exists to prevent.
  //
  // **Keyed on the SHAPE, not on the version.** A bare `found < SCHEMA_VERSION`
  // would be wrong: a genuinely v6-shaped database whose stamp was lowered by
  // hand must still migrate forward, and three tests say so. What distinguishes
  // a pre-rows database is that `memories` has no `body` column — ask that.
  //
  // The WAL argument that put the FIRST lock on filenames does not apply here:
  // this build opened the file itself several statements ago.
  if (found !== null && Number.parseInt(found, 10) < SCHEMA_VERSION && !hasBodyColumn(db)) {
    db.close();
    throw new StoreError("STORE_PRE_ROWS", {
      path,
      found,
      expected: SCHEMA_VERSION,
      reason: "no-body-column",
      readableBy: PRE_ROWS_READABLE_BY,
    });
  }
  let note = null as MigrationNote | null;
  try {
    db.transaction(() => {
      // THE CLAIM. `transaction` is BEGIN IMMEDIATE, so this connection now holds
      // the write lock; the version is read again under it. Of several processes
      // opening an old store at once, the first through here copies and
      // migrates, and the rest find it current and do neither.
      const now = readSchemaVersion(db);
      if (now === String(SCHEMA_VERSION)) return;
      if (now !== null && Number.parseInt(now, 10) > SCHEMA_VERSION) {
        throw new StoreError("SCHEMA_AHEAD", { path, expected: SCHEMA_VERSION, found: now });
      }
      // A store with a version is about to change shape: copy it first. A
      // fresh file (no version) has nothing to lose. VACUUM INTO runs on its
      // own connection, which may read while this one holds the lock, and
      // sees the store as it stands before the DDL below.
      if (now !== null) note = copyBeforeMigrating(path, now, opts);
      for (const sql of DDL) db.exec(sql);
      ensureAddedColumns(db);
      for (const sql of DDL_AFTER_COLUMNS) db.exec(sql);
      // v7 (review S1): `lastActiveDate` was a UTC date and becomes a local
      // one. West of UTC, an evening's last boundary under the old build wrote
      // UTC's TOMORROW, and the first local date after the upgrade would read
      // as the clock going backwards. Clamped to the person's today, once, as
      // the calendar changes. At most one lived day is counted twice (the
      // evening already advanced it); decay does not notice one day.
      if (now !== null && Number.parseInt(now, 10) < 7 && opts.localToday !== undefined && opts.localToday !== "") {
        db.run(
          "UPDATE meta SET value = ? WHERE key = 'lastActiveDate' AND value > ?",
          opts.localToday,
          opts.localToday,
        );
      }
      // v8 (2026-09-26): every row the upgrade finds is LEGACY — the one-time
      // consolidation bonus path stays open for it exactly as it was, so the
      // redesign moves no memory down a band and prunes none sooner (physics
      // §5.2/§5.11). One statement; what it found is recorded for doctor, and
      // the first decay pass after it measures every row old-vs-new
      // (`sleep/decay.ts#upgradeCensus`). The counts doctor prints are of LIVE
      // memories — not chapters, schema rows, archived rows or tombstones,
      // which the flag also lands on (review of #251: 183 "memories" said for
      // 129 on the seeded demo store).
      if (now !== null && Number.parseInt(now, 10) < 8) {
        db.run("UPDATE memories SET legacy = 1");
        const counts = db.get<{ rows: number; consolidated: number; identity: number }>(
          `SELECT COUNT(*) AS rows,
                  COALESCE(SUM(consolidated), 0) AS consolidated,
                  COALESCE(SUM(promoted_identity), 0) AS identity
             FROM memories WHERE type = 'memory' AND archived = 0`,
        );
        const credited = creditLegacyReturns(db);
        const lived = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run(
          "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
          V8_UPGRADE_KEY,
          JSON.stringify({
            from: now,
            day: Number.parseInt(lived, 10) || 0,
            at: Date.now(),
            rows: counts?.rows ?? 0,
            consolidated: counts?.consolidated ?? 0,
            identity: counts?.identity ?? 0,
            legacyReturns: credited.memories,
          }),
        );
      }
      // v9 (2026-09-27): THE UPGRADE CARRIES TODAY'S RULE (working default
      // after the design review, held lightly). Until v9 "about me" was a kind
      // label — every `self` memory, and `person` memories naming the owner.
      // Those rows are marked `me` and `owner` now, `about_by = 'upgrade'`, so
      // the core candidates are the same the morning after the upgrade as the
      // night before, and doctor says so. From here the mark is set by
      // meaning: a writer's field, or the reflection — which may mark one of
      // these `work` and take it out of the candidates (removal is the safer
      // direction). Every existing feeling is given its source: `dream` for
      // the ones a dream recorded (its change log names them), `session` for
      // the rest (`store/NOTES.md` 2026-09-27).
      if (now !== null && Number.parseInt(now, 10) < 9) {
        const marked = markByOldRule(db);
        const feelings = sourceExistingFeelings(db);
        const lived = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run(
          "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
          V9_UPGRADE_KEY,
          JSON.stringify({
            from: now,
            day: Number.parseInt(lived, 10) || 0,
            at: Date.now(),
            markedMe: marked.self,
            markedOwner: marked.person,
            candidates: marked.candidates,
            feelingsDream: feelings.dream,
            feelingsSession: feelings.session,
          }),
        );
      }
      // v10 (2026-09-29): EVERY OPEN DREAM FLAG BECOMES A PAIR, unsettled,
      // carrying the latch that said it was raised awake and the habituation
      // "my mind" kept for it — so the morning after the upgrade raises and
      // weighs exactly what the night before did (`carryDreamFlags`).
      if (now !== null && Number.parseInt(now, 10) < 10) {
        const carried = carryDreamFlags(db);
        const lived = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run(
          "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
          V10_UPGRADE_KEY,
          JSON.stringify({
            from: now,
            day: Number.parseInt(lived, 10) || 0,
            at: Date.now(),
            flags: carried.flags,
            pairs: carried.pairs,
            raised: carried.raised,
            standing: carried.standing,
          }),
        );
      }
      // v11 (2026-09-30): EVERY FEELING RE-FILED ONTO THE SEVEN CORES, each
      // re-filed row keeping what the first wheel stored (`refileFeelingsV11`).
      if (now !== null && Number.parseInt(now, 10) < 11) {
        const refiled = refileFeelingsV11(db);
        const lived = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run(
          "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
          V11_UPGRADE_KEY,
          JSON.stringify({
            from: now,
            day: Number.parseInt(lived, 10) || 0,
            at: Date.now(),
            feelings: refiled.feelings,
            refiled: refiled.refiled,
            moves: refiled.moves,
          }),
        );
      }
      // v12 (2026-10-03): THE MOMENT OF THE UPGRADE, for doctor's "since
      // v12" — the writer's three fields are NULL on every row it found, and
      // the share that counts is of the rows written after it. Nothing else
      // moves; the subject links are filled after the open (no alias index here).
      if (now !== null && Number.parseInt(now, 10) < 12) {
        const lived = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        const memories = db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM memories WHERE type = 'memory' AND archived = 0",
        )?.n ?? 0;
        db.run(
          "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
          V12_UPGRADE_KEY,
          JSON.stringify({ from: now, day: Number.parseInt(lived, 10) || 0, at: Date.now(), memories }),
        );
      }
      // v13 (2026-10-10, the mechanisms review's one schema bump): every
      // feeling learns the lived day it was recorded (`backfillRecordedDays`),
      // and the moment is kept for doctor. `next_change_day` stays NULL on
      // every row, so the first turn-down after the upgrade looks at all of
      // them once — which is also the night the new curve is first read.
      if (now !== null && Number.parseInt(now, 10) < 13) {
        const backfilled = backfillRecordedDays(db);
        const lived = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run(
          "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
          V13_UPGRADE_KEY,
          JSON.stringify({ from: now, day: Number.parseInt(lived, 10) || 0, at: Date.now(), ...backfilled }),
        );
      }
      const put = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");
      put.run("livedDay", "0");
      put.run("lastActiveDate", "");
      put.run("retentionDays", String(opts.retentionDays ?? DEFAULT_RETENTION_DAYS));
      // Last, and REPLACE not IGNORE: the version row is the latch the next open
      // reads, so it must be written only after the DDL it describes has run.
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)", String(SCHEMA_VERSION));
    });
  } catch (err) {
    db.close();
    throw err;
  }
  if (note !== null) opts.onMigrated?.(note);
  return db;
}

/**
 * THE UNRELEASED-VERSION EXCEPTION to "write nothing when current" (added
 * 2026-09-27 with `traits`, a working default). A table folded into a schema
 * version no published build has yet — `traits` into v9 — is missing from a
 * development store that was stamped with that version before the table
 * existed, and the steady-state return above never runs the DDL that would
 * make it. So a WRITER open at the current version asks `sqlite_master` which
 * of the tables this build creates are absent (one read, and the common case
 * ends there), and when any is, runs the DDL — every statement is `IF NOT
 * EXISTS` — in one transaction. No copy first: nothing that exists changes
 * shape. An observer open does not write; a reader of such a table treats it
 * as empty until a writer has opened (`Store#hasTable`).
 */
export function ensureCurrentTables(db: Db): void {
  const have = new Set(
    db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger')").map((r) => r.name),
  );
  // A TRIGGER too (2026-10-10, the old-claims era's `memories_next_change_era`,
  // added after v13 was stamped on development stores): the same exception.
  const missing = [...CREATED_TABLES, ...CREATED_TRIGGERS].filter((t) => !have.has(t));
  if (missing.length === 0) return;
  db.transaction(() => {
    for (const sql of DDL) db.exec(sql);
    for (const sql of DDL_AFTER_COLUMNS) db.exec(sql);
  });
}

/**
 * Every table `DDL` creates, read off the statements themselves. Exported for
 * the test that holds it equal to what `DDL` actually creates
 * (`test/traits.test.ts`), so the pattern cannot silently miss a table.
 */
export const CREATED_TABLES: readonly string[] = DDL.flatMap((sql) => {
  const m = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql);
  return m === null ? [] : [m[1] as string];
});

/**
 * The copy before a migration, or the refusal that stops it. Throws
 * `MIGRATION_SNAPSHOT_FAILED` inside the transaction, which rolls back: the
 * store stays on `found` and the build that wrote it still opens it.
 */
function copyBeforeMigrating(path: string, found: string, opts: OpenOperationalOptions): MigrationNote {
  const dir = preMigrationDir(path, opts.snapshotsDir);
  try {
    const copy = snapshotBeforeMigration({
      dbPath: path,
      dir,
      from: found,
      to: SCHEMA_VERSION,
      ...(opts.freshMigrationCopy === true ? { reuse: false } : {}),
    });
    return { from: found, to: SCHEMA_VERSION, snapshot: copy.name, reused: copy.reused, dir: dir as string };
  } catch (err) {
    const reason = String((err as Error).message ?? err);
    throw new StoreError("MIGRATION_SNAPSHOT_FAILED", {
      path,
      found,
      expected: SCHEMA_VERSION,
      dir,
      reason,
      remedy:
        `This store is on schema v${found} and this build needs v${SCHEMA_VERSION}, but a copy of it could not ` +
        `be saved first (${reason}), so nothing was changed and the previous build still opens it; ` +
        `fix that and open it again.`,
    });
  }
}

/**
 * Indexes over columns that `ADDED_COLUMNS` may have just added, so they run
 * AFTER it: on a v6 store `event_date` does not exist while `DDL` runs.
 */
export const DDL_AFTER_COLUMNS: readonly string[] = [
  // v7: `Store.datedMemories` without a scan (prospective/INTERFACE-GAPS §2).
  // Partial, because almost no memory carries one.
  `CREATE INDEX IF NOT EXISTS memories_event_date ON memories (event_date) WHERE event_date IS NOT NULL`,
  // v13 (2026-10-10, the mechanisms review's one schema bump — additive only).
  // The nightly turn-down reads the rows whose band or reach changes today
  // (`sleep/decay.ts`, review 13 C2); the dream queue, the rows it has not
  // shown (13 C6, Group 3); the census and the dream's window, by birth (13
  // C3); the mood read, by moment (13 C4); the association sweeps (06).
  `CREATE INDEX IF NOT EXISTS memories_next_change ON memories (archived, next_change_day)`,
  `CREATE INDEX IF NOT EXISTS memories_dream_shown ON memories (archived, dream_shown_day, birth_day)`,
  `CREATE INDEX IF NOT EXISTS memories_birth ON memories (archived, birth_day)`,
  `CREATE INDEX IF NOT EXISTS feelings_created ON feelings (created_at)`,
  `CREATE INDEX IF NOT EXISTS edges_last_day ON edges (last_day)`,
  `CREATE INDEX IF NOT EXISTS edges_weight ON edges (weight)`,
  `CREATE INDEX IF NOT EXISTS edges_dst ON edges (dst)`,
  // v13: WHEN A MEMORY'S CURVE CHANGES, ITS NEXT-CHANGE DAY IS FORGOTTEN.
  // `next_change_day` is derived (`physics#nextChangeDay`): the lived day the
  // turn-down must look at the row again. Any write to an input of the curve —
  // a use, a return, a replay, a fade, a claim, a kind, a promotion, a date, a
  // repeat word in the meta — and any feeling added, changed or removed, clears
  // it to NULL ("look again"), here, so no writer can forget to. So does a
  // write to the BAND column from anywhere (U8: the decay pass is what keeps
  // the band of record true, and it can only do that for a row it reads). The
  // decay pass writes the day back after its own band writes; the day is not
  // an input, so writing it fires nothing.
  `CREATE TRIGGER IF NOT EXISTS memories_next_change_inputs
     AFTER UPDATE OF kind, novelty, relevance, emotional, predictive, claimed, uses, last_used_day,
                     consolidated, promoted_identity, legacy, returns, last_return_day, last_dream_day,
                     fade, event_date, meta, learned_on, archived, band
     ON memories
     WHEN NEW.next_change_day IS NOT NULL
   BEGIN
     UPDATE memories SET next_change_day = NULL WHERE id = NEW.id;
   END`,
  `CREATE TRIGGER IF NOT EXISTS feelings_next_change_insert AFTER INSERT ON feelings
   BEGIN
     UPDATE memories SET next_change_day = NULL WHERE id = NEW.memory_id AND next_change_day IS NOT NULL;
   END`,
  `CREATE TRIGGER IF NOT EXISTS feelings_next_change_update AFTER UPDATE OF strength, memory_id ON feelings
   BEGIN
     UPDATE memories SET next_change_day = NULL WHERE id IN (NEW.memory_id, OLD.memory_id) AND next_change_day IS NOT NULL;
   END`,
  `CREATE TRIGGER IF NOT EXISTS feelings_next_change_delete AFTER DELETE ON feelings
   BEGIN
     UPDATE memories SET next_change_day = NULL WHERE id = OLD.memory_id AND next_change_day IS NOT NULL;
   END`,
  // THE OLD-CLAIMS ERA's inputs (2026-10-10): what a memory is about, who said
  // it, its status, its protection and its moment decide whether the curve
  // reads its claim or its default (`eraClaimOf`). Its own trigger, so a store
  // already at v13 gains it at its next writable open (`ensureCurrentTables`
  // checks `CREATED_TRIGGERS`) instead of keeping the first one's column list.
  `CREATE TRIGGER IF NOT EXISTS memories_next_change_era
     AFTER UPDATE OF about, status, said_by, protected, created_at, type
     ON memories
     WHEN NEW.next_change_day IS NOT NULL
   BEGIN
     UPDATE memories SET next_change_day = NULL WHERE id = NEW.id;
   END`,
  // 2026-10-10: `Store.openThreadIds` — "Still open:" read at session start.
  // Partial, because few memories are open. It rides the v13 upgrade (no
  // bump of its own: Mike, 10-09, batch format changes); a store stamped v13
  // before it existed scans one column instead — 1.7 ms at a synthetic 9,250
  // live memories.
  `CREATE INDEX IF NOT EXISTS memories_open ON memories (birth_day) WHERE archived = 0 AND meta LIKE '%"unresolved":true%'`,
  // 2026-10-10: `Store.memoryCountsByScopeSince` — the "Today, elsewhere"
  // line's counts — reads today's rows, not the store. Rides the v13 upgrade,
  // as `memories_open` does; without it the count scans (1.8 ms at a
  // synthetic 9,250).
  `CREATE INDEX IF NOT EXISTS memories_created ON memories (created_at) WHERE created_at IS NOT NULL`,
  // 2026-10-10: the chapter walks a session start makes (the Yesterday line,
  // "Last here", "Today, elsewhere") read each fortnight episode's copies by
  // `origin_ref` (`Store#copiesOf`) — a scan of the store without this
  // (≈3 ms at a synthetic 9,250). Rides the v13 upgrade, as above.
  `CREATE INDEX IF NOT EXISTS memories_origin_ref ON memories (origin_ref) WHERE origin_ref IS NOT NULL`,
];

/** Every trigger `DDL_AFTER_COLUMNS` creates, read off the statements (`ensureCurrentTables`). */
export const CREATED_TRIGGERS: readonly string[] = DDL_AFTER_COLUMNS.flatMap((sql) => {
  const m = /CREATE TRIGGER IF NOT EXISTS (\w+)/.exec(sql);
  return m === null ? [] : [m[1] as string];
});

/**
 * Columns added to a table AFTER it first shipped. `CREATE TABLE IF NOT EXISTS`
 * cannot grow an existing table, so a pre-existing store gains these here —
 * checked against `pragma table_info` and added one `ALTER TABLE` at a time,
 * inside the migrate-at-open transaction. Idempotent by construction, and a
 * fresh CREATE must list the same columns so both paths converge (a test
 * asserts table_info equality between a fresh open and a migrated one).
 */
export const ADDED_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  // The v6 columns are NOT listed, and that is the floor's safety rule rather
  // than an accident. A pre-v6 store is refused by name before anything opens
  // it, so nothing here can reach one — and `body` added through this path to a
  // v5 store would be NULL on every row while the words sat in files this build
  // cannot see (`SCHEMA_VERSION` above, `STORE_PRE_ROWS`).
  //
  // v7 (2026-09-25): additive, nullable, no default — `ALTER TABLE ADD COLUMN`
  // cannot add NOT NULL without one, and a default would put a made-up moment
  // on every old row. Rows written before carry NULL (docs/time.md rule 6).
  // The fresh-CREATE DDL above lists the same columns in the same order, so
  // both paths converge on one `table_info`.
  { table: "memories", column: "created_at", ddl: "ALTER TABLE memories ADD COLUMN created_at INTEGER" },
  { table: "memories", column: "updated_at", ddl: "ALTER TABLE memories ADD COLUMN updated_at INTEGER" },
  { table: "memories", column: "model", ddl: "ALTER TABLE memories ADD COLUMN model TEXT" },
  { table: "memories", column: "event_date", ddl: "ALTER TABLE memories ADD COLUMN event_date TEXT" },
  { table: "versions", column: "created_at", ddl: "ALTER TABLE versions ADD COLUMN created_at INTEGER" },
  { table: "versions", column: "model", ddl: "ALTER TABLE versions ADD COLUMN model TEXT" },
  { table: "versions", column: "event_date", ddl: "ALTER TABLE versions ADD COLUMN event_date TEXT" },
  { table: "edges", column: "created_at", ddl: "ALTER TABLE edges ADD COLUMN created_at INTEGER" },
  { table: "edges", column: "updated_at", ddl: "ALTER TABLE edges ADD COLUMN updated_at INTEGER" },
  { table: "prospective", column: "created_at", ddl: "ALTER TABLE prospective ADD COLUMN created_at INTEGER" },
  { table: "prospective", column: "updated_at", ddl: "ALTER TABLE prospective ADD COLUMN updated_at INTEGER" },
  // v8 (2026-09-26, dreaming + consolidation). `legacy` marks every row the
  // upgrade found (set to 1 in the migrating transaction, below), so the old
  // consolidation bonus path stays open for exactly those; the rest are the
  // returns aggregate (`returns` table). Defaults of 0 are the pre-v8
  // arithmetic exactly: a factor of 1 on stability, no lane progress.
  { table: "memories", column: "legacy", ddl: "ALTER TABLE memories ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0" },
  { table: "memories", column: "returns", ddl: "ALTER TABLE memories ADD COLUMN returns REAL NOT NULL DEFAULT 0" },
  {
    table: "memories",
    column: "return_days",
    ddl: "ALTER TABLE memories ADD COLUMN return_days INTEGER NOT NULL DEFAULT 0",
  },
  { table: "memories", column: "first_return_day", ddl: "ALTER TABLE memories ADD COLUMN first_return_day INTEGER" },
  { table: "memories", column: "last_return_day", ddl: "ALTER TABLE memories ADD COLUMN last_return_day INTEGER" },
  { table: "memories", column: "last_dream_day", ddl: "ALTER TABLE memories ADD COLUMN last_dream_day INTEGER" },
  // v9 (2026-09-27, reflection + core by meaning): what a memory is about and
  // who said so (the upgrade fills both for the rows today's rule reads as
  // about me — below), and a feeling's source and the date it was recorded
  // after the moment, NULL for one felt at the time (every feeling written
  // before v9 was; the upgrade names each one's source).
  { table: "memories", column: "about", ddl: "ALTER TABLE memories ADD COLUMN about TEXT" },
  { table: "memories", column: "about_by", ddl: "ALTER TABLE memories ADD COLUMN about_by TEXT" },
  { table: "feelings", column: "source", ddl: "ALTER TABLE feelings ADD COLUMN source TEXT" },
  { table: "feelings", column: "recorded_later", ddl: "ALTER TABLE feelings ADD COLUMN recorded_later TEXT" },
  // v10 (2026-09-29, contradictions): a memory's FADE, the multiplier a
  // `changed` settle puts on its strength (physics §5.12). 1 on every row the
  // upgrade finds: nothing was settled before.
  { table: "memories", column: "fade", ddl: "ALTER TABLE memories ADD COLUMN fade REAL NOT NULL DEFAULT 1" },
  // v11 (2026-09-30, the feelings wheel v2): a feeling's valence as the
  // writer gave it (NULL = the word's default), and the first wheel's core and
  // emotion on a row the upgrade re-filed.
  { table: "feelings", column: "valence", ddl: "ALTER TABLE feelings ADD COLUMN valence REAL" },
  { table: "feelings", column: "core_v10", ddl: "ALTER TABLE feelings ADD COLUMN core_v10 TEXT" },
  { table: "feelings", column: "emotion_v10", ddl: "ALTER TABLE feelings ADD COLUMN emotion_v10 TEXT" },
  // v12 (2026-10-03, the write side of deliberate recall): the writer's three
  // fields, on a memory and on each archived version of its words. NULL on
  // every row the upgrade finds: nothing can fill them without a model.
  { table: "memories", column: "occurred_on", ddl: "ALTER TABLE memories ADD COLUMN occurred_on TEXT" },
  { table: "memories", column: "said_by", ddl: "ALTER TABLE memories ADD COLUMN said_by TEXT" },
  { table: "memories", column: "status", ddl: "ALTER TABLE memories ADD COLUMN status TEXT" },
  { table: "versions", column: "occurred_on", ddl: "ALTER TABLE versions ADD COLUMN occurred_on TEXT" },
  { table: "versions", column: "said_by", ddl: "ALTER TABLE versions ADD COLUMN said_by TEXT" },
  { table: "versions", column: "status", ddl: "ALTER TABLE versions ADD COLUMN status TEXT" },
  // v13 (2026-10-10, the mechanisms review's ONE schema bump, synthesis §3):
  // additive only, every column nullable or defaulted, so groups 1–4 need no
  // second bump. NULL `next_change_day` means "the turn-down looks at it on
  // its next pass" — every row the upgrade finds, once. `dream_shown_day`
  // (Group 3: the last day a standing dream SHOWED a memory; `last_dream_day`
  // is set on returns, not shows), `returns.session` (Group 3: recurrence
  // counts sessions), `edges.source` / `edges.reinforced` (Group 4) — nothing
  // writes those yet. `feelings.recorded_day` is backfilled in the migrating
  // transaction (`backfillRecordedDays`).
  { table: "memories", column: "next_change_day", ddl: "ALTER TABLE memories ADD COLUMN next_change_day INTEGER" },
  { table: "memories", column: "dream_shown_day", ddl: "ALTER TABLE memories ADD COLUMN dream_shown_day INTEGER" },
  { table: "edges", column: "source", ddl: "ALTER TABLE edges ADD COLUMN source TEXT" },
  { table: "edges", column: "reinforced", ddl: "ALTER TABLE edges ADD COLUMN reinforced INTEGER NOT NULL DEFAULT 0" },
  { table: "feelings", column: "recorded_day", ddl: "ALTER TABLE feelings ADD COLUMN recorded_day INTEGER" },
  { table: "returns", column: "session", ddl: "ALTER TABLE returns ADD COLUMN session TEXT" },
];

/**
 * THE HISTORY A LEGACY ROW ALREADY HAD, credited as returns at the v8 upgrade
 * (working default 2026-09-26, the review of #251): the old rules could carry
 * a well-used memory into the identity band; the new ones let a fact go, so
 * its durability must reflect the reinforcement it earned. Each distinct
 * reinforced day (`reinforced_days`, a count — the days themselves were never
 * kept) becomes one `returns` row of source `legacy`, placed evenly between
 * the memory's birth and its last use (the last one exactly on it) and weighed
 * by the same spacing rule as any return. `legacy` rows lengthen stability and
 * nothing else: the core lanes read awake returns only, and invented day
 * positions are not a lane's evidence. Idempotent (the rows' primary key), in
 * the migrating transaction. Returns what it credited.
 */
export function creditLegacyReturns(db: Db): { memories: number; rows: number } {
  const at = Date.now();
  const candidates = db.all<{ id: string; birth_day: number; last_used_day: number; reinforced_days: number }>(
    `SELECT id, birth_day, last_used_day, reinforced_days FROM memories
      WHERE type = 'memory' AND body != '' AND reinforced_days > 0 AND last_used_day > birth_day`,
  );
  const insert = db.prepare(
    `INSERT OR IGNORE INTO returns (memory_id, day, source, weight, gap, dream_id, at)
     VALUES (?, ?, 'legacy', ?, ?, NULL, ?)`,
  );
  let memories = 0;
  let rows = 0;
  for (const c of candidates) {
    const span = c.last_used_day - c.birth_day;
    const n = Math.min(c.reinforced_days, span);
    let prev = c.birth_day;
    let wrote = 0;
    for (let k = 1; k <= n; k += 1) {
      const day = k === n ? c.last_used_day : c.birth_day + Math.round((k * span) / n);
      if (day <= prev) continue;
      const gap = day - prev;
      insert.run(c.id, day, spacingWeight(gap), gap, at);
      prev = day;
      wrote += 1;
    }
    if (wrote > 0) {
      memories += 1;
      rows += wrote;
      db.run(
        "UPDATE memories SET returns = (SELECT COALESCE(SUM(weight), 0) FROM returns WHERE memory_id = ?) WHERE id = ?",
        c.id,
        c.id,
      );
    }
  }
  return { memories, rows };
}

/** Meta key: what the v8 upgrade found (`physics.v8.upgrade`), for doctor.
 *  `sleep/upgrade.ts` spells the same key for its census latch. */
export const V8_UPGRADE_KEY = "physics.v8.upgrade";

/** Meta key: what the v9 upgrade found (`physics.v9.upgrade`), for doctor. */
export const V9_UPGRADE_KEY = "physics.v9.upgrade";

/** Meta key: what the v10 upgrade carried (`contradictions.v10.upgrade`), for doctor. */
export const V10_UPGRADE_KEY = "contradictions.v10.upgrade";

/** Meta key: what the v11 upgrade re-filed (`feelings.v11.upgrade`), for doctor. */
export const V11_UPGRADE_KEY = "feelings.v11.upgrade";

/** Meta key: when the v12 upgrade ran (`recall.v12.upgrade`) — doctor's "since v12". */
export const V12_UPGRADE_KEY = "recall.v12.upgrade";

/** Meta key: what the v13 upgrade did (`physics.v13.upgrade`) — the mechanisms bump. */
export const V13_UPGRADE_KEY = "physics.v13.upgrade";

/**
 * THE v13 BACKFILL of `feelings.recorded_day` (2026-10-10, review 02 C5): the
 * lived day each feeling was recorded, which its softening counts from.
 *
 *   - a feeling written in a session at the time (`source` `session`, or none)
 *     was recorded on its memory's birth day — what softening read until now,
 *     so nothing about it moves;
 *   - a feeling recorded LATER (a dream, a reflection, an awake feeling-now)
 *     gets the lived day of the last logged event at or before its moment
 *     (`events.at` -> `events.day`), never before its memory's birth; with no
 *     such event, the birth day — the old reading, so the fallback moves
 *     nothing either.
 *
 * Only rows still NULL; idempotent. In the migrating transaction, after the
 * copy. Counts only come back.
 */
export function backfillRecordedDays(db: Db): { feelings: number; mapped: number } {
  const all = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM feelings WHERE recorded_day IS NULL")?.n ?? 0;
  db.run(
    `UPDATE feelings SET recorded_day = (SELECT m.birth_day FROM memories m WHERE m.id = feelings.memory_id)
      WHERE recorded_day IS NULL AND (source IS NULL OR source = 'session')`,
  );
  const later = db.all<{ id: string; created_at: number; birth_day: number | null }>(
    `SELECT f.id, f.created_at, m.birth_day FROM feelings f LEFT JOIN memories m ON m.id = f.memory_id
      WHERE f.recorded_day IS NULL`,
  );
  let mapped = 0;
  for (const f of later) {
    const birth = f.birth_day ?? 0;
    const hit = db.get<{ day: number }>("SELECT day FROM events WHERE at <= ? ORDER BY seq DESC LIMIT 1", f.created_at);
    const day = hit !== undefined && Number.isFinite(hit.day) ? Math.max(birth, hit.day) : birth;
    if (day !== birth) mapped += 1;
    db.run("UPDATE feelings SET recorded_day = ? WHERE id = ? AND recorded_day IS NULL", day, f.id);
  }
  return { feelings: all, mapped };
}

/**
 * THE v11 RE-FILING: every feeling the first wheel stored, moved onto the
 * seven cores by `feelings-wheel.ts#remapV10Feeling` (pure; the rule is
 * there). A row whose core or emotion changes keeps the old pair in
 * `core_v10` / `emotion_v10`; a row that does not change is left exactly as it
 * was. It runs once: the version latch says so, and so does its own record
 * (`V11_UPGRADE_KEY`, written beside it in the same transaction) — a second
 * call finds that and moves nothing, so a feeling written AFTER the upgrade
 * under a core the writer chose (happy, grateful) is never re-filed by the
 * first wheel's rule. In the migrating transaction, after the copy. Ids and
 * counts only come back: `moves` is `"<old> → <new>"` with how many.
 */
export function refileFeelingsV11(db: Db): { feelings: number; refiled: number; moves: Record<string, number> } {
  if (db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", V11_UPGRADE_KEY) !== undefined) {
    return { feelings: 0, refiled: 0, moves: {} };
  }
  const rows = db.all<{ id: string; core: string; emotion: string; other_word: string | null }>(
    "SELECT id, core, emotion, other_word FROM feelings WHERE core_v10 IS NULL",
  );
  const write = db.prepare("UPDATE feelings SET core = ?, emotion = ?, core_v10 = ?, emotion_v10 = ? WHERE id = ? AND core_v10 IS NULL");
  const moves: Record<string, number> = {};
  let refiled = 0;
  for (const r of rows) {
    const now = remapV10Feeling(r.core, r.emotion, r.other_word);
    if (now.core === r.core && now.emotion === r.emotion) continue;
    write.run(now.core, now.emotion, r.core, r.emotion, r.id);
    refiled += 1;
    const k = `${r.core} → ${now.core}`;
    moves[k] = (moves[k] ?? 0) + 1;
  }
  return { feelings: rows.length, refiled, moves };
}

/** The first wheel's cores that are not cores now. */
const V10_ONLY_CORES = ["fear", "anger", "surprise", "disgust"] as const;

/**
 * A STRAY FIRST-WHEEL CORE, swept at a writer's open (the review of #301, m3):
 * a row still filed under fear, anger, surprise or disgust on a v11 store —
 * nothing in this build writes one, but a raw insert or a copied row could —
 * is re-filed by the same rule as the upgrade, keeping its old pair when it
 * has none yet. One read in the steady state, and it finds nothing; a write
 * only when a row is there. Idempotent. Returns how many it moved.
 */
export function refileStrayV10Cores(db: Db): number {
  const marks = V10_ONLY_CORES.map(() => "?").join(", ");
  const rows = db.all<{ id: string; core: string; emotion: string; other_word: string | null }>(
    `SELECT id, core, emotion, other_word FROM feelings WHERE core IN (${marks})`,
    ...V10_ONLY_CORES,
  );
  if (rows.length === 0) return 0;
  return db.transaction(() => {
    let moved = 0;
    for (const r of rows) {
      const now = remapV10Feeling(r.core, r.emotion, r.other_word);
      if (now.core === r.core) continue;
      db.run(
        "UPDATE feelings SET core = ?, emotion = ?, core_v10 = COALESCE(core_v10, ?), emotion_v10 = COALESCE(emotion_v10, ?) WHERE id = ? AND core = ?",
        now.core,
        now.emotion,
        r.core,
        r.emotion,
        r.id,
        r.core,
      );
      moved += 1;
    }
    return moved;
  });
}

/**
 * THE WAY BACK from the v11 re-filing, for a person who wants the first
 * wheel's cores again: every re-filed row gets its `core_v10` / `emotion_v10`
 * back and the marks cleared. Not wired to any command — the copy taken before
 * migrating is the whole-store way back; this is the surgical one, and the
 * test that proves the re-filing loses nothing. Returns how many rows.
 *
 * PARTIAL, named (the review of #301): the store's stamp stays 11, so this
 * build still opens it and its writer-open sweep (`refileStrayV10Cores`)
 * re-files the restored rows at the next open — run it on a copy, or with the
 * build that reads v10 against the pre-migration copy instead. And a memory
 * merged by a dream after the upgrade carries copies of its feelings with no
 * `core_v10`: those stay on the seven.
 */
export function restoreFeelingsV10(db: Db): number {
  return db.transaction(() => {
    db.run(
      "UPDATE feelings SET core = core_v10, emotion = COALESCE(emotion_v10, emotion), core_v10 = NULL, emotion_v10 = NULL WHERE core_v10 IS NOT NULL",
    );
    return db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
  });
}

/** The id a carried dream flag's pair gets: the same flag, the same id, on every run. */
export function carriedPairId(dreamId: string, seq: number): string {
  return `ctr_${createHash("sha256").update(`${dreamId}.${String(seq)}`).digest("hex").slice(0, 12)}`;
}

/**
 * THE v10 CARRY: every contradiction a dream flagged that still stands (the
 * change not undone, the dream not undone, both addresses still there) becomes
 * a pair in `contradictions`, `unsettled`, `source = 'dream'`. The same two
 * memories flagged by two dreams are ONE pair (the first flag's). The latch
 * `dream.raised.<dream>.<seq>` becomes the pair's `raised_day`, and
 * `mind.seen.<dream>.<seq>` is copied to `mind.seen.<pair>`, so what was raised
 * stays raised and what habituated stays habituated. Idempotent (the pair's id
 * is derived from the flag). `standing` counts the carried pairs whose two
 * memories are both still live — the ones that will show as unsettled.
 */
export function carryDreamFlags(db: Db): { flags: number; pairs: number; raised: number; standing: number } {
  const flags = db.all<{ dream_id: string; seq: number; ref: string; ref2: string; at: number; day: number }>(
    `SELECT c.dream_id, c.seq, c.ref, c.ref2, c.at, d.day FROM dream_changes c JOIN dreams d ON d.id = c.dream_id
      WHERE c.action = 'contradiction' AND c.undone = 0 AND d.state != 'undone'
        AND c.ref IS NOT NULL AND c.ref2 IS NOT NULL AND c.ref != c.ref2
      ORDER BY d.started_at, d.rowid, c.seq`,
  );
  type Age = { birth_day: number; created_at: number | null; rid: number; archived: number; superseded_by: string | null; body: string };
  const age = db.prepare("SELECT birth_day, created_at, rowid AS rid, archived, superseded_by, body FROM memories WHERE id = ?");
  const meta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const putMeta = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");
  const insert = db.prepare(
    `INSERT OR IGNORE INTO contradictions
       (id, a, b, state, how, holds, over, via, source, dream_id, dream_seq, flagged_day, raised_day, settled_day, created_at, updated_at)
     VALUES (?, ?, ?, 'unsettled', NULL, NULL, NULL, NULL, 'dream', ?, ?, ?, ?, NULL, ?, ?)`,
  );
  // The same two memories flagged by several dreams are ONE pair, the first
  // flag's; it counts as raised when ANY of its flags was raised, and keeps the
  // first habituation found (review of #284, M6: only the first flag's latch
  // was read, so a pair raised through a later flag was raised again).
  const groups = new Map<string, typeof flags>();
  for (const f of flags) {
    const key = [f.ref, f.ref2].sort().join("|");
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [f]);
    else g.push(f);
  }
  let pairs = 0;
  let raised = 0;
  let standing = 0;
  for (const group of groups.values()) {
    const f = group[0] as (typeof flags)[number];
    const x = age.get<Age>(f.ref);
    const y = age.get<Age>(f.ref2);
    if (x === undefined || y === undefined) continue;
    const [a, b] = olderFirst({ id: f.ref, ...x }, { id: f.ref2, ...y });
    const id = carriedPairId(f.dream_id, f.seq);
    let raisedDay: number | null = null;
    let habit: string | undefined;
    for (const g of group) {
      const latch = meta.get<{ value: string }>(`dream.raised.${g.dream_id}.${String(g.seq)}`)?.value;
      if (latch !== undefined) raisedDay = Math.max(raisedDay ?? 0, Number.parseInt(latch, 10) || 0);
      if (habit === undefined) habit = meta.get<{ value: string }>(`mind.seen.${g.dream_id}.${String(g.seq)}`)?.value;
    }
    insert.run(id, a, b, f.dream_id, f.seq, f.day, raisedDay, f.at, f.at);
    pairs += 1;
    if (raisedDay !== null) raised += 1;
    if (habit !== undefined) putMeta.run(`mind.seen.${id}`, habit);
    const live = (r: Age): boolean => r.archived === 0 && r.superseded_by === null && r.body !== "";
    if (live(x) && live(y)) standing += 1;
  }
  return { flags: flags.length, pairs, raised, standing };
}

/**
 * The two memories of a pair, older first: by lived birth day, then by the
 * moment written (a pre-v7 row with none counts as earliest), then by the
 * order the rows were inserted (`rid`, when the caller read it), then by id.
 */
export function olderFirst(
  x: { id: string; birth_day: number; created_at: number | null; rid?: number },
  y: { id: string; birth_day: number; created_at: number | null; rid?: number },
): [string, string] {
  if (x.birth_day !== y.birth_day) return x.birth_day < y.birth_day ? [x.id, y.id] : [y.id, x.id];
  const xa = x.created_at ?? 0;
  const ya = y.created_at ?? 0;
  if (xa !== ya) return xa < ya ? [x.id, y.id] : [y.id, x.id];
  // Written in the same millisecond: the order they were inserted in.
  if (x.rid !== undefined && y.rid !== undefined && x.rid !== y.rid) return x.rid < y.rid ? [x.id, y.id] : [y.id, x.id];
  return x.id < y.id ? [x.id, y.id] : [y.id, x.id];
}

/**
 * THE OLD KIND RULE, CARRIED as marks at the v9 upgrade: every `self` memory
 * is marked `me`, and every `person` memory that names the owner (title,
 * body, or its `name` / `entity` meta, whole word, any case) `owner` —
 * `about_by = 'upgrade'`. Non-removed memory rows only (archived ones too, so
 * a dream undo that restores one finds it as it was). The owner's names are
 * read off the identity core, as `sleep/consolidate.ts#ownerNames` does;
 * restated here because `store/` sits below `sleep/`. `candidates` counts the
 * live, not-yet-core rows among them — the core candidates by today's rule.
 */
export function markByOldRule(db: Db): { self: number; person: number; candidates: number } {
  const owner = ownerNamesIn(db);
  const rows = "type = 'memory' AND body != '' AND about IS NULL";
  db.run(`UPDATE memories SET about = 'me', about_by = 'upgrade' WHERE ${rows} AND kind = 'self'`);
  const self = db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
  // The old rule read a `self` SCHEMA row (a belief about me, the identity
  // core) as about me too; carried the same, but for the page, which sleep
  // never lets cross whatever it is marked (`sleep/consolidate.ts#isThePage`).
  const markSchema = db.prepare("UPDATE memories SET about = 'me', about_by = 'upgrade' WHERE id = ?");
  for (const r of db.all<{ id: string; meta: string }>(
    "SELECT id, meta FROM memories WHERE type = 'schema' AND kind = 'self' AND body != '' AND about IS NULL",
  )) {
    let role: unknown;
    try {
      role = (JSON.parse(r.meta) as Record<string, unknown>)["role"];
    } catch {
      role = undefined;
    }
    if (role !== "page") markSchema.run(r.id);
  }
  let person = 0;
  if (owner.length > 0) {
    const mark = db.prepare("UPDATE memories SET about = 'owner', about_by = 'upgrade' WHERE id = ?");
    // Schema rows too (review of #256, S3): the old rule read a `person`
    // BELIEF naming the owner as about me as well, whatever its type.
    for (const r of db.all<{ id: string; type: string; title: string | null; body: string; meta: string }>(
      `SELECT id, type, title, body, meta FROM memories
        WHERE type IN ('memory', 'schema') AND body != '' AND about IS NULL AND kind = 'person'`,
    )) {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(r.meta) as Record<string, unknown>;
      } catch {
        meta = {};
      }
      const fields = [r.title ?? "", r.body, String(meta["name"] ?? ""), String(meta["entity"] ?? "")];
      if (!fields.some((f) => f.length > 0 && namesAny(f, owner))) continue;
      mark.run(r.id);
      if (r.type === "memory") person += 1;
    }
  }
  // THE CANDIDATES the old rule read, counted the way consolidation meets
  // them (review of #256, S3): every row the upgrade marked, memory or schema,
  // live and not yet core — but the page, which never crosses.
  let candidates = 0;
  for (const r of db.all<{ type: string; meta: string }>(
    `SELECT type, meta FROM memories
      WHERE about_by = 'upgrade' AND type IN ('memory', 'schema')
        AND archived = 0 AND superseded_by IS NULL AND promoted_identity = 0`,
  )) {
    if (r.type === "schema") {
      try {
        if ((JSON.parse(r.meta) as Record<string, unknown>)["role"] === "page") continue;
      } catch {
        /* unreadable meta reads as not the page, as sleep reads it */
      }
    }
    candidates += 1;
  }
  return { self, person, candidates };
}

/** The owner's names off the identity core (`role: entity`), lower-cased. */
function ownerNamesIn(db: Db): string[] {
  const owner: string[] = [];
  for (const r of db.all<{ meta: string }>("SELECT meta FROM memories WHERE type = 'schema' AND kind = 'self' AND archived = 0")) {
    try {
      const meta = JSON.parse(r.meta) as Record<string, unknown>;
      if (meta["role"] !== "entity") continue;
      const add = (v: unknown): void => {
        if (typeof v === "string" && v.trim().length >= 2) owner.push(v.trim().toLowerCase());
      };
      add(meta["name"]);
      if (Array.isArray(meta["aliases"])) for (const a of meta["aliases"]) add(a);
    } catch {
      continue;
    }
  }
  return [...new Set(owner)];
}

/** Does `text` name any of `names` as a whole word (case-insensitive)? */
function namesAny(text: string, names: readonly string[]): boolean {
  const lower = text.toLowerCase();
  for (const n of names) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(lower)) return true;
  }
  return false;
}

/**
 * EVERY FEELING WRITTEN BEFORE v9 IS GIVEN ITS SOURCE: `dream` for the ones a
 * dream's `feeling-now` recorded (its change log lists their ids), `session`
 * for the rest — the only two writers there were.
 */
export function sourceExistingFeelings(db: Db): { dream: number; session: number } {
  const dreamed = new Set<string>();
  for (const c of db.all<{ detail: string }>("SELECT detail FROM dream_changes WHERE action = 'feeling-now'")) {
    try {
      const d = JSON.parse(c.detail) as { feelings?: unknown };
      if (Array.isArray(d.feelings)) for (const id of d.feelings) if (typeof id === "string") dreamed.add(id);
    } catch {
      continue;
    }
  }
  const mark = db.prepare("UPDATE feelings SET source = 'dream' WHERE id = ? AND source IS NULL");
  let dream = 0;
  for (const id of dreamed) {
    mark.run(id);
    dream += db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
  }
  db.run("UPDATE feelings SET source = 'session' WHERE source IS NULL");
  const session = db.get<{ n: number }>("SELECT changes() AS n")?.n ?? 0;
  return { dream, session };
}

function ensureAddedColumns(db: Db): void {
  const byTable = new Map<string, Set<string>>();
  for (const spec of ADDED_COLUMNS) {
    let have = byTable.get(spec.table);
    if (have === undefined) {
      have = new Set(
        db.all<{ name: string }>(`PRAGMA table_info(${spec.table})`).map((r) => r.name),
      );
      byTable.set(spec.table, have);
    }
    if (!have.has(spec.column)) db.exec(spec.ddl);
  }
}

export function rowToSalience(row: MemoryRow): Salience {
  return {
    novelty: row.novelty,
    relevance: row.relevance,
    emotional: row.emotional,
    predictive: row.predictive,
    // The author's claimed FLOOR, kept beside the dimensions so `sal(m)` stays
    // reproducible from stored state alone (physics §5.1). Never defaulted.
    claimed: row.claimed,
  };
}

/**
 * HOW OFTEN A REMINDER DATE COMES ROUND — the meta key (`store/index.ts`
 * re-exports it; the full note is there). Spelled here so the read seam's
 * dated hold can ask it without importing the store's index.
 */
export const RECURRING_META = "recurring";

/** `self/page.ts#SELF_PAGE_ROLE`, spelled here (store imports no core module); a test holds them equal. */
export const SELF_PAGE_ROLE_SPELLED = "page";

/**
 * THE DATED HOLD of one row on calendar day `today` (2026-10-10, Group 1;
 * physics §5.4, review 07 C1/C2), or null for a memory with no reminder date:
 *
 *   - a date that REPEATS (a day `event_date` and a `recurring` word in its
 *     meta): `pending` before its first occurrence (when written before it, as
 *     any reminder) and inside each occurrence's window — `HOLD_LEAD_DAYS`
 *     before it to `HOLD_GRACE_DAYS` after; between windows, null: it fades on
 *     its curve, as the owner's 2026-10-09 design says, and each occurrence
 *     told is a use (decided by g1a-builder, 2026-10-10, lightly held; revisit
 *     after ~5 lived days. Why: ambient recall now leaves out what is below
 *     reach, and a yearly date used once a year would be below reach on the
 *     day it comes round). A daily or weekly repeat is always in a window;
 *   - a date whose last day was AFTER the day it was written (a reminder, not
 *     a note about the past): `pending` while `today` is on or before its last
 *     day plus `HOLD_GRACE_DAYS`, then null: an ordinary memory again, on its
 *     own curve from its own anchor (2026-10-11, the steeper "spent" slope cut);
 *   - anything else — no date, an unreadable one, a date that was already past
 *     when it was written (an `event_date` used as "the date it is about",
 *     before v12 split `occurred_on` off), or no calendar today: null.
 *
 * Pure: the caller hands it the row's columns and the calendar today.
 */
export function datedHold(
  row: Pick<MemoryRow, "event_date" | "learned_on" | "meta">,
  today: string | null | undefined,
): DatedHold | null {
  if (row.event_date === null || row.event_date === undefined || row.event_date === "") return null;
  if (typeof today !== "string" || !isDay(today)) return null;
  if (isDay(row.event_date) && typeof row.meta === "string" && row.meta.includes(`"${RECURRING_META}"`)) {
    let rule: unknown = null;
    try {
      rule = (JSON.parse(row.meta) as Record<string, unknown>)[RECURRING_META];
    } catch {
      /* unreadable meta: the date is once */
    }
    if (isRecurrence(rule)) {
      const anchor = row.event_date;
      const written = typeof row.learned_on === "string" ? row.learned_on.slice(0, 10) : "";
      if (daysBetween(today, anchor) > 0 && (!isDay(written) || daysBetween(written, anchor) > 0)) return { state: "pending" };
      const near = occurrenceBetween(
        anchor,
        rule,
        addDays(today, -PHYSICS_TUNABLES.HOLD_GRACE_DAYS),
        addDays(today, PHYSICS_TUNABLES.HOLD_LEAD_DAYS),
      );
      return near === null ? null : { state: "pending" };
    }
  }
  const date = parseCalendarDate(row.event_date);
  if (date === null) return null;
  const written = typeof row.learned_on === "string" ? row.learned_on.slice(0, 10) : "";
  if (isDay(written) && daysBetween(written, date.last) <= 0) return null;
  const closes = addDays(date.last, PHYSICS_TUNABLES.HOLD_GRACE_DAYS);
  return daysBetween(closes, today) <= 0 ? { state: "pending" } : null;
}

/**
 * OUTSIDE REACH ALTOGETHER (2026-10-10, Group 1, review 03 C2/C4): the rows
 * whose strength is not a working-layer question, so "below reach" never
 * applies to them — the decay pass does not rank them, ambient recall does not
 * leave them out for it, and the dashboard does not count them:
 *
 *   - a journal CHAPTER (`type = 'episode'`) and a chapter's COPY (`source =
 *     'episode'` with the chapter's id in `origin_ref`) — the journal, which
 *     recall folds into one result (U13);
 *   - a HANDOFF (a schema row whose meta says `role: handoff`) — its own
 *     lived-day expiry is its clock;
 *   - an ENTITY CARD (`role: entity`) — a name's card, a stub at salience 0 by
 *     design, faded by `schemas/`' own verdict, never by the floor;
 *   - the SELF PAGE (`role: page`, `self/page.ts#SELF_PAGE_ROLE`) — never
 *     pruned, decayed below reach, merged or deduplicated (the `self_page`
 *     tool's promise). The prune also skips it by name (`sleep/prune.ts`),
 *     beside the `protected` flag it is born with.
 *
 * Read off the row's own columns and meta; no prose read. Decided by
 * g1a-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why: each
 * is born at strength 0 by design, so a reach line would hide all of them from
 * birth — the chapter fold, the card's name — which no one decided.
 */
export function reachExempt(row: Pick<MemoryRow, "type" | "source" | "origin_ref" | "meta">): boolean {
  if (row.type === "episode") return true;
  if (row.type === "memory") return row.source === "episode" && row.origin_ref !== null && row.origin_ref.length > 0;
  if (row.type !== "schema" || typeof row.meta !== "string" || !row.meta.includes('"role"')) return false;
  try {
    const role = (JSON.parse(row.meta) as { role?: unknown } | null)?.role;
    return role === "handoff" || role === "entity" || role === SELF_PAGE_ROLE_SPELLED;
  } catch {
    return false;
  }
}

/**
 * THE OLD-CLAIMS ERA's meta keys (2026-10-10; physics §5.1, CONTRACT). Both
 * hold a moment in UTC ms, compared with a row's `created_at`:
 *
 *   - `CLAIMS_ERA_CUTOFF_KEY` — the switch the curve reads. Present: a
 *     memory written before it is read at today's default for what it is
 *     about — a default always, an explicit claim when that is lower
 *     (`eraClaimOf`). Deleted (`counterparts claims-era --off`): every
 *     claim reads as stored, exactly as before the era — the stored claim was
 *     never touched.
 *   - `CLAIMS_ERA_RECORDED_KEY` — the moment first recorded, kept so a store
 *     whose switch was turned off is not re-recorded at its next open, and so
 *     `--on` restores the same cutoff. Deleting BOTH re-records "now" at the
 *     next writable open (every memory then is old).
 *
 * Recorded ONCE, at the first writable open by a build that knows the era
 * (`Store` constructor) — on a v12 store that is the open that migrates it to
 * v13, the moment the new claim text reached its writers; on a store that was
 * already v13, its next open; on a new store, its birth (nothing is older).
 */
export const CLAIMS_ERA_CUTOFF_KEY = "claims.era.cutoff";
export const CLAIMS_ERA_RECORDED_KEY = "claims.era.recorded";
/** `mint.ts#CLAIMED_DEFAULT_META_KEY`, spelled here (store imports no core module); a test holds them equal. */
export const CLAIMED_DEFAULT_SPELLED = "claimedDefault";
/**
 * THE MOMENT THE ERA READS A ROW AS WRITTEN, when it is not the row's own
 * `created_at` (2026-10-11, the dream merge): a merged memory is a new row,
 * written after the cutoff, but its claim is its best source's stored claim,
 * so the era reads it as it read that source. UTC ms, or null for a source
 * written before v7 (no moment: old). Carried through a merge of a merge.
 * `eraCarriedFrom` writes it; `eraClaimOf` reads it in place of `created_at`.
 */
export const ERA_WRITTEN_AT_META = "eraWrittenAt";

function metaObjectOf(raw: string | null | undefined): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The moment the era compares with its cutoff: the carried one when present, else `created_at`. Null: unrecorded, old. */
function eraMomentOf(createdAt: number | null | undefined, meta: Record<string, unknown> | null): number | null {
  if (meta !== null && Object.prototype.hasOwnProperty.call(meta, ERA_WRITTEN_AT_META)) {
    const v = meta[ERA_WRITTEN_AT_META];
    if (v === null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return typeof createdAt === "number" ? createdAt : null;
}

/**
 * WHAT A ROW MADE FROM `source` CARRIES OF ITS ERA STANDING (2026-10-11, the
 * dream merge; decided by random-06, 2026-10-11, lightly held), as meta keys
 * for the new row: `claimedDefault` when the source's claim was a default (the
 * new row takes that claim, so it is still nobody's), and — when the source is
 * read as old against `cutoff` (the era's cutoff, or the moment first recorded
 * while the era is off, so `--on` reads it the same) — the source's moment
 * (`ERA_WRITTEN_AT_META`). The era then reads the new row exactly as it read
 * the source: a default at today's default, an explicit claim down to it, the
 * exempt as claimed. Nothing of the moment for a source written after the
 * cutoff. The stored claim is never touched.
 */
export function eraCarriedFrom(
  source: Pick<MemoryRow, "created_at" | "meta">,
  cutoff: string | number | null | undefined,
): Record<string, unknown> {
  const meta = metaObjectOf(source.meta);
  const out: Record<string, unknown> = {};
  if (meta !== null && meta[CLAIMED_DEFAULT_SPELLED] === true) out[CLAIMED_DEFAULT_SPELLED] = true;
  const at = typeof cutoff === "number" ? cutoff : typeof cutoff === "string" && cutoff !== "" ? Number(cutoff) : Number.NaN;
  if (!Number.isFinite(at)) return out;
  const moment = eraMomentOf(source.created_at, meta);
  if (moment === null || moment < at) out[ERA_WRITTEN_AT_META] = moment;
  return out;
}

/**
 * THE CLAIM THE CURVE READS FOR AN OLD MEMORY (2026-10-10, the old-claims era;
 * decided by Mike, 2026-10-10, loosely held; extended by Mike, 2026-10-11,
 * lightly held), or null to read the stored claim. Only when the era is on
 * (`cutoff` a moment) and the row is a `memory` written before it
 * (`created_at` earlier, or unrecorded — older than v7; a dream's merged
 * memory, its best source's moment, `ERA_WRITTEN_AT_META`, 2026-10-11) that
 * carries a claim. Then the default for what it is about TODAY (`physics#defaultClaimFor`):
 *
 *   - for a DEFAULT (`meta.claimedDefault` true: the writer claimed nothing
 *     and the seam filled in its day's default), in either direction and with
 *     no exemptions — an owner memory written at the old flat 0.25 reads 0.40,
 *     a done work event 0.20. A default was nobody's claim, so an upgrader
 *     reads what a fresh install writes. Already today's: null;
 *   - for an EXPLICIT claim, only when the default is LOWER (a scale-down
 *     only: a 0.3 world reading below its 0.35 reads as written), and never
 *     for the exempt: the core (`promoted_identity`), about the owner or us,
 *     said by the owner, `protected`, a pending date (`hold` pending: its date
 *     and grace still ahead) or a repeating date (a `recurring` rule).
 *
 * The 10-11 reading of defaults is `sleep/decay.ts#curveSignature`'s
 * `eraReads: 2`. Pure: the caller hands it the row, the cutoff and the hold it
 * computed.
 */
export function eraClaimOf(
  row: Pick<
    MemoryRow,
    "type" | "kind" | "claimed" | "created_at" | "meta" | "about" | "status" | "said_by" | "promoted_identity" | "protected" | "event_date"
  >,
  cutoff: string | number | null | undefined,
  hold: DatedHold | null,
): number | null {
  const at = typeof cutoff === "number" ? cutoff : typeof cutoff === "string" && cutoff !== "" ? Number(cutoff) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  if (row.type !== "memory" || row.claimed === null || row.claimed === undefined) return null;
  // Unreadable meta: no default mark, no carried moment, no repeat.
  const meta = metaObjectOf(row.meta);
  // A merged memory is read at its best source's moment (2026-10-11, `ERA_WRITTEN_AT_META`).
  const moment = eraMomentOf(row.created_at, meta);
  if (moment !== null && moment >= at) return null;
  const about = row.about ?? null;
  const claim = defaultClaimFor({ about, status: row.status ?? null, saidBy: row.said_by ?? null, kind: row.kind }).claim;
  // A default: today's, either way, exempt or not (2026-10-11).
  if (meta !== null && meta[CLAIMED_DEFAULT_SPELLED] === true) return claim === row.claimed ? null : claim;
  if (row.promoted_identity === 1 || row.protected === 1) return null;
  if (about === "owner" || about === "us" || (row.said_by ?? null) === "owner") return null;
  if (hold !== null && hold.state === "pending") return null;
  if (row.event_date !== null && row.event_date !== undefined && row.event_date !== "" && meta !== null && isRecurrence(meta[RECURRING_META])) {
    return null;
  }
  return claim < row.claimed ? claim : null;
}

/**
 * A row as physics reads it. `today` is the calendar day the dated hold is
 * judged on (`datedHold`); absent, the row's own `today_date` — the store's
 * `lastActiveDate`, which `Store.row()` reads beside it, so every
 * `rowToPhysics(store.row(id))` carries the hold without asking. The
 * old-claims era's cutoff rides the same way (`claims_era_cutoff`); a bare
 * `SELECT *` carries none, and reads every claim as stored.
 */
export function rowToPhysics(row: MemoryRow & FeelingPeak, today?: string | null): MemoryPhysics {
  const hold = datedHold(row, today ?? row.today_date ?? null);
  const eraClaim = eraClaimOf(row, row.claims_era_cutoff, hold);
  return {
    hold,
    ...(eraClaim === null ? {} : { eraClaim }),
    kind: row.kind,
    salience: rowToSalience(row),
    birthDay: row.birth_day,
    uses: row.uses,
    lastUsedDay: row.last_used_day,
    // Distinct lived days that credited a use — `uses` is a weighted sum and
    // cannot reconstruct it (physics §5.3/§5.5). Absent reads as 0.
    reinforcedDays: row.reinforced_days,
    // The strongest feeling recorded on it (physics §5.10), when the read
    // carried one — `Store.row()` always does.
    feelingPeak: row.feeling_peak ?? null,
    // v9: the fast lane's peak (feelings felt at the time or written in a
    // session, not a reflection's later ones). Absent on a read that did not
    // compute it — then physics falls back to `feelingPeak`.
    ...(row.feeling_peak_lived === undefined ? {} : { feelingPeakLived: row.feeling_peak_lived }),
    consolidated: row.consolidated === 1,
    // v10 (physics §5.12): the settle's multiplier. Read tolerantly — a bare row reads 1.
    fade: typeof row.fade === "number" ? row.fade : 1,
    // v8 (physics §5.2/§5.11). Read tolerantly — a bare row built by a test or
    // a tool without the columns reads as a post-upgrade memory with no returns.
    legacy: row.legacy === 1,
    returns: row.returns ?? 0,
    returnDays: row.return_days ?? 0,
    firstReturnDay: row.first_return_day ?? null,
    lastReturnDay: row.last_return_day ?? null,
    lastDreamDay: row.last_dream_day ?? null,
    promotedIdentity: row.promoted_identity === 1,
    protected: row.protected === 1,
    pressure: row.pressure,
    lastChallengedDay: row.last_challenged_day,
  };
}
