/**
 * The RANKING CACHE — box 3, and only box 3.
 *
 * Strength is a PURE FUNCTION of stored state and the lived day
 * (`physics/` §5.4). Nothing here is truth: this file holds a materialized copy
 * of `strength(m, d)` and `band(m, d)` so a ranker does not have to recompute
 * the whole store per query. Delete it and nothing is lost but a re-materialize;
 * that is the definition of box 3.
 *
 * Two consequences the contract leans on:
 *
 *   - **A replayed day is a no-op BY CONSTRUCTION** (§4, owner rescope 1), not by
 *     a per-item stamp. Same state, same day ⇒ same number ⇒ the same row.
 *   - **Canonical state takes no decay STEP.** No `uses`, no prose, and no
 *     strength anywhere but here. A decay pass that materialized strength into
 *     canonical state would be v1's materialize-decay churn, which v2 got as an
 *     open choice and declined. *(Amended 2026-09-14, U8: the box-2 `band`
 *     column is reconciled by the same pass — it is the band of record, and a
 *     table that contradicted the cache was reported as fact by the `status`
 *     tool for 869 rows. One UPDATE per disagreeing row, never a strength
 *     write; `sleep/NOTES.md` §5.)*
 *
 * **SEAMS item J closed 2026-08-25:** `Store` now owns a `ranking` table inside
 * `cache/cache.sqlite`, and `storeRankingCache()` below is the shipped default —
 * one owner for box 3, one rebuild story (`resetCache` drops `ranking` with the
 * rest). `sqliteStrengthCache()` stays as the fallback for a store-shaped port
 * that does not implement the writer, and as the historical record of why the
 * side file existed: the store holds an open connection to `cache.sqlite` and
 * takes `BEGIN IMMEDIATE` on it, so a SECOND CONNECTION to the same file would
 * contend for its write lock. Going through the store's own connection is what
 * makes the table safe; a foreign connection would not have been.
 *
 * Opening is LAZY. An eagerly-opened SQLite file is a created file, and an
 * observer cycle that creates a file has already failed the byte-compare it
 * exists to pass.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Band } from "../types.js";
import { openDb } from "../store/db.js";
import type { Db } from "../store/db.js";

export const STRENGTH_CACHE_FILE = "strength.sqlite";

export function strengthCachePath(dir: string): string {
  return join(dir, "cache", STRENGTH_CACHE_FILE);
}

export interface StrengthRow {
  id: string;
  strength: number;
  band: Band;
  day: number;
}

export interface StrengthCache {
  /** Never opens anything that is not already open — a miss is `undefined`. */
  readAll(): Map<string, StrengthRow>;
  write(rows: readonly StrengthRow[]): void;
  /** Forget rows the turn-down no longer ranks (2026-10-10). Optional: a cache without it keeps them. */
  drop?(ids: readonly string[]): void;
  close(): void;
}

interface CacheRow {
  memory_id: string;
  strength: number;
  band: string;
  day: number;
}

const DDL = `CREATE TABLE IF NOT EXISTS ranking (
   memory_id TEXT PRIMARY KEY,
   strength  REAL NOT NULL,
   band      TEXT NOT NULL,
   day       INTEGER NOT NULL
 )`;

/**
 * The shipped implementation: one small SQLite file inside the cache directory,
 * opened on first use and closed with the cycle.
 */
export function sqliteStrengthCache(dir: string): StrengthCache {
  const path = strengthCachePath(dir);
  let db: Db | null = null;

  const open = (): Db => {
    if (db === null) {
      mkdirSync(dirname(path), { recursive: true });
      db = openDb(path);
      db.exec(DDL);
    }
    return db;
  };

  return {
    readAll(): Map<string, StrengthRow> {
      const rows = open().all<CacheRow>("SELECT * FROM ranking");
      const out = new Map<string, StrengthRow>();
      for (const r of rows) {
        out.set(r.memory_id, {
          id: r.memory_id,
          strength: r.strength,
          band: r.band as Band,
          day: r.day,
        });
      }
      return out;
    },
    write(rows: readonly StrengthRow[]): void {
      if (rows.length === 0) return;
      const d = open();
      d.transaction(() => {
        const st = d.prepare(
          "INSERT OR REPLACE INTO ranking (memory_id, strength, band, day) VALUES (?, ?, ?, ?)",
        );
        for (const r of rows) st.run(r.id, r.strength, r.band, r.day);
      });
    },
    close(): void {
      if (db !== null) {
        db.close();
        db = null;
      }
    },
  };
}

/**
 * The shipped default: box 3's `ranking` table, written through the store's own
 * connection. No second file, no second lock, and `rebuildCache()` clears it.
 */
export interface RankingWriter {
  setRanking?(rows: readonly StrengthRow[]): void;
  rankingAll?(): Map<string, StrengthRow>;
  dropRanking?(ids: readonly string[]): void;
}

export function supportsRanking(
  store: RankingWriter,
): store is Required<Pick<RankingWriter, "setRanking" | "rankingAll">> & RankingWriter {
  return typeof store.setRanking === "function" && typeof store.rankingAll === "function";
}

export function storeRankingCache(store: RankingWriter): StrengthCache {
  return {
    readAll: () => (store.rankingAll?.() ?? new Map<string, StrengthRow>()),
    write(rows: readonly StrengthRow[]): void {
      if (rows.length === 0) return;
      store.setRanking?.(rows);
    },
    drop(ids: readonly string[]): void {
      if (ids.length === 0) return;
      store.dropRanking?.(ids);
    },
    close: () => {
      // The store owns the connection and closes it with the store.
    },
  };
}

/** An injectable in-process cache — for probes, replay scoring, and tests. */
export function memoryStrengthCache(seed: readonly StrengthRow[] = []): StrengthCache & {
  rows: Map<string, StrengthRow>;
  writes: number;
} {
  const rows = new Map<string, StrengthRow>();
  for (const r of seed) rows.set(r.id, { ...r });
  const self = {
    rows,
    writes: 0,
    readAll: () => new Map(rows),
    write(batch: readonly StrengthRow[]): void {
      for (const r of batch) rows.set(r.id, { ...r });
      self.writes += batch.length;
    },
    drop(ids: readonly string[]): void {
      for (const id of ids) rows.delete(id);
    },
    close: () => {
      /* nothing to close */
    },
  };
  return self;
}
