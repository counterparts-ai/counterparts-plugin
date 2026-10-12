/** `Counterpart`'s deposit: the gate's record, the update guard, and carrying facts, reminders and threads onto what is written (bodies moved out of `counterpart.ts`, 2026-10-11; the class keeps a delegate for each). */
import { batteryGate } from "./bridge.js";
import { mintProposal, UNRESOLVED_META_KEY } from "./mint.js";
import { cueModeOf, recurrenceOf, DATE_LINEAGE_MAX, DATE_MOVED_TO_META } from "./prospective/index.js";
import { errCode, submitProposal } from "./remember/index.js";
import type { Proposal, SubmitResult, ProposalSource } from "./remember/index.js";
import {
  settleMovedReminder,
  expireUnanswerableSlots,
  detectSlot,
  proposeSlot,
  updateRelatedness,
  guardBar,
  heldView,
  CONTRADICTION_HELD_EVENT,
} from "./reconsolidation.js";
import type { SlotOutcome, HeldUpdate } from "./reconsolidation.js";
import { isDay } from "./time.js";
import type { Recurrence } from "./time.js";
import { markWakeBehind } from "./self/index.js";
import { ownerNames } from "./sleep/index.js";
import { statusOf, inheritFrom, occurredOnOf, saidByOf } from "./store/index.js";
import type { MemoryRow, Inherited, MemoryStatus } from "./store/index.js";
import type {
  DepositContext,
  SessionEndDepositContext,
  DepositResult,
  DepositReason,
  SentFacts,
  DepositFacts,
  FactField,
  ThreadRefusal,
  ReminderCarryPlan,
  DepositReminder,
} from "./counterpart-types.js";
import { GATE_DEPOSIT_EVENT, gateDepositRecord } from "./counterpart-events.js";
import type { Counterpart } from "./counterpart.js";

/** A proposal without its `how`: its declaration links and settles nothing (`revision.ts`). */
function withoutHow(p: Proposal): Proposal {
  const { how: _how, ...rest } = p;
  void _how;
  return rest as Proposal;
}

/** A proposal without its `updates` (a held one, `Counterpart#guardUpdate`): a new memory, linked to nothing. */
function withoutUpdates(p: Proposal): Proposal {
  return { ...withoutHow(p), updates: null };
}

/**
 * ONE `gate.deposit` ROW PER DEPOSIT THAT REACHED THE BATTERY — the authored
 * door's half of the gate log (replay INTERFACE-GAPS §2a).
 *
 * WHEN NOTHING IS WRITTEN, and why that is the honest answer rather than a
 * hole: `records` is empty exactly when no battery ran. An observer stood
 * down, intake found the draft malformed, the content was already deposited,
 * or the gate itself threw — all four are decided before or instead of the
 * battery (`remember/` NOTES §7's rejection ordering), and a row claiming five
 * clear gates for a draft no gate ever saw would be worse than no row (scar
 * §2.4). Those outcomes keep the in-process `counterpart.deposit.refused`
 * event they have always had.
 *
 * **NO `dedupKey`, AND THAT IS THE WHOLE DIFFERENCE FROM `gate.chunk`.**
 * `store.pruneEvents` exempts a latched row by construction — a latch is the
 * replay anti-double-append, so sweeping one would let a replayed day re-record
 * what the store already accounted for. That price is right for `gate.chunk`,
 * whose writer is the crash fallback and whose ordinary rate is zero rows a
 * day. It is wrong here: the authored door fires at every session end and
 * every jot, so a latch would put a permanently un-sweepable row on the
 * busiest write path in the system. Unlatched, this row is the same class as
 * `recall.decision`, which made exactly this call for exactly this reason
 * (replay INTERFACE-GAPS §7, "no retention rule was added").
 *
 * **AND THE HONEST HALF, NOW CLOSED: the events table IS swept.** When this
 * row was added, `Store.pruneEvents()` existed, was tested, and had NO caller
 * anywhere in `src/` — "unlatched" bought eligibility, not deletion (filed as
 * `src/core/sleep/NOTES.md` §13). Since 2026-09-05 sleep's `log` phase calls
 * it as the cycle's last step: this row leaves the log once it is older than
 * the store's window (90 lived days by default), at most `BUDGETS.log` rows a
 * pass (`sleep/CONTRACT.md` §5 G16, `sleep/NOTES.md` §15).
 *
 * What the latch would have bought is bought elsewhere anyway: an accepted
 * deposit cannot repeat, because `remember/`'s content ledger refuses a second
 * deposit of the same text in the same scope before the battery is called. A
 * refused one CAN repeat, and two refusals are honestly two events.
 */
