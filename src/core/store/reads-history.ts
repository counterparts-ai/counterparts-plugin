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

export function eventLogCensus(store: Store): EventLogCensus {
  const cutoffDay = store.livedDay() - store.retentionDays;
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
  const past = store["ops"].get<{ eligible: number; latched: number }>(
    `SELECT COUNT(*) - COUNT(dedup_key) AS eligible,
              COUNT(dedup_key) AS latched
         FROM events WHERE day < ?`,
    cutoffDay,
  );
  return {
    rows: totals?.total ?? 0,
    latched: totals?.latched ?? 0,
    oldestDay: totals?.oldest_day ?? null,
    oldestAt: totals?.oldest_at ?? null,
    newestDay: totals?.newest_day ?? null,
    cutoffDay,
    retentionDays: store.retentionDays,
    eligible: past?.eligible ?? 0,
    latchedPastCutoff: past?.latched ?? 0,
  };
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
