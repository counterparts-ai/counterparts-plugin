import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { StoreError } from "./errors.js";
const require_ = createRequire(import.meta.url);
export function runtimeIsBun() {
  return typeof globalThis.Bun !== "undefined";
}
function openRaw(path) {
  if (runtimeIsBun()) {
    try {
      const { Database } = require_("bun:sqlite");
      return { raw: new Database(path, { create: true }), driver: "bun:sqlite" };
    } catch (cause) {
      throw new StoreError("SQLITE_UNAVAILABLE", {
        driver: "bun:sqlite",
        reason: String(cause.message ?? cause)
      });
    }
  }
  try {
    const { DatabaseSync } = nodeSqlite();
    return { raw: new DatabaseSync(path), driver: "node:sqlite" };
  } catch (cause) {
    throw new StoreError("SQLITE_UNAVAILABLE", {
      driver: "node:sqlite",
      nodeVersionFloor: "22.15",
      running: process.versions.node,
      reason: String(cause.message ?? cause)
    });
  }
}
function nodeSqlite() {
  const builtin = process.getBuiltinModule;
  const mod = typeof builtin === "function" ? builtin.call(process, "node:sqlite") : require_("node:sqlite");
  const sqlite = mod ?? (typeof builtin === "function" ? require_("node:sqlite") : null);
  if (sqlite === null || sqlite === undefined || typeof sqlite.DatabaseSync !== "function") {
    throw new Error(`Node ${process.versions.node} did not load node:sqlite`);
  }
  return { DatabaseSync: sqlite.DatabaseSync };
}
function norm(params) {
  return params.map((p) => {
    if (p === undefined)
      return null;
    if (typeof p === "boolean")
      return p ? 1 : 0;
    return p;
  });
}
export const BUSY_TIMEOUT_MS = 5000;
function convertToWal(db) {
  const current = db.get("PRAGMA journal_mode")?.journal_mode;
  if (current !== undefined && current.toLowerCase() === "wal")
    return;
  try {
    db.get("PRAGMA journal_mode = WAL");
  } catch (err) {
    if (!isLocked(err))
      throw err;
  }
}
export function isLocked(err) {
  const code = err?.code;
  if (typeof code === "string" && (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))) {
    return true;
  }
  const message = String(err?.message ?? err);
  return message.includes("database is locked") || message.includes("database table is locked");
}
export function isUnreadableDatabase(err) {
  const e = err;
  const code = e?.code;
  if (typeof code === "string" && (code.startsWith("SQLITE_NOTADB") || code.startsWith("SQLITE_CORRUPT") || code === "SQLITE_IOERR_SHORT_READ")) {
    return true;
  }
  const n = typeof e?.errcode === "number" ? e.errcode : -1;
  if ((n & 255) === 26 || (n & 255) === 11 || n === 522)
    return true;
  const message = String(err?.message ?? err);
  return message.includes("file is not a database") || message.includes("database disk image is malformed");
}
export function journalModeOf(path) {
  if (!existsSync(path))
    return "absent";
  const db = openDb(path);
  try {
    return db.get("PRAGMA journal_mode")?.journal_mode ?? "unknown";
  } finally {
    db.close();
  }
}
export function foldWal(db) {
  try {
    db.exec("PRAGMA busy_timeout = 0");
    const row = db.get("PRAGMA wal_checkpoint(TRUNCATE)");
    if (row === undefined)
      return { busy: true, log: -1, checkpointed: -1, error: "no row" };
    const at = Object.values(row);
    const busy = row["busy"] ?? at[0];
    const log = row["log"] ?? at[1];
    const checkpointed = row["checkpointed"] ?? at[2];
    return { busy: busy !== 0, log: Number(log ?? -1), checkpointed: Number(checkpointed ?? -1) };
  } catch (err) {
    const code = err?.code;
    return {
      busy: isLocked(err),
      log: -1,
      checkpointed: -1,
      error: typeof code === "string" ? code : String(err?.message ?? err)
    };
  } finally {
    try {
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    } catch {}
  }
}
export function wroteOn(db) {
  try {
    return (db.get("SELECT total_changes() AS n")?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
export function openDb(path, opts = {}) {
  const { raw, driver } = openRaw(path);
  let depth = 0;
  let savepointSeq = 0;
  const TABLE_CHANGE = /\b(?:ALTER|DROP)\s+TABLE\b/i;
  const STATEMENT_CACHE_MAX = 512;
  const statements = new Map;
  let closed = false;
  const finalizeAll = () => {
    for (const st of statements.values()) {
      try {
        st.finalize?.();
      } catch {}
    }
    statements.clear();
  };
  const open = () => {
    if (closed)
      throw new StoreError("DB_CLOSED", { path });
  };
  const exec = (sql) => {
    open();
    try {
      raw.exec(sql);
    } finally {
      if (TABLE_CHANGE.test(sql))
        finalizeAll();
    }
  };
  const statementFor = (sql) => {
    open();
    let st = statements.get(sql);
    if (st === undefined) {
      st = raw.prepare(sql);
      if (statements.size >= STATEMENT_CACHE_MAX)
        finalizeAll();
      statements.set(sql, st);
    }
    return st;
  };
  const prepare = (sql) => {
    statementFor(sql);
    return {
      run: (...p) => {
        try {
          statementFor(sql).run(...norm(p));
        } finally {
          if (TABLE_CHANGE.test(sql))
            finalizeAll();
        }
      },
      get: (...p) => statementFor(sql).get(...norm(p)) ?? undefined,
      all: (...p) => statementFor(sql).all(...norm(p)) ?? []
    };
  };
  const db = {
    path,
    driver,
    exec,
    prepare,
    run: (sql, ...p) => prepare(sql).run(...p),
    get: (sql, ...p) => prepare(sql).get(...p),
    all: (sql, ...p) => prepare(sql).all(...p),
    transaction(fn) {
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
          if (outer)
            exec("ROLLBACK");
          else {
            exec(`ROLLBACK TO ${name}`);
            exec(`RELEASE ${name}`);
          }
        } catch {}
        throw err;
      } finally {
        depth -= 1;
      }
    },
    close: () => {
      if (closed)
        return;
      closed = true;
      finalizeAll();
      raw.close();
    }
  };
  exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  exec("PRAGMA foreign_keys = ON");
  if (opts.wal === true)
    convertToWal(db);
  exec("PRAGMA synchronous = FULL");
  return db;
}
