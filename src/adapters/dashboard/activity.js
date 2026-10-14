import { localClock } from "../../core/time.js";
import { PLAIN } from "./ansi.js";
import { NEVER, NONE, heading, indent, plural, stack, subheading, table, truncate } from "./layout.js";
import { DURABLE_EVENTS, DURABLE_EVENT_NAMES } from "./registries.js";
import { resolvePayload, resolveRef } from "./resolve.js";
export const DEFAULT_FEED = 30;
const FEED_CEILING = 1000;
export function renderActivity(src, opts = {}) {
  const style = opts.style ?? PLAIN;
  const store = src.store;
  const limit = opts.limit ?? DEFAULT_FEED;
  const filter = { limit: FEED_CEILING, order: "desc" };
  if (opts.name !== undefined)
    filter.name = opts.name;
  if (opts.ref !== undefined)
    filter.ref = opts.ref;
  const all = store.eventLog(filter);
  const shown = all.slice(0, limit);
  const held = opts.ref === undefined ? store.eventCounts().filter((c) => opts.name === undefined || c.name === opts.name).reduce((n, c) => n + c.count, 0) : all.length;
  const atLeast = opts.ref !== undefined && all.length >= FEED_CEILING;
  const bound = `I keep events for ${plural(store.retentionDays, "day of use", "days of use")}; older ones are swept unless ` + "a replay latch holds them. This is what I still have, not everything that ever happened.";
  if (shown.length === 0) {
    return stack(heading("What has happened lately", style), style.warn(`${NONE} — my durable log is empty.`), vocabulary(src, style), `${subheading("The bounds of this feed", style)}
${indent(bound)}`);
  }
  const rows = [];
  for (const row of shown) {
    const when = localClock(row.at, store.zone());
    const subject = row.ref === null ? style.dim("—") : resolveRef(store, row.ref, 44).label;
    rows.push([`day ${row.day}`, style.dim(when), row.name, subject]);
    const detail = payloadLine(src, row.payload, style);
    if (detail !== null)
      rows.push(["", "", "", indentDetail(detail)]);
  }
  return stack(heading("What has happened lately", style), indent(table(rows)), vocabulary(src, style), `${subheading("The bounds of this feed", style)}
${indent(bound)}`, `Showing ${shown.length} of ${atLeast ? "at least " : ""}${plural(held, "event")} I hold.`);
}
function vocabulary(src, style) {
  const counts = new Map(src.store.eventCounts().map((c) => [c.name, c.count]));
  const rows = DURABLE_EVENT_NAMES.map((name) => {
    const count = counts.get(name) ?? 0;
    return [
      name,
      count === 0 ? style.warn(NEVER) : String(count),
      DURABLE_EVENTS[name]
    ];
  });
  return `${subheading("Everything I am able to record durably, and how often I have", style)}
${indent(table(rows, { right: [1] }))}`;
}
function indentDetail(detail) {
  return `↳ ${detail}`;
}
function payloadLine(src, payload, style) {
  if (payload === null)
    return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return style.warn("(payload unreadable)");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return truncate(String(parsed), 72);
  }
  return resolvePayload(src.store, parsed, 40).map((p) => `${p.key} ${p.value}`).join(" · ");
}
