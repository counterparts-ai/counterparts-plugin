/**
 * `counterparts uninstall` — leave, and leave everything that is not ours alone.
 *
 * **The owner's ruling, 2026-09-21, quoted from `docs/new-user-findings.md`:**
 *
 *   > Uninstall leaves `~/.counterparts` in place by default. `--park` moves it
 *   > aside under a dated name. `--delete-memories` deletes it, and only after a
 *   > warning that counts what is about to go — `WARNING: this will delete 1,204
 *   > memories.` — and the person typing `DELETE MEMORIES` exactly. No `--yes`
 *   > for that one.
 *
 * ── THE BLOCKER THIS FILE WAS REWRITTEN AROUND ──────────────────────────────
 *
 * The first version read that ruling as "the directory the configuration sits
 * in", and `install --config <path>` is the supported way to put a configuration
 * anywhere. The adversarial review of 2026-09-21 pointed one at `~/.claude` and
 * watched `--park` rename Claude Code's entire user configuration — settings,
 * project transcripts, todos — under a heading that said "Your memory, parked";
 * then pointed one at `~/Documents` and watched `--delete-memories` destroy
 * `taxes/` and `photos/` after warning about **one memory**. Both reproduced
 * again here before this was written.
 *
 * So the subject of this command is no longer a directory. **It is an explicit
 * list of the things this package writes**, built from names we own:
 *
 *   - the configuration file, and our own temp and backup siblings of it;
 *   - `scopes.json` and its siblings;
 *   - `snapshots/`, when it is the one this layout owns rather than a directory
 *     the owner pointed at;
 *   - the STORE — at `dataDir`, **wherever that is**, which is the other half of
 *     the same finding: the store can live outside the configuration directory,
 *     and the old code counted it, deleted the directory without it, and said
 *     the memory was gone.
 *
 * (`credentials.env` was on this list until the keys were removed on
 * 2026-09-24. It is not ours to delete any more — it may hold somebody's API
 * keys — so an old one is left where it is, like anything else we do not own,
 * and the plan names it.)
 *
 * The configuration directory itself moves or goes **only when it holds nothing
 * else**, which keeps the ordinary `~/.counterparts` a single atomic rename. If
 * it holds anything we do not own, the directory is never touched: our entries
 * go one by one, the foreign ones are NAMED, and the output says the directory
 * stays.
 *
 * And four directories are refused outright whatever they hold: `~/.claude`
 * (the host's own), the home directory, any parent of it, and anything holding
 * a `.git` — a configuration inside somebody's repository is a configuration
 * this command will not reason about.
 *
 * ── the rest of the shape ───────────────────────────────────────────────────
 *
 *   - **The default removes WIRING, never memory.** It unwires, says where the
 *     memory still is and how much of it there is, and gives the one command
 *     that removes the package.
 *   - **`--park` is `rename(2)`**, once per thing. Never a copy, never a delete.
 *     The way back is `counterparts install`, which finds a parked folder beside
 *     a missing one and asks; the guarded `mv` that does it by hand moved to
 *     `counterparts help uninstall` (owner, 2026-09-22, finding #22 — a shell
 *     one-liner with an `if [ -e … ] … REFUSING …` guard in it "doesn't make
 *     sense" as the last thing on the screen).
 *   - **`--delete-memories` is the only destructive verb in this package**, and
 *     the one with no `--yes`. It PRINTS THE WHOLE PLAN — every path, with its
 *     size — and then takes a typed phrase.
 *   - **The plain arm OFFERS the delete, after the wiring is out** (Mike,
 *     2026-10-11, lightly held: every uninstall path offers "Also delete all
 *     memories and related data? This can't be undone", always behind a
 *     confirmation). At a terminal, and only there: the plan printed, then
 *     `[y/N]` — Enter, Esc, `n`, `--yes`, `--keep-memories` and no terminal all
 *     KEEP — and a yes leads to the same typed phrase `--delete-memories` takes.
 *     It is not offered while anything holds the store (`openRefusal`).
 *   - **`--json` is the plugin command's door** (`uninstallJson`). Alone it is a
 *     PLAN and changes nothing; with `--keep-memories` it uninstalls and keeps.
 *     **There is no scripted delete.** The phrase is typed by a person at a
 *     terminal or not at all: this process cannot tell who wrote its stdin, so
 *     a door that took the phrase there would be one a model could walk through
 *     by typing it (the PR that added the offer briefly had one; the
 *     coordinator took it out, 2026-10-11, lightly held). The plugin's command
 *     shows the plan and sends the person to a terminal, with Claude Code
 *     closed — which a delete needs anyway, since a live session holds the
 *     store. `--delete-memories` with no person refuses, `--json` or not.
 *   - **Both moving arms refuse unless the deregistration is CONFIRMED** and
 *     unless the process check actually LOOKED. A guard that cannot tell "I
 *     found nothing" from "I could not look" is not a guard (review M2, M3);
 *     `--nothing-is-open` is the explicit override, the same flag and the same
 *     meaning `start-fresh` gives it.
 */
