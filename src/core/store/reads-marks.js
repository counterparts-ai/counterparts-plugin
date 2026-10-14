import { localDate } from "../time.js";
import { CARD_TOMBSTONE_PREFIX } from "./operational.js";
export function feelingsOn(store, ids) {
  const out = new Map;
  if (ids.length === 0)
    return out;
  const unique = [...new Set(ids)];
  for (let at = 0;at < unique.length; at += 500) {
    const part = unique.slice(at, at + 500);
    const rows = store["ops"].all(`SELECT f.*, m.birth_day AS birth_day FROM feelings f JOIN memories m ON m.id = f.memory_id
          WHERE f.memory_id IN (${part.map(() => "?").join(",")})
          ORDER BY f.created_at, f.rowid`, ...part);
    for (const r of rows) {
      const list = out.get(r.memory_id) ?? [];
      list.push(r);
      out.set(r.memory_id, list);
    }
  }
  return out;
}
export function emotionCensus(store, opts = {}) {
  const since = opts.sinceDay ?? Number.MIN_SAFE_INTEGER;
  const row = store["ops"].get(`SELECT
         SUM(CASE WHEN EXISTS (SELECT 1 FROM feelings f WHERE f.memory_id = m.id) THEN 1 ELSE 0 END) AS with_feelings,
         SUM(CASE WHEN m.emotional > 0
                    OR EXISTS (SELECT 1 FROM feelings f WHERE f.memory_id = m.id AND f.strength > 0)
                  THEN 1 ELSE 0 END) AS weighted
         FROM memories m
        WHERE m.archived = 0 AND m.superseded_by IS NULL AND m.birth_day >= ?${store["notMergedAway"]("m")}`, since);
  return { withFeelings: row?.with_feelings ?? 0, weighted: row?.weighted ?? 0 };
}
export function feelingCounts(store, opts) {
  const col = opts.by === "core" ? "core" : "emotion";
  const rows = store["ops"].all(`SELECT whose, ${col} AS key, created_at FROM feelings ${opts.whose === undefined ? "" : "WHERE whose = ?"}`, ...opts.whose === undefined ? [] : [opts.whose]);
  const zone = store.zone();
  const tally = new Map;
  for (const r of rows) {
    if (opts.from !== undefined || opts.to !== undefined) {
      const day = localDate(r.created_at, zone);
      if (opts.from !== undefined && day < opts.from)
        continue;
      if (opts.to !== undefined && day > opts.to)
        continue;
    }
    const k = `${r.whose}\x00${r.key}`;
    const t = tally.get(k) ?? { whose: r.whose, key: r.key, count: 0 };
    t.count += 1;
    tally.set(k, t);
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || (a.whose + a.key < b.whose + b.key ? -1 : 1));
}
export function traitsFor(store, memoryId, opts = {}) {
  if (!store["hasTable"]("traits"))
    return [];
  const rows = store["ops"].all(`SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.memory_id = ? ORDER BY t.created_at, t.rowid`, memoryId);
  return store["traitReads"](rows, opts.includeConfidential === true);
}
export function traitsOn(store, ids, opts = {}) {
  const out = new Map;
  if (ids.length === 0 || !store["hasTable"]("traits"))
    return out;
  const unique = [...new Set(ids)];
  for (let at = 0;at < unique.length; at += 500) {
    const part = unique.slice(at, at + 500);
    const rows = store["ops"].all(`SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
          WHERE t.memory_id IN (${part.map(() => "?").join(",")})
          ORDER BY t.created_at, t.rowid`, ...part);
    for (const r of store["traitReads"](rows, opts.includeConfidential === true)) {
      const list = out.get(r.memory_id) ?? [];
      list.push(r);
      out.set(r.memory_id, list);
    }
  }
  return out;
}
export function traitsAll(store, opts = {}) {
  if (!store["hasTable"]("traits"))
    return [];
  const live = opts.live !== false;
  const rows = store["ops"].all(`SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.created_at >= ?${live ? ` AND m.archived = 0 AND m.superseded_by IS NULL${store["notMergedAway"]("m")}` : ""}
        ORDER BY t.created_at, t.rowid`, opts.sinceMs ?? Number.MIN_SAFE_INTEGER);
  return store["traitReads"](rows, opts.includeConfidential === true);
}
export function traitCensus(store, opts = {}) {
  if (!store["hasTable"]("traits"))
    return { memories: 0, nudges: 0 };
  const row = store["ops"].get(`SELECT COUNT(DISTINCT t.memory_id) AS memories, COUNT(*) AS nudges
         FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.created_at >= ? AND m.archived = 0 AND m.superseded_by IS NULL${store["notMergedAway"]("m")}`, opts.sinceMs ?? Number.MIN_SAFE_INTEGER);
  return { memories: row?.memories ?? 0, nudges: row?.nudges ?? 0 };
}
export function memoriesNaming(store, subjectId, opts = {}) {
  if (!store["hasTable"]("memory_subjects"))
    return [];
  return store["ops"].all(`SELECT s.memory_id FROM memory_subjects s JOIN memories m ON m.id = s.memory_id
          WHERE s.subject_id = ?${opts.archived === true ? "" : " AND m.archived = 0"}
          ORDER BY s.memory_id`, subjectId).map((r) => r.memory_id);
}
export function subjectLinksOf(store, memoryId) {
  if (!store["hasTable"]("memory_subjects"))
    return [];
  return store["ops"].all("SELECT subject_id, via, created_at FROM memory_subjects WHERE memory_id = ? ORDER BY subject_id", memoryId).map((r) => ({ subjectId: r.subject_id, via: r.via, createdAt: r.created_at }));
}
export function cardTombstoneLinks(store) {
  const out = [];
  for (const value of store.metaWithPrefix(CARD_TOMBSTONE_PREFIX).values()) {
    try {
      const ids = JSON.parse(value);
      if (Array.isArray(ids))
        out.push(ids.filter((x) => typeof x === "string"));
    } catch {}
  }
  return out;
}
export function subjectLinkCount(store) {
  if (!store["hasTable"]("memory_subjects"))
    return null;
  const row = store["ops"].get("SELECT COUNT(*) AS links, COUNT(DISTINCT memory_id) AS memories, COUNT(DISTINCT subject_id) AS subjects FROM memory_subjects");
  return { links: row?.links ?? 0, memories: row?.memories ?? 0, subjects: row?.subjects ?? 0 };
}
