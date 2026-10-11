/**
 * `counterparts start-fresh` — beginning again without losing what came before.
 *
 * **What it is for.** The owner is about to use this system as a stranger would:
 * a blank store, the QUICKSTART followed literally, every rough edge collected,
 * fixed, and then started over again (plan §2 ruling 6, "cut-over carries
 * NOTHING"). Doing that by hand is five steps
 * (`docs/plan-step3-the-floor-2026-09-17.md` §2 step 5) with seventeen thousand
 * private memories on the other side of a typo. This is those steps, once, with
 * the guards written down.
 *
 * **THE ONE RULE, and everything below is a way of keeping it: it never deletes,
 * and it never opens the old store.** Not for writing, not for reading, not
 * read-only — a WAL store's `-wal` holds committed pages until somebody
 * checkpoints it, and an opener is somebody. The old store is moved by a single
 * `rename(2)` and then left exactly as it was, byte for byte, including its
 * sidecars. Nothing in this file calls `Store.open`, `openDb`, `rm`, `unlink` or
 * `cp` on anything at all. The only mutating call it makes is `rename`.
 *
 * Which is also why the command works on CUT-OVER DAY, when the running build
 * REFUSES the store on disk by name (`STORE_PRE_ROWS`, F5): a rename does not
 * care what floor a directory is on. For the same reason the question "is there
 * a store here?" is asked as **does this directory exist and hold anything**,
 * never `storeExists()` — that one looks for the canonical database by NAME, and
 * the name changes with the floor, so on cut-over day it would answer "no store
 * here" about the very store this command exists to protect.
 *
 * **Why the configuration decides which store, and `--dir` is refused.** The
 * store that matters is the one the HOOKS and the MCP SERVER open, and that is
 * `dataDir` in `claude-code.json` — nothing else. A `--dir` on this command line
 * would be a second answer to "which store", which is the `--dirr` scar
 * (`commands.ts#COMMAND_FLAGS`) pointed at the most dangerous verb in the
 * package. So it is refused by name rather than quietly ignored.
 *
 * **Why the new store lands at the SAME path.** The floor plan's step 5 made a
 * `store-v2` beside the old one and re-ran `claude mcp add`. Parking in place
 * instead means `dataDir` does not move, so the configuration is kept
 * byte-for-byte, the MCP registration (`-e COUNTERPARTS_DATA_DIR=<store>`) still
 * names the right path, and there is no re-registration step to forget — which
 * was named as failure mode (b) of the clean cut.
 *
 * **What a kill can leave behind.** The snapshots directory is parked FIRST and
 * the store SECOND, so the only window in which the configuration names a
 * directory that is not there is between the store's rename and the blank
 * store's creation, which is two syscalls wide — and the rollback lines are
 * printed BEFORE the first rename, so even a kill inside that window leaves the
 * way back on the screen. A later run reads the ground and finishes.
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";

// `preRowsMarkersIn` reads FILENAMES and opens nothing — which is the only
// reason this module may call it. It is how the plan can say which floor the
// store being parked is on without going anywhere near its database.
import {
  PRE_ROWS_READABLE_BY,
  assertSafeDataDir,
  dateOf,
  isWithin,
  preRowsMarkersIn,
} from "../../core/store/index.js";
import { SESSIONS_DIR } from "../sessions.js";

/** The infix a parked directory wears: `store.parked-2026-09-20`. */
export const PARKED_INFIX = "parked";

/** And the one the BLANK store wears when a rollback parks it in turn. */
export const BLANK_INFIX = "blank";

/**
 * How recently something must have touched the store for this command to call
 * it open.
 *
 * It is short on purpose. A crashed session leaves a record behind, and a
 * window measured in hours (`sessions.ts#SESSION_TTL_MS` is four of them) would
 * lock the owner out of his own cut-over until it expired. Ten minutes is long
 * enough that a session anybody is actually using has touched a boundary or a
 * `-wal` inside it, and short enough that yesterday's crash is not an obstacle.
 *
 * **It is a floor on the evidence, never a proof of the absence.** A Claude Code
 * session sitting idle with its MCP server attached writes nothing and is
 * invisible here. That is exactly why the confirmation below exists and says so
 * in those words: the check catches the obvious case, the human catches the
 * rest.
 */
export const OPEN_WINDOW_MS = 10 * 60_000;

// ── what is on the ground ───────────────────────────────────────────────────

export interface DirSighting {
  readonly path: string;
  /** The directory is there. `lstat`, so a symlink counts as present. */
  readonly present: boolean;
  /** It is a symbolic link rather than a directory. Refused; see `parkRefusal`. */
  readonly symlink: boolean;
  /** How many entries it holds. 0 for an absent one, and for an empty one. */
  readonly entries: number;
}

/**
 * Is there something here, and what is it? FLOOR-AGNOSTIC BY CONSTRUCTION: it
 * asks the filesystem, never the store, so an old-floor store, a half-restored
 * copy and a store from a build nobody has written yet all read the same.
 */
export function sight(path: string): DirSighting {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return { path, present: false, symlink: false, entries: 0 };
  }
  if (stat.isSymbolicLink()) return { path, present: true, symlink: true, entries: 0 };
  if (!stat.isDirectory()) return { path, present: true, symlink: false, entries: 0 };
  let entries = 0;
  try {
    entries = readdirSync(path).length;
  } catch {
    // Unreadable is not empty. Treated as holding something, which is the
    // direction that parks rather than overwrites.
    entries = 1;
  }
  return { path, present: true, symlink: false, entries };
}

/**
 * Why this directory may not be parked, or null.
 *
 * Every clause is the same mistake in a different costume: a path that turns
 * out to name somewhere that matters. The forbidden-root check runs on BOTH
 * spellings — the path as the configuration wrote it, and the path it actually
 * reaches — which is the lesson the F2 adversarial review taught
 * (`adapters/snapshots.ts#assertRotatableDir`): `assertSafeDataDir` is pure
 * string math and follows no links, so a `dataDir` that is a symlink into
 * `~/.bansai` clears it on the written spelling alone.
 *
 * A SYMLINK IS REFUSED OUTRIGHT rather than followed or renamed. Renaming a
 * symlink moves the LINK: the real store would stay where it is, unparked,
 * while a fresh empty directory appeared at the name the configuration points
 * at — the old memories still live, still written to by anything holding them
 * open, and no longer reachable by the configuration. That is the one outcome
 * worse than refusing.
 */
