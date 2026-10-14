import { TERMINAL_ARCHIVE_LATCHES } from "./associate/index.js";
export const GATE_CHUNK_EVENT = "gate.chunk";
export const GATE_CHUNK_FIELDS = [
  "chunkKey",
  "index",
  "scope",
  "session",
  "day",
  "proposals",
  "accepted",
  "refused",
  "fullyGated",
  "effects",
  "blind",
  "shown",
  "shownIds",
  "shownLexicalOnly",
  "shownSemanticOnly",
  "shownBoth",
  "candidates",
  "semanticState",
  "semanticReason",
  "channels",
  "fires",
  "refusals",
  "refusalsByReason",
  "novelty",
  "noveltyReason"
];
export const GATE_DEPOSIT_EVENT = "gate.deposit";
export const GATE_DEPOSIT_FIELDS = [
  "source",
  "session",
  "scope",
  "day",
  "proposals",
  "accepted",
  "refused",
  "memoryId",
  "contentHash",
  "kind",
  "gates",
  "fires",
  "refusalsByReason",
  "blockedBy",
  "secretFamilies",
  "hedges",
  "aliasesDeclared",
  "aliasesKept",
  "aliasesDropped",
  "feelingExemption",
  "quoteStripped",
  "floorChars",
  "floorWords",
  "preselection",
  "preselectionReason",
  "shown",
  "channels"
];
export const RECALL_DECISION_EVENT = "recall.decision";
export const SWEEP_GATE_EVENT = "sweep.gate";
export const SWEEP_WAKE_EVENT = "sweep.wake";
export const SLEEP_CYCLE_EVENT = "sleep.cycle";
export const SELF_BRIEFING_EVENT = "self.briefing";
export const PRIMACY_STANDDOWN_EVENT = "adapter.primacy.standdown";
export const PRIMACY_DELIVER_EVENT = "adapter.primacy.deliver";
export const WAKE_INJECTED_EVENT = "adapter.wake.injected";
export const WAKE_DELIVERED_EVENT = "adapter.wake.delivered";
export const RECALL_DELIVERED_EVENT = "adapter.recall";
export const EPISODE_ASK_EVENT = "adapter.episode.ask";
export const BOUNDARY_EVENT = "adapter.boundary";
export const AUTHORSHIP_ASK_EVENT = "adapter.authorship.ask";
export const ADAPTER_ASK_EVENT = "adapter.ask";
export const EMBED_BACKFILL_EVENT = "adapter.embed.backfill";
export const SEMANTIC_LAG_EVENT = "adapter.semantic.lag";
export const RECALL_CREDIT_EVENT = "recall.credit";
export const ASSOCIATE_FLUSH_EVENT = "associate.flush";
export const CONTIGUITY_CURSOR_META = "associateContiguityCursor";
export const SUBJECTS_BACKFILL_META = "subjects.v12.backfill";
export const REGROWN_RELINK_META = TERMINAL_ARCHIVE_LATCHES["episode-regrown"];
export const CORRECTED_RELINK_META = TERMINAL_ARCHIVE_LATCHES["corrected"];
export const SPAWN_REFUSED_EVENT = "adapter.spawn.refused";
export const SPAWN_FAILED_EVENT = "adapter.spawn.failed";
export const RUNNER_FAILED_EVENT = "adapter.runner.failed";
export const HOOK_CLAIM_LOST_EVENT = "adapter.hook.claim.lost";
export const WRITE_UP_FAILED_EVENT = "adapter.writeup.failed";
export const NIGHT_WRITE_UP_EVENT = "adapter.night.writeup";
export const CAPTURE_FAILED_EVENT = "remember.capture.failed";
export const SPAWN_STARTED_EVENT = "adapter.spawn.started";
export const MCP_RECALL_EVENT = "mcp.recall";
export const MCP_PART_EVENT = "mcp.part";
export const MCP_OVERSIZE_EVENT = "mcp.result.oversize";
export const MCP_SPILLED_EVENT = "mcp.result.spilled";
export const ENVELOPE_OVERCAP_EVENT = "adapter.envelope.overcap";
export const NOTICE_DROPPED_EVENT = "adapter.notice.dropped";
export const ENVELOPE_GAVE_WAY_EVENT = "adapter.envelope.gave-way";
export const INJECTION_OVERBUDGET_EVENT = "adapter.injection.overbudget";
export const CHECKOUT_EVENT = "adapter.checkout";
export const SNAPSHOT_TAKEN_EVENT = "snapshot.taken";
export const SNAPSHOT_FAILED_EVENT = "snapshot.failed";
export const SNAPSHOT_ROTATED_EVENT = "snapshot.rotated";
export const STORE_EXPORT_EVENT = "store.export";
const RENDERED_EVENT = "self.briefing.rendered";
export const BRIEFING_PUBLISHED_EVENT = "self.briefing.published";
export const TRIM_EVENT = "self.briefing.trim";
export const TRIMMED_FIELD = "trimmed";
export const CLOCK_PHASE = "clock";
export function renderedEvent(events) {
  for (let i = events.length - 1;i >= 0; i -= 1) {
    const e = events[i];
    if (e !== undefined && e.name === RENDERED_EVENT)
      return e;
  }
  return null;
}
export function numberField(event, key) {
  const v = event?.data?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export function stringField(event, key) {
  const v = event.data?.[key];
  return typeof v === "string" ? v : null;
}
export function nonzero(counts) {
  const out = {};
  let any = false;
  for (const [reason, n] of Object.entries(counts)) {
    if (typeof n === "number" && n > 0) {
      out[reason] = n;
      any = true;
    }
  }
  return any ? out : null;
}
export function gateChunkRecord(result, ctx) {
  const pre = result.preselection;
  const fires = {};
  for (const e of result.events) {
    const parts = e.event.split(".");
    const gate = parts[0] === "gate" ? parts[1] : undefined;
    if (gate === undefined)
      continue;
    fires[gate] = (fires[gate] ?? 0) + 1;
  }
  const refusalsByReason = {};
  for (const r of result.refused) {
    refusalsByReason[r.reason] = (refusalsByReason[r.reason] ?? 0) + 1;
  }
  return {
    chunkKey: ctx.chunkKey,
    index: ctx.index,
    scope: ctx.scope,
    session: ctx.session,
    day: result.day,
    proposals: result.accepted.length + result.refused.length,
    accepted: result.accepted.length,
    refused: result.refused.length,
    fullyGated: result.fullyGated,
    effects: result.effects.length,
    blind: pre.blind,
    shown: pre.shown.length,
    shownIds: pre.shown.map((s) => s.id),
    shownLexicalOnly: pre.lexicalIds.filter((id) => !pre.semanticIds.includes(id)).length,
    shownSemanticOnly: pre.semanticOnlyIds.length,
    shownBoth: pre.overlapIds.length,
    candidates: pre.candidates,
    semanticState: pre.semantic.state,
    semanticReason: pre.semantic.reason,
    channels: result.channels.map((c) => ({
      channel: c.channel,
      state: c.state,
      reason: c.reason
    })),
    novelty: result.novelty.novelty,
    noveltyReason: result.novelty.reason,
    fires,
    refusalsByReason,
    refusals: result.refused.map((r) => ({
      ref: r.ref,
      kind: r.kind,
      reason: r.reason,
      blockedBy: [...r.blockedBy]
    }))
  };
}
function recordFor(records, gate) {
  return records.find((r) => r.gate === gate);
}
export function gateDepositRecord(records, channels, ctx) {
  const secrets = recordFor(records, "secrets");
  const precision = recordFor(records, "precision");
  const aliases = recordFor(records, "aliases");
  const emotion = recordFor(records, "emotion");
  const floor = recordFor(records, "floor");
  const fires = {};
  for (const r of records) {
    if (r.status === "clear" || r.status === "not-invoked")
      continue;
    fires[r.gate] = (fires[r.gate] ?? 0) + 1;
  }
  const refusalsByReason = {};
  const firstBlock = ctx.blockedBy[0];
  if (firstBlock !== undefined)
    refusalsByReason[firstBlock] = 1;
  return {
    source: ctx.source,
    session: ctx.session,
    scope: ctx.scope,
    day: ctx.day,
    proposals: 1,
    accepted: ctx.accepted ? 1 : 0,
    refused: ctx.accepted ? 0 : 1,
    memoryId: ctx.memoryId,
    contentHash: secrets?.contentHash ?? null,
    kind: ctx.kind,
    gates: records.map((r) => ({
      gate: r.gate,
      status: r.status,
      reason: r.reason,
      ablatable: r.ablatable
    })),
    fires,
    refusalsByReason,
    blockedBy: [...ctx.blockedBy],
    secretFamilies: (secrets?.findings ?? []).map((f) => ({
      family: f.family,
      count: f.count,
      site: f.site
    })),
    hedges: (precision?.hedges ?? []).map((h) => ({ kind: h.kind, count: h.count })),
    aliasesDeclared: aliases?.declared ?? 0,
    aliasesKept: aliases?.kept ?? 0,
    aliasesDropped: (aliases?.dropped ?? []).map((d) => ({ index: d.index, reason: d.reason })),
    feelingExemption: emotion?.exemption ?? false,
    quoteStripped: emotion?.quoteStripped ?? false,
    floorChars: floor?.chars ?? null,
    floorWords: floor?.words ?? null,
    preselection: "not-run",
    preselectionReason: "authored-door-shows-no-schema-cards",
    shown: null,
    channels: channels.map((c) => ({ channel: c.channel, state: c.state, reason: c.reason }))
  };
}
export const RECALL_DECISION_FIELDS = [
  "session",
  "turn",
  "day",
  "date",
  "reason",
  "observer",
  "budgetBytes",
  "bytes",
  "surfacedCount",
  "footnoteCount",
  "affectFlag",
  "affectReason",
  "moodMatched",
  "sentinelRendered",
  "surfaced",
  "footnotes",
  "elapsedMs",
  "aborted",
  "spread",
  "dropped",
  "linksReached"
];
export function surfaceSetFields() {
  return RECALL_DECISION_FIELDS;
}
function tierRows(ids, verdicts) {
  return ids.map((id) => {
    const v = verdicts.find((x) => x.id === id);
    return { id, sal: v?.sal ?? null, activation: v?.activation ?? null, ...v?.via === undefined ? {} : { via: v.via } };
  });
}
export function recallDecisionRecord(d, ctx) {
  const surfaceSet = {
    session: d.sessionId,
    turn: d.turn,
    day: d.day,
    date: ctx.date,
    reason: d.reason,
    observer: d.observer,
    budgetBytes: d.budgetBytes,
    bytes: d.bytes,
    surfacedCount: d.surfaced.length,
    footnoteCount: d.footnotes.length,
    affectFlag: d.affectFlag,
    affectReason: d.affectReason,
    moodMatched: d.moodMatched,
    sentinelRendered: d.sentinel !== null,
    surfaced: tierRows(d.surfaced, d.verdicts),
    footnotes: tierRows(d.footnotes, d.verdicts),
    elapsedMs: d.elapsedMs,
    aborted: d.aborted,
    spread: d.spread,
    dropped: d.dropped,
    linksReached: (d.spread?.pointersShown ?? 0) + (d.spread?.liftedShown ?? 0)
  };
  return surfaceSet;
}
