import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { remapV10Feeling } from "../feelings-wheel.js";
import { TUNABLES as PHYSICS_TUNABLES, defaultClaimFor, spacingWeight } from "../physics/index.js";
import { addDays, daysBetween, isDay, isRecurrence, occurrenceBetween, parseCalendarDate } from "../time.js";
import { openDb } from "./db.js";
import { StoreError } from "./errors.js";
import { PRE_ROWS_READABLE_BY } from "./paths.js";
import { preMigrationDir, snapshotBeforeMigration } from "./pre-migration.js";
export const SCHEMA_VERSION = 13;
export const OBSERVER_READ_FLOOR = 11;
export const DEFAULT_RETENTION_DAYS = 90;
export const CARD_TOMBSTONE_PREFIX = "removal.card.";
export function rowTombstoned(row) {
  return row.body === "" && row.content_hash === "";
}
export const DDL = [
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
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
  `CREATE TABLE IF NOT EXISTS dream_asks (
     date    TEXT PRIMARY KEY,
     state   TEXT NOT NULL,
     session TEXT,
     day     INTEGER NOT NULL,
     at      INTEGER NOT NULL
   )`,
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
  `CREATE TABLE IF NOT EXISTS derivations (
     child  TEXT NOT NULL,
     parent TEXT NOT NULL,
     how    TEXT NOT NULL,
     day    INTEGER,
     PRIMARY KEY (child, parent, how)
   )`,
  `CREATE INDEX IF NOT EXISTS derivations_parent ON derivations (parent)`,
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
  `CREATE TABLE IF NOT EXISTS removal_record (
     seq       INTEGER PRIMARY KEY AUTOINCREMENT,
     memory_id TEXT NOT NULL,
     stage     TEXT NOT NULL,
     at        INTEGER NOT NULL,
     actor     TEXT NOT NULL,
     reason    TEXT
   )`,
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
   )`
];
function hasBodyColumn(db) {
  try {
    return db.all("PRAGMA table_info(memories)").some((c) => c.name === "body");
  } catch {
    return false;
  }
}
export function isPreRowsDatabase(path) {
  let db;
  try {
    db = openDb(path, { wal: false });
    const found = readSchemaVersion(db);
    if (found === null)
      return false;
    const n = Number.parseInt(found, 10);
    return Number.isFinite(n) && n < SCHEMA_VERSION && !hasBodyColumn(db);
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
export function pendingMigration(path) {
  if (!existsSync(path))
    return null;
  let db;
  try {
    db = openDb(path, { wal: false });
    const found = readSchemaVersion(db);
    if (found === null || found === String(SCHEMA_VERSION))
      return null;
    const n = Number.parseInt(found, 10);
    if (Number.isFinite(n) && n > SCHEMA_VERSION)
      return null;
    if (!hasBodyColumn(db))
      return null;
    return { found, expected: SCHEMA_VERSION };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
function readSchemaVersion(db) {
  try {
    return db.get("SELECT value FROM meta WHERE key = 'schemaVersion'")?.value ?? null;
  } catch {
    return null;
  }
}
export function openOperational(path, opts = {}) {
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
      try {
        refileStrayV10Cores(db);
      } catch {}
    }
    return db;
  }
  if (found !== null && Number.parseInt(found, 10) > SCHEMA_VERSION) {
    db.close();
    throw new StoreError("SCHEMA_AHEAD", { path, expected: SCHEMA_VERSION, found });
  }
  if (opts.initialize === false) {
    if (found !== null && Number.parseInt(found, 10) >= OBSERVER_READ_FLOOR)
      return db;
    db.close();
    throw new StoreError("STORE_UNINITIALIZED", {
      path,
      expected: SCHEMA_VERSION,
      found: found ?? "none"
    });
  }
  if (found !== null && Number.parseInt(found, 10) < SCHEMA_VERSION && !hasBodyColumn(db)) {
    db.close();
    throw new StoreError("STORE_PRE_ROWS", {
      path,
      found,
      expected: SCHEMA_VERSION,
      reason: "no-body-column",
      readableBy: PRE_ROWS_READABLE_BY
    });
  }
  let note = null;
  try {
    db.transaction(() => {
      const now = readSchemaVersion(db);
      if (now === String(SCHEMA_VERSION))
        return;
      if (now !== null && Number.parseInt(now, 10) > SCHEMA_VERSION) {
        throw new StoreError("SCHEMA_AHEAD", { path, expected: SCHEMA_VERSION, found: now });
      }
      if (now !== null)
        note = copyBeforeMigrating(path, now, opts);
      for (const sql of DDL)
        db.exec(sql);
      ensureAddedColumns(db);
      for (const sql of DDL_AFTER_COLUMNS)
        db.exec(sql);
      if (now !== null && Number.parseInt(now, 10) < 7 && opts.localToday !== undefined && opts.localToday !== "") {
        db.run("UPDATE meta SET value = ? WHERE key = 'lastActiveDate' AND value > ?", opts.localToday, opts.localToday);
      }
      if (now !== null && Number.parseInt(now, 10) < 8) {
        db.run("UPDATE memories SET legacy = 1");
        const counts = db.get(`SELECT COUNT(*) AS rows,
                  COALESCE(SUM(consolidated), 0) AS consolidated,
                  COALESCE(SUM(promoted_identity), 0) AS identity
             FROM memories WHERE type = 'memory' AND archived = 0`);
        const credited = creditLegacyReturns(db);
        const lived = db.get("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", V8_UPGRADE_KEY, JSON.stringify({
          from: now,
          day: Number.parseInt(lived, 10) || 0,
          at: Date.now(),
          rows: counts?.rows ?? 0,
          consolidated: counts?.consolidated ?? 0,
          identity: counts?.identity ?? 0,
          legacyReturns: credited.memories
        }));
      }
      if (now !== null && Number.parseInt(now, 10) < 9) {
        const marked = markByOldRule(db);
        const feelings = sourceExistingFeelings(db);
        const lived = db.get("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", V9_UPGRADE_KEY, JSON.stringify({
          from: now,
          day: Number.parseInt(lived, 10) || 0,
          at: Date.now(),
          markedMe: marked.self,
          markedOwner: marked.person,
          candidates: marked.candidates,
          feelingsDream: feelings.dream,
          feelingsSession: feelings.session
        }));
      }
      if (now !== null && Number.parseInt(now, 10) < 10) {
        const carried = carryDreamFlags(db);
        const lived = db.get("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", V10_UPGRADE_KEY, JSON.stringify({
          from: now,
          day: Number.parseInt(lived, 10) || 0,
          at: Date.now(),
          flags: carried.flags,
          pairs: carried.pairs,
          raised: carried.raised,
          standing: carried.standing
        }));
      }
      if (now !== null && Number.parseInt(now, 10) < 11) {
        const refiled = refileFeelingsV11(db);
        const lived = db.get("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", V11_UPGRADE_KEY, JSON.stringify({
          from: now,
          day: Number.parseInt(lived, 10) || 0,
          at: Date.now(),
          feelings: refiled.feelings,
          refiled: refiled.refiled,
          moves: refiled.moves
        }));
      }
      if (now !== null && Number.parseInt(now, 10) < 12) {
        const lived = db.get("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        const memories = db.get("SELECT COUNT(*) AS n FROM memories WHERE type = 'memory' AND archived = 0")?.n ?? 0;
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", V12_UPGRADE_KEY, JSON.stringify({ from: now, day: Number.parseInt(lived, 10) || 0, at: Date.now(), memories }));
      }
      if (now !== null && Number.parseInt(now, 10) < 13) {
        const backfilled = backfillRecordedDays(db);
        const lived = db.get("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0";
        db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", V13_UPGRADE_KEY, JSON.stringify({ from: now, day: Number.parseInt(lived, 10) || 0, at: Date.now(), ...backfilled }));
      }
      const put = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");
      put.run("livedDay", "0");
      put.run("lastActiveDate", "");
      put.run("retentionDays", String(opts.retentionDays ?? DEFAULT_RETENTION_DAYS));
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)", String(SCHEMA_VERSION));
    });
  } catch (err) {
    db.close();
    throw err;
  }
  if (note !== null)
    opts.onMigrated?.(note);
  return db;
}
export function ensureCurrentTables(db) {
  const have = new Set(db.all("SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger')").map((r) => r.name));
  const missing = [...CREATED_TABLES, ...CREATED_TRIGGERS].filter((t) => !have.has(t));
  if (missing.length === 0)
    return;
  db.transaction(() => {
    for (const sql of DDL)
      db.exec(sql);
    for (const sql of DDL_AFTER_COLUMNS)
      db.exec(sql);
  });
}
export const CREATED_TABLES = DDL.flatMap((sql) => {
  const m = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql);
  return m === null ? [] : [m[1]];
});
function copyBeforeMigrating(path, found, opts) {
  const dir = preMigrationDir(path, opts.snapshotsDir);
  try {
    const copy = snapshotBeforeMigration({
      dbPath: path,
      dir,
      from: found,
      to: SCHEMA_VERSION,
      ...opts.freshMigrationCopy === true ? { reuse: false } : {}
    });
    return { from: found, to: SCHEMA_VERSION, snapshot: copy.name, reused: copy.reused, dir };
  } catch (err) {
    const reason = String(err.message ?? err);
    throw new StoreError("MIGRATION_SNAPSHOT_FAILED", {
      path,
      found,
      expected: SCHEMA_VERSION,
      dir,
      reason,
      remedy: `This store is on schema v${found} and this build needs v${SCHEMA_VERSION}, but a copy of it could not ` + `be saved first (${reason}), so nothing was changed and the previous build still opens it; ` + `fix that and open it again.`
    });
  }
}
export const DDL_AFTER_COLUMNS = [
  `CREATE INDEX IF NOT EXISTS memories_event_date ON memories (event_date) WHERE event_date IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS memories_next_change ON memories (archived, next_change_day)`,
  `CREATE INDEX IF NOT EXISTS memories_dream_shown ON memories (archived, dream_shown_day, birth_day)`,
  `CREATE INDEX IF NOT EXISTS memories_birth ON memories (archived, birth_day)`,
  `CREATE INDEX IF NOT EXISTS feelings_created ON feelings (created_at)`,
  `CREATE INDEX IF NOT EXISTS edges_last_day ON edges (last_day)`,
  `CREATE INDEX IF NOT EXISTS edges_weight ON edges (weight)`,
  `CREATE INDEX IF NOT EXISTS edges_dst ON edges (dst)`,
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
  `CREATE TRIGGER IF NOT EXISTS memories_next_change_era
     AFTER UPDATE OF about, status, said_by, protected, created_at, type
     ON memories
     WHEN NEW.next_change_day IS NOT NULL
   BEGIN
     UPDATE memories SET next_change_day = NULL WHERE id = NEW.id;
   END`,
  `CREATE INDEX IF NOT EXISTS memories_open ON memories (birth_day) WHERE archived = 0 AND meta LIKE '%"unresolved":true%'`,
  `CREATE INDEX IF NOT EXISTS memories_created ON memories (created_at) WHERE created_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS memories_origin_ref ON memories (origin_ref) WHERE origin_ref IS NOT NULL`
];
export const CREATED_TRIGGERS = DDL_AFTER_COLUMNS.flatMap((sql) => {
  const m = /CREATE TRIGGER IF NOT EXISTS (\w+)/.exec(sql);
  return m === null ? [] : [m[1]];
});
export const ADDED_COLUMNS = [
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
  { table: "memories", column: "legacy", ddl: "ALTER TABLE memories ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0" },
  { table: "memories", column: "returns", ddl: "ALTER TABLE memories ADD COLUMN returns REAL NOT NULL DEFAULT 0" },
  {
    table: "memories",
    column: "return_days",
    ddl: "ALTER TABLE memories ADD COLUMN return_days INTEGER NOT NULL DEFAULT 0"
  },
  { table: "memories", column: "first_return_day", ddl: "ALTER TABLE memories ADD COLUMN first_return_day INTEGER" },
  { table: "memories", column: "last_return_day", ddl: "ALTER TABLE memories ADD COLUMN last_return_day INTEGER" },
  { table: "memories", column: "last_dream_day", ddl: "ALTER TABLE memories ADD COLUMN last_dream_day INTEGER" },
  { table: "memories", column: "about", ddl: "ALTER TABLE memories ADD COLUMN about TEXT" },
  { table: "memories", column: "about_by", ddl: "ALTER TABLE memories ADD COLUMN about_by TEXT" },
  { table: "feelings", column: "source", ddl: "ALTER TABLE feelings ADD COLUMN source TEXT" },
  { table: "feelings", column: "recorded_later", ddl: "ALTER TABLE feelings ADD COLUMN recorded_later TEXT" },
  { table: "memories", column: "fade", ddl: "ALTER TABLE memories ADD COLUMN fade REAL NOT NULL DEFAULT 1" },
  { table: "feelings", column: "valence", ddl: "ALTER TABLE feelings ADD COLUMN valence REAL" },
  { table: "feelings", column: "core_v10", ddl: "ALTER TABLE feelings ADD COLUMN core_v10 TEXT" },
  { table: "feelings", column: "emotion_v10", ddl: "ALTER TABLE feelings ADD COLUMN emotion_v10 TEXT" },
  { table: "memories", column: "occurred_on", ddl: "ALTER TABLE memories ADD COLUMN occurred_on TEXT" },
  { table: "memories", column: "said_by", ddl: "ALTER TABLE memories ADD COLUMN said_by TEXT" },
  { table: "memories", column: "status", ddl: "ALTER TABLE memories ADD COLUMN status TEXT" },
  { table: "versions", column: "occurred_on", ddl: "ALTER TABLE versions ADD COLUMN occurred_on TEXT" },
  { table: "versions", column: "said_by", ddl: "ALTER TABLE versions ADD COLUMN said_by TEXT" },
  { table: "versions", column: "status", ddl: "ALTER TABLE versions ADD COLUMN status TEXT" },
  { table: "memories", column: "next_change_day", ddl: "ALTER TABLE memories ADD COLUMN next_change_day INTEGER" },
  { table: "memories", column: "dream_shown_day", ddl: "ALTER TABLE memories ADD COLUMN dream_shown_day INTEGER" },
  { table: "edges", column: "source", ddl: "ALTER TABLE edges ADD COLUMN source TEXT" },
  { table: "edges", column: "reinforced", ddl: "ALTER TABLE edges ADD COLUMN reinforced INTEGER NOT NULL DEFAULT 0" },
  { table: "feelings", column: "recorded_day", ddl: "ALTER TABLE feelings ADD COLUMN recorded_day INTEGER" },
  { table: "returns", column: "session", ddl: "ALTER TABLE returns ADD COLUMN session TEXT" }
];
export function creditLegacyReturns(db) {
  const at = Date.now();
  const candidates = db.all(`SELECT id, birth_day, last_used_day, reinforced_days FROM memories
      WHERE type = 'memory' AND body != '' AND reinforced_days > 0 AND last_used_day > birth_day`);
  const insert = db.prepare(`INSERT OR IGNORE INTO returns (memory_id, day, source, weight, gap, dream_id, at)
     VALUES (?, ?, 'legacy', ?, ?, NULL, ?)`);
  let memories = 0;
  let rows = 0;
  for (const c of candidates) {
    const span = c.last_used_day - c.birth_day;
    const n = Math.min(c.reinforced_days, span);
    let prev = c.birth_day;
    let wrote = 0;
    for (let k = 1;k <= n; k += 1) {
      const day = k === n ? c.last_used_day : c.birth_day + Math.round(k * span / n);
      if (day <= prev)
        continue;
      const gap = day - prev;
      insert.run(c.id, day, spacingWeight(gap), gap, at);
      prev = day;
      wrote += 1;
    }
    if (wrote > 0) {
      memories += 1;
      rows += wrote;
      db.run("UPDATE memories SET returns = (SELECT COALESCE(SUM(weight), 0) FROM returns WHERE memory_id = ?) WHERE id = ?", c.id, c.id);
    }
  }
  return { memories, rows };
}
export const V8_UPGRADE_KEY = "physics.v8.upgrade";
export const V9_UPGRADE_KEY = "physics.v9.upgrade";
export const V10_UPGRADE_KEY = "contradictions.v10.upgrade";
export const V11_UPGRADE_KEY = "feelings.v11.upgrade";
export const V12_UPGRADE_KEY = "recall.v12.upgrade";
export const V13_UPGRADE_KEY = "physics.v13.upgrade";
export function backfillRecordedDays(db) {
  const all = db.get("SELECT COUNT(*) AS n FROM feelings WHERE recorded_day IS NULL")?.n ?? 0;
  db.run(`UPDATE feelings SET recorded_day = (SELECT m.birth_day FROM memories m WHERE m.id = feelings.memory_id)
      WHERE recorded_day IS NULL AND (source IS NULL OR source = 'session')`);
  const later = db.all(`SELECT f.id, f.created_at, m.birth_day FROM feelings f LEFT JOIN memories m ON m.id = f.memory_id
      WHERE f.recorded_day IS NULL`);
  let mapped = 0;
  for (const f of later) {
    const birth = f.birth_day ?? 0;
    const hit = db.get("SELECT day FROM events WHERE at <= ? ORDER BY seq DESC LIMIT 1", f.created_at);
    const day = hit !== undefined && Number.isFinite(hit.day) ? Math.max(birth, hit.day) : birth;
    if (day !== birth)
      mapped += 1;
    db.run("UPDATE feelings SET recorded_day = ? WHERE id = ? AND recorded_day IS NULL", day, f.id);
  }
  return { feelings: all, mapped };
}
export function refileFeelingsV11(db) {
  if (db.get("SELECT value FROM meta WHERE key = ?", V11_UPGRADE_KEY) !== undefined) {
    return { feelings: 0, refiled: 0, moves: {} };
  }
  const rows = db.all("SELECT id, core, emotion, other_word FROM feelings WHERE core_v10 IS NULL");
  const write = db.prepare("UPDATE feelings SET core = ?, emotion = ?, core_v10 = ?, emotion_v10 = ? WHERE id = ? AND core_v10 IS NULL");
  const moves = {};
  let refiled = 0;
  for (const r of rows) {
    const now = remapV10Feeling(r.core, r.emotion, r.other_word);
    if (now.core === r.core && now.emotion === r.emotion)
      continue;
    write.run(now.core, now.emotion, r.core, r.emotion, r.id);
    refiled += 1;
    const k = `${r.core} → ${now.core}`;
    moves[k] = (moves[k] ?? 0) + 1;
  }
  return { feelings: rows.length, refiled, moves };
}
const V10_ONLY_CORES = ["fear", "anger", "surprise", "disgust"];
export function refileStrayV10Cores(db) {
  const marks = V10_ONLY_CORES.map(() => "?").join(", ");
  const rows = db.all(`SELECT id, core, emotion, other_word FROM feelings WHERE core IN (${marks})`, ...V10_ONLY_CORES);
  if (rows.length === 0)
    return 0;
  return db.transaction(() => {
    let moved = 0;
    for (const r of rows) {
      const now = remapV10Feeling(r.core, r.emotion, r.other_word);
      if (now.core === r.core)
        continue;
      db.run("UPDATE feelings SET core = ?, emotion = ?, core_v10 = COALESCE(core_v10, ?), emotion_v10 = COALESCE(emotion_v10, ?) WHERE id = ? AND core = ?", now.core, now.emotion, r.core, r.emotion, r.id, r.core);
      moved += 1;
    }
    return moved;
  });
}
export function restoreFeelingsV10(db) {
  return db.transaction(() => {
    db.run("UPDATE feelings SET core = core_v10, emotion = COALESCE(emotion_v10, emotion), core_v10 = NULL, emotion_v10 = NULL WHERE core_v10 IS NOT NULL");
    return db.get("SELECT changes() AS n")?.n ?? 0;
  });
}
export function carriedPairId(dreamId, seq) {
  return `ctr_${createHash("sha256").update(`${dreamId}.${String(seq)}`).digest("hex").slice(0, 12)}`;
}
export function carryDreamFlags(db) {
  const flags = db.all(`SELECT c.dream_id, c.seq, c.ref, c.ref2, c.at, d.day FROM dream_changes c JOIN dreams d ON d.id = c.dream_id
      WHERE c.action = 'contradiction' AND c.undone = 0 AND d.state != 'undone'
        AND c.ref IS NOT NULL AND c.ref2 IS NOT NULL AND c.ref != c.ref2
      ORDER BY d.started_at, d.rowid, c.seq`);
  const age = db.prepare("SELECT birth_day, created_at, rowid AS rid, archived, superseded_by, body FROM memories WHERE id = ?");
  const meta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const putMeta = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");
  const insert = db.prepare(`INSERT OR IGNORE INTO contradictions
       (id, a, b, state, how, holds, over, via, source, dream_id, dream_seq, flagged_day, raised_day, settled_day, created_at, updated_at)
     VALUES (?, ?, ?, 'unsettled', NULL, NULL, NULL, NULL, 'dream', ?, ?, ?, ?, NULL, ?, ?)`);
  const groups = new Map;
  for (const f of flags) {
    const key = [f.ref, f.ref2].sort().join("|");
    const g = groups.get(key);
    if (g === undefined)
      groups.set(key, [f]);
    else
      g.push(f);
  }
  let pairs = 0;
  let raised = 0;
  let standing = 0;
  for (const group of groups.values()) {
    const f = group[0];
    const x = age.get(f.ref);
    const y = age.get(f.ref2);
    if (x === undefined || y === undefined)
      continue;
    const [a, b] = olderFirst({ id: f.ref, ...x }, { id: f.ref2, ...y });
    const id = carriedPairId(f.dream_id, f.seq);
    let raisedDay = null;
    let habit;
    for (const g of group) {
      const latch = meta.get(`dream.raised.${g.dream_id}.${String(g.seq)}`)?.value;
      if (latch !== undefined)
        raisedDay = Math.max(raisedDay ?? 0, Number.parseInt(latch, 10) || 0);
      if (habit === undefined)
        habit = meta.get(`mind.seen.${g.dream_id}.${String(g.seq)}`)?.value;
    }
    insert.run(id, a, b, f.dream_id, f.seq, f.day, raisedDay, f.at, f.at);
    pairs += 1;
    if (raisedDay !== null)
      raised += 1;
    if (habit !== undefined)
      putMeta.run(`mind.seen.${id}`, habit);
    const live = (r) => r.archived === 0 && r.superseded_by === null && r.body !== "";
    if (live(x) && live(y))
      standing += 1;
  }
  return { flags: flags.length, pairs, raised, standing };
}
export function olderFirst(x, y) {
  if (x.birth_day !== y.birth_day)
    return x.birth_day < y.birth_day ? [x.id, y.id] : [y.id, x.id];
  const xa = x.created_at ?? 0;
  const ya = y.created_at ?? 0;
  if (xa !== ya)
    return xa < ya ? [x.id, y.id] : [y.id, x.id];
  if (x.rid !== undefined && y.rid !== undefined && x.rid !== y.rid)
    return x.rid < y.rid ? [x.id, y.id] : [y.id, x.id];
  return x.id < y.id ? [x.id, y.id] : [y.id, x.id];
}
export function markByOldRule(db) {
  const owner = ownerNamesIn(db);
  const rows = "type = 'memory' AND body != '' AND about IS NULL";
  db.run(`UPDATE memories SET about = 'me', about_by = 'upgrade' WHERE ${rows} AND kind = 'self'`);
  const self = db.get("SELECT changes() AS n")?.n ?? 0;
  const markSchema = db.prepare("UPDATE memories SET about = 'me', about_by = 'upgrade' WHERE id = ?");
  for (const r of db.all("SELECT id, meta FROM memories WHERE type = 'schema' AND kind = 'self' AND body != '' AND about IS NULL")) {
    let role;
    try {
      role = JSON.parse(r.meta)["role"];
    } catch {
      role = undefined;
    }
    if (role !== "page")
      markSchema.run(r.id);
  }
  let person = 0;
  if (owner.length > 0) {
    const mark = db.prepare("UPDATE memories SET about = 'owner', about_by = 'upgrade' WHERE id = ?");
    for (const r of db.all(`SELECT id, type, title, body, meta FROM memories
        WHERE type IN ('memory', 'schema') AND body != '' AND about IS NULL AND kind = 'person'`)) {
      let meta = {};
      try {
        meta = JSON.parse(r.meta);
      } catch {
        meta = {};
      }
      const fields = [r.title ?? "", r.body, String(meta["name"] ?? ""), String(meta["entity"] ?? "")];
      if (!fields.some((f) => f.length > 0 && namesAny(f, owner)))
        continue;
      mark.run(r.id);
      if (r.type === "memory")
        person += 1;
    }
  }
  let candidates = 0;
  for (const r of db.all(`SELECT type, meta FROM memories
      WHERE about_by = 'upgrade' AND type IN ('memory', 'schema')
        AND archived = 0 AND superseded_by IS NULL AND promoted_identity = 0`)) {
    if (r.type === "schema") {
      try {
        if (JSON.parse(r.meta)["role"] === "page")
          continue;
      } catch {}
    }
    candidates += 1;
  }
  return { self, person, candidates };
}
function ownerNamesIn(db) {
  const owner = [];
  for (const r of db.all("SELECT meta FROM memories WHERE type = 'schema' AND kind = 'self' AND archived = 0")) {
    try {
      const meta = JSON.parse(r.meta);
      if (meta["role"] !== "entity")
        continue;
      const add = (v) => {
        if (typeof v === "string" && v.trim().length >= 2)
          owner.push(v.trim().toLowerCase());
      };
      add(meta["name"]);
      if (Array.isArray(meta["aliases"]))
        for (const a of meta["aliases"])
          add(a);
    } catch {
      continue;
    }
  }
  return [...new Set(owner)];
}
function namesAny(text, names) {
  const lower = text.toLowerCase();
  for (const n of names) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(lower))
      return true;
  }
  return false;
}
export function sourceExistingFeelings(db) {
  const dreamed = new Set;
  for (const c of db.all("SELECT detail FROM dream_changes WHERE action = 'feeling-now'")) {
    try {
      const d = JSON.parse(c.detail);
      if (Array.isArray(d.feelings)) {
        for (const id of d.feelings)
          if (typeof id === "string")
            dreamed.add(id);
      }
    } catch {
      continue;
    }
  }
  const mark = db.prepare("UPDATE feelings SET source = 'dream' WHERE id = ? AND source IS NULL");
  let dream = 0;
  for (const id of dreamed) {
    mark.run(id);
    dream += db.get("SELECT changes() AS n")?.n ?? 0;
  }
  db.run("UPDATE feelings SET source = 'session' WHERE source IS NULL");
  const session = db.get("SELECT changes() AS n")?.n ?? 0;
  return { dream, session };
}
function ensureAddedColumns(db) {
  const byTable = new Map;
  for (const spec of ADDED_COLUMNS) {
    let have = byTable.get(spec.table);
    if (have === undefined) {
      have = new Set(db.all(`PRAGMA table_info(${spec.table})`).map((r) => r.name));
      byTable.set(spec.table, have);
    }
    if (!have.has(spec.column))
      db.exec(spec.ddl);
  }
}
export function rowToSalience(row) {
  return {
    novelty: row.novelty,
    relevance: row.relevance,
    emotional: row.emotional,
    predictive: row.predictive,
    claimed: row.claimed
  };
}
export const RECURRING_META = "recurring";
export const SELF_PAGE_ROLE_SPELLED = "page";
export function datedHold(row, today) {
  if (row.event_date === null || row.event_date === undefined || row.event_date === "")
    return null;
  if (typeof today !== "string" || !isDay(today))
    return null;
  if (isDay(row.event_date) && typeof row.meta === "string" && row.meta.includes(`"${RECURRING_META}"`)) {
    let rule = null;
    try {
      rule = JSON.parse(row.meta)[RECURRING_META];
    } catch {}
    if (isRecurrence(rule)) {
      const anchor = row.event_date;
      const written = typeof row.learned_on === "string" ? row.learned_on.slice(0, 10) : "";
      if (daysBetween(today, anchor) > 0 && (!isDay(written) || daysBetween(written, anchor) > 0))
        return { state: "pending" };
      const near = occurrenceBetween(anchor, rule, addDays(today, -PHYSICS_TUNABLES.HOLD_GRACE_DAYS), addDays(today, PHYSICS_TUNABLES.HOLD_LEAD_DAYS));
      return near === null ? null : { state: "pending" };
    }
  }
  const date = parseCalendarDate(row.event_date);
  if (date === null)
    return null;
  const written = typeof row.learned_on === "string" ? row.learned_on.slice(0, 10) : "";
  if (isDay(written) && daysBetween(written, date.last) <= 0)
    return null;
  const closes = addDays(date.last, PHYSICS_TUNABLES.HOLD_GRACE_DAYS);
  return daysBetween(closes, today) <= 0 ? { state: "pending" } : null;
}
export function reachExempt(row) {
  if (row.type === "episode")
    return true;
  if (row.type === "memory")
    return row.source === "episode" && row.origin_ref !== null && row.origin_ref.length > 0;
  if (row.type !== "schema" || typeof row.meta !== "string" || !row.meta.includes('"role"'))
    return false;
  try {
    const role = JSON.parse(row.meta)?.role;
    return role === "handoff" || role === "entity" || role === SELF_PAGE_ROLE_SPELLED;
  } catch {
    return false;
  }
}
export const CLAIMS_ERA_CUTOFF_KEY = "claims.era.cutoff";
export const CLAIMS_ERA_RECORDED_KEY = "claims.era.recorded";
export const CLAIMED_DEFAULT_SPELLED = "claimedDefault";
export const ERA_WRITTEN_AT_META = "eraWrittenAt";
function metaObjectOf(raw) {
  if (typeof raw !== "string" || raw.length === 0)
    return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function eraMomentOf(createdAt, meta) {
  if (meta !== null && Object.prototype.hasOwnProperty.call(meta, ERA_WRITTEN_AT_META)) {
    const v = meta[ERA_WRITTEN_AT_META];
    if (v === null)
      return null;
    if (typeof v === "number" && Number.isFinite(v))
      return v;
  }
  return typeof createdAt === "number" ? createdAt : null;
}
export function eraCarriedFrom(source, cutoff) {
  const meta = metaObjectOf(source.meta);
  const out = {};
  if (meta !== null && meta[CLAIMED_DEFAULT_SPELLED] === true)
    out[CLAIMED_DEFAULT_SPELLED] = true;
  const at = typeof cutoff === "number" ? cutoff : typeof cutoff === "string" && cutoff !== "" ? Number(cutoff) : Number.NaN;
  if (!Number.isFinite(at))
    return out;
  const moment = eraMomentOf(source.created_at, meta);
  if (moment === null || moment < at)
    out[ERA_WRITTEN_AT_META] = moment;
  return out;
}
export function eraClaimOf(row, cutoff, hold) {
  const at = typeof cutoff === "number" ? cutoff : typeof cutoff === "string" && cutoff !== "" ? Number(cutoff) : Number.NaN;
  if (!Number.isFinite(at))
    return null;
  if (row.type !== "memory" || row.claimed === null || row.claimed === undefined)
    return null;
  const meta = metaObjectOf(row.meta);
  const moment = eraMomentOf(row.created_at, meta);
  if (moment !== null && moment >= at)
    return null;
  const about = row.about ?? null;
  const claim = defaultClaimFor({ about, status: row.status ?? null, saidBy: row.said_by ?? null, kind: row.kind }).claim;
  if (meta !== null && meta[CLAIMED_DEFAULT_SPELLED] === true)
    return claim === row.claimed ? null : claim;
  if (row.promoted_identity === 1 || row.protected === 1)
    return null;
  if (about === "owner" || about === "us" || (row.said_by ?? null) === "owner")
    return null;
  if (hold !== null && hold.state === "pending")
    return null;
  if (row.event_date !== null && row.event_date !== undefined && row.event_date !== "" && meta !== null && isRecurrence(meta[RECURRING_META])) {
    return null;
  }
  return claim < row.claimed ? claim : null;
}
export function rowToPhysics(row, today) {
  const hold = datedHold(row, today ?? row.today_date ?? null);
  const eraClaim = eraClaimOf(row, row.claims_era_cutoff, hold);
  return {
    hold,
    ...eraClaim === null ? {} : { eraClaim },
    kind: row.kind,
    salience: rowToSalience(row),
    birthDay: row.birth_day,
    uses: row.uses,
    lastUsedDay: row.last_used_day,
    reinforcedDays: row.reinforced_days,
    feelingPeak: row.feeling_peak ?? null,
    ...row.feeling_peak_lived === undefined ? {} : { feelingPeakLived: row.feeling_peak_lived },
    consolidated: row.consolidated === 1,
    fade: typeof row.fade === "number" ? row.fade : 1,
    legacy: row.legacy === 1,
    returns: row.returns ?? 0,
    returnDays: row.return_days ?? 0,
    firstReturnDay: row.first_return_day ?? null,
    lastReturnDay: row.last_return_day ?? null,
    lastDreamDay: row.last_dream_day ?? null,
    promotedIdentity: row.promoted_identity === 1,
    protected: row.protected === 1,
    pressure: row.pressure,
    lastChallengedDay: row.last_challenged_day
  };
}
