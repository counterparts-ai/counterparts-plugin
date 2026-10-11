/**
 * `counterparts install` — the cold-start command.
 *
 * It exists because a stranger's first five minutes were, until this file,
 * hand-written files: the store, the adapter's configuration, a hooks block in
 * the host's settings, and an MCP registration. Some of those are OURS and some
 * are the HOST'S, and the split is the whole design of this command:
 *
 *   - **Ours, so we write them**: the data directory and `claude-code.json`
 *     BESIDE it. Nothing here is a host file and nothing here belongs to another
 *     program. (An empty `credentials.env` at 0600 was the third until the API
 *     keys were removed on 2026-09-24; nothing reads one now.)
 *   - **The host's**: the `settings.json` hooks block and the `claude mcp add`
 *     line. THIS FILE only builds them (`settingsBlock`, `mcpCommand`), and
 *     they are printed as the manual fallback — a pipe, a script, a CI job, or
 *     `--no-connect`. At a terminal the console's `install` goes on to connect
 *     the host itself (`wire.ts#wire`, 2026-09-22): it merges the hooks block
 *     into `~/.claude/settings.json`, backing the file up first and keeping
 *     every other key, and runs `claude mcp add`; `counterparts disconnect`
 *     undoes both. (Until then this said `install` never opened that file at
 *     all, which stopped being true that day.)
 *
 * Three rules the code below mechanizes:
 *
 *   1. **The config sits BESIDE the store, never inside it.** `store/paths.ts`
 *      classifies every top-level entry of the data dir and `assertLayout()`
 *      refuses an unclassified one (§5 G11), so `claude-code.json` inside the
 *      data dir is a store that will not open. Hence the default layout:
 *      `~/.counterparts/` holds the config, and the store
 *      is `~/.counterparts/store`.
 *   2. **Nothing existing is overwritten without `--force`.** A second
 *      `install` on a live machine reports what it found and changes nothing —
 *      the same idempotence `init` already has, extended to the two files.
 *   3. **No ceiling is invented** (scar §2.18). `injectionBudgetBytes` is
 *      written only when `--budget` says what it is; without it the config is
 *      written without the key and the printed steps say so out loud.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isDay } from "../../core/time.js";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The store directory under the base. Named, because three files agree on it. */
export const DEFAULT_STORE_DIR = "store";

import { EMBEDDER_KINDS } from "../config.js";
import type { EmbedderKind } from "../config.js";
import { CONFIG_ENV, CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import { parseScriptInvocation, runtimeOf, runtimePresent, scriptArgs, shellTokens } from "../runtime.js";
import type { RuntimeKind } from "../runtime.js";
import { pluginInstall, readOurHook } from "../host-wiring.js";
import type { PluginInstallRead } from "../host-wiring.js";
// `preRowsMarkersIn` reads FILENAMES and opens nothing, which is the only
// reason a module that promises never to open a parked store may call it —
// the same clause `start-fresh.ts` states over its own import of it.
import {
  DEFAULT_DATA_DIR_NAME,
  PRE_ROWS_READABLE_BY,
  isWithin,
  preRowsMarkersIn,
} from "../../core/store/index.js";

/** The five host events one executable serves (`claude-code/bin/hook.ts`). */
export const HOST_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "SessionEnd",
  "PreCompact",
] as const;

/** The installed executables, by the names `package.json#bin` gives them. */
export const BIN = {
  cli: "counterparts",
  hook: "counterparts-hook",
  mcp: "counterparts-mcp",
  dashboard: "counterparts-dashboard",
} as const;

/** The name the MCP server is registered under, and the one `status` reports. */
export const MCP_SERVER_NAME = "counterparts";

/**
 * THE TWO ENTRY SCRIPTS, ABSOLUTE, resolved from THIS file's location — never
 * from a working directory and never from a name on a PATH.
 *
 * This is scar §2.18 again, in its sharpest form. Day 0 of the parallel run
 * measured that this host's hook processes carry none of the variables the
 * owner exported in his shell: **the host's process environment is not the
 * login shell's**. The same sentence is true of `PATH`. `counterparts-hook` is
 * a shim whose shebang is `#!/usr/bin/env bun`, so a host that launches hooks
 * without `~/.bun/bin` on PATH gets "command not found" on every event — a
 * memory that is simply never there, with nothing on screen to say why.
 *
 * So the printed commands name the RUNTIME and the SCRIPT by absolute path,
 * which is what the live host has run since 2026-09-03 and what `hook.ts`
 * already does for its own worker (`command: process.execPath, args: ["run",
 * RUNNER_PATH]`). The short names stay on PATH for a human at a terminal; they
 * are not what goes into a host's configuration.
 */
export const HOOK_SCRIPT = fileURLToPath(new URL("../claude-code/bin/hook.ts", import.meta.url));
export const MCP_SCRIPT = fileURLToPath(new URL("../mcp/bin/serve.ts", import.meta.url));

/** Double-quote a path so a shell keeps it whole. Paths with `"` are refused
 *  by being escaped rather than silently mangled. */
