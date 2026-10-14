import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync } from "node:fs";
import { utcDate } from "../time.js";
import { basename, dirname, join, resolve } from "node:path";
import { openDb } from "./db.js";
import { DATABASE_FILE, assertSafeDataDir, defaultSnapshotsDir, forbiddenRoots, isWithin } from "./paths.js";
export const PRE_MIGRATION_TAG = "pre-migration";
export const PRE_MIGRATION_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-pre-migration-v[0-9A-Za-z]+-to-v[0-9A-Za-z]+$/;
export function preMigrationVersions(name) {
  if (!PRE_MIGRATION_NAME_RE.test(name))
    return null;
  const m = /-pre-migration-v([0-9A-Za-z]+)-to-v([0-9A-Za-z]+)$/.exec(name);
  return m === null ? null : { from: m[1] ?? "", to: m[2] ?? "" };
}
function stampForName(stamp) {
  const clean = stamp.replace(/[^0-9A-Za-z]/g, "");
  return clean.length > 0 ? clean : "unknown";
}
export function preMigrationName(at, from, to) {
  const instant = new Date(at).toISOString().replace(/[:.]/g, "-");
  return `${instant}-${PRE_MIGRATION_TAG}-v${stampForName(from)}-to-v${stampForName(String(to))}`;
}
export function vacuumInto(source, destination) {
  if (!existsSync(source))
    return { ok: false, error: "no canonical database at source" };
  if (existsSync(destination)) {
    return { ok: false, error: `destination already exists: ${destination}` };
  }
  let db;
  try {
    db = openDb(source);
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  } finally {
    db?.close();
  }
}
export function realpathDeep(path) {
  const resolved = resolve(path);
  let head = resolved;
  const tail = [];
  for (;; ) {
    try {
      lstatSync(head);
      const real = realpathSync(head);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head)
        return resolved;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}
export function preMigrationDir(dbPath, configured) {
  if (configured !== undefined && configured.trim().length > 0)
    return resolve(configured);
  return defaultSnapshotsDir(dirname(dbPath));
}
export function assertPreMigrationTarget(dbPath, dir) {
  if (dir === null) {
    throw new Error("there is no snapshots directory for a store outside the usual <base>/store layout; name one (the snapshotsDir option, or snapshots.dir in the host configuration)");
  }
  const storeDir = realpathDeep(dirname(dbPath));
  assertSafeDataDir(dir);
  const real = realpathDeep(dir);
  assertSafeDataDir(real);
  for (const root of forbiddenRoots()) {
    if (isWithin(realpathDeep(root), real))
      throw new Error(`refusing a snapshots directory inside ${root}`);
  }
  if (isWithin(storeDir, real))
    throw new Error(`the snapshots directory is inside the store: ${real}`);
  if (isWithin(real, storeDir))
    throw new Error(`the snapshots directory contains the store: ${real}`);
  return real;
}
export function snapshotBeforeMigration(input) {
  const dir = assertPreMigrationTarget(input.dbPath, input.dir);
  const now = Date.now();
  const earlier = input.reuse === false ? null : reusableCopy(dir, input.dbPath, input.from, input.to, now);
  if (earlier !== null)
    return { name: earlier, reused: true };
  const name = preMigrationName(now, input.from, input.to);
  const instant = new Date(now).toISOString().replace(/[:.]/g, "-");
  const partial = join(dir, `.partial-${instant}-${String(process.pid)}`);
  mkdirSync(partial, { recursive: true });
  const copy = vacuumInto(input.dbPath, join(partial, DATABASE_FILE));
  if (!copy.ok)
    throw new Error(copy.error);
  const bad = checkCopy(join(partial, DATABASE_FILE), input.from);
  if (bad !== null)
    throw new Error(bad);
  renameSync(partial, join(dir, name));
  return { name, reused: false };
}
function reusableCopy(dir, dbPath, from, to, now) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const want = { from: stampForName(from), to: stampForName(String(to)) };
  const today = utcDate(now);
  const wal = `${dbPath}-wal`;
  const lastWrite = Math.max(mtimeOf(dbPath), sizeOf(wal) > 0 ? mtimeOf(wal) : 0);
  const candidates = names.filter((n) => {
    const v = preMigrationVersions(n);
    return v !== null && v.from === want.from && v.to === want.to;
  }).sort().reverse();
  for (const name of candidates) {
    try {
      if (statSync(join(dir, name, DATABASE_FILE)).size === 0)
        continue;
    } catch {
      continue;
    }
    if (name.slice(0, 10) === today)
      return name;
    const taken = instantOf(name);
    if (taken !== null && lastWrite < taken)
      return name;
  }
  return null;
}
function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
function instantOf(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  if (m === null)
    return null;
  const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(at) ? at : null;
}
function checkCopy(path, from) {
  let db;
  try {
    db = openDb(path);
    const row = db.get("PRAGMA quick_check");
    const verdict = row === undefined ? null : Object.values(row)[0];
    if (verdict !== "ok")
      return `the copy did not verify: ${verdict ?? "no answer"}`;
    const stamp = db.get("SELECT value FROM meta WHERE key = 'schemaVersion'")?.value;
    return stamp === from ? null : `the copy carries schema ${stamp ?? "none"}, expected ${from}`;
  } catch (err) {
    return `the copy would not open: ${String(err.message ?? err)}`;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
