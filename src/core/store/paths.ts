/**
 * Where the data dir is, what lives in it, and which of it is backed up.
 *
 * `dataDir()` reads the environment AT CALL TIME (never at module load) so a test
 * can redirect it per test — the hermetic-test rule in CLAUDE.md depends on this.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, relative, isAbsolute } from "node:path";
import { StoreError, isStoreError } from "./errors.js";

export const DATA_DIR_ENV = "COUNTERPARTS_DATA_DIR";
/**
 * THE EXPLICIT-DIR GUARD. Armed (`1`, `true` or `on`), it makes `dataDir()` REFUSE
 * its fallback instead of returning `~/.counterparts/store`: a caller who named
 * no directory — no `dir`, no `COUNTERPARTS_DATA_DIR` — gets
 * `IMPLICIT_DEFAULT_DIR_REFUSED` and nothing opens. Unset — or set to `0`, `false`
 * or `off` — nothing changes. A value that is neither is REFUSED rather than
 * read as off (`EXPLICIT_DIR_ARMING_VALUES` below).
 *
 * Why it exists (LAUNCH-STATUS I21, owner ruling 2026-09-05): on the owner's
 * machine the fallback IS his live memory, and a library caller reached it
 * overnight by passing the wrong option name — `dir` was undefined, the default
 * answered, and nine titles were read out of the live store. `.counterparts`
 * cannot go on `FORBIDDEN_ROOT_NAMES` (the store must open its own default), so
 * the guard is opt-in: OFF by default so every installed host behaves exactly as
 * before, ON wherever this repo's own tooling runs — `test/preload.ts`, the demo
 * seeder, the visual loop, the recall bench, and the agent shells the owner
 * ruled it into. The install loop deliberately UNSETS it inside its clean room
 * (`tools/install-loop/run.sh`): its fake HOME makes the default throwaway, and
 * it measures a stranger's environment, which has no such variable.
 *
 * `adapters/config-path.ts#implicitConfigRefusal` is the same guard at the other
 * door: a default-sourced `~/.counterparts/claude-code.json` NAMES a store, so the
 * hook, the worker and the MCP server reach the live one without ever calling
 * `dataDir()`, and `install` writes under that base.
 */
export const REQUIRE_EXPLICIT_DIR_ENV = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";
export const DEFAULT_DATA_DIR_NAME = ".counterparts";
/**
 * The STORE sits one level below the base dir. The base dir belongs to the host
 * adapters (configuration, credentials); the store classifies every top-level
 * entry it holds and refuses an unclassified one at open (§5 G11), so a store
 * that IS the base dir cannot open once a host has written its config there.
 * Ruled by the owner 2026-09-04 after the launch inventory reproduced it.
 */
export const DEFAULT_STORE_SUBDIR = "store";

/** The directory the snapshots live in, beside the store rather than inside it. */
export const SNAPSHOTS_DIR_NAME = "snapshots";

/**
 * The default snapshots directory for a store: a sibling of it, but only inside
 * the layout this package creates (`<base>/store` → `<base>/snapshots`). A store
 * somebody pointed at an arbitrary directory has no default, and null says so.
 */
export function defaultSnapshotsDir(storeDir: string): string | null {
  const store = resolve(storeDir);
  if (basename(store) !== DEFAULT_STORE_SUBDIR) return null;
  return join(dirname(store), SNAPSHOTS_DIR_NAME);
}

/**
 * The canonical database's file name (owner ruling 5, 2026-09-18).
 *
 * It was `operational.sqlite` while the memories themselves were markdown files
 * beside it and the database held "the operational bits". Once the bodies are
 * rows the name stops being true, and a name that lies is a name somebody will
 * one day act on. There is no migration to worry about: the cut-over starts a
 * blank store, and a directory holding the OLD name is refused by name before
 * anything opens it (`STORE_PRE_ROWS`, `store/index.ts`).
 *
 * Spelled once. `LAYOUT` and `paths.operational` both read it, and
 * `adapters/snapshots.ts` takes it from `basename(paths.operational("."))`
 * rather than typing it a second time.
 */
export const DATABASE_FILE = "counterparts.sqlite";

