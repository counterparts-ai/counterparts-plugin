/**
 * WHAT THE NPM INSTALL WROTE INTO CLAUDE CODE'S OWN FILES — recognised, and
 * only ever READ.
 *
 * Two installs of Counterparts can now reach one Claude Code: the npm one,
 * which `counterparts connect` wires by editing `settings.json` (five hook
 * entries) and running `claude mcp add` (one server), and the Claude Code
 * plugin, whose hooks and server Claude Code loads from the plugin's own files
 * (`.claude-plugin/plugin.json`, `hooks/hooks.json`). Hooks from settings and
 * hooks from plugins MERGE — they all fire, in parallel — and an MCP server
 * from a plugin is a duplicate of a configured one only when it runs the same
 * command, which ours never does (the paths differ). So a person who has both
 * gets every turn captured twice and two sets of memory tools. `plugin.ts`
 * decides who stands down; this file only answers "is the npm wiring there,
 * and would it run?".
 *
 * Why it lives here and not in `cli/wire.ts`, which wrote the entries: the
 * hook and the MCP server both need the answer, and adapters are leaves that
 * never import each other (`mcp/INTERFACE-GAPS.md` §7). `isOurHookCommand`
 * moved here from `wire.ts` on 2026-10-09 for that reason and `wire.ts`
 * re-exports it unchanged. It is the WRITER's question and stays strict; the
 * stand-down reads with `readOurHook`, which recognises the hook by its
 * script whatever flags surround it, because the plugin reading the settings
 * may be older or newer than the `connect` that wrote them.
 *
 * WHERE CLAUDE CODE KEEPS THEM, measured against 2.1.295 on 2026-10-09 (a
 * throwaway HOME, `--debug-file` naming every settings path it read):
 * `$CLAUDE_CONFIG_DIR/settings.json` and `$CLAUDE_CONFIG_DIR/.claude.json` when
 * that variable is set, else `~/.claude/settings.json` and `~/.claude.json`.
 * (`cli/wire.ts#userSettingsPath` puts the settings file at
 * `$CLAUDE_CONFIG_DIR/.claude/settings.json`, which is not where Claude Code
 * reads it; recorded in the plugin PR rather than changed here.)
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { CONFIG_FLAG } from "./config-path.js";
import { BUN_CONFIG_PREFIX, BUN_NO_ENV_FILE, isBinaryName, parseScriptInvocation, runtimeOf, runtimePresent, shellTokens } from "./runtime.js";

/** The name `counterparts connect` registers the server under
 *  (`cli/install.ts#MCP_SERVER_NAME`), spelled again because this module may
 *  not import the console. `test/plugin.test.ts` holds the two equal. */
export const NPM_MCP_NAME = "counterparts";

