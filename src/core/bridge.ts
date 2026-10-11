/**
 * The remember→encode bridge — SEAMS.md items 1–3 close here.
 *
 * remember/ owns authorship mechanics and deliberately injects its gate;
 * encode/ owns the battery and deliberately holds no store handle. This file is
 * the one place the two are composed, so the composition rules live in exactly
 * one spot:
 *
 *   1. CHUNK-LEVEL GATED-MEANS-GATED: fallback-sweep chunks route through
 *      `encodeChunk`, whose all-rejected rule already returns zero durable
 *      effects. The bridge adds no second
 *      implementation — it routes.
 *   2. THE EMOTION EXEMPTION IS ENGINE-SET HERE, from the proposal's source: a
 *      session-end dump or an in-the-moment jot IS the experiencer writing, so
 *      its feelings are self-authored; a fallback sweep's are not. No author
 *      field can claim it (encode validates; remember's drafts can't carry it).
 *   3. Claimed salience, dimensions, and title-as-handle reach the battery, and
 *      a battery refusal is marked `refusedByDesign` so callers can tell a
 *      working gate from a broken one.
 *   4. SEAMS item H: EPISODES route through the same battery. `self/`'s default
 *      episode gate REFUSES everything ("an absent gate is not an open one"), and
 *      `episodeGate()` below is what makes that default unreachable in
 *      production. Episode ingestion was v1's most heavily gated surface — 66% of
 *      all gate fires (scar §2.7) — and a first-person reflection is not exempt
 *      from never durably encoding a credential.
 */
import { computeNovelty, encodeChunk, gateProposal } from "./encode/index.js";
import type {
  ChunkInput,
  ClaimedDimensions,
  EncodeOptions,
  EncodeResult,
  Proposal as EncodeProposal,
} from "./encode/index.js";
import type { GateFn, GateVerdict } from "./remember/index.js";
import type { SweepChunk } from "./remember/index.js";
import type { EpisodeGate } from "./self/index.js";

/**
 * Where the vectors come from — injected, because `encode/` "supplies the inputs
 * and holds no store handle" and this file holds no network client either. The
 * composition root binds all three members; absent, both gates behave exactly as
 * they did before one existed (novelty null, reason `no-chunk-vector`).
 *
 * Only the AUTHORED door takes one. `GateFn` may return a promise and
 * `submitProposal` awaits it, so that door can pay for a live embedding;
 * `EpisodeGate` is synchronous AND its verdict has nowhere to carry a novelty
 * number, so `episodeGate()` takes no source at all rather than computing one to
 * throw away (INTERFACE-GAPS §8c).
 *
 * Every member is asked for the text AS THE STORE WILL INDEX IT — the gate's
 * output, never the author's draft. That is what makes one embedding serve both
 * the novelty measurement and box 3, and it is also the egress rule: nothing
 * reaches this interface that has not already been through the battery.
 */
export interface VectorSource {
  /** Live: may reach the network. Only called where the caller can await. */
  vector(title: string | null, content: string): Promise<number[] | null>;
  /** E(m) — what this brain already holds near `vec`. Read-only. */
  context(vec: readonly number[]): readonly (readonly number[])[];
  /**
   * Fetch vectors for memories about to be written, in ONE batched call. The
   * sweep's only use: its mints happen in a loop, and a round trip each would be
   * the shape scar E1 warns about paid for one item at a time.
   */
  warm(items: readonly { title: string | null; content: string }[]): Promise<void>;
}

