/**
 * `encode/` — attention plus amygdala tagging. The bouncer.
 *
 * What gets in: the gate battery every proposal passes, the salience tags it
 * carries, and the computed novelty that makes prediction error a number.
 * Implements CONTRACT.md; ambiguities and the places the contract was silent are
 * recorded in NOTES.md.
 *
 * THREE PROPERTIES HOLD ACROSS THE WHOLE MODULE, and each is enforced rather than
 * asserted:
 *
 * 1. **The secrets gate is not ablatable.** No parameter anywhere disables it,
 *    `SecretsGateStatus` cannot spell `stood-down`, `assertNoBypassOption`
 *    refuses an invented option key at runtime, and EVERY export below that can
 *    return author-supplied text leaves through `redactSecrets` — whatever order
 *    a caller invoked things in.
 * 2. **Encode writes nothing.** It computes verdicts and returns `DurableEffect`
 *    intents for `remember/` to apply. It imports `hashText` from the store's
 *    prose module and nothing at all from the store's write surface — so "a
 *    fully-gated proposal moves zero durable state" is structural, and the test
 *    asserts it both behaviorally and by source-scan.
 * 3. **No model calls, no fetching.** Vectors are inputs. A missing vector
 *    degrades a channel loudly; it never triggers a lookup.
 *
 * THE PUBLIC SURFACE IS ENUMERATED, NOT SPILLED. Every re-export below is named
 * one at a time, because `test/encode.test.ts` asserts a total classification of
 * this surface: every export is either a text path that must redact, a verdict
 * function, a shared definition, or a constant. A new export with no
 * classification fails the suite rather than slipping in ungated (scar §7: one
 * un-gated entrance defeats the gate).
 *
 * `normalizeForFloor` and `stripRedactions` are deliberately NOT exported: both
 * return author text with the redaction marks taken back off, which is exactly
 * the shape a leak has. They stay internal to the floor.
 */

// ── the vocabulary ──────────────────────────────────────────────────────────
export { GATES, CHANNELS, SELF_SUBJECT, EncodeError } from "./types.js";
export type {
  AcceptedProposal,
  AliasGateRecord,
  ChannelName,
  ChannelRecord,
  ChannelState,
  ClaimedDimensions,
  DurableEffect,
  DurableFeeling,
  EmotionGateRecord,
  EncodeEvent,
  Feeling,
  FloorGateRecord,
  GateName,
  GateRecord,
  GateRecordBase,
  GateStatus,
  GatedProposal,
  PrecisionGateRecord,
  Proposal,
  RefusalReason,
  RefusedProposal,
  SecretFinding,
  SecretsGateRecord,
  SecretsGateStatus,
} from "./types.js";

export { TUNABLES } from "./tunables.js";

// ── the ONE whole-word definition (§8 G3 — shared with schema birth) ────────
export { escapeRegExp, wholeWordRegex, occursAsWholeWord, countWholeWord } from "./words.js";

// ── the non-ablatable gate ─────────────────────────────────────────────────
export { REDACTION_MARK, SECRET_FAMILIES, scanSecrets, redactSecrets, containsSecret } from "./secrets.js";
export type { SecretPattern, SecretsScan } from "./secrets.js";

// ── the other four checks ──────────────────────────────────────────────────
export { hedgePrecision } from "./precision.js";
export type { PrecisionResult } from "./precision.js";
export { gateAliases } from "./aliases.js";
export type { AliasDropReason, AliasGateResult } from "./aliases.js";
export { gateEmotion, emotionClassifierRecord } from "./emotion.js";
export type { EmotionGateResult, EmotionVerdict } from "./emotion.js";
export { contentFloor, floorRefusals } from "./floor.js";
export type { FloorReason, FloorResult } from "./floor.js";

// ── tagging + prediction error ─────────────────────────────────────────────
export { computeNovelty, tagSalience } from "./salience.js";
export type { NoveltyReason, NoveltyResult, SalienceTag } from "./salience.js";

// ── what the author may see ────────────────────────────────────────────────
export { preselectSchemas, renderSchemaContext } from "./preselect.js";
export type { Channel, Preselection, PreselectInput, SchemaSlice, SelectedSchema } from "./preselect.js";

// ── the battery and the one chokepoint ─────────────────────────────────────
export { assertNoBypassOption, gateProposal } from "./battery.js";
export type { BatteryOptions, BatteryOutcome, GateInput } from "./battery.js";
export { encodeChunk, mentionsSchema } from "./chunk.js";
export type { ChunkInput, EncodeOptions, EncodeResult } from "./chunk.js";

export type { Kind, Salience } from "../types.js";
