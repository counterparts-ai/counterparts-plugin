/**
 * THE HOLD: A CHAT'S DELETE, MADE NON-DESTRUCTIVE (HD1, 2026-11-04; Mike's
 * yes 09:16, lightly held; design note 2026-11-03-briefs/HD1-design-note.md).
 *
 * A person can ask Claude to delete one memory. The model may not destroy
 * anything (CLI CONTRACT §1: the erase is the owner's console's, or an
 * owner-side clock's), so what the model's call does is HIDE: it appends
 * `held` to the removal record, and the store's deny-list hides the memory at
 * once from everything that reads it — recall, the wake, footnotes, the night,
 * sleep, reminders. Twenty-four hours of wall-clock time later something no
 * model can call erases it with the console's own removal
 * (`sweepHeldRemovals`, in `adapters/cli/`): hosted's ten-minute timer, or
 * the worker on local. Inside the window `released` undoes it, whole.
 *
 * This file writes only removal-record rows, through `Store.appendRemovalRecord`
 * — the same door the console's removal records through — and reads. It
 * destroys nothing, and imports nothing that does: the caller-universality
 * test in `test/cli.test.ts` still pins who may reach the erase.
 *
 * `removalRefusal` lives here, not in the console's removal module where it was born
 * (2026-09-22), so the model's door and the console's ask the SAME question:
 * an id the hold refuses is one the console refuses, and the other way round,
 * except that a held id is the console's to finish.
 */
import { isSelfPageRow } from "./self/page.js";
import { REMOVAL_HOLD_MS } from "./store/index.js";
import type { Store } from "./store/index.js";

/** Everything a removal (or a hold) can say instead of going ahead. */
export type RemovalRefusal = "unknown-id" | "not-memory-bearing" | "already-removed" | "is-the-self-page";

/** Prose families a removal may target. Everything else is chased, never named. */
const MEMORY_BEARING = new Set(["memory", "episode", "schema"]);

/** The fixed reason a hold records (§16 G9: the record holds no words of the memory, and no model-written why). */
export const HOLD_WHY = "asked in chat";

/**
 * IS THIS ID REMOVABLE AT ALL — step 1 of a removal on its own, and nothing
 * after it. Pure: it writes nothing and takes no lock.
 *
 * Extracted 2026-09-22 for the console's interactive picker; moved here
 * 2026-11-04 (HD1) so the hold asks it too. A HELD id is removable — the hold
 * is the first half of a removal, and the console's `--confirm` or the sweep
 * finishes it — so `already-removed` means taken dark, not held.
 */
export function removalRefusal(store: Store, targetId: string): RemovalRefusal | null {
  const row = store.row(targetId);
  if (row === undefined) return "unknown-id";
  if (!MEMORY_BEARING.has(row.type)) return "not-memory-bearing";
  // Held, or claimed by the sweep that is erasing it: still the removal's to finish.
  if (store.deniedIds().includes(targetId) && store.holdState(targetId) === null) return "already-removed";
  // THE SELF PAGE IS NOT REMOVED, IT IS CLEARED (2026-09-18, S1). Removal
  // tombstones a row and `schemas/` reads every schema row at open; the page
  // has its own door (`self-page --clear`), which keeps it as a version. See
  // the console's removal module for the history of this rule.
  if (isSelfPageRow(store, targetId)) return "is-the-self-page";
  return null;
}

/** What a hold or an undo names the memory by: its title, or its first line. Never more. */
export function heldTitle(doc: { title?: string | null; body: string }): string {
  const t = (doc.title ?? "").trim();
  if (t.length > 0) return t.replace(/\s+/g, " ");
  const first = (doc.body.split("\n").find((l) => l.trim().length > 0) ?? "").trim().replace(/\s+/g, " ");
  const chars = [...first];
  return chars.length <= 80 ? first : `${chars.slice(0, 79).join("").trimEnd()}…`;
}

export type HoldOutcome =
  | {
      readonly ok: true;
      /** `held` now, or `already-held` (a second ask is the first one's answer: idempotent). */
      readonly reason: "held" | "already-held";
      readonly id: string;
      readonly title: string;
      /** When the memory was written, epoch ms. */
      readonly createdAt: number;
      /** When the hold was placed, and when the sweep may erase it (epoch ms). */
      readonly heldAt: number;
      readonly erasableAt: number;
    }
  | { readonly ok: false; readonly reason: RemovalRefusal; readonly id: string };

