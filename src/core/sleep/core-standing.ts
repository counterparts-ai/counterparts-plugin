/**
 * THE CORE WEIGHS ITSELF, AND NOTHING LEAVES IT SILENTLY (2026-10-11, Group 3
 * part A; item 14, review 08 C2 and C4 — C4's automatic demotion dropped).
 *
 * A core memory is FLAGGED "being reconsidered" — a `core_events` row,
 * `reconsidering`, with a reason category — when the consolidate phase finds
 *
 *   - it is no longer one the core is for (`consolidate.ts#identityBlock`: not
 *     marked me or us, not a core kind, or a plan) — the members the narrowed
 *     test of 2026-10-11 moves out, among them; or
 *   - it has not recurred for `CORE_QUIET_DAYS` lived days (itself or its
 *     slot: used awake, cited by a reflection, re-encoded), counted from its
 *     last recurrence, its promotion or its last reaffirmation.
 *
 * A flagged memory STAYS in the core, decay-exempt, shown "being reconsidered"
 * in the wake's "Still open" and on the dashboard, and handed to the
 * reflection. Only a DECISION moves it: mine (awake, `remember`'s `core`; or a
 * reflection's `core` part) or the owner's (`counterparts core --demote` /
 * `--reaffirm`). Either of us may also retire a core memory that was never
 * flagged. A flag whose cause has gone — re-marked me or us, or it recurred —
 * is lifted by the next consolidation (`reaffirmed`, actor `sleep`). No
 * column: actions and reasons are TEXT values of `core_events` (v8).
 */

import { band } from "../physics/index.js";
import type { Store } from "../store/index.js";
import type { MemoryRow } from "../store/operational.js";
import { coreRecurrence, identityBlock } from "./consolidate.js";
import type { ReadsCoreContext } from "./consolidate.js";
import { TUNABLES } from "./tunables.js";
import type { SleepStore } from "./types.js";

/** Why a core memory is being reconsidered: the identity test's three parts, and quiet. */
export const CORE_RECONSIDER_REASONS = ["not-about-me-or-us", "not-a-core-kind", "a-plan", "no-recurrence"] as const;
export type CoreReconsiderReason = (typeof CORE_RECONSIDER_REASONS)[number];

/** The plain words for a reason category: the wake, the dashboard and the reflection say these. */
export function reconsiderWords(reason: string | null): string {
  switch (reason) {
    case "not-about-me-or-us":
      return "it is not marked about me or about us";
    case "not-a-core-kind":
      return "it is a fact, a skill or a place, not who I am";
    case "a-plan":
      return "it is a plan (planned, proposed or asked), not who I am";
    case "no-recurrence":
      return `it has not come back in ${String(TUNABLES.CORE_QUIET_DAYS)} lived days`;
    default:
      return "it was flagged for a decision";
  }
}

/** What one consolidation decides about one core memory: flag it, lift its flag, or nothing. */
export type CoreWeighing =
  | { readonly action: "reconsidering"; readonly reason: CoreReconsiderReason }
  | { readonly action: "reaffirmed"; readonly reason: "cause-gone" }
  | null;

/** What `weighCore` reads. */
export type ReadsCoreStanding = ReadsCoreContext & Pick<SleepStore, "coreStanding" | "coreEvents">;

/**
 * DOES A KEEP STAND? — a decision (`reaffirmed` by the owner, by me or by a
 * reflection; not sleep's own lift) since the memory last came into the core
 * or left it. Read off the whole history, not the latest row: sleep lifting a
 * later quiet flag writes its own `reaffirmed`, and that must not erase the
 * keep (review of #430). A port without the history reads the latest row.
 */
