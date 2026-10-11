/**
 * `counterparts rollback` — put a store back the way it was before an upgrade
 * (2026-10-11).
 *
 * An upgrade that changes the store's schema copies the database first, to
 * `<snapshots>/<instant>-pre-migration-v<old>-to-v<new>` (`store/pre-migration.ts`).
 * Going back to the older version means putting that copy in place of the
 * upgraded database, because the older version refuses a store from a newer
 * one. Until now that was a hand recipe (set the database and its sidecars
 * aside, copy the snapshot's in, delete the cache); this is the recipe as one
 * command, with the guards written down.
 *
 * **What it never does.** It never deletes the store it replaces: the database,
 * its `-wal`/`-shm` and the cache are RENAMED into
 * `<base>/rollback-aside-v<new>-<instant>/`, on the same filesystem, so the
 * committed pages still in the `-wal` go with it. It never writes into the
 * snapshot: the copy is read and copied. And it refuses while something holds
 * the store open — a session the registry says is live, a memory server whose
 * record is fresh, a dashboard or worker whose command line names the store.
 *
 * **THE HARD PART: the command runs on the NEW build.** Between the rollback
 * and the older version's install, anything on the new build that opens the
 * store would upgrade it again — and a read is not harmless either, because an
 * observer open builds the new build's cache beside the old store, which the
 * old build then refuses ("cache ahead", every memory tool). So the rollback
 * leaves a HOLD (`store/rollback-hold.ts`, a file inside `sessions/`), and the
 * new build's `Store` refuses every open while the hold is there and the store
 * is behind it (`STORE_ROLLED_BACK`). The old build has no such code and opens
 * the store as it always did.
 *
 * Why not `disconnect` first, as the hand recipe did: the hold covers more than
 * disconnecting would — Claude Desktop's memory server, the dashboard and the
 * console are not disconnected by it, and each of them would upgrade or cache
 * the store — and it leaves the host's files to the commands that own them. The
 * printed next steps keep QUICKSTART's order for changing versions
 * (disconnect on the newer version, install the older, connect), which is about
 * the hooks' shape, not the store.
 *
 * Released by `--upgrade-again` (the store is upgraded there and then, from a
 * NEW pre-migration copy, so a second rollback cannot reuse the first one's) or
 * by `--undo`, which puts the set-aside store back if nothing has written to
 * the restored one since.
 *
 * Decided by the rollback builder, 2026-10-11, lightly held.
 */
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
  unlinkSync,
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
  writeRollbackHold,
} from "../../core/store/index.js";
import type { MigrationNote, RollbackHold } from "../../core/store/index.js";
import { foldWal, openDb } from "../../core/store/db.js";
import { listSessions, readServerRecords, serverBelieved } from "../sessions.js";
import { pathGuard, readLiveness, realpathDeep, sameFilesystemRefusal } from "./start-fresh.js";
import { look } from "./wire.js";
import type { ProcessLister } from "./wire.js";

/** Take the hold away, and its directory when that leaves it empty. Here and
 *  not in the store, whose files call no filesystem removal. */
export function clearRollbackHold(storeDir: string): void {
  try {
    unlinkSync(rollbackHoldPath(storeDir));
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  }
  removeIfEmpty(join(storeDir, ROLLBACK_HOLD_DIR));
}

/** `<base>/rollback-aside-v13-2026-10-11T07-25-00-000Z`. */
export const ASIDE_PREFIX = "rollback-aside-v";
const ASIDE_NAME_RE = /^rollback-aside-v[0-9A-Za-z]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/** `counterparts.sqlite.rollback-<pid>`: the copy, before it is renamed into place. */
const TMP_INFIX = ".rollback-";

/** The database and the sidecars SQLite keeps beside it, by exact name. */
const DB_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;
/** `cache.sqlite`, and its sidecars by prefix, inside `cache/`. */
const CACHE_FILE = basename(paths.cache("."));

function instant(at: number): string {
  return new Date(at).toISOString().replace(/[:.]/g, "-");
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The schema stamp in a database, read on its own connection without
 *  converting it, or null when there is none to read. */
export function readStamp(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;
  let db;
  try {
    db = openDb(dbPath, { wal: false });
    return db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schemaVersion'")?.value ?? null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* nothing to learn from a close */
    }
  }
}

