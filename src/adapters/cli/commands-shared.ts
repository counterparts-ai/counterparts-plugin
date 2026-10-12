/** What every `counterparts` command shares — the exit codes, the console's io, the argv parser, opening the store and the refusals that open can answer (moved out of `commands.ts`, 2026-10-11). */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Counterpart } from "../../core/counterpart.js";
import {
  DATA_DIR_ENV,
  SCHEMA_VERSION,
  Store,
  StoreError,
  dataDir,
  describeGuardRefusal,
  DATABASE_FILE,
  describePreRowsRefusal,
  isPreRowsDatabase,
  isStoreError,
  paths,
} from "../../core/store/index.js";
import type { Embedder } from "../../core/store/index.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import { defaultConfigPath } from "../config-path.js";
import type { ConfigChoice } from "../config-path.js";
import { loadConfig, withEmbedderDefault, zoneBeside } from "../config.js";
import type { AdapterConfig } from "../config.js";
import type { CheckoutReading } from "../claude-code/doctor.js";
import type { ChildPlan, ChildResult } from "../claude-code/child.js";
import type { Spawner, ProcessLister, Outcome as WireOutcome } from "./wire.js";
import type { Binary } from "../runtime.js";
import { upgradeWords } from "../hosts.js";
import { hostsSeen, installedVersion } from "../sessions.js";
import type { DashboardSeam } from "./commands-dashboard.js";

export const EXIT = {
  ok: 0,
  usage: 1,
  refused: 2,
  failed: 3,
} as const;

export interface Io {
  out(line: string): void;
  err(line: string): void;
  /** Interactive confirmation. ABSENT means non-interactive, and a destructive
   *  command refuses rather than proceeding unconfirmed. */
  prompt?: (question: string) => Promise<string>;
  /**
   * The same read WITHOUT ECHO, for a value that must not reach a scrollback
   * buffer (a secret). Optional and additive: every console that has only
   * `prompt` behaves exactly as it did, and `ui.ts`'s `askHidden` REFUSES
   * rather than fall back to the echoing reader when this is absent and stdin
   * is a terminal. `ui.ts/hiddenPrompt` builds one over real streams.
   */
  promptHidden?: (question: string) => Promise<string>;
  /**
   * WHAT THE HOST KNOWS ABOUT ITS TERMINAL — the seam `ui.ts` decides colour,
   * wrapping and interactivity from. ABSENT means "not a terminal", which is
   * the truth for every pipe and every test console, so a console that does not
   * set it keeps today's plain, unwrapped, never-asking output.
   */
  tty?: { readonly stdin: boolean; readonly stdout: boolean; readonly columns?: number };
}