/**
 * Roots this repo may never write into: v1's live memory and its ancestor.
 * (CLAUDE.md "never touch the live stores"; scar §2.13 — a path guard resolves
 * both sides before it compares, so `~/.bansai/../.bansai/x` is caught too.)
 */
export const FORBIDDEN_ROOT_NAMES = [".bansai", ".claude-engram"] as const;

export function forbiddenRoots(): string[] {
  const home = homedir();
  return FORBIDDEN_ROOT_NAMES.map((n) => resolve(join(home, n)));
}

/** True when `child` is `parent` or lives underneath it. Both sides resolved first. */
export function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Throws rather than returning a path that points at a live v1 store. */
export function assertSafeDataDir(dir: string): string {
  const resolved = resolve(dir);
  for (const root of forbiddenRoots()) {
    if (isWithin(root, resolved)) {
      throw new StoreError("DATA_DIR_FORBIDDEN", { root });
    }
  }
  return resolved;
}

/**
 * THE THREE READINGS OF THE SWITCH. Whitespace is trimmed and case is ignored on
 * all of them; blank is absent.
 *
 *   - `EXPLICIT_DIR_ARMING_VALUES` — the guard is on. It is a SUPERSET of the two
 *     `COUNTERPARTS_OBSERVER` accepts (`cli/commands.ts`,
 *     `mcp/bin/serve.ts#launchOptions` both match `"1"` and `"true"` exactly), so
 *     a person who exports `=true` by analogy IS protected. `COUNTERPARTS_OBSERVER`
 *     is deliberately NOT widened to match from here: it is read on the live MCP
 *     server's launch path, which this change promises to leave instruction-for-
 *     instruction identical, and giving it a fail-closed arm is its own ruling.
 *   - `EXPLICIT_DIR_DISARMING_VALUES` — the guard is off, exactly as if the
 *     variable were unset. A guard whose `=0` REFUSED would trip the shell of the
 *     person it protects, which is the surprising direction; `off` means off
 *     (owner ruling on the #80 review round).
 *   - anything else non-blank is REFUSED, never ignored. The #80 review measured
 *     `=true`, `=yes`, `=on` and `= 1` all falling silently to the default under
 *     the first draft, and falling open is the one failure direction a safety
 *     guard may not have. Junk is not "off"; junk is a question this will not
 *     answer.
 */
export const EXPLICIT_DIR_ARMING_VALUES: readonly string[] = ["1", "true", "on"];
export const EXPLICIT_DIR_DISARMING_VALUES: readonly string[] = ["0", "false", "off"];

export type ExplicitDirSetting =
  /** Armed; `value` is the trimmed text that armed it, so a refusal can quote it as typed. */
  | { readonly armed: true; readonly value: string }
  /** Not armed: `malformed` is null when the variable is absent, blank or a disarming value, else the text the guard refuses to guess at. */
  | { readonly armed: false; readonly malformed: string | null };

/** What the variable says, read without judgement. Pure; never throws. */
export function explicitDirSetting(
  env: Record<string, string | undefined> = process.env,
): ExplicitDirSetting {
  const value = (env[REQUIRE_EXPLICIT_DIR_ENV] ?? "").trim();
  if (value.length === 0) return { armed: false, malformed: null };
  const word = value.toLowerCase();
  if (EXPLICIT_DIR_ARMING_VALUES.includes(word)) return { armed: true, value };
  if (EXPLICIT_DIR_DISARMING_VALUES.includes(word)) return { armed: false, malformed: null };
  return { armed: false, malformed: value };
}

/**
 * True when the guard is armed. THROWS `EXPLICIT_DIR_GUARD_MALFORMED` on a value
 * it will not guess at — this is the guard's decision point, and it is exactly
 * where falling open would cost a live store. A caller who wants the reading
 * without the throw uses `explicitDirSetting`.
 */
export function explicitDirRequired(env: Record<string, string | undefined> = process.env): boolean {
  const setting = explicitDirSetting(env);
  if (!setting.armed && setting.malformed !== null) {
    throw new StoreError("EXPLICIT_DIR_GUARD_MALFORMED", {
      guard: REQUIRE_EXPLICIT_DIR_ENV,
      value: setting.malformed,
      accepted: EXPLICIT_DIR_ARMING_VALUES.join("|"),
      off: EXPLICIT_DIR_DISARMING_VALUES.join("|"),
    });
  }
  return setting.armed;
}

