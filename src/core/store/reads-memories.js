import { calendarOverlaps, compareCalendarDates } from "../time.js";
import { LATER_FEELING_SOURCES } from "./feelings.js";
import { TUNABLES as PHYSICS_TUNABLES } from "../physics/index.js";
import { StoreError } from "./errors.js";
import {
  CLAIMS_ERA_CUTOFF_KEY,
  rowToPhysics,
  RECURRING_META,
  CLAIMS_ERA_RECORDED_KEY,
  ERA_WRITTEN_AT_META,
  reachExempt
} from "./operational.js";
import { readNeighbours, allVectors, rankAgainst, NEIGHBOURS_KEPT, writeNeighbours } from "./cache.js";
import { recurrenceOfRow } from "./shapes.js";
import { aboutMarkOf, STATUSES } from "./marks.js";
const LATER_SQL = LATER_FEELING_SOURCES.map((x) => `'${x}'`).join(", ");
const RECORDED_LATER_SQL = ["dream", ...LATER_FEELING_SOURCES].map((x) => `'${x}'`).join(", ");
const MAX_CHAIN = 32;
const NIGHTLY_SQL = `(COALESCE(source, '') IN ('dreamed', 'reflection')
  OR COALESCE(origin_ref, '') LIKE 'dream:%' OR COALESCE(origin_ref, '') LIKE 'reflection:%')`;