export interface RunOptions {
  io: Io;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /**
   * The home directory `install` writes its configuration under. Real runs never
   * pass it; the TESTS always do, because `install` writes to
   * `~/.counterparts/claude-code.json` by design — that is the one path the
   * hooks read — and a test that used the real one would write the owner's live
   * configuration. The hermetic rule (CLAUDE.md) has no exceptions, so the seam
   * is here rather than in a mocked `os` module.
   */
  home?: string;
  /**
   * STANDARD INPUT, as a seam — `self-page --write --stdin` reads the page from
   * here.
   *
   * `isTty` is the host telling us whether a human is at the keyboard: with no
   * pipe the command REFUSES and names the two ways in, rather than hanging on
   * a terminal the owner will have to Ctrl-C. Injected so a test can prove the
   * whole path — including "the value never appears in the output" — without a
   * subprocess.
   */
  stdin?: { isTty: boolean; read: () => Promise<string> };
  /**
   * WHICH CHECKOUT IS RUNNING, for `doctor`. Real runs never pass it — the
   * reading derives itself from the running code's own path, which is the whole
   * point of the finding. The TESTS always do, because the suite runs inside a
   * git checkout that is by definition on a branch and dirty while somebody is
   * working in it, and a test whose verdict depended on that would pass and fail
   * with the developer's `git status`.
   */
  checkout?: CheckoutReading;
  /**
   * `claude`, AND `ps` — the two programs `wire`, `unwire` and `uninstall`
   * reach outside this process for.
   *
   * Real runs never pass them; `install.ts`'s own `realSpawner` / the process
   * lister are the defaults. **The TESTS always do**, and it is the same rule
   * `checkout` is here for one clause up: a test that let the interactive
   * install arm run would otherwise invoke whatever `claude` is on the
   * developer's PATH, against their own `~/.claude.json`. Nothing in this suite
   * may run the real binary, and a seam is how that is a fact rather than a
   * habit.
   */
  spawner?: Spawner;
  processes?: ProcessLister;
  /**
   * THE WEB VIEW, for `dashboard` — the same kind of seam as `spawner` above
   * and for a sharper version of the same reason: a test that let the real one
   * run would BIND A PORT on the machine running the suite. Real runs never
   * pass it and get `realDashboard()`, which loads the server module lazily.
   */
  dashboard?: DashboardSeam;
  /**
   * WHERE A NOTE IS FILED — the scope `note` stamps on what it writes. Real
   * terminal runs pass nothing and get the working directory, which is where
   * the person typing is. The dashboard passes its store's own directory: a
   * note written in the browser was not written from any project, and the
   * server's working directory is only wherever it happened to be launched.
   * (The store dir is the same "no project" answer `mcp/server.ts#resolveScope`
   * falls back to.)
   */
  scope?: string;
  /**
   * THE SINGLE BINARY (`runtime.ts#Binary`), when this console is it — the
   * program the Claude Code plugin downloads when a machine has no Bun or Node.
   * Real runs never pass it and get `BINARY`; tests pass one to drive the
   * binary's refusals from source.
   */
  binary?: Binary | null;
  /**
   * THE CATCH-UP CHILD, for `catch-up` — the same kind of seam as `spawner`:
   * a test that let the real one run would start `claude -p` on the machine
   * running the suite. Real runs never pass it.
   */
  catchUpStart?: (plan: ChildPlan) => Promise<ChildResult>;
}

export interface Parsed {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean | undefined>;
}

/**
 * THE ONE DOOR IN FRONT OF A BULK WRITE: the store is named by the `--dir`
 * FLAG, typed on this command line, or the command refuses.
 *
 * **The disagreement this ends (review of #77, 2026-09-05).** Two writing
 * commands landed the same night with two definitions of "named".
 * `migrate-cache --apply` counted `COUNTERPARTS_DATA_DIR`, so
 * `COUNTERPARTS_DATA_DIR=<store> counterparts migrate-cache --apply --yes`
 * walked through its door, reached the conversion and would have rewritten
 * every vector; `repair-dates --apply`, one command over, refused the identical
 * environment, because its guard read `flags.dir === undefined`. Two answers to
 * "did you name the store", in one console, under one `--yes` sentence
 * asserting they agreed.
 *
 * **The owner's ruling (2026-09-05).** `--yes` only ever skips an interactive
 * confirmation. A command that performs a BULK WRITE always requires the
 * `--dir` flag; neither `--yes` nor `COUNTERPARTS_DATA_DIR` stands in for it.
 * An exported variable is a shell's memory of where a store lives, not a
 * sentence somebody typed about THIS rewrite — and on a real machine what it
 * names is the owner's live memory. Ordinary per-memory commands (`note`,
 * `recall`, `remove`, `init`, `install`, `status`, and `verify`'s read-only
 * census) keep today's behaviour: the variable names their store, which is what
 * QUICKSTART §3a teaches.
 *
 * Called FIRST in each writing body, before `storeExists` and before any
 * planning read: a guard that opened the directory before refusing it has
 * already pointed the command at the store it meant to refuse.
 *
 * `label` is the invocation as the owner typed it (`repair-dates --apply`,
 * `verify --rebuild`) and `what` is the one clause saying what it would have
 * done. Returns the refusal's exit code, or `null` when the door is open.
 */