/** Anything that makes a command line more than one program run. */
const SHELL_OPERATOR = /&&|\|\||;|\||>|<|`|\$\(/;

/**
 * IS THIS COMMAND OURS TO REWRITE — which is a stricter question than "does it
 * mention us" (review m1).
 *
 * `HOOK_COMMAND_MARK` answers the reporting question `doctor` asks: is a hook
 * of ours installed on this event? It matches a COMPOSITE command, and it
 * should — a wrapper that ends in `counterparts-hook` really does run our hook,
 * and a doctor that said otherwise would be wrong.
 *
 * It is the wrong question for a WRITE. The review wrapped our hook two ways —
 * `~/bin/log-start.sh && counterparts-hook`, and `/opt/mytool/bin/wrap --then
 * counterparts-hook` — and `wire` overwrote the first with ours alone while
 * `unwire` deleted the second outright. Both are somebody's own line, and
 * `wire.ts`'s own promise is that nothing belonging to another tool is a
 * candidate.
 *
 * So a command is ours to rewrite only when it IS our invocation and nothing
 * else: our runtime and our hook script, or the installed shim, optionally
 * followed by `--config <path>`. Anything with a shell operator in it is
 * refused outright, whatever else it looks like — a command this cannot parse
 * is a command this does not edit.
 *
 * `test/wire.test.ts` holds the two to each other in the direction that
 * matters: everything `wire` WRITES is matched by both, so a hook we installed
 * can never read as missing on the surface a person checks.
 */
export function isOurHookCommand(command: string): boolean {
  // A shell operator means the line does something besides run our hook.
  if (SHELL_OPERATOR.test(command)) return false;
  const tokens = shellTokens(command);
  if (tokens.length === 0) return false;
  const tail = (from: number): boolean => {
    const rest = tokens.slice(from);
    if (rest.length === 0) return true;
    return rest.length === 2 && rest[0] === CONFIG_FLAG && (rest[1] ?? "").length > 0;
  };
  const first = tokens[0] ?? "";
  // The installed shim, by itself.
  if (/(^|[/\\])counterparts-hook$/.test(first)) return tail(1);
  // `<runtime> run <our hook script>`, Node's
  // `<runtime> --import <node-hooks.mjs> <our hook script>`, or the single
  // binary's `<binary> hook` (`runtime.ts`).
  const run = parseScriptInvocation(tokens);
  if (run !== null && (run.mode === "hook" || (run.mode === undefined && /claude-code[/\\]bin[/\\]hook\.ts$/.test(run.script)))) {
    return tail(tokens.length - run.rest.length);
  }
  return false;
}

/** Our hook's entry by its path, as a runtime's script: the TypeScript entry
 *  or its `.mjs` shim. (The installed `counterparts-hook` shim runs itself,
 *  so it is read only as the command's first token.) Anchored at
 *  `adapters/`, where the entry has lived since it was written (review of
 *  #355): a bare `claude-code/bin/hook.ts` is a path any tool with a Claude
 *  Code adapter may have, and this reading accepts any runtime before it —
 *  `tsx`, `deno run`, `node` — so a match here stands the plugin down. */
const HOOK_ENTRY = /(^|[/\\])adapters[/\\]claude-code[/\\]bin[/\\]hook\.(ts|mjs)$/;

/** Our hook command, read for WHAT IT RUNS (`readOurHook`). */
export interface OurHookRead {
  /** `shim`: `counterparts-hook` by itself. `binary`: `<binary> hook`.
   *  `script`: a runtime given our hook entry. */
  readonly shape: "shim" | "binary" | "script";
  readonly exe: string;
  /** The file that must be on disk for it to run: the shim, the binary, or
   *  the hook entry the runtime is given. */
  readonly script: string;
  /** Whether the runtime reads the project's `.env` or `bunfig.toml`
   *  (`runtime.ts#ScriptInvocation.projectEnv`, by the same rule). */
  readonly projectEnv: "read" | "ignored";
}

/**
 * IS THIS COMMAND OUR HOOK — read by its SCRIPT, so a reader from one version
 * recognises what another version wrote (2026-10-09).
 *
 * The question the plugin's stand-down and `doctor` ask is not
 * `isOurHookCommand`'s ("may `connect` rewrite this line?") but "does this
 * line run our hook?". They were answered by the same strict parser, and it
 * returns null for any Bun flag it does not know: 0.3.14's `connect` wrote
 * `"<bun>" --no-env-file "--config=<…>" run "<…/hook.ts>"`, a plugin built
 * before those two flags existed did not read that as the npm wiring, did not
 * stand down, and every session got two wakes and two recall blocks per
 * prompt. The next flag would have done it again to every plugin out there.
 *
 * So this reads the shape, not the vocabulary: `<exe>`, any number of flags
 * (a token starting with `-`; Node's `--import` takes the next token as its
 * value), at most one `run`, more flags, and then the FIRST other token is the
 * script — ours when its path ends in our hook entry (`claude-code/bin/hook.ts`
 * or its `.mjs` shim). Whatever follows the script is the script's own
 * arguments. Also `counterparts-hook` itself, and the single binary's
 * `<binary> [flags] hook`. Any shell operator
 * refuses the line, exactly as for a rewrite: a wrapper runs something else
 * too, and is somebody's own line (review m1).
 *
 * WRITERS, THEREFORE: a future flag must be ONE token (`--name` or
 * `--name=value`). A flag whose value is a separate token would be read as
 * the script by every older reader.
 */
export function readOurHook(command: string): OurHookRead | null {
  if (SHELL_OPERATOR.test(command)) return null;
  const tokens = shellTokens(command);
  const exe = tokens[0] ?? "";
  if (exe.length === 0) return null;
  if (/(^|[/\\])counterparts-hook$/.test(exe)) return { shape: "shim", exe, script: exe, projectEnv: "ignored" };
  let at = 1;
  const isFlag = (t: string | undefined): boolean => t !== undefined && t.length > 1 && t.startsWith("-");
  if (isBinaryName(exe)) {
    while (isFlag(tokens[at])) at += 1;
    return tokens[at] === "hook" ? { shape: "binary", exe, script: exe, projectEnv: "ignored" } : null;
  }
  let ran = false;
  let noEnvFile = false;
  let ownConfig = false;
  for (; at < tokens.length; at += 1) {
    const t = tokens[at] ?? "";
    if (isFlag(t)) {
      if (t === BUN_NO_ENV_FILE) noEnvFile = true;
      if (t.startsWith(BUN_CONFIG_PREFIX) && t.length > BUN_CONFIG_PREFIX.length) ownConfig = true;
      // Node's loader, `--import <node-hooks.mjs>`: the one flag we write
      // whose value is its own token.
      if (t === "--import") at += 1;
      continue;
    }
    if (t === "run" && !ran) {
      ran = true;
      continue;
    }
    if (!HOOK_ENTRY.test(t)) return null;
    const projectEnv = runtimeOf(exe) === "node" || (noEnvFile && ownConfig) ? "ignored" : "read";
    return { shape: "script", exe, script: t, projectEnv };
  }
  return null;
}

