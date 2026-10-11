/**
 * THE CLAUDE CODE PLUGIN'S SEAM — prototype, 2026-10-09.
 *
 * Counterparts can reach Claude Code two ways now. The npm way: `npm i -g
 * counterparts`, then `counterparts install`, which writes the store and its
 * configuration and wires the host by editing `~/.claude/settings.json` and
 * running `claude mcp add`. The plugin way: Claude Code fetches this
 * repository as a plugin (`.claude-plugin/plugin.json` at its root), runs the
 * five hooks `hooks/hooks.json` names and the MCP server `plugin.json` names,
 * and nothing in the person's settings is edited by us at all.
 *
 * Both launch the SAME entry points (`claude-code/bin/hook.ts`,
 * `mcp/bin/serve.ts`) through `plugin-run.sh`. This file is the few things
 * that differ when the launcher is the plugin's:
 *
 *   1. **Knowing it.** `CLAUDE_PLUGIN_ROOT` is set by Claude Code on the
 *      plugin's own hook and server processes, and it is THIS package's root
 *      exactly when the plugin is this copy of Counterparts. Equality, not
 *      presence: the variable is inherited by children, and a settings-wired
 *      hook of a different install must never mistake itself for the plugin.
 *   2. **Not firing twice.** A person with the npm wiring AND the plugin gets
 *      every hook twice (Claude Code merges hooks from settings and plugins
 *      and runs them all) and two memory servers (plugin servers are deduped
 *      only by identical command). The npm installs already out there cannot
 *      learn about the plugin, so the rule has to live on THIS side: **the
 *      plugin stands down wherever the npm wiring is live** — hooks for
 *      hooks, the server for the server — and says so once, at session
 *      start. Same store either way, so nothing needs to change. Where the
 *      plugin is a real install, the line adds that moving to it alone is
 *      optional (`counterparts disconnect`); where it runs from a folder
 *      (`--plugin-dir`, a checkout), it says this is expected and suggests
 *      nothing (`pluginOrigin`) — disconnecting there would leave the live
 *      memory wired to a development folder.
 *   3. **First run without a terminal.** The npm way creates the store and
 *      `~/.counterparts/claude-code.json` at `install`. A plugin has no
 *      install step we run, so the first hook or server to start runs that
 *      same `install` (non-interactive, `--no-connect`: it writes OUR two
 *      things and touches no host file), under a lock so the hook and the
 *      server racing at session start produce one install, not two. The
 *      layout is therefore exactly the npm one, which is what makes moving
 *      between the two a non-event. WHICHEVER of the two makes it, the
 *      session's first SessionStart says so, once: the maker leaves a notice
 *      and the hook takes it (`firstRunNoticePath`), because the server has no
 *      channel to the person and is often first (since #342's sidebar
 *      module, Claude Code starts the hook after the server has finished).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { implicitConfigRefusal } from "./config-path.js";
import type { ConfigChoice } from "./config-path.js";
import { pluginInstall } from "./host-wiring.js";
import type { NpmWiring } from "./host-wiring.js";
import { BINARY, CLI_SCRIPT, parseScriptInvocation, scriptArgs, shellTokens } from "./runtime.js";
import type { Binary } from "./runtime.js";

/** Set by Claude Code on a plugin's hook, MCP and LSP processes. */
export const PLUGIN_ROOT_ENV = "CLAUDE_PLUGIN_ROOT";
/**
 * The plugin's persistent directory — and the memory is deliberately NOT in
 * it. Claude Code deletes `~/.claude/plugins/data/<id>/` when the plugin is
 * uninstalled from its last scope (unless `--keep-data`), and a memory that an
 * uninstall erases is not one anybody agreed to. The store stays where the
 * npm install puts it, `~/.counterparts/store`, which is also what lets a
 * person move between the two installs without moving anything.
 */
export const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

/** This package's root — the directory holding `package.json` and, in this
 *  repository, `.claude-plugin/`. */
export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Is this process the plugin's? True when Claude Code's `CLAUDE_PLUGIN_ROOT`
 * names this very package. Both sides are realpath'd: macOS spells one
 * directory `/var/…` and `/private/var/…`, and a plugin added from a symlinked
 * checkout is the same plugin.
 */
