import { implicitConfigRefusal, namedConfigRefusal, namedUnreadableRefusal } from "../../config-path.js";
import { openLog } from "../../log/index.js";
import { nightChildrenWords } from "../../../core/dream/index.js";
import { NIGHT_KIND_ENV, NIGHT_RUN_ENV, openNightCounterpart, readKind, runNight } from "../night-run.js";
import { isEntryPoint, pinnedScope, pinnedSession, runnerConfig, runnerConfigChoice } from "./runner.js";
async function main() {
  const choice = runnerConfigChoice();
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    process.stderr.write(`[counterparts] nightly run stood down: ${refusal}
`);
    return;
  }
  const { config, reason } = runnerConfig(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`[counterparts] nightly run stood down: ${unreadable}
`);
    return;
  }
  const run = (process.env[NIGHT_RUN_ENV] ?? "").trim();
  const session = pinnedSession();
  const log = openLog({
    dataDir: config.dataDir,
    proc: "nightly",
    session,
    ...config.timeZone === undefined ? {} : { timeZone: config.timeZone },
    observer: config.observer === true
  });
  log.start({ run: run.length > 0 ? run : null, kind: readKind(process.env[NIGHT_KIND_ENV]).kind });
  if (run.length === 0 || session === null || config.observer === true) {
    process.stderr.write(`[counterparts] nightly run stood down: no run, no session, or an observer
`);
    if (run.length > 0 && config.observer !== true)
      standDown(config, run, session ?? "", readKind(process.env[NIGHT_KIND_ENV]).kind);
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
    onEvent: log.event
  });
  log.end(out.state, {
    run: out.run,
    why: out.reason,
    detail: out.detail,
    code: out.code,
    parts: (out.parts ?? []).join(","),
    children: nightChildrenWords(out.children ?? [])
  });
}
function standDown(config, run, session, kind) {
  try {
    const c = openNightCounterpart(config);
    try {
      const now = c.store.now();
      c.dreams.recordNightRun({ run, date: c.store.today(), state: "could-not-start", kind, session, startedAt: now, endedAt: now, reason: "refused", detail: session.length === 0 ? "NO_SESSION" : "STOOD_DOWN", code: null, dream: null, reflection: null });
    } finally {
      c.close();
    }
  } catch {}
}
export function start() {
  main().then(() => process.exit(0), (err) => {
    process.stderr.write(`[counterparts] nightly run stood down: ${err instanceof Error ? err.message : String(err)}
`);
    process.exit(0);
  });
}
if (isEntryPoint(process.argv[1], import.meta.url))
  start();
