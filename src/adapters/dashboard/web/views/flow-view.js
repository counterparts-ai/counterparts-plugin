import { band } from "../../../../core/physics/index.js";
import { NEVER, NONE } from "../../layout.js";
import { FLOW_EDGES, FLOW_NODES, NO_EVENT_OF_ITS_OWN, UNLOGGED_PATH, eventsOfNode, findNode } from "../flow.js";
import { narrate } from "../narrate.js";
import { activityView } from "./activity.js";
import { LOG_CEILING, census, eventCountsByName, memoriesHeld } from "./shared.js";
export function flowView(src, feedLimit = 24) {
  const store = src.store;
  const rows = census(src).filter((r) => !r.schema);
  const day = store.livedDay();
  const activity = activityView(src, { limit: feedLimit });
  const counts = new Map;
  for (const v of activity.vocabulary) {
    if (v.node === null)
      continue;
    counts.set(v.node, (counts.get(v.node) ?? 0) + v.count);
  }
  const nodes = FLOW_NODES.map((node) => {
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
      silent
    };
  });
  return {
    nodes,
    edges: FLOW_EDGES,
    lastSeq: activity.lastSeq,
    feed: activity.events,
    note: "Only particles mean activity. A still diagram is a still machine — nothing here drifts for decoration."
  };
}
function nodeState(src, key, count, memories, day) {
  const store = src.store;
  switch (key) {
    case "store":
      return memories === 0 ? NONE : `${memories} memories held`;
    case "physics":
      return day === 0 ? NEVER : `day ${day} on the clock`;
    case "associate": {
      let edges = 0;
      for (const id of store.list({ archived: false }))
        edges += store.edgesFrom(id).length;
      return edges === 0 ? NONE : `${edges} directed edges`;
    }
    case "prospective": {
      let armed = 0;
      let fired = 0;
      for (const id of store.list({ archived: false })) {
        for (const p of store.prospectiveFor(id)) {
          if (p.state === "fired")
            fired += 1;
          else
            armed += 1;
        }
      }
      return armed + fired === 0 ? NONE : `${armed} waiting · ${fired} fired`;
    }
    case "self": {
      const e = src.self.enumerate(day);
      return e.identity.length === 0 && e.protected.length === 0 ? NONE : `${e.identity.length} in the band · ${e.protected.length} permanent`;
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
      return day === 0 ? NEVER : "silent by design";
    case "session": {
      const sessions = new Set;
      for (const name of eventsOfNode("session")) {
        for (const row of store.eventLog({ name, order: "desc", limit: LOG_CEILING }))
          if (row.ref !== null)
            sessions.add(row.ref);
      }
      for (const row of store.eventLog({ name: "recall.decision", order: "desc", limit: LOG_CEILING })) {
        if (row.ref !== null)
          sessions.add(row.ref);
      }
      return sessions.size === 0 ? day === 0 ? NEVER : NONE : `${sessions.size} sessions seen`;
    }
    case "remember":
      return memories === 0 ? day === 0 ? NEVER : NONE : `${memories} came through`;
    case "encode":
      if (count > 0)
        return `${count} recorded`;
      if (memories > 0)
        return `${memories} passed · no gate record for them`;
      return day === 0 ? NEVER : NONE;
    default:
      return count === 0 ? NEVER : `${count} recorded`;
  }
}
export function nodeDetail(src, key, limit = 8) {
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
      state: ""
    };
  }
  const store = src.store;
  const names = eventsOfNode(node.key);
  const rows = [];
  for (const name of names)
    rows.push(...store.eventLog({ name, order: "desc", limit: LOG_CEILING }));
  rows.sort((a, b) => a.seq - b.seq);
  const recent = rows.slice(-limit).reverse().map((row) => narrate(store, row));
  const everLived = store.livedDay() > 0 || store.list().length > 0;
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
    recentAbsent: recent.length === 0 ? names.length === 0 ? null : everLived ? NONE : NEVER : null,
    state: nodeState(src, node.key, recorded, memoriesHeld(src), store.livedDay())
  };
}
