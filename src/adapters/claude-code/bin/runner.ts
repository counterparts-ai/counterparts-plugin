#!/usr/bin/env bun
/**
 * The detached worker — everything the foreground hook refused to wait for.
 *
 * Started by `spawn.ts` with a pinned environment (`COUNTERPARTS_DATA_DIR` last)
 * and a watchdog it is TOLD about (`COUNTERPARTS_WATCHDOG_MS`), so the timeout
 * that guards this process is the same number the spawner validated against
 * `remember/`'s claim-staleness window. It arms that watchdog itself as well as
 * being subject to the parent's, because a child that hangs past the window can
 * hold spans a second run would also claim (scars E4/E5, SEAMS queued item 10).
 *
 * What it runs, in order (the composition root owns the order, not this file):
 *   0a. the LAGGED SEMANTIC CUE for the session that just spoke — before
 *       anything else, because it reads the live span buffer and the sweep's
 *       claim moves those spans out of it (`vectors.ts`). It runs on EVERY
 *       boundary, outside the sweep gate and regardless of its verdict: the cue
 *       expires after one turn, so a step that fired only when a session had
 *       crashed would leave the semantic channel dark on every ordinary turn;
 *   0b. one bounded EMBEDDING BACKFILL, on the same terms and for the same
 *       reason — the store's blind memories gain vectors at a guaranteed rate
 *       rather than only when a deposit happens to pay for one, and running it
 *       first means a long sweep cannot starve it;
 *   1. the crash-fallback sweep's GATE, over EVERY scope holding experience (§2 G9) —
 *      which SELECTS NOTHING unless a session actually crashed (uncovered spans,
 *      no `session-end` boundary, silent for `CRASH_STALE_MS`). This worker is
 *      spawned at every boundary for the flush and the cycle below; the sweep is
 *      a fallback and its ordinary answer is "nothing crashed", recorded as the
 *      durable `sweep.gate` row so the silence is evidenced (owner ruling
 *      2026-09-04, `remember/fallback.ts`);
 *   2. the Hebbian flush;
 *   3. the sleep cycle, whose last content write is the wake briefing;
 *   3a. the wake's catch-up (2026-09-30): re-rendered again when the page was
 *      written or a write-up landed since its last render (`refreshWake`);
 *   3b. WHAT IS NOT WRITTEN UP (2026-09-30): the coverage ledger's rows — a
 *      stretch owed, written up, lapsed — one per stretch per state
 *      (`core/coverage/`);
 *   3c. RAW TRANSCRIPT RETENTION (owner's ruling 2026-09-23): once per date —
 *      behind an `O_EXCL` latch under `spans/retention/` — a session's captured
 *      text is deleted 7 days after it ended when it owes no write-up and the
 *      registry does not hold it open (`remember/owes.ts` decides,
 *      `remember/retention.ts` deletes, and this file is the only one that may
 *      import the second), and one `remember.prune` row says what was deleted,
 *      what is waiting on a write-up, what is younger than a week and what is
 *      still open. Keyless, like every step but the sweep. BEFORE the snapshot on
 *      purpose: raw text in every backup is the reason it exists;
 *   4. the DAILY ROTATING SNAPSHOT (`adapters/snapshots.ts`), last and outside
 *      the cycle. Last because it copies the state the three steps above just
 *      left; outside because sleep must not learn that the floor is changing —
 *      it is not a `core/sleep/` phase and never becomes one. It runs in the
 *      `finally` below, so a boundary that FAILED still gets its copy: the day
 *      the worker breaks is the day a backup is worth most.
 *
 * **THE SWEEP NEVER INTERPRETS HERE** (keyless, owner 2026-09-24). It was an
 * opt-in that sent a crashed session's words to the Anthropic API; that path
 * was removed with the key. A session that ended before it was written up is
 * written up by the NEXT session in its project, at SessionStart, and step 1
 * records its gate row (`reason: "not-opted-in"`) and does nothing else.
 *
 * **IT DEGRADES, STEP BY STEP; IT DOES NOT REFUSE** (I32, 2026-09-11). Each
 * step asks its own question and records its own answer by name — the vector
 * steps' are `embedder-off` / `embedder-unavailable` — so a step that cannot
 * run says so where tomorrow can read it, and the others still run.
 *
 * It exits 0 on every path. Nothing about a failed run may reach the host.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart, RUNNER_FAILED_EVENT } from "../../../core/counterpart.js";
import { recordCoverage } from "../../../core/coverage/index.js";
import { RETENTION_EVENT, retentionRow, retentionRuns } from "../../../core/remember/index.js";
import type { HostSessionEvidence, RetentionReport } from "../../../core/remember/index.js";
// THE DELETING HALF, by path, and from this file alone (PR #189 review, B1):
// `remember/index.ts` does not re-export it, and `test/cli.test.ts` pins every
// importer — nothing that holds a `Counterpart` can reach it.
import { pruneRetention } from "../../../core/remember/retention.js";
import { dataDir, describeGuardRefusal } from "../../../core/store/index.js";
import type { Store } from "../../../core/store/index.js";
import { hostSessionEvidence, installedVersion, writeUpSources } from "../../sessions.js";
import { openLog } from "../../log/index.js";
import { BINARY } from "../../runtime.js";
import type { Binary } from "../../runtime.js";

import {
  configLine,
  defaultConfigPath,
  implicitConfigRefusal,
  namedConfigRefusal,
  namedUnreadableRefusal,
  resolveConfigPath,
} from "../../config-path.js";
import type { ConfigChoice } from "../../config-path.js";

import { loadConfig, withEmbedderDefault } from "../../config.js";
import type { AdapterConfig } from "../../config.js";
import { openEmbedder } from "../index.js";
import type { LiveEmbedder } from "../embed-client.js";
import { DATA_DIR_ENV, SCOPE_ENV, SESSION_ENV, WATCHDOG_ENV } from "../../spawn.js";
import { backfillVectors, laggedSemantic } from "../vectors.js";
import type { BackfillReport, LagReport } from "../vectors.js";
import { runSnapshot } from "../../snapshots.js";
import type { SnapshotRunReport } from "../../snapshots.js";

/**
 * The default, unchanged: the same file the hook reads when nobody says
 * otherwise. `--config <absolute path>` and the `COUNTERPARTS_CONFIG` the
 * spawner pins override it in that order (`adapters/config-path.ts`).
 */
