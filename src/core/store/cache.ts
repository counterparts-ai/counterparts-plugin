/**
 * Box 3 — the rebuildable cache: a SEPARATE sqlite file for the inverted text index
 * and embeddings. Never backed up. Its loss is a re-index, never a memory.
 *
 * The index is a plain inverted table rather than FTS5 on purpose: FTS5 is a
 * compile-time option and the two runtimes we support do not guarantee it the same
 * way. The simplest thing that answers a cue identically on both is 40 lines of
 * tokenizer (constitution line 15 — machinery is earned, not anticipated).
 */
import type { Db, SqlValue } from "./db.js";
import { openDb } from "./db.js";
import { StoreError } from "./errors.js";

/**
 * Bumped to 2 (2026-08-25, SEAMS item J): the `ranking` table joins box 3.
 * Bumped to 3 (2026-09-04): `doc_lens` — the document length the cue channel
 * needs to stop rewarding a memory for being long (see `LengthNorm` below).
 * Bumped to 4 (2026-09-05): embeddings are written as a float32 BLOB rather
 * than JSON text (see `encodeVector`). The bump changes what a WRITE produces;
 * reads stay tolerant of both shapes, and `counterparts migrate-cache`
 * converts the rows already on disk.
 * Bumped to 5 (2026-09-23, roadmap C1): `cache_meta.embedder` — the IDENTITY of
 * the vectors in `embeddings` (`<model>@<dim>`, see `reconcileEmbedder`). The
 * table's shape does not change; what changes is that a v5 cache's vectors
 * carry a claim about which model wrote them, and a v4 cache's do not. The
 * migration therefore ERASES any tag it finds (a v5 tag that has since passed
 * through a v4 build's writes is not evidence of anything) and leaves the rows
 * where they are; the first open with an embedder configured decides what they
 * are (`reconcileEmbedder`'s legacy arm).
 * Bumped to 6 (2026-10-10, Lane 0 / scale review C1): `neighbours` — each
 * memory's nearest vectors as they stood when it was written (or when the dream
 * first asked), so the dream's `begin` reads one indexed row set per queued
 * memory instead of re-scanning the whole embedding table for each (299 ms at
 * 1x, 22 s at 10x). Derived from `embeddings` and nothing else; dropped and
 * refilled like the rest of box 3. An older build opening a v6 cache reads it
 * as "ahead" and turns its vector channel off (the existing #187 policy).
 */
export const CACHE_SCHEMA_VERSION = 6;

const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS doc_tokens (
     memory_id TEXT NOT NULL,
     token     TEXT NOT NULL,
     tf        INTEGER NOT NULL,
     PRIMARY KEY (memory_id, token)
   )`,
  `CREATE INDEX IF NOT EXISTS doc_tokens_token ON doc_tokens (token)`,
  // Document length, in indexed tokens — SUM(tf) over the row's `doc_tokens`.
  //
  // It is DERIVED FROM `doc_tokens` AND NOTHING ELSE, which is the whole reason
  // it is its own table rather than a column somewhere upstream: a cache that
  // predates this version rebuilds its lengths with one `GROUP BY` over the
  // index it already has (`backfillLengths` below) — no prose read, no embedder,
  // and above all no `resetCache`, which would drop 13,868 vectors that cost a
  // network call each to recompute.
  `CREATE TABLE IF NOT EXISTS doc_lens (
     memory_id TEXT PRIMARY KEY,
     len       INTEGER NOT NULL
   )`,
  // `vec` is a float32 BLOB: `dim` little-endian IEEE-754 singles, `dim * 4`
  // bytes (v4, 2026-09-05). It was JSON text through v3, and the declared type
  // here is AFFINITY, not a constraint — a v3 cache whose table says `TEXT`
  // stores a bound BLOB as a BLOB (SQLite's TEXT affinity keeps NULL/TEXT/BLOB
  // storage classes unchanged), so the write side needs no table rewrite and
  // the read side decodes whichever shape a row actually holds.
  `CREATE TABLE IF NOT EXISTS embeddings (
     memory_id TEXT PRIMARY KEY,
     dim       INTEGER NOT NULL,
     vec       BLOB NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS cache_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  // SEAMS item J — the materialized ranking cache.
  //
  // Strength is a PURE FUNCTION of stored state and the lived day (physics §5.4),
  // so nothing here is truth: it is `strength(m, d)` and `band(m, d)` written down
  // so a ranker need not recompute the whole store per query. Delete the file and
  // the next decay tick re-materializes every row.
  //
  // It lives in box 3's own file (and in `TABLES`, so `resetCache` drops it with
  // the rest) rather than in the side file `sleep/strength-cache.ts` opened: the
  // store holds the write lock on this database, and two connections contending
  // for it left box 3 with two owners and one rebuild story
  // (sleep/INTERFACE-GAPS.md §1).
  `CREATE TABLE IF NOT EXISTS ranking (
     memory_id TEXT PRIMARY KEY,
     strength  REAL NOT NULL,
     band      TEXT NOT NULL,
     day       INTEGER NOT NULL
   )`,
  // v6 (2026-10-10, Lane 0): a memory's NEAREST VECTORS, ranked, as `nearest`
  // found them — written when the memory's vector is written (`Store#indexOne`)
  // and, for a memory that has none yet, the first time the dream asks
  // (`Store#neighbourReader`). Derived from `embeddings` alone: a row whose
  // vector goes takes its neighbour rows with it, in both directions
  // (`forgetNeighbours`), and a reset drops the table with the rest.
  `CREATE TABLE IF NOT EXISTS neighbours (
     memory_id    TEXT NOT NULL,
     rank         INTEGER NOT NULL,
     neighbour_id TEXT NOT NULL,
     cosine       REAL NOT NULL,
     PRIMARY KEY (memory_id, rank)
   )`,
  `CREATE INDEX IF NOT EXISTS neighbours_neighbour ON neighbours (neighbour_id)`,
];

const TABLES = ["doc_tokens", "doc_lens", "embeddings", "cache_meta", "ranking", "neighbours"] as const;

/**
 * Length normalization for the token channel — the document side of §9 G4.
 *
 * Cue matching is already rarity-weighted on the CUE side: a token spanning the
 * whole store is evidence of nothing, and that zero is what replaces the stop
 * list. This is the same rule read from the other end of the edge: **a memory
 * spanning every topic is specific evidence for none of them.** Before this,
 * `searchIndex` scored a document by raw `SUM(tf)` and took the top `limit` by
 * it, so the longest documents in the store won every cue — measured
 * 2026-09-04 on the live store, where nine memories of 9–20 KB (against a
 * ~1.1 KB median, ~106 indexed tokens) came back as footnotes for every topic
 * across two unrelated sessions and were judged 0-of-9 relevant.
 *
 * The formula is BM25's, and it is chosen because it is the SMALLEST change
 * that could work (constitution 15): the old score's saturating half,
 * `2·tf/(tf+1)`, is exactly this expression at `b = 0, k1 = 1`. Turning `b` up
 * adds length normalization and moves nothing else.
 *
 *   score(tok, doc) = tf·(k1+1) / ( tf + k1·( 1 − b + b·len/avgLen ) )
 *
 * The CAL home for these numbers — the calibration record, with how they were
 * chosen — is `src/core/recall/tunables.ts` (`CUE_TF_SATURATION`,
 * `CUE_LENGTH_NORM`). This default exists because `search()` has two callers
 * that are not recall (`counterpart.ts`'s update-candidate lookup and the CLI's
 * contamination scan), and a test asserts the two agree.
 */
