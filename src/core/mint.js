import { TUNABLES as PHYSICS, clampSalienceAtSeam, defaultClaimFor } from "./physics/index.js";
import { CUE_MODE_META, DATE_FROM_META, RECURRING_META } from "./prospective/index.js";
import { isDay, isRecurrence, localDate } from "./time.js";
import { SECOND_HAND_META_KEY, WRITTEN_UP_BY_META_KEY } from "./types.js";
export const UPDATES_META_KEY = "updates";
export const CLAIMED_DEFAULT_META_KEY = "claimedDefault";
export const UNRESOLVED_META_KEY = "unresolved";
export function directionOf(method) {
  return method === "content" || method === "content+hint" ? "confirm" : "soften";
}
export function mintProposal(store, proposal, opts = {}) {
  const channel = opts.channel ?? "authored";
  const dims = {
    novelty: proposal.salience.novelty ?? null,
    relevance: proposal.salience.relevance ?? 0,
    emotional: proposal.salience.emotional ?? 0,
    predictive: proposal.salience.predictive ?? 0
  };
  const ceiling = channel === "fallback" ? PHYSICS.SWEEP_CLAIM_CEILING : 1;
  const byAbout = channel === "authored" ? defaultClaimFor({
    about: opts.about ?? null,
    status: proposal.facts?.status ?? null,
    saidBy: proposal.facts?.saidBy ?? null,
    kind: proposal.kind
  }) : null;
  const defaultClaim = byAbout === null ? null : byAbout.claim;
  const clamp = clampSalienceAtSeam(dims, proposal.salience.claimed ?? null, ceiling, defaultClaim);
  const resolved = proposal.updates?.resolved ?? null;
  const meta = {};
  if (resolved !== null) {
    meta[UPDATES_META_KEY] = resolved;
    meta["updatesMethod"] = proposal.updates?.method ?? "declared";
  }
  if (proposal.unresolved)
    meta[UNRESOLVED_META_KEY] = true;
  if (proposal.aliases.length > 0)
    meta["aliases"] = [...proposal.aliases];
  if (proposal.feeling !== null)
    meta["feeling"] = proposal.feeling.feeling;
  if (clamp.rawClaim !== null)
    meta["claimedRaw"] = clamp.rawClaim;
  if (clamp.defaulted)
    meta[CLAIMED_DEFAULT_META_KEY] = true;
  if (proposal.eventDate !== null && proposal.remind !== null)
    meta[CUE_MODE_META] = proposal.remind;
  if (proposal.eventDate !== null && isDay(proposal.eventDate) && isRecurrence(proposal.recurring)) {
    meta[RECURRING_META] = proposal.recurring;
  }
  if (proposal.reminderFrom !== undefined)
    meta[DATE_FROM_META] = proposal.reminderFrom;
  const writeUp = opts.writeUp;
  if (writeUp !== undefined) {
    meta[SECOND_HAND_META_KEY] = true;
    meta[WRITTEN_UP_BY_META_KEY] = proposal.session;
  }
  const learnedOn = Number.isFinite(proposal.at) && proposal.at > 0 ? localDate(proposal.at, store.zone()) : store.today();
  const id = store.put({
    type: "memory",
    kind: proposal.kind,
    body: proposal.content,
    learnedOn,
    ...writeUp?.happenedOn === undefined || writeUp.happenedOn === null ? {} : { happenedOn: writeUp.happenedOn },
    ...proposal.title === null ? {} : { title: proposal.title },
    ...proposal.eventDate === null ? {} : { eventDate: proposal.eventDate },
    ...proposal.facts?.occurredOn === undefined ? {} : { occurredOn: proposal.facts.occurredOn },
    ...proposal.facts?.saidBy === undefined ? {} : { saidBy: proposal.facts.saidBy },
    ...proposal.facts?.status === undefined ? {} : { status: proposal.facts.status },
    ...opts.inheritedAbout === undefined ? {} : { about: opts.inheritedAbout.about, ...opts.inheritedAbout.aboutBy === null ? {} : { aboutBy: opts.inheritedAbout.aboutBy } },
    meta,
    band: opts.band ?? "episodic",
    ...opts.model === undefined ? {} : { model: opts.model },
    salience: clamp.salience,
    physics: { birthDay: proposal.day, lastUsedDay: proposal.day },
    source: channel,
    origin: {
      session: writeUp?.session ?? proposal.session,
      scope: proposal.scope,
      ref: proposal.id,
      ...proposal.ownSpanHash === null ? {} : { spanHash: proposal.ownSpanHash }
    }
  });
  if (clamp.event !== null) {
    opts.onEvent?.("salience.lifted", {
      id,
      computed: clamp.event.computed,
      claimed: clamp.event.claimed,
      applied: clamp.event.applied,
      ceiling: clamp.event.ceiling,
      capped: clamp.event.capped
    });
  }
  if (clamp.defaultEvent !== null) {
    opts.onEvent?.("salience.defaulted", {
      id,
      channel,
      class: byAbout?.class ?? null,
      computed: clamp.defaultEvent.computed,
      floor: clamp.defaultEvent.floor,
      applied: clamp.defaultEvent.applied
    });
  }
  let claim = null;
  const direction = opts.claimDirection ?? directionOf(proposal.updates?.method);
  if (resolved !== null && opts.self !== undefined) {
    const outcome = opts.self.noteSelfConfirmation({
      elementId: resolved,
      source: channel,
      direction,
      day: proposal.day,
      session: writeUp?.session ?? proposal.session
    });
    claim = {
      elementId: resolved,
      frozen: outcome.frozen,
      reason: outcome.reason,
      reinforced: outcome.reinforced
    };
    opts.onEvent?.("mint.claim", {
      id,
      element: resolved,
      channel,
      direction,
      frozen: outcome.frozen,
      reason: outcome.reason,
      reinforced: outcome.reinforced
    });
  }
  opts.onEvent?.("mint.proposal", {
    id,
    proposal: proposal.id,
    kind: proposal.kind,
    updates: resolved,
    updatesReason: proposal.updates?.reason ?? "NO_DECLARATION",
    lifted: clamp.lifted,
    defaulted: clamp.defaulted,
    blind: clamp.blind
  });
  return {
    id,
    claim,
    salience: clamp.salience,
    lifted: clamp.lifted,
    defaulted: clamp.defaulted,
    blind: clamp.blind,
    updates: resolved
  };
}
