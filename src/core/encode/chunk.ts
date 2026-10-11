/**
 * The chunk — the one entrance, and the place "gated means gated" is enforced.
 *
 * A chunk is a unit of experience with proposals attached. `encodeChunk` is the
 * ONLY function in this module that produces `DurableEffect`s, which is what makes
 * scar §7's acceptance criterion enumerable rather than arguable: one chokepoint,
 * and a rejected input moves zero durable state, ASSERTED PER STATE KIND.
 *
 * **A fully-gated chunk moves NO durable state — not strength, not `uses`, not a
 * revision, not an entity mention.** The rule is stated at the chunk level rather
 * than the proposal level because of v1: once gradient reinforcement went live,
 * prediction checks were found to bypass the gate, so *a chunk the gates had
 * rejected could still reinforce schema elements* as an element-level side effect
 * (scar §7b). Ruled strict: "the lost reinforcement signal is affordable; the leak
 * in the non-ablatable wall is not." (This module carried a `predictionChecks`
 * channel, dropped when fully gated, until 2026-10-09; nothing ever fed it, so it
 * was removed — encode NOTES.)
 *
 * Deliberately scoped to ALL-REJECTED. A chunk with one survivor was gated in
 * part, not refused (§3 G2) — and then only the survivor's effects exist.
 *
 * Encode writes nothing itself. It returns intents; `remember/` applies them. That
 * is why this file imports `hashText` from the store's prose module and NOTHING
 * from the store's write surface.
 */

import { gateProposal } from "./battery.js";
import type { BatteryOptions } from "./battery.js";
import { preselectSchemas } from "./preselect.js";
import type { Preselection, SchemaSlice } from "./preselect.js";
import { computeNovelty } from "./salience.js";
import type { NoveltyResult } from "./salience.js";
import { occursAsWholeWord } from "./words.js";
import type {
  AcceptedProposal,
  ChannelRecord,
  DurableEffect,
  EncodeEvent,
  GatedProposal,
  Proposal,
  RefusedProposal,
} from "./types.js";

export interface ChunkInput {
  /** The caller's handle for this chunk — a hash or a span id, never its text. */
  chunkRef: string;
  /** The source span. Used to check claims against; never becomes durable here. */
  span: string;
  proposals: readonly Proposal[];
  /** The schema slice the proposals were encoded against. */
  schemas?: readonly SchemaSlice[];
  /** Supplied by the caller. Absent ⇒ novelty is null and the chunk is blind. */
  chunkVector?: readonly number[] | null;
  /** The lived day (active-day clock, scar E8). Recorded, never derived here. */
  day: number;
  /**
   * Observer stance (docs/observer-mode.md, scar E7). An instrument leaves the
   * store as it found it: encode still computes — a read-only instrument may
   * measure the gates — but it emits NO effects, and the stand-down is logged so
   * a stood-down instrument stays distinguishable from a broken hook.
   */
  observer?: boolean;
}

export interface EncodeOptions extends BatteryOptions {
  semanticCap?: number;
  semanticFloor?: number;
}

export interface EncodeResult {
  chunkRef: string;
  day: number;
  accepted: AcceptedProposal[];
  refused: RefusedProposal[];
  /** True iff there were proposals and every one of them was refused. */
  fullyGated: boolean;
  /** EMPTY when `fullyGated` (or under observer). The complete list of ways this
   *  chunk may move durable state — there is no second channel. */
  effects: DurableEffect[];
  preselection: Preselection;
  novelty: NoveltyResult;
  channels: ChannelRecord[];
  events: EncodeEvent[];
  observer: boolean;
}

