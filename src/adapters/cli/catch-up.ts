/**
 * `counterparts catch-up` (2026-10-11) — write up every ended session that was
 * never written up, now, instead of waiting for the nightly run.
 *
 * The same launcher and the same child as the night's catch-up
 * (`claude-code/night-catch-up.ts#runCatchUp`): claim-first, a runner of its
 * own (`writeup-cup_…`), a `claude -p` child per batch allowed one tool
 * (`session_end`), the same door. This process is the launcher, in the
 * foreground: it prints each batch as it is granted, waits, and prints what it
 * took and what is left. It runs while sessions are open — a session still at
 * work is not owed yet, and one another writer holds is passed over (`busy`).
 *
 * The runners' records are filed under the STORE's own directory: a catch-up
 * typed in a terminal was not started from any project, and a directory set
 * `off` must not be where its child's tools are pinned.
 */
import { CATCH_UP_TOOLS, catchUpWords, newCatchUpRunId, plannedParts, runCatchUp } from "../claude-code/night-catch-up.js";
import type { CatchUpPlan, CatchUpReport } from "../claude-code/night-catch-up.js";
import { openNightCounterpart, planNightChild } from "../claude-code/night-run.js";
import { startChild } from "../claude-code/child.js";
import type { ChildPlan, ChildResult } from "../claude-code/child.js";
import { TUNABLES } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { openLog } from "../log/index.js";

export interface CatchUpCommandInput {
  readonly config: AdapterConfig & { readonly dataDir: string };
  /** The configuration file the child's memory server reads, when one was. */
  readonly configPath?: string;
  readonly env: Record<string, string | undefined>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now: () => number;
  /** TESTS ONLY: the child's starter; absent, a real `claude -p`. */
  readonly start?: (plan: ChildPlan) => Promise<ChildResult>;
}

/** The exit: 0 when it did what it could (or there was nothing), 3 when a
 *  child failed, timed out, could not start or stopped short. */
export async function catchUpCommand(input: CatchUpCommandInput): Promise<number> {
  const { config } = input;
  const run = newCatchUpRunId();
  const scope = config.dataDir;
  const log = openLog({
    dataDir: config.dataDir,
    proc: "catch-up",
    session: null,
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    observer: config.observer === true,
    now: input.now,
  });
  log.start({ run });
  input.out(
    `Catching up on sessions that ended before they were written up, oldest first, in batches of up to ${String(TUNABLES.NIGHT_WRITE_UP_BATCH_PARTS)} parts — each a windowless claude -p allowed one tool, session_end.`,
  );
  input.out("Open sessions are fine: one still at work is left for later, and one being written up elsewhere is passed over.");
  let report: CatchUpReport | null;
  try {
    report = await runCatchUp({
      open: () => openNightCounterpart(config, log.event),
      config,
      run,
      scope,
      plan: ({ prompt, runner }) =>
        planNightChild({
          config,
          run,
          prompt,
          scope,
          session: runner,
          tools: CATCH_UP_TOOLS,
          maxTurns: TUNABLES.NIGHT_WRITE_UP_MAX_TURNS,
          timeoutMs: TUNABLES.NIGHT_WRITE_UP_MS,
          baseEnv: input.env,
          ...(input.configPath === undefined ? {} : { configPath: input.configPath }),
        }),
      start: input.start ?? ((p: ChildPlan) => startChild(p)),
      now: input.now,
      // The command's ceiling, run on purpose: four nights' worth (Mike, 2026-10-11).
      parts: TUNABLES.CATCH_UP_COMMAND_PARTS,
      onBatch: ({ batch, plan }) => input.out(batchLine(batch, plan)),
      onEvent: log.event,
    });
  } catch (err) {
    log.threw(err);
    input.err(`catch-up failed: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }
  if (report === null) {
    log.end("nothing-owed", { run });
    input.out("Nothing to catch up: every ended session is written up.");
    return 0;
  }
  log.end(report.state, { run, written: report.written, parts: report.parts, left: report.left });
  const words = catchUpWords(report);
  input.out(`${words.charAt(0).toUpperCase()}${words.slice(1)}.`);
  if (report.busy > 0 && report.state !== "none-granted") {
    input.out(`${String(report.busy)} ${report.busy === 1 ? "session was" : "sessions were"} being written up elsewhere, and left to that writer.`);
  }
  if (report.state === "done" || report.state === "none-granted") {
    if (report.limit !== null) input.out("What is left stays owed: run this again, or the nightly run takes it.");
    return 0;
  }
  input.err(
    report.state === "could-not-start"
      ? "The child could not start: is claude on your PATH and logged in? Run claude -p once by hand to see. What is owed stays owed."
      : "It stopped before the rest — a usage limit, its watchdog, or an error. What is left stays owed: run this again later, or the nightly run takes it.",
  );
  return 3;
}

/** "batch 1: 4 sessions, 12 parts (~180 KB)". */
function batchLine(batch: number, plan: CatchUpPlan): string {
  const sessions = plan.subjects.length;
  const parts = plannedParts(plan);
  const kb = Math.max(1, Math.round(plan.bytes / 1024));
  return `  batch ${String(batch)}: ${String(sessions)} ${sessions === 1 ? "session" : "sessions"}, ${String(parts)} ${parts === 1 ? "part" : "parts"} (~${String(kb)} KB)`;
}
