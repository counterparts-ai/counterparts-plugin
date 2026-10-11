/**
 * `sleep/` — systems consolidation: pure math on a cycle.
 *
 * The librarian. It advances the lived-day clock, materializes strength into the
 * ranking cache, marks consolidation and executes the identity crossing, prunes
 * at the floor (archivally), dedups, expires superseded-version rows, re-renders
 * the wake briefing (the last CONTENT write), and finally sweeps the durable
 * event log past its retention window — bounded per pass, latched records kept
 * (CONTRACT §5 G16).
 *
 * **Zero generative model calls, asserted by a test over this module's sources**
 * (CONTRACT §5 G1). Embedding lookups are permitted arithmetic and arrive
 * INJECTED, isolated, and degrading to lexical — never as a dependency of this
 * module.
 *
 * What this module deliberately does NOT contain, and why:
 *
 *   - **The lock, the watchdog, and detachment** (§3, scars E4/E5). Those belong
 *     to the adapter that spawns the cycle; the cross-key configuration
 *     invariant that binds them is here, as `validateWatchdog`, because it is
 *     arithmetic. INTERFACE-GAPS.md §6.
 *   - **The briefing itself.** `self/` owns it. Sleep owns only that it is last.
 *   - **Any import from `../self/`.** A test asserts the absence.
 */

export { runCycle, todayDate, census } from "./cycle.js";
export type { SleepOptions } from "./cycle.js";

export {
  CURSOR_PREFIX,
  MARKER_PREFIX,
  MARKER_UNSET,
  MERGE_ARCHIVE_REASON,
  MERGE_RECORD_PREFIX,
  PROMOTION_RECORD_PREFIX,
  PRUNE_ARCHIVE_REASON,
  PRUNE_RECORD_PREFIX,
  TUNABLES,
  shouldSpawn,
  validateWatchdog,
} from "./tunables.js";
export type { SpawnReason, WatchdogReason } from "./tunables.js";

export {
  advanceMarker,
  budgetFor,
  cadenceFor,
  cursorKey,
  initializeMarkers,
  markerDue,
  markerKey,
  readCursor,
  readMarker,
  resumeIndex,
  writeCursor,
} from "./markers.js";
export type { DueVerdict, MarkerHealth, MarkerRead } from "./markers.js";

export {
  STRENGTH_CACHE_FILE,
  memoryStrengthCache,
  sqliteStrengthCache,
  storeRankingCache,
  supportsRanking,
  strengthCachePath,
} from "./strength-cache.js";
export type { StrengthCache, StrengthRow } from "./strength-cache.js";

export { DECAY_SKIPS, runDecay } from "./decay.js";
export type { DecayResult, DecaySkip } from "./decay.js";

export {
  CONSOLIDATION_SKIPS,
  REFLECTED_FEELING_KEY,
  aboutMe,
  acceptsReflectedFeeling,
  coreContextFor,
  laterFeelingCarriers,
  laterFeelingWasAwake,
  laterFeelingWasReflections,
  namesOwner,
  ownerNames,
  promotionRecordKey,
  runConsolidate,
  selfRelevantFeeling,
} from "./consolidate.js";
export { V8_CENSUS_EVENT, V8_CENSUS_KEY, V8_UPGRADE_KEY, censusDue, preV8, projectedPruneDay, upgradeCensus, v7WouldPromote } from "./upgrade.js";
export type { UpgradeCensus } from "./upgrade.js";
export type { ReadsCoreContext, ReadsDocs } from "./consolidate.js";
export type { ConsolidateResult, ConsolidationSkip } from "./consolidate.js";

export { inLiveRevisionChain, pruneRecordKey, runPrune } from "./prune.js";
export type { PruneResult } from "./prune.js";

export {
  contentHashCandidates,
  declaredUpdates,
  mergeRecordKey,
  revisionSuccessorOf,
  revisionSuccessorPair,
  runDedup,
} from "./dedup.js";
export type { DedupCandidateInput, DedupCandidateSource, DedupPair, DedupResult } from "./dedup.js";

export { runFade } from "./fade.js";
export type { FadeFn, FadeInput, FadeResult, FadeSweepOutcome } from "./fade.js";

export { runBriefing } from "./briefing.js";
export type { BriefingContext, BriefingOutcome, BriefingResult, RenderFn } from "./briefing.js";

export { LOG_SWEEP_EVENT, LOG_SWEEP_SKIPS, runLogSweep } from "./log.js";
export type { LogSweepResult, LogSweepSkip } from "./log.js";

export { BAND_TRANSITION_EVENT, BAND_TRANSITION_FIELDS, CycleKilled, PHASES, attachCyclePartial, countSkip, cyclePartial, emptyOutcome, isEntityCard, isJournal, isSchemaRow, phaseReport } from "./types.js";
export type {
  CyclePartial,
  CycleReport,
  CycleStep,
  KindCensus,
  MergeRecord,
  Phase,
  PhaseCtx,
  PhaseOutcome,
  PhaseReason,
  PhaseReport,
  PhaseStatus,
  PromotionRecord,
  PrunedRecord,
  SleepEvent,
  SleepStore,
  StepStage,
} from "./types.js";
