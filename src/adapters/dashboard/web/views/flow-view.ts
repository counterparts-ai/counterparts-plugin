/**
 * `/api/flow` and `/api/node` — the architecture diagram's live state. (Named
 * `flow-view` so it is not confused with `web/flow.ts`, the diagram's static shape.)
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { band } from "../../../../core/physics/index.js";
import { NEVER, NONE } from "../../layout.js";
import type { DashboardSource } from "../../source.js";
import { FLOW_EDGES, FLOW_NODES, NO_EVENT_OF_ITS_OWN, UNLOGGED_PATH, eventsOfNode, findNode } from "../flow.js";
import type { NodeKey } from "../flow.js";
import { narrate } from "../narrate.js";
import type { NarratedEvent } from "../narrate.js";
import { activityView } from "./activity.js";
import { LOG_CEILING, census, eventCountsByName, memoriesHeld } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// flow
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowNodeState {
  readonly key: NodeKey;
  readonly label: string;
  readonly sub: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly accent: string;
  /** How many durable events this node has ever recorded, in the kept window. */
  readonly count: number;
  /** The honest state line drawn inside the box. */
  readonly state: string;
  /** True when the log has never carried a single event for this node. */
  readonly silent: boolean;
}

export interface FlowView {
  readonly nodes: FlowNodeState[];
  readonly edges: typeof FLOW_EDGES;
  readonly lastSeq: number;
  readonly feed: NarratedEvent[];
  readonly note: string;
}

export function flowView(src: DashboardSource, feedLimit = 24): FlowView {
  const store = src.store;
  // MEMORIES, not every row: the STORE node says "N memories held" and the
  // overview's tile says the same words, so they had better be the same number.
  const rows = census(src).filter((r) => !r.schema);
  const day = store.livedDay();
  const activity = activityView(src, { limit: feedLimit });
  const counts = new Map<NodeKey, number>();
  for (const v of activity.vocabulary) {
    if (v.node === null) continue;
    counts.set(v.node as NodeKey, (counts.get(v.node as NodeKey) ?? 0) + v.count);
  }

  const nodes: FlowNodeState[] = FLOW_NODES.map((node) => {
    const count = counts.get(node.key) ?? 0;
    const silent = eventsOfNode(node.key).length === 0 || count === 0;
    return {
      key: node.key,
      label: node.label,
      sub: node.sub,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      accent: node.accent,
      count,
      state: nodeState(src, node.key, count, rows.length, day),
      silent,
    };
  });

  return {
    nodes,
    edges: FLOW_EDGES,
    lastSeq: activity.lastSeq,
    feed: activity.events,
    note: "Only particles mean activity. A still diagram is a still machine — nothing here drifts for decoration.",
  };
}

