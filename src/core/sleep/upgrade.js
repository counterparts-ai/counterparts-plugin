import {
  TUNABLES as PHYSICS,
  band,
  base,
  consolidationEligibility,
  kindPhysics,
  reinforcedDays,
  rep,
  sal,
  daysUntilBelow,
  decayAnchor,
  strength
} from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import { isJournal } from "./types.js";
export const V8_UPGRADE_KEY = "physics.v8.upgrade";
export const V8_CENSUS_KEY = "physics.v8.census";
export const V8_CENSUS_EVENT = "physics.upgrade.census";
export function projectedPruneDay(m) {
  if (m.promotedIdentity || m.protected)
    return null;
  const anchor = decayAnchor(m);
  const t = daysUntilBelow(m, PHYSICS.PHI_PRUNE);
  if (t === null)
    return null;
  return Math.max(anchor + t, anchor + PHYSICS.D_FLOOR_DAYS);
}
export function v7WouldPromote(m, day) {
  if (m.legacy !== true || m.promotedIdentity)
    return false;
  const k = kindPhysics(m.kind);
  const marked = m.consolidated || consolidationEligibility(m, day).eligible;
  const b = Math.max(k.wSal * sal(m.salience), k.wRep * rep(m)) + (marked ? PHYSICS.CONS_BONUS : 0);
  return b >= V7_THETA_ID && reinforcedDays(m) >= V7_PROMOTION_DAYS;
}
const V7_THETA_ID = 0.85;
const V7_PROMOTION_DAYS = 3;
export function preV8(m) {
  return { ...m, returns: 0 };
}
export function censusDue(store) {
  return store.getMeta(V8_UPGRADE_KEY) !== undefined && store.getMeta(V8_CENSUS_KEY) === undefined;
}
export function upgradeCensus(ctx) {
  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  let checked = 0;
  let bandDown = 0;
  let bandUp = 0;
  let pruneSooner = 0;
  let pruneLater = 0;
  let legacy = 0;
  let consolidated = 0;
  let weaker = 0;
  let closedRoad = 0;
  const rank = { episodic: 0, semantic: 1, identity: 2 };
  for (const id of store.list({ archived: false })) {
    if (denied.has(id))
      continue;
    const row = store.row(id);
    if (row === undefined || row.archived === 1 || isJournal(row))
      continue;
    const now = rowToPhysics(row);
    const old = preV8(now);
    checked += 1;
    if (now.legacy === true)
      legacy += 1;
    if (now.consolidated)
      consolidated += 1;
    if (row.type !== "schema" || row.kind !== "self") {
      if (v7WouldPromote(now, day))
        closedRoad += 1;
    }
    const move = rank[band(now, day)] - rank[band(old, day)];
    if (move < 0)
      bandDown += 1;
    else if (move > 0)
      bandUp += 1;
    if (strength(now, day) < strength(old, day) - 0.000000000001)
      weaker += 1;
    const pNow = projectedPruneDay(now);
    const pOld = projectedPruneDay(old);
    if (pNow !== null && pOld !== null) {
      if (pNow < pOld)
        pruneSooner += 1;
      else if (pNow > pOld)
        pruneLater += 1;
    }
  }
  const census = {
    day,
    checked,
    bandDown,
    bandUp,
    weaker,
    pruneSooner,
    pruneLater,
    legacy,
    consolidated,
    v7WouldPromote: closedRoad
  };
  if (ctx.apply) {
    store.setMeta(V8_CENSUS_KEY, JSON.stringify(census));
    store.appendEvent?.({
      name: V8_CENSUS_EVENT,
      day,
      dedupKey: V8_CENSUS_EVENT,
      payload: { ...census }
    });
  }
  ctx.event("sleep.upgrade.census", undefined, { ...census });
  return census;
}