export interface LengthNorm {
  /** tf saturation (BM25 k1). 1.0 reproduces the previous `2·tf/(tf+1)`. */
  readonly k1: number;
  /** length normalization (BM25 b). 0 = none; 1 = fully proportional. */
  readonly b: number;
  /**
   * ONE-SIDED: clamp the length factor at 1, so a long document is penalized
   * and a short one is never REWARDED.
   *
   * BM25's factor is centered on the mean, so at `b = 0.75` a very short
   * document scores up to ~1.6× what it scored with no normalization at all.
   * That is fine for ranking — ranking is relative — and it is not fine for the
   * gate's ABSOLUTE floors (`FLOOR_GLOBAL_UNITS`, `FLOOR_STRONG_DEFAULT_UNITS`),
   * which a candidate clears in a fixed number of cue units. Clamping keeps
   * every score at or below its previous value, so a floor means what it meant.
   *
   * Measured before shipping (`tools/recall-bench`, 13 real prompts, 2026-09-04),
   * and the measurement REFUSED the hypothesis it was built to confirm: clamping
   * does NOT bring the loud tier down (24 one-sided vs 23 two-sided at b=0.75,
   * against 4 before). So the loud-tier inflation is the RELATIVE BAR meeting a
   * distribution that no longer has nine outliers setting its variance — not the
   * scale meeting old floors. That question is now answered, and it is answered
   * against the clamp. Recorded because a flag kept for a reason that turned out
   * to be false is how a codebase accumulates folklore.
   *
   * The clamp ships anyway, for the two reasons that survived: at `b = 0.5` it
   * is the only configuration in the grid that recovers an AMBIENT labeled
   * positive (a correction the owner once gave, as a turn-4 footnote — see
   * `recall/tunables.ts`), and it is the conservative
   * arithmetic — no score exceeds what it was before normalization, so an
   * inherited absolute floor still means what it meant.
   */
  readonly oneSided?: boolean;
}

export const DEFAULT_LENGTH_NORM: LengthNorm = { k1: 1, b: 0.5, oneSided: true };

/**
 * Mean document length, memoized per open database.
 *
 * A recall pass issues up to `MAX_CUES` index probes, and re-deriving
 * `AVG(len)` over 15k rows inside each of them is real time against a 1200 ms
 * budget. Staleness is harmless by construction: this is a SMOOTHING CONSTANT,
 * not truth — it moves by a fraction of a token when a memory is written, and
 * every writer here invalidates it anyway. A second process's writes are not
 * seen until this one reopens, which is the same tolerance box 3 already has.
 */
const avgLenMemo = new WeakMap<Db, number>();

export function avgDocLen(db: Db): number {
  const memo = avgLenMemo.get(db);
  if (memo !== undefined) return memo;
  const row = db.get<{ a: number | null }>("SELECT AVG(len) AS a FROM doc_lens");
  const avg = row?.a !== null && row?.a !== undefined && row.a > 0 ? row.a : 1;
  avgLenMemo.set(db, avg);
  return avg;
}

function forgetAvgDocLen(db: Db): void {
  avgLenMemo.delete(db);
}

/**
 * The v2 → v3 migration, and the reason the length column is not a rebuild.
 *
 * Lengths are a pure function of `doc_tokens`, so an existing cache re-derives
 * them with one aggregate — no prose read, no embedder, and no `resetCache`.
 * That distinction is the whole point: `rebuildCache()` drops `embeddings`, and
 * on a store whose embedder is not configured in the migrating process, those
 * vectors do not come back. Returns the number of rows written.
 */
export function backfillLengths(db: Db): number {
  const have = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_lens")?.n ?? 0;
  if (have > 0) return 0;
  db.run(
    `INSERT OR REPLACE INTO doc_lens (memory_id, len)
       SELECT memory_id, SUM(tf) FROM doc_tokens GROUP BY memory_id`,
  );
  forgetAvgDocLen(db);
  return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_lens")?.n ?? 0;
}

/**
 * The schema version box 3 says it is, or null for a fresh file (no table, no
 * row). A read; nothing is created. E's every-call check reads the same key.
 */
export function cacheSchemaVersion(db: Db): string | null {
  try {
    return db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value ?? null;
  } catch {
    return null; // table absent: fresh cache
  }
}

/**
 * THE ONE DEFINITION OF "AHEAD", for both boxes and every reader (roadmap E's
 * server gate included): a stamp is ahead of the code only when it is a plain
 * base-10 integer greater than the code's version. Absent, behind, or anything
 * that is not digits (`"6-beta"`, `"7a"`, `""`) reads as NOT ahead — today's
 * behaviour, in which an older or odd stamp is the migrating open's to fix.
 * `parseInt` would have read `"6-beta"` as 6; this does not.
 */
export function schemaAhead(found: string | null, code: number): boolean {
  if (found === null || !/^[0-9]+$/.test(found)) return false;
  return Number.parseInt(found, 10) > code;
}

/**
 * Is this cache from a NEWER build? Then this build must not stamp it, migrate
 * it, drop from it or write vectors into it — only read what it can.
 */
export function cacheAhead(db: Db): { found: string; expected: number } | null {
  const found = cacheSchemaVersion(db);
  return found !== null && schemaAhead(found, CACHE_SCHEMA_VERSION)
    ? { found, expected: CACHE_SCHEMA_VERSION }
    : null;
}