import { existsSync, lstatSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";

import { Store, assertSafeDataDir, dateOf, isWithin, storeExists } from "../../core/store/index.js";
import { isJournal } from "../../core/sleep/index.js";
import { SCOPES_FILE_NAME, shellWord } from "../scopes.js";
import { PLUGIN_ROOT_ENV, installRoute } from "../plugin.js";
import { pluginInstall } from "../host-wiring.js";
import type { PluginInstallRead } from "../host-wiring.js";
import { SNAPSHOTS_DIR_NAME, resolveSnapshotsDir } from "../snapshots.js";
import type { AdapterConfig } from "../config.js";
import type { Io } from "./commands.js";
import { BIN, CONFIG_FILE, LEGACY_CREDENTIALS_FILE, MCP_SERVER_NAME, hostSettingsDir } from "./install.js";
import {
  OPEN_WINDOW_MS,
  PARKED_INFIX,
  pairedSuffix,
  realpathDeep,
  sameFilesystemRefusal,
} from "./start-fresh.js";
import { readHolders } from "./rollback.js";
import type { Holder } from "./rollback.js";
import { confirm, typed, ui } from "./ui.js";
import type { Ui } from "./ui.js";
import type { Outcome, ProcessLister, Spawner, WireInput } from "./wire.js";
import { look, readMcp, tilde, unwire } from "./wire.js";

/** The phrase `--delete-memories` asks for, exactly. Case-sensitive, and
 *  nothing is trimmed but the end-of-line (`ui.ts#typed`). */
export const DELETE_PHRASE = "DELETE MEMORIES";

/** The question the plain arm puts once the wiring is out, in Mike's words
 *  (2026-10-11). Its default is NO, and a yes only leads to the phrase. */
export const DELETE_QUESTION = "Also delete all memories and related data? This can't be undone.";

/** The typed-phrase prompt, one string for both arms. */
export const PHRASE_PROMPT = `Type ${DELETE_PHRASE} to go ahead — Esc or "cancel" to stop: `;

/** The one command that removes the package. A program does not delete itself
 *  out from under the process that is running it. */
export const REMOVE_PACKAGE = `bun remove -g ${BIN.cli}`;

/** The same, for a copy Claude Code's plugin manager put there. */
export const REMOVE_PLUGIN = "in Claude Code, /plugin → Installed → counterparts → Uninstall";

/**
 * The console's own name and the program's removal, in the words of the route
 * this copy came by (`plugin.ts#installRoute`, as doctor's fix lines are): a
 * plugin install has no `counterparts` on PATH and no `bun remove -g` to run.
 * `either` (a plugin root that names another copy) keeps the console's name
 * and names both removals.
 */
export function consoleName(env: Record<string, string | undefined>, home: string): string {
  if (installRoute(env) !== "plugin") return BIN.cli;
  const launcher = join((env[PLUGIN_ROOT_ENV] ?? "").trim(), "src", "adapters", "plugin-run.sh");
  return `sh ${shellWord(launcher, home)} cli`;
}

export function removeProgram(env: Record<string, string | undefined>): string {
  const route = installRoute(env);
  if (route === "npm") return REMOVE_PACKAGE;
  if (route === "plugin") return REMOVE_PLUGIN;
  return `${REMOVE_PACKAGE} (npm) · ${REMOVE_PLUGIN} (plugin)`;
}

/** The plugin's id when Claude Code records none here: the published one. */
export const PLUGIN_ID_FALLBACK = "counterparts@counterparts";

/**
 * Claude Code's own command that removes the plugin, from a terminal. A
 * project or local install is only removed with `--scope`, from the folder it
 * was installed for, both of which Claude Code records beside the id.
 */
export function pluginUninstallCommand(plugin: PluginInstallRead | null, home: string): string {
  const command = `claude plugin uninstall ${plugin?.id ?? PLUGIN_ID_FALLBACK}`;
  const scope = plugin?.scope ?? null;
  if (scope !== "project" && scope !== "local") return command;
  const where = plugin?.projectPath ?? null;
  return where === null
    ? `${command} --scope ${scope} (in the project it was installed for)`
    : `cd ${shellWord(where, home)} && ${command} --scope ${scope}`;
}

/** {@link pluginUninstallCommand} for the install Claude Code records here. */
export function removePluginAtTerminal(env: Record<string, string | undefined>, home: string): string {
  return pluginUninstallCommand(pluginInstall({ home, env, cwd: null }), home);
}

/** Why the plugin goes before Claude Code opens again, said under that line. */
export const PLUGIN_BEFORE_REOPEN =
  "Run it here, before you open Claude Code again: while the plugin is on, its first start sets " +
  "Counterparts up again, with a new, empty memory folder.";

/**
 * The closing line once the configuration is GONE — deleted or parked. A
 * plugin that is still on runs its first run (`plugin.ts#ensureFirstRun`) at
 * the very next session start, before anybody can reach /plugin, finds no
 * configuration and installs a fresh one, which the plugin's removal then
 * leaves behind (measured with Claude Code 2.1.296 in a throwaway home,
 * 2026-10-11). The person is at a terminal with Claude Code closed, so the
 * plugin goes from there, with Claude Code's own command. Printed, never run:
 * the launcher running this lives in the folder that command removes.
 */
function removeProgramAfterGone(input: UninstallInput): void {
  const route = installRoute(input.env);
  if (route === "npm") {
    input.io.out(`To remove the program too: ${REMOVE_PACKAGE}`);
    // INSTALLED TWICE: the plugin stood down while this install's hooks were
    // live, and they are out now, so its next start is a first run too.
    const also = pluginInstall({ home: input.home, env: input.env, cwd: null });
    if (also === null || !also.enabled) return;
    input.io.out(`Claude Code also has the plugin: ${pluginUninstallCommand(also, input.home)}`);
    input.io.out(PLUGIN_BEFORE_REOPEN);
    return;
  }
  const plugin = removePluginAtTerminal(input.env, input.home);
  input.io.out(`To remove the program too: ${route === "plugin" ? plugin : `${REMOVE_PACKAGE} (npm) · ${plugin} (plugin)`}`);
  input.io.out(PLUGIN_BEFORE_REOPEN);
}

/** The one line a moving arm prints while `claude mcp list` runs (TTY only). */
export const CHECKING_CLAUDE_CODE = "Checking Claude Code…";

// ── the forbidden-root clause, which every arm runs ─────────────────────────

/**
 * Is this path inside a live v1 store? Run on BOTH spellings, because
 * `assertSafeDataDir` is pure string math and follows no links, so a `--config`
 * inside a symlink into `~/.bansai` clears it on the written spelling alone
 * (`snapshots.ts#assertRotatableDir`, the F2 review's lesson).
 *
 * Every arm runs it, the plain one included: that arm renames nothing and
 * deletes nothing, but it READS — the size fallback walks the directory — and
 * the second safety rule forbids reading those stores as flatly as writing to
 * them.
 */
export function forbiddenBaseRefusal(base: string): string | null {
  const written = resolve(base);
  for (const spelling of [written, realpathDeep(written)]) {
    try {
      assertSafeDataDir(spelling);
    } catch (err) {
      const root =
        err !== null && typeof err === "object" && "detail" in err
          ? String((err as { detail: Record<string, unknown> }).detail["root"] ?? "a live store")
          : "a live store";
      return (
        `refused by name: ${spelling} is inside ${root}. That is a live memory this package ` +
        "never touches — not to read it, not to move it, not to rename it (CLAUDE.md, the " +
        "second safety rule)."
      );
    }
  }
  return null;
}

// ── what we own, by name ────────────────────────────────────────────────────

export type OwnedKind = "config" | "scopes" | "snapshots" | "store" | "sidecar";

/** The basenames this package writes inside a configuration directory. Built
 *  from the configuration rather than assumed, because three of the five are
 *  things the file itself can move. */
export interface OwnedNames {
  readonly config: string;
  readonly scopes: string;
  /** Null when `snapshots.dir` points at a directory the OWNER chose, which
   *  this command leaves alone exactly as `start-fresh` does. */
  readonly snapshots: string | null;
  /** Null when `dataDir` is not directly inside the configuration directory. */
  readonly store: string | null;
}

export function ownedNames(
  configPath: string,
  config: AdapterConfig,
  storeDir: string | null,
): OwnedNames {
  const dir = resolve(dirname(configPath));
  const snaps =
    storeDir === null
      ? null
      : resolveSnapshotsDir(storeDir, config.snapshots?.dir).dir;
  return {
    config: basename(resolve(configPath)),
    scopes: SCOPES_FILE_NAME,
    snapshots:
      snaps !== null && resolve(dirname(snaps)) === dir ? basename(snaps) : null,
    store: storeDir !== null && resolve(dirname(storeDir)) === dir ? basename(storeDir) : null,
  };
}

/**
 * Is this entry name one this package writes, and which kind?
 *
 * The sidecars matter as much as the files: `scopes.ts` writes `<path>.<pid>.tmp`
 * siblings (and the removed `keys.ts` wrote them too, and a bare `<path>.tmp`
 * before review n4, which a leftover may still be), `start-fresh` leaves `store.parked-<date>`,
 * `store.blank-<date>` and `store.new-<pid>` behind, and `wire` leaves
 * `<file>.counterparts-backup-<stamp>`. A directory holding only those is still
 * a directory holding only ours.
 */
export function ownedKind(name: string, owned: OwnedNames): OwnedKind | null {
  if (name === owned.config) return "config";
  if (name === owned.scopes) return "scopes";
  if (owned.snapshots !== null && name === owned.snapshots) return "snapshots";
  if (owned.store !== null && name === owned.store) return "store";
  const bases = [owned.config, owned.scopes, owned.snapshots, owned.store];
  for (const base of bases) {
    if (base === null || !name.startsWith(`${base}.`)) continue;
    const suffix = name.slice(base.length + 1);
    if (
      /^\d+\.tmp$/.test(suffix) ||
      suffix === "tmp" ||
      /^counterparts-backup-/.test(suffix) ||
      /^(parked|blank|new)-/.test(suffix)
    ) {
      return "sidecar";
    }
  }
  return null;
}

// ── how much is about to go ─────────────────────────────────────────────────

export type Census =
  | {
      readonly kind: "memories";
      readonly memories: number;
      readonly journal: number;
      /** Beliefs, entities and the self page — `status`'s second population.
       *  Reported so a warning is never the bare word "0" while a store goes. */
      readonly schemas: number;
    }
  | { readonly kind: "size"; readonly bytes: number; readonly why: string };

/** Every byte under a path. Used for the printed plan and for the fallback when
 *  the store will not open, so a warning always carries a number. */
export function dirSize(path: string): number {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return total;
  }
  for (const name of entries) total += dirSize(join(path, name));
  return total;
}

/**
 * How many of `dirSize`'s bytes are SQLite WRITE-AHEAD LOGS — a `<name>.sqlite-wal`
 * with its database `<name>.sqlite` beside it, the only shape this package's two
 * databases take — so the plan can say what its number is made of (finding #26,
 * below). A `something.bak-wal` beside a `something.bak` is not one of ours and
 * is not called a log that shrinks on its own (review of #188, NIT).
 *
 * `lstat` and `readdir` only, like `dirSize`: the store is never opened to ask.
 */
export function walBytes(path: string): number {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return 0;
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of entries) {
    const full = join(path, name);
    if (name.endsWith(".sqlite-wal") && entries.includes(name.slice(0, -"-wal".length))) {
      try {
        const log = lstatSync(full);
        if (log.isFile()) total += log.size;
      } catch {
        /* gone between the listing and the stat: nothing to count */
      }
    } else {
      total += walBytes(full);
    }
  }
  return total;
}

/**
 * WHEN THE LOG IS WORTH A SENTENCE: a megabyte or more, and at least a tenth of
 * the store. A fresh store carries a couple of hundred kilobytes of log and the
 * owner's screens stay exactly as he drew them; the trial's store carried 5.3 MB
 * of its 6.7, and that is the case a person would otherwise wonder about.
 */
export const LOG_WORTH_SAYING = 1024 * 1024;

/**
 * THE SENTENCE — the same words under both plans, so the two arms cannot tell
 * one memory's size two ways (finding #26). Two short lines rather than one
 * long one: under the delete plan it starts in the column the store's words
 * start in, forty-odd characters in.
 */
export function logClause(logBytes: number, storeBytes: number): readonly string[] | null {
  if (logBytes < LOG_WORTH_SAYING || logBytes * 10 < storeBytes) return null;
  return [
    `${humanBytes(logBytes)} of that is a database log that shrinks on its own;`,
    "nothing is lost when it does.",
  ];
}

