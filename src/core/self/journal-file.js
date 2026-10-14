import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { renderMarkdown, rowTombstoned } from "../store/index.js";
export const JOURNAL_DIR = "journal";
export const JOURNAL_COPY_WRITTEN_EVENT = "journal.copy.written";
export const JOURNAL_COPY_FAILED_EVENT = "journal.copy.failed";
export const JOURNAL_BACKFILL_PER_PASS = 25;
export const JOURNAL_BACKFILL_COLD_PASS = 1000;
export const JOURNAL_BACKFILL_BUDGET_MS = 250;
export const JOURNAL_TEMP_STALE_MS = 60 * 60000;
export const UNDATED = "undated";
export function journalDir(storeDir) {
  return join(storeDir, JOURNAL_DIR);
}
export function journalRelativePath(doc) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(doc.learnedOn) ? doc.learnedOn : UNDATED;
  const year = date === UNDATED ? UNDATED : date.slice(0, 4);
  return `${JOURNAL_DIR}/${year}/${date}-${doc.id}.md`;
}
export function journalFileEpisodeId(relativePath) {
  const m = /^journal\/(?:\d{4}|undated)\/(?:\d{4}-\d{2}-\d{2}|undated)-(.+?)\.md(?:\.tmp-[A-Za-z0-9]+)?$/.exec(relativePath);
  return m === null ? null : m[1];
}
export function journalPathIsLinked(storeDir, relativePath) {
  let at = storeDir;
  for (const part of relativePath.split("/")) {
    at = join(at, part);
    try {
      if (lstatSync(at).isSymbolicLink())
        return true;
    } catch {
      return false;
    }
  }
  return false;
}
export function isJournalTempName(name) {
  return /\.md\.tmp-[A-Za-z0-9]+$/.test(name);
}
export const JOURNAL_DIRECTORY_REASONS = [
  "journal-symlink",
  "journal-dir-unwritable",
  "journal-unreadable"
];
export function isJournalDirectoryFailure(reason) {
  return reason !== null && JOURNAL_DIRECTORY_REASONS.includes(reason);
}
export function journalScan(storeDir) {
  const root = journalDir(storeDir);
  const out = [];
  let linked = false;
  try {
    if (lstatSync(root).isSymbolicLink())
      return { files: [], linked: true };
  } catch {
    return { files: [], linked: false };
  }
  const walk = (at, rel) => {
    let names;
    try {
      names = readdirSync(at).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(at, name);
      const next = rel === "" ? name : `${rel}/${name}`;
      try {
        const st = lstatSync(full);
        if (st.isSymbolicLink()) {
          linked = true;
          continue;
        }
        if (st.isDirectory())
          walk(full, next);
        else
          out.push(`${JOURNAL_DIR}/${next}`);
      } catch {}
    }
  };
  walk(root, "");
  return { files: out, linked };
}
export function journalFiles(storeDir) {
  return journalScan(storeDir).files;
}
export function journalFilesFor(storeDir, episodeId) {
  return journalFiles(storeDir).filter((rel) => journalFileEpisodeId(rel) === episodeId);
}
export function sweepJournalTemps(storeDir, now = Date.now()) {
  const swept = [];
  for (const rel of journalFiles(storeDir)) {
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (!isJournalTempName(name) || journalFileEpisodeId(rel) === null)
      continue;
    const full = join(storeDir, rel);
    try {
      if (now - statSync(full).mtimeMs < JOURNAL_TEMP_STALE_MS)
        continue;
      rmSync(full, { force: true });
      swept.push(rel);
    } catch {}
  }
  return swept;
}
export function renderJournalCopy(doc) {
  return renderMarkdown(doc);
}
export function syncJournalCopy(store, episodeId) {
  const result = (outcome, extra = {}) => ({
    episodeId,
    outcome,
    file: null,
    bytes: 0,
    reason: null,
    ...extra
  });
  let scan;
  try {
    scan = journalScan(store.dir);
  } catch {
    return result("failed", { reason: "journal-unreadable" });
  }
  if (scan.linked)
    return result("failed", { reason: "journal-symlink" });
  try {
    mkdirSync(journalDir(store.dir), { recursive: true });
  } catch {
    return result("failed", { reason: "journal-dir-unwritable" });
  }
  const existing = scan.files.filter((rel) => journalFileEpisodeId(rel) === episodeId);
  let doc = null;
  try {
    const row = store.row(episodeId);
    const live = row !== undefined && row.type === "episode" && !rowTombstoned(row) && !store.deniedIds().includes(episodeId);
    if (live)
      doc = store.readProse(episodeId);
  } catch {
    doc = null;
  }
  if (doc === null) {
    let removed = 0;
    for (const rel of existing) {
      if (journalPathIsLinked(store.dir, rel)) {
        return result("failed", { reason: "journal-symlink", file: rel });
      }
      try {
        rmSync(join(store.dir, rel), { force: true });
        removed += 1;
      } catch {
        return result("failed", { reason: "unlink-failed", file: rel });
      }
    }
    return removed === 0 ? result("absent") : result("removed", { file: existing[0] });
  }
  let text;
  try {
    text = renderJournalCopy(doc);
  } catch {
    return result("failed", { reason: "render-refused" });
  }
  const rel = journalRelativePath(doc);
  const bytes = Buffer.byteLength(text, "utf8");
  const target = join(store.dir, rel);
  if (journalPathIsLinked(store.dir, rel)) {
    return result("failed", { reason: "journal-symlink", file: rel, bytes });
  }
  const strandedStale = [];
  for (const stale of existing) {
    if (stale === rel)
      continue;
    try {
      rmSync(join(store.dir, stale), { force: true });
    } catch {
      strandedStale.push(stale);
    }
  }
  try {
    if (strandedStale.length === 0 && !lstatSync(target).isSymbolicLink() && readFileSync(target, "utf8") === text) {
      return result("unchanged", { file: rel, bytes });
    }
  } catch {}
  const temp = `${target}.tmp-${Math.random().toString(36).slice(2, 10)}`;
  try {
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(temp, text, "utf8");
    renameSync(temp, target);
  } catch {
    try {
      rmSync(temp, { force: true });
    } catch {}
    return result("failed", { reason: "write-failed", file: rel, bytes });
  }
  if (strandedStale.length > 0) {
    return result("failed", { reason: "stale-copy-stranded", file: strandedStale[0], bytes });
  }
  return result("written", { file: rel, bytes });
}
export const JOURNAL_FAILURE_WINDOW_DAYS = 2;
export function standingJournalFailures(store) {
  const sinceDay = Math.max(0, store.livedDay() - JOURNAL_FAILURE_WINDOW_DAYS);
  const newest = (name) => {
    const out = new Map;
    for (const row of store.eventLog({ name, sinceDay, order: "desc", limit: 5000 })) {
      if (row.ref !== null && !out.has(row.ref))
        out.set(row.ref, row.seq);
    }
    return out;
  };
  const failed = newest(JOURNAL_COPY_FAILED_EVENT);
  const written = newest(JOURNAL_COPY_WRITTEN_EVENT);
  const standing = new Set;
  for (const [id, seq] of failed) {
    if ((written.get(id) ?? -1) < seq)
      standing.add(id);
  }
  return standing;
}
export function journalBackfillTargets(store, limit) {
  let have;
  try {
    have = new Set(journalFiles(store.dir).map((rel) => journalFileEpisodeId(rel)).filter((id) => id !== null));
  } catch {
    return [];
  }
  const denied = new Set(store.deniedIds());
  let standing;
  try {
    standing = standingJournalFailures(store);
  } catch {
    standing = new Set;
  }
  const out = [];
  for (const id of store.list({ type: "episode" })) {
    if (out.length >= limit)
      break;
    if (have.has(id) || denied.has(id) || standing.has(id))
      continue;
    out.push(id);
  }
  return out;
}
export function backfillJournalCopies(store, opts = {}) {
  const budget = opts.budgetMs ?? JOURNAL_BACKFILL_BUDGET_MS;
  const clock = opts.now ?? Date.now;
  const started = clock();
  const cold = (() => {
    try {
      return journalFiles(store.dir).length === 0;
    } catch {
      return false;
    }
  })();
  const limit = opts.limit ?? (cold ? JOURNAL_BACKFILL_COLD_PASS : JOURNAL_BACKFILL_PER_PASS);
  let sweptTemps = 0;
  try {
    sweptTemps = sweepJournalTemps(store.dir, started).length;
  } catch {}
  const results = [];
  let targets;
  try {
    targets = journalBackfillTargets(store, limit);
  } catch {
    return { written: 0, failed: 0, results: [], more: false, sweptTemps };
  }
  let more = false;
  for (const id of targets) {
    if (clock() - started > budget) {
      more = true;
      break;
    }
    const result = syncJournalCopy(store, id);
    if (isJournalDirectoryFailure(result.reason)) {
      results.push({ ...result, episodeId: "", file: null, bytes: 0 });
      return {
        written: 0,
        failed: 1,
        results,
        more: true,
        sweptTemps
      };
    }
    results.push(result);
  }
  if (!more && targets.length >= limit)
    more = true;
  return {
    written: results.filter((r) => r.outcome === "written").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
    more,
    sweptTemps
  };
}
export function noteJournalCopy(store, result, opts) {
  if (result.outcome === "unchanged" || result.outcome === "absent")
    return;
  const failed = result.outcome === "failed";
  const directory = isJournalDirectoryFailure(result.reason);
  const ref = failed && directory ? null : result.episodeId === "" ? null : result.episodeId;
  const date = store.today();
  const dedupKey = failed ? `${JOURNAL_COPY_FAILED_EVENT}:${directory ? "dir" : String(ref)}:${String(result.reason)}:${date}` : undefined;
  try {
    store.appendEvent({
      name: failed ? JOURNAL_COPY_FAILED_EVENT : JOURNAL_COPY_WRITTEN_EVENT,
      day: opts.day,
      ref,
      ...dedupKey === undefined ? {} : { dedupKey },
      payload: {
        date,
        site: opts.site,
        outcome: result.outcome,
        file: result.file,
        bytes: result.bytes,
        ...opts.chapters === undefined ? {} : { chapters: opts.chapters },
        ...result.reason === null ? {} : { reason: result.reason },
        ...directory ? { scope: "directory" } : {}
      }
    });
  } catch {}
}
