import { localClock } from "../../../../core/time.js";
import { NEVER, NONE } from "../../layout.js";
import { DURABLE_EVENTS, DURABLE_EVENT_NAMES } from "../../registries.js";
import { payloadOf } from "../../../mechanism-evidence.js";
import { FLOW_NODES, eventsOfNode } from "../flow.js";
import { laneOf } from "../lanes.js";
import { narrate } from "../narrate.js";
import { mergeRepeats } from "./mechanism-panel.js";
import { FEED_LIMIT, LOG_CEILING, eventCountsByName } from "./shared.js";
export function activityView(src, opts = {}) {
  const store = src.store;
  const limit = opts.limit ?? FEED_LIMIT;
  const filter = { limit: LOG_CEILING, order: "desc" };
  if (opts.name !== undefined && opts.name.length > 0)
    filter.name = opts.name;
  const all = store.eventLog(filter).reverse();
  const since = opts.sinceSeq;
  const lane = opts.lane;
  const inLane = (r) => lane === undefined || laneOf(r.name, payloadOf(r)) === lane;
  const events = since !== undefined ? all.filter((r) => r.seq > since).map((row) => narrate(store, row)) : opts.fold === true ? foldedNewest(store, all, limit, inLane) : newestIn(all, limit, inLane).map((row) => narrate(store, row));
  const lastSeq = all.length === 0 ? 0 : all[all.length - 1]?.seq ?? 0;
  const everLived = store.livedDay() > 0 || store.list().length > 0;
  const counts = eventCountsByName(src);
  const total = filter.name !== undefined ? counts.get(filter.name) ?? 0 : [...counts.values()].reduce((n, c) => n + c, 0);
  return {
    events,
    total,
    lastSeq,
    retentionDays: store.retentionDays,
    bound: `I keep events for ${store.retentionDays} days of use; older ones are swept unless a replay latch holds them. ` + "This is what I still have, not everything that ever happened.",
    absent: events.length === 0 ? everLived ? NONE : NEVER : null,
    vocabulary: DURABLE_EVENT_NAMES.map((name) => {
      const count = counts.get(name) ?? 0;
      return {
        name,
        count,
        description: DURABLE_EVENTS[name],
        absent: count === 0 ? NEVER : null,
        node: FLOW_NODES.find((nd) => eventsOfNode(nd.key).includes(name))?.key ?? null
      };
    })
  };
}
function newestIn(rows, limit, keep) {
  const out = [];
  for (let i = rows.length - 1;i >= 0 && out.length < limit; i--) {
    const r = rows[i];
    if (r !== undefined && keep(r))
      out.push(r);
  }
  return out;
}
function foldedNewest(store, rows, limit, keep) {
  const lines = [];
  let groups = 0;
  let last = null;
  for (let i = rows.length - 1;i >= 0; i--) {
    const r = rows[i];
    if (r === undefined || !keep(r))
      continue;
    const line = narrate(store, r);
    if (last === null || line.text !== last.text || line.name !== last.name) {
      groups += 1;
      if (groups > limit)
        break;
    }
    last = line;
    lines.push(line);
  }
  return mergeRepeats(lines);
}
export function eventDetail(src, seq) {
  const store = src.store;
  for (const row of store.eventLog({ limit: LOG_CEILING, order: "desc" })) {
    if (row.seq === seq)
      return { found: true, event: narrate(store, row), when: localClock(row.at, store.zone()) };
  }
  return { found: false, event: null, when: null };
}
