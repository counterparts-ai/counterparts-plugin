import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SpanBuffer, keyFor } from "../../core/remember/index.js";
import { strikeSpans } from "../../core/remember/owner-strike-seam.js";
import { journalFilesFor, syncJournalCopy } from "../../core/self/journal-file.js";
import { paths, rowTombstoned } from "../../core/store/index.js";
import { isLocked, openDb } from "../../core/store/db.js";
import { chaseRemoved } from "../../core/store/owner-op-seam.js";
import { isSelfPageRow } from "../../core/self/page.js";
const MEMORY_BEARING = new Set(["memory", "episode", "schema"]);
export function removalRefusal(store, targetId) {
  const row = store.row(targetId);
  if (row === undefined)
    return "unknown-id";
  if (!MEMORY_BEARING.has(row.type))
    return "not-memory-bearing";
  if (store.deniedIds().includes(targetId))
    return "already-removed";
  if (isSelfPageRow(store, targetId))
    return "is-the-self-page";
  return null;
}
const SPANS_BLIND = "this removal did not reach it, and a later backup would copy it (export would not).";
const JOURNAL_STILL_THERE = "journal/ — it is a derived copy, and deleting that file by hand loses nothing";
function olderCopiesNote(storeDir) {
  const snapshots = join(storeDir, "..", "snapshots");
  let copies = 0;
  try {
    copies = readdirSync(snapshots).length;
  } catch {}
  return `snapshots and backups TAKEN BEFORE TODAY still hold these words, and the journal ones hold them as plain markdown` + (copies === 0 ? ` — none in the default location (${relative(storeDir, snapshots)}), and a location set in your host configuration is not visible from this console.` : ` — ${copies} cop${copies === 1 ? "y" : "ies"} in the default location (${relative(storeDir, snapshots)}), plus anywhere else you have taken one.`) + " A removal does not reach into them; they are yours to delete. Snapshots taken from today carry no journal/ at all.";
}
function jsonlUnder(root) {
  if (!existsSync(root))
    return [];
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory())
        walk(full);
      else if (name.endsWith(".jsonl") || name.endsWith(".jsonl.striking"))
        out.push(full);
    }
  };
  walk(root);
  return out;
}
function spanLinesIn(path, hashes, needle) {
  const none = { byHash: 0, byTextJot: 0, byTextOther: 0 };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return none;
  }
  let byHash = 0;
  let byTextJot = 0;
  let byTextOther = 0;
  let parsedAny = false;
  for (const line of text.split(`
`)) {
    if (line.trim().length === 0)
      continue;
    try {
      const record = JSON.parse(line);
      if (typeof record.text !== "string")
        continue;
      parsedAny = true;
      if (typeof record.hash === "string" && hashes.has(record.hash))
        byHash += 1;
      else if (needle !== null && record.text.includes(needle)) {
        if (record.kind === "jot" && record.text.trim() === needle)
          byTextJot += 1;
        else
          byTextOther += 1;
      }
    } catch {}
  }
  if (byHash === 0 && byTextJot === 0 && byTextOther === 0 && !parsedAny && needle !== null && text.includes(needle)) {
    return { byHash: 0, byTextJot: 0, byTextOther: 1 };
  }
  return { byHash, byTextJot, byTextOther };
}
function chaseHashes(store, doc, row) {
  const scope = typeof row?.origin_scope === "string" && row.origin_scope.length > 0 ? row.origin_scope : null;
  const hashes = new Set;
  const origin = doc?.meta?.["origin"];
  if (origin !== null && typeof origin === "object") {
    const spanHash = origin.spanHash;
    if (typeof spanHash === "string" && spanHash.length > 0)
      hashes.add(spanHash);
  }
  const ref = typeof row?.origin_ref === "string" && row.origin_ref.length > 0 ? row.origin_ref : null;
  if (ref !== null && scope !== null) {
    const coverage = join(store.dir, "spans", keyFor(scope), "coverage.jsonl");
    if (existsSync(coverage)) {
      let text = "";
      try {
        text = readFileSync(coverage, "utf8");
      } catch {
        text = "";
      }
      for (const line of text.split(`
`)) {
        if (line.trim().length === 0)
          continue;
        try {
          const mark = JSON.parse(line);
          if (mark.own !== true)
            continue;
          if (mark.proposalId !== ref)
            continue;
          if (typeof mark.spanHash === "string")
            hashes.add(mark.spanHash);
        } catch {}
      }
    }
  }
  return { scope, hashes: [...hashes] };
}
export function spanResidue(store, targetId, body, hashes = [], opts = {}) {
  const row = store.row(targetId);
  const source = typeof row?.source === "string" && row.source.length > 0 ? row.source : null;
  const scope = typeof row?.origin_scope === "string" && row.origin_scope.length > 0 ? row.origin_scope : null;
  const spansRoot = join(store.dir, "spans");
  const scopeDir = scope === null ? spansRoot : join(spansRoot, keyFor(scope));
  const files = jsonlUnder(scopeDir);
  const rel = (path) => relative(store.dir, path);
  const named = scope === null ? "spans/" : `${rel(scopeDir)}/`;
  const none = (state, line, extra = {}) => ({
    surface: "spans",
    state,
    path: null,
    count: 0,
    echoes: 0,
    matchedBy: "none",
    candidates: [],
    line,
    ...extra
  });
  if (files.length === 0) {
    return none("not-applicable", `spans: not applicable — there is no capture buffer at ${named} for this memory, so nothing of it rode one.`);
  }
  const needle = body.trim().length > 0 ? body.trim() : null;
  const keys = new Set(hashes);
  const contentAllowed = keys.size === 0 && needle !== null;
  const contentScoped = contentAllowed && (scope !== null || opts.crossScopeContent === true);
  let count = 0;
  let echoes = 0;
  let first = null;
  const candidates = [];
  for (const file of files) {
    const hits = spanLinesIn(file, keys, needle);
    const exact = keys.size > 0 ? 0 : hits.byTextJot;
    const mine = keys.size > 0 ? hits.byHash : contentScoped ? hits.byTextJot : 0;
    echoes += keys.size > 0 ? hits.byTextJot + hits.byTextOther : hits.byTextOther;
    if (!contentScoped && exact > 0)
      candidates.push({ file: rel(file), lines: exact });
    if (mine === 0)
      continue;
    count += mine;
    if (first === null)
      first = rel(file);
  }
  const echoNote = echoes === 0 ? "" : ` ${echoes} line${echoes === 1 ? "" : "s"} of conversation under ${named} quote${echoes === 1 ? "s" : ""} these words — transcript, not this memory's own capture, and left alone here; retention deletes a session's captured text 3 days after it is written up and ended, and never keeps it more than 14 days, so ${echoes === 1 ? "it goes" : "they go"} then (backups made since 2026-10-13 hold none of it).`;
  if (first !== null) {
    const where = count === 1 ? first : `${first} (and ${count - 1} more line${count === 2 ? "" : "s"})`;
    const how = keys.size > 0 ? "matched by the span hash its mint recorded" : opts.crossScopeContent === true && scope === null ? "matched by content across every scope, on your say-so (--strike-by-content-across-scopes)" : "matched by content — a jot whose whole text is this memory's body";
    return {
      surface: "spans",
      state: "held",
      path: first,
      count,
      echoes,
      matchedBy: keys.size > 0 ? "hash" : "content",
      candidates: [],
      line: `${where} — the raw capture buffer holds this memory's words (${how}); the removal strikes them out of it.${echoNote}`
    };
  }
  if (candidates.length > 0) {
    const total = candidates.reduce((n, c) => n + c.lines, 0);
    const where = candidates.map((c) => `${c.file} (${c.lines})`).join(", ");
    return {
      surface: "spans",
      state: "unknown",
      path: named,
      count: 0,
      echoes,
      matchedBy: "none",
      candidates,
      line: `${named} — this memory's provenance records no scope and no span hash, so a chase by content would have to visit EVERY project on this machine. NOT done: ${total} jot line${total === 1 ? "" : "s"} whose whole text is this memory's body would have matched, in ${where}. Look, then re-run with --strike-by-content-across-scopes if they are yours to remove; until then ${SPANS_BLIND}${echoNote}`
    };
  }
  if (needle === null && keys.size === 0) {
    return none("unknown", `${named} — the prose is already gone and no span hash was recorded, so this console cannot tell whether the words rode the buffer; if they did, ${SPANS_BLIND}${echoNote}`, { echoes, path: named });
  }
  if (keys.size > 0) {
    return none("not-applicable", echoes === 0 ? `spans: not applicable — this memory's own span is named in its provenance, and no line under ${named} still carries it.` : `spans: not applicable — this memory's own capture is already gone from ${named}.${echoNote}`, { echoes });
  }
  if (source === "authored") {
    return none("unknown", `${named} — this memory came through the jot door, so its words rode the buffer; no jot there matches them now, and this console cannot prove the capture is gone; if one survives, ${SPANS_BLIND}${echoNote}`, { echoes, path: named });
  }
  if (source === null) {
    return none("unknown", `${named} — unknown whether the words rode the buffer: this memory's provenance was never recorded, and a buffer exists; if a jot is there, ${SPANS_BLIND}${echoNote}`, { echoes, path: named });
  }
  return none("not-applicable", `spans: not applicable — a '${source}' memory is not captured as a jot, and no jot under ${named} holds its words.${echoNote}`, { echoes });
}
export const JOURNAL_ECHO_SCAN_MAX = 2000;
function folded(text) {
  return text.replace(/\s+/g, " ").trim();
}
function journalEcho(store, targetId, body, doc, opts) {
  const ids = [];
  const linked = doc?.meta?.["episodeId"];
  if (typeof linked === "string" && linked.length > 0 && linked !== targetId) {
    const row = store.row(linked);
    if (row !== undefined && row.type === "episode" && !rowTombstoned(row))
      ids.push(linked);
  }
  const needle = folded(body);
  let episodes;
  try {
    episodes = store.list({ type: "episode" });
  } catch {
    return { ids, checked: 0, total: 0 };
  }
  if (needle.length === 0)
    return { ids, checked: episodes.length, total: episodes.length };
  const cap = Math.max(0, opts.echoScanMax ?? JOURNAL_ECHO_SCAN_MAX);
  let checked = 0;
  for (const id of episodes) {
    if (checked >= cap)
      break;
    checked += 1;
    if (id === targetId || ids.includes(id))
      continue;
    try {
      const row = store.row(id);
      if (row === undefined || rowTombstoned(row))
        continue;
      if (folded(store.readProse(id).body).includes(needle))
        ids.push(id);
    } catch {}
  }
  return { ids, checked, total: episodes.length };
}
export function planRemoval(store, targetId, opts = {}) {
  const none = (reason) => ({
    targetId,
    valid: false,
    reason,
    contamination: [],
    surfaces: [],
    spans: {
      surface: "spans",
      state: "not-applicable",
      path: null,
      count: 0,
      echoes: 0,
      matchedBy: "none",
      candidates: [],
      line: "spans: not applicable — there is nothing here to have ridden the buffer."
    },
    spanChase: { scope: null, hashes: [], byContent: false },
    unchasable: [],
    leftAlone: []
  });
  const refusal = removalRefusal(store, targetId);
  if (refusal !== null)
    return none(refusal);
  const row = store.row(targetId);
  if (row === undefined)
    return none("unknown-id");
  let body = "";
  let doc = null;
  try {
    const read = store.readProse(targetId);
    body = read.body;
    doc = read;
  } catch {}
  const chase = chaseHashes(store, doc, row);
  const contamination = [];
  if (body.trim().length > 0) {
    for (const hit of store.search(body, 20)) {
      if (hit.id !== targetId)
        contamination.push(hit.id);
    }
  }
  const versions = store.versions(targetId);
  const edges = store.edgesFrom(targetId);
  const prospective = store.prospectiveFor(targetId);
  const spans = spanResidue(store, targetId, body, chase.hashes, opts);
  const ownJournalFiles = journalFilesFor(store.dir, targetId).length;
  const journalEchoes = journalEcho(store, targetId, body, doc, opts);
  return {
    targetId,
    valid: true,
    reason: "ok",
    contamination,
    surfaces: [
      { surface: "prose", count: 1 },
      { surface: "versions", count: versions.length },
      { surface: "edges", count: edges.length },
      { surface: "prospective", count: prospective.length },
      { surface: "operational rows", count: 1 },
      { surface: "cache", count: 1 },
      { surface: "journal", count: ownJournalFiles },
      ...spans.state === "unknown" ? [] : [{ surface: "spans", count: spans.count }]
    ],
    spans,
    spanChase: {
      scope: chase.scope,
      hashes: chase.hashes,
      byContent: chase.hashes.length === 0 && body.trim().length > 0 && (chase.scope !== null || opts.crossScopeContent === true)
    },
    unchasable: spans.state === "unknown" ? [spans.line] : [],
    leftAlone: [
      ...spans.echoes > 0 ? [
        `spans echo: ${spans.echoes} line${spans.echoes === 1 ? "" : "s"} of conversation quoting these words — transcript, not this memory's capture. Left on purpose. Nothing prunes the buffer today, so ${spans.echoes === 1 ? "it stays" : "they stay"} there.`
      ] : [],
      ...journalEchoes.ids.length > 0 ? [
        `journal echo: ${journalEchoes.ids.length} episode${journalEchoes.ids.length === 1 ? "" : "s"} whose chapters quote these words — the counterpart's own account of those days, not this memory. Left on purpose, row and markdown copy alike, so ${journalEchoes.ids.length === 1 ? "that .md under journal/ still holds the words" : "those .md files under journal/ still hold the words"}, and any snapshot or backup already taken holds them too. To take one as well: ${journalEchoes.ids.map((id) => `counterparts remove ${id} --confirm`).join(" · ")}`
      ] : [],
      ...journalEchoes.checked < journalEchoes.total ? [
        `journal echo check was BOUNDED: checked ${journalEchoes.checked} of ${journalEchoes.total} episodes, so an episode past that quoting these words is not named above. 'counterparts export --out <dir> --markdown --plaintext' writes every chapter out if you want to look yourself.`
      ] : [],
      ...row.type === "episode" || journalEchoes.ids.length > 0 ? [olderCopiesNote(store.dir)] : []
    ]
  };
}
export function ownerRemoval(store, request, opts = {}) {
  const emit = opts.onEvent ?? (() => {});
  const notes = [];
  const append = (stage, addendum) => {
    const note = {
      memoryId: request.targetId,
      stage,
      actor: request.actor,
      reason: addendum === undefined ? request.reason : `${request.reason} [${addendum}]`
    };
    store.appendRemovalRecord(note);
    notes.push(note);
    emit("cli.removal.stage", { stage, target: request.targetId });
  };
  const plan = planRemoval(store, request.targetId, {
    ...opts.crossScopeContent === undefined ? {} : { crossScopeContent: opts.crossScopeContent }
  });
  if (!plan.valid) {
    throw new Error(`removal refused: ${plan.reason}`);
  }
  append("requested");
  let doomedBody = "";
  try {
    doomedBody = store.readProse(request.targetId).body.trim();
  } catch {}
  append("dark");
  const chased = [];
  const unchased = [...plan.unchasable];
  const leftAlone = [...plan.leftAlone];
  if (plan.spans.state === "held") {
    try {
      const buffer = new SpanBuffer({ dir: store.dir, day: () => store.livedDay() });
      const report = strikeSpans(buffer, {
        scope: plan.spanChase.scope,
        hashes: plan.spanChase.hashes,
        ...plan.spanChase.byContent && doomedBody.length > 0 ? { predicate: (text) => text.trim() === doomedBody } : {}
      });
      if (report.reason === "STRUCK") {
        chased.push(`spans(${report.struck} line${report.struck === 1 ? "" : "s"} in ${report.files.length} file${report.files.length === 1 ? "" : "s"})`);
        if (report.ledgered > 0) {
          chased.push(`spans ledger(${report.ledgered} hash${report.ledgered === 1 ? "" : "es"} kept in consumed.jsonl so nothing re-captures the words)`);
        }
        if (report.touchedClaim)
          chased.push("spans claim file(rewritten; a restore cannot put it back)");
        emit("cli.removal.spans", {
          struck: report.struck,
          files: report.files.length,
          ledgered: report.ledgered,
          byHash: plan.spanChase.hashes.length > 0
        });
        if (report.recovered > 0) {
          chased.push(`spans recovered(${report.recovered} line${report.recovered === 1 ? "" : "s"} folded back out of a crashed strike's aside)`);
        }
      } else {
        unchased.push(`spans (${report.reason}) — the strike did not run; ${plan.spans.path ?? "the capture buffer"} still holds this memory's words, and ${SPANS_BLIND}`);
      }
    } catch {
      unchased.push(`spans (threw) — the strike did not run; ${plan.spans.path ?? "the capture buffer"} still holds this memory's words, and ${SPANS_BLIND}`);
    }
  }
  try {
    const report = chaseRemoved(store, request.targetId);
    for (const surface of report.removed)
      chased.push(`${surface.surface}(${surface.count})`);
    for (const surface of report.neutralized) {
      chased.push(`${surface.surface}(${surface.count}, tombstoned)`);
    }
    notes.push({ memoryId: request.targetId, stage: "chased", actor: request.actor });
    emit("cli.removal.stage", { stage: "chased", target: request.targetId });
  } catch {
    unchased.push("operational rows");
    append("chased");
  }
  try {
    const synced = syncJournalCopy(store, request.targetId);
    if (synced.outcome === "failed") {
      unchased.push(`journal (${synced.reason ?? "unknown"}) — the markdown copy of this episode is still under ${JOURNAL_STILL_THERE}`);
    } else if (synced.outcome === "removed") {
      chased.push("journal(1 markdown copy)");
    } else {
      const echoes = plan.leftAlone.filter((line) => line.startsWith("journal echo:")).length;
      chased.push(echoes === 0 ? "journal(0, nothing beside the row)" : "journal(0 of its own; other episodes' copies left on purpose, see above)");
    }
  } catch {
    unchased.push(`journal (threw) — the markdown copy may still be under ${JOURNAL_STILL_THERE}`);
  }
  try {
    store.rebuildCache();
    chased.push("cache");
  } catch {
    unchased.push("cache");
  }
  chaseWriteAheadLog(store.dir, chased, unchased);
  append("complete", unchased.length === 0 ? undefined : `${unchased.length} surface${unchased.length === 1 ? "" : "s"} unchased — see the console report`);
  emit("cli.removal.complete", {
    target: request.targetId,
    chased: chased.length,
    unchased: unchased.length,
    contamination: plan.contamination.length
  });
  return { chased, unchased, leftAlone, notes };
}
function chaseWriteAheadLog(dir, chased, unchased) {
  reclaim(paths.operational(dir), "write-ahead log and freed pages", chased, unchased);
  reclaim(paths.cache(dir), "cache write-ahead log and freed pages", chased, unchased);
}
function reclaim(path, surface, chased, unchased) {
  if (!existsSync(path))
    return;
  let db;
  try {
    db = openDb(path);
    db.exec("VACUUM");
    const row = db.get("PRAGMA wal_checkpoint(TRUNCATE)");
    const busy = row === undefined ? 1 : Object.values(row)[0];
    if (busy === 0)
      chased.push(surface);
    else
      unchased.push(`${surface} (${STILL_THERE})`);
  } catch (err) {
    const why = isLocked(err) ? "the database was busy" : String(err.message ?? err);
    unchased.push(`${surface} (${why}; ${STILL_THERE})`);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
const STILL_THERE = "the memory's rows are gone, but its words may remain in pages no row points at until " + "the next successful removal or 'counterparts verify --dir <store> --rebuild'";
export function verifyRemoval(store, targetId) {
  const row = store.row(targetId);
  const tombstone = store.tombstones().find((e) => e.id === targetId);
  return {
    denied: store.deniedIds().includes(targetId),
    bodyGone: row === undefined || row.body === "",
    rowSurvives: row !== undefined,
    rowTombstoned: tombstone !== undefined && row !== undefined && rowTombstoned(row),
    darkState: store.edgesFrom(targetId).length + store.prospectiveFor(targetId).length
  };
}
