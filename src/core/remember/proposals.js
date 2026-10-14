import { SETTLE_HOWS } from "../types.js";
import { hashText } from "../store/prose.js";
import { isDay, isRecurrence, parseCalendarDate } from "../time.js";
import { randomBytes } from "node:crypto";
const KIND_SET = {
  self: true,
  person: true,
  entity: true,
  skill: true,
  place: true,
  fact: true
};
export const AUTHOR_DIMENSIONS = ["relevance", "emotional", "predictive"];
export const DRAFT_FIELDS = [
  "content",
  "kind",
  "title",
  "claimed",
  "salience",
  "feeling",
  "aliases",
  "updates",
  "how",
  "unresolved",
  "eventDate",
  "remind",
  "recurring"
];
export function intake(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "NOT_AN_OBJECT", text: typeof raw === "string" ? raw : null, dropped: [] };
  }
  const rec = raw;
  const dropped = Object.keys(rec).filter((k) => !DRAFT_FIELDS.includes(k));
  const text = typeof rec["content"] === "string" ? rec["content"] : null;
  const bad = (reason) => ({ ok: false, reason, text, dropped });
  if (rec["content"] === undefined)
    return bad("CONTENT_MISSING");
  if (typeof rec["content"] !== "string")
    return bad("CONTENT_MISSING");
  if (rec["content"].trim().length === 0)
    return bad("CONTENT_EMPTY");
  if (rec["kind"] !== undefined) {
    if (typeof rec["kind"] !== "string" || !(rec["kind"] in KIND_SET))
      return bad("KIND_UNKNOWN");
  }
  if (rec["title"] !== undefined && typeof rec["title"] !== "string")
    return bad("TITLE_NOT_STRING");
  if (rec["claimed"] !== undefined && rec["claimed"] !== null) {
    if (typeof rec["claimed"] !== "number" || !Number.isFinite(rec["claimed"])) {
      return bad("CLAIMED_NOT_NUMERIC");
    }
    if (rec["claimed"] < 0 || rec["claimed"] > 1)
      return bad("CLAIMED_OUT_OF_RANGE");
  }
  if (rec["updates"] !== undefined && typeof rec["updates"] !== "string") {
    return bad("UPDATES_NOT_STRING");
  }
  if (rec["how"] !== undefined && rec["how"] !== null) {
    if (typeof rec["how"] !== "string" || !SETTLE_HOWS.includes(rec["how"]))
      return bad("HOW_UNKNOWN");
  }
  if (rec["salience"] !== undefined && rec["salience"] !== null) {
    const s = rec["salience"];
    if (typeof s !== "object" || Array.isArray(s))
      return bad("DIMENSION_OUT_OF_RANGE");
    for (const dim of AUTHOR_DIMENSIONS) {
      const v = s[dim];
      if (v === undefined)
        continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        return bad("DIMENSION_OUT_OF_RANGE");
      }
    }
  }
  if (rec["aliases"] !== undefined) {
    const a = rec["aliases"];
    if (!Array.isArray(a) || a.some((x) => typeof x !== "string" || x.trim().length === 0)) {
      return bad("ALIASES_NOT_STRINGS");
    }
  }
  if (rec["feeling"] !== undefined) {
    const f = rec["feeling"];
    if (f === null || typeof f !== "object")
      return bad("FEELING_MALFORMED");
    const g = f;
    if (typeof g["feeling"] !== "string" || typeof g["quote"] !== "string" || typeof g["subject"] !== "string" || g["feeling"].trim().length === 0) {
      return bad("FEELING_MALFORMED");
    }
  }
  let eventDate;
  if (rec["eventDate"] !== undefined && rec["eventDate"] !== null) {
    const v = rec["eventDate"];
    const read = typeof v === "string" ? parseCalendarDate(v) : null;
    if (read === null)
      return bad("EVENT_DATE_UNREADABLE");
    eventDate = read.text;
  }
  if (rec["remind"] !== undefined && rec["remind"] !== null) {
    if (rec["remind"] !== "plain" && rec["remind"] !== "quiet")
      return bad("REMIND_UNKNOWN");
  }
  let recurring;
  if (rec["recurring"] !== undefined && rec["recurring"] !== null) {
    if (!isRecurrence(rec["recurring"]))
      return bad("RECURRING_UNKNOWN");
    if (eventDate !== undefined && !isDay(eventDate))
      return bad("RECURRING_NEEDS_DAY");
    recurring = rec["recurring"];
  }
  const draft = { content: rec["content"] };
  if (eventDate !== undefined) {
    draft.eventDate = eventDate;
    draft.remind = rec["remind"] === "plain" ? "plain" : "quiet";
    if (recurring !== undefined)
      draft.recurring = recurring;
  } else {
    if (rec["remind"] !== undefined && rec["remind"] !== null)
      dropped.push("remind");
    if (recurring !== undefined)
      dropped.push("recurring");
  }
  if (rec["kind"] !== undefined)
    draft.kind = rec["kind"];
  if (typeof rec["title"] === "string")
    draft.title = rec["title"];
  if (rec["claimed"] !== undefined)
    draft.claimed = rec["claimed"];
  if (rec["salience"] !== undefined && typeof rec["salience"] === "object" && rec["salience"] !== null) {
    draft.salience = rec["salience"];
  }
  if (rec["feeling"] !== undefined)
    draft.feeling = rec["feeling"];
  if (rec["aliases"] !== undefined)
    draft.aliases = rec["aliases"];
  if (typeof rec["updates"] === "string")
    draft.updates = rec["updates"];
  if (typeof rec["how"] === "string") {
    if (draft.updates !== undefined)
      draft.how = rec["how"];
    else
      dropped.push("how");
  }
  draft.unresolved = rec["unresolved"] === true;
  const dateIntent = {
    eventDate: eventDate !== undefined ? "set" : rec["eventDate"] === null ? "cleared" : "absent",
    remind: rec["remind"] === "plain" || rec["remind"] === "quiet" ? rec["remind"] : null,
    recurring: recurring ?? (rec["recurring"] === null ? "cleared" : null)
  };
  const threadSaid = typeof rec["unresolved"] === "boolean";
  return { ok: true, draft, dropped, dateIntent, threadSaid };
}
export const NO_GATE = () => ({ ok: false, gate: "none", reason: "NO_GATE_INJECTED" });
export async function submitProposal(buffer, raw, ctx) {
  const base = {
    accepted: false,
    reason: "OBSERVER",
    proposal: null,
    coverage: [],
    gate: null,
    malformed: null,
    degradedToSpan: false,
    droppedFields: [],
    records: [],
    channels: [],
    kind: null,
    blockedBy: []
  };
  if (buffer.observer) {
    buffer.emit("remember.observer.standdown", undefined, { site: "proposal" });
    return base;
  }
  const parsed = intake(raw);
  if (!parsed.ok) {
    let degraded = false;
    if (parsed.text !== null && parsed.text.trim().length > 0) {
      degraded = buffer.jot({ session: ctx.session, scope: ctx.scope, text: parsed.text }).captured;
    }
    buffer.emit("remember.proposal.malformed", undefined, {
      reason: parsed.reason,
      degraded,
      dropped: parsed.dropped.length
    });
    return {
      ...base,
      reason: "MALFORMED",
      malformed: parsed.reason,
      degradedToSpan: degraded,
      droppedFields: parsed.dropped
    };
  }
  const draft = parsed.draft;
  const contentHash = hashText(normalize(draft.content));
  const priors = buffer.proposalRecords(ctx.scope);
  if (priors.some((p) => p.accepted && p.contentHash === contentHash)) {
    buffer.emit("remember.proposal.duplicate", contentHash, { session: ctx.session });
    return { ...base, reason: "DUPLICATE_CONTENT", droppedFields: parsed.dropped };
  }
  const kind = draft.kind ?? "fact";
  const own = ctx.ownSpanHash === undefined || ctx.ownSpanHash === null ? null : buffer.spans(ctx.scope).find((s) => s.hash === ctx.ownSpanHash) ?? null;
  const gate = ctx.gate ?? NO_GATE;
  let verdict;
  try {
    verdict = await gate({
      content: draft.content,
      kind,
      aliases: draft.aliases ?? [],
      feeling: draft.feeling ?? null,
      title: draft.title ?? null,
      claimed: draft.claimed ?? null,
      salience: draft.salience ?? {},
      span: own === null ? null : { hash: own.hash, text: own.text },
      source: ctx.source,
      day: buffer.day()
    });
  } catch (err) {
    buffer.emit("remember.proposal.gate.failed", undefined, { session: ctx.session });
    return { ...base, reason: "GATE_FAILED", gate: "unknown", droppedFields: parsed.dropped, malformed: null, kind, blockedBy: [] };
  }
  if (!verdict.ok) {
    buffer.emit("remember.proposal.rejected", contentHash, {
      gate: verdict.gate,
      reason: verdict.reason
    });
    return {
      ...base,
      reason: "GATE_REJECTED",
      gate: verdict.gate,
      droppedFields: parsed.dropped,
      records: verdict.records ?? [],
      channels: verdict.channels ?? [],
      kind,
      blockedBy: verdict.blockedBy ?? []
    };
  }
  let updates = null;
  if (draft.updates !== undefined && ctx.resolveUpdates !== undefined) {
    updates = await ctx.resolveUpdates(draft.updates, verdict.content);
  }
  const { novelty: _claimedNovelty, ...authoredDims } = draft.salience ?? {};
  const proposal = {
    id: `prp_${randomBytes(6).toString("hex")}`,
    source: ctx.source,
    session: ctx.session,
    scope: ctx.scope,
    content: verdict.content,
    kind,
    title: draft.title ?? null,
    salience: {
      ...authoredDims,
      ...verdict.novelty === undefined ? {} : { novelty: verdict.novelty },
      claimed: draft.claimed ?? null
    },
    feeling: verdict.feeling !== undefined ? verdict.feeling : draft.feeling ?? null,
    aliases: [...verdict.aliases ?? draft.aliases ?? []],
    updates,
    ...draft.updates === undefined ? {} : { how: draft.how ?? "changed", howSent: draft.how !== undefined },
    unresolved: draft.unresolved === true,
    eventDate: draft.eventDate ?? null,
    remind: draft.eventDate === undefined ? null : draft.remind ?? "quiet",
    recurring: draft.eventDate === undefined ? null : draft.recurring ?? null,
    dateIntent: parsed.dateIntent,
    ...parsed.threadSaid ? { threadSaid: true } : {},
    at: buffer.now(),
    day: buffer.day(),
    contentHash,
    covers: [],
    ownSpanHash: own?.hash ?? null
  };
  const coverage = ctx.cover === false ? [] : buffer.claimCoverage({
    scope: ctx.scope,
    session: ctx.cover === undefined ? ctx.session : ctx.cover.session,
    proposalId: proposal.id,
    ownSpanHash: ctx.cover === undefined ? proposal.ownSpanHash : null,
    ...ctx.source === "jot" && ctx.cover === undefined ? { ownTurn: true } : {}
  });
  proposal.covers = coverage.map((c) => c.spanHash);
  const record = {
    id: proposal.id,
    contentHash,
    session: proposal.session,
    source: proposal.source,
    at: proposal.at,
    day: proposal.day,
    covers: proposal.covers,
    accepted: true
  };
  if (!buffer.recordProposal(ctx.scope, record)) {
    return {
      ...base,
      reason: "IO_FAILED",
      droppedFields: parsed.dropped,
      records: verdict.records ?? [],
      channels: verdict.channels ?? [],
      kind,
      blockedBy: []
    };
  }
  buffer.emit("remember.proposal.accepted", proposal.id, {
    source: proposal.source,
    kind: proposal.kind,
    claimed: proposal.salience.claimed,
    covers: proposal.covers.length,
    updates: proposal.updates?.method ?? "none"
  });
  return {
    accepted: true,
    reason: "ACCEPTED",
    proposal,
    coverage,
    gate: null,
    malformed: null,
    degradedToSpan: false,
    droppedFields: parsed.dropped,
    records: verdict.records ?? [],
    channels: verdict.channels ?? [],
    kind,
    blockedBy: []
  };
}
export const ALREADY_AUTHORED_MARK = "[already authored by the experiencer]";
export function markCovered(spans, covered) {
  return spans.map((span) => ({ span, mark: covered.has(span.hash) ? ALREADY_AUTHORED_MARK : null }));
}
export function renderForSweep(marked) {
  return marked.map((m) => m.mark === null ? m.span.text : `${m.mark}
${m.span.text}`).join(`

---

`);
}
function normalize(text) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
