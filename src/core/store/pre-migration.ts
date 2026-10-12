/**
 * The copy taken before a schema migration changes box 2.
 *
 * `openOperational` calls `snapshotBeforeMigration` inside the migrating
 * transaction, after it has taken the write lock and re-read the version — so
 * of several processes opening an old store at once, only the one that wins the
 * lock copies and migrates; the rest find it current and do neither.
 *
 * The copy is the database only, through `VACUUM INTO` on its own connection
 * (a read, so it sees the last committed state: the store before the
 * migration). The migration changes nothing else in the store, so nothing else
 * needs rolling back. It lands in the same snapshots directory the daily copies
 * use, named `<instant>-pre-migration-v<from>-to-v<to>`, and the daily rotation
 * keeps it apart from its own count (`adapters/snapshots.ts`).
 *
 * If the copy cannot be made, the caller does not migrate.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync } from "node:fs";
import { utcDate } from "../time.js";
import { basename, dirname, join, resolve } from "node:path";

import { openDb } from "./db.js";
import { DATABASE_FILE, assertSafeDataDir, defaultSnapshotsDir, forbiddenRoots, isWithin } from "./paths.js";

/** The marker in a pre-migration copy's name. */
export const PRE_MIGRATION_TAG = "pre-migration";

/** `2026-09-24T10-00-00-000Z-pre-migration-v6-to-v7`. The instant sorts first. */
export const PRE_MIGRATION_NAME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-pre-migration-v[0-9A-Za-z]+-to-v[0-9A-Za-z]+$/;

/** The version out of a pre-migration name, as `{ from, to }`, or null. */
export function preMigrationVersions(name: string): { from: string; to: string } | null {
  if (!PRE_MIGRATION_NAME_RE.test(name)) return null;
  const m = /-pre-migration-v([0-9A-Za-z]+)-to-v([0-9A-Za-z]+)$/.exec(name);
  return m === null ? null : { from: m[1] ?? "", to: m[2] ?? "" };
}

/** A version stamp as it can appear in a directory name. */
function stampForName(stamp: string): string {
  const clean = stamp.replace(/[^0-9A-Za-z]/g, "");
  return clean.length > 0 ? clean : "unknown";
}

export function preMigrationName(at: number, from: string, to: number | string): string {
  const instant = new Date(at).toISOString().replace(/[:.]/g, "-");
  return `${instant}-${PRE_MIGRATION_TAG}-v${stampForName(from)}-to-v${stampForName(String(to))}`;
}

/**
 * `VACUUM INTO` on its own connection. The destination must not exist — SQLite
 * refuses to overwrite, which is the right default for a snapshot: a backup that
 * silently replaces yesterday's is one crash away from being no backup at all.
 *
 * Moved here from `adapters/cli/snapshot.ts` (which still exports it) so the
 * store can copy itself before a migration.
 */
export function vacuumInto(
  source: string,
  destination: string,
): { ok: true } | { ok: false; error: string } {
  if (!existsSync(source)) return { ok: false, error: "no canonical database at source" };
  if (existsSync(destination)) {
    return { ok: false, error: `destination already exists: ${destination}` };
  }
  let db;
  try {
    db = openDb(source);
    // Single-quoted SQL literal: the path is escaped for SQL, never interpolated
    // into a shell, because nothing here shells out.
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  } finally {
    db?.close();
  }
}

/** The real path of a directory that may not exist yet: the deepest existing
 *  ancestor realpathed, the rest put back on. Shared with `adapters/snapshots.ts`. */