export function openCache(path: string): Db {
  // WAL here whatever the stance, unlike box 2: the dashboard and the worker read
  // and write this file at the same time, its sidecars live inside `cache/` where
  // nothing classifies them, and box 3 is DECLARED rebuildable — the same reason
  // the constructor lets an instrument materialize this directory at all.
  const db = openDb(path, { wal: true });
  // A CACHE FROM A NEWER BUILD IS LEFT EXACTLY AS IT IS (2026-09-23, found by
  // roadmap E). Before v5 this function stamped whatever version it found back
  // DOWN to its own — so an old MCP server opened after an upgrade rewrote the
  // new build's `schemaVersion`, and the every-call "schema ahead" refusal that
  // exists to stop that server could never see what it was looking for. The
  // handle is returned unmigrated; the `Store` built on it turns the vector
  // channel off by name (`EmbedderVerdict` "cache-ahead") and refuses a
  // rebuild. (The MCP server refuses every tool in this state — #187 — and
  // that policy wins for the server; see store NOTES, 2026-09-23.)
  if (cacheAhead(db) !== null) return db;
  // Idempotent open: write the version row only when it differs. An observer
  // constructing a Store over an up-to-date cache must not churn a byte — the
  // dashboard build measured exactly that churn and filed it (its gap §1).
  // A fresh or outdated cache still initializes (box 3 is rebuildable, and an
  // absent cache is not canonical state), but the steady state is read-only.
  const existing = cacheSchemaVersion(db);
  if (existing !== String(CACHE_SCHEMA_VERSION)) {
    db.transaction(() => {
      for (const sql of DDL) db.exec(sql);
      // The version bump and the lengths it promises land in ONE transaction:
      // a cache stamped v3 with no lengths would score every document as if it
      // were average, silently, which is the failure this version exists to end.
      backfillLengths(db);
      // v5: a tag found on a cache stamped BELOW 5 means a v5 build tagged it
      // and an OLDER build then stamped the version down (any 0.2.0 process,
      // an unrestarted MCP server, a dev checkout) and may have written vectors
      // of its own beside the tagged ones. Before v5 the only thing that ever
      // wrote a vector was the paid seat, so what an older build can add is
      // paid-width rows. The tag is KEPT when every row still has the width it
      // names — nothing foreign was written — and erased otherwise, leaving the
      // rows untagged for the first identified open to judge
      // (`reconcileEmbedder`'s legacy arm: a static table refills rows of its
      // own width and holds anything else; a paid seat adopts only its own
      // known width). The held marker survives either way: a hold is the
      // owner's to release, never a migration's.
      if (existing !== null && Number(existing) < 5) {
        const tag = db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = ?", EMBEDDER_META_KEY)?.value;
        const dim = tag === undefined ? null : parseIdentityTag(tag).dim;
        const foreign =
          dim === null
            ? 1
            : (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings WHERE dim != ?", dim)?.n ?? 0);
        if (tag !== undefined && foreign > 0) {
          db.run("DELETE FROM cache_meta WHERE key IN (?, ?)", EMBEDDER_META_KEY, EMBEDDER_REBUILD_META_KEY);
        }
      }
      db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", String(CACHE_SCHEMA_VERSION));
    });
  }
  return db;
}

// ── the embedder identity tag (v5) ──────────────────────────────────────────

/**
 * `cache_meta` key holding the identity of every vector in `embeddings`:
 * `<model>@<dim>`, e.g. `potion-base-8M@256` (or `voyage-3-large@1024`, from
 * the paid seat the adapter had until 2026-09-24).
 *
 * WHY IT EXISTS: `embed-client.ts` §2.15 — "a vector's generation is part of
 * its identity; vectors from two models are not comparable." Through v4 that
 * was enforced by nothing: the seat id was pinned in config, and a changed
 * config would have ranked a new model's query against an old model's rows
 * with no sign anything was wrong. Two embedders exist now (a paid remote seat
 * and a free local table), and switching between them is an ordinary act — so
 * the rows have to say what they are.
 */
export const EMBEDDER_META_KEY = "embedder";
/**
 * Companion key: how the tagged vectors come BACK after a drop — `inline` (the
 * embedder computes them in-process, for nothing) or `external` (only a paid or
 * asynchronous path can). It is what lets a mismatch drop free rows at open and
 * refuse to drop paid ones.
 */
export const EMBEDDER_REBUILD_META_KEY = "embedderRebuild";
/**
 * THE DURABLE HOLD (review of #190, MAJOR 1). Present ⇔ box 3 holds PAID
 * vectors that the configured embedder cannot use, and nobody has confirmed
 * dropping them. Its value is the identity that was refused (the configured
 * one). It lives in the FILE, not in a handle, because the handles that rank
 * are not all the handles that reconcile: the MCP server's store, the
 * dashboard, the console all open without an identity, and a per-handle hold
 * let every one of them take a cosine across two models.
 *
 * Written by `reconcileEmbedder`; read by every `Store.open`; cleared by the
 * two exits and nothing else — an open whose configured identity matches the
 * recorded one again (the owner put the config back), or a rebuild that drops
 * the vectors (`counterparts verify --rebuild --drop-vectors --dir <store>`,
 * which drops `cache_meta` with them). `migrate-cache` gains a typed confirm
 * for it in C3.
 */
export const EMBEDDER_HELD_META_KEY = "embedderHeld";

/**
 * The way out of a hold, in the words doctor and the durable row use.
 *
 * There were two until 2026-09-24: put the configuration back to the model
 * that wrote the rows (free), or drop them. The Claude Code adapter no longer
 * offers any embedder but its local table, so the model that wrote held rows —
 * the removed Voyage seat, in practice — cannot be configured again, and the
 * one exit left is the drop: `verify --rebuild --drop-vectors`, after which the
 * configured embedder re-embeds every memory. `recorded` is kept so the
 * signature (and the durable row's `exits` field) stays one shape. `<store>` is
 * the caller's to fill.
 */
export function heldExits(recorded: string | null): string {
  void recorded;
  return (
    "drop the old vectors: counterparts verify --rebuild --drop-vectors --dir <store> " +
    "(the configured embedder then re-embeds every memory)"
  );
}

/** What a configured embedder says about the vectors it produces. */
export interface EmbedderIdentity {
  /** The pinned model id: `potion-base-8M`, `voyage-3-large`. */
  readonly model: string;
  /**
   * The output width when it is KNOWN before the first vector: a static table
   * always knows; a paid seat knows for the models this package names
   * (`adapters/config.ts#EMBED_MODEL_DIMS`). Null only for a paid id this
   * package has never heard of — then the width is learned from the first
   * vector written, and untagged rows are never adopted under it.
   */
  readonly dim: number | null;
  /**
   * `inline`: the SYNC embedder computes every vector itself, here, now, at no
   * cost — so rows IT wrote can be dropped and refilled at open.
   * `external`: the sync face is a cache over a paid call — nothing is rebuilt
   * inline, and rows it wrote are never dropped at open (see `reconcileEmbedder`).
   */
  readonly rebuild: "inline" | "external";
}

/** A tag, as recorded. `dim` null only for a hand-written tag with no `@`. */
export interface RecordedEmbedder {
  readonly tag: string;
  readonly model: string;
  readonly dim: number | null;
  /** Null when the companion key is absent — read as `external` (the cautious reading). */
  readonly rebuild: "inline" | "external" | null;
}

export function identityTag(model: string, dim: number | null): string {
  return dim === null ? model : `${model}@${dim}`;
}

/** Split on the LAST `@`, so a model id that contains one survives. */
export function parseIdentityTag(tag: string): { model: string; dim: number | null } {
  const at = tag.lastIndexOf("@");
  if (at <= 0) return { model: tag, dim: null };
  const dim = Number(tag.slice(at + 1));
  return Number.isInteger(dim) && dim > 0 ? { model: tag.slice(0, at), dim } : { model: tag, dim: null };
}

function metaOf(db: Db): Map<string, string> {
  return new Map(
    db
      .all<{ key: string; value: string }>(
        "SELECT key, value FROM cache_meta WHERE key IN (?, ?, ?)",
        EMBEDDER_META_KEY,
        EMBEDDER_REBUILD_META_KEY,
        EMBEDDER_HELD_META_KEY,
      )
      .map((r) => [r.key, r.value] as const),
  );
}

export function recordedEmbedder(db: Db): RecordedEmbedder | null {
  const m = metaOf(db);
  const tag = m.get(EMBEDDER_META_KEY);
  if (tag === undefined || tag.length === 0) return null;
  const rebuild = m.get(EMBEDDER_REBUILD_META_KEY);
  return {
    tag,
    ...parseIdentityTag(tag),
    rebuild: rebuild === "inline" || rebuild === "external" ? rebuild : null,
  };
}

/** The durable hold, if box 3 is under one: the refused identity, or null. */
export function heldEmbedder(db: Db): string | null {
  try {
    const v = metaOf(db).get(EMBEDDER_HELD_META_KEY);
    return v === undefined || v.length === 0 ? null : v;
  } catch {
    return null; // a cache with no meta table holds nothing
  }
}

/**
 * The outcome of `reconcileEmbedder`, by name. Every arm is a different
 * sentence to somebody reading why their semantic channel looks the way it
 * does, so none of them is folded into another.
 */
export type EmbedderVerdict =
  /** No embedder configured in this process and no hold on the file: the rows were not looked at. */
  | { readonly kind: "none" }
  /**
   * The recorded identity is the configured one. Nothing was written — unless
   * this open RELEASED a hold (`released`), because the owner put the
   * configuration back to the model that wrote the rows.
   */
  | { readonly kind: "match"; readonly tag: string; readonly released?: boolean }
  /**
   * There was no tag, and now there is: a fresh table taken by this identity
   * (a static table's `<model>@<dim>`, a paid seat's model alone until its
   * first vector), or legacy untagged rows ADOPTED by a paid seat whose known
   * width they all have. (`tag` is null only in a verdict from before the
   * re-review, kept in the type for readers of old telemetry.)
   */
  | { readonly kind: "tagged"; readonly tag: string | null; readonly adopted: number }
  /**
   * The rows were FREE to recompute (a static table's, or none at all) and
   * were from another model: gone, and the tag names the configured one. An
   * inline embedder refills them at open; a paid one through its backfill.
   */
  | { readonly kind: "reset"; readonly from: string | null; readonly to: string | null; readonly dropped: number }
  /**
   * PAID rows the configured embedder cannot use (or untagged rows it cannot
   * vouch for): NOTHING dropped, nothing tagged, and a durable marker says so.
   * No handle on this file writes vectors or ranks against them until one of
   * `heldExits(recorded)` is taken. `fresh` is true on the open that WROTE the marker.
   */
  | {
      readonly kind: "held";
      readonly recorded: string | null;
      readonly configured: string | null;
      readonly rows: number;
      readonly fresh: boolean;
    }
  /**
   * Box 3 was written by a NEWER build (`cacheAhead`). The identity check did
   * not run, nothing was written, and — exactly as under `held` — this handle
   * neither writes vectors nor ranks against them. The lexical index is still
   * read and written by a non-server handle (the MCP server refuses every tool
   * instead, #187).
   */
  | { readonly kind: "cache-ahead"; readonly found: string; readonly expected: number }
  /**
   * The check had a DECISION to write (a first tag, a reset, a hold, an
   * adoption) and another process held box 3's write lock past the busy
   * timeout. Nothing was written; this handle's embedder is withdrawn for this
   * open (no vector written under an unsettled identity), and the next open
   * decides again. A lost lock costs the tag, never the open (re-review NIT 1).
   */
  | { readonly kind: "deferred"; readonly reason: "locked" };

/** Per open database: the identity this process writes vectors under. */
const writerIdentity = new WeakMap<Db, EmbedderIdentity>();

function writeTag(db: Db, tag: string | null, rebuild: "inline" | "external"): void {
  if (tag === null) {
    db.run("DELETE FROM cache_meta WHERE key IN (?, ?)", EMBEDDER_META_KEY, EMBEDDER_REBUILD_META_KEY);
  } else {
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)", EMBEDDER_META_KEY, tag);
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)", EMBEDDER_REBUILD_META_KEY, rebuild);
  }
}

