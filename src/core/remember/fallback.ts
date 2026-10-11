/**
 * The crash fallback — transcript interpretation, demoted from primary path to the
 * thing that runs only when the experiencer never got the pen (contract §4).
 *
 * WHAT "CRASHED" MEANS, mechanically (owner ruling 2026-09-04, adapter CONTRACT
 * open question 3; the predicate itself is `SpanBuffer.crashedSessions`): a
 * session holds uncovered spans, has recorded NO `session-end` boundary, and has
 * had no boundary activity for `TUNABLES.CRASH_STALE_MS`. Nothing else is swept
 * — not an ordinary Stop, not a session that ended normally with trailing turns,
 * not a compaction on its own. A host with no end-of-session event has every
 * session swept once it goes quiet, which is the intended degradation.
 *
 * It runs for spans that are unclaimed and left behind by such a session. A fallback
 * that runs after a crash is exactly the path that must not lose the day, so the
 * machinery shrank with its role but did not disappear — chunking with per-chunk
 * failure isolation (E1), a `stop_reason` guard (E2), restore-on-throw (E6), and an
 * observer that sweeps nothing (E7).
 *
 * Restore-on-failure is BOUNDED: `SpanBuffer.noteFailures()` counts a span's
 * failures and quarantines it at `TUNABLES.MAX_SPAN_FAILURES`, so a permanently
 * failing span cannot bill the owner one model call per boundary forever.
 *
 * **There is no SDK and no network here.** Interpretation is an INJECTED async
 * function; streaming, retries, token budgets and detachment belong to whoever
 * injects it (INTERFACE-GAPS.md #3). This module owns the choreography only.
 */
import { markCovered, renderForSweep } from "./proposals.js";
import type { MarkedSpan } from "./proposals.js";
import { errCode } from "./spans.js";
import type { Span, SpanBuffer } from "./spans.js";
import { TUNABLES } from "./tunables.js";

export interface SweepChunk {
  index: number;
  spans: Span[];
  /** Covered spans ride ALONG, marked — the sweep loses permission to write the
   *  same memory twice, not sight of the material (§4.1 G4). */
  marked: MarkedSpan[];
  /** The prompt-side rendering. Marks live here and nowhere else (§5 G7). */
  prompt: string;
  bytes: number;
}

export interface InterpretResult {
  proposals?: readonly unknown[];
  /** A truncated response is a failure, not data (scar E2). Absent means the
   *  injected function does not report one — see NOTES §6. */
  stopReason?: string;
}

export type InterpretFn = (chunk: SweepChunk) => Promise<InterpretResult>;

/** Persist one chunk's harvest. Injected: minting is `encode/`'s and `store/`'s. */
export type ApplyFn = (
  proposals: readonly unknown[],
  chunk: SweepChunk,
) => void | Promise<void>;

export const OK_STOP_REASONS: readonly string[] = [
  "end_turn",
  "stop",
  "stop_sequence",
  "tool_use",
];

export type ChunkReason =
  | "APPLIED"
  | "EMPTY"
  | "TRUNCATED"
  | "MALFORMED_RESULT"
  | "THREW"
  | "APPLY_FAILED";

export interface ChunkOutcome {
  index: number;
  ok: boolean;
  /** "EMPTY" and the failure reasons are DISTINCT records: returned-nothing is not
   *  failed (scar §2.4). */
  reason: ChunkReason;
  spans: number;
  bytes: number;
  proposals: number;
  code: string | null;
}

/**
 * EVERY WAY A SWEEP CAN END, as a runtime list — so a per-reason count can zero
 * every key before it counts anything and an absent reason is distinguishable
 * from one that never fired (scar §2.4, the `DECAY_SKIPS` pattern).
 */
export const SWEEP_REASONS = [
  "OBSERVER",
  "NO_CRASHED_SESSION",
  "NOTHING_TO_SWEEP",
  "NOTHING_UNCLAIMED",
  "BELOW_MIN_CLAIM",
  "IO_FAILED",
  "SWEPT",
] as const;

export type SweepReason = (typeof SWEEP_REASONS)[number];

