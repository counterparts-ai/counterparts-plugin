export const TUNABLES = {
  MIN_CLAIM_BYTES: 200,
  STALE_CLAIM_MS: 10 * 60000,
  CONSUMED_LEDGER_MAX: 2000,
  CRASH_STALE_MS: 12 * 60 * 60000,
  CHUNK_BYTES: 12000,
  MAX_SPAN_FAILURES: 3,
  UPDATES_FLOOR: 0.55,
  UPDATES_MARGIN: 0.1,
  UPDATES_CANDIDATES: 8,
  SWEEP_WAKE_BYTES: null,
  RETENTION_MS: 3 * 24 * 60 * 60000,
  RETENTION_MAX_MS: 14 * 24 * 60 * 60000
};
export function validateWatchdog(timeoutMs, staleClaimMs = TUNABLES.STALE_CLAIM_MS) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { ok: false, reason: "TIMEOUT_NOT_FINITE" };
  }
  if (timeoutMs >= staleClaimMs)
    return { ok: false, reason: "TIMEOUT_EXCEEDS_STALENESS" };
  return { ok: true, reason: "OK" };
}
