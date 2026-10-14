import { NEVER_CHANGES, band, bandMove, nextChangeDay, strength } from "../physics/index.js";
import { TUNABLES as PHYSICS } from "../physics/index.js";
import { CLAIMS_ERA_CUTOFF_KEY, reachExempt, rowToPhysics } from "../store/operational.js";
import { TUNABLES } from "./tunables.js";
import { countSkip, emptyOutcome, isEntityCard, isHandoffRow, isJournal, isJournalCopy, isSelfPageRow, recordBandTransition } from "./types.js";
import { censusDue, upgradeCensus } from "./upgrade.js";
import { readCursor, resumeIndex, writeCursor } from "./markers.js";
const DECAY_PHASE = "decay";
export const CURVE_META_KEY = "decay.curve";
export function curveSignature(eraCutoff = null) {
  return JSON.stringify({
    era: eraCutoff,
    eraReads: 2,
    defaults: [
      PHYSICS.DEFAULT_CLAIM_WORK_EVENT,
      PHYSICS.AUTHORED_DEFAULT_CLAIM,
      PHYSICS.DEFAULT_CLAIM_WORLD,
      PHYSICS.DEFAULT_CLAIM_PERSONAL
    ],
    shape: PHYSICS.DECAY_SHAPE,
    psi: PHYSICS.POWER_LAW_PSI,
    s0: PHYSICS.S0,
    g: PHYSICS.STABILITY_GAIN,
    q: PHYSICS.EMO_Q,
    lift: PHYSICS.EMO_LIFT,
    beta: PHYSICS.BETA,
    ret: PHYSICS.RETURN_GAIN,
    rep: PHYSICS.REP_PER_USE,
    repCap: PHYSICS.REP_CAP,
    repScale: PHYSICS.REP_SCALE_USES,
    cons: PHYSICS.CONS_BONUS,
    sem: PHYSICS.THETA_SEM,
    reach: PHYSICS.REACH,
    floor: PHYSICS.PHI_PRUNE,
    dwell: PHYSICS.D_FLOOR_DAYS,
    grace: PHYSICS.HOLD_GRACE_DAYS,
    lead: PHYSICS.HOLD_LEAD_DAYS,
    afterHold: "own-curve",
    felt: PHYSICS.FELT_HEIGHT_CAP,
    kinds: Object.fromEntries(Object.entries(PHYSICS.KINDS).map(([k, v]) => [k, [v.wSal, v.wRep, v.kappa]]))
  });
}
export function bandMoveCause(direction, to, nextChangeDay, hold, recurved) {
  if (recurved && to !== "identity")
    return "recurve";
  if (direction === "down")
    return "curve";
  if (to === "identity")
    return "promoted";
  if (nextChangeDay === null || nextChangeDay === undefined)
    return "input";
  return hold !== null ? "held" : "unexplained";
}
export const DECAY_SKIPS = [
  "archived",
  "removed",
  "journal",
  "journal-copy",
  "handoff",
  "entity-card",
  "self-page",
  "identity-band",
  "reinforced-today",
  "at-floor",
  "under-audit",
  "unchanged"
];
export function runDecay(ctx, cache) {
  const out = emptyOutcome();
  for (const skip of DECAY_SKIPS)
    out.skipped[skip] = 0;
  if (ctx.apply && censusDue(ctx.store)) {
    try {
      upgradeCensus(ctx);
    } catch (err) {
      ctx.event("sleep.upgrade.census.failed", undefined, { error: err instanceof Error ? err.name : "UNKNOWN" });
    }
  }
  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const prior = cache === null ? new Map : cache.readAll();
  const written = [];
  const transitions = [];
  let bandsReconciled = 0;
  const signature = curveSignature(store.getMeta(CLAIMS_ERA_CUTOFF_KEY) ?? null);
  const sameCurve = store.getMeta(CURVE_META_KEY) === signature;
  const turnDown = typeof store.turnDownDue === "function" && typeof store.setNextChangeDays === "function" && (sameCurve || ctx.apply);
  if (turnDown && !sameCurve && ctx.apply) {
    store.clearNextChangeDays?.();
    store.setMeta(CURVE_META_KEY, signature);
  }
  const recurved = turnDown && !sameCurve && ctx.apply;
  if (turnDown && sameCurve && ctx.apply && cache !== null && prior.size === 0)
    store.clearNextChangeDays?.();
  const ids = turnDown && store.turnDownDue !== undefined ? store.turnDownDue(day) : store.list({ archived: false });
  countSkip(out, "archived", store.list({ archived: true }).length);
  const nextChanges = [];
  const dropped = [];
  const start = resumeIndex(ids, readCursor(store, DECAY_PHASE));
  const order = start === 0 ? ids : [...ids.slice(start), ...ids.slice(0, start)];
  let stoppedAt = null;
  let index = 0;
  for (const id of order) {
    if (out.examined >= ctx.budget) {
      out.budgetExhausted = true;
      out.skippedForBudget = ids.length - index;
      break;
    }
    index += 1;
    stoppedAt = id;
    const row = store.row(id);
    if (row === undefined)
      continue;
    if (denied.has(id)) {
      countSkip(out, "removed");
      nextChanges.push({ id, day: NEVER_CHANGES });
      continue;
    }
    if (row.archived === 1) {
      countSkip(out, "archived");
      continue;
    }
    if (isJournal(row)) {
      countSkip(out, "journal");
      nextChanges.push({ id, day: NEVER_CHANGES });
      continue;
    }
    if (reachExempt(row)) {
      countSkip(out, isJournalCopy(row) ? "journal-copy" : isHandoffRow(row) ? "handoff" : isEntityCard(row) ? "entity-card" : isSelfPageRow(row) ? "self-page" : "journal");
      nextChanges.push({ id, day: NEVER_CHANGES });
      if (prior.has(id))
        dropped.push(id);
      continue;
    }
    out.examined += 1;
    const p = rowToPhysics(row);
    const s = strength(p, day);
    const b = band(p, day);
    nextChanges.push({ id, day: nextChangeDay(p, day) });
    if (p.promotedIdentity)
      countSkip(out, "identity-band");
    if (p.lastUsedDay === day)
      countSkip(out, "reinforced-today");
    if (s < PHYSICS.PHI_PRUNE)
      countSkip(out, "at-floor");
    const wrong = row.band !== b;
    if (wrong) {
      bandsReconciled += 1;
      if (ctx.apply)
        store.setBand(id, b, day);
    }
    const was = prior.get(id);
    const moved = was === undefined || was.band !== b || Math.abs(was.strength - s) >= TUNABLES.DECAY_QUANTUM || was.strength < PHYSICS.REACH !== s < PHYSICS.REACH;
    if (!moved) {
      if (wrong)
        out.changed += 1;
      else
        countSkip(out, "unchanged");
      continue;
    }
    if (was !== undefined && was.band !== b) {
      const direction = bandMove(was.band, b);
      if (direction !== "none") {
        const cause = bandMoveCause(direction, b, row.next_change_day, p.hold ?? null, recurved);
        const transition = {
          id,
          kind: row.kind,
          from: was.band,
          to: b,
          direction,
          site: "decay",
          day,
          cause
        };
        transitions.push(transition);
        recordBandTransition(ctx, transition);
      }
    }
    written.push({ id, strength: s, band: b, day });
    out.changed += 1;
    ctx.step("item", { index, id });
  }
  if (ctx.apply && cache !== null && dropped.length > 0)
    cache.drop?.(dropped);
  if (ctx.apply && turnDown) {
    store.setNextChangeDays?.(nextChanges);
  }
  if (ctx.apply && cache !== null && (written.length > 0 || bandsReconciled > 0)) {
    if (written.length > 0)
      cache.write(written);
    ctx.event("sleep.decay.materialized", undefined, {
      rows: written.length,
      examined: out.examined,
      bandsReconciled,
      day
    });
  }
  if (ctx.apply && stoppedAt !== null)
    writeCursor(store, DECAY_PHASE, stoppedAt);
  return { ...out, reconciled: bandsReconciled, written, transitions, bandsReconciled };
}
