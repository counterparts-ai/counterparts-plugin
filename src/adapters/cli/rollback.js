import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { localDate } from "../../core/time.js";
import {
  DATABASE_FILE,
  PRE_MIGRATION_NAME_RE,
  SCHEMA_VERSION,
  Store,
  ROLLBACK_HOLD_DIR,
  assertSafeDataDir,
  paths,
  preMigrationVersions,
  readRollbackHold,
  rollbackHoldPath,
  writeRollbackHold
} from "../../core/store/index.js";
import { foldWal, openDb } from "../../core/store/db.js";
import { listSessions, readServerRecords, serverBelieved } from "../sessions.js";
import { pathGuard, readLiveness, realpathDeep, sameFilesystemRefusal } from "./start-fresh.js";
import { look } from "./wire.js";
export function clearRollbackHold(storeDir) {
  try {
    unlinkSync(rollbackHoldPath(storeDir));
  } catch (err) {
    if (err.code !== "ENOENT")
      throw err;
  }
  removeIfEmpty(join(storeDir, ROLLBACK_HOLD_DIR));
}
export const ASIDE_PREFIX = "rollback-aside-v";
const ASIDE_NAME_RE = /^rollback-aside-v[0-9A-Za-z]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const TMP_INFIX = ".rollback-";
const DB_SUFFIXES = ["", "-wal", "-shm", "-journal"];
const CACHE_FILE = basename(paths.cache("."));
function instant(at) {
  return new Date(at).toISOString().replace(/[:.]/g, "-");
}
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export function readStamp(dbPath) {
  if (!existsSync(dbPath))
    return null;
  let db;
  try {
    db = openDb(dbPath, { wal: false });
    return db.get("SELECT value FROM meta WHERE key = 'schemaVersion'")?.value ?? null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
export function preMigrationCopies(snapshotsDir) {
  if (snapshotsDir === null)
    return [];
  let names;
  try {
    names = readdirSync(snapshotsDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.sort().reverse()) {
    const v = preMigrationVersions(name);
    if (v === null)
      continue;
    const db = join(snapshotsDir, name, DATABASE_FILE);
    if (!existsSync(db))
      continue;
    out.push({ name, db, from: v.from, to: v.to });
  }
  return out;
}
export function countWrittenSince(currentDb, snapshotDb) {
  let db;
  try {
    db = openDb(currentDb, { wal: false });
    db.exec(`ATTACH DATABASE '${snapshotDb.replace(/'/g, "''")}' AS snap`);
    try {
      const rows = db.all("SELECT type, COUNT(*) AS n FROM memories WHERE id NOT IN (SELECT id FROM snap.memories) GROUP BY type");
      let memories = 0;
      let other = 0;
      for (const r of rows) {
        if (r.type === "memory")
          memories += r.n;
        else
          other += r.n;
      }
      return { memories, other };
    } finally {
      db.exec("DETACH DATABASE snap");
    }
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
export function previousVersion(storeDir, schema) {
  let best = null;
  try {
    for (const rec of listSessions(storeDir)) {
      const build = rec.opened?.build;
      if (build === undefined || build.version === null)
        continue;
      if (String(build.storeSchema) !== schema)
        continue;
      if (best === null || rec.startedAt > best.at)
        best = { at: rec.startedAt, version: build.version };
    }
  } catch {
    return null;
  }
  return best?.version ?? null;
}
export function readHolders(input) {
  const out = [];
  for (const sign of readLiveness(input.storeDir, input.now).signs) {
    out.push({
      what: `a Claude Code session (${sign.what})`,
      detail: `${sign.where}, its hooks ran ${String(Math.round(sign.agoMs / 1000))}s ago`,
      refuse: true
    });
  }
  for (const rec of readServerRecords(input.storeDir)) {
    if (rec.pid === process.pid)
      continue;
    if (!serverBelieved(rec.pid, rec.refreshedAt, input.now))
      continue;
    out.push({
      what: "a memory server",
      detail: `pid ${String(rec.pid)}, ${rec.build.version ?? "an unknown build"}, for ${rec.scope}`,
      refuse: true
    });
  }
  if (input.lister !== undefined) {
    for (const p of look(input.lister).processes) {
      if (p.what !== "a dashboard" && p.what !== "the worker")
        continue;
      const names = p.command.includes(input.storeDir) || input.configPath !== null && p.command.includes(input.configPath);
      out.push({ what: p.what, detail: `pid ${String(p.pid)}: ${p.command}`, refuse: names });
    }
  }
  return out;
}
export function planRollback(input) {
  const storeDir = isAbsolute(input.storeDir) ? resolve(input.storeDir) : input.storeDir;
  let snapshotsDir = input.snapshotsDir === null ? null : resolve(input.snapshotsDir);
  let wanted = input.to;
  if (wanted !== undefined && isAbsolute(wanted)) {
    snapshotsDir = dirname(resolve(wanted));
    wanted = basename(resolve(wanted));
  }
  const empty = {
    storeDir,
    snapshotsDir,
    current: null,
    copy: null,
    copies: [],
    aside: "",
    lost: null
  };
  const refuse = (refusal, more = {}) => ({ ...empty, ...more, refusal });
  const guard = pathGuard("store", input.storeDir, input.configPath, input.home, "--dir");
  if (guard !== null)
    return refuse(guard);
  if (snapshotsDir !== null) {
    try {
      assertSafeDataDir(snapshotsDir);
      assertSafeDataDir(realpathDeep(snapshotsDir));
    } catch {
      return refuse(`refused by name: ${snapshotsDir} is inside a live store this package never touches (CLAUDE.md).`);
    }
  }
  const dbPath = join(storeDir, DATABASE_FILE);
  const hold = readRollbackHold(storeDir);
  if (hold !== null) {
    const when = hold === "unreadable" ? "" : ` on ${localDate(hold.at)}`;
    return refuse(!existsSync(dbPath) ? `refused: a rollback of this store${when} stopped before the copy went in, so there is no database here; ` + `the newer store is whole in the folder it was set aside to. Use --undo to put it back.` : `refused: this store was already rolled back${when}, and its hold is still there. ` + `Use --undo to put the newer store back, or --upgrade-again to let this version upgrade it again.`);
  }
  if (!existsSync(dbPath))
    return refuse(`refused: there is no store database at ${dbPath}, so there is nothing to roll back.`);
  const current = readStamp(dbPath);
  if (current !== String(SCHEMA_VERSION)) {
    const n = current === null ? Number.NaN : Number.parseInt(current, 10);
    return refuse(Number.isFinite(n) && n > SCHEMA_VERSION ? `refused: this store is on schema v${String(current)}, newer than this version (v${String(SCHEMA_VERSION)}). Roll it back with the version that upgraded it.` : `refused: this store is on schema v${String(current ?? "?")} and this version is v${String(SCHEMA_VERSION)}, so this version has not upgraded it and there is nothing for it to roll back.`, { current });
  }
  const cross = sameFilesystemRefusal(storeDir);
  if (cross !== null)
    return refuse(cross, { current });
  const copies = preMigrationCopies(snapshotsDir);
  let copy;
  if (wanted !== undefined) {
    if (!PRE_MIGRATION_NAME_RE.test(wanted)) {
      return refuse(`refused: --to takes the name of a pre-migration copy (like 2026-10-11T07-25-00-000Z-pre-migration-v12-to-v13), or an absolute path to one; "${wanted}" is neither.`, { current, copies });
    }
    copy = copies.find((c) => c.name === wanted) ?? null;
    if (copy === null) {
      return refuse(`refused: there is no copy named ${wanted} with a database in ${snapshotsDir ?? "(no snapshots directory)"}.`, {
        current,
        copies
      });
    }
    if (!(Number.parseInt(copy.from, 10) < Number.parseInt(current, 10))) {
      return refuse(`refused: ${copy.name} is a copy of schema v${copy.from}, which is not older than the store's v${current}.`, {
        current,
        copies
      });
    }
  } else {
    copy = copies.find((c) => c.to === current) ?? null;
    if (copy === null) {
      return refuse(`refused: no copy taken before the upgrade to v${current} is in ${snapshotsDir ?? "(no snapshots directory)"}` + (copies.length === 0 ? ". Pre-migration copies are kept 14 days." : `. These are there; name one with --to: ${copies.map((c) => c.name).join(", ")}`), { current, copies });
    }
  }
  const stamp = readStamp(copy.db);
  if (stamp !== copy.from) {
    return refuse(`refused: ${copy.name}'s database says schema v${stamp ?? "?"}, but its name says v${copy.from}. It is not the copy it claims to be.`, { current, copies, copy });
  }
  const aside = join(dirname(storeDir), `${ASIDE_PREFIX}${current}-${instant(input.now)}`);
  if (existsSync(aside))
    return refuse(`refused: ${aside} already exists. Run this again in a moment.`, { current, copies, copy });
  return {
    storeDir,
    snapshotsDir,
    current,
    copy,
    copies,
    aside,
    lost: countWrittenSince(dbPath, copy.db),
    refusal: null
  };
}
export function rollbackPlanLines(plan) {
  if (plan.copy === null)
    return [`Store: ${plan.storeDir}`];
  const out = [
    `Store:     ${plan.storeDir} (schema v${plan.current ?? "?"})`,
    `Copy:      ${plan.copy.name}`,
    `           in ${plan.snapshotsDir ?? "?"} (schema v${plan.copy.from})`,
    "",
    "It will:",
    `  1. set the store's database, its -wal and -shm, and the cache aside, by rename, in`,
    `     ${plan.aside}`,
    `  2. copy the copy's database in their place (the copy itself is not changed)`,
    `  3. leave a hold, so this version neither upgrades nor reads the store again until you`,
    `     say so (rollback --upgrade-again), or put the newer store back (rollback --undo)`,
    ""
  ];
  if (plan.lost === null) {
    out.push("What is lost: everything written since the upgrade (it could not be counted).");
  } else {
    const { memories, other } = plan.lost;
    out.push(`What is lost: ${String(memories)} memor${memories === 1 ? "y" : "ies"}` + (other > 0 ? ` and ${String(other)} other entr${other === 1 ? "y" : "ies"} (chapters, beliefs)` : "") + " written since the upgrade, and any change made since to the memories that were already there.");
  }
  out.push("Nothing is deleted: the newer store stays in the folder above.");
  return out;
}
export function performRollback(plan, now, build) {
  if (plan.copy === null || plan.current === null || plan.snapshotsDir === null) {
    return { ok: false, done: [], error: "there is no plan to carry out" };
  }
  const storeDir = plan.storeDir;
  const dbPath = join(storeDir, DATABASE_FILE);
  const tmp = join(storeDir, `${DATABASE_FILE}${TMP_INFIX}${String(process.pid)}`);
  const done = [];
  let moved = false;
  try {
    copyFileSync(plan.copy.db, tmp, fsConstants.COPYFILE_EXCL);
    const hold = {
      version: 1,
      at: now,
      from: plan.current,
      to: plan.copy.from,
      snapshot: plan.copy.name,
      snapshotsDir: plan.snapshotsDir,
      aside: plan.aside,
      restoredSha256: sha256File(tmp),
      build
    };
    writeRollbackHold(storeDir, hold);
    foldBeforeMoving(dbPath);
    mkdirSync(join(plan.aside, "cache"), { recursive: true });
    for (const suffix of DB_SUFFIXES) {
      const from = `${dbPath}${suffix}`;
      if (!existsSync(from))
        continue;
      renameSync(from, join(plan.aside, `${DATABASE_FILE}${suffix}`));
      moved = true;
      done.push(`moved ${from} -> ${plan.aside}`);
    }
    const cacheDir = paths.cacheDir(storeDir);
    for (const name of listOrEmpty(cacheDir)) {
      if (!name.startsWith(CACHE_FILE))
        continue;
      renameSync(join(cacheDir, name), join(plan.aside, "cache", name));
      done.push(`moved ${join(cacheDir, name)} -> ${join(plan.aside, "cache")}`);
    }
    renameSync(tmp, dbPath);
    done.push(`put ${plan.copy.name}'s database at ${dbPath}`);
    return { ok: true, done, error: null };
  } catch (err) {
    const error = String(err.message ?? err);
    if (!moved) {
      try {
        unlinkSync(tmp);
      } catch {}
      clearRollbackHold(storeDir);
      removeIfEmpty(join(plan.aside, "cache"));
      removeIfEmpty(plan.aside);
      return { ok: false, done: [], error };
    }
    return { ok: false, done, error };
  }
}
function foldBeforeMoving(dbPath) {
  let db;
  let why = null;
  try {
    db = openDb(dbPath);
    const fold = foldWal(db);
    if (fold.error !== undefined)
      why = fold.error;
    else if (fold.busy)
      why = "busy";
  } catch (err) {
    why = String(err.message ?? err);
  } finally {
    try {
      db?.close();
    } catch {}
  }
  if (why === null && nonEmpty(`${dbPath}-wal`))
    why = "the -wal is not empty after it";
  if (why !== null) {
    throw new Error(`the database's write-ahead log could not be folded into it first (${why}), so something still holds ` + "the store open. Close every session, Claude Desktop and the dashboard (and wait for a background run " + "to finish), then run this again");
  }
}
function listOrEmpty(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
function removeIfEmpty(dir) {
  try {
    rmdirSync(dir);
  } catch {}
}
export function nextStepLines(plan, previous, cli) {
  const version = previous ?? "<the version you had before>";
  return [
    "Next, in this order:",
    `  1. ${cli} disconnect          (while this version is still installed)`,
    `  2. install the version you had before${previous === null ? "" : ` (${previous}, the last one this store ran on v${plan.copy?.from ?? "?"})`}:`,
    `       bun add -g counterparts@${version}     (or: npm i -g counterparts@${version})`,
    `  3. ${cli} connect && ${cli} doctor`,
    "  4. if you use Claude Desktop: quit it, then run counterparts install --host claude-desktop",
    "  With the Claude Code plugin instead: skip step 1, install the older version with bun or",
    "  npm as in step 2, then run counterparts install. The plugin stands down once that wiring",
    "  is live (it stays on this version, which leaves the store alone); uninstall it to tidy up.",
    "",
    "Until step 2, this version leaves the store alone: sessions on it stand down and say why.",
    "The search index went aside with the newer store; the first session on the older version",
    "rebuilds it, and until then `ask` from the console finds nothing.",
    `Changed your mind? ${cli} rollback --undo --dir ${plan.storeDir} puts the newer store back,`,
    "as long as nothing has written to the restored one."
  ];
}
export function planRollbackUndo(input) {
  const storeDir = resolve(input.storeDir);
  const refuse = (refusal, hold = null) => ({ storeDir, hold, refusal });
  const guard = pathGuard("store", input.storeDir, input.configPath, input.home, "--dir");
  if (guard !== null)
    return refuse(guard);
  const hold = readRollbackHold(storeDir);
  if (hold === null)
    return refuse(`refused: ${storeDir} carries no rollback hold, so there is no rollback to undo.`);
  if (hold === "unreadable") {
    return refuse(`refused: the rollback hold in ${storeDir} cannot be read, so this will not guess where the newer store went. ` + `Look for a ${ASIDE_PREFIX}… folder beside the store and move its files back by hand.`);
  }
  const aside = resolve(hold.aside);
  if (dirname(aside) !== dirname(storeDir) || !ASIDE_NAME_RE.test(basename(aside))) {
    return refuse(`refused: the hold names ${aside} as the set-aside store, which is not a folder this command writes ` + `(a ${ASIDE_PREFIX}<version>-<time> folder beside the store). A hold is a file, not an instruction.`, hold);
  }
  const asideGuard = pathGuard("set-aside store", aside, input.configPath, input.home, "the rollback hold");
  if (asideGuard !== null)
    return refuse(asideGuard, hold);
  if (!existsSync(join(aside, DATABASE_FILE)))
    return refuse(`refused: ${aside} holds no store database to put back.`, hold);
  const dbPath = join(storeDir, DATABASE_FILE);
  if (!existsSync(dbPath))
    return { storeDir, hold, refusal: null };
  const written = hold.restoredSha256 === null || sha256File(dbPath) !== hold.restoredSha256 || nonEmpty(`${dbPath}-wal`) || existsSync(`${dbPath}-journal`);
  if (written) {
    return refuse(`refused: the restored store has been written to since the rollback (the older version opened it, most likely), ` + `and putting the newer one back would lose that. The newer store is still in ${aside}; ` + `if you mean to lose what the restored store holds, move it aside and move those files back by hand.`, hold);
  }
  return { storeDir, hold, refusal: null };
}
function nonEmpty(path) {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}
export function performRollbackUndo(plan) {
  if (plan.hold === null)
    return { ok: false, done: [], error: "there is no plan to carry out" };
  const hold = plan.hold;
  const storeDir = plan.storeDir;
  const aside = resolve(hold.aside);
  const dbPath = join(storeDir, DATABASE_FILE);
  const done = [];
  try {
    const snapshotDb = join(hold.snapshotsDir, hold.snapshot, DATABASE_FILE);
    const duplicate = existsSync(snapshotDb) && sha256File(snapshotDb) === hold.restoredSha256;
    const halfway = !existsSync(dbPath);
    if (!halfway) {
      for (const suffix of DB_SUFFIXES) {
        const path = `${dbPath}${suffix}`;
        if (!existsSync(path))
          continue;
        if (duplicate) {
          unlinkSync(path);
          done.push(`removed ${path} (the same bytes are in ${snapshotDb})`);
        } else {
          renameSync(path, join(aside, `restored-${DATABASE_FILE}${suffix}`));
          done.push(`moved ${path} -> ${join(aside, `restored-${DATABASE_FILE}${suffix}`)}`);
        }
      }
    }
    for (const name of listOrEmpty(storeDir)) {
      if (!name.startsWith(`${DATABASE_FILE}${TMP_INFIX}`))
        continue;
      const path = join(storeDir, name);
      if (duplicate && sha256File(path) === hold.restoredSha256) {
        unlinkSync(path);
        done.push(`removed ${path} (the same bytes are in ${snapshotDb})`);
      } else {
        renameSync(path, join(aside, name));
        done.push(`moved ${path} -> ${aside}`);
      }
    }
    const coming = DB_SUFFIXES.filter((s) => existsSync(join(aside, `${DATABASE_FILE}${s}`)));
    const clash = coming.find((s) => existsSync(`${dbPath}${s}`));
    if (clash !== undefined) {
      throw new Error(`${dbPath}${clash} is there, and so is ${join(aside, `${DATABASE_FILE}${clash}`)}; ` + "this will not put one over the other. Move one of them by hand");
    }
    for (const suffix of coming) {
      const from = join(aside, `${DATABASE_FILE}${suffix}`);
      renameSync(from, `${dbPath}${suffix}`);
      done.push(`moved ${from} -> ${storeDir}`);
    }
    const cacheDir = paths.cacheDir(storeDir);
    const asideCache = join(aside, "cache");
    const comingBack = listOrEmpty(asideCache).filter((n) => n.startsWith(CACHE_FILE));
    if (comingBack.length > 0) {
      for (const name of halfway ? [] : listOrEmpty(cacheDir)) {
        if (name.startsWith(CACHE_FILE))
          unlinkSync(join(cacheDir, name));
      }
      mkdirSync(cacheDir, { recursive: true });
      for (const name of comingBack)
        renameSync(join(asideCache, name), join(cacheDir, name));
      done.push(`moved the cache back into ${cacheDir}`);
    }
    clearRollbackHold(storeDir);
    removeIfEmpty(asideCache);
    removeIfEmpty(aside);
    return { ok: true, done, error: null };
  } catch (err) {
    return { ok: false, done, error: String(err.message ?? err) };
  }
}
export function upgradeAgain(input) {
  if (!existsSync(join(input.storeDir, DATABASE_FILE))) {
    throw new Error(`there is no database at ${join(input.storeDir, DATABASE_FILE)}: the rollback stopped before its copy went in, ` + "so there is nothing to upgrade. Run counterparts rollback --undo to put the newer store back");
  }
  const store = Store.open({
    dir: input.storeDir,
    releaseRollbackHold: true,
    ...input.snapshotsDir === undefined ? {} : { snapshotsDir: input.snapshotsDir },
    ...input.timeZone === undefined ? {} : { timeZone: input.timeZone }
  });
  let migration;
  try {
    migration = store.migration;
  } finally {
    store.close();
  }
  const hold = readRollbackHold(input.storeDir);
  if (hold !== null && hold !== "unreadable")
    tidyAfterKill(input.storeDir, hold);
  clearRollbackHold(input.storeDir);
  return { migration };
}
function tidyAfterKill(storeDir, hold) {
  const snapshotDb = join(hold.snapshotsDir, hold.snapshot, DATABASE_FILE);
  const duplicate = hold.restoredSha256 !== null && existsSync(snapshotDb) && sha256File(snapshotDb) === hold.restoredSha256;
  for (const name of listOrEmpty(storeDir)) {
    if (!duplicate || !name.startsWith(`${DATABASE_FILE}${TMP_INFIX}`))
      continue;
    const path = join(storeDir, name);
    if (sha256File(path) === hold.restoredSha256)
      unlinkSync(path);
  }
  const aside = resolve(hold.aside);
  if (dirname(aside) === dirname(resolve(storeDir)) && ASIDE_NAME_RE.test(basename(aside))) {
    removeIfEmpty(join(aside, "cache"));
    removeIfEmpty(aside);
  }
}