export function parkRefusal(
  label: string,
  path: string,
  configPath: string,
  home: string = homedir(),
): string | null {
  const written = resolve(path);
  // As WRITTEN first, so the sentence names what the owner typed...
  const forbidden = forbiddenRefusal(label, written);
  if (forbidden !== null) return forbidden;
  // ...and then as it RESOLVES, which is the spelling that decides where a
  // rename would actually land.
  const real = realpathDeep(written);
  const forbiddenReal = forbiddenRefusal(label, real);
  if (forbiddenReal !== null) return forbiddenReal;

  if (real === parsePath(real).root) {
    return `refused: the ${label} resolves to a filesystem root (${real}). Nothing here will rename that.`;
  }
  if (real === realpathDeep(home)) {
    return `refused: the ${label} resolves to your home directory (${real}). Nothing here will rename that.`;
  }
  if (isWithin(written, configPath)) {
    return (
      `refused: the ${label} at ${written} CONTAINS the configuration ${configPath}. ` +
      "Parking it would move the file that says where your memory is, and the hooks would " +
      "read a path that is no longer there. The store belongs one level below the " +
      "configuration (`install` puts it there); move it before starting fresh."
    );
  }
  const seen = sight(path);
  if (seen.symlink) {
    let target = "somewhere else";
    try {
      target = realpathDeep(written);
    } catch {
      /* the sentence is about the link, not the target */
    }
    return (
      `refused: the ${label} at ${written} is a SYMBOLIC LINK (to ${target}). ` +
      "Renaming a link moves the link and leaves the real directory exactly where it is — " +
      "so the memories would stay live, still open to anything holding them, and no longer " +
      "reachable from your configuration. Park the real directory by hand, or point " +
      `"dataDir" at it directly.`
    );
  }
  return null;
}

function forbiddenRefusal(label: string, path: string): string | null {
  try {
    assertSafeDataDir(path);
    return null;
  } catch (err) {
    const root =
      err !== null && typeof err === "object" && "detail" in err
        ? String((err as { detail: Record<string, unknown> }).detail["root"] ?? "a live store")
        : "a live store";
    return (
      `refused by name: the ${label} (${path}) is inside ${root}. ` +
      "That is a live memory this package never touches — not to read it, not to move it, " +
      "not to rename it (CLAUDE.md, the second safety rule)."
    );
  }
}

/**
 * THE ONE GUARD RING, and the reason it is one function.
 *
 * The confirmation review found `--undo` renaming directories inside `~/.bansai`
 * — one command after the forward direction refused the same path, in those
 * exact words, on the same screen. Not because the refusals were wrong, but
 * because `--undo` was new code that called none of them. Two directions, two
 * sets of checks, and only one of them maintained.
 *
 * So there is one function now, and **every path either direction would rename
 * goes through it**: the store, a parked store read out of a record, a parked
 * snapshots folder. It is the whole battery in the order that matters —
 * present, absolute, not a forbidden root by either spelling, not a filesystem
 * root, not the home directory, not a directory containing the configuration,
 * not a symlink.
 *
 * `source` is where the path came from, because the sentence differs: a bad
 * `dataDir` is a configuration to fix; a bad recorded path is a row in a
 * database that should not have been trusted.
 */
export function pathGuard(
  label: string,
  written: string,
  configPath: string,
  home: string = homedir(),
  source = "the configuration",
): string | null {
  const raw = written.trim();
  if (raw.length === 0) {
    return `refused: ${source} gives no path for the ${label}, so there is nothing to act on.`;
  }
  if (!isAbsolute(raw)) {
    return (
      `refused: ${source} names "${raw}" as the ${label}, which is not an absolute path. ` +
      "`install` always writes an absolute one, and for a reason: the hook, the worker and " +
      "the MCP server are launched by a host from a working directory nobody chose, so a " +
      "relative path names a different directory in every one of them — and this would act " +
      `on whatever happened to sit at that name in ITS working directory (${resolve(raw)}). ` +
      "A leading `~` is a shell's idea, not a path."
    );
  }
  return parkRefusal(label, raw, configPath, home);
}

/**
 * Why this path is not a PARKED SIBLING of that store, or null.
 *
 * **The record is a row in a database.** `store.previous.parked` lives in the
 * new store's `meta` table, and anything that can open the store can write it —
 * the review rewrote it to `~/.bansai/store` and watched `--undo` rename v1's
 * live memory onto `dataDir`, and to `dirname(storeDir)` to get a directory
 * planned into its own child. A value read back out of a store is data, never
 * an instruction.
 *
 * So the shape is pinned rather than trusted: it must sit in the SAME directory
 * as the store, and its name must be exactly the name this package writes —
 * `<base>.parked-<date>` with an optional `-N`. `planUndo`'s own fallback only
 * ever produces those; this makes a recorded value obey the rule the fallback
 * already obeys.
 */
