/** `Store`'s reads of its history — dreams, reflections, contradictions, the core's events, the event log and the gate's records (bodies moved out of `store/index.ts`, 2026-10-11; the class keeps a delegate, and its doc comment, for each). */
import type { Band } from "../types.js";
import type {
  CoreEventRow,
  ReflectionRow,
  ContradictionRow,
  SettleRow,
  DreamRow,
  EventRow,
  GateSessionRow,
} from "./operational.js";
import type { DreamShownRow, EventLogFilter, EventCount, EventLogCensus, RankingRow } from "./shapes.js";
import type { Store } from "./index.js";
import { EVENTS_ROLLED_EVENT, SHORT_RETENTION_DAYS, SHORT_RETENTION_NAMES } from "./operational.js";
import { rolledOf } from "../event-rollup.js";
import type { RolledDay } from "../event-rollup.js";

export function coreEvents(store: Store, filter: { memoryId?: string; action?: string; sinceAt?: number; limit?: number } = {}): CoreEventRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.memoryId !== undefined) {
    where.push("memory_id = ?");
    args.push(filter.memoryId);
  }
  if (filter.action !== undefined) {
    where.push("action = ?");
    args.push(filter.action);
  }
  if (filter.sinceAt !== undefined) {
    where.push("at >= ?");
    args.push(filter.sinceAt);
  }
  const sql = `SELECT * FROM core_events${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`;
  args.push(filter.limit ?? 1_000);
  return store["ops"].all<CoreEventRow>(sql, ...args);
}

export function reflections(store: Store, filter: { limit?: number; dreamId?: string } = {}): ReflectionRow[] {
  return filter.dreamId === undefined
    ? store["ops"].all<ReflectionRow>("SELECT * FROM reflections ORDER BY started_at DESC, rowid DESC LIMIT ?", filter.limit ?? 100)
    : store["ops"].all<ReflectionRow>(
        "SELECT * FROM reflections WHERE dream_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?",
        filter.dreamId,
        filter.limit ?? 100,
      );
}

export function coreReconsidering(store: Store): { id: string; day: number; reason: string | null; at: number }[] {
  return store["ops"].all<{ id: string; day: number; reason: string | null; at: number }>(
    `SELECT e.memory_id AS id, e.day AS day, e.reason AS reason, e.at AS at
         FROM core_events e JOIN memories m ON m.id = e.memory_id
        WHERE e.action = 'reconsidering' AND m.promoted_identity = 1 AND m.archived = 0
          AND e.seq = (SELECT MAX(seq) FROM core_events x WHERE x.memory_id = e.memory_id
                         AND x.action IN ('promoted', 'demoted', 'reconsidering', 'reaffirmed'))
        ORDER BY e.seq`,
  );
}

export function contradictionsOf(store: Store, ids: readonly string[]): Map<string, ContradictionRow[]> {
  const out = new Map<string, ContradictionRow[]>();
  if (ids.length === 0 || !store["hasTable"]("contradictions")) return out;
  const stmt = store["ops"].prepare(
    `SELECT * FROM contradictions WHERE state != 'withdrawn' AND (a = ? OR b = ?)
        ORDER BY created_at DESC, rowid DESC`,
  );
  for (const id of new Set(ids)) {
    const rows = stmt.all<ContradictionRow>(id, id);
    if (rows.length > 0) out.set(id, rows);
  }
  return out;
}

export function contradictions(store: Store, filter: { state?: string; sinceAt?: number; limit?: number } = {}): ContradictionRow[] {
  if (!store["hasTable"]("contradictions")) return [];
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.state !== undefined) {
    where.push("state = ?");
    args.push(filter.state);
  }
  if (filter.sinceAt !== undefined) {
    where.push("updated_at >= ?");
    args.push(filter.sinceAt);
  }
  args.push(filter.limit ?? 1_000);
  return store["ops"].all<ContradictionRow>(
    `SELECT * FROM contradictions${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    ...args,
  );
}

export function contradictionSettles(store: Store, filter: { pairId?: string; sinceAt?: number; limit?: number } = {}): SettleRow[] {
  if (!store["hasTable"]("contradiction_settles")) return [];
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.pairId !== undefined) {
    where.push("pair_id = ?");
    args.push(filter.pairId);
  }
  if (filter.sinceAt !== undefined) {
    where.push("at >= ?");
    args.push(filter.sinceAt);
  }
  args.push(filter.limit ?? 1_000);
  return store["ops"].all<SettleRow>(
    `SELECT * FROM contradiction_settles${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY seq LIMIT ?`,
    ...args,
  );
}

export function foldsCiting(store: Store, id: string): string[] {
  const rows = store["ops"].all<{ id: string; meta: string | null }>(
    `SELECT id, meta FROM memories
        WHERE archived = 0 AND superseded_by IS NULL AND source = 'dreamed'
          AND meta LIKE '%"fold"%' AND meta LIKE ?
        ORDER BY COALESCE(created_at, 0), id`,
    `%"${id}"%`,
  );
  const out: string[] = [];
  for (const r of rows) {
    try {
      const m = JSON.parse(r.meta ?? "{}") as Record<string, unknown>;
      if (m["fold"] === true && Array.isArray(m["sources"]) && (m["sources"] as unknown[]).includes(id)) out.push(r.id);
    } catch {
      /* an unreadable bag names nothing */
    }
  }
  return out;
}

export function contradictionBetween(store: Store, x: string, y: string): ContradictionRow | undefined {
  if (!store["hasTable"]("contradictions")) return undefined;
  return store["ops"].get<ContradictionRow>(
    `SELECT * FROM contradictions
        WHERE state != 'withdrawn' AND ((a = ? AND b = ?) OR (a = ? AND b = ?))
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    x,
    y,
    y,
    x,
  );
}

