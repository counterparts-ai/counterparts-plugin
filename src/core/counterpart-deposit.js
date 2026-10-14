import { batteryGate } from "./bridge.js";
import { mintProposal, UNRESOLVED_META_KEY } from "./mint.js";
import { cueModeOf, recurrenceOf, DATE_LINEAGE_MAX, DATE_MOVED_TO_META } from "./prospective/index.js";
import { errCode, submitProposal } from "./remember/index.js";
import {
  settleMovedReminder,
  expireUnanswerableSlots,
  detectSlot,
  proposeSlot,
  updateRelatedness,
  guardBar,
  heldView,
  CONTRADICTION_HELD_EVENT
} from "./reconsolidation.js";
import { isDay } from "./time.js";
import { markWakeBehind } from "./self/index.js";
import { ownerNames } from "./sleep/index.js";
import { statusOf, inheritFrom, occurredOnOf, saidByOf } from "./store/index.js";
import { GATE_DEPOSIT_EVENT, gateDepositRecord } from "./counterpart-events.js";
function withoutHow(p) {
  const { how: _how, ...rest } = p;
  return rest;
}
function withoutUpdates(p) {
  return { ...withoutHow(p), updates: null };
}
export function recordDeposit(cp, result, ctx, source, mint) {
  if (cp.observer || result.records.length === 0 || result.kind === null)
    return;
  const day = cp.store.livedDay();
  const secrets = result.records.find((r) => r.gate === "secrets");
  const contentHash = secrets !== undefined && secrets.gate === "secrets" ? secrets.contentHash : null;
  try {
    cp.store.appendEvent({
      name: GATE_DEPOSIT_EVENT,
      day,
      ref: contentHash,
      payload: gateDepositRecord(result.records, result.channels, {
        source,
        session: ctx.session,
        scope: ctx.scope,
        day,
        accepted: result.reason !== "GATE_REJECTED",
        memoryId: mint?.id ?? null,
        kind: result.kind,
        blockedBy: result.blockedBy
      })
    });
  } catch (err) {
    cp["emit"]("counterpart.deposit.record.failed", undefined, {
      source,
      accepted: mint !== null,
      error: errCode(err)
    });
  }
}
export async function deposit(cp, draft, source, ctx) {
  const none = (reason, gate = null) => ({
    deposited: false,
    reason,
    memoryId: null,
    proposal: null,
    mint: null,
    gate,
    covers: []
  });
  const result = await submitProposal(cp.spans, draft, {
    session: ctx.session,
    scope: ctx.scope,
    source,
    gate: batteryGate(cp["vectors"]),
    ...ctx.ownSpanHash === undefined ? {} : { ownSpanHash: ctx.ownSpanHash },
    ...ctx.cover === undefined ? {} : { cover: ctx.cover },
    resolveUpdates: (declared, content) => cp["resolveUpdatesFor"](ctx.scope, declared, content)
  });
  if (!result.accepted || result.proposal === null) {
    const reason = result.reason === "OBSERVER" ? "observer" : result.reason === "MALFORMED" ? "malformed" : result.reason === "DUPLICATE_CONTENT" ? "duplicate-content" : result.reason === "GATE_REJECTED" ? "gate-rejected" : result.reason === "GATE_FAILED" ? "gate-failed" : "io-failed";
    cp["emit"]("counterpart.deposit.refused", undefined, {
      source,
      reason,
      gate: result.gate,
      malformed: result.malformed
    });
    cp["recordDeposit"](result, ctx, source, null);
    return { ...none(reason, result.gate), malformed: result.malformed };
  }
  const held = await cp["guardUpdate"](result.proposal, ctx);
  const carry = cp["carryReminder"](held === null ? result.proposal : withoutUpdates(result.proposal), ctx.facts?.status ?? null);
  const facts = cp["carryFacts"](carry.proposal, ctx.facts);
  const proposal = facts === null ? carry.proposal : { ...carry.proposal, facts: { ...facts.occurredOn === null ? {} : { occurredOn: facts.occurredOn }, ...facts.saidBy === null ? {} : { saidBy: facts.saidBy }, ...facts.status === null ? {} : { status: facts.status } } };
  const about = cp["carryAbout"](carry.proposal, ctx.about);
  const mint = mintProposal(cp.store, proposal, {
    self: cp.self,
    channel: "authored",
    ...about !== null ? { about: about.about, inheritedAbout: about } : ctx.about === undefined ? {} : { about: ctx.about },
    ...ctx.model === undefined ? {} : { model: ctx.model },
    ...ctx.writeUp === undefined ? {} : { writeUp: ctx.writeUp },
    onEvent: (name, data) => cp["emit"](name, undefined, data)
  });
  const reminder = carry.from === null ? null : cp["moveReminder"](carry, mint.id);
  const thread = cp["closeThread"](proposal, mint.id, ctx.owner === undefined ? cp["owner"] : ctx.owner && !cp.observer);
  cp["emit"]("counterpart.deposit", mint.id, {
    source,
    kind: proposal.kind,
    covers: proposal.covers.length,
    updates: mint.updates,
    lifted: mint.lifted,
    blind: mint.blind
  });
  cp["recordDeposit"](result, ctx, source, mint);
  cp["creditNamedIn"](proposal.title ?? null, proposal.content, proposal.day, mint.id, source);
  const keepOpen = thread?.refused === "confidential" || thread?.refused === "other-directory";
  const revision = cp["applyDeclaredRevision"](keepOpen ? withoutHow(proposal) : proposal, mint, source, ctx.session);
  if (reminder !== null && reminder.moved && !cp.observer) {
    try {
      settleMovedReminder(cp.store, { remnant: reminder.from, holder: mint.id, actor: "session", actorId: ctx.session, day: proposal.day }, { retarget: cp["retargetLinks"] });
    } catch {}
  }
  if (held !== null)
    cp["recordHold"](held, mint.id, source, ctx, proposal.day);
  const slot = cp["proposeSlotFor"](mint.id, proposal, ctx.session, ctx.siblings ?? []);
  markWakeBehind(cp.store, source === "session-end" ? "write-up" : "memory");
  return {
    deposited: true,
    reason: "minted",
    memoryId: mint.id,
    proposal,
    mint,
    gate: null,
    covers: proposal.covers,
    ...reminder === null ? {} : { reminder },
    ...revision === null ? {} : { revision },
    ...held === null ? {} : { held },
    ...thread === null ? {} : { thread },
    ...facts === null ? {} : { facts },
    ...about === null ? {} : { aboutCarried: { mark: about.about, from: about.from } },
    ...slot === null ? {} : { slot }
  };
}
export function proposeSlotFor(cp, id, p, session, siblings) {
  if (cp.observer)
    return null;
  expireUnanswerableSlots(cp.store, p.day);
  try {
    const declared = p.updates?.resolved ?? null;
    const candidate = detectSlot(cp.store, { id, exclude: declared === null ? siblings : [declared, ...siblings], session });
    if (candidate === null)
      return null;
    const out = proposeSlot(cp.store, { holds: id, candidate, actorId: session, day: p.day });
    return out.ok ? out : null;
  } catch {
    return null;
  }
}
export async function guardUpdate(cp, p, ctx) {
  const how = p.how;
  if (how !== "changed" && how !== "corrected")
    return null;
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  if (target === null)
    return null;
  let row;
  try {
    row = cp.store.row(target);
    if (row === undefined || cp["closesOrRedates"](p, target, row, ctx.facts))
      return null;
  } catch {
    return null;
  }
  let overVec = null;
  let textVec = null;
  if (cp["vectors"] !== undefined) {
    try {
      textVec = await cp["vectors"].vector(p.title, p.content);
      overVec = await cp["vectors"].vector(row.title, row.body);
    } catch {
      textVec = null;
      overVec = null;
    }
  }
  let ignoreNames = [];
  try {
    ignoreNames = ownerNames(cp.store);
  } catch {}
  const read = updateRelatedness({
    over: `${row.title ?? ""}
${row.body}`,
    text: `${p.title ?? ""}
${p.content}`,
    overVec,
    textVec,
    ignoreNames,
    ...overVec !== null && textVec !== null ? { bar: guardBar(cp.store) } : {}
  });
  cp["emit"]("counterpart.update.read", target, {
    related: read.related,
    by: read.by,
    cosine: read.cosine,
    shared: read.shared.length,
    how
  });
  if (read.related)
    return null;
  const owner = ctx.owner === undefined ? cp["owner"] : ctx.owner && !cp.observer;
  return { over: target, ...heldView(row, owner), how, by: read.by, cosine: read.cosine, shared: read.shared.length };
}
export function closesOrRedates(cp, p, target, row, sent) {
  if (row.promoted_identity === 1 || row.band === "identity")
    return false;
  try {
    if (cp.store.readProse(target).meta[UNRESOLVED_META_KEY] === true)
      return true;
  } catch {}
  const intent = p.dateIntent;
  if (intent !== undefined && (intent.eventDate !== "absent" || intent.remind !== null) && cp["reminderHolder"](target) !== null)
    return true;
  const now = sent?.status ?? null;
  const was = statusOf(row.status ?? null);
  return now !== null && was !== null && now !== was;
}
export function recordHold(cp, held, holds, source, ctx, day) {
  const payload = {
    holds,
    over: held.over,
    how: held.how,
    by: held.by,
    cosine: held.cosine,
    shared: held.shared,
    source,
    writeUp: ctx.writeUp !== undefined,
    actor: "session",
    actorId: ctx.session,
    day
  };
  cp["emit"]("counterpart.update.held", holds, { over: held.over, how: held.how, by: held.by, cosine: held.cosine, shared: held.shared, source });
  try {
    cp.store.appendEvent({ name: CONTRADICTION_HELD_EVENT, day, ref: holds, payload });
  } catch (err) {
    cp["emit"]("counterpart.update.held.record.failed", holds, { error: errCode(err) });
  }
}
export function carryAbout(cp, p, sent) {
  if (sent !== undefined && sent !== null)
    return null;
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  if (target === null)
    return null;
  let row;
  try {
    row = cp.store.row(target);
  } catch {
    return null;
  }
  return row === undefined ? null : inheritFrom([row]).about;
}
export function carryFacts(cp, p, sent) {
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  let row;
  try {
    row = target === null ? undefined : cp.store.row(target);
  } catch {
    row = undefined;
  }
  const inherited = [];
  const pick = (field, given, prior) => {
    if (given !== undefined)
      return given;
    if (prior !== null)
      inherited.push(field);
    return prior;
  };
  const occurredOn = pick("occurredOn", sent?.occurredOn, occurredOnOf(row?.occurred_on ?? null));
  const saidBy = pick("saidBy", sent?.saidBy, saidByOf(row?.said_by ?? null));
  const status = pick("status", sent?.status, statusOf(row?.status ?? null));
  if (occurredOn === null && saidBy === null && status === null && inherited.length === 0) {
    return sent === undefined || Object.keys(sent).length === 0 ? null : { occurredOn, saidBy, status, inherited, from: null };
  }
  return { occurredOn, saidBy, status, inherited, from: inherited.length > 0 ? target : null };
}
export function closeThread(cp, p, successor, owner) {
  if (p.threadSaid !== true)
    return null;
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  if (target === null || target === successor)
    return null;
  let refused = null;
  try {
    const row = cp.store.row(target);
    if (row === undefined)
      return null;
    if (cp.store.readProse(target).meta[UNRESOLVED_META_KEY] !== true)
      return null;
    if (row.protected === 1)
      refused = "protected-refuses-revision";
    else if (row.archived === 1)
      refused = "target-archived";
    else if (!owner && row.confidential === 1)
      refused = "confidential";
    else if (!owner && (row.origin_scope ?? "") !== p.scope)
      refused = "other-directory";
  } catch {
    return null;
  }
  if (refused !== null) {
    cp["emit"]("counterpart.thread.refused", target, { successor, reason: refused });
    return { from: target, closed: false, refused };
  }
  let closed = false;
  try {
    cp.store.revise(target, { meta: { [UNRESOLVED_META_KEY]: false }, reason: "thread-closed" });
    closed = true;
  } catch (err) {
    cp["emit"]("counterpart.thread.close.failed", target, { successor, error: errCode(err) });
  }
  cp["emit"]("counterpart.thread.closed", target, { successor, closed, carried: p.unresolved });
  return { from: target, closed };
}
export function carryReminder(cp, p, sentStatus = null) {
  const intent = p.dateIntent;
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  const none = { proposal: p, from: null, inherited: [] };
  if (intent === undefined || target === null)
    return none;
  const from = cp["reminderHolder"](target);
  if (from === null)
    return none;
  const priorDate = cp.store.row(from)?.event_date ?? null;
  if (priorDate === null)
    return none;
  let priorMode = "quiet";
  let priorRule = null;
  try {
    const prior = cp.store.readProse(from);
    priorMode = cueModeOf(prior);
    priorRule = recurrenceOf(prior);
  } catch {}
  const spent = intent.eventDate === "absent" && sentStatus === "done";
  const eventDate = intent.eventDate === "set" ? p.eventDate : intent.eventDate === "cleared" || spent ? null : priorDate;
  const remind = eventDate === null ? null : intent.remind ?? priorMode;
  const sentRule = intent.recurring ?? null;
  const wanted = eventDate === null || sentRule === "cleared" ? null : sentRule ?? priorRule;
  const recurring = wanted !== null && isDay(eventDate) ? wanted : null;
  const inherited = [];
  if (eventDate !== null && intent.eventDate === "absent")
    inherited.push("eventDate");
  if (eventDate !== null && intent.remind === null)
    inherited.push("remind");
  if (recurring !== null && sentRule === null)
    inherited.push("recurring");
  return {
    proposal: { ...p, eventDate, remind, recurring, reminderFrom: from },
    from,
    inherited,
    ...wanted !== null && recurring === null ? { recurringDropped: true } : {}
  };
}
export function reminderHolder(cp, target) {
  let current = target;
  const seen = new Set;
  for (let hop = 0;hop <= DATE_LINEAGE_MAX; hop++) {
    if (seen.has(current))
      return null;
    seen.add(current);
    const row = cp.store.row(current);
    if (row === undefined || row.archived === 1)
      return null;
    if (row.event_date !== null)
      return current;
    let next;
    try {
      next = cp.store.readProse(current).meta[DATE_MOVED_TO_META];
      if (typeof next !== "string")
        return null;
      current = cp.store.resolve(next);
    } catch {
      return null;
    }
  }
  return null;
}
export function moveReminder(cp, carry, successor) {
  const from = carry.from;
  let moved = false;
  try {
    cp.store.revise(from, {
      eventDate: null,
      meta: { [DATE_MOVED_TO_META]: successor },
      reason: "reminder-moved"
    });
    moved = true;
  } catch (err) {
    cp["emit"]("counterpart.reminder.move.failed", from, { successor, error: errCode(err) });
  }
  cp["emit"]("counterpart.reminder.moved", successor, {
    from,
    moved,
    eventDate: carry.proposal.eventDate,
    remind: carry.proposal.remind,
    recurring: carry.proposal.recurring ?? null,
    inherited: carry.inherited.join(",") || null
  });
  return {
    from,
    eventDate: carry.proposal.eventDate,
    remind: carry.proposal.remind,
    recurring: carry.proposal.recurring ?? null,
    ...carry.recurringDropped === true ? { recurringDropped: true } : {},
    inherited: carry.inherited,
    moved
  };
}
export function creditNamedIn(cp, title, body, day, memoryId, door) {
  if (cp.observer)
    return;
  try {
    const out = cp.schemas.creditNamedIn({
      text: title === null ? body : `${title}
${body}`,
      day,
      ref: memoryId
    });
    if (out.credited.length + out.refused.length + out.revived.length + out.ambiguous === 0)
      return;
    cp["emit"]("counterpart.mention.named", memoryId, {
      door,
      credited: out.credited.length,
      refused: out.refused.length,
      revived: out.revived.length,
      ambiguous: out.ambiguous,
      day
    });
  } catch (err) {
    cp["emit"]("counterpart.mention.named.failed", memoryId, { door, code: errCode(err) });
  }
}