/**
 * Is the recorded identity the configured one? The model always; the width
 * only for an INLINE table, where it is part of what the table is (a 256-wide
 * slice of a 1,024-wide table is another space). A paid seat's width is its
 * provider's, pinned by the model id — so its declared width (`EMBED_MODEL_DIMS`)
 * decides only whether untagged rows may be adopted, and the tag records what
 * its vectors actually measured.
 */
function sameIdentity(recorded: { model: string; dim: number | null }, configured: EmbedderIdentity): boolean {
  if (recorded.model !== configured.model) return false;
  if (configured.rebuild === "external") return true;
  return configured.dim === null || recorded.dim === null || recorded.dim === configured.dim;
}

/**
 * The tag an open writes when it TAKES a file (a fresh table, a reset): an
 * inline table's full `<model>@<dim>`; a paid seat's model alone — its first
 * vector completes it with the width the provider actually returned.
 */
function takenTag(configured: EmbedderIdentity): string {
  return identityTag(configured.model, configured.rebuild === "inline" ? configured.dim : null);
}

/**
 * THE AT-OPEN IDENTITY CHECK. Called once per open by a process that has an
 * embedder configured (never by an instrument — an observer has none), and
 * never again for the life of the handle: "at open only" is the rule, and the
 * per-call schema check is another module's (roadmap E).
 *
 * **The steady state takes no lock.** A match, or a paid seat of unknown width
 * meeting a table with no rows and no tag (nothing to decide), returns from a
 * plain read. Only a real decision opens a transaction.
 *
 * **Paid rows are never dropped at open**, whatever is configured (review of
 * #190, MAJOR 2). The rules, by what the table holds:
 *
 *   - **held already** — stays held until the configured identity matches the
 *     recorded one again (then released) or the rows are dropped by a rebuild.
 *   - **tagged, same identity** — match.
 *   - **tagged, other identity:**
 *       - no rows → retag (nothing to lose);
 *       - the recorded rows are INLINE (a static table's) → drop, retag, and
 *         the configured embedder refills (free);
 *       - the recorded rows are EXTERNAL (paid) → HELD, even under a static
 *         configuration. Dropping paid vectors is the owner's decision.
 *   - **untagged, no rows** — tag now if the width is known.
 *   - **untagged rows** (a v4 cache, or a tag erased by a mixed-build stamp-down):
 *       - static configured, and EVERY row has the table's own width → drop and
 *         refill (they are a static table's rows whose name was lost; free);
 *       - paid configured with a KNOWN width, and every row has it → adopt;
 *       - anything else → HELD.
 *
 * Race-safe by construction: anything that writes re-reads and re-decides
 * inside one IMMEDIATE transaction, so two processes opening at once agree on
 * one outcome and the second sees the first's tag as a match.
 */
