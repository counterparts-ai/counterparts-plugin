/** `verify`, `migrate-cache`, and the store repairs `backfill-claims` and `repair-dates` (moved out of `commands.ts`, 2026-10-11). */
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { localDate } from "../../core/time.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAIMED_DEFAULT_META_KEY } from "../../core/mint.js";
// `band` is imported rather than mirrored: the dashboard computes the live
// band with this exact function, and two implementations of "which band is this
// row in today" is how the two surfaces disagreed in the first place.
import { TUNABLES } from "../../core/physics/index.js";
// The ONE predicate for "this row is the journal, not a memory" — the same one
// the sleep phases and the dashboard's census use. A second copy of that test
// living here is how the console drifted away from them in the first place.
import { TUNABLES as SLEEP_TUNABLES, isJournal } from "../../core/sleep/index.js";
// The deep import into box 3's own driver — the same one `snapshot.ts` and
// `export.ts` make, and filed as INTERFACE-GAPS §5. `verify`'s census needs the
// number of vectors box 3 holds, and `Store` exposes no read for it.
import { BUSY_TIMEOUT_MS, foldWal, journalModeOf, openDb } from "../../core/store/db.js";
import type { Db, SqlValue, WalFold } from "../../core/store/db.js";
// Box 3's own door for the vector migration: `openCache` stamps the schema
// version, `vectorFormats` counts the two shapes, `convertVectorBatch` is the
// one transactional step. The conversion arithmetic lives in `store/cache.ts`
// beside the readers it must agree with, never in a second copy here.
import { convertVectorBatch, countNonFinite, openCache, vectorFormats } from "../../core/store/cache.js";
import {
  CACHE_SCHEMA_VERSION,
  EMBED_FAILED_PREFIX,
  SCHEMA_VERSION,
  Store,
  StoreError,
  decodeVector,
  DATABASE_FILE,
  describePreRowsRefusal,
  isPreRowsDatabase,
  preRowsMarkersIn,
  encodeVector,
  paths,
  storeExists,
} from "../../core/store/index.js";
import type { EventLogCensus, VectorFormatCensus } from "../../core/store/index.js";
import { repairDates } from "./repair-dates.js";
import type { Confidence } from "./repair-dates.js";
// The console's shared manners (2026-09-21): is there a person here, ask them,
// and say one marked line back.
import { typed } from "./ui.js";
import { EXIT, requireDirFlagForBulkWrite, openStoreAt, describeDirRefusal } from "./commands-shared.js";
import type { Io } from "./commands-shared.js";

// ── verify ──────────────────────────────────────────────────────────────────

/**
 * What box 3 holds right now, read WITHOUT going through `Store` — because
 * `Store` has no read API for it. `unembeddedCount()` is the coverage
 * denominator (live rows with no vector), not a count of the vectors held, and
 * the census needs the latter before it may drop anything.
 *
 * The direct open is the same deep import `snapshot.ts` and `export.ts` already
 * make (INTERFACE-GAPS §5): the CLI genuinely needs the database here, not the
 * store's abstraction of it. It is gated on the file EXISTING, because `openDb`
 * creates what it opens and a census that minted box 3 by looking at it would be
 * the instrument-mints-its-subject wart all over again (§7, closed 2026-08-26).
 */
interface CacheCensus {
  readonly path: string;
  /** False when box 3 has never been built here. Nothing was opened, nothing created. */
  readonly present: boolean;
  /** Null when the file is there and its tables are not — a half-built cache. */
  readonly counts: {
    readonly embeddings: number;
    readonly indexRows: number;
    readonly lengths: number;
    readonly ranking: number;
    /** The distinct ids the token index holds, for the set diff below. */
    readonly indexed: readonly string[];
    /**
     * Which SHAPE the vectors are in — float32 BLOB (v4) or JSON text (v3).
     * A census that counted them without saying which would not answer the one
     * question `migrate-cache` exists for, and a MIXED cache (an interrupted
     * migration) has to be visible: readers tolerate it, but it is not done.
     */
    readonly vectors: VectorFormatCensus;
  } | null;
  readonly why: string | null;
}

/**
 * THE BAND OF RECORD, RECONCILED (IMPROVEMENTS U8, 2026-09-14).
 *
 * `memories.band` is canonical and the ranking cache's `band` is derived, and
 * until this PR nothing kept them together: the decay phase wrote its reading
 * into box 3 alone, so on the live store 869 rows were semantic in the cache and
 * episodic in the table while the same pass emitted `band.transition` rows
 * saying they had moved. The ruling is that the TABLE FOLLOWS PHYSICS —
 * `sleep/decay.ts` now writes each row's band back when the column disagrees —
 * and this census is how that is checked rather than believed.
 *
 * THREE NUMBERS, because they are three different facts (scar §2.4):
 *   - `rows`      — live, non-journal rows: the population the column describes.
 *     The journal is not a memory and never earns a band (`sleep/types.ts`), and
 *     an archived or superseded row is deliberately outside box 3.
 *   - `disagree`  — the column contradicts the cache. After a decay pass that was
 *     not cut short by its budget (`sleep/tunables.ts` `BUDGETS.decay`, 20,000
 *     examined rows) this is 0, and a non-zero number means either no pass has
 *     run since this shipped or the store is larger than one pass and is still
 *     catching up, a budget's worth a day.
 *   - `unranked`  — live rows box 3 has never seen. Not a disagreement: there is
 *     nothing to disagree with. "Born since the last pass" is the ordinary
 *     cause and NOT the only one — `verify --rebuild` drops the `ranking` table
 *     with the rest of box 3 (`store/cache.ts#resetCache`) and repopulates only
 *     the index, so straight after a rebuild this reads EVERY live row until the
 *     next decay pass; a decay phase killed mid-body (`CycleKilled`, the
 *     watchdog) leaves everything it had not reached unranked the same way.
 */
interface BandOfRecordCensus {
  readonly rows: number;
  readonly disagree: number;
  readonly unranked: number;
}

function bandOfRecordCensus(store: Store): BandOfRecordCensus {
  const ranking = store.rankingAll();
  const denied = new Set(store.deniedIds());
  let rows = 0;
  let disagree = 0;
  let unranked = 0;
  for (const id of store.list({ archived: false })) {
    if (denied.has(id)) continue;
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    rows += 1;
    const ranked = ranking.get(id);
    if (ranked === undefined) unranked += 1;
    else if (ranked.band !== row.band) disagree += 1;
  }
  return { rows, disagree, unranked };
}

function bandOfRecordLines(c: BandOfRecordCensus): string[] {
  const out = [
    `  band of record: ${c.disagree} of ${c.rows} live rows disagree with the ranking cache` +
      `   (${c.unranked} not yet ranked)`,
  ];
  if (c.disagree > 0) {
    out.push(
      "    The decay phase writes each band move back to `memories.band` (U8), so a pass that",
      "    its budget did not cut short leaves 0 here. A number that survives several boundaries",
      "    means no boundary has run since this store was built — or that the pass is truncating.",
    );
  }
  if (c.unranked > 0) {
    out.push(
      "    Unranked rows are rows box 3 has not read yet: ones born since the last decay pass,",
      "    everything after a `verify --rebuild` (the rebuild drops the ranking table and does not",
      "    refill it), and whatever a decay phase killed mid-body never reached. The next boundary",
      "    ranks them; a count that survives one is a decay phase that is not finishing.",
    );
  }
  return out;
}