export function requireDirFlagForBulkWrite(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  label: string,
  what: string,
): number | null {
  // The same test the dispatcher uses to decide whether `--dir` named the
  // store. A bare trailing `--dir` never reaches here — `unknownFlag` refuses
  // it for want of a value — and if it ever did it would arrive as boolean
  // `true`, which is "absent" to every reader in this file, and to this one.
  if (typeof flags["dir"] === "string") return null;
  io.err(
    `refused: '${label}' ${what}, and will not run against a store nobody named (it would have been ${dir}). Name the store: --dir <path>.`,
  );
  io.err("Nothing has changed.");
  return EXIT.refused;
}

export function parse(argv: readonly string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: false,
    options: {
      dir: { type: "string" },
      out: { type: "string" },
      reason: { type: "string" },
      passphrase: { type: "string" },
      plaintext: { type: "boolean" },
      markdown: { type: "boolean" },
      "include-confidential": { type: "boolean" },
      "with-versions": { type: "boolean" },
      "into-non-empty": { type: "boolean" },
      overwrite: { type: "boolean" },
      "echo-scan": { type: "string" },
      confirm: { type: "boolean" },
      name: { type: "string" },
      embedder: { type: "boolean" },
      "no-embedder": { type: "boolean" },
      force: { type: "boolean" },
      kind: { type: "string" },
      title: { type: "string" },
      salience: { type: "string" },
      id: { type: "string" },
      json: { type: "boolean" },
      full: { type: "boolean" },
      // `ask`'s page of a facts answer (2026-10-03).
      page: { type: "string" },
      // `ask`'s mode: facts (the default) or meaning (2026-10-09).
      mode: { type: "string" },
      // `ask`'s: the question is already in the counterpart's voice (U13).
      voiced: { type: "boolean" },
      apply: { type: "boolean" },
      // `verify`'s two: the rebuild is opt-in, and dropping vectors this console
      // cannot recompute is opt-in on top of that. Declared rather than left to
      // `strict: false`, which does not make an undeclared boolean reliable.
      rebuild: { type: "boolean" },
      "drop-vectors": { type: "boolean" },
      // I13's cheap repair: take the archived and superseded rows out of the
      // text index without resetting box 3, so the embeddings survive.
      "prune-index": { type: "boolean" },
      "keep-vectors": { type: "boolean" },
      batch: { type: "string" },
      yes: { type: "boolean" },
      // `catch-up --reowe <run>` (2026-10-11): the run whose empty parts to owe again.
      reowe: { type: "string" },
      budget: { type: "string" },
      config: { type: "string" },
      // `repair-dates`' three. `dry-run` is a declared boolean rather than a
      // `strict: false` accident so that `--apply --dry-run` is a refusal the
      // command can see, and the two string flags are declared for the same
      // reason `budget` is: an undeclared valued flag arrives as `true`.
      // (`yes` is declared above; `migrate-cache` is the one command that takes
      // it, since repair-dates has no confirmation to skip.)
      "dry-run": { type: "boolean" },
      confidence: { type: "string" },
      "import-day": { type: "string" },
      sample: { type: "string" },
      stdin: { type: "boolean" },
      // `self-page`'s own three that are not already declared. `--file` and
      // `--version` are strings for the reason every valued flag here is: a
      // trailing `--from` would otherwise arrive as the boolean `true` and be
      // read as "no file named".
      write: { type: "boolean" },
      // `start-fresh`'s two. Declared as booleans for the same reason `rebuild`
      // is: `strict: false` does not make an undeclared boolean reliable.
      undo: { type: "boolean" },
      // `rollback`'s two (2026-10-11): which copy to put back, and the release.
      to: { type: "string" },
      "upgrade-again": { type: "boolean" },
      "nothing-is-open": { type: "boolean" },
      // The wiring three. Declared as booleans for the same reason `rebuild`
      // is: `strict: false` does not make an undeclared boolean reliable, and
      // `--delete-memories` arriving as anything but `true` would be a flag the
      // most dangerous command in the package could not see.
      "no-connect": { type: "boolean" },
      park: { type: "boolean" },
      "delete-memories": { type: "boolean" },
      "keep-memories": { type: "boolean" },
      // `dashboard`'s two. `--port` is a string for the reason every valued flag
      // here is: a trailing `--port` would otherwise arrive as the boolean
      // `true` and be read as "no port named", which is the right answer by
      // accident and the wrong one the moment somebody writes `--port --no-open`.
      port: { type: "string" },
      "no-open": { type: "boolean" },
      file: { type: "string" },
      // `--short <file>`, the page's short version: a string like `--file`, so
      // the spaced form carries its file. Undeclared, `--short <file>` arrived
      // as the boolean `true` with the file left over as a positional, and was
      // refused; only `--short=<file>` worked.
      short: { type: "string" },
      versions: { type: "boolean" },
      version: { type: "string" },
      restore: { type: "string" },
      clear: { type: "boolean" },
      "if-version": { type: "string" },
      // `dream --show <id>` and `core --demote <id>`: strings, so a trailing
      // flag is a refusal rather than a `true` read as "no id named". `dream
      // --undo` reuses `start-fresh`'s boolean and takes the id positionally.
      show: { type: "string" },
      demote: { type: "string" },
      reaffirm: { type: "string" },
      // `settle`'s five valued flags (2026-09-29): strings, so a trailing flag
      // is a refusal rather than a `true` read as "none named".
      pair: { type: "string" },
      holds: { type: "string" },
      against: { type: "string" },
      how: { type: "string" },
      why: { type: "string" },
      // `core --reflected-feeling on|off` (2026-09-27): a string, so a bare
      // flag is a refusal rather than a `true` read as a choice.
      "reflected-feeling": { type: "string" },
      // `dream --setting auto|ask|off` (2026-09-28): a string, like
      // `--reflected-feeling`. `counterparts dream` prints the setting.
      setting: { type: "string" },
      // `log --date YYYY-MM-DD` (which day's file to print) and `coverage
      // --date` (which day to read): a string, so a bare flag is a refusal.
      date: { type: "string" },
      host: { type: "string" },
      observer: { type: "boolean" },
      help: { type: "boolean" },
      // `scope`'s five. Declared as booleans for the same reason `rebuild` is:
      // `strict: false` does not make an undeclared boolean reliable. `--note`
      // is a string, so a trailing `--note` is a refusal rather than a `true`
      // silently recorded as the reason a directory was turned off.
      on: { type: "boolean" },
      off: { type: "boolean" },
      pause: { type: "boolean" },
      resume: { type: "boolean" },
      list: { type: "boolean" },
      note: { type: "string" },
    },
  });
  return {
    command: positionals[0],
    positional: positionals.slice(1),
    flags: values as Record<string, string | boolean | undefined>,
  };
}