/**
 * `214 B`, `2.0 KB`, `913 KB`, `6.7 MB` — the screen's own spelling.
 *
 * One decimal below ten and none at or above it: these numbers sit in a column
 * beside each other, and `913.0 KB` spends four characters saying nothing while
 * `6.7 MB` needs its one.
 */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : String(Math.round(n))} ${units[i] ?? "KB"}`;
}

/** `1,204` — the ruling's own spelling of a count. */
export function grouped(n: number): string {
  return n.toLocaleString("en-US");
}

/** `1,204 memories`, and `1 memory`. A brand-new install holds exactly one — its
 *  identity core — so "1 memories" was what somebody leaving after five minutes
 *  actually read. */
export function memories(n: number): string {
  return n === 1 ? "1 memory" : `${grouped(n)} memories`;
}

/**
 * How many memories are about to go — **the same number `status` calls
 * Memories** (review m5), plus the journal on its own line.
 *
 * It used to be `countMemories()` with no filter at all, which counts every
 * archived row, every superseded version, every belief, every entity, the self
 * page and the whole episode journal. On the owner's own store that reads high
 * by thousands, and the number is the ONE thing a person is consenting to. So
 * the population is the census's: not archived, not superseded, not a journal
 * episode, not a schema row — and the journal is reported beside it rather than
 * folded in, because it is a different thing that is also going.
 *
 * **READ-ONLY, AND OBSERVER** (review m6). This used to be a writer open, with
 * `initialize: true`, on the arm whose whole promise is that it changes
 * nothing: it could take the write lock against a live session (the I38
 * "database is locked" shape) and would migrate a schema-behind store during a
 * command that says it touches nothing. `storeExists` is checked first for a
 * second reason — `Store.open` CREATES what it opens, and a count must never be
 * the thing that mints a store.
 */
export function censusOf(base: string, storeDir: string | null): Census {
  const store = storeDir === null ? join(base, "store") : resolve(storeDir);
  if (!storeExists(store)) {
    return {
      kind: "size",
      bytes: dirSize(base),
      why: "there is no store this build recognises at the path the configuration names",
    };
  }
  try {
    const opened = Store.open({ dir: store, observer: true });
    try {
      const denied = new Set(opened.deniedIds());
      let live = 0;
      let journal = 0;
      let schemas = 0;
      for (const id of opened.list()) {
        const row = opened.row(id);
        if (row === undefined || denied.has(id)) continue;
        if (row.archived === 1) continue;
        if (row.superseded_by !== null) continue;
        if (isJournal(row)) {
          journal += 1;
          continue;
        }
        if (row.type === "schema") {
          schemas += 1;
          continue;
        }
        live += 1;
      }
      return { kind: "memories", memories: live, journal, schemas };
    } finally {
      opened.close();
    }
  } catch (err) {
    return {
      kind: "size",
      bytes: dirSize(base),
      why: `the store would not open on this build (${String((err as Error).message ?? err).split("\n")[0] ?? "no detail"})`,
    };
  }
}

/**
 * WHAT IS IN THE STORE, in the words that sit on the store's own line of the
 * plan: `32 memories, 2 journal entries`.
 *
 * The 2026-09-21 ruling put this count in a `WARNING:` line of its own —
 * `WARNING: this will delete 1,204 memories.` — and the 09-22 screen moves it
 * onto the line naming the thing it is a count OF, leaving the warning to say
 * the one thing the list cannot: that there is no way back. The count is still
 * on the screen before anything is asked, which is guarantee 28's whole claim.
 *
 * The journal rides BESIDE the count rather than inside it, because it is a
 * different population that is also going. And a store with **no memories yet**
 * never reads as a bare `0`: a fresh install holds an identity core and no
 * memories at all, so "0 memories" was the whole account of a store going.
 */
export function censusWords(census: Census): string {
  if (census.kind === "size") return "the count could not be taken";
  const journal =
    census.journal === 0
      ? ""
      : `, ${grouped(census.journal)} journal entr${census.journal === 1 ? "y" : "ies"}`;
  if (census.memories > 0) return `${memories(census.memories)}${journal}`;
  const rest =
    census.schemas === 0
      ? ""
      : `, ${grouped(census.schemas)} belief${census.schemas === 1 ? "" : "s"} or entit${
          census.schemas === 1 ? "y" : "ies"
        }`;
  return `no memories in it yet${rest}${journal}`;
}

// ── the plan ────────────────────────────────────────────────────────────────

export interface PlanEntry {
  readonly path: string;
  readonly kind: OwnedKind;
  /** In the words the printed plan uses. */
  readonly what: string;
  readonly bytes: number;
  readonly directory: boolean;
}

export interface UninstallPlan {
  readonly configDir: string;
  readonly configPath: string;
  /** `dataDir` as resolved, or null when the configuration names none. */
  readonly storeDir: string | null;
  readonly storeInside: boolean;
  /** True when the store is there and will be acted on. */
  readonly storeActed: boolean;
  /** Every path that will move or go, store first. */
  readonly entries: readonly PlanEntry[];
  /** Names in the configuration directory that are NOT ours. Never touched. */
  readonly foreign: readonly string[];
  /** True when the directory itself may move or go — it holds nothing else. */
  readonly wholeDirectory: boolean;
  /**
   * THE PATHS THAT ACTUALLY MOVE OR GO, in order — the one list both arms act
   * on, so a park and a delete cannot disagree about what this command's
   * subject is. It is the directory itself (plus an outside store) when nothing
   * foreign is in it, and our entries one by one when something is.
   */
  readonly targets: readonly string[];
  /**
   * The count, and ONLY on the arm that needs it — filled in by `counted`, never
   * by `planUninstall`, which opens nothing.
   *
   * Null for `--park`, deliberately: counting means OPENING the store, and
   * `start-fresh`'s discipline — this process never opens the store it is
   * moving, not even read-only — is worth keeping for the arm that does not
   * have to. The printed plan gets its sizes from the filesystem either way.
   */
  readonly census: Census | null;
  readonly bytes: number;
  /**
   * The part of the STORE's bytes that is SQLite's write-ahead log (`walBytes`),
   * 0 when no store is acted on. Both arms print it the same way (`logClause`).
   */
  readonly logBytes: number;
  readonly refusal: string | null;
}

export interface PlanInput {
  readonly configPath: string;
  readonly config: AdapterConfig;
  readonly home: string;
  /** "park" or "delete", for the refusals' wording. */
  readonly verb: string;
  /** The process environment, for where the host keeps its own directory
   *  (`CLAUDE_CONFIG_DIR`, review of #337). Absent: `~/.claude` only. */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Read the ground and decide exactly what this command may act on.
 *
 * Pure but for the reads, and those are `lstat` and `readdir` — it OPENS
 * NOTHING and changes nothing. The count the delete arm needs is `counted`,
 * taken by the caller after the sizes it will print (finding #26). The caller
 * prints the plan before it asks.
 */
export function planUninstall(input: PlanInput): UninstallPlan {
  const configPath = resolve(input.configPath);
  const configDir = resolve(dirname(configPath));
  const written = input.config.dataDir;
  const storeDir =
    written === undefined || written.trim().length === 0
      ? null
      : isAbsolute(written.trim())
        ? resolve(written.trim())
        : null;
  const empty: UninstallPlan = {
    configDir,
    configPath,
    storeDir,
    storeInside: storeDir !== null && isWithin(configDir, storeDir),
    storeActed: false,
    entries: [],
    foreign: [],
    wholeDirectory: false,
    targets: [],
    census: null,
    bytes: 0,
    logBytes: 0,
    refusal: null,
  };

  const dirRefusal = configDirRefusal(configDir, configPath, input.home, input.verb, input.env);
  if (dirRefusal !== null) return { ...empty, refusal: dirRefusal };

  if (written !== undefined && written.trim().length > 0 && storeDir === null) {
    return {
      ...empty,
      refusal:
        `refused: ${configPath} names "${written.trim()}" as its store, which is not an absolute ` +
        "path — it means a different directory in every process that reads it. This will not " +
        `${input.verb} whatever happens to sit at that name.`,
    };
  }
  if (storeDir !== null && existsSync(storeDir)) {
    const storeWhy = storeRefusal(storeDir, input.home, input.verb);
    if (storeWhy !== null) return { ...empty, refusal: storeWhy };
  }

  // ── what is in the configuration directory, ours and not ──────────────────
  const owned = ownedNames(configPath, input.config, storeDir);
  const ours: PlanEntry[] = [];
  const foreign: string[] = [];
  let names: string[];
  try {
    names = readdirSync(configDir).sort();
  } catch (err) {
    return {
      ...empty,
      refusal: `refused: ${configDir} could not be listed (${String((err as Error).message ?? err)}).`,
    };
  }
  for (const name of names) {
    const kind = ownedKind(name, owned);
    if (kind === null) {
      foreign.push(name);
      continue;
    }
    if (kind === "store") continue; // added first, below, wherever it lives
    const path = join(configDir, name);
    ours.push({
      path,
      kind,
      what: WHAT[kind],
      bytes: dirSize(path),
      directory: isDirectory(path),
    });
  }

  // THE STORE IS FIRST AND IT IS ITS OWN ENTRY, wherever it lives (review M1).
  const entries: PlanEntry[] = [];
  const storeActed = storeDir !== null && existsSync(storeDir);
  if (storeActed && storeDir !== null) {
    entries.push({
      path: storeDir,
      kind: "store",
      what: WHAT.store,
      bytes: dirSize(storeDir),
      directory: true,
    });
  }
  entries.push(...ours);

  // A STORE THAT LIVES ELSEWHERE DOES NOT MAKE THE DIRECTORY FOREIGN. It is
  // simply one more target beside it, and the directory it left behind still
  // holds nothing but ours.
  const wholeDirectory = foreign.length === 0;
  const storeOutside = storeActed && storeDir !== null && !isWithin(configDir, storeDir);
  const targets = wholeDirectory
    ? [...(storeOutside && storeDir !== null ? [storeDir] : []), configDir]
    : entries.map((e) => e.path);

  // NO COUNT HERE (finding #26; review of #188). The sizes were never the cause
  // of #26 — both arms always walked the same files — what moved between the
  // owner's two runs was the store's write-ahead log, folded in by the MCP
  // server the FIRST run's pre-flight started. So the command takes its sizes
  // again after its pre-flight (`remeasured`) and only THEN counts (`counted`),
  // so that nothing this process opens can move the number it prints.
  return {
    ...empty,
    storeActed,
    entries,
    foreign,
    wholeDirectory,
    targets,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    logBytes: storeActed && storeDir !== null ? walBytes(storeDir) : 0,
    refusal: null,
  };
}

/**
 * The plan with its COUNT — the delete arm's, and only after the sizes it
 * prints have been taken. `censusOf` opens the store (observer); today that
 * open-and-close leaves the log byte-identical under bun, but the order is what
 * guarantees it rather than a property of the current `store/` (`store/`'s
 * INTERFACE-GAPS §13 ask would change that property).
 */
export function counted(plan: UninstallPlan): UninstallPlan {
  return { ...plan, census: censusOf(plan.configDir, plan.storeDir) };
}

/** What each thing IS, in the words somebody who never read this code would
 *  use — the owner's screen of 2026-09-22, where "the scope registry" became
 *  "which directories memory is on for". */
const WHAT: Record<OwnedKind, string> = {
  config: "the configuration",
  scopes: "which directories memory is on for",
  snapshots: "the snapshots",
  store: "your memory",
  sidecar: "a file this package left",
};

/** The same things named in a list rather than a column, for the one sentence
 *  under `--park`'s arrow: "your memory, configuration, snapshots". */
const SHORT_WHAT: Record<OwnedKind, string> = {
  config: "configuration",
  scopes: "scopes",
  snapshots: "snapshots",
  store: "your memory",
  sidecar: "files it left behind",
};

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Why this CONFIGURATION DIRECTORY may not be acted on, or null.
 *
 * `start-fresh`'s ring, plus the four the blocker added: the host's own
 * `~/.claude`, the home directory, any PARENT of the home directory, and
 * anything holding a `.git`. The host's own directory is also wherever
 * `CLAUDE_CONFIG_DIR` puts it, when `env` says so (review of #337).
 */
export function configDirRefusal(
  configDir: string,
  configPath: string,
  home: string,
  verb: string,
  env: Record<string, string | undefined> = {},
): string | null {
  // THE RAW SPELLING DECIDES THIS ONE. `resolve()` is relative to the process
  // working directory and always hands back an absolute path, so a test on the
  // resolved value can never fail — and a relative `dataDir` or `--config`
  // names a different directory in every process that reads it.
  const raw = configDir.trim();
  if (raw.length === 0) {
    return `refused: nothing named a directory to ${verb}.`;
  }
  if (!isAbsolute(raw)) {
    return (
      `refused: "${raw}" is not an absolute path, so it names a different directory in every ` +
      `process that reads it. This will not ${verb} whatever happens to sit at that name in ` +
      `its own working directory (${resolve(raw)}).`
    );
  }
  const written = resolve(raw);
  const forbidden = forbiddenBaseRefusal(written);
  if (forbidden !== null) return forbidden;
  const real = realpathDeep(written);
  const realHome = realpathDeep(home);
  if (real === parsePath(real).root) {
    return `refused: ${written} resolves to a filesystem root (${real}). Nothing here will ${verb} that.`;
  }
  if (real === realHome) {
    return `refused: ${written} resolves to your home directory (${real}). Nothing here will ${verb} that.`;
  }
  if (isWithin(real, realHome)) {
    return (
      `refused: ${written} resolves to ${real}, which CONTAINS your home directory. ` +
      `Nothing here will ${verb} that.`
    );
  }
  if (!isWithin(realHome, real)) {
    return (
      `refused: ${written} resolves to ${real}, which is outside your home directory ` +
      `(${realHome}). This command acts on what an install of yours wrote; a path anywhere ` +
      "else is one somebody else is responsible for."
    );
  }
  // THE HOST'S OWN DIRECTORY, BY NAME. `install --config ~/.claude/claude-code.json`
  // is a command somebody can type, and the first version of this file renamed
  // Claude Code's settings, project transcripts and todos away under a heading
  // that said "Your memory, parked".
  // `CLAUDE_CONFIG_DIR` MOVES IT (review of #337): the host keeps the same
  // settings, transcripts and todos there instead, so a configuration inside
  // `~/.claude-work` is the same mistake as one inside `~/.claude`.
  if (real === realpathDeep(join(home, ".claude")) || real === realpathDeep(resolve(hostSettingsDir(home, env)))) {
    return (
      `refused: ${written} is Claude Code's own configuration directory. Whatever this ` +
      "install put there, the settings, the project transcripts and the todos beside it are " +
      `the host's, and this command will not ${verb} them. Move the configuration somewhere ` +
      "of its own and run this again."
    );
  }
  if (existsSync(join(written, ".git"))) {
    return (
      `refused: ${written} holds a .git, so it is a repository somebody is working in. ` +
      `This command will not ${verb} a directory whose contents are under version control ` +
      "alongside a configuration that happens to sit in it."
    );
  }
  let stat;
  try {
    stat = lstatSync(written);
  } catch {
    return `refused: ${written} is not there, so there is nothing to ${verb}.`;
  }
  if (stat.isSymbolicLink()) {
    return (
      `refused: ${written} is a SYMBOLIC LINK (to ${real}). Renaming a link moves the link and ` +
      "leaves the real directory exactly where it is — and removing one removes the link while " +
      "the memories stay live and unreachable. Act on the real directory by hand."
    );
  }
  if (!stat.isDirectory()) {
    return `refused: ${written} is not a directory.`;
  }
  if (!existsSync(configPath)) {
    return (
      `refused: ${configPath} is not there, so this is not a Counterparts install to ${verb}.`
    );
  }
  return null;
}