/**
 * THE QUIET REASONS — the ones whose ordinary count is "most of them, every day"
 * (G48, 2026-09-14).
 *
 * The sweep is a crash fallback, so its healthy state is refusing, and the
 * refusals divide in THREE, not two — the third division is the correction the
 * first reading of G48 needed (2026-09-14, same day):
 *
 *   - **Quiet.** `NO_CRASHED_SESSION` (nothing crashed in this scope),
 *     `NOTHING_TO_SWEEP` (a crashed session left nothing behind — which,
 *     because `crashedSessions()` never forgets a session, is the permanent
 *     answer for every scope that was ever swept and retired), and
 *     `NOTHING_UNCLAIMED` (everything eligible was already authored, retired
 *     without a model call). All three are the gate working.
 *   - **Not quiet, NOW.** `IO_FAILED` is a claim the filesystem refused;
 *     `OBSERVER` means the buffer stood down under a root that did not — the two
 *     stances are set from one flag (`counterpart.ts`), so a nonzero count is a
 *     wiring fault. Neither can be a normal day even once.
 *   - **Not quiet IF CHRONIC.** `BELOW_MIN_CLAIM` is fine once and a stuck
 *     buffer if it repeats. It is PERMANENT BY CONSTRUCTION: a crashed session's
 *     leftover under `MIN_CLAIM_BYTES` is restored to the buffer
 *     (`spans.ts#claim`), `crashedSessions()` never forgets the session, so the
 *     same scope answers `BELOW_MIN_CLAIM` on every run thereafter. Ambering on
 *     the first one made one 200-byte leftover an amber dashboard forever, which
 *     is the alarm that trains its reader to ignore it.
 *
 * `SWEPT` is not a refusal at all and is in none of the lists; it is counted
 * beside them so the per-reason map is TOTAL over the run's reports.
 */
export const QUIET_SWEEP_REASONS: readonly SweepReason[] = [
  "NO_CRASHED_SESSION",
  "NOTHING_TO_SWEEP",
  "NOTHING_UNCLAIMED",
];

/**
 * WORTH AN ALARM ON THE FIRST ONE. Read by the gate row's `noisyRefusals`, by
 * the dashboard narrator's amber and by the daily's `sweep.gate:refused` split —
 * all three of which are single-row readers, and a single row cannot tell a
 * first time from a thousandth.
 */
export const NOISY_NOW_SWEEP_REASONS: readonly SweepReason[] = ["IO_FAILED", "OBSERVER"];

/**
 * WORTH A LOOK ONLY IF IT REPEATS. Counted onto the gate row as
 * `chronicCandidates` and named neutrally by every one-row reader; whether it is
 * chronic is a question about a RUN OF ROWS, which only a reader holding several
 * days of them can answer (`tools/parallel/` reads the series; the dashboard and
 * the daily do not).
 */
export const NOISY_IF_CHRONIC_SWEEP_REASONS: readonly SweepReason[] = ["BELOW_MIN_CLAIM"];

export interface SweepReport {
  scope: string;
  ran: boolean;
  reason: SweepReason;
  claimId: string | null;
  chunks: ChunkOutcome[];
  spansSwept: number;
  spansRestored: number;
  /** Spans that hit the retry bound this run: written to `quarantine.jsonl`,
   *  never restored, never swept again (TUNABLES.MAX_SPAN_FAILURES). */
  spansQuarantined: number;
  proposals: number;
  /** False when a failed restore forbade consuming the claim (spec §2 G7). */
  consumed: boolean;
}

export interface SweepOptions {
  scope: string;
  interpret: InterpretFn;
  apply?: ApplyFn;
  chunkBytes?: number;
  minBytes?: number;
  staleClaimMs?: number;
  /** How long a session must be silent before it counts as crashed
   *  (`TUNABLES.CRASH_STALE_MS`). Overridden by the REPLAY harness alone, where
   *  "every session in this corpus died months ago" is literally true. */
  crashStaleMs?: number;
  okStopReasons?: readonly string[];
}

