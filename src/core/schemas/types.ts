/**
 * `schemas/` — the vocabulary of semantic memory.
 *
 * Three ROLES share one prose family (`type: "schema"`), because what
 * distinguishes them is lifecycle, not shape (behavioral-spec §4.2):
 *
 *   - `entity`        the organizing unit — a person, a place, a skill, a
 *                     project/system, the self. Born by mention, dies by decay.
 *   - `belief`        a statement held about an entity. Revised only by physics
 *                     §5.6 arithmetic; there is no edit verb (CONTRACT §5 G1).
 *   - `current-state` timestamped status about an entity. Refused on the
 *                     identity schema — the ~72 KB lesson (CONTRACT §3).
 *
 * Every row's `kind` is the ENTITY's kind, fixed at birth and never re-derived,
 * so a belief about a person moves at person inertia (iota 0.8) and project
 * status on an entity moves at entity inertia (0.5) — "a loosening chosen out
 * loud" (§4.3).
 */

import type { Band, Kind, Salience } from "../types.js";

// ---------------------------------------------------------------------------
// Roles and kinds
// ---------------------------------------------------------------------------

export const SCHEMA_ROLES = ["entity", "belief", "current-state"] as const;
export type SchemaRole = (typeof SCHEMA_ROLES)[number];

/**
 * The kinds birth-by-mention may mint. `self` is absent DELIBERATELY and
 * independently of every other check — "one identity core; a second is a
 * category error no evidence could justify" (§14.3, CONTRACT §5 G5). `fact` is
 * absent because a fact is a memory, not a thing memories attach to.
 */
export const BIRTH_KINDS = ["person", "entity", "skill", "place"] as const;
export type BirthKind = (typeof BIRTH_KINDS)[number];

export function isBirthKind(kind: Kind): kind is BirthKind {
  return (BIRTH_KINDS as readonly string[]).includes(kind);
}

// ---------------------------------------------------------------------------
// Telemetry — ids, hashes, counts, kinds, reasons. NEVER a name, NEVER a body.
// ---------------------------------------------------------------------------

/**
 * A schema NAME is author content that the store indexes: it is logged as a
 * hash, exactly the way `encode/` logs a dropped alias by index rather than by
 * text. The proposal is logged, not only the outcome (scar §2.4).
 */
