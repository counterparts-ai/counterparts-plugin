import { WRITE_UP_BY, recordWriteUp } from "../../core/remember/write-up-seam.js";
import { calendarDate } from "../../core/self/index.js";
import {
  NIGHT_RUNNER_PREFIX,
  WRITE_UP_CLAIM_MS,
  WRITE_UP_KEPT_MARK,
  WRITE_UP_PART_BYTES,
  WRITE_UP_REPLY_MARK,
  claimWriteUpProgress,
  firstUnwrittenPart,
  isSessionId,
  liveClaim,
  markWriteUpFetched,
  progressKey,
  readSession,
  readWriteUpProgress,
  sameScope,
  saveWriteUpProgress,
  writeUpEntries,
  writeUpPartsDated,
  writeUpPlan,
  writeUpStanding
} from "../sessions.js";
export const WRITE_UP_REFUSALS = [
  "handoff-not-accepted",
  "unknown-session",
  "live-session",
  "other-project",
  "already-written-up",
  "owes-nothing",
  "not-asked",
  "wrong-part",
  "part-already-written",
  "memories-required",
  "nothing-landed",
  "io-failed",
  "claimed",
  "allowance-spent",
  "grant-expired",
  "reason-required"
];
const BY = "next-session";
const refused = (reason, detail = {}) => ({
  reason,
  isError: true,
  body: { stored: false, writeUp: true, reason, ...detail }
});
const NO_DEPOSITS = { outcomes: [], deposited: 0, duplicates: 0 };
export async function writeUpDoor(input) {
  const { args, counterpart } = input;
  const ended = args["writeUp"];
  const present = (v) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  if (present(args["handoff"]) || present(args["retireHandoff"])) {
    return refused("handoff-not-accepted", {
      detail: "A handoff is this directory's pointer, written by this session for itself. Send it on its own `session_end`, without `writeUp`."
    });
  }
  if (!isSessionId(ended))
    return refused("unknown-session", { writeUp: typeof ended === "string" ? ended : null });
  if (ended === input.session) {
    return refused("live-session", { writeUp: ended, detail: "That is this session. Its own memories go on an ordinary `session_end`." });
  }
  const plan = writeUpPlan({ store: counterpart.store, spans: counterpart.spans });
  const all = readWriteUpProgress(counterpart.store);
  const record = readSession(input.registryDir, input.session);
  let st;
  if (record?.mayWriteUp?.includes(ended) === true && record.sessionId.startsWith(NIGHT_RUNNER_PREFIX) && (record.endedAt !== null || input.now - record.lastBoundaryAt >= WRITE_UP_CLAIM_MS)) {
    return refused("grant-expired", { writeUp: ended, detail: "This runner's grant has run out. A later catch-up writes that session up." });
  }
  if (record?.mayWriteUp?.includes(ended) === true) {
    const held = plan.find((h) => h.session === ended);
    const subject = held === undefined ? readSession(input.registryDir, ended) : null;
    const scopes = held?.scopes ?? (subject === null ? [] : [subject.scope]);
    if (scopes.length === 0)
      return refused("unknown-session", { writeUp: ended });
    let found = null;
    let first = null;
    for (const scope of scopes) {
      const s = writeUpStanding(plan, input.registryDir, ended, scope, input.now, { progress: all });
      if (s.status === "owed") {
        found = s;
        break;
      }
      first ??= s;
    }
    if (found === null) {
      const why = first ?? { status: "unknown-session" };
      if (why.status === "owes-nothing")
        return refused("owes-nothing", { writeUp: ended, why: why.why });
      if (why.status === "live-session") {
        return refused("live-session", { writeUp: ended, detail: "That session is still at work today. It is written up once it is not." });
      }
      return refused(why.status, { writeUp: ended });
    }
    const key = progressKey(ended, found.here);
    st = { held: found.held, here: found.here, key, progress: all[key], all, granted: true };
  } else {
    const standing = writeUpStanding(plan, input.registryDir, ended, input.scope, input.now, { progress: all });
    if (standing.status === "owes-nothing")
      return refused("owes-nothing", { writeUp: ended, why: standing.why });
    if (standing.status !== "owed")
      return refused(standing.status, { writeUp: ended });
    const key = progressKey(ended, standing.here);
    st = { held: standing.held, here: standing.here, key, progress: all[key], all, granted: false };
  }
  const held = liveClaim(st.progress, input.now);
  if (held !== null && held.by !== input.session) {
    return refused("claimed", {
      writeUp: ended,
      detail: held.by.startsWith(NIGHT_RUNNER_PREFIX) ? "The nightly run or counterparts catch-up is writing that session up now. Nothing to do here." : "Another session is writing that session up now. Nothing to do here."
    });
  }
  const mine = record?.writeUpFor?.session === ended ? record.writeUpFor : undefined;
  const raw = args["memories"];
  const fetching = raw === undefined || Array.isArray(raw) && raw.length === 0 && mine === undefined;
  if (fetching)
    return handOver(input, ended, st, st.granted ? ended : record?.writeUpPointer, mine);
  return takeBack(input, ended, st, mine, raw);
}
async function handOver(input, ended, st, pointer, mine) {
  const { counterpart } = input;
  if (pointer !== ended)
    return refused("not-asked", { writeUp: ended });
  const p = st.progress;
  if (p !== undefined && p.answer !== undefined && p.waiting !== true) {
    return finish(input, ended, st, p.parts, p.answer, NO_DEPOSITS, true);
  }
  const answered = mine?.answer !== undefined && (p?.done ?? 0) >= mine.part;
  if (mine?.answer !== undefined && !(st.granted && answered)) {
    return refused("part-already-written", {
      writeUp: ended,
      part: mine.part,
      detail: "This session has written up its part. The next part is handed over at a later session start here."
    });
  }
  const current = st.granted && answered ? undefined : mine;
  const chunk = p?.chunk ?? WRITE_UP_PART_BYTES;
  const parts = writeUpPartsDated(writeUpEntries(counterpart.spans, { session: ended, scopes: [st.here] }), chunk);
  if (parts.length === 0)
    return refused("owes-nothing", { writeUp: ended, why: "no-text" });
  const nextUnwritten = Math.min((p?.done ?? 0) + 1, parts.length);
  const part = current?.part ?? firstUnwrittenPart(parts, nextUnwritten);
  const skipped = current === undefined ? part - nextUnwritten : 0;
  const own = liveClaim(p, input.now);
  const upTo = own !== null && own.by === input.session ? own.upTo : undefined;
  if (upTo !== undefined && part > upTo) {
    return refused("allowance-spent", {
      writeUp: ended,
      part,
      of: parts.length,
      detail: "This batch's allowance for that session is spent. The rest stays owed, for the next batch or a later catch-up."
    });
  }
  const next = {
    ...p ?? {},
    chunk,
    parts: parts.length,
    done: Math.min(skipped > 0 ? part - 1 : p?.done ?? 0, parts.length),
    handedAt: input.now,
    claim: { by: input.session, at: input.now, ...upTo === undefined ? {} : { upTo } }
  };
  const took = claimWriteUpProgress(counterpart.store, st.key, next, input.now);
  if (took === "claimed") {
    return refused("claimed", { writeUp: ended, detail: "Another writer took that session a moment ago. Nothing to do here." });
  }
  if (took === "failed")
    return refused("io-failed", { writeUp: ended });
  if (!markWriteUpFetched(input.registryDir, input.session, { session: ended, part })) {
    return refused("io-failed", { writeUp: ended, detail: "The part could not be recorded as handed to this session." });
  }
  return {
    reason: "part",
    isError: false,
    body: {
      writeUp: true,
      reason: "part",
      session: input.session,
      ended,
      endedOn: calendarDate(st.held.clockFrom, counterpart.store.zone()),
      part,
      of: parts.length,
      ...skipped > 0 ? { skipped } : {},
      next: `Hand back what caught your attention in this part, one idea each, with session_end: session: ${input.session}, ` + `writeUp: ${ended}, part: ${String(part)}, memories: [...] — in your own words, as this session's. ` + (st.granted && (parts[part - 1]?.unwritten ?? 0) > 0 ? `If nothing in what is not yet written up is worth keeping, send memories: [] WITH nothing: "<one line: why>" — an empty answer without that line is refused, and the part stays owed. ` : `memories: [] only if nothing in it held your attention. `) + `Anything marked ${WRITE_UP_KEPT_MARK} was written up before — by that session or an earlier write-up. ` + `Lines marked ${WRITE_UP_REPLY_MARK} are what that session said back — context for what was said to it; you are writing it up second-hand.` + (part < parts.length ? st.granted ? " Then fetch the next part the same way (writeUp and no memories)." : " The rest comes at later session starts here." : ""),
      text: parts[part - 1]?.text
    }
  };
}
function reasonGiven(v) {
  return typeof v === "string" && v.trim().length >= 8;
}
async function takeBack(input, ended, st, mine, raw) {
  const { counterpart, args } = input;
  const p = st.progress;
  if (mine === undefined || p === undefined) {
    return refused("not-asked", { writeUp: ended, detail: "Fetch it first: the same call with no memories returns its words." });
  }
  const part = mine.part;
  const said = args["part"];
  const claimed = typeof said === "string" && /^\d+$/.test(said) ? Number(said) : said;
  if (claimed !== undefined && claimed !== part) {
    return refused("wrong-part", { writeUp: ended, part, detail: `This session was handed part ${String(part)}.` });
  }
  const final = part >= p.parts;
  if (p.answer !== undefined && p.waiting !== true) {
    return finish(input, ended, st, p.parts, p.answer, NO_DEPOSITS, true);
  }
  if (p.done >= part)
    return refused("part-already-written", { writeUp: ended, part, of: p.parts });
  if (!Array.isArray(raw))
    return refused("memories-required", { writeUp: ended, part });
  const said2 = raw.length === 0 ? "nothing-new" : "memories";
  const dated = writeUpPartsDated(writeUpEntries(counterpart.spans, { session: ended, scopes: [st.here] }), p.chunk);
  if (st.granted && raw.length === 0 && (dated[part - 1]?.unwritten ?? 0) > 0 && !reasonGiven(args["nothing"])) {
    return refused("reason-required", {
      writeUp: ended,
      part,
      detail: `Part ${String(part)} holds words not yet written up. Hand back what is worth keeping in it, or send memories: [] with nothing: "<one line: why nothing in it is worth keeping>".`
    });
  }
  const livedAt = dated[part - 1]?.lastAt ?? st.held.clockFrom;
  const happenedOn = livedAt > 0 ? calendarDate(livedAt, counterpart.store.zone()) : null;
  const deposits = raw.length === 0 ? NO_DEPOSITS : await input.deposit(raw, final ? { session: ended } : false, st.granted ? st.here : undefined, {
    session: ended,
    happenedOn
  });
  if (said2 === "memories" && deposits.deposited === 0 && deposits.duplicates === 0) {
    return {
      reason: "nothing-landed",
      isError: true,
      body: {
        stored: false,
        writeUp: true,
        reason: "nothing-landed",
        ended,
        part,
        entries: raw.length,
        deposited: 0,
        refused: raw.length,
        outcomes: deposits.outcomes
      }
    };
  }
  const answered = markWriteUpFetched(input.registryDir, input.session, { session: ended, part, answer: said2 });
  if (!final) {
    const { claim, ...rest } = p;
    const kept = st.granted && claim !== undefined ? { ...rest, claim: { ...claim, at: input.now } } : rest;
    const advanced = saveWriteUpProgress(counterpart.store, st.key, { ...kept, done: part });
    return {
      reason: "part-written",
      isError: false,
      body: {
        writeUp: true,
        reason: "part-written",
        answer: said2,
        session: input.session,
        ended,
        part,
        of: p.parts,
        entries: raw.length,
        deposited: deposits.deposited,
        refused: raw.length - deposits.deposited,
        outcomes: deposits.outcomes,
        recorded: advanced && answered
      }
    };
  }
  return finish(input, ended, st, part, said2, deposits, false);
}
function finish(input, ended, st, part, said, deposits, retry) {
  const spans = input.counterpart.spans;
  try {
    spans.claimCoverage({ scope: st.here, session: ended, proposalId: `writeup:${input.session}` });
  } catch {}
  const elsewhere = st.held.scopes.filter((scope) => !sameScope(scope, st.here) && writeUpEntries(spans, { session: ended, scopes: [scope] }).length > 0 && !(() => {
    const q = st.all[progressKey(ended, scope)];
    return q !== undefined && q.done >= q.parts && q.waiting === true;
  })());
  const { claim: _released, ...base } = st.progress ?? { chunk: WRITE_UP_PART_BYTES, parts: part, done: 0, handedAt: input.now };
  const entries = deposits.outcomes.length;
  const common = {
    writeUp: true,
    answer: said,
    session: input.session,
    ended,
    part,
    of: base.parts,
    entries,
    deposited: deposits.deposited,
    refused: entries - deposits.deposited,
    outcomes: deposits.outcomes
  };
  if (elsewhere.length > 0) {
    saveWriteUpProgress(input.counterpart.store, st.key, { ...base, done: part, answer: said, waiting: true });
    return {
      reason: "written-up-here",
      isError: false,
      body: {
        ...common,
        reason: "written-up-here",
        marked: false,
        elsewhere: elsewhere.length
      }
    };
  }
  const reasons = [recordWriteUp(spans, { scope: st.here, session: ended, by: BY })];
  const marked = reasons.includes("RECORDED");
  if (marked)
    saveWriteUpProgress(input.counterpart.store, st.key, null, { allOf: ended });
  else
    saveWriteUpProgress(input.counterpart.store, st.key, { ...base, done: part, answer: said });
  return {
    reason: "written-up",
    isError: !marked,
    body: {
      ...common,
      reason: "written-up",
      marked,
      ...marked ? {} : { markReasons: [...new Set(reasons)] },
      ...retry ? { detail: "The last part's answer landed on an earlier call; this one only recorded the write-up." } : {}
    }
  };
}
