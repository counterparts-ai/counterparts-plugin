import { StoreError } from "./errors.js";
import { hashText } from "./prose.js";
import { unfade } from "../physics/index.js";
import { CARD_TOMBSTONE_PREFIX } from "./operational.js";
const GRANTS = new WeakMap;
export function grantOwnerOps(store, access) {
  GRANTS.set(store, access);
}
export const REMOVED_REASON = "removed-by-owner";
export function chaseRemoved(store, id) {
  const access = GRANTS.get(store);
  if (access === undefined) {
    throw new StoreError("OWNER_OP_UNGRANTED", { id, site: "chaseRemoved" });
  }
  if (!access.isDenied(id)) {
    throw new StoreError("REMOVAL_NOT_DARK", { id, site: "chaseRemoved" });
  }
  let restoredFade = 0;
  let pairsGone = 0;
  const unarchived = [];
  let cardLinks = 0;
  const report = access.ownerMutate("chaseRemoved", (db) => {
    const row = access.rawRow(id);
    const already = db.get("SELECT COUNT(*) AS n FROM removal_tombstone WHERE memory_id = ?", id);
    const noop = (already?.n ?? 0) > 0;
    const edges = db.get("SELECT COUNT(*) AS n FROM edges WHERE src = ? OR dst = ?", id, id)?.n ?? 0;
    const prospective = db.get("SELECT COUNT(*) AS n FROM prospective WHERE memory_id = ?", id)?.n ?? 0;
    const gateRows = db.get("SELECT COUNT(*) AS n FROM gate_session WHERE ref = ?", id)?.n ?? 0;
    const versions = db.get("SELECT COUNT(*) AS n FROM versions WHERE memory_id = ?", id)?.n ?? 0;
    db.run("DELETE FROM edges WHERE src = ? OR dst = ?", id, id);
    db.run("DELETE FROM prospective WHERE memory_id = ?", id);
    db.run("DELETE FROM feelings WHERE memory_id = ?", id);
    if (db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'traits'")?.n) {
      db.run("DELETE FROM traits WHERE memory_id = ?", id);
    }
    db.run("DELETE FROM gate_session WHERE ref = ?", id);
    db.run("DELETE FROM returns WHERE memory_id = ?", id);
    db.run("DELETE FROM wake_display WHERE memory_id = ?", id);
    db.run("DELETE FROM core_events WHERE memory_id = ?", id);
    const journals = redactDreamJournals(db, id, row?.title ?? null, row?.body ?? "");
    const reflections = redactReflections(db, id, row?.title ?? null, row?.body ?? "");
    db.run("UPDATE dream_changes SET ref = NULL WHERE ref = ?", id);
    db.run("UPDATE dream_changes SET ref2 = NULL WHERE ref2 = ?", id);
    if (db.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'contradictions'")?.n) {
      const pairs = db.all("SELECT id, state, via FROM contradictions WHERE a = ? OR b = ?", id, id);
      for (const pair of pairs) {
        if (pair.state === "settled" && pair.via === null) {
          const last = db.get("SELECT detail FROM contradiction_settles WHERE pair_id = ? AND action = 'settle' AND undone = 0 ORDER BY seq DESC LIMIT 1", pair.id);
          let d = {};
          try {
            d = JSON.parse(last?.detail ?? "{}");
          } catch {
            d = {};
          }
          const fade = d["fade"];
          if (fade !== undefined && typeof fade.id === "string" && fade.id !== id && typeof fade.factor === "number") {
            const now = db.get("SELECT fade FROM memories WHERE id = ?", fade.id)?.fade ?? 1;
            db.run("UPDATE memories SET fade = ? WHERE id = ?", unfade(now, fade.factor), fade.id);
            restoredFade += 1;
          }
          const archived = d["archived"];
          if (typeof archived === "string" && archived !== id) {
            db.run(`UPDATE memories SET archived = 0, archived_reason = NULL, updated_at = ?
                WHERE id = ? AND archived = 1 AND archived_reason = 'corrected' AND superseded_by IS NULL`, Date.now(), archived);
            if ((db.get("SELECT changes() AS n")?.n ?? 0) > 0)
              unarchived.push(archived);
          }
        }
        db.run("DELETE FROM contradiction_settles WHERE pair_id = ?", pair.id);
        db.run(`UPDATE contradictions SET state = 'unsettled', how = NULL, holds = NULL, over = NULL, via = NULL,
                  settled_day = NULL, raised_day = NULL, updated_at = ? WHERE via = ?`, Date.now(), pair.id);
        db.run("DELETE FROM contradictions WHERE id = ?", pair.id);
        pairsGone += 1;
      }
    }
    db.run(`UPDATE versions
          SET title = NULL, body = '', meta = '{}', content_hash = '',
              learned_on = '', happened_on = NULL,
              created_at = NULL, model = NULL, event_date = NULL
        WHERE memory_id = ?`, id);
    try {
      db.run("UPDATE versions SET occurred_on = NULL, said_by = NULL, status = NULL WHERE memory_id = ?", id);
      if (row?.type === "schema" && !noop) {
        const linked = db.all("SELECT memory_id FROM memory_subjects WHERE subject_id = ? ORDER BY memory_id", id).map((r) => r.memory_id);
        if (linked.length > 0) {
          db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", `${CARD_TOMBSTONE_PREFIX}${id}`, JSON.stringify(linked));
          cardLinks = linked.length;
        }
      }
      db.run("DELETE FROM memory_subjects WHERE memory_id = ? OR subject_id = ?", id, id);
    } catch {}
    if (row !== undefined) {
      db.run(`UPDATE memories
            SET novelty = NULL, relevance = 0, emotional = 0, predictive = 0, claimed = NULL,
                uses = 0, reinforced_days = 0, consolidated = 0, promoted_identity = 0,
                protected = 0, pressure = 0, last_challenged_day = NULL,
                archived = 1, archived_reason = ?, content_hash = '',
                title = NULL, body = '', meta = '{}', confidential = 0,
                learned_on = '', happened_on = NULL,
                created_at = NULL, updated_at = NULL, model = NULL, event_date = NULL,
                returns = 0, return_days = 0, first_return_day = NULL, last_return_day = NULL,
                last_dream_day = NULL, about = NULL, about_by = NULL
          WHERE id = ?`, REMOVED_REASON, id);
      try {
        db.run("UPDATE memories SET occurred_on = NULL, said_by = NULL, status = NULL WHERE id = ?", id);
      } catch {}
      if (!noop) {
        db.run(`INSERT INTO removal_tombstone
             (memory_id, type, kind, band, protected, promoted_identity, superseded_by,
              versions, edges, prospective, gate_rows, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, row.type, row.kind, row.band, row.protected, row.promoted_identity, row.superseded_by, versions, edges, prospective, gateRows, Date.now());
      }
    }
    const note = { memoryId: id, stage: "chased", actor: "owner" };
    store.appendRemovalRecord(note);
    return {
      id,
      removed: [
        { surface: "operational.edges", count: edges },
        { surface: "operational.prospective", count: prospective },
        { surface: "operational.gate_session", count: gateRows }
      ],
      neutralized: [
        { surface: "operational.memories", count: row === undefined ? 0 : 1 },
        { surface: "operational.versions", count: versions },
        ...journals > 0 ? [{ surface: "operational.dreams", count: journals }] : [],
        ...reflections > 0 ? [{ surface: "operational.reflections", count: reflections }] : [],
        ...pairsGone > 0 ? [{ surface: "operational.contradictions", count: pairsGone }] : [],
        ...restoredFade + unarchived.length > 0 ? [{ surface: "operational.contradictions.restored", count: restoredFade + unarchived.length }] : []
      ],
      survives: ["removal_record", "deny-list", "removal_tombstone", ...cardLinks > 0 ? ["meta.removal.card"] : []],
      noop
    };
  });
  for (const back of unarchived)
    access.reindexLexical(back);
  return report;
}
const REDACTED_JOURNAL_TITLE = "(redacted)";
const REDACTED_JOURNAL = "[This dream's journal was redacted: it was shown, changed or quoted a memory the owner removed.]";
function wordsOf(text) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
}
function quotes(body, journal, window = 6) {
  const b = wordsOf(body);
  const j = wordsOf(journal);
  if (b.length < window || j.length < window)
    return false;
  const seen = new Set;
  for (let i = 0;i + window <= j.length; i += 1)
    seen.add(j.slice(i, i + window).join(" "));
  for (let i = 0;i + window <= b.length; i += 1)
    if (seen.has(b.slice(i, i + window).join(" ")))
      return true;
  return false;
}
function redactDreamJournals(db, id, title, body) {
  const dreams = db.all("SELECT id, shown, title, journal FROM dreams WHERE journal IS NOT NULL OR title IS NOT NULL");
  const changed = new Set(db.all("SELECT DISTINCT dream_id FROM dream_changes WHERE ref = ? OR ref2 = ?", id, id).map((r) => r.dream_id));
  const named = title !== null && title.trim().length >= 8 ? title.trim().toLowerCase() : null;
  let n = 0;
  for (const d of dreams) {
    if (d.journal === REDACTED_JOURNAL)
      continue;
    let shown = false;
    try {
      const ids = JSON.parse(d.shown);
      shown = Array.isArray(ids) && ids.includes(id);
    } catch {
      shown = false;
    }
    const text = `${d.title ?? ""}
${d.journal ?? ""}`;
    const quoted = quotes(body, text) || named !== null && text.toLowerCase().includes(named);
    if (!shown && !changed.has(d.id) && !quoted)
      continue;
    db.run("UPDATE dreams SET title = ?, journal = ? WHERE id = ?", REDACTED_JOURNAL_TITLE, REDACTED_JOURNAL, d.id);
    n += 1;
  }
  return n;
}
const REDACTED_REFLECTION = "[This reflection was redacted: it was shown, cited or quoted a memory the owner removed.]";
function without(json, id) {
  try {
    const ids = JSON.parse(json);
    if (!Array.isArray(ids))
      return { json, had: false };
    const kept = ids.filter((x) => x !== id);
    return { json: JSON.stringify(kept), had: kept.length !== ids.length };
  } catch {
    return { json, had: false };
  }
}
function redactReflections(db, id, title, body) {
  const rows = db.all("SELECT id, shown, cites, share_cites, entry, entry_id, share, share_state FROM reflections");
  const named = title !== null && title.trim().length >= 8 ? title.trim().toLowerCase() : null;
  let n = 0;
  for (const r of rows) {
    const shown = without(r.shown, id);
    const cites = without(r.cites, id);
    const shareCites = without(r.share_cites, id);
    const text = `${r.entry ?? ""}
${r.share ?? ""}`;
    const quoted = r.entry !== REDACTED_REFLECTION && (quotes(body, text) || named !== null && text.toLowerCase().includes(named));
    if (!shown.had && !cites.had && !shareCites.had && !quoted)
      continue;
    db.run(`UPDATE reflections
          SET entry = ?, share = ?, share_state = CASE WHEN share_state IN ('offered', 'carried') THEN 'none' ELSE share_state END,
              shown = ?, cites = ?, share_cites = ?
        WHERE id = ?`, r.entry === null ? null : REDACTED_REFLECTION, r.share === null ? null : REDACTED_REFLECTION, shown.json, cites.json, shareCites.json, r.id);
    if (r.entry_id !== null && r.entry_id !== id)
      redactEntryMemory(db, r.entry_id, id);
    n += 1;
  }
  return n;
}
const REDACTED_ENTRY_TITLE = "Reflected: [redacted]";
function redactEntryMemory(db, entryId, removedId) {
  const row = db.get("SELECT meta, body FROM memories WHERE id = ?", entryId);
  if (row === undefined || row.body === "")
    return;
  let meta = {};
  try {
    meta = JSON.parse(row.meta);
  } catch {
    meta = {};
  }
  if (Array.isArray(meta["cites"]))
    meta["cites"] = meta["cites"].filter((x) => x !== removedId);
  db.run("UPDATE memories SET title = ?, body = ?, content_hash = ?, meta = ? WHERE id = ?", REDACTED_ENTRY_TITLE, REDACTED_REFLECTION, hashText(REDACTED_REFLECTION), JSON.stringify(meta), entryId);
  db.run("UPDATE versions SET title = NULL, body = ?, content_hash = ?, meta = '{}' WHERE memory_id = ?", REDACTED_REFLECTION, hashText(REDACTED_REFLECTION), entryId);
  try {
    db.run("DELETE FROM memory_subjects WHERE memory_id = ?", entryId);
  } catch {}
}
export const MERGED_ARCHIVE_REASON = "merged";
export const UNMERGE_EVENT = "memory.unmerged";
export function unarchiveMerged(store, id) {
  const access = GRANTS.get(store);
  if (access === undefined) {
    throw new StoreError("OWNER_OP_UNGRANTED", { id, site: "unarchiveMerged" });
  }
  if (access.isDenied(id))
    throw new StoreError("REMOVED", { id, by: "owner" });
  const row = access.rawRow(id);
  if (row === undefined)
    throw new StoreError("ID_UNKNOWN", { id });
  if (row.superseded_by !== null) {
    throw new StoreError("UNMERGE_SUPERSEDED", { id, successor: row.superseded_by });
  }
  if (row.archived === 1 && row.archived_reason !== MERGED_ARCHIVE_REASON) {
    throw new StoreError("UNMERGE_NOT_A_MERGE", { id, reason: row.archived_reason });
  }
  const report = access.ownerMutate("unarchiveMerged", (db) => {
    const noop = row.archived === 0;
    const merge = db.get(`SELECT day, payload FROM events
        WHERE name = 'memory.merged' AND ref = ?
        ORDER BY seq DESC LIMIT 1`, id);
    const payload = readMergePayload(merge?.payload ?? null);
    const record = {
      event: UNMERGE_EVENT,
      day: store.livedDay(),
      candidateId: id,
      originalId: payload.originalId,
      mergedOnDay: merge?.day ?? null,
      usesDelta: payload.usesDelta
    };
    if (noop)
      return { id, record, noop };
    db.run("UPDATE memories SET archived = 0, archived_reason = NULL, updated_at = ? WHERE id = ?", store.now(), id);
    store.appendEvent({
      name: UNMERGE_EVENT,
      day: record.day,
      ref: id,
      dedupKey: `${UNMERGE_EVENT}:${id}`,
      payload: { ...record }
    });
    return { id, record, noop };
  });
  if (!report.noop)
    access.reindexLexical(id);
  return report;
}
function readMergePayload(raw) {
  if (raw === null)
    return { originalId: null, usesDelta: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      originalId: typeof parsed["originalId"] === "string" ? parsed["originalId"] : null,
      usesDelta: typeof parsed["usesDelta"] === "number" ? parsed["usesDelta"] : null
    };
  } catch {
    return { originalId: null, usesDelta: null };
  }
}
