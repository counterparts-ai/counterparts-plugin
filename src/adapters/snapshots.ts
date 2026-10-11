/**
 * The daily rotating snapshot — and the only mechanism in this package that
 * DELETES a copy of the owner's memory.
 *
 * **Why it is here and not in the core.** The store exports no delete of any
 * kind (store CONTRACT §5 G2), and rotation is a delete. So the deciding — is
 * today's copy already made, how many are kept, which ones go — lives in an
 * adapter, where a person can read the whole rule in one file.
 *
 * **What it copies is not decided here.** It calls `cli/snapshot.ts#snapshot`
 * unchanged, which copies exactly `Store.backupSet()`. That matters more than it
 * looks: v1 hand-maintained a second allowlist, it landed hours before the
 * episode directory existed, and the canonical journal was silently absent from
 * every backup for three weeks (scar §2.11). A database-only snapshot here would
 * re-enact that on today's floor, where the prose files are canonical.
 *
 * **THE TWO THINGS THAT CAN HURT SOMEONE**, and the shape of each defence:
 *
 *   1. *Rotation deletes.* It deletes only directories sitting DIRECTLY inside
 *      the resolved snapshots directory whose names match the one pattern this
 *      module writes (`snapshotName`); it reads the directory with `Dirent`s, so
 *      a symlink is never followed out; it refuses the whole rotation if that
 *      directory resolves inside the store, contains the store, is a filesystem
 *      root or is the home directory itself; it never deletes the copy just
 *      taken; it never rotates at all after a copy that FAILED — losing the
 *      oldest good backup on the day you could not make a new one is the worst
 *      outcome available here; and a `keep` that is not a positive integer falls
 *      back to the default rather than meaning "delete everything". The copies
 *      the store takes before a schema migration (`PRE_MIGRATION_NAME_RE`) sit
 *      in the same directory on a rule of their own (`expiredPreMigration`).
 *
 *   2. *A half-copy must never count as a snapshot.* The worker runs under a
 *      watchdog and the copy is synchronous, so the process can be killed
 *      mid-copy with no chance to clean up. Every copy is therefore written to a
 *      `.partial-…` name inside the snapshots directory and RENAMED into place
 *      when it completes — one atomic step. An interrupted copy is not counted
 *      toward `keep`, does not satisfy "today's exists", is never a rotation
 *      candidate (its name does not match), and is swept up by a later run once
 *      it is old enough that no live run could still be writing it.
 *
 * **It never throws** (cli CONTRACT §5 G8, and the worker's degrade-don't-abort
 * rule): a snapshot problem must not take a consolidation cycle down. Every
 * failure is a field in the report and, where it is worth a durable record, a
 * `snapshot.failed` row.
 *
 * **Which skips leave a row, and which do not.** A row at every session boundary
 * is a flood, not a record, so: `already-today` writes nothing — today's
 * `snapshot.taken` row IS the record; `attempts-exhausted` writes nothing — the
 * `snapshot.failed` rows it counted are; `no-default-dir` writes nothing,
 * because it is a configuration fact rather than an event and doctor says it in
 * words. Everything that stopped a copy that should have happened — a refused
 * directory, a failed copy, a failed rename, an aborted run — is a
 * `snapshot.failed` row carrying its `reason` and the `step` it died at.
 */
import { cpSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";

import type { Counterpart } from "../core/counterpart.js";
import {
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_ROTATED_EVENT,
  SNAPSHOT_TAKEN_EVENT,
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
  isWithin,
} from "../core/store/index.js";
import { paths } from "../core/store/index.js";
import type { Store } from "../core/store/index.js";
import { openDb } from "../core/store/db.js";

import { assertSafeTarget, snapshot, snapshotName } from "./cli/snapshot.js";

/**
 * The canonical database's FILE NAME, taken from the store's own path helper
 * rather than typed here — F5 renames it to `counterparts.sqlite`, and a second
 * spelling of it in this file would be a verification that quietly stopped
 * verifying on the day the floor changed.
 */
const DATABASE_NAME = basename(paths.operational("."));

/** The directory the copies live in, beside the store rather than inside it. */
export { SNAPSHOTS_DIR_NAME };

/** How many copies are kept. Owner's ruling, 2026-09-18. */
export const DEFAULT_KEEP = 14;

/**
 * The prefix a copy wears while it is being written. It starts with a dot so it
 * sorts and reads as "not one of the snapshots", and it can never collide with
 * `snapshotName`, whose output starts with a digit.
 */
export const PARTIAL_PREFIX = ".partial-";

/**
 * And the whole shape of one, not just its prefix — `<prefix><instant>-<pid>`.
 * The sweep deletes what matches this and nothing else, so a person's own
 * `.partial-my-own-thing` in a directory they pointed `snapshots.dir` at is left
 * alone (F2 review, MINOR-7).
 */
export const PARTIAL_NAME_RE = /^\.partial-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+$/;

/**
 * How old an abandoned `.partial-…` directory must be before a later run removes
 * it. Comfortably past the worker's watchdog (`adapters/config.ts` TUNABLES,
 * 5 minutes), because the one thing this must not do is delete the directory a
 * CONCURRENT run is still writing into.
 *
 * It is fixed while `watchdogMs` is configurable, so a host that set a watchdog
 * longer than this could in principle have a partial swept out from under a live
 * copy. The direction is safe: that run's rename then fails, its `snapshot.failed`
 * row says so, and — because a failed copy never rotates — nothing old is lost.
 */
export const PARTIAL_STALE_MS = 30 * 60_000;

/**
 * How many times a day a failing copy is retried. A copy of this store is tens
 * of megabytes and thousands of files, the worker runs at every session
 * boundary, and a persistent failure (a full disk, a permission) would otherwise
 * pay that cost dozens of times between midnight and midnight. Three attempts is
 * enough for a transient lock and cheap enough for a permanent one.
 */
export const MAX_ATTEMPTS_PER_DAY = 3;

/**
 * The name pattern rotation is allowed to delete — `snapshotName`'s output, and
 * nothing else. It is written here rather than derived so that widening the
 * DELETE side takes a deliberate edit to this line.
 */
export const SNAPSHOT_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/**
 * How long a copy taken before a schema migration is kept (the store takes it,
 * `store/pre-migration.ts`). It is not counted toward `keep`, and rotation
 * removes it only once it is this many days old AND `keep` daily copies newer
 * than it exist — so a stretch of failed daily copies never takes it early.
 */
export const PRE_MIGRATION_KEEP_DAYS = 14;

export interface SnapshotsConfig {
  /** Where the copies go. Absent ⇒ beside the store; see `resolveSnapshotsDir`. */
  readonly dir?: string;
  readonly keep?: number;
  /** A second location that receives the same copy, with its own rotation. */
  readonly mirror?: string;
}

export type SnapshotReason =
  | "taken"
  | "observer"
  | "already-today"
  | "no-default-dir"
  | "attempts-exhausted"
  | "aborted"
  | "refused"
  | "failed";

export interface RotationReport {
  /** The snapshot names that were deleted, oldest first. */
  readonly deleted: readonly string[];
  /** How many snapshots remain, including the one just taken. */
  readonly kept: number;
  /** The oldest snapshot still there, by name, or null when there are none. */
  readonly oldest: string | null;
  /** Abandoned `.partial-…` directories this pass removed. */
  readonly cleaned: number;
  /** Copies whose name is more than a day ahead of the clock — a clock-skewed
   *  boundary's, kept but counted, because they hold a `keep` slot forever. */
  readonly future: number;
  /** Correctly-named directories the layout rule does not recognise as copies.
   *  Never deleted, never counted toward `keep` — and never silent. */
  readonly unrecognised: readonly string[];
  /** Copies of a PRE-ROWS store — the owner's snapshots from before the floor.
   *  Never deleted, never counted toward `keep`, and named so they are not a
   *  mystery sitting in the one directory he relies on (review B, MAJOR-2). */
  readonly preRows: readonly string[];
  /** Copies taken before a schema migration still on disk, oldest first. */
  readonly preMigration: readonly string[];
  readonly errors: readonly string[];
}

export interface SnapshotRunReport {
  readonly reason: SnapshotReason;
  /** The resolved snapshots directory, or null when none could be resolved. */
  readonly dir: string | null;
  /** The name of the copy this run made, or null when it made none. */
  readonly name: string | null;
  readonly files: number;
  readonly ms: number;
  readonly rotation: RotationReport | null;
  /** The mirror's own result, or null when no mirror is configured. */
  readonly mirror: {
    readonly ok: boolean;
    readonly why: string;
    /** The step a failed mirror died at, for its own durable row. Null when it
     *  worked. Never `copy`/`rename`/`verify` — the mirror must not spend the
     *  primary's daily attempt budget. */
    readonly step: string | null;
    readonly rotation: RotationReport | null;
  } | null;
  /** Everything that went wrong, in the order it went wrong. */
  readonly errors: readonly string[];
}

const EMPTY_ROTATION: RotationReport = {
  deleted: [],
  kept: 0,
  oldest: null,
  cleaned: 0,
  future: 0,
  unrecognised: [],
  preRows: [],
  preMigration: [],
  errors: [],
};

// ── where the copies go ─────────────────────────────────────────────────────

/**
 * The snapshots directory for this store, and the rule that chose it.
 *
 * The default is a SIBLING of the store directory — `~/.counterparts/snapshots`
 * for the owner — and that is deliberate on two counts: `assertSafeTarget`
 * refuses a destination inside the store, and a destination inside would land an
 * unclassified top-level path that `assertLayout()` then refuses at every open.
 *
 * **The default only applies inside the layout this package creates.** The base
 * directory belongs to the host adapters and the store sits one level below it
 * (`store/paths.ts` DEFAULT_STORE_SUBDIR, owner ruling 2026-09-04). A store
 * somebody pointed at an arbitrary directory has no base directory, and helping
 * ourselves to a sibling of it would write tens of megabytes into a directory
 * this package does not own. That case resolves to null and doctor says so in
 * words; `snapshots.dir` in the configuration names one explicitly.
 *
 * `dataDir` is the one this adapter was HANDED. Never `$HOME`, so a hermetic
 * test cannot reach a real `~/.counterparts` however it is run.
 */
export function resolveSnapshotsDir(
  dataDir: string,
  configured?: string,
): { dir: string | null; reason: "configured" | "beside-the-store" | "no-default-dir" } {
  if (configured !== undefined && configured.trim().length > 0) {
    return { dir: resolve(configured), reason: "configured" };
  }
  // The store's own rule, so the copy taken before a migration lands in the
  // same directory as the daily ones.
  const dir = defaultSnapshotsDir(dataDir);
  return dir === null ? { dir: null, reason: "no-default-dir" } : { dir, reason: "beside-the-store" };
}

/**
 * THE GUARD ON THE DIRECTORY ROTATION IS ALLOWED TO DELETE INSIDE.
 *
 * Every refusal here is about the same mistake in a different costume: a
 * configured path that turns out to name somewhere that matters. So both sides
 * are resolved — and REALPATHED where the directory already exists, because
 * `resolve` does not follow symlinks and a symlinked `snapshots` pointing at
 * `$HOME` would pass a string comparison while rotation walked the home
 * directory. A symlink to an external volume is a legitimate arrangement and
 * still works; it is the TARGET that is judged.
 *
 * **THE LIVE-STORE REFUSAL RUNS ON THE REALPATH, AND IT USED TO RUN ON THE NAME**
 * (found by the F2 adversarial review, 2026-09-18). `assertSafeDataDir` is pure
 * string math — it resolves and compares against `~/.bansai` and
 * `~/.claude-engram` and follows no links — so applying it before the realpath
 * meant a `snapshots.dir` that was a SYMLINK into v1's live memory cleared the
 * one guard this repository's first safety rule is about, and the directory was
 * handed back as rotatable. The copy was refused further down, but `cleanPartials`
 * runs before that and would have swept inside the forbidden tree. It is checked
 * on BOTH spellings now: the path as written, and the path it actually reaches.
 *
 * `refuse` is that check, injectable for ONE reason — `os.homedir()` cannot be
 * moved under bun, so the forbidden roots cannot be relocated into a temp tree,
 * and the only honest way to prove the ORDER hermetically is to hand the guard a
 * stand-in and assert which spelling it was called with. Production never passes
 * it.
 *
 * Throws. Every caller in this file is inside a try.
 */
export function assertRotatableDir(
  storeDir: string,
  dir: string,
  refuse: (path: string) => string = assertSafeDataDir,
): string {
  // As WRITTEN first — a path literally under a forbidden root is refused by the
  // name it was given, so the message names what the owner typed...
  refuse(dir);
  // ...and then as it RESOLVES, which is the spelling that decides where a
  // delete would actually land.
  const real = refuse(realpathDeep(dir));
  const store = realpathDeep(storeDir);
  // The two absolutes first, so each gets the refusal that names it. A
  // filesystem root also CONTAINS the store, and the containment message would
  // be true and useless.
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

// ── the run ─────────────────────────────────────────────────────────────────

export interface SnapshotRunInput {
  /** The open counterpart. Its store is copied; its seam records the run. */
  readonly counterpart: Counterpart;
  readonly config?: SnapshotsConfig;
  /** The data directory this adapter was handed. The default location hangs off
   *  it, never off `$HOME`. */
  readonly dataDir: string;
  /** Injected so a test pins the day and the name without touching the clock. */
  readonly now?: number;
  /** The calendar date this run is about, UTC. Defaults to `now`'s. */
  readonly date?: string;
  /** The worker's watchdog. Aborted ⇒ no copy is started. */
  readonly signal?: AbortSignal;
}

/**
 * One run: decide, copy, rotate, record. Never throws.
 *
 * ORDER IS THE DESIGN. The copy happens first and lands under a partial name;
 * the rename is the moment it becomes a snapshot; rotation runs only after a
 * copy that succeeded; and the `snapshot.taken` row is written LAST, after the
 * copy — which means **a snapshot never contains its own record**. It appears in
 * the next one. That is the honest arrangement: a row written before the copy
 * would be a record of a copy that had not happened yet.
 */
export function runSnapshot(input: SnapshotRunInput): SnapshotRunReport {
  const started = Date.now();
  const errors: string[] = [];
  const now = input.now ?? started;
  // THE RUN'S DATE IS THE FIRST HALF OF EVERY NAME THIS MODULE WRITES, so a
  // caller that handed in something that is not a calendar date would build a
  // name matching neither of the two load-bearing patterns: never recognised as
  // a snapshot, so a full copy at every boundary; never rotated; and its partial
  // never swept (second F2 review, MINOR-a). No caller can do that today — the
  // worker derives the date from the clock — but a `--date` flag on the worker
  // is one line away, and this project has them elsewhere.
  const asked = input.date;
  const date = asked !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : dateOf(now);
  if (asked !== undefined && asked !== date) {
    errors.push(`"${asked}" is not a calendar date; this run is filed under ${date}`);
  }
  const counterpart = input.counterpart;
  const store: Store = counterpart.store;

  if (counterpart.observer) {
    // An instrument that leaves a directory behind is the thing §15 G3 is about.
    // The runner already refuses under observer before it opens a store, so
    // nothing reaches this today — but `noteAdapterEvent` standing the ROW down
    // while the copy still wrote tens of megabytes to disk was a stand-down in
    // name only (F2 review, MINOR-6).
    return done("observer", null, null, 0, null, null, errors, started);
  }

  const resolved = resolveSnapshotsDir(input.dataDir, input.config?.dir);
  if (resolved.dir === null) {
    // No row: a store outside this package's layout is a configuration fact, and
    // one row per boundary for a thing that will never change is a flood.
    // `doctor.ts#snapshotFindings` says it in words instead.
    return done("no-default-dir", null, null, 0, null, null, errors, started);
  }

  let dir: string;
  try {
    dir = assertRotatableDir(store.dir, resolved.dir);
  } catch (err) {
    const why = messageOf(err);
    errors.push(why);
    // Deduped per calendar date: a refused directory refuses identically at
    // every boundary, and the count belongs nowhere.
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: "resolve", reason: why }, `${SNAPSHOT_FAILED_EVENT}:resolve:${date}`);
    return done("refused", resolved.dir, null, 0, null, null, errors, started);
  }

  // Sweep up whatever a killed run left behind BEFORE anything else looks at the
  // directory, so a stale partial cannot be mistaken for anything and the count
  // of what was cleaned reaches the report even on a day that takes no copy.
  const cleaned = cleanPartials(dir, now, errors);

  if (todaysSnapshot(dir, date) !== null) {
    return done("already-today", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  const attempts = failedAttemptsToday(store, date);
  if (attempts.saturated) {
    // The read could not see today's rows, so the cap's answer is a guess. It
    // guesses "exhausted" — the fail-closed direction — and SAYS SO durably,
    // because `attempts-exhausted` writes no row of its own and a permanent
    // silent stop is the failure this project keeps writing scars about.
    note(
      counterpart,
      SNAPSHOT_FAILED_EVENT,
      { date, step: "attempts", reason: "attempt-window-unreadable" },
      `${SNAPSHOT_FAILED_EVENT}:attempts:${date}`,
    );
    errors.push("the failure window was too full to read; treating the day's attempts as spent");
    return done("attempts-exhausted", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  if (attempts.count >= MAX_ATTEMPTS_PER_DAY) {
    return done("attempts-exhausted", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  if (input.signal?.aborted === true) {
    // The watchdog already fired. Starting a copy of the whole store here is
    // exactly the copy most likely to be killed halfway. `step: "aborted"`, not
    // `"copy"`: no copy was attempted, so this must not spend the day's budget
    // (F2 review, MINOR-1 — three watchdog overruns cost the whole day's backup).
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: "aborted", reason: "aborted" }, undefined);
    errors.push("aborted before the copy started");
    return done("aborted", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }

  // THE NAME'S DAY IS THE ROW'S DAY, always. `snapshotName` spells an instant,
  // and a run that starts at 23:59:59 and copies at 00:00:01 would otherwise
  // file the copy under tomorrow while the row said today — so "today's exists"
  // would never find it and yesterday would end with no copy at all (F2 review,
  // N-2). The time of day is the real instant; only the date is pinned — so a
  // copy taken at 00:00:05 on the 19th for a run about the 18th reads
  // `2026-09-18T00-00-05-000Z`, which looks odd and is harmless: sorting is by
  // date and there is at most one copy per date.
  const name = `${date}T${snapshotName(now).slice(11)}`;
  const copy = copyInto(store, dir, name, errors);
  if (!copy.ok) {
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: copy.step, reason: copy.why }, undefined);
    // NO ROTATION after a failed copy. Deleting the oldest good backup on the
    // day no new one could be made is the one outcome worth refusing outright.
    return done("failed", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }

  const rotation = rotate(dir, input.config?.keep, name, cleaned, errors, now);
  const mirror = mirrorTo(store, dir, name, input.config?.mirror, input.config?.keep, now, errors);

  note(
    counterpart,
    SNAPSHOT_TAKEN_EVENT,
    {
      date,
      name,
      files: copy.files,
      ms: Date.now() - started,
      kept: rotation.kept,
      oldest: rotation.oldest,
      deleted: rotation.deleted.length,
      mirror: mirror === null ? "off" : mirror.ok ? "ok" : "failed",
      // The mirror's reason rides on this row too: "failed" with no why is the
      // half-record this project keeps finding in v1.
      mirrorWhy: mirror === null || mirror.ok ? null : mirror.why,
      // Named directories the layout rule does not recognise: kept, never
      // rotated, and never silent about it.
      unrecognised: rotation.unrecognised.length,
      unrecognisedNames: rotation.unrecognised.length === 0 ? null : fewOf(rotation.unrecognised),
    },
    undefined,
  );
  // A MIRROR THAT FAILED GETS ITS OWN ROW. The `snapshot.taken` row carries
  // `mirror: "failed"` and the reason, but the fired view reads failures by
  // NAME, and a second copy that has been silently broken for a month is exactly
  // the thing this track exists to make visible. Its `step` is never one the
  // daily attempt cap counts: the primary landed, and the mirror must not spend
  // tomorrow's budget for it.
  if (mirror !== null && !mirror.ok) {
    note(
      counterpart,
      SNAPSHOT_FAILED_EVENT,
      { date, step: mirror.step ?? "mirror", reason: mirror.why },
      `${SNAPSHOT_FAILED_EVENT}:mirror:${date}`,
    );
  }
  // Only when something actually went (scar §2.4: every discard says what and
  // how much). A daily row saying "nothing was deleted" would make a store that
  // has not filled up yet read like a rotation that is working.
  if (rotation.deleted.length > 0) {
    note(
      counterpart,
      SNAPSHOT_ROTATED_EVENT,
      {
        date,
        keep: keepOf(input.config?.keep),
        deleted: rotation.deleted.length,
        names: [...rotation.deleted],
        // A clock-skewed name holds a `keep` slot forever, so it is on the row
        // that discards rather than left to be noticed as a missing day.
        future: rotation.future,
        unrecognised: rotation.unrecognised.length,
        unrecognisedNames: rotation.unrecognised.length === 0 ? null : fewOf(rotation.unrecognised),
        kept: rotation.kept,
        oldest: rotation.oldest,
      },
      undefined,
    );
  }
  return done("taken", dir, name, copy.files, rotation, mirror, errors, started);
}

function done(
  reason: SnapshotReason,
  dir: string | null,
  name: string | null,
  files: number,
  rotation: RotationReport | null,
  mirror: SnapshotRunReport["mirror"],
  errors: readonly string[],
  started: number,
): SnapshotRunReport {
  return { reason, dir, name, files, ms: Date.now() - started, rotation, mirror, errors: [...errors] };
}

function withCleaned(cleaned: number): RotationReport {
  return { ...EMPTY_ROTATION, cleaned };
}

// ── the copy, and the rename that makes it a snapshot ───────────────────────

/**
 * Copy the store into `<dir>/.partial-<name>` and rename it to `<dir>/<name>`.
 *
 * The rename is the whole point: it is one step, so a process killed at any
 * instant leaves either a partial directory (which is not a snapshot by name and
 * will be swept) or a complete one. There is no in-between state that counts.
 */
function copyInto(
  store: Store,
  dir: string,
  name: string,
  errors: string[],
): { ok: true; files: number } | { ok: false; step: string; why: string } {
  // The pid makes the partial name unique to THIS process, so two runs that
  // overlap cannot write into each other's directory.
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
  // THE COPY IS LOOKED AT BEFORE THE RENAME MAKES IT A SNAPSHOT (F2 review,
  // MINOR-9). `report.ok` means only that no entry reported an error — and
  // `copyTree` returns 0 files and `ok: true` for a source that is not there, so
  // a structurally empty directory would have taken the name, counted toward
  // `keep`, satisfied "today's exists" and pushed a real copy out on day 15.
  const bad = verifyCopy(partial, files);
  if (bad !== null) {
    errors.push(bad);
    try {
      rmSync(partial, { recursive: true, force: true });
    } catch {
      /* the sweep will get it */
    }
    return { ok: false, step: "verify", why: bad };
  }
  try {
    renameSync(partial, join(dir, name));
  } catch (err) {
    const why = messageOf(err);
    errors.push(why);
    try {
      rmSync(partial, { recursive: true, force: true });
    } catch {
      /* the sweep will get it */
    }
    return { ok: false, step: "rename", why };
  }
  return { ok: true, files };
}

/**
 * Is what was just written actually a copy? The cheapest honest questions, asked
 * once, on a directory nothing else can see yet: it holds files at all, the
 * database is there and not empty, and SQLite itself says the database is sound.
 *
 * `PRAGMA quick_check` rather than `integrity_check`: it is the one SQLite
 * recommends for exactly this — it skips the expensive index cross-checks and
 * still reads every page, which on a freshly vacuumed few-megabyte file is
 * milliseconds. Returns the reason on failure, null when the copy is good.
 */
export function verifyCopy(partial: string, files: number): string | null {
  if (files === 0) return "the copy landed no files at all";
  const db = join(partial, DATABASE_NAME);
  let size: number;
  try {
    size = statSync(db).size;
  } catch {
    return `the copy holds no ${DATABASE_NAME}`;
  }
  if (size === 0) return `the copy's ${DATABASE_NAME} is empty`;
  let handle;
  try {
    handle = openDb(db);
    const row = handle.get<Record<string, string>>("PRAGMA quick_check");
    const verdict = row === undefined ? null : Object.values(row)[0];
    return verdict === "ok" ? null : `the copy's database did not verify: ${verdict ?? "no answer"}`;
  } catch (err) {
    return `the copy's database would not open: ${messageOf(err)}`;
  } finally {
    // A `finally` that throws REPLACES the return and propagates — out of
    // `copyInto`, out of `runSnapshot`, past "it never throws" (second F2
    // review, MINOR-c). The runner's own try would catch it, but that is belt
    // and braces rather than the structural promise this module makes.
    try {
      handle?.close();
    } catch {
      /* a handle that will not close has already told us what it could */
    }
  }
}

/**
 * The mirror — a second location that receives the same copy and rotates on its
 * own terms. **A mirror failure is reported, never fatal**: the snapshot beside
 * the store has already landed, and losing the second copy is not worth losing
 * the first.
 *
 * It is copied from the finished primary rather than taken from the store a
 * second time. Two reasons: the two locations then hold BYTE-IDENTICAL copies of
 * one instant rather than two snapshots taken minutes apart, and the store is
 * read once instead of twice. This does not cross scar §2.11's line — that rule
 * is about copying a CANONICAL database as a file. The database inside a
 * finished snapshot is a `VACUUM INTO` output that no process holds open.
 */
function mirrorTo(
  store: Store,
  dir: string,
  name: string,
  configured: string | undefined,
  keep: number | undefined,
  now: number,
  errors: string[],
): SnapshotRunReport["mirror"] {
  if (configured === undefined || configured.trim().length === 0) return null;
  let verifyFailed = false;
  try {
    const target = assertRotatableDir(store.dir, configured);
    // A SECOND LOCATION HAS TO BE A SECOND LOCATION (second F2 review, MINOR-e).
    // A mirror nested inside the primary directory dies with the same disk while
    // silently doubling local storage, and the outer rotation cannot see it —
    // its name does not match — so nothing ever says there are two trees. A
    // mirror EQUAL to it used to fail with a raw `ENOTEMPTY` from the rename.
    // Realpaths, because that is the only spelling that settles it.
    if (target === dir) {
      throw new Error(`the mirror is the snapshots directory itself: ${target}`);
    }
    if (isWithin(dir, target)) {
      throw new Error(`the mirror is inside the snapshots directory, so it is not a second place: ${target}`);
    }
    if (isWithin(target, dir)) {
      throw new Error(`the mirror contains the snapshots directory, so it is not a second place: ${target}`);
    }
    // The same guard the primary copy passes through, on the FULL destination.
    assertSafeTarget(store.dir, join(target, name));
    const partial = join(target, `${PARTIAL_PREFIX}${name}-${String(process.pid)}`);
    cleanPartials(target, now, errors);
    try {
      cpSync(join(dir, name), partial, { recursive: true });
      // VERIFIED LIKE THE PRIMARY (second F2 review, MINOR-b). A `cpSync` that
      // throws is cleaned up below; one that returns having written a truncated
      // tree — a filling mirror volume is the obvious case — would otherwise be
      // renamed into place, counted toward the mirror's own `keep`, and rotate a
      // good copy out of it on day 15. The mirror is the copy you reach for when
      // the primary is gone.
      const bad = verifyCopy(partial, countFiles(partial));
      if (bad !== null) {
        verifyFailed = true;
        throw new Error(`the mirrored copy did not verify: ${bad}`);
      }
      renameSync(partial, join(target, name));
    } catch (err) {
      try {
        rmSync(partial, { recursive: true, force: true });
      } catch {
        /* the sweep will get it */
      }
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

// ── rotation: the part that deletes ─────────────────────────────────────────

/** `keep`, defended. Anything that is not a positive whole number is a
 *  misconfiguration, and the safe reading of one is the default — never zero,
 *  which would mean "delete them all". */
export function keepOf(keep: number | undefined): number {
  return keep !== undefined && Number.isInteger(keep) && keep > 0 ? keep : DEFAULT_KEEP;
}

/**
 * Keep the newest `keep`, delete the rest OLDEST FIRST, and say what went.
 *
 * Sorted by NAME, never by mtime: the names are ISO instants, so they sort
 * chronologically by construction, and an mtime is a property of the filesystem
 * that a copy, a restore or a `touch` can rewrite.
 *
 * `dir` has already been through `assertRotatableDir`. `justTaken` is excluded
 * from the candidates explicitly — it is the newest by name and could not be
 * chosen anyway, but a rule this consequential should not rest on an ordering.
 */
export function rotate(
  dir: string,
  keep: number | undefined,
  justTaken: string | null,
  cleaned: number,
  errors: string[],
  now: number = Date.now(),
): RotationReport {
  const limit = keepOf(keep);
  const read = readSnapshotsDir(dir);
  const names = read.names;
  const deleted: string[] = [];
  const rotationErrors: string[] = [];
  // Newest last. Everything before the final `limit` entries goes, oldest first.
  const doomed = names.slice(0, Math.max(0, names.length - limit));
  for (const name of doomed) {
    if (name === justTaken) continue;
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
  // Pre-migration copies: past their days AND behind `keep` newer daily copies.
  const preMigration: string[] = [];
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
  for (const name of read.preMigration) if (!deleted.includes(name)) preMigration.push(name);
  return {
    deleted,
    kept: remaining.length,
    oldest: remaining[0] ?? null,
    cleaned,
    future: futureNamesIn(remaining, now).length,
    unrecognised: read.unrecognised,
    preRows: read.preRows,
    preMigration,
    errors: rotationErrors,
  };
}

/**
 * The pre-migration copies rotation may remove: older than
 * `PRE_MIGRATION_KEEP_DAYS` by the date in their name, with at least `keep`
 * daily copies newer than them. Names sort by instant, so a string compare of
 * the leading instant is a time compare.
 */
export function expiredPreMigration(
  preMigration: readonly string[],
  daily: readonly string[],
  keep: number,
  now: number,
): string[] {
  const cutoff = dateOf(now - PRE_MIGRATION_KEEP_DAYS * 86_400_000);
  return preMigration.filter((name) => {
    if (name.slice(0, 10) >= cutoff) return false;
    const instant = name.slice(0, 24);
    return daily.filter((d) => d > instant).length >= keep;
  });
}

/**
 * The snapshots in a directory, sorted oldest first — and the one place that
 * decides what COUNTS as a snapshot, which is the same decision as what rotation
 * may delete.
 *
 * `readdirSync(..., { withFileTypes: true })` reports the entry's OWN type, so a
 * symlink is `isSymbolicLink()` and never `isDirectory()`: a link pointing
 * anywhere at all is skipped rather than followed, and rotation cannot walk out
 * of this directory.
 */
export function snapshotNamesIn(dir: string): string[] {
  return readSnapshotsDir(dir).names;
}

/**
 * The same reading, with "the directory is not there or would not open" kept
 * apart from "the directory is empty". Doctor needs those two apart — one is a
 * store that has not taken a copy yet, the other is copies that have gone
 * missing — and this module's own callers do not care.
 */
export function readSnapshotsDir(dir: string): SnapshotsDirRead {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A directory that does not exist yet holds no snapshots. Not an error.
    return { names: [], readable: false, unrecognised: [], preRows: [], preMigration: [] };
  }
  const names: string[] = [];
  const unrecognised: string[] = [];
  const preRows: string[] = [];
  const preMigration: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // A copy the store took before a migration: its own channel, never counted
    // toward `keep` and never "today's". Only one that looks like a copy.
    if (PRE_MIGRATION_NAME_RE.test(entry.name)) {
      if (copyKind(join(dir, entry.name)) === "ours") preMigration.push(entry.name);
      else unrecognised.push(entry.name);
      continue;
    }
    if (!SNAPSHOT_NAME_RE.test(entry.name)) continue;
    // AND IT HAS TO LOOK LIKE ONE WE WROTE (F2 review, MINOR-7). Inside the
    // default directory this is belt and braces — the package made every entry
    // there. It earns its keep the moment somebody points `snapshots.dir` or
    // `mirror` at a directory of their own, shared with another tool: the delete
    // rule becomes "a directory this package wrote" rather than "a directory
    // whose name looks like one". Classified top-level names only, read from the
    // store's own LAYOUT so the check cannot go stale when the floor changes.
    //
    // A REJECTION IS COUNTED AND NAMED, NEVER JUST SKIPPED (second F2 review,
    // MAJOR-A). Because `LAYOUT` is read at runtime, this rule can change
    // underneath copies that already exist — a floor change, or a copy somebody
    // partly cleaned out — and a rejected directory is invisible to rotation, to
    // "today's exists", to `kept`, to `oldest` and to every row. Permanent
    // uncounted residue in the one directory the owner relies on is the same
    // silence this module exists to remove, one level down. The rule stays as
    // strict; it just says what it did.
    const kind = copyKind(join(dir, entry.name));
    if (kind === "pre-rows") {
      // A copy of the owner's old floor. Kept, counted, named — and never
      // rotated, because this build cannot open it to know what is in it.
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
    preMigration: preMigration.sort(),
  };
}

export interface SnapshotsDirRead {
  readonly names: string[];
  readonly readable: boolean;
  /** Correctly-named directories that hold nothing the store's layout
   *  classifies. Kept — we never delete what we cannot prove we made — but
   *  counted, so "not rotated" can never mean "nobody noticed". */
  readonly unrecognised: string[];
  /** Copies of a PRE-ROWS store: they hold `operational.sqlite`, `prose/` or
   *  `versions/`. A copy, of a floor this build cannot open — so never deleted,
   *  never counted toward `keep`, and named rather than left a mystery in the
   *  one directory the owner relies on (review B, MAJOR-2). */
  readonly preRows: string[];
  /** Copies the store took before a schema migration, oldest first. Kept apart
   *  from `names`: rotation removes one only by `expiredPreMigration`'s rule. */
  readonly preMigration: string[];
}

/** How many files a finished copy holds — the mirror's input to `verifyCopy`,
 *  which the primary gets for free from `snapshot()`'s own report. */
function countFiles(dir: string): number {
  let n = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
    }
  } catch {
    /* an unreadable copy counts as nothing, which `verifyCopy` refuses */
  }
  return n;
}

/** The first few of a list, and how many more — for a row or a line that must
 *  stay readable however long the list is. */
function fewOf(names: readonly string[], limit = 3): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} and ${String(names.length - limit)} more`;
}

/**
 * Is this directory a copy of a store THIS BUILD WROTE — the only kind rotation
 * may ever delete?
 *
 * Two questions, and the second one is review B's MAJOR-2. The first: does it
 * hold a top-level name the store's current `LAYOUT` classifies? A person's own
 * folder wearing a snapshot-shaped name does not.
 *
 * **The second: is it a PRE-ROWS copy?** `LAYOUT` is read at runtime, and F5
 * took `prose`, `versions` and `operational.sqlite` out of it — but left
 * `spans`, which was in the old backup set too and which the owner's live store
 * fills every day. So a real v5 snapshot holds `spans/` and was RECOGNISED, and
 * therefore rotatable. F2 went live on the v5 store, so `~/.counterparts/
 * snapshots/` fills with v5 copies; cut-over then mints a fresh store at the
 * same path, which resolves to the SAME snapshots directory; fourteen daily
 * boundaries later every one of the owner's pre-rows copies is deleted as an
 * ordinary rotation. Those folders are the only copy of those words.
 *
 * So a directory holding any `PRE_ROWS_MARKERS` entry is never ours to delete,
 * whatever else it holds. It is not "unrecognised" either — it is a copy, of a
 * floor this build cannot open — and it gets its own channel so the sentence
 * the owner reads can say which it is.
 */
function copyKind(path: string): "ours" | "pre-rows" | "not-a-copy" {
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return "not-a-copy"; // unreadable is not "ours"
  }
  if (entries.some((e) => PRE_ROWS_MARKERS.includes(e))) return "pre-rows";
  for (const entry of entries) {
    if (LAYOUT.some((e) => (e.match === "prefix" ? entry.startsWith(e.name) : entry === e.name))) {
      return "ours";
    }
  }
  return "not-a-copy";
}

/**
 * Snapshots whose name is more than a day in the FUTURE (F2 review, MINOR-5).
 *
 * One clock-skewed boundary — a laptop waking with a bad RTC — plants a name
 * that sorts newest forever, occupies a `keep` slot permanently, and quietly
 * leaves the owner with thirteen days of history instead of fourteen. They are
 * NOT deleted here: a copy is a copy, and guessing that a name is wrong is not a
 * reason to destroy the bytes behind it. They are COUNTED and reported, so the
 * "silently" is gone.
 */
export function futureNamesIn(names: readonly string[], now: number): string[] {
  // COMPARED AS CALENDAR DATES, not as instants. Doctor asks this question with
  // midnight today and rotation asks it with the live clock, and an instant
  // cutoff made the two disagree by up to a day — one surface saying "1 dated in
  // the future" while the other's row said none (second F2 review, MINOR-f).
  // Every caller on the same day now gets the same answer.
  const cutoff = dateOf(now + 86_400_000);
  return names.filter((n) => n.slice(0, 10) > cutoff);
}

/** Today's snapshot, by name, or null. The names are UTC ISO instants, so the
 *  calendar date is their first ten characters — the same UTC day every other
 *  date in this store is spelled in. */
export function todaysSnapshot(dir: string, date: string): string | null {
  for (const name of snapshotNamesIn(dir)) {
    if (name.startsWith(`${date}T`)) return name;
  }
  return null;
}

/**
 * Remove `.partial-…` directories a killed run left behind — but only ones old
 * enough that no live run could still be writing into them. A sweep that deleted
 * a fresh partial would be this module destroying its own concurrent copy.
 */
export function cleanPartials(dir: string, now: number, errors: string[]): number {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let cleaned = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!PARTIAL_NAME_RE.test(entry.name)) continue;
    const path = join(dir, entry.name);
    try {
      // ABSOLUTE, so a partial whose mtime is in the FUTURE — the same
      // clock-skew family as a future-dated copy — is not kept forever by a
      // negative age that is always under the bound (second F2 review, NIT-2).
      if (Math.abs(now - statSync(path).mtimeMs) < PARTIAL_STALE_MS) continue;
      // A PARTIAL HOLDING PRE-ROWS NAMES IS STILL NOT OURS TO DELETE.
      //
      // B-MAJOR-2's rule — a directory holding any `PRE_ROWS_MARKERS` entry is
      // never ours — was applied to finished copies and not here, and this was
      // the one path left that still deleted pre-rows bytes (review f5c,
      // NIT-3). A partial is by definition incomplete, so in principle it is a
      // half-copy nobody wants; but "in principle" is exactly the confidence
      // that deleted three weeks of journal in v1, and the cost of keeping one
      // is a directory. It stops being counted as cleaned, and the rotation's
      // `preRows` channel names it.
      if (copyKind(path) === "pre-rows") continue;
      rmSync(path, { recursive: true, force: true });
      cleaned += 1;
    } catch (err) {
      errors.push(`could not remove an abandoned copy ${entry.name}: ${messageOf(err)}`);
    }
  }
  return cleaned;
}

// ── the durable record ──────────────────────────────────────────────────────

/**
 * How many copy attempts already failed today. The cap's input.
 *
 * `eventLog` is `ORDER BY seq ASC LIMIT`, so a read that comes back FULL is the
 * OLDEST rows and today's are exactly the ones missing — the same trap
 * `doctor.ts#newestRows` carries a paragraph about. It bites hardest under the
 * failure this project has already lived through: a frozen lived-day clock (I32)
 * leaves every row inside one `day`, the window fills, and the cap silently
 * reads zero forever. So the limit is generous, and a read that REACHES it is
 * treated as exhausted rather than as zero — the fail-closed direction, and the
 * cheap one, because the thing being refused is a retry rather than a backup.
 */
const FAILED_READ_LIMIT = 1000;

function failedAttemptsToday(
  store: Store,
  date: string,
): { count: number; saturated: boolean } {
  try {
    const livedDay = store.livedDay();
    // A lived day is never longer than a calendar day, so two lived days back
    // certainly covers today's rows whichever side of a cycle they landed on.
    const rows = store.eventLog({
      name: SNAPSHOT_FAILED_EVENT,
      sinceDay: Math.max(0, livedDay - 2),
      limit: FAILED_READ_LIMIT,
    });
    if (rows.length >= FAILED_READ_LIMIT) return { count: MAX_ATTEMPTS_PER_DAY, saturated: true };
    let n = 0;
    for (const row of rows) {
      if (row.payload === null) continue;
      try {
        const p: unknown = JSON.parse(row.payload);
        if (p === null || typeof p !== "object") continue;
        const rec = p as Record<string, unknown>;
        // Only a failed COPY counts against the cap: a refused directory, an
        // aborted watchdog and an unreadable window all cost nothing to re-check,
        // and capping on them would hide a fixed one (F2 review, MINOR-1).
        if (
          rec["date"] === date &&
          (rec["step"] === "copy" || rec["step"] === "rename" || rec["step"] === "verify")
        ) {
          n += 1;
        }
      } catch {
        /* an unparseable row is not an attempt */
      }
    }
    return { count: n, saturated: false };
  } catch {
    // A store that cannot be read is not a store that has used up its attempts.
    return { count: 0, saturated: false };
  }
}

/** One durable row, and never a throw: a failed record may not turn a failed
 *  step into a failed process. */
function note(
  counterpart: Counterpart,
  name: typeof SNAPSHOT_TAKEN_EVENT | typeof SNAPSHOT_FAILED_EVENT | typeof SNAPSHOT_ROTATED_EVENT,
  data: Record<string, unknown>,
  dedupKey: string | undefined,
): void {
  try {
    counterpart.noteAdapterEvent(name, data, dedupKey === undefined ? {} : { dedupKey });
  } catch {
    /* §5 G8 */
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
