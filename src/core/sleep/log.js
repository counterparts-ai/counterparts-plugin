import { countSkip, emptyOutcome } from "./types.js";
export const LOG_SWEEP_EVENT = "sleep.log.swept";
export const LOG_SWEEP_SKIPS = ["latched"];
export function runLogSweep(ctx) {
  const { store } = ctx;
  if (store.pruneEvents === undefined || store.eventLogCensus === undefined) {
    throw Object.assign(new Error("log sweep on a port with no durable event log"), {
      code: "NO_DURABLE_EVENT_LOG"
    });
  }
  const out = emptyOutcome();
  const census = store.eventLogCensus();
  const keptLatched = census.latchedPastCutoff;
  if (keptLatched > 0)
    countSkip(out, "latched", keptLatched);
  if (!ctx.apply) {
    const would = Math.min(census.eligible, ctx.budget);
    out.examined = census.eligible + keptLatched;
    out.changed = would;
    out.skippedForBudget = census.eligible - would;
    out.budgetExhausted = out.skippedForBudget > 0;
    return {
      ...out,
      eligible: census.eligible,
      deleted: 0,
      remaining: census.eligible - would,
      keptLatched,
      cutoffDay: census.cutoffDay,
      retentionDays: census.retentionDays
    };
  }
  const report = store.pruneEvents({ limit: ctx.budget });
  out.examined = report.eligible + keptLatched;
  out.changed = report.pruned;
  out.skippedForBudget = report.remaining;
  out.budgetExhausted = report.remaining > 0;
  ctx.event(LOG_SWEEP_EVENT, undefined, {
    day: ctx.day,
    count: report.pruned,
    eligible: report.eligible,
    remaining: report.remaining,
    keptLatched,
    budget: ctx.budget,
    cutoffDay: report.cutoffDay,
    retentionDays: report.retentionDays
  });
  return {
    ...out,
    eligible: report.eligible,
    deleted: report.pruned,
    remaining: report.remaining,
    keptLatched,
    cutoffDay: report.cutoffDay,
    retentionDays: report.retentionDays
  };
}