/**
 * Per-proposal gate for the authored paths (session-end dumps and jots).
 *
 * With a `VectorSource` the returned gate is ASYNC (a live embedding is one
 * network call), which `GateFn` permits and `remember/submitProposal` awaits.
 * WITHOUT one it stays synchronous — not for speed, but because a gate that
 * became a promise for every caller would silently break any caller reading
 * `verdict.ok` off the return value.
 *
 * **THE BATTERY RUNS BEFORE THE SOCKET DOES.** The first version of this
 * function embedded `input.content` — the author's RAW draft — and then gated
 * it, which put un-redacted text on the wire: a credential in a session-end dump
 * reached the embedding provider verbatim while the prose written to disk was
 * correctly redacted. The secrets gate is not ablatable and "durable" is not its
 * scope; egress is egress. So the order here is the order the sweep door already
 * used (`counterpart.applySweep` warms `result.accepted`, post-gate):
 *
 *   1. gate the proposal, with novelty NOT YET KNOWN;
 *   2. a refusal returns immediately — nothing refused is ever embedded;
 *   3. embed the GATE'S text, which is also the text the store will index;
 *   4. compute novelty against E(m) and attach it to the verdict.
 *
 * Step 1 costs nothing in correctness because the battery's accept/refuse never
 * consults novelty: `gateProposal` reads `input.novelty` only AFTER its refusal
 * branch has returned, to tag the accepted proposal's salience and to emit
 * `encode.blind`. Both of those are discarded here (this function returns a
 * `GateVerdict`, not an `AcceptedProposal`, and drops `outcome.events`), so the
 * placeholder cannot leak a wrong number into telemetry either — the novelty
 * that survives is the one attached in step 4.
 */
export function batteryGate(vectors?: VectorSource): GateFn {
  if (vectors === undefined) return (input) => verdictFor(input, computeNovelty(null, []));
  return async (input): Promise<GateVerdict> => {
    const verdict = verdictFor(input, computeNovelty(null, []));
    // A refused proposal is not a memory, so it is not a vector either — and it
    // is emphatically not something to send to a third party on the way out.
    if (!verdict.ok) return verdict;
    const vec = await vectors.vector(input.title, verdict.content);
    const novelty = computeNovelty(vec, vec === null ? [] : vectors.context(vec));
    return { ...verdict, novelty: novelty.novelty };
  };
}

/** The battery run itself, novelty already decided. One body, two entrances. */
function verdictFor(
  input: Parameters<GateFn>[0],
  novelty: ReturnType<typeof computeNovelty>,
): GateVerdict {
  const selfAuthored = input.source === "session-end" || input.source === "jot";
  const proposal: EncodeProposal = {
    ref: input.span?.hash ?? "authored",
    content: input.content,
    kind: input.kind,
    aliases: input.aliases,
    feeling:
      input.feeling === null
        ? null
        : {
            // remember says `feeling`, encode says `type` — same field.
            type: input.feeling.feeling,
            quote: input.feeling.quote,
            subject: input.feeling.subject,
          },
    selfAuthoredFeeling: selfAuthored,
    claimedSalience: input.claimed,
  };
  if (input.title !== null) {
    proposal.title = input.title;
    proposal.handles = [input.title];
  }
  const dims = dimensionsFrom(input.salience);
  if (dims !== null) proposal.dimensions = dims;

  // Novelty arrives DECIDED — computed against a real vector when the root wired
  // a source, null-with-reason when it did not (scar §2.9: never a default, in
  // either direction). Nothing here invents one.
  const outcome = gateProposal({
    proposal,
    span: input.span?.text ?? input.content,
    novelty,
  });
  const g = outcome.gated;
  if (g.accepted) {
    return {
      ok: true,
      content: g.content,
      aliases: g.aliases,
      // THE RECORDS TRAVEL NOW (replay INTERFACE-GAPS §2a). They used to be
      // dropped here on both arms, which left the authored door with two facts
      // — accepted, or refused-with-a-reason — and nothing durable to write.
      // Relayed, never read: this function decides nothing from them.
      records: g.records,
      channels: outcome.channels,
      feeling:
        g.feeling === null
          ? null
          : { feeling: g.feeling.type, quote: "", subject: g.feeling.subject },
      // NO `novelty` field here, deliberately: this function runs before any
      // vector exists. `batteryGate` attaches the computed dimension after the
      // gate has spoken, so an OMITTED field means "no source was wired" and an
      // explicit null means "a source tried and could not measure" — the two
      // records `remember/proposals.ts` documents on the field.
    };
  }
  return {
    ok: false,
    gate: g.reason,
    reason: g.blockedBy.join("+"),
    refusedByDesign: true,
    records: g.records,
    channels: outcome.channels,
    // The same list `reason` above joins. Both, deliberately: the string is what
    // a person reads in an event line, the array is what telemetry counts, and
    // splitting the string back apart at the reader is how a `+` in a future
    // reason word becomes a silently wrong count.
    blockedBy: [...g.blockedBy],
  };
}

