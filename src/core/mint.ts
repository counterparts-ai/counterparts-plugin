/**
 * The minting seam — SEAMS.md item I (and queued item 8) close here.
 *
 * `remember/` mints PROPOSALS; nothing in it may touch the store. `sleep/`,
 * `schemas/` and `physics/` all read the memory that a proposal becomes. This
 * file is the one place a proposal becomes a memory, so the two rules that
 * belong to that crossing live in exactly one spot:
 *
 *   1. **`updates:` reaches canonical state.** The author's declaration is
 *      resolved upstream (`remember/updates.ts`) and the RESOLVED id — never the
 *      declared string — is written to `doc.meta["updates"]`. `sleep/`'s
 *      `declaredUpdates()` reads that key and `physics.dedupVerdict` checks it
 *      FIRST, before hash and before cosine. Until this seam existed the
 *      guarantee was enforced downstream and starved at the source: scar §2.6's
 *      exact shape (sleep/INTERFACE-GAPS.md §4, recall/INTERFACE-GAPS.md §2).
 *      A declaration that did NOT resolve writes no key at all — "declared
 *      nothing" is the honest reading, and a dangling address must never become
 *      a merge exclusion for a target that does not exist.
 *   2. **The salience floor is clamped here, once.** `physics.clampSalienceAtSeam`
 *      runs at the proposal→memory seam and nowhere else
 *      (remember/INTERFACE-GAPS.md §7: `remember/` deliberately does not call it,
 *      because calling it there would put the clamp in two places). Any lift
 *      emits `salience.lifted` — v1's "remember this" note claimed a floor in its
 *      prompt with no engine backstop, which is the failure encode §5 G6 names.
 *      The same seam supplies the CHANNEL'S DEFAULT FLOOR when the author
 *      claimed nothing: `PHYSICS.AUTHORED_DEFAULT_CLAIM` on the lived channel,
 *      nothing at all on the others. Measured 2026-09-04, all 48 authored
 *      memories on the live store had zero dimensions and no claim, so an
 *      unclaimed note's salience was 0 — weakest in the store, first to decay,
 *      and worth zero revision force. A default is recorded as `defaulted`
 *      (`meta.claimedDefault` plus `salience.defaulted`), NEVER as a lift: the
 *      lift metric measures what authors claim, and silence is not a claim.
 *
 *   3. **The freeze seam has a caller** (SEAMS item N). A proposal that resolved
 *      against an existing element is a CLAIM against that element, and every
 *      such claim routes through `self.noteSelfConfirmation` — so a self-claim
 *      repeat arriving from a transcript sweep is counted and not trained, end to
 *      end. Two things are ENGINE-SET here and cannot be claimed by an author or
 *      an interpreter, exactly as the emotion exemption is engine-set in
 *      `bridge.ts`: the CHANNEL (a fallback sweep can never call itself
 *      authorship — that substitution is the whole doctrine) and the fact that
 *      the call happens at all. The claim's DIRECTION is read off the matcher's
 *      own output rather than guessed (see `directionOf` below).
 *
 * What this seam deliberately does NOT do: re-judge the kind (`submitProposal`
 * already defaulted it), re-gate the content (the gate ran before the proposal
 * existed — its output IS `proposal.content`), invent a band, or decide WHICH
 * claim is a repeat of which element — that matcher is `remember/`'s `updates:`
 * resolution, upstream, and this file does not write a second one.
 */
import { TUNABLES as PHYSICS, clampSalienceAtSeam, defaultClaimFor } from "./physics/index.js";
import { CUE_MODE_META, DATE_FROM_META, RECURRING_META } from "./prospective/index.js";
import type { Proposal } from "./remember/index.js";
import { isDay, isRecurrence, localDate } from "./time.js";
import type { AboutMark, AboutSetter, Store } from "./store/index.js";
import { SECOND_HAND_META_KEY, WRITTEN_UP_BY_META_KEY } from "./types.js";
import type { Band, Salience } from "./types.js";

/** The canonical prose meta key. One spelling, read by `sleep/dedup.ts`. */
export const UPDATES_META_KEY = "updates";
/** The durable record that a memory's floor was the engine's, not its author's.
 *  Prose is canonical, so this — not the event ring — is what the daily counts
 *  defaulted-versus-claimed out of. */
export const CLAIMED_DEFAULT_META_KEY = "claimedDefault";
/** An open loop is an ordinary memory with a flag (`remember/` CONTRACT §4). */
export const UNRESOLVED_META_KEY = "unresolved";