/**
 * Why the STORE may not be acted on, or null — the same ring, applied to the
 * one thing that can live anywhere (review M1).
 *
 * A store that fails any of these is a refusal rather than something left
 * behind: the whole purpose of both moving arms is the memory, and a `--park`
 * that parked a configuration and left the memory live somewhere else is the
 * lie the review found.
 */
export function storeRefusal(storeDir: string, home: string, verb: string): string | null {
  const written = resolve(storeDir);
  const forbidden = forbiddenBaseRefusal(written);
  if (forbidden !== null) return forbidden;
  const real = realpathDeep(written);
  const realHome = realpathDeep(home);
  if (real === parsePath(real).root || real === realHome || isWithin(real, realHome)) {
    return `refused: the store resolves to ${real}. Nothing here will ${verb} that.`;
  }
  if (!isWithin(realHome, real)) {
    return (
      `refused: the store is at ${real}, outside your home directory (${realHome}). This ` +
      `command will not ${verb} it there. Move it by hand, or point "dataDir" somewhere of ` +
      "your own first."
    );
  }
  let stat;
  try {
    stat = lstatSync(written);
  } catch {
    return null; // not there: nothing to act on, and not a refusal
  }
  if (stat.isSymbolicLink()) {
    return (
      `refused: the store at ${written} is a SYMBOLIC LINK (to ${real}). Renaming one moves the ` +
      "link and leaves the memories exactly where they are; removing one leaves them live and " +
      "unreachable. Act on the real directory by hand."
    );
  }
  if (!stat.isDirectory()) {
    return `refused: the store at ${written} is not a directory.`;
  }
  if (!storeExists(written)) {
    return (
      `refused: ${written} does not look like a Counterparts store — nothing this build ` +
      `recognises as one is in it. This will not ${verb} a directory on the strength of a ` +
      `"dataDir" alone.`
    );
  }
  return null;
}

// ── printing it ─────────────────────────────────────────────────────────────

/**
 * The plan — printed BEFORE anything is asked, and in the two shapes the owner
 * drew on 2026-09-22.
 *
 * `--delete-memories` is a column: path, size, what it is, with the store's
 * count on the store's own line. `--park` is a list of arrows, because the
 * thing a rename does is the arrow, and one sentence under it saying what is
 * inside.
 *
 * **Home paths are written `~/…`** (item 13). Only on screen: every path this
 * command actually acts on is the absolute one, and every refusal still prints
 * it in full, because a refusal is a thing somebody has to be able to act on.
 */
