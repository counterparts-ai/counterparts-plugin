/**
 * The runtime adapter: `bun:sqlite` under Bun, `node:sqlite` under Node.
 *
 * Deliberately the smallest interface the store needs — exec / prepare / run /
 * get / all / transaction / close. Both drivers accept positional `?` parameters
 * and return plain row objects, so only construction actually differs.
 *
 * Booleans and `undefined` are normalized here: node:sqlite rejects both, bun:sqlite
 * accepts them. Normalizing at the seam keeps the two runtimes behaviorally identical.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { StoreError } from "./errors.js";

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParam = SqlValue | boolean | undefined;
export type Row = Record<string, SqlValue>;

export interface Statement {
  run(...params: SqlParam[]): void;
  get<T = Row>(...params: SqlParam[]): T | undefined;
  all<T = Row>(...params: SqlParam[]): T[];
}

export interface Db {
  readonly path: string;
  readonly driver: "bun:sqlite" | "node:sqlite";
  exec(sql: string): void;
  prepare(sql: string): Statement;
  run(sql: string, ...params: SqlParam[]): void;
  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined;
  all<T = Row>(sql: string, ...params: SqlParam[]): T[];
  /** BEGIN/COMMIT at depth 0, SAVEPOINT/RELEASE when nested. Throws ⇒ rolls back. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

interface RawStatement {
  run(...p: SqlValue[]): unknown;
  get(...p: SqlValue[]): unknown;
  all(...p: SqlValue[]): unknown;
}
interface RawDb {
  exec(sql: string): unknown;
  prepare(sql: string): RawStatement;
  close(): unknown;
}

const require_ = createRequire(import.meta.url);

export function runtimeIsBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

function openRaw(path: string): { raw: RawDb; driver: Db["driver"] } {
  if (runtimeIsBun()) {
    try {
      const { Database } = require_("bun:sqlite") as {
        Database: new (p: string, o?: unknown) => RawDb;
      };
      return { raw: new Database(path, { create: true }), driver: "bun:sqlite" };
    } catch (cause) {
      throw new StoreError("SQLITE_UNAVAILABLE", {
        driver: "bun:sqlite",
        reason: String((cause as Error).message ?? cause),
      });
    }
  }
  try {
    const { DatabaseSync } = nodeSqlite();
    return { raw: new DatabaseSync(path), driver: "node:sqlite" };
  } catch (cause) {
    // node:sqlite is unflagged from 22.13 / 23.4; the package runs under Node from
    // 22.15 (`adapters/node-hooks.mjs` needs `module.registerHooks`), which is what
    // package.json's engines.node says. Say so rather than failing vaguely.
    throw new StoreError("SQLITE_UNAVAILABLE", {
      driver: "node:sqlite",
      nodeVersionFloor: "22.15",
      running: process.versions.node,
      reason: String((cause as Error).message ?? cause),
    });
  }
}

/**
 * `node:sqlite`, by `process.getBuiltinModule` first (Node 22.3+), `require`
 * second.
 *
 * Measured 2026-10-01 (review of #312): under `module.registerHooks` — which is
 * how the package runs on Node (`adapters/node-hooks.mjs`) — a `createRequire`
 * of `node:sqlite` returns NULL on Node 22.15–22.17, 23.5–23.11 and 24.0–24.3,
 * so every store open failed there with "no SQLite binding". The builtin lookup
 * does not go through the module hooks at all. A null from either is refused
 * here by name, never dereferenced.
 */
function nodeSqlite(): { DatabaseSync: new (p: string, o?: unknown) => RawDb } {
  const builtin = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const mod =
    typeof builtin === "function" ? builtin.call(process, "node:sqlite") : require_("node:sqlite");
  const sqlite = (mod ?? (typeof builtin === "function" ? require_("node:sqlite") : null)) as {
    DatabaseSync?: new (p: string, o?: unknown) => RawDb;
  } | null;
  if (sqlite === null || sqlite === undefined || typeof sqlite.DatabaseSync !== "function") {
    throw new Error(`Node ${process.versions.node} did not load node:sqlite`);
  }
  return { DatabaseSync: sqlite.DatabaseSync };
}

function norm(params: SqlParam[]): SqlValue[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    return p;
  });
}

/**
 * How long a connection waits for someone else's write lock before giving up.
 * TUNABLE.
 *
 * Without it SQLite fails INSTANTLY with "database is locked", which is how a
 * live `counterparts backup` threw while a session held an open write
 * transaction (live-verify 2026-08-25) — and CLI CONTRACT §5 G8 says a backup
 * never throws. Brief contention between the console and a background worker is
 * normal and should WAIT; a lock held for five seconds is a real problem and
 * should still be reported rather than waited on forever.
 */
export const BUSY_TIMEOUT_MS = 5000;

