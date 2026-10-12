/** `Store`'s reads of what sits on a memory — its feelings, its traits, and the entities it names (bodies moved out of `store/index.ts`, 2026-10-11; the class keeps a delegate, and its doc comment, for each). */
import { localDate } from "../time.js";
import type { FeelingRow } from "./feelings.js";
import type { TraitRead, TraitRow } from "./traits.js";
import { CARD_TOMBSTONE_PREFIX } from "./operational.js";
import type { Store } from "./index.js";

export function feelingsOn(store: Store, ids: readonly string[]): Map<string, (FeelingRow & { birth_day: number })[]> {
  const out = new Map<string, (FeelingRow & { birth_day: number })[]>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  // SQLite's default bound-variable ceiling is far above recall's candidate
  // cap; chunk anyway so no caller can walk into it.
  for (let at = 0; at < unique.length; at += 500) {
    const part = unique.slice(at, at + 500);
    const rows = store["ops"].all<FeelingRow & { birth_day: number }>(
      `SELECT f.*, m.birth_day AS birth_day FROM feelings f JOIN memories m ON m.id = f.memory_id
          WHERE f.memory_id IN (${part.map(() => "?").join(",")})
          ORDER BY f.created_at, f.rowid`,
      ...part,
    );
    for (const r of rows) {
      const list = out.get(r.memory_id) ?? [];
      list.push(r);
      out.set(r.memory_id, list);
    }
  }
  return out;
}

export function emotionCensus(store: Store, opts: { sinceDay?: number } = {}): { withFeelings: number; weighted: number } {
  const since = opts.sinceDay ?? Number.MIN_SAFE_INTEGER;
  const row = store["ops"].get<{ with_feelings: number | null; weighted: number | null }>(
    `SELECT
         SUM(CASE WHEN EXISTS (SELECT 1 FROM feelings f WHERE f.memory_id = m.id) THEN 1 ELSE 0 END) AS with_feelings,
         SUM(CASE WHEN m.emotional > 0
                    OR EXISTS (SELECT 1 FROM feelings f WHERE f.memory_id = m.id AND f.strength > 0)
                  THEN 1 ELSE 0 END) AS weighted
         FROM memories m
        WHERE m.archived = 0 AND m.superseded_by IS NULL AND m.birth_day >= ?${store["notMergedAway"]("m")}`,
    since,
  );
  return { withFeelings: row?.with_feelings ?? 0, weighted: row?.weighted ?? 0 };
}

export function feelingCounts(
  store: Store,
  opts: { by: "core" | "emotion"; whose?: string; from?: string; to?: string },): { whose: string; key: string; count: number }[] {
  const col = opts.by === "core" ? "core" : "emotion";
  const rows = store["ops"].all<{ whose: string; key: string; created_at: number }>(
    `SELECT whose, ${col} AS key, created_at FROM feelings ${opts.whose === undefined ? "" : "WHERE whose = ?"}`,
    ...(opts.whose === undefined ? [] : [opts.whose]),
  );
  const zone = store.zone();
  const tally = new Map<string, { whose: string; key: string; count: number }>();
  for (const r of rows) {
    if (opts.from !== undefined || opts.to !== undefined) {
      const day = localDate(r.created_at, zone);
      if (opts.from !== undefined && day < opts.from) continue;
      if (opts.to !== undefined && day > opts.to) continue;
    }
    const k = `${r.whose}\u0000${r.key}`;
    const t = tally.get(k) ?? { whose: r.whose, key: r.key, count: 0 };
    t.count += 1;
    tally.set(k, t);
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || (a.whose + a.key < b.whose + b.key ? -1 : 1));
}

export function traitsFor(store: Store, memoryId: string, opts: { includeConfidential?: boolean } = {}): TraitRead[] {
  if (!store["hasTable"]("traits")) return [];
  const rows = store["ops"].all<TraitRow & { confidential: number }>(
    `SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.memory_id = ? ORDER BY t.created_at, t.rowid`,
    memoryId,
  );
  return store["traitReads"](rows, opts.includeConfidential === true);
}

