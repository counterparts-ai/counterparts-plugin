import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { CONFIG_FLAG } from "./config-path.js";
import {
  BUN_CONFIG_PREFIX,
  BUN_NO_ENV_FILE,
  isBinaryName,
  parseScriptInvocation,
  readsHostUserConfig,
  runtimeOf,
  runtimePresent,
  shellTokens
} from "./runtime.js";
export const NPM_MCP_NAME = "counterparts";
const SHELL_OPERATOR = /&&|\|\||;|\||>|<|`|\$\(/;
export function isOurHookCommand(command) {
  if (SHELL_OPERATOR.test(command))
    return false;
  const tokens = shellTokens(command);
  if (tokens.length === 0)
    return false;
  const tail = (from) => {
    const rest = tokens.slice(from);
    if (rest.length === 0)
      return true;
    return rest.length === 2 && rest[0] === CONFIG_FLAG && (rest[1] ?? "").length > 0;
  };
  const first = tokens[0] ?? "";
  if (/(^|[/\\])counterparts-hook$/.test(first))
    return tail(1);
  const run = parseScriptInvocation(tokens);
  if (run !== null && (run.mode === "hook" || run.mode === undefined && /((^|[/\\])adapters[/\\]claude-code[/\\]bin[/\\]hook\.js|claude-code[/\\]bin[/\\]hook\.ts)$/.test(run.script))) {
    return tail(tokens.length - run.rest.length);
  }
  return false;
}
const HOOK_ENTRY = /(^|[/\\])adapters[/\\]claude-code[/\\]bin[/\\]hook\.(ts|mjs|js)$/;
export function readOurHook(command) {
  if (SHELL_OPERATOR.test(command))
    return null;
  const tokens = shellTokens(command);
  const exe = tokens[0] ?? "";
  if (exe.length === 0)
    return null;
  if (/(^|[/\\])counterparts-hook$/.test(exe))
    return { shape: "shim", exe, script: exe, projectEnv: "ignored" };
  let at = 1;
  const isFlag = (t) => t !== undefined && t.length > 1 && t.startsWith("-");
  if (isBinaryName(exe)) {
    while (isFlag(tokens[at]))
      at += 1;
    return tokens[at] === "hook" ? { shape: "binary", exe, script: exe, projectEnv: "ignored" } : null;
  }
  let ran = false;
  let noEnvFile = false;
  let ownConfig = false;
  for (;at < tokens.length; at += 1) {
    const t = tokens[at] ?? "";
    if (isFlag(t)) {
      if (t === BUN_NO_ENV_FILE)
        noEnvFile = true;
      if (t.startsWith(BUN_CONFIG_PREFIX) && t.length > BUN_CONFIG_PREFIX.length)
        ownConfig = true;
      if (t === "--import")
        at += 1;
      continue;
    }
    if (t === "run" && !ran) {
      ran = true;
      continue;
    }
    if (!HOOK_ENTRY.test(t))
      return null;
    const projectEnv = runtimeOf(exe) === "node" || noEnvFile && ownConfig ? "ignored" : "read";
    return { shape: "script", exe, script: t, projectEnv };
  }
  return null;
}
export function claudeUserFiles(home, env) {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0 ? { settings: join(moved, "settings.json"), globalConfig: join(moved, ".claude.json") } : { settings: join(home, ".claude", "settings.json"), globalConfig: join(home, ".claude.json") };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readObject(path) {
  if (!existsSync(path))
    return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}
export function hookCommandLive(command, env) {
  const ours = readOurHook(command);
  if (ours === null)
    return false;
  if (ours.shape !== "script")
    return runtimePresent(ours.exe, env);
  return runtimePresent(ours.exe, env) && existsSync(ours.script);
}
function hooksIn(file, settings, env) {
  if (settings === null)
    return [];
  const hooks = settings["hooks"];
  if (!isRecord(hooks))
    return [];
  const out = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups))
      continue;
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group["hooks"]))
        continue;
      for (const entry of group["hooks"]) {
        if (!isRecord(entry))
          continue;
        const command = entry["command"];
        if (typeof command !== "string" || readOurHook(command) === null)
          continue;
        out.push({ file, event, command, live: hookCommandLive(command, env) });
      }
    }
  }
  return out;
}
function mcpEntry(file, scope, servers, env) {
  if (!isRecord(servers))
    return [];
  const entry = servers[NPM_MCP_NAME];
  if (!isRecord(entry))
    return [];
  const command = typeof entry["command"] === "string" ? entry["command"] : "";
  const args = Array.isArray(entry["args"]) ? entry["args"].filter((a) => typeof a === "string") : [];
  const run = parseScriptInvocation([command, ...args]);
  const live = command.length > 0 && runtimePresent(command, env) && (run === null ? true : existsSync(isAbsolute(run.script) ? run.script : resolve(run.script)));
  return [{ file, scope, command: [command, ...args].join(" "), live }];
}
export function pluginStandsDown(installPath) {
  if (installPath === null || installPath.length === 0)
    return null;
  if (existsSync(join(installPath, "src", "adapters", "plugin-run.sh")))
    return true;
  if (existsSync(join(installPath, "src", "adapters", "runtime.js")))
    return false;
  return null;
}
export function pluginInstall(input) {
  const moved = (input.env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  const configDir = moved.length > 0 ? moved : join(input.home, ".claude");
  const cacheRoot = (input.env["CLAUDE_CODE_PLUGIN_CACHE_DIR"] ?? "").trim();
  const pluginsRoot = cacheRoot.length > 0 ? cacheRoot : join(configDir, "plugins");
  const installed = readObject(join(pluginsRoot, "installed_plugins.json"));
  const plugins = installed === null ? null : installed["plugins"];
  if (!isRecord(plugins))
    return null;
  const id = Object.keys(plugins).find((k) => k.startsWith(`${NPM_MCP_NAME}@`));
  if (id === undefined)
    return null;
  const records = plugins[id];
  const first = Array.isArray(records) ? records.find(isRecord) : isRecord(records) ? records : undefined;
  const files = [claudeUserFiles(input.home, input.env).settings];
  if (input.cwd !== null && input.cwd.length > 0) {
    files.push(join(resolve(input.cwd), ".claude", "settings.json"), join(resolve(input.cwd), ".claude", "settings.local.json"));
  }
  let enabled = true;
  for (const file of files) {
    const settings = readObject(file);
    const on = settings === null ? undefined : settings["enabledPlugins"];
    if (isRecord(on) && typeof on[id] === "boolean")
      enabled = on[id];
  }
  const installPath = first !== undefined && typeof first["installPath"] === "string" ? first["installPath"] : null;
  return {
    id,
    installPath,
    version: first !== undefined && typeof first["version"] === "string" ? first["version"] : null,
    scope: first !== undefined && typeof first["scope"] === "string" ? first["scope"] : null,
    projectPath: first !== undefined && typeof first["projectPath"] === "string" ? first["projectPath"] : null,
    enabled,
    standsDown: pluginStandsDown(installPath)
  };
}
export function npmWiring(input) {
  if (!(input.readsUserConfig ?? readsHostUserConfig()))
    return { hooks: [], mcp: [] };
  const { settings, globalConfig } = claudeUserFiles(input.home, input.env);
  const cwd = input.cwd === null || input.cwd.length === 0 ? null : resolve(input.cwd);
  const hooks = [];
  if (input.read?.hooks !== false) {
    hooks.push(...hooksIn(settings, readObject(settings), input.env));
    if (cwd !== null) {
      for (const name of ["settings.json", "settings.local.json"]) {
        const file = join(cwd, ".claude", name);
        hooks.push(...hooksIn(file, readObject(file), input.env));
      }
    }
  }
  const mcp = [];
  if (input.read?.mcp === false)
    return { hooks, mcp };
  const global = readObject(globalConfig);
  if (global !== null) {
    mcp.push(...mcpEntry(globalConfig, "user", global["mcpServers"], input.env));
    const projects = global["projects"];
    if (cwd !== null && isRecord(projects) && isRecord(projects[cwd])) {
      mcp.push(...mcpEntry(globalConfig, "local", projects[cwd]["mcpServers"], input.env));
    }
  }
  return { hooks, mcp };
}