export function reconcileEmbedder(db: Db, configured: EmbedderIdentity): EmbedderVerdict {
  const m0 = metaOf(db);
  const fastTag = m0.get(EMBEDDER_META_KEY);
  const fastHeld = m0.get(EMBEDDER_HELD_META_KEY);
  if (fastHeld === undefined && fastTag !== undefined && sameIdentity(parseIdentityTag(fastTag), configured)) {
    writerIdentity.set(db, configured);
    return { kind: "match", tag: fastTag };
  }
  // A STANDING hold, asked again by the identity it already refused: nothing to
  // decide, so no lock — every hook on a held store opens with a read.
  const fastConfigured = identityTag(configured.model, configured.dim);
  if (
    fastHeld !== undefined &&
    fastHeld === fastConfigured &&
    !(fastTag !== undefined && sameIdentity(parseIdentityTag(fastTag), configured))
  ) {
    return { kind: "held", recorded: fastTag ?? null, configured: fastConfigured, rows: embeddingCount(db), fresh: false };
  }
  // (BLOCKER 1 of the #190 review: every arm below is a TRANSITION, taken once
  // per store — a fresh table is tagged on its first identified open, even a
  // paid seat's with its model alone, so every later open is one of the two
  // lock-free reads above. The once-only write may still lose the lock: the
  // Store turns that into `deferred`, never a throw.)
  const verdict = db.transaction((): EmbedderVerdict => {
    const recorded = recordedEmbedder(db);
    const held = heldEmbedder(db);
    const rows = embeddingCount(db);
    const configuredTag = identityTag(configured.model, configured.dim);
    const dropAndTag = (from: string | null): EmbedderVerdict => {
      db.run("DELETE FROM embeddings");
      // Another model's cosines rank nothing either (v6).
      db.run("DELETE FROM neighbours");
      db.run("DELETE FROM cache_meta WHERE key = ?", EMBEDDER_HELD_META_KEY);
      // A tag even when the width is unknown (`model` alone): the per-write and
      // per-search checks need to know WHOSE the file is now, or a process
      // still running under the old identity would re-tag it with the first
      // vector it wrote (re-review of #190, MAJOR A).
      const to = takenTag(configured);
      writeTag(db, to, configured.rebuild);
      return { kind: "reset", from, to, dropped: rows };
    };
    const hold = (): EmbedderVerdict => {
      const fresh = held !== configuredTag;
      if (fresh) db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)", EMBEDDER_HELD_META_KEY, configuredTag);
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
      if (rows === 0) return dropAndTag(recorded.tag);
      if (recorded.rebuild === "inline") return dropAndTag(recorded.tag);
      return hold();
    }
    if (rows === 0) {
      db.run("DELETE FROM cache_meta WHERE key = ?", EMBEDDER_HELD_META_KEY);
      const tag = takenTag(configured);
      writeTag(db, tag, configured.rebuild);
      return { kind: "tagged", tag, adopted: 0 };
    }
    // Untagged rows.
    const dims = db.all<{ dim: number }>("SELECT DISTINCT dim FROM embeddings").map((r) => r.dim);
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
  if (verdict.kind !== "held") writerIdentity.set(db, configured);
  return verdict;
}

/** Why a vector was not written, or a ranking not taken — by name. */
export type VectorRefusal =
  /** Box 3 is under a durable hold (`EMBEDDER_HELD_META_KEY`). */
  | "held"
  /** Box 3 was written by a newer build. */
  | "cache-ahead"
  /**
   * The file now names ANOTHER identity than this handle's: a process with a
   * newer configuration reset or re-tagged it after this handle opened (a
   * session-long MCP server, the re-review's MAJOR A). A vector written now
   * would be filed under a tag it does not match; a cosine taken now would
   * cross two models.
   */
  | "identity-changed";

/** The file's claim, read FRESH: one primary-key read of three `cache_meta` rows. */
function fileClaim(db: Db): { tag: string | null; held: string | null; ahead: boolean } {
  let rows: { key: string; value: string }[];
  try {
    rows = db.all<{ key: string; value: string }>(
      "SELECT key, value FROM cache_meta WHERE key IN ('schemaVersion', ?, ?)",
      EMBEDDER_META_KEY,
      EMBEDDER_HELD_META_KEY,
    );
  } catch {
    return { tag: null, held: null, ahead: false };
  }
  const get = (k: string): string | null => {
    const v = rows.find((r) => r.key === k)?.value;
    return v === undefined || v.length === 0 ? null : v;
  };
  return {
    tag: get(EMBEDDER_META_KEY),
    held: get(EMBEDDER_HELD_META_KEY),
    ahead: schemaAhead(get("schemaVersion"), CACHE_SCHEMA_VERSION),
  };
}

function refusalFor(
  claim: { tag: string | null; held: string | null; ahead: boolean },
  identity: EmbedderIdentity | undefined,
  dim: number,
): VectorRefusal | null {
  if (claim.ahead) return "cache-ahead";
  if (claim.held !== null) return "held";
  if (identity === undefined || claim.tag === null) return null;
  const recorded = parseIdentityTag(claim.tag);
  if (recorded.model !== identity.model) return "identity-changed";
  // An inline table's width is part of its identity; a paid seat's is its
  // provider's (see `sameIdentity`), and the scan's width filter covers it.
  if (identity.rebuild === "inline" && recorded.dim !== null && recorded.dim !== dim) return "identity-changed";
  return null;
}

/**
 * THE PER-CALL CHECK FOR A RANKING (re-review of #190, MAJOR A). The at-open
 * check is not enough for a handle that lives all session: another process
 * may reset or re-tag box 3 under it. So every ranking reads the file's claim
 * first — the same cheap read #187 makes of the schema stamp on every tool
 * call — and answers nothing, by name, when the file is held, ahead, or now
 * another identity's. A handle with no identity (the console, the dashboard)
 * is checked for the hold and the stamp only; the width filter in `nearest`
 * is its last line.
 */
export function searchRefusal(db: Db, identity: EmbedderIdentity | undefined, dim: number): VectorRefusal | null {
  return refusalFor(fileClaim(db), identity, dim);
}

/**
 * THE PER-WRITE CHECK, and "written whenever vectors are written" (the tag
 * follows the vectors). Called INSIDE the vector write's own transaction, so
 * the check, the vector and the tag it implies are one unit:
 *
 *   - the file held, ahead, or now another identity's → REFUSED: no vector is
 *     written, and the memory is left unembedded for whichever process owns the
 *     file now (its backfill fills it);
 *   - otherwise, a handle with a reconciled identity re-tags the file when its
 *     `<model>@<dim>` differs from the file's (a first vector; a paid seat's
 *     width learned; a model-only tag completed). A handle with no identity
 *     (the console converting rows, a test's bare cache) writes no tag.
 */
function admitVector(db: Db, dim: number): VectorRefusal | null {
  const identity = writerIdentity.get(db);
  const claim = fileClaim(db);
  const refusal = refusalFor(claim, identity, dim);
  if (refusal !== null || identity === undefined) return refusal;
  const tag = identityTag(identity.model, dim);
  if (claim.tag !== tag) writeTag(db, tag, identity.rebuild);
  return null;
}

/**
 * Scoped to box 3 alone: drops only this file's tables, touches no canonical state.
 *
 * `keepEmbeddings` spares exactly one table, and it exists because "rebuildable"
 * is not the same claim for all four. `doc_tokens`, `doc_lens` and `ranking` are
 * recomputed from state this process already holds; `embeddings` are recomputed
 * from a PAID NETWORK CALL, one per row, and a console with no embedder wired
 * cannot put them back at all (`adapters/cli/NOTES.md`, 2026-09-04 — a bare
 * `verify` would have dropped ~13,700 of them). The table is left in place
 * rather than read out and rewritten, so nothing has to fit in memory.
 */
export function resetCache(db: Db, opts: { keepEmbeddings?: boolean } = {}): void {
  // A rebuild re-stamps the version, so on a newer build's cache it would be a
  // downgrade by another name. Refused by the same code box 2 uses.
  const ahead = cacheAhead(db);
  if (ahead !== null) throw new StoreError("SCHEMA_AHEAD", { box: "cache", expected: ahead.expected, found: ahead.found });
  const keep = opts.keepEmbeddings === true;
  const drop = keep ? TABLES.filter((t) => t !== "embeddings") : TABLES;
  forgetAvgDocLen(db);
  db.transaction(() => {
    // KEEP MEANS KEEP THE TAG TOO — and the hold. `cache_meta` is one of the
    // dropped tables, and a rebuild that spared the vectors but dropped the
    // line saying which model wrote them would leave untagged rows behind. A
    // rebuild that DROPS the vectors drops both, and that is one of the two
    // ways out of a hold (`heldExits`).
    const tag = keep
      ? db.all<{ key: string; value: string }>(
          "SELECT key, value FROM cache_meta WHERE key IN (?, ?, ?)",
          EMBEDDER_META_KEY,
          EMBEDDER_REBUILD_META_KEY,
          EMBEDDER_HELD_META_KEY,
        )
      : [];
    for (const t of drop) db.exec(`DROP TABLE IF EXISTS ${t}`);
    for (const sql of DDL) db.exec(sql);
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", String(CACHE_SCHEMA_VERSION));
    for (const r of tag) db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES (?, ?)", r.key, r.value);
  });
  // No vectors, no tag: the next vector written re-tags (`admitVector`).
}

// ── vectors: the wire shape of box 3's embeddings ────────────────────────────

/**
 * A vector as box 3 stores it since v4: **`dim` little-endian float32s**, not
 * JSON text.
 *
 * The measurement that motivated it (`docs/LAUNCH-STATUS.md` §E-W1(4), and the
 * synthetic re-measurement in this module's NOTES): at 1,024 dimensions a JSON
 * row is ~12.7 KB against 4 KB of float32, and `nearest()` — a full scan that
 * `JSON.parse`d every row — cost 590–1,040 ms on the live store's ~13.9K
 * vectors. Nothing about that is the parser being slow; it is the SCAN reading
 * three times the bytes and then allocating a 1,024-element `number[]` per row
 * to throw away.
 *
 * **float32 is not a lossy choice for an embedding, it is the embedder's own
 * precision.** Every provider this adapter speaks to computes and serves single
 * precision; JSON text was storing float64 room that never held float64
 * information. What float32 IS lossy about is a value that arrived as a
 * float64 which is not exactly representable as a float32 — a re-serialized
 * vector, a hand-written test fixture — and there the round trip moves the
 * value by at most one float32 ulp (~1e-7 relative). `nearest` accumulates in
 * float64 either way, so for a vector whose values are already float32-exact
 * (`Math.fround(x) === x`) the scores are BIT-IDENTICAL before and after; that
 * is the property `test/store.test.ts` pins, and the general case is pinned as
 * same-order, ≤1e-6 score movement.
 */
export function encodeVector(vec: readonly number[]): Uint8Array {
  const f = new Float32Array(vec.length);
  // `Number.isFinite`, not `?? 0`: a `NaN` or an infinity is not a coordinate,
  // and it must not reach the scan. v3 coerced it by accident —
  // `JSON.stringify(NaN)` is `"null"` and `JSON.parse` gave back `null ?? 0` —
  // so writing it through would have been a REGRESSION dressed as a format
  // change. A NaN row scores `NaN`, and `nearest`'s comparator
  // (`b.score - a.score || id`) reads `NaN - x` as falsy and falls through to
  // the id tiebreak, so one such row sorts anywhere at all, first included.
  // `countNonFinite` is how a caller reports what it coerced.
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i];
    f[i] = typeof x === "number" && Number.isFinite(x) ? x : 0;
  }
  return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
}

/** How many of `vec`'s entries `encodeVector` would coerce to zero. */
export function countNonFinite(vec: readonly number[]): number {
  let n = 0;
  for (const x of vec) if (!(typeof x === "number" && Number.isFinite(x))) n += 1;
  return n;
}

