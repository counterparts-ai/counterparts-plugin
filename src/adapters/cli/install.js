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
  writeFileSync
} from "node:fs";
import { isDay } from "../../core/time.js";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
export const DEFAULT_STORE_DIR = "store";
import { EMBEDDER_KINDS } from "../config.js";
import { CONFIG_ENV, CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
import { entryScript, parseScriptInvocation, runtimeOf, runtimePresent, scriptArgs, shellTokens } from "../runtime.js";
import { pluginInstall, readOurHook } from "../host-wiring.js";
import {
  DEFAULT_DATA_DIR_NAME,
  PRE_ROWS_READABLE_BY,
  isWithin,
  preRowsMarkersIn
} from "../../core/store/index.js";
export const HOST_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "SessionEnd",
  "PreCompact"
];
export const BIN = {
  cli: "counterparts",
  hook: "counterparts-hook",
  mcp: "counterparts-mcp",
  dashboard: "counterparts-dashboard"
};
export const MCP_SERVER_NAME = "counterparts";
export const HOOK_SCRIPT = entryScript(new URL("../claude-code/bin/hook.ts", import.meta.url));
export const MCP_SCRIPT = entryScript(new URL("../mcp/bin/serve.ts", import.meta.url));
export function shellQuote(path) {
  return `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}
export function runCommand(script, exe = process.execPath) {
  const words = scriptArgs(script, exe).map((a) => /^[A-Za-z-]+$/.test(a) ? a : shellQuote(a));
  return [shellQuote(exe), ...words].join(" ");
}
export function hookCommand(configPath, exe = process.execPath) {
  const base = runCommand(HOOK_SCRIPT, exe);
  return configPath === undefined || configPath.length === 0 ? base : `${base} ${CONFIG_FLAG} ${shellQuote(configPath)}`;
}
export const CONFIG_FILE = "claude-code.json";
export const LEGACY_CREDENTIALS_FILE = "credentials.env";
export function installLayout(dirFlag, env, home = homedir(), configPath) {
  const named = dirFlag !== undefined && dirFlag.length > 0 ? dirFlag : (env["COUNTERPARTS_DATA_DIR"] ?? "").trim().length > 0 ? env["COUNTERPARTS_DATA_DIR"] : undefined;
  const base = configPath === undefined || configPath.length === 0 ? join(home, DEFAULT_DATA_DIR_NAME) : dirname(resolve(configPath));
  const store = named === undefined ? join(base, DEFAULT_STORE_DIR) : resolve(named);
  return {
    base,
    store,
    config: configPath === undefined || configPath.length === 0 ? join(base, CONFIG_FILE) : resolve(configPath)
  };
}
export function layoutRefusal(layout) {
  if (!isWithin(layout.store, layout.config))
    return null;
  return `refused: the configuration lives at ${layout.config}, which would sit INSIDE the ` + `data dir ${layout.store}. The store's layout check refuses an unclassified file at ` + `open (§5 G11), so that store would never open again. Choose a --dir that is not ` + `${layout.base} or an ancestor of it — ${join(layout.base, DEFAULT_STORE_DIR)} is the default.`;
}
export function tempRoots(env = process.env) {
  const out = [];
  const add = (value) => {
    if (!out.includes(value))
      out.push(value);
  };
  for (const raw of [tmpdir(), env["TMPDIR"], env["TMP"], env["TEMP"], "/tmp"]) {
    if (typeof raw !== "string" || raw.trim().length === 0)
      continue;
    const abs = resolve(raw.trim());
    add(abs);
    try {
      add(realpathSync(abs));
    } catch {}
  }
  return out;
}
function underTempRoot(path, roots) {
  const abs = resolve(path);
  return roots.some((root) => isWithin(root, abs));
}
export function throwawayDefaultRefusal(layout, env = process.env, home = homedir()) {
  const defaultConfig = defaultConfigPath(home);
  if (resolve(layout.config) !== defaultConfig)
    return null;
  const roots = tempRoots(env);
  if (!underTempRoot(layout.store, roots))
    return null;
  if (underTempRoot(defaultConfig, roots))
    return null;
  return `refused: this would write the DEFAULT configuration, ${defaultConfig}, with a data dir ` + `under the system temp directory (${layout.store}). That file is the one the hook, the ` + "worker and the MCP server read when nothing names another, so a throwaway store would " + "become this machine's live memory and the real one would stop being written to. " + `Name a scratch install instead: ` + `${CONFIG_FLAG} <absolute path outside ${join(home, DEFAULT_DATA_DIR_NAME)}>, which moves the ` + "configuration and the store together. A permanent store outside the temp " + "dir is the other way through.";
}
export function configObject(input) {
  const out = {
    dataDir: input.layout.store,
    owner: true,
    ...input.carried ?? {}
  };
  if (input.budgetBytes !== undefined)
    out["injectionBudgetBytes"] = input.budgetBytes;
  if (input.name !== undefined && input.name.length > 0)
    out["identity"] = { name: input.name };
  if (input.embedder !== undefined)
    out["embedder"] = { ...input.embedder };
  return out;
}
export function resolveEmbedderBlock(input) {
  if (input.enabled === undefined)
    return;
  if (input.enabled)
    return { enabled: true, kind: "static" };
  const was = embedderBlockIn(input.configPath);
  if (was === null)
    return { enabled: false, kind: "static" };
  const recorded = was["kind"];
  const oldKind = typeof recorded === "string" && EMBEDDER_KINDS.includes(recorded) ? recorded : undefined;
  return oldKind === undefined ? { enabled: false } : { enabled: false, kind: oldKind };
}
function embedderBlockIn(configPath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const block = raw["embedder"];
  return block !== null && typeof block === "object" && !Array.isArray(block) ? block : null;
}
export function settingsBlock(hookCommand = runCommand(HOOK_SCRIPT)) {
  const hooks = {};
  for (const event of HOST_EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: hookCommand }] }];
  }
  return JSON.stringify({ hooks }, null, 2);
}
export function mcpCommand(store, serve = runCommand(MCP_SCRIPT), configPath) {
  const config = configPath === undefined || configPath.length === 0 ? "" : ` -e ${CONFIG_ENV}=${shellQuote(configPath)}`;
  return `claude mcp add ${MCP_SERVER_NAME} -s user -e COUNTERPARTS_DATA_DIR=${shellQuote(store)}${config} -- ${serve}`;
}
export function budgetRefusal(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return `refused: --budget takes a positive whole number of bytes, not '${value}'.`;
  }
  return null;
}
export function writeOnce(path, text, opts) {
  const present = existsSync(path);
  if (present && !opts.force) {
    return { path, what: "kept", ...modeOf(path) };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, opts.mode === undefined ? {} : { mode: opts.mode });
  if (opts.mode !== undefined)
    chmodSync(path, opts.mode);
  return { path, what: present ? "replaced" : "created", ...modeOf(path) };
}
function modeOf(path) {
  try {
    return { mode: (statSync(path).mode & 511).toString(8).padStart(3, "0") };
  } catch {
    return {};
  }
}
export function desktopConfigPath(home) {
  return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
}
export function isOurDesktopEntry(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry))
    return false;
  const command = entry["command"];
  const args = entry["args"];
  if (typeof command !== "string" || !Array.isArray(args) || !args.every((a) => typeof a === "string"))
    return false;
  const run = parseScriptInvocation([command, ...args]);
  if (run === null || run.rest.length > 0)
    return false;
  return run.mode === "mcp" || run.mode === undefined && /((^|[/\\])adapters[/\\]mcp[/\\]bin[/\\]serve\.js|mcp[/\\]bin[/\\]serve\.ts)$/.test(run.script);
}
export const HOOK_COMMAND_MARK = /(^|[\s"'=/\\])counterparts-hook(\s|$|")|(adapters[/\\]claude-code[/\\]bin[/\\]hook\.js|claude-code[/\\]bin[/\\]hook\.(ts|mjs))(?=$|["'\s])|[/\\]counterparts(\.exe)?"?\s+hook(\s|$)/;
export function hookTargetPath(command) {
  const run = parseScriptInvocation(shellTokens(command));
  if (run?.runtime === "binary")
    return run.exe;
  const tokens = command.trim().split(/\s+/);
  for (const raw of tokens) {
    const token = raw.replace(/^["']|["']$/g, "");
    if (!token.startsWith("/"))
      continue;
    if (/node-hooks\.mjs$/.test(token))
      continue;
    if (/\.(ts|js|mjs|cjs)$/.test(token))
      return token;
    if (/counterparts-hook$/.test(token))
      return token;
  }
  return null;
}
export function hostSettingsFiles(userDir, cwd) {
  return [
    join(userDir, "settings.json"),
    join(userDir, "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json")
  ];
}
export function hostSettingsDir(home, env) {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0 ? moved : join(home, ".claude");
}
export function hostMcpFile(base) {
  return join(base, ".claude.json");
}
export function hostConfigBase(home, env) {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0 ? moved : home;
}
function readJsonFile(path) {
  if (!existsSync(path))
    return { state: "absent", value: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? { state: "read", value: parsed } : { state: "unreadable", value: {} };
  } catch {
    return { state: "unreadable", value: {} };
  }
}
export function readHost(home, cwd, env = process.env) {
  const base = hostConfigBase(home, env);
  const events = new Set;
  const live = new Set;
  const stale = new Map;
  const settingsRead = [];
  const settingsUnreadable = [];
  const runtimes = new Map;
  const noteRuntime = (tokens, used) => {
    const run = parseScriptInvocation(tokens);
    if (run === null)
      return;
    const row = runtimes.get(run.exe) ?? { kind: run.runtime, used: new Set, projectEnv: new Set };
    row.used.add(used);
    if (run.projectEnv === "read")
      row.projectEnv.add(used);
    runtimes.set(run.exe, row);
  };
  const noteHookRuntime = (command) => {
    const tokens = shellTokens(command);
    if (parseScriptInvocation(tokens) !== null)
      return noteRuntime(tokens, "hooks");
    const ours = readOurHook(command);
    if (ours === null || ours.shape === "shim")
      return;
    const row = runtimes.get(ours.exe) ?? {
      kind: ours.shape === "binary" ? "binary" : runtimeOf(ours.exe),
      used: new Set,
      projectEnv: new Set
    };
    row.used.add("hooks");
    if (ours.projectEnv === "read")
      row.projectEnv.add("hooks");
    runtimes.set(ours.exe, row);
  };
  for (const path of hostSettingsFiles(hostSettingsDir(home, env), cwd)) {
    const read = readJsonFile(path);
    if (read.state === "unreadable")
      settingsUnreadable.push(path);
    if (read.state !== "read")
      continue;
    settingsRead.push(path);
    const hooks = read.value["hooks"];
    if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks))
      continue;
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries))
        continue;
      for (const entry of entries) {
        if (entry === null || typeof entry !== "object")
          continue;
        const inner = entry["hooks"];
        if (!Array.isArray(inner))
          continue;
        for (const h of inner) {
          if (h === null || typeof h !== "object")
            continue;
          const command = h["command"];
          if (typeof command !== "string" || !HOOK_COMMAND_MARK.test(command))
            continue;
          events.add(event);
          noteHookRuntime(command);
          const target = hookTargetPath(command);
          if (target === null || existsSync(target))
            live.add(event);
          else
            stale.set(event, target);
        }
      }
    }
  }
  const mcpFile = hostMcpFile(base);
  const mcpRead = readJsonFile(mcpFile);
  const servers = mcpRead.value["mcpServers"];
  const mcp = servers !== null && typeof servers === "object" && !Array.isArray(servers) && MCP_SERVER_NAME in servers;
  if (mcp) {
    const entry = servers[MCP_SERVER_NAME];
    if (entry !== null && typeof entry === "object") {
      const command = entry["command"];
      const args = entry["args"];
      if (typeof command === "string" && Array.isArray(args) && args.every((a) => typeof a === "string")) {
        noteRuntime([command, ...args], "mcp");
      }
    }
  }
  const desktopServers = readJsonFile(desktopConfigPath(home)).value["mcpServers"];
  if (desktopServers !== null && typeof desktopServers === "object" && !Array.isArray(desktopServers)) {
    const entry = desktopServers[MCP_SERVER_NAME];
    if (isOurDesktopEntry(entry))
      noteRuntime([entry.command, ...entry.args], "desktop");
  }
  return {
    expected: [...HOST_EVENTS],
    events: [...events].sort(),
    stale: [...stale.entries()].filter(([event]) => !live.has(event)).map(([event, path]) => ({ event, path })).sort((a, b) => a.event < b.event ? -1 : 1),
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
      projectEnv: [...row.projectEnv].sort()
    })),
    plugin: pluginInstall({ home, env, cwd })
  };
}
export function parkedNameParts(name, base) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${escaped}\\.parked-(\\d{4}-\\d{2}-\\d{2})(?:-(\\d+))?$`).exec(name);
  if (m === null)
    return null;
  const date = m[1] ?? "";
  if (!isDay(date))
    return null;
  if (m[2] === undefined)
    return { date, ordinal: 1 };
  const ordinal = Number(m[2]);
  if (!Number.isInteger(ordinal) || ordinal < 2)
    return null;
  return { date, ordinal };
}
export function dirBytes(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory())
    return stat.size;
  let total = 0;
  let entries;
  try {
    entries = readdirSync(path);
  } catch {
    return total;
  }
  for (const name of entries)
    total += dirBytes(join(path, name));
  return total;
}
export function parkedRefusal(path, home) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return `refused: ${path} is not there any more.`;
  }
  if (stat.isSymbolicLink()) {
    return `refused: ${path} is a SYMBOLIC LINK, not the directory a park leaves. Renaming a link ` + "moves the link and leaves whatever it points at exactly where it is — and what came " + "back would be a name pointing somewhere nobody here chose. Nothing was moved.";
  }
  if (!stat.isDirectory()) {
    return `refused: ${path} is not a directory, so it is not a parked memory. Nothing was moved.`;
  }
  let real = resolve(path);
  try {
    real = realpathSync(real);
  } catch {}
  let realHome = resolve(home);
  try {
    realHome = realpathSync(realHome);
  } catch {}
  if (!isWithin(realHome, real)) {
    return `refused: ${path} resolves to ${real}, outside your home directory (${realHome}). This ` + "command brings back what an install of yours set aside; a path anywhere else is one " + "somebody else is responsible for. Nothing was moved.";
  }
  const storePath = join(path, DEFAULT_STORE_DIR);
  let storeStat;
  try {
    storeStat = lstatSync(storePath);
  } catch {
    storeStat = undefined;
  }
  if (storeStat === undefined) {
    return `refused: ${path} holds no '${DEFAULT_STORE_DIR}' directory, so the memory is not in it — ` + "a store that lived somewhere else was parked under its own name beside itself. Bringing " + "this folder back alone would point the hooks at a store that is not there. Move both by " + "hand if that is what you meant; nothing was moved.";
  }
  if (storeStat.isSymbolicLink()) {
    return `refused: ${storePath} is a SYMBOLIC LINK. What would come back is a name pointing at ` + "somebody else's directory — the next thing to open the store would open whatever it " + "names, and nothing downstream follows a link to find out. Act on the real directory by " + "hand; nothing was moved, and nothing in it was read.";
  }
  if (!storeStat.isDirectory()) {
    return `refused: ${storePath} is not a directory, so this is not a parked store. Nothing was moved.`;
  }
  const markers = preRowsMarkersIn(storePath);
  if (markers.length > 0) {
    return `refused: ${path} holds a store from before the rows floor (${markers.join(", ")}), which ` + "this build will not open. Bringing it back would leave every hook standing down with " + `nothing on screen to say why. ${PRE_ROWS_READABLE_BY} is the last build that reads one. ` + "It is left exactly where it is; nothing was moved.";
  }
  return null;
}
export function parkedSiblings(configDir, home) {
  const dir = resolve(configDir);
  const parent = dirname(dir);
  const base = basename(dir);
  let names;
  try {
    names = readdirSync(parent);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const parts = parkedNameParts(name, base);
    if (parts === null)
      continue;
    const path = join(parent, name);
    const refusal = parkedRefusal(path, home);
    out.push({
      path,
      date: parts.date,
      ordinal: parts.ordinal,
      bytes: refusal === null ? dirBytes(path) : 0,
      refusal
    });
  }
  out.sort((a, b) => a.date === b.date ? b.ordinal - a.ordinal : a.date < b.date ? 1 : -1);
  return out;
}
export function bringParkedBack(parked, destination, home) {
  const why = parkedRefusal(parked, home);
  if (why !== null)
    return { ok: false, reason: why };
  let there = true;
  try {
    lstatSync(destination);
  } catch {
    there = false;
  }
  if (there) {
    return {
      ok: false,
      reason: `refused: ${destination} exists again, so there is nowhere to put ${parked} back. ` + "A rename onto a directory that is there is how one folder ends up inside another. " + "Nothing was moved."
    };
  }
  try {
    renameSync(parked, destination);
  } catch (err) {
    return {
      ok: false,
      reason: `refused: ${parked} could not be moved back: ${String(err.message ?? err)}. Nothing was moved.`
    };
  }
  return { ok: true };
}