export interface OpenDbOptions {
  /**
   * Convert the file to WAL when it is not already in it. A WRITER asks; nobody
   * else does.
   *
   * Reading the journal mode is free; CHANGING it is a write that takes the
   * database's exclusive lock. An opener that converted a file it had only come
   * to read would be writing at open — the observer's stand-down (contract §5),
   * and the shape of the lock incident I38. So the default is false, and it is
   * the default that matters: `vacuumInto` opens the SOURCE of a backup with
   * this, and `adapters/cli` opens box 3 read-only for a census.
   */
  readonly wal?: boolean;
}

/**
 * Put the file in WAL, and only if it is not there already.
 *
 * WAL because several processes hold this one small database open at once — the
 * session hooks, a long-running MCP server, the nightly worker, the dashboard —
 * and in WAL a reader no longer blocks the writer. Its permanent `-wal`/`-shm`
 * sidecars are classified: `LAYOUT`'s database entry matches by PREFIX (§5 G11),
 * which is why the reason NOTES §9 gave for DELETE no longer holds.
 *
 * THE READ COMES FIRST because the set is a write: on a store already in WAL —
 * every open after the first — this statement pair touches nothing.
 *
 * A CONTENDED conversion is not an error, and what contention COSTS depends on
 * who is holding the lock (measured, bun:sqlite 1.3):
 *
 *   - against a WRITER (another connection inside a write transaction) the busy
 *     handler does not run: it fails in about a millisecond, and the open
 *     continues in whatever mode the file is in. The next open tries again.
 *   - against a READER (a shared lock) the busy handler DOES run, so the open
 *     WAITS for the reader and then converts. A short read costs that read; a
 *     reader that outlasts `BUSY_TIMEOUT_MS` costs the whole five seconds and
 *     leaves the file as it was.
 *
 * So the one-time converting open can wait, once, up to the busy timeout. Every
 * open after it reads `wal` and returns without a statement. A hook must not die
 * because the worker happened to be committing, and it does not.
 *
 * ONLY the locked case is swallowed. This statement is also the first one that
 * reads the file's header, so "not a database" arrives here — and a caller that
 * opens a corrupt box 3 to count its vectors has to fail closed rather than be
 * handed a handle (`cli` verify --rebuild's guard).
 */
function convertToWal(db: Db): void {
  const current = db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode;
  if (current !== undefined && current.toLowerCase() === "wal") return;
  try {
    db.get("PRAGMA journal_mode = WAL");
  } catch (err) {
    if (!isLocked(err)) throw err;
    // Contended. The file keeps the mode it has, and this connection works in it.
  }
}

/**
 * SQLITE_BUSY / SQLITE_LOCKED, under either driver's spelling of it.
 *
 * Exported since H1: the hook's stand-down path asks the same question at the
 * other end of the same failure — a contended database is a TRANSIENT fault, and
 * it is told apart from a store that will not open at all by exactly this test.
 * One copy, so the two cannot come to disagree about what "busy" looks like.
 */
export function isLocked(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))) {
    return true;
  }
  const message = String((err as Error)?.message ?? err);
  return message.includes("database is locked") || message.includes("database table is locked");
}

/**
 * SQLITE_NOTADB / SQLITE_CORRUPT, under either driver's spelling: the file is
 * there and is not a database this can read — its header (`file is not a
 * database`) or a page (`database disk image is malformed`). And
 * SQLITE_IOERR_SHORT_READ: a file shorter than its own log and index say,
 * which is what a database file overwritten beside a WAL that outlived its
 * connections (macOS's SQLite keeps it) reads as. Unlike `isLocked`, none of
 * these passes by waiting. bun puts the name in `code`; `node:sqlite` puts the
 * extended number in `errcode` (26, 11 and 522; the primary is the low byte)
 * and the words in the message.
 */
export function isUnreadableDatabase(err: unknown): boolean {
  const e = err as { code?: unknown; errcode?: unknown } | null | undefined;
  const code = e?.code;
  if (
    typeof code === "string" &&
    (code.startsWith("SQLITE_NOTADB") || code.startsWith("SQLITE_CORRUPT") || code === "SQLITE_IOERR_SHORT_READ")
  ) {
    return true;
  }
  const n = typeof e?.errcode === "number" ? e.errcode : -1;
  if ((n & 0xff) === 26 || (n & 0xff) === 11 || n === 522) return true;
  const message = String((err as Error)?.message ?? err);
  return message.includes("file is not a database") || message.includes("database disk image is malformed");
}

/**
 * The journal mode a database file is in, on its own connection — opened, read,
 * closed, converting nothing. What `counterparts verify` and `doctor` print.
 *
 * An absent file answers `absent` rather than being CREATED by the question
 * (`openDb` opens with `create: true`). The handle is read-WRITE, like every
 * other handle this codebase takes: a read-only one would refuse a WAL store
 * whose sidecars are missing, and turning a census into a failure to answer a
 * one-word question is the wrong trade.
 */