export function encodeChunk(input: ChunkInput, opts: EncodeOptions = {}): EncodeResult {
  const schemas = input.schemas ?? [];
  const events: EncodeEvent[] = [];

  // ── preselection, ONCE per chunk (§5 G7) ──────────────────────────────────
  const preselectInput: Parameters<typeof preselectSchemas>[0] = {
    chunkRef: input.chunkRef,
    span: input.span,
    schemas,
  };
  if (input.chunkVector !== undefined) preselectInput.chunkVector = input.chunkVector;
  if (opts.semanticCap !== undefined) preselectInput.semanticCap = opts.semanticCap;
  if (opts.semanticFloor !== undefined) preselectInput.semanticFloor = opts.semanticFloor;
  const preselection = preselectSchemas(preselectInput);
  events.push(...preselection.events);

  // ── novelty as prediction error, against the SHOWN slice ──────────────────
  // Blindness here and blindness in preselection are the same fact seen twice:
  // novelty is error against what the author could see, so a chunk shown nothing
  // has no error to measure — null, recorded, never defaulted.
  const shownIds = new Set(preselection.shown.map((s) => s.id));
  const contextVectors = schemas
    .filter((s) => shownIds.has(s.id))
    .map((s) => s.vector)
    .filter((v): v is readonly number[] => v !== null && v !== undefined && v.length > 0);
  const novelty = computeNovelty(input.chunkVector, contextVectors);

  // ── the battery, per proposal ─────────────────────────────────────────────
  const gated: GatedProposal[] = [];
  const channels: ChannelRecord[] = [preselection.semantic];
  for (const proposal of input.proposals) {
    const outcome = gateProposal({ proposal, span: input.span, novelty }, opts);
    gated.push(outcome.gated);
    events.push(...outcome.events);
    for (const c of outcome.channels) {
      if (!channels.some((existing) => existing.channel === c.channel)) channels.push(c);
    }
  }

  const accepted = gated.filter((g): g is AcceptedProposal => g.accepted);
  const refused = gated.filter((g): g is RefusedProposal => !g.accepted);
  const fullyGated = input.proposals.length > 0 && accepted.length === 0;
  const observer = input.observer === true;

  // ── the effects — and the two ways there are none ─────────────────────────
  let effects: DurableEffect[] = [];

  if (fullyGated) {
    events.push({
      event: "encode.fullyGated",
      ref: input.chunkRef,
      data: {
        proposals: input.proposals.length,
        refused: refused.length,
      },
    });
  } else if (observer) {
    events.push({
      event: "encode.observer.standdown",
      ref: input.chunkRef,
      data: { accepted: accepted.length, suppressedEffects: true },
    });
  } else {
    effects = buildEffects(accepted, preselection, schemas);
  }

  events.push({
    event: "encode.chunk",
    ref: input.chunkRef,
    data: {
      day: input.day,
      proposals: input.proposals.length,
      accepted: accepted.length,
      refused: refused.length,
      fullyGated,
      blind: preselection.blind,
      noveltyReason: novelty.reason,
      effects: effects.length,
      observer,
    },
  });

  return {
    chunkRef: input.chunkRef,
    day: input.day,
    accepted,
    refused,
    fullyGated,
    effects,
    preselection,
    novelty,
    channels,
    events,
    observer,
  };
}

/**
 * Every durable-state intent an accepted proposal earns, and no others. Entity
 * mentions are computed from the ACCEPTED (redacted, hedged) content by the one
 * whole-word rule — a mention that only existed in redacted text is not a mention.
 */
function buildEffects(
  accepted: readonly AcceptedProposal[],
  preselection: Preselection,
  schemas: readonly SchemaSlice[],
): DurableEffect[] {
  const effects: DurableEffect[] = [];
  const byId = new Map(schemas.map((s) => [s.id, s]));

  for (const a of accepted) {
    effects.push({
      effect: "memory.create",
      ref: a.ref,
      kind: a.kind,
      contentHash: a.contentHash,
    });
    for (const sel of preselection.shown) {
      const s = byId.get(sel.id);
      if (s === undefined) continue;
      // The lexical channel matched the SPAN. A mention is durable state, so it
      // must survive in what was actually ACCEPTED — the redacted, hedged text —
      // or it is a mention of a credential we just removed.
      const terms = [s.name, ...(s.aliases ?? [])];
      if (terms.some((t) => occursAsWholeWord(a.content, t))) {
        effects.push({ effect: "entity.mention", schemaId: sel.id, ref: a.ref });
      }
    }
    if (a.updates !== null) {
      // `targetId` is the DECLARATION, exactly as the author wrote it — encode
      // resolves nothing and holds no store. The applier is
      // `src/core/revision.ts`, reached once per effect from every mint door,
      // and it is what walks the declaration to a real row (`remember/` matches
      // text to a candidate; the store walks an id through the supersede chain).
      //
      // So the correspondence this list promises is ONE APPLY PER DECLARATION,
      // not one movement per effect: a declaration that resolves to nothing
      // lands as a named `target-unresolvable` refusal, and one that hit an
      // ordinary memory lands as a link. (The applier is reached slightly more
      // often than this list is long: a proposal that declared NOTHING but whose
      // content the engine matched to an existing memory also arrives there, and
      // is a named no-move — a restatement is a confirmation, never a challenge.
      // No effect is missing, because nothing moved.) What the chunk MOVED is
      // the applier's own record. A fully gated chunk accepts nothing, so it
      // emits no effect and applies none — and an observer's emits none either.
      effects.push({ effect: "revision.challenge", targetId: a.updates, ref: a.ref });
    }
  }
  return effects;
}

/** Re-exported for callers that want the mention rule without the whole chunk. */
export function mentionsSchema(content: string, term: string): boolean {
  return occursAsWholeWord(content, term);
}