/** Claude Code's two user-level files, wherever `CLAUDE_CONFIG_DIR` puts them. */
export function claudeUserFiles(
  home: string,
  env: Record<string, string | undefined>,
): { readonly settings: string; readonly globalConfig: string } {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0
    ? { settings: join(moved, "settings.json"), globalConfig: join(moved, ".claude.json") }
    : { settings: join(home, ".claude", "settings.json"), globalConfig: join(home, ".claude.json") };
}

/** A hook entry of ours in a settings file, and whether it would run. */
export interface WiredHook {
  readonly file: string;
  readonly event: string;
  readonly command: string;
  /** Its runtime and its script are both still there. A dead entry (an npm
   *  install removed, a checkout deleted) runs nothing, so nobody stands down
   *  for it — it is reported instead. */
  readonly live: boolean;
}

/** Our MCP registration in one of the two scopes `claude mcp add` writes. */
export interface WiredMcp {
  readonly file: string;
  readonly scope: "user" | "local";
  readonly command: string;
  readonly live: boolean;
}

export interface NpmWiring {
  readonly hooks: readonly WiredHook[];
  readonly mcp: readonly WiredMcp[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON object from disk, or null for absent, unreadable or not-an-object.
 *  Read-only, and quiet: a file this cannot read says nothing about our wiring. */
function readObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Would this hook command actually run? The shim must be on PATH (or at the
 * absolute path named), and so must the single binary; a runtime given our
 * hook entry needs both the runtime and the entry on disk. `env` is the hook
 * process's own, which is the host's — the PATH that counts is the one the
 * host will run the command with. Read by `readOurHook`, so a flag this build
 * has never heard of does not make a live entry read as dead (a dead one is
 * one nobody stands down for).
 */
export function hookCommandLive(command: string, env: Record<string, string | undefined>): boolean {
  const ours = readOurHook(command);
  if (ours === null) return false;
  if (ours.shape !== "script") return runtimePresent(ours.exe, env);
  return runtimePresent(ours.exe, env) && existsSync(ours.script);
}

/** Every hook entry of ours in one settings object, by event. */
function hooksIn(file: string, settings: Record<string, unknown> | null, env: Record<string, string | undefined>): WiredHook[] {
  if (settings === null) return [];
  const hooks = settings["hooks"];
  if (!isRecord(hooks)) return [];
  const out: WiredHook[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) continue;
      for (const entry of group["hooks"] as unknown[]) {
        if (!isRecord(entry)) continue;
        const command = entry["command"];
        // RUNS OUR HOOK, read tolerantly (`readOurHook`): whatever flags the
        // version that wrote it put around the script.
        if (typeof command !== "string" || readOurHook(command) === null) continue;
        out.push({ file, event, command, live: hookCommandLive(command, env) });
      }
    }
  }
  return out;
}

/** An MCP entry named like ours, with the command it would run. */
function mcpEntry(
  file: string,
  scope: WiredMcp["scope"],
  servers: unknown,
  env: Record<string, string | undefined>,
): WiredMcp[] {
  if (!isRecord(servers)) return [];
  const entry = servers[NPM_MCP_NAME];
  if (!isRecord(entry)) return [];
  const command = typeof entry["command"] === "string" ? entry["command"] : "";
  const args = Array.isArray(entry["args"]) ? (entry["args"] as unknown[]).filter((a): a is string => typeof a === "string") : [];
  // A disabled-in-`/mcp` server is still registered; Claude Code keeps the
  // switch elsewhere and this reader does not chase it. Live means "the
  // command it names is there", which is the half that decides double tools.
  const run = parseScriptInvocation([command, ...args]);
  const live =
    command.length > 0 &&
    runtimePresent(command, env) &&
    (run === null ? true : existsSync(isAbsolute(run.script) ? run.script : resolve(run.script)));
  return [{ file, scope, command: [command, ...args].join(" "), live }];
}

/** The Counterparts plugin as Claude Code records it, for `doctor`. */
export interface PluginInstallRead {
  /** `counterparts@<marketplace>`. */
  readonly id: string;
  readonly installPath: string | null;
  readonly version: string | null;
  /** `enabledPlugins[id]` from user, project and local settings, the last one
   *  that says anything winning (Claude Code's precedence); unset is enabled. */
  readonly enabled: boolean;
}