export function recordDeposit(
  cp: Counterpart,
  result: SubmitResult,
  ctx: DepositContext,
  source: ProposalSource,
  mint: { id: string } | null,): void {
  // `records` is non-empty exactly when the battery ran, and the battery runs
  // only after intake has parsed a kind — so this is a NARROWING, not a
  // default. A null here would mean the two facts disagreed.
  if (cp.observer || result.records.length === 0 || result.kind === null) return;
  const day = cp.store.livedDay();
  const secrets = result.records.find((r) => r.gate === "secrets");
  const contentHash = secrets !== undefined && secrets.gate === "secrets" ? secrets.contentHash : null;
  // TELEMETRY NEVER BREAKS THE DOOR. This runs AFTER the mint on the accept
  // arm, so a throwing log write would turn a memory that is already on disk
  // into a failed deposit the caller retries — the worst possible trade for a
  // row whose only job is to be readable later. The failure is emitted, not
  // swallowed silently (scar §2.4 again: a missing row must be explainable).
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
        // THE GATE'S VERDICT, not the deposit's fate. With records in hand
        // the only reachable reasons are ACCEPTED, GATE_REJECTED and
        // IO_FAILED — and IO_FAILED is a clean gate whose ledger write then
        // failed. Deriving this from `mint !== null` instead recorded that
        // case as `refused: 1` with an empty `blockedBy` and no rejecting
        // gate: a refusal with no reason, which is the one shape a refusal
        // distribution must never contain. `accepted: 1, memoryId: null` is
        // the IO-failed signature, and it is legible as exactly that.
        accepted: result.reason !== "GATE_REJECTED",
        memoryId: mint?.id ?? null,
        kind: result.kind,
        // The refusal arm's WHOLE list, not just the first reason — the exact
        // thing the old `{gate, reason}` seam could not carry.
        blockedBy: result.blockedBy,
      }),
    });
  } catch (err) {
    cp["emit"]("counterpart.deposit.record.failed", undefined, {
      source,
      accepted: mint !== null,
      error: errCode(err),
    });
  }
}

/**
 * The authored path, end to end: intake → the encode battery (per proposal,
 * via `bridge.batteryGate()`) → `updates:` resolution against the real store →
 * coverage → mint, with the channel engine-set to `authored`.
 */