export function row(store, id) {
  return store["ops"].get(`SELECT m.*,
              (SELECT value FROM meta WHERE key = 'lastActiveDate') AS today_date,
              (SELECT value FROM meta WHERE key = '${CLAIMS_ERA_CUTOFF_KEY}') AS claims_era_cutoff,
              COALESCE(
                (SELECT MAX(f.strength) FROM feelings f
                  WHERE f.memory_id = m.id AND f.source IN (${RECORDED_LATER_SQL})
                    AND f.created_at = (SELECT MAX(g.created_at) FROM feelings g WHERE g.memory_id = m.id AND g.source IN (${RECORDED_LATER_SQL}))),
                (SELECT MAX(f.strength) FROM feelings f WHERE f.memory_id = m.id)) AS feeling_peak,
              (SELECT MAX(f.strength) FROM feelings f
                WHERE f.memory_id = m.id AND (f.source IS NULL OR f.source NOT IN (${LATER_SQL}))) AS feeling_peak_lived
         FROM memories m WHERE m.id = ?`, id);
}
export function read(store, id) {
  const row = store["requireRow"](id);
  const doc = store["docOf"](row);
  if (row.archived === 1) {
    store["emit"]("store.archived.read", id, { reason: row.archived_reason });
  }
  return {
    doc,
    physics: rowToPhysics(row),
    band: row.band,
    bandDay: row.band_day,
    archived: row.archived === 1,
    archivedReason: row.archived_reason,
    supersededBy: row.superseded_by,
    revision: row.revision,
    contentHash: row.content_hash,
    confidential: row.confidential === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    model: row.model,
    about: aboutMarkOf(row.about),
    aboutBy: row.about_by ?? null
  };
}
export function resolve(store, id) {
  let current = id;
  const seen = new Set;
  for (let depth = 0;depth <= MAX_CHAIN; depth++) {
    if (seen.has(current))
      throw new StoreError("ID_CYCLE", { id, at: current });
    seen.add(current);
    if (store["isDenied"](current))
      return current;
    const row = store.row(current);
    if (row === undefined) {
      throw new StoreError(current === id ? "ID_UNKNOWN" : "ID_DANGLING", { id, at: current });
    }
    if (row.superseded_by === null)
      return current;
    current = row.superseded_by;
  }
  throw new StoreError("ID_CHAIN_TOO_DEEP", { id, max: MAX_CHAIN });
}
export function copiesOf(store, refs) {
  const out = new Map;
  const unique = [...new Set(refs)];
  const CHUNK = 500;
  for (let i = 0;i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const rows = store["ops"].all(`SELECT id, origin_ref, confidential, about FROM memories
          WHERE type = 'memory' AND archived = 0 AND origin_ref IN (${part.map(() => "?").join(", ")})
          ORDER BY id`, ...part);
    for (const r of rows) {
      const held = out.get(r.origin_ref) ?? [];
      held.push({ id: r.id, confidential: r.confidential === 1, about: r.about });
      out.set(r.origin_ref, held);
    }
  }
  return out;
}
export function workCandidates(store, scope, limit) {
  return store["ops"].all(`SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND origin_scope = ?
            AND band != 'identity' AND event_date IS NULL AND confidential = 0 AND body != ''
            AND (about = 'work' OR (about IS NULL AND kind IN ('skill', 'fact', 'entity', 'place')))
          ORDER BY MAX(birth_day, last_used_day) DESC, id
          LIMIT ?`, scope, Math.max(0, Math.floor(limit))).map((r) => r.id);
}
export function planCandidates(store, input) {
  const scopes = input.scopes.filter((s) => s.length > 0);
  const statuses = input.statuses.filter((s) => STATUSES.includes(s));
  if (scopes.length === 0 || input.limit <= 0)
    return [];
  const marks = (n) => Array.from({ length: n }, () => "?").join(", ");
  const status = statuses.length === 0 ? "" : `status IN (${marks(statuses.length)}) OR `;
  return store["ops"].all(`SELECT id FROM memories
          WHERE type = 'memory' AND archived = 0 AND superseded_by IS NULL AND body != ''
            AND source = 'authored' AND origin_scope IN (${marks(scopes.length)}) AND created_at > ?
            ${input.confidential === true ? "" : "AND confidential = 0"}
            AND (${status}meta LIKE '%"unresolved":true%')
          ORDER BY created_at DESC, id
          LIMIT ?`, ...scopes, input.after, ...statuses, Math.max(0, Math.floor(input.limit))).map((r) => r.id);
}
export function datedMemories(store, from, to, opts = {}) {
  const rows = store["ops"].all(`SELECT id, event_date FROM memories
        WHERE event_date IS NOT NULL AND event_date <= ?${opts.archived === true ? "" : " AND archived = 0"}`, `${to}~`);
  return rows.filter((r) => calendarOverlaps(r.event_date, from, to)).sort((a, b) => compareCalendarDates(a.event_date, b.event_date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => ({ id: r.id, eventDate: r.event_date }));
}
export function recurringMemories(store, opts = {}) {
  const rows = store["ops"].all(`SELECT id, event_date, meta FROM memories
        WHERE event_date IS NOT NULL AND meta LIKE '%"${RECURRING_META}":"%'${opts.archived === true ? "" : " AND archived = 0"}
        ORDER BY id`);
  const out = [];
  for (const r of rows) {
    const rule = recurrenceOfRow(r);
    if (rule !== null)
      out.push({ id: r.id, eventDate: r.event_date, recurring: rule });
  }
  return out;
}
export function recallRows(store) {
  const v12 = store.hasColumn("memories", "occurred_on");
  return store["ops"].all(`SELECT id, type, kind, title, learned_on, created_at, updated_at,
              ${v12 ? "occurred_on, said_by, status" : "NULL AS occurred_on, NULL AS said_by, NULL AS status"},
              source, origin_session, origin_scope, origin_ref, confidential,
              CASE WHEN type = 'memory' THEN NULL ELSE meta END AS meta
         FROM memories
        WHERE archived = 0 AND superseded_by IS NULL AND NOT (body = '' AND content_hash = '')
        ORDER BY id`);
}
export function memoriesWrittenSince(store, at) {
  return store["ops"].all(`SELECT id, origin_session, created_at, birth_day, ${NIGHTLY_SQL} AS nightly FROM memories
          WHERE type = 'memory' AND created_at >= ? AND origin_session IS NOT NULL
            AND archived = 0 AND superseded_by IS NULL
          ORDER BY created_at, rowid`, at).map((r) => ({ id: r.id, session: r.origin_session, at: r.created_at, bornDay: r.birth_day, nightly: r.nightly === 1 }));
}
export function memoryCountsByScopeSince(store, at, opts = {}) {
  return store["ops"].all(`SELECT origin_scope, COUNT(*) AS n FROM memories
          WHERE type = 'memory' AND created_at IS NOT NULL AND created_at >= ? AND origin_scope IS NOT NULL AND origin_scope != ''
            AND archived = 0 AND superseded_by IS NULL AND NOT ${NIGHTLY_SQL}
            ${opts.confidential === true ? "" : "AND confidential = 0"}
          GROUP BY origin_scope
          ORDER BY n DESC, origin_scope`, at).map((r) => ({ scope: r.origin_scope, count: r.n }));
}
export function memoriesOfSession(store, session) {
  return store["ops"].all(`SELECT id, origin_session, created_at, birth_day FROM memories
          WHERE type = 'memory' AND origin_session = ? AND created_at IS NOT NULL
            AND archived = 0 AND superseded_by IS NULL AND NOT ${NIGHTLY_SQL}
          ORDER BY created_at, rowid`, session).map((r) => ({ id: r.id, session: r.origin_session, at: r.created_at, bornDay: r.birth_day }));
}
export function readVersion(store, id, seq) {
  store["refuseIfDenied"](id);
  const row = store["ops"].get("SELECT * FROM versions WHERE memory_id = ? AND seq = ?", id, seq);
  if (row === undefined)
    throw new StoreError("VERSION_UNKNOWN", { id, seq });
  store["emit"]("store.version.read", id, { seq, reason: row.reason });
  return store["versionDoc"](id, row);
}
export function tombstones(store) {
  const rows = store["ops"].all(`SELECT t.*,
              (SELECT r.stage FROM removal_record r
                WHERE r.memory_id = t.memory_id ORDER BY r.seq DESC LIMIT 1) AS last_stage,
              (SELECT COUNT(*) FROM memories m WHERE m.id = t.memory_id) AS row_survives
         FROM removal_tombstone t
        ORDER BY t.memory_id`);
  return rows.map((r) => ({
    id: r.memory_id,
    type: r.type,
    kind: r.kind,
    band: r.band,
    wasProtected: r.protected === 1,
    wasPromotedIdentity: r.promoted_identity === 1,
    supersededBy: r.superseded_by,
    stage: r.last_stage ?? "dark",
    at: r.at,
    rowSurvives: r.row_survives > 0,
    chased: {
      versions: r.versions,
      edges: r.edges,
      prospective: r.prospective,
      gateRows: r.gate_rows
    }
  }));
}
export function removalRecord(store, id) {
  const rows = id === undefined ? store["ops"].all("SELECT * FROM removal_record ORDER BY seq") : store["ops"].all("SELECT * FROM removal_record WHERE memory_id = ? ORDER BY seq", id);
  store["emit"]("store.removalRecord.read", id, { rows: rows.length });
  return rows;
}
export function newMemoryIds(store, filter) {
  const base = `SELECT id FROM memories
                   WHERE type = 'memory' AND archived = 0 AND superseded_by IS NULL AND protected = 0
                     AND (source IS NULL OR source != 'dreamed')
                     AND (origin_ref IS NULL OR origin_ref NOT LIKE 'dream:%')`;
  const order = "ORDER BY COALESCE(created_at, 0) DESC, birth_day DESC, id LIMIT ?";
  const limit = filter.limit ?? -1;
  const rows = filter.sinceAt === null ? filter.beforeDay === undefined ? store["ops"].all(`${base} AND birth_day >= ? ${order}`, filter.sinceDay, limit) : store["ops"].all(`${base} AND birth_day >= ? AND birth_day < ? ${order}`, filter.sinceDay, filter.beforeDay, limit) : store["ops"].all(`${base} AND (created_at > ? OR (created_at IS NULL AND birth_day > ?)) ${order}`, filter.sinceAt, filter.sinceDay, limit);
  return rows.map((r) => r.id);
}
export function writeFieldShare(store, since) {
  if (!store.hasColumn("memories", "occurred_on"))
    return null;
  const row = store["ops"].get(`SELECT COUNT(*) AS written,
              COALESCE(SUM(occurred_on IS NOT NULL), 0) AS occurred_on,
              COALESCE(SUM(said_by IS NOT NULL), 0) AS said_by,
              COALESCE(SUM(status IS NOT NULL), 0) AS status,
              COALESCE(SUM(occurred_on IS NOT NULL AND said_by IS NOT NULL AND status IS NOT NULL), 0) AS all_three
         FROM memories
        WHERE type = 'memory' AND body != ''
          AND (source = 'dreamed' OR (source = 'authored' AND (origin_ref IS NULL OR origin_ref NOT LIKE 'dream:%')))
          AND (? IS NULL OR created_at >= ?)`, since, since);
  return {
    written: row?.written ?? 0,
    occurredOn: row?.occurred_on ?? 0,
    saidBy: row?.said_by ?? 0,
    status: row?.status ?? 0,
    all: row?.all_three ?? 0
  };
}
export function neighbourReader(store) {
  let table = null;
  return (id, limit) => {
    const vec = store.vectorOf(id);
    if (vec === null)
      return null;
    if (!store["rankable"](vec.length, "neighbourReader"))
      return [];
    const stored = readNeighbours(store["cache"], id, limit);
    if (stored !== null)
      return stored.map((h) => h.id);
    table ??= allVectors(store["cache"]);
    const hits = rankAgainst(table, vec, NEIGHBOURS_KEPT + 1).filter((h) => h.id !== id);
    if (!store.observer) {
      try {
        writeNeighbours(store["cache"], id, hits);
      } catch {}
    }
    return hits.slice(0, limit).map((h) => h.id);
  };
}
export function claimsEra(store) {
  const num = (v) => {
    const n = v === undefined || v === "" ? Number.NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const cutoff = num(store.getMeta(CLAIMS_ERA_CUTOFF_KEY));
  const recorded = num(store.getMeta(CLAIMS_ERA_RECORDED_KEY));
  let down = 0;
  let up = 0;
  if (cutoff !== null) {
    for (const { id } of store["ops"].all(`SELECT id FROM memories WHERE archived = 0 AND type = 'memory' AND claimed IS NOT NULL
           AND (created_at IS NULL OR created_at < ? OR meta LIKE '%"${ERA_WRITTEN_AT_META}"%')`, cutoff)) {
      const row = store.row(id);
      if (row === undefined || reachExempt(row) || row.claimed === null)
        continue;
      const era = rowToPhysics(row).eraClaim;
      if (typeof era !== "number")
        continue;
      if (era < row.claimed)
        down += 1;
      else
        up += 1;
    }
  }
  return { cutoff, recorded, affected: down + up, down, up };
}
export function belowReachCount(store) {
  const ranking = store.rankingAll();
  let n = 0;
  for (const r of store["ops"].all("SELECT * FROM memories WHERE archived = 0 AND type != 'episode'")) {
    if (reachExempt(r))
      continue;
    const rk = ranking.get(r.id);
    if (rk !== undefined && rk.band !== "identity" && rk.strength < PHYSICS_TUNABLES.REACH)
      n += 1;
  }
  return n;
}
export function returnCounts(store, filter = {}) {
  const r = store["ops"].get(`SELECT SUM(CASE WHEN source = 'awake' THEN 1 ELSE 0 END) AS awake,
              SUM(CASE WHEN source = 'dream' THEN 1 ELSE 0 END) AS dream,
              SUM(CASE WHEN source = 'reflection' THEN 1 ELSE 0 END) AS reflection,
              COUNT(DISTINCT CASE WHEN source != 'legacy' THEN memory_id END) AS memories
         FROM returns WHERE at >= ? AND day >= ? AND source != 'legacy'`, filter.sinceAt ?? 0, filter.sinceDay ?? -2147483648);
  return { awake: r?.awake ?? 0, dream: r?.dream ?? 0, reflection: r?.reflection ?? 0, memories: r?.memories ?? 0 };
}