export function shellQuote(path: string): string {
  return `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * `<runtime> --no-env-file "--config=<empty-bunfig.toml>" run <script>` under
 * Bun, `<runtime> --import <node-hooks.mjs> <script>` under Node
 * (`adapters/runtime.ts`) — the shape both printed host commands take. A path
 * (or a flag carrying one) is quoted and a bare flag is not. Until 2026-10-09
 * the Bun shape was `<runtime> run <script>`; those commands still read as
 * ours, so `connect` repairs them in place.
 */
export function runCommand(script: string, exe: string = process.execPath): string {
  const words = scriptArgs(script, exe).map((a) => (/^[A-Za-z-]+$/.test(a) ? a : shellQuote(a)));
  return [shellQuote(exe), ...words].join(" ");
}

/**
 * The hook command the host is told to run — and the ONE case where it carries
 * a flag.
 *
 * The default path IS the rule (`adapters/config-path.ts`): a hooks block that
 * spelled out `--config "$HOME/.counterparts/claude-code.json"` would teach a
 * reader that the flag is part of the wiring, and would then be wrong the moment
 * they moved a home directory. So the flag is printed only when this install put
 * the configuration somewhere the hooks would not find on their own, and the
 * output says why (`commands.ts#installCommand`).
 */
export function hookCommand(configPath?: string, exe: string = process.execPath): string {
  const base = runCommand(HOOK_SCRIPT, exe);
  return configPath === undefined || configPath.length === 0
    ? base
    : `${base} ${CONFIG_FLAG} ${shellQuote(configPath)}`;
}

export const CONFIG_FILE = "claude-code.json";
/**
 * The file an install wrote beside the configuration until 2026-09-24, when the
 * API keys were removed. Nothing reads or writes it now; the name is kept so
 * `uninstall` can recognise an old one and say what it is rather than delete
 * it (it may hold somebody's keys).
 */
export const LEGACY_CREDENTIALS_FILE = "credentials.env";

export interface InstallLayout {
  /** The directory holding the config and the store. */
  readonly base: string;
  /** The data dir itself — a SUBDIRECTORY of `base`, never `base` (rule 1). */
  readonly store: string;
  readonly config: string;
}

/**
 * Where an install lands, from the flags and the environment — resolved, never
 * guessed halfway.
 *
 * **`--dir` never moves the base.** `claude-code/bin/hook.ts` and `bin/runner.ts`
 * read `~/.counterparts/claude-code.json` unless something NAMES another file —
 * `--config <absolute path>`, else `COUNTERPARTS_CONFIG`
 * (`adapters/config-path.ts`) — and they fall back to `COUNTERPARTS_DATA_DIR`
 * only when the configuration they read names no store. A hook that finds no
 * config stands down and exits 0 (every hook exits 0; the Stop ask leaves as
 * JSON feedback since 2026-09-24), so a config nothing points them at is a config the ambient half
 * never finds and never complains about. The cold-stranger review of 2026-09-04
 * found exactly that: `--dir` produced a working store, a correct config and
 * correct printed hooks, and an ambient half permanently blind, with nothing on
 * screen to say so.
 *
 * So `--dir` (and `COUNTERPARTS_DATA_DIR`) move the STORE and only the store;
 * `dataDir` in the config is how the hooks are told where it went. `--config`
 * moves the CONFIGURATION — and with it the default store beneath it — and then the printed hooks block and `claude mcp
 * add` line carry it, because a file nothing points at is the failure above.
 *
 * The default store is `~/.counterparts/store`, deliberately NOT `dataDir()`'s
 * `~/.counterparts` — that is the directory holding the two unclassifiable
 * files, and rule 1 is why.
 */
export function installLayout(
  dirFlag: string | undefined,
  env: Record<string, string | undefined>,
  home = homedir(),
  configPath?: string,
): InstallLayout {
  const named =
    dirFlag !== undefined && dirFlag.length > 0
      ? dirFlag
      : (env["COUNTERPARTS_DATA_DIR"] ?? "").trim().length > 0
        ? (env["COUNTERPARTS_DATA_DIR"] as string)
        : undefined;
  // `--config` (or `COUNTERPARTS_CONFIG`) moves the whole BASE — the config and,
  // when no `--dir` says otherwise, the store beneath it. Splitting them would
  // put part of a scratch install in `~/.counterparts/`, which is the live one
  // on the owner's machine; an install that writes there because it was pointed
  // somewhere else is the accident this flag exists to prevent.
  const base =
    configPath === undefined || configPath.length === 0
      ? join(home, DEFAULT_DATA_DIR_NAME)
      : dirname(resolve(configPath));
  const store = named === undefined ? join(base, DEFAULT_STORE_DIR) : resolve(named);
  return {
    base,
    store,
    config:
      configPath === undefined || configPath.length === 0
        ? join(base, CONFIG_FILE)
        : resolve(configPath),
  };
}

/**
 * Why this store cannot hold this install's configuration, or null when it can.
 *
 * The one case: a `--dir` that IS `~/.counterparts`, or any ancestor of it, puts
 * `claude-code.json` inside the data dir, and the layout
 * totality check (§5 G11) refuses an unclassified top-level entry at open. The
 * store would be created and then never open again. Caught before anything is
 * written, and named.
 */
export function layoutRefusal(layout: InstallLayout): string | null {
  if (!isWithin(layout.store, layout.config)) return null;
  return (
    `refused: the configuration lives at ${layout.config}, which would sit INSIDE the ` +
    `data dir ${layout.store}. The store's layout check refuses an unclassified file at ` +
    `open (§5 G11), so that store would never open again. Choose a --dir that is not ` +
    `${layout.base} or an ancestor of it — ${join(layout.base, DEFAULT_STORE_DIR)} is the default.`
  );
}

/**
 * The roots this machine hands out for THROWAWAY files: `os.tmpdir()`, the three
 * variables that set it, and `/tmp`. Each is listed twice — as spelled and as
 * realpath'd — because macOS spells the same directory `/var/folders/…` and
 * `/private/var/folders/…` depending on who asked, and a prefix test that knows
 * only one of the two silently answers "no".
 */
export function tempRoots(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  const add = (value: string): void => {
    if (!out.includes(value)) out.push(value);
  };
  for (const raw of [tmpdir(), env["TMPDIR"], env["TMP"], env["TEMP"], "/tmp"]) {
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    const abs = resolve(raw.trim());
    add(abs);
    try {
      add(realpathSync(abs));
    } catch {
      // A root that is not there cannot contain anything; nothing to add.
    }
  }
  return out;
}

/** True when `path` is one of the temp roots or lives under one. */
function underTempRoot(path: string, roots: readonly string[]): boolean {
  const abs = resolve(path);
  return roots.some((root) => isWithin(root, abs));
}

/**
 * Why this install may not write THE DEFAULT CONFIGURATION, or null.
 *
 * The one case, and it is a scar rather than a theory: on 2026-09-04 a suite run
 * that had lost `test/preload.ts`'s home mock resolved the real
 * `~/.counterparts/claude-code.json` and rewrote its `dataDir` to a temp path.
 * The file is the one the hook, the worker and the MCP server read with NO flag,
 * so from that moment the owner's live memory was a directory the OS was free to
 * delete — and it recorded nothing for three days before anyone noticed. A
 * throwaway store must never become the live default.
 *
 * So: the default configuration file will not be written with a `dataDir` under
 * a temp root. `--config <somewhere else>` is the way through, and it moves the
 * store with it (`installLayout`), which is the whole point
 * — a scratch install should be scratch all the way down.
 *
 * THE THIRD CLAUSE, and why the clean room still works: the refusal also
 * requires that the CONFIGURATION not be under a temp root. `tools/install-loop/run.sh`
 * installs into a fake `$HOME` beneath `$TMPDIR` with no `--config` at all, so
 * its default config and its store are both throwaway and both under the same
 * base — a stranger's install, correctly measured, not a live default pointed at
 * a temp store. Keying on the store alone would refuse the loop; keying on the
 * pair is what "the REAL default path" means on a machine where the temp dir can
 * hold a whole home. Test-suite installs are in the same position (the mocked
 * home is minted under `os.tmpdir()`), which is why this is provable only with
 * an injected home outside the temp tree.
 *
 * Not bypassable by `--force`: `--force` says "overwrite the file I named", and
 * the file this refuses to write is one nobody named.
 */
export function throwawayDefaultRefusal(
  layout: InstallLayout,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string | null {
  const defaultConfig = defaultConfigPath(home);
  if (resolve(layout.config) !== defaultConfig) return null;
  const roots = tempRoots(env);
  if (!underTempRoot(layout.store, roots)) return null;
  if (underTempRoot(defaultConfig, roots)) return null;
  return (
    `refused: this would write the DEFAULT configuration, ${defaultConfig}, with a data dir ` +
    `under the system temp directory (${layout.store}). That file is the one the hook, the ` +
    "worker and the MCP server read when nothing names another, so a throwaway store would " +
    "become this machine's live memory and the real one would stop being written to. " +
    `Name a scratch install instead: ` +
    `${CONFIG_FLAG} <absolute path outside ${join(home, DEFAULT_DATA_DIR_NAME)}>, which moves the ` +
    "configuration and the store together. A permanent store outside the temp " +
    "dir is the other way through."
  );
}

export interface ConfigInput {
  readonly layout: InstallLayout;
  readonly budgetBytes?: number;
  readonly name?: string;
  /**
   * The embedder block to write, exactly as `resolveEmbedderBlock` decided it
   * — absent when nothing on the command line (or the terminal arm's default)
   * said anything about it, which writes no block and leaves any carried one
   * standing.
   */
  readonly embedder?: EmbedderBlock;
  /**
   * Keys carried forward from a configuration this write is REPLACING, and
   * only ones the command line did not supply (`commands.ts#carryForward`).
   *
   * B1, 2026-09-22: `--force` used to blank whatever the flags did not name —
   * the owner's `identity`, a running `embedder` opt-in, a ceiling somebody
   * chose. `--force` is consent to rewrite a file, not consent to forget what
   * it said.
   */
  readonly carried?: Readonly<Record<string, unknown>>;
}

/**
 * The adapter configuration this install writes. Absolute paths only: the file
 * is read by three processes the owner never launches by hand (the hook, the
 * worker, the MCP server), and `~` is a shell's idea, not a path.
 */
export function configObject(input: ConfigInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    dataDir: input.layout.store,
    owner: true,
    // WHAT THE FILE BEING REPLACED SAID, first, so a flag below still wins —
    // though `carryForward` has already dropped every key this line supplied,
    // so the two can never disagree. `dataDir` is set ABOVE it and is never
    // carried: moving an install is what `--force` is for, and a path from the
    // old file would silently undo the move.
    ...(input.carried ?? {}),
  };
  // Scar §2.18: written only when a number was SUPPLIED. There is no default
  // for a host's ceiling anywhere in this package and this is not the place
  // there starts being one.
  if (input.budgetBytes !== undefined) out["injectionBudgetBytes"] = input.budgetBytes;
  if (input.name !== undefined && input.name.length > 0) out["identity"] = { name: input.name };
  // The embedder knob, only when something decided it. Absent reads as the
  // local table, on (`config.ts#resolveEmbedder`).
  if (input.embedder !== undefined) out["embedder"] = { ...input.embedder };
  return out;
}

/** The `embedder` block `install` writes: `{ enabled, kind? }`, the shape
 *  `adapters/config.ts#loadConfig` reads strictly. */
export interface EmbedderBlock {
  readonly enabled: boolean;
  readonly kind?: EmbedderKind;
}

/**
 * WHICH `embedder` BLOCK AN INSTALL WRITES (roadmap C3; review of #190, MINOR 4;
 * review of #195, MAJOR 1).
 *
 * There is one embedder, the local table (the Voyage seat was removed on
 * 2026-09-24), so:
 *
 *   - **Turning it ON** (`--embedder`, or the terminal arm's default) →
 *     `{ enabled: true, kind: "static" }`, whatever the replaced block said —
 *     which is what doctor's `Turn on:` line promises.
 *   - **Turning it OFF** (`--no-embedder`) → the kind the replaced block
 *     records, when it is one this build knows, else kind-less
 *     `{ enabled: false }`; with no block at all, `{ enabled: false, kind:
 *     "static" }`.
 *
 * `enabled` comes from the caller; `undefined` means nothing decided it, and
 * the result is then `undefined` too — no block is written and the carried one
 * stands. It reads the old file with `JSON.parse`, like
 * `commands.ts#carryForward`: what is wanted is what the file SAID.
 */
export function resolveEmbedderBlock(input: {
  readonly enabled: boolean | undefined;
  /** The configuration being replaced, if any — read, never written. */
  readonly configPath: string;
}): EmbedderBlock | undefined {
  if (input.enabled === undefined) return undefined;
  if (input.enabled) return { enabled: true, kind: "static" };
  const was = embedderBlockIn(input.configPath);
  if (was === null) return { enabled: false, kind: "static" };
  const recorded = was["kind"];
  const oldKind =
    typeof recorded === "string" && (EMBEDDER_KINDS as readonly string[]).includes(recorded)
      ? (recorded as EmbedderKind)
      : undefined;
  return oldKind === undefined ? { enabled: false } : { enabled: false, kind: oldKind };
}

/** The old file's `embedder` object, or null when it has none (or none that
 *  reads as an object). Never throws. */
function embedderBlockIn(configPath: string): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const block = (raw as Record<string, unknown>)["embedder"];
  return block !== null && typeof block === "object" && !Array.isArray(block)
    ? (block as Record<string, unknown>)
    : null;
}

