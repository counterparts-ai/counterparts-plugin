/**
 * The floor prune — and it is ARCHIVAL, not deletion.
 *
 * `physics.pruneVerdict` alone decides. No model on any path holds this power,
 * and this phase adds no criterion of its own: it supplies the one piece of
 * context physics cannot compute (is this memory in a live revision chain?),
 * applies the verdict absolutely, and records it.
 *
 * **The contract's open question 1, resolved toward archival.** `sleep/CONTRACT.md`
 * §4 called the floor prune "the one place the system deletes" and flagged the
 * question as open; v1's §11 G6 said the opposite in as many words. The answer
 * is archival, and the store settles it structurally: there is no delete, no
 * unlink, no remove anywhere in `store/`, so there is no verb to call. A pruned
 * memory keeps its prose, keeps its id, stays resolvable, and carries
 * `archived_reason = "pruned"`. Fading is not deletion — but an archived row is
 * out of every recall path except a lookup by its id (`recall/activate.ts`),
 * so "a strong enough cue can still reach it" was never true of an EXITED row;
 * it is true of one BELOW REACH (physics `REACH`, 2026-10-10), which deliberate
 * recall still finds and a use revives. Two states: below reach (computed,
 * revivable) and exited (archived here, readable by id). The exit is countable
 * (scar §2.17). See NOTES.md §2.
 *
 * **Record first, move second (§5 G8).** The record is counts, kind, and dates —
 * NEVER a body and NEVER a content hash (scar §2.20; hashing low-entropy content
 * leaks it). A failed record append means NOTHING MOVES for that memory: the
 * archive is skipped, the failure is counted with its reason, and the cycle
 * continues.
 */

import { pressureAt, pruneVerdict, supersededResolvable } from "../physics/index.js";
import type { MemoryPhysics, PruneReason } from "../physics/index.js";
import { recurrenceOfRow } from "../store/index.js";
import { rowToPhysics } from "../store/operational.js";
import { PRUNE_ARCHIVE_REASON, PRUNE_RECORD_PREFIX } from "./tunables.js";
import type { MemoryRow, PhaseCtx, PhaseOutcome, PrunedRecord } from "./types.js";
import { countSkip, emptyOutcome, isEntityCard, isJournal, isJournalCopy, isLiveHandoffRow, isSelfPageRow } from "./types.js";
import type { Phase } from "./types.js";
import { readCursor, resumeIndex, writeCursor } from "./markers.js";

/** This phase's own name, for the cursor it keeps (typed: a rename fails `tsc`). */
const PRUNE_PHASE: Phase = "prune";

export interface PruneResult extends PhaseOutcome {
  readonly pruned: readonly PrunedRecord[];
  /** Every blocking gate, counted — physics names all six, not just the first. */
  readonly blocked: Readonly<Record<string, number>>;
  /** Memories left in place because their record could not be written. */
  readonly recordFailures: readonly { id: string; error: string }[];
}

export function pruneRecordKey(id: string): string {
  return `${PRUNE_RECORD_PREFIX}${id}`;
}

/**
 * The one input physics cannot see: is this memory load-bearing in a revision
 * that is still live? Three ways to be, all read from canonical state:
 *
 *   - it has already been superseded (it has a forwarding address);
 *   - a version row still points at a successor within the resolvable horizon H;
 *   - challenge pressure is standing against it right now — an argument in
 *     progress is not a memory to quietly retire.
 */
export function inLiveRevisionChain(
  store: Pick<PhaseCtx["store"], "versions">,
  id: string,
  row: MemoryRow,
  physics: MemoryPhysics,
  day: number,
): boolean {
  if (row.superseded_by !== null) return true;
  if (pressureAt(physics, day) > 0) return true;
  return store
    .versions(id)
    .some((v) => v.successor_id !== null && supersededResolvable(v.version_day, day));
}

