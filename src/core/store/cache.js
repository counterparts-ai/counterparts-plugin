import { openDb } from "./db.js";
import { StoreError } from "./errors.js";
export const CACHE_SCHEMA_VERSION = 6;
const DDL = [
  `CREATE TABLE IF NOT EXISTS doc_tokens (
     memory_id TEXT NOT NULL,
     token     TEXT NOT NULL,
     tf        INTEGER NOT NULL,
     PRIMARY KEY (memory_id, token)
   )`,
  `CREATE INDEX IF NOT EXISTS doc_tokens_token ON doc_tokens (token)`,
  `CREATE TABLE IF NOT EXISTS doc_lens (
     memory_id TEXT PRIMARY KEY,
     len       INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS embeddings (
     memory_id TEXT PRIMARY KEY,
     dim       INTEGER NOT NULL,
     vec       BLOB NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS cache_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ranking (
     memory_id TEXT PRIMARY KEY,
     strength  REAL NOT NULL,
     band      TEXT NOT NULL,
     day       INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS neighbours (
     memory_id    TEXT NOT NULL,
     rank         INTEGER NOT NULL,
     neighbour_id TEXT NOT NULL,
     cosine       REAL NOT NULL,
     PRIMARY KEY (memory_id, rank)
   )`,
  `CREATE INDEX IF NOT EXISTS neighbours_neighbour ON neighbours (neighbour_id)`
];
const TABLES = ["doc_tokens", "doc_lens", "embeddings", "cache_meta", "ranking", "neighbours"];
export const DEFAULT_LENGTH_NORM = { k1: 1, b: 0.5, oneSided: true };
const avgLenMemo = new WeakMap;
export function avgDocLen(db) {
  const memo = avgLenMemo.get(db);
  if (memo !== undefined)
    return memo;
  const row = db.get("SELECT AVG(len) AS a FROM doc_lens");
  const avg = row?.a !== null && row?.a !== undefined && row.a > 0 ? row.a : 1;
  avgLenMemo.set(db, avg);
  return avg;
}
function forgetAvgDocLen(db) {
  avgLenMemo.delete(db);
}
export function backfillLengths(db) {
  const have = db.get("SELECT COUNT(*) AS n FROM doc_lens")?.n ?? 0;
  if (have > 0)
    return 0;
  db.run(`INSERT OR REPLACE INTO doc_lens (memory_id, len)
       SELECT memory_id, SUM(tf) FROM doc_tokens GROUP BY memory_id`);
  forgetAvgDocLen(db);
  return db.get("SELECT COUNT(*) AS n FROM doc_lens")?.n ?? 0;
}
export function cacheSchemaVersion(db) {
  try {
    return db.get("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value ?? null;
  } catch {
    return null;
  }
}
export function schemaAhead(found, code) {
  if (found === null || !/^[0-9]+$/.test(found))
    return false;
  return Number.parseInt(found, 10) > code;
}
export function cacheAhead(db) {
  const found = cacheSchemaVersion(db);
  return found !== null && schemaAhead(found, CACHE_SCHEMA_VERSION) ? { found, expected: CACHE_SCHEMA_VERSION } : null;
}
export function openCache(path) {
  const db = openDb(path, { wal: true });
  if (cacheAhead(db) !== null)
    return db;
  const existing = cacheSchemaVersion(db);
  if (existing !== String(CACHE_SCHEMA_VERSION)) {
    db.transaction(() => {
      for (const sql of DDL)
        db.exec(sql);
      backfillLengths(db);
      if (existing !== null && Number(existing) < 5) {
        const tag = db.get("SELECT value FROM cache_meta WHERE key = ?", EMBEDDER_META_KEY)?.value;
        const dim = tag === undefined ? null : parseIdentityTag(tag).dim;
        const foreign = dim === null ? 1 : db.get("SELECT COUNT(*) AS n FROM embeddings WHERE dim != ?", dim)?.n ?? 0;
        if (tag !== undefined && foreign > 0) {
          db.run("DELETE FROM cache_meta WHERE key IN (?, ?)", EMBEDDER_META_KEY, EMBEDDER_REBUILD_META_KEY);
        }
      }
      db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", String(CACHE_SCHEMA_VERSION));
    });
  }
  return db;
}
export const EMBEDDER_META_KEY = "embedder";
export const EMBEDDER_REBUILD_META_KEY = "embedderRebuild";
export const EMBEDDER_HELD_META_KEY = "embedderHeld";
export function heldExits(recorded) {
  return "drop the old vectors: counterparts verify --rebuild --drop-vectors --dir <store> " + "(the configured embedder then re-embeds every memory)";
}
export function identityTag(model, dim) {
  return dim === null ? model : `${model}@${dim}`;
}
export function parseIdentityTag(tag) {
  const at = tag.lastIndexOf("@");
  if (at <= 0)
    return { model: tag, dim: null };
  const dim = Number(tag.slice(at + 1));
  return Number.isInteger(dim) && dim > 0 ? { model: tag.slice(0, at), dim } : { model: tag, dim: null };
}
function metaOf(db) {
  return new Map(db.all("SELECT key, value FROM cache_meta WHERE key IN (?, ?, ?)", EMBEDDER_META_KEY, EMBEDDER_REBUILD_META_KEY, EMBEDDER_HELD_META_KEY).map((r) => [r.key, r.value]));
}
export function recordedEmbedder(db) {
  const m = metaOf(db);
  const tag = m.get(EMBEDDER_META_KEY);
  if (tag === undefined || tag.length === 0)
    return null;
  const rebuild = m.get(EMBEDDER_REBUILD_META_KEY);
  return {
    tag,
    ...parseIdentityTag(tag),
    rebuild: rebuild === "inline" || rebuild === "external" ? rebuild : null
  };
}
export function heldEmbedder(db) {
  try {
    const v = metaOf(db).get(EMBEDDER_HELD_META_KEY);
    return v === undefined || v.length === 0 ? null : v;
  } catch {
    return null;
  }
}
const writerIdentity = new WeakMap;
function writeTag(db, tag, rebuild) {
  if (tag === null) {
    db.run("DELETE FROM cache_meta WHERE key IN (?, ?)", EMBEDDER_META_KEY, EMBEDDER_REBUILD_META_KEY);
  } else {
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)", EMBEDDER_META_KEY, tag);
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)", EMBEDDER_REBUILD_META_KEY, rebuild);
  }
}
function sameIdentity(recorded, configured) {
  if (recorded.model !== configured.model)
    return false;
  if (configured.rebuild === "external")
    return true;
  return configured.dim === null || recorded.dim === null || recorded.dim === configured.dim;
}
function takenTag(configured) {
  return identityTag(configured.model, configured.rebuild === "inline" ? configured.dim : null);
}
export function reconcileEmbedder(db, configured) {
  const m0 = metaOf(db);
  const fastTag = m0.get(EMBEDDER_META_KEY);
  const fastHeld = m0.get(EMBEDDER_HELD_META_KEY);
  if (fastHeld === undefined && fastTag !== undefined && sameIdentity(parseIdentityTag(fastTag), configured)) {
    writerIdentity.set(db, configured);
    return { kind: "match", tag: fastTag };
  }
  const fastConfigured = identityTag(configured.model, configured.dim);
  if (fastHeld !== undefined && fastHeld === fastConfigured && !(fastTag !== undefined && sameIdentity(parseIdentityTag(fastTag), configured))) {
    return { kind: "held", recorded: fastTag ?? null, configured: fastConfigured, rows: embeddingCount(db), fresh: false };
  }
  const verdict = db.transaction(() => {
    const recorded = recordedEmbedder(db);
    const held = heldEmbedder(db);
    const rows = embeddingCount(db);
    const configuredTag = identityTag(configured.model, configured.dim);
    const dropAndTag = (from) => {
      db.run("DELETE FROM embeddings");
      db.run("DELETE FROM neighbours");
      db.run("DELETE FROM cache_meta WHERE key = ?", EMBEDDER_HELD_META_KEY);
      const to = takenTag(configured);
      writeTag(db, to, configured.rebuild);
      return { kind: "reset", from, to, dropped: rows };
    };
    const hold = () => {
      const fresh = held !== configuredTag;
      if (fresh)
        db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)", EMBEDDER_HELD_META_KEY, configuredTag);
      return { kind: "held", recorded: recorded?.tag ?? null, configured: configuredTag, rows, fresh };
    };
    if (recorded !== null) {
      if (sameIdentity(recorded, configured)) {
        if (held !== null) {
          db.run("DELETE FROM cache_meta WHERE key = ?", EMBEDDER_HELD_META_KEY);
          return { kind: "match", tag: recorded.tag, released: true };
        }
        return { kind: "match", tag: recorded.tag };
      }
      if (rows === 0)
        return dropAndTag(recorded.tag);
      if (recorded.rebuild === "inline")
        return dropAndTag(recorded.tag);
      return hold();
    }
    if (rows === 0) {
      db.run("DELETE FROM cache_meta WHERE key = ?", EMBEDDER_HELD_META_KEY);
      const tag = takenTag(configured);
      writeTag(db, tag, configured.rebuild);
      return { kind: "tagged", tag, adopted: 0 };
    }
    const dims = db.all("SELECT DISTINCT dim FROM embeddings").map((r) => r.dim);
    const only = dims.length === 1 ? dims[0] : undefined;
    if (configured.rebuild === "inline") {
      return only !== undefined && only === configured.dim ? dropAndTag(null) : hold();
    }
    if (only !== undefined && configured.dim !== null && only === configured.dim) {
      db.run("DELETE FROM cache_meta WHERE key = ?", EMBEDDER_HELD_META_KEY);
      const tag = identityTag(configured.model, only);
      writeTag(db, tag, configured.rebuild);
      return { kind: "tagged", tag, adopted: rows };
    }
    return hold();
  });
  if (verdict.kind !== "held")
    writerIdentity.set(db, configured);
  return verdict;
}
function fileClaim(db) {
  let rows;
  try {
    rows = db.all("SELECT key, value FROM cache_meta WHERE key IN ('schemaVersion', ?, ?)", EMBEDDER_META_KEY, EMBEDDER_HELD_META_KEY);
  } catch {
    return { tag: null, held: null, ahead: false };
  }
  const get = (k) => {
    const v = rows.find((r) => r.key === k)?.value;
    return v === undefined || v.length === 0 ? null : v;
  };
  return {
    tag: get(EMBEDDER_META_KEY),
    held: get(EMBEDDER_HELD_META_KEY),
    ahead: schemaAhead(get("schemaVersion"), CACHE_SCHEMA_VERSION)
  };
}
function refusalFor(claim, identity, dim) {
  if (claim.ahead)
    return "cache-ahead";
  if (claim.held !== null)
    return "held";
  if (identity === undefined || claim.tag === null)
    return null;
  const recorded = parseIdentityTag(claim.tag);
  if (recorded.model !== identity.model)
    return "identity-changed";
  if (identity.rebuild === "inline" && recorded.dim !== null && recorded.dim !== dim)
    return "identity-changed";
  return null;
}
export function searchRefusal(db, identity, dim) {
  return refusalFor(fileClaim(db), identity, dim);
}
function admitVector(db, dim) {
  const identity = writerIdentity.get(db);
  const claim = fileClaim(db);
  const refusal = refusalFor(claim, identity, dim);
  if (refusal !== null || identity === undefined)
    return refusal;
  const tag = identityTag(identity.model, dim);
  if (claim.tag !== tag)
    writeTag(db, tag, identity.rebuild);
  return null;
}
export function resetCache(db, opts = {}) {
  const ahead = cacheAhead(db);
  if (ahead !== null)
    throw new StoreError("SCHEMA_AHEAD", { box: "cache", expected: ahead.expected, found: ahead.found });
  const keep = opts.keepEmbeddings === true;
  const drop = keep ? TABLES.filter((t) => t !== "embeddings") : TABLES;
  forgetAvgDocLen(db);
  db.transaction(() => {
    const tag = keep ? db.all("SELECT key, value FROM cache_meta WHERE key IN (?, ?, ?)", EMBEDDER_META_KEY, EMBEDDER_REBUILD_META_KEY, EMBEDDER_HELD_META_KEY) : [];
    for (const t of drop)
      db.exec(`DROP TABLE IF EXISTS ${t}`);
    for (const sql of DDL)
      db.exec(sql);
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", String(CACHE_SCHEMA_VERSION));
    for (const r of tag)
      db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)", r.key, r.value);
  });
}
export function encodeVector(vec) {
  const f = new Float32Array(vec.length);
  for (let i = 0;i < vec.length; i++) {
    const x = vec[i];
    f[i] = typeof x === "number" && Number.isFinite(x) ? x : 0;
  }
  return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
}
export function countNonFinite(vec) {
  let n = 0;
  for (const x of vec)
    if (!(typeof x === "number" && Number.isFinite(x)))
      n += 1;
  return n;
}
export function decodeVector(raw) {
  if (typeof raw === "string")
    return JSON.parse(raw);
  if (raw instanceof Uint8Array) {
    if (raw.byteLength % 4 !== 0)
      return [];
    const n = raw.byteLength >>> 2;
    if (n === 0)
      return [];
    if (raw.byteOffset % 4 === 0)
      return new Float32Array(raw.buffer, raw.byteOffset, n);
    const copy = new Uint8Array(raw);
    return new Float32Array(copy.buffer, 0, n);
  }
  return [];
}
export function vectorFormats(db) {
  const rows = db.all(`SELECT CASE
              WHEN typeof(vec) = 'blob' AND LENGTH(vec) % 4 = 0 THEN 'blob'
              WHEN typeof(vec) = 'text' THEN 'text'
              ELSE 'other'
            END AS t,
            COUNT(*) AS n, SUM(LENGTH(vec)) AS b
       FROM embeddings GROUP BY t`);
  let float32 = 0;
  let jsonText = 0;
  let other = 0;
  let float32Bytes = 0;
  let jsonTextBytes = 0;
  for (const r of rows) {
    const bytes = r.b ?? 0;
    if (r.t === "blob") {
      float32 += r.n;
      float32Bytes += bytes;
    } else if (r.t === "text") {
      jsonText += r.n;
      jsonTextBytes += bytes;
    } else
      other += r.n;
  }
  return { total: float32 + jsonText + other, float32, jsonText, other, float32Bytes, jsonTextBytes };
}
export function convertVectorBatch(db, batch = 500, after) {
  const rows = after === undefined ? db.all("SELECT memory_id, vec FROM embeddings WHERE typeof(vec) = 'text' ORDER BY memory_id LIMIT ?", batch) : db.all("SELECT memory_id, vec FROM embeddings WHERE typeof(vec) = 'text' AND memory_id > ? ORDER BY memory_id LIMIT ?", after, batch);
  const lastId = rows.length === 0 ? null : rows[rows.length - 1]?.memory_id ?? null;
  if (rows.length === 0)
    return { examined: 0, converted: 0, skipped: [], coerced: 0, lastId };
  const decoded = [];
  const skipped = [];
  let coerced = 0;
  for (const row of rows) {
    try {
      const arr = Array.from(decodeVector(row.vec));
      coerced += countNonFinite(arr);
      decoded.push({ id: row.memory_id, arr });
    } catch {
      skipped.push(row.memory_id);
    }
  }
  const converted = db.transaction(() => {
    const upd = db.prepare("UPDATE embeddings SET dim = ?, vec = ? WHERE memory_id = ?");
    let n = 0;
    for (const d of decoded) {
      upd.run(d.arr.length, encodeVector(d.arr), d.id);
      n += 1;
    }
    return n;
  });
  return { examined: rows.length, converted, skipped, coerced, lastId };
}
export function tokenize(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}
export function indexDoc(db, id, text, vec) {
  const counts = new Map;
  let len = 0;
  for (const tok of tokenize(text)) {
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
    len += 1;
  }
  forgetAvgDocLen(db);
  return db.transaction(() => {
    db.run("DELETE FROM doc_tokens WHERE memory_id = ?", id);
    const ins = db.prepare("INSERT INTO doc_tokens (memory_id, token, tf) VALUES (?, ?, ?)");
    for (const [token, tf] of counts)
      ins.run(id, token, tf);
    if (len > 0)
      db.run("INSERT OR REPLACE INTO doc_lens (memory_id, len) VALUES (?, ?)", id, len);
    else
      db.run("DELETE FROM doc_lens WHERE memory_id = ?", id);
    if (vec === undefined)
      return null;
    const refusal = admitVector(db, vec.length);
    if (refusal !== null) {
      db.run("DELETE FROM embeddings WHERE memory_id = ?", id);
      forgetNeighbours(db, id);
      return refusal;
    }
    db.run("INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)", id, vec.length, encodeVector(vec));
    return null;
  });
}
export function setEmbedding(db, id, vec) {
  return db.transaction(() => {
    const refusal = admitVector(db, vec.length);
    if (refusal !== null)
      return refusal;
    db.run("INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)", id, vec.length, encodeVector(vec));
    return null;
  });
}
export function deindexDoc(db, id) {
  forgetAvgDocLen(db);
  db.transaction(() => {
    db.run("DELETE FROM doc_tokens WHERE memory_id = ?", id);
    db.run("DELETE FROM doc_lens WHERE memory_id = ?", id);
    forgetNeighbours(db, id);
  });
}
export function embeddingCount(db) {
  return db.get("SELECT COUNT(*) AS n FROM embeddings")?.n ?? 0;
}
function reachJoin(alias) {
  return `LEFT JOIN ranking rk ON rk.memory_id = ${alias}.memory_id`;
}
const REACH_WHERE = `(rk.memory_id IS NULL OR rk.strength >= ? OR rk.band = 'identity')`;
export function searchIndex(db, cue, limit = 10, norm = DEFAULT_LENGTH_NORM, minStrength = null) {
  const tokens = [...new Set(tokenize(cue))];
  if (tokens.length === 0)
    return [];
  const placeholders = tokens.map(() => "?").join(",");
  const avg = avgDocLen(db);
  const lengthFactor = `CAST(? AS REAL) + CAST(? AS REAL) * COALESCE(dl.len, CAST(? AS REAL)) / CAST(? AS REAL)`;
  const clamped = norm.oneSided === true ? `MAX(1.0, ${lengthFactor})` : lengthFactor;
  const reach = minStrength !== null && Number.isFinite(minStrength);
  const rows = db.all(`SELECT dt.memory_id AS memory_id,
            SUM(CAST(dt.tf AS REAL) * CAST(? AS REAL)
                / (dt.tf + CAST(? AS REAL) * (${clamped}))) AS score
       FROM doc_tokens dt
       LEFT JOIN doc_lens dl ON dl.memory_id = dt.memory_id
       ${reach ? reachJoin("dt") : ""}
      WHERE dt.token IN (${placeholders})${reach ? ` AND ${REACH_WHERE}` : ""}
      GROUP BY dt.memory_id
      ORDER BY score DESC, dt.memory_id ASC
      LIMIT ?`, norm.k1 + 1, norm.k1, 1 - norm.b, norm.b, avg, avg, ...tokens, ...reach ? [minStrength] : [], limit);
  return rows.map((r) => ({ id: r.memory_id, score: r.score }));
}
export function docFrequency(db, tokens) {
  const out = new Map;
  const unique = [...new Set(tokens)];
  if (unique.length === 0)
    return out;
  const CHUNK = 400;
  for (let i = 0;i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    const rows = db.all(`SELECT token, COUNT(*) AS n FROM doc_tokens WHERE token IN (${placeholders}) GROUP BY token`, ...slice);
    for (const r of rows)
      out.set(r.token, r.n);
  }
  return out;
}
export function nearest(db, vec, limit = 10, minStrength = null) {
  const rows = minStrength !== null && Number.isFinite(minStrength) ? db.all(`SELECT e.memory_id AS memory_id, e.vec AS vec FROM embeddings e ${reachJoin("e")} WHERE ${REACH_WHERE}`, minStrength) : db.all("SELECT memory_id, vec FROM embeddings");
  const hits = [];
  for (const row of rows) {
    const other = decodeVector(row.vec);
    if (other.length > 0 && other.length !== vec.length)
      continue;
    hits.push({ id: row.memory_id, score: cosine(vec, other) });
  }
  hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits.slice(0, limit);
}
export const NEIGHBOURS_KEPT = 48;
export function forgetNeighbours(db, id) {
  db.run("DELETE FROM neighbours WHERE memory_id = ?", id);
  db.run("DELETE FROM neighbours WHERE neighbour_id = ?", id);
}
export function writeNeighbours(db, id, hits) {
  db.transaction(() => {
    db.run("DELETE FROM neighbours WHERE memory_id = ?", id);
    const ins = db.prepare("INSERT INTO neighbours (memory_id, rank, neighbour_id, cosine) VALUES (?, ?, ?, ?)");
    let rank = 0;
    for (const h of hits) {
      if (h.id === id)
        continue;
      ins.run(id, rank, h.id, h.score);
      rank += 1;
    }
  });
}
export function readNeighbours(db, id, limit) {
  const rows = db.all("SELECT neighbour_id, cosine FROM neighbours WHERE memory_id = ? ORDER BY rank LIMIT ?", id, limit);
  return rows.length === 0 ? null : rows.map((r) => ({ id: r.neighbour_id, score: r.cosine }));
}
export function allVectors(db) {
  return db.all("SELECT memory_id, vec FROM embeddings").map((r) => ({ id: r.memory_id, vec: decodeVector(r.vec) }));
}
export function rankAgainst(rows, vec, limit) {
  const hits = [];
  for (const row of rows) {
    if (row.vec.length > 0 && row.vec.length !== vec.length)
      continue;
    hits.push({ id: row.id, score: cosine(vec, row.vec) });
  }
  hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits.slice(0, limit);
}
export function nearestVectors(db, vec, limit = 10) {
  const rows = db.all("SELECT memory_id, vec FROM embeddings");
  const scored = [];
  for (const row of rows) {
    const other = decodeVector(row.vec);
    if (other.length === 0 || other.length !== vec.length)
      continue;
    scored.push({ id: row.memory_id, score: cosine(vec, other), vec: other });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, limit).map((s) => Array.isArray(s.vec) ? s.vec : Array.from(s.vec));
}
export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0;i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0)
    return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
