import { spawn } from "node:child_process";
export const DEFAULT_HOST_COMMAND = "claude";
export const PERMISSION_MODE = "default";
export const OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
export const KILL_GRACE_MS = 5000;
export const REAP_GRACE_MS = 2000;
export async function startChild(plan, abort) {
  return await new Promise((resolve) => {
    let settled = false;
    let terminated = false;
    const timers = [];
    let off = null;
    const chunks = [];
    let kept = 0;
    let outputShort = false;
    const output = () => plan.captureOutput === true ? { output: Buffer.concat(chunks).toString("utf8"), ...outputShort ? { outputShort } : {} } : {};
    const done = (r) => {
      if (settled)
        return;
      settled = true;
      for (const t of timers)
        clearTimeout(t);
      off?.();
      resolve({ ...r, ...output() });
    };
    let child;
    try {
      child = spawn(plan.command, [...plan.args], {
        detached: true,
        stdio: ["pipe", plan.captureOutput === true ? "pipe" : "ignore", "ignore"],
        env: { ...plan.env },
        ...plan.cwd === undefined ? {} : { cwd: plan.cwd }
      });
    } catch (err) {
      done({ code: null, timedOut: false, error: err instanceof Error ? err.name : "UNKNOWN", ...spawnCodeOf(err) });
      return;
    }
    child.stdout?.on("data", (chunk) => {
      if (kept >= OUTPUT_MAX_BYTES) {
        outputShort = true;
        return;
      }
      const room = OUTPUT_MAX_BYTES - kept;
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (part.length < chunk.length)
        outputShort = true;
      chunks.push(part);
      kept += part.length;
    });
    try {
      child.stdin?.end(plan.stdin);
    } catch {}
    const terminate = () => {
      if (terminated)
        return;
      terminated = true;
      signal(child, "SIGTERM");
      timers.push(arm(() => {
        signal(child, "SIGKILL");
        timers.push(arm(() => {
          done({ code: null, timedOut: true, error: "unkillable" });
        }, REAP_GRACE_MS));
      }, KILL_GRACE_MS));
    };
    if (Number.isFinite(plan.timeoutMs) && plan.timeoutMs > 0) {
      timers.push(arm(terminate, plan.timeoutMs));
    }
    if (abort !== undefined) {
      const onAbort = () => {
        terminate();
      };
      if (abort.aborted)
        onAbort();
      else {
        abort.addEventListener("abort", onAbort, { once: true });
        off = () => {
          abort.removeEventListener("abort", onAbort);
        };
      }
    }
    child.on("error", (err) => {
      done({ code: null, timedOut: false, error: err.name, ...spawnCodeOf(err) });
    });
    const ended = (exit, sig) => {
      done({
        code: exit,
        timedOut: terminated || sig === "SIGTERM" || sig === "SIGKILL",
        error: terminated ? "killed" : null
      });
    };
    child.on("close", ended);
    if (plan.captureOutput === true) {
      child.on("exit", (exit, sig) => {
        timers.push(arm(() => ended(exit, sig), REAP_GRACE_MS));
      });
    }
  });
}
function spawnCodeOf(err) {
  const c = err !== null && typeof err === "object" ? err.code : undefined;
  return typeof c === "string" && c.length > 0 ? { spawnCode: c } : {};
}
function arm(fn, ms) {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return t;
}
function signal(child, sig) {
  try {
    if (child.pid !== undefined)
      process.kill(-child.pid, sig);
  } catch {}
  try {
    child.kill(sig);
  } catch {}
}