/**
 * Read a stored vector back in whatever shape the row holds — float32 BLOB
 * (v4) or JSON text (v3 and earlier).
 *
 * Tolerating both is deliberate and is what makes the migration safe rather
 * than a flag day: a cache mid-`migrate-cache` (or one written by a v4 process
 * and last converted by nothing) is MIXED, and a reader that assumed one shape
 * would turn an unconverted row into either a crash or a silent zero-similarity
 * lie. The cost is one `typeof` per row.
 *
 * The BLOB arm returns a `Float32Array` VIEW where it can — no per-row copy of
 * 1,024 numbers, which is most of what the old scan spent. A driver that hands
 * back a pooled buffer at an unaligned `byteOffset` (node:sqlite's `Buffer`s do
 * this; bun:sqlite's always start at 0) forces one copy, which is what the
 * second arm is.
 *
 * A byte length that is not a multiple of four is **not** a short vector, it is
 * a CORRUPT ROW, and it comes back empty rather than truncated: truncating
 * would hand the scan a silently shortened vector and a cosine computed over a
 * prefix, which is a wrong number with no signal on it. Empty scores 0 through
 * `cosine`'s zero-norm arm, `nearestVectors` skips it, and `vectorFormats`
 * counts the row in `other` so a census names it instead of a scan hiding it.
 */
export function decodeVector(raw: SqlValue): Float32Array | number[] {
  if (typeof raw === "string") return JSON.parse(raw) as number[];
  if (raw instanceof Uint8Array) {
    if (raw.byteLength % 4 !== 0) return [];
    const n = raw.byteLength >>> 2;
    if (n === 0) return [];
    if (raw.byteOffset % 4 === 0) return new Float32Array(raw.buffer, raw.byteOffset, n);
    const copy = new Uint8Array(raw); // fresh buffer, byteOffset 0
    return new Float32Array(copy.buffer, 0, n);
  }
  return [];
}

/** How many vectors box 3 holds, in each of the two shapes. Cheap: a grouped count. */
export interface VectorFormatCensus {
  readonly total: number;
  /** v4 rows: `dim` little-endian float32s. */
  readonly float32: number;
  /** v3 rows: `JSON.stringify(vec)`. What `migrate-cache` converts. */
  readonly jsonText: number;
  /**
   * Unreadable: neither shape, or a BLOB whose byte length is not a multiple
   * of four (`decodeVector` returns empty for those rather than a truncated
   * vector). Named rather than folded into a total.
   */
  readonly other: number;
  /** `SUM(LENGTH(vec))` over each shape, in bytes. */
  readonly float32Bytes: number;
  readonly jsonTextBytes: number;
}

export function vectorFormats(db: Db): VectorFormatCensus {
  // The GROUP BY key is the shape as a READER sees it, not `typeof` alone: a
  // blob of 4,097 bytes has `typeof = 'blob'` and is still not a vector, and a
  // census that counted it as one would report a store as fully converted while
  // `decodeVector` was returning empty for it.
  const rows = db.all<{ t: string; n: number; b: number | null }>(
    `SELECT CASE
              WHEN typeof(vec) = 'blob' AND LENGTH(vec) % 4 = 0 THEN 'blob'
              WHEN typeof(vec) = 'text' THEN 'text'
              ELSE 'other'
            END AS t,
            COUNT(*) AS n, SUM(LENGTH(vec)) AS b
       FROM embeddings GROUP BY t`,
  );
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
    } else other += r.n;
  }
  return { total: float32 + jsonText + other, float32, jsonText, other, float32Bytes, jsonTextBytes };
}

export interface ConvertBatchReport {
  /** Rows examined this batch. Zero means the walk is finished. */
  readonly examined: number;
  /** Rows rewritten as float32 BLOBs. */
  readonly converted: number;
  /** Rows whose `vec` would not parse — left exactly as they are, and named. */
  readonly skipped: readonly string[];
  /** Coordinates coerced to zero because they were NaN or infinite. */
  readonly coerced: number;
  /** The last `memory_id` examined, to continue the walk past a skipped row. */
  readonly lastId: string | null;
}

/**
 * Convert up to `batch` JSON-text vectors to float32 BLOBs, in ONE transaction,
 * and report what happened. `examined === 0` means the walk is finished.
 *
 * **Batched, not one statement**, because this runs on a 177 MB file the
 * Stop-hook worker also writes to: a single transaction over 13.9K rows holds
 * box 3's write lock for the whole rewrite, and `BUSY_TIMEOUT_MS` is five
 * seconds. Idempotent by its WHERE clause — a converted row is not selected —
 * so an interrupted run resumes by being run again, and a finished one is a
 * no-op.
 *
 * **`after` is what makes one bad row survivable.** The first version parsed
 * inside the transaction and let a throw roll the batch back; because the
 * selection is `ORDER BY memory_id LIMIT ?`, the very next attempt selected the
 * same unparseable row and threw again, and every row after it stayed in the
 * old shape forever — one corrupt byte holding 13,000 vectors hostage. Now a
 * row that will not parse is SKIPPED, NAMED, and left untouched (nothing here
 * repairs data it cannot read), and the caller walks past it with
 * `after = lastId`.
 */