// ── the copies ──────────────────────────────────────────────────────────────

export interface PreMigrationCopyInfo {
  readonly name: string;
  /** The copy's database. */
  readonly db: string;
  readonly from: string;
  readonly to: string;
}

/** Every pre-migration copy with a database in it, newest first (the name
 *  begins with its instant, so the name sorts). */
export function preMigrationCopies(snapshotsDir: string | null): PreMigrationCopyInfo[] {
  if (snapshotsDir === null) return [];
  let names: string[];
  try {
    names = readdirSync(snapshotsDir);
  } catch {
    return [];
  }
  const out: PreMigrationCopyInfo[] = [];
  for (const name of names.sort().reverse()) {
    const v = preMigrationVersions(name);
    if (v === null) continue;
    const db = join(snapshotsDir, name, DATABASE_FILE);
    if (!existsSync(db)) continue;
    out.push({ name, db, from: v.from, to: v.to });
  }
  return out;
}

/** What a rollback to `snapshotDb` would lose: rows in the store now that the
 *  copy does not have, memories apart from chapters and beliefs. Null when the
 *  two could not be compared. Changes to rows both have are not counted. */
export function countWrittenSince(currentDb: string, snapshotDb: string): { memories: number; other: number } | null {
  let db;
  try {
    db = openDb(currentDb, { wal: false });
    db.exec(`ATTACH DATABASE '${snapshotDb.replace(/'/g, "''")}' AS snap`);
    try {
      const rows = db.all<{ type: string; n: number }>(
        "SELECT type, COUNT(*) AS n FROM memories WHERE id NOT IN (SELECT id FROM snap.memories) GROUP BY type",
      );
      let memories = 0;
      let other = 0;
      for (const r of rows) {
        if (r.type === "memory") memories += r.n;
        else other += r.n;
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
    } catch {
      /* nothing to learn from a close */
    }
  }
}

/**
 * The version this store last ran on the older schema, from the session
 * records' build stamps — so the printed install line can name it. Best
 * effort: the records are pruned a week after their session ends.
 */
export function previousVersion(storeDir: string, schema: string): string | null {
  let best: { at: number; version: string } | null = null;
  try {
    for (const rec of listSessions(storeDir)) {
      const build = rec.opened?.build;
      if (build === undefined || build.version === null) continue;
      if (String(build.storeSchema) !== schema) continue;
      if (best === null || rec.startedAt > best.at) best = { at: rec.startedAt, version: build.version };
    }
  } catch {
    return null;
  }
  return best?.version ?? null;
}

// ── who holds the store ─────────────────────────────────────────────────────

export interface Holder {
  readonly what: string;
  readonly detail: string;
  /** True when it is evidence about THIS store; false when it may be another's. */
  readonly refuse: boolean;
}

/**
 * Everything that may have the store open, graded. A live session record and a
 * fresh memory-server record are evidence about THIS store (they live in it),
 * and refuse. A dashboard or a worker in the process table refuses when its
 * command line names the store or the configuration; one that names neither
 * may be another store's, and is only said.
 */
export function readHolders(input: {
  readonly storeDir: string;
  readonly configPath: string | null;
  readonly now: number;
  readonly lister?: ProcessLister;
}): Holder[] {
  const out: Holder[] = [];
  for (const sign of readLiveness(input.storeDir, input.now).signs) {
    out.push({
      what: `a Claude Code session (${sign.what})`,
      detail: `${sign.where}, its hooks ran ${String(Math.round(sign.agoMs / 1000))}s ago`,
      refuse: true,
    });
  }
  for (const rec of readServerRecords(input.storeDir)) {
    if (rec.pid === process.pid) continue;
    if (!serverBelieved(rec.pid, rec.refreshedAt, input.now)) continue;
    out.push({
      what: "a memory server",
      detail: `pid ${String(rec.pid)}, ${rec.build.version ?? "an unknown build"}, for ${rec.scope}`,
      refuse: true,
    });
  }
  if (input.lister !== undefined) {
    for (const p of look(input.lister).processes) {
      if (p.what !== "a dashboard" && p.what !== "the worker") continue;
      const names =
        p.command.includes(input.storeDir) || (input.configPath !== null && p.command.includes(input.configPath));
      out.push({ what: p.what, detail: `pid ${String(p.pid)}: ${p.command}`, refuse: names });
    }
  }
  return out;
}

// ── the plan ────────────────────────────────────────────────────────────────

export interface RollbackPlan {
  readonly storeDir: string;
  readonly snapshotsDir: string | null;
  /** The store's schema now, as its database says. */
  readonly current: string | null;
  readonly copy: PreMigrationCopyInfo | null;
  readonly copies: readonly PreMigrationCopyInfo[];
  readonly aside: string;
  readonly lost: { memories: number; other: number } | null;
  readonly refusal: string | null;
}

export interface RollbackInput {
  /** The store, as named (`--dir`, or the configuration's `dataDir`). */
  readonly storeDir: string;
  /** The snapshots directory the store's upgrade copied into, or null. */
  readonly snapshotsDir: string | null;
  /** `--to`: a copy's name, or an absolute path to one. */
  readonly to?: string;
  /** For the guard ring's "store contains the configuration" check. */
  readonly configPath: string;
  readonly home: string;
  readonly now: number;
}

/**
 * Read the ground and decide. Changes nothing: it reads directory listings,
 * two schema stamps and one comparison of ids. Called twice by the command —
 * once to print, once after the confirmation — because a plan held across a
 * person is a plan about a store that may have changed.
 */
export function planRollback(input: RollbackInput): RollbackPlan {
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
    copies: [] as PreMigrationCopyInfo[],
    aside: "",
    lost: null,
  };
  const refuse = (refusal: string, more: Partial<RollbackPlan> = {}): RollbackPlan => ({ ...empty, ...more, refusal });

  const guard = pathGuard("store", input.storeDir, input.configPath, input.home, "--dir");
  if (guard !== null) return refuse(guard);
  // The copy is only read, and still: a snapshots folder inside a live store
  // nobody here may touch is refused by name, as written and as it resolves.
  if (snapshotsDir !== null) {
    try {
      assertSafeDataDir(snapshotsDir);
      assertSafeDataDir(realpathDeep(snapshotsDir));
    } catch {
      return refuse(`refused by name: ${snapshotsDir} is inside a live store this package never touches (CLAUDE.md).`);
    }
  }
  const dbPath = join(storeDir, DATABASE_FILE);
  // The hold first: a rollback that stopped halfway leaves no database, and
  // "nothing to roll back" would hide the way back.
  const hold = readRollbackHold(storeDir);
  if (hold !== null) {
    const when = hold === "unreadable" ? "" : ` on ${localDate(hold.at)}`;
    return refuse(
      !existsSync(dbPath)
        ? `refused: a rollback of this store${when} stopped before the copy went in, so there is no database here; ` +
            `the newer store is whole in the folder it was set aside to. Use --undo to put it back.`
        : `refused: this store was already rolled back${when}, and its hold is still there. ` +
            `Use --undo to put the newer store back, or --upgrade-again to let this version upgrade it again.`,
    );
  }
  if (!existsSync(dbPath)) return refuse(`refused: there is no store database at ${dbPath}, so there is nothing to roll back.`);

  const current = readStamp(dbPath);
  if (current !== String(SCHEMA_VERSION)) {
    const n = current === null ? Number.NaN : Number.parseInt(current, 10);
    return refuse(
      Number.isFinite(n) && n > SCHEMA_VERSION
        ? `refused: this store is on schema v${String(current)}, newer than this version (v${String(SCHEMA_VERSION)}). Roll it back with the version that upgraded it.`
        : `refused: this store is on schema v${String(current ?? "?")} and this version is v${String(SCHEMA_VERSION)}, so this version has not upgraded it and there is nothing for it to roll back.`,
      { current },
    );
  }

  const cross = sameFilesystemRefusal(storeDir);
  if (cross !== null) return refuse(cross, { current });

  const copies = preMigrationCopies(snapshotsDir);
  let copy: PreMigrationCopyInfo | null;
  if (wanted !== undefined) {
    if (!PRE_MIGRATION_NAME_RE.test(wanted)) {
      return refuse(
        `refused: --to takes the name of a pre-migration copy (like 2026-10-11T07-25-00-000Z-pre-migration-v12-to-v13), or an absolute path to one; "${wanted}" is neither.`,
        { current, copies },
      );
    }
    copy = copies.find((c) => c.name === wanted) ?? null;
    if (copy === null) {
      return refuse(`refused: there is no copy named ${wanted} with a database in ${snapshotsDir ?? "(no snapshots directory)"}.`, {
        current,
        copies,
      });
    }
    if (!(Number.parseInt(copy.from, 10) < Number.parseInt(current, 10))) {
      return refuse(`refused: ${copy.name} is a copy of schema v${copy.from}, which is not older than the store's v${current}.`, {
        current,
        copies,
      });
    }
  } else {
    copy = copies.find((c) => c.to === current) ?? null;
    if (copy === null) {
      return refuse(
        `refused: no copy taken before the upgrade to v${current} is in ${snapshotsDir ?? "(no snapshots directory)"}` +
          (copies.length === 0
            ? ". Pre-migration copies are kept 14 days."
            : `. These are there; name one with --to: ${copies.map((c) => c.name).join(", ")}`),
        { current, copies },
      );
    }
  }
  const stamp = readStamp(copy.db);
  if (stamp !== copy.from) {
    return refuse(
      `refused: ${copy.name}'s database says schema v${stamp ?? "?"}, but its name says v${copy.from}. It is not the copy it claims to be.`,
      { current, copies, copy },
    );
  }

  const aside = join(dirname(storeDir), `${ASIDE_PREFIX}${current}-${instant(input.now)}`);
  if (existsSync(aside)) return refuse(`refused: ${aside} already exists. Run this again in a moment.`, { current, copies, copy });

  return {
    storeDir,
    snapshotsDir,
    current,
    copy,
    copies,
    aside,
    lost: countWrittenSince(dbPath, copy.db),
    refusal: null,
  };
}

