import { dedupVerdict } from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import { hashText } from "../store/prose.js";
import { ACCOMMODATION_SOURCE, MERGE_ARCHIVE_REASON, MERGE_RECORD_PREFIX } from "./tunables.js";
import { countSkip, emptyOutcome, isJournal, isSchemaRow } from "./types.js";
export function mergeRecordKey(id) {
  return `${MERGE_RECORD_PREFIX}${id}`;
}
export function contentHashCandidates(input) {
  const groups = new Map;
  for (const id of input.liveIds) {
    const row = input.store.row(id);
    if (row === undefined)
      continue;
    let bodyHash;
    try {
      bodyHash = hashText(input.store.read(id).doc.body);
    } catch {
      continue;
    }
    const list = groups.get(bodyHash) ?? [];
    list.push({ id, birthDay: row.birth_day });
    groups.set(bodyHash, list);
  }
  const pairs = [];
  for (const members of groups.values()) {
    if (members.length < 2)
      continue;
    members.sort((a, b) => a.birthDay - b.birthDay || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const original = members[0];
    if (original === undefined)
      continue;
    for (const dup of members.slice(1)) {
      pairs.push({ candidateId: dup.id, originalId: original.id, sameContentHash: true });
    }
  }
  return pairs;
}
export function declaredUpdates(store, id) {
  try {
    const value = store.read(id).doc.meta["updates"];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
export function revisionSuccessorOf(store, id) {
  const row = store.row(id);
  if (row === undefined || row.source !== ACCOMMODATION_SOURCE)
    return null;
  return row.origin_ref;
}
export function revisionSuccessorPair(store, a, b) {
  return revisionSuccessorOf(store, a) === b || revisionSuccessorOf(store, b) === a;
}
export function runDedup(ctx, source) {
  const out = emptyOutcome();
  out.skipped["already-archived"] = 0;
  out.skipped["self-pair"] = 0;
  out.skipped["journal"] = 0;
  out.skipped["schema"] = 0;
  const leftAlone = {};
  const merged = [];
  let degradedToLexical = false;
  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const live = new Set;
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || row.archived === 1 || denied.has(id))
      continue;
    if (isJournal(row)) {
      countSkip(out, "journal");
      continue;
    }
    if (isSchemaRow(row)) {
      countSkip(out, "schema");
      continue;
    }
    live.add(id);
  }
  const liveIds = [...live];
  const input = { store, day, liveIds };
  const pairs = contentHashCandidates(input);
  if (source !== undefined) {
    try {
      pairs.push(...source(input));
    } catch (err) {
      degradedToLexical = true;
      ctx.event("sleep.dedup.degraded", undefined, { error: errorName(err) });
    }
  }
  let index = 0;
  for (const pair of pairs) {
    if (out.examined >= ctx.budget) {
      out.budgetExhausted = true;
      out.skippedForBudget = pairs.length - index;
      break;
    }
    index += 1;
    if (pair.candidateId === pair.originalId) {
      countSkip(out, "self-pair");
      continue;
    }
    if (!live.has(pair.candidateId) || !live.has(pair.originalId)) {
      const kind = excludedKind(store, pair.candidateId) ?? excludedKind(store, pair.originalId);
      countSkip(out, kind ?? "already-archived");
      continue;
    }
    out.examined += 1;
    const verdict = dedupVerdict({
      originalId: pair.originalId,
      declaredUpdates: declaredUpdates(store, pair.candidateId),
      revisionSuccessorPair: revisionSuccessorPair(store, pair.candidateId, pair.originalId) || pair.sameContentHash === true && revisionSuccessorOf(store, pair.candidateId) !== null,
      ...pair.sameContentHash !== undefined ? { sameContentHash: pair.sameContentHash } : {},
      ...pair.cosine !== undefined ? { cosine: pair.cosine } : {}
    });
    if (verdict.verdict !== "merge" || verdict.effect === null) {
      leftAlone[verdict.reason] = (leftAlone[verdict.reason] ?? 0) + 1;
      countSkip(out, `left-alone:${verdict.reason}`);
      continue;
    }
    let credit = "not-applied";
    if (ctx.apply) {
      const originalRow = store.row(pair.originalId);
      if (originalRow === undefined) {
        countSkip(out, "already-archived");
        continue;
      }
      const p = rowToPhysics(originalRow);
      store.updatePhysics(pair.originalId, { uses: p.uses + verdict.effect.usesDelta });
      credit = "uses-only";
    }
    const record = {
      event: "memory.merged",
      day,
      candidateId: pair.candidateId,
      originalId: pair.originalId,
      reason: verdict.reason,
      usesDelta: verdict.effect.usesDelta,
      credit
    };
    if (ctx.apply) {
      store.setMeta(mergeRecordKey(pair.candidateId), JSON.stringify(record));
      store.appendEvent?.({
        name: record.event,
        day,
        ref: pair.candidateId,
        dedupKey: mergeRecordKey(pair.candidateId),
        payload: { ...record }
      });
      store.archive(pair.candidateId, MERGE_ARCHIVE_REASON);
    }
    live.delete(pair.candidateId);
    merged.push(record);
    out.changed += 1;
    ctx.event("sleep.merged", pair.candidateId, {
      original: pair.originalId,
      reason: verdict.reason,
      usesDelta: verdict.effect.usesDelta,
      day
    });
    ctx.step("item", { index, id: pair.candidateId });
  }
  return { ...out, merged, leftAlone, degradedToLexical };
}
function excludedKind(store, id) {
  const row = store.row(id);
  if (row === undefined)
    return null;
  if (isSchemaRow(row))
    return "schema";
  if (isJournal(row))
    return "journal";
  return null;
}
function errorName(err) {
  if (err !== null && typeof err === "object" && "code" in err) {
    return String(err.code);
  }
  return err instanceof Error ? err.name : "UNKNOWN";
}