export function planLines(
  plan: UninstallPlan,
  verb: "park" | "delete",
  home: string,
  /** The suffix `--park` will append — for the destination column. Null when
   *  it could not be worked out, in which case the arrow is left off. */
  suffix: string | null = null,
  /** The delete plan's first line, when it is an offer rather than the plan
   *  of a command somebody already typed. */
  deleteLead = "This will delete, for good:",
): string[] {
  const out: string[] = [];
  const short = (path: string): string => tilde(path, home);
  if (verb === "park") {
    out.push("This will set aside (renamed, nothing copied, nothing deleted):");
    for (const from of plan.targets) {
      out.push(
        suffix === null
          ? `  ${short(from)}`
          : `  ${short(from)}  →  ${short(`${from}${suffix}`)}`,
      );
    }
    if (plan.targets.length === 0) out.push("  (nothing — there is none of ours left here)");
    else {
      out.push(`     ${contentsSentence(plan)}`);
      for (const line of logClause(plan.logBytes, storeBytesOf(plan)) ?? []) out.push(`     ${line}`);
    }
  } else {
    out.push(deleteLead);
    // Two columns, sized to what is actually in them: the paths are shortened
    // by now and the sizes are short by construction, so nothing here needs the
    // 60-character ceiling the absolute paths did.
    const pathWidth = plan.entries.reduce((n, e) => Math.max(n, short(e.path).length), 0);
    const sizeWidth = plan.entries.reduce((n, e) => Math.max(n, humanBytes(e.bytes).length), 0);
    for (const e of plan.entries) {
      const what =
        e.kind === "store" && plan.census !== null ? `${e.what} — ${censusWords(plan.census)}` : e.what;
      out.push(
        `  ${short(e.path).padEnd(pathWidth)}  ${humanBytes(e.bytes).padEnd(sizeWidth)}   ${what}`,
      );
      // UNDER THE STORE'S OWN ROW, in the column its words are in: "that" is
      // the size just printed on the line above.
      const log = e.kind === "store" ? logClause(plan.logBytes, e.bytes) : null;
      for (const line of log ?? []) out.push(`${" ".repeat(2 + pathWidth + 2 + sizeWidth + 3)}${line}`);
    }
    if (plan.entries.length === 0) out.push("  (nothing — there is none of ours left here)");
    if (plan.wholeDirectory) {
      out.push(`  and the ${short(plan.configDir)} folder itself.`);
    }
  }
  if (!plan.wholeDirectory && plan.foreign.length > 0) {
    out.push("");
    out.push(
      `  ${short(plan.configDir)} itself STAYS. It also holds ` +
        (plan.foreign.length === 1
          ? "1 thing that is not ours:"
          : `${String(plan.foreign.length)} things that are not ours:`),
    );
    for (const name of plan.foreign.slice(0, 12)) out.push(`    ${name}`);
    if (plan.foreign.length > 12) out.push(`    … and ${String(plan.foreign.length - 12)} more`);
    out.push("  None of those is touched.");
    if (plan.foreign.includes(LEGACY_CREDENTIALS_FILE)) {
      out.push(
        `  (${LEGACY_CREDENTIALS_FILE} is from an older install that used API keys. Counterparts no longer reads it; delete it yourself if you like.)`,
      );
    }
  }
  if (plan.storeDir !== null && !plan.storeInside) {
    out.push("");
    out.push(`  Your memory is NOT inside that directory — it is at ${short(plan.storeDir)},`);
    out.push(`  and it is ${verb === "park" ? "moved" : "deleted"} there, on its own line above.`);
  }
  if (plan.storeDir !== null && !plan.storeActed) {
    out.push("");
    out.push(
      `  There is no store at ${short(plan.storeDir)}, so no memory is ${verb === "park" ? "moved" : "deleted"}.`,
    );
  }
  return out;
}

/** The store's own row's bytes, or 0 when no store is acted on. */
function storeBytesOf(plan: UninstallPlan): number {
  return plan.entries.find((e) => e.kind === "store")?.bytes ?? 0;
}

/** `your memory, configuration, API keys, snapshots — 7.6 MB`: what is inside
 *  the thing being renamed, since the arrow above names a folder rather than
 *  its contents. The store first, then the rest in the order they were read. */
function contentsSentence(plan: UninstallPlan): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const e of plan.entries) {
    const word = SHORT_WHAT[e.kind];
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  const what = words.length === 0 ? "this install's own files" : words.join(", ");
  return `${what} — ${humanBytes(plan.bytes)}`;
}

/** Something a delete leaves, and why — said beside the plan, because "all
 *  memories and related data" has to say where it stops (brief, 2026-10-11). */
export interface NotTouched {
  readonly path: string;
  readonly why: string;
}

/**
 * What a delete does NOT touch that somebody might expect it to: Claude Code's
 * own directory (never ours — `configDirRefusal` refuses it as a target), and a
 * snapshots folder the configuration points somewhere of the owner's choosing,
 * which this command leaves alone exactly as `start-fresh` does. The foreign
 * entries in the configuration directory are already named by `planLines`.
 */
export function notTouched(
  plan: UninstallPlan,
  config: AdapterConfig,
  home: string,
  env: Record<string, string | undefined>,
): NotTouched[] {
  const out: NotTouched[] = [
    { path: hostSettingsDir(home, env), why: "Claude Code's own files: its settings, history and transcripts" },
  ];
  if (plan.storeDir !== null) {
    const snaps = resolveSnapshotsDir(plan.storeDir, config.snapshots?.dir).dir;
    if (snaps !== null && existsSync(snaps) && !plan.targets.some((t) => isWithin(t, snaps))) {
      out.push({ path: snaps, why: "the snapshots folder your configuration names — yours to delete" });
    }
  }
  return out;
}

export function notTouchedLines(items: readonly NotTouched[], home: string): string[] {
  if (items.length === 0) return [];
  const width = items.reduce((n, i) => Math.max(n, tilde(i.path, home).length), 0);
  return ["", "  Not touched:", ...items.map((i) => `    ${tilde(i.path, home).padEnd(width)}  ${i.why}`)];
}

/**
 * Whatever would make a park or a delete unsafe RIGHT NOW, as the lines a
 * refusal prints (without its "Nothing has changed."), or null when clear.
 *
 * The first two clauses are the moving arms' own check (review M3): a look that
 * did not happen, and any process of ours at all. The third is `rollback`'s
 * live-holder check, for a delete only: a session whose hooks ran in the last
 * ten minutes, or a memory server whose record is fresh, is evidence about THIS
 * store — the process table cannot always see a session's hooks, and a delete
 * under one leaves its writes going nowhere.
 */
export function openRefusal(
  input: Pick<UninstallInput, "lister" | "nothingIsOpen" | "configPath" | "now">,
  storeDir: string | null,
  holders: boolean,
): string[] | null {
  const sighting = look(input.lister);
  if (!sighting.looked && !input.nothingIsOpen) {
    return [
      "refused: this could not check whether anything of ours is still running — there is no " +
        "usable `ps` here, or it would not answer. A rename does not break an open file handle " +
        "and a delete does not tell a running process it has gone, so this will not proceed on " +
        "a look that did not happen. Close every Claude Code session, dashboard and worker, and " +
        "say so: --nothing-is-open.",
    ];
  }
  if (sighting.processes.length > 0) {
    return [
      `refused: ${String(sighting.processes.length)} Counterparts process${sighting.processes.length === 1 ? " is" : "es are"} still running:`,
      ...sighting.processes.map((p) => `  ${p.what}, pid ${String(p.pid)}`),
      "A rename does not break an open file handle and a delete does not tell a running " +
        "process it has gone. Close Claude Code sessions and try again.",
    ];
  }
  if (holders && storeDir !== null && existsSync(storeDir)) {
    const refusing = liveHolders(storeDir, input).filter((h) => h.refuse);
    if (refusing.length > 0) {
      return [
        "refused: this store is open in:",
        ...refusing.map((h) => `  ${h.what} — ${h.detail}`),
        "Close every Claude Code session on it, quit Claude Desktop and stop the dashboard, then " +
          `try again. A session that crashed or whose terminal was closed counts for ${String(Math.round(OPEN_WINDOW_MS / 60_000))} ` +
          "minutes after its last hook.",
      ];
    }
  }
  return null;
}

/** `rollback`'s holders, minus the process table (the caller's `look` has it). */
function liveHolders(
  storeDir: string,
  input: Pick<UninstallInput, "configPath" | "now">,
): Holder[] {
  return readHolders({ storeDir, configPath: input.configPath, now: input.now });
}

// ── the command ─────────────────────────────────────────────────────────────

export interface UninstallInput {
  readonly io: Io;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  readonly configPath: string;
  readonly custom: string | undefined;
  /** The whole configuration, so the plan can find the store and the
   *  snapshots wherever the file put them. */
  readonly config: AdapterConfig;
  readonly now: number;
  readonly yes: boolean;
  readonly park: boolean;
  readonly deleteMemories: boolean;
  /** The assertion that every session, dashboard and MCP server is closed —
   *  the same flag and the same meaning `start-fresh` gives it. Only a way past
   *  a process check that could not LOOK; it never excuses one that found
   *  something. */
  readonly nothingIsOpen: boolean;
  /** `--keep-memories`: do not put the delete question; the memory stays.
   *  Absent is false. */
  readonly keepMemories?: boolean;
  readonly exe: string;
  readonly spawner: Spawner;
  readonly lister: ProcessLister;
  /** Filled in as the command goes, for `--json`'s result. */
  readonly record?: UninstallRecord;
}

/** What happened, for the one JSON line `uninstallJson` prints. */
export interface UninstallRecord {
  /** True once the hooks and the registration are out. */
  unwired: boolean;
}

