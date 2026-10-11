/**
 * `encode/` — the shared vocabulary of the bouncer.
 *
 * A PROPOSAL is what an author declares it learned. It is not a memory: it has no
 * id, no strength, no row. Everything here describes the pre-durable world, which
 * is the whole point of the module — gates run on proposals, before anything is
 * durable (CONTRACT §5 G2, behavioral-spec §3 G3).
 */

import type { Kind, Salience } from "../types.js";

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

/**
 * A typed, attributed feeling as DECLARED. Absent means null, never neutral
 * (CONTRACT §3, behavioral-spec §4.2 G5). Encode never assigns a type to an
 * untyped feeling — retro-typing is forbidden.
 */
export interface Feeling {
  /** The type word. Empty/blank is NOT "neutral" — it is a refusal. */
  type: string;
  /** The cited quote the span must contain. STRIPPED before durability. */
  quote: string;
  /** Who felt it. `SELF_SUBJECT` is the only value the exemption recognizes. */
  subject: string;
}

/** The feeling as it survives into durable state: the quote is gone (§3). */
export interface DurableFeeling {
  type: string;
  subject: string;
}

/** The one subject the emotion exemption recognizes. It cannot widen (§5 G5). */
export const SELF_SUBJECT = "self";

/**
 * The author-supplied salience dimensions. `novelty` is deliberately absent:
 * novelty is COMPUTED as prediction error against the schema slice, never
 * claimed (CONTRACT §3, physics §5.1).
 */
export interface ClaimedDimensions {
  relevance: number;
  emotional: number;
  predictive: number;
}

export interface Proposal {
  /** The author's handle for this proposal inside its chunk. Not an id. */
  ref: string;
  content: string;
  kind: Kind;
  scope?: string;
  title?: string;
  /** The author's claimed AGGREGATE salience — a FLOOR, never a value (physics §5.1). */
  claimedSalience?: number | null;
  dimensions?: ClaimedDimensions;
  feeling?: Feeling | null;
  aliases?: readonly string[];
  /**
   * Names and handles the operation would index (the ops rule, §3): a secret in a
   * NAME rejects the whole operation — "a credential must never become an entity
   * the store indexes" — and a matching key that never persists is exempt from
   * hedging, because a name is not a claim.
   */
  handles?: readonly string[];
  /** The declared revision target. Validated by `remember/`, not here. */
  updates?: string | null;
  /** An open loop is an ordinary memory with a flag (CONTRACT §4). */
  unresolved?: boolean;
  /**
   * The emotion exemption, SET PER PROPOSAL BY THE ENGINE THAT MINTED IT
   * (§5 G5). Encode VALIDATES it against this proposal's own span and subject;
   * encode never infers it from content. A claim about someone else's interior
   * always takes the ordinary path.
   */
  selfAuthoredFeeling?: boolean;
}

// ---------------------------------------------------------------------------
// Gate telemetry
// ---------------------------------------------------------------------------

/** The five checks. Every one of them runs on every proposal (§5 G2). */
export const GATES = ["secrets", "precision", "aliases", "emotion", "floor"] as const;
export type GateName = (typeof GATES)[number];

/** Channels are not gates: they are switchable capabilities beside the battery. */
export const CHANNELS = ["emotion-classifier", "semantic-preselection"] as const;
export type ChannelName = (typeof CHANNELS)[number];

/**
 * Three distinct records per gate, plus the two ways of not acting (§5 G11,
 * scar §2.4 — "did not fire", "was never asked", and "was switched off" are
 * different facts, and the by-design case is flagged AT THE REFUSAL SITE).
 *
 *  - `clear`             ran; found nothing to act on
 *  - `fired`             ran; content or a declared element was changed
 *  - `rejected`          ran; the proposal is refused (terminal)
 *  - `refused-by-design` ran; a declared element was dropped because the design
 *                        forbids it — not an error, not a bug
 *  - `not-invoked`       ran; nothing of this gate's kind was declared
 *  - `stood-down`        deliberately switched off
 */
export type GateStatus =
  | "clear"
  | "fired"
  | "rejected"
  | "refused-by-design"
  | "not-invoked"
  | "stood-down";

/**
 * The secrets gate's status union. `stood-down` IS NOT REPRESENTABLE (§5 G1):
 * the non-ablatable guarantee is enforced in the type system, not by a comment.
 */
export type SecretsGateStatus = Exclude<GateStatus, "stood-down">;