function keptByDecision(store: ReadsCoreStanding, id: string, standing: { action: string; actor: string | null } | undefined): boolean {
  if (store.coreEvents === undefined) return standing?.action === "reaffirmed" && standing.actor !== "sleep";
  try {
    for (const e of store.coreEvents({ memoryId: id, limit: 200 })) {
      if (e.action === "promoted" || e.action === "demoted") return false;
      if (e.action === "reaffirmed" && e.actor !== "sleep") return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * WEIGH ONE CORE MEMORY (2026-10-11). Reads only; the phase writes what it
 * returns. A memory the owner or I chose to KEEP (`reaffirmed` by a decision)
 * is not flagged again for what it is — he or I already answered — only for
 * going quiet after the keep. Never demotes.
 */
export function weighCore(store: ReadsCoreStanding, row: Pick<MemoryRow, "id" | "kind" | "birth_day" | "band_day"> & { about?: string | null; status?: string | null }, day: number): CoreWeighing {
  const standing = store.coreStanding?.(row.id);
  const flagged = standing?.action === "reconsidering";
  // A member nobody marked is not flagged for its mark: it came in by
  // recognition (the fast lane's door for unmarked memories) or before marks.
  const block = identityBlock(store, row, { unmarkedPasses: true });
  const rec = coreRecurrence(store, row.id, day);
  if (flagged) {
    const reason = standing.reason;
    if (reason === "no-recurrence") return rec.lastEver !== null && rec.lastEver > standing.day ? { action: "reaffirmed", reason: "cause-gone" } : null;
    // An identity flag lifts when the memory is one the core is for again (re-marked me or us).
    return block === null ? { action: "reaffirmed", reason: "cause-gone" } : null;
  }
  const kept = keptByDecision(store, row.id, standing);
  if (block !== null && !kept) return { action: "reconsidering", reason: block };
  // QUIET: from the latest of its last recurrence, its promotion or keep, its band day.
  const since = Math.max(rec.lastEver ?? -Infinity, standing !== undefined && standing.action !== "demoted" ? standing.day : -Infinity, row.band_day, row.birth_day);
  if (day - since >= TUNABLES.CORE_QUIET_DAYS) return { action: "reconsidering", reason: "no-recurrence" };
  return null;
}

export type CoreDecisionActor = "owner" | "self" | "reflection";

export type CoreDecision = { ok: true; reason: "kept" | "demoted" } | { ok: false; reason: "observer" | "reason-required" | "unknown-id" | "not-core" };

/**
 * KEEP A CORE MEMORY (2026-10-11): a decision — the owner's, mine awake, or a
 * reflection's — that it stays. Written `reaffirmed` with the why; a flag on
 * it is lifted, and it is not flagged again for what it is. Refuses under
 * observer, without a why, or for a memory not in the core.
 */
export function keepCore(store: Store, input: { id: string; why: string; actor: CoreDecisionActor; day?: number; dreamId?: string | null }): CoreDecision {
  if (store.observer) return { ok: false, reason: "observer" };
  const why = input.why.trim();
  if (why.length === 0) return { ok: false, reason: "reason-required" };
  const row = store.row(input.id);
  if (row === undefined) return { ok: false, reason: "unknown-id" };
  if (row.promoted_identity !== 1) return { ok: false, reason: "not-core" };
  const day = input.day ?? store.livedDay();
  store.appendCoreEvent({ memoryId: input.id, action: "reaffirmed", day, reason: why, actor: input.actor, dreamId: input.dreamId ?? null });
  store.appendEvent({ name: "band.core.kept", day, ref: input.id, payload: { day, actor: input.actor } });
  return { ok: true, reason: "kept" };
}

/**
 * THE DEMOTE DOOR (owner decision 2026-09-26; mine too since 2026-10-11): send
 * a core memory back to ordinary fading, and record why. Its fading restarts
 * TODAY — it was held at full strength until now, and "back to normal fading"
 * should not mean a collapse to whatever months of decay would have left. The
 * demotion is sticky: the core lanes do not promote it again (`coreDemoted`).
 * The row says who and why; a `band.demoted` event is the durable crossing
 * record, the mirror of `band.promoted`.
 */
export function retireCore(store: Store, input: { id: string; reason: string; actor: CoreDecisionActor; day?: number; dreamId?: string | null }): CoreDecision {
  if (store.observer) return { ok: false, reason: "observer" };
  const reason = input.reason.trim();
  if (reason.length === 0) return { ok: false, reason: "reason-required" };
  const row = store.row(input.id);
  if (row === undefined) return { ok: false, reason: "unknown-id" };
  if (row.promoted_identity !== 1) return { ok: false, reason: "not-core" };
  const day = input.day ?? store.livedDay();
  store.appendCoreEvent({ memoryId: input.id, action: "demoted", day, reason, actor: input.actor, dreamId: input.dreamId ?? null });
  store.updatePhysics(input.id, { promotedIdentity: false, lastUsedDay: Math.max(row.last_used_day, day) });
  const after = store.physicsOf(input.id);
  store.setBand(input.id, band(after, day), day);
  store.appendEvent({ name: "band.demoted", day, ref: input.id, payload: { kind: row.kind, day, actor: input.actor } });
  return { ok: true, reason: "demoted" };
}