/**
 * PUT ONE MEMORY ON THE HOLD. Refused for what removal refuses; idempotent on
 * an id already held (the deadline stays the first hold's — a second ask does
 * not buy a second day). Throws only when the record cannot be written, which
 * is the one failure where doing nothing is correct (§16 G10).
 */
export function holdForRemoval(store: Store, id: string, opts: { actor?: string } = {}): HoldOutcome {
  // Any active hold — claimed by the sweep too: a second `held` after a claim
  // would void the claim and open an undo on a memory being erased (R1).
  const already = store.holdState(id);
  const refusal = already === null ? removalRefusal(store, id) : null;
  if (refusal !== null) return { ok: false, reason: refusal, id };
  if (already === null) {
    store.appendRemovalRecord({ memoryId: id, stage: "held", actor: opts.actor ?? "self", reason: HOLD_WHY });
  }
  const hold = store.holdState(id);
  const doc = store.heldProse(id);
  const row = store.row(id);
  const heldAt = hold?.at ?? store.now();
  return {
    ok: true,
    reason: already === null ? "held" : "already-held",
    id,
    title: doc === null ? id : heldTitle(doc),
    createdAt: row?.created_at ?? heldAt,
    heldAt,
    erasableAt: heldAt + REMOVAL_HOLD_MS,
  };
}

export type ReleaseOutcome =
  | { readonly ok: true; readonly reason: "released"; readonly id: string; readonly title: string }
  | { readonly ok: false; readonly reason: "unknown-id" | "not-held" | "already-removed" | "already-erasing"; readonly id: string };

/**
 * UNDO A HOLD before the erase: `released`, and the memory is back as it was —
 * nothing about it was touched while it was held, and the store re-indexes its
 * words. After the erase it is `already-removed`, and nothing brings it back.
 *
 * ATOMIC AGAINST THE SWEEP (fix round R1, 2026-11-04): the "still held, not
 * claimed" check runs inside the same write transaction as the `released` row
 * (`appendRemovalRecord`'s `unless`), and the sweep's claim does the same, so
 * of an undo and an erase that meet, exactly one lands. Once the sweep has
 * claimed it the undo is refused (`already-erasing`): an undo that answers
 * "released" is never erased afterwards.
 */
export function releaseHold(store: Store, id: string, opts: { actor?: string } = {}): ReleaseOutcome {
  if (store.row(id) === undefined && store.removalRecord(id).length === 0) return { ok: false, reason: "unknown-id", id };
  const doc = store.heldProse(id);
  const seq = store.appendRemovalRecord(
    { memoryId: id, stage: "released", actor: opts.actor ?? "self", reason: HOLD_WHY },
    { unless: () => !store.isHeld(id) },
  );
  if (seq === 0) {
    if (store.holdState(id) !== null) return { ok: false, reason: "already-erasing", id };
    return { ok: false, reason: store.deniedIds().includes(id) ? "already-removed" : "not-held", id };
  }
  return { ok: true, reason: "released", id, title: doc === null ? id : heldTitle(doc) };
}

/**
 * HOW LONG A CLAIM STANDS before another sweep may take the hold again (R1,
 * R8): an erase that threw keeps its claim, and the memory stays hidden, so a
 * failure is tried again only after a backoff — an hour after the first
 * claim, doubling per try, at most a day — never every tick. A claim whose
 * process died mid-erase is taken again the same way. An erase runs seconds;
 * an hour is never a live eraser's.
 */
export const CLAIM_LEASE_MS = 60 * 60 * 1000;
export function claimRetryAfter(claims: number): number {
  return Math.min(CLAIM_LEASE_MS * 2 ** Math.max(0, claims - 1), REMOVAL_HOLD_MS);
}

/** When the sweep may next act on one active hold: its window's end, or a failed claim's backoff. */
export function holdNextAt(h: { at: number; claims: number; claimedAt: number | null }): number {
  return h.claims === 0 || h.claimedAt === null ? h.at + REMOVAL_HOLD_MS : h.claimedAt + claimRetryAfter(h.claims);
}