/** A channel's state. "off" is silence; "skipped" is loud (§5 G8). */
export type ChannelState = "ran" | "off" | "skipped";

export interface GateRecordBase {
  status: GateStatus;
  /** Why this status. Always present — a bare status cannot be told from a bug. */
  reason: string;
  /** Whether this gate can ever be switched off. False for all five checks. */
  ablatable: boolean;
}

/** Content-by-reference: family + count. NEVER the secret, and never its hash —
 *  hashing a low-entropy credential is reversible (store §16 G9). */
export interface SecretFinding {
  family: string;
  count: number;
  /** Where it was found: body, an alias, a handle, a feeling field, rendered context. */
  site: string;
}

export interface SecretsGateRecord extends GateRecordBase {
  gate: "secrets";
  status: SecretsGateStatus;
  ablatable: false;
  findings: SecretFinding[];
  /** Hash of the REDACTED text — safe to log, unlike the secret (§5 G10). */
  contentHash: string;
}

export interface PrecisionGateRecord extends GateRecordBase {
  gate: "precision";
  /** What was softened, by kind and count. Never the quoted text itself. */
  hedges: { kind: string; count: number }[];
}

export interface AliasGateRecord extends GateRecordBase {
  gate: "aliases";
  declared: number;
  kept: number;
  /** Per-alias verdicts, by position — an alias is author text, so never logged. */
  dropped: { index: number; reason: string }[];
}

export interface EmotionGateRecord extends GateRecordBase {
  gate: "emotion";
  /** True only when the engine's exemption was set AND validated here. */
  exemption: boolean;
  /** The type word survives into telemetry: it is a closed vocabulary, not content. */
  type: string | null;
  quoteStripped: boolean;
}

export interface FloorGateRecord extends GateRecordBase {
  gate: "floor";
  chars: number;
  words: number;
  minChars: number;
  minWords: number;
}

export type GateRecord =
  | SecretsGateRecord
  | PrecisionGateRecord
  | AliasGateRecord
  | EmotionGateRecord
  | FloorGateRecord;

export interface ChannelRecord {
  channel: ChannelName;
  state: ChannelState;
  reason: string;
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export type RefusalReason =
  | "secret-in-name"
  | "empty-after-redaction"
  | "content-empty"
  | "content-stub"
  | "content-too-short"
  | "content-too-few-words";

export interface AcceptedProposal {
  ref: string;
  accepted: true;
  kind: Kind;
  /** Redacted and hedged. This is what may become canonical. */
  content: string;
  contentHash: string;
  title?: string;
  scope?: string;
  aliases: string[];
  feeling: DurableFeeling | null;
  salience: Salience;
  updates: string | null;
  unresolved: boolean;
  records: GateRecord[];
}

export interface RefusedProposal {
  ref: string;
  accepted: false;
  kind: Kind;
  /** The FIRST blocking reason. `blockedBy` carries every one of them. */
  reason: RefusalReason;
  blockedBy: RefusalReason[];
  records: GateRecord[];
}

export type GatedProposal = AcceptedProposal | RefusedProposal;

// ---------------------------------------------------------------------------
// Durable-state intents — the whole surface by which encode can move anything
// ---------------------------------------------------------------------------

/**
 * Encode itself writes NOTHING. It returns INTENTS for its caller to apply, and
 * a fully-gated chunk returns none of them (§5 G3, scar §7's element-level rider:
 * "nothing from a rejected chunk may touch warmth, gradient, occurrences, or
 * ledger evidence").
 *
 * Every kind of durable state a chunk could move is named here, so "moves zero
 * durable state" is asserted per state kind rather than per happy path.
 */
export type DurableEffect =
  | { effect: "memory.create"; ref: string; kind: Kind; contentHash: string }
  | { effect: "entity.mention"; schemaId: string; ref: string }
  /** `targetId` is the DECLARATION as written — encode resolves nothing. Its
   *  applier is `core/revision.ts`, one apply per effect (see `chunk.ts`). */
  | { effect: "revision.challenge"; targetId: string; ref: string };

// ---------------------------------------------------------------------------
// Events — content-by-reference, always (§5 G10)
// ---------------------------------------------------------------------------

export interface EncodeEvent {
  event: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export class EncodeError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown>;
  constructor(code: string, detail: Record<string, unknown> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "EncodeError";
    this.code = code;
    this.detail = detail;
  }
}
