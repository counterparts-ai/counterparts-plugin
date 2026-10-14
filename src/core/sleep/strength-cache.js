import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDb } from "../store/db.js";
export const STRENGTH_CACHE_FILE = "strength.sqlite";
export function strengthCachePath(dir) {
  return join(dir, "cache", STRENGTH_CACHE_FILE);
}
const DDL = `CREATE TABLE IF NOT EXISTS ranking (
   memory_id TEXT PRIMARY KEY,
   strength  REAL NOT NULL,
   band      TEXT NOT NULL,
   day       INTEGER NOT NULL
 )`;
export function sqliteStrengthCache(dir) {
  const path = strengthCachePath(dir);
  let db = null;
  const open = () => {
    if (db === null) {
      mkdirSync(dirname(path), { recursive: true });
      db = openDb(path);
      db.exec(DDL);
    }
    return db;
  };
  return {
    readAll() {
      const rows = open().all("SELECT * FROM ranking");
      const out = new Map;
      for (const r of rows) {
        out.set(r.memory_id, {
          id: r.memory_id,
          strength: r.strength,
          band: r.band,
          day: r.day
        });
      }
      return out;
    },
    write(rows) {
      if (rows.length === 0)
        return;
      const d = open();
      d.transaction(() => {
        const st = d.prepare("INSERT OR REPLACE INTO ranking (memory_id, strength, band, day) VALUES (?, ?, ?, ?)");
        for (const r of rows)
          st.run(r.id, r.strength, r.band, r.day);
      });
    },
    close() {
      if (db !== null) {
        db.close();
        db = null;
      }
    }
  };
}
export function supportsRanking(store) {
  return typeof store.setRanking === "function" && typeof store.rankingAll === "function";
}
export function storeRankingCache(store) {
  return {
    readAll: () => store.rankingAll?.() ?? new Map,
    write(rows) {
      if (rows.length === 0)
        return;
      store.setRanking?.(rows);
    },
    drop(ids) {
      if (ids.length === 0)
        return;
      store.dropRanking?.(ids);
    },
    close: () => {}
  };
}
export function memoryStrengthCache(seed = []) {
  const rows = new Map;
  for (const r of seed)
    rows.set(r.id, { ...r });
  const self = {
    rows,
    writes: 0,
    readAll: () => new Map(rows),
    write(batch) {
      for (const r of batch)
        rows.set(r.id, { ...r });
      self.writes += batch.length;
    },
    drop(ids) {
      for (const id of ids)
        rows.delete(id);
    },
    close: () => {}
  };
  return self;
}