/** The plan as the owner reads it, before anything moves. */
export function rollbackPlanLines(plan: RollbackPlan): string[] {
  if (plan.copy === null) return [`Store: ${plan.storeDir}`];
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
    "",
  ];
  if (plan.lost === null) {
    out.push("What is lost: everything written since the upgrade (it could not be counted).");
  } else {
    const { memories, other } = plan.lost;
    out.push(
      `What is lost: ${String(memories)} memor${memories === 1 ? "y" : "ies"}` +
        (other > 0 ? ` and ${String(other)} other entr${other === 1 ? "y" : "ies"} (chapters, beliefs)` : "") +
        " written since the upgrade, and any change made since to the memories that were already there.",
    );
  }
  out.push("Nothing is deleted: the newer store stays in the folder above.");
  return out;
}

// ── doing it ────────────────────────────────────────────────────────────────

export interface RollbackOutcome {
  readonly ok: boolean;
  /** Plain words for what was done before a failure, for the owner. */
  readonly done: readonly string[];
  readonly error: string | null;
}

/**
 * The moves, in the order that keeps every moment safe:
 *
 *   1. copy the snapshot's database to a temporary name inside the store (a
 *      `counterparts.sqlite.*` name, which the layout classifies);
 *   2. write the hold — from here this build refuses the store, even if it
 *      finds no database at all;
 *   2b. fold the database's write-ahead log into the main file and truncate
 *      it (`foldBeforeMoving`), refusing if anything holds it — so a kill
 *      between the database's rename and its `-wal`'s cannot leave committed
 *      pages in a lone `-wal`, where an older version would start a blank store;
 *   3. rename the database, its sidecars and the cache into the aside folder;
 *   4. rename the temporary copy into place.
 *
 * A failure before step 3 undoes 1 and 2 (they made only copies) and the store
 * is as it was. A failure after it leaves the hold, so nothing on this build
 * opens a half-restored store, and says what moved. So does a kill between 3
 * and 4: the hold holds a store with no database, doctor says so in red, and
 * `--undo` puts the newer store back (`--upgrade-again` refuses: an open there
 * would mint a blank store).
 */
