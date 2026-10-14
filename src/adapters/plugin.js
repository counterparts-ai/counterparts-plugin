import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NEW_INSTALL_DREAMING_LINE_PLUGIN } from "../core/onboarding.js";
import { implicitConfigRefusal } from "./config-path.js";
import { pluginInstall } from "./host-wiring.js";
import { BINARY, CLI_SCRIPT, parseScriptInvocation, scriptArgs, shellTokens } from "./runtime.js";
export const PLUGIN_ROOT_ENV = "CLAUDE_PLUGIN_ROOT";
export const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
function realOrResolved(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
export function runningAsPlugin(env, packageRoot = PACKAGE_ROOT, binary = BINARY) {
  const named = (env[PLUGIN_ROOT_ENV] ?? "").trim();
  if (named.length === 0)
    return false;
  if (binary !== null) {
    const data = (env[PLUGIN_DATA_ENV] ?? "").trim();
    if (data.length === 0)
      return false;
    const rel = relative(realOrResolved(data), realOrResolved(binary.self));
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
  }
  return realOrResolved(named) === realOrResolved(packageRoot);
}
export function installRoute(env, packageRoot = PACKAGE_ROOT, binary = BINARY) {
  if (runningAsPlugin(env, packageRoot, binary))
    return "plugin";
  return (env[PLUGIN_ROOT_ENV] ?? "").trim().length > 0 ? "either" : "npm";
}
function tildeOf(path, home) {
  const h = resolve(home);
  const p = resolve(path);
  return p === h ? "~" : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
}
export function pluginOrigin(input) {
  const named = (input.env[PLUGIN_ROOT_ENV] ?? "").trim();
  const root = realOrResolved(input.root ?? (named.length > 0 ? named : PACKAGE_ROOT)).replace(/\/+$/, "");
  const moved = (input.env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  const configDir = moved.length > 0 ? moved : join(input.home, ".claude");
  const cacheRoot = (input.env["CLAUDE_CODE_PLUGIN_CACHE_DIR"] ?? "").trim();
  const pluginsRoot = realOrResolved(cacheRoot.length > 0 ? cacheRoot : join(configDir, "plugins")).replace(/\/+$/, "");
  if (root === pluginsRoot || root.startsWith(`${pluginsRoot}/`))
    return { installed: true, root };
  const recorded = pluginInstall({ home: input.home, env: input.env, cwd: input.cwd ?? null })?.installPath ?? null;
  if (recorded !== null && realOrResolved(recorded).replace(/\/+$/, "") === root)
    return { installed: true, root };
  return { installed: false, root };
}
const INSTALLED = { installed: true, root: "" };
export function hookGate(wiring, home, origin = INSTALLED) {
  const live = wiring.hooks.find((h) => h.live);
  if (live !== undefined) {
    return {
      standDown: true,
      line: origin.installed ? `Counterparts is installed twice: the npm install's hooks in ${tildeOf(live.file, home)} and this plugin. ` + "The plugin is standing down so nothing is captured twice; both use the same memory, so nothing needs to change. " + "Optional, only if you want the plugin alone: `counterparts disconnect`, then restart Claude Code." : `Counterparts: this plugin is running from a folder (${tildeOf(origin.root, home)}), beside the npm install's hooks in ` + `${tildeOf(live.file, home)}. Its own hooks and server stand down and the npm install keeps your memory, ` + "as expected. Nothing to do."
    };
  }
  const dead = wiring.hooks[0];
  if (dead !== undefined) {
    return {
      standDown: false,
      line: `Counterparts: ${tildeOf(dead.file, home)} still names an old Counterparts hook that no longer runs. ` + "The plugin is keeping your memory; remove those entries to quiet them."
    };
  }
  return { standDown: false, line: null };
}
export function mcpGate(wiring, home, origin = INSTALLED) {
  const live = wiring.mcp.find((m) => m.live);
  if (live === undefined)
    return { standDown: false, instructions: null };
  const head = `This plugin's Counterparts server is standing down: the npm install already registers a ` + `"counterparts" memory server (${live.scope} scope, ${tildeOf(live.file, home)}), and two servers ` + "over one memory would offer every tool twice. Use that server's tools. ";
  return {
    standDown: true,
    instructions: origin.installed ? head + "Nothing needs to change: both use the same memory. Only if the person asks to keep the plugin alone, " + "`counterparts disconnect` and a restart of Claude Code do it; it is their choice, never one to make for them." : head + `This plugin is running from a folder (${tildeOf(origin.root, home)}), not an install, which is expected ` + "beside the npm install. Nothing needs to change; do not suggest disconnecting or uninstalling anything."
  };
}
export function pluginDoctorLine(wiring, home, origin = INSTALLED) {
  const hook = wiring.hooks.find((h) => h.live);
  const mcp = wiring.mcp.find((m) => m.live);
  if (hook === undefined && mcp === undefined)
    return null;
  const where = hook !== undefined ? `its hooks in ${tildeOf(hook.file, home)}` : `its "counterparts" server (${mcp?.scope ?? "user"} scope, ${tildeOf(mcp?.file ?? "", home)})`;
  const copy = origin.installed ? "This plugin" : `This plugin (running from ${tildeOf(origin.root, home)})`;
  return `${copy} is standing down: the npm install is the live one here (${where}). ` + "What follows is the wired npm install's own doctor (`counterparts doctor`), the one that knows your memory.";
}
export function npmDoctorCommand(wiring) {
  const entries = [...wiring.hooks.filter((h) => h.live), ...wiring.mcp.filter((m) => m.live)];
  for (const entry of entries) {
    const tokens = shellTokens(entry.command);
    const call = parseScriptInvocation(tokens);
    if (call === null)
      continue;
    const at = call.rest.indexOf("--config");
    const config = at >= 0 && call.rest[at + 1] !== undefined ? ["--config", call.rest[at + 1]] : [];
    if (call.runtime === "binary")
      return { exe: call.exe, args: ["cli", "doctor", ...config] };
    const cli = join(dirname(call.script), "..", "..", "cli", "bin", `counterparts${call.script.endsWith(".js") ? ".js" : ".ts"}`);
    if (!existsSync(cli))
      continue;
    const scriptAt = tokens.indexOf(call.script, 1);
    const prefix = scriptAt > 0 ? tokens.slice(1, scriptAt) : ["run"];
    return { exe: call.exe, args: [...prefix, resolve(cli), "doctor", ...config] };
  }
  return null;
}
export const FIRST_RUN_WAIT_MS = 20000;
export const FIRST_RUN_STALE_MS = 120000;
export const FIRST_RUN_TIMEOUT_MS = 60000;
export function firstRunLockPath(configPath, tmp = tmpdir()) {
  return join(tmp, `counterparts-first-run-${firstRunKey(configPath)}.lock`);
}
function firstRunKey(configPath) {
  return createHash("sha256").update(resolve(configPath)).digest("hex").slice(0, 16);
}
export function firstRunNoticePath(configPath, tmp = tmpdir()) {
  return join(tmp, `counterparts-first-run-${firstRunKey(configPath)}.unannounced`);
}
export function takeFirstRunNotice(noticePath) {
  try {
    unlinkSync(noticePath);
    return true;
  } catch {
    return false;
  }
}
export function twiceNoticePath(configPath, env, tmp = tmpdir()) {
  const data = (env[PLUGIN_DATA_ENV] ?? "").trim();
  return join(data.length > 0 ? data : tmp, `counterparts-installed-twice-${firstRunKey(configPath)}.said`);
}
export function markTwiceSaid(markPath) {
  try {
    mkdirSync(dirname(markPath), { recursive: true });
    writeFileSync(markPath, `${new Date().toISOString()}
`, { encoding: "utf8", mode: 384, flag: "wx" });
    return true;
  } catch (err) {
    return err.code !== "EEXIST";
  }
}
export function firstRunLine(configPath, home) {
  const base = dirname(configPath);
  const parked = parkedBeside(base);
  return `Counterparts is set up: a memory that stays on this computer, in ${tildeOf(base, home)}. ` + NEW_INSTALL_DREAMING_LINE_PLUGIN + (parked.length === 0 ? "" : ` A memory set aside earlier is still at ${parked.map((p) => tildeOf(p, home)).join(", ")}, untouched; ` + "the new one does not include it.");
}
function leaveFirstRunNotice(noticePath, configPath) {
  takeFirstRunNotice(noticePath);
  try {
    writeFileSync(noticePath, `${JSON.stringify({ config: resolve(configPath), at: new Date().toISOString(), pid: process.pid })}
`, {
      encoding: "utf8",
      mode: 384,
      flag: "wx"
    });
    return true;
  } catch {
    return false;
  }
}
export function parkedBeside(base) {
  const dir = dirname(resolve(base));
  const prefix = `${basename(resolve(base))}.parked-`;
  try {
    return readdirSync(dir).filter((n) => n.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(n.slice(prefix.length))).sort().map((n) => join(dir, n));
  } catch {
    return [];
  }
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
export function ensureFirstRun(input) {
  const { choice, env } = input;
  if (choice.source !== "default")
    return { state: "skipped", line: null, detail: `configuration named by ${choice.source}` };
  if (existsSync(choice.path))
    return { state: "existed", line: null };
  const guard = implicitConfigRefusal(choice, env);
  if (guard !== null)
    return { state: "skipped", line: null, detail: guard };
  const now = input.now ?? (() => Date.now());
  const lock = input.lockPath ?? firstRunLockPath(choice.path);
  const notice = input.noticePath ?? firstRunNoticePath(choice.path);
  const waitMs = input.waitMs ?? FIRST_RUN_WAIT_MS;
  const staleMs = input.staleMs ?? FIRST_RUN_STALE_MS;
  const joined = { state: "joined", line: null };
  const take = () => {
    try {
      mkdirSync(lock, 448);
      return true;
    } catch (err) {
      if (err.code !== "EEXIST")
        throw err;
      return false;
    }
  };
  const uid = input.uid !== undefined ? input.uid : typeof process.getuid === "function" ? process.getuid() : null;
  const planted = () => {
    if (uid === null)
      return false;
    try {
      const st = lstatSync(lock);
      return !st.isDirectory() || st.uid !== uid;
    } catch {
      return false;
    }
  };
  let held = take();
  if (!held) {
    const until = now() + waitMs;
    while (!held) {
      if (existsSync(choice.path))
        return joined;
      if (planted())
        break;
      let age = 0;
      try {
        age = Math.abs(now() - statSync(lock).mtimeMs);
      } catch {
        age = 0;
      }
      if (age > staleMs) {
        try {
          rmdirSync(lock);
        } catch {}
      }
      held = take();
      if (held)
        break;
      if (now() >= until) {
        return { state: "failed", line: null, detail: `timed out after ${String(waitMs)} ms waiting for another first run (${lock})` };
      }
      sleepSync(100);
    }
  }
  try {
    if (existsSync(choice.path))
      return joined;
    const left = leaveFirstRunNotice(notice, choice.path);
    const runtime = input.runtime ?? process.execPath;
    const script = input.cliScript ?? CLI_SCRIPT;
    const res = spawnSync(runtime, [...scriptArgs(script, runtime), "install", "--no-connect"], {
      env,
      encoding: "utf8",
      timeout: FIRST_RUN_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (res.status === 0 && existsSync(choice.path)) {
      return { state: "created", line: left ? null : firstRunLine(choice.path, input.home) };
    }
    if (left)
      takeFirstRunNotice(notice);
    const why = (String(res.stderr ?? "").trim().split(`
`).pop() ?? "") || (res.error?.message ?? `exit ${String(res.status)}`);
    return {
      state: "failed",
      line: `Counterparts could not set up its memory on first run (${why.slice(0, 200)}). Memory is off for this session.`,
      detail: why
    };
  } finally {
    if (held) {
      try {
        rmdirSync(lock);
      } catch {}
    }
  }
}