export interface SchemaEvent {
  at: number;
  event: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

// ---------------------------------------------------------------------------
// Birth by mention
// ---------------------------------------------------------------------------

/**
 * Outcomes of one mention. `born` and `existing` are both successes and are
 * DIFFERENT RECORDS; every other value is a loud refusal with its ground named
 * (scar §2.4 — v1's zero births were ambiguous precisely because "refused" and
 * "never proposed" were indistinguishable).
 */
export type BirthReason =
  | "born"
  | "existing"
  | "second-self-refused"
  | "kind-not-allowed"
  | "name-empty"
  | "name-is-secret"
  | "name-not-in-source"
  | "ambiguous-existing-name"
  | "collision-exact-different-kind"
  | "collision-near"
  | "birth-cap-per-chunk";

export interface MentionInput {
  /** The name as the source said it. Matched against the source verbatim. */
  name: string;
  kind: Kind;
  /** The span the name must occur in, as a whole word (§5 G2). */
  source: string;
  /** The chunk this mention came from — the birth cap counts by it (§5 G3). */
  chunkRef: string;
  /** Verified individually and DROPPED rather than fatal (§4). */
  aliases?: readonly string[];
  /** The lived day. Explicit, never read from a wall clock (scar E8). */
  day: number;
}

export interface BirthOutcome {
  /** True for both `born` and `existing`: a mention that found its home. */
  ok: boolean;
  reason: BirthReason;
  /** The entity this mention resolved to, when there is one. */
  id: string | null;
  born: boolean;
  /** Ids the refusal collided with — a near collision names what it hit. */
  collidedWith: string[];
  /** Aliases the alias gate dropped, BY INDEX (author content, §5 G10). */
  droppedAliases: { index: number; reason: string }[];
  keptAliases: string[];
  /** Credited reinforcement on a re-mention, when one landed. */
  reinforced: boolean;
}

// ---------------------------------------------------------------------------
// Beliefs and current state
/**
 * A saved memory's text, checked for the names of live cards (NOTES §15). It
 * refreshes cards that already exist and never births one.
 */
export interface NamedInTextInput {
  /** The memory's title and body. */
  text: string;
  /** The lived day of the save. */
  day: number;
  /** The memory the text came from, for the event trail. */
  ref: string;
  /** Cards not to credit here — the title path already had its turn with them. */
  except?: readonly string[];
}

export interface NamedInTextReport {
  /** Cards named in the text and credited with a use. */
  credited: string[];
  /** Cards named but not credited: physics refused (birth day, already used today). */
  refused: string[];
  /** New cards born for faded cards the text named: each one's return. */
  revived: string[];
  /** Handles in the text held by more than one card, live or faded; none of those is credited or revived. */
  ambiguous: number;
}

// ---------------------------------------------------------------------------

export interface DimensionsInput {
  relevance: number;
  emotional: number;
  predictive: number;
}

export interface BeliefInput {
  entityId: string;
  statement: string;
  day: number;
  dimensions?: DimensionsInput;
  /** A FLOOR, never a value (physics §5.1). Clamped at the mint — and capped
   *  by the CHANNEL's ceiling (the authorship doctrine, owner ruling
   *  2026-08-29): a fallback author's claim cuts to `SWEEP_CLAIM_CEILING`. */
  claimedSalience?: number | null;
  /** Who is placing this belief. ENGINE-SET by the composition, defaulting
   *  "authored"; the caller placing on behalf of a transcript sweep MUST pass
   *  "fallback", and the migrate tool passes "migrated" (full floor — lived
   *  v1 state). Persisted as the element's `source`. */
  channel?: "authored" | "fallback" | "episode" | "accommodation" | "migrated";
  protected?: boolean;
  /** Provenance: the memory ids that grounded this belief. */
  groundedIn?: readonly string[];
}

export type BeliefAddReason =
  | "added"
  | "entity-unknown"
  | "entity-archived"
  | "statement-empty";

export interface BeliefOutcome {
  ok: boolean;
  reason: BeliefAddReason;
  id: string | null;
}

export interface CurrentStateInput {
  entityId: string;
  statement: string;
  day: number;
  /** When it was true, at stated precision. Defaults to the store's date. */
  statedOn?: string;
  dimensions?: DimensionsInput;
  claimedSalience?: number | null;
  /** See `BeliefInput.channel` — same doctrine, same ceiling. */
  channel?: "authored" | "fallback" | "episode" | "accommodation" | "migrated";
}

/**
 * `status-on-identity-refused` IS the ~72 KB lesson, mechanized at this seam:
 * v1 rendered ~68-72 KB of dated project status into every self-keyed prompt,
 * and 14 of self's 19 active beliefs were about projects with no retrieval key.
 * The refusal names where the row belongs instead.
 */
export type PlacementReason =
  | "placed"
  | "entity-unknown"
  | "entity-archived"
  | "statement-empty"
  | "status-on-identity-refused";

export interface PlacementOutcome {
  ok: boolean;
  reason: PlacementReason;
  id: string | null;
  /** On refusal: the kinds of home this row DOES have. Advice, not a redirect. */
  belongsOn: BirthKind[] | null;
}

// ---------------------------------------------------------------------------
// Revision
// ---------------------------------------------------------------------------

export interface ChallengeInput {
  /** The `updates:` DECLARATION, as written. May name a superseded belief. */
  updates: string;
  /** The challenging memory's id. Must already be in the store. */
  challengerId: string;
  day: number;
  /** The successor's prose. Defaults to the challenger's own body. */
  statement?: string;
}

/** physics' own `ChallengeReason` values, plus this module's seam refusals. */
export type RevisionReason =
  | "revised"
  | "below-bar"
  | "no-declared-target"
  | "target-mismatch"
  | "already-challenged-today"
  | "stale-day"
  | "target-unresolvable"
  | "target-not-a-belief"
  | "target-archived"
  | "protected-refuses-revision"
  | "challenger-unknown";

/**
 * A CURRENT-STATE row is a "now" fact, and the owner's ruling (2026-09-04) is
 * that a resolved `updates:` against one REPLACES it immediately, with lineage —
 * no pressure to accumulate. World-state flips on one clear correction (§4.3),
 * and pressure on a fact that is already wrong would only delay the correction
 * while the stale row kept rendering into slices.
 */
export type ReplacementReason =
  | "replaced"
  | "no-declared-target"
  | "target-unresolvable"
  | "target-not-current-state"
  | "target-archived"
  | "protected-refuses-revision"
  | "challenger-unknown";

export interface ReplacementOutcome {
  ok: boolean;
  reason: ReplacementReason;
  /** The id the declaration resolved to after following the supersede chain. */
  targetId: string | null;
  retargeted: boolean;
  successorId: string | null;
}

export interface PressureIncrement {
  readonly event: "revision.pressure";
  readonly targetId: string;
  readonly day: number;
  readonly challengerId: string;
  readonly force: number;
  readonly pressureAfter: number;
  readonly bar: number;
}

export interface RevisionOutcome {
  verdict: "revise" | "hold";
  reason: RevisionReason;
  /** Did the pressure field on the target row actually move? */
  credited: boolean;
  /** The id the declaration resolved to after following the supersede chain. */
  targetId: string | null;
  /** True when the declaration named a superseded belief and was retargeted. */
  retargeted: boolean;
  successorId: string | null;
  force: number;
  pressureBefore: number;
  pressureAfter: number;
  bar: number;
  increment: PressureIncrement | null;
}

// ---------------------------------------------------------------------------
// Death by decay
// ---------------------------------------------------------------------------

export type FadeReason =
  | "faded"
  | "not-an-entity"
  | "already-archived"
  | "above-floor"
  | "dwell-too-short"
  | "band-not-episodic"
  | "protected"
  | "in-live-revision-chain"
  /** Physics' sixth gate (a repeating reminder date). The card fade never asks it. */
  | "recurring"
  | "has-live-attached-elements"
  /** The identity core is not a card that fades. */
  | "identity-core"
  /** Past physics' dwell, not yet past this kind's longer one (`FADE.LIVED_DWELL_FACTOR_BY_KIND`). */
  | "kind-dwell-too-short"
  /** Not enough calendar days since last use (`FADE.CALENDAR_FLOOR_DAYS*`). */
  | "calendar-floor-not-passed";

export interface FadeVerdict {
  fade: boolean;
  reason: FadeReason;
  /** EVERY blocker, not just the first. */
  blockedBy: FadeReason[];
  strength: number;
  band: Band;
  dwellDays: number;
  attached: number;
  /** Lived days of quiet this card's kind needs (physics' dwell × the kind's factor). */
  livedFloorDays: number;
  /**
   * Calendar days since last use, as a LOWER BOUND — never a guess that could
   * run long: the largest of the lived-day gap (each lived day is a distinct
   * date), the birth date when birth was the last use, and a sweep anchor no
   * older than the last use (NOTES §14).
   */
  calendarDays: number;
  /** Which of the three set `calendarDays`. */
  calendarSource: "lived-days" | "birth-date" | "anchor";
  calendarFloorDays: number;
}

export interface FadeSweepOptions {
  /** The sweep's calendar date. Defaults to `store.today()`. */
  date?: string;
  /** Compute every verdict and write nothing — no archive, no anchor. The observer's report. */
  dryRun?: boolean;
  /** Examine at most this many live cards. There is no cursor, so the same cards
   *  come first every sweep; sleep's budget is sized so a personal store never hits it. */
  limit?: number;
}

export interface FadeReport {
  day: number;
  date: string;
  dryRun: boolean;
  examined: number;
  /** Faded this sweep — or, on a dry run, would have. Ids only. */
  faded: string[];
  /** Every blocker, counted, across the cards that did not fade. */
  blocked: Record<string, number>;
  /** Calendar anchors written: cards seen for the first time, or used since the last anchor. */
  anchored: number;
  /** Live cards not examined because `limit` ran out. */
  skippedForLimit: number;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface EntityView {
  id: string;
  name: string;
  kind: Kind;
  aliases: string[];
  archived: boolean;
  archivedReason: string | null;
  birthDay: number;
}

export interface ElementView {
  id: string;
  entityId: string;
  role: SchemaRole;
  statement: string;
  kind: Kind;
  archived: boolean;
  supersededBy: string | null;
  protected: boolean;
  salience: Salience;
  /** Present on current-state rows only: when the status was stated. */
  statedOn?: string;
  statedOnDay?: number;
}

/**
 * A schema slice as `encode/preselect.ts` consumes it, plus the elision count
 * guarantee 8 requires. Beliefs and current state are VERBATIM — a paraphrase
 * of a belief cannot be honestly confirmed or contradicted (§8 G7).
 */
/** One element on a card: the id is the ADDRESS an `updates:` declaration can
 *  name, the statement is verbatim (§8 G7 — a paraphrase cannot be honestly
 *  contradicted). */
export interface SliceElement {
  id: string;
  statement: string;
}

export interface SchemaSliceOut {
  id: string;
  name: string;
  aliases: string[];
  beliefs: SliceElement[];
  currentState: SliceElement[];
  /**
   * Announced as a count, never a silent omission (§5 G8). Nonzero when the
   * caller asked for the interpreter's view: protected elements never render
   * into the falsification path (§14.1 G2), and each one filtered is counted
   * here rather than silently absent.
   */
  elided: number;
}

export interface LineageStep {
  id: string;
  seq: number;
  reason: string;
  day: number;
  successorId: string | null;
}

/** What the dashboard's story view reads (constitution line 16). */
export interface BeliefStory {
  beliefId: string;
  /** The live head of the chain — `beliefId` itself when nothing superseded it. */
  headId: string;
  lineage: LineageStep[];
  pressure: number;
  lastChallengedDay: number | null;
  bar: number;
  strength: number;
  /** Every credited increment this session logged, oldest first. */
  increments: PressureIncrement[];
}

/**
 * Guarantee 13: every kind reports created-versus-exited counts. A kind whose
 * exit count is zero after the bake-in window is a DEFECT TO INVESTIGATE, not a
 * base rate to accept (scar §2.17) — hence the flag, which is deliberately not
 * called `ok`.
 */
export interface LifecycleRow {
  kind: Kind;
  created: number;
  exited: number;
  noExitsYet: boolean;
}