export async function deposit(
  cp: Counterpart,
  draft: unknown,
  source: ProposalSource,
  ctx: SessionEndDepositContext,): Promise<DepositResult> {
  const none = (reason: DepositReason, gate: string | null = null): DepositResult => ({
    deposited: false,
    reason,
    memoryId: null,
    proposal: null,
    mint: null,
    gate,
    covers: [],
  });

  const result = await submitProposal(cp.spans, draft, {
    session: ctx.session,
    scope: ctx.scope,
    source,
    gate: batteryGate(cp["vectors"]),
    ...(ctx.ownSpanHash === undefined ? {} : { ownSpanHash: ctx.ownSpanHash }),
    ...(ctx.cover === undefined ? {} : { cover: ctx.cover }),
    resolveUpdates: (declared, content) => cp["resolveUpdatesFor"](ctx.scope, declared, content),
  });

  if (!result.accepted || result.proposal === null) {
    const reason: DepositReason =
      result.reason === "OBSERVER"
        ? "observer"
        : result.reason === "MALFORMED"
          ? "malformed"
          : result.reason === "DUPLICATE_CONTENT"
            ? "duplicate-content"
            : result.reason === "GATE_REJECTED"
              ? "gate-rejected"
              : result.reason === "GATE_FAILED"
                ? "gate-failed"
                : "io-failed";
    cp["emit"]("counterpart.deposit.refused", undefined, {
      source,
      reason,
      gate: result.gate,
      malformed: result.malformed,
    });
    cp["recordDeposit"](result, ctx, source, null);
    return { ...none(reason, result.gate), malformed: result.malformed };
  }

  // THE UPDATE GUARD (2026-10-09), before anything reads the address: a
  // `changed` or `corrected` at a memory that looks unrelated is HELD. The
  // proposal goes on without its `updates`, so nothing is linked, carried
  // over, closed or settled; the hold is recorded and handed back.
  const held = await cp["guardUpdate"](result.proposal, ctx);
  const carry = cp["carryReminder"](held === null ? result.proposal : withoutUpdates(result.proposal), ctx.facts?.status ?? null);
  // v12: the writer's three fields, a revision's carried over where unsent.
  const facts = cp["carryFacts"](carry.proposal, ctx.facts);
  const proposal: Proposal = facts === null ? carry.proposal : { ...carry.proposal, facts: { ...(facts.occurredOn === null ? {} : { occurredOn: facts.occurredOn }), ...(facts.saidBy === null ? {} : { saidBy: facts.saidBy }), ...(facts.status === null ? {} : { status: facts.status }) } };
  // What it is about, a revision's carried over when none was sent (2026-10-11).
  const about = cp["carryAbout"](carry.proposal, ctx.about);
  const mint = mintProposal(cp.store, proposal, {
    self: cp.self,
    channel: "authored",
    ...(about !== null ? { about: about.about, inheritedAbout: about } : ctx.about === undefined ? {} : { about: ctx.about }),
    ...(ctx.model === undefined ? {} : { model: ctx.model }),
    ...(ctx.writeUp === undefined ? {} : { writeUp: ctx.writeUp }),
    onEvent: (name, data) => cp["emit"](name, undefined, data),
  });
  // BEFORE the revision dispatch: a current-state target is superseded there,
  // and the date must leave the row while it is still the live one.
  const reminder = carry.from === null ? null : cp["moveReminder"](carry, mint.id);
  const thread = cp["closeThread"](proposal, mint.id, ctx.owner === undefined ? cp["owner"] : ctx.owner && !cp.observer);
  cp["emit"]("counterpart.deposit", mint.id, {
    source,
    kind: proposal.kind,
    covers: proposal.covers.length,
    updates: mint.updates,
    lifted: mint.lifted,
    blind: mint.blind,
  });
  // The ACCEPT arm's row. An accepted deposit's gate record is not a
  // formality: a gate that redacted a secret, softened a hedge or dropped an
  // alias ACTED, and those fires are most of what a mix is made of — v1's own
  // "737 gate fires" counted fires on proposals that were accepted.
  cp["recordDeposit"](result, ctx, source, mint);
  cp["creditNamedIn"](proposal.title ?? null, proposal.content, proposal.day, mint.id, source);
  // THE CLOSE AND THE LIST AGREE (2026-10-02). A thread this session may
  // not close — confidential, or opened in another directory, for a session
  // that is not the owner's — is not settled over either: the declaration
  // stays a link (no `how`), so the old memory stays live and stays under
  // "Still open", which is what the refusal says. It used to be refused and
  // settled at once, and the wake dropped what the deposit said was open.
  const keepOpen = thread?.refused === "confidential" || thread?.refused === "other-directory";
  const revision = cp["applyDeclaredRevision"](keepOpen ? withoutHow(proposal) : proposal, mint, source, ctx.session);
  // THE MEMORY THE REMINDER LEFT STEPS BACK (2026-10-11, Group 2b; review 07
  // §4.3): after the declared revision, so the writer's own settle (its
  // `how`, its words) comes first; a row of its own only when the two are not
  // a pair already — the reminder came from further along its chain, or the
  // writer said `open`.
  if (reminder !== null && reminder.moved && !cp.observer) {
    try {
      settleMovedReminder(cp.store, { remnant: reminder.from, holder: mint.id, actor: "session", actorId: ctx.session, day: proposal.day }, { retarget: cp["retargetLinks"] });
    } catch {
      /* the reminder moved; the row is bookkeeping */
    }
  }
  if (held !== null) cp["recordHold"](held, mint.id, source, ctx, proposal.day);
  // THE SLOT DETECTOR (2026-10-11, Group 2), after the declared revision:
  // what the writer named is settled first, then arithmetic reads whether
  // this is the newer state of something it did not name.
  const slot = cp["proposeSlotFor"](mint.id, proposal, ctx.session, ctx.siblings ?? []);
  // THE WAKE IS BEHIND EVERY ACCEPTED MEMORY (2026-10-10), whatever door it
  // came through. Only `session_end` marked it before, so a `note` — the
  // most common write mid-session — left Still open, Nearby and Arriving as
  // they were for up to a day, a thread it closed included. The turn-end
  // worker re-renders (`refreshWake`): no model call, ~0.45 s on the
  // owner's store, in the detached worker. A write-up keeps its own name.
  markWakeBehind(cp.store, source === "session-end" ? "write-up" : "memory");
  return {
    deposited: true,
    reason: "minted",
    memoryId: mint.id,
    proposal,
    mint,
    gate: null,
    covers: proposal.covers,
    ...(reminder === null ? {} : { reminder }),
    ...(revision === null ? {} : { revision }),
    ...(held === null ? {} : { held }),
    ...(thread === null ? {} : { thread }),
    ...(facts === null ? {} : { facts }),
    ...(about === null ? {} : { aboutCarried: { mark: about.about, from: about.from } }),
    ...(slot === null ? {} : { slot }),
  };
}

