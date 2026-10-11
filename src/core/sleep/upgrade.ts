/**
 * THE V8 UPGRADE CENSUS — the proof, on the owner's own rows, that the
 * dreaming + consolidation redesign (2026-09-26) moved no memory down.
 *
 * The migration (`store/operational.ts`) marks every row it finds `legacy` and
 * records what it found under `physics.v8.upgrade`. The FIRST decay pass after
 * that runs this once: for every live memory it reads the band and the
 * projected prune day (no further use) two ways — by the v8 arithmetic, and by
 * the pre-v8 arithmetic (the same row with its returns set to zero, which is
 * exactly the old formula: the returns factor is the only term v8 added, and a
 * legacy row keeps its consolidation path) — and counts every difference by
 * direction. By construction the down counts are zero; the census is how that
 * is SEEN rather than asserted (constitution 11). The result is one meta row,
 * `physics.v8.census`, and one durable event, and doctor prints it.
 *
 * Arithmetic only. Runs at most once per store: the meta row is its latch.
 */

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
  strength,
} from "../physics/index.js";
import type { MemoryPhysics } from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import type { PhaseCtx } from "./types.js";
import { isJournal } from "./types.js";

export const V8_UPGRADE_KEY = "physics.v8.upgrade";
export const V8_CENSUS_KEY = "physics.v8.census";
export const V8_CENSUS_EVENT = "physics.upgrade.census";

export interface UpgradeCensus {
  readonly day: number;
  readonly checked: number;
  readonly bandDown: number;
  readonly bandUp: number;
  /** Rows whose strength today is lower by the v8 arithmetic than by the old. */
  readonly weaker: number;
  readonly pruneSooner: number;
  readonly pruneLater: number;
  readonly legacy: number;
  readonly consolidated: number;
  /**
   * THE ROAD THE UPGRADE CLOSED (adversarial review of #251): live rows the
   * pre-v8 rule would have made identity at its next consolidation — `base`
   * without the emotion lift (+ the consolidation bonus the same pass would
   * have granted) at or above 0.85, reinforced on 3+ distinct lived days — and
   * that v8's core lanes do not promote. Every band/strength/prune count above
   * compares a row with itself at one moment, so it cannot see these: nothing
   * moves at the upgrade, but these rows no longer have the future the old
   * rules gave them. Absent on a census recorded before the review.
   */
  readonly v7WouldPromote?: number;
}

/**
 * The lived day a memory would reach the prune floor with no further use, or
 * null when it never will (identity, protected, a held date). On the shipped
 * curve (`physics#daysUntilBelow`; power-law since 2026-10-10 — it was the
 * exponential's closed form until then), and never before its dwell.
 */
export function projectedPruneDay(m: MemoryPhysics): number | null {
  if (m.promotedIdentity || m.protected) return null;
  const anchor = decayAnchor(m);
  const t = daysUntilBelow(m, PHYSICS.PHI_PRUNE);
  if (t === null) return null;
  return Math.max(anchor + t, anchor + PHYSICS.D_FLOOR_DAYS);
}

/**
 * Would the PRE-v8 rule have promoted this row at a consolidation on `day`?
 * v7's `promotionBase` (`max(wSal x sal, wRep x rep) + cons`, no emotion lift)
 * at or above its `THETA_ID` of 0.85, and reinforcement on at least its N = 3
 * distinct lived days — with the consolidation mark the same pass would have
 * set first counted in, as v7 ordered it. Legacy rows only: a row made since
 * the upgrade never had the old rules.
 */
export function v7WouldPromote(m: MemoryPhysics, day: number): boolean {
  if (m.legacy !== true || m.promotedIdentity) return false;
  const k = kindPhysics(m.kind);
  const marked = m.consolidated || consolidationEligibility(m, day).eligible;
  const b = Math.max(k.wSal * sal(m.salience), k.wRep * rep(m)) + (marked ? PHYSICS.CONS_BONUS : 0);
  return b >= V7_THETA_ID && reinforcedDays(m) >= V7_PROMOTION_DAYS;
}

/** The pre-v8 identity threshold and distinct-day count, kept here for the census alone. */
const V7_THETA_ID = 0.85;
const V7_PROMOTION_DAYS = 3;

/** The same row by the pre-v8 formula: its returns set aside. */
export function preV8(m: MemoryPhysics): MemoryPhysics {
  return { ...m, returns: 0 };
}

/** Is the census due — an upgrade recorded and no census yet? */
export function censusDue(store: PhaseCtx["store"]): boolean {
  return store.getMeta(V8_UPGRADE_KEY) !== undefined && store.getMeta(V8_CENSUS_KEY) === undefined;
}

/** Run the census over every live memory and (under `apply`) record it once. */
export function upgradeCensus(ctx: PhaseCtx): UpgradeCensus {
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
  const rank = { episodic: 0, semantic: 1, identity: 2 } as const;
  for (const id of store.list({ archived: false })) {
    if (denied.has(id)) continue;
    const row = store.row(id);
    if (row === undefined || row.archived === 1 || isJournal(row)) continue;
    const now = rowToPhysics(row);
    const old = preV8(now);
    checked += 1;
    if (now.legacy === true) legacy += 1;
    if (now.consolidated) consolidated += 1;
    if (row.type !== "schema" || row.kind !== "self") {
      if (v7WouldPromote(now, day)) closedRoad += 1;
    }
    const move = rank[band(now, day)] - rank[band(old, day)];
    if (move < 0) bandDown += 1;
    else if (move > 0) bandUp += 1;
    // The strength too, so a drop inside a band could never hide behind "no band moved".
    if (strength(now, day) < strength(old, day) - 1e-12) weaker += 1;
    const pNow = projectedPruneDay(now);
    const pOld = projectedPruneDay(old);
    if (pNow !== null && pOld !== null) {
      if (pNow < pOld) pruneSooner += 1;
      else if (pNow > pOld) pruneLater += 1;
    }
  }
  const census: UpgradeCensus = {
    day,
    checked,
    bandDown,
    bandUp,
    weaker,
    pruneSooner,
    pruneLater,
    legacy,
    consolidated,
    v7WouldPromote: closedRoad,
  };
  if (ctx.apply) {
    store.setMeta(V8_CENSUS_KEY, JSON.stringify(census));
    store.appendEvent?.({
      name: V8_CENSUS_EVENT,
      day,
      dedupKey: V8_CENSUS_EVENT,
      payload: { ...census },
    });
  }
  ctx.event("sleep.upgrade.census", undefined, { ...census });
  return census;
}