export function convertVectorBatch(db: Db, batch = 500, after?: string): ConvertBatchReport {
  const rows =
    after === undefined
      ? db.all<{ memory_id: string; vec: SqlValue }>(
          "SELECT memory_id, vec FROM embeddings WHERE typeof(vec) = 'text' ORDER BY memory_id LIMIT ?",
          batch,
        )
      : db.all<{ memory_id: string; vec: SqlValue }>(
          "SELECT memory_id, vec FROM embeddings WHERE typeof(vec) = 'text' AND memory_id > ? ORDER BY memory_id LIMIT ?",
          after,
          batch,
        );
  const lastId = rows.length === 0 ? null : (rows[rows.length - 1]?.memory_id ?? null);
  if (rows.length === 0) return { examined: 0, converted: 0, skipped: [], coerced: 0, lastId };
  // Parse OUTSIDE the transaction: a throw here must cost one row, not a batch.
  const decoded: { id: string; arr: number[] }[] = [];
  const skipped: string[] = [];
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

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** (Re)index one document. Idempotent: the doc's prior rows are replaced wholesale. */
export function indexDoc(db: Db, id: string, text: string, vec?: readonly number[]): VectorRefusal | null {
  const counts = new Map<string, number>();
  let len = 0;
  for (const tok of tokenize(text)) {
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
    len += 1;
  }
  forgetAvgDocLen(db);
  return db.transaction((): VectorRefusal | null => {
    db.run("DELETE FROM doc_tokens WHERE memory_id = ?", id);
    const ins = db.prepare("INSERT INTO doc_tokens (memory_id, token, tf) VALUES (?, ?, ?)");
    for (const [token, tf] of counts) ins.run(id, token, tf);
    // A document with no indexable tokens has no length either: it leaves the
    // table rather than dragging a zero through `AVG(len)`.
    if (len > 0) db.run("INSERT OR REPLACE INTO doc_lens (memory_id, len) VALUES (?, ?)", id, len);
    else db.run("DELETE FROM doc_lens WHERE memory_id = ?", id);
    if (vec === undefined) return null;
    const refusal = admitVector(db, vec.length);
    if (refusal !== null) {
      // The text changed and this vector may not be filed: the row's OLD
      // vector (if any) describes words the memory no longer says, so it goes,
      // and the memory waits for the owning identity's backfill.
      db.run("DELETE FROM embeddings WHERE memory_id = ?", id);
      forgetNeighbours(db, id);
      return refusal;
    }
    db.run(
      "INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
      id,
      vec.length,
      encodeVector(vec),
    );
    return null;
  });
}

/**
 * Write ONE document's vector, and touch nothing else.
 *
 * Split out of `indexDoc` because the backfill needs exactly this and `indexDoc`
 * does far more: it `DELETE`s and re-inserts every token row for the document.
 * For a memory whose text has not changed, that is pure churn on `doc_tokens` —
 * and `doc_tokens` is the 263 MB index whose page-cache warming measured 794-819
 * ms on the first recall of every fresh hook process, which is the whole reason
 * `BUDGET_MS` went from 250 to 1200. Sixty-four token-index rewrites per Stop
 * would have fought the constraint that motivated the lag in the first place.
 */
export function setEmbedding(db: Db, id: string, vec: readonly number[]): VectorRefusal | null {
  // ONE transaction for the check, the vector and the tag it may imply (a
  // SAVEPOINT when the caller already holds one — the at-open refill does): a
  // crash between them must not leave a vector under no tag, or a tag with no
  // rebuild key. Returns the refusal, by name, or null when the vector landed.
  return db.transaction((): VectorRefusal | null => {
    const refusal = admitVector(db, vec.length);
    if (refusal !== null) return refusal;
    db.run(
      "INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
      id,
      vec.length,
      encodeVector(vec),
    );
    return null;
  });
}

/**
 * Take one document OUT of the text index — the other half of `indexDoc`.
 *
 * **The rule this makes structural: the index is the index OF THE LIVE STORE.**
 * `doc_tokens` is what `docFrequency` counts and what `searchIndex` selects
 * from, and both of those numbers are read against a LIVE denominator:
 * `recall/`'s `storeSize` is `store.list({ archived: false }).length`, and
 * `activate.ts` throws away any hit whose row is archived or superseded. While
 * a dead row kept its token rows, the two counts came from two different
 * populations — so `df > storeSize` was reachable, and
 * `informativeness(df, storeSize)` returns exactly zero at `df >= storeSize`.
 * MEASURED 2026-09-04: a fresh store, one note, one revision — `revision.ts`
 * calls `Store.supersede`, the head is archived and stays indexed,
 * `df(sourdough) = 2` against `storeSize = 1`, every cue is dropped, and the
 * MCP `recall` door answers `nothing-came` on a store whose only memory plainly
 * matches the question. That is NOTES §12's N=1 re-zeroing, restored by an
 * ordinary revision (LAUNCH-STATUS I13).
 *
 * It also stops a dead row from spending a slot ON THE LEXICAL CHANNEL:
 * `searchIndex` takes the top `limit` per cue, and a row `activate` will
 * discard was still winning one of them. Narrowing the candidate SET is the
 * same failure length normalization was moved into the SQL to avoid.
 *
 * **`embeddings` is left alone, and the semantic half of that same slot problem
 * is therefore still OPEN.** A vector cost a paid network call, so deleting it
 * here would spend money — but the first draft of this docblock justified that
 * with "nothing reads a dead row's vector", and an adversarial review measured
 * the opposite: `nearest` (below) scans `embeddings` with no filter, and
 * `activate.ts`'s semantic channel takes that ranking as `SEMANTIC_TOP_M`
 * candidates before discarding the dead one. After a `supersede`, `nearestTo`
 * returned the dead row FIRST of three. So what is true is narrower: nothing
 * can be DELIVERED from a dead row, and its vector can still displace a live
 * neighbour from the semantic slate. Named as a follow-up in
 * `recall/NOTES.md` §13 (filter inside `Store.nearestTo` — over-fetch and drop
 * the non-live against box 2, the shape the lexical half just got) rather than
 * widened into this change. `rebuildCache` does not carry a dead row's vector
 * forward — a rebuild reproduces the LIVE index — and that asymmetry is named
 * there too.
 *
 * **Two things this does NOT reach, deliberately.** The `ranking` table keeps
 * the row: it is keyed by id and read per-id by callers that already iterate
 * live rows, so it is inert rather than wrong. And the rule is kept by the two
 * WRITERS of `archived = 1` that live in this module — `Store.archive` and
 * `Store.supersede`; the third, `owner-op-seam.ts`'s removal scrub, is reached
 * only by its caller's convention (the console's destruction path always
 * follows it with `rebuildCache`, which drops the row as `skippedDenied`). If
 * that rebuild ever failed, `counterparts verify`'s "indexed but not live" line
 * now names the leftover instead of hiding it.
 */
export function deindexDoc(db: Db, id: string): void {
  forgetAvgDocLen(db);
  db.transaction(() => {
    db.run("DELETE FROM doc_tokens WHERE memory_id = ?", id);
    db.run("DELETE FROM doc_lens WHERE memory_id = ?", id);
    // v6: a dead row is nobody's neighbour, and has none of its own. (Its
    // VECTOR stays, as above — the neighbour rows are free to recompute.)
    forgetNeighbours(db, id);
  });
}

/** How many vectors box 3 holds. The count `unembeddedCount()` is NOT. */
export function embeddingCount(db: Db): number {
  return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings")?.n ?? 0;
}

export interface Hit {
  id: string;
  score: number;
}

/**
 * Deterministic: score desc, then id asc — so "same cue, same order" is testable.
 *
 * The normalization is applied **inside the SQL, before `ORDER BY … LIMIT`**,
 * and that placement is the fix rather than a detail of it. Normalizing the
 * score afterwards in the caller would have left the CANDIDATE SET chosen by
 * raw `SUM(tf)`: the longest documents would still occupy all `limit` slots for
 * every cue, and the caller would only have re-ranked a set that was already
 * wrong.
 *
 * `LEFT JOIN` + `COALESCE`: a row whose length is not (yet) known is treated as
 * average rather than dropped. Box 3 is rebuildable and partially-built states
 * are ordinary; a missing length must cost precision, never a hit.
 *
 * `CAST(… AS REAL)` on every operand: SQLite divides integers as integers, and
 * both drivers bind an integer-valued JS number as INTEGER. At `b = 1` with an
 * integer mean length, `1 * len / avg` would truncate — silently, and only for
 * some values of the tunables, which is the worst way for arithmetic to be wrong.
 */
/**
 * THE AMBIENT PREFILTER (2026-10-10, Group 1, review 03 C2): the SQL that keeps
 * a row the last decay pass read as BELOW REACH out of a top-K, so it cannot
 * take a slot an in-reach memory would have had. Read off box 3's own
 * `ranking` table, at most one decay pass stale: a row never ranked (born
 * since) passes, the identity band passes, and the caller rechecks the exact
 * strength (`recall/activate.ts`). A memory revived since the last pass waits
 * for the next one to come back through here — deliberate recall, which does
 * not prefilter, finds it meanwhile.
 */
function reachJoin(alias: string): string {
  return `LEFT JOIN ranking rk ON rk.memory_id = ${alias}.memory_id`;
}
const REACH_WHERE = `(rk.memory_id IS NULL OR rk.strength >= ? OR rk.band = 'identity')`;

export function searchIndex(
  db: Db,
  cue: string,
  limit = 10,
  norm: LengthNorm = DEFAULT_LENGTH_NORM,
  minStrength: number | null = null,
): Hit[] {
  const tokens = [...new Set(tokenize(cue))];
  if (tokens.length === 0) return [];
  const placeholders = tokens.map(() => "?").join(",");
  const avg = avgDocLen(db);
  const lengthFactor =
    `CAST(? AS REAL) + CAST(? AS REAL) * COALESCE(dl.len, CAST(? AS REAL)) / CAST(? AS REAL)`;
  const clamped = norm.oneSided === true ? `MAX(1.0, ${lengthFactor})` : lengthFactor;
  const reach = minStrength !== null && Number.isFinite(minStrength);
  const rows = db.all<{ memory_id: string; score: number }>(
    `SELECT dt.memory_id AS memory_id,
            SUM(CAST(dt.tf AS REAL) * CAST(? AS REAL)
                / (dt.tf + CAST(? AS REAL) * (${clamped}))) AS score
       FROM doc_tokens dt
       LEFT JOIN doc_lens dl ON dl.memory_id = dt.memory_id
       ${reach ? reachJoin("dt") : ""}
      WHERE dt.token IN (${placeholders})${reach ? ` AND ${REACH_WHERE}` : ""}
      GROUP BY dt.memory_id
      ORDER BY score DESC, dt.memory_id ASC
      LIMIT ?`,
    norm.k1 + 1,
    norm.k1,
    1 - norm.b,
    norm.b,
    avg,
    avg,
    ...tokens,
    ...(reach ? [minStrength as number] : []),
    limit,
  );
  return rows.map((r) => ({ id: r.memory_id, score: r.score }));
}

/**
 * Document frequency — in how many indexed documents does each token appear?
 *
 * This exists because the caller that needs df was counting the wrong thing.
 * `recall/activate.ts` took `df = searchIndex(tok, PER_CUE_FETCH).length`, which
 * is `min(trueDf, PER_CUE_FETCH)` — so on a store with more than
 * `PER_CUE_FETCH` documents holding a token, EVERY common word measured as
 * "appears in 24 documents" and drew a rarity weight near the maximum.
 * MEASURED 2026-09-04 on a 15,421-document index: `the` and `conversation`
 * scored `informativeness = 5.7` against a ceiling of 8.95, where their true
 * frequencies (df 350–10k) put them at 0–3. On a seventeen-memory fixture the
 * truncation cannot happen at all, so the bug was invisible to every hermetic
 * test and grew with the store.
 *
 * `doc_tokens` is keyed `(memory_id, token)`, so `COUNT(*)` per token IS the
 * document count — no `DISTINCT` needed, and the `doc_tokens_token` index
 * covers it. One grouped query for the whole turn: measured 8–36 ms cold and
 * 2–4 ms warm for 72 tokens on that same index.
 */
export function docFrequency(db: Db, tokens: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return out;
  // Bound the statement's variable count; SQLite's default limit is 999.
  const CHUNK = 400;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    const rows = db.all<{ token: string; n: number }>(
      `SELECT token, COUNT(*) AS n FROM doc_tokens WHERE token IN (${placeholders}) GROUP BY token`,
      ...slice,
    );
    for (const r of rows) out.set(r.token, r.n);
  }
  return out;
}

