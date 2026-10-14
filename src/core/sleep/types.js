import { SELF_PAGE_ROLE_SPELLED } from "../store/operational.js";
export const PHASES = [
  "clock",
  "decay",
  "consolidate",
  "prune",
  "fade",
  "births",
  "dedup",
  "versions",
  "briefing",
  "log"
];

export class CycleKilled extends Error {
  phase;
  stage;
  index;
  constructor(step) {
    super(`CYCLE_KILLED ${step.phase}/${step.stage}`);
    this.name = "CycleKilled";
    this.phase = step.phase;
    this.stage = step.stage;
    this.index = step.index;
  }
}
const CYCLE_PARTIAL = Symbol.for("counterparts.sleep.cyclePartial");
export function attachCyclePartial(err, partial) {
  if (err === null || typeof err !== "object" && typeof err !== "function")
    return;
  try {
    Object.defineProperty(err, CYCLE_PARTIAL, {
      value: partial,
      enumerable: false,
      configurable: true
    });
  } catch {}
}
export function cyclePartial(err) {
  if (err === null || typeof err !== "object" && typeof err !== "function")
    return null;
  const v = err[CYCLE_PARTIAL];
  return v === undefined ? null : v;
}
export const BAND_TRANSITION_EVENT = "band.transition";
export const BAND_TRANSITION_FIELDS = ["kind", "from", "to", "direction", "site", "cause"];
export function bandTransitionKey(t) {
  return `${BAND_TRANSITION_EVENT}:${t.id}:${t.day}:${t.from}:${t.to}`;
}
export function recordBandTransition(ctx, t) {
  ctx.event("sleep.band.moved", t.id, {
    kind: t.kind,
    from: t.from,
    to: t.to,
    direction: t.direction,
    site: t.site,
    cause: t.cause,
    day: t.day
  });
  if (!ctx.apply)
    return;
  ctx.store.appendEvent?.({
    name: BAND_TRANSITION_EVENT,
    day: t.day,
    ref: t.id,
    dedupKey: bandTransitionKey(t),
    payload: { kind: t.kind, from: t.from, to: t.to, direction: t.direction, site: t.site, cause: t.cause }
  });
}
export function phaseReport(report, phase) {
  const found = report.phases.find((p) => p.phase === phase);
  if (found === undefined)
    throw new Error(`no report for phase ${phase}`);
  return found;
}
export function emptyOutcome() {
  return { examined: 0, changed: 0, skipped: {}, budgetExhausted: false, skippedForBudget: 0 };
}
export function isJournal(row) {
  return row.type === "episode";
}
export function isSchemaRow(row) {
  return row.type === "schema";
}
export function isJournalCopy(row) {
  return row.type === "memory" && row.source === "episode" && row.origin_ref !== null && row.origin_ref.length > 0;
}
export const HANDOFF_SHAPE = { role: "handoff", kind: "place", writtenDay: "writtenDay", lifeDays: 14 };
export function isHandoffRow(row) {
  if (row.type !== "schema" || row.kind !== HANDOFF_SHAPE.kind || !row.meta.includes(HANDOFF_SHAPE.role))
    return false;
  try {
    const meta = JSON.parse(row.meta);
    return meta !== null && typeof meta === "object" && meta.role === HANDOFF_SHAPE.role;
  } catch {
    return false;
  }
}
export function isLiveHandoffRow(row, day) {
  if (!isHandoffRow(row))
    return false;
  try {
    const written = JSON.parse(row.meta)[HANDOFF_SHAPE.writtenDay];
    return typeof written === "number" && Number.isFinite(written) && HANDOFF_SHAPE.lifeDays - (day - written) > 0;
  } catch {
    return false;
  }
}
export function isSelfPageRow(row) {
  if (row.type !== "schema" || row.kind !== "self" || !row.meta.includes(SELF_PAGE_ROLE_SPELLED))
    return false;
  try {
    const meta = JSON.parse(row.meta);
    return meta !== null && typeof meta === "object" && meta.role === SELF_PAGE_ROLE_SPELLED;
  } catch {
    return false;
  }
}
export function isEntityCard(row) {
  if (row.type !== "schema")
    return false;
  try {
    const meta = JSON.parse(row.meta);
    return meta !== null && typeof meta === "object" && meta.role === "entity";
  } catch {
    return false;
  }
}
export function countSkip(out, reason, n = 1) {
  out.skipped[reason] = (out.skipped[reason] ?? 0) + n;
}