/**
 * `dataDir()` reads the environment AT CALL TIME and runs the path guard — and
 * it reads THIS invocation's environment, not the process's: the tests pass one,
 * and a caller-supplied environment is honoured without mutating the real one
 * (the old shape here swapped `COUNTERPARTS_DATA_DIR` in and out of
 * `process.env` around the call; `dataDir(env)` made that unnecessary, and it
 * means the explicit-dir guard is read from the same environment as the dir).
 */
export function resolveDir(env: Record<string, string | undefined>): string {
  return dataDir(env);
}

/**
 * The store refusals the console renders as a SENTENCE rather than printing the
 * error's own line, because the reader is owed what it refused and how to
 * proceed (constitution 16), not a JSON detail. The sentences are the store's
 * (`describeGuardRefusal`, `describePreRowsRefusal`); the remedy is this
 * console's, because it is the surface that has `--dir`. Every other store
 * error keeps its `${code} ${detail}` line, asserted by code.
 *
 * Two of them now. The explicit-dir guard is one an operator armed on purpose.
 * `STORE_PRE_ROWS` joined it after review A measured what every console door
 * actually printed at a pre-rows store — the bare code and a JSON blob, with
 * the one instruction the owner is given ("Run: counterparts doctor") printing
 * the same blob. A dead end at the exact moment of the cut-over.
 */