export async function sweep(buffer: SpanBuffer, opts: SweepOptions): Promise<SweepReport> {
  const report: SweepReport = {
    scope: opts.scope,
    ran: false,
    reason: "OBSERVER",
    claimId: null,
    chunks: [],
    spansSwept: 0,
    spansRestored: 0,
    spansQuarantined: 0,
    proposals: 0,
    consumed: false,
  };

  if (buffer.observer) {
    buffer.emit("remember.observer.standdown", undefined, { site: "sweep" });
    return report;
  }

  // THE GATE (owner ruling 2026-09-04): the sweep is a FALLBACK, never the
  // primary mechanism, and it spends the owner's API budget every time it fires.
  // It may read a transcript only for a session that CRASHED — uncovered spans,
  // no `session-end` boundary ever, and silence past `CRASH_STALE_MS`. A session
  // that ended normally is never swept even when trailing spans are uncovered:
  // the experiencer had the pen, and what it did not write is forgotten by
  // design (constitution 3).
  //
  // Answered BEFORE the claim, so a scope with nothing crashed costs no rename
  // and — the point — records "nothing crashed" rather than "claimed and found
  // nothing already authored". The daily has to tell a quiet sweep from a broken
  // one (constitution 16).
  const staleOpt = opts.crashStaleMs === undefined ? {} : { staleMs: opts.crashStaleMs };
  const pending = buffer.crashedPending(opts.scope, staleOpt);
  if (pending.spans === 0) {
    // TWO DIFFERENT FACTS, kept apart (scar §2.4). "Nothing crashed" is the
    // healthy quiet day the ruling produces; "a crashed session left nothing
    // behind" is the buffer already being empty — the same reason `claim()`
    // reports when it finds no lines.
    const reason: SweepReason = pending.sessions.size === 0 ? "NO_CRASHED_SESSION" : "NOTHING_TO_SWEEP";
    buffer.emit("remember.sweep.skipped", undefined, {
      scope: opts.scope,
      reason,
      crashedSessions: pending.sessions.size,
      uncovered: pending.uncovered,
    });
    return { ...report, reason };
  }
  const crashed = pending.sessions;

  const claimed = buffer.claim(opts.scope, {
    ...(opts.minBytes !== undefined ? { minBytes: opts.minBytes } : {}),
    ...(opts.staleClaimMs !== undefined ? { staleClaimMs: opts.staleClaimMs } : {}),
  });
  if (!claimed.claimed) {
    const reason: SweepReason =
      claimed.reason === "BELOW_MIN_CLAIM"
        ? "BELOW_MIN_CLAIM"
        : claimed.reason === "EMPTY"
          ? "NOTHING_TO_SWEEP"
          : claimed.reason === "OBSERVER"
            ? "OBSERVER"
            : "IO_FAILED";
    return { ...report, reason };
  }

  const claim = claimed.claim;
  report.claimId = claim.id;
  const withheld = buffer.withheldHashes(opts.scope);
  const covered = buffer.coveredHashes(opts.scope);

  // Three piles. Ineligible spans belong to sessions that are still running, or
  // that ended normally, or that have not yet gone quiet past the window — all of
  // them go straight back; withheld spans are a proposal's own words and are
  // dropped from the sweep outright (re-encoding them is guaranteed duplication).
  const eligible: Span[] = [];
  const ineligible: Span[] = [];
  for (const span of claim.spans) {
    if (withheld.has(span.hash)) continue;
    if (crashed.has(span.session)) eligible.push(span);
    else ineligible.push(span);
  }

  const uncovered = eligible.filter((s) => !covered.has(s.hash));
  if (uncovered.length === 0) {
    // Everything eligible was already authored: retire it without a model call.
    const back = buffer.restore(claim, ineligible);
    // Restored spans stay OUT of the consumed ledger: recording them would make
    // them un-restorable at their next failure (the replay-review P0).
    const consumed = back.restored
      ? buffer.consume(claim, { except: ineligible }).consumed
      : false;
    buffer.emit("remember.sweep.skipped", claim.id, {
      scope: opts.scope,
      reason: "NOTHING_UNCLAIMED",
      retired: eligible.length,
    });
    return {
      ...report,
      reason: "NOTHING_UNCLAIMED",
      spansRestored: back.spans,
      consumed,
    };
  }

  const chunks = chunkSpans(eligible, covered, opts.chunkBytes ?? TUNABLES.CHUNK_BYTES);
  const okStop = opts.okStopReasons ?? OK_STOP_REASONS;
  const failed: Span[] = [];

  for (const chunk of chunks) {
    const outcome = await runChunk(buffer, chunk, opts, okStop);
    report.chunks.push(outcome);
    if (outcome.ok) {
      report.spansSwept += chunk.spans.length;
      report.proposals += outcome.proposals;
    } else {
      // Per-chunk failure isolation (scar E1): this chunk's spans go back and are
      // retried at the next boundary; its siblings are unaffected.
      //
      // BOUNDED (replay-review follow-up): the failure is recorded per span, and a
      // span that has now failed MAX_SPAN_FAILURES times is quarantined instead of
      // restored. Named limitation: a chunk failure marks EVERY span in the chunk,
      // so an innocent sibling chunked with a poison pill N times is quarantined
      // with it. That is the simplest rule that bounds the cost; bisecting a chunk
      // is machinery in anticipation of a failure not yet seen (Amendment 15).
      const noted = buffer.noteFailures(opts.scope, chunk.spans, outcome.code ?? outcome.reason);
      failed.push(...noted.retry);
      report.spansQuarantined += noted.quarantined.length;
    }
  }

  // Quarantined spans are deliberately NOT in this list: they are not restored,
  // and their hashes DO belong in the consumed ledger — see `consume()`.
  const restoredSpans = [...failed, ...ineligible];
  const back = buffer.restore(claim, restoredSpans);
  report.spansRestored = back.spans;
  if (!back.restored) {
    // A failed restore FORBIDS consuming the claim: the spans stay in claim-or-buffer.
    buffer.emit("remember.sweep.restore.failed", claim.id, { spans: failed.length });
    return { ...report, ran: true, reason: "SWEPT", consumed: false };
  }
  // The ledger records what was APPLIED. A restored span's hash must stay out of
  // it, or restore()'s dedup makes the SECOND failure of the same content silent
  // loss — the replay-review P0, fired live on 2026-08-09/10.
  report.consumed = buffer.consume(claim, { except: restoredSpans }).consumed;
  buffer.emit("remember.sweep.done", claim.id, {
    scope: opts.scope,
    chunks: report.chunks.length,
    swept: report.spansSwept,
    restored: report.spansRestored,
    quarantined: report.spansQuarantined,
    proposals: report.proposals,
  });
  return { ...report, ran: true, reason: "SWEPT" };
}

