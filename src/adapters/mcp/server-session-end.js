import { CLAIM_NOTHING_NEW, claimUnwritten } from "../../core/coverage/index.js";
import { DREW_ON_MAX_PER_BOUNDARY, RECALL_CREDIT_EVENT } from "../../core/counterpart.js";
import { CONTRADICTION_TUNABLES, NEIGHBOURS_HINT } from "../../core/reconsolidation.js";
import { installedVersion, isSessionId, markNothingNew, readSession, sameScope } from "../sessions.js";
import { writeUpDoor } from "./write-up.js";
import {
  readDimensions,
  pickDimensions,
  readReminder,
  readFeelings,
  readAbout,
  readTraits,
  readWriteFacts,
  MEMORY_KINDS,
  reminderEcho,
  undatedReminderWarning,
  factsEcho,
  threadOf
} from "./server-args.js";
export async function sessionEndTool(server, args) {
  if (server.observer)
    return server["standDown"]("session_end");
  const bound = server["requireBoundSession"](args["session"], "session_end");
  if (bound !== null)
    return bound;
  const drewOn = server["drewOnField"](args["drewOn"], "session_end");
  if (typeof args["writeUp"] === "string" && args["writeUp"].length > 0)
    return server["writeUpField"](args, drewOn);
  const unnamed = server["callBoundBy"] === "most-recent";
  const handoff = unnamed ? server["unnamedHandoffField"](args["handoff"]) : server["writeHandoffField"](args["handoff"]);
  const retiredRaw = args["retireHandoff"];
  let retired = null;
  if (!unnamed) {
    retired = server["retireHandoffField"](retiredRaw);
  } else if (!(Array.isArray(retiredRaw) && retiredRaw.length === 0)) {
    const refused = server["unnamedHandoffField"](retiredRaw);
    retired = refused === null ? null : [refused];
  }
  const raw = args["memories"];
  const session = server.session;
  const landed = handoff !== null && handoff["written"] === true || retired !== null && retired.some((r) => r["written"] === true);
  const noMemories = raw === undefined || Array.isArray(raw) && raw.length === 0;
  const emptyList = Array.isArray(raw) && raw.length === 0;
  if (landed && noMemories || emptyList) {
    const marked = markNothingNew(server["registryDir"], session, server["nowFn"]()) !== null;
    if (emptyList)
      claimUnwritten(server.counterpart.spans, { session, scope: server.scope, by: CLAIM_NOTHING_NEW, ref: session });
    const handoffFailed = handoff !== null && handoff["written"] !== true && handoff["reason"] !== "nothing-to-clear" || retired !== null && retired.some((r) => r["written"] !== true && r["reason"] !== "not-here");
    server["emit"]("mcp.session_end", session, {
      entries: 0,
      deposited: 0,
      refused: 0,
      handoff: landed,
      nothingNew: true,
      recorded: marked
    });
    return server["result"]({
      session,
      entries: 0,
      deposited: 0,
      refused: 0,
      outcomes: [],
      reason: landed ? "handoff-only" : "nothing-new",
      recorded: marked,
      ...handoff === null ? {} : { handoff },
      ...retired === null ? {} : { retired },
      ...drewOn === null ? {} : { drewOn }
    }, handoffFailed);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return server["refuse"]("session_end", "memories-required", {
      ...handoff === null ? {} : { handoff },
      ...retired === null ? {} : { retired },
      ...drewOn === null ? {} : { drewOn }
    });
  }
  const { outcomes, deposited, entries } = await server["depositEntries"](raw, session);
  server["emit"]("mcp.session_end", session, {
    entries: entries.length,
    deposited,
    refused: entries.length - deposited,
    handoff: handoff === null ? false : handoff["written"] === true
  });
  return server["result"]({
    session,
    entries: entries.length,
    deposited,
    refused: entries.length - deposited,
    outcomes,
    ...outcomes.some((o) => o["neighbours"] !== undefined) ? { neighboursHint: NEIGHBOURS_HINT } : {},
    ...handoff === null ? {} : { handoff },
    ...retired === null ? {} : { retired },
    ...drewOn === null ? {} : { drewOn }
  }, deposited === 0);
}
export async function depositEntries(server, raw, session, cover, scope, writeUp) {
  const entries = [];
  const feelingsOf = [];
  const datedOf = [];
  const aboutOf = [];
  const traitsOf = [];
  const factsOf = [];
  const today = server["today"]();
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      entries.push({ content: "" });
      feelingsOf.push({ inputs: [] });
      datedOf.push({ fields: {}, remindIgnored: false });
      aboutOf.push({ mark: null });
      traitsOf.push({ inputs: [] });
      factsOf.push({ sent: {}, dropped: [], notes: [] });
      continue;
    }
    const rec = item;
    const draft = { content: rec["content"] };
    if (typeof rec["kind"] === "string")
      draft["kind"] = rec["kind"];
    if (typeof rec["title"] === "string")
      draft["title"] = rec["title"];
    if (typeof rec["updates"] === "string")
      draft["updates"] = rec["updates"];
    if (rec["how"] !== undefined)
      draft["how"] = rec["how"];
    if (typeof rec["unresolved"] === "boolean")
      draft["unresolved"] = rec["unresolved"];
    if (rec["salience"] !== undefined)
      draft["claimed"] = rec["salience"];
    const entryDims = readDimensions(rec) ?? pickDimensions(rec);
    if (Object.keys(entryDims).length > 0)
      draft["salience"] = entryDims;
    const dated = readReminder(rec);
    if (!("refused" in dated))
      Object.assign(draft, dated.fields);
    datedOf.push(dated);
    entries.push(draft);
    feelingsOf.push(readFeelings(rec["feelings"]));
    aboutOf.push(readAbout(rec["about"]));
    traitsOf.push(readTraits(rec["traits"]));
    factsOf.push(readWriteFacts(rec, today));
  }
  const outcomes = [];
  let deposited = 0;
  let duplicates = 0;
  const batch = [];
  let listed = 0;
  const model = server["sessionModel"]();
  for (const [n, draft] of entries.entries()) {
    const feelings = feelingsOf[n] ?? { inputs: [] };
    if ("refused" in feelings) {
      outcomes.push({ stored: false, reason: "feelings-malformed", detail: feelings.refused });
      continue;
    }
    const dated = datedOf[n] ?? { fields: {}, remindIgnored: false };
    if ("refused" in dated) {
      outcomes.push({ stored: false, reason: dated.refused, detail: dated.detail });
      continue;
    }
    const about = aboutOf[n] ?? { mark: null };
    if ("refused" in about) {
      outcomes.push({ stored: false, reason: "about-malformed", detail: about.refused });
      continue;
    }
    const traits = traitsOf[n] ?? { inputs: [] };
    if ("refused" in traits) {
      outcomes.push({ stored: false, reason: "traits-malformed", detail: traits.refused });
      continue;
    }
    const facts = factsOf[n] ?? { sent: {}, dropped: [], notes: [] };
    let result;
    try {
      result = await server.counterpart.submitSessionEnd(draft, {
        session,
        scope: scope ?? server.scope,
        owner: server.owner,
        facts: facts.sent,
        about: about.mark,
        siblings: [...batch],
        ...cover === undefined ? {} : { cover },
        ...model === undefined ? {} : { model },
        ...writeUp === undefined ? {} : { writeUp }
      });
    } catch (err) {
      outcomes.push({ stored: false, reason: "threw", detail: String(err.message ?? err) });
      continue;
    }
    if (result.deposited)
      deposited += 1;
    if (result.reason === "duplicate-content")
      duplicates += 1;
    const malformed = result.malformed ?? null;
    const neighbours = server["neighboursOf"](result, batch, Math.min(CONTRADICTION_TUNABLES.NEIGHBOURS, CONTRADICTION_TUNABLES.NEIGHBOURS_PER_CALL - listed), session);
    listed += neighbours.length;
    if (result.memoryId !== null)
      batch.push(result.memoryId);
    outcomes.push({
      stored: result.deposited,
      reason: result.reason,
      ...result.memoryId === null ? {} : { id: result.memoryId },
      ...result.gate === null ? {} : { gate: result.gate },
      ...malformed === null ? {} : { malformed },
      ...malformed === "KIND_UNKNOWN" ? { kinds: [...MEMORY_KINDS] } : {},
      ...server["recordFeelings"](result, feelings.inputs, model),
      ...server["recordAbout"](result, about.mark),
      ...server["recordTraits"](result, traits.inputs, model),
      ...reminderEcho(result, dated, server["today"]()),
      ...undatedReminderWarning(result, dated, draft["title"], draft["content"]),
      ...factsEcho(result, facts),
      ...server["settledOf"](result, draft["how"] !== undefined),
      ...threadOf(result),
      ...neighbours.length === 0 ? {} : { neighbours },
      ...server["slotOf"](result)
    });
  }
  return { outcomes, deposited, duplicates, entries };
}
export async function writeUpField(server, args, drewOn) {
  const session = server.session;
  const out = await writeUpDoor({
    counterpart: server.counterpart,
    registryDir: server["registryDir"],
    scope: server.scope,
    session,
    now: server["nowFn"](),
    args,
    deposit: (raw, cover, scope, writeUp) => server["depositEntries"](raw, session, cover, scope, writeUp)
  });
  const body = out.body;
  const ended = args["writeUp"];
  const known = isSessionId(ended) && readSession(server["registryDir"], ended) !== null;
  server["emit"]("mcp.write_up", known ? ended : undefined, {
    reason: out.reason,
    part: typeof body["part"] === "number" ? body["part"] : null,
    of: typeof body["of"] === "number" ? body["of"] : null,
    deposited: typeof body["deposited"] === "number" ? body["deposited"] : 0,
    marked: typeof body["marked"] === "boolean" ? body["marked"] : null,
    skipped: typeof body["skipped"] === "number" ? body["skipped"] : 0
  });
  if (out.isError && body["stored"] === false && out.reason !== "nothing-landed") {
    server["emit"]("mcp.refused", undefined, { tool: "session_end", reason: out.reason });
  }
  return server["result"](drewOn === null ? body : { ...body, drewOn }, out.isError);
}
export function drewOnField(server, raw, via) {
  if (raw === undefined || raw === null)
    return null;
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
    return { credited: [], reason: "drewOn-malformed", detail: "drewOn is a list of memory ids, as strings." };
  }
  if (raw.length === 0)
    return null;
  if (server["callBoundBy"] === "most-recent") {
    return {
      credited: [],
      reason: "session-unnamed",
      detail: `Name your session to say what you drew on: session: <the id wake gave this chat>. This call named none, so it was filed under the most recent Claude Desktop session (${server.session ?? "none"}), which may be another chat's.`
    };
  }
  const session = server.session;
  let out;
  try {
    out = server.counterpart.creditDrewOn(session, raw, { at: server["today"]() });
  } catch (err) {
    return { credited: [], reason: "threw", detail: String(err.message ?? err) };
  }
  const byReason = {};
  for (const r of out.refused)
    byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  if (out.capped.length > 0)
    byReason["capped"] = out.capped.length;
  server["telemetry"](() => {
    server.counterpart.noteAdapterEvent(RECALL_CREDIT_EVENT, {
      source: "drewOn",
      via,
      reason: out.credited.length > 0 ? "credited" : "nothing-to-credit",
      session,
      date: server["today"](),
      day: out.day,
      considered: out.named,
      credited: out.credited.length,
      refused: byReason,
      ids: out.credited.slice(0, 64),
      how: out.credited.slice(0, 64).map(() => "drewOn"),
      idsTotal: out.credited.length,
      refusedIds: out.refused.slice(0, 64).map((r) => r.id),
      capped: out.capped.slice(0, 64),
      linked: out.linked
    });
  });
  return {
    credited: out.credited,
    ...out.refused.length === 0 ? {} : { refused: out.refused },
    ...out.capped.length === 0 ? {} : { capped: out.capped, cap: `At most ${String(DREW_ON_MAX_PER_BOUNDARY)} per boundary, the first named; these were not credited.` },
    ...out.actedOn.length === 0 ? {} : { actedOn: out.actedOn, actedOnNote: "Dated memories you acted on: they will not come back as footnotes around this date again." }
  };
}
export function writeHandoffField(server, raw) {
  if (raw === undefined || raw === null)
    return null;
  let out;
  try {
    if (typeof raw !== "string") {
      out = server.counterpart.refuseHandoff("not-text", { session: server.session });
    } else if (server.scopeSource === "store" || sameScope(server.scope, server.counterpart.store.dir)) {
      out = server.counterpart.refuseHandoff("no-scope", { session: server.session });
    } else if (raw.trim().length === 0) {
      out = server.counterpart.clearHandoff({ scope: server.scope, session: server.session });
    } else {
      out = server.counterpart.writeHandoff(raw, {
        scope: server.scope,
        session: server.session,
        model: server["sessionModel"]() ?? null,
        build: server["identity"]?.build.version ?? installedVersion()
      });
    }
  } catch (err) {
    return { written: false, reason: "threw", detail: String(err.message ?? err) };
  }
  server["emit"]("mcp.handoff", out.id ?? undefined, {
    written: out.written,
    reason: out.reason,
    bytes: out.bytes
  });
  return {
    written: out.written,
    reason: out.reason,
    ...out.id === null ? {} : { id: out.id },
    bytes: out.bytes,
    ...out.version === null ? {} : { version: out.version },
    ...out.gate === null ? {} : { gate: out.gate },
    ...out.redacted === null ? {} : { redacted: true },
    ...out.showsForDays === null ? {} : { showsForDays: out.showsForDays },
    ...out.others === undefined || out.others.length === 0 ? {} : { others: out.others }
  };
}
export function unnamedHandoffField(server, raw) {
  if (raw === undefined || raw === null)
    return null;
  const detail = `Name your session to leave or retire a handoff: session: <the id wake gave this chat> — or, in a Claude Code session (Desktop's Code tab), the id your wake or Stop ask names. This call named none, so it was filed under the most recent Claude Desktop session (${server.session ?? "none"}), which may be another chat's.`;
  try {
    const out = server.counterpart.refuseHandoff("session-unnamed", { session: server.session });
    server["emit"]("mcp.handoff", undefined, { written: false, reason: out.reason, bytes: 0 });
    return { written: false, reason: out.reason, bytes: 0, detail };
  } catch (err) {
    return { written: false, reason: "threw", detail: String(err.message ?? err) };
  }
}
export function retireHandoffField(server, raw) {
  if (raw === undefined || raw === null)
    return null;
  const ids = typeof raw === "string" ? [raw] : raw;
  if (Array.isArray(ids) && ids.length === 0)
    return null;
  const outcome = (id, out) => {
    server["emit"]("mcp.handoff.retire", out.id ?? undefined, { written: out.written, reason: out.reason });
    return { ...id === null ? {} : { id }, written: out.written, reason: out.reason, bytes: out.bytes };
  };
  try {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return [outcome(null, server.counterpart.refuseHandoff("not-text", { session: server.session }))];
    }
    if (server.scopeSource === "store" || sameScope(server.scope, server.counterpart.store.dir)) {
      return [outcome(null, server.counterpart.refuseHandoff("no-scope", { session: server.session }))];
    }
    return [...new Set(ids)].map((id) => outcome(id, server.counterpart.retireHandoff(id, { scope: server.scope, session: server.session })));
  } catch (err) {
    return [{ written: false, reason: "threw", detail: String(err.message ?? err) }];
  }
}
export async function chapterTool(server, args) {
  if (server.observer)
    return server["standDown"]("chapter");
  const bound = server["requireBoundSession"](args["session"], "chapter");
  if (bound !== null)
    return bound;
  const drewOn = server["drewOnField"](args["drewOn"], "chapter");
  const withDrewOn = drewOn === null ? {} : { drewOn };
  const text = args["text"];
  if (typeof text !== "string" || text.trim().length === 0) {
    return server["refuse"]("chapter", "text-required", {
      detail: "A chapter has to say something. Nothing worth writing is a real answer — say nothing at all instead.",
      ...withDrewOn
    });
  }
  const session = server.session;
  const title = args["title"];
  const about = readAbout(args["about"]);
  if ("refused" in about)
    return server["refuse"]("chapter", "about-malformed", { detail: about.refused, ...withDrewOn });
  const model = readSession(server["registryDir"], session)?.model;
  let written;
  try {
    written = server.counterpart.appendEpisode(session, text, {
      scope: server.scope,
      ...typeof title === "string" && title.length > 0 ? { title } : {},
      ...model === undefined ? {} : { model },
      ...about.mark === null ? {} : { about: about.mark }
    });
  } catch (err) {
    return server["refuse"]("chapter", "threw", { detail: String(err.message ?? err), ...withDrewOn });
  }
  server["emit"]("mcp.chapter", written.episodeId ?? undefined, {
    session,
    stored: written.appended,
    reason: written.reason,
    chapter: written.chapter,
    created: written.created
  });
  return server["result"]({
    stored: written.appended,
    reason: written.reason,
    session,
    episodeId: written.episodeId,
    chapter: written.chapter,
    created: written.created,
    ...written.gate === null ? {} : { gate: written.gate },
    ...about.mark === null || !written.appended ? {} : { about: about.mark },
    ...withDrewOn
  }, !written.appended);
}