/**
 * `refused: …` exactly once. The store's own sentences already open with the
 * word, and `init`/`install` added their own prefix in front of it (review f5c,
 * NIT-2).
 */
export function prefixedRefusal(said: string): string {
  return said.startsWith("refused:") ? said : `refused: ${said}`;
}

export function describeDirRefusal(err: unknown, dir?: string): string {
  return (
    describeGuardRefusal(err, `Name the store: --dir <path>, or ${DATA_DIR_ENV}.`) ??
    describePreRowsRefusal(err, `Name a store with --dir <path>.`) ??
    preRowsInDisguise(err, dir) ??
    upgradePending(err) ??
    // A rollback's hold: its remedy is the sentence, not the JSON around it.
    (isStoreError(err, "STORE_ROLLED_BACK") && typeof err.detail["remedy"] === "string" ? err.detail["remedy"] : null) ??
    String((err as Error).message ?? err)
  );
}

/**
 * A store on an OLDER schema, met by a read-only door (review N1, 2026-09-25).
 * `STORE_UNINITIALIZED` with a `found` version below this build's reads, to an
 * observer, like an empty store; it is not — it is waiting for the first
 * session, which copies it and upgrades it. Doctor's sentence, said here too.
 * WHICH session is said in the words of the hosts the store's registry has
 * seen (`hosts.ts#upgradeWords`, 2026-10-01): with only Claude Desktop there
 * is no Claude Code session to wait for.
 */
export function upgradePending(err: unknown): string | null {
  if (!isStoreError(err, "STORE_UNINITIALIZED")) return null;
  const found = Number.parseInt(String(err.detail["found"] ?? ""), 10);
  // Only a store this build can migrate: v6 up. Below the floor is the
  // pre-rows refusal's sentence, never "the next session upgrades it".
  if (!Number.isFinite(found) || found < 6 || found >= SCHEMA_VERSION) return null;
  // The refusal names the database file; the registry sits beside it.
  const path = err.detail["path"];
  const words = upgradeWords(typeof path === "string" && path.length > 0 ? hostsSeen(dirname(path)) : new Set());
  return (
    `this store is on schema v${String(found)}; ${words.who} copies it and upgrades it ` +
    `to v${String(SCHEMA_VERSION)}. Nothing to do: ${words.open}, then run this again.`
  );
}

/** The line a read-only door prints when its open was refused. */
export function openRefusalLine(err: unknown, dir?: string): string {
  if (dir !== undefined && preRowsInDisguise(err, dir) !== null) {
    return `could not open the store: ${describeDirRefusal(err, dir)}`;
  }
  return upgradePending(err) ?? `could not open the store: ${describeDirRefusal(err, dir)}`;
}

/**
 * The shape-lock shape, wearing `STORE_UNINITIALIZED`'s clothes.
 *
 * A door that opens as an OBSERVER never reaches the second lock: `initialize:
 * false` short-circuits on `OBSERVER_READ_FLOOR` and throws
 * `STORE_UNINITIALIZED` first. So `status` and `verify` printed a bare code and
 * a JSON blob on a v5 database renamed to `counterparts.sqlite`, while
 * `verify --rebuild`, `migrate-cache`, `init` and the hook all printed the
 * sentence — A-MINOR-3's exact complaint surviving on the other lock's shape
 * (review f5c, NEW-MINOR-3).
 *
 * Only asked when the store has already refused, and only about a file already
 * named `counterparts.sqlite` — never the owner's parked v5 store, which is
 * caught by NAME before anything opens it.
 */
function preRowsInDisguise(err: unknown, dir: string | undefined): string | null {
  if (dir === undefined) return null;
  if (!isStoreError(err, "STORE_UNINITIALIZED")) return null;
  if (!isPreRowsDatabase(paths.operational(dir))) return null;
  return describePreRowsRefusal(
    new StoreError("STORE_PRE_ROWS", {
      dir,
      found: DATABASE_FILE,
      expected: SCHEMA_VERSION,
      reason: "no-body-column",
    }),
    `Name a store with --dir <path>.`,
  );
}