/**
 * The author's dimensions, as given — a missing one reads 0, exactly as
 * `mint.ts` has always stored it.
 *
 * CHANGED 2026-09-26 (emotion part A, owner decision 1: "stop dropping a lone
 * `emotional` score"). This used to be all three or nothing, so a note that
 * said only `emotional: 0.9` reached the battery with no dimensions at all —
 * while `mint.ts`, reading the same draft, stored the 0.9 on the row. The two
 * readings of one note disagreed; now they agree. Padding a missing dimension
 * with 0 claims nothing the author did not say: 0 is what an unsaid dimension
 * has always been on the row. The SWEEP's intake (`counterpart.ts#applySweep`)
 * keeps its all-three rule on purpose — a retelling author's lone number is not
 * testimony, and it would now lift height and slow decay (physics §5.10).
 *
 * Still NOT manufactured from a stated feeling: `encode/emotion.ts#gateEmotion`
 * yields `{type, subject}` with no magnitude, and inventing one from "a feeling
 * was stated" is retro-typing emotion, which encode §3 forbids. Recorded
 * FEELINGS (the `feelings` table) carry their own strength and reach physics
 * beside the row (`feelingPeak`), not through this function.
 */
function dimensionsFrom(
  s: Partial<{ relevance: number; emotional: number; predictive: number }>,
): ClaimedDimensions | null {
  const given = [s.relevance, s.emotional, s.predictive].some((v) => typeof v === "number");
  if (!given) return null;
  const n = (v: number | undefined): number => (typeof v === "number" ? v : 0);
  return { relevance: n(s.relevance), emotional: n(s.emotional), predictive: n(s.predictive) };
}

/**
 * The sweep-chunk composition (SEAMS item 1): parsed fallback proposals for ONE
 * chunk go through `encodeChunk` — never `gateProposal` one at a time — so the
 * chunk-level all-rejected rule holds. Fallback proposals are never
 * self-authored: `selfAuthoredFeeling` is stripped here even if the interpreter
 * hallucinated it (the exemption is engine-set, and this engine says no).
 */
export function gateSweepChunk(
  chunk: SweepChunk,
  proposals: readonly EncodeProposal[],
  day: number,
  extras: Omit<ChunkInput, "chunkRef" | "span" | "proposals" | "day"> = {},
  opts: EncodeOptions = {},
): EncodeResult {
  const stripped = proposals.map((p) => ({ ...p, selfAuthoredFeeling: false }));
  const input: ChunkInput = {
    ...extras,
    chunkRef: `sweep:${chunk.index}`,
    span: chunk.spans.map((s) => s.text).join("\n"),
    proposals: stripped,
    day,
  };
  return encodeChunk(input, opts);
}

/**
 * The episode gate (SEAMS item H). Episodes are self-authored by definition, so
 * the emotion exemption applies exactly as it does to a session-end dump; the
 * handles are the episode's named people and places, and a credential in one
 * refuses the whole ingestion (the ops rule: a credential must never become an
 * entity the store indexes).
 *
 * A body secret is REDACTED, not fatal, and the redacted text comes back on the
 * verdict — the same rule every other ingestion path follows.
 */
export function episodeGate(): EpisodeGate {
  return (input) => {
    const proposal: EncodeProposal = {
      ref: `episode:${input.sessionId}`,
      content: input.text,
      kind: "self",
      selfAuthoredFeeling: true,
    };
    if (input.handles.length > 0) proposal.handles = [...input.handles];
    // NO VECTOR SOURCE, and the reason is structural rather than a shortcut:
    // `EpisodeGateVerdict` has nowhere to put a novelty number, so anything
    // computed here would be spent on a gate decision that never reads it and
    // then dropped — exactly the decorative wire §8d exists to describe. An
    // earlier draft took a `VectorSource` and looked one up anyway; it was
    // removed rather than kept as a comment, and the door is filed in
    // INTERFACE-GAPS §8c as blind until the verdict type can carry the value.
    const outcome = gateProposal({
      proposal,
      span: input.text,
      novelty: computeNovelty(null, []),
    });
    const g = outcome.gated;
    if (g.accepted) return { ok: true, text: g.content };
    return { ok: false, gate: g.reason, reason: g.blockedBy.join("+") };
  };
}