export function dreams(store: Store, filter: { limit?: number; sinceAt?: number } = {}): DreamRow[] {
  return filter.sinceAt === undefined
    ? store["ops"].all<DreamRow>("SELECT * FROM dreams ORDER BY started_at DESC, id DESC LIMIT ?", filter.limit ?? 100)
    : store["ops"].all<DreamRow>(
        "SELECT * FROM dreams WHERE started_at >= ? ORDER BY started_at DESC, id DESC LIMIT ?",
        filter.sinceAt,
        filter.limit ?? 100,
      );
}

export function dreamsShown(store: Store, filter: { sinceDay?: number } = {}): DreamShownRow[] {
  const cols = "SELECT id, day, date, state, started_at, shown FROM dreams";
  const order = "ORDER BY started_at ASC, id ASC";
  return filter.sinceDay === undefined
    ? store["ops"].all<DreamShownRow>(`${cols} ${order}`)
    : store["ops"].all<DreamShownRow>(`${cols} WHERE day >= ? ${order}`, filter.sinceDay);
}

export function eventLog(store: Store, filter: EventLogFilter = {}): EventRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.name !== undefined) {
    where.push("name = ?");
    args.push(filter.name);
  }
  if (filter.ref !== undefined) {
    where.push("ref = ?");
    args.push(filter.ref);
  }
  if (filter.sinceDay !== undefined) {
    where.push("day >= ?");
    args.push(filter.sinceDay);
  }
  const sql =
    "SELECT * FROM events" +
    (where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`) +
    ` ORDER BY seq ${filter.order === "desc" ? "DESC" : "ASC"} LIMIT ?`;
  return store["ops"].all<EventRow>(sql, ...args, filter.limit ?? 500);
}

export function eventCounts(store: Store, filter: { sinceDay?: number; sinceAt?: number } = {}): EventCount[] {
  const where: string[] = [];
  const args: number[] = [];
  if (filter.sinceDay !== undefined) {
    where.push("day >= ?");
    args.push(filter.sinceDay);
  }
  if (filter.sinceAt !== undefined) {
    where.push("at >= ?");
    args.push(filter.sinceAt);
  }
  const rows = store["ops"].all<{ name: string; n: number; newest_at: number; newest_day: number; newest_seq: number }>(
    "SELECT name, COUNT(*) AS n, MAX(at) AS newest_at, MAX(day) AS newest_day, MAX(seq) AS newest_seq" +
      " FROM events" +
      (where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`) +
      " GROUP BY name ORDER BY name",
    ...args,
  );
  return rows.map((r) => ({
    name: r.name,
    count: r.n,
    newestAt: r.newest_at,
    newestDay: r.newest_day,
    newestSeq: r.newest_seq,
  }));
}

/**
 * THE SWEEP'S WINDOW AS ONE PREDICATE (FD1 step 2), so the delete, its count
 * and the census can never disagree: an unlatched row is past the window when
 * it is one of `SHORT_RETENTION_NAMES` older than the short cutoff, or any
 * other name older than `retentionDays`. The short window is never longer
 * than the store's own.
 */
export function eventWindow(store: Store): {
  sql: string;
  args: (string | number)[];
  cutoffDay: number;
  shortCutoffDay: number;
  shortRetentionDays: number;
} {
  const day = store.livedDay();
  const cutoffDay = day - store.retentionDays;
  const shortRetentionDays = Math.min(SHORT_RETENTION_DAYS, store.retentionDays);
  const shortCutoffDay = day - shortRetentionDays;
  if (SHORT_RETENTION_NAMES.length === 0) {
    return { sql: "dedup_key IS NULL AND day < ?", args: [cutoffDay], cutoffDay, shortCutoffDay, shortRetentionDays };
  }
  const marks = SHORT_RETENTION_NAMES.map(() => "?").join(", ");
  return {
    sql: `dedup_key IS NULL AND ((name IN (${marks}) AND day < ?) OR (name NOT IN (${marks}) AND day < ?))`,
    args: [...SHORT_RETENTION_NAMES, shortCutoffDay, ...SHORT_RETENTION_NAMES, cutoffDay],
    cutoffDay,
    shortCutoffDay,
    shortRetentionDays,
  };
}