export function runPrune(ctx: PhaseCtx): PruneResult {
  const out = emptyOutcome();
  out.skipped["archived"] = 0;
  out.skipped["removed"] = 0;
  out.skipped["journal"] = 0;
  out.skipped["entity-card"] = 0;
  out.skipped["journal-copy"] = 0;
  out.skipped["handoff-live"] = 0;
  out.skipped["self-page"] = 0;
  const blocked: Record<string, number> = {};
  const pruned: PrunedRecord[] = [];
  const recordFailures: { id: string; error: string }[] = [];

  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const ids = store.list();
  // WHERE THE LAST RUN STOPPED (2026-09-28, build B; the audit's #4). `store.list()`
  // is `ORDER BY id` and ids are random, so without a resume point a budget
  // smaller than the store examined the same slice every night and the rest
  // never. Like `consolidate`: this run starts strictly after the cursor and
  // wraps; the cursor moves only under `apply`.
  const start = resumeIndex(ids, readCursor(store, PRUNE_PHASE));
  const order = start === 0 ? ids : [...ids.slice(start), ...ids.slice(0, start)];
  let stoppedAt: string | null = null;

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
    if (row === undefined) continue;
    if (denied.has(id)) {
      countSkip(out, "removed");
      continue;
    }
    // Already archived — including anything this cycle's dedup archived. An
    // archived memory has already exited; it is not pruned a second time.
    if (row.archived === 1) {
      countSkip(out, "archived");
      continue;
    }
    // THE JOURNAL IS NEVER PRUNED. Measured 2026-09-04: 224 migrated episodes
    // at zero on every dimension would have been archived at the floor, and an
    // archived episode stops reconciling — so the memories it had not yet
    // minted would never exist (`types.ts#isJournal`).
    if (isJournal(row)) {
      countSkip(out, "journal");
      continue;
    }
    // NOR IS A CHAPTER'S COPY (2026-10-10, review 03 C4a): recall folds it
    // into its chapter (U13), and at salience 0 it would reach the floor on the
    // first night the 14-day dwell allowed — 71 rows of the live store's first
    // let-go wave would have been copies.
    if (isJournalCopy(row)) {
      countSkip(out, "journal-copy");
      continue;
    }
    // A LIVE HANDOFF is never let go at the floor (2026-10-10, review 03 C4b):
    // it is a schema row at salience 0, born at strength 0, and its own
    // lived-day expiry (`handoff/index.ts#HANDOFF_LIFE_DAYS`) is its clock. A
    // session revising its pointer day after day keeps its birth day, so a
    // 14-day dwell from the last use would take a pointer still being shown.
    // Once expired, it is left to the prune, as the handoff module says.
    if (isLiveHandoffRow(row, day)) {
      countSkip(out, "handoff-live");
      continue;
    }
    // THE SELF PAGE IS NEVER PRUNED (2026-10-10, review of #372): `protected`
    // already blocks the floor; this names it, so a page that ever lost the
    // flag would still be kept.
    if (isSelfPageRow(row)) {
      countSkip(out, "self-page");
      continue;
    }
    // An entity card fades in the next phase, under `schemas/`' gentler verdict
    // (`types.ts#isEntityCard`, NOTES §17) — not here, at physics' floor alone.
    if (isEntityCard(row)) {
      countSkip(out, "entity-card");
      continue;
    }
    out.examined += 1;

    const p = rowToPhysics(row);
    const verdict = pruneVerdict(p, day, {
      inLiveRevisionChain: inLiveRevisionChain(store, id, row, p, day),
      // A reminder date that still repeats (2026-10-09): physics refuses it by
      // name. The meta is the row's, read here because physics cannot see it.
      recurring: recurrenceOfRow(row) !== null,
    });
    if (!verdict.prune || verdict.record === null) {
      // EVERY failing gate, not just the first — physics names all six, and a
      // memory blocked by two reasons that reports one is a memory nobody can
      // explain. Mirrored into the skip map so the cycle report carries them.
      for (const reason of verdict.blockedBy) {
        blocked[reason] = (blocked[reason] ?? 0) + 1;
        countSkip(out, `blocked:${reason}`);
      }
      continue;
    }

    if (ctx.apply) {
      try {
        store.setMeta(pruneRecordKey(id), JSON.stringify(verdict.record));
        // Beside it, never instead of it: the meta row is what §5 G8 gates the
        // move on; the durable event is what makes the record queryable.
        store.appendEvent?.({
          name: verdict.record.event,
          day,
          ref: id,
          dedupKey: pruneRecordKey(id),
          payload: { ...verdict.record },
        });
      } catch (err) {
        // §5 G8: a failed record append means nothing moves.
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
      day,
    });
    ctx.step("item", { index, id });
  }

  if (ctx.apply && stoppedAt !== null) writeCursor(store, PRUNE_PHASE, stoppedAt);
  return { ...out, pruned, blocked, recordFailures };
}

function errorCode(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return err instanceof Error ? err.name : "UNKNOWN";
}

export type { PruneReason };