export function journalModeOf(path: string): string {
  if (!existsSync(path)) return "absent";
  const db = openDb(path);
  try {
    return db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode ?? "unknown";
  } finally {
    db.close();
  }
}

/**
 * What `foldWal` did. A fold succeeded only when `busy` is false AND `error` is
 * unset; `busy: false` with `error` set means the pragma threw for some other
 * reason (a closed handle, a statement still running) and nothing was folded.
 */
export interface WalFold {
  /** True when SQLite could not finish: a reader held an older snapshot, or
   *  another connection held a lock. What it could copy, it copied. */
  readonly busy: boolean;
  /** Frames in the log as the pragma reports them: 0 after a successful
   *  TRUNCATE (the log is emptied), the remaining frames when `busy`, and -1
   *  when the file is not in WAL or the pragma could not run. */
  readonly log: number;
  /** Frames copied into the database file, read the same way as `log`: 0
   *  after a successful TRUNCATE, -1 when not in WAL or the pragma could not run. */
  readonly checkpointed: number;
  /** Set only when the pragma THREW; a code or a message, never row text. */
  readonly error?: string;
}

/**
 * FOLD THE WRITE-AHEAD LOG into the database file and truncate it to zero —
 * `PRAGMA wal_checkpoint(TRUNCATE)` — without ever waiting and without ever
 * throwing. Meant for the last thing a WRITER does before it closes its handle
 * (`Store.close`, cli INTERFACE-GAPS §13).
 *
 * WHY IT IS NEEDED: SQLite folds the log itself when the LAST connection closes,
 * but only if that close really happens. `openDb` prepares a statement per call
 * and never finalizes one, so bun's `close()` defers the real close and the
 * `-wal` stays at its high-water size until some later process folds it —
 * finding #26, a store whose size on disk depended on who touched it last. An
 * explicit checkpoint does not care about statement lifecycles or drivers.
 *
 * WHY IT NEVER WAITS: RESTART and TRUNCATE run the busy handler while they wait
 * for readers to leave the log, and this connection's handler waits
 * `BUSY_TIMEOUT_MS`. A hook closing while the MCP server or the worker held a
 * read snapshot would stall for five seconds. So the timeout goes to ZERO first
 * for the fold only (it is put back afterwards) — and a
 * contended fold degrades to what SQLite calls PASSIVE: it copies every frame it
 * can without blocking, reports `busy`, and the next writer's close (or
 * SQLite's own auto-checkpoint) finishes the job. Nothing is lost either way;
 * the log is part of the database until it is folded.
 *
 * A file not in WAL answers `log: -1` and nothing happens. Any throw — a
 * statement still running on this connection, a closed handle — is caught and
 * named in `error`: a close must never fail because a checkpoint could not run.
 *
 * Declared BEFORE `openDb` on purpose: the I39 test reads the pragmas in
 * `openDb`'s body in order, and this function's two are not part of an open.
 */
export function foldWal(db: Db): WalFold {
  try {
    db.exec("PRAGMA busy_timeout = 0");
    const row = db.get<Record<string, number>>("PRAGMA wal_checkpoint(TRUNCATE)");
    if (row === undefined) return { busy: true, log: -1, checkpointed: -1, error: "no row" };
    // SQLite names the three columns `busy`, `log`, `checkpointed`; by position
    // as the fallback, which is how the removal reclaim has always read the first.
    const at = Object.values(row);
    const busy = row["busy"] ?? at[0];
    const log = row["log"] ?? at[1];
    const checkpointed = row["checkpointed"] ?? at[2];
    return { busy: busy !== 0, log: Number(log ?? -1), checkpointed: Number(checkpointed ?? -1) };
  } catch (err) {
    const code = (err as { code?: unknown } | null | undefined)?.code;
    return {
      busy: isLocked(err),
      log: -1,
      checkpointed: -1,
      error: typeof code === "string" ? code : String((err as Error)?.message ?? err),
    };
  } finally {
    // Put the wait back, so a caller that runs another statement on this handle
    // after the fold has not silently lost I39's timeout.
    try {
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    } catch {
      /* a closed handle has no timeout to restore */
    }
  }
}

/**
 * Did THIS connection change any row since it opened? SQLite's own
 * `total_changes()` — row changes (INSERT/UPDATE/DELETE) by this connection,
 * nobody else's. A schema-only write (CREATE, ALTER, a pragma) counts no rows,
 * so it does not trigger a fold; its frames wait for the next writer's fold.
 * A handle that only read answers false, and so does a closed one (the
 * question throws there, and "I cannot tell" is not "I wrote").
 */