export function runningAsPlugin(
  env: Record<string, string | undefined>,
  packageRoot: string = PACKAGE_ROOT,
  binary: Binary | null = BINARY,
): boolean {
  const named = (env[PLUGIN_ROOT_ENV] ?? "").trim();
  if (named.length === 0) return false;
  // THE SINGLE BINARY: it has no package root on disk — `plugin-run.sh`
  // downloads it into the plugin's own data directory — so "this very copy"
  // is a binary sitting under CLAUDE_PLUGIN_DATA, which Claude Code sets only
  // on the plugin's processes and their children.
  if (binary !== null) {
    const data = (env[PLUGIN_DATA_ENV] ?? "").trim();
    if (data.length === 0) return false;
    const rel = relative(realOrResolved(data), realOrResolved(binary.self));
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
  }
  return realOrResolved(named) === realOrResolved(packageRoot);
}

/** `~/…` for a path under the home directory, for a line a person reads. */
function tildeOf(path: string, home: string): string {
  const h = resolve(home);
  const p = resolve(path);
  return p === h ? "~" : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
}

/**
 * Where this copy of the plugin was loaded from. `installed`: Claude Code put
 * it there — it lies under Claude Code's plugins directory (its install cache;
 * `CLAUDE_CODE_PLUGIN_CACHE_DIR`, else `<config dir>/plugins`), or it is the
 * path `installed_plugins.json` records for `counterparts@…` (a folder
 * marketplace is read in place). Anything else is a folder somebody pointed
 * `claude --plugin-dir` (or `CLAUDE_CODE_PLUGIN_DIRS`) at: a development copy.
 * READ-ONLY.
 */
export interface PluginOrigin {
  readonly installed: boolean;
  readonly root: string;
}

