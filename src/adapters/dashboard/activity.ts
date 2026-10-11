/**
 * `activity` — what has happened lately, resolved at render.
 *
 * The event log is content-BY-REFERENCE by law (store §5 G10): ids, hashes,
 * counts, scores, kinds, tiers — never body text, never a user turn. That law is
 * what keeps the log from becoming the verbatim honeypot the design rejects, and
 * it is exactly what makes this view necessary: a feed of raw rows is a wall of
 * hex. So every id in a row — its `ref`, and every id-shaped value inside its
 * payload — is resolved HERE, at the moment of printing (scar §2.20).
 *
 * Which means the feed tells the truth as of now: a memory the owner removed
 * this morning reads as removed in a line written three days ago, because the
 * line never held its text.
 *
 * The feed is honest about its own bounds. Events are bounded-retention
 * telemetry, not canonical memory — `pruneEvents` sweeps them past H lived days,
 * keeping only the ones latched by a `dedupKey`. A feed that showed six rows
 * without saying that would be quietly claiming six things ever happened.
 */
import { localClock } from "../../core/time.js";
import { PLAIN } from "./ansi.js";
import type { Style } from "./ansi.js";
import { NEVER, NONE, heading, indent, plural, stack, subheading, table, truncate } from "./layout.js";
import { DURABLE_EVENTS, DURABLE_EVENT_NAMES } from "./registries.js";
import { resolvePayload, resolveRef } from "./resolve.js";
import type { DashboardSource } from "./source.js";

export const DEFAULT_FEED = 30;
/** The most rows one feed reads, newest first. */
const FEED_CEILING = 1000;

export interface ActivityOptions {
  readonly style?: Style;
  readonly limit?: number;
  /** Only this event name. */
  readonly name?: string;
  /** Only events about this id (the stored ref, not the resolved head). */
  readonly ref?: string;
}

export function renderActivity(src: DashboardSource, opts: ActivityOptions = {}): string {
  const style = opts.style ?? PLAIN;
  const store = src.store;
  const limit = opts.limit ?? DEFAULT_FEED;

  const filter: { name?: string; ref?: string; limit: number; order: "desc" } = { limit: FEED_CEILING, order: "desc" };
  if (opts.name !== undefined) filter.name = opts.name;
  if (opts.ref !== undefined) filter.ref = opts.ref;

  // Newest first is what "lately" means, and it has to be asked of the store:
  // an ascending read with a limit is the OLDEST rows, so past the ceiling the
  // feed printed last month as lately.
  const all = store.eventLog(filter);
  const shown = all.slice(0, limit);
  // How many the log holds, counted in SQL where it can be; a `ref` filter has
  // no grouped count, so its read is the count and a full one says "at least".
  const held =
    opts.ref === undefined
      ? store
          .eventCounts()
          .filter((c) => opts.name === undefined || c.name === opts.name)
          .reduce((n, c) => n + c.count, 0)
      : all.length;
  const atLeast = opts.ref !== undefined && all.length >= FEED_CEILING;

  const bound =
    `I keep events for ${plural(store.retentionDays, "lived day")}; older ones are swept unless ` +
    "a replay latch holds them. This is what I still have, not everything that ever happened.";

  if (shown.length === 0) {
    return stack(
      heading("What has happened lately", style),
      style.warn(`${NONE} — my durable log is empty.`),
      vocabulary(src, style),
      `${subheading("The bounds of this feed", style)}\n${indent(bound)}`,
    );
  }

  const rows: string[][] = [];
  for (const row of shown) {
    const when = localClock(row.at, store.zone());
    const subject = row.ref === null ? style.dim("—") : resolveRef(store, row.ref, 44).label;
    rows.push([`day ${row.day}`, style.dim(when), row.name, subject]);
    const detail = payloadLine(src, row.payload, style);
    if (detail !== null) rows.push(["", "", "", indentDetail(detail)]);
  }

  return stack(
    heading("What has happened lately", style),
    indent(table(rows)),
    vocabulary(src, style),
    `${subheading("The bounds of this feed", style)}\n${indent(bound)}`,
    `Showing ${shown.length} of ${atLeast ? "at least " : ""}${plural(held, "event")} I hold.`,
  );
}

/**
 * TOTALITY, applied to the log (CONTRACT §5 [M], scar §2.17). Every event name
 * that can reach box 2 is listed with its count — filters and all — so "prune
 * has never once fired" reads as a sentence instead of as an absence of rows.
 * This is the block that would have caught v1's starved curation path.
 */
function vocabulary(src: DashboardSource, style: Style): string {
  // One grouped query for every name (INTERFACE-GAPS §5), exact rather than
  // capped at a read ceiling; a name with no rows is absent from it.
  const counts = new Map(src.store.eventCounts().map((c) => [c.name, c.count]));
  const rows = DURABLE_EVENT_NAMES.map((name) => {
    const count = counts.get(name) ?? 0;
    return [
      name,
      count === 0 ? style.warn(NEVER) : String(count),
      DURABLE_EVENTS[name],
    ];
  });
  return `${subheading("Everything I am able to record durably, and how often I have", style)}\n${indent(
    table(rows, { right: [1] }),
  )}`;
}

function indentDetail(detail: string): string {
  return `↳ ${detail}`;
}

function payloadLine(src: DashboardSource, payload: string | null, style: Style): string | null {
  if (payload === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return style.warn("(payload unreadable)");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return truncate(String(parsed), 72);
  }
  return resolvePayload(src.store, parsed as Record<string, unknown>, 40)
    .map((p) => `${p.key} ${p.value}`)
    .join(" · ");
}
