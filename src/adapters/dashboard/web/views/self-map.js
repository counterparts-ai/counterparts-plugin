import { strength } from "../../../../core/physics/index.js";
import { pairKey } from "../../../../core/associate/index.js";
import { reveal } from "../reveal.js";
export const MAP_MAX = 60;
export function selfMap(src, core, candidates) {
  const store = src.store;
  const day = store.livedDay();
  const nodes = [];
  const seen = new Set;
  for (const c of core) {
    if (seen.has(c.id) || nodes.length >= MAP_MAX)
      continue;
    seen.add(c.id);
    nodes.push({ id: c.id, text: c.text, confidential: c.confidential, strength: round(c.strength), core: true, oneReturnAway: false, ready: false, closeness: 2 });
  }
  for (const c of candidates) {
    if (seen.has(c.id) || nodes.length >= MAP_MAX)
      continue;
    seen.add(c.id);
    const r = reveal(store, c.id, 110);
    let s = 0;
    try {
      s = strength(store.physicsOf(c.id), day);
    } catch {}
    nodes.push({
      id: c.id,
      text: r.text ?? r.label,
      confidential: r.confidential,
      strength: round(s),
      core: false,
      oneReturnAway: c.oneReturnAway,
      ready: c.eligible,
      closeness: round(c.closeness)
    });
  }
  const drawn = new Set(nodes.map((n) => n.id));
  const byPair = new Map;
  for (const n of nodes) {
    let edges;
    try {
      edges = store.edgesFrom(n.id);
    } catch {
      continue;
    }
    for (const e of edges) {
      if (!drawn.has(e.dst) || e.dst === n.id)
        continue;
      const key = pairKey(n.id, e.dst);
      const prior = byPair.get(key);
      if (prior === undefined || e.weight > prior.weight) {
        const [a, b] = n.id < e.dst ? [n.id, e.dst] : [e.dst, n.id];
        byPair.set(key, { a, b, weight: round(e.weight) });
      }
    }
  }
  const links = [...byPair.values()].sort((x, y) => x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1);
  const total = core.length + candidates.filter((c) => !core.some((k) => k.id === c.id)).length;
  return { nodes, links, total, more: Math.max(0, total - nodes.length) };
}
const round = (x) => Math.round(x * 1000) / 1000;
