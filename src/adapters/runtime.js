import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export const BUN_NO_ENV_FILE = "--no-env-file";
export function binaryOf(moduleUrl, self) {
  const path = moduleUrl.startsWith("file:") ? decodeURIComponent(new URL(moduleUrl).pathname) : moduleUrl;
  if (!/[\\/]\$bunfs[\\/]|(^|[\\/])~BUN[\\/]/.test(path))
    return null;
  const root = path.replace(/[\\/][^\\/]*$/, "").replace(/^\/([A-Za-z]:[\\/])/, "$1");
  return { root, self };
}
export const BINARY = binaryOf(import.meta.url, process.execPath);
export function moduleExtOf(moduleUrl, binary = BINARY) {
  return binary === null && /\.js$/.test(moduleUrl) ? ".js" : ".ts";
}
export const MODULE_EXT = moduleExtOf(import.meta.url);
export const TRANSPILED = MODULE_EXT === ".js";
export function readsHostUserConfig(transpiled = TRANSPILED) {
  return !transpiled;
}
export function entryScript(url, ext = MODULE_EXT) {
  const path = fileURLToPath(url);
  return ext === ".js" ? path.replace(/\.ts$/, ".js") : path;
}
export function isCompiled(binary = BINARY) {
  return binary !== null;
}
export function packagePath(rel, binary = BINARY) {
  if (binary === null)
    return fileURLToPath(new URL(`../../${rel}`, import.meta.url));
  const sep = binary.root.includes("\\") ? "\\" : "/";
  return rel.includes("/") ? [binary.root, ...rel.split("/")].join(sep) : [binary.root, ".", rel].join(sep);
}
export function bundledModelDir(binary = BINARY) {
  return binary === null ? undefined : packagePath("node_modules/counterparts-model-potion", binary);
}
export const BINARY_MODES = ["hook", "mcp", "cli", "dashboard", "runner", "nightly"];
export const BINARY_MODE_OF = {
  "hook.ts": "hook",
  "serve.ts": "mcp",
  "counterparts.ts": "cli",
  "dashboard.ts": "dashboard",
  "runner.ts": "runner",
  "nightly.ts": "nightly"
};
export function isBinaryName(exe) {
  const name = exe.split(/[\\/]/).pop() ?? "";
  return /^counterparts([-.][\w.-]*)?$/i.test(name) && !/^counterparts-(hook|mcp|dashboard)(\.exe)?$/i.test(name);
}
export function binaryModeOf(script) {
  return BINARY_MODE_OF[basename(script).replace(/\.js$/, ".ts")];
}
function isBinaryMode(word) {
  return BINARY_MODES.includes(word ?? "");
}
export const EMPTY_BUNFIG = fileURLToPath(new URL("./empty-bunfig.toml", import.meta.url));
export const BUN_CONFIG_PREFIX = "--config=";
export const NODE_HOOKS = fileURLToPath(new URL("./node-hooks.mjs", import.meta.url));
export const CLI_SCRIPT = entryScript(new URL("./cli/bin/counterparts.ts", import.meta.url));
export function pluginConsoleWords(root) {
  const launcher = join(root, "src", "adapters", "plugin-run.sh");
  const entry = join(root, "src", "adapters", "cli", "bin", "counterparts.js");
  if (!existsSync(launcher) && existsSync(entry))
    return [entry];
  return ["sh", launcher, "cli"];
}
export const NODE_FLOOR = "22.15";
export function currentRuntime() {
  return process.versions.bun === undefined ? "node" : "bun";
}
export function runtimeLabel(binary = BINARY) {
  const bun = process.versions.bun;
  if (binary !== null)
    return `the single binary (bun ${bun ?? "?"})`;
  return bun === undefined ? `node ${process.versions.node}` : `bun ${bun}`;
}
export function runtimeOf(exe) {
  return /^node(js)?(\d[\d.]*)?(\.exe)?$/i.test(exe.split(/[\\/]/).pop() ?? "") ? "node" : "bun";
}
export function scriptArgs(script, exe = process.execPath, binary = BINARY) {
  const mode = binary !== null && exe === binary.self ? binaryModeOf(script) : undefined;
  if (mode !== undefined)
    return [mode];
  return runtimeOf(exe) === "node" ? ["--import", NODE_HOOKS, script] : [BUN_NO_ENV_FILE, `${BUN_CONFIG_PREFIX}${EMPTY_BUNFIG}`, "run", script];
}
export function parseScriptInvocation(tokens) {
  const exe = tokens[0] ?? "";
  if (exe.length === 0)
    return null;
  if (isBinaryName(exe) && isBinaryMode(tokens[1])) {
    return { exe, runtime: "binary", script: exe, mode: tokens[1], rest: tokens.slice(2), projectEnv: "ignored" };
  }
  let at = 1;
  let noEnvFile = false;
  let ownConfig = false;
  const flags = () => {
    for (;; ) {
      const t = tokens[at] ?? "";
      if (t === BUN_NO_ENV_FILE)
        noEnvFile = true;
      else if (t.startsWith(BUN_CONFIG_PREFIX) && t.length > BUN_CONFIG_PREFIX.length)
        ownConfig = true;
      else
        return;
      at += 1;
    }
  };
  flags();
  const flagged = at > 1;
  if (tokens[at] === "run") {
    at += 1;
    flags();
    const script = tokens[at] ?? "";
    if (script.length === 0)
      return null;
    const runtime = runtimeOf(exe);
    return {
      exe,
      runtime,
      script,
      rest: tokens.slice(at + 1),
      projectEnv: runtime === "node" || noEnvFile && ownConfig ? "ignored" : "read"
    };
  }
  if (flagged)
    return null;
  if (tokens[1] === "--import" && /(^|[/\\])node-hooks\.mjs$/.test(tokens[2] ?? "") && (tokens[3] ?? "").length > 0) {
    return { exe, runtime: "node", script: tokens[3], rest: tokens.slice(4), projectEnv: "ignored" };
  }
  return null;
}
export function runtimePresent(exe, env = process.env) {
  if (exe.includes("/") || exe.includes("\\"))
    return existsSync(exe);
  const dirs = (env["PATH"] ?? "").split(process.platform === "win32" ? ";" : ":").filter((d) => d.length > 0);
  return dirs.some((d) => existsSync(`${d}/${exe}`));
}
export function shellTokens(command) {
  const out = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (let i = 0;i < command.length; i += 1) {
    const ch = command[i] ?? "";
    if (ch === "\\" && quoted && i + 1 < command.length) {
      current += command[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (started || current.length > 0)
        out.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started || current.length > 0)
    out.push(current);
  return out;
}