/** The hooks block to paste into `~/.claude/settings.json` — the manual fallback
 *  prints it; `connect` (`wire.ts`) merges the same entries itself. */
export function settingsBlock(hookCommand = runCommand(HOOK_SCRIPT)): string {
  const hooks: Record<string, unknown> = {};
  for (const event of HOST_EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: hookCommand }] }];
  }
  return JSON.stringify({ hooks }, null, 2);
}

/**
 * The MCP registration line — printed by the manual fallback; `connect`
 * (`wire.ts`) runs the same registration itself.
 *
 * A non-default configuration travels as `-e COUNTERPARTS_CONFIG=…`, not as a
 * flag, and that is the whole reason the environment variable exists: this host
 * launches MCP servers from a STATIC registration, and `-e` is the channel that
 * registration has. It sits beside `COUNTERPARTS_DATA_DIR` because the two names
 * answer different questions — which store, and which configuration.
 */
export function mcpCommand(
  store: string,
  serve = runCommand(MCP_SCRIPT),
  configPath?: string,
): string {
  const config =
    configPath === undefined || configPath.length === 0
      ? ""
      : ` -e ${CONFIG_ENV}=${shellQuote(configPath)}`;
  return `claude mcp add ${MCP_SERVER_NAME} -s user -e COUNTERPARTS_DATA_DIR=${shellQuote(store)}${config} -- ${serve}`;
}