export function traitsOn(store: Store, ids: readonly string[], opts: { includeConfidential?: boolean } = {}): Map<string, TraitRead[]> {
  const out = new Map<string, TraitRead[]>();
  if (ids.length === 0 || !store["hasTable"]("traits")) return out;
  const unique = [...new Set(ids)];
  for (let at = 0; at < unique.length; at += 500) {
    const part = unique.slice(at, at + 500);
    const rows = store["ops"].all<TraitRow & { confidential: number }>(
      `SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
          WHERE t.memory_id IN (${part.map(() => "?").join(",")})
          ORDER BY t.created_at, t.rowid`,
      ...part,
    );
    for (const r of store["traitReads"](rows, opts.includeConfidential === true)) {
      const list = out.get(r.memory_id) ?? [];
      list.push(r);
      out.set(r.memory_id, list);
    }
  }
  return out;
}

export function traitsAll(store: Store, opts: { includeConfidential?: boolean; live?: boolean; sinceMs?: number } = {}): TraitRead[] {
  if (!store["hasTable"]("traits")) return [];
  const live = opts.live !== false;
  const rows = store["ops"].all<TraitRow & { confidential: number }>(
    `SELECT t.*, m.confidential AS confidential FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.created_at >= ?${live ? ` AND m.archived = 0 AND m.superseded_by IS NULL${store["notMergedAway"]("m")}` : ""}
        ORDER BY t.created_at, t.rowid`,
    opts.sinceMs ?? Number.MIN_SAFE_INTEGER,
  );
  return store["traitReads"](rows, opts.includeConfidential === true);
}

export function traitCensus(store: Store, opts: { sinceMs?: number } = {}): { memories: number; nudges: number } {
  if (!store["hasTable"]("traits")) return { memories: 0, nudges: 0 };
  const row = store["ops"].get<{ memories: number | null; nudges: number | null }>(
    `SELECT COUNT(DISTINCT t.memory_id) AS memories, COUNT(*) AS nudges
         FROM traits t JOIN memories m ON m.id = t.memory_id
        WHERE t.created_at >= ? AND m.archived = 0 AND m.superseded_by IS NULL${store["notMergedAway"]("m")}`,
    opts.sinceMs ?? Number.MIN_SAFE_INTEGER,
  );
  return { memories: row?.memories ?? 0, nudges: row?.nudges ?? 0 };
}

export function memoriesNaming(store: Store, subjectId: string, opts: { archived?: boolean } = {}): string[] {
  if (!store["hasTable"]("memory_subjects")) return [];
  return store["ops"]
    .all<{ memory_id: string }>(
      `SELECT s.memory_id FROM memory_subjects s JOIN memories m ON m.id = s.memory_id
          WHERE s.subject_id = ?${opts.archived === true ? "" : " AND m.archived = 0"}
          ORDER BY s.memory_id`,
      subjectId,
    )
    .map((r) => r.memory_id);
}

export function subjectLinksOf(store: Store, memoryId: string): { subjectId: string; via: string; createdAt: number }[] {
  if (!store["hasTable"]("memory_subjects")) return [];
  return store["ops"]
    .all<{ subject_id: string; via: string; created_at: number }>(
      "SELECT subject_id, via, created_at FROM memory_subjects WHERE memory_id = ? ORDER BY subject_id",
      memoryId,
    )
    .map((r) => ({ subjectId: r.subject_id, via: r.via, createdAt: r.created_at }));
}

export function cardTombstoneLinks(store: Store): string[][] {
  const out: string[][] = [];
  for (const value of store.metaWithPrefix(CARD_TOMBSTONE_PREFIX).values()) {
    try {
      const ids = JSON.parse(value) as unknown;
      if (Array.isArray(ids)) out.push(ids.filter((x): x is string => typeof x === "string"));
    } catch {
      /* a row that does not parse holds nothing */
    }
  }
  return out;
}

export function subjectLinkCount(store: Store): { links: number; memories: number; subjects: number } | null {
  if (!store["hasTable"]("memory_subjects")) return null;
  const row = store["ops"].get<{ links: number; memories: number; subjects: number }>(
    "SELECT COUNT(*) AS links, COUNT(DISTINCT memory_id) AS memories, COUNT(DISTINCT subject_id) AS subjects FROM memory_subjects",
  );
  return { links: row?.links ?? 0, memories: row?.memories ?? 0, subjects: row?.subjects ?? 0 };
}
