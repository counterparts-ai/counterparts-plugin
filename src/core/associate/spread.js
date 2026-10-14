import { conducts, edgeWeightAt } from "./edges.js";
export function spread(input, t) {
  const acc = new Map;
  const seedIds = new Set(input.seeds.map((s) => s.id));
  const queue = new Map;
  const expandedAt = new Set;
  let blocked = 0;
  let expanded = 0;
  let reached = 0;
  let pastHops = false;
  for (const s of input.seeds) {
    if (!input.conducts(s.id)) {
      blocked += 1;
      continue;
    }
    if (!(s.activation > 0))
      continue;
    const have = queue.get(s.id);
    queue.set(s.id, { carried: (have?.carried ?? 0) + s.activation, level: 1 });
  }
  let strongest = 0;
  for (const q of queue.values())
    strongest = Math.max(strongest, q.carried);
  const threshold = strongest * t.SPREAD_MIN_FRACTION;
  let stop = "exhausted";
  for (;; ) {
    const next = head(queue);
    if (next === null) {
      stop = pastHops ? "hop-limit" : "exhausted";
      break;
    }
    if (next.carried < threshold) {
      stop = "threshold";
      break;
    }
    if (expanded >= t.MAX_SPREAD_NODES) {
      stop = "node-limit";
      break;
    }
    queue.delete(next.id);
    expandedAt.add(next.id);
    expanded += 1;
    if (next.level > reached)
      reached = next.level;
    const live = [];
    for (const e of input.edgesFrom(next.id)) {
      if (e.dst === next.id)
        continue;
      const w = edgeWeightAt(e, input.day, t);
      if (!conducts(w, t))
        continue;
      if (!input.conducts(e.dst)) {
        blocked += 1;
        continue;
      }
      live.push({ dst: e.dst, weight: w });
    }
    if (live.length === 0)
      continue;
    const sum = live.reduce((total, e) => total + e.weight, 0);
    const fan = t.FAN_NORMALIZATION ? Math.max(t.MAX_OUT_WEIGHT, sum) : 1;
    if (!(fan > 0))
      continue;
    for (const e of live) {
      if (seedIds.has(e.dst))
        continue;
      const gain = next.carried * t.HOP_DECAY * (e.weight / fan);
      if (gain <= 0)
        continue;
      const have = acc.get(e.dst);
      if (have === undefined) {
        acc.set(e.dst, { activation: gain, depth: next.level, paths: 1, from: new Map([[next.id, gain]]) });
      } else {
        have.activation += gain;
        have.paths += 1;
        have.from.set(next.id, (have.from.get(next.id) ?? 0) + gain);
        if (next.level < have.depth)
          have.depth = next.level;
      }
      if (expandedAt.has(e.dst))
        continue;
      if (next.level >= t.HOPS) {
        pastHops = true;
        continue;
      }
      const waiting = queue.get(e.dst);
      if (waiting === undefined)
        queue.set(e.dst, { carried: gain, level: next.level + 1 });
      else {
        waiting.carried += gain;
        if (next.level + 1 < waiting.level)
          waiting.level = next.level + 1;
      }
    }
  }
  let waiting = 0;
  if (stop === "node-limit") {
    for (const q of queue.values())
      if (q.carried >= threshold)
        waiting += 1;
  }
  const contributions = [...acc].map(([id, v]) => ({ id, activation: v.activation, depth: v.depth, paths: v.paths, from: Object.fromEntries(v.from) })).sort((a, b) => b.activation - a.activation || (a.id < b.id ? -1 : 1));
  return { contributions, expanded, blocked, stop, depth: reached, waiting };
}
function head(queue) {
  let best = null;
  for (const [id, q] of queue) {
    if (best === null || q.carried > best.carried || q.carried === best.carried && id < best.id) {
      best = { id, carried: q.carried, level: q.level };
    }
  }
  return best;
}