/**
 * Rank every stored vector against `vec`.
 *
 * **Only rows of the query's own width are scored (v5).** `cosine` reads the
 * common prefix of two vectors of different lengths, so a 1,024-d query against
 * a 256-d row used to produce a NUMBER — the cosine of a truncated query against
 * a whole row, which means nothing and ranks anyway. Since two embedders can
 * now have written this table (the identity check keeps them apart, and a held
 * mismatch is exactly the state where they are not), a row of another width is
 * skipped rather than scored. A CORRUPT row (`decodeVector` → empty) keeps its
 * old treatment — it scores 0 through `cosine`'s zero-norm arm, and the census
 * names it — because that is a different fault with its own reporting.
 */
export function nearest(db: Db, vec: readonly number[], limit = 10, minStrength: number | null = null): Hit[] {
  // The ambient prefilter (`reachJoin`, 2026-10-10): below-reach rows take no slot.
  const rows =
    minStrength !== null && Number.isFinite(minStrength)
      ? db.all<{ memory_id: string; vec: SqlValue }>(
          `SELECT e.memory_id AS memory_id, e.vec AS vec FROM embeddings e ${reachJoin("e")} WHERE ${REACH_WHERE}`,
          minStrength,
        )
      : db.all<{ memory_id: string; vec: SqlValue }>("SELECT memory_id, vec FROM embeddings");
  const hits: Hit[] = [];
  for (const row of rows) {
    const other = decodeVector(row.vec);
    if (other.length > 0 && other.length !== vec.length) continue;
    hits.push({ id: row.memory_id, score: cosine(vec, other) });
  }
  hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits.slice(0, limit);
}

// ── neighbours (v6) ──────────────────────────────────────────────────────────

/**
 * How many neighbours are kept per memory. The dream reads ranks up to
 * `MIXING_TO_RANK` (40); the extra are slack for what its read filters out
 * (queued, newer, unshowable).
 * Decided by lane0-builder, 2026-10-10, lightly held; revisit after ~5 lived days. Why: 40 + 8 covers the dream's widest read with room for its filters, at ~48 small rows a memory.
 */
export const NEIGHBOURS_KEPT = 48;

/** Take one memory out of the neighbour table — its own list, and every list it is on. */
export function forgetNeighbours(db: Db, id: string): void {
  db.run("DELETE FROM neighbours WHERE memory_id = ?", id);
  db.run("DELETE FROM neighbours WHERE neighbour_id = ?", id);
}

/** Write one memory's neighbours (replacing any it had), rank 0 the nearest. Never itself. */
export function writeNeighbours(db: Db, id: string, hits: readonly Hit[]): void {
  db.transaction(() => {
    db.run("DELETE FROM neighbours WHERE memory_id = ?", id);
    const ins = db.prepare("INSERT INTO neighbours (memory_id, rank, neighbour_id, cosine) VALUES (?, ?, ?, ?)");
    let rank = 0;
    for (const h of hits) {
      if (h.id === id) continue;
      ins.run(id, rank, h.id, h.score);
      rank += 1;
    }
  });
}

/**
 * One memory's stored neighbours, nearest first — or null when none were ever
 * written for it (the caller computes them). An empty list that WAS written
 * (a store with one vector) reads as null too, which only costs a recompute
 * against a table that small.
 */
export function readNeighbours(db: Db, id: string, limit: number): Hit[] | null {
  const rows = db.all<{ neighbour_id: string; cosine: number }>(
    "SELECT neighbour_id, cosine FROM neighbours WHERE memory_id = ? ORDER BY rank LIMIT ?",
    id,
    limit,
  );
  return rows.length === 0 ? null : rows.map((r) => ({ id: r.neighbour_id, score: r.cosine }));
}

/** Every vector, decoded once — for ranking many queries against one read. */
export function allVectors(db: Db): { id: string; vec: Float32Array | number[] }[] {
  return db
    .all<{ memory_id: string; vec: SqlValue }>("SELECT memory_id, vec FROM embeddings")
    .map((r) => ({ id: r.memory_id, vec: decodeVector(r.vec) }));
}

/** `nearest`'s ranking, over vectors already read (`allVectors`). Same order, same width rule. */
export function rankAgainst(rows: readonly { id: string; vec: ArrayLike<number> }[], vec: readonly number[], limit: number): Hit[] {
  const hits: Hit[] = [];
  for (const row of rows) {
    if (row.vec.length > 0 && row.vec.length !== vec.length) continue;
    hits.push({ id: row.id, score: cosine(vec, row.vec) });
  }
  hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits.slice(0, limit);
}

/**
 * The same ranking as `nearest`, returning the VECTORS rather than the ids —
 * the context slice a novelty measurement is error against. One scan, one
 * ordering, no second definition of "nearest" to drift from the first.
 */
export function nearestVectors(db: Db, vec: readonly number[], limit = 10): number[][] {
  const rows = db.all<{ memory_id: string; vec: SqlValue }>("SELECT memory_id, vec FROM embeddings");
  const scored: { id: string; score: number; vec: Float32Array | number[] }[] = [];
  for (const row of rows) {
    const other = decodeVector(row.vec);
    // Same width as the query or not at all — see `nearest`.
    if (other.length === 0 || other.length !== vec.length) continue;
    scored.push({ id: row.memory_id, score: cosine(vec, other), vec: other });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // `Array.from` only on the `limit` survivors: the caller's contract is
  // `number[][]`, and materializing the whole scan to satisfy it would give
  // back exactly the per-row allocation the BLOB read exists to avoid.
  return scored.slice(0, limit).map((s) => (Array.isArray(s.vec) ? s.vec : Array.from(s.vec)));
}

/**
 * `ArrayLike<number>` rather than `readonly number[]`: since v4 the stored side
 * arrives as a `Float32Array` view over the row's bytes, and widening the
 * parameter is what lets the scan score it WITHOUT copying it into an array
 * first. The arithmetic is unchanged and still accumulates in float64.
 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