export async function uninstall(input: UninstallInput): Promise<Outcome> {
  const { io, env, home } = input;
  const u = ui(io, env);
  const configDir = resolve(join(input.configPath, ".."));
  const moving = input.park || input.deleteMemories;
  const verb = input.park ? "park" : "delete";

  // THE COMMAND THAT IS RUNNING, flag and all: three arms of this command do
  // three different things to somebody's memory, and the heading is the one
  // line that says which of them they typed.
  u.heading(
    `${BIN.cli} uninstall${
      input.park
        ? " --park"
        : input.deleteMemories
          ? " --delete-memories"
          : input.keepMemories === true
            ? " --keep-memories"
            : ""
    }`,
  );
  // ONLY WHEN SOMEBODY NAMED ONE. The default configuration is the path in
  // every line below it; a `--config` somewhere else is the fact that explains
  // a screen full of paths nobody expected (`install --config` is supported,
  // and it is how the 2026-09-21 blocker was reached).
  if (input.custom !== undefined) u.hint(`configuration: ${tilde(input.configPath, home)}`);
  u.blank();

  // ── BEFORE EVERY ARM, including the one that only reads ──────────────────
  const forbidden = forbiddenBaseRefusal(configDir);
  if (forbidden !== null) {
    io.err(forbidden);
    io.err("Nothing has changed and nothing was read.");
    return "refused";
  }

  // ── the two flags are one choice ─────────────────────────────────────────
  if (input.park && input.deleteMemories) {
    io.err(
      "refused: --park moves your memory aside and --delete-memories destroys it. They are two " +
        "answers to one question, and this will not guess which one you meant.",
    );
    return "refused";
  }
  if (input.keepMemories === true && moving) {
    io.err(
      `refused: --keep-memories keeps your memory where it is and --${input.park ? "park" : "delete-memories"} ` +
        `${input.park ? "moves it aside" : "destroys it"}. They are two answers to one question, and this will ` +
        "not guess which one you meant.",
    );
    return "refused";
  }

  let plan: UninstallPlan | null = null;
  if (moving) {
    plan = planUninstall({ configPath: input.configPath, config: input.config, home, verb, env });
    if (plan.refusal !== null) {
      io.err(plan.refusal);
      io.err("Nothing has changed.");
      return "refused";
    }
    if (input.park) {
      // `plan.targets`, NOT `plan.entries`: when the directory moves whole it
      // is the directory that is renamed, and checking only the things inside
      // it left a `~/.counterparts` that is its own mount point to fail at
      // `renameSync` with EXDEV instead of refusing up front.
      for (const entry of plan.targets) {
        const cross = sameFilesystemRefusal(entry);
        if (cross !== null) {
          io.err(cross);
          io.err("Nothing has changed.");
          return "refused";
        }
      }
    }

    // ── AND NOTHING OF OURS MAY BE RUNNING — FAILING CLOSED (review M3) ─────
    //
    // A rename does not break an open file handle: an MCP server or a worker
    // would go on writing into the PARKED directory. A delete is worse: the
    // writes go nowhere at all and nothing says so. And a check that cannot
    // tell "I found nothing" from "I could not look" is not a check — the
    // review parked a store on a box with no `ps` and got no word about it.
    // A delete also takes `rollback`'s live holders (2026-10-11).
    const open = openRefusal(input, plan.storeDir, input.deleteMemories);
    if (open !== null) {
      for (const line of open) io.err(line);
      io.err("Nothing has changed.");
      return "refused";
    }

    // ── AND `claude` MUST BE REACHABLE IF THERE IS ANYTHING TO DEREGISTER ──
    //
    // The pre-flight half of review M2: the common failure is `claude` simply
    // not on this PATH, and finding that out AFTER the hooks are gone costs a
    // person their wiring for nothing. `claude mcp list` is read-only.
    const preflight = mcpPreflight(input, home);
    if (preflight !== null) {
      io.err(preflight);
      io.err("Nothing has changed.");
      return "refused";
    }

    // ── THE SIZES, TAKEN AGAIN NOW (finding #26) ─────────────────────────────
    //
    // The pre-flight's `claude mcp list` STARTS OUR MCP SERVER as a health
    // check, and that server — a writer, in another process — folds the
    // store's write-ahead log into the database on its way out: measured on a
    // throwaway store, 3.8 MB of log to 0, the database 2.9 → 3.3 MB (NOTES,
    // 2026-09-23). That is the owner's 6.7 MB and 1.4 MB: the delete plan was
    // sized before its own pre-flight, and the park plan a minute later found
    // the log already folded. Sizing AFTER the pre-flight, in both arms,
    // measures the ground as it stands when the question is put — `lstat`
    // only, so THIS process still never opens a store it parks — and whatever
    // log is still there is said.
    plan = remeasured(plan);
    // AND ONLY THEN THE COUNT, which opens the store: after the sizes, so it
    // cannot move the number printed above it.
    if (input.deleteMemories) plan = counted(plan);

    // ── THE PLAN, PRINTED, BEFORE A SINGLE QUESTION ────────────────────────
    //
    // The park arm shows WHERE each thing is going, which means working the
    // dated suffix out here rather than at the rename. It is worked out AGAIN
    // when the renames happen (`parkPlan`) — the ground can move while somebody
    // reads — and the report afterwards prints the names that were actually
    // used, so a `-2` from a collision is visible rather than assumed.
    for (const line of planLines(plan, input.park ? "park" : "delete", home, previewSuffix(input, plan))) {
      io.out(line);
    }
    if (input.deleteMemories) {
      for (const line of notTouchedLines(notTouched(plan, input.config, home, env), home)) io.out(line);
    }
    u.blank();
  }

  // ── the count, and the typed phrase, BEFORE the hooks come out ───────────
  //
  // Keyed on the FLAG, not on the count being there: the typed phrase is the
  // whole guard on the one destructive verb, and it must never fall through to
  // the ordinary yes/no because a count went missing.
  if (input.deleteMemories && plan !== null) {
    if (io.prompt === undefined) {
      io.err(
        "refused: --delete-memories needs a person. It has no --yes and never will: the typed " +
          "phrase is the whole guard, and a script that could supply it would be a script that " +
          "deletes somebody's memory by having the right string in it.",
      );
      return "refused";
    }
    const stopped = await phraseGate(input, u, plan);
    if (stopped !== null) return stopped;
    // THE HOLDERS AGAIN, after a person read and typed (review of #414: the
    // offer looked twice and this arm once).
    const openAgain = openRefusal(input, plan.storeDir, true);
    if (openAgain !== null) {
      for (const line of openAgain) io.err(line);
      io.err("Nothing has changed.");
      return "refused";
    }
  } else if (!input.yes) {
    if (io.prompt === undefined) {
      io.err(
        "refused: this is not an interactive console and nothing was confirmed. Pass --yes if " +
          "that is what you mean.",
      );
      return "refused";
    }
    // THE QUESTION SAYS WHAT IT IS AGREEING TO, and the tag says how to get
    // out (item 8: every prompt that can be cancelled says how in its own
    // text). Esc and `n` are the same answer here.
    // When the delete question follows, this one no longer promises the memory
    // stays: the next question is about exactly that.
    const go = await confirm(
      io,
      input.park || offers(input)
        ? "Claude Code will be disconnected. Go ahead?"
        : "Claude Code will be disconnected — your memory stays exactly where it is. Go ahead?",
      { default: true, hint: "(Esc or n to stop)" },
    );
    if (!go) {
      io.out(input.park ? "Cancelled. Nothing was moved." : "Cancelled. Nothing was changed.");
      return "ok";
    }
  }

  // ── the wiring ────────────────────────────────────────────────────────────
  const wireInput: WireInput = {
    io,
    env,
    home,
    configPath: input.configPath,
    custom: input.custom,
    store: input.config.dataDir ?? join(configDir, "store"),
    now: input.now,
    yes: true,
    dryRun: false,
    exe: input.exe,
    spawner: input.spawner,
    lister: input.lister,
    heading: true,
  };
  u.blank();
  const removed = await unwire(wireInput);
  if (removed.outcome !== "ok") {
    io.err("");
    io.err(
      moving
        ? "The wiring could not be removed, so NOTHING WAS MOVED OR DELETED — hooks pointing at " +
          "a directory that is not there fail at every session start, silently. Fix the above " +
          "and run this again."
        : "The wiring could not be removed. Your memory is untouched.",
    );
    return removed.outcome;
  }
  // ── THE DEREGISTRATION IS CONFIRMED, OR THIS STOPS HERE (review M2) ───────
  if (moving && !removed.mcpConfirmed) {
    io.err("");
    io.err(
      "refused: the MCP registration is still there and this could not remove it, so NOTHING " +
        "WAS MOVED OR DELETED. A server pointed at a store that is gone fails at every session " +
        "start with nothing on screen — which is the same reason the hooks are not left behind " +
        "either. Run the line above, then run this again.",
    );
    io.err(`The hooks are out; \`${BIN.cli} connect\` puts them back if you want them.`);
    return "refused";
  }

  if (input.record !== undefined) input.record.unwired = true;

  // ── the memory ────────────────────────────────────────────────────────────
  u.blank();
  if (plan !== null && input.park) return parkPlan(input, u, plan);
  if (plan !== null && input.deleteMemories) return deletePlan(input, u, plan);

  u.heading("Your memory");
  const kept = censusOf(configDir, input.config.dataDir ?? null);
  const where = tilde(input.config.dataDir ?? join(configDir, "store"), home);
  u.ok(
    kept.kind === "memories"
      ? `${memories(kept.memories)} ${kept.memories === 1 ? "is" : "are"} still at ${where}.`
      : `everything is still at ${tilde(configDir, home)} (${humanBytes(kept.bytes)}).`,
  );
  if (offers(input)) return offerDelete(input, u, removed.mcpConfirmed);
  keptHints(input, u);
  return "ok";
}

/**
 * Does the plain arm put the delete question? Only to a person: a console with
 * a prompt, and neither `--yes` (whose sentence is "take the ordinary answer to
 * every question", and the ordinary answer here is keep) nor `--keep-memories`.
 */
function offers(input: UninstallInput): boolean {
  return (
    !input.park &&
    !input.deleteMemories &&
    !input.yes &&
    input.keepMemories !== true &&
    input.io.prompt !== undefined
  );
}