/**
 * Why `--budget` cannot be used, or null — `install`'s own rule, exported so
 * there is ONE of it.
 *
 * `start-fresh` hands `install` the ceiling it read out of the configuration,
 * and `loadConfig` accepts any finite positive number while this requires a
 * whole one. A fractional `injectionBudgetBytes` therefore loaded fine
 * everywhere else and refused inside `install` — which, before the order
 * changed, happened AFTER both directories had been parked (N1 review M1). A
 * caller that wants to know in advance asks the same function `install` asks.
 */
export function budgetRefusal(value: string): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return `refused: --budget takes a positive whole number of bytes, not '${value}'.`;
  }
  return null;
}

export type WroteWhat = "created" | "kept" | "replaced";

export interface FileResult {
  readonly path: string;
  readonly what: WroteWhat;
  /** Octal mode after the call. */
  readonly mode?: string;
}

/** Write `text` at `path` unless it is already there and `--force` was not given. */
export function writeOnce(
  path: string,
  text: string,
  opts: { force: boolean; mode?: number },
): FileResult {
  const present = existsSync(path);
  if (present && !opts.force) {
    return { path, what: "kept", ...modeOf(path) };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, opts.mode === undefined ? {} : { mode: opts.mode });
  // `writeFileSync`'s mode is a CREATION mode and the umask applies; an
  // existing file keeps the mode it had. Both cases are fixed here, so "0600"
  // is a fact about the file rather than about the call that made it.
  if (opts.mode !== undefined) chmodSync(path, opts.mode);
  return { path, what: present ? "replaced" : "created", ...modeOf(path) };
}

function modeOf(path: string): { mode?: string } {
  try {
    return { mode: (statSync(path).mode & 0o777).toString(8).padStart(3, "0") };
  } catch {
    return {};
  }
}

// ── did the two printed steps actually take (2026-09-20, finding 4) ─────────

/**
 * READ THE HOST'S OWN FILES and say whether what `install` printed is there.
 *
 * `install` prints the hooks block and the `claude mcp add` line and applies
 * neither — correctly, because they edit somebody else's editor configuration.
 * Nothing then checked them, so a user who pasted the block into a project
 * settings file instead of the user one, or who never restarted, got a fully
 * green `doctor` and total silence. The failure mode of this product is
 * silence, and QUICKSTART §4a says as much about a hook that stands down.
 *
 * It lives HERE and not in `doctor.ts` because it is the other half of what
 * this file prints: the block and the line are `settingsBlock` and
 * `mcpCommand`, and the names they use — `HOST_EVENTS`, `MCP_SERVER_NAME` — are
 * this module's. `doctor.ts` grades the reading and holds none of that
 * vocabulary, exactly as it already takes `checkout` and `open` from its caller.
 *
 * **READ-ONLY, AND EVERY ANSWER NAMES THE FILES IT READ.** None of these paths
 * is ours. `~/.claude.json` in particular is the host's own state file, which
 * its documentation describes as one the host writes for itself — so it may
 * move, and the line must then read "I looked here and did not find it", never
 * "you did not install it". `CLAUDE_CONFIG_DIR` relocates both, checked first:
 * the user settings to `$CLAUDE_CONFIG_DIR/settings.json` (`hostSettingsDir`) and
 * the MCP file to `$CLAUDE_CONFIG_DIR/.claude.json` (`hostConfigBase`).
 *
 * Hooks MERGE across the host's settings files, so all four places a block can
 * land are read and the answer is their union: finding the command in a project
 * file is still finding it, and the line says where it looked.
 *
 * Verified against the host's documentation on 2026-09-20. True for now.
 */
export interface HostRead {
  readonly expected: readonly string[];
  readonly events: readonly string[];
  /**
   * Events whose hook command NAMES A PATH THAT IS NOT THERE (2026-09-20).
   *
   * A settings block left over from a checkout that has since been deleted or
   * renamed matches the command mark perfectly and fails at every session
   * start. Reading it as installed is the one outcome this whole finding was
   * added to prevent: GREEN while nothing fires. These are a subset of
   * `events` — the block IS installed — and they are graded as a fault.
   */
  readonly stale: readonly { event: string; path: string }[];
  readonly settingsRead: readonly string[];
  /** Files that exist and could not be opened or parsed — a different fact from
   *  "there is no such file", and the one the MCP file already got a flag for. */
  readonly settingsUnreadable: readonly string[];
  readonly mcp: boolean;
  readonly mcpName: string;
  readonly mcpFile: string;
  readonly mcpUnreadable: boolean;
  /** The runtimes our hook commands and our MCP registration name, one row
   *  per distinct executable (`adapters/runtime.ts`), and whether each is there. */
  readonly runtimes: readonly HostRuntime[];
  /** The Counterparts Claude Code plugin, when Claude Code records it
   *  installed (`host-wiring.ts#pluginInstall`), else null. */
  readonly plugin: PluginInstallRead | null;
}

/** Which of our host entries a runtime row came from: Claude Code's hooks, its
 *  MCP registration, or Claude Desktop's `counterparts` server entry. */
export type HostUse = "hooks" | "mcp" | "desktop";

/**
 * Where Claude Desktop keeps its MCP servers, under a home directory (macOS).
 * Here rather than in `desktop.ts` (which re-exports it) because `readHost`
 * reads Desktop's entry too, and `desktop.ts` imports this file.
 */