/**
 * THE DAILY SUMMARIES (FD1 step 2): every `events.rolled` row, parsed, oldest
 * first, with its own seq. A rolled day's per-turn rows that are still held
 * (a capped sweep leaves a day half-deleted) are ALREADY in its summary: an
 * all-time reader counts the summary and skips those rows (`days`).
 */
export function rolledDays(store: Store): { rows: (RolledDay & { seq: number; at: number })[]; days: Set<number> } {
  const out: (RolledDay & { seq: number; at: number })[] = [];
  for (const r of store["ops"].all<{ seq: number; at: number; day: number; payload: string | null }>(
    "SELECT seq, at, day, payload FROM events WHERE name = ? ORDER BY day, seq",
    EVENTS_ROLLED_EVENT,
  )) {
    const rolled = rolledOf(r.payload, r.day);
    if (rolled !== null) out.push({ ...rolled, seq: r.seq, at: r.at });
  }
  return { rows: out, days: new Set(out.map((r) => r.day)) };
}

/**
 * EVERY NAME'S ALL-TIME COUNT (FD1 step 2, roadmap ruling R2): the rows held,
 * plus each daily summary's counts, minus the held per-turn rows of a day a
 * summary already counts. So a count shown as all-time never shrinks when the
 * sweep lets the rows go. Newest fields come from the held rows, or from the
 * summaries for a name that has none held. Read-only.
 */