/** Every scope holding experience gets swept, not only the one whose boundary fired
 *  (spec §2 G9) — a project never revisited would otherwise hold spans forever. */
export async function sweepAll(
  buffer: SpanBuffer,
  opts: Omit<SweepOptions, "scope">,
): Promise<SweepReport[]> {
  const out: SweepReport[] = [];
  for (const scope of buffer.scopes()) {
    out.push(await sweep(buffer, { ...opts, scope }));
  }
  return out;
}

async function runChunk(
  buffer: SpanBuffer,
  chunk: SweepChunk,
  opts: SweepOptions,
  okStop: readonly string[],
): Promise<ChunkOutcome> {
  const base: ChunkOutcome = {
    index: chunk.index,
    ok: false,
    reason: "THREW",
    spans: chunk.spans.length,
    bytes: chunk.bytes,
    proposals: 0,
    code: null,
  };
  let result: InterpretResult;
  try {
    result = await opts.interpret(chunk);
  } catch (err) {
    const code = errCode(err);
    buffer.emit("remember.chunk.failed", undefined, { index: chunk.index, reason: "THREW", code });
    return { ...base, reason: "THREW", code };
  }

  if (result === null || typeof result !== "object") {
    buffer.emit("remember.chunk.failed", undefined, { index: chunk.index, reason: "MALFORMED_RESULT" });
    return { ...base, reason: "MALFORMED_RESULT" };
  }
  if (result.stopReason !== undefined && !okStop.includes(result.stopReason)) {
    // A truncated JSON response is a failure, not data (scar E2).
    buffer.emit("remember.chunk.failed", undefined, {
      index: chunk.index,
      reason: "TRUNCATED",
      stopReason: result.stopReason,
    });
    return { ...base, reason: "TRUNCATED", code: result.stopReason };
  }
  if (result.proposals !== undefined && !Array.isArray(result.proposals)) {
    buffer.emit("remember.chunk.failed", undefined, { index: chunk.index, reason: "MALFORMED_RESULT" });
    return { ...base, reason: "MALFORMED_RESULT" };
  }

  const proposals = result.proposals ?? [];
  if (proposals.length === 0) {
    // Returned nothing is NOT failed. The chunk's spans are consumed: they were
    // read, and the sweep's verdict was "nothing here" (scar §2.4).
    buffer.emit("remember.chunk.empty", undefined, { index: chunk.index, spans: chunk.spans.length });
    return { ...base, ok: true, reason: "EMPTY" };
  }

  if (opts.apply !== undefined) {
    try {
      await opts.apply(proposals, chunk);
    } catch (err) {
      const code = errCode(err);
      buffer.emit("remember.chunk.failed", undefined, {
        index: chunk.index,
        reason: "APPLY_FAILED",
        code,
      });
      return { ...base, reason: "APPLY_FAILED", code, proposals: proposals.length };
    }
  }
  buffer.emit("remember.chunk.applied", undefined, {
    index: chunk.index,
    spans: chunk.spans.length,
    proposals: proposals.length,
  });
  return { ...base, ok: true, reason: "APPLIED", proposals: proposals.length };
}

export function chunkSpans(
  spans: readonly Span[],
  covered: ReadonlySet<string>,
  chunkBytes: number,
): SweepChunk[] {
  const chunks: SweepChunk[] = [];
  let current: Span[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    const marked = markCovered(current, covered);
    chunks.push({
      index: chunks.length,
      spans: current,
      marked,
      prompt: renderForSweep(marked),
      bytes,
    });
    current = [];
    bytes = 0;
  };
  for (const span of spans) {
    if (current.length > 0 && bytes + span.text.length > chunkBytes) flush();
    current.push(span);
    bytes += span.text.length;
  }
  flush();
  return chunks;
}