export function wroteOn(db: Db): boolean {
  try {
    return (db.get<{ n: number }>("SELECT total_changes() AS n")?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export function openDb(path: string, opts: OpenDbOptions = {}): Db {
  const { raw, driver } = openRaw(path);
  let depth = 0;
  let savepointSeq = 0;

  // THE STATEMENT CACHE (2026-10-10, Lane 0 / scale review C5): every
  // `get`/`all`/`run` used to prepare its SQL afresh, and in the 10x sleep
  // profile `prepare` was half the cycle's time — paid once per row by every
  // N+1 read. Statements are kept per connection by their text. Some SQL is
  // built per call (`IN (?, ?, …)` of a varying width), so the cache is
  // bounded and simply emptied when full.
  // Decided by lane0-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why: 512 distinct statements covers every fixed query in the store several times over; emptying beats an LRU's bookkeeping for a cache this cheap to refill.
  //
  // A TABLE CHANGED ON THIS CONNECTION EMPTIES IT (review of #368). SQLite
  // re-prepares a kept statement when the schema moves, but the drivers keep
  // its column NAMES from the first prepare. Measured 2026-10-10: after
  // `ALTER TABLE … ADD COLUMN`, a kept `SELECT *` on bun 1.3 returns the old
  // columns only, and after a table rebuild (create, copy, drop, rename) the
  // values under the wrong names; on Node 22 its `all` throws "Cannot get name
  // of column". Every ALTER and DROP in the store runs through `exec`, at open.
  // A change made by ANOTHER connection is not seen here; the version checks
  // refuse a newer build's store before anything reads it.
  const TABLE_CHANGE = /\b(?:ALTER|DROP)\s+TABLE\b/i;
  const STATEMENT_CACHE_MAX = 512;
  const statements = new Map<string, RawStatement>();

  const exec = (sql: string): void => {
    try {
      raw.exec(sql);
    } finally {
      if (TABLE_CHANGE.test(sql)) statements.clear();
    }
  };

  const statementFor = (sql: string): RawStatement => {
    let st = statements.get(sql);
    if (st === undefined) {
      st = raw.prepare(sql);
      if (statements.size >= STATEMENT_CACHE_MAX) statements.clear();
      statements.set(sql, st);
    }
    return st;
  };

  const prepare = (sql: string): Statement => {
    const st = statementFor(sql);
    return {
      run: (...p) => {
        try {
          st.run(...norm(p));
        } finally {
          if (TABLE_CHANGE.test(sql)) statements.clear();
        }
      },
      get: <T>(...p: SqlParam[]) => (st.get(...norm(p)) ?? undefined) as T | undefined,
      all: <T>(...p: SqlParam[]) => (st.all(...norm(p)) ?? []) as T[],
    };
  };

  const db: Db = {
    path,
    driver,
    exec,
    prepare,
    run: (sql, ...p) => prepare(sql).run(...p),
    get: <T>(sql: string, ...p: SqlParam[]) => prepare(sql).get<T>(...p),
    all: <T>(sql: string, ...p: SqlParam[]) => prepare(sql).all<T>(...p),
    transaction<T>(fn: () => T): T {
      const outer = depth === 0;
      const name = `cp_sp_${++savepointSeq}`;
      exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
      depth += 1;
      try {
        const result = fn();
        exec(outer ? "COMMIT" : `RELEASE ${name}`);
        return result;
      } catch (err) {
        try {
          if (outer) exec("ROLLBACK");
          else {
            exec(`ROLLBACK TO ${name}`);
            exec(`RELEASE ${name}`);
          }
        } catch {
          // A rollback that itself fails must not mask the original reason.
        }
        throw err;
      } finally {
        depth -= 1;
      }
    },
    close: () => {
      statements.clear();
      raw.close();
    },
  };

  // FIRST, before any other statement on this connection (finding I39): every
  // pragma below can contend for a lock, and without the timeout SQLite fails
  // them INSTANTLY. The journal-mode statement used to run here with zero wait,
  // inside another writer's commit window — which is where "database is locked"
  // came from. Set on every connection, including the short-lived one
  // `VACUUM INTO` opens for a backup (§5 G8, live-verify 2026-08-25).
  exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  // Foreign keys are OFF by default in SQLite; referential integrity is enforced by
  // the store (contract §5 G4), so turn them on before anything is written.
  exec("PRAGMA foreign_keys = ON");
  if (opts.wal === true) convertToWal(db);
  // FULL, not WAL's usual NORMAL: that is a durability ruling for the owner to
  // make, not a cleanup to make on the way past. TUNABLE — the one knob here
  // that trades fsyncs for commit speed.
  exec("PRAGMA synchronous = FULL");
  return db;
}
