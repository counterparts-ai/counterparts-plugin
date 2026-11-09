/**
 * `doctor`'s `Recall steps` line (LT2 part 1, 2026-11-09): the week's median
 * ms for each step of a recall pass, largest first, read off the `steps` the
 * `recall.decision` rows carry (`core/recall/steps.ts`). The 11-07 read saw the
 * pass's p50 double in six lived days with candidates flat; this line is how
 * the growing step gets named. One bounded event read; informational, green.
 */
import { STEP_NAMES } from "../../core/recall/index.js";
import type { Store } from "../../core/store/index.js";
import { finding, num, payloadOf } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

/** How far back the line reads turns, in lived days. */
export const RECALL_STEPS_WINDOW_DAYS = 7;
/** The newest turns read at most; past it the medians are of these. */
const RECALL_STEPS_ROWS = 5_000;
/** Steps named on the line, largest median first; all of them go in `--json`. */
const RECALL_STEPS_SHOWN = 8;

/** The median, the lower middle of an even count; NaN for none. */
function p50(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1] as number;
}

function ms(x: number): string {
  return x >= 10 ? String(Math.round(x)) : x.toFixed(1);
}

export function recallStepFindings(store: Store): Finding[] {
  const byStep = new Map<string, number[]>();
  const builds: number[] = [];
  let turns = 0;
  let unread = false;
  try {
    const since = Math.max(0, store.livedDay() - RECALL_STEPS_WINDOW_DAYS);
    const rows = store.eventLog({ name: "recall.decision", sinceDay: since, order: "desc", limit: RECALL_STEPS_ROWS });
    unread = rows.length >= RECALL_STEPS_ROWS;
    for (const row of rows) {
      const p = payloadOf(row);
      const steps = p["steps"];
      if (steps === null || typeof steps !== "object") continue;
      turns += 1;
      const elapsed = num(p, "elapsedMs");
      if (elapsed !== null) builds.push(elapsed);
      for (const [name, v] of Object.entries(steps as Record<string, unknown>)) {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const list = byStep.get(name);
        if (list === undefined) byStep.set(name, [v]);
        else list.push(v);
      }
    }
  } catch {
    return [];
  }
  const window = `last ${String(RECALL_STEPS_WINDOW_DAYS)} lived days`;
  if (turns === 0) {
    return [finding("recall-steps", "green", "Recall steps", `${window}: no timed recall turns yet`, "", { turns: 0 })];
  }
  // Known steps in the pass's order, then anything a newer build named.
  const known = new Set<string>(STEP_NAMES);
  const names = [...STEP_NAMES.filter((n) => byStep.has(n)), ...[...byStep.keys()].filter((n) => !known.has(n)).sort()];
  const medians = names.map((name) => ({ name, p50: p50(byStep.get(name) ?? []) }));
  const largest = [...medians].sort((a, b) => b.p50 - a.p50 || names.indexOf(a.name) - names.indexOf(b.name)).slice(0, RECALL_STEPS_SHOWN);
  const build = p50(builds);
  const data: Record<string, string | number | boolean | null> = { turns, unread };
  if (builds.length > 0) data["elapsedMsP50"] = build;
  for (const m of medians) data[`p50.${m.name}`] = m.p50;
  return [
    finding(
      "recall-steps",
      "green",
      "Recall steps",
      `${window}, ${String(turns)} timed ${turns === 1 ? "turn" : "turns"}` +
        (builds.length > 0 ? `, whole build p50 ${ms(build)} ms` : "") +
        ` — p50 ms by step, largest first: ${largest.map((m) => `${m.name} ${ms(m.p50)}`).join(", ")}` +
        " (embed and the other steps before the build, and record after it, are outside the build's time)" +
        (unread ? `. Only the newest ${String(RECALL_STEPS_ROWS)} turns were read` : ""),
      "",
      data,
    ),
  ];
}
