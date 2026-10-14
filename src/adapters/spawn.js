import { spawn } from "node:child_process";
import { TUNABLES as REMEMBER, validateWatchdog } from "../core/remember/index.js";
import { CONFIG_ENV as CONFIG_PATH_ENV } from "./config-path.js";
import { TUNABLES } from "./config.js";
import { entryScript } from "./runtime.js";
export const WORKER_RUNNER_PATH = entryScript(new URL("./claude-code/bin/runner.ts", import.meta.url));
export const DATA_DIR_ENV = "COUNTERPARTS_DATA_DIR";
export const WATCHDOG_ENV = "COUNTERPARTS_WATCHDOG_MS";
export const SESSION_ENV = "COUNTERPARTS_SESSION";
export const NIGHT_RUN_ENV = "COUNTERPARTS_NIGHT_RUN";
export const SCOPE_ENV = "COUNTERPARTS_SCOPE";
export const NIGHT_CHILD_ENV = "COUNTERPARTS_NIGHT_CHILD";
export { CONFIG_ENV } from "./config-path.js";
export function planSpawn(input) {
  const { config } = input;
  const base = input.baseEnv ?? process.env;
  const timeoutMs = config.watchdogMs ?? TUNABLES.WATCHDOG_MS;
  const priorFailures = input.priorFailures ?? 0;
  const escalate = priorFailures + 1 >= TUNABLES.ESCALATE_AFTER;
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined)
      env[key] = value;
  }
  const refuse = (reason) => ({
    ok: false,
    reason,
    command: input.command,
    args: [...input.args],
    env,
    timeoutMs,
    escalate
  });
  if (config.observer === true) {
    return { ...refuse("OBSERVER"), escalate: false };
  }
  if (config.dataDir === undefined || config.dataDir.trim().length === 0) {
    return refuse("NO_DATA_DIR");
  }
  const watchdog = validateWatchdog(timeoutMs, REMEMBER.STALE_CLAIM_MS);
  if (!watchdog.ok) {
    return refuse(watchdog.reason === "TIMEOUT_NOT_FINITE" ? "WATCHDOG_NOT_FINITE" : "WATCHDOG_EXCEEDS_STALENESS");
  }
  env[DATA_DIR_ENV] = config.dataDir;
  env[WATCHDOG_ENV] = String(timeoutMs);
  if (input.session !== undefined && input.session.length > 0)
    env[SESSION_ENV] = input.session;
  if (input.scope !== undefined && input.scope.length > 0)
    env[SCOPE_ENV] = input.scope;
  if (input.configPath !== undefined && input.configPath.length > 0) {
    env[CONFIG_PATH_ENV] = input.configPath;
  }
  return {
    ok: true,
    reason: "ready",
    command: input.command,
    args: [...input.args],
    env,
    timeoutMs,
    escalate: false
  };
}
export function spawnDetached(plan, opts = {}) {
  const emit = opts.onEvent ?? (() => {});
  if (!plan.ok) {
    emit(plan.escalate ? "spawn.escalated" : "spawn.refused", {
      reason: plan.reason,
      timeoutMs: plan.timeoutMs,
      escalate: plan.escalate
    });
    return { started: false, reason: plan.reason, pid: null, escalate: plan.escalate, code: null };
  }
  const run = opts.spawner ?? ((p) => spawn(p.command, [...p.args], {
    detached: true,
    stdio: "ignore",
    env: { ...p.env },
    timeout: p.timeoutMs
  }));
  try {
    const child = run(plan);
    child.unref?.();
    emit("spawn.started", { pid: child.pid ?? null, timeoutMs: plan.timeoutMs });
    return { started: true, reason: "ready", pid: child.pid ?? null, escalate: false, code: null };
  } catch (err) {
    const code = err !== null && typeof err === "object" && typeof err.code === "string" ? err.code : "UNKNOWN";
    emit("spawn.failed", { code, timeoutMs: plan.timeoutMs });
    return { started: false, reason: "SPAWN_FAILED", pid: null, escalate: true, code };
  }
}
