import { CATCH_UP_RUN_PREFIX, CATCH_UP_TOOLS, catchUpWords, newCatchUpRunId, plannedParts, runCatchUp } from "../claude-code/night-catch-up.js";
import { applyReowe, reoweLine, reowePlan } from "../claude-code/reowe.js";
import { typed } from "./ui.js";
import { openNightCounterpart, planNightChild } from "../claude-code/night-run.js";
import { startChild } from "../claude-code/child.js";
import { TUNABLES } from "../config.js";
import { openLog } from "../log/index.js";
export async function catchUpCommand(input) {
  const { config } = input;
  const run = newCatchUpRunId();
  const scope = config.dataDir;
  const log = openLog({
    dataDir: config.dataDir,
    proc: "catch-up",
    session: null,
    ...config.timeZone === undefined ? {} : { timeZone: config.timeZone },
    observer: config.observer === true,
    now: input.now
  });
  log.start({ run });
  input.out(`Catching up on sessions that ended before they were written up, oldest first, in batches of up to ${String(TUNABLES.NIGHT_WRITE_UP_BATCH_PARTS)} parts — each a windowless claude -p allowed one tool, session_end.`);
  input.out("Open sessions are fine: one still at work is left for later, and one being written up elsewhere is passed over.");
  let report;
  try {
    report = await runCatchUp({
      open: () => openNightCounterpart(config, log.event),
      config,
      run,
      scope,
      plan: ({ prompt, runner }) => planNightChild({
        config,
        run,
        prompt,
        scope,
        session: runner,
        tools: CATCH_UP_TOOLS,
        maxTurns: TUNABLES.NIGHT_WRITE_UP_MAX_TURNS,
        timeoutMs: TUNABLES.NIGHT_WRITE_UP_MS,
        baseEnv: input.env,
        ...input.configPath === undefined ? {} : { configPath: input.configPath }
      }),
      start: input.start ?? ((p) => startChild(p)),
      now: input.now,
      parts: TUNABLES.CATCH_UP_COMMAND_PARTS,
      onBatch: ({ batch, plan }) => input.out(batchLine(batch, plan)),
      onEvent: log.event
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
    if (report.limit !== null)
      input.out("What is left stays owed: run this again, or the nightly run takes it.");
    return 0;
  }
  input.err(report.state === "could-not-start" ? "The child could not start: is claude on your PATH and logged in? Run claude -p once by hand to see. What is owed stays owed." : "It stopped before the rest — a usage limit, its watchdog, or an error. What is left stays owed: run this again later, or the nightly run takes it.");
  return 3;
}
export async function reoweCommand(input) {
  const { io } = input;
  const run = input.run;
  if (typeof run !== "string" || !run.startsWith(CATCH_UP_RUN_PREFIX) && !run.startsWith("nrn_")) {
    io.err(`usage: counterparts catch-up --reowe <run> — a run's id, cup_… (counterparts catch-up) or nrn_… (the nightly run), as doctor and the log name it.`);
    return 1;
  }
  const c = openNightCounterpart(input.config);
  try {
    const plan = reowePlan(c, run, input.now());
    if (!plan.found) {
      io.err(`refused: the log holds no write-up answers of ${run}. It keeps a week (sessions/log/), so a run older than that, one that wrote nothing, or another store's run cannot be re-owed from here.`);
      return 2;
    }
    if (plan.subjects.length === 0) {
      io.out(`${run}: every part it closed brought memories back. Nothing to re-owe.`);
      return 0;
    }
    io.out(`${run}, which began ${new Date(plan.startedAt ?? 0).toISOString()}:`);
    for (const s of plan.subjects)
      io.out(reoweLine(s));
    const todo = plan.subjects.filter((s) => s.status === "reowe");
    const refused = plan.subjects.some((s) => s.status !== "reowe" && s.status !== "nothing-to-reowe");
    if (todo.length === 0) {
      io.out(refused ? "Nothing was changed." : "Nothing to re-owe: every part it closed with nothing kept was written up before the run began.");
      return refused ? 2 : 0;
    }
    if (input.dryRun) {
      io.out("Dry run: nothing was changed.");
      return 0;
    }
    if (!input.yes) {
      if (io.prompt === undefined) {
        io.err("refused: this is not an interactive console and nothing was confirmed. Pass --yes if that is what you mean.");
        return 2;
      }
      const said = await typed(io, run, `Type the run's id to owe those parts again [${run}] — Esc or "cancel" to stop: `);
      if (said === "cancelled") {
        io.out("Cancelled. Nothing was changed.");
        return 0;
      }
      if (said !== "typed") {
        io.err("refused: the confirmation did not match. Nothing was changed.");
        return 2;
      }
    }
    const moved = applyReowe(c, plan, input.now());
    io.out(moved.length === 0 ? "Nothing moved: a writer took those sessions, or moved past them, since the plan was read." : `Owed again: ${moved.join(", ")}. The next catch-up (this command, or the nightly run) reads those parts.`);
    return refused || moved.length < todo.length ? 2 : 0;
  } finally {
    c.close();
  }
}
function batchLine(batch, plan) {
  const sessions = plan.subjects.length;
  const parts = plannedParts(plan);
  const kb = Math.max(1, Math.round(plan.bytes / 1024));
  return `  batch ${String(batch)}: ${String(sessions)} ${sessions === 1 ? "session" : "sessions"}, ${String(parts)} ${parts === 1 ? "part" : "parts"} (~${String(kb)} KB)`;
}