/**
 * THE SLOT DETECTOR at the write (2026-10-11): the nearest older memory this
 * one reads as the newer state of, proposed provisionally — never the one
 * it declared in `updates` (settled or held already), nor an earlier entry
 * of the same call. Never throws: a detector that fails costs the proposal,
 * never the write.
 */
export function proposeSlotFor(cp: Counterpart, id: string, p: Proposal, session: string, siblings: readonly string[]): Extract<SlotOutcome, { ok: true }> | null {
  if (cp.observer) return null;
  // With dreaming off, proposals nothing answered go, once a lived day.
  expireUnanswerableSlots(cp.store, p.day);
  try {
    const declared = p.updates?.resolved ?? null;
    const candidate = detectSlot(cp.store, { id, exclude: declared === null ? siblings : [declared, ...siblings], session });
    if (candidate === null) return null;
    const out = proposeSlot(cp.store, { holds: id, candidate, actorId: session, day: p.day });
    return out.ok ? out : null;
  } catch {
    return null;
  }
}

/**
 * THE UPDATE GUARD (2026-10-09): is the memory this write says it changes
 * or corrects the one it is about? The engine fades or archives on the
 * writer's word, and a weaker writer points at the wrong one (a 10-02
 * benchmark read: a Haiku writer, about two thirds of 149 pairs; on the
 * owner's store, Opus, all 10 checked were right). The pair is read by
 * `reconsolidation.ts#updateRelatedness` — by meaning through the local
 * embedder, by shared content words when there is none — and an unrelated
 * one comes back as a hold. Null: the declaration goes on as written.
 *
 * Only where the write would move the old memory on its word alone:
 *
 *   - an AUTHOR's `how` of `changed` (said or defaulted) or `corrected` —
 *     `open` moves nothing and stays as it was, and a sweep sends no `how`;
 *   - at an address the author DECLARED and the store resolved — a content
 *     match is the engine's own reading, already held to a score floor and a
 *     margin (`remember/updates.ts`);
 *   - and not a CLOSE or a REDATE (`closesOrRedates`), which acts on that
 *     exact memory by id, usually right after recall showed it, and whose
 *     words ("done") need not share anything with what they close.
 *
 * Every door that deposits reaches this, the write-up door and the nightly
 * catch-up's included: a batch writer has nobody to read the reply, so a
 * hold there stays a hold, which is the safe side. Never throws: a guard
 * that cannot read the pair lets the declaration through, as before.
 */