/**
 * Is the plugin installed, and on? Read from `installed_plugins.json` under
 * Claude Code's plugins root (`CLAUDE_CODE_PLUGIN_CACHE_DIR`, else
 * `<config dir>/plugins`) and `enabledPlugins` in the settings files — the
 * shapes measured on 2.1.295 (`{"version":2,"plugins":{"<id>":[{"scope",
 * "installPath","version",…}]}}`; `enabledPlugins: {"<id>": true|false}`).
 * READ-ONLY. Null when no `counterparts@…` install is recorded.
 */
export function pluginInstall(input: {
  readonly home: string;
  readonly env: Record<string, string | undefined>;
  readonly cwd: string | null;
}): PluginInstallRead | null {
  const moved = (input.env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  const configDir = moved.length > 0 ? moved : join(input.home, ".claude");
  const cacheRoot = (input.env["CLAUDE_CODE_PLUGIN_CACHE_DIR"] ?? "").trim();
  const pluginsRoot = cacheRoot.length > 0 ? cacheRoot : join(configDir, "plugins");
  const installed = readObject(join(pluginsRoot, "installed_plugins.json"));
  const plugins = installed === null ? null : installed["plugins"];
  if (!isRecord(plugins)) return null;
  const id = Object.keys(plugins).find((k) => k.startsWith(`${NPM_MCP_NAME}@`));
  if (id === undefined) return null;
  const records = plugins[id];
  const first = Array.isArray(records) ? (records as unknown[]).find(isRecord) : isRecord(records) ? records : undefined;
  const files = [claudeUserFiles(input.home, input.env).settings];
  if (input.cwd !== null && input.cwd.length > 0) {
    files.push(join(resolve(input.cwd), ".claude", "settings.json"), join(resolve(input.cwd), ".claude", "settings.local.json"));
  }
  let enabled = true;
  for (const file of files) {
    const settings = readObject(file);
    const on = settings === null ? undefined : settings["enabledPlugins"];
    if (isRecord(on) && typeof on[id] === "boolean") enabled = on[id] as boolean;
  }
  return {
    id,
    installPath: first !== undefined && typeof first["installPath"] === "string" ? first["installPath"] : null,
    version: first !== undefined && typeof first["version"] === "string" ? first["version"] : null,
    enabled,
  };
}

/**
 * The npm install's wiring as Claude Code will see it for a session in `cwd`:
 * our hook entries in the user, project and local settings files, and a
 * server registered as `counterparts` in the user scope (`~/.claude.json`) or
 * the local scope (that file's `projects[<cwd>]`). READ-ONLY, every file,
 * always.
 */
export function npmWiring(input: {
  readonly home: string;
  readonly env: Record<string, string | undefined>;
  /** The session's project directory: `CLAUDE_PROJECT_DIR`, else the event's `cwd`. */
  readonly cwd: string | null;
  /**
   * Which half to read; both by default. The hook passes `{ mcp: false }`:
   * it runs every turn and needs only the hooks, and `~/.claude.json` grows
   * with every project's history, so parsing it per prompt is a cost for
   * nothing. The server, once per session, passes `{ hooks: false }`.
   */
  readonly read?: { readonly hooks?: boolean; readonly mcp?: boolean };
}): NpmWiring {
  const { settings, globalConfig } = claudeUserFiles(input.home, input.env);
  const cwd = input.cwd === null || input.cwd.length === 0 ? null : resolve(input.cwd);
  const hooks: WiredHook[] = [];
  if (input.read?.hooks !== false) {
    hooks.push(...hooksIn(settings, readObject(settings), input.env));
    if (cwd !== null) {
      for (const name of ["settings.json", "settings.local.json"]) {
        const file = join(cwd, ".claude", name);
        hooks.push(...hooksIn(file, readObject(file), input.env));
      }
    }
  }
  const mcp: WiredMcp[] = [];
  if (input.read?.mcp === false) return { hooks, mcp };
  const global = readObject(globalConfig);
  if (global !== null) {
    mcp.push(...mcpEntry(globalConfig, "user", global["mcpServers"], input.env));
    const projects = global["projects"];
    if (cwd !== null && isRecord(projects) && isRecord(projects[cwd])) {
      mcp.push(...mcpEntry(globalConfig, "local", (projects[cwd] as Record<string, unknown>)["mcpServers"], input.env));
    }
  }
  // A project `.mcp.json` is not read: `connect` never writes one, and a server
  // there waits for the person's approval, so its presence says nothing about
  // whether it runs.
  return { hooks, mcp };
}