export function parkedSiblingRefusal(
  label: string,
  candidate: string,
  beside: string,
  base: string,
): string | null {
  const path = resolve(candidate);
  if (dirname(path) !== resolve(beside)) {
    return (
      `refused: the ${label} recorded in this store is ${path}, which does not sit beside ` +
      `${resolve(beside)}. A record is a row in a database, not an instruction — anything it ` +
      "names that is not a parked directory of this store is not a thing to rename."
    );
  }
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\.${PARKED_INFIX}-\\d{4}-\\d{2}-\\d{2}(-\\d+)?$`);
  if (!pattern.test(basename(path))) {
    return (
      `refused: the ${label} recorded in this store is ${path}, and '${basename(path)}' is ` +
      `not a name this package writes — those are '${base}.${PARKED_INFIX}-<date>' with an ` +
      "optional '-N'. A record is a row in a database; this will not rename something " +
      "because a row said to."
    );
  }
  return null;
}

/**
 * The real path of a directory that may not exist yet — the same helper
 * `adapters/snapshots.ts` carries, and for the same reason: `resolve` follows no
 * links and `realpathSync` throws on a path that is not there, and both cases
 * are ordinary here (macOS spells `$TMPDIR` through a symlink, and the
 * snapshots directory does not exist before the first copy).
 */
export function realpathDeep(path: string): string {
  const resolved = resolve(path);
  let head = resolved;
  const tail: string[] = [];
  for (;;) {
    try {
      // `realpathSync` is a READ of a path, never an open of a database.
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

// ── the parked name ─────────────────────────────────────────────────────────

/**
 * `<path>.<infix>-<date>`, with `-2`, `-3` … if that is taken.
 *
 * The date is the store's own UTC calendar date (`dateOf`), the same spelling
 * every other date in this tree uses, so a parked directory sorts beside the
 * snapshots and the journal entries of the day it was parked.
 *
 * `taken` is injected so the choice is provable without a filesystem, and so a
 * caller can ask the question twice — once when it prints the plan and once
 * after the human has confirmed it, because a name that was free before
 * somebody went to make coffee may not be free after (scar §2.13).
 */
export function parkedPath(
  path: string,
  infix: string,
  date: string,
  taken: (candidate: string) => boolean = existsSync,
): string {
  const base = `${resolve(path)}.${infix}-${date}`;
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${String(n)}`;
    if (!taken(candidate)) return candidate;
  }
  // A thousand parked stores in one day is not a case worth guessing at.
  throw new Error(`no free parked name beside ${path} for ${date}`);
}

// ── who has it open ─────────────────────────────────────────────────────────

export interface OpenSign {
  /** `session <id>` or the sidecar's file name. */
  readonly what: string;
  /** Where it was seen, in plain words. */
  readonly where: string;
  readonly agoMs: number;
}

export interface Liveness {
  /** Evidence good enough to REFUSE on: a session the host has not ended whose
   *  hooks ran inside the window. */
  readonly signs: readonly OpenSign[];
  /** Evidence good enough to SAY, and not to refuse on: something wrote to the
   *  store recently, which may well have been the reader's own last command. */
  readonly recent: readonly OpenSign[];
  /** True when the sessions directory could not be read at all — not a refusal:
   *  an unreadable registry is no evidence either way, and the confirmation is
   *  what stands between this command and an open session regardless. */
  readonly unreadable: boolean;
}

/**
 * Cheap, honest evidence that something still has this store open — split into
 * what is worth REFUSING on and what is only worth SAYING.
 *
 * Two sources, both READS OF METADATA — a `readdir`, a `stat`, and one small
 * JSON file per live session. Neither opens a database.
 *
 *   1. **The live-session registry** (`<store>/sessions/<id>.json`): host state
 *      the hooks leave for the MCP server. A record with no `endedAt` whose last
 *      boundary is inside the window is a session whose hooks — and whose MCP
 *      server — are very likely still attached. **This is the refusal.**
 *
 *   2. **A fresh `-shm`.** Measured on this build, 2026-09-20: under `bun:sqlite`
 *      the `-wal` and the `-shm` SURVIVE a clean close — a store that nothing has
 *      open still has both, with the mtime of whatever last wrote. So a fresh
 *      `-shm` does NOT mean a connection is open; it means something wrote
 *      recently, and on this command line the likeliest something is the
 *      owner's own `doctor` a minute ago. Refusing on it made `start-fresh`
 *      refuse itself in testing. It is reported, in the sentence above the
 *      confirmation, and it is not a refusal. Matched by SUFFIX, never by
 *      database name, because the name changes with the floor.
 *
 * What neither can see is said out loud wherever they are printed: an idle open
 * session writes nothing at all.
 */
export function readLiveness(
  storeDir: string,
  now: number,
  windowMs: number = OPEN_WINDOW_MS,
): Liveness {
  const signs: OpenSign[] = [];
  const recent: OpenSign[] = [];
  let unreadable = false;

  const sessions = join(storeDir, SESSIONS_DIR);
  let names: string[];
  try {
    names = readdirSync(sessions);
  } catch {
    names = [];
    // An ABSENT sessions directory is ordinary — a store nothing has ever run
    // against has none. `unreadable` is reserved for one that is THERE and
    // would not list, because that is the source that could have answered and
    // did not.
    unreadable = existsSync(sessions);
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(sessions, name), "utf8"));
    } catch {
      continue;
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    if (rec["endedAt"] !== null && rec["endedAt"] !== undefined) continue;
    const last = rec["lastBoundaryAt"];
    if (typeof last !== "number") continue;
    const agoMs = now - last;
    if (agoMs > windowMs || agoMs < -windowMs) continue;
    const id = typeof rec["sessionId"] === "string" ? rec["sessionId"] : name.replace(/\.json$/, "");
    const scope = typeof rec["scope"] === "string" ? rec["scope"] : "an unrecorded directory";
    signs.push({ what: `session ${id}`, where: scope, agoMs });
  }

  for (const path of sidecarCandidates(storeDir)) {
    try {
      const agoMs = now - statSync(path).mtimeMs;
      if (agoMs > windowMs || agoMs < -windowMs) continue;
      recent.push({ what: basename(path), where: dirname(path), agoMs });
    } catch {
      continue;
    }
  }
  return { signs, recent, unreadable };
}

/** Every `-shm` at the top of the store and inside `cache/`. Suffix, never name:
 *  the database is renamed by the floor and this check must not go with it. */
function sidecarCandidates(storeDir: string): string[] {
  const out: string[] = [];
  for (const dir of [storeDir, join(storeDir, "cache")]) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith("-shm")) out.push(join(dir, entry.name));
      }
    } catch {
      continue;
    }
  }
  return out;
}

// ── the plan ────────────────────────────────────────────────────────────────

