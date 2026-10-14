import { cpSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import {
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_ROTATED_EVENT,
  SNAPSHOT_TAKEN_EVENT
} from "../core/counterpart.js";
import {
  LAYOUT,
  PRE_MIGRATION_NAME_RE,
  SNAPSHOTS_DIR_NAME,
  defaultSnapshotsDir,
  realpathDeep,
  PRE_ROWS_MARKERS,
  assertSafeDataDir,
  dateOf,
  isWithin
} from "../core/store/index.js";
import { paths } from "../core/store/index.js";
import { openDb } from "../core/store/db.js";
import { assertSafeTarget, snapshot, snapshotName } from "./cli/snapshot.js";
const DATABASE_NAME = basename(paths.operational("."));

export { SNAPSHOTS_DIR_NAME };
export const DEFAULT_KEEP = 14;
export const PARTIAL_PREFIX = ".partial-";
export const PARTIAL_NAME_RE = /^\.partial-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+$/;
export const PARTIAL_STALE_MS = 30 * 60000;
export const MAX_ATTEMPTS_PER_DAY = 3;
export const SNAPSHOT_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
export const PRE_MIGRATION_KEEP_DAYS = 14;
const EMPTY_ROTATION = {
  deleted: [],
  kept: 0,
  oldest: null,
  cleaned: 0,
  future: 0,
  unrecognised: [],
  preRows: [],
  preMigration: [],
  errors: []
};
export function resolveSnapshotsDir(dataDir, configured) {
  if (configured !== undefined && configured.trim().length > 0) {
    return { dir: resolve(configured), reason: "configured" };
  }
  const dir = defaultSnapshotsDir(dataDir);
  return dir === null ? { dir: null, reason: "no-default-dir" } : { dir, reason: "beside-the-store" };
}
export function assertRotatableDir(storeDir, dir, refuse = assertSafeDataDir) {
  refuse(dir);
  const real = refuse(realpathDeep(dir));
  const store = realpathDeep(storeDir);
  if (real === parse(real).root) {
    throw new Error(`refusing a filesystem root as a snapshots directory: ${real}`);
  }
  if (real === realpathDeep(homedir())) {
    throw new Error(`refusing the home directory as a snapshots directory: ${real}`);
  }
  if (isWithin(store, real)) {
    throw new Error(`refusing to keep snapshots inside the store they copy: ${real}`);
  }
  if (isWithin(real, store)) {
    throw new Error(`refusing a snapshots directory that contains the store: ${real}`);
  }
  return real;
}
export function runSnapshot(input) {
  const started = Date.now();
  const errors = [];
  const now = input.now ?? started;
  const asked = input.date;
  const date = asked !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : dateOf(now);
  if (asked !== undefined && asked !== date) {
    errors.push(`"${asked}" is not a calendar date; this run is filed under ${date}`);
  }
  const counterpart = input.counterpart;
  const store = counterpart.store;
  if (counterpart.observer) {
    return done("observer", null, null, 0, null, null, errors, started);
  }
  const resolved = resolveSnapshotsDir(input.dataDir, input.config?.dir);
  if (resolved.dir === null) {
    return done("no-default-dir", null, null, 0, null, null, errors, started);
  }
  let dir;
  try {
    dir = assertRotatableDir(store.dir, resolved.dir);
  } catch (err) {
    const why = messageOf(err);
    errors.push(why);
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: "resolve", reason: why }, `${SNAPSHOT_FAILED_EVENT}:resolve:${date}`);
    return done("refused", resolved.dir, null, 0, null, null, errors, started);
  }
  const cleaned = cleanPartials(dir, now, errors);
  if (todaysSnapshot(dir, date) !== null) {
    return done("already-today", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  const attempts = failedAttemptsToday(store, date);
  if (attempts.saturated) {
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: "attempts", reason: "attempt-window-unreadable" }, `${SNAPSHOT_FAILED_EVENT}:attempts:${date}`);
    errors.push("the failure window was too full to read; treating the day's attempts as spent");
    return done("attempts-exhausted", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  if (attempts.count >= MAX_ATTEMPTS_PER_DAY) {
    return done("attempts-exhausted", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  if (input.signal?.aborted === true) {
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: "aborted", reason: "aborted" }, undefined);
    errors.push("aborted before the copy started");
    return done("aborted", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  const name = `${date}T${snapshotName(now).slice(11)}`;
  const copy = copyInto(store, dir, name, errors);
  if (!copy.ok) {
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: copy.step, reason: copy.why }, undefined);
    return done("failed", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  const rotation = rotate(dir, input.config?.keep, name, cleaned, errors, now);
  const mirror = mirrorTo(store, dir, name, input.config?.mirror, input.config?.keep, now, errors);
  note(counterpart, SNAPSHOT_TAKEN_EVENT, {
    date,
    name,
    files: copy.files,
    ms: Date.now() - started,
    kept: rotation.kept,
    oldest: rotation.oldest,
    deleted: rotation.deleted.length,
    mirror: mirror === null ? "off" : mirror.ok ? "ok" : "failed",
    mirrorWhy: mirror === null || mirror.ok ? null : mirror.why,
    unrecognised: rotation.unrecognised.length,
    unrecognisedNames: rotation.unrecognised.length === 0 ? null : fewOf(rotation.unrecognised)
  }, undefined);
  if (mirror !== null && !mirror.ok) {
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: mirror.step ?? "mirror", reason: mirror.why }, `${SNAPSHOT_FAILED_EVENT}:mirror:${date}`);
  }
  if (rotation.deleted.length > 0) {
    note(counterpart, SNAPSHOT_ROTATED_EVENT, {
      date,
      keep: keepOf(input.config?.keep),
      deleted: rotation.deleted.length,
      names: [...rotation.deleted],
      future: rotation.future,
      unrecognised: rotation.unrecognised.length,
      unrecognisedNames: rotation.unrecognised.length === 0 ? null : fewOf(rotation.unrecognised),
      kept: rotation.kept,
      oldest: rotation.oldest
    }, undefined);
  }
  return done("taken", dir, name, copy.files, rotation, mirror, errors, started);
}
function done(reason, dir, name, files, rotation, mirror, errors, started) {
  return { reason, dir, name, files, ms: Date.now() - started, rotation, mirror, errors: [...errors] };
}
function withCleaned(cleaned) {
  return { ...EMPTY_ROTATION, cleaned };
}
function copyInto(store, dir, name, errors) {
  const partial = join(dir, `${PARTIAL_PREFIX}${name}-${String(process.pid)}`);
  const report = snapshot(store, partial);
  if (!report.ok) {
    const why = report.errors.join("; ") || "the copy reported no detail";
    errors.push(why);
    try {
      rmSync(partial, { recursive: true, force: true });
    } catch (err) {
      errors.push(`could not remove the failed partial copy: ${messageOf(err)}`);
    }
    return { ok: false, step: "copy", why };
  }
  const files = report.copied.reduce((n, entry) => n + entry.files, 0);
  const bad = verifyCopy(partial, files);
  if (bad !== null) {
    errors.push(bad);
    try {
      rmSync(partial, { recursive: true, force: true });
    } catch {}
    return { ok: false, step: "verify", why: bad };
  }
  try {
    renameSync(partial, join(dir, name));
  } catch (err) {
    const why = messageOf(err);
    errors.push(why);
    try {
      rmSync(partial, { recursive: true, force: true });
    } catch {}
    return { ok: false, step: "rename", why };
  }
  return { ok: true, files };
}
export function verifyCopy(partial, files) {
  if (files === 0)
    return "the copy landed no files at all";
  const db = join(partial, DATABASE_NAME);
  let size;
  try {
    size = statSync(db).size;
  } catch {
    return `the copy holds no ${DATABASE_NAME}`;
  }
  if (size === 0)
    return `the copy's ${DATABASE_NAME} is empty`;
  let handle;
  try {
    handle = openDb(db);
    const row = handle.get("PRAGMA quick_check");
    const verdict = row === undefined ? null : Object.values(row)[0];
    return verdict === "ok" ? null : `the copy's database did not verify: ${verdict ?? "no answer"}`;
  } catch (err) {
    return `the copy's database would not open: ${messageOf(err)}`;
  } finally {
    try {
      handle?.close();
    } catch {}
  }
}
function mirrorTo(store, dir, name, configured, keep, now, errors) {
  if (configured === undefined || configured.trim().length === 0)
    return null;
  let verifyFailed = false;
  try {
    const target = assertRotatableDir(store.dir, configured);
    if (target === dir) {
      throw new Error(`the mirror is the snapshots directory itself: ${target}`);
    }
    if (isWithin(dir, target)) {
      throw new Error(`the mirror is inside the snapshots directory, so it is not a second place: ${target}`);
    }
    if (isWithin(target, dir)) {
      throw new Error(`the mirror contains the snapshots directory, so it is not a second place: ${target}`);
    }
    assertSafeTarget(store.dir, join(target, name));
    const partial = join(target, `${PARTIAL_PREFIX}${name}-${String(process.pid)}`);
    cleanPartials(target, now, errors);
    try {
      cpSync(join(dir, name), partial, { recursive: true });
      const bad = verifyCopy(partial, countFiles(partial));
      if (bad !== null) {
        verifyFailed = true;
        throw new Error(`the mirrored copy did not verify: ${bad}`);
      }
      renameSync(partial, join(target, name));
    } catch (err) {
      try {
        rmSync(partial, { recursive: true, force: true });
      } catch {}
      throw err;
    }
    const rotation = rotate(target, keep, name, 0, errors, now);
    return { ok: true, why: "mirrored", step: null, rotation };
  } catch (err) {
    const why = messageOf(err);
    errors.push(`mirror: ${why}`);
    return { ok: false, why, step: verifyFailed ? "mirror-verify" : "mirror", rotation: null };
  }
}
export function keepOf(keep) {
  return keep !== undefined && Number.isInteger(keep) && keep > 0 ? keep : DEFAULT_KEEP;
}
export function rotate(dir, keep, justTaken, cleaned, errors, now = Date.now()) {
  const limit = keepOf(keep);
  const read = readSnapshotsDir(dir);
  const names = read.names;
  const deleted = [];
  const rotationErrors = [];
  const doomed = names.slice(0, Math.max(0, names.length - limit));
  for (const name of doomed) {
    if (name === justTaken)
      continue;
    try {
      rmSync(join(dir, name), { recursive: true, force: true });
      deleted.push(name);
    } catch (err) {
      const why = `could not remove ${name}: ${messageOf(err)}`;
      rotationErrors.push(why);
      errors.push(why);
    }
  }
  const remaining = names.filter((n) => !deleted.includes(n));
  const preMigration = [];
  for (const name of expiredPreMigration(read.preMigration, remaining, limit, now)) {
    try {
      rmSync(join(dir, name), { recursive: true, force: true });
      deleted.push(name);
    } catch (err) {
      const why = `could not remove ${name}: ${messageOf(err)}`;
      rotationErrors.push(why);
      errors.push(why);
    }
  }
  for (const name of read.preMigration)
    if (!deleted.includes(name))
      preMigration.push(name);
  return {
    deleted,
    kept: remaining.length,
    oldest: remaining[0] ?? null,
    cleaned,
    future: futureNamesIn(remaining, now).length,
    unrecognised: read.unrecognised,
    preRows: read.preRows,
    preMigration,
    errors: rotationErrors
  };
}
export function deleteAllCopies(storeDir, dir) {
  const real = assertRotatableDir(storeDir, dir);
  const read = readSnapshotsDir(real);
  const deleted = [];
  const errors = [];
  let entries = 0;
  for (const name of [...read.names, ...read.preMigration]) {
    const removed = removeCopy(join(real, name), errors);
    entries += removed.entries;
    if (removed.ok)
      deleted.push(name);
  }
  return { deleted, entries, left: [...read.preRows, ...read.unrecognised], errors };
}
function removeCopy(path, errors) {
  let entries = 0;
  let ok = true;
  let listing;
  try {
    listing = readdirSync(path, { withFileTypes: true });
  } catch (err) {
    errors.push(`could not read ${basename(path)}: ${messageOf(err)}`);
    return { ok: false, entries };
  }
  for (const entry of listing) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const inner = removeCopy(child, errors);
      entries += inner.entries;
      if (!inner.ok)
        ok = false;
      continue;
    }
    try {
      unlinkSync(child);
      entries += 1;
    } catch (err) {
      ok = false;
      errors.push(`could not remove ${entry.name}: ${messageOf(err)}`);
    }
  }
  if (!ok)
    return { ok, entries };
  try {
    rmdirSync(path);
    entries += 1;
  } catch (err) {
    errors.push(`could not remove ${basename(path)}: ${messageOf(err)}`);
    return { ok: false, entries };
  }
  return { ok: true, entries };
}
export function expiredPreMigration(preMigration, daily, keep, now) {
  const cutoff = dateOf(now - PRE_MIGRATION_KEEP_DAYS * 86400000);
  return preMigration.filter((name) => {
    if (name.slice(0, 10) >= cutoff)
      return false;
    const instant = name.slice(0, 24);
    return daily.filter((d) => d > instant).length >= keep;
  });
}
export function snapshotNamesIn(dir) {
  return readSnapshotsDir(dir).names;
}
export function readSnapshotsDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { names: [], readable: false, unrecognised: [], preRows: [], preMigration: [] };
  }
  const names = [];
  const unrecognised = [];
  const preRows = [];
  const preMigration = [];
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (PRE_MIGRATION_NAME_RE.test(entry.name)) {
      if (copyKind(join(dir, entry.name)) === "ours")
        preMigration.push(entry.name);
      else
        unrecognised.push(entry.name);
      continue;
    }
    if (!SNAPSHOT_NAME_RE.test(entry.name))
      continue;
    const kind = copyKind(join(dir, entry.name));
    if (kind === "pre-rows") {
      preRows.push(entry.name);
      continue;
    }
    if (kind === "not-a-copy") {
      unrecognised.push(entry.name);
      continue;
    }
    names.push(entry.name);
  }
  return {
    names: names.sort(),
    readable: true,
    unrecognised: unrecognised.sort(),
    preRows: preRows.sort(),
    preMigration: preMigration.sort()
  };
}
function countFiles(dir) {
  let n = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
    }
  } catch {}
  return n;
}
function fewOf(names, limit = 3) {
  if (names.length <= limit)
    return names.join(", ");
  return `${names.slice(0, limit).join(", ")} and ${String(names.length - limit)} more`;
}
function copyKind(path) {
  let entries;
  try {
    entries = readdirSync(path);
  } catch {
    return "not-a-copy";
  }
  if (entries.some((e) => PRE_ROWS_MARKERS.includes(e)))
    return "pre-rows";
  for (const entry of entries) {
    if (LAYOUT.some((e) => e.match === "prefix" ? entry.startsWith(e.name) : entry === e.name)) {
      return "ours";
    }
  }
  return "not-a-copy";
}
export function futureNamesIn(names, now) {
  const cutoff = dateOf(now + 86400000);
  return names.filter((n) => n.slice(0, 10) > cutoff);
}
export function todaysSnapshot(dir, date) {
  for (const name of snapshotNamesIn(dir)) {
    if (name.startsWith(`${date}T`))
      return name;
  }
  return null;
}
export function cleanPartials(dir, now, errors) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let cleaned = 0;
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (!PARTIAL_NAME_RE.test(entry.name))
      continue;
    const path = join(dir, entry.name);
    try {
      if (Math.abs(now - statSync(path).mtimeMs) < PARTIAL_STALE_MS)
        continue;
      if (copyKind(path) === "pre-rows")
        continue;
      rmSync(path, { recursive: true, force: true });
      cleaned += 1;
    } catch (err) {
      errors.push(`could not remove an abandoned copy ${entry.name}: ${messageOf(err)}`);
    }
  }
  return cleaned;
}
const FAILED_READ_LIMIT = 1000;
function failedAttemptsToday(store, date) {
  try {
    const livedDay = store.livedDay();
    const rows = store.eventLog({
      name: SNAPSHOT_FAILED_EVENT,
      sinceDay: Math.max(0, livedDay - 2),
      limit: FAILED_READ_LIMIT
    });
    if (rows.length >= FAILED_READ_LIMIT)
      return { count: MAX_ATTEMPTS_PER_DAY, saturated: true };
    let n = 0;
    for (const row of rows) {
      if (row.payload === null)
        continue;
      try {
        const p = JSON.parse(row.payload);
        if (p === null || typeof p !== "object")
          continue;
        const rec = p;
        if (rec["date"] === date && (rec["step"] === "copy" || rec["step"] === "rename" || rec["step"] === "verify")) {
          n += 1;
        }
      } catch {}
    }
    return { count: n, saturated: false };
  } catch {
    return { count: 0, saturated: false };
  }
}
function note(counterpart, name, data, dedupKey) {
  try {
    counterpart.noteAdapterEvent(name, data, dedupKey === undefined ? {} : { dedupKey });
  } catch {}
}
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}