export function performRollback(plan: RollbackPlan, now: number, build: string | null): RollbackOutcome {
  if (plan.copy === null || plan.current === null || plan.snapshotsDir === null) {
    return { ok: false, done: [], error: "there is no plan to carry out" };
  }
  const storeDir = plan.storeDir;
  const dbPath = join(storeDir, DATABASE_FILE);
  const tmp = join(storeDir, `${DATABASE_FILE}${TMP_INFIX}${String(process.pid)}`);
  const done: string[] = [];
  let moved = false;
  try {
    copyFileSync(plan.copy.db, tmp, fsConstants.COPYFILE_EXCL);
    const hold: RollbackHold = {
      version: 1,
      at: now,
      from: plan.current,
      to: plan.copy.from,
      snapshot: plan.copy.name,
      snapshotsDir: plan.snapshotsDir,
      aside: plan.aside,
      restoredSha256: sha256File(tmp),
      build,
    };
    writeRollbackHold(storeDir, hold);
    foldBeforeMoving(dbPath);
    mkdirSync(join(plan.aside, "cache"), { recursive: true });
    for (const suffix of DB_SUFFIXES) {
      const from = `${dbPath}${suffix}`;
      if (!existsSync(from)) continue;
      renameSync(from, join(plan.aside, `${DATABASE_FILE}${suffix}`));
      moved = true;
      done.push(`moved ${from} -> ${plan.aside}`);
    }
    const cacheDir = paths.cacheDir(storeDir);
    for (const name of listOrEmpty(cacheDir)) {
      if (!name.startsWith(CACHE_FILE)) continue;
      renameSync(join(cacheDir, name), join(plan.aside, "cache", name));
      done.push(`moved ${join(cacheDir, name)} -> ${join(plan.aside, "cache")}`);
    }
    renameSync(tmp, dbPath);
    done.push(`put ${plan.copy.name}'s database at ${dbPath}`);
    return { ok: true, done, error: null };
  } catch (err) {
    const error = String((err as Error).message ?? err);
    if (!moved) {
      // Nothing of the store has moved: take back the two things this made.
      try {
        unlinkSync(tmp);
      } catch {
        /* never made */
      }
      clearRollbackHold(storeDir);
      removeIfEmpty(join(plan.aside, "cache"));
      removeIfEmpty(plan.aside);
      return { ok: false, done: [], error };
    }
    return { ok: false, done, error };
  }
}

