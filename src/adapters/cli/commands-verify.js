import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { localDate } from "../../core/time.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAIMED_DEFAULT_META_KEY } from "../../core/mint.js";
import { TUNABLES } from "../../core/physics/index.js";
import { TUNABLES as SLEEP_TUNABLES, isJournal } from "../../core/sleep/index.js";
import { BUSY_TIMEOUT_MS, foldWal, journalModeOf, openDb } from "../../core/store/db.js";
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
  storeExists
} from "../../core/store/index.js";
import { repairDates } from "./repair-dates.js";
import { typed } from "./ui.js";
import { EXIT, requireDirFlagForBulkWrite, openStoreAt, describeDirRefusal } from "./commands-shared.js";
function bandOfRecordCensus(store) {
  const ranking = store.rankingAll();
  const denied = new Set(store.deniedIds());
  let rows = 0;
  let disagree = 0;
  let unranked = 0;
  for (const id of store.list({ archived: false })) {
    if (denied.has(id))
      continue;
    const row = store.row(id);
    if (row === undefined || isJournal(row))
      continue;
    rows += 1;
    const ranked = ranking.get(id);
    if (ranked === undefined)
      unranked += 1;
    else if (ranked.band !== row.band)
      disagree += 1;
  }
  return { rows, disagree, unranked };
}
function bandOfRecordLines(c) {
  const out = [
    `  band of record: ${c.disagree} of ${c.rows} live rows disagree with the ranking cache` + `   (${c.unranked} not yet ranked)`
  ];
  if (c.disagree > 0) {
    out.push("    The decay phase writes each band move back to `memories.band` (U8), so a pass that", "    its budget did not cut short leaves 0 here. A number that survives several boundaries", "    means no boundary has run since this store was built — or that the pass is truncating.");
  }
  if (c.unranked > 0) {
    out.push("    Unranked rows are rows box 3 has not read yet: ones born since the last decay pass,", "    everything after a `verify --rebuild` (the rebuild drops the ranking table and does not", "    refill it), and whatever a decay phase killed mid-body never reached. The next boundary", "    ranks them; a count that survives one is a decay phase that is not finishing.");
  }
  return out;
}
function censusCache(dir) {
  const path = paths.cache(dir);
  if (!existsSync(path))
    return { path, present: false, counts: null, why: "never built" };
  let db;
  try {
    db = openDb(path);
    const handle = db;
    const n = (sql) => handle.get(sql)?.n ?? 0;
    return {
      path,
      present: true,
      why: null,
      counts: {
        embeddings: n("SELECT COUNT(*) AS n FROM embeddings"),
        indexRows: n("SELECT COUNT(*) AS n FROM doc_tokens"),
        lengths: n("SELECT COUNT(*) AS n FROM doc_lens"),
        ranking: n("SELECT COUNT(*) AS n FROM ranking"),
        indexed: handle.all("SELECT DISTINCT memory_id FROM doc_tokens").map((r) => r.memory_id),
        vectors: vectorFormats(handle)
      }
    };
  } catch (err) {
    return { path, present: true, counts: null, why: String(err.message ?? err) };
  } finally {
    db?.close();
  }
}
function vectorFormatLine(v) {
  if (v.total === 0)
    return "none held";
  const parts = [];
  if (v.float32 > 0)
    parts.push(`${v.float32} float32 BLOB (v4)`);
  if (v.jsonText > 0)
    parts.push(`${v.jsonText} JSON text (v3)`);
  if (v.other > 0)
    parts.push(`${v.other} unreadable`);
  const tail = v.jsonText > 0 ? " — 'counterparts migrate-cache' converts them in place (dry run by default)" : "";
  return `${parts.join(", ")}${tail}`;
}
function refusePreRows(dir, io) {
  const found = preRowsMarkersIn(dir);
  const detail = { dir, expected: SCHEMA_VERSION };
  if (found.length > 0)
    detail["found"] = found.join(", ");
  else if (isPreRowsDatabase(paths.operational(dir))) {
    detail["found"] = DATABASE_FILE;
    detail["reason"] = "no-body-column";
  } else
    return null;
  io.err(describePreRowsRefusal(new StoreError("STORE_PRE_ROWS", detail), "Name a store with --dir <path>.") ?? `refused: ${dir} was written before this build's floor.`);
  return EXIT.failed;
}
export function verifyCommand(dir, io, flags) {
  const writing = flags["rebuild"] === true ? ["verify --rebuild", "drops box 3 for the whole store and builds it again"] : flags["prune-index"] === true ? [
    "verify --prune-index",
    "deletes every archived and superseded row from the text index"
  ] : flags["retry-skipped"] === true ? [
    "verify --retry-skipped",
    "clears every embed.failed counter, so the backfill offers those ids again"
  ] : flags["drop-vectors"] === true ? [
    "verify --drop-vectors",
    "stands as consent to lose embeddings this console has no embedder to recompute"
  ] : null;
  if (writing !== null) {
    const refusal = requireDirFlagForBulkWrite(dir, io, flags, writing[0], writing[1]);
    if (refusal !== null)
      return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const preRowsRefusal = refusePreRows(dir, io);
  if (preRowsRefusal !== null)
    return preRowsRefusal;
  if (flags["rebuild"] !== true) {
    if (flags["prune-index"] === true)
      return verifyPruneIndex(dir, io);
    if (flags["retry-skipped"] === true)
      return verifyRetrySkipped(dir, io);
    return verifyCensus(dir, io);
  }
  if (flags["drop-vectors"] === true && flags["keep-vectors"] === true) {
    io.err("refused: --drop-vectors and --keep-vectors say opposite things about the same rows.");
    return EXIT.refused;
  }
  return verifyRebuild(dir, io, flags["drop-vectors"] === true, flags["keep-vectors"] === true);
}
function verifyPruneIndex(dir, io) {
  const store = openStoreAt({ dir });
  try {
    const removed = store.pruneDeadIndex();
    io.out(`Store: ${dir}`);
    io.out(`Dropped from the text index (archived or superseded): ${removed}`);
    io.out(removed === 0 ? "The index already held live rows only." : "Embeddings are untouched — this repair never resets box 3.");
    return EXIT.ok;
  } finally {
    store.close();
  }
}
function verifyRetrySkipped(dir, io) {
  const store = openStoreAt({ dir });
  try {
    const skipped = store.skippedVectorIds();
    const held = store.metaWithPrefix(EMBED_FAILED_PREFIX);
    const moves = [];
    for (const [key, value] of held) {
      if (value !== "0")
        moves.push([key, "0"]);
    }
    if (moves.length > 0)
      store.setMetaMany(moves);
    io.out(`Store: ${dir}`);
    io.out(`Embed-failure counters cleared: ${moves.length}`);
    io.out(`Back in the backfill's rotation: ${skipped.length}`);
    if (skipped.length > 0)
      io.out(`  ${skipped.join(", ")}`);
    io.out(moves.length === 0 ? "Nothing was being skipped; the backfill was already offering every live row." : "Nothing else changed. If the text is still poison they will be skipped again.");
    return EXIT.ok;
  } finally {
    store.close();
  }
}
export function eventLogLines(log, zone) {
  const cap = SLEEP_TUNABLES.BUDGETS.log;
  const wouldDelete = Math.min(log.eligible, cap);
  const oldest = log.oldestDay === null || log.oldestAt === null ? "oldest: none" : `oldest: lived day ${log.oldestDay} (${localDate(log.oldestAt, zone)})`;
  return [
    `Events: ${log.rows} held (${log.latched} latched records)   ${oldest}   ` + `window: ${log.retentionDays} lived days (cutoff day ${log.cutoffDay})`,
    `  past the window: ${log.eligible} unlatched (the next sleep pass deletes ${wouldDelete}, cap ${cap} per pass)` + `, ${log.latchedPastCutoff} latched records kept`
  ];
}
function verifyCensus(dir, io) {
  const store = openStoreAt({ dir, observer: true });
  let canonical;
  let live;
  let denied;
  let unembedded;
  let skippedVectors;
  let faulted;
  let schemaVersion;
  let log;
  let bands;
  try {
    canonical = store.list();
    live = store.list({ archived: false });
    denied = store.deniedIds();
    unembedded = store.unembeddedCount();
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
  io.out(`Journal mode: ${journalModeOf(paths.operational(dir))} (busy timeout ${BUSY_TIMEOUT_MS} ms)`);
  io.out(`Canonical rows: ${canonical.length}   live rows: ${live.length}   ` + `removed (deny-list): ${denied.length}`);
  io.out(`Floor: schema v${schemaVersion ?? "?"} · bodies in rows · prose files: none` + (schemaVersion === String(SCHEMA_VERSION) ? "" : ` (this build writes v${SCHEMA_VERSION})`));
  if (faulted.length > 0) {
    io.err(`Rows whose words are missing: ${String(faulted.length)} — ${faulted.slice(0, 5).join(", ")}` + (faulted.length > 5 ? ` and ${String(faulted.length - 5)} more` : "") + ". Each has an empty body and a content hash that still names it, which no write path " + "in this build produces. A session that loads a BELIEF or reads that memory stands down: " + "a faulted schema row takes every session with it, an ordinary memory only the reads that " + "reach it. Restore a snapshot over the store, or remove that row by id to tombstone it " + "and let sessions start again.");
  }
  for (const line of eventLogLines(log, store.zone()))
    io.out(line);
  if (cache.counts === null) {
    io.out(cache.present ? `Cache: ${cache.path} — unreadable (${cache.why ?? "no reason given"}).` : `Cache: absent — box 3 has never been built here.`);
    if (canonical.length === 0) {
      io.out("Nothing canonical to index, so nothing is missing.");
      return EXIT.ok;
    }
    io.err(cache.present ? `${canonical.length} canonical rows and a cache that would not open — retry (another process may hold it); if it is truly gone, 'counterparts verify --rebuild' builds box 3 again.` : `${canonical.length} canonical rows have no index — run 'counterparts verify --rebuild' to build box 3.`);
    return EXIT.failed;
  }
  const indexed = new Set(cache.counts.indexed);
  const known = new Set(canonical);
  const liveSet = new Set(live);
  const deniedSet = new Set(denied);
  const missing = live.filter((id) => !indexed.has(id) && !deniedSet.has(id));
  const orphans = cache.counts.indexed.filter((id) => !known.has(id));
  const stale = cache.counts.indexed.filter((id) => known.has(id) && !liveSet.has(id));
  io.out(`Cache: ${cache.path}`);
  io.out(`  indexed documents: ${indexed.size}   index rows: ${cache.counts.indexRows}   ` + `document lengths: ${cache.counts.lengths}   ranking rows: ${cache.counts.ranking}`);
  io.out(`  embeddings: ${cache.counts.embeddings}   live memories with no vector: ${unembedded}`);
  for (const line of bandOfRecordLines(bands))
    io.out(line);
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
    return faulted.length === 0 ? EXIT.ok : EXIT.failed;
  }
  if (missing.length === 0 && orphans.length === 0) {
    io.err(`Cache stale: ${stale.length} indexed ids are archived or superseded and still count toward rarity — ` + `'counterparts verify --prune-index' drops them and keeps the embeddings.`);
    return EXIT.failed;
  }
  io.err(`Cache incomplete: ${missing.length} live rows are not indexed, ${orphans.length} indexed ids are not canonical rows, ` + `${stale.length} are canonical but not live — ` + `'counterparts verify --rebuild' rebuilds box 3.`);
  return EXIT.failed;
}
function verifyRebuild(dir, io, dropVectors, keepVectors) {
  const cache = censusCache(dir);
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
  if (cache.present && cache.counts === null && !dropVectors) {
    io.err(`Refusing: box 3 exists but could not be read (${cache.why ?? "no reason given"}), so this console cannot tell how many embeddings --rebuild would drop — retry, pass --keep-vectors to rebuild the text index and keep them, or --drop-vectors to proceed anyway.`);
    return EXIT.refused;
  }
  const held = cache.counts?.embeddings ?? 0;
  const vectors = `${held} ${held === 1 ? "embedding" : "embeddings"}`;
  if (held > 0 && !dropVectors) {
    io.err(`Refusing: --rebuild drops box 3 and this console has no embedder, so the ${vectors} it holds would be gone and each one costs a paid network call to recompute — pass --keep-vectors to rebuild the text index and keep them, or --drop-vectors if losing them is what you mean.`);
    return EXIT.refused;
  }
  const store = openStoreAt({ dir });
  try {
    const canonical = store.list().length;
    const report = store.rebuildCache();
    io.out(`Canonical rows: ${canonical}`);
    if (held > 0)
      io.out(`Dropped on your say-so (--drop-vectors): ${vectors}.`);
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
function reclaimFreedPages(dir, io) {
  for (const [path, name] of [
    [paths.operational(dir), "the database"],
    [paths.cache(dir), "the cache"]
  ]) {
    if (!existsSync(path))
      continue;
    let db;
    try {
      db = openDb(path);
      db.exec("VACUUM");
      db.get("PRAGMA wal_checkpoint(TRUNCATE)");
      io.out(`Reclaimed free pages in ${name}.`);
    } catch (err) {
      io.err(`Could not reclaim free pages in ${name} (${String(err.message ?? err)}). ` + "Words from a removed memory may remain in pages no row points at; run this again " + "when nothing else is holding the store.");
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }
}
function foldNote(io, fold) {
  if (!fold.busy && fold.error === undefined)
    return;
  io.out("The file on disk shrinks to that size once other Counterparts processes (an open session or the dashboard) let go of it.");
}
function humanBytes(n) {
  if (n < 1024)
    return `${n} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
function databaseBytes(db) {
  const pages = db.get("PRAGMA page_count")?.page_count ?? 0;
  const pageSize = db.get("PRAGMA page_size")?.page_size ?? 0;
  return pages * pageSize;
}
function reclaimableBytes(db) {
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
function worthCompacting(reclaimable, size) {
  return reclaimable !== null && reclaimable > 1024 * 1024 && reclaimable > size / 20;
}
export async function migrateCacheCommand(dir, io, flags) {
  const apply = flags["apply"] === true;
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(dir, io, flags, "migrate-cache --apply", "rewrites every vector in box 3");
    if (refusal !== null)
      return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const preRowsRefusal = refusePreRows(dir, io);
  if (preRowsRefusal !== null)
    return preRowsRefusal;
  const path = paths.cache(dir);
  if (!existsSync(path)) {
    io.err(`no cache at ${path} — box 3 has never been built here, so there are no vectors to convert.`);
    return EXIT.failed;
  }
  const batch = (() => {
    const raw = flags["batch"];
    if (typeof raw !== "string")
      return 500;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 500;
  })();
  const db = openDb(path);
  const sizeBefore = databaseBytes(db);
  let census;
  let stamped;
  try {
    census = vectorFormats(db);
    stamped = db.get("SELECT value FROM cache_meta WHERE key = 'schemaVersion'")?.value ?? null;
    io.out(`Store: ${dir}`);
    io.out(`Cache: ${path}  (${humanBytes(sizeBefore)}, schema ${stamped === null ? "unstamped" : `v${stamped}`}` + `${stamped === String(CACHE_SCHEMA_VERSION) ? "" : ` — v${CACHE_SCHEMA_VERSION} once anything opens it for writing`})`);
    io.out(`Vectors: ${census.total}   float32 BLOB: ${census.float32}   JSON text: ${census.jsonText}` + (census.other > 0 ? `   unreadable: ${census.other}` : ""));
    io.out(`  bytes in vec: JSON text ${humanBytes(census.jsonTextBytes)}, ` + `float32 ${humanBytes(census.float32Bytes)}`);
    if (census.jsonText === 0) {
      const reclaimable = reclaimableBytes(db);
      const worth = worthCompacting(reclaimable, sizeBefore);
      io.out("");
      if (reclaimable === null) {
        io.out("Converted. Could not measure whether the file is compacted (the probe would not run).");
      } else if (worth) {
        io.out(`Converted, NOT yet compacted: ${humanBytes(reclaimable)} reclaimable of ${humanBytes(sizeBefore)}.`);
      } else {
        io.out(`Converted and compacted. Nothing to do.`);
      }
      if (!apply) {
        if (worth)
          io.out("Re-run with --apply to compact (it converts nothing — there is nothing left to convert).");
        return EXIT.ok;
      }
      if (!worth) {
        io.err(`Refusing: box 3 holds no JSON-text vectors and has nothing worth reclaiming — it is already float32. Nothing was written.`);
        return EXIT.refused;
      }
      const ok = await confirmMigrate(io, flags, dir, `compact box 3 (${humanBytes(reclaimable ?? 0)} reclaimable)`);
      if (!ok)
        return EXIT.refused;
      const { sizeAfter, fold } = (() => {
        const writable = openCache(path);
        try {
          writable.exec("VACUUM");
          return { sizeAfter: databaseBytes(writable), fold: foldWal(writable) };
        } finally {
          writable.close();
        }
      })();
      io.out(`Cache file: ${humanBytes(sizeBefore)} → ${humanBytes(sizeAfter)} ` + `(reclaimed ${humanBytes(Math.max(0, sizeBefore - sizeAfter))}).`);
      foldNote(io, fold);
      return EXIT.ok;
    }
    const projected = db.get("SELECT SUM(dim) * 4 AS b FROM embeddings WHERE typeof(vec) = 'text'")?.b ?? 0;
    io.out(`  after conversion those ${census.jsonText} rows hold ${humanBytes(projected)} ` + `(${census.jsonTextBytes > 0 ? (census.jsonTextBytes / Math.max(projected, 1)).toFixed(1) : "?"}× smaller)`);
    const sample = db.get("SELECT memory_id, dim, vec FROM embeddings WHERE typeof(vec) = 'text' ORDER BY memory_id LIMIT 1");
    if (sample !== undefined) {
      try {
        const asIs = Array.from(decodeVector(sample.vec));
        const converted = Array.from(decodeVector(encodeVector(asIs)));
        const drift = asIs.reduce((m, v, i) => Math.max(m, Math.abs(v - (converted[i] ?? 0))), 0);
        const show = (v) => v.slice(0, 4).map((x) => x.toPrecision(9)).join(", ");
        io.out("");
        io.out(`Sample: ${sample.memory_id}  dim ${sample.dim}  (${String(sample.vec).length} chars of JSON)`);
        io.out(`  now:   [${show(asIs)}, …]`);
        io.out(`  after: [${show(converted)}, …]`);
        io.out(`  largest coordinate change in this row: ${drift.toExponential(3)}`);
        const nonFinite = countNonFinite(asIs);
        if (nonFinite > 0)
          io.out(`  ${nonFinite} non-finite coordinates in this row become 0`);
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
    io.out(`First, copy box 3 aside — 'counterparts backup' skips the cache on purpose (it is rebuildable), so it does not cover this:`);
    io.out(`  cp ${path} ${path}.bak-<date>`);
    io.out(`  cp ${path}-wal ${path}-wal.bak-<date>   (when it is there)`);
    io.out(`  (with every session closed — a copy of a database being written is not a copy of it —`);
    io.out(`   and BOTH files: since WAL the database file alone is not the database, its '-wal' holds`);
    io.out(`   every page committed since the last checkpoint, so a copy without it is silently short)`);
    io.out(`Then re-run with --apply to convert (batches of ${batch}).`);
    return EXIT.ok;
  }
  const ok = await confirmMigrate(io, flags, dir, `convert ${census.jsonText} vectors in box 3`);
  if (!ok)
    return EXIT.refused;
  const writable = openCache(path);
  try {
    let converted = 0;
    let coerced = 0;
    let batches = 0;
    const skipped = [];
    let after;
    for (;; ) {
      const report = convertVectorBatch(writable, batch, after);
      if (report.examined === 0)
        break;
      converted += report.converted;
      coerced += report.coerced;
      skipped.push(...report.skipped);
      batches += 1;
      after = report.lastId ?? undefined;
      if (after === undefined)
        break;
    }
    io.out("");
    io.out(`Converted ${converted} vectors in ${batches} ${batches === 1 ? "batch" : "batches"}.`);
    if (coerced > 0)
      io.out(`Coerced ${coerced} non-finite coordinates to 0 (a NaN is not a coordinate).`);
    for (const id of skipped)
      io.out(`  SKIPPED, left exactly as it was: ${id} — its vec does not parse.`);
    const after2 = vectorFormats(writable);
    io.out(`Vectors now: float32 BLOB ${after2.float32}, JSON text ${after2.jsonText}`);
    let vacuumed = true;
    try {
      writable.exec("VACUUM");
    } catch (err) {
      vacuumed = false;
      io.err(`The conversion is committed; the VACUUM that reclaims the space did not run (${String(err.message ?? err)}). ` + `Re-run 'counterparts migrate-cache --dir ${dir} --apply' with no session open to compact it.`);
    }
    const sizeAfter = databaseBytes(writable);
    if (vacuumed) {
      const fold = foldWal(writable);
      io.out(`Cache file: ${humanBytes(sizeBefore)} → ${humanBytes(sizeAfter)} ` + `(reclaimed ${humanBytes(Math.max(0, sizeBefore - sizeAfter))}).`);
      foldNote(io, fold);
    }
    if (skipped.length > 0)
      return EXIT.failed;
    return after2.jsonText === 0 && vacuumed ? EXIT.ok : EXIT.failed;
  } finally {
    writable.close();
  }
}
async function confirmMigrate(io, flags, dir, what) {
  if (flags["yes"] === true)
    return true;
  io.out("");
  io.out(`About to ${what} at ${dir}.`);
  if (io.prompt === undefined) {
    io.err("refused: this is not an interactive console — pass --yes if that is what you mean.");
    return false;
  }
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
export function backfillClaimsCommand(dir, io, flags) {
  const apply = flags["apply"] === true;
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(dir, io, flags, "backfill-claims --apply", "writes the default claimed floor onto every unclaimed authored memory");
    if (refusal !== null)
      return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const floor = TUNABLES.AUTHORED_DEFAULT_CLAIM;
  const planning = openStoreAt({ dir, observer: true });
  let targets;
  try {
    targets = backfillTargets(planning);
  } finally {
    planning.close();
  }
  io.out(`Authored memories with no claimed salience: ${targets.length}`);
  io.out(`Default floor to apply: ${floor} (physics TUNABLES.AUTHORED_DEFAULT_CLAIM)`);
  for (const t of targets)
    io.out(`  ${t.id}  ${t.kind}  dims ${t.dims}`);
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
  const failures = [];
  try {
    for (const target of backfillTargets(store)) {
      try {
        const physics = store.physicsOf(target.id);
        store.updatePhysics(target.id, { salience: { ...physics.salience, claimed: floor } });
        store.revise(target.id, { meta: { [CLAIMED_DEFAULT_META_KEY]: true }, reason: "salience.default" });
        store.appendEvent({
          name: "salience.defaulted",
          day: store.livedDay(),
          ref: target.id,
          payload: { channel: "authored", floor, backfill: true }
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
  for (const failure of failures)
    io.err(`  FAILED ${failure}`);
  return failures.length === 0 ? EXIT.ok : EXIT.failed;
}
function backfillTargets(store) {
  const denied = new Set(store.deniedIds());
  const out = [];
  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined || denied.has(id))
      continue;
    if (row.archived === 1 || row.superseded_by !== null)
      continue;
    if (row.source !== "authored" || row.claimed !== null)
      continue;
    out.push({
      id,
      kind: row.kind,
      dims: `rel ${row.relevance} emo ${row.emotional} pred ${row.predictive}`
    });
  }
  return out;
}
export function repairDatesCommand(dir, io, flags) {
  const apply = flags["apply"] === true;
  if (apply && flags["dry-run"] === true) {
    io.err("repair-dates: --apply and --dry-run contradict each other; pass one");
    return EXIT.usage;
  }
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(dir, io, flags, "repair-dates --apply", "rewrites the date on every migrated memory the evidence reaches");
    if (refusal !== null)
      return refusal;
  }
  const raw = typeof flags["confidence"] === "string" ? flags["confidence"] : "high";
  if (raw !== "high" && raw !== "medium" && raw !== "low") {
    io.err(`repair-dates: --confidence must be high, medium or low (got ${raw})`);
    return EXIT.usage;
  }
  const confidence = raw;
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
    ...importDay === undefined ? {} : { importDay },
    ...sampleRaw === undefined ? {} : { sample: sampleRaw }
  });
  if (report === null)
    return EXIT.failed;
  if (report.refused !== null)
    return EXIT.refused;
  return report.failures.length === 0 ? EXIT.ok : EXIT.failed;
}
