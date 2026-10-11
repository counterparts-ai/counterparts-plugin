#!/usr/bin/env bun
/**
 * THE HEADLESS NIGHTLY RUN'S OWN PROCESS (2026-09-29) — started DETACHED by the
 * hook when the dreaming setting is `auto` (`night-run.ts#planNightRunner`),
 * with a pinned environment: the data dir and configuration the hook read, the
 * session the run is attributed to and its directory, the run's id and what it
 * is (`NIGHT_RUN_ENV`, `NIGHT_KIND_ENV`).
 *
 * It composes the launch prompt from the store, starts `claude -p` with it on
 * stdin, waits under the run's watchdog, and records what became of the run —
 * then exits 0 on every path. Nothing about a failed run may reach the host;
 * the ROW is how the next session hears of it.
 */
import { implicitConfigRefusal, namedConfigRefusal, namedUnreadableRefusal } from "../../config-path.js";
import { openLog } from "../../log/index.js";

import { NIGHT_KIND_ENV, NIGHT_RUN_ENV, openNightCounterpart, readKind, runNight } from "../night-run.js";
import { isEntryPoint, pinnedScope, pinnedSession, runnerConfig, runnerConfigChoice } from "./runner.js";

async function main(): Promise<void> {
  const choice = runnerConfigChoice();
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    process.stderr.write(`[counterparts] nightly run stood down: ${refusal}\n`);
    return;
  }
  const { config, reason } = runnerConfig(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`[counterparts] nightly run stood down: ${unreadable}\n`);
    return;
  }
  const run = (process.env[NIGHT_RUN_ENV] ?? "").trim();
  const session = pinnedSession();
  // THE PROCESS LOG (`adapters/log/`): this process's stdio is discarded, so
  // its start, its end and the run's state are written here.
  const log = openLog({
    dataDir: config.dataDir,
    proc: "nightly",
    session,
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    observer: config.observer === true,
  });
  log.start({ run: run.length > 0 ? run : null, kind: readKind(process.env[NIGHT_KIND_ENV]).kind });
  if (run.length === 0 || session === null || config.observer === true) {
    process.stderr.write("[counterparts] nightly run stood down: no run, no session, or an observer\n");
    // SAID WHERE IT CAN BE (review of #282, finding 4): a run the hook started
    // and this process will not carry is recorded `could-not-start`, so the
    // next prompt asks instead of waiting on a row that stays `started`.
    if (run.length > 0 && config.observer !== true) standDown(config, run, session ?? "", readKind(process.env[NIGHT_KIND_ENV]).kind);
    log.end("stood-down", { run: run.length > 0 ? run : null });
    return;
  }
  const out = await runNight({
    open: () => openNightCounterpart(config, log.event),
    config,
    run,
    session,
    scope: pinnedScope() ?? "",
    kind: readKind(process.env[NIGHT_KIND_ENV]),
    configPath: choice.path,
    onEvent: log.event,
  });
  log.end(out.state, {
    run: out.run,
    why: out.reason,
    detail: out.detail,
    code: out.code,
    parts: (out.parts ?? []).join(","),
  });
}

/** One `could-not-start` row for a run this process stood down from. Never throws. */
function standDown(config: Parameters<typeof openNightCounterpart>[0], run: string, session: string, kind: "night" | "reflection"): void {
  try {
    const c = openNightCounterpart(config);
    try {
      const now = c.store.now();
      c.dreams.recordNightRun({ run, date: c.store.today(), state: "could-not-start", kind, session, startedAt: now, endedAt: now, reason: "refused", detail: session.length === 0 ? "NO_SESSION" : "STOOD_DOWN", code: null, dream: null, reflection: null });
    } finally {
      c.close();
    }
  } catch {
    /* a store that will not open: the row stays `started` and reads as lost later */
  }
}

/** The nightly run, then exit — what this file does as a script, and what the
 *  single binary's `nightly` mode calls. */
export function start(): void {
  void main().then(
    () => process.exit(0),
    (err: unknown) => {
      process.stderr.write(`[counterparts] nightly run stood down: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(0);
    },
  );
}

if (isEntryPoint(process.argv[1], import.meta.url)) start();
