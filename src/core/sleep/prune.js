import { pressureAt, pruneVerdict, supersededResolvable } from "../physics/index.js";
import { recurrenceOfRow } from "../store/index.js";
import { rowToPhysics } from "../store/operational.js";
import { PRUNE_ARCHIVE_REASON, PRUNE_RECORD_PREFIX } from "./tunables.js";
import { countSkip, emptyOutcome, isEntityCard, isJournal, isJournalCopy, isLiveHandoffRow, isSelfPageRow } from "./types.js";
import { readCursor, resumeIndex, writeCursor } from "./markers.js";
const PRUNE_PHASE = "prune";
export function pruneRecordKey(id) {
  return `${PRUNE_RECORD_PREFIX}${id}`;
}
export function inLiveRevisionChain(store, id, row, physics, day) {
  if (row.superseded_by !== null)
    return true;
  if (pressureAt(physics, day) > 0)
    return true;
  return store.versions(id).some((v) => v.successor_id !== null && supersededResolvable(v.version_day, day));
}
export function runPrune(ctx) {
  const out = emptyOutcome();
  out.skipped["archived"] = 0;
  out.skipped["removed"] = 0;
  out.skipped["journal"] = 0;
  out.skipped["entity-card"] = 0;
  out.skipped["journal-copy"] = 0;
  out.skipped["handoff-live"] = 0;
  out.skipped["self-page"] = 0;
  const blocked = {};
  const pruned = [];
  const recordFailures = [];
  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const ids = store.list();
  const start = resumeIndex(ids, readCursor(store, PRUNE_PHASE));
  const order = start === 0 ? ids : [...ids.slice(start), ...ids.slice(0, start)];
  let stoppedAt = null;
  let index = 0;
  for (const id of order) {
    if (out.examined >= ctx.budget) {
      out.budgetExhausted = true;
      out.skippedForBudget = ids.length - index;
      break;
    }
    index += 1;
    stoppedAt = id;
    const row = store.row(id);
    if (row === undefined)
      continue;
    if (denied.has(id)) {
      countSkip(out, "removed");
      continue;
    }
    if (row.archived === 1) {
      countSkip(out, "archived");
      continue;
    }
    if (isJournal(row)) {
      countSkip(out, "journal");
      continue;
    }
    if (isJournalCopy(row)) {
      countSkip(out, "journal-copy");
      continue;
    }
    if (isLiveHandoffRow(row, day)) {
      countSkip(out, "handoff-live");
      continue;
    }
    if (isSelfPageRow(row)) {
      countSkip(out, "self-page");
      continue;
    }
    if (isEntityCard(row)) {
      countSkip(out, "entity-card");
      continue;
    }
    out.examined += 1;
    const p = rowToPhysics(row);
    const verdict = pruneVerdict(p, day, {
      inLiveRevisionChain: inLiveRevisionChain(store, id, row, p, day),
      recurring: recurrenceOfRow(row) !== null
    });
    if (!verdict.prune || verdict.record === null) {
      for (const reason of verdict.blockedBy) {
        blocked[reason] = (blocked[reason] ?? 0) + 1;
        countSkip(out, `blocked:${reason}`);
      }
      continue;
    }
    if (ctx.apply) {
      try {
        store.setMeta(pruneRecordKey(id), JSON.stringify(verdict.record));
        store.appendEvent?.({
          name: verdict.record.event,
          day,
          ref: id,
          dedupKey: pruneRecordKey(id),
          payload: { ...verdict.record }
        });
      } catch (err) {
        const code = errorCode(err);
        recordFailures.push({ id, error: code });
        countSkip(out, "record-append-failed");
        ctx.event("sleep.prune.record-failed", id, { error: code });
        continue;
      }
      store.archive(id, PRUNE_ARCHIVE_REASON);
    }
    pruned.push({ id, record: verdict.record });
    out.changed += 1;
    ctx.event("sleep.pruned", id, {
      kind: verdict.record.kind,
      band: verdict.record.band,
      strength: verdict.record.strength,
      uses: verdict.record.uses,
      dwellDays: verdict.dwellDays,
      day
    });
    ctx.step("item", { index, id });
  }
  if (ctx.apply && stoppedAt !== null)
    writeCursor(store, PRUNE_PHASE, stoppedAt);
  return { ...out, pruned, blocked, recordFailures };
}
function errorCode(err) {
  if (err !== null && typeof err === "object" && "code" in err) {
    return String(err.code);
  }
  return err instanceof Error ? err.name : "UNKNOWN";
}
