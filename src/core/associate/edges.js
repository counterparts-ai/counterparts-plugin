import { decayCurve } from "../physics/index.js";
export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
export function edgeWeightAt(e, day, t) {
  const elapsed = day - e.lastDay;
  if (elapsed <= 0)
    return e.weight;
  return e.weight * decayCurve(elapsed, t.S_EDGE, t.EDGE_DECAY_SHAPE);
}
export function conducts(weight, t) {
  return weight > t.EDGE_FLOOR;
}
export function isDead(e, day, t) {
  return !conducts(edgeWeightAt(e, day, t), t);
}
export function strengthen(current, delta, t) {
  const next = current + Math.max(0, delta);
  return next > t.EDGE_CAP ? t.EDGE_CAP : next;
}
export function homeostasis(src, weights, t) {
  const next = new Map(weights);
  const evictions = [];
  const live = [...next.entries()].filter(([, w]) => conducts(w, t)).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  for (const [dst, w] of live.slice(t.MAX_EDGES_PER_NODE)) {
    next.set(dst, 0);
    evictions.push({ src, dst, priorWeight: w, reason: "count-cap" });
  }
  const kept = live.slice(0, t.MAX_EDGES_PER_NODE);
  const total = kept.reduce((sum, [, w]) => sum + w, 0);
  let renormalized = false;
  if (total > t.MAX_OUT_WEIGHT && total > 0) {
    const factor = t.MAX_OUT_WEIGHT / total;
    for (const [dst, w] of kept)
      next.set(dst, w * factor);
    renormalized = true;
  }
  return { next, evictions, renormalized };
}
export function planFlush(deltas, day, edgesFrom, t) {
  return plan(deltas, day, edgesFrom, t, (current, delta) => strengthen(current, delta, t));
}
export function planProposal(pairs, weight, day, edgesFrom, t) {
  const w = Math.min(t.EDGE_CAP, Math.max(0, weight));
  const nodes = new Map;
  const load = (id) => {
    const have = nodes.get(id);
    if (have !== undefined)
      return have;
    const m = new Map;
    for (const e of edgesFrom(id))
      if (e.dst !== id)
        m.set(e.dst, edgeWeightAt(e, day, t));
    nodes.set(id, m);
    return m;
  };
  const room = (node, dst) => {
    const current = node.get(dst) ?? 0;
    const next = Math.max(current, w);
    if (next === current)
      return true;
    let live = 0;
    let sum = 0;
    for (const v of node.values()) {
      if (!conducts(v, t))
        continue;
      live += 1;
      sum += v;
    }
    const isNew = !conducts(current, t) && conducts(next, t);
    if (isNew && live + 1 > t.MAX_EDGES_PER_NODE)
      return false;
    const after = sum - (conducts(current, t) ? current : 0) + (conducts(next, t) ? next : 0);
    return after <= t.MAX_OUT_WEIGHT + 0.000000000001;
  };
  const rows = new Map;
  const outcomes = [];
  for (const p of pairs) {
    if (p.a === p.b)
      continue;
    const fwd = load(p.a);
    const back = load(p.b);
    if (!room(fwd, p.b) || !room(back, p.a)) {
      outcomes.push({ a: p.a, b: p.b, outcome: "no-room" });
      continue;
    }
    for (const [src, node, dst] of [
      [p.a, fwd, p.b],
      [p.b, back, p.a]
    ]) {
      const current = node.get(dst) ?? 0;
      const next = Math.max(current, w);
      if (next === current)
        continue;
      node.set(dst, next);
      rows.set(`${src}\x00${dst}`, { src, dst, weight: next, lastDay: day });
    }
    outcomes.push({ a: p.a, b: p.b, outcome: "landed" });
  }
  return { rows: [...rows.values()], outcomes };
}
function plan(deltas, day, edgesFrom, t, combine) {
  const nodes = new Map;
  const stored = new Map;
  const load = (id) => {
    const have = nodes.get(id);
    if (have !== undefined)
      return have;
    const decayed = new Map;
    const raw = new Map;
    for (const e of edgesFrom(id)) {
      decayed.set(e.dst, edgeWeightAt(e, day, t));
      raw.set(e.dst, e);
    }
    nodes.set(id, decayed);
    stored.set(id, raw);
    return decayed;
  };
  for (const d of deltas) {
    if (d.a === d.b)
      continue;
    const forward = load(d.a);
    const back = load(d.b);
    forward.set(d.b, combine(forward.get(d.b) ?? 0, d.delta));
    back.set(d.a, combine(back.get(d.a) ?? 0, d.back ?? d.delta));
  }
  const rows = [];
  const evictions = [];
  const renormalized = [];
  for (const [src, weights] of [...nodes].sort((x, y) => x[0] < y[0] ? -1 : 1)) {
    const settled = homeostasis(src, weights, t);
    evictions.push(...settled.evictions);
    if (settled.renormalized)
      renormalized.push(src);
    const raw = stored.get(src) ?? new Map;
    for (const [dst, weight] of [...settled.next].sort((x, y) => x[0] < y[0] ? -1 : 1)) {
      const before = raw.get(dst);
      if (before !== undefined && before.weight === weight && before.lastDay === day)
        continue;
      rows.push({ src, dst, weight, lastDay: day });
    }
  }
  return { rows, evictions, renormalized, nodesTouched: nodes.size };
}