function censusCache(dir: string): CacheCensus {
  const path = paths.cache(dir);
  if (!existsSync(path)) return { path, present: false, counts: null, why: "never built" };
  let db: Db | undefined;
  try {
    db = openDb(path);
    const handle = db;
    const n = (sql: string): number => handle.get<{ n: number }>(sql)?.n ?? 0;
    return {
      path,
      present: true,
      why: null,
      counts: {
        embeddings: n("SELECT COUNT(*) AS n FROM embeddings"),
        indexRows: n("SELECT COUNT(*) AS n FROM doc_tokens"),
        lengths: n("SELECT COUNT(*) AS n FROM doc_lens"),
        ranking: n("SELECT COUNT(*) AS n FROM ranking"),
        indexed: handle
          .all<{ memory_id: string }>("SELECT DISTINCT memory_id FROM doc_tokens")
          .map((r) => r.memory_id),
        vectors: vectorFormats(handle),
      },
    };
  } catch (err) {
    return { path, present: true, counts: null, why: String((err as Error).message ?? err) };
  } finally {
    db?.close();
  }
}

/**
 * One line naming the shape box 3's vectors are in, and — when it is mixed —
 * what to run. An empty table is neither format and says so.
 */
function vectorFormatLine(v: VectorFormatCensus): string {
  if (v.total === 0) return "none held";
  const parts: string[] = [];
  if (v.float32 > 0) parts.push(`${v.float32} float32 BLOB (v4)`);
  if (v.jsonText > 0) parts.push(`${v.jsonText} JSON text (v3)`);
  if (v.other > 0) parts.push(`${v.other} unreadable`);
  const tail =
    v.jsonText > 0
      ? " — 'counterparts migrate-cache' converts them in place (dry run by default)"
      : "";
  return `${parts.join(", ")}${tail}`;
}

/**
 * `verify` — the census by default, the rebuild only when asked, and never the
 * rebuild by accident.
 *
 * **The sharp edge this exists to blunt.** `rebuildCache()` begins with
 * `resetCache`, which DROPS `embeddings` along with the rest of box 3, and this
 * console has no embedder to put them back: on the store this was found against,
 * a bare `counterparts verify` would have deleted ~13,700 vectors that each cost
 * a paid network call to recompute. `store/cache.ts` says the same thing in its
 * own voice about `backfillLengths`. Until PR #37 a bare `verify` was saved only
 * by ACCIDENT — it failed the layout check before it reached the store — and an
 * accident is not a guard.
 *
 * So the destructive half now needs `--rebuild`, and even then it refuses while
 * box 3 holds vectors nothing here can recompute, unless `--drop-vectors` says
 * out loud that losing them is the intent.
 *
 * **2026-09-05: the third door.** Refuse-unless-flag was the adapter-level
 * answer while preserving the vectors needed a core change; that change now
 * exists (`Store.rebuildCache({ keepVectors })`), so `--keep-vectors` rebuilds
 * the text index and leaves `embeddings` in place. The refusals stay exactly as
 * they were and now name it, because the safe option being available is not a
 * reason to make the destructive one quieter.
 */
/**
 * Refuse a PRE-ROWS store before this command opens anything of its own.
 *
 * `Store.open` refuses it by name, and ~20 doors get that for free because they
 * open a `Store` first. Two do not: `migrate-cache` opens box 3 directly and
 * never sees a `Store` at all, and `verify --rebuild` opens box 3 for its
 * census before it opens box 2. Review A measured both writing into a parked
 * pre-rows store's `cache/` — a `-shm` in the fixture, and on the owner's real
 * parked store a `--apply` would rewrite and VACUUM ~17,000 documents' index in
 * a store this build has declared it cannot read.
 *
 * Box 3 is rebuildable and out of the backup set, so this is not memory loss.
 * It is a door writing where the build said it would not, and a rebuild of that
 * cache after a rollback is a paid re-embed.
 */
function refusePreRows(dir: string, io: Io): number | null {
  // TWO SHAPES, and only the first is a filename question. The second is a v5
  // database wearing the v6 NAME, which `preRowsMarkersIn` cannot see — review
  // f5c measured `migrate-cache` running to completion on one, and
  // `verify --rebuild` reaching box 3 before box 2 refused it.
  const found = preRowsMarkersIn(dir);
  const detail: Record<string, string | number> = { dir, expected: SCHEMA_VERSION };
  if (found.length > 0) detail["found"] = found.join(", ");
  else if (isPreRowsDatabase(paths.operational(dir))) {
    detail["found"] = DATABASE_FILE;
    detail["reason"] = "no-body-column";
  } else return null;
  io.err(
    describePreRowsRefusal(
      new StoreError("STORE_PRE_ROWS", detail),
      "Name a store with --dir <path>.",
    ) ?? `refused: ${dir} was written before this build's floor.`,
  );
  return EXIT.failed;
}