export interface ParkStep {
  /** What is being moved, in the words the output uses. */
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export type StartFreshShape =
  /** A store is there and will be parked. The ordinary case. */
  | "park"
  /** Nothing to park: no store directory, or an empty one. It is just an install. */
  | "nothing-to-park"
  /** The store directory is gone and something is parked beside it: a previous
   *  run was interrupted between the rename and the creation. Finish it. */
  | "resume";

export interface StartFreshPlan {
  readonly shape: StartFreshShape;
  readonly configPath: string;
  readonly configPresent: boolean;
  readonly storeDir: string;
  readonly date: string;
  /** Snapshots first, store second. Empty for `nothing-to-park` and `resume`. */
  readonly parks: readonly ParkStep[];
  /** Already-parked directories a resume found, for the report. */
  readonly alreadyParked: readonly string[];
  /** The snapshots directory, when it is the one beside the store. */
  readonly snapshotsDir: string | null;
  /** Said when `snapshots.dir` points somewhere this command will not touch. */
  readonly snapshotsElsewhere: string | null;
  /**
   * Why the snapshots folder beside the store is being LEFT rather than parked,
   * or null when there is nothing to say. A symlinked `snapshots` used to refuse
   * the whole command (review m2) — symlinking a backup folder onto an external
   * disk is an ordinary thing to have done, and there is no way through except
   * editing the configuration. It is now treated exactly as a configured
   * `snapshots.dir` is: left alone, and said out loud. The store still moves.
   */
  readonly snapshotsLeft: string | null;
  /** Part-built `store.new-<pid>` siblings an interrupted run left behind.
   *  Named, never adopted and never deleted (confirmation review MINOR-5). */
  readonly strayTempStores: readonly string[];
  /** How many entries the store being parked holds. `--yes` is refused on a
   *  non-empty one (review m1's corollary): the typed confirmation is the only
   *  instrument that can catch an idle dashboard. */
  readonly storeEntries: number;
  /**
   * The pre-rows marker filenames found in the store being parked, or empty.
   *
   * This is **cut-over day, named**: a store holding `prose/`, `versions/` or
   * `operational.sqlite` was written by a build before F5, and the build
   * running this command refuses to open it (`STORE_PRE_ROWS`). That refusal is
   * the right one and this command never reaches it — but a reader who has just
   * seen it from `status` or from a hook deserves to be told that this is the
   * same fact, and that it is the reason parking rather than touching is the
   * whole move. Filenames only; nothing is opened to learn it.
   */
  readonly preRowsMarkers: readonly string[];
  readonly liveness: Liveness;
  readonly refusal: string | null;
}

export interface PlanInput {
  readonly configPath: string;
  readonly configPresent: boolean;
  /** `dataDir` exactly as the configuration holds it. */
  readonly dataDir: string | undefined;
  /** `snapshots.dir` from the configuration, when it names one. */
  readonly snapshotsConfigured: string | undefined;
  readonly now: number;
  readonly home?: string;
  /** Injected by the tests that prove the name choice without a filesystem. */
  readonly taken?: (candidate: string) => boolean;
}

/**
 * Read the ground, decide the renames, and collect every reason not to.
 *
 * Pure but for the reads: it stats, lists and parses, and it changes nothing.
 * `commands.ts` calls it TWICE — once to print, once after the confirmation —
 * so it must be safe to call as often as anyone likes.
 */
export function planStartFresh(input: PlanInput): StartFreshPlan {
  const date = dateOf(input.now);
  const home = input.home ?? homedir();
  const configPath = resolve(input.configPath);
  const empty = {
    shape: "nothing-to-park" as StartFreshShape,
    configPath,
    configPresent: input.configPresent,
    date,
    parks: [] as ParkStep[],
    alreadyParked: [] as string[],
    snapshotsDir: null,
    snapshotsElsewhere: null,
    snapshotsLeft: null,
    strayTempStores: [] as string[],
    storeEntries: 0,
    preRowsMarkers: [] as string[],
    liveness: { signs: [], recent: [], unreadable: false } as Liveness,
  };

  // A CONFIGURATION THAT IS THERE AND NAMES NO STORE IS A REFUSAL, not a guess.
  // The hooks fall back to `COUNTERPARTS_DATA_DIR` when the file names no store
  // (`claude-code/bin/hook.ts`), so "the store the hooks open" is a fact about
  // somebody's shell rather than about this file — and guessing `<base>/store`
  // would park a directory nobody pointed at.
  if (input.configPresent && (input.dataDir === undefined || input.dataDir.trim().length === 0)) {
    return {
      ...empty,
      storeDir: "",
      refusal:
        `refused: ${configPath} names no "dataDir", so there is no way to know which store your ` +
        "hooks open — with that key absent they fall back to $COUNTERPARTS_DATA_DIR, which is a " +
        'fact about a shell rather than about this file. Add "dataDir": "<absolute path>" to the ' +
        "configuration first (that is what `counterparts install` writes), then run this again.",
    };
  }

  // A `dataDir` THAT IS NOT ABSOLUTE IS REFUSED BY NAME (review M5).
  //
  // `resolve()` is relative to the PROCESS WORKING DIRECTORY and does not expand
  // `~`, and `loadConfig` accepts any string — so `"relative-store"` renamed an
  // unrelated directory that happened to sit in the shell's cwd and reported
  // success, and `"~/.counterparts/store"` created a literal `~` directory and
  // left the real store untouched and unmentioned. Both were measured. A path
  // that means a different directory in every process that reads it is not a
  // path this command will act on.
  const written = input.dataDir === undefined ? "" : input.dataDir.trim();
  const storeDir = written.length > 0 && isAbsolute(written) ? resolve(written) : "";

  // No configuration at all: a machine that has never had an install. Nothing
  // is parked, and the command is an ordinary first `install` that says so.
  if (!input.configPresent) {
    return { ...empty, storeDir, refusal: null };
  }

  // THE SHARED RING (`pathGuard`), so this direction and `--undo` cannot drift.
  const refusal = pathGuard("store", written, configPath, home, `${configPath}'s "dataDir"`);
  if (refusal !== null) {
    return { ...empty, storeDir, shape: "park", refusal };
  }

  const store = sight(storeDir);
  // WHERE THE SNAPSHOTS ARE IS THE SNAPSHOT MODULE'S QUESTION, asked in its own
  // words rather than by rebuilding the rule here: the default is a sibling of
  // the store, and a configured `snapshots.dir` is a directory the OWNER pointed
  // at, which this command leaves alone and says so.
  const beside = join(dirname(storeDir), "snapshots");
  const configured = input.snapshotsConfigured;
  const snapshotsElsewhere =
    configured !== undefined && configured.trim().length > 0 && resolve(configured) !== beside
      ? resolve(configured)
      : null;
  const snapshotsDir =
    snapshotsElsewhere === null && basename(storeDir) === "store" ? beside : null;

  const taken = input.taken ?? existsSync;

  if (!store.present || store.entries === 0) {
    // Nothing to park. Two readings, and the difference matters to the reader:
    // a store that was never there, and one a previous run already moved.
    const parked = siblingsParked(storeDir, taken);
    return {
      ...empty,
      storeDir,
      snapshotsDir,
      snapshotsElsewhere,
      shape: parked.length > 0 && !store.present ? "resume" : "nothing-to-park",
      alreadyParked: parked,
      storeEntries: store.entries,
      refusal: null,
    };
  }

  // WHY THE SNAPSHOTS FOLDER IS NEVER A REASON TO REFUSE THE WHOLE COMMAND
  // (review m2). It used to be: a symlinked `~/.counterparts/snapshots` — an
  // external disk, an ordinary arrangement — refused everything, and the only
  // way through was editing the configuration. A snapshots folder this command
  // will not move is now treated exactly as a `snapshots.dir` pointed elsewhere
  // is: LEFT, and said out loud. The memory still moves, which is what the
  // owner came for; the copies stay where they are, which costs nothing but a
  // sentence.
  const snapshotsSeen = snapshotsDir === null ? null : sight(snapshotsDir);
  let snapshotsLeft: string | null = null;
  let parkSnapshots = false;
  if (snapshotsDir !== null && snapshotsSeen !== null && snapshotsSeen.present) {
    const why = parkRefusal("snapshots directory", snapshotsDir, configPath, home);
    if (why !== null) {
      snapshotsLeft = why;
    } else {
      // BOTH devices, before anything moves (review SHOULD 3). Only the store's
      // was compared, so a snapshots folder on another filesystem would have
      // failed its rename mid-run rather than refusing up front — and the store
      // is parked first only in the order, not in the decision.
      const cross = sameFilesystemRefusal(snapshotsDir);
      if (cross !== null) snapshotsLeft = cross;
      else parkSnapshots = true;
    }
  }

  const crossDevice = sameFilesystemRefusal(storeDir);
  if (crossDevice !== null) {
    return {
      ...empty,
      storeDir,
      snapshotsDir,
      snapshotsElsewhere,
      snapshotsLeft,
      shape: "park",
      refusal: crossDevice,
    };
  }

  // ONE SUFFIX FOR BOTH (review n3). The two used to pick `-N` independently,
  // so a second run the same day could leave `store.parked-D-2` beside
  // `snapshots.parked-D` — a pair that does not read as a pair. The suffix is
  // chosen once, against BOTH names, so they always match.
  const suffix = pairedSuffix(
    [storeDir, ...(parkSnapshots && snapshotsDir !== null ? [snapshotsDir] : [])],
    date,
    taken,
  );
  const parks: ParkStep[] = [];
  // SNAPSHOTS FIRST. A kill between the two renames then leaves the
  // configuration pointing at a store that is still there — the harmless order.
  if (parkSnapshots && snapshotsDir !== null) {
    parks.push({ label: "snapshots", from: snapshotsDir, to: `${snapshotsDir}${suffix}` });
  }
  parks.push({ label: "store", from: storeDir, to: `${storeDir}${suffix}` });

  return {
    shape: "park",
    configPath,
    configPresent: input.configPresent,
    storeDir,
    date,
    parks,
    alreadyParked: [],
    snapshotsDir,
    snapshotsElsewhere,
    snapshotsLeft,
    strayTempStores: strayTempStoresBeside(storeDir),
    storeEntries: store.entries,
    // Names only. Never an open — that is the whole point of the refusal this
    // reading is about.
    preRowsMarkers: preRowsMarkersIn(storeDir),
    liveness: readLiveness(storeDir, input.now),
    refusal: null,
  };
}

/**
 * Why this rename cannot be atomic, or null.
 *
 * `rename(2)` is atomic within one filesystem and fails with `EXDEV` across
 * two. A store that is itself a mount point — an external disk, a network
 * volume, a container bind — is exactly that case, and the alternative
 * (copy-then-delete) is the one thing this command may never do. So it is
 * measured BEFORE anything moves, by comparing device numbers, and refused with
 * the reason rather than discovered halfway through.
 */
export function sameFilesystemRefusal(storeDir: string): string | null {
  let here: number;
  let parent: number;
  try {
    here = statSync(storeDir).dev;
    parent = statSync(dirname(storeDir)).dev;
  } catch (err) {
    return `refused: could not read ${storeDir} or its parent (${String((err as Error).message ?? err)}).`;
  }
  if (here === parent) return null;
  return (
    `refused: ${storeDir} is on a different filesystem from ${dirname(storeDir)}, so moving it ` +
    "beside itself would be a COPY followed by a DELETE rather than one atomic rename — and this " +
    "command does not delete, ever. Move the store by hand with a tool you trust, verify the copy, " +
    `and point "dataDir" at whatever you want the new store to be.`
  );
}

/**
 * The ONE suffix both parked directories wear — `.parked-<date>`, with `-2`,
 * `-3` … when any of the names it would produce is taken.
 *
 * Asked of every path at once rather than of each in turn, so the store and its
 * snapshots always land on matching names (review n3).
 */
export function pairedSuffix(
  paths: readonly string[],
  date: string,
  taken: (candidate: string) => boolean = existsSync,
): string {
  const free = (suffix: string): boolean => paths.every((p) => !taken(`${resolve(p)}${suffix}`));
  const base = `.${PARKED_INFIX}-${date}`;
  if (free(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    if (free(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
  }
  throw new Error(`no free parked suffix for ${date}`);
}

/** `store.new-*` siblings — what an interrupted run leaves. REPORTED only:
 *  `freeTempStore` never returns a name that exists, so one of these can never
 *  become somebody's store, and nothing here removes it. */
export function strayTempStoresBeside(storeDir: string): string[] {
  const out: string[] = [];
  try {
    const prefix = `${basename(storeDir)}.new-`;
    for (const entry of readdirSync(dirname(storeDir))) {
      if (entry.startsWith(prefix)) out.push(join(dirname(storeDir), entry));
    }
  } catch {
    return out;
  }
  return out.sort();
}

/** Parked siblings of a store path, newest name last. Used only to REPORT. */
function siblingsParked(storeDir: string, taken: (c: string) => boolean): string[] {
  const out: string[] = [];
  try {
    const prefix = `${basename(storeDir)}.${PARKED_INFIX}-`;
    for (const entry of readdirSync(dirname(storeDir))) {
      if (entry.startsWith(prefix)) out.push(join(dirname(storeDir), entry));
    }
  } catch {
    return out;
  }
  return out.filter((p) => taken(p)).sort();
}

// ── doing it ────────────────────────────────────────────────────────────────

/**
 * The filesystem, injected — ONE call, so a test can fail step N deterministically
 * and then prove that what is on disk is either the before or the after and never
 * a third thing.
 */
export interface StartFreshOps {
  readonly rename: (from: string, to: string) => void;
}

export const REAL_OPS: StartFreshOps = {
  rename: (from, to) => {
    renameSync(from, to);
  },
};

export interface ParkOutcome {
  readonly done: readonly ParkStep[];
  /** The step that failed, when one did. */
  readonly failed: ParkStep | null;
  readonly error: string | null;
}

/**
 * Perform the renames, in order, stopping at the first failure.
 *
 * It does exactly as many `rename` calls as there are steps and nothing else:
 * no mkdir, no chmod, no cleanup, no attempt to undo a rename that worked. An
 * "undo" here would be a second rename of a directory whose state nobody has
 * re-read, which is how a recovery path destroys what the failure left intact.
 * The caller prints what was done and what was not, and the rollback lines it
 * printed before starting are still correct.
 */
export function park(steps: readonly ParkStep[], ops: StartFreshOps = REAL_OPS): ParkOutcome {
  const done: ParkStep[] = [];
  for (const step of steps) {
    try {
      ops.rename(step.from, step.to);
      done.push(step);
    } catch (err) {
      const code =
        err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
          ? `${(err as { code: string }).code}: `
          : "";
      return { done, failed: step, error: `${code}${String((err as Error).message ?? err)}` };
    }
  }
  return { done, failed: null, error: null };
}

// ── what the owner reads ────────────────────────────────────────────────────

/** The plan, in the order it will happen. One line per rename, paths in full. */
export function planLines(plan: StartFreshPlan, landing?: string): string[] {
  const out: string[] = [];
  out.push(`Configuration: ${plan.configPath}${plan.configPresent ? "" : " (not there yet)"}`);
  // THE STORE LINE IS NEVER BLANK (review B1). It used to be, on the arm where
  // there was no configuration — and directly below it the install printed
  // "Store already present at …/store", naming the live store. Two sentences on
  // one screen contradicting each other, with the second one the true one.
  out.push(`Store:         ${plan.storeDir.length > 0 ? plan.storeDir : (landing ?? "(unknown)")}`);
  out.push("");
  if (plan.shape === "nothing-to-park") {
    out.push(
      plan.configPresent
        ? "Nothing to park: the store your configuration names is not there, or is empty."
        : "There is no configuration at that path, so there is nothing to park and nothing",
    );
    if (!plan.configPresent) {
      out.push("this command can call your memory. It will do an ordinary first install at the");
      out.push("store path above — and refuse if anything at all is already there.");
    } else {
      out.push("So this is an ordinary first install, and it says so rather than pretending");
      out.push("it moved something.");
    }
    return out;
  }
  if (plan.shape === "resume") {
    out.push("A previous run was interrupted: the store directory is gone and these are");
    out.push("parked beside it —");
    for (const p of plan.alreadyParked) out.push(`  ${p}`);
    out.push("");
    out.push("Nothing will be moved. This run only creates the blank store at the path");
    out.push("your configuration names, which is what that run had left to do.");
    return out;
  }
  out.push("It will rename, in this order — one atomic rename each, nothing copied,");
  out.push("nothing deleted, and the old store is never opened:");
  for (const step of plan.parks) {
    out.push(`  ${step.from}`);
    out.push(`    -> ${step.to}`);
  }
  out.push("");
  out.push("Then it will create a blank store at:");
  out.push(`  ${plan.storeDir}`);
  if (plan.strayTempStores.length > 0) {
    out.push("");
    out.push("  Beside your store are part-built stores from interrupted runs:");
    for (const stray of plan.strayTempStores) out.push(`    ${stray}`);
    out.push("  Nothing reads them, nothing here will use one, and nothing here will remove");
    out.push("  one. Move them aside whenever you like.");
  }
  if (plan.preRowsMarkers.length > 0) {
    out.push("");
    out.push("  This store is on the OLD FLOOR — it keeps its memories in files");
    out.push(`  (${plan.preRowsMarkers.join(", ")}).`);
    out.push("  This build cannot open it and refuses to try, by name, which is exactly why");
    out.push("  moving it is the right thing to do with it: a rename does not care what floor");
    out.push(`  a directory is on. The build that still reads it is tagged ${PRE_ROWS_READABLE_BY}.`);
  }
  if (plan.snapshotsElsewhere !== null) {
    out.push("");
    out.push(`  Snapshots are configured at ${plan.snapshotsElsewhere}, which is a directory`);
    out.push("  you pointed at rather than one this layout owns, so it is LEFT ALONE — and so");
    out.push("  is any `mirror`. The new store's rotation will share that folder with what is");
    out.push("  already in it: copies of an OLD-FLOOR store are recognised there and never");
    out.push("  deleted or counted, but copies this floor wrote do count toward `keep`, so the");
    out.push("  new store's oldest could rotate out sooner than you expect.");
  } else if (plan.snapshotsLeft !== null) {
    out.push("");
    out.push(`  The snapshots folder at ${plan.snapshotsDir ?? ""} is LEFT WHERE IT IS.`);
    out.push(`    ${plan.snapshotsLeft}`);
    out.push("  That is a reason not to MOVE it, not a reason to stop: your memory still");
    out.push("  moves, and the copies stay exactly where they are. The new store's rotation");
    out.push("  will share that folder with what is already in it.");
  } else if (plan.snapshotsDir === null) {
    out.push("");
    out.push("  No snapshots directory belongs to this layout (the store is not named");
    out.push("  'store' under a base directory), so there is none to park.");
  }
  return out;
}

/** The configuration's side of it — today, always "nothing changes". */
export function configLines(plan: StartFreshPlan): string[] {
  if (!plan.configPresent) {
    return [
      `  ${plan.configPath}: will be CREATED by the install below.`,
    ];
  }
  return [
    `  ${plan.configPath}: unchanged — "dataDir" already names ${plan.storeDir},`,
    "    and the blank store is created at that same path. Nothing in the file is",
    "    rewritten, so your credentials file, your ceiling and every other value",
    "    stay exactly as they are, byte for byte.",
  ];
}

/**
 * THE WAY BACK, AS SHELL LINES — and every one of them GUARDED, because plain
 * `mv` does the worst possible thing here.
 *
 * Measured on macOS (review M3): `mv src dst` where `dst` is an existing
 * DIRECTORY does not refuse and does not overwrite — it moves `src` INSIDE
 * `dst`, exit 0. `mv -n` behaves identically. On the real layout that put the
 * owner's parked memory at `store/store.parked-<date>`, and the live store then
 * stopped opening at all (`LAYOUT_UNCLASSIFIED`). Nothing was lost, and nothing
 * about that is obvious at 11pm.
 *
 * So each line tests its destination first and says what it is refusing.
 * Everything is double-quoted, so a path with a space in it survives the
 * copy-paste this text exists to be.
 *
 * `counterparts start-fresh --undo` does the same thing with the same
 * discipline and without the shell; these lines are the by-hand fallback, and
 * they are printed because a way back that depends on the program that just
 * moved your memory is not much of a way back.
 */
export function rollbackLines(
  plan: StartFreshPlan,
  taken: (candidate: string) => boolean = existsSync,
  opts: { readonly parkTheBlankStore?: boolean } = {},
): string[] {
  if (plan.parks.length === 0) return [];
  const out: string[] = [];
  // LINE 1 IS ONLY TRUE ONCE A BLANK STORE IS THERE (confirmation review
  // NIT-3). The install now runs BEFORE the parks, so a run interrupted during
  // it leaves the MEMORY at the store path — and line 1 would park it under a
  // name that says it is the empty one. Before anything moves, that line is
  // conditional and says so; afterwards, `printWayBack` emits it only when the
  // store actually moved.
  if (opts.parkTheBlankStore !== false) {
    out.push(guardedMove(plan.storeDir, parkedPath(plan.storeDir, BLANK_INFIX, plan.date, taken)));
  }
  for (const step of [...plan.parks].reverse()) out.push(guardedMove(step.to, step.from));
  return out;
}

/** One `mv` that refuses instead of nesting. Exported so the test can parse the
 *  printed line back out of real output and run it against a destination that
 *  exists — which is the only way to prove the guard rather than the intent. */
export function guardedMove(from: string, to: string): string {
  // The destination appears twice — once as an argument, once INSIDE the
  // message — so it is escaped twice over in different ways: `shell()` wraps it
  // in its own quotes, and `inner()` only escapes, because a second pair of
  // quotes inside an already-quoted string is how a path with a space in it
  // comes out mangled in the one sentence that has to be readable.
  // `if/then/else`, not `[ -e … ] && echo … || mv …`. Two reasons, and the
  // second is the sharp one. It exits NON-ZERO on a refusal, so a pasted block
  // stops at a `set -e` and a reader's `&&` chain does not sail past it
  // (confirmation review NIT-2). And the `&&/||` form has a trap of its own:
  // if the `echo` ever failed, the `||` would run the `mv` — the one thing the
  // guard exists to prevent.
  return (
    `  if [ -e ${shell(to)} ]; then echo "REFUSING: ${inner(to)} already exists — ` +
    `mv would put the source INSIDE it" >&2; false; else mv ${shell(from)} ${shell(to)}; fi`
  );
}

/** Escaped for use INSIDE an already-quoted shell string; adds no quotes. */
function inner(path: string): string {
  return path.replace(/(["\\$`])/g, "\\$1");
}

/** Always double-quoted: these lines are printed to be pasted, and a path with
 *  a space in it is not a reason for the way back to break. */
function shell(path: string): string {
  return `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}

// ── the way back, as a command ──────────────────────────────────────────────

export interface UndoStep {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export interface UndoPlan {
  readonly storeDir: string;
  /** The parked store this would put back. */
  readonly parked: string | null;
  /** A parked snapshots folder this will NOT move, because one is already back
   *  at the live name. Left, and said — never merged. */
  readonly snapshotsLeft?: string | null;
  /** Every parked sibling found, for the report when there is more than one. */
  readonly candidates: readonly string[];
  readonly steps: readonly UndoStep[];
  /** True when the store being restored was written before this build's floor —
   *  on cut-over day, undoing also means re-detaching the checkout. */
  readonly preRows: boolean;
  readonly refusal: string | null;
}

/**
 * The reverse of a run: park the blank store, put the parked one back, put the
 * snapshots back. Same discipline as the forward direction — one `rename` each,
 * nothing deleted, nothing opened, and a destination that already exists is a
 * REFUSAL rather than a merge.
 *
 * `parked` is normally read from the new store's own `store.previous.parked`
 * record, which names the directory THIS run parked. When that cannot be had —
 * an unopenable store, a record a kill never wrote — the caller passes null and
 * this falls back to the siblings on disk, refusing when there is more than one
 * rather than guessing (review M4: guessing picked an empty shell).
 */
export function planUndo(input: {
  /** `dataDir` EXACTLY as the configuration holds it — the guard needs the
   *  written spelling, not a resolved one. */
  readonly storeDir: string;
  readonly parked: string | null;
  readonly configPath: string;
  readonly now: number;
  readonly home?: string;
  readonly taken?: (candidate: string) => boolean;
}): UndoPlan {
  const taken = input.taken ?? existsSync;
  const home = input.home ?? homedir();
  const configPath = resolve(input.configPath);
  const storeDir = isAbsolute(input.storeDir.trim())
    ? resolve(input.storeDir.trim())
    : input.storeDir.trim();
  const date = dateOf(input.now);
  const candidates = isAbsolute(storeDir) ? siblingsParked(storeDir, taken) : [];
  const empty = {
    storeDir,
    parked: null,
    candidates,
    steps: [],
    snapshotsLeft: null,
    preRows: false,
  };

  // ── THE SAME RING THE FORWARD DIRECTION RUNS (confirmation review BLOCKER-1)
  //
  // This is the whole finding. `--undo` used to go from `resolve(dataDir)`
  // straight to `existsSync` and `renameSync`, so a configuration the forward
  // command refuses BY NAME one command earlier — `dataDir` inside `~/.bansai` —
  // was renamed twice by the command whose job is being the safe way back.
  const storeRefusal = pathGuard(
    "store",
    input.storeDir,
    configPath,
    home,
    `${configPath}'s "dataDir"`,
  );
  if (storeRefusal !== null) return { ...empty, refusal: storeRefusal };

  let parked = input.parked === null ? null : resolve(input.parked);
  if (parked === null) {
    if (candidates.length === 0) {
      return {
        ...empty,
        refusal:
          `refused: nothing beside ${storeDir} is a parked store, and the store that is there ` +
          "carries no record of one. There is nothing to undo.",
      };
    }
    if (candidates.length > 1) {
      return {
        ...empty,
        refusal:
          `refused: ${String(candidates.length)} parked stores sit beside ${storeDir} and the ` +
          "store that is there does not say which one it replaced, so this will not guess — " +
          "guessing is how an empty shell gets named as somebody's memory. They are:\n" +
          candidates.map((c) => `    ${c}`).join("\n") +
          "\n  Move the one you want back by hand; the printed lines from the run that made " +
          "it are the exact way, and each is guarded.",
      };
    }
    parked = candidates[0] ?? null;
  }
  if (parked === null || !taken(parked)) {
    return { ...empty, refusal: `refused: ${String(parked)} is not there.` };
  }

  // THE RECORDED PATH GOES THROUGH THE RING TOO, and then through the shape
  // rule — a row in a database may name anything at all.
  const parkedRefusal =
    pathGuard("parked store", parked, configPath, home, "the record in this store") ??
    parkedSiblingRefusal("parked store", parked, dirname(storeDir), basename(storeDir));
  if (parkedRefusal !== null) return { ...empty, refusal: parkedRefusal };

  const steps: UndoStep[] = [];
  const store = sight(storeDir);
  if (store.present) {
    // THE BLANK STORE IS PARKED, NEVER REMOVED — the same rule as everything
    // else here. An undo that deleted would be the one delete in the command.
    steps.push({
      label: "the store that is there now",
      from: storeDir,
      to: parkedPath(storeDir, BLANK_INFIX, date, taken),
    });
  }
  steps.push({ label: "your parked memory", from: parked, to: storeDir });

  // The snapshots that went with it, by the suffix the store wears.
  const suffix = basename(parked).slice(basename(storeDir).length);
  const snapshots = join(dirname(storeDir), "snapshots");
  const parkedSnapshots = `${snapshots}${suffix}`;
  let snapshotsLeft: string | null = null;
  // The snapshots folder is derived from the store's own suffix rather than
  // recorded, so it cannot be steered — but it is a rename, so it goes through
  // the same two checks anyway. A refusal here LEAVES it (m2's lesson) rather
  // than stopping the store from coming back.
  const snapshotsRefusal =
    pathGuard("parked snapshots", parkedSnapshots, configPath, home, "this store's layout") ??
    parkedSiblingRefusal("parked snapshots", parkedSnapshots, dirname(storeDir), "snapshots");
  if (taken(parkedSnapshots) && snapshotsRefusal !== null) {
    snapshotsLeft = parkedSnapshots;
  } else if (taken(parkedSnapshots)) {
    if (taken(snapshots)) {
      // Something put a snapshots folder back while the blank store was live —
      // the rotation does, at the first boundary. Moving the parked one onto it
      // would be the merge this command refuses everywhere else, and refusing
      // the WHOLE undo over a folder of copies would be m2's mistake again. It
      // is left, and said.
      snapshotsLeft = parkedSnapshots;
    } else {
      steps.push({ label: "its snapshots", from: parkedSnapshots, to: snapshots });
    }
  }

  return {
    storeDir,
    parked,
    candidates,
    steps,
    snapshotsLeft,
    // Filenames only. Nothing is opened, here least of all.
    preRows: preRowsMarkersIn(parked).length > 0,
    refusal: null,
  };
}

/** What `--undo` prints before it moves anything. */
export function undoLines(plan: UndoPlan): string[] {
  const out = [`Store:  ${plan.storeDir}`, `Parked: ${plan.parked ?? "(none found)"}`, ""];
  if (plan.steps.length === 0) return out;
  out.push("It will rename, in this order — one atomic rename each, nothing copied,");
  out.push("nothing deleted, and nothing opened:");
  for (const step of plan.steps) {
    out.push(`  ${step.label}`);
    out.push(`    ${step.from}`);
    out.push(`      -> ${step.to}`);
  }
  if (plan.snapshotsLeft !== undefined && plan.snapshotsLeft !== null) {
    out.push("");
    out.push(`  ${plan.snapshotsLeft} is LEFT WHERE IT IS: a snapshots`);
    out.push("  folder is already back at the live name, and moving one onto the other is");
    out.push("  the merge this refuses everywhere else. Your copies are in both.");
  }
  if (plan.preRows) {
    out.push("");
    out.push("  THE STORE COMING BACK IS ON THE OLD FLOOR. This build cannot open it, so");
    out.push("  putting it back is only half the undo: the checkout has to go back too —");
    out.push(`    tools/deploy-checkout.sh --repo <your checkout> --ref ${PRE_ROWS_READABLE_BY}`);
    out.push("  and then restart Claude Code. Until that happens every session will stand");
    out.push("  down against this store, loudly and harmlessly.");
  }
  return out;
}

/** What the confirmation asks to be typed back: the parked store's own name. */
export function confirmationWord(plan: StartFreshPlan): string {
  const store = plan.parks.find((p) => p.label === "store");
  return store === undefined ? "" : basename(store.to);
}