export async function guardUpdate(cp: Counterpart, p: Proposal, ctx: DepositContext): Promise<HeldUpdate | null> {
  const how = p.how;
  if (how !== "changed" && how !== "corrected") return null;
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  if (target === null) return null;
  let row: MemoryRow | undefined;
  try {
    row = cp.store.row(target);
    if (row === undefined || cp["closesOrRedates"](p, target, row, ctx.facts)) return null;
  } catch {
    return null;
  }
  let overVec: number[] | null = null;
  let textVec: number[] | null = null;
  if (cp["vectors"] !== undefined) {
    try {
      // The new memory's vector is the gate's, already in the cache; the old
      // one's is computed here rather than read from box 3, which a backfill
      // may not have reached and which may hold another model's vectors.
      textVec = await cp["vectors"].vector(p.title, p.content);
      overVec = await cp["vectors"].vector(row.title, row.body);
    } catch {
      textVec = null;
      overVec = null;
    }
  }
  let ignoreNames: string[] = [];
  try {
    // The owner's names: half the store says them, so sharing one says nothing.
    ignoreNames = ownerNames(cp.store);
  } catch {
    // No names to set aside: the words read as they are.
  }
  const read = updateRelatedness({
    over: `${row.title ?? ""}\n${row.body}`,
    text: `${p.title ?? ""}\n${p.content}`,
    overVec,
    textVec,
    ignoreNames,
    // The store's own bar (2026-10-11): what a random pair reads here.
    ...(overVec !== null && textVec !== null ? { bar: guardBar(cp.store) } : {}),
  });
  cp["emit"]("counterpart.update.read", target, {
    related: read.related,
    by: read.by,
    cosine: read.cosine,
    shared: read.shared.length,
    how,
  });
  if (read.related) return null;
  const owner = ctx.owner === undefined ? cp["owner"] : ctx.owner && !cp.observer;
  return { over: target, ...heldView(row, owner), how, by: read.by, cosine: read.cosine, shared: read.shared.length };
}

/**
 * A CLOSE OR A REDATE goes straight through the update guard (2026-10-09):
 * the write acts on something the memory it names HOLDS, so it is that
 * memory the writer means.
 *
 *   - The memory is an OPEN THREAD. Both roads the tools document close one
 *     — `unresolved: false`, or `how: changed` with the answer — and an
 *     answer rarely repeats its question ("which cache?" / "Redis").
 *   - The write sends a reminder field (`eventDate`, a date or null, or
 *     `remind`) and the memory holds a date: a reschedule or a "done".
 *   - The write sends a `status` and the memory has a different one
 *     (planned, now done).
 *
 * A field the memory has nothing for — a date on an undated memory, a
 * status where it had none — dates or describes the NEW memory, and the
 * guard reads the pair as it would any other.
 */
export function closesOrRedates(cp: Counterpart, p: Proposal, target: string, row: MemoryRow, sent: SentFacts | undefined): boolean {
  // NOT FOR A CORE MEMORY (review of #427, 2026-10-11): a `done` over a core
  // plan takes it out of the core in one step (`revision.ts#fulfil`), so the
  // pair is read like any other first. A plan and the memory that says it
  // was done share their subject; an unrelated write that named the id does not.
  if (row.promoted_identity === 1 || row.band === "identity") return false;
  try {
    if (cp.store.readProse(target).meta[UNRESOLVED_META_KEY] === true) return true;
  } catch {
    // Unreadable prose: no thread this can see.
  }
  const intent = p.dateIntent;
  if (intent !== undefined && (intent.eventDate !== "absent" || intent.remind !== null) && cp["reminderHolder"](target) !== null) return true;
  const now = sent?.status ?? null;
  const was = statusOf(row.status ?? null);
  return now !== null && was !== null && now !== was;
}

/** The hold's durable row and its in-process event. Telemetry never breaks the door. */
export function recordHold(cp: Counterpart, held: HeldUpdate, holds: string, source: ProposalSource, ctx: SessionEndDepositContext, day: number): void {
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
    day,
  };
  cp["emit"]("counterpart.update.held", holds, { over: held.over, how: held.how, by: held.by, cosine: held.cosine, shared: held.shared, source });
  try {
    cp.store.appendEvent({ name: CONTRADICTION_HELD_EVENT, day, ref: holds, payload });
  } catch (err) {
    cp["emit"]("counterpart.update.held.record.failed", holds, { error: errCode(err) });
  }
}