/** The sentence for a value the guard refuses to guess at. One copy, so the two doors say the same thing. */
export function explicitDirMalformedRefusal(value: string): string {
  return (
    `refused: ${REQUIRE_EXPLICIT_DIR_ENV} is set to '${value}', which this will not guess at — it arms on ` +
    `${EXPLICIT_DIR_ARMING_VALUES.join(", ")} and stands down on ${EXPLICIT_DIR_DISARMING_VALUES.join(", ")} ` +
    "(case and surrounding whitespace ignored), and a safety guard fails closed on anything else. " +
    "Unset it, set it to 1, or set it to 0."
  );
}

/**
 * The guard's two refusals as ONE SENTENCE, for a surface that has a reader —
 * the console, the dashboard, the hook, the worker, the MCP server. `remedy` is
 * that surface's OWN way of naming a store: the console has `--dir`, the hook
 * has a field in the file it was pointed at, and a remedy that names a flag the
 * reader does not have is worse than none (#80 review). Null for any other
 * error, so a caller falls through to its usual rendering.
 */
export function describeGuardRefusal(err: unknown, remedy: string): string | null {
  if (isStoreError(err, "IMPLICIT_DEFAULT_DIR_REFUSED")) {
    return (
      `refused: ${String(err.detail["guard"])} and no store was named, so this would have opened the ` +
      `default data dir, ${String(err.detail["dir"])} — on a machine with an install, somebody's live ` +
      `memory. ${remedy}`
    );
  }
  if (isStoreError(err, "EXPLICIT_DIR_GUARD_MALFORMED")) {
    return explicitDirMalformedRefusal(String(err.detail["value"]));
  }
  return null;
}

/** The path the fallback WOULD return — so a refusal can name it without resolving it. */
export function defaultDataDir(): string {
  return join(homedir(), DEFAULT_DATA_DIR_NAME, DEFAULT_STORE_SUBDIR);
}

/**
 * The data directory for THIS call. Resolution order:
 *   1. `COUNTERPARTS_DATA_DIR` (read now, not at import)
 *   2. `~/.counterparts/store` (the base dir minus its host-adapter files) —
 *      unless `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` is armed, which refuses it by
 *      name; a value that neither arms nor is blank is refused too
 *      (`explicitDirRequired`).
 *
 * `env` defaults to the process's own and is injectable for the one caller that
 * carries an environment of its own (`cli/commands.ts#resolveDir`, whose tests
 * pass one) — so the guard is provable without mutating `process.env`. It is
 * read from THAT object only: a `run(argv, { env: {} })` is unarmed for that
 * call whatever `process.env` says (`NOTES.md` 2026-09-05, the observation).
 *
 * The env-set case returns FIRST, before the guard is so much as read: a process
 * launched with the variable (the live MCP server) runs exactly the instructions
 * it ran before the guard existed — and a malformed guard value beside a named
 * store is not consulted either, because the guard's only question is about
 * the fallback.
 */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[DATA_DIR_ENV];
  if (fromEnv && fromEnv.trim().length > 0) return assertSafeDataDir(fromEnv);
  const fallback = defaultDataDir();
  const setting = explicitDirSetting(env);
  if (setting.armed) {
    throw new StoreError("IMPLICIT_DEFAULT_DIR_REFUSED", {
      guard: `${REQUIRE_EXPLICIT_DIR_ENV}=${setting.value}`,
      dir: fallback,
      remedy: `name the store: pass dir (--dir on a command line, "dataDir" in a host configuration), or set ${DATA_DIR_ENV}`,
    });
  }
  // Fails closed: a value this cannot read refuses here, where falling open
  // would have handed back the live store.
  explicitDirRequired(env);
  return assertSafeDataDir(fallback);
}