/**
 * `PRAGMA wal_checkpoint(TRUNCATE)` on the database about to move, on its own
 * connection (`foldWal` never waits, so a contended fold reports `busy`), then
 * a check that the `-wal` is empty. Throws a sentence saying what to do when
 * it cannot: something holds the database (a session, a memory server, the
 * dashboard, or a background run the holders check could not see).
 */
function foldBeforeMoving(dbPath: string): void {
  let db;
  let why: string | null = null;
  try {
    db = openDb(dbPath);
    const fold = foldWal(db);
    if (fold.error !== undefined) why = fold.error;
    else if (fold.busy) why = "busy";
  } catch (err) {
    why = String((err as Error).message ?? err);
  } finally {
    try {
      db?.close();
    } catch {
      /* nothing to learn from a close */
    }
  }
  if (why === null && nonEmpty(`${dbPath}-wal`)) why = "the -wal is not empty after it";
  if (why !== null) {
    throw new Error(
      `the database's write-ahead log could not be folded into it first (${why}), so something still holds ` +
        "the store open. Close every session, Claude Desktop and the dashboard (and wait for a background run " +
        "to finish), then run this again",
    );
  }
}

function listOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function removeIfEmpty(dir: string): void {
  try {
    rmdirSync(dir);
  } catch {
    /* not empty, or not there */
  }
}

/** What to do next, printed after a rollback. */
export function nextStepLines(plan: RollbackPlan, previous: string | null, cli: string): string[] {
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
    "as long as nothing has written to the restored one.",
  ];
}

// ── the way back ────────────────────────────────────────────────────────────

export interface UndoPlan {
  readonly storeDir: string;
  readonly hold: RollbackHold | null;
  readonly refusal: string | null;
}

