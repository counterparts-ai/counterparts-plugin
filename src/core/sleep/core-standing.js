import { band } from "../physics/index.js";
import { coreRecurrence, identityBlock } from "./consolidate.js";
import { TUNABLES } from "./tunables.js";
export const CORE_RECONSIDER_REASONS = ["not-about-me-or-us", "not-a-core-kind", "a-plan", "no-recurrence"];
export function reconsiderWords(reason) {
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
function keptByDecision(store, id, standing) {
  if (store.coreEvents === undefined)
    return standing?.action === "reaffirmed" && standing.actor !== "sleep";
  try {
    for (const e of store.coreEvents({ memoryId: id, limit: 200 })) {
      if (e.action === "promoted" || e.action === "demoted")
        return false;
      if (e.action === "reaffirmed" && e.actor !== "sleep")
        return true;
    }
  } catch {
    return false;
  }
  return false;
}
export function weighCore(store, row, day) {
  const standing = store.coreStanding?.(row.id);
  const flagged = standing?.action === "reconsidering";
  const block = identityBlock(store, row, { unmarkedPasses: true });
  const rec = coreRecurrence(store, row.id, day);
  if (flagged) {
    const reason = standing.reason;
    if (reason === "no-recurrence")
      return rec.lastEver !== null && rec.lastEver > standing.day ? { action: "reaffirmed", reason: "cause-gone" } : null;
    return block === null ? { action: "reaffirmed", reason: "cause-gone" } : null;
  }
  const kept = keptByDecision(store, row.id, standing);
  if (block !== null && !kept)
    return { action: "reconsidering", reason: block };
  const since = Math.max(rec.lastEver ?? -1 / 0, standing !== undefined && standing.action !== "demoted" ? standing.day : -1 / 0, row.band_day, row.birth_day);
  if (day - since >= TUNABLES.CORE_QUIET_DAYS)
    return { action: "reconsidering", reason: "no-recurrence" };
  return null;
}
export function keepCore(store, input) {
  if (store.observer)
    return { ok: false, reason: "observer" };
  const why = input.why.trim();
  if (why.length === 0)
    return { ok: false, reason: "reason-required" };
  const row = store.row(input.id);
  if (row === undefined)
    return { ok: false, reason: "unknown-id" };
  if (row.promoted_identity !== 1)
    return { ok: false, reason: "not-core" };
  const day = input.day ?? store.livedDay();
  store.appendCoreEvent({ memoryId: input.id, action: "reaffirmed", day, reason: why, actor: input.actor, dreamId: input.dreamId ?? null });
  store.appendEvent({ name: "band.core.kept", day, ref: input.id, payload: { day, actor: input.actor } });
  return { ok: true, reason: "kept" };
}
export function retireCore(store, input) {
  if (store.observer)
    return { ok: false, reason: "observer" };
  const reason = input.reason.trim();
  if (reason.length === 0)
    return { ok: false, reason: "reason-required" };
  const row = store.row(input.id);
  if (row === undefined)
    return { ok: false, reason: "unknown-id" };
  if (row.promoted_identity !== 1)
    return { ok: false, reason: "not-core" };
  const day = input.day ?? store.livedDay();
  store.appendCoreEvent({ memoryId: input.id, action: "demoted", day, reason, actor: input.actor, dreamId: input.dreamId ?? null });
  store.updatePhysics(input.id, { promotedIdentity: false, lastUsedDay: Math.max(row.last_used_day, day) });
  const after = store.physicsOf(input.id);
  store.setBand(input.id, band(after, day), day);
  store.appendEvent({ name: "band.demoted", day, ref: input.id, payload: { kind: row.kind, day, actor: input.actor } });
  return { ok: true, reason: "demoted" };
}