/** The plain arm's closing lines when the memory stays. */
function keptHints(input: UninstallInput, u: Ui): void {
  const cli = consoleName(input.env, input.home);
  u.hint("Nothing here deleted anything. To move it aside under a dated name:");
  u.hint(`  ${cli} uninstall --park`);
  u.hint("To destroy it (it prints the whole plan first, then asks you to type a phrase):");
  u.hint(`  ${cli} uninstall --delete-memories`);
  u.blank();
  input.io.out(`To remove the program too: ${removeProgram(input.env)}`);
}

/**
 * The warning and the typed phrase — the whole guard on a delete, shared by
 * `--delete-memories` and the plain arm's offer. Null means the phrase was
 * typed; anything else is the outcome to return, and nothing was deleted.
 *
 * THREE ANSWERS, TWO SENTENCES, TWO EXIT CODES. Stopping is something somebody
 * chose and it exits 0; typing the wrong thing is a refusal, in case it was a
 * script or a paste that went wrong.
 */
async function phraseGate(input: UninstallInput, u: Ui, plan: UninstallPlan): Promise<Outcome | null> {
  const { io } = input;
  const census = plan.census ?? censusOf(plan.configDir, plan.storeDir);
  // A PLAIN RED WARNING, not a `fail` tag (owner, finding #25): nothing has
  // failed here. The count it used to carry is on the store's own line of the
  // plan above, which is the line it is a count of.
  u.warning(
    "nothing can bring these back afterwards.",
    `(${consoleName(input.env, input.home)} uninstall --park sets them aside instead of deleting.)`,
  );
  if (census.kind === "size") {
    u.hint(`The count could not be taken: ${census.why}.`);
  }
  u.blank();
  const said = await typed(io, DELETE_PHRASE, PHRASE_PROMPT);
  if (said === "cancelled") {
    io.out("Cancelled. Nothing was deleted.");
    return "ok";
  }
  if (said !== "typed") {
    io.err(`That was not ${DELETE_PHRASE}. Nothing was deleted.`);
    return "refused";
  }
  return null;
}

/**
 * THE OFFER (Mike, 2026-10-11): after the wiring is out, ask whether to delete
 * the memory too — default NO — and a yes leads to the same typed phrase.
 *
 * Not offered, with the reason said, when a delete could not go ahead anyway:
 * the registration is still there (review M2), the plan refuses, or something
 * holds the store (`openRefusal`). Asked rather than refused after a yes,
 * because a question whose yes is always refused is a question nobody should
 * be put. Everything is looked at AGAIN after the phrase — somebody may have
 * opened a session while reading — and anything changed is a refusal.
 */
async function offerDelete(input: UninstallInput, u: Ui, mcpConfirmed: boolean): Promise<Outcome> {
  const { io, home, env } = input;
  const withheld = (why: readonly string[]): Outcome => {
    u.blank();
    io.out("Deleting your memory is not offered right now:");
    for (const line of why) io.out(`  ${line.replace(/^refused: /, "")}`);
    u.blank();
    keptHints(input, u);
    return "ok";
  };
  if (!mcpConfirmed) {
    return withheld([
      "the memory server is still registered (above), and a server pointed at a store that is " +
        "gone fails at every session start. Remove it, then run uninstall again.",
    ]);
  }
  const planInput: PlanInput = { configPath: input.configPath, config: input.config, home, verb: "delete", env };
  let plan = planUninstall(planInput);
  if (plan.refusal !== null) return withheld([plan.refusal]);
  if (plan.targets.length === 0) {
    keptHints(input, u);
    return "ok";
  }
  const open = openRefusal(input, plan.storeDir, true);
  if (open !== null) return withheld(open);

  plan = counted(remeasured(plan));
  u.blank();
  for (const line of planLines(plan, "delete", home, null, "If you say yes, this deletes, for good:")) io.out(line);
  for (const line of notTouchedLines(notTouched(plan, input.config, home, env), home)) io.out(line);
  u.blank();
  const yes = await confirm(io, DELETE_QUESTION, { default: false, hint: "(Enter keeps them)" });
  if (!yes) {
    io.out("Kept. Nothing was deleted.");
    u.blank();
    io.out(`To remove the program too: ${removeProgram(env)}`);
    return "ok";
  }
  u.blank();
  const stopped = await phraseGate(input, u, plan);
  if (stopped !== null) return stopped;

  // THE GROUND AGAIN, after a person read and typed.
  const again = planUninstall(planInput);
  const openAgain = openRefusal(input, again.storeDir, true);
  const moved =
    again.refusal !== null ||
    again.targets.length !== plan.targets.length ||
    again.targets.some((t, i) => t !== plan.targets[i]);
  if (openAgain !== null || moved) {
    for (const line of openAgain ?? [again.refusal ?? "refused: what this would delete changed while you were reading it."]) {
      io.err(line);
    }
    io.err("Nothing was deleted. Run uninstall again to see the plan as it stands now.");
    return "refused";
  }
  u.blank();
  return deletePlan(input, u, { ...again, census: plan.census });
}

/**
 * The same plan with every size taken again from the filesystem — `dirSize` and
 * `walBytes`, `lstat` and `readdir` only, nothing opened. What moves or goes,
 * and the count, are unchanged: only the numbers are brought up to now.
 */
export function remeasured(plan: UninstallPlan): UninstallPlan {
  const entries = plan.entries.map((e) => ({ ...e, bytes: dirSize(e.path) }));
  return {
    ...plan,
    entries,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    logBytes: plan.storeActed && plan.storeDir !== null ? walBytes(plan.storeDir) : 0,
  };
}

/**
 * The suffix the park arm is ABOUT to use, for the destination column — or null
 * when it cannot be worked out yet.
 *
 * Never a decision: `parkPlan` computes its own at the moment of the rename,
 * against the ground as it is then. This one exists so the screen can show
 * somebody where their memory is going before they agree to it, and a failure
 * here costs an arrow rather than the command (the real refusal, with its
 * sentence, comes from the same call inside `parkPlan`).
 */
function previewSuffix(input: UninstallInput, plan: UninstallPlan): string | null {
  if (!input.park || plan.targets.length === 0) return null;
  try {
    return pairedSuffix([...plan.targets], dateOf(input.now));
  } catch {
    return null;
  }
}

/**
 * Is `claude` reachable, when there is a registration that has to go?
 *
 * The pre-flight half of review M2, and it is deliberately narrow: **it only
 * bites when a registration is actually there.** A person who never wired, or
 * who drives this package from another host entirely, has nothing to deregister
 * and must not be stopped by a binary they do not need. The first cut asked
 * unconditionally and refused every `--park` on a box without `claude` — the
 * opposite failure, and it showed up on the very repro it was written for.
 *
 * Read-only: `claude mcp list` changes nothing. A registration we cannot SEE is
 * not a reason to refuse either; `unwire`'s own confirmation covers that one
 * after the fact, before anything irreversible happens.
 */
function mcpPreflight(input: UninstallInput, home: string): string | null {
  const mcp = readMcp(home, input.env, input.config.dataDir ?? "", input.custom, input.exe);
  if (!mcp.present && !mcp.unreadable) return null;
  // THE WAIT, SAID OUT LOUD (the owner's 0.2.0 trial, 2026-09-22). `claude mcp
  // list` health-checks every MCP server a person has registered, which takes
  // seconds, and until this line both moving arms sat on a blank screen while
  // it ran. `spawnSync` blocks the event loop, so nothing can animate — a
  // spinner was ruled out for exactly that reason — and one static line is the
  // whole of it. Printed HERE, after the early return, so somebody with nothing
  // registered is never told about a check that does not happen; and only to a
  // terminal, so a pipe, a script and every test keep the screen they had.
  if (input.io.tty?.stdout === true) {
    input.io.out(CHECKING_CLAUDE_CODE);
    input.io.out("");
  }
  // MISSING, HANGING **AND** ANGRY. A `spawnSync` that timed out comes back
  // `missing: false, code: null`, and a `claude` that exits non-zero on a
  // read-only `mcp list` is one that will not manage a removal either. Testing
  // only `missing` meant a hung binary passed the pre-flight, the hooks came
  // out, and the refusal landed thirty seconds later on the removal instead.
  const probe = input.spawner(["mcp", "list"]);
  if (!probe.missing && probe.code === 0) return null;
  const why = probe.missing
    ? "`claude` is not on this PATH"
    : probe.code === null
      ? "`claude` did not answer"
      : `\`claude mcp list\` exited ${String(probe.code)}`;
  return (
    `refused: ${mcp.file} ${mcp.unreadable ? "could not be read, so a registration may still be there" : `still registers "${MCP_SERVER_NAME}"`}, and ${why}, ` +
    "so it cannot be deregistered — this will not move or delete a store while something may " +
    "still be registered to open it. Fix that, or run " +
    `\`claude mcp remove ${MCP_SERVER_NAME} -s user\` yourself first, then run this again.`
  );
}