/** Can the set-aside store come back? Reads the hold, the folder it names and
 *  one hash; changes nothing. The hold's path is data, so it is checked for
 *  the shape this command writes before anything acts on it. */
export function planRollbackUndo(input: { storeDir: string; configPath: string; home: string }): UndoPlan {
  const storeDir = resolve(input.storeDir);
  const refuse = (refusal: string, hold: RollbackHold | null = null): UndoPlan => ({ storeDir, hold, refusal });
  const guard = pathGuard("store", input.storeDir, input.configPath, input.home, "--dir");
  if (guard !== null) return refuse(guard);
  const hold = readRollbackHold(storeDir);
  if (hold === null) return refuse(`refused: ${storeDir} carries no rollback hold, so there is no rollback to undo.`);
  if (hold === "unreadable") {
    return refuse(
      `refused: the rollback hold in ${storeDir} cannot be read, so this will not guess where the newer store went. ` +
        `Look for a ${ASIDE_PREFIX}… folder beside the store and move its files back by hand.`,
    );
  }
  const aside = resolve(hold.aside);
  if (dirname(aside) !== dirname(storeDir) || !ASIDE_NAME_RE.test(basename(aside))) {
    return refuse(
      `refused: the hold names ${aside} as the set-aside store, which is not a folder this command writes ` +
        `(a ${ASIDE_PREFIX}<version>-<time> folder beside the store). A hold is a file, not an instruction.`,
      hold,
    );
  }
  const asideGuard = pathGuard("set-aside store", aside, input.configPath, input.home, "the rollback hold");
  if (asideGuard !== null) return refuse(asideGuard, hold);
  if (!existsSync(join(aside, DATABASE_FILE))) return refuse(`refused: ${aside} holds no store database to put back.`, hold);

  // No database here: the rollback stopped before its copy went in (killed,
  // or failed after the newer store moved). Nothing can have written to a
  // store that is not there, so the way back is open whatever the hash says.
  const dbPath = join(storeDir, DATABASE_FILE);
  if (!existsSync(dbPath)) return { storeDir, hold, refusal: null };
  const written =
    hold.restoredSha256 === null ||
    sha256File(dbPath) !== hold.restoredSha256 ||
    nonEmpty(`${dbPath}-wal`) ||
    existsSync(`${dbPath}-journal`);
  if (written) {
    return refuse(
      `refused: the restored store has been written to since the rollback (the older version opened it, most likely), ` +
        `and putting the newer one back would lose that. The newer store is still in ${aside}; ` +
        `if you mean to lose what the restored store holds, move it aside and move those files back by hand.`,
      hold,
    );
  }
  return { storeDir, hold, refusal: null };
}

function nonEmpty(path: string): boolean {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}

/**
 * Put the newer store back. The restored copy is removed only when the
 * snapshot it was copied from still holds the same bytes — then it is a
 * duplicate of a file that stays. Otherwise it is kept in the aside folder
 * under its own name. The cache that comes back replaces any cache file the
 * store has now; a cache is rebuilt from the database and is never backed up.
 */