export function pluginOrigin(input: {
  readonly home: string;
  readonly env: Record<string, string | undefined>;
  readonly cwd?: string | null;
  readonly root?: string;
}): PluginOrigin {
  // CLAUDE_PLUGIN_ROOT first: the single binary has no package root on disk.
  const named = (input.env[PLUGIN_ROOT_ENV] ?? "").trim();
  const root = realOrResolved(input.root ?? (named.length > 0 ? named : PACKAGE_ROOT)).replace(/\/+$/, "");
  const moved = (input.env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  const configDir = moved.length > 0 ? moved : join(input.home, ".claude");
  const cacheRoot = (input.env["CLAUDE_CODE_PLUGIN_CACHE_DIR"] ?? "").trim();
  const pluginsRoot = realOrResolved(cacheRoot.length > 0 ? cacheRoot : join(configDir, "plugins")).replace(/\/+$/, "");
  if (root === pluginsRoot || root.startsWith(`${pluginsRoot}/`)) return { installed: true, root };
  const recorded = pluginInstall({ home: input.home, env: input.env, cwd: input.cwd ?? null })?.installPath ?? null;
  if (recorded !== null && realOrResolved(recorded).replace(/\/+$/, "") === root) return { installed: true, root };
  return { installed: false, root };
}

/** An install's origin, for a caller that has not read one (the tests' default). */
const INSTALLED: PluginOrigin = { installed: true, root: "" };

/** What the plugin's hook does about the npm wiring, and what it says. */
export interface PluginGate {
  readonly standDown: boolean;
  /** One line for the owner at session start, or null. */
  readonly line: string | null;
}

/**
 * THE HOOKS' RULE: live npm hooks win. A DEAD npm entry (its runtime or script
 * gone — an uninstalled package, a deleted checkout) runs nothing, so the
 * plugin carries on and says the stale lines are there. "Ours" is read by the
 * script the line runs (`host-wiring.ts#readOurHook`), so a line a newer
 * `connect` wrote, with flags this build never heard of, still stands the
 * plugin down. Whatever this misses, the per-event claim in the store catches
 * (`claude-code/claim.ts`): of two hooks that run one event, one delivers.
 */
export function hookGate(wiring: NpmWiring, home: string, origin: PluginOrigin = INSTALLED): PluginGate {
  const live = wiring.hooks.find((h) => h.live);
  if (live !== undefined) {
    return {
      standDown: true,
      line: origin.installed
        ? `Counterparts is installed twice: the npm install's hooks in ${tildeOf(live.file, home)} and this plugin. ` +
          "The plugin is standing down so nothing is captured twice; both use the same memory, so nothing needs to change. " +
          "Optional, only if you want the plugin alone: `counterparts disconnect`, then restart Claude Code."
        : `Counterparts: this plugin is running from a folder (${tildeOf(origin.root, home)}), beside the npm install's hooks in ` +
          `${tildeOf(live.file, home)}. Its own hooks and server stand down and the npm install keeps your memory, ` +
          "as expected. Nothing to do.",
    };
  }
  const dead = wiring.hooks[0];
  if (dead !== undefined) {
    return {
      standDown: false,
      line:
        `Counterparts: ${tildeOf(dead.file, home)} still names an old Counterparts hook that no longer runs. ` +
        "The plugin is keeping your memory; remove those entries to quiet them.",
    };
  }
  return { standDown: false, line: null };
}

/**
 * THE SERVER'S RULE: a live `counterparts` registration in the user or local
 * scope wins. The words become the stood-down server's `instructions`, which
 * is the only thing a model sees of a server with no tools.
 */
export function mcpGate(
  wiring: NpmWiring,
  home: string,
  origin: PluginOrigin = INSTALLED,
): { readonly standDown: boolean; readonly instructions: string | null } {
  const live = wiring.mcp.find((m) => m.live);
  if (live === undefined) return { standDown: false, instructions: null };
  const head =
    `This plugin's Counterparts server is standing down: the npm install already registers a ` +
    `"counterparts" memory server (${live.scope} scope, ${tildeOf(live.file, home)}), and two servers ` +
    "over one memory would offer every tool twice. Use that server's tools. ";
  return {
    standDown: true,
    instructions: origin.installed
      ? head +
        "Nothing needs to change: both use the same memory. Only if the person asks to keep the plugin alone, " +
        "`counterparts disconnect` and a restart of Claude Code do it; it is their choice, never one to make for them."
      : head +
        `This plugin is running from a folder (${tildeOf(origin.root, home)}), not an install, which is expected ` +
        "beside the npm install. Nothing needs to change; do not suggest disconnecting or uninstalling anything.",
  };
}

/**
 * `/counterparts:doctor` run from the plugin while the npm wiring is live
 * here: the plugin is standing down, so its own copy's doctor would describe
 * an install that is not the one keeping the memory (a different version, a
 * development folder). The console then says so and runs the npm install's
 * `counterparts doctor` instead (`cli/bin/counterparts.ts`). Null when nothing
 * of the npm install's is live, and the plugin's doctor is the right one.
 */
export function pluginDoctorLine(wiring: NpmWiring, home: string, origin: PluginOrigin = INSTALLED): string | null {
  const hook = wiring.hooks.find((h) => h.live);
  const mcp = wiring.mcp.find((m) => m.live);
  if (hook === undefined && mcp === undefined) return null;
  const where =
    hook !== undefined
      ? `its hooks in ${tildeOf(hook.file, home)}`
      : `its "counterparts" server (${mcp?.scope ?? "user"} scope, ${tildeOf(mcp?.file ?? "", home)})`;
  const copy = origin.installed ? "This plugin" : `This plugin (running from ${tildeOf(origin.root, home)})`;
  return (
    `${copy} is standing down: the npm install is the live one here (${where}). ` +
    "What follows is the wired npm install's own doctor (`counterparts doctor`), the one that knows your memory."
  );
}

/**
 * The npm install's own `counterparts doctor`, as the live wiring names it:
 * the runtime and the install of the live hook (else the live server), with
 * `cli/bin/counterparts.ts` beside that entry, and the `--config` the wiring
 * passes. Null when no live entry can be read that way (then PATH's
 * `counterparts` is the fallback). PATH alone could find another install than
 * the one actually wired (a second global, a stale checkout).
 */
export function npmDoctorCommand(wiring: NpmWiring): { readonly exe: string; readonly args: readonly string[] } | null {
  const entries = [...wiring.hooks.filter((h) => h.live), ...wiring.mcp.filter((m) => m.live)];
  for (const entry of entries) {
    const tokens = shellTokens(entry.command);
    const call = parseScriptInvocation(tokens);
    if (call === null) continue;
    const at = call.rest.indexOf("--config");
    const config = at >= 0 && call.rest[at + 1] !== undefined ? ["--config", call.rest[at + 1] as string] : [];
    // The single binary is its own install: `<binary> cli doctor`.
    if (call.runtime === "binary") return { exe: call.exe, args: ["cli", "doctor", ...config] };
    // `<root>/src/adapters/claude-code/bin/hook.ts` or `<root>/src/adapters/mcp/bin/serve.ts`.
    const cli = join(dirname(call.script), "..", "..", "cli", "bin", "counterparts.ts");
    if (!existsSync(cli)) continue;
    // Whatever the wiring put between the runtime and its script, as written:
    // Bun's `--no-env-file "--config=…/empty-bunfig.toml" run`, or Node's
    // `--import …/node-hooks.mjs`.
    const scriptAt = tokens.indexOf(call.script, 1);
    const prefix = scriptAt > 0 ? tokens.slice(1, scriptAt) : ["run"];
    return { exe: call.exe, args: [...prefix, resolve(cli), "doctor", ...config] };
  }
  return null;
}

// ── first run ───────────────────────────────────────────────────────────────

/**
 * `joined`: absent when this process looked, made by a CONCURRENT first run
 * (the hook and the server start together) while this one waited.
 */
export type FirstRunState = "existed" | "created" | "joined" | "skipped" | "failed";

export interface FirstRun {
  readonly state: FirstRunState;
  /**
   * A line THIS process has to say itself at session start, or null. That is
   * a failure, and — only when the notice could not be left — the first-run
   * line of an install this process made. Otherwise a new install says
   * nothing here: whichever side made it left a notice, and the session's
   * first SessionStart takes it (`takeFirstRunNotice`), so the line reaches
   * the person once whether the hook or the server got there first.
   */
  readonly line: string | null;
  /** Why it failed or was skipped, for stderr. */
  readonly detail?: string;
}

/** How long a waiting process gives the one holding the lock. An install is a
 *  directory, an empty database and a small JSON file: well under a second on
 *  the machines measured, so twenty is generous and still inside Claude
 *  Code's thirty-second MCP start-up window. */
export const FIRST_RUN_WAIT_MS = 20_000;
/** A lock older than this is a process that died holding it. */
export const FIRST_RUN_STALE_MS = 120_000;
/** The install's own ceiling, as a child process. */
export const FIRST_RUN_TIMEOUT_MS = 60_000;

/**
 * Where the lock lives: the system temp directory, keyed by the configuration
 * path — never inside `~/.counterparts`, where a leftover lock directory would
 * be one more entry for `doctor` and `start-fresh` to have an opinion about.
 */
export function firstRunLockPath(configPath: string, tmp: string = tmpdir()): string {
  return join(tmp, `counterparts-first-run-${firstRunKey(configPath)}.lock`);
}

function firstRunKey(configPath: string): string {
  return createHash("sha256").update(resolve(configPath)).digest("hex").slice(0, 16);
}

/**
 * "A FIRST RUN, NOT YET ANNOUNCED" (0.3.15's plugin loop, step 12). Whoever
 * makes the install — the hook or the server — leaves this file, and the
 * session's first SessionStart takes it and says the first-run line. Before,
 * the line rode only with the process that made or joined the install, which
 * was the hook as long as Claude Code started the hook and the server
 * together. The sidebar mod's `"modules"` entry (#342) makes Claude Code start
 * a hooks worker first and run the SessionStart command after it, so the
 * server's install has finished by then: the hook found the configuration
 * there (`existed`) and said nothing, and a new user was never told a memory
 * had been set up.
 *
 * Beside the lock and for the lock's reasons: the system temp directory, keyed
 * by the configuration path, which the hook and the server demonstrably agree
 * on (it is what the lock settles), and never inside `~/.counterparts`, where
 * `uninstall` would list it as somebody else's file. Only a plugin's first run
 * leaves one — `counterparts install` at a terminal says its own words there —
 * and a plugin hook that stands down for a live npm wiring takes it unsaid.
 */
export function firstRunNoticePath(configPath: string, tmp: string = tmpdir()): string {
  return join(tmp, `counterparts-first-run-${firstRunKey(configPath)}.unannounced`);
}

/**
 * Take the notice: true for exactly one caller, however many sessions start
 * at once (an unlink either removes the file or finds it gone). False when
 * there is none, or it is not ours to remove (another user's file in a shared
 * `/tmp`, which says nothing about this install).
 */
export function takeFirstRunNotice(noticePath: string): boolean {
  try {
    unlinkSync(noticePath);
    return true;
  } catch {
    return false;
  }
}

/** The line a new install is announced with, for the configuration at `configPath`. */
export function firstRunLine(configPath: string, home: string): string {
  const base = dirname(configPath);
  const parked = parkedBeside(base);
  return (
    `Counterparts: first run — a new memory was set up at ${tildeOf(base, home)}. ` +
    "It stays on this computer." +
    (parked.length === 0
      ? ""
      : ` A memory set aside earlier is still at ${parked.map((p) => tildeOf(p, home)).join(", ")}, untouched; ` +
        "the new one does not include it.")
  );
}

/**
 * Leave the notice; false when it could not be written (then the maker says the line itself).
 *
 * CREATED, NEVER OPENED (`wx`, O_EXCL). On Linux the temp directory is a shared
 * `/tmp` and this name is predictable from the home path, so a file or symlink
 * somebody else put there first must not be written through — a plain write
 * follows a planted symlink onto whatever it names. A notice of our own that a
 * dead first run left is removed first, so `wx` refuses only what is not ours
 * (sticky `/tmp` lets nobody else remove it), and the maker says the line itself.
 */
function leaveFirstRunNotice(noticePath: string, configPath: string): boolean {
  takeFirstRunNotice(noticePath);
  try {
    writeFileSync(noticePath, `${JSON.stringify({ config: resolve(configPath), at: new Date().toISOString(), pid: process.pid })}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * A MEMORY SET ASIDE BESIDE THE ONE ABOUT TO BE MADE (review of #328).
 * `counterparts uninstall --park` leaves `<base>.parked-<date>[-N]` next to
 * where the configuration lives (`cli/install.ts#parkedNameParts`, which also
 * checks the date is a real day; the shape is enough here). A non-interactive
 * install walks past one and makes a blank store beside it, and says so on
 * stdout (review M4: "a second store the person does not know about") — but
 * the first run drops that stdout, so the line it hands the wake has to say it
 * instead. Named only: nothing here opens, moves or counts it.
 */
export function parkedBeside(base: string): string[] {
  const dir = dirname(resolve(base));
  const prefix = `${basename(resolve(base))}.parked-`;
  try {
    return readdirSync(dir)
      .filter((n) => n.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(n.slice(prefix.length)))
      .sort()
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface FirstRunInput {
  readonly choice: ConfigChoice;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  /** The runtime that runs the console: this process's own, by default. */
  readonly runtime?: string;
  readonly cliScript?: string;
  readonly lockPath?: string;
  readonly noticePath?: string;
  readonly waitMs?: number;
  readonly staleMs?: number;
  readonly now?: () => number;
  /** Whose a lock must be to be waited on: this process's user by default;
   *  null where the platform has none (Windows). A test's seam. */
  readonly uid?: number | null;
}

/**
 * Make sure the store and the default configuration exist, the way
 * `counterparts install` makes them — by running it.
 *
 * SKIPPED, and nothing written, when a configuration was NAMED (`--config`,
 * `COUNTERPARTS_CONFIG`: somebody chose a file, and a missing one is that
 * entry point's refusal to make) or when the explicit-dir guard is armed (it
 * refuses the implicit default by design; `config-path.ts#implicitConfigRefusal`).
 *
 * The console is SPAWNED rather than imported: adapters do not import each
 * other, and the console is the one place that knows how an install is made
 * ("invent no second install path"). Its output is captured and dropped — a
 * hook's stdout is the model's context, and a server's is the JSON-RPC wire.
 */
export function ensureFirstRun(input: FirstRunInput): FirstRun {
  const { choice, env } = input;
  if (choice.source !== "default") return { state: "skipped", line: null, detail: `configuration named by ${choice.source}` };
  if (existsSync(choice.path)) return { state: "existed", line: null };
  const guard = implicitConfigRefusal(choice, env);
  if (guard !== null) return { state: "skipped", line: null, detail: guard };

  const now = input.now ?? ((): number => Date.now());
  const lock = input.lockPath ?? firstRunLockPath(choice.path);
  const notice = input.noticePath ?? firstRunNoticePath(choice.path);
  const waitMs = input.waitMs ?? FIRST_RUN_WAIT_MS;
  const staleMs = input.staleMs ?? FIRST_RUN_STALE_MS;
  // The install was somebody else's, and so is the notice: they left it before
  // the configuration could appear (below), so it is there for SessionStart.
  const joined: FirstRun = { state: "joined", line: null };

  const take = (): boolean => {
    try {
      mkdirSync(lock, 0o700);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };
  // A LOCK THAT IS NOT THIS USER'S (2026-10-11, from the review of #365). The
  // lock's name is known — the temp directory and a hash of the configuration
  // path — and on Linux the temp directory is a shared `/tmp`, so anybody can
  // make a directory there first, and with the sticky bit nobody else can
  // remove it. Waited on, it made every first run wait its whole bound and
  // fail. So only a directory this user owns, not a link, is another first
  // run at work; anything else is passed over and the install runs without
  // the lock. The lock only keeps the hook and the server, starting together,
  // from installing twice at once, and `install` writes the same two things
  // either way. Where the platform has no uid, the lock is taken as it stands.
  const uid = input.uid !== undefined ? input.uid : typeof process.getuid === "function" ? process.getuid() : null;
  const planted = (): boolean => {
    if (uid === null) return false;
    try {
      const st = lstatSync(lock);
      return !st.isDirectory() || st.uid !== uid;
    } catch {
      return false;
    }
  };

  let held = take();
  if (!held) {
    // Somebody else is installing. Wait for the configuration to appear; a
    // lock older than `staleMs` is a dead process's, and is taken over once.
    const until = now() + waitMs;
    while (!held) {
      if (existsSync(choice.path)) return joined;
      if (planted()) break;
      let age = 0;
      try {
        // The DISTANCE from now (review of #382, as the claims' lock): a lock
        // dated ahead after the clock stepped back is stale, not fresh.
        age = Math.abs(now() - statSync(lock).mtimeMs);
      } catch {
        age = 0;
      }
      if (age > staleMs) {
        try {
          rmdirSync(lock);
        } catch {
          // Gone already, or not ours to remove; `take` below decides.
        }
      }
      held = take();
      if (held) break;
      if (now() >= until) {
        return { state: "failed", line: null, detail: `timed out after ${String(waitMs)} ms waiting for another first run (${lock})` };
      }
      sleepSync(100);
    }
  }
  try {
    // The one who waited may find it done the moment it gets the lock.
    if (existsSync(choice.path)) return joined;
    // THE NOTICE BEFORE THE INSTALL, never after: the configuration appears
    // while the install runs, and a hook that sees it (`existed`, or `joined`
    // while it waited) looks for the notice that same moment.
    const left = leaveFirstRunNotice(notice, choice.path);
    const runtime = input.runtime ?? process.execPath;
    const script = input.cliScript ?? CLI_SCRIPT;
    const res = spawnSync(runtime, [...scriptArgs(script, runtime), "install", "--no-connect"], {
      env: env as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: FIRST_RUN_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.status === 0 && existsSync(choice.path)) {
      return { state: "created", line: left ? null : firstRunLine(choice.path, input.home) };
    }
    if (left) takeFirstRunNotice(notice);
    const why = (String(res.stderr ?? "").trim().split("\n").pop() ?? "") || (res.error?.message ?? `exit ${String(res.status)}`);
    return {
      state: "failed",
      line: `Counterparts could not set up its memory on first run (${why.slice(0, 200)}). Memory is off for this session.`,
      detail: why,
    };
  } finally {
    // Only a lock this process made is released; one passed over is not ours.
    if (held) {
      try {
        rmdirSync(lock);
      } catch {
        // Already gone: nothing to release.
      }
    }
  }
}