export const CONFIG_PATH = defaultConfigPath();

/**
 * Which configuration this worker will read, and which rule chose it. Exported
 * and injectable so the pinned case — the only one a hook produces — is provable
 * without a process.
 */
export function runnerConfigChoice(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ConfigChoice {
  return resolveConfigPath(argv, env as Record<string, string | undefined>);
}

export interface RunReport {
  readonly ran: boolean;
  /** `ran` covers the keyless run too: the day HAPPENED, minus the sweep. The
   *  step that did not is named on the durable `sweep.gate` row, not here. */
  readonly reason: "ran" | "no-data-dir" | "observer" | "failed";
  readonly swept: number;
  readonly minted: number;
  readonly code: string | null;
  /** The next turn's semantic cue, and the vectors this run bought. Null when
   *  the run refused before reaching them. */
  readonly lag: LagReport | null;
  readonly backfill: BackfillReport | null;
  /** The day's copy of the store, or what stopped it. Null when the run refused
   *  before it opened a store at all. */
  readonly snapshot: SnapshotRunReport | null;
  /** The day's retention pass, or why it did not run. Null when the run refused
   *  before it opened a store at all. */
  readonly retention: RetentionJobReport | null;
}

/** What the retention step came to on one worker run. */
export interface RetentionJobReport {
  /** `ran` — it planned and pruned (possibly nothing); `already-ran` — this
   *  date's row exists, or another worker holds this date's latch, so this run
   *  did nothing; `observer` / `failed` — named. */
  readonly reason: "ran" | "already-ran" | "observer" | "failed";
  readonly date: string;
  readonly report: RetentionReport | null;
  /** Whether the `remember.prune` row landed. */
  readonly recorded: boolean;
  readonly code: string | null;
}

/** A run's counts before it has counted anything — the `STARTED` and
 *  `LATCH_HELD` rows carry these. */
const EMPTY_RETENTION: RetentionReport = {
  reason: "NOTHING",
  scopes: 0,
  deleted: 0,
  keptOwed: 0,
  keptYoung: 0,
  keptLive: 0,
  failed: 0,
  lines: 0,
  bytes: 0,
};

/**
 * WHAT THIS HOST KNOWS ABOUT A SESSION, for `remember/owes.ts` — now defined
 * once in `adapters/sessions.ts#hostSessionEvidence` (C2), because the
 * SessionStart write-up ask and the MCP write-up door read the same facts this
 * pass does, and neither of them may import this file. The old name stays.
 */
export const retentionHost: (store: Store) => (session: string) => HostSessionEvidence = hostSessionEvidence;

/**
 * THE RETENTION STEP — once per calendar date, keyless, and it never throws.
 *
 * ONCE PER DATE because the worker runs at every boundary and the rule is
 * measured in days. Two latches: this date's `remember.prune` row (the cheap
 * check), and beneath it the one that is atomic — `retention.ts` creates
 * `spans/retention/<date>.latch` with `O_EXCL` before it plans or deletes
 * anything, so two workers racing past the row check cannot both prune (PR
 * #189 review, m6). A run that FAILED leaves its row with `failed` counted and
 * is retried the next date: sessions it could not delete stay due. The date is
 * the worker's run date, which is UTC like every date this worker stamps — so
 * for a Pacific owner the pass happens at the first boundary after 17:00 local
 * (review n1, named rather than moved).
 *
 * What it may delete is decided by `remember/owes.ts` and nothing here: the
 * coverage ledger (`core/coverage/`) and this host's registry
 * (`retentionHost`) are the facts, and a session that owes a write-up, or that
 * the registry holds open, is never in any request.
 */
export function retentionJob(input: {
  counterpart: Counterpart;
  date: string;
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}): RetentionJobReport {
  const { counterpart, date } = input;
  const emit = input.onEvent ?? ((): void => {});
  const none = { date, report: null, recorded: false, code: null } as const;
  if (counterpart.observer) return { ...none, reason: "observer" };
  const store = counterpart.store;
  try {
    if (retentionRuns(store).some((r) => r.date === date)) return { ...none, reason: "already-ran" };
    // THE SAME SOURCES THE WRITE-UP READS (`sessions.ts#writeUpSources`), so
    // what this pass keeps as owed and what the next session is asked to write
    // up are one set, by construction rather than by two copies agreeing.
    const sources = writeUpSources(store);
    // THE DATE IS VISIBLE FROM THE MOMENT IT IS HELD (re-review R7): a
    // `STARTED` row goes in as soon as the latch is taken, before anything is
    // planned, so a run the watchdog kills halfway leaves "started, never
    // finished" rather than a date that is spent and silent.
    const started = (): void => {
      try {
        store.appendEvent({
          name: RETENTION_EVENT,
          day: store.livedDay(),
          payload: retentionRow({ ...EMPTY_RETENTION, reason: "STARTED" }, date),
          dedupKey: `${RETENTION_EVENT}:${date}:started`,
        });
      } catch (err) {
        emit("retention.record.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
      }
    };
    const report = pruneRetention(counterpart.spans, sources, { date, onLatched: started });
    if (report.reason === "ALREADY_RAN") {
      // Held, and still no row for the date at all: a run died between taking
      // the latch and writing its first row. Say so, once.
      if (!retentionRuns(store).some((r) => r.date === date)) {
        try {
          store.appendEvent({
            name: RETENTION_EVENT,
            day: store.livedDay(),
            payload: retentionRow({ ...EMPTY_RETENTION, reason: "LATCH_HELD" }, date),
            dedupKey: `${RETENTION_EVENT}:${date}:held`,
          });
        } catch (err) {
          emit("retention.record.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
        }
      }
      return { ...none, reason: "already-ran" };
    }
    // The latch itself would not take (an unwritable `spans/`): nothing was
    // planned or deleted, and no row is written, so the next worker today tries
    // again rather than finding the date spent.
    if (report.reason === "IO_FAILED" && report.failed === 0 && report.scopes === 0) {
      return { ...none, reason: "failed", code: "LATCH_FAILED" };
    }
    let recorded = false;
    try {
      store.appendEvent({
        name: RETENTION_EVENT,
        day: store.livedDay(),
        payload: retentionRow(report, date),
        dedupKey: `${RETENTION_EVENT}:${date}`,
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
      recorded,
    });
    return { reason: "ran", date, report, recorded, code: null };
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : err instanceof Error
          ? err.name
          : "UNKNOWN";
    emit("retention.failed", { code });
    return { ...none, reason: "failed", code };
  }
}

/**
 * One run. Exported and injectable so the whole worker is testable without a
 * process, a socket, or a real data directory.
 */
export async function runOnce(input: {
  config: AdapterConfig;
  date?: string;
  signal?: AbortSignal;
  /** The session this run follows, and its scope — pinned onto the child by the
   *  spawner (`SESSION_ENV` / `SCOPE_ENV`). Absent ⇒ no lagged cue is computed
   *  and none is claimed: a run nobody bound to a session has nobody to cue. */
  session?: string;
  scope?: string;
  /** Injected so the whole vector path is provable without the weights. */
  embedder?: LiveEmbedder | null;
  /** The package version this run is, for the wake's build stamp. Absent: the
   *  installed manifest's (`installedVersion`). Injected so a test can be an upgrade. */
  build?: string | null;
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}): Promise<RunReport> {
  const { config } = input;
  const emit = input.onEvent ?? ((): void => {});
  if (config.dataDir === undefined || config.dataDir.trim().length === 0) {
    emit("runner.refused", { reason: "no-data-dir" });
    return { ran: false, reason: "no-data-dir", swept: 0, minted: 0, code: null, lag: null, backfill: null, snapshot: null, retention: null };
  }
  if (config.observer === true) {
    // A cycle advances the clock, decays the store and rewrites the briefing:
    // the instrument mutating what it measures (§15 G3).
    emit("runner.refused", { reason: "observer" });
    return { ran: false, reason: "observer", swept: 0, minted: 0, code: null, lag: null, backfill: null, snapshot: null, retention: null };
  }

  // The embedder, when it is on. This is the composition root that backfills,
  // so an embedder wired only into `openAdapter` would be one the memories
  // never meet.
  const embedder = input.embedder !== undefined ? input.embedder : openEmbedder(config, { onEvent: emit });

  const counterpart = Counterpart.open({
    dir: config.dataDir,
    ...(config.snapshots?.dir === undefined ? {} : { snapshotsDir: config.snapshots.dir }),
    ...(embedder === null ? {} : { embed: embedder.embed, vectors: embedder }),
    ...(config.injectionBudgetBytes === undefined
      ? {}
      : { budgetBytes: config.injectionBudgetBytes }),
    ...(config.owner === undefined ? {} : { owner: config.owner }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    // The build stamps the wake it publishes, and a wake another build
    // published is re-rendered at step 3a (`version`, 2026-10-02).
    build: input.build === undefined ? installedVersion() : input.build,
    onEvent: (e) => emit(e.name, { ...(e.data ?? {}) }),
  });
  // ONE DATE FOR THE WHOLE RUN, resolved before the first step that could
  // record anything. The `sweep.gate` row carries it; so must every failure row,
  // or a replay with a pinned date would dedup against the wall clock instead.
  // The person's day, in the store's zone (docs/time.md; UTC before 2026-09-25).
  const today = input.date ?? counterpart.store.today();

  let lag: LagReport | null = null;
  let backfill: BackfillReport | null = null;
  try {
    // 0a. BEFORE THE SWEEP. The cue is read out of the LIVE span buffer and the
    // sweep's claim moves those spans out of it — run this after `sessionEnd`
    // and the session that just spoke has nothing left to be cued from.
    // BOTH or neither: a data dir is not a scope, and guessing one would look
    // in the wrong span stream and report `no-text` for a session that spoke.
    if (
      input.session !== undefined &&
      input.session.length > 0 &&
      input.scope !== undefined &&
      input.scope.length > 0
    ) {
      lag = await laggedSemantic({
        counterpart,
        sessionId: input.session,
        scope: input.scope,
        embedder,
        onEvent: emit,
      });
    }
    // 0b. One bounded batch, before the variable-length sweep, so a long sweep
    // (or the watchdog that ends one) cannot starve the store's blind memories.
    backfill = await backfillVectors({ counterpart, embedder, onEvent: emit });
  } catch (err) {
    // Neither step may cost the run. A cue is a nicety; the sweep is the day.
    const code = err instanceof Error ? err.name : "UNKNOWN";
    emit("vectors.failed", { code });
    // DURABLE, now that the counterpart is open (I32): a vector step that failed
    // inside a detached process wrote to a ring that nothing ever read, and
    // stdio is ignored on this path by construction.
    noteFailure(counterpart, emit, code, "vectors", today);
  }

  // Step 4's answer, filled in the `finally` below and joined to whichever of
  // the two results the boundary produced. A `let` rather than a fourth return
  // arm because the copy must happen on BOTH paths and before `close()`.
  let snapshotReport: SnapshotRunReport | null = null;
  let retentionReport: RetentionJobReport | null = null;
  let result: RunReport;
  try {
    // NO INTERPRETER, EVER (keyless, 2026-09-24). The sweep is told "skipped"
    // and records its gate row; a session that ended before it was written up
    // is the next session's to write up, and everything else still runs.
    const report = await counterpart.sessionEnd({
      date: today,
      at: today,
      sweep: { skipped: "not-opted-in" },
      // Whose boundary this is, for the `associate.flush` rows (2026-10-11).
      ...(input.session === undefined ? {} : { session: input.session }),
    });
    const swept = report.sweeps.reduce((n, s) => n + s.spansSwept, 0);
    const minted = report.sweeps.reduce((n, s) => n + s.proposals, 0);
    emit("runner.done", {
      day: report.cycle.day,
      scopes: report.sweeps.length,
      swept,
      minted,
      edges: report.edges.reason,
      // What this run carried in from the hooks' pending file — the host's own
      // learned association, which no hook writes any more.
      carried: report.carried?.reason ?? "threw",
      carriedRows: report.carried?.rows ?? 0,
      sweep: "next-session",
    });
    // 3a. THE WAKE CATCHES UP (2026-09-30): a page written, a memory or a
    // write-up accepted, or a handoff changed (2026-10-10) since the last
    // render re-renders it now, not at the next lived day. After the cycle, whose own render already caught up to what was
    // marked before it; nothing marked, nothing rendered.
    // Its own try: a render that fails costs the refresh, and the mark stays.
    try {
      const wake = counterpart.refreshWake({ at: today });
      if (wake.reason !== "current") emit("runner.wake", { reason: wake.reason, triggers: wake.triggers.join(","), bytes: wake.bytes });
    } catch (err) {
      noteFailure(counterpart, emit, err instanceof Error ? err.name : "UNKNOWN", "wake", today);
    }
    result = { ran: true, reason: "ran", swept, minted, code: null, lag, backfill, snapshot: null, retention: null };
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "UNKNOWN";
    emit("runner.failed", { code });
    // Durable before `close()` in the `finally` below — a worker that died at
    // the boundary is the failure a person most needs to be able to read
    // tomorrow, and this process's stderr goes nowhere (I32).
    noteFailure(counterpart, emit, code, "sessionEnd", today);
    result = { ran: false, reason: "failed", swept: 0, minted: 0, code, lag, backfill, snapshot: null, retention: null };
  } finally {
    // 3b. WHAT IS NOT WRITTEN UP (2026-09-30, `core/coverage/`): one row per
    // stretch per state — owed, written up, lapsed — at every turn-end, keyless.
    // Before retention, so a lapse is recorded while its pieces are there to
    // count. Its own try: a ledger that will not read may not cost the rest.
    try {
      const host = hostSessionEvidence(counterpart.store);
      const covered = recordCoverage(counterpart.spans, counterpart.store, {
        now: counterpart.store.now(),
        zone: counterpart.store.zone(),
        host: (s) => ({ endedAt: host(s).endedAt }),
      });
      emit("runner.coverage", { ...covered });
    } catch (err) {
      emit("coverage.threw", { code: err instanceof Error ? err.name : "UNKNOWN" });
    }
    // 3c. RETENTION — on the failed path as well as the good one (a day whose
    // sweep broke still ages the week-old text of sessions that owe nothing),
    // and BEFORE the copy below, so the day's backup never carries raw text
    // past its week. Its own try: a retention pass may not cost the snapshot.
    try {
      retentionReport = retentionJob({ counterpart, date: today, onEvent: emit });
      if (retentionReport.reason === "failed") {
        noteFailure(counterpart, emit, retentionReport.code ?? "UNKNOWN", "retention", today);
      }
    } catch (err) {
      emit("retention.threw", { code: err instanceof Error ? err.name : "UNKNOWN" });
    }
    // 4. THE DAY'S COPY OF THE STORE — after everything above has written, on
    // the failed path as well as the good one, and before the store is closed.
    // It never throws by construction (`adapters/snapshots.ts`); the try is
    // belt and braces, because a backup that took the worker down with it would
    // be the mechanism defeating its own purpose.
    try {
      snapshotReport = runSnapshot({
        counterpart,
        dataDir: config.dataDir,
        ...(config.snapshots === undefined ? {} : { config: config.snapshots }),
        date: today,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      emit("runner.snapshot", {
        reason: snapshotReport.reason,
        name: snapshotReport.name,
        kept: snapshotReport.rotation?.kept ?? 0,
        deleted: snapshotReport.rotation?.deleted.length ?? 0,
        ms: snapshotReport.ms,
      });
    } catch (err) {
      emit("snapshot.threw", { code: err instanceof Error ? err.name : "UNKNOWN" });
    }
    counterpart.close();
  }
  return { ...result, snapshot: snapshotReport, retention: retentionReport };
}

/**
 * One durable row for a step that failed inside the detached worker.
 *
 * Pre-open failures are NOT covered here and do not need to be: the parent's
 * `adapter.spawn.refused` / `adapter.spawn.failed` row already says the worker
 * never got as far as a store. This is the other half — it opened one, and then
 * something went wrong where nobody was looking.
 *
 * `dedupKey` gates it to one row per step per calendar date, the same rule the
 * spawn rows follow, so a failure that repeats at every boundary is a fact and
 * not a flood. It never throws: a failed record may not turn a failed step into
 * a failed process.
 */
function noteFailure(
  counterpart: Counterpart,
  emit: (name: string, data: Record<string, string | number | boolean | null>) => void,
  code: string,
  step: string,
  date: string,
): void {
  if (counterpart.observer) return;
  try {
    counterpart.noteAdapterEvent(
      RUNNER_FAILED_EVENT,
      { code, step, date },
      { dedupKey: `${RUNNER_FAILED_EVENT}:${step}:${date}` },
    );
  } catch (err) {
    emit("runner.record.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
  }
}

/** The watchdog this process arms on itself, from the number it was told. */
export function watchdogMs(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env[WATCHDOG_ENV];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The data dir this process was PINNED to. Never resolved from anywhere else. */
export function pinnedDataDir(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[DATA_DIR_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}

/** The session (and its scope) this process was told to follow. Read from the
 *  pinned environment for the same reason the data dir is: the spawner wrote
 *  them last, so nothing a caller exported can redirect the cue. */
export function pinnedSession(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[SESSION_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}

export function pinnedScope(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[SCOPE_ENV];
  return raw !== undefined && raw.trim().length > 0 ? raw : null;
}

export function isEntryPoint(argv1: string | undefined, url: string, binary: Binary | null = BINARY): boolean {
  // Never in the single binary, where every module shares one URL: its
  // dispatcher (tools/single-binary/main.ts) calls `start()` itself.
  if (argv1 === undefined || binary !== null) return false;
  return resolve(argv1) === fileURLToPath(new URL(url));
}

/**
 * This process's configuration and its pinned data dir.
 *
 * Exported and injectable so the runner's configuration path is provable
 * without a process (the entry point itself is not importable).
 */
export function runnerConfig(
  path = CONFIG_PATH,
  env: NodeJS.ProcessEnv = process.env,
): { config: AdapterConfig; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    raw = undefined;
  }
  const loaded = loadConfig(raw);
  const pinned = pinnedDataDir(env);
  // THE EMBEDDER DEFAULT (config.ts#resolveEmbedder), the same rule the hook
  // applies, so the worker backfills with the table the hooks embed with.
  return {
    config: withEmbedderDefault({
      ...loaded.config,
      // The PIN wins. The spawner wrote it last precisely so nothing else can.
      dataDir: pinned ?? loaded.config.dataDir ?? dataDir(),
    }),
    reason: loaded.reason,
  };
}

async function main(): Promise<void> {
  const choice = runnerConfigChoice();
  // The second refusal is the explicit-dir guard (`config-path.ts#implicitConfigRefusal`):
  // armed, an UNNAMED configuration stands the worker down too, because the
  // default one names a store. Never armed on the live host.
  const refusal = namedConfigRefusal(choice) ?? implicitConfigRefusal(choice);
  if (refusal !== null) {
    // Same direction as the hook: a worker told to read a configuration it
    // cannot resolve — relative, or absolute and not there — does NOT fall back
    // to the default store. It says so and exits 0: nothing about a failed run
    // may reach the host. This one matters even though the spawner pins a path
    // the parent already read, because the pin travels through an environment
    // and a file can be moved between the two processes.
    process.stderr.write(`[counterparts] worker stood down: ${refusal}\n`);
    return;
  }
  const { config, reason } = runnerConfig(choice.path);
  const unreadable = namedUnreadableRefusal(choice, reason);
  if (unreadable !== null) {
    process.stderr.write(`[counterparts] worker stood down: ${unreadable}\n`);
    return;
  }
  // Detached, this stderr goes nowhere (`spawn.ts` runs the child with stdio
  // ignored); run by hand it is the line that says which file answered. The
  // record for a detached run is the pin itself — `COUNTERPARTS_CONFIG` in the
  // environment the spawner wrote — and the session record the parent left.
  process.stderr.write(`[counterparts] worker config: ${configLine(choice)}\n`);

  const timeout = watchdogMs();
  const controller = new AbortController();
  const timer =
    timeout === null
      ? null
      : setTimeout(() => {
          controller.abort();
        }, timeout);
  timer?.unref?.();
  // THE PROCESS LOG (`adapters/log/`) — the one place this detached run's
  // events outlive it, since its stdio goes nowhere.
  const log = openLog({
    dataDir: config.dataDir,
    proc: "worker",
    session: pinnedSession(),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    observer: config.observer === true,
  });
  log.start();
  try {
    const report = await runOnce({
      config,
      signal: controller.signal,
      ...(pinnedSession() === null ? {} : { session: pinnedSession() as string }),
      ...(pinnedScope() === null ? {} : { scope: pinnedScope() as string }),
      onEvent: (name, data) => log.event({ name, data }),
    });
    log.end(report.reason, { swept: report.swept, minted: report.minted, code: report.code });
  } catch (err) {
    log.threw(err);
    throw err;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** One worker run, then exit — what this file does as a script, and what the
 *  single binary's `runner` mode calls. */
export function start(): void {
  void main().then(
    () => process.exit(0),
    (err: unknown) => {
      // Exit 0 either way — nothing about a failed run may reach the host — but
      // SAY why, the way the hook does. Before this line, the gap between the
      // two guards (a named configuration that names no store, nothing else
      // naming it) was a bare exit 0 (#80 review). Detached, this goes nowhere;
      // run by hand, it is the reason.
      const detail = err instanceof Error ? err.message : String(err);
      const remedy = `Set "dataDir" in ${runnerConfigChoice().path}, or set ${DATA_DIR_ENV}.`;
      process.stderr.write(`[counterparts] worker stood down: ${describeGuardRefusal(err, remedy) ?? detail}\n`);
      process.exit(0);
    },
  );
}

if (isEntryPoint(process.argv[1], import.meta.url)) start();