/** The one line inside a node's box: its own state, or the honest absence. */
function nodeState(src: DashboardSource, key: NodeKey, count: number, memories: number, day: number): string {
  const store = src.store;
  switch (key) {
    case "store":
      return memories === 0 ? NONE : `${memories} memories held`;
    case "physics":
      return day === 0 ? NEVER : `day ${day} on the clock`;
    case "associate": {
      let edges = 0;
      for (const id of store.list({ archived: false })) edges += store.edgesFrom(id).length;
      return edges === 0 ? NONE : `${edges} directed edges`;
    }
    case "prospective": {
      let armed = 0;
      let fired = 0;
      for (const id of store.list({ archived: false })) {
        for (const p of store.prospectiveFor(id)) {
          if (p.state === "fired") fired += 1;
          else armed += 1;
        }
      }
      return armed + fired === 0 ? NONE : `${armed} waiting · ${fired} fired`;
    }
    case "self": {
      const e = src.self.enumerate(day);
      return e.identity.length === 0 && e.protected.length === 0
        ? NONE
        : `${e.identity.length} in the band · ${e.protected.length} permanent`;
    }
    case "wake": {
      const wake = src.self.wake();
      return wake.ok ? `${wake.bytes} bytes waiting` : NEVER;
    }
    case "schemas": {
      const entities = src.schemas.entities().length;
      return entities === 0 ? NONE : `${entities} entities`;
    }
    case "spans":
      // Turn capture writes no durable event; see NO_EVENT_OF_ITS_OWN. On a
      // store that has never lived a day the honest word is still `(never run)`
      // — "silent by design" would claim a design decision was exercised.
      return day === 0 ? NEVER : "silent by design";
    case "session": {
      const sessions = new Set<string>();
      for (const name of eventsOfNode("session")) {
        for (const row of store.eventLog({ name, order: "desc", limit: LOG_CEILING })) if (row.ref !== null) sessions.add(row.ref);
      }
      // The surfacing log names its session, so a store whose host wrote no
      // boundary rows can still say how many conversations it has seen.
      for (const row of store.eventLog({ name: "recall.decision", order: "desc", limit: LOG_CEILING })) {
        if (row.ref !== null) sessions.add(row.ref);
      }
      return sessions.size === 0 ? (day === 0 ? NEVER : NONE) : `${sessions.size} sessions seen`;
    }
    case "remember":
      // The door's own record is the ask's pacing row, which only a HOST
      // writes. What the door actually did is the count that came through it.
      return memories === 0 ? (day === 0 ? NEVER : NONE) : `${memories} came through`;
    case "encode":
      // NEITHER ABSENCE WORD IS TRUE HERE once anything is in the store: the
      // battery ran on every one of those memories. `(never run)` beside
      // STORE's `143 memories held` was a contradiction on the face of the
      // diagram. Both doors record now (`gate.chunk`, `gate.deposit`), so the
      // ordinary answer is a count — but a store holding memories that PREDATE
      // the gate log, or that were seeded around the door, still has none, and
      // that state gets its own sentence rather than a zero.
      if (count > 0) return `${count} recorded`;
      if (memories > 0) return `${memories} passed · no gate record for them`;
      return day === 0 ? NEVER : NONE;
    default:
      return count === 0 ? NEVER : `${count} recorded`;
  }
}

export interface NodeDetailView {
  readonly found: boolean;
  readonly key: string;
  readonly label: string;
  readonly what: string;
  readonly analog: string;
  readonly breaks: string;
  readonly eventNames: string[];
  readonly noEventOfItsOwn: string | null;
  /** Work that is real and deliberately unrecorded. See `UNLOGGED_PATH`. */
  readonly unloggedPath: string | null;
  readonly recent: NarratedEvent[];
  readonly recentAbsent: string | null;
  readonly state: string;
}

export function nodeDetail(src: DashboardSource, key: string, limit = 8): NodeDetailView {
  const node = findNode(key);
  if (node === undefined) {
    return {
      found: false,
      key,
      label: "",
      what: "",
      analog: "",
      breaks: "",
      eventNames: [],
      noEventOfItsOwn: null,
      unloggedPath: null,
      recent: [],
      recentAbsent: NEVER,
      state: "",
    };
  }
  const store = src.store;
  const names = eventsOfNode(node.key);
  const rows = [];
  // Newest first per name, so "recent" is recent past the ceiling too; then one order.
  for (const name of names) rows.push(...store.eventLog({ name, order: "desc", limit: LOG_CEILING }));
  rows.sort((a, b) => a.seq - b.seq);
  const recent = rows.slice(-limit).reverse().map((row) => narrate(store, row));
  const everLived = store.livedDay() > 0 || store.list().length > 0;
  // The count is the log's own, not the length of reads that stop at a ceiling.
  const counts = eventCountsByName(src);
  const recorded = names.reduce((n, name) => n + (counts.get(name) ?? 0), 0);
  return {
    found: true,
    key: node.key,
    label: node.label,
    what: node.what,
    analog: node.analog,
    breaks: node.breaks,
    eventNames: names,
    noEventOfItsOwn: NO_EVENT_OF_ITS_OWN[node.key] ?? null,
    unloggedPath: UNLOGGED_PATH[node.key] ?? null,
    recent,
    recentAbsent: recent.length === 0 ? (names.length === 0 ? null : everLived ? NONE : NEVER) : null,
    state: nodeState(src, node.key, recorded, memoriesHeld(src), store.livedDay()),
  };
}