export function verifyCommand(dir: string, io: Io, flags: Record<string, string | boolean | undefined>): number {
  // THE WRITING HALF NAMES ITS STORE (2026-09-05 ruling). The census is
  // read-only and stays open to `COUNTERPARTS_DATA_DIR`; these three are not.
  // `--drop-vectors` is guarded even though it is inert without `--rebuild`,
  // because it is a standing consent to lose embeddings and must never be
  // typed at a store the owner did not name.
  const writing =
    flags["rebuild"] === true
      ? (["verify --rebuild", "drops box 3 for the whole store and builds it again"] as const)
      : flags["prune-index"] === true
        ? ([
            "verify --prune-index",
            "deletes every archived and superseded row from the text index",
          ] as const)
        : flags["retry-skipped"] === true
          ? ([
              "verify --retry-skipped",
              "clears every embed.failed counter, so the backfill offers those ids again",
            ] as const)
          : flags["drop-vectors"] === true
            ? ([
                "verify --drop-vectors",
                "stands as consent to lose embeddings this console has no embedder to recompute",
              ] as const)
            : null;
  if (writing !== null) {
    const refusal = requireDirFlagForBulkWrite(dir, io, flags, writing[0], writing[1]);
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // BEFORE box 3 is opened, on every branch: `--rebuild`'s census opens the
  // cache before it opens box 2, so the refusal arrived after a `-shm` had
  // already moved (review A, MINOR-2).
  const preRowsRefusal = refusePreRows(dir, io);
  if (preRowsRefusal !== null) return preRowsRefusal;
  if (flags["rebuild"] !== true) {
    if (flags["prune-index"] === true) return verifyPruneIndex(dir, io);
    if (flags["retry-skipped"] === true) return verifyRetrySkipped(dir, io);
    return verifyCensus(dir, io);
  }
  // Both at once is a command line that contradicts itself, and guessing which
  // half the owner meant is the one thing a guard like this may not do.
  if (flags["drop-vectors"] === true && flags["keep-vectors"] === true) {
    io.err("refused: --drop-vectors and --keep-vectors say opposite things about the same rows.");
    return EXIT.refused;
  }
  return verifyRebuild(dir, io, flags["drop-vectors"] === true, flags["keep-vectors"] === true);
}

/**
 * `--prune-index` — the CHEAP repair, and the only one for a store that holds
 * vectors.
 *
 * The text index is the index of the live store (I13, `store/cache.ts#deindexDoc`):
 * `archive` and `supersede` take a row out of it, and a store written before
 * they did still holds its dead rows' tokens, where they go on counting toward
 * document frequency against a live denominator. The repair is a pure function
 * of what both boxes already hold, so — exactly like `backfillLengths` — it must
 * not be paid for with `--rebuild`, which drops every embedding.
 */
function verifyPruneIndex(dir: string, io: Io): number {
  const store = openStoreAt({ dir });
  try {
    const removed = store.pruneDeadIndex();
    io.out(`Store: ${dir}`);
    io.out(`Dropped from the text index (archived or superseded): ${removed}`);
    io.out(
      removed === 0
        ? "The index already held live rows only."
        : "Embeddings are untouched — this repair never resets box 3.",
    );
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * `--retry-skipped` — the way BACK for an id the backfill gave up on.
 *
 * A skip is not a denial: the memory is live, recallable and lexically indexed,
 * and only its vector is missing. But the skip is self-sealing —
 * `missingVectors` stops offering the id, so the backfill never tries it, so the
 * counter that caused the skip can never be cleared by a run that lands. Until
 * this flag the only remedy was editing box 2 by hand, and `verify` printed a
 * remedy ("repair it, or rebuild box 3") that could not work: a rebuild has no
 * embedder to recompute anything and never touches meta.
 *
 * So: clear every counter, name how many, and let the next boundary's backfill
 * decide again on the evidence. It writes nothing but those rows — no prose, no
 * index, no embeddings — which is why it is the one writing verify flag that can
 * lose nothing.
 */
function verifyRetrySkipped(dir: string, io: Io): number {
  const store = openStoreAt({ dir });
  try {
    const skipped = store.skippedVectorIds();
    const held = store.metaWithPrefix(EMBED_FAILED_PREFIX);
    const moves: [string, string][] = [];
    for (const [key, value] of held) {
      if (value !== "0") moves.push([key, "0"]);
    }
    if (moves.length > 0) store.setMetaMany(moves);
    io.out(`Store: ${dir}`);
    io.out(`Embed-failure counters cleared: ${moves.length}`);
    io.out(`Back in the backfill's rotation: ${skipped.length}`);
    if (skipped.length > 0) io.out(`  ${skipped.join(", ")}`);
    io.out(
      moves.length === 0
        ? "Nothing was being skipped; the backfill was already offering every live row."
        : "Nothing else changed. If the text is still poison they will be skipped again.",
    );
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * The durable event log, as `verify` prints it: what is held, how old the
 * oldest row is, and — the number this exists for — what the next cycle's log
 * sweep would delete. Before 2026-09-05 nothing swept the log at all
 * (`sleep/NOTES.md` §13); the first sweep on a store that has never been swept
 * is a deletion somebody should be able to see the size of BEFORE it runs,
 * which is what this read-only line is for. The cap is the sleep budget itself,
 * imported rather than restated, so the number printed is the number in force.
 */
export function eventLogLines(log: EventLogCensus, zone?: string): string[] {
  const cap = SLEEP_TUNABLES.BUDGETS.log;
  const wouldDelete = Math.min(log.eligible, cap);
  const oldest =
    log.oldestDay === null || log.oldestAt === null
      ? "oldest: none"
      : `oldest: lived day ${log.oldestDay} (${localDate(log.oldestAt, zone)})`;
  return [
    `Events: ${log.rows} held (${log.latched} latched records)   ${oldest}   ` +
      `window: ${log.retentionDays} lived days (cutoff day ${log.cutoffDay})`,
    `  past the window: ${log.eligible} unlatched (the next sleep pass deletes ${wouldDelete}, cap ${cap} per pass)` +
      `, ${log.latchedPastCutoff} latched records kept`,
  ];
}

/**
 * Read-only. Opens the store in OBSERVER stance and box 3 on its own connection,
 * one after the other rather than both at once, and writes nothing canonical.
 * (Constructing a `Store` still rewrites box 3's schema-version row when it is
 * out of date — dashboard INTERFACE-GAPS §1 — which is box 3's business.)
 */
function verifyCensus(dir: string, io: Io): number {
  const store = openStoreAt({ dir, observer: true });
  let canonical: string[];
  let live: string[];
  let denied: string[];
  let unembedded: number;
  let skippedVectors: string[];
  let faulted: string[];
  let schemaVersion: string | null;
  let log: EventLogCensus;
  let bands: BandOfRecordCensus;
  try {
    canonical = store.list();
    // What the INDEX is supposed to cover, since I13: the live rows. An
    // archived or superseded row is canonical and deliberately unindexed.
    live = store.list({ archived: false });
    denied = store.deniedIds();
    unembedded = store.unembeddedCount();
    // The other half of that sum since I33: ids the backfill has given up on
    // after `EMBED_SKIP_AFTER` failed runs. They are excluded from the count
    // above on purpose — it reports what is still actionable — so leaving them
    // unprinted here would be the coverage watch quietly losing rows.
    skippedVectors = store.skippedVectorIds();
    faulted = store.faultedIds();
    schemaVersion = store.getMeta("schemaVersion") ?? null;
    log = store.eventLogCensus();
    bands = bandOfRecordCensus(store);
  } finally {
    store.close();
  }

  const cache = censusCache(dir);
  io.out(`Store: ${dir}`);
  // How the boxes are being held open, on the day WAL landed: the mode is in the
  // file header, so this says what the NEXT process will find, not what this one
  // asked for. A store still reading `delete` means no writer on THIS build has
  // opened it since the deploy — or that one on the build before it has, since
  // that one set the mode unconditionally and would have set it back.
  io.out(
    `Journal mode: ${journalModeOf(paths.operational(dir))} (busy timeout ${BUSY_TIMEOUT_MS} ms)`,
  );
  io.out(
    `Canonical rows: ${canonical.length}   live rows: ${live.length}   ` +
      `removed (deny-list): ${denied.length}`,
  );
  // WHERE THE WORDS ARE. This was two census lines counting how the two path
  // columns were spelled and how many of their files were on disk (§5 G15,
  // finding I22) — a report ON the file layout, which the floor deleted along
  // with the columns. What replaces it is a one-line statement of the floor
  // this store is on, because "prose files: none" is the fact an owner looking
  // for his markdown needs, and a store that still had any would be a store
  // this build refused to open (`STORE_PRE_ROWS`).
  io.out(
    `Floor: schema v${schemaVersion ?? "?"} · bodies in rows · prose files: none` +
      (schemaVersion === String(SCHEMA_VERSION)
        ? ""
        : ` (this build writes v${SCHEMA_VERSION})`),
  );
  // ROWS WHOSE WORDS WENT MISSING, counted beside the floor line.
  //
  // One of these stands EVERY session down (`MEMORY_BODY_MISSING` out of
  // `Schemas.load`), and before this `verify` printed a green census over it
  // and exited 0 — the owner had a dead store and two surfaces telling him it
  // was fine (review B, MAJOR-3). Named, not just counted: the id is the only
  // handle there is on this floor.
  if (faulted.length > 0) {
    io.err(
      `Rows whose words are missing: ${String(faulted.length)} — ${faulted.slice(0, 5).join(", ")}` +
        (faulted.length > 5 ? ` and ${String(faulted.length - 5)} more` : "") +
        ". Each has an empty body and a content hash that still names it, which no write path " +
        "in this build produces. A session that loads a BELIEF or reads that memory stands down: " +
        "a faulted schema row takes every session with it, an ordinary memory only the reads that " +
        "reach it. Restore a snapshot over the store, or remove that row by id to tombstone it " +
        "and let sessions start again.",
    );
  }
  for (const line of eventLogLines(log, store.zone())) io.out(line);

  // The unreadable half of this is narrow by construction: `Store.open` builds
  // box 3 on the way in, so a cache this process cannot read usually fails the
  // open above and is reported there. It is still handled, because between that
  // close and this read is a window another process can change.
  if (cache.counts === null) {
    io.out(
      cache.present
        ? `Cache: ${cache.path} — unreadable (${cache.why ?? "no reason given"}).`
        : `Cache: absent — box 3 has never been built here.`,
    );
    if (canonical.length === 0) {
      io.out("Nothing canonical to index, so nothing is missing.");
      return EXIT.ok;
    }
    io.err(
      cache.present
        ? `${canonical.length} canonical rows and a cache that would not open — retry (another process may hold it); if it is truly gone, 'counterparts verify --rebuild' builds box 3 again.`
        : `${canonical.length} canonical rows have no index — run 'counterparts verify --rebuild' to build box 3.`,
    );
    return EXIT.failed;
  }

  // A SET DIFF, not arithmetic: `indexed + denied === canonical` can agree by
  // coincidence while holding the wrong ids, and it cannot say WHICH way it is
  // wrong. Both directions are named, because an orphaned index row and an
  // unindexed memory are different problems.
  const indexed = new Set(cache.counts.indexed);
  const known = new Set(canonical);
  const liveSet = new Set(live);
  const deniedSet = new Set(denied);
  const missing = live.filter((id) => !indexed.has(id) && !deniedSet.has(id));
  const orphans = cache.counts.indexed.filter((id) => !known.has(id));
  // A THIRD state, and it needs its own name and its own repair: an id that is
  // a canonical row but not a live one, still holding token rows. It is not an
  // orphan (the row exists) and it is not missing (it is there); it is a dead
  // row voting on document frequency against a live denominator, which is I13.
  // `--rebuild` would fix it and drop every embedding on the way; the cheap
  // repair is `--prune-index`.
  const stale = cache.counts.indexed.filter((id) => known.has(id) && !liveSet.has(id));

  io.out(`Cache: ${cache.path}`);
  io.out(
    `  indexed documents: ${indexed.size}   index rows: ${cache.counts.indexRows}   ` +
      `document lengths: ${cache.counts.lengths}   ranking rows: ${cache.counts.ranking}`,
  );
  io.out(`  embeddings: ${cache.counts.embeddings}   live memories with no vector: ${unembedded}`);
  for (const line of bandOfRecordLines(bands)) io.out(line);
  if (skippedVectors.length > 0) {
    io.out(`  skipped after repeated embed failures: ${skippedVectors.length}`);
    io.out(`    ${skippedVectors.join(", ")}`);
    io.out("    Not counted above: the backfill stopped offering them, so they cannot");
    io.out("    clear themselves by landing. Repair the text if it is the cause, then");
    io.out("    counterparts verify --dir <store> --retry-skipped puts them back in the");
    io.out("    rotation for the next boundary.");
  }
  io.out(`  indexed but not live (archived or superseded): ${stale.length}`);
  io.out(`  vector format: ${vectorFormatLine(cache.counts.vectors)}`);
  if (missing.length === 0 && orphans.length === 0 && stale.length === 0) {
    io.out("The cache covers every live row and holds nothing else.");
    // A faulted row outranks a clean cache: the store does not OPEN for a
    // session, so a zero exit here would be the second surface telling the
    // owner everything is fine while every session stands down.
    return faulted.length === 0 ? EXIT.ok : EXIT.failed;
  }
  if (missing.length === 0 && orphans.length === 0) {
    io.err(
      `Cache stale: ${stale.length} indexed ids are archived or superseded and still count toward rarity — ` +
        `'counterparts verify --prune-index' drops them and keeps the embeddings.`,
    );
    return EXIT.failed;
  }
  io.err(
    `Cache incomplete: ${missing.length} live rows are not indexed, ${orphans.length} indexed ids are not canonical rows, ` +
      `${stale.length} are canonical but not live — ` +
      `'counterparts verify --rebuild' rebuilds box 3.`,
  );
  return EXIT.failed;
}

/**
 * Rebuild box 3 from canonical state and report. The database is a cache: if
 * this ever loses something canonical, the claim was false and the report is
 * where it shows. What cannot be recomputed is DECLARED, with an owner and a
 * repair, rather than silently missing (§5 G8).
 *
 * The vector count is taken BEFORE a writable store is opened, so the refusal
 * path never constructs one.
 */
function verifyRebuild(dir: string, io: Io, dropVectors: boolean, keepVectors: boolean): number {
  const cache = censusCache(dir);
  // `--keep-vectors` re-indexes the text side and leaves `embeddings` alone
  // (`Store.rebuildCache({ keepVectors })`, the core follow-up this console
  // filed in NOTES on 2026-09-04 and could not do adapter-side). Nothing is at
  // risk, so neither guard below applies — and an unreadable census is no
  // longer a reason to refuse, because the count it could not take was only
  // ever the count of what would be LOST.
  if (keepVectors) {
    const store = openStoreAt({ dir });
    try {
      const canonical = store.list().length;
      const report = store.rebuildCache({ keepVectors: true });
      io.out(`Canonical rows: ${canonical}`);
      io.out(`Re-indexed: ${report.indexed}`);
      io.out(`Skipped as removed (deny-list): ${report.skippedDenied}`);
      io.out(`Vectors kept: ${report.keptVectors}   dropped as no longer canonical: ${report.droppedVectors}`);
      io.out(`Not recomputed: ${report.unrecomputed}`);
      const accounted = report.indexed + report.skippedDenied;
      if (accounted !== canonical) {
        io.err(`MISMATCH: ${canonical} canonical rows, ${accounted} accounted for.`);
        return EXIT.failed;
      }
      io.out("Every canonical row is accounted for.");
      return EXIT.ok;
    } finally {
      store.close();
    }
  }
  // FAIL CLOSED. A count that could not be taken is not a count of zero: box 3
  // is the file the Stop-hook worker writes vectors into, so "database is
  // locked" after the busy timeout is an ordinary outcome here — and a guard
  // whose failure mode is "could not count the vectors, so dropped them" is not
  // a guard. An ABSENT cache is different and stays fine: there is nothing to lose.
  if (cache.present && cache.counts === null && !dropVectors) {
    io.err(
      `Refusing: box 3 exists but could not be read (${cache.why ?? "no reason given"}), so this console cannot tell how many embeddings --rebuild would drop — retry, pass --keep-vectors to rebuild the text index and keep them, or --drop-vectors to proceed anyway.`,
    );
    return EXIT.refused;
  }
  const held = cache.counts?.embeddings ?? 0;
  const vectors = `${held} ${held === 1 ? "embedding" : "embeddings"}`;
  if (held > 0 && !dropVectors) {
    io.err(
      `Refusing: --rebuild drops box 3 and this console has no embedder, so the ${vectors} it holds would be gone and each one costs a paid network call to recompute — pass --keep-vectors to rebuild the text index and keep them, or --drop-vectors if losing them is what you mean.`,
    );
    return EXIT.refused;
  }
  const store = openStoreAt({ dir });
  try {
    const canonical = store.list().length;
    const report = store.rebuildCache();
    io.out(`Canonical rows: ${canonical}`);
    if (held > 0) io.out(`Dropped on your say-so (--drop-vectors): ${vectors}.`);
    io.out(`Re-indexed: ${report.indexed}`);
    io.out(`Skipped as removed (deny-list): ${report.skippedDenied}`);
    io.out(`Skipped as not live (archived or superseded): ${report.skippedArchived}`);
    io.out(`Not recomputed: ${report.unrecomputed}`);
    for (const declared of report.declared) {
      io.out(`  declared: ${declared.what} — owner ${declared.owner}; repair: ${declared.repair}`);
    }
    const accounted = report.indexed + report.skippedDenied + report.skippedArchived;
    if (accounted !== canonical) {
      io.err(`MISMATCH: ${canonical} canonical rows, ${accounted} accounted for.`);
      return EXIT.failed;
    }
    io.out("Every canonical row is accounted for.");
    reclaimFreedPages(dir, io);
    return EXIT.ok;
  } finally {
    store.close();
  }
}

/**
 * VACUUM both databases, then checkpoint — the named command a removal points at
 * when it could not do this itself.
 *
 * `cli/removal.ts#reclaim` runs the same two statements at the end of every
 * chase, because blanking a long body leaves whole OVERFLOW pages on the
 * freelist still holding the words (the third review's NEW-MAJOR-1). When that
 * is contended the removal says so and names this command — so this command has
 * to actually do it. It did not: measured, `verify --rebuild` left the residue
 * exactly where it was, because rebuilding box 3 says nothing about box 2's free
 * list.
 *
 * Runs after the rebuild has finished with the store, and never throws: a
 * failure here is a line, not a lost rebuild.
 */
function reclaimFreedPages(dir: string, io: Io): void {
  for (const [path, name] of [
    [paths.operational(dir), "the database"],
    [paths.cache(dir), "the cache"],
  ] as const) {
    if (!existsSync(path)) continue;
    let db;
    try {
      db = openDb(path);
      db.exec("VACUUM");
      db.get("PRAGMA wal_checkpoint(TRUNCATE)");
      io.out(`Reclaimed free pages in ${name}.`);
    } catch (err) {
      io.err(
        `Could not reclaim free pages in ${name} (${String((err as Error).message ?? err)}). ` +
          "Words from a removed memory may remain in pages no row points at; run this again " +
          "when nothing else is holding the store.",
      );
    } finally {
      try {
        db?.close();
      } catch {
        /* a handle that will not close has already said what it could */
      }
    }
  }
}

// ── migrate-cache ───────────────────────────────────────────────────────────

/** One line when the post-VACUUM fold could not finish: the pages are safe in
 *  `-wal`, and the file shrinks when the next writer (or checkpoint) folds it. */
function foldNote(io: Io, fold: WalFold): void {
  if (!fold.busy && fold.error === undefined) return;
  io.out(
    "The file on disk shrinks to that size once other Counterparts processes (an open session or the dashboard) let go of it.",
  );
}

/** Bytes, in the units an owner reads. Box 3 is measured in hundreds of MiB. */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/**
 * How big the database IS: `page_count * page_size`, off the open handle, which
 * is true wherever the pages happen to be sitting.
 *
 * Since WAL landed (2026-09-18) the file on disk is not the database — committed
 * pages live in the `-wal` until a checkpoint moves them in — so `statSync` alone
 * under-reports a busy cache (measured: 1.8 MiB of file with 3.7 MB in the
 * sidecar). Adding the `-wal` to the file is not the fix either, and was the
 * first cut of this: the `-wal` holds COPIES of pages the main file already
 * counts, so a fat one read as space a `VACUUM` would give back — 4,144,752
 * bytes of "reclaimable" on a cache with nothing to reclaim (review MAJOR-1).
 * What gives those bytes back is a CHECKPOINT, and a checkpoint happens on its
 * own. Two pragmas cost nothing, take no lock, and say what a VACUUM is being
 * compared against.
 */
function databaseBytes(db: Db): number {
  const pages = db.get<{ page_count: number }>("PRAGMA page_count")?.page_count ?? 0;
  const pageSize = db.get<{ page_size: number }>("PRAGMA page_size")?.page_size ?? 0;
  return pages * pageSize;
}

/**
 * How many bytes a `VACUUM` would give back, MEASURED — `VACUUM INTO` a
 * throwaway copy outside the data dir, stat it, delete it.
 *
 * The obvious cheap probe is wrong here and was tried: `PRAGMA freelist_count`
 * reads **0** on a cache whose rows were rewritten from ~12.7 KiB of text to
 * 4 KiB of blob, because the pages are not free, they are FRAGMENTED — the win
 * is defragmentation. On a store measured mid-review, `freelist_count = 0` and
 * a real `VACUUM` still took 3,756,032 bytes to 1,544,192 (59%). A probe that
 * reads zero where the answer is 59% is worse than no probe.
 *
 * `VACUUM INTO` is read-only on the source (it is what `backup` already uses),
 * and the copy lands in the OS temp dir, never beside the store — box 3's
 * directory is classified and a stray file there is a store that will not open
 * (§5 G11). Returns null when the probe cannot run, which is not an error: it
 * means this run has no number, and it says so rather than guessing one.
 */
function reclaimableBytes(db: Db): number | null {
  const probeDir = mkdtempSync(join(tmpdir(), "counterparts-vacuum-probe-"));
  const probe = join(probeDir, "compacted.sqlite");
  try {
    db.run("VACUUM INTO ?", probe);
    return Math.max(0, databaseBytes(db) - statSync(probe).size);
  } catch {
    return null;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

/** Worth compacting: more than a MiB, and more than a twentieth of the file. */
function worthCompacting(reclaimable: number | null, size: number): boolean {
  return reclaimable !== null && reclaimable > 1024 * 1024 && reclaimable > size / 20;
}

/**
 * `migrate-cache` — convert box 3's vectors from JSON text to float32 BLOBs,
 * IN PLACE, and compact the file afterwards.
 *
 * **Why this is a command and not `verify --rebuild`.** A rebuild recomputes;
 * the thing that would have to recompute here is an EMBEDDER, and this console
 * wires none — so `--rebuild` as the migration means "delete ~13,700 vectors
 * that cost a paid network call each and hope something puts them back"
 * (`cli/NOTES.md`, 2026-09-04). The information needed to write the new shape
 * is already in the old one. Converting is a read and a write of the same
 * numbers, so the migration is a conversion.
 *
 * Six properties, each one a rule this console already has:
 *
 *   1. **The dry run is READ-ONLY, not merely honest.** It opens box 3 with
 *      `openDb`, never `openCache`: the migrating constructor stamps
 *      `cache_meta.schemaVersion`, and on the v3 store this will actually be run
 *      against that one row changed the file's hash under a line that said
 *      nothing had changed. Every question the dry run asks is a `SELECT`.
 *   2. **`--apply` names its store out loud.** The destination is the `--dir`
 *      FLAG, typed on this line, and nothing else — not the default, and (since
 *      the 2026-09-05 ruling) not `COUNTERPARTS_DATA_DIR` either, which is a
 *      shell's memory rather than a sentence about this rewrite. Then it asks,
 *      `remove`-style, unless `--yes`.
 *   3. **Transactional per batch, and therefore resumable.** One transaction per
 *      `--batch` rows, not one over the whole table: box 3 is the file the
 *      Stop-hook worker writes into, `BUSY_TIMEOUT_MS` is five seconds, and a
 *      single transaction over 13.9K rows would hold the write lock for the
 *      whole rewrite. An interrupted run leaves a MIXED cache, which every
 *      reader already tolerates (`cache.ts#decodeVector`), and re-running
 *      finishes it.
 *   4. **A row that will not parse costs one row.** It is skipped, counted and
 *      NAMED, and the walk continues past it — the first version rolled its
 *      batch back and then re-selected the same row forever.
 *   5. **Idempotent, and it refuses rather than pretending.** The batch selects
 *      on `typeof(vec) = 'text'`, so a converted row is never touched twice, and
 *      `--apply` with nothing to convert AND nothing to reclaim exits REFUSED
 *      with the counts, because "I did nothing" and "I converted your store"
 *      must not look the same on a terminal.
 *   6. **Compaction is reachable on its own.** The rewrite frees space that only
 *      a `VACUUM` returns, and `VACUUM` is exactly the step most likely to fail
 *      — it takes an exclusive lock, and the worker holds box 3. So a store that
 *      is CONVERTED BUT NOT COMPACTED is a real state with a door: the dry run
 *      reports the reclaimable bytes and `--apply` compacts them. Without that
 *      door, one lost lock stranded 177 MiB behind an "already converted"
 *      refusal — the whole debt, unreachable through the tool that exists to pay
 *      it.
 *
 * It never opens a `Store`: box 3 only, gated on the file EXISTING so the
 * command cannot mint the box it migrates.
 */
export async function migrateCacheCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): Promise<number> {
  const apply = flags["apply"] === true;
  // FIRST, before this command looks at a single path. `resolveDir` falls
  // through to `dataDir()`, which on the owner's machine is his live memory,
  // and this command's own PR says the merge is reversible and the `--apply`
  // is not. A guard that reads the default directory before refusing it has
  // already been pointed at the store it meant to refuse.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "migrate-cache --apply",
      "rewrites every vector in box 3",
    );
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  // This command never opens a `Store`, so it never met the refusal every other
  // door gets for free (review A, MINOR-1).
  const preRowsRefusal = refusePreRows(dir, io);
  if (preRowsRefusal !== null) return preRowsRefusal;
  const path = paths.cache(dir);
  if (!existsSync(path)) {
    io.err(
      `no cache at ${path} — box 3 has never been built here, so there are no vectors to convert.`,
    );
    return EXIT.failed;
  }
  const batch = (() => {
    const raw = flags["batch"];
    if (typeof raw !== "string") return 500;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 500;
  })();

  // READ-ONLY for the report: `openDb` opens what is there and stamps nothing.
  // `openCache` — which brings an out-of-date box 3 up to the current schema —
  // is reserved for `--apply`, below, where a write is the point.
  const db = openDb(path);
  const sizeBefore = databaseBytes(db);
  let census: VectorFormatCensus;
  let stamped: string | null;
  try {
    census = vectorFormats(db);
    stamped =
      db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value ??
      null;

    io.out(`Store: ${dir}`);
    io.out(
      `Cache: ${path}  (${humanBytes(sizeBefore)}, schema ${stamped === null ? "unstamped" : `v${stamped}`}` +
        `${stamped === String(CACHE_SCHEMA_VERSION) ? "" : ` — v${CACHE_SCHEMA_VERSION} once anything opens it for writing`})`,
    );
    io.out(
      `Vectors: ${census.total}   float32 BLOB: ${census.float32}   JSON text: ${census.jsonText}` +
        (census.other > 0 ? `   unreadable: ${census.other}` : ""),
    );
    io.out(
      `  bytes in vec: JSON text ${humanBytes(census.jsonTextBytes)}, ` +
        `float32 ${humanBytes(census.float32Bytes)}`,
    );

    if (census.jsonText === 0) {
      // Converted. The remaining question is whether the file was ever
      // compacted — the step most likely to have failed, and the one the
      // "already converted" refusal used to hide.
      const reclaimable = reclaimableBytes(db);
      const worth = worthCompacting(reclaimable, sizeBefore);
      io.out("");
      if (reclaimable === null) {
        io.out("Converted. Could not measure whether the file is compacted (the probe would not run).");
      } else if (worth) {
        io.out(
          `Converted, NOT yet compacted: ${humanBytes(reclaimable)} reclaimable of ${humanBytes(sizeBefore)}.`,
        );
      } else {
        io.out(`Converted and compacted. Nothing to do.`);
      }
      if (!apply) {
        if (worth) io.out("Re-run with --apply to compact (it converts nothing — there is nothing left to convert).");
        return EXIT.ok;
      }
      if (!worth) {
        io.err(
          `Refusing: box 3 holds no JSON-text vectors and has nothing worth reclaiming — it is already float32. Nothing was written.`,
        );
        return EXIT.refused;
      }
      const ok = await confirmMigrate(io, flags, dir, `compact box 3 (${humanBytes(reclaimable ?? 0)} reclaimable)`);
      if (!ok) return EXIT.refused;
      const { sizeAfter, fold } = (() => {
        const writable = openCache(path);
        try {
          writable.exec("VACUUM");
          // Under WAL the VACUUM's pages sit in `-wal` until a checkpoint; fold
          // them so the reclaim below is true of the file on disk.
          return { sizeAfter: databaseBytes(writable), fold: foldWal(writable) };
        } finally {
          writable.close();
        }
      })();
      io.out(
        `Cache file: ${humanBytes(sizeBefore)} → ${humanBytes(sizeAfter)} ` +
          `(reclaimed ${humanBytes(Math.max(0, sizeBefore - sizeAfter))}).`,
      );
      foldNote(io, fold);
      return EXIT.ok;
    }

    // The projection is arithmetic on the rows themselves, not an average: a
    // store whose vectors are not all the same width would make a mean lie.
    const projected =
      db.get<{ b: number | null }>(
        "SELECT SUM(dim) * 4 AS b FROM embeddings WHERE typeof(vec) = 'text'",
      )?.b ?? 0;
    io.out(
      `  after conversion those ${census.jsonText} rows hold ${humanBytes(projected)} ` +
        `(${census.jsonTextBytes > 0 ? (census.jsonTextBytes / Math.max(projected, 1)).toFixed(1) : "?"}× smaller)`,
    );

    // ONE sample row, decoded both ways. Vectors are not prose, so printing a
    // few of a memory's coordinates discloses nothing a census does not.
    const sample = db.get<{ memory_id: string; dim: number; vec: SqlValue }>(
      "SELECT memory_id, dim, vec FROM embeddings WHERE typeof(vec) = 'text' ORDER BY memory_id LIMIT 1",
    );
    if (sample !== undefined) {
      try {
        const asIs = Array.from(decodeVector(sample.vec));
        const converted = Array.from(decodeVector(encodeVector(asIs)));
        const drift = asIs.reduce((m, v, i) => Math.max(m, Math.abs(v - (converted[i] ?? 0))), 0);
        const show = (v: readonly number[]): string =>
          v.slice(0, 4).map((x) => x.toPrecision(9)).join(", ");
        io.out("");
        io.out(
          `Sample: ${sample.memory_id}  dim ${sample.dim}  (${String(sample.vec).length} chars of JSON)`,
        );
        io.out(`  now:   [${show(asIs)}, …]`);
        io.out(`  after: [${show(converted)}, …]`);
        io.out(`  largest coordinate change in this row: ${drift.toExponential(3)}`);
        const nonFinite = countNonFinite(asIs);
        if (nonFinite > 0) io.out(`  ${nonFinite} non-finite coordinates in this row become 0`);
      } catch {
        io.out("");
        io.out(`Sample: ${sample.memory_id} — its vec does not parse; the migration will skip and name it.`);
      }
    }
  } finally {
    db.close();
  }

  if (!apply) {
    io.out("");
    io.out("Dry run. Nothing was changed — every question above was a read.");
    // NAME THE PROTECTION THAT EXISTS. This line used to say "take a
    // 'counterparts backup' first", which protects nothing here: box 3 is on
    // the backup set's explicit EXCLUSION list ("cache — Box 3 — rebuildable",
    // `store/paths.ts#LAYOUT`), so a snapshot taken before `--apply` contains
    // no copy of the file `--apply` rewrites. The only thing that does is a
    // copy of the file itself — and a copy of a database another process is
    // writing is not a backup (scar §2.11), which is why the sentence says
    // with nothing open rather than leaving that to be discovered.
    io.out(
      `First, copy box 3 aside — 'counterparts backup' skips the cache on purpose (it is rebuildable), so it does not cover this:`,
    );
    io.out(`  cp ${path} ${path}.bak-<date>`);
    io.out(`  cp ${path}-wal ${path}-wal.bak-<date>   (when it is there)`);
    io.out(`  (with every session closed — a copy of a database being written is not a copy of it —`);
    io.out(`   and BOTH files: since WAL the database file alone is not the database, its '-wal' holds`);
    io.out(`   every page committed since the last checkpoint, so a copy without it is silently short)`);
    io.out(`Then re-run with --apply to convert (batches of ${batch}).`);
    return EXIT.ok;
  }

  const ok = await confirmMigrate(io, flags, dir, `convert ${census.jsonText} vectors in box 3`);
  if (!ok) return EXIT.refused;

  const writable = openCache(path);
  try {
    let converted = 0;
    let coerced = 0;
    let batches = 0;
    const skipped: string[] = [];
    let after: string | undefined;
    for (;;) {
      const report = convertVectorBatch(writable, batch, after);
      if (report.examined === 0) break;
      converted += report.converted;
      coerced += report.coerced;
      skipped.push(...report.skipped);
      batches += 1;
      // Walk PAST what was examined, so a skipped row is not re-selected
      // forever. `lastId` is non-null whenever `examined > 0`.
      after = report.lastId ?? undefined;
      if (after === undefined) break;
    }
    io.out("");
    io.out(`Converted ${converted} vectors in ${batches} ${batches === 1 ? "batch" : "batches"}.`);
    if (coerced > 0) io.out(`Coerced ${coerced} non-finite coordinates to 0 (a NaN is not a coordinate).`);
    for (const id of skipped) io.out(`  SKIPPED, left exactly as it was: ${id} — its vec does not parse.`);
    const after2 = vectorFormats(writable);
    io.out(`Vectors now: float32 BLOB ${after2.float32}, JSON text ${after2.jsonText}`);
    // Free pages are not free space until the file is rewritten, and the whole
    // debt this pays is file size. VACUUM runs outside any transaction, and it
    // is the step that fails first when another process holds box 3 — so its
    // failure is REPORTED with the way back in, never swallowed.
    let vacuumed = true;
    try {
      writable.exec("VACUUM");
    } catch (err) {
      vacuumed = false;
      io.err(
        `The conversion is committed; the VACUUM that reclaims the space did not run (${String((err as Error).message ?? err)}). ` +
          `Re-run 'counterparts migrate-cache --dir ${dir} --apply' with no session open to compact it.`,
      );
    }
    const sizeAfter = databaseBytes(writable);
    if (vacuumed) {
      // Fold the VACUUM's pages out of `-wal`, so the reclaim is true on disk.
      const fold = foldWal(writable);
      io.out(
        `Cache file: ${humanBytes(sizeBefore)} → ${humanBytes(sizeAfter)} ` +
          `(reclaimed ${humanBytes(Math.max(0, sizeBefore - sizeAfter))}).`,
      );
      foldNote(io, fold);
    }
    if (skipped.length > 0) return EXIT.failed;
    return after2.jsonText === 0 && vacuumed ? EXIT.ok : EXIT.failed;
  } finally {
    writable.close();
  }
}

/**
 * The one human in the loop. `--yes` is the non-interactive door (a script, the
 * install loop); without it and without a prompt, this refuses rather than
 * proceeding unconfirmed — the console's rule 2, and the same shape `remove`
 * uses, one notch softer because this destroys no memory.
 */
async function confirmMigrate(
  io: Io,
  flags: Record<string, string | boolean | undefined>,
  dir: string,
  what: string,
): Promise<boolean> {
  if (flags["yes"] === true) return true;
  io.out("");
  io.out(`About to ${what} at ${dir}.`);
  if (io.prompt === undefined) {
    io.err("refused: this is not an interactive console — pass --yes if that is what you mean.");
    return false;
  }
  // Exactly `yes`, through `typed()`: Esc, an empty Enter and `cancel` are the
  // person stopping, and say so; anything else is "not confirmed".
  const said = await typed(io, "yes", `Type 'yes' to proceed — Esc or "cancel" to stop: `);
  if (said === "cancelled") {
    io.out("Cancelled. Nothing has changed.");
    return false;
  }
  if (said !== "typed") {
    io.err("refused: not confirmed. Nothing has changed.");
    return false;
  }
  return true;
}

// ── backfill-claims ─────────────────────────────────────────────────────────

/**
 * The one-shot repair for memories minted BEFORE the authored default existed.
 *
 * Measured 2026-09-04 on the parallel-run store: 48 authored memories, every
 * one of them with relevance/emotional/predictive = 0, most with no claim — so
 * `sal(m)` was 0 and the lived channel's own deposits were the weakest things in
 * the store. New mints get the floor at the seam (`mint.ts`); these rows never
 * crossed a seam that had one.
 *
 * Three properties, all of them the console's usual ones rather than new
 * inventions: it is a DRY RUN unless `--apply`; it refuses under observer via
 * `OWNER_OPS` (an instrument does not repair the store it is reading); and it
 * touches only rows whose `source` is `authored` and whose `claimed` is NULL —
 * an explicit claim, however low, is testimony and is never overwritten.
 * Archived, superseded and removed rows are excluded: the repair is for what
 * the store is still holding.
 *
 * Each write is two durable acts plus a record: the claim onto box 2
 * (`updatePhysics`), the `claimedDefault` flag onto canonical prose (`revise`,
 * which keeps the prior version — constitution 7), and a `salience.defaulted`
 * row in the event log so the daily can count this run.
 *
 * `claimedDefault` is META, and since the floor (2026-09-20) `content_hash` is
 * `hashText(body)` — so a backfilled row's hash does NOT move when the flag
 * lands, where before the floor it did (the hash addressed the whole serialized
 * document, id and frontmatter included). Either way nothing downstream cares:
 * `sleep/dedup.ts` deliberately hashes the body itself rather than reading this
 * column, and `remember/`'s content-idempotency ledger hashes normalized content
 * and never reads it at all. What DOES move, on purpose, is the revision: the
 * flag goes on through `revise`, which keeps the prior version (constitution 7).
 */
export function backfillClaimsCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const apply = flags["apply"] === true;
  // A BULK WRITE ACROSS EVERY AUTHORED MEMORY, and until 2026-09-05 it had no
  // door at all: `COUNTERPARTS_DATA_DIR=<store> backfill-claims --apply` ran.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "backfill-claims --apply",
      "writes the default claimed floor onto every unclaimed authored memory",
    );
    if (refusal !== null) return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const floor = TUNABLES.AUTHORED_DEFAULT_CLAIM;

  // The plan is made read-only, as every plan here is (scar E5).
  const planning = openStoreAt({ dir, observer: true });
  let targets: { id: string; kind: string; dims: string }[];
  try {
    targets = backfillTargets(planning);
  } finally {
    planning.close();
  }

  io.out(`Authored memories with no claimed salience: ${targets.length}`);
  io.out(`Default floor to apply: ${floor} (physics TUNABLES.AUTHORED_DEFAULT_CLAIM)`);
  // IDS AND NUMBERS ONLY — a repair report is not a place to print bodies.
  for (const t of targets) io.out(`  ${t.id}  ${t.kind}  dims ${t.dims}`);

  if (!apply) {
    io.out("");
    io.out("Dry run. Nothing has changed. Re-run with --apply to write the floor.");
    return EXIT.ok;
  }
  if (targets.length === 0) {
    io.out("");
    io.out("Nothing to do.");
    return EXIT.ok;
  }

  const store = openStoreAt({ dir });
  let written = 0;
  const failures: string[] = [];
  try {
    // RE-CHECK under the writing store: the plan was made against a store that
    // may have moved, and this loop must not write a floor over a claim that
    // arrived in between.
    for (const target of backfillTargets(store)) {
      try {
        const physics = store.physicsOf(target.id);
        store.updatePhysics(target.id, { salience: { ...physics.salience, claimed: floor } });
        store.revise(
          target.id,
          { meta: { [CLAIMED_DEFAULT_META_KEY]: true }, reason: "salience.default" },
        );
        store.appendEvent({
          name: "salience.defaulted",
          day: store.livedDay(),
          ref: target.id,
          payload: { channel: "authored", floor, backfill: true },
        });
        written += 1;
      } catch (err) {
        failures.push(`${target.id}: ${describeDirRefusal(err)}`);
      }
    }
  } finally {
    store.close();
  }

  io.out("");
  io.out(`Applied the default floor to ${written} memories.`);
  for (const failure of failures) io.err(`  FAILED ${failure}`);
  return failures.length === 0 ? EXIT.ok : EXIT.failed;
}

/** Live, authored, unclaimed — in that order, and nothing else. */
function backfillTargets(store: Store): { id: string; kind: string; dims: string }[] {
  const denied = new Set(store.deniedIds());
  const out: { id: string; kind: string; dims: string }[] = [];
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || denied.has(id)) continue;
    if (row.archived === 1 || row.superseded_by !== null) continue;
    if (row.source !== "authored" || row.claimed !== null) continue;
    out.push({
      id,
      kind: row.kind,
      dims: `rel ${row.relevance} emo ${row.emotional} pred ${row.predictive}`,
    });
  }
  return out;
}

// ── repair-dates ────────────────────────────────────────────────────────────

/**
 * The migrated rows' dates, proposed from what the rows themselves carry.
 *
 * The console's half is thin on purpose: parse three flags, refuse a bad one by
 * name, and hand off to `repair-dates.ts`, where the evidence rules and their
 * reasons live. `--dry-run` is accepted and is the DEFAULT — it exists so the
 * safe call can be spelled out loud rather than only implied by the absence of
 * `--apply` — and passing both is a refusal, not a silent winner.
 */
export function repairDatesCommand(
  dir: string,
  io: Io,
  flags: Record<string, string | boolean | undefined>,
): number {
  const apply = flags["apply"] === true;
  // Argument arithmetic only: this opens nothing, so it may stand in front of
  // the store door. A command line that contradicts itself should be told so.
  if (apply && flags["dry-run"] === true) {
    io.err("repair-dates: --apply and --dry-run contradict each other; pass one");
    return EXIT.usage;
  }
  // THE ONE OWNER OP THAT REWRITES THOUSANDS OF CANONICAL DOCUMENTS. A dry run on
  // the defaulted store is read-only and stays unguarded (it is how the owner
  // looks); an APPLY that nobody aimed asks to be aimed (review §4) — by `--dir`,
  // and by nothing else. `--yes` used to stand in for it here, while one command
  // over it meant "skip the typed confirmation"; the 2026-09-05 ruling is that
  // `--yes` only ever skips a confirmation, and this command has none to skip.
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(
      dir,
      io,
      flags,
      "repair-dates --apply",
      "rewrites the date on every migrated memory the evidence reaches",
    );
    if (refusal !== null) return refusal;
  }
  const raw = typeof flags["confidence"] === "string" ? flags["confidence"] : "high";
  if (raw !== "high" && raw !== "medium" && raw !== "low") {
    io.err(`repair-dates: --confidence must be high, medium or low (got ${raw})`);
    return EXIT.usage;
  }
  const confidence: Confidence = raw;
  const importDay = typeof flags["import-day"] === "string" ? flags["import-day"] : undefined;
  if (importDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(importDay)) {
    io.err(`repair-dates: --import-day must be YYYY-MM-DD (got ${importDay})`);
    return EXIT.usage;
  }
  const sampleRaw = typeof flags["sample"] === "string" ? Number(flags["sample"]) : undefined;
  if (sampleRaw !== undefined && (!Number.isInteger(sampleRaw) || sampleRaw < 0)) {
    io.err(`repair-dates: --sample must be a non-negative whole number`);
    return EXIT.usage;
  }
  const report = repairDates(dir, io, {
    apply,
    minConfidence: confidence,
    ...(importDay === undefined ? {} : { importDay }),
    ...(sampleRaw === undefined ? {} : { sample: sampleRaw }),
  });
  if (report === null) return EXIT.failed;
  if (report.refused !== null) return EXIT.refused;
  return report.failures.length === 0 ? EXIT.ok : EXIT.failed;
}