export function performRollbackUndo(plan: UndoPlan): RollbackOutcome {
  if (plan.hold === null) return { ok: false, done: [], error: "there is no plan to carry out" };
  const hold = plan.hold;
  const storeDir = plan.storeDir;
  const aside = resolve(hold.aside);
  const dbPath = join(storeDir, DATABASE_FILE);
  const done: string[] = [];
  try {
    const snapshotDb = join(hold.snapshotsDir, hold.snapshot, DATABASE_FILE);
    const duplicate = existsSync(snapshotDb) && sha256File(snapshotDb) === hold.restoredSha256;
    // No database here: the rollback stopped halfway, so whatever sits beside
    // where it would be is the NEWER store's, not yet moved. It stays, and
    // nothing is renamed over it (below).
    const halfway = !existsSync(dbPath);
    if (!halfway) {
      for (const suffix of DB_SUFFIXES) {
        const path = `${dbPath}${suffix}`;
        if (!existsSync(path)) continue;
        if (duplicate) {
          unlinkSync(path);
          done.push(`removed ${path} (the same bytes are in ${snapshotDb})`);
        } else {
          renameSync(path, join(aside, `restored-${DATABASE_FILE}${suffix}`));
          done.push(`moved ${path} -> ${join(aside, `restored-${DATABASE_FILE}${suffix}`)}`);
        }
      }
    }
    // The copy a rollback made under a temporary name and never renamed into
    // place (`performRollback` step 1), by the same rule as the restored one.
    for (const name of listOrEmpty(storeDir)) {
      if (!name.startsWith(`${DATABASE_FILE}${TMP_INFIX}`)) continue;
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
      throw new Error(
        `${dbPath}${clash} is there, and so is ${join(aside, `${DATABASE_FILE}${clash}`)}; ` +
          "this will not put one over the other. Move one of them by hand",
      );
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
      // Halfway, a cache file still here is the newer cache's own sidecar (the
      // rollback stopped partway through moving them): it stays, and the rest
      // comes back beside it. Otherwise it is a cache built since, on the
      // restored store, and goes.
      for (const name of halfway ? [] : listOrEmpty(cacheDir)) {
        if (name.startsWith(CACHE_FILE)) unlinkSync(join(cacheDir, name));
      }
      mkdirSync(cacheDir, { recursive: true });
      for (const name of comingBack) renameSync(join(asideCache, name), join(cacheDir, name));
      done.push(`moved the cache back into ${cacheDir}`);
    }
    clearRollbackHold(storeDir);
    removeIfEmpty(asideCache);
    removeIfEmpty(aside);
    return { ok: true, done, error: null };
  } catch (err) {
    return { ok: false, done, error: String((err as Error).message ?? err) };
  }
}

// ── letting this version upgrade it again ───────────────────────────────────

/**
 * `--upgrade-again`: open the store past the hold — which upgrades it if it is
 * behind, from a NEW pre-migration copy — and remove the hold once that open
 * has succeeded. Throws what the open throws; the hold stays if it does.
 */
export function upgradeAgain(input: {
  readonly storeDir: string;
  readonly snapshotsDir?: string;
  readonly timeZone?: string;
}): { migration: MigrationNote | null } {
  // Past the hold, an open with no database mints a blank store over a
  // rollback that stopped halfway — the case the hold refuses for. Never.
  if (!existsSync(join(input.storeDir, DATABASE_FILE))) {
    throw new Error(
      `there is no database at ${join(input.storeDir, DATABASE_FILE)}: the rollback stopped before its copy went in, ` +
        "so there is nothing to upgrade. Run counterparts rollback --undo to put the newer store back",
    );
  }
  const store = Store.open({
    dir: input.storeDir,
    releaseRollbackHold: true,
    ...(input.snapshotsDir === undefined ? {} : { snapshotsDir: input.snapshotsDir }),
    ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
  });
  let migration: MigrationNote | null;
  try {
    migration = store.migration;
  } finally {
    store.close();
  }
  const hold = readRollbackHold(input.storeDir);
  if (hold !== null && hold !== "unreadable") tidyAfterKill(input.storeDir, hold);
  clearRollbackHold(input.storeDir);
  return { migration };
}

/**
 * What a rollback killed after its hold but before anything moved leaves
 * besides the hold: the copy under its temporary name, and an empty aside
 * folder. The copy goes only when the snapshot it came from still holds the
 * same bytes (it is a duplicate of a file that stays); a folder only when
 * empty, and only one of the shape this command writes beside the store.
 */
function tidyAfterKill(storeDir: string, hold: RollbackHold): void {
  const snapshotDb = join(hold.snapshotsDir, hold.snapshot, DATABASE_FILE);
  const duplicate = hold.restoredSha256 !== null && existsSync(snapshotDb) && sha256File(snapshotDb) === hold.restoredSha256;
  for (const name of listOrEmpty(storeDir)) {
    if (!duplicate || !name.startsWith(`${DATABASE_FILE}${TMP_INFIX}`)) continue;
    const path = join(storeDir, name);
    if (sha256File(path) === hold.restoredSha256) unlinkSync(path);
  }
  const aside = resolve(hold.aside);
  if (dirname(aside) === dirname(resolve(storeDir)) && ASIDE_NAME_RE.test(basename(aside))) {
    removeIfEmpty(join(aside, "cache"));
    removeIfEmpty(aside);
  }
}