export function realpathDeep(path: string): string {
  const resolved = resolve(path);
  let head = resolved;
  const tail: string[] = [];
  for (;;) {
    try {
      lstatSync(head);
      const real = realpathSync(head);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolved;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/**
 * Where a pre-migration copy of the database at `dbPath` would go: the named
 * directory, else the default beside the store. Null when there is neither.
 */
export function preMigrationDir(dbPath: string, configured?: string): string | null {
  if (configured !== undefined && configured.trim().length > 0) return resolve(configured);
  return defaultSnapshotsDir(dirname(dbPath));
}

/**
 * The checks a copy's destination has to pass, without writing anything:
 * there is one, it is not under a live v1 store, and it is neither inside the
 * store nor around it. Returns the resolved directory; throws a plain reason.
 * Doctor asks the same question before a session does.
 */
export function assertPreMigrationTarget(dbPath: string, dir: string | null): string {
  if (dir === null) {
    throw new Error(
      "there is no snapshots directory for a store outside the usual <base>/store layout; name one (the snapshotsDir option, or snapshots.dir in the host configuration)",
    );
  }
  const storeDir = realpathDeep(dirname(dbPath));
  // Checked as written and as it resolves, so a link into a live v1 store is refused too.
  assertSafeDataDir(dir);
  const real = realpathDeep(dir);
  assertSafeDataDir(real);
  for (const root of forbiddenRoots()) {
    if (isWithin(realpathDeep(root), real)) throw new Error(`refusing a snapshots directory inside ${root}`);
  }
  if (isWithin(storeDir, real)) throw new Error(`the snapshots directory is inside the store: ${real}`);
  if (isWithin(real, storeDir)) throw new Error(`the snapshots directory contains the store: ${real}`);
  return real;
}

export interface PreMigrationInput {
  /** The live database file. */
  readonly dbPath: string;
  /** Where the copy goes; null when none was configured and there is no default. */
  readonly dir: string | null;
  /** The stamp found on disk, and the version about to be written. */
  readonly from: string;
  readonly to: number;
  /** False: never use an earlier copy, always take a new one. Default true. */
  readonly reuse?: boolean;
}

export interface PreMigrationCopy {
  /** The copy's directory name inside the snapshots directory. */
  readonly name: string;
  /** True when an earlier copy for this upgrade was used instead of a new one. */
  readonly reused: boolean;
}

/**
 * Copy the database into `<dir>/<pre-migration name>` and return that name —
 * or the name of a copy already there for the same upgrade (`reusableCopy`).
 * Throws with a plain reason when it cannot; the caller then does not migrate.
 *
 * Named by the wall clock, never an injected one: a replayed or fixed clock
 * would collide with its own earlier copy, or name one rotation removes at once.
 *
 * Written under a `.partial-<instant>-<pid>` name and renamed into place, like
 * the daily copies, so a killed process leaves a partial the daily sweep
 * removes rather than something that looks like a snapshot.
 */
export function snapshotBeforeMigration(input: PreMigrationInput): PreMigrationCopy {
  const dir = assertPreMigrationTarget(input.dbPath, input.dir);
  const now = Date.now();
  const earlier = input.reuse === false ? null : reusableCopy(dir, input.dbPath, input.from, input.to, now);
  if (earlier !== null) return { name: earlier, reused: true };

  const name = preMigrationName(now, input.from, input.to);
  const instant = new Date(now).toISOString().replace(/[:.]/g, "-");
  const partial = join(dir, `.partial-${instant}-${String(process.pid)}`);
  // A failure below leaves the partial where it is: the store deletes nothing,
  // and the daily sweep removes a stale partial by this name.
  mkdirSync(partial, { recursive: true });
  const copy = vacuumInto(input.dbPath, join(partial, DATABASE_FILE));
  if (!copy.ok) throw new Error(copy.error);
  const bad = checkCopy(join(partial, DATABASE_FILE), input.from);
  if (bad !== null) throw new Error(bad);
  renameSync(partial, join(dir, name));
  return { name, reused: false };
}

/**
 * A copy for this same upgrade that is already on disk and still good enough,
 * so a migration that keeps failing AFTER its copy does not take a new full
 * copy at every open. Good enough means: its database is there, and either it
 * was taken today (UTC) or the live database has not been written since it was
 * taken (neither the file nor a `-wal` with anything in it is newer than the
 * copy's instant).
 *
 * A copy only takes its final name after it verified, so the name is the proof.
 */
function reusableCopy(dir: string, dbPath: string, from: string, to: number, now: number): string | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const want = { from: stampForName(from), to: stampForName(String(to)) };
  // The folder names begin with a UTC instant, so "today" here is the UTC day.
  const today = utcDate(now);
  // An EMPTY `-wal` says nothing about writes: SQLite makes one at every open
  // where the last close deleted it (bun's own SQLite on Linux, node:sqlite),
  // so its mtime is the open's, not a write's (2026-10-11, when `close()` began
  // really closing). A checkpoint that emptied it wrote the database file, and
  // that file's mtime is counted.
  const wal = `${dbPath}-wal`;
  const lastWrite = Math.max(mtimeOf(dbPath), sizeOf(wal) > 0 ? mtimeOf(wal) : 0);
  const candidates = names
    .filter((n) => {
      const v = preMigrationVersions(n);
      return v !== null && v.from === want.from && v.to === want.to;
    })
    .sort()
    .reverse();
  for (const name of candidates) {
    try {
      if (statSync(join(dir, name, DATABASE_FILE)).size === 0) continue;
    } catch {
      continue;
    }
    if (name.slice(0, 10) === today) return name;
    const taken = instantOf(name);
    if (taken !== null && lastWrite < taken) return name;
  }
  return null;
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** `2026-09-24T10-00-00-000Z-…` → its epoch milliseconds, or null. */
function instantOf(name: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  if (m === null) return null;
  const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(at) ? at : null;
}

/** Is the copy a sound database still carrying the old stamp? Null when it is. */
function checkCopy(path: string, from: string): string | null {
  let db;
  try {
    db = openDb(path);
    const row = db.get<Record<string, string>>("PRAGMA quick_check");
    const verdict = row === undefined ? null : Object.values(row)[0];
    if (verdict !== "ok") return `the copy did not verify: ${verdict ?? "no answer"}`;
    const stamp = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schemaVersion'")?.value;
    return stamp === from ? null : `the copy carries schema ${stamp ?? "none"}, expected ${from}`;
  } catch (err) {
    return `the copy would not open: ${String((err as Error).message ?? err)}`;
  } finally {
    try {
      db?.close();
    } catch {
      /* nothing more to learn from it */
    }
  }
}