/** Structurally `Self.noteSelfConfirmation` — this file imports no class. */
export interface FreezeSeam {
  noteSelfConfirmation(occasion: {
    elementId: string;
    source: ClaimChannel;
    direction: ClaimDirection;
    day?: number;
    /** The session the claim came in (2026-10-11): written on the return it earns. */
    session?: string | null;
  }): { frozen: boolean; reason: string; reinforced: boolean };
}

/** Which path minted this memory. ENGINE-SET; see rule 3 in the header. */
export type ClaimChannel = "authored" | "fallback" | "episode" | "accommodation";
export type ClaimDirection = "confirm" | "soften";

export interface MintOptions {
  /** Telemetry only — ids, counts, flags. Never body text (store §5 G10). */
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
  /** Nothing is born into identity (module-map ruling 2); default `episodic`. */
  band?: Band;
  /** The freeze seam. Absent means no claim is routed — and a claim that is
   *  never routed is never trained either, so absence is the quiet direction. */
  self?: FreezeSeam;
  /**
   * The minting CHANNEL, engine-set. Defaults to `"authored"` because a
   * `Proposal` is by construction an authored deposit (`session-end` or `jot`);
   * the crash-fallback composition passes `"fallback"` explicitly, and no author
   * field can move it.
   */
  channel?: ClaimChannel;
  /** Explicit override. Absent, the direction is read off `updates.method` —
   *  see `directionOf`, which is where the rule and its reasons live. */
  claimDirection?: ClaimDirection;
  /**
   * The model that wrote this deposit, as the host reported it (schema v7's
   * `memories.model`). Host state, never an author field: the MCP server reads
   * it off the session registry record (`mcp/server.ts`), the same relay a
   * chapter's model takes. The sweep passes none — its words are an
   * interpreter's retelling, not a named model's — and the column is NULL.
   */
  model?: string;
  /**
   * A WRITE-UP of another session's stretch (2026-10-01, build 3): the memory
   * is THAT session's — its origin names it, not the writer — the day it was
   * lived is its `happened_on` (the learned date stays the day it was written),
   * and it is marked second-hand in its meta (`SECOND_HAND_META_KEY`, with the
   * writer's id under `WRITTEN_UP_BY_META_KEY`). Engine-set by the door, never
   * an author field.
   */
  writeUp?: { readonly session: string; readonly happenedOn: string | null };
  /**
   * What the memory is about, as the writer marked it — read ONLY for an
   * unclaimed memory's default floor (`physics.defaultClaimFor`, 2026-10-10).
   * The mark is recorded by the door after the mint, as before.
   */
  about?: string | null;
  /**
   * The mark a REVISION inherits from the memory it revises when its writer
   * sent none (2026-10-11, `store/index.ts#inheritFrom`), with who set it:
   * written on the row at birth, as a merge's is. The door sets it, and hands
   * the same mark in `about` so the default floor reads by it.
   */
  inheritedAbout?: { readonly about: AboutMark; readonly aboutBy: AboutSetter | null };
}

export interface MintResult {
  id: string;
  /** The freeze verdict, when this memory made a claim against an element. */
  claim: { elementId: string; frozen: boolean; reason: string; reinforced: boolean } | null;
  /** The clamped salience actually written to box 2. */
  salience: Salience;
  /** True when the author's claimed floor exceeded the computed value. A
   *  defaulted floor is NOT a lift — see `defaulted`. */
  lifted: boolean;
  /** True when the author claimed nothing and the channel's default floor was
   *  written in its place (`meta.claimedDefault` on the row). */
  defaulted: boolean;
  /** No schema context existed at encoding — recorded, never defaulted (§2.9). */
  blind: boolean;
  /** The resolved id written to `doc.meta["updates"]`, or null when none was. */
  updates: string | null;
}

/**
 * The claim's direction, from the matcher's own verdict — not a default anybody
 * had to remember, and not a second matcher.
 *
 *   - **`declared`** — the author (or the interpreter) wrote `updates: <id>`:
 *     they ADDRESSED the element in order to revise it. That is a softening, and
 *     softening is never frozen (§14.2 G6 — freezing both directions would make
 *     the identity model unrevisable in both) and never reinforces here: a
 *     refutation must not credit a use to the belief it refutes. That is scar
 *     §2.10's one-way ratchet, and it is the same rule `physics.dedupVerdict`
 *     checks FIRST for the merge case — the two must not disagree.
 *   - **`content` / `content+hint`** — nobody addressed anything; the ENGINE
 *     matched a restatement. Saying the same thing again IS a confirmation, and
 *     it is exactly the doctrine's scenario when it arrives from a transcript
 *     sweep: a model reading its own conduct and agreeing with its own schema.
 */