/**
 * THE SWEEP'S CLAIM ON ONE HOLD (R1, fix round 2026-11-04): in ONE write
 * transaction, re-check that the id is still on its hold (not released, not
 * taken dark), that its time has come (`holdNextAt <= now`: the window passed,
 * or a failed claim's backoff), and append `erasing`. True: this caller, and
 * only this caller, erases it now. False: another eraser has it, it was
 * undone, or it is gone — the caller does nothing.
 *
 * `console`: the owner's `--confirm` finishing a hold at once — no window,
 * and only a claim older than `CLAIM_LEASE_MS` stands aside for it.
 */
export function claimHold(store: Store, id: string, now: number, opts: { actor?: string; console?: boolean } = {}): boolean {
  const claimable = (): boolean => {
    const h = store.holdState(id);
    if (h === null) return false;
    if (opts.console === true) return h.claims === 0 || h.claimedAt === null || now - h.claimedAt >= CLAIM_LEASE_MS;
    return holdNextAt(h) <= now;
  };
  return store.appendRemovalRecord(
    { memoryId: id, stage: "erasing", actor: opts.actor ?? "self", reason: HOLD_WHY },
    { unless: () => !claimable(), at: now },
  ) > 0;
}

/** The holds waiting, with their titles and when each may be erased: the `deleted` handle's list. */
export function heldList(store: Store): { id: string; title: string; heldAt: number; erasableAt: number }[] {
  return store.pendingHolds().map((h) => {
    const doc = store.heldProse(h.id);
    return { id: h.id, title: doc === null ? h.id : heldTitle(doc), heldAt: h.at, erasableAt: h.at + REMOVAL_HOLD_MS };
  });
}

/**
 * The holds the sweep may try at `now`, oldest first: the window passed, or a
 * failed claim's backoff did. Only a LIST — each id is claimed again, in its
 * own transaction, right before its erase (`claimHold`); between this read and
 * that claim an undo may land, and then the claim finds nothing.
 */
export function dueHolds(store: Store, now: number): { id: string; at: number; claims: number }[] {
  return store
    .holds()
    .filter((h) => holdNextAt(h) <= now)
    .map((h) => ({ id: h.id, at: h.at, claims: h.claims }));
}

/**
 * HOW LATE AN ERASE MAY RUN BEFORE IT IS SAID OUT LOUD (ROADMAP 11:55): a hold
 * still active this long after its 24 hours is overdue — the sweep never ran
 * (local: no session since), or its erase keeps failing. Doctor names it on
 * local; hosted logs a codes-only line once per hold.
 */
export const REMOVAL_OVERDUE_MS = 48 * 60 * 60 * 1000;

/**
 * Active holds that are OVERDUE at `now`, oldest first: more than
 * `REMOVAL_OVERDUE_MS` past their erase time, or CLAIMED and not finished
 * past the claim's lease (an erase that failed, or whose process died) —
 * a claimed hold has left the `deleted` list and the wake's count, so this is
 * where it is still seen (review of 474db3cf, R1-a). A claim younger than the
 * lease is an erase running now, and is not.
 */
export function overdueHolds(store: Store, now: number): { id: string; at: number; claims: number }[] {
  return store
    .holds()
    .filter(
      (h) =>
        h.at + REMOVAL_HOLD_MS + REMOVAL_OVERDUE_MS <= now ||
        (h.claims > 0 && h.claimedAt !== null && now - h.claimedAt >= CLAIM_LEASE_MS),
    )
    .map((h) => ({ id: h.id, at: h.at, claims: h.claims }));
}

/** Recall's handle for the holds waiting (HD1): each by title, with when it goes, to undo one. */
export const DELETED_HANDLE = "deleted";

/**
 * The wake's count of a chat's deletes still on their hold (HD1): a count,
 * never titles — titles would show again what was asked gone. Null at none.
 * The line both wakes carry: the MCP `wake` and Claude Code's session start.
 */
export function heldWakeLine(n: number): string | null {
  if (n <= 0) return null;
  return `${n === 1 ? "1 memory" : `${String(n)} memories`} deleted in chat ${n === 1 ? "is" : "are"} waiting to be erased: recall "${DELETED_HANDLE}" to see or undo.`;
}
