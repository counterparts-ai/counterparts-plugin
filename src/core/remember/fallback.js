import { markCovered, renderForSweep } from "./proposals.js";
import { errCode } from "./spans.js";
import { TUNABLES } from "./tunables.js";
export const OK_STOP_REASONS = [
  "end_turn",
  "stop",
  "stop_sequence",
  "tool_use"
];
export const SWEEP_REASONS = [
  "OBSERVER",
  "NO_CRASHED_SESSION",
  "NOTHING_TO_SWEEP",
  "NOTHING_UNCLAIMED",
  "BELOW_MIN_CLAIM",
  "IO_FAILED",
  "SWEPT"
];
export const QUIET_SWEEP_REASONS = [
  "NO_CRASHED_SESSION",
  "NOTHING_TO_SWEEP",
  "NOTHING_UNCLAIMED"
];
export const NOISY_NOW_SWEEP_REASONS = ["IO_FAILED", "OBSERVER"];
export const NOISY_IF_CHRONIC_SWEEP_REASONS = ["BELOW_MIN_CLAIM"];
export async function sweep(buffer, opts) {
  const report = {
    scope: opts.scope,
    ran: false,
    reason: "OBSERVER",
    claimId: null,
    chunks: [],
    spansSwept: 0,
    spansRestored: 0,
    spansQuarantined: 0,
    proposals: 0,
    consumed: false
  };
  if (buffer.observer) {
    buffer.emit("remember.observer.standdown", undefined, { site: "sweep" });
    return report;
  }
  const staleOpt = opts.crashStaleMs === undefined ? {} : { staleMs: opts.crashStaleMs };
  const pending = buffer.crashedPending(opts.scope, staleOpt);
  if (pending.spans === 0) {
    const reason = pending.sessions.size === 0 ? "NO_CRASHED_SESSION" : "NOTHING_TO_SWEEP";
    buffer.emit("remember.sweep.skipped", undefined, {
      scope: opts.scope,
      reason,
      crashedSessions: pending.sessions.size,
      uncovered: pending.uncovered
    });
    return { ...report, reason };
  }
  const crashed = pending.sessions;
  const claimed = buffer.claim(opts.scope, {
    ...opts.minBytes !== undefined ? { minBytes: opts.minBytes } : {},
    ...opts.staleClaimMs !== undefined ? { staleClaimMs: opts.staleClaimMs } : {}
  });
  if (!claimed.claimed) {
    const reason = claimed.reason === "BELOW_MIN_CLAIM" ? "BELOW_MIN_CLAIM" : claimed.reason === "EMPTY" ? "NOTHING_TO_SWEEP" : claimed.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED";
    return { ...report, reason };
  }
  const claim = claimed.claim;
  report.claimId = claim.id;
  const withheld = buffer.withheldHashes(opts.scope);
  const covered = buffer.coveredHashes(opts.scope);
  const eligible = [];
  const ineligible = [];
  for (const span of claim.spans) {
    if (withheld.has(span.hash))
      continue;
    if (crashed.has(span.session))
      eligible.push(span);
    else
      ineligible.push(span);
  }
  const uncovered = eligible.filter((s) => !covered.has(s.hash));
  if (uncovered.length === 0) {
    const back = buffer.restore(claim, ineligible);
    const consumed = back.restored ? buffer.consume(claim, { except: ineligible }).consumed : false;
    buffer.emit("remember.sweep.skipped", claim.id, {
      scope: opts.scope,
      reason: "NOTHING_UNCLAIMED",
      retired: eligible.length
    });
    return {
      ...report,
      reason: "NOTHING_UNCLAIMED",
      spansRestored: back.spans,
      consumed
    };
  }
  const chunks = chunkSpans(eligible, covered, opts.chunkBytes ?? TUNABLES.CHUNK_BYTES);
  const okStop = opts.okStopReasons ?? OK_STOP_REASONS;
  const failed = [];
  for (const chunk of chunks) {
    const outcome = await runChunk(buffer, chunk, opts, okStop);
    report.chunks.push(outcome);
    if (outcome.ok) {
      report.spansSwept += chunk.spans.length;
      report.proposals += outcome.proposals;
    } else {
      const noted = buffer.noteFailures(opts.scope, chunk.spans, outcome.code ?? outcome.reason);
      failed.push(...noted.retry);
      report.spansQuarantined += noted.quarantined.length;
    }
  }
  const restoredSpans = [...failed, ...ineligible];
  const back = buffer.restore(claim, restoredSpans);
  report.spansRestored = back.spans;
  if (!back.restored) {
    buffer.emit("remember.sweep.restore.failed", claim.id, { spans: failed.length });
    return { ...report, ran: true, reason: "SWEPT", consumed: false };
  }
  report.consumed = buffer.consume(claim, { except: restoredSpans }).consumed;
  buffer.emit("remember.sweep.done", claim.id, {
    scope: opts.scope,
    chunks: report.chunks.length,
    swept: report.spansSwept,
    restored: report.spansRestored,
    quarantined: report.spansQuarantined,
    proposals: report.proposals
  });
  return { ...report, ran: true, reason: "SWEPT" };
}
export async function sweepAll(buffer, opts) {
  const out = [];
  for (const scope of buffer.scopes()) {
    out.push(await sweep(buffer, { ...opts, scope }));
  }
  return out;
}
async function runChunk(buffer, chunk, opts, okStop) {
  const base = {
    index: chunk.index,
    ok: false,
    reason: "THREW",
    spans: chunk.spans.length,
    bytes: chunk.bytes,
    proposals: 0,
    code: null
  };
  let result;
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
    buffer.emit("remember.chunk.failed", undefined, {
      index: chunk.index,
      reason: "TRUNCATED",
      stopReason: result.stopReason
    });
    return { ...base, reason: "TRUNCATED", code: result.stopReason };
  }
  if (result.proposals !== undefined && !Array.isArray(result.proposals)) {
    buffer.emit("remember.chunk.failed", undefined, { index: chunk.index, reason: "MALFORMED_RESULT" });
    return { ...base, reason: "MALFORMED_RESULT" };
  }
  const proposals = result.proposals ?? [];
  if (proposals.length === 0) {
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
        code
      });
      return { ...base, reason: "APPLY_FAILED", code, proposals: proposals.length };
    }
  }
  buffer.emit("remember.chunk.applied", undefined, {
    index: chunk.index,
    spans: chunk.spans.length,
    proposals: proposals.length
  });
  return { ...base, ok: true, reason: "APPLIED", proposals: proposals.length };
}
export function chunkSpans(spans, covered, chunkBytes) {
  const chunks = [];
  let current = [];
  let bytes = 0;
  const flush = () => {
    if (current.length === 0)
      return;
    const marked = markCovered(current, covered);
    chunks.push({
      index: chunks.length,
      spans: current,
      marked,
      prompt: renderForSweep(marked),
      bytes
    });
    current = [];
    bytes = 0;
  };
  for (const span of spans) {
    if (current.length > 0 && bytes + span.text.length > chunkBytes)
      flush();
    current.push(span);
    bytes += span.text.length;
  }
  flush();
  return chunks;
}