export function directionOf(method: string | undefined): ClaimDirection {
  return method === "content" || method === "content+hint" ? "confirm" : "soften";
}

export function mintProposal(store: Store, proposal: Proposal, opts: MintOptions = {}): MintResult {
  const channel = opts.channel ?? "authored";
  const dims: Salience = {
    novelty: proposal.salience.novelty ?? null,
    relevance: proposal.salience.relevance ?? 0,
    emotional: proposal.salience.emotional ?? 0,
    predictive: proposal.salience.predictive ?? 0,
  };
  // The authorship doctrine's salience half (owner ruling 2026-08-29): lived
  // testimony commands the full floor; the fallback's retelling author is
  // capped. The ceiling is ENGINE-SET off the channel — like the channel
  // itself, no author field can move it.
  const ceiling = channel === "fallback" ? PHYSICS.SWEEP_CLAIM_CEILING : 1;
  // The doctrine's other half, and engine-set the same way: an author who
  // claimed nothing still deposited something LIVED, so the authored channel —
  // and only it — has a default floor. The fallback channel is untouched: its
  // ceiling and its interpreter-supplied dimensions stay exactly as they were.
  //
  // BY WHAT IT IS ABOUT since 2026-10-10 (Group 1c, review 01 C2): a done work
  // event starts lowest, the world higher, the owner, us and me highest —
  // all below the semantic floor (`physics.defaultClaimFor`).
  const byAbout =
    channel === "authored"
      ? defaultClaimFor({
          about: opts.about ?? null,
          status: proposal.facts?.status ?? null,
          saidBy: proposal.facts?.saidBy ?? null,
          kind: proposal.kind,
        })
      : null;
  const defaultClaim = byAbout === null ? null : byAbout.claim;
  const clamp = clampSalienceAtSeam(dims, proposal.salience.claimed ?? null, ceiling, defaultClaim);

  // The RESOLVED id, and only when it resolved (sleep/INTERFACE-GAPS.md §4:
  // "the minting seam persists the RESOLVED id there, and states which it is").
  const resolved = proposal.updates?.resolved ?? null;

  const meta: Record<string, unknown> = {};
  if (resolved !== null) {
    meta[UPDATES_META_KEY] = resolved;
    meta["updatesMethod"] = proposal.updates?.method ?? "declared";
  }
  if (proposal.unresolved) meta[UNRESOLVED_META_KEY] = true;
  if (proposal.aliases.length > 0) meta["aliases"] = [...proposal.aliases];
  if (proposal.feeling !== null) meta["feeling"] = proposal.feeling.feeling;
  // A capped claim's RAW value survives in prose meta: the cap is doctrine,
  // but silently discarding what the author actually said would be its own
  // small destruction — and the re-run's ceiling decision needs the evidence.
  if (clamp.rawClaim !== null) meta["claimedRaw"] = clamp.rawClaim;
  // Durable, because the event ring is not: prose is canonical, so the flag on
  // the document is what makes "defaulted vs claimed" countable tomorrow.
  if (clamp.defaulted) meta[CLAIMED_DEFAULT_META_KEY] = true;
  // PLAIN OR QUIET rides the meta bag beside its date (2026-09-26, no schema
  // bump), under the key its one reader owns.
  if (proposal.eventDate !== null && proposal.remind !== null) meta[CUE_MODE_META] = proposal.remind;
  // HOW OFTEN IT COMES ROUND (2026-10-09), in the same bag for the same
  // reason: no schema bump. Only beside a day — intake refuses it on anything
  // else, and a carried one that no longer fits was dropped by the carry.
  if (proposal.eventDate !== null && isDay(proposal.eventDate) && isRecurrence(proposal.recurring)) {
    meta[RECURRING_META] = proposal.recurring;
  }
  // The memory a revision took its reminder from (`Counterpart#carryReminder`):
  // an id, so what was already said for the same window still counts.
  if (proposal.reminderFrom !== undefined) meta[DATE_FROM_META] = proposal.reminderFrom;
  // SECOND-HAND (2026-10-01): written up by a session that did not live it.
  const writeUp = opts.writeUp;
  if (writeUp !== undefined) {
    meta[SECOND_HAND_META_KEY] = true;
    meta[WRITTEN_UP_BY_META_KEY] = proposal.session;
  }

  // THE PROPOSAL'S OWN INSTANT, not the write's (§I7). `proposal.at` is the
  // span buffer's injected clock read at the moment the author deposited; the
  // row is written later — at a boundary, possibly the next morning, possibly
  // during a replay of a corpus from months ago. A memory is dated by when it
  // was LEARNED, so the deposit's instant is the honest one and the store's
  // default (`store.today()`) is only the fallback for a proposal with no
  // usable instant. The lived day is untouched: `physics.birthDay` below is
  // still `proposal.day`, and the two clocks stay separate.
  //
  // In the person's zone since 2026-09-25 (docs/time.md rule 3): an 11:50 pm
  // deposit belongs to that local day, not to the UTC one it is already in.
  const learnedOn =
    Number.isFinite(proposal.at) && proposal.at > 0 ? localDate(proposal.at, store.zone()) : store.today();

  const id = store.put({
    type: "memory",
    kind: proposal.kind,
    body: proposal.content,
    learnedOn,
    // The day a write-up's stretch was LIVED (2026-10-01).
    ...(writeUp?.happenedOn === undefined || writeUp.happenedOn === null ? {} : { happenedOn: writeUp.happenedOn }),
    ...(proposal.title === null ? {} : { title: proposal.title }),
    // The reminder date, as the author wrote it (schema v7's `event_date`).
    ...(proposal.eventDate === null ? {} : { eventDate: proposal.eventDate }),
    // v12: the writer's three fields (when it happened, who said it, what kind).
    ...(proposal.facts?.occurredOn === undefined ? {} : { occurredOn: proposal.facts.occurredOn }),
    ...(proposal.facts?.saidBy === undefined ? {} : { saidBy: proposal.facts.saidBy }),
    ...(proposal.facts?.status === undefined ? {} : { status: proposal.facts.status }),
    // What a revision carries over of what its memory was about (2026-10-11).
    ...(opts.inheritedAbout === undefined
      ? {}
      : { about: opts.inheritedAbout.about, ...(opts.inheritedAbout.aboutBy === null ? {} : { aboutBy: opts.inheritedAbout.aboutBy }) }),
    meta,
    band: opts.band ?? "episodic",
    ...(opts.model === undefined ? {} : { model: opts.model }),
    salience: clamp.salience,
    physics: { birthDay: proposal.day, lastUsedDay: proposal.day },
    // Engine-set provenance (F9-light): the channel as recorded fact, and ids
    // only — session, scope, and the proposal id. Never span or body text.
    source: channel,
    // `spanHash` only when the proposal HAD an own span (a jot). A sweep-minted
    // memory rode no single span, so the key is absent rather than null — and
    // removal's span surface reads that absence as "nothing of it rode one".
    origin: {
      // A write-up's memory is the session it writes up (2026-10-01).
      session: writeUp?.session ?? proposal.session,
      scope: proposal.scope,
      ref: proposal.id,
      ...(proposal.ownSpanHash === null ? {} : { spanHash: proposal.ownSpanHash }),
    },
  });

  if (clamp.event !== null) {
    opts.onEvent?.("salience.lifted", {
      id,
      computed: clamp.event.computed,
      claimed: clamp.event.claimed,
      applied: clamp.event.applied,
      ceiling: clamp.event.ceiling,
      capped: clamp.event.capped,
    });
  }
  if (clamp.defaultEvent !== null) {
    opts.onEvent?.("salience.defaulted", {
      id,
      channel,
      class: byAbout?.class ?? null,
      computed: clamp.defaultEvent.computed,
      floor: clamp.defaultEvent.floor,
      applied: clamp.defaultEvent.applied,
    });
  }
  // SEAMS item N: a resolved `updates:` IS a claim against an existing element.
  let claim: MintResult["claim"] = null;
  const direction = opts.claimDirection ?? directionOf(proposal.updates?.method);
  if (resolved !== null && opts.self !== undefined) {
    const outcome = opts.self.noteSelfConfirmation({
      elementId: resolved,
      source: channel,
      direction,
      day: proposal.day,
      // The session it came in, as the new memory's origin says (review of
      // #430): the core's recurrence lane counts sessions.
      session: writeUp?.session ?? proposal.session,
    });
    claim = {
      elementId: resolved,
      frozen: outcome.frozen,
      reason: outcome.reason,
      reinforced: outcome.reinforced,
    };
    opts.onEvent?.("mint.claim", {
      id,
      element: resolved,
      channel,
      direction,
      frozen: outcome.frozen,
      reason: outcome.reason,
      reinforced: outcome.reinforced,
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
    blind: clamp.blind,
  });

  return {
    id,
    claim,
    salience: clamp.salience,
    lifted: clamp.lifted,
    defaulted: clamp.defaulted,
    blind: clamp.blind,
    updates: resolved,
  };
}