/**
 * Contract §5 G11: every top-level path in the data directory is classified —
 * in the backup set, or on an explicit exclusion list. A new directory that is
 * not listed here fails `layout.test`'s totality assertion.
 *
 * `match: "prefix"` covers SQLite's journal sidecars (`-journal`, `-wal`, `-shm`)
 * without leaving them unclassified.
 */
export interface LayoutEntry {
  readonly name: string;
  readonly match: "exact" | "prefix";
  readonly backup: boolean;
  readonly why: string;
}

export const LAYOUT: readonly LayoutEntry[] = [
  {
    name: DATABASE_FILE,
    match: "prefix",
    backup: true,
    why: "Box 2 — the canonical database. The memories themselves live here since the floor (schema v6): bodies, their archived versions, and every structured field. Backed up as a database, never rebuilt.",
  },
  {
    name: "cache",
    match: "exact",
    backup: false,
    why: "Box 3 — rebuildable embeddings/FTS. Never backed up; its loss is a re-index.",
  },
  {
    name: "spans",
    match: "exact",
    backup: true,
    why: "remember/'s capture buffer: lived experience awaiting encoding; not reconstructible.",
  },
  {
    name: "journal",
    match: "exact",
    // NOT BACKED UP, since 2026-09-20 (f6f7 review MAJOR-5). It was PROPOSED
    // `true` — a directory the owner is invited to read should ride along with
    // a copy of the store — and changed to `false` in review, inside the same
    // PR, the same day: F6 never landed on master with the flag set, and a
    // reader of this comment should not go looking for a window where it was.
    // What the review measured is the cost the proposal would have had: every
    // snapshot held every episode's words as plain greppable markdown, so a
    // removal that emptied the live store byte for byte left the removed
    // chapter readable in fourteen copies — and a database inside an old
    // snapshot is a file somebody must know to open, while a `.md` inside one
    // is a search result, a Spotlight hit, a synced folder's problem.
    //
    // It costs NOTHING to stop copying it, which is the whole argument: the
    // files are DERIVED. The snapshot carries the rows; the first backfill pass
    // on a restored store writes every file again, and `test/cli.test.ts`
    // proves that on a store with more episodes than one ordinary pass's
    // budget. Scar §2.11 is not in play — that scar is about losing the
    // CANONICAL journal from every backup for three weeks, and this journal is
    // canonical in the database.
    //
    // Still CLASSIFIED, which is the half of §2.11 that does apply: an
    // unclassified top-level path refuses the store at open, and
    // `snapshots.ts#looksCopied` keys on classification rather than on this
    // flag, so rotation of copies already on disk is unaffected. CONTRACT §5
    // G11 says that in its own words now — classified and backed up are two
    // questions, and this entry is the example.
    backup: false,
    why: "The counterpart's diary, ALSO written as markdown files as each chapter lands (owner, 2026-09-17 §15 item 9) — a COPY, kept because plain files outlive the system that wrote them. The chapters themselves are rows like every other memory, so this directory is derived: it is not backed up, and a restored store regenerates every file from its rows at the next boundary. Deliberately excluded rather than merely absent: copying it put removed episodes' words into every rotating snapshot as plain greppable markdown (f6f7 review MAJOR-5).",
  },
  {
    name: "sessions",
    match: "exact",
    backup: false,
    why: "adapters/sessions.ts — the live-session registry a host's hooks leave for its tools, plus the notes one process leaves another inside it: adapters/expansions.ts' handle log and associate/pending.ts' co-activation deltas (sessions/association/). Host state, not memory: no content, and its loss costs a lazy bind or one pass's reinforcement, never a memory. New state of that kind goes INSIDE this directory rather than beside it, because `assertLayout()` runs in the store's constructor and a store opened by code that predates the name would refuse to open at all.",
  },
];

/**
 * The ONE database sidecar that holds no content of its own: the `-shm`, WAL's
 * shared index, which every connection writes read-marks into — a read-only one
 * included. The suites that hash a store directory and mean "nothing wrote"
 * skip this and nothing else (2026-09-18, when box 2 and box 3 went to WAL).
 *
 * **The `-wal` is deliberately not here.** Committed pages live in it until a
 * checkpoint moves them into the file, so a write that landed since the last
 * checkpoint is IN the `-wal` and nowhere else; a hash that skipped it would
 * pass over exactly the write it exists to catch. **Nor is the `-journal`**:
 * one beside the database means a rollback-mode writer is mid-transaction, and
 * during the changeover that writer is a process on the build before this one —
 * which is a thing those suites should see, not skip.
 *
 * `classifyTopLevel` covers all three by prefix. That is a different question,
 * about what the layout allows.
 */