/**
 * WHAT A REVISION IS ABOUT WHEN ITS WRITER DID NOT SAY (2026-10-11; decided
 * by random-06, 2026-10-11, lightly held): the mark of the memory it revises
 * — an address the author declared and the store resolved, as `carryFacts`
 * reads it — through `store/index.ts#inheritFrom`, so its default floor
 * reads by it: an owner memory revised without restating `about` stays the
 * owner's (0.40), not the unmarked 0.25. A mark that was sent always wins
 * (the door records it after the mint, as before); null and absent are the
 * same here, since the doors read both as none sent. Null: a mark was sent,
 * this is no declared revision, or the memory it revises is unmarked.
 */
export function carryAbout(cp: Counterpart, p: Proposal, sent: string | null | undefined): (NonNullable<Inherited["about"]>) | null {
  if (sent !== undefined && sent !== null) return null;
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  if (target === null) return null;
  let row: MemoryRow | undefined;
  try {
    row = cp.store.row(target);
  } catch {
    return null;
  }
  return row === undefined ? null : inheritFrom([row]).about;
}

/**
 * THE WRITER'S THREE FIELDS FOR A NEW MEMORY (v12, 2026-10-03): what the
 * writer sent, field by field, and — for a revision of a memory the author
 * addressed by `updates:` (declared and resolved, as `carryReminder` reads
 * it) — what it left out, taken from the memory it revises. A field sent as
 * null carries nothing. Unlike the reminder nothing MOVES: the old memory
 * keeps its own three, which describe its words truly. Null when nothing
 * was sent and nothing carried.
 */
export function carryFacts(cp: Counterpart, p: Proposal, sent: SentFacts | undefined): DepositFacts | null {
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  let row: MemoryRow | undefined;
  try {
    row = target === null ? undefined : cp.store.row(target);
  } catch {
    row = undefined;
  }
  const inherited: FactField[] = [];
  const pick = <T extends string>(field: FactField, given: T | null | undefined, prior: T | null): T | null => {
    if (given !== undefined) return given;
    if (prior !== null) inherited.push(field);
    return prior;
  };
  const occurredOn = pick("occurredOn", sent?.occurredOn, occurredOnOf(row?.occurred_on ?? null));
  const saidBy = pick("saidBy", sent?.saidBy, saidByOf(row?.said_by ?? null));
  const status = pick("status", sent?.status, statusOf(row?.status ?? null));
  if (occurredOn === null && saidBy === null && status === null && inherited.length === 0) {
    return sent === undefined || Object.keys(sent).length === 0 ? null : { occurredOn, saidBy, status, inherited, from: null };
  }
  return { occurredOn, saidBy, status, inherited, from: inherited.length > 0 ? (target as string) : null };
}

/**
 * CLOSING AN OPEN THREAD (2026-10-01, lane 8). A memory flagged
 * `unresolved` is in the wake's "Still open:" lane until something closes
 * it, and nothing could: no write tool set the flag, so no tool cleared it.
 * Now a deposit that DECLARES `updates:` an unresolved memory and SAYS
 * `unresolved` clears the old row's flag — `false`: it is answered; `true`:
 * this memory carries the thread on, so it lives on one row, the newest
 * (the reminder's rule, `moveReminder`). Left out, nothing moves: a plain
 * revision of an open question does not answer it. `how: changed` or
 * `corrected` closes it too, by another road (`settledOver` takes the old
 * one out of every lane but identity).
 *
 * Only for an address the author declared and the store resolved, as for
 * the reminder. `Store#revise` keeps the old meta in the version it writes.
 * A failed clear does not fail the deposit; it is emitted and reported.
 */