export function eventCountsAllTime(store: Store): EventCount[] {
  const live = eventCounts(store);
  const rolled = rolledDays(store);
  if (rolled.rows.length === 0) return live;
  const byName = new Map(live.map((c) => [c.name, { ...c }]));
  const days = [...rolled.days];
  const dayMarks = days.map(() => "?").join(", ");
  const nameMarks = SHORT_RETENTION_NAMES.map(() => "?").join(", ");
  if (SHORT_RETENTION_NAMES.length > 0) {
    for (const r of store["ops"].all<{ name: string; n: number }>(
      `SELECT name, COUNT(*) AS n FROM events WHERE dedup_key IS NULL AND name IN (${nameMarks}) AND day IN (${dayMarks}) GROUP BY name`,
      ...SHORT_RETENTION_NAMES,
      ...days,
    )) {
      const c = byName.get(r.name);
      if (c !== undefined) c.count -= r.n;
    }
  }
  // A name with nothing held outside the rolled days takes its newest from the summaries.
  const fromRolled = new Set([...byName.values()].filter((c) => c.count <= 0).map((c) => c.name));
  for (const day of rolled.rows) {
    for (const [name, n] of Object.entries(day.counts)) {
      if (typeof n !== "number") continue;
      const lastAt = day.spans[name]?.lastAt ?? day.at;
      const c = byName.get(name);
      if (c === undefined) {
        byName.set(name, { name, count: n, newestAt: lastAt, newestDay: day.day, newestSeq: day.seq });
        fromRolled.add(name);
        continue;
      }
      if (fromRolled.has(name)) {
        // Oldest first, so the last summary read is the newest.
        c.newestAt = lastAt;
        c.newestDay = day.day;
        c.newestSeq = day.seq;
      }
      c.count += n;
    }
  }
  return [...byName.values()].filter((c) => c.count > 0).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function eventLogCensus(store: Store): EventLogCensus {
  const window = eventWindow(store);
  const cutoffDay = window.cutoffDay;
  const totals = store["ops"].get<{
    total: number;
    latched: number;
    oldest_day: number | null;
    oldest_at: number | null;
    newest_day: number | null;
  }>(
    `SELECT COUNT(*) AS total,
              COUNT(dedup_key) AS latched,
              MIN(day) AS oldest_day,
              MIN(at) AS oldest_at,
              MAX(day) AS newest_day
         FROM events`,
  );
  const latchedPast = store["ops"].get<{ latched: number }>(
    "SELECT COUNT(dedup_key) AS latched FROM events WHERE day < ?",
    cutoffDay,
  );
  const eligible = store["ops"].get<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE ${window.sql}`, ...window.args);
  const past = { eligible: eligible?.n ?? 0, latched: latchedPast?.latched ?? 0 };
  return {
    rows: totals?.total ?? 0,
    latched: totals?.latched ?? 0,
    oldestDay: totals?.oldest_day ?? null,
    oldestAt: totals?.oldest_at ?? null,
    newestDay: totals?.newest_day ?? null,
    cutoffDay,
    retentionDays: store.retentionDays,
    eligible: past.eligible,
    latchedPastCutoff: past.latched,
    shortCutoffDay: window.shortCutoffDay,
    shortRetentionDays: window.shortRetentionDays,
  };
}

/**
 * THE MOMENT A LIVED DAY BEGAN, as the log saw it (FD1 step 2): the earliest
 * `at` among rows written on lived day `day` or later, or null when the log
 * holds none. Tables whose rows carry a wall-clock `created_at` (edges, cue
 * pairs) and the archive's `updated_at` are counted "in the last N lived days"
 * from it, so every growth window runs on the store's one lived clock.
 */
export function livedDayStartAt(store: Store, day: number): number | null {
  return store["ops"].get<{ at: number | null }>("SELECT MIN(at) AS at FROM events WHERE day >= ?", day)?.at ?? null;
}

/**
 * THE GROWING ASSOCIATION TABLES COUNTED (FD1 step 2, 2026-11-07): rows held,
 * and rows first written at or after `sinceAt`, for the tables that carry a
 * `created_at` (`edges` since v7, `cue_edges` since v15; a row with none
 * counts as old). `cues` is null on a store without the table. Read-only.
 *
 * A BIAS, said (review of #776): `recent` counts the rows that are still
 * there, so a pair or edge born and swept inside the window is counted as
 * swept but not as new, and "new" reads a little low against "swept".
 */
function tableGrowth(store: Store, table: "edges" | "cue_edges", sinceAt: number): { rows: number; recent: number } {
  const r = store["ops"].get<{ rows: number; recent: number | null }>(
    `SELECT COUNT(*) AS rows, SUM(CASE WHEN COALESCE(created_at, 0) >= ? THEN 1 ELSE 0 END) AS recent FROM ${table}`,
    sinceAt,
  );
  return { rows: r?.rows ?? 0, recent: r?.recent ?? 0 };
}

export function growthCounts(store: Store, sinceAt: number): {
  edges: { rows: number; recent: number };
  cues: { rows: number; recent: number } | null;
} {
  const hasCues = store["ops"].get<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'cue_edges'")?.n === 1;
  return { edges: tableGrowth(store, "edges", sinceAt), cues: hasCues ? tableGrowth(store, "cue_edges", sinceAt) : null };
}

/** The `edges` half of `growthCounts` alone (the Association line, which runs at session start). */
export function edgeGrowth(store: Store, sinceAt: number): { rows: number; recent: number } {
  return tableGrowth(store, "edges", sinceAt);
}

/**
 * THE EVENT LOG'S SIZE ON DISK (FD1 step 2): the pages of `events` and its
 * indexes from SQLite's `dbstat` when this build of SQLite has it (`exact`),
 * else the columns' lengths plus a fixed cost per row (an estimate). Read-only.
 */
export function eventLogBytes(store: Store): { bytes: number; exact: boolean } {
  const ops = store["ops"];
  try {
    const b = ops.get<{ b: number | null }>(
      "SELECT SUM(pgsize) AS b FROM dbstat WHERE name IN ('events', 'events_dedup', 'events_name', 'events_day')",
    );
    return { bytes: b?.b ?? 0, exact: true };
  } catch {
    const b = ops.get<{ b: number | null }>(
      "SELECT SUM(LENGTH(name) + COALESCE(LENGTH(ref), 0) + COALESCE(LENGTH(dedup_key), 0) + COALESCE(LENGTH(payload), 0) + 40) AS b FROM events",
    );
    return { bytes: b?.b ?? 0, exact: false };
  }
}

export function gateRecords(store: Store, sessionId: string, kind?: string): GateSessionRow[] {
  return kind === undefined
    ? store["ops"].all<GateSessionRow>(
        "SELECT * FROM gate_session WHERE session_id = ? ORDER BY kind, ref",
        sessionId,
      )
    : store["ops"].all<GateSessionRow>(
        "SELECT * FROM gate_session WHERE session_id = ? AND kind = ? ORDER BY ref",
        sessionId,
        kind,
      );
}

export function rankingAll(store: Store): Map<string, RankingRow> {
  const out = new Map<string, RankingRow>();
  for (const row of store["cache"].all<{
    memory_id: string;
    strength: number;
    band: string;
    day: number;
  }>("SELECT * FROM ranking")) {
    out.set(row.memory_id, {
      id: row.memory_id,
      strength: row.strength,
      band: row.band as Band,
      day: row.day,
    });
  }
  return out;
}