export function isDatabaseSidecar(name: string): boolean {
  return name.endsWith("-shm");
}

export function classifyTopLevel(name: string): LayoutEntry | undefined {
  return LAYOUT.find((e) =>
    e.match === "exact" ? e.name === name : name.startsWith(e.name),
  );
}

/** Throws on the first unclassified top-level entry (contract §5 G11). */
export function assertLayoutClassified(names: readonly string[]): void {
  for (const name of names) {
    if (!classifyTopLevel(name)) {
      throw new StoreError("LAYOUT_UNCLASSIFIED", { name });
    }
  }
}

/**
 * Two boxes, two files. There is nothing else to address.
 *
 * `prose`, `proseKind`, `proseFile`, `versions`, `versionsFor`, `versionFile`
 * and `tmp` went with the floor (schema v6), along with `PROSE_DIR`, `stored.*`,
 * `resolveStoredPath`, `relativizeStoredPath` and `isCanonicalRelativePath` —
 * the placement rules that existed to keep a store self-contained while its
 * rows named files (§5 G15, finding I22, and four review rounds of edge cases
 * about blank pointers, absolute pre-v5 rows and `../ESCAPE/...`).
 *
 * The PROPERTY they defended survives and is now structural rather than
 * enforced: a row IS its memory, so a copied store cannot read or delete
 * another store's words, because there are no words outside the database to
 * reach. `test/store-portable.test.ts` still proves it, with the mechanism gone.
 *
 * `tools/parallel/legacy-paths.ts` keeps the two resolvers, for the read-only
 * instruments that still read the owner's pre-rows store.
 */
export const paths = {
  operational: (dir: string) => join(dir, DATABASE_FILE),
  cacheDir: (dir: string) => join(dir, "cache"),
  cache: (dir: string) => join(dir, "cache", "cache.sqlite"),
} as const;

/**
 * THE PRE-ROWS MARKERS — what a store written before the floor leaves at its
 * top level, and the evidence `STORE_PRE_ROWS` refuses on (`store/index.ts`).
 *
 * The FILENAME is the evidence, deliberately, rather than the schema version
 * inside the database. Reading the version would mean OPENING the old file, and
 * since F1 the owner's live store is in WAL: if that open were the last
 * connection, closing it checkpoints and removes the `-wal`, so the act of
 * asking would move the bytes of the very store the refusal exists to leave
 * untouched. A directory holding any of these three was written by a build that
 * kept its memories in files, and that is all the refusal needs to know.
 *
 * All three, not just the database: a store whose database was moved or deleted
 * by hand still has ~16,000 prose files in it, and minting a blank v6 store on
 * top of them would bury the one copy of those words.
 */
export const PRE_ROWS_MARKERS: readonly string[] = ["operational.sqlite", "prose", "versions"];

/** The tag whose build still opens a pre-rows store. A git ref, so every
 *  sentence that carries it says what to do with it. */
export const PRE_ROWS_READABLE_BY = "floor/v5-last";

/**
 * EVERY pre-rows name present in `dir`, sidecars included — not just the first.
 *
 * Two reasons it is a sweep rather than a `.find`. A refusal that says
 * `found: "operational.sqlite"` and never mentions the 16,000 files under
 * `prose/` has named the least interesting half (review A, NIT-1). And a
 * directory whose main database was moved by hand, leaving only
 * `operational.sqlite-wal` / `-shm`, was not seen as pre-rows at all: the
 * constructor mkdir'd `cache/`, `openOperational` minted `counterparts.sqlite`,
 * and only then did `assertLayout` refuse — on the wrong evidence, after the
 * one write that landed in a pre-rows directory ahead of the refusal (A,
 * MINOR-4).
 *
 * The exact `existsSync` pass stays exactly as it was, because it is what
 * catches `Prose/` and `OPERATIONAL.SQLITE` on a case-insensitive filesystem
 * (measured); the sidecar sweep is added BESIDE it. A stale
 * `operational.sqlite-journal` from a pre-F1 store is caught too.
 *
 * Reads names only. Nothing is opened.
 */
