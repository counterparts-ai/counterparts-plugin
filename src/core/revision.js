import { hashText, occurredOnOf, saidByOf, statusOf } from "./store/index.js";
import { TUNABLES, applyChallenge, successorSeed, supersedeRecord } from "./physics/index.js";
import { directionOf } from "./mint.js";
import { DATE_MOVED_TO_META } from "./prospective/index.js";
import { headOf } from "./recall/standing.js";
import { FULFILLED_SOURCE, PRESSURE_UNDONE_REASON, flag, settleOnWrite, supersede } from "./reconsolidation.js";
const NOTHING = {
  moved: false,
  credited: false,
  verdict: "none",
  retargeted: false,
  successorId: null,
  force: 0,
  pressureBefore: 0,
  pressureAfter: 0,
  bar: 0,
  increment: null
};
export const PRESSURE_EVENT = "revision.pressure";
export function applyRevision(store, schemas, input, opts = {}) {
  const declared = input.updates.trim();
  const declaredHash = hashText(declared);
  const settle = (path, reason, targetId, extra = {}) => {
    const out = { ...NOTHING, path, reason, targetId, ...extra };
    const name = out.moved ? "revision.applied" : path === "link-only" ? "revision.linked" : reason === "confirmation-not-a-challenge" ? "revision.confirmed" : "revision.refused";
    opts.onEvent?.(name, {
      path,
      reason,
      target: targetId,
      declaredHash,
      challenger: input.challengerId,
      day: input.day,
      credited: out.credited,
      successor: out.successorId,
      retargeted: out.retargeted
    });
    return out;
  };
  if (store.observer)
    return settle("none", "observer", null);
  if (declared.length === 0)
    return settle("none", "no-declared-target", null);
  let targetId;
  try {
    targetId = store.resolve(declared);
  } catch {
    return settle("none", "target-unresolvable", null);
  }
  targetId = forwardedHead(store, targetId) ?? targetId;
  const retargeted = targetId !== declared;
  const row = store.row(targetId);
  if (row === undefined)
    return settle("none", "target-unresolvable", null, { retargeted });
  if (store.deniedIds().includes(targetId))
    return settle("none", "target-removed", null, { retargeted });
  if (directionOf(input.method) === "confirm") {
    return settle("none", "confirmation-not-a-challenge", targetId, { retargeted });
  }
  if (!store.has(input.challengerId)) {
    return settle("none", "challenger-unknown", targetId, { retargeted });
  }
  const target = store.physicsOf(targetId);
  if (target.protected) {
    return settle("none", "protected-refuses-revision", targetId, { retargeted });
  }
  if (row.archived === 1)
    return settle("none", "target-archived", targetId, { retargeted });
  const element = schemas.element(targetId);
  if (element?.role === "belief") {
    const out = schemas.challengeBelief({
      updates: targetId,
      challengerId: input.challengerId,
      day: input.day,
      ...input.statement === undefined ? {} : { statement: input.statement }
    });
    return settle("belief", out.reason, out.targetId, {
      moved: out.credited || out.successorId !== null,
      credited: out.credited,
      verdict: out.verdict,
      retargeted: retargeted || out.retargeted,
      successorId: out.successorId,
      force: out.force,
      pressureBefore: out.pressureBefore,
      pressureAfter: out.pressureAfter,
      bar: out.bar,
      increment: out.increment
    });
  }
  if (element?.role === "current-state") {
    const out = schemas.replaceCurrentState({
      updates: targetId,
      challengerId: input.challengerId,
      day: input.day,
      ...input.statement === undefined ? {} : { statement: input.statement }
    });
    return settle("current-state", out.reason, out.targetId, {
      moved: out.successorId !== null,
      verdict: out.successorId === null ? "none" : "replace",
      retargeted: retargeted || out.retargeted,
      successorId: out.successorId
    });
  }
  if (schemas.entity(targetId) !== undefined) {
    return settle("link-only", "target-is-an-entity", targetId, { retargeted });
  }
  if (row.type === "memory" && (row.band === "identity" || target.promotedIdentity)) {
    if (input.how !== undefined && input.how !== "open" && fulfilled(store, row, input.challengerId)) {
      return fulfil(store, row, input, settle, retargeted, opts);
    }
    const out = identityChallenge(store, row, input, opts, settle, retargeted);
    if (input.how !== undefined && out.successorId === null && store.has(input.challengerId)) {
      const f = flag(store, { x: row.id, y: input.challengerId, source: "pressure", day: input.day });
      if (f.ok) {
        if (f.created)
          store.markContradictionRaised(f.pair, input.day);
        return { ...out, pressurePair: f.pair };
      }
    }
    return out;
  }
  if (input.how !== undefined && row.type === "memory") {
    const out = settleOnWrite(store, {
      newId: input.challengerId,
      targetId,
      how: input.how,
      actorId: input.session ?? null,
      day: input.day,
      ...input.howSent === undefined ? {} : { howSent: input.howSent },
      ...opts.retarget === undefined ? {} : { retarget: opts.retarget }
    });
    if (out.ok)
      return settle(out.how, "settled", targetId, { moved: true, retargeted, settle: out });
    return settle("link-only", "linked-only", targetId, { retargeted, settle: out });
  }
  return settle("link-only", "linked-only", targetId, { retargeted });
}
function identityChallenge(store, row, input, opts, settle, retargeted) {
  const targetId = row.id;
  const target = store.physicsOf(targetId);
  const challenger = store.physicsOf(input.challengerId);
  const outcome = applyChallenge(targetId, target, {
    id: input.challengerId,
    declaredUpdates: targetId,
    physics: challenger,
    ...input.how === "changed" || input.how === "corrected" ? { floor: TUNABLES.F_DAY_CAP_SLOW } : {}
  }, input.day);
  let increment = null;
  if (outcome.credited) {
    store.updatePhysics(targetId, outcome.next);
    const log = outcome.log;
    if (log !== null) {
      increment = {
        event: PRESSURE_EVENT,
        targetId,
        day: log.day,
        challengerId: log.challengerId,
        force: log.force,
        pressureAfter: log.pressureAfter,
        bar: log.bar
      };
      store.appendEvent({
        name: PRESSURE_EVENT,
        day: log.day,
        ref: targetId,
        dedupKey: `${PRESSURE_EVENT}:${targetId}:${log.day}:${log.challengerId}`,
        payload: {
          targetId,
          day: log.day,
          challengerId: log.challengerId,
          force: log.force,
          pressureAfter: log.pressureAfter,
          bar: log.bar
        }
      });
    }
  }
  let successorId = null;
  let crossed = null;
  if (outcome.verdict === "revise") {
    const statement = (input.statement ?? store.readProse(input.challengerId).body).trim();
    const said = store.row(input.challengerId);
    const occurredOn = occurredOnOf(said?.occurred_on ?? null);
    const saidBy = saidByOf(said?.said_by ?? null);
    const status = statusOf(said?.status ?? null);
    const successor = store.put({
      type: "memory",
      kind: row.kind,
      body: statement,
      ...occurredOn === null ? {} : { occurredOn },
      ...saidBy === null ? {} : { saidBy },
      ...status === null ? {} : { status },
      meta: { revisedFrom: targetId, groundedIn: [input.challengerId] },
      band: row.band,
      salience: challenger.salience,
      physics: {
        birthDay: input.day,
        lastUsedDay: input.day,
        ...successorSeed(store.physicsOf(targetId))
      },
      source: "accommodation",
      origin: { ref: input.challengerId }
    });
    try {
      store.carryInto(targetId, successor, { returns: false });
    } catch {}
    const door = supersede(store, { holds: successor, over: targetId, how: "changed", source: "pressure", actor: "session", actorId: input.session ?? null, day: input.day }, opts.retarget === undefined ? {} : { retarget: opts.retarget });
    if (!door.ok) {
      store.archive(successor, PRESSURE_UNDONE_REASON);
      opts.onEvent?.("revision.door.refused", { target: targetId, successor, day: input.day, reason: door.reason });
    } else {
      crossed = door.pair;
      successorId = successor;
      if (opts.retarget !== undefined) {
        try {
          opts.retarget(targetId, successor, input.day);
        } catch (err) {
          opts.onEvent?.("revision.edges.retarget.failed", { target: targetId, successor, day: input.day, error: err instanceof Error ? err.name : "UNKNOWN" });
        }
      }
      const record = supersedeRecord(targetId, successor, input.day);
      opts.onEvent?.("memory.superseded", {
        target: targetId,
        successor,
        day: record.day,
        resolvableUntilDay: record.resolvableUntilDay
      });
    }
  }
  return settle("identity", outcome.reason, targetId, {
    moved: outcome.credited || successorId !== null,
    credited: outcome.credited,
    verdict: outcome.verdict,
    retargeted,
    successorId,
    force: outcome.force,
    pressureBefore: outcome.pressureBefore,
    pressureAfter: outcome.pressureAfter,
    bar: outcome.bar,
    increment,
    ...crossed === null ? {} : { pressurePair: crossed }
  });
}
const FORWARDING_SOURCES = new Set(["dream-merge", "pressure"]);
function forwardedHead(store, id) {
  try {
    const pairs = store.contradictionsOf([id]).get(id) ?? [];
    const forwarded = pairs.some((p) => p.state === "settled" && p.via === null && p.over === id && FORWARDING_SOURCES.has(p.source));
    return forwarded ? headOf(store, id) : null;
  } catch {
    return null;
  }
}
function fulfilled(store, row, challengerId) {
  const was = statusOf(row.status ?? null);
  let movedHere = false;
  try {
    movedHere = row.event_date === null && store.readProse(row.id).meta[DATE_MOVED_TO_META] === challengerId;
  } catch {
    movedHere = false;
  }
  const holdsAState = was !== null && was !== "done" || row.event_date !== null || movedHere;
  return holdsAState && statusOf(store.row(challengerId)?.status ?? null) === "done";
}
function fulfil(store, row, input, settle, retargeted, opts) {
  const standing = store.contradictionBetween(row.id, input.challengerId);
  const door = supersede(store, {
    holds: input.challengerId,
    over: row.id,
    how: "changed",
    source: FULFILLED_SOURCE,
    actor: "session",
    actorId: input.session ?? null,
    day: input.day,
    ...standing !== undefined && standing.state === "unsettled" ? { pair: standing } : {},
    ...input.howSent === undefined ? {} : { howSent: input.howSent }
  }, opts.retarget === undefined ? {} : { retarget: opts.retarget });
  if (!door.ok)
    return settle("identity", "below-bar", row.id, { retargeted, settle: door });
  return settle("identity", "revised", row.id, { moved: true, verdict: "replace", retargeted, successorId: input.challengerId, settle: door, pressurePair: door.pair });
}