export function closeThread(cp: Counterpart, p: Proposal, successor: string, owner: boolean): { from: string; closed: boolean; refused?: ThreadRefusal } | null {
  if (p.threadSaid !== true) return null;
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  if (target === null || target === successor) return null;
  let refused: ThreadRefusal | null = null;
  try {
    const row = cp.store.row(target);
    if (row === undefined) return null;
    if (cp.store.readProse(target).meta[UNRESOLVED_META_KEY] !== true) return null;
    // THE REVISION STEP'S CHECKS, FIRST (review of #313): a flag is state
    // like any other, so what refuses a revision refuses this — the owner's
    // protection and an archived row, in `revision.ts`'s own words — and a
    // session that is not the owner's closes nothing confidential and
    // nothing written in another directory.
    if (row.protected === 1) refused = "protected-refuses-revision";
    else if (row.archived === 1) refused = "target-archived";
    else if (!owner && row.confidential === 1) refused = "confidential";
    else if (!owner && (row.origin_scope ?? "") !== p.scope) refused = "other-directory";
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

/**
 * A REVISION OWNS THE REMINDER (review N7, 2026-09-26). A `note` or a
 * `session_end` entry that revises a DATED memory (`updates:`) and leaves the
 * date out would otherwise mint an undated successor — and because a revision
 * of an ordinary memory is link-only (`revision.ts`), the old row would keep
 * its date and keep coming back beside the new one; a reschedule would leave
 * the old day firing too. So, field by field: what the author sent wins,
 * `eventDate: null` drops the date, and anything left out is carried over from
 * the memory being revised. `moveReminder` then clears the old row's date.
 *
 * Only for an address the AUTHOR declared and the store resolved (`declared`).
 * A content match is the engine's guess, and moving a date off a guessed row
 * would be a wrong write; leaving it where it is loses nothing. The sweep
 * builds its proposals without a `dateIntent`, so it carries nothing either
 * (it never dates a memory — `applySweep`).
 *
 * The reminder is found where it NOW lives (`reminderHolder`): the old id
 * stays live after a move, so "cancel it" or "it moved to the 20th" sent
 * against the id the model first saw must reach the memory holding the date,
 * not answer from a row whose date already left (review of #247). An
 * ARCHIVED holder carries nothing, as `revision.ts` refuses `target-archived`:
 * a reminder that faded or was put away is not revived onto a live row by a
 * revision that did not ask for it.
 */
export function carryReminder(cp: Counterpart, p: Proposal, sentStatus: MemoryStatus | null = null): ReminderCarryPlan {
  const intent = p.dateIntent;
  const target = p.updates?.method === "declared" ? p.updates.resolved : null;
  const none: ReminderCarryPlan = { proposal: p, from: null, inherited: [] };
  if (intent === undefined || target === null) return none;
  const from = cp["reminderHolder"](target);
  // Nothing dated to carry or to move: the author's own fields stand as sent.
  if (from === null) return none;
  const priorDate = cp.store.row(from)?.event_date ?? null;
  if (priorDate === null) return none;
  let priorMode: "plain" | "quiet" = "quiet";
  let priorRule: Recurrence | null = null;
  try {
    const prior = cp.store.readProse(from);
    priorMode = cueModeOf(prior);
    priorRule = recurrenceOf(prior);
  } catch {
    // Unreadable prose: the date still carries, at the default mode, once.
  }
  // A `done` SPENDS IT (review of #427, 2026-10-11): a write that says the
  // dated thing is done, and sends no date, does not inherit one to fire on
  // a plan already carried out — the rule the one door keeps for a settle.
  const spent = intent.eventDate === "absent" && sentStatus === "done";
  const eventDate =
    intent.eventDate === "set" ? p.eventDate : intent.eventDate === "cleared" || spent ? null : priorDate;
  const remind = eventDate === null ? null : intent.remind ?? priorMode;
  // HOW OFTEN, field by field like the rest (2026-10-09): what the author
  // sent, `null` for "no longer repeats", else the revised memory's. Only a
  // day repeats, so a revision that moves the date to a month or a range
  // leaves it once — the same occurrence keys are what `lineage` counts.
  const sentRule = intent.recurring ?? null;
  const wanted = eventDate === null || sentRule === "cleared" ? null : sentRule ?? priorRule;
  const recurring = wanted !== null && isDay(eventDate) ? wanted : null;
  const inherited: ("eventDate" | "remind" | "recurring")[] = [];
  if (eventDate !== null && intent.eventDate === "absent") inherited.push("eventDate");
  if (eventDate !== null && intent.remind === null) inherited.push("remind");
  if (recurring !== null && sentRule === null) inherited.push("recurring");
  return {
    proposal: { ...p, eventDate, remind, recurring, reminderFrom: from },
    from,
    inherited,
    ...(wanted !== null && recurring === null ? { recurringDropped: true } : {}),
  };
}

/**
 * The live memory holding the reminder `target` had: `target` itself when it
 * is dated, else the end of its `meta.reminderMovedTo` chain (each hop through
 * `Store#resolve`, since a holder can itself be superseded). Null when there
 * is none, when the chain reaches an archived or removed row, or when it runs
 * past `DATE_LINEAGE_MAX`.
 */
export function reminderHolder(cp: Counterpart, target: string): string | null {
  let current = target;
  const seen = new Set<string>();
  for (let hop = 0; hop <= DATE_LINEAGE_MAX; hop++) {
    if (seen.has(current)) return null;
    seen.add(current);
    const row = cp.store.row(current);
    if (row === undefined || row.archived === 1) return null;
    if (row.event_date !== null) return current;
    let next: unknown;
    try {
      next = cp.store.readProse(current).meta[DATE_MOVED_TO_META];
      if (typeof next !== "string") return null;
      current = cp.store.resolve(next);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The other half of `carryReminder`: the revised row's date is cleared, so the
 * reminder lives on exactly one memory — the newest. `Store#revise` keeps the
 * old date in the version it writes (constitution 7). A failed clear does not
 * fail a deposit that is already on disk; it is emitted and reported.
 */
export function moveReminder(cp: Counterpart, carry: ReminderCarryPlan, successor: string): DepositReminder {
  const from = carry.from as string;
  let moved = false;
  try {
    // The forward pointer rides the same revise, so the clear and the address
    // it leaves behind land in one transaction or not at all.
    cp.store.revise(from, {
      eventDate: null,
      meta: { [DATE_MOVED_TO_META]: successor },
      reason: "reminder-moved",
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
    inherited: carry.inherited.join(",") || null,
  });
  return {
    from,
    eventDate: carry.proposal.eventDate,
    remind: carry.proposal.remind,
    recurring: carry.proposal.recurring ?? null,
    ...(carry.recurringDropped === true ? { recurringDropped: true } : {}),
    inherited: carry.inherited,
    moved,
  };
}

/**
 * A saved memory that names a card anywhere in its title or body counts as a
 * use of that card, so someone talked about every day keeps their card, and
 * one who faded comes back (schemas NOTES §15). Every door that mints calls
 * this: a deposit, a sweep, an episode ingestion. Fail-open: the memory has
 * already landed.
 *
 * A write never BIRTHS a card (2026-10-11, Group 3 part D). The title door
 * that used to (`mentionFromProposal`) passed the memory's title as the name,
 * and an authored title is a sentence that never occurs verbatim in its own
 * body: 84 entity and person memories, 0 births (review 12 §3a). Cards are
 * born at the boundary, from the names the memories keep saying
 * (`Schemas#birthsFromNames`, the sleep cycle's `births` phase).
 */
export function creditNamedIn(
  cp: Counterpart,
  title: string | null,
  body: string,
  day: number,
  memoryId: string,
  door: string,): void {
  if (cp.observer) return;
  try {
    const out = cp.schemas.creditNamedIn({
      text: title === null ? body : `${title}\n${body}`,
      day,
      ref: memoryId,
    });
    if (out.credited.length + out.refused.length + out.revived.length + out.ambiguous === 0) return;
    cp["emit"]("counterpart.mention.named", memoryId, {
      door,
      credited: out.credited.length,
      refused: out.refused.length,
      revived: out.revived.length,
      ambiguous: out.ambiguous,
      day,
    });
  } catch (err) {
    cp["emit"]("counterpart.mention.named.failed", memoryId, { door, code: errCode(err) });
  }
}
