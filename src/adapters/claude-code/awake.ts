/**
 * TIME AWAKE, TOLD FROM TIME ASLEEP (2026-11-01, NT1).
 *
 * On 2026-11-01 a night started in a lid-closed dark wake. Its catch-up child got about 15 s
 * awake, the laptop slept 853 s, and its 10-minute `setTimeout` fired on wake. A watchdog is
 * there to stop a child that is stuck, not one whose machine was asleep.
 *
 * No clock JavaScript can read stops for sleep everywhere, and timers disagree (run and read
 * in the PR): on macOS `process.hrtime` runs through sleep (libuv uses `mach_continuous_time`,
 * and bun's timer fired on wake on 11-01); on Linux libuv uses `CLOCK_MONOTONIC`, which stops
 * for a suspend. So this leans on none of them. It looks at the wall clock every tick while it
 * waits: a tick that comes `NIGHT_ASLEEP_GAP_MS` late means the process was not running, and
 * that gap is not charged. Whether the runtime's timer fired right on wake (macOS) or a tick
 * after it (Linux), the wall clock shows the same gap.
 *
 * Loose on purpose. A sleep shorter than the gap is charged, so nothing below it is ever
 * mistaken for sleep and a stuck child still dies on schedule, a tick late at worst. A wall
 * clock stepped forward reads as sleep and one stepped back as no time at all, each once.
 * A process stopped by SIGSTOP reads as asleep too: it was not running either.
 */
import { TUNABLES } from "../config.js";

export interface AwakeOptions {
  /** The wall clock. */
  readonly now?: () => number;
  readonly tickMs?: number;
  readonly gapMs?: number;
  /** Starts one wait and returns how to cancel it; absent, an unref'd `setTimeout`. */
  readonly schedule?: (fn: () => void, ms: number) => () => void;
  /** Told each sleep as it is noticed, with how long it lasted. Its throw is swallowed. */
  readonly onSlept?: (ms: number) => void;
}

/** What a wait has seen so far. Reading it looks at the clock, so a wait that ends on wake sees the sleep before the next tick. */
export interface AwakeMeter {
  asleepMs(): number;
  stop(): void;
}

function realSchedule(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return () => {
    clearTimeout(t);
  };
}

/** The accounts, with no timer of their own. */
function accounts(opts: AwakeOptions): { readonly tick: number; look(): void; awake(): number; asleep(): number } {
  const now = opts.now ?? ((): number => Date.now());
  const tick = opts.tickMs ?? TUNABLES.NIGHT_AWAKE_TICK_MS;
  const gap = opts.gapMs ?? TUNABLES.NIGHT_ASLEEP_GAP_MS;
  let last = now();
  let awake = 0;
  let asleep = 0;
  return {
    tick,
    look(): void {
      const t = now();
      const elapsed = t - last;
      last = t;
      if (elapsed > gap) {
        const slept = elapsed - tick;
        awake += tick;
        asleep += slept;
        try {
          opts.onSlept?.(slept);
        } catch {
          /* a sleep nobody could write down is still a sleep */
        }
      } else if (elapsed > 0) {
        awake += elapsed;
      }
    },
    awake: () => awake,
    asleep: () => asleep,
  };
}

/** A running count of what a long wait slept through. */
export function awakeMeter(opts: AwakeOptions = {}): AwakeMeter {
  const a = accounts(opts);
  const schedule = opts.schedule ?? realSchedule;
  let cancel: (() => void) | null = null;
  const step = (): void => {
    a.look();
    if (cancel !== null) cancel = schedule(step, a.tick);
  };
  cancel = schedule(step, a.tick);
  return {
    asleepMs(): number {
      a.look();
      return a.asleep();
    },
    stop(): void {
      cancel?.();
      cancel = null;
    },
  };
}

/** Run `fn` once after `ms` of time awake. Returns how to cancel it. */
export function armAwake(fn: () => void, ms: number, opts: AwakeOptions = {}): () => void {
  const a = accounts(opts);
  const schedule = opts.schedule ?? realSchedule;
  let cancel: (() => void) | null = null;
  const step = (): void => {
    a.look();
    const left = ms - a.awake();
    if (left <= 0) {
      cancel = null;
      fn();
      return;
    }
    cancel = schedule(step, Math.min(a.tick, left));
  };
  cancel = schedule(step, Math.min(a.tick, ms));
  return () => {
    cancel?.();
    cancel = null;
  };
}