/** ONE atomic rename per thing, never a copy, and the store is never opened. */
function parkPlan(input: UninstallInput, u: Ui, plan: UninstallPlan): Outcome {
  const { io, home } = input;
  const date = dateOf(input.now);
  const all = [...plan.targets];
  if (all.length === 0) {
    u.heading("Nothing to park");
    u.hint("None of this install's own files is still here.");
    return "ok";
  }
  // ONE SUFFIX FOR EVERYTHING THIS RUN MOVES, so a set of parked things reads
  // as a set (`start-fresh#pairedSuffix`, same reason).
  let suffix: string;
  try {
    suffix = pairedSuffix(all, date);
  } catch (err) {
    io.err(`refused: ${String((err as Error).message ?? err)}`);
    io.err("Nothing has changed.");
    return "refused";
  }

  const done: { from: string; to: string }[] = [];
  for (const from of all) {
    const to = `${from}${suffix}`;
    try {
      renameSync(from, to);
      done.push({ from, to });
    } catch (err) {
      io.err(`failed to park ${from}: ${String((err as Error).message ?? err)}`);
      io.err(
        done.length === 0
          ? "Nothing was moved. The wiring has been removed; `counterparts connect` puts it back."
          : "What is listed below HAS moved; nothing else has, and nothing was deleted.",
      );
      for (const d of done) io.err(`  ${d.from} -> ${d.to}`);
      return "failed";
    }
  }

  // THE NAMES THAT WERE ACTUALLY USED, not the ones the preview predicted: a
  // collision between the two turns `…parked-2026-09-22` into `…-2`, and this
  // block is the one a person reads to find their memory again.
  u.heading("Set aside");
  for (const d of done) u.ok(`${tilde(d.from, home)}  →  ${tilde(d.to, home)}`);
  if (!plan.storeActed) {
    u.hint("No memory was moved: there was no store at the path the configuration named.");
  }
  if (plan.foreign.length > 0) {
    u.hint(
      `${tilde(plan.configDir, home)} itself was left where it is, with everything in it that is not ours.`,
    );
  }
  u.blank();
  // THE WAY BACK IS A COMMAND NOW (owner, finding #22: the guarded `mv`
  // one-liner "doesn't make sense"). `install` finds a parked folder beside a
  // missing one and asks; the shell line that does it by hand lives in
  // `counterparts help uninstall`, where somebody looking for it can read it
  // whole instead of meeting it at the end of a screen.
  io.out(`To bring it back later: ${consoleName(input.env, home)} install — it finds this folder and asks.`);
  removeProgramAfterGone(input);
  return "ok";
}

/** The only delete in this package, and it happens after everything above. */
function deletePlan(input: UninstallInput, u: Ui, plan: UninstallPlan): Outcome {
  const { io, home } = input;
  const gone: string[] = [];
  for (const path of plan.targets) {
    try {
      rmSync(path, { recursive: true, force: true });
      gone.push(path);
    } catch (err) {
      io.err(`failed to delete ${path}: ${String((err as Error).message ?? err)}`);
      io.err("What is listed below is gone; nothing else was touched.");
      for (const g of gone) io.err(`  ${g}`);
      return "failed";
    }
  }

  u.heading("Deleted");
  // EXACTLY WHAT WENT, PATH BY PATH (review M1). Never "your memory is gone"
  // unless the store itself went.
  for (const path of gone) u.ok(tilde(path, home));
  if (plan.storeActed) {
    u.hint(
      plan.census !== null && plan.census.kind === "memories"
        ? `${memories(plan.census.memories)} ${plan.census.memories === 1 ? "is" : "are"} gone with it.`
        : "Your memory went with it.",
    );
  } else {
    u.hint("No memory was deleted: there was no store at the path the configuration named.");
  }
  if (plan.foreign.length > 0) {
    u.hint(
      `${tilde(plan.configDir, home)} itself is still there, with everything in it that is not ours.`,
    );
  }
  u.hint("Nothing in this package can bring the rest back.");
  u.blank();
  removeProgramAfterGone(input);
  return "ok";
}

// ── --json: the door the plugin's command drives ────────────────────────────

/** The version of the JSON below. Bumped if a field changes meaning. */
export const UNINSTALL_JSON_VERSION = 1;

/**
 * `counterparts uninstall --json` — ONE JSON object on stdout, and nothing else
 * there. Two modes, by the flags beside it:
 *
 *   - **alone: the plan.** Changes nothing — not the wiring, not the store. It
 *     says what a delete would remove (every path, with its size and the count
 *     of memories), what it would leave, whether a delete could go ahead right
 *     now and if not why, and the question the terminal would put. It opens the
 *     store read-only to count, as `--delete-memories` does.
 *   - **`--keep-memories`: uninstall, memory kept** — the wiring out, the store
 *     untouched; no question, because the flag is the answer.
 *
 * **NO SCRIPTED DELETE** (coordinator, 2026-10-11, lightly held, reversing the
 * builder's stdin door): `--delete-memories --json` is refused. This process
 * cannot tell who wrote its stdin, so a phrase read there could have been
 * typed by the model the plugin's command runs under — and a live session
 * holds the store, so a delete from inside one refuses anyway. The plugin's
 * command shows this plan and sends the person to `terminalArgs`, run by hand
 * in a terminal with Claude Code closed, where the phrase is typed at a TTY.
 *
 * Exit codes are the console's: 0 for a plan or a kept uninstall, 2 for a
 * refusal, 3 for a failure part-way. A refusal before this function runs (no
 * configuration, a `--dir`) comes as text on stderr with no JSON.
 */
export async function uninstallJson(input: UninstallInput): Promise<Outcome> {
  const { io, home, env } = input;
  // ALWAYS NAMED, the default included: the next call must act on the
  // configuration this plan read, whatever its environment says.
  const withConfig = ["--config", resolve(input.configPath)];
  const emit = (body: Record<string, unknown>): void => {
    io.out(
      JSON.stringify({
        command: "uninstall",
        version: UNINSTALL_JSON_VERSION,
        configPath: resolve(input.configPath),
        ...body,
      }),
    );
  };
  if (input.park) {
    emit({ mode: "park", outcome: "refused", why: "--json does not park. Run `uninstall --park` at a terminal." });
    return "refused";
  }
  if (input.deleteMemories) {
    emit({
      mode: "delete",
      outcome: "refused",
      why:
        "--json does not delete: the phrase has to be typed by the person, at a terminal. Close " +
        "Claude Code, then run `uninstall` there (terminalArgs in the plan) and answer its question.",
      unwired: false,
    });
    return "refused";
  }

  // ── uninstall, memory kept: the console's own arm, behind a quiet console ─
  if (input.keepMemories === true) {
    const lines: string[] = [];
    const errors: string[] = [];
    // No prompt at all: the flag answered the one question there is, and a
    // console without one is a console nothing can be typed into.
    const quiet: Io = { out: (line) => lines.push(line), err: (line) => errors.push(line) };
    const record: UninstallRecord = { unwired: false };
    const outcome = await uninstall({ ...input, io: quiet, yes: true, record });
    emit({ mode: "keep", outcome, unwired: record.unwired, lines, errors });
    return outcome;
  }

  // ── the plan: reads, and changes nothing ─────────────────────────────────
  const forbidden = forbiddenBaseRefusal(resolve(dirname(input.configPath)));
  if (forbidden !== null) {
    emit({ mode: "plan", outcome: "refused", deletable: false, why: forbidden });
    return "refused";
  }
  let plan = planUninstall({ configPath: input.configPath, config: input.config, home, verb: "delete", env });
  const sighting = look(input.lister);
  const holders =
    plan.storeDir !== null && existsSync(plan.storeDir)
      ? readHolders({ storeDir: plan.storeDir, configPath: input.configPath, now: input.now })
      : [];
  const open = plan.refusal === null ? openRefusal(input, plan.storeDir, true) : null;
  if (plan.refusal === null) plan = counted(plan);
  const why =
    plan.refusal ??
    (open !== null
      ? open.join("\n")
      : plan.targets.length === 0
        ? "there is none of ours left here to delete."
        : null);
  const census = plan.census;
  const kept = notTouched(plan, input.config, home, env);
  emit({
    mode: "plan",
    outcome: "ok",
    deletable: why === null,
    why,
    question: DELETE_QUESTION,
    // What comes next. `terminalArgs` is for the PERSON to run, by hand, in a
    // terminal with Claude Code closed: it asks the question and takes the
    // phrase there. `keepArgs` the plugin's command may run itself.
    terminalArgs: ["uninstall", ...withConfig],
    keepArgs: ["uninstall", "--keep-memories", "--json", ...withConfig],
    configDir: plan.configDir,
    storeDir: plan.storeDir,
    memories: census !== null && census.kind === "memories" ? census.memories : null,
    countWhy: census !== null && census.kind === "size" ? census.why : null,
    bytes: plan.bytes,
    deletes: plan.entries.map((e) => ({
      path: e.path,
      kind: e.kind,
      what: e.what,
      bytes: e.bytes,
      directory: e.directory,
    })),
    // What actually goes: the folder itself when nothing foreign is in it, our
    // entries one by one when something is.
    targets: plan.targets,
    wholeDirectory: plan.wholeDirectory,
    foreign: plan.foreign,
    notTouched: kept,
    running: sighting.looked ? sighting.processes.map((p) => ({ pid: p.pid, what: p.what })) : null,
    holders: holders.map((h) => ({ what: h.what, detail: h.detail, refuse: h.refuse })),
    // The screen a terminal would show, for a caller that shows text.
    lines:
      plan.refusal === null
        ? [
            ...planLines(plan, "delete", home, null, "If you say yes, this deletes, for good:"),
            ...notTouchedLines(kept, home),
          ]
        : [],
  });
  return "ok";
}
