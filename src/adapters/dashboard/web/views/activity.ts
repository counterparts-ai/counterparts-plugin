/**
 * `/api/activity` and `/api/event` — the durable log, narrated.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { localClock } from "../../../../core/time.js";
import { NEVER, NONE } from "../../layout.js";
import { DURABLE_EVENTS, DURABLE_EVENT_NAMES } from "../../registries.js";
import type { DurableEventName } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import type { EventRow } from "../../../../core/store/index.js";
import { payloadOf } from "../../../mechanism-evidence.js";
import { FLOW_NODES, eventsOfNode } from "../flow.js";
import { laneOf } from "../lanes.js";
import type { Lane } from "../lanes.js";
import { narrate } from "../narrate.js";
import type { NarratedEvent } from "../narrate.js";
import { mergeRepeats } from "./mechanism-panel.js";
import { FEED_LIMIT, LOG_CEILING, eventCountsByName } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// activity
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityView {
  readonly events: NarratedEvent[];
  readonly total: number;
  readonly lastSeq: number;
  readonly retentionDays: number;
  readonly bound: string;
  readonly absent: string | null;
  readonly vocabulary: { name: DurableEventName; count: number; description: string; absent: string | null; node: string | null }[];
}

/**
 * `fold` (2026-09-27, home round 3 — a try): neighbours that read the same are
 * one line, "×N", with the span of days they cover (`mergeRepeats`, the
 * mechanism panel's rule), and `limit` counts LINES, not rows. Only the home
 * feed asks for it; the flow tab's feed stays the whole log, row by row.
 */
export function activityView(
  src: DashboardSource,
  opts: { limit?: number; name?: string; sinceSeq?: number; lane?: Lane; fold?: boolean } = {},
): ActivityView {
  const store = src.store;
  const limit = opts.limit ?? FEED_LIMIT;
  const filter: { name?: string; limit: number; order: "desc" } = { limit: LOG_CEILING, order: "desc" };
  if (opts.name !== undefined && opts.name.length > 0) filter.name = opts.name;
  // NEWEST `LOG_CEILING`, turned back to oldest first. An ascending read with a
  // limit is the OLDEST rows: past the ceiling the feed showed last month as
  // "lately" and `lastSeq` froze, so the pulse never saw a new row again.
  const all = store.eventLog(filter).reverse();
  const since = opts.sinceSeq;
  const lane = opts.lane;
  const inLane = (r: EventRow): boolean => lane === undefined || laneOf(r.name, payloadOf(r)) === lane;
  const events =
    since !== undefined
      ? all.filter((r) => r.seq > since).map((row) => narrate(store, row))
      : opts.fold === true
        ? foldedNewest(store, all, limit, inLane)
        : newestIn(all, limit, inLane).map((row) => narrate(store, row));
  const lastSeq = all.length === 0 ? 0 : (all[all.length - 1]?.seq ?? 0);
  const everLived = store.livedDay() > 0 || store.list().length > 0;
  const counts = eventCountsByName(src);
  // The total is counted in SQL, not the length of a read that stops at the ceiling.
  const total = filter.name !== undefined ? (counts.get(filter.name) ?? 0) : [...counts.values()].reduce((n, c) => n + c, 0);

  return {
    events,
    total,
    lastSeq,
    retentionDays: store.retentionDays,
    bound:
      `I keep events for ${store.retentionDays} lived days; older ones are swept unless a replay latch holds them. ` +
      "This is what I still have, not everything that ever happened.",
    absent: events.length === 0 ? (everLived ? NONE : NEVER) : null,
    vocabulary: DURABLE_EVENT_NAMES.map((name) => {
      const count = counts.get(name) ?? 0;
      return {
        name,
        count,
        description: DURABLE_EVENTS[name],
        absent: count === 0 ? NEVER : null,
        node: (FLOW_NODES.find((nd) => eventsOfNode(nd.key).includes(name))?.key ?? null),
      };
    }),
  };
}

/** The newest `limit` rows that pass `keep`, newest first. */
function newestIn(rows: readonly EventRow[], limit: number, keep: (r: EventRow) => boolean): EventRow[] {
  const out: EventRow[] = [];
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const r = rows[i];
    if (r !== undefined && keep(r)) out.push(r);
  }
  return out;
}

/** The newest rows that pass `keep`, narrated and folded, until `limit` lines stand. */
function foldedNewest(store: DashboardSource["store"], rows: readonly EventRow[], limit: number, keep: (r: EventRow) => boolean): NarratedEvent[] {
  const lines: NarratedEvent[] = [];
  let groups = 0;
  let last: NarratedEvent | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r === undefined || !keep(r)) continue;
    const line = narrate(store, r);
    if (last === null || line.text !== last.text || line.name !== last.name) {
      groups += 1;
      if (groups > limit) break;
    }
    last = line;
    lines.push(line);
  }
  return mergeRepeats(lines);
}

/** One record, opened. `when` is its moment on the reader's clock, converted
 *  here (`core/time.ts`), so the page never builds a date itself. */
export function eventDetail(
  src: DashboardSource,
  seq: number,
): { found: boolean; event: NarratedEvent | null; when: string | null } {
  const store = src.store;
  // Newest first: the rows a page links to are the recent ones.
  for (const row of store.eventLog({ limit: LOG_CEILING, order: "desc" })) {
    if (row.seq === seq) return { found: true, event: narrate(store, row), when: localClock(row.at, store.zone()) };
  }
  return { found: false, event: null, when: null };
}
