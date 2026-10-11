/**
 * THE SELF MAP (2026-09-27, self round 3b — an experiment, easy to change or
 * take out): the memories about me or about us as a small picture. Each is a
 * dot, as bright as it is firmly held (the memories tab's language); the
 * association links between them are lines; the core sits in the middle,
 * ringed, and a memory one awake return from the fast lane wears a faint ring.
 *
 * Who is about me or about us, how close each is to the core and whether it is
 * one return away all come from `coreCandidates` (`views/mind.ts`), which asks
 * the engine (`aboutMe`, `promotionEligibility`, `oneReturnAway`); nothing here
 * re-derives a threshold, a kind or a lane. A memory the owner sent back is left
 * out, as the list it replaces left it out. The links are the `edges` table,
 * read (`edgesFrom`), only between dots that are drawn.
 *
 * To take the map out: this file, `pages/self/sections/map.js`, the `map` field
 * in `mindView`, and its two lines in `sections/settling.js`.
 *
 * Read-only, like everything in this directory.
 */
import { strength } from "../../../../core/physics/index.js";
import { pairKey } from "../../../../core/associate/index.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";
import type { CoreCandidate } from "./mind.js";

/** How many dots the map draws at most: the core, then the closest to it. */
export const MAP_MAX = 60;

export interface MapNode {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  /** How firmly it is held today, 0..1 — the number the memories tab brightens on. */
  readonly strength: number;
  /** In the core (the identity band). */
  readonly core: boolean;
  /** One awake return from the fast lane (the engine's verdict, via `coreCandidates`). */
  readonly oneReturnAway: boolean;
  /** Ready: a lane is met; it joins at the next consolidation. */
  readonly ready: boolean;
  /** The better of the two lanes' progress, 0..2; 2 for a core memory. */
  readonly closeness: number;
}

export interface MapLink {
  readonly a: string;
  readonly b: string;
  readonly weight: number;
}

export interface SelfMap {
  readonly nodes: MapNode[];
  readonly links: MapLink[];
  /** Memories about me or about us that could have been drawn (the core included). */
  readonly total: number;
  /** Of them, left off because the map is full. */
  readonly more: number;
}

/**
 * The map's dots and lines. `core` is the identity band as `self/` enumerates
 * it; `candidates` is `coreCandidates(...).raw`, closest first.
 */
export function selfMap(
  src: DashboardSource,
  core: readonly { id: string; text: string; confidential: boolean; strength: number }[],
  candidates: readonly CoreCandidate[],
): SelfMap {
  const store = src.store;
  const day = store.livedDay();
  const nodes: MapNode[] = [];
  const seen = new Set<string>();
  for (const c of core) {
    if (seen.has(c.id) || nodes.length >= MAP_MAX) continue;
    seen.add(c.id);
    nodes.push({ id: c.id, text: c.text, confidential: c.confidential, strength: round(c.strength), core: true, oneReturnAway: false, ready: false, closeness: 2 });
  }
  for (const c of candidates) {
    if (seen.has(c.id) || nodes.length >= MAP_MAX) continue;
    seen.add(c.id);
    const r = reveal(store, c.id, 110);
    let s = 0;
    try {
      s = strength(store.physicsOf(c.id), day);
    } catch {
      /* a row whose physics will not read draws at its dimmest, never left out */
    }
    nodes.push({
      id: c.id,
      text: r.text ?? r.label,
      confidential: r.confidential,
      strength: round(s),
      core: false,
      oneReturnAway: c.oneReturnAway,
      ready: c.eligible,
      closeness: round(c.closeness),
    });
  }
  const drawn = new Set(nodes.map((n) => n.id));
  const byPair = new Map<string, MapLink>();
  for (const n of nodes) {
    let edges;
    try {
      edges = store.edgesFrom(n.id);
    } catch {
      continue;
    }
    for (const e of edges) {
      if (!drawn.has(e.dst) || e.dst === n.id) continue;
      const key = pairKey(n.id, e.dst);
      const prior = byPair.get(key);
      // A pair stored both ways is one line, drawn at the stronger of the two.
      if (prior === undefined || e.weight > prior.weight) {
        const [a, b] = n.id < e.dst ? [n.id, e.dst] : [e.dst, n.id];
        byPair.set(key, { a, b, weight: round(e.weight) });
      }
    }
  }
  const links = [...byPair.values()].sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1));
  const total = core.length + candidates.filter((c) => !core.some((k) => k.id === c.id)).length;
  return { nodes, links, total, more: Math.max(0, total - nodes.length) };
}

const round = (x: number): number => Math.round(x * 1000) / 1000;
