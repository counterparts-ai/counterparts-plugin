/**
 * ONE CYCLE AT A TIME, PER STORE (2026-10-21, the card twins' root fix).
 *
 * A closing session fires Stop and then SessionEnd, and each spawns a worker
 * that runs the cycle. Both workers are kept: each carries the Hebbian flush,
 * and SessionEnd covers a close with no final Stop. But the two cycles ran side
 * by side ~94 ms apart, and the markers could not keep them apart: a phase
 * reads "due", works, and only then advances its marker, so a slow phase
 * (births, ~1.5 s on the corpus) ran twice — 40 names got two cards, and the
 * briefing rendered twice. Two sessions closing together do the same.
 *
 * So the cycle takes a LEASE before its first phase: one meta row in box 2,
 * `{ owner, pid, at, until }`, taken in one `BEGIN IMMEDIATE` read-change-write
 * (`Store#updateMeta`). A second cycle finds it held and stands aside at once —
 * no waiting on the holder, no retry; the write lock it takes to look is one
 * statement long. The holder gives it back after its last phase, only if it is
 * still its own.
 *
 * A HOLDER THAT DIED leaves the row behind. It is taken over at once when its
 * pid names no process, and in any case once `until` has passed
 * (`TUNABLES.CYCLE_LEASE_MS`); a row taken "in the future" or running out
 * further ahead than a lease lasts is a clock that jumped backward, and is
 * taken over too (`leaseStale`). The markers then do what they always did: the
 * phases the dead cycle finished are done, the one it died in is due.
 *
 * A HOLDER THAT IS WEDGED, not dead, is the case a lease alone gets wrong: the
 * reclaimer would run beside it. The watchdog's kill cannot be relied on for
 * it (a detached worker's spawn timeout lives in the hook that exited; its own
 * timer cannot fire while it is stuck in synchronous work). So the lease is
 * FENCED: the cycle reads the row again before every phase, and its release
 * after the last phase is its last check; the moment it is no longer the owner
 * it stops — `CycleLeaseLost` — and reports that it stood aside part-way. A
 * wedged cycle can finish at most the one phase it was stuck in.
 *
 * An observer takes no lease: it writes nothing, and a lease is a write.
 */

import { TUNABLES } from "./tunables.js";
import type { CycleStep, Phase } from "./types.js";
import { CycleKilled } from "./types.js";

/** The meta row. One per store. */
export const CYCLE_LEASE_KEY = "sleep.lease";

export interface CycleLease {
  readonly owner: string;
  readonly pid: number | null;
  /** When it was taken, ms. */
  readonly at: number;
  /** When it may be reclaimed, ms. */
  readonly until: number;
}

/** The store as the lease needs it: the one transactional meta write. */
export interface LeaseStore {
  getMeta(key: string): string | undefined;
  updateMeta(key: string, fn: (current: string | undefined) => string | null | undefined): string | null | undefined;
}

/** The row, or null when it is absent or unreadable (unreadable is reclaimable: forward-safe). */
export function readLease(raw: string | undefined): CycleLease | null {
  if (raw === undefined) return null;
  try {
    const v = JSON.parse(raw) as Partial<CycleLease>;
    if (typeof v.owner !== "string" || typeof v.at !== "number" || typeof v.until !== "number") return null;
    if (!Number.isFinite(v.at) || !Number.isFinite(v.until)) return null;
    return { owner: v.owner, pid: typeof v.pid === "number" ? v.pid : null, at: v.at, until: v.until };
  } catch {
    return null;
  }
}

/** Why a row another owner wrote no longer holds the store. */
export type LeaseStale = "expired" | "holder-dead" | "taken-in-the-future" | "until-too-far";

