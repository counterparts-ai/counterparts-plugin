/**
 * ONE WINDOWLESS HOST CHILD — started, watched, and ended.
 *
 * The headless nightly run (`night-run.ts`) starts `claude -p` as a child of a
 * detached process and waits for it under a watchdog. This file is the part of
 * that which is about the CHILD rather than about the night: the host command,
 * the permission mode, the plan shape a starter needs, and the starter itself.
 *
 * It lived in `page-writer.ts` until 2026-09-29, when the page writer's host
 * mode — the first thing in this package to start a windowless session — was
 * removed (the nightly run carries the page writer now). What the nightly run
 * shared with it moved here unchanged: the plan is pure and decides
 * everything, the starter is small enough to read, the prompt rides on STDIN
 * and never in `argv`, and the child's environment is the caller's to scrub
 * (`night-run.ts#planNightChild`).
 */
import { spawn } from "node:child_process";

/**
 * The host CLI a windowless child runs — always this one, resolved on the
 * child's PATH. It was once overridable by `pageWriter.command` in the
 * configuration; that key was removed on 2026-09-24 ("runs a command named by
 * config" was a supply-chain scanner's finding). A configuration that still
 * carries it is read with the key ignored and named (`config.ts#loadConfig`).
 */
export const DEFAULT_HOST_COMMAND = "claude";

/**
 * The permission mode a windowless child runs under: `default`, beside an
 * explicit allow-list. In a session with no window a prompt nobody can answer
 * is a refusal, which is the direction this should fail in.
 */
export const PERMISSION_MODE = "default";

/** What one child did, as the OS reported it. Injected so a test can prove the
 *  whole path without starting a process. */
export interface ChildResult {
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly error: string | null;
  /** The OS's code when the child could not be started at all (`ENOENT` for a
   *  command that is not there). Absent otherwise. */
  readonly spawnCode?: string;
}

/** WHAT `startChild` NEEDS OF A PLAN. */
export interface ChildPlan {
  readonly command: string;
  readonly args: readonly string[];
  /** What goes on the child's STDIN — the instruction. It is not in `argv`
   *  because a command line is readable by every process on the machine. */
  readonly stdin: string;
  /** The child's complete environment. The caller's own values are written LAST. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** The child's working directory; absent, this process's. */
  readonly cwd?: string;
}

/**
 * HOW LONG A CHILD GETS TO DIE POLITELY before it is killed, and how long after
 * that before this stops waiting for the OS to confirm it.
 *
 * Both exist because of one hole (S2 review, MAJOR-3): the first version
 * resolved only on `close` or `error`, and both alarms — `spawn`'s own timeout
 * and the caller's abort — send SIGTERM and nothing else. A child that ignores
 * SIGTERM (a trapping shell wrapper, an uninterruptible wait, a CLI with its
 * own handler) therefore kept the promise pending, which kept the waiting
 * process HOLDING THE STORE OPEN for as long as the child lived. It was
 * reproduced: `trap '' TERM; sleep 60` with a 3-second child watchdog and a
 * 1.2-second abort still had the waiter alive at 25 seconds.
 */
export const KILL_GRACE_MS = 5_000;
export const REAP_GRACE_MS = 2_000;

/** The real starter: one child, two alarms, and an end that does not need it. */
export async function startChild(plan: ChildPlan, abort?: AbortSignal): Promise<ChildResult> {
  return await new Promise<ChildResult>((resolve) => {
    let settled = false;
    let terminated = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let off: (() => void) | null = null;
    const done = (r: ChildResult): void => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      off?.();
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(plan.command, [...plan.args], {
        // DETACHED ONLY SO THERE IS A PROCESS GROUP TO KILL. The caller still
        // awaits this child — `unref` is deliberately not called — so a child
        // whose outcome nobody can record is still impossible. What `detached`
        // buys is that a host CLI which spawned helpers of its own cannot
        // survive in them after the watchdog fires.
        detached: true,
        // THE PROMPT GOES ON STDIN, not in `argv`: what a child is handed in a
        // command line is readable by every process on the machine through
        // `ps` (S2 review, NIT-2). `claude -p` with no positional prompt reads
        // stdin.
        stdio: ["pipe", "ignore", "ignore"],
        env: { ...plan.env },
        ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
      });
    } catch (err) {
      // A runtime that refuses synchronously rather than by `error` (a command
      // that is not there, on some runtimes): the same answer, now.
      done({ code: null, timedOut: false, error: err instanceof Error ? err.name : "UNKNOWN", ...spawnCodeOf(err) });
      return;
    }
    try {
      child.stdin?.end(plan.stdin);
    } catch {
      /* a child that died before its stdin opened is handled by `error` below */
    }
    /** SIGTERM, then SIGKILL, then stop waiting. Each step arms the next. */
    const terminate = (): void => {
      if (terminated) return;
      terminated = true;
      signal(child, "SIGTERM");
      timers.push(
        arm(() => {
          // The polite ask was ignored. SIGKILL cannot be trapped; the process
          // GROUP goes with it, because a `claude` that spawned its own
          // children would otherwise leave them holding the terminal.
          signal(child, "SIGKILL");
          // ...and if even that does not produce a `close` — a child wedged in
          // an uninterruptible wait is the case — this stops waiting anyway.
          // The caller gets its answer and exits; the row says
          // `failed(unkillable)` rather than nothing at all.
          timers.push(
            arm(() => {
              done({ code: null, timedOut: true, error: "unkillable" });
            }, REAP_GRACE_MS),
          );
        }, KILL_GRACE_MS),
      );
    };
    // THE CHILD'S OWN WATCHDOG, armed here rather than left to `spawn`'s
    // `timeout` option, which only signals and never resolves anything.
    if (Number.isFinite(plan.timeoutMs) && plan.timeoutMs > 0) {
      timers.push(arm(terminate, plan.timeoutMs));
    }
    // THE CALLER'S WATCHDOG, which may be shorter than the child's. Fired, it
    // takes the child with it rather than leaving the caller holding the store
    // open past the life its own contract states.
    if (abort !== undefined) {
      const onAbort = (): void => {
        terminate();
      };
      if (abort.aborted) onAbort();
      else {
        abort.addEventListener("abort", onAbort, { once: true });
        off = (): void => {
          abort.removeEventListener("abort", onAbort);
        };
      }
    }
    child.on("error", (err) => {
      done({ code: null, timedOut: false, error: err.name, ...spawnCodeOf(err) });
    });
    child.on("close", (exit, sig) => {
      done({
        code: exit,
        timedOut: terminated || sig === "SIGTERM" || sig === "SIGKILL",
        error: terminated ? "killed" : null,
      });
    });
  });
}

/** The OS error code on a failed start (`ENOENT`, `EACCES`), as a field or nothing. */
function spawnCodeOf(err: unknown): { spawnCode?: string } {
  const c = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  return typeof c === "string" && c.length > 0 ? { spawnCode: c } : {};
}

/** A timer that never keeps the process alive on its own. */
function arm(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return t;
}

/**
 * Signal the child's whole process GROUP where the platform has one, falling
 * back to the child alone. A host CLI that spawned helpers of its own would
 * otherwise survive in them.
 */
function signal(child: { pid?: number | undefined; kill: (s: NodeJS.Signals) => boolean }, sig: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, sig);
  } catch {
    /* no group, or already gone — fall through to the child itself */
  }
  try {
    child.kill(sig);
  } catch {
    /* already gone */
  }
}