/** A configuration is "custom" by its PATH, not by how it was named — the same
 *  test `installCommand` and `startFreshCommand` each make. Hoisted here so
 *  the four callers cannot drift. */
export function customConfigPath(named: ConfigChoice | undefined, home: string): string | undefined {
  return named !== undefined && named.source !== "default" && resolve(named.path) !== defaultConfigPath(home)
    ? named.path
    : undefined;
}

/** `wire.ts` returns words, not numbers, so that it never has to import this
 *  file's `EXIT` back and make the two modules circular. */
export function exitFor(outcome: WireOutcome): number {
  return outcome === "ok" ? EXIT.ok : outcome === "refused" ? EXIT.refused : EXIT.failed;
}

/** Exported for the caller-universality test: the console composes a brain the
 *  same way every other adapter does, and never re-wires the modules. */
export function openCounterpart(
  dir: string,
  observer = false,
  identity?: { readonly name: string },
  embed?: Embedder,
): Counterpart {
  // `identity` goes through the SAME door the host adapter uses —
  // `Counterpart.open`'s own option, which calls `self.ensureIdentityCore`. The
  // console does not get a second way to mint an identity core; it gets the
  // one way, with a name from a flag instead of from `claude-code.json`.
  // `embed` likewise: the option every composition root hands its embedder's
  // sync face through (`ask`, 2026-09-24).
  const snapshotsDir = observer ? undefined : snapshotsDirBeside(dir);
  const timeZone = zoneBeside(dir);
  return Counterpart.open({
    dir,
    observer,
    // A wake `rebrief` publishes is stamped with this build (2026-10-02).
    build: installedVersion(),
    ...(timeZone === undefined ? {} : { timeZone }),
    ...(identity === undefined ? {} : { identity }),
    ...(embed === undefined ? {} : { embed }),
    ...(snapshotsDir === undefined ? {} : { snapshotsDir }),
  });
}

/** `Store.open` for the console: the config's zone beside the store rides along. */
export function openStoreAt(opts: { dir: string; observer?: boolean }): Store {
  const timeZone = zoneBeside(opts.dir);
  return Store.open({ ...opts, ...(timeZone === undefined ? {} : { timeZone }) });
}

/**
 * `snapshots.dir` from the host configuration beside the store
 * (`<base>/claude-code.json`, the file `install` writes), so a migration the
 * console runs puts its copy where the worker's rotation and doctor look.
 * Absent, unreadable or unset: undefined, and the store's default applies.
 */
export function snapshotsDirBeside(dir: string): string | undefined {
  const beside = join(dir, "..", "claude-code.json");
  if (!existsSync(beside)) return undefined;
  try {
    return loadConfig(JSON.parse(readFileSync(beside, "utf8"))).config.snapshots?.dir;
  } catch {
    return undefined;
  }
}

/**
 * The host configuration at `path`, read the way every entry point reads it,
 * with the three readings kept distinct.
 *
 * `loadConfig(undefined)` says "absent", which is the right answer for a file
 * that is not there and the WRONG one for a file that is there and will not
 * parse — so the parse failure is caught here and named. Both resolve to a
 * config `doctor` can still report on; neither throws.
 */
export function hostConfigFor(path: string): {
  config: AdapterConfig;
  reason: "loaded" | "absent" | "unreadable";
  /** The keys the loader named, when it could not read the file. */
  unreadableKeys?: readonly string[];
} {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    const load = loadConfig(undefined);
    return { config: load.config, reason: "absent" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // The same direction `loadConfig` takes for a file it cannot understand:
    // observer, and say so. A config that will not parse silences every hook.
    return { config: { observer: true }, reason: "unreadable" };
  }
  const load = loadConfig(raw);
  // THE EMBEDDER DEFAULT the hooks, the worker and the server apply
  // (`config.ts#resolveEmbedder`): an absent block is the local table.
  return {
    config: withEmbedderDefault(load.config),
    reason: load.reason,
    ...(load.unreadableKeys === undefined ? {} : { unreadableKeys: load.unreadableKeys }),
  };
}