export function preRowsMarkersIn(dir: string): string[] {
  const found = PRE_ROWS_MARKERS.filter((name) => existsSync(join(dir, name)));
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (!PRE_ROWS_MARKERS.some((m) => lower.startsWith(`${m}-`))) continue;
    if (!found.includes(entry)) found.push(entry);
  }
  return found;
}

/**
 * Are the pre-rows directories EMPTY — i.e. did an old build just mkdir them,
 * or is this a store with words in it?
 *
 * This is the question that decides whether a remedy may say "delete these".
 * The PRE-FLOOR build's `Store` constructor — the one tagged `floor/v5-last`,
 * and what a stale worktree or an un-deployed checkout still runs — mkdirs
 * `prose/`, `versions/` and `tmp/` before
 * it reaches `assertLayout()`, so ONE old-build hook on a v6 store leaves all
 * three behind EMPTY — and from then on this build refuses its own store (A,
 * MAJOR-1). Removing them is exactly right there, and a catastrophe beside a
 * real v5 store somebody has hand-copied a `counterparts.sqlite` into.
 *
 * **It answers by LISTING, never by opening.** Reviewer A's measurement — that
 * nothing here opens the old database — is the promise this whole door rests
 * on, and a row count would break it: on a post-F1 store most of the owner's
 * recent words are in the `-wal`, and an open-and-close can checkpoint it away.
 * An empty `prose/` is a sufficient answer and costs no handle.
 */
export function preRowsLeftoversAreEmpty(dir: string): boolean {
  const holdsAFile = (at: string): boolean => {
    let names: string[];
    try {
      names = readdirSync(at);
    } catch {
      return false;
    }
    for (const name of names) {
      const full = join(at, name);
      try {
        if (statSync(full).isDirectory() ? holdsAFile(full) : true) return true;
      } catch {
        /* vanished underneath the walk; it is not a file we can see */
      }
    }
    return false;
  };
  return !["prose", "versions"].some((d) => holdsAFile(join(dir, d)));
}

/**
 * The pre-rows refusal as ONE SENTENCE a person can act on, for any surface
 * that has a reader — the console, the hook, doctor, the dashboard.
 *
 * It exists for the same reason `describeGuardRefusal` does, and it is the same
 * shape: `remedy` is the surface's OWN way of naming a store. Before it, every
 * console door printed the bare code and a JSON blob, and the one instruction
 * the owner was given — "Run: counterparts doctor" — printed the same blob
 * (A, MINOR-3). Null for any other error, so a caller falls through.
 */
export function describePreRowsRefusal(err: unknown, remedy: string): string | null {
  if (!isStoreError(err, "STORE_PRE_ROWS")) return null;
  const detail = err.detail;
  const dir = typeof detail["dir"] === "string" ? detail["dir"] : String(detail["path"] ?? "");
  const found = String(detail["found"] ?? "");
  const own = typeof detail["remedy"] === "string" ? detail["remedy"] : null;
  // WHAT `found` IS depends on WHICH lock refused. The filename door names the
  // old names it saw; the SHAPE door names the schema version it read out of a
  // database already wearing the current name, and rendering that as a filename
  // printed "it keeps its memories in files (5)" (review f5c, NIT-1).
  const shape = detail["reason"] === "no-body-column";
  const what = shape
    ? `it is a schema v${found} database under this build's own filename`
    : `it keeps its memories in files (${found})`;
  return (
    `refused: ${dir} was written before this build's floor — ${what}, ` +
    `and this build keeps them in the database. NOTHING WAS TOUCHED. ` +
    (own ??
      `The build that reads it is tagged ${PRE_ROWS_READABLE_BY}: check it out ` +
      `(git checkout ${PRE_ROWS_READABLE_BY}) to open this store, or name a store this build wrote.`) +
    ` ${remedy}`
  );
}
