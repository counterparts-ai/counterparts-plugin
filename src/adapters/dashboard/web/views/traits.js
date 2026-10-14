import { strength } from "../../../../core/physics/index.js";
import { TRAIT_AXES } from "../../../../core/store/index.js";
import { localDate } from "../../../../core/time.js";
import { reveal } from "../reveal.js";
export const WEEK_AGO_DAYS = 7;
export const TRAIT_ROWS_MAX = 40;
export function balanceOf(nudges, poles) {
  let signed = 0;
  let unsigned = 0;
  for (const n of nudges) {
    const sign = n.toward === poles[1] ? 1 : n.toward === poles[0] ? -1 : 0;
    if (sign === 0)
      continue;
    const w = clamp01(n.strength) * clamp01(n.firmness);
    signed += sign * w;
    unsigned += w;
  }
  if (!(unsigned > 0))
    return null;
  return round(signed / unsigned);
}
export function firmnessThen(store, id, dayThen, thenMs) {
  try {
    const row = store.row(id);
    if (row === undefined)
      return 0;
    const said = store.coreEvents({ memoryId: id }).filter((e) => e.action === "promoted" || e.action === "demoted");
    const before = said.find((e) => e.day <= dayThen);
    const after = said.filter((e) => e.day > dayThen).at(-1);
    const coreThen = before !== undefined ? before.action === "promoted" : after !== undefined ? after.action === "demoted" : row.promoted_identity === 1;
    if (coreThen)
      return 1;
    const returns = store.returnsOf(id).filter((r) => r.day <= dayThen).reduce((sum, r) => sum + r.weight, 0);
    const felt = store.feelingsFor(id).filter((f) => f.created_at <= thenMs).map((f) => f.strength);
    const physics = store.physicsOf(id);
    return clamp01(strength({ ...physics, promotedIdentity: false, returns, feelingPeak: felt.length === 0 ? null : Math.max(...felt) }, dayThen));
  } catch {
    return 0;
  }
}
export function traitsView(src) {
  const store = src.store;
  const day = store.livedDay();
  const zone = store.zone();
  const thenMs = store.now() - WEEK_AGO_DAYS * 86400000;
  const weekAgoDate = localDate(thenMs, zone);
  const dayThen = Math.max(0, day - WEEK_AGO_DAYS);
  let all;
  try {
    all = store.traitsAll({ live: false });
  } catch {
    all = [];
  }
  const state = new Map;
  const stateOf = (id) => {
    const seen = state.get(id);
    if (seen !== undefined)
      return seen;
    let out = { live: false, leftOn: null, born: 1 / 0 };
    try {
      const r = store.row(id);
      if (r !== undefined) {
        const live = r.archived === 0 && r.superseded_by === null;
        out = { live, leftOn: live || r.updated_at === null ? null : localDate(r.updated_at, zone), born: r.birth_day };
      }
    } catch {}
    state.set(id, out);
    return out;
  };
  const live = all.filter((n) => stateOf(n.memory_id).live);
  const pool = new Map;
  const twins = new Map;
  for (const n of all) {
    if (localDate(n.created_at, zone) > weekAgoDate)
      continue;
    const st = stateOf(n.memory_id);
    if (!st.live && !(st.leftOn !== null && st.leftOn > weekAgoDate))
      continue;
    const same = [n.axis, n.toward, n.strength, n.created_at].join("|");
    const twin = (twins.get(n.memory_id + "|" + same) ?? 0) + 1;
    twins.set(n.memory_id + "|" + same, twin);
    const key = same + "|" + twin;
    const held = pool.get(key);
    if (held === undefined || st.born < stateOf(held.memory_id).born)
      pool.set(key, n);
  }
  const old = [...pool.values()];
  const thenMemo = new Map;
  const firmThen = (id) => {
    let f = thenMemo.get(id);
    if (f === undefined) {
      f = round(firmnessThen(store, id, dayThen, thenMs));
      thenMemo.set(id, f);
    }
    return f;
  };
  const memo = new Map;
  const about = (id) => {
    const seen = memo.get(id);
    if (seen !== undefined)
      return seen;
    let firmness = 0;
    try {
      firmness = store.row(id)?.promoted_identity === 1 ? 1 : strength(store.physicsOf(id), day);
    } catch {}
    const r = reveal(store, id, 110);
    const out = { firmness: round(clamp01(firmness)), text: r.text ?? r.label, confidential: r.confidential };
    memo.set(id, out);
    return out;
  };
  const known = new Set;
  const axes = TRAIT_AXES.map((axis) => {
    const poles = axis.poles;
    const on = live.filter((n) => n.axis === axis.id && poles.includes(n.toward));
    const rows = on.map((n) => {
      known.add(n.memory_id);
      const m = about(n.memory_id);
      const withheld = n.withheld || n.confidential || m.confidential;
      return {
        id: n.memory_id,
        text: m.text,
        confidential: m.confidential || n.confidential,
        toward: n.toward,
        strength: round(clamp01(n.strength)),
        firmness: m.firmness,
        carriedBy: withheld ? "" : n.carried_by,
        withheld,
        at: n.created_at
      };
    });
    const then = old.filter((n) => n.axis === axis.id && poles.includes(n.toward)).map((n) => ({ toward: n.toward, strength: n.strength, firmness: firmThen(n.memory_id) }));
    const sorted = [...rows].sort((a, b) => b.strength * b.firmness - a.strength * a.firmness || b.at - a.at || (a.id < b.id ? -1 : 1));
    return {
      id: axis.id,
      poles,
      gloss: axis.gloss,
      balance: balanceOf(rows, poles),
      weekAgo: then.length === 0 ? null : balanceOf(then, poles),
      memories: new Set(rows.map((r) => r.id)).size,
      nudges: rows.length,
      rows: sorted.slice(0, TRAIT_ROWS_MAX),
      more: Math.max(0, sorted.length - TRAIT_ROWS_MAX)
    };
  });
  return {
    axes,
    memories: known.size,
    nudges: axes.reduce((s, a) => s + a.nudges, 0),
    weekAgoDate
  };
}
const clamp01 = (x) => Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
const round = (x) => Math.round(x * 1000) / 1000;
