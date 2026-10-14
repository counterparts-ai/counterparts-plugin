import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Counterpart, RUNNER_FAILED_EVENT } from "../../../core/counterpart.js";
import { recordCoverage } from "../../../core/coverage/index.js";
import { clearIdleCarries } from "../../../core/recall/index.js";
import { RETENTION_EVENT, retentionRow, retentionRuns } from "../../../core/remember/index.js";
import { pruneRetention } from "../../../core/remember/retention.js";
import { dataDir, describeGuardRefusal } from "../../../core/store/index.js";
import { hostSessionEvidence, installedVersion, writeUpSources } from "../../sessions.js";
import { openLog } from "../../log/index.js";
import { BINARY } from "../../runtime.js";
import {
  configLine,
  defaultConfigPath,
  implicitConfigRefusal,
  namedConfigRefusal,
  namedUnreadableRefusal,
  resolveConfigPath
} from "../../config-path.js";
import { loadConfig, retentionClocks, withBudgetDefault, withEmbedderDefault } from "../../config.js";
import { openEmbedder } from "../index.js";
import { DATA_DIR_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV } from "../../spawn.js";
import { backfillVectors, laggedSemantic } from "../vectors.js";
import { removeSidebarStatus, sidebarInstalled, writeSidebarStatus } from "../../sidebar-status.js";
import { runSnapshot } from "../../snapshots.js";
export const CONFIG_PATH = defaultConfigPath();
export function runnerConfigChoice(argv = process.argv.slice(2), env = process.env) {
  return resolveConfigPath(argv, env);
}
const EMPTY_RETENTION = {
  reason: "NOTHING",
  scopes: 0,
  deleted: 0,
  keptOwed: 0,
  keptYoung: 0,
  keptLive: 0,
  failed: 0,
  lines: 0,
  bytes: 0
};
export const retentionHost = hostSessionEvidence;
export function retentionJob(input) {
  const { counterpart, date } = input;
  const emit = input.onEvent ?? (() => {});
  const none = { date, report: null, recorded: false, code: null };
  if (counterpart.observer)
    return { ...none, reason: "observer" };
  const store = counterpart.store;
  try {
    if (retentionRuns(store).some((r) => r.date === date))
      return { ...none, reason: "already-ran" };
    const sources = writeUpSources(store, input.clocks ?? {});
    const started = () => {
      try {
        store.appendEvent({
          name: RETENTION_EVENT,
          day: store.livedDay(),
          payload: retentionRow({ ...EMPTY_RETENTION, reason: "STARTED" }, date, sources),
          dedupKey: `${RETENTION_EVENT}:${date}:started`
        });
      } catch (err) {
        emit("retention.record.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
      }
    };
    const report = pruneRetention(counterpart.spans, sources, { date, onLatched: started });
    if (report.reason === "ALREADY_RAN") {
      if (!retentionRuns(store).some((r) => r.date === date)) {
        try {
          store.appendEvent({
            name: RETENTION_EVENT,
            day: store.livedDay(),
            payload: retentionRow({ ...EMPTY_RETENTION, reason: "LATCH_HELD" }, date, sources),
            dedupKey: `${RETENTION_EVENT}:${date}:held`
          });
        } catch (err) {
          emit("retention.record.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
        }
      }
      return { ...none, reason: "already-ran" };
    }
    if (report.reason === "IO_FAILED" && report.failed === 0 && report.scopes === 0) {
      return { ...none, reason: "failed", code: "LATCH_FAILED" };
    }
    let recorded = false;
    try {
      store.appendEvent({
        name: RETENTION_EVENT,
        day: store.livedDay(),
        payload: retentionRow(report, date, sources),
        dedupKey: `${RETENTION_EVENT}:${date}`
      });
      recorded = true;
    } catch (err) {
      emit("retention.record.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
    }
    emit("runner.retention", {
      reason: report.reason,
      deleted: report.deleted,
      keptOwed: report.keptOwed,
      keptYoung: report.keptYoung,
      keptLive: report.keptLive,
      failed: report.failed,
      lines: report.lines,
      recorded
    });
    return { reason: "ran", date, report, recorded, code: null };
  } catch (err) {
    const code = err !== null && typeof err === "object" && typeof err.code === "string" ? err.code : err instanceof Error ? err.name : "UNKNOWN";
    emit("retention.failed", { code });
    return { ...none, reason: "failed", code };
  }
}
export async function runOnce(input) {
  const { config } = input;
  const emit = input.onEvent ?? (() => {});
  if (config.dataDir === undefined || config.dataDir.trim().length === 0) {
    emit("runner.refused", { reason: "no-data-dir" });
    return { ran: false, reason: "no-data-dir", swept: 0, minted: 0, code: null, lag: null, backfill: null, snapshot: null, retention: null };
  }
  if (config.observer === true) {
    emit("runner.refused", { reason: "observer" });
    return { ran: false, reason: "observer", swept: 0, minted: 0, code: null, lag: null, backfill: null, snapshot: null, retention: null };
  }
  const embedder = input.embedder !== undefined ? input.embedder : openEmbedder(config, { onEvent: emit });
  const counterpart = Counterpart.open({
    dir: config.dataDir,
    ...config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir },
    ...embedder === null ? {} : { embed: embedder.embed, vectors: embedder },
    ...config.injectionBudgetBytes === undefined ? {} : { budgetBytes: config.injectionBudgetBytes },
    ...config.owner === undefined ? {} : { owner: config.owner },
    ...config.timeZone === undefined ? {} : { timeZone: config.timeZone },
    build: input.build === undefined ? installedVersion() : input.build,
    onEvent: (e) => emit(e.name, { ...e.data ?? {} })
  });
  const today = input.date ?? counterpart.store.today();
  let lag = null;
  let backfill = null;
  try {
    if (input.session !== undefined && input.session.length > 0 && input.scope !== undefined && input.scope.length > 0) {
      lag = await laggedSemantic({
        counterpart,
        sessionId: input.session,
        scope: input.scope,
        embedder,
        onEvent: emit
      });
    }
    backfill = await backfillVectors({ counterpart, embedder, onEvent: emit });
  } catch (err) {
    const code = err instanceof Error ? err.name : "UNKNOWN";
    emit("vectors.failed", { code });
    noteFailure(counterpart, emit, code, "vectors", today);
  }
  let snapshotReport = null;
  let retentionReport = null;
  let result;
  try {
    const report = await counterpart.sessionEnd({
      date: today,
      at: today,
      sweep: { skipped: "not-opted-in" },
      ...input.session === undefined ? {} : { session: input.session }
    });
    const swept = report.sweeps.reduce((n, s) => n + s.spansSwept, 0);
    const minted = report.sweeps.reduce((n, s) => n + s.proposals, 0);
    emit("runner.done", {
      day: report.cycle.day,
      scopes: report.sweeps.length,
      swept,
      minted,
      edges: report.edges.reason,
      carried: report.carried?.reason ?? "threw",
      carriedRows: report.carried?.rows ?? 0,
      sweep: "next-session"
    });
    try {
      const wake = counterpart.refreshWake({ at: today });
      if (wake.reason !== "current")
        emit("runner.wake", { reason: wake.reason, triggers: wake.triggers.join(","), bytes: wake.bytes });
    } catch (err) {
      noteFailure(counterpart, emit, err instanceof Error ? err.name : "UNKNOWN", "wake", today);
    }
    result = { ran: true, reason: "ran", swept, minted, code: null, lag, backfill, snapshot: null, retention: null };
  } catch (err) {
    const code = err !== null && typeof err === "object" && typeof err.code === "string" ? err.code : "UNKNOWN";
    emit("runner.failed", { code });
    noteFailure(counterpart, emit, code, "sessionEnd", today);
    result = { ran: false, reason: "failed", swept: 0, minted: 0, code, lag, backfill, snapshot: null, retention: null };
  } finally {
    try {
      const host = hostSessionEvidence(counterpart.store);
      const covered = recordCoverage(counterpart.spans, counterpart.store, {
        now: counterpart.store.now(),
        zone: counterpart.store.zone(),
        host: (s) => ({ endedAt: host(s).endedAt })
      });
      emit("runner.coverage", { ...covered });
    } catch (err) {
      emit("coverage.threw", { code: err instanceof Error ? err.name : "UNKNOWN" });
    }
    try {
      retentionReport = retentionJob({ counterpart, date: today, clocks: retentionClocks(config), onEvent: emit });
      if (retentionReport.reason === "failed") {
        noteFailure(counterpart, emit, retentionReport.code ?? "UNKNOWN", "retention", today);
      }
    } catch (err) {
      emit("retention.threw", { code: err instanceof Error ? err.name : "UNKNOWN" });
    }
    try {
      const cleared = clearIdleCarries(counterpart.store, retentionClocks(config).maxMs);
      if (cleared > 0)
        emit("runner.carries", { cleared });
    } catch (err) {
      emit("carries.threw", { code: err instanceof Error ? err.name : "UNKNOWN" });
    }
    try {
      snapshotReport = runSnapshot({
        counterpart,
        dataDir: config.dataDir,
        ...config.snapshots === undefined ? {} : { config: config.snapshots },
        date: today,
        ...input.signal === undefined ? {} : { signal: input.signal }
      });
      emit("runner.snapshot", {
        reason: snapshotReport.reason,
        name: snapshotReport.name,
        kept: snapshotReport.rotation?.kept ?? 0,
        deleted: snapshotReport.rotation?.deleted.length ?? 0,
        ms: snapshotReport.ms
      });
    } catch (err) {
      emit("snapshot.threw", { code: err instanceof Error ? err.name : "UNKNOWN" });
    }
    counterpart.close();
  }
  let sidebar;
  if (input.sidebarConfigPath !== undefined && input.sidebarConfigPath.length > 0) {
    sidebar = writeSidebarStatus({
      configPath: input.sidebarConfigPath,
      dataDir: config.dataDir,
      ...config.timeZone === undefined ? {} : { timeZone: config.timeZone }
    });
    emit("runner.sidebar", { written: sidebar.written, reason: sidebar.reason, bytes: sidebar.bytes, ms: sidebar.ms });
  }
  return { ...result, snapshot: snapshotReport, retention: retentionReport, ...sidebar === undefined ? {} : { sidebar } };
}
function noteFailure(counterpart, emit, code, step, date) {
  if (counterpart.observer)
    return;
  try {
    counterpart.noteAdapterEvent(RUNNER_FAILED_EVENT, { code, step, date }, { dedupKey: `${RUNNER_FAILED_EVENT}:${step}:${date}` });
  } catch (err) {
    emit("runner.record.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
  }
}
export function watchdogMs(env = process.env) {
  const raw = env[WATCHDOG_ENV];
  if (raw === undefined)
    return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
export function pinnedDataDir(env = process.env) {
  const raw = env[DATA_DIR_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}
export function pinnedSession(env = process.env) {
  const raw = env[SESSION_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}
export function pinnedScope(env = process.env) {
  const raw = env[SCOPE_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}
export function isEntryPoint(argv1, url, binary = BINARY) {
  if (argv1 === undefined || binary !== null)
    return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}
export function runnerConfig(path = CONFIG_PATH, env = process.env) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    raw = undefined;
  }
  const loaded = loadConfig(raw);
  const pinned = pinnedDataDir(env);
  return {
    config: withBudgetDefault(withEmbedderDefault({
      ...loaded.config,
      dataDir: pinned ?? loaded.config.dataDir ?? dataDir()
    })),
    reason: loaded.reason
  };
}
async function main() {
  const choice = runnerConfigChoice();
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    process.stderr.write(`[counterparts] worker stood down: ${refusal}
`);
    return;
  }
  const { config, reason } = runnerConfig(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`[counterparts] worker stood down: ${unreadable}
`);
    return;
  }
  process.stderr.write(`[counterparts] worker config: ${configLine(choice)}
`);
  const timeout = watchdogMs();
  const controller = new AbortController;
  const timer = timeout === null ? null : setTimeout(() => {
    controller.abort();
  }, timeout);
  timer?.unref?.();
  const log = openLog({
    dataDir: config.dataDir,
    proc: "worker",
    session: pinnedSession(),
    ...config.timeZone === undefined ? {} : { timeZone: config.timeZone },
    observer: config.observer === true
  });
  log.start();
  const sidebarWanted = sidebarInstalled(process.env, homedir());
  if (!sidebarWanted && removeSidebarStatus(choice.path))
    log.event({ name: "runner.sidebar", data: { removed: true } });
  try {
    const report = await runOnce({
      config,
      signal: controller.signal,
      ...pinnedSession() === null ? {} : { session: pinnedSession() },
      ...pinnedScope() === null ? {} : { scope: pinnedScope() },
      ...sidebarWanted ? { sidebarConfigPath: choice.path } : {},
      onEvent: (name, data) => log.event({ name, data })
    });
    log.end(report.reason, { swept: report.swept, minted: report.minted, code: report.code });
  } catch (err) {
    log.threw(err);
    throw err;
  } finally {
    if (timer !== null)
      clearTimeout(timer);
  }
}
export function start() {
  main().then(() => process.exit(0), (err) => {
    const detail = err instanceof Error ? err.message : String(err);
    const remedy = `Set "dataDir" in ${runnerConfigChoice().path}, or set ${DATA_DIR_ENV}.`;
    process.stderr.write(`[counterparts] worker stood down: ${describeGuardRefusal(err, remedy) ?? detail}
`);
    process.exit(0);
  });
}
if (isEntryPoint(process.argv[1], import.meta.url))
  start();