/**
 * Whether `pid` names a live process on this machine. `kill(pid, 0)` sends
 * nothing: it fails with ESRCH when there is no such process, and with EPERM
 * when there is one this user may not signal (alive). Anything else reads as
 * alive — the direction that stands aside rather than runs two cycles.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code !== "ESRCH";
  }
}

/**
 * WHETHER ANOTHER OWNER'S ROW STILL HOLDS THE STORE, and if not, why. Null:
 * it holds. Any one of these is enough (review of #581):
 *   - `until` has passed: the lease ran out;
 *   - it was taken in the future, or runs out further ahead than a lease
 *     lasts: the clock jumped backward since, which would otherwise stall every
 *     cycle for the size of the jump (and a frozen clock in a tool can only
 *     leave a row like this behind);
 *   - its pid names no process: the holder died, and there is nothing to wait
 *     out.
 * A live holder misjudged by the clock rules is stopped by the fence before
 * its next phase, so two cycles still never run at once.
 */
export function leaseStale(
  held: CycleLease,
  now: number,
  opts: { leaseMs?: number; alive?: (pid: number) => boolean } = {},
): LeaseStale | null {
  const leaseMs = opts.leaseMs ?? TUNABLES.CYCLE_LEASE_MS;
  if (held.until <= now) return "expired";
  if (held.at > now) return "taken-in-the-future";
  if (held.until - now > leaseMs) return "until-too-far";
  if (held.pid !== null && !(opts.alive ?? pidAlive)(held.pid)) return "holder-dead";
  return null;
}

export type LeaseTake =
  | {
      readonly taken: true;
      readonly lease: CycleLease;
      /** The other owner's row this take replaced, and why it no longer held. */
      readonly reclaimed: CycleLease | null;
      readonly why: LeaseStale | null;
      readonly torn: boolean;
    }
  | { readonly taken: false; readonly holder: CycleLease };

/**
 * Take the lease, in one transaction: free, unreadable or stale (`leaseStale`)
 * ⇒ ours; held by another owner that still holds it ⇒ not taken, and who.
 * Never waits on the holder.
 */
export function takeLease(
  store: LeaseStore,
  opts: { owner: string; now: number; pid?: number | null; leaseMs?: number; alive?: (pid: number) => boolean },
): LeaseTake {
  const leaseMs = opts.leaseMs ?? TUNABLES.CYCLE_LEASE_MS;
  const box: { out?: LeaseTake } = {};
  store.updateMeta(CYCLE_LEASE_KEY, (current) => {
    const held = readLease(current);
    const other = held !== null && held.owner !== opts.owner ? held : null;
    const why = other === null ? null : leaseStale(other, opts.now, { leaseMs, ...(opts.alive === undefined ? {} : { alive: opts.alive }) });
    if (other !== null && why === null) {
      box.out = { taken: false, holder: other };
      return undefined;
    }
    const lease: CycleLease = { owner: opts.owner, pid: opts.pid ?? null, at: opts.now, until: opts.now + leaseMs };
    box.out = { taken: true, lease, reclaimed: other, why, torn: current !== undefined && held === null };
    return JSON.stringify(lease);
  });
  if (box.out === undefined) throw new Error("takeLease: updateMeta did not call back");
  return box.out;
}

/** Whether `owner` still holds the row — the fence, one read. */
export function holdsLease(store: Pick<LeaseStore, "getMeta">, owner: string): boolean {
  return readLease(store.getMeta(CYCLE_LEASE_KEY))?.owner === owner;
}

/** Give it back, only if it is still ours: a reclaimer's row is never deleted. False: it was not ours. */
export function releaseLease(store: LeaseStore, owner: string): boolean {
  const box = { released: false };
  store.updateMeta(CYCLE_LEASE_KEY, (current) => {
    if (readLease(current)?.owner !== owner) return undefined;
    box.released = true;
    return null;
  });
  return box.released;
}

/**
 * The fence's stop: this cycle's lease was taken over while it ran. A
 * `CycleKilled`, so it leaves the phases exactly where they stopped; `runCycle`
 * catches it and returns the cycle as one that stood aside part-way
 * (`CycleReport.held.lostAt`), not as one that died: another cycle holds the
 * store, and the night is that cycle's.
 */
export class CycleLeaseLost extends CycleKilled {
  readonly holder: CycleLease | null;

  constructor(phase: Phase, holder: CycleLease | null, stage: CycleStep["stage"] = "start") {
    super({ phase, stage });
    this.name = "CycleLeaseLost";
    this.message = `CYCLE_LEASE_LOST ${phase}/${stage}`;
    this.holder = holder;
  }
}