export function desktopConfigPath(home: string): string {
  return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

/**
 * Is a `counterparts` entry in Desktop's file one this package wrote? Its
 * command must read back as ours (`runtime.ts#parseScriptInvocation`) and run
 * the memory server — a hand-made entry under the same name is somebody's
 * own, and `connect` leaves it alone (`desktop.ts#repairDesktop`), so doctor's
 * Runtime line does not grade it either (`readHost`): an amber whose fix,
 * `connect`, never touches the entry would never clear.
 *
 * NOTHING AFTER THE SCRIPT (review of #354). `desktop.ts#desktopEntry` never
 * writes a tail — the configuration travels in `env` — so an entry with
 * arguments after `serve.ts` (or after the binary's `mcp`) is somebody's edit
 * of ours, and the rewrite, which replaces `args` whole, would drop them
 * without a word. The line `host-wiring.ts#isOurHookCommand` holds for hooks.
 */
export function isOurDesktopEntry(entry: unknown): entry is { command: string; args: string[] } & Record<string, unknown> {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  const command = (entry as Record<string, unknown>)["command"];
  const args = (entry as Record<string, unknown>)["args"];
  if (typeof command !== "string" || !Array.isArray(args) || !args.every((a) => typeof a === "string")) return false;
  const run = parseScriptInvocation([command, ...(args as string[])]);
  if (run === null || run.rest.length > 0) return false;
  return run.mode === "mcp" || (run.mode === undefined && /mcp[/\\]bin[/\\]serve\.ts$/.test(run.script));
}

/** One runtime a host's configuration launches us with. */
export interface HostRuntime {
  readonly exe: string;
  /** `binary`: the single compiled binary, its own runtime. */
  readonly kind: RuntimeKind | "binary";
  readonly present: boolean;
  /** `hooks`, `mcp`, or both. */
  readonly used: readonly HostUse[];
  /** Of `used`, the ones whose command lets Bun read the project's `.env` or
   *  `bunfig.toml` — wired before `--no-env-file` and an empty `--config=`
   *  (`runtime.ts#BUN_NO_ENV_FILE`, `#EMPTY_BUNFIG`). */
  readonly projectEnv: readonly HostUse[];
}

/**
 * What a hook command of ours looks like, wherever it was installed from — a
 * global install, a clone, or a worktree.
 *
 * ANCHORED AT A TOKEN BOUNDARY, not a bare substring (2026-09-20): the first
 * version matched any command merely *mentioning* the name, so `echo
 * counterparts-hook` read as an installed hook. It still cannot resolve an
 * arbitrary shell command — that is out of scope, and deliberately so — but it
 * no longer matches prose. The third shape is the single binary's own
 * (`"<…>/counterparts" hook`, `runtime.ts#parseScriptInvocation`). It matches
 * the entry's `.mjs` shim as well as `hook.ts` (2026-10-09, with
 * `host-wiring.ts#readOurHook`): a line that runs our hook is ours to report,
 * whatever flags or entry file a later version writes.
 */
export const HOOK_COMMAND_MARK =
  /(^|[\s"'=/\\])counterparts-hook(\s|$|")|claude-code[/\\]bin[/\\]hook\.(ts|mjs)|[/\\]counterparts(\.exe)?"?\s+hook(\s|$)/;

/**
 * The absolute path a hook command runs, when it names one — the first token
 * that looks like a path, or the argument after a runtime like `bun`.
 *
 * Deliberately narrow: it answers "does this file exist" for the shapes
 * `install` prints and the shapes a clone produces, and returns null for
 * anything else rather than guessing. A null is never reported as stale.
 */
export function hookTargetPath(command: string): string | null {
  // The single binary is its own script: `"<binary>" hook` needs the binary.
  const run = parseScriptInvocation(shellTokens(command));
  if (run?.runtime === "binary") return run.exe;
  const tokens = command.trim().split(/\s+/);
  for (const raw of tokens) {
    const token = raw.replace(/^["']|["']$/g, "");
    if (!token.startsWith("/")) continue;
    // Node's loader (`--import …/node-hooks.mjs`) is not the hook either.
    if (/node-hooks\.mjs$/.test(token)) continue;
    // The runtime itself (…/bin/bun) is not the hook; keep looking for the
    // script it was handed.
    if (/\.(ts|js|mjs|cjs)$/.test(token)) return token;
    if (/counterparts-hook$/.test(token)) return token;
  }
  return null;
}

/**
 * The host's settings files that can carry a user's hooks, in merge order.
 * `userDir` is the host's own directory (`hostSettingsDir`) — `~/.claude`, or
 * `CLAUDE_CONFIG_DIR` itself when that is set — and NOT the base the MCP file
 * hangs off: the project files are `<cwd>/.claude/…` either way.
 */
export function hostSettingsFiles(userDir: string, cwd: string): string[] {
  return [
    join(userDir, "settings.json"),
    join(userDir, "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];
}

/**
 * THE HOST'S OWN DIRECTORY, where its user settings live (2026-10-09):
 * `CLAUDE_CONFIG_DIR` when set, else `~/.claude`.
 *
 * Until today the user settings file was `hostConfigBase` + `.claude/settings.json`,
 * which is right with no variable and wrong with one: the host's documentation
 * says `CLAUDE_CONFIG_DIR` overrides the configuration directory whose default
 * is `~/.claude`, and that every `~/.claude` path lives under it instead — so
 * the file is `$CLAUDE_CONFIG_DIR/settings.json`, and we were reading (and
 * `connect` was writing) `$CLAUDE_CONFIG_DIR/.claude/settings.json`, a file the
 * host never opens. Two agents found it independently. `~/.claude.json` is
 * not a `~/.claude` path, so the MCP file keeps `hostConfigBase`.
 */
export function hostSettingsDir(home: string, env: Record<string, string | undefined>): string {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0 ? moved : join(home, ".claude");
}

/**
 * Where a `-s user` MCP registration lands. `CLAUDE_CONFIG_DIR` moves it.
 *
 * **A SYMLINK OUT OF THE BASE IS FOLLOWED, and the name printed is the link.**
 * It is the user's own symlink on the user's own machine and the read is
 * read-only, so the blast radius is nil — but this module promises that every
 * answer names the file it read, and after a symlink that promise is only
 * half-kept. Stated here rather than refused: refusing would break a real setup
 * (a dotfiles repository) to fix a wording problem, and resolving the target to
 * print it would make the line harder to read for everyone else.
 */
export function hostMcpFile(base: string): string {
  return join(base, ".claude.json");
}

/** The base the MCP file (`.claude.json`) lives under: `CLAUDE_CONFIG_DIR` when
 *  set, else the home dir. The user settings file is `hostSettingsDir`'s. */
export function hostConfigBase(home: string, env: Record<string, string | undefined>): string {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0 ? moved : home;
}

/**
 * Three outcomes, not two (2026-09-20): `absent`, `unreadable` and `read`.
 *
 * The first version collapsed "does not exist", "cannot be opened" and "is not
 * JSON" into one falsy answer, so a mode-000 `settings.json` — or a DIRECTORY
 * with that name — dropped out of the report with no trace at all. The MCP file
 * already had a flag for exactly this; the settings files did not.
 */
function readJsonFile(path: string): {
  state: "absent" | "unreadable" | "read";
  value: Record<string, unknown>;
} {
  if (!existsSync(path)) return { state: "absent", value: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? { state: "read", value: parsed as Record<string, unknown> }
      : { state: "unreadable", value: {} };
  } catch {
    return { state: "unreadable", value: {} };
  }
}

export function readHost(
  home: string,
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): HostRead {
  const base = hostConfigBase(home, env);
  const events = new Set<string>();
  const live = new Set<string>();
  const stale = new Map<string, string>();
  const settingsRead: string[] = [];
  const settingsUnreadable: string[] = [];
  // WHICH RUNTIME the host launches us with — read off the same commands, never
  // spawned: `bun run <script>` or `node --import <node-hooks.mjs> <script>`.
  const runtimes = new Map<string, { kind: RuntimeKind | "binary"; used: Set<HostUse>; projectEnv: Set<HostUse> }>();
  const noteRuntime = (tokens: readonly string[], used: HostUse): void => {
    const run = parseScriptInvocation(tokens);
    if (run === null) return;
    const row = runtimes.get(run.exe) ?? { kind: run.runtime, used: new Set<HostUse>(), projectEnv: new Set<HostUse>() };
    row.used.add(used);
    if (run.projectEnv === "read") row.projectEnv.add(used);
    runtimes.set(run.exe, row);
  };
  // A HOOK LINE IS READ BY ITS SCRIPT when the strict parser does not know its
  // flags (`host-wiring.ts#readOurHook`): a line a later `connect` wrote keeps
  // its Runtime row instead of vanishing from it. The shim names no runtime.
  const noteHookRuntime = (command: string): void => {
    const tokens = shellTokens(command);
    if (parseScriptInvocation(tokens) !== null) return noteRuntime(tokens, "hooks");
    const ours = readOurHook(command);
    if (ours === null || ours.shape === "shim") return;
    const row = runtimes.get(ours.exe) ?? {
      kind: ours.shape === "binary" ? "binary" : runtimeOf(ours.exe),
      used: new Set<HostUse>(),
      projectEnv: new Set<HostUse>(),
    };
    row.used.add("hooks");
    if (ours.projectEnv === "read") row.projectEnv.add("hooks");
    runtimes.set(ours.exe, row);
  };
  for (const path of hostSettingsFiles(hostSettingsDir(home, env), cwd)) {
    const read = readJsonFile(path);
    if (read.state === "unreadable") settingsUnreadable.push(path);
    if (read.state !== "read") continue;
    settingsRead.push(path);
    const hooks = read.value["hooks"];
    if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) continue;
    for (const [event, entries] of Object.entries(hooks as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries as unknown[]) {
        if (entry === null || typeof entry !== "object") continue;
        const inner = (entry as Record<string, unknown>)["hooks"];
        if (!Array.isArray(inner)) continue;
        for (const h of inner as unknown[]) {
          if (h === null || typeof h !== "object") continue;
          const command = (h as Record<string, unknown>)["command"];
          if (typeof command !== "string" || !HOOK_COMMAND_MARK.test(command)) continue;
          events.add(event);
          noteHookRuntime(command);
          // A BLOCK THAT NAMES A PATH THAT IS NOT THERE fails at every session
          // start, silently. One event can carry several entries, so a live one
          // anywhere wins and a stale one is only reported when nothing on that
          // event resolves.
          const target = hookTargetPath(command);
          if (target === null || existsSync(target)) live.add(event);
          else stale.set(event, target);
        }
      }
    }
  }
  const mcpFile = hostMcpFile(base);
  const mcpRead = readJsonFile(mcpFile);
  const servers = mcpRead.value["mcpServers"];
  const mcp =
    servers !== null &&
    typeof servers === "object" &&
    !Array.isArray(servers) &&
    MCP_SERVER_NAME in (servers as Record<string, unknown>);
  if (mcp) {
    const entry = (servers as Record<string, unknown>)[MCP_SERVER_NAME];
    if (entry !== null && typeof entry === "object") {
      const command = (entry as Record<string, unknown>)["command"];
      const args = (entry as Record<string, unknown>)["args"];
      if (typeof command === "string" && Array.isArray(args) && args.every((a) => typeof a === "string")) {
        noteRuntime([command, ...(args as string[])], "mcp");
      }
    }
  }
  // CLAUDE DESKTOP'S ENTRY (`install --host claude-desktop`, 2026-10-10): the
  // third command we write into a host's configuration, read the same way, so
  // the Runtime line says when Desktop's server still lets Bun read a
  // project's `.env` (`connect` rewrites it too, while Desktop is closed).
  // Only an entry `connect` would rewrite (`isOurDesktopEntry`, review of #354).
  const desktopServers = readJsonFile(desktopConfigPath(home)).value["mcpServers"];
  if (desktopServers !== null && typeof desktopServers === "object" && !Array.isArray(desktopServers)) {
    const entry = (desktopServers as Record<string, unknown>)[MCP_SERVER_NAME];
    if (isOurDesktopEntry(entry)) noteRuntime([entry.command, ...entry.args], "desktop");
  }
  return {
    expected: [...HOST_EVENTS],
    events: [...events].sort(),
    stale: [...stale.entries()]
      .filter(([event]) => !live.has(event))
      .map(([event, path]) => ({ event, path }))
      .sort((a, b) => (a.event < b.event ? -1 : 1)),
    settingsRead,
    settingsUnreadable,
    mcp,
    mcpName: MCP_SERVER_NAME,
    mcpFile,
    mcpUnreadable: mcpRead.state === "unreadable",
    runtimes: [...runtimes.entries()].map(([exe, row]) => ({
      exe,
      kind: row.kind,
      present: runtimePresent(exe, env),
      used: [...row.used].sort(),
      projectEnv: [...row.projectEnv].sort(),
    })),
    plugin: pluginInstall({ home, env, cwd }),
  };
}

// ── the undo of `uninstall --park` (2026-09-22, item 11) ────────────────────

/**
 * `install` IS THE WAY BACK FROM `uninstall --park`.
 *
 * Trial finding #22, in the owner's words: after `--park` "the undo is a pasted
 * shell one-liner with an `if [ -e … ] … REFUSING … mv … fi` guard. Doesn't make
 * sense." So the undo became a command, and the command is the one a person
 * runs anyway when they come back: `install` looks beside the configuration
 * directory, finds what the park left, and asks.
 *
 * ── THE RULE THIS SECTION EXISTS TO KEEP ────────────────────────────────────
 *
 * **The parked directory is never opened.** Not `Store.open`, not `openDb`, not
 * read-only, and not its `claude-code.json` either. `start-fresh.ts`'s header
 * says why for the store itself — a WAL store's `-wal` holds committed pages
 * until somebody checkpoints it, and an opener is somebody — and the park arm
 * repeats it on screen ("the store was never opened — not even read-only, which
 * is why this arm does not print a count"). A command that brought the folder
 * back by first reading what is in it would make that sentence false one release
 * later.
 *
 * So everything below is `readdir`, `lstat` and ONE `rename`. The date comes out
 * of the NAME, the size out of a walk of the tree, the floor out of
 * `preRowsMarkersIn`, which reads filenames. There is no memory count, and the
 * screen says so rather than leaving a reader to wonder.
 *
 * ── AND THE REFUSALS, WHICH ARE THE REASON IT GETS A REVIEW ─────────────────
 *
 * This moves a stranger's data. Every candidate is refused BY NAME, with the
 * reason, and left exactly where it is, unless it is a plain directory, under
 * this home, holding a store this build can open. The sharpest of them is the
 * symlink clause: `~/.counterparts.parked-2026-09-22 -> ~/.bansai` renamed into
 * place would make `~/.counterparts` a link into v1's live memory, and the very
 * next `Store.open` would open it. That is the one CLAUDE.md forbids twice.
 */

/**
 * `<base>.parked-<date>` with an optional `-N` — the name `uninstall --park`
 * writes, by way of `start-fresh#pairedSuffix`. Nothing else is a candidate.
 *
 * THE DATE IS A DATE, not four-two-two digits (review n1). The pattern alone
 * accepted `.counterparts.parked-2099-13-45`, which then sorted ABOVE a real
 * folder and put "Found memory set aside on 2099-13-45" on the screen —
 * anything that wants to be picked first need only name a month that does not
 * exist. It is round-tripped through `Date` instead, so only a day that is
 * really on the calendar is a candidate at all.
 *
 * AND THE ORDINAL IS AT LEAST 2 (review n2). `pairedSuffix` starts counting at
 * two — a `-0` or a `-1` is not a name this package writes, and `-0` sorted
 * BELOW the bare same-day folder it was pretending to follow.
 */
export function parkedNameParts(
  name: string,
  base: string,
): { date: string; ordinal: number } | null {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${escaped}\\.parked-(\\d{4}-\\d{2}-\\d{2})(?:-(\\d+))?$`).exec(name);
  if (m === null) return null;
  const date = m[1] ?? "";
  // A real day, and not 2099-13-45 (`time.ts#isDay`).
  if (!isDay(date)) return null;
  if (m[2] === undefined) return { date, ordinal: 1 };
  const ordinal = Number(m[2]);
  if (!Number.isInteger(ordinal) || ordinal < 2) return null;
  return { date, ordinal };
}

/** Every byte under a path, by walking it. `lstat`, so a symlink is counted as
 *  the link it is and never followed out of the tree. No file is opened. */
export function dirBytes(path: string): number {
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
  for (const name of entries) total += dirBytes(join(path, name));
  return total;
}

export interface ParkedSighting {
  readonly path: string;
  /** The date out of the NAME. Never out of anything inside the folder. */
  readonly date: string;
  /** The `-2`, `-3` … a second park the same day wears; 1 when there is none. */
  readonly ordinal: number;
  /** Every byte under it, from the walk above. */
  readonly bytes: number;
  /** Why this one may not be brought back, or null. It is still LISTED when it
   *  is refused: a folder nobody mentions is a folder somebody thinks is gone. */
  readonly refusal: string | null;
}

/**
 * Why this parked directory may not be renamed into place, or null.
 *
 * Every clause is a way for one `rename` to do something nobody asked for, and
 * each of them is checked on the FILESYSTEM rather than on the name — with
 * `lstat`, never `existsSync`, wherever a link could be the answer.
 *
 * ORDER MATTERS HERE. Every clause that could make a READ go somewhere it
 * should not runs before the read does: the folder's own symlink test and the
 * home-containment test before anything looks inside, and the `store/` symlink
 * test before `preRowsMarkersIn` reads a single filename.
 */
export function parkedRefusal(path: string, home: string): string | null {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return `refused: ${path} is not there any more.`;
  }
  // THE SYMLINK CLAUSE. Renaming a link moves the link: `~/.counterparts` would
  // become a pointer into whatever it names — `~/.bansai`, say — and the next
  // `Store.open` would open that. `uninstall.ts` refuses a symlink on the way
  // out for the mirror-image reason; this is the way back in.
  if (stat.isSymbolicLink()) {
    return (
      `refused: ${path} is a SYMBOLIC LINK, not the directory a park leaves. Renaming a link ` +
      "moves the link and leaves whatever it points at exactly where it is — and what came " +
      "back would be a name pointing somewhere nobody here chose. Nothing was moved."
    );
  }
  if (!stat.isDirectory()) {
    return `refused: ${path} is not a directory, so it is not a parked memory. Nothing was moved.`;
  }
  // BELT, ON THE PATH IT ACTUALLY REACHES. The name matched a pattern; the
  // thing it reaches is what gets renamed.
  let real = resolve(path);
  try {
    real = realpathSync(real);
  } catch {
    /* a path that cannot be resolved is judged as written */
  }
  let realHome = resolve(home);
  try {
    realHome = realpathSync(realHome);
  } catch {
    /* likewise */
  }
  // A CANDIDATE OUTSIDE THIS HOME. Closed in practice rather than in theory:
  // `uninstall --park` refuses a base outside the home too
  // (`uninstall.ts#configDirRefusal`), so no folder this package wrote can be
  // here — what can is a symlink pointing out, or an `--config` somewhere
  // exotic, and neither is a thing to rename on a pattern match (review n5).
  if (!isWithin(realHome, real)) {
    return (
      `refused: ${path} resolves to ${real}, outside your home directory (${realHome}). This ` +
      "command brings back what an install of yours set aside; a path anywhere else is one " +
      "somebody else is responsible for. Nothing was moved."
    );
  }
  // AND THE SAME SYMLINK CLAUSE ONE DIRECTORY DOWN, BEFORE ANYTHING READS IT.
  //
  // A REAL parked directory holding `store -> ~/.bansai/store` clears every
  // check above: the folder is not a link, and it is under this home. Then
  // `preRowsMarkersIn` would `readdir` through the link — a read of v1's live
  // memory, which CLAUDE.md forbids as flatly as a write — and, finding no
  // pre-rows names, would let the rename put `~/.counterparts/store` on top of
  // it. `assertSafeDataDir` is pure string math and follows no links (the F2
  // review's lesson, stated in `start-fresh.ts`), so nothing downstream would
  // catch it either. `uninstall.ts#storeRefusal` makes this same check on the
  // way out; this is the way back in.
  //
  // `lstatSync` and not `existsSync`: the latter FOLLOWS the link, which is the
  // one thing that must not happen here.
  const storePath = join(path, DEFAULT_STORE_DIR);
  let storeStat;
  try {
    storeStat = lstatSync(storePath);
  } catch {
    storeStat = undefined;
  }
  if (storeStat === undefined) {
    return (
      `refused: ${path} holds no '${DEFAULT_STORE_DIR}' directory, so the memory is not in it — ` +
      "a store that lived somewhere else was parked under its own name beside itself. Bringing " +
      "this folder back alone would point the hooks at a store that is not there. Move both by " +
      "hand if that is what you meant; nothing was moved."
    );
  }
  if (storeStat.isSymbolicLink()) {
    return (
      `refused: ${storePath} is a SYMBOLIC LINK. What would come back is a name pointing at ` +
      "somebody else's directory — the next thing to open the store would open whatever it " +
      "names, and nothing downstream follows a link to find out. Act on the real directory by " +
      "hand; nothing was moved, and nothing in it was read."
    );
  }
  if (!storeStat.isDirectory()) {
    return (
      `refused: ${storePath} is not a directory, so this is not a parked store. Nothing was moved.`
    );
  }

  // THE FLOOR, FROM THE FILENAMES ONLY (`preRowsMarkersIn`). A store from
  // before the rows floor is one this build refuses to open by name, so
  // bringing it back would put a directory at `dataDir` that every hook, the
  // worker and the MCP server refuse from the next session start — silently,
  // because a hook that cannot open a store stands down and exits 0.
  const markers = preRowsMarkersIn(storePath);
  if (markers.length > 0) {
    return (
      `refused: ${path} holds a store from before the rows floor (${markers.join(", ")}), which ` +
      "this build will not open. Bringing it back would leave every hook standing down with " +
      `nothing on screen to say why. ${PRE_ROWS_READABLE_BY} is the last build that reads one. ` +
      "It is left exactly where it is; nothing was moved."
    );
  }
  return null;
}

/**
 * What `uninstall --park` left beside this configuration directory, newest
 * first.
 *
 * NEWEST FIRST MEANS THE DATE AND THEN THE ORDINAL: two parks on one day are
 * `…parked-2026-09-22` and `…parked-2026-09-22-2`, and the `-2` is the later of
 * the two, so it sorts above the bare one.
 *
 * **THE REFUSAL IS DECIDED BEFORE THE SIZE IS MEASURED** (review m5). Object
 * literals evaluate in order, so `bytes` first meant every directory under a
 * candidate had already been `readdir`'d and every entry `lstat`'d by the time
 * it was refused — and then the number was thrown away, because a refusal
 * prints only the path and the reason. Nothing was opened and no link was
 * followed, so the safety claim survived; but the refusal says "nothing in it
 * was read", and a walk of the tree is a read of it. Cheaper, and now true.
 */
export function parkedSiblings(configDir: string, home: string): ParkedSighting[] {
  const dir = resolve(configDir);
  const parent = dirname(dir);
  const base = basename(dir);
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return [];
  }
  const out: ParkedSighting[] = [];
  for (const name of names) {
    const parts = parkedNameParts(name, base);
    if (parts === null) continue;
    const path = join(parent, name);
    const refusal = parkedRefusal(path, home);
    out.push({
      path,
      date: parts.date,
      ordinal: parts.ordinal,
      bytes: refusal === null ? dirBytes(path) : 0,
      refusal,
    });
  }
  out.sort((a, b) =>
    a.date === b.date ? b.ordinal - a.ordinal : a.date < b.date ? 1 : -1,
  );
  return out;
}

export type BringBack = { ok: true } | { ok: false; reason: string };

/**
 * ONE `rename`, and the guard re-made against the ground rather than against
 * the plan.
 *
 * `start-fresh#guardedMove` is the same discipline as a shell line, and the
 * reason it exists is measured: on macOS `mv src dst` where `dst` is an existing
 * DIRECTORY moves `src` INSIDE it, exit 0 (review M3). `rename(2)` on a
 * non-empty destination fails instead — but it is not the only outcome worth
 * refusing, and the check is made HERE, immediately before the call, because the
 * person has been at a prompt in between (scar §2.13: a plan made before
 * somebody went to make coffee is a plan about a filesystem that may have
 * changed).
 *
 * `lstatSync` rather than `existsSync`: a DANGLING symlink at the destination is
 * something at that path, and `existsSync` answers false for it.
 */
export function bringParkedBack(parked: string, destination: string, home: string): BringBack {
  const why = parkedRefusal(parked, home);
  if (why !== null) return { ok: false, reason: why };
  let there = true;
  try {
    lstatSync(destination);
  } catch {
    there = false;
  }
  if (there) {
    return {
      ok: false,
      reason:
        `refused: ${destination} exists again, so there is nowhere to put ${parked} back. ` +
        "A rename onto a directory that is there is how one folder ends up inside another. " +
        "Nothing was moved.",
    };
  }
  try {
    renameSync(parked, destination);
  } catch (err) {
    return {
      ok: false,
      reason: `refused: ${parked} could not be moved back: ${String((err as Error).message ?? err)}. Nothing was moved.`,
    };
  }
  return { ok: true };
}
