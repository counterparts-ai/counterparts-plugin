export const TUNABLES = {
  CONSOLIDATION_EVERY_DAYS: 3,
  CORE_MAX_PER_SLEEP: 3,
  CORE_QUIET_DAYS: 60,
  DECAY_QUANTUM: 0.0001,
  BUDGETS: {
    clock: 1,
    decay: 20000,
    consolidate: 5000,
    prune: 1000,
    fade: 5000,
    births: 10,
    dedup: 1000,
    versions: 1,
    briefing: 1,
    log: 5000
  },
  CADENCE: {
    clock: 1,
    decay: 1,
    consolidate: 3,
    prune: 1,
    fade: 3,
    births: 1,
    dedup: 1,
    versions: 1,
    briefing: 1,
    log: 1
  }
};
export const MARKER_UNSET = -1;
export const MARKER_PREFIX = "sleep.marker.";
export const CURSOR_PREFIX = "sleep.cursor.";
export const PRUNE_RECORD_PREFIX = "sleep.pruned.";
export const PROMOTION_RECORD_PREFIX = "sleep.promoted.";
export const MERGE_RECORD_PREFIX = "sleep.merged.";
export const PRUNE_ARCHIVE_REASON = "pruned";
export const MERGE_ARCHIVE_REASON = "merged";
export const ACCOMMODATION_SOURCE = "accommodation";
export function validateWatchdog(softMs, hardMs, leaseMs) {
  if (!Number.isFinite(softMs) || softMs <= 0)
    return { ok: false, reason: "SOFT_NOT_FINITE" };
  if (!Number.isFinite(hardMs) || hardMs <= 0)
    return { ok: false, reason: "HARD_NOT_FINITE" };
  if (!Number.isFinite(leaseMs) || leaseMs <= 0)
    return { ok: false, reason: "LEASE_NOT_FINITE" };
  if (softMs >= hardMs)
    return { ok: false, reason: "SOFT_NOT_BEFORE_HARD" };
  if (hardMs >= leaseMs)
    return { ok: false, reason: "HARD_KILL_AFTER_LEASE_RECLAIMABLE" };
  return { ok: true, reason: "OK" };
}
export function shouldSpawn(store) {
  return store.observer ? { spawn: false, reason: "observer" } : { spawn: true, reason: "spawn" };
}
