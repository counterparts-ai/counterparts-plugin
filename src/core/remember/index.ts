/**
 * `remember/` — the authorship pipeline's mechanics.
 *
 * The experiencer writes its own memories at session end, jots in the moment where
 * the host allows, and a transcript sweep exists only as the crash fallback
 * (CONTRACT.md §1). This module owns the *mechanics* of that: durable span capture,
 * proposal intake, coverage by hash, `updates:` resolution, and the fallback's
 * claim/consume choreography.
 *
 * What it deliberately does NOT own:
 *   - the gate battery (`encode/`) — injected as a `GateFn`;
 *   - the model call (an adapter) — injected as an `InterpretFn`;
 *   - who the `updates:` candidates are (`store/`, `schemas/`) — injected as a
 *     `CandidateSource` plus an `IdResolver`;
 *   - the salience clamp (`physics/`), which governs every memory, not just these.
 *
 * Every one of those seams, and every place another module must meet this one, is
 * listed in INTERFACE-GAPS.md. Implementation choices the CONTRACT left open are in
 * NOTES.md.
 */
export { SpanBuffer, BOUNDARY_KINDS, WRITE_SITES, enters, keyFor, errCode } from "./spans.js";
export type {
  BoundaryKind,
  BoundaryRecord,
  BufferOptions,
  CaptureReason,
  CaptureResult,
  Claim,
  ClaimOutcome,
  ClaimRefusal,
  CoverageMark,
  CoverageReport,
  FailureOutcome,
  FailureRecord,
  RememberEvent,
  Span,
  SpanKind,
  Turn,
  TurnSource,
  WriteSite,
  WriteUpRecord,
} from "./spans.js";

export {
  ALREADY_AUTHORED_MARK,
  AUTHOR_DIMENSIONS,
  DRAFT_FIELDS,
  NO_GATE,
  intake,
  markCovered,
  renderForSweep,
  submitProposal,
} from "./proposals.js";
export type {
  DateIntent,
  Feeling,
  GateFn,
  GateInput,
  GateVerdict,
  IntakeResult,
  MalformedReason,
  MarkedSpan,
  Proposal,
  ProposalDraft,
  ProposalRecord,
  ProposalSource,
  SubmitContext,
  SubmitReason,
  SubmitResult,
} from "./proposals.js";

export { resolveUpdates, similarity } from "./updates.js";
export type {
  Candidate,
  CandidateSource,
  IdResolver,
  UpdatesContext,
  UpdatesMethod,
  UpdatesReason,
  UpdatesResolution,
} from "./updates.js";

export {
  NOISY_IF_CHRONIC_SWEEP_REASONS,
  NOISY_NOW_SWEEP_REASONS,
  OK_STOP_REASONS,
  QUIET_SWEEP_REASONS,
  SWEEP_REASONS,
  chunkSpans,
  sweep,
  sweepAll,
} from "./fallback.js";
export type {
  ApplyFn,
  ChunkOutcome,
  ChunkReason,
  InterpretFn,
  InterpretResult,
  SweepChunk,
  SweepOptions,
  SweepReason,
  SweepReport,
} from "./fallback.js";

export { TUNABLES, validateWatchdog } from "./tunables.js";

// Retention (2026-09-23): the READ-ONLY plan and readers — what a session owes
// is `core/coverage/`'s rule since 2026-09-30, read by the plan. The deleting half — `retention.ts#pruneRetention`
// — is deliberately NOT here (PR #189 review, B1): it acts through the owner's
// strike, and everything that holds a `Counterpart` imports this index. Only the
// background worker imports it, and `test/cli.test.ts` pins that.
export {
  NO_HOST_EVIDENCE,
  RETENTION_EVENT,
  lastRetentionRun,
  planRetention,
  retentionRow,
  retentionRuns,
  retentionSources,
} from "./owes.js";
export type {
  HeldSession,
  HostSessionEvidence,
  RetentionReport,
  RetentionRun,
  RetentionSources,
  RetentionVerdict,
  WriteUpFacts,
} from "./owes.js";
