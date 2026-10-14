import { todayIn } from "../time.js";
import { TUNABLES as PHYSICS, symmetryCheck } from "../physics/index.js";
import { runBriefing } from "./briefing.js";
import { runConsolidate } from "./consolidate.js";
import { runDecay } from "./decay.js";
import { runDedup } from "./dedup.js";
import { runFade } from "./fade.js";
import { runBirths } from "./births.js";
import { runLogSweep } from "./log.js";
import { advanceMarker, budgetFor, cadenceFor, markerDue, readMarker } from "./markers.js";
import { runPrune } from "./prune.js";
import { sqliteStrengthCache, storeRankingCache, supportsRanking } from "./strength-cache.js";
import { shouldSpawn } from "./tunables.js";
import { isJournal } from "./types.js";
import { BAND_TRANSITION_EVENT, CycleKilled, PHASES, attachCyclePartial, emptyOutcome } from "./types.js";
const EVENT_RING = 500;
export function todayDate() {
  return todayIn();
}
export function runCycle(opts) {
  const { store } = opts;
  const observer = store.observer;
  const apply = !observer;
  const date = opts.date ?? todayDate();
  const events = [];
  const emit = (name, ref, data) => {
    const event = {
      at: Date.now(),
      name,
      ...ref !== undefined ? { ref } : {},
      ...data !== undefined ? { data } : {}
    };
    events.push(event);
    if (events.length > EVENT_RING)
      events.shift();
    opts.onEvent?.(event);
  };
  const step = (phase, stage, detail) => {
    opts.onStep?.({ phase, stage, ...detail });
  };
  const reports = [];
  const order = [];
  const promoted = [];
  const pruned = [];
  const merged = [];
  const faded = [];
  const bandTransitions = [];
  const injectedCache = opts.strengthCache;
  const cache = observer ? null : injectedCache ?? (supportsRanking(store) ? storeRankingCache(store) : sqliteStrengthCache(store.dir));
  emit("sleep.cycle.start", undefined, { date, observer, spawn: shouldSpawn(store).reason });
  try {
    const day = runClock();
    const ctxFor = (phase, budget) => ({
      store,
      day,
      apply,
      budget,
      step: (stage, detail) => step(phase, stage, detail),
      event: emit
    });
    const runPhase = (phase, body, collect, precheck) => {
      const before = readMarker(store, phase);
      if (before.health === "torn") {
        emit("sleep.marker.torn", undefined, { phase, raw: before.raw ?? "" });
      }
      const budget = budgetFor(phase, opts.budgets);
      const skeleton = { phase, budget, markerBefore: before.day, markerAfter: before.day };
      const idle = (reason) => ({
        ...skeleton,
        status: "did-not-run",
        reason,
        examined: 0,
        changed: 0,
        skipped: {},
        budgetExhausted: false,
        skippedForBudget: 0
      });
      order.push(phase);
      step(phase, "start");
      const blocked = precheck?.() ?? null;
      if (blocked !== null) {
        reports.push(idle(blocked));
        return;
      }
      if (!observer) {
        const due = markerDue(before.day, day, cadenceFor(phase, opts.cadence));
        if (due !== "due") {
          reports.push(idle(due));
          return;
        }
      }
      let result;
      try {
        result = body(ctxFor(phase, budget));
      } catch (err) {
        if (err instanceof CycleKilled)
          throw err;
        const code = errorCode(err);
        emit("sleep.phase.failed", undefined, { phase, error: code });
        reports.push({
          ...skeleton,
          status: "failed",
          reason: "failed",
          examined: 0,
          changed: 0,
          skipped: {},
          budgetExhausted: false,
          skippedForBudget: 0,
          error: code
        });
        return;
      }
      collect?.(result);
      const shape = {
        examined: result.examined,
        changed: result.changed,
        skipped: result.skipped,
        budgetExhausted: result.budgetExhausted,
        skippedForBudget: result.skippedForBudget,
        ...result.reconciled === undefined ? {} : { reconciled: result.reconciled }
      };
      if (observer) {
        reports.push({ ...skeleton, status: "did-not-run", reason: "observer-report", ...shape });
        emit("sleep.observer.report", undefined, { phase, would: result.changed });
        return;
      }
      step(phase, "work-done");
      const after = advanceMarker(store, phase, day);
      step(phase, "marked");
      reports.push({
        ...skeleton,
        markerAfter: after,
        status: result.changed > 0 ? "ran" : "ran-nothing-found",
        reason: result.changed > 0 ? "completed" : "nothing-to-do",
        ...shape
      });
    };
    runPhase("decay", (ctx) => runDecay(ctx, cache), (r) => {
      bandTransitions.push(...r.transitions);
    });
    runPhase("consolidate", (ctx) => runConsolidate(ctx), (r) => {
      promoted.push(...r.promoted);
    });
    runPhase("prune", (ctx) => runPrune(ctx), (r) => {
      pruned.push(...r.pruned);
    });
    runPhase("fade", (ctx) => runFade(ctx, opts.fade, date), (r) => {
      faded.push(...r.faded);
    }, () => opts.fade === undefined ? "no-fade-fn" : null);
    runPhase("births", (ctx) => runBirths(ctx, opts.births), () => {}, () => opts.births === undefined ? "no-births-fn" : null);
    runPhase("dedup", (ctx) => runDedup(ctx, opts.candidates), (r) => {
      merged.push(...r.merged);
    });
    runPhase("versions", (ctx) => {
      const out = emptyOutcome();
      if (!ctx.apply) {
        out.skipped["observer-report"] = 1;
        return out;
      }
      const report = store.pruneSupersededVersions();
      out.examined = report.pruned;
      out.changed = report.pruned;
      emit("sleep.versions.pruned", undefined, {
        count: report.pruned,
        cutoffDay: report.cutoffDay,
        retentionDays: report.retentionDays
      });
      return out;
    });
    runPhase("briefing", (ctx) => runBriefing(ctx, opts.render, opts.budgetBytes), undefined, () => opts.render === undefined ? "no-render-fn" : null);
    runPhase("log", (ctx) => runLogSweep(ctx), undefined, () => store.pruneEvents === undefined || store.eventLogCensus === undefined ? "no-durable-event-log" : null);
    const symmetry = symmetryVerdicts(store, day, emit);
    const report = {
      day,
      date,
      observer,
      order,
      phases: reports,
      promoted,
      pruned,
      merged,
      faded,
      bandTransitions,
      symmetry,
      census: census(store, day, pruned, merged, faded),
      events
    };
    emit("sleep.cycle.done", undefined, {
      day,
      phases: reports.length,
      promoted: promoted.length,
      pruned: pruned.length,
      merged: merged.length,
      faded: faded.length,
      bandUp: bandTransitions.filter((t) => t.direction === "up").length,
      bandDown: bandTransitions.filter((t) => t.direction === "down").length,
      failed: reports.filter((p) => p.status === "failed").length
    });
    return report;
  } catch (err) {
    attachCyclePartial(err, {
      phases: [...reports],
      order: [...order],
      ...err instanceof CycleKilled ? { phase: err.phase, stage: err.stage } : {}
    });
    throw err;
  } finally {
    if (injectedCache === undefined)
      cache?.close();
  }
  function runClock() {
    const phase = "clock";
    const before = readMarker(store, phase);
    const budget = budgetFor(phase, opts.budgets);
    const skeleton = { phase, budget, markerBefore: before.day, markerAfter: before.day };
    order.push(phase);
    step(phase, "start");
    if (observer) {
      reports.push({
        ...skeleton,
        status: "did-not-run",
        reason: "observer-report",
        examined: 0,
        changed: 0,
        skipped: { "observer-report": 1 },
        budgetExhausted: false,
        skippedForBudget: 0
      });
      return store.livedDay();
    }
    const wasDay = store.livedDay();
    let day;
    try {
      day = store.advanceClock(date);
    } catch (err) {
      if (err instanceof CycleKilled)
        throw err;
      const code = errorCode(err);
      emit("sleep.clock.failed", undefined, { date, error: code });
      reports.push({
        ...skeleton,
        status: "failed",
        reason: "failed",
        examined: 0,
        changed: 0,
        skipped: {},
        budgetExhausted: false,
        skippedForBudget: 0,
        error: code
      });
      return wasDay;
    }
    step(phase, "work-done");
    const after = advanceMarker(store, phase, day);
    step(phase, "marked");
    const advanced = day > wasDay;
    reports.push({
      ...skeleton,
      markerAfter: after,
      status: advanced ? "ran" : "ran-nothing-found",
      reason: advanced ? "completed" : "nothing-to-do",
      examined: 1,
      changed: advanced ? 1 : 0,
      skipped: advanced ? {} : { "same-lived-day": 1 },
      budgetExhausted: false,
      skippedForBudget: 0
    });
    return day;
  }
}
const TRANSITION_LOG_LIMIT = 1e6;
export function symmetryVerdicts(store, day, emit) {
  const kinds = Object.keys(PHYSICS.KINDS);
  if (store.eventLog === undefined) {
    emit("sleep.symmetry.unavailable", undefined, { day, reason: "no-durable-event-log" });
    return [];
  }
  const up = new Map;
  const down = new Map;
  const unexplained = new Map;
  let unreadable = 0;
  for (const row of store.eventLog({
    name: BAND_TRANSITION_EVENT,
    limit: TRANSITION_LOG_LIMIT
  })) {
    let payload;
    try {
      payload = JSON.parse(row.payload ?? "");
    } catch {
      unreadable += 1;
      continue;
    }
    const kind = typeof payload["kind"] === "string" ? payload["kind"] : null;
    const direction = payload["direction"];
    if (kind === null) {
      unreadable += 1;
      continue;
    }
    if (payload["cause"] === "recurve")
      continue;
    if (direction === "up") {
      up.set(kind, (up.get(kind) ?? 0) + 1);
      if (payload["cause"] === "unexplained")
        unexplained.set(kind, (unexplained.get(kind) ?? 0) + 1);
    } else if (direction === "down")
      down.set(kind, (down.get(kind) ?? 0) + 1);
    else
      unreadable += 1;
  }
  if (unreadable > 0) {
    emit("sleep.symmetry.unreadable", undefined, { day, rows: unreadable });
  }
  const out = [];
  for (const kind of kinds) {
    const verdict = symmetryCheck(kind, {
      up: up.get(kind) ?? 0,
      down: down.get(kind) ?? 0,
      unexplained: unexplained.get(kind) ?? 0
    });
    out.push(verdict);
    emit("sleep.symmetry", undefined, {
      day,
      kind: verdict.kind,
      reason: verdict.reason,
      ok: verdict.ok,
      up: verdict.up,
      down: verdict.down,
      ratio: Number.isFinite(verdict.ratio) ? verdict.ratio : null,
      expectedMax: verdict.expectedMax,
      unexplained: verdict.unexplained
    });
    if (!verdict.ok) {
      emit("sleep.symmetry.tripped", undefined, {
        day,
        kind: verdict.kind,
        reason: verdict.reason,
        says: verdict.unexplained > 0 ? `up-ratchet suspected: ${String(verdict.unexplained)} band climb(s) with no use, return, feeling or promotion behind them` : "up-ratchet suspected: up-moves far outnumber down-moves",
        up: verdict.up,
        down: verdict.down,
        unexplained: verdict.unexplained,
        expectedMax: verdict.expectedMax
      });
    }
  }
  return out;
}
export function census(store, day, pruned, merged, faded = []) {
  const kinds = Object.keys(PHYSICS.KINDS);
  const created = new Map;
  const exited = new Map;
  const born = store.bornOn?.(day);
  if (born !== undefined) {
    for (const b of born)
      created.set(b.kind, (created.get(b.kind) ?? 0) + b.n);
  } else {
    for (const id of store.list({ bornFromDay: day })) {
      const row = store.row(id);
      if (row === undefined || row.birth_day !== day)
        continue;
      if (isJournal(row))
        continue;
      created.set(row.kind, (created.get(row.kind) ?? 0) + 1);
    }
  }
  for (const p of pruned)
    exited.set(p.record.kind, (exited.get(p.record.kind) ?? 0) + 1);
  for (const m of merged) {
    const row = store.row(m.candidateId);
    if (row === undefined)
      continue;
    exited.set(row.kind, (exited.get(row.kind) ?? 0) + 1);
  }
  for (const id of faded) {
    const row = store.row(id);
    if (row === undefined)
      continue;
    exited.set(row.kind, (exited.get(row.kind) ?? 0) + 1);
  }
  const out = {};
  for (const kind of kinds) {
    out[kind] = { created: created.get(kind) ?? 0, exited: exited.get(kind) ?? 0 };
  }
  return out;
}
function errorCode(err) {
  if (err !== null && typeof err === "object" && "code" in err) {
    return String(err.code);
  }
  return err instanceof Error ? err.name : "UNKNOWN";
}

export { PHASES };
