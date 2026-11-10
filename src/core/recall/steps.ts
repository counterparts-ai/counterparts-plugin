/**
 * WHERE A TURN'S RECALL TIME GOES (LT2 part 1, 2026-11-09; measurement only).
 *
 * The 11-07 read had recall's p50 rising from 87 ms on lived day 40 to 206 ms
 * on day 46 with candidates flat at ~370, so the growth was in a step nobody
 * timed. A `StepClock` is a running mark: `lap(step)` charges the time since the
 * last lap to `step` and moves the mark, so consecutive laps tile the pass with
 * no gaps and no overlap, and a step lapped twice (the render, around each
 * standing lookup) sums. `performance.now()` deltas: cheap, monotonic, and read
 * by nothing that decides — the clock changes no output (the twin test in
 * `test/lt2-step-timing.test.ts`).
 *
 * The step names, in the order a turn runs them, are `STEP_NAMES`; a step that
 * did not run on a turn is absent rather than 0. Rows carry them as `steps` on
 * `recall.decision` (`recall.STEP_TIMING`, on).
 */

/** Every step a turn can name, in the order the pass runs them (NOTES, LT2). */
export const STEP_NAMES = [
  // `Counterpart#recallForTurn`, before the build (outside `elapsedMs`):
  "arrivals",
  "echo",
  "place",
  "embed",
  "primeContext",
  "compose",
  // SO1 step 4: what waits on the owner and the turn touches (`owedForTurn`).
  "owed",
  // `Recall#build` (inside `elapsedMs`):
  "gateLoad",
  "primePlan",
  "beliefs",
  "counts",
  "mood",
  "cue",
  "learned",
  "semantic",
  "rank",
  "spread",
  "prime",
  "read",
  "pointers",
  "settledOver",
  "plumbing",
  "habituation",
  "competing",
  "gate",
  "seeAlso",
  "render",
  "rest",
  // `Recall#recall`, after the build (outside `elapsedMs`):
  "record",
] as const;

export type StepName = (typeof STEP_NAMES)[number];

/** Hundredths of a millisecond: a step's size, not the clock's noise. */
const STEP_ROUND = 100;

export class StepClock {
  private last: number;
  private readonly ms = new Map<StepName, number>();
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.last = now();
  }

  /** Charge the time since the last lap to `step`, and move the mark. */
  lap(step: StepName): void {
    const t = this.now();
    this.ms.set(step, (this.ms.get(step) ?? 0) + Math.max(0, t - this.last));
    this.last = t;
  }

  /** The steps so far, in `STEP_NAMES` order, ms rounded to hundredths. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of STEP_NAMES) {
      const v = this.ms.get(name);
      if (v !== undefined) out[name] = Math.round(v * STEP_ROUND) / STEP_ROUND;
    }
    return out;
  }
}
