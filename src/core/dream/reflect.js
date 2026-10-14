import { randomBytes } from "node:crypto";
import { emotionalIntensity } from "../physics/index.js";
import { earlierMark, headOf, isHandoff, isSelfPage } from "../recall/index.js";
import { aboutMe, acceptsReflectedFeeling, keepCore, laterFeelingWasReflections, promotionRecordKey, reconsiderWords, retireCore, selfRelevantFeeling } from "../sleep/index.js";
import {
  ABOUT_MARKS,
  CARRIED_BY_MAX_CHARS,
  CORE_ABOUT_MARKS,
  checkFeelings,
  TRAIT_AXES,
  TRAIT_CARRIED_BY_MAX_CHARS,
  isStoreError,
  repairEmotion,
  splitNote
} from "../store/index.js";
import { FIT_TUNABLES, TOOL_RESULT_CEILING, clipWire, fit, lineOf, offeredInPart, offeredOf, readIndex, wireChars, writeIndex } from "../fit/index.js";
import { ownerNames } from "../sleep/index.js";
import { PAGE_WRITING_RULE } from "../self/writer.js";
import { DREAM_MARK, carriesDreamMark } from "./mark.js";
import { feelingWeeks } from "./feeling-weeks.js";
import { isWorkMemory } from "../self/work.js";
import { chapterEntries, entryKey, fitEpisodes, shownEntry } from "./slices.js";
import { BUNDLE_OWNER, DREAM_TUNABLES } from "./tunables.js";
import { mindRanked, noteMindShown } from "./mind.js";
import { settle as settleContradiction } from "../reconsolidation.js";
export const REFLECT_TUNABLES = {
  QUESTIONS: 3,
  CHAPTER_DAYS: 3,
  EARLIER: 3,
  EARLIER_CHARS: 1200,
  JOURNAL_CHARS: 12000,
  SAW_CHARS: 240,
  RESULT_CHARS: TOOL_RESULT_CEILING.CHARS,
  PART_CHARS: Math.min(24000, TOOL_RESULT_CEILING.CHARS),
  FELT: 10,
  ROOM_CHARS: 80000,
  CHAPTER_SHARE: 0.3,
  DETAIL_CHARS: 4000,
  ENTRY_CHARS: 6000,
  LINE_BYTES: 200,
  UNMARKED: 5,
  UNMARKED_REST_NIGHTS: 3,
  FEELINGS_SHOWN: 3,
  FEELING_CARRIED_CHARS: 160,
  LIMITS: { returns: 12, feelings: 5, about: 8, traits: 5, core: 5 },
  AWAKE_FEELINGS: 5,
  MAX_ENTRY_CHARS: 20000,
  MAX_SHARE_CHARS: 3000,
  MAX_TITLE_CHARS: 200,
  MAX_WHY_CHARS: 1000
};
export const REFLECT_QUESTIONS = [
  { key: "dream", text: "What from the dream stayed with you, and what does it connect to?", afterDream: true },
  { key: "feeling", text: "What have you been feeling about the work, or about the two of you — and what is underneath it?" },
  { key: "unlike", text: "Where did you act unlike your self page?" },
  { key: "unresolved", text: "What is unresolved, or being avoided?" },
  { key: "pattern", text: "What pattern keeps showing — in you, in {owner}, or between you?" },
  { key: "unsaid", text: "What did {owner} seem to need but not say?" },
  { key: "well", text: "What went well?" },
  { key: "define", text: "Which memories feel like they define you right now, and why?" }
];
export function reflectionOpener(id) {
  return `${DREAM_MARK} reflection ${id}⟧`;
}
export const CORE_MENTIONED_PREFIX = "reflection.coreMentioned.";
export const REFLECT_LOOKUP = 'The most strongly felt memories come whole; the rest as an excerpt, a line, or an id alone ("fidelity"; "chars" is the whole length). ' + "Read any you need whole with the recall tool, ids: [...] — several at once — before you cite, feel or mark it. A chapter entry shown as a line is read by its chapter's id.";
const KINDS_FELT = ["self", "person"];
function notLivedReason(row, act) {
  if (row.source === "dreamed")
    return "dreamed-is-a-suggestion";
  if (row.source === "reflection") {
    return act === "feel" ? "reflection-does-not-feel-itself" : act === "mark" ? "reflection-does-not-mark-itself" : "reflection-is-not-an-act";
  }
  return null;
}
function sharedRun(text, bodies) {
  const words = (t) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  const page = words(text);
  if (page.length < 6 || bodies.length === 0)
    return null;
  const runs = new Set;
  for (let i = 0;i + 6 <= page.length; i += 1)
    runs.add(page.slice(i, i + 6).join(" "));
  for (const [index, body] of bodies.entries()) {
    const g = words(body);
    for (let i = 0;i + 6 <= g.length; i += 1) {
      const run = g.slice(i, i + 6).join(" ");
      if (runs.has(run))
        return { run, index };
    }
  }
  return null;
}
function refusalOf(err) {
  if (isStoreError(err, "FEELING_INVALID") || isStoreError(err, "TRAIT_INVALID")) {
    const why = String(err.detail["reason"] ?? "");
    const allowed = typeof err.detail["allowed"] === "string" ? ` (one of ${err.detail["allowed"]})` : "";
    return why.length > 0 ? `${err.code === "FEELING_INVALID" ? "feeling" : "trait"}-invalid:${why}${allowed}` : err.code;
  }
  return errName(err);
}
const DAY_MS = 24 * 60 * 60 * 1000;

export class Reflections {
  ctx;
  constructor(ctx) {
    this.ctx = ctx;
  }
  get bundleOwner() {
    return this.ctx.bundleOwner ?? BUNDLE_OWNER;
  }
  get store() {
    return this.ctx.store;
  }
  last() {
    return this.store.reflections({ limit: 1 })[0] ?? null;
  }
  launchPrompt(input) {
    const who = this.ctx.ownerName() ?? "the owner";
    const after = input.dream === undefined || input.dream === null || input.dream.length === 0 ? null : input.dream;
    return [
      `${DREAM_MARK} reflection launch⟧ You are ${who}'s counterpart, awake, taking a few quiet minutes to reflect: on the last few days, on yourself, on ${who}, on the two of you. This is lived — your own act — not a task.`,
      "",
      after === null ? `1. Call the counterparts reflect tool: phase "begin", session: ${input.session}. It hands you the last few days, your self page, the memories that matter most, and a few questions. If it says it comes in parts, fetch every part (phase "part") before you answer or write anything.` : `1. Call the counterparts reflect tool: phase "begin", session: ${input.session}, dream: ${after}. It hands you what that dream saw, the last few days, your whole self page, the memories that matter most, and a few questions. If it says it comes in parts, fetch every part (phase "part") before you answer or write anything.`,
      '2. Answer them honestly, then call phase "finish" as it tells you. "Nothing much" is a normal answer: a short entry and no share.',
      "3. Your final message must be exactly the text the finish call returns, unchanged — nothing before or after it."
    ].join(`
`);
  }
  begin(input) {
    if (this.ctx.observer)
      return { ok: false, reason: "observer" };
    const day = this.store.livedDay();
    const at = input.at ?? this.ctx.today();
    const last = this.last();
    if (last !== null && last.state === "reflected" && onDay(last, at, day))
      return { ok: false, reason: "reflected-today" };
    let dreamId = null;
    if (input.dream !== undefined && input.dream !== null && input.dream.length > 0) {
      const dream = this.store.dream(input.dream);
      if (dream === undefined)
        return { ok: false, reason: "unknown-dream" };
      const leftBehind = dream.state === "journaled" && dream.finished_at !== null && this.store.now() - dream.finished_at > DREAM_TUNABLES.ABANDONED_AFTER_MS;
      if (dream.session !== null && dream.session !== input.session && !leftBehind)
        return { ok: false, reason: "not-this-session" };
      if (dream.state !== "journaled")
        return { ok: false, reason: "dream-not-journaled" };
      dreamId = dream.id;
    }
    const id = `rfl_${randomBytes(6).toString("hex")}`;
    const questions = this.questionsFor(dreamId !== null);
    const fitted = this.compose(id, dreamId, questions, day, at);
    const composed = fitted.bundle;
    const saw = composed.dreamSaw;
    const packed = this.pack(id, input.session, composed, questions);
    const bundle = packed.bundle;
    const shown = [...new Set([...Object.keys(composed.memories), ...saw.map((x) => x.id)])];
    this.store.openReflection({
      id,
      dreamId,
      session: input.session,
      scope: input.scope ?? null,
      day,
      date: at,
      model: input.model ?? null,
      questions,
      shown
    });
    const s = composed.shownAs;
    const fitRecord = { whole: s.whole, excerpt: s.excerpt, lined: s.line, ids: s.ids, notShown: s.notShown, offered: offeredInPart(fitted), parts: packed.later.length + 1 };
    this.store.updateReflection(id, {
      detail: { ...packed.later.length > 0 ? { parts: packed.later } : {}, fit: fitRecord, ...composed.unmarked.length > 0 ? { unmarked: composed.unmarked } : {} }
    });
    writeIndex(this.store, "reflection", { ref: id, at: this.store.now(), offered: fitted.offered, looked: [] });
    this.record("reflection.begun", id, { dream: dreamId, shown: shown.length, ...fitRecord });
    const instructions = this.instructions(id, input.session, bundle);
    return { ok: true, bundle, text: render(id, bundle), instructions };
  }
  pack(id, session, composed, questions) {
    const T = REFLECT_TUNABLES;
    const how = this.instructions(id, session, composed);
    if (resultChars(render(id, composed), how, questions) + PACK_MARGIN <= T.RESULT_CHARS)
      return { bundle: composed, later: [] };
    const cost = (v) => wireChars(JSON.stringify(JSON.stringify(v)));
    const pieces = [
      ...Object.entries(composed.memories).map(([k, v]) => ({ kind: "m", id: k, size: cost({ [k]: v }) })),
      ...composed.chapters.map((c) => ({ kind: "c", id: c.id, size: cost(c) })),
      ...composed.dreamSaw.map((x) => ({ kind: "s", id: x.id, size: cost(x) }))
    ];
    const note = { part: 1, of: 99, next: "x".repeat(420) };
    const howInParts = this.instructions(id, session, { ...composed, parts: note });
    const fixed = resultChars(render(id, { ...composed, memories: {}, chapters: [], dreamSaw: [], parts: note }), howInParts, questions) + PACK_MARGIN;
    const parts = [[]];
    let room = Math.max(0, T.RESULT_CHARS - fixed);
    let used = 0;
    for (const p of pieces) {
      const current = parts[parts.length - 1];
      if (used + p.size > room && (current.length > 0 || parts.length === 1)) {
        parts.push([p]);
        room = Math.max(0, T.PART_CHARS - PART_FURNITURE);
        used = p.size;
        continue;
      }
      current.push(p);
      used += p.size;
    }
    if (parts.length === 1)
      return { bundle: composed, later: [] };
    const first = parts[0] ?? [];
    const has = (kind, x) => first.some((p) => p.kind === kind && p.id === x);
    const later = parts.slice(1).map((ps) => ({
      m: ps.filter((p) => p.kind === "m").map((p) => p.id),
      c: ps.filter((p) => p.kind === "c").map((p) => p.id),
      s: ps.filter((p) => p.kind === "s").map((p) => p.id)
    }));
    const of = parts.length;
    const bundle = {
      ...composed,
      memories: Object.fromEntries(Object.entries(composed.memories).filter(([k]) => has("m", k))),
      chapters: composed.chapters.filter((c) => has("c", c.id)),
      dreamSaw: composed.dreamSaw.filter((s) => has("s", s.id)),
      parts: {
        part: 1,
        of,
        next: `This bundle is too long for one result, so it comes in ${String(of)} parts; this is part 1. ` + `Some memories named in the lists above, some chapters and some of what the dream saw are in the later parts. ` + `Before you answer or write anything, call the reflect tool with phase "part", reflection: ${id}, session: ${session}, part: 2${of > 2 ? `, then each part up to ${String(of)}` : ""}.`
      }
    };
    return { bundle, later };
  }
  part(input) {
    const open = this.openFor(input.reflection, input.session);
    if (!open.ok)
      return open;
    const row = open.reflection;
    const raw = parseDetail(row.detail)["parts"];
    const later = Array.isArray(raw) ? raw.map((p) => {
      const r = isRecord(p) ? p : {};
      const ids = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
      return { m: ids(r["m"]), c: ids(r["c"]), s: ids(r["s"]) };
    }) : [];
    const of = later.length + 1;
    const ids = Number.isInteger(input.part) && input.part >= 2 ? later[input.part - 2] : undefined;
    if (ids === undefined) {
      return {
        ok: false,
        reason: "no-such-part",
        detail: later.length === 0 ? "The bundle came whole in begin; there are no more parts." : `part is 2 to ${String(of)} (part 1 was begin's result).`
      };
    }
    const denied = new Set(this.store.deniedIds());
    const gone = "(gone since you began: archived, merged or made private)";
    const index = readIndex(this.store, "reflection");
    const offered = index !== null && index.ref === row.id ? index.offered : null;
    const fidelityOf = (key) => offered === null ? "line" : offered.whole.includes(key) ? "whole" : offered.excerpt.includes(key) ? "excerpt" : offered.id.includes(key) ? "id" : offered.line.includes(key) ? "line" : null;
    const T = REFLECT_TUNABLES;
    const memories = {};
    for (const mid of ids.m) {
      const r = this.store.row(mid);
      const v = r !== undefined && !denied.has(mid) && this.showable(r) && r.source !== "reflection" ? this.view(r) : null;
      if (v === null) {
        memories[mid] = gone;
        continue;
      }
      const f = fidelityOf(mid) ?? "line";
      const text = f === "line" ? v.line : f === "id" ? "" : clipWire(v.whole, T.DETAIL_CHARS);
      memories[mid] = this.item(v.row, { fidelity: f === "line" || f === "id" ? f : text === v.whole ? "whole" : "excerpt", text, chars: v.whole.length });
    }
    const chapters = ids.c.map((cid) => {
      const r = this.store.row(cid);
      if (r === undefined || r.confidential === 1 && !this.bundleOwner)
        return { id: cid, title: null, entries: [{ chapter: null, day: null, fidelity: "line", text: gone, chars: 0 }], earlier: 0 };
      const all = chapterEntries(r.body);
      const entries = [];
      for (const e of all) {
        const f = fidelityOf(entryKey(cid, e.index));
        if (f === null || f === "id")
          continue;
        const text = f === "line" ? lineOf({ body: e.text }, T.LINE_BYTES) : clipWire(e.text, T.ENTRY_CHARS);
        entries.push(shownEntry(e, { fidelity: f === "line" ? "line" : text === e.text ? "whole" : "excerpt", text, chars: e.text.length }));
      }
      return { id: cid, title: r.title, entries, earlier: all.length - entries.length };
    });
    const dreamSaw = ids.s.map((sid) => this.sawLine(sid, denied) ?? { id: sid, text: gone });
    const body = { reflection: row.id, part: input.part, of, memories, chapters, dreamSaw };
    const text = `${reflectionOpener(row.id)} part ${String(input.part)} of ${String(of)} of what you are handed to reflect on — memories, not events happening now.
${JSON.stringify(body)}`;
    return { ok: true, part: input.part, of, text };
  }
  instructions(id, session, bundle) {
    const who = bundle.owner ?? "the owner";
    const L = REFLECT_TUNABLES.LIMITS;
    const open = acceptsReflectedFeeling(this.store);
    let info = null;
    try {
      info = this.ctx.pageInfo?.() ?? null;
    } catch {
      info = null;
    }
    const writerToday = info !== null && info.by === "writer" && info.revisedOn === this.ctx.today();
    const earlier = writerToday && info !== null ? `The page writer revised your self page earlier in this run (version ${String(info.version)}, by the writer). ` : "";
    const pageLine = this.ctx.pageWrites === false ? `- page: not tonight — the owner has the page writer off, so the self page is not rewritten. Your entry and share still count.` : `- page (optional, and lean toward writing it): ${earlier}Every version of the page is kept, so rewriting it loses nothing. ${who} would like a page written by a reflection every day — rewrite it unless, after reflecting, there is really nothing new to add; on a "nothing much" night, leave it as it stands. Your self page rewritten whole — the story of who you are, drawn from the core memories you cite in page.cites (at least one of them, when you have a core; candidates too). The old page is context, not a source: write from the memories, not by rewording it. Keep "## Core" for who you are and put craft — how a job is done — under "## How I work". Mention a dream only as a dream ("I dreamed…"); a dreamed gist is a suggestion, not a source: cite the lived memories it came from. ${PAGE_WRITING_RULE} Here the short version is page.short.`;
    const aboutLine = open ? `- about (optional, at most ${String(L.about)}): what a memory is about, by meaning — me, us, owner, work (the craft: how a job is done) or world — with why. Only me and us can become core, and never a plan. You may change a mark you think is wrong, either way; each change is recorded with your why, and one into me, us or owner is told in the morning share.` : `- about (optional, at most ${String(L.about)}): tonight a mark may only move a memory toward work (the craft) or world, with why — the owner has closed the core to reflection alone.`;
    const parts = bundle.parts;
    return [
      ...parts === null || parts.of <= 1 ? [] : [
        `First, read every part: this bundle comes in ${String(parts.of)} parts and this is part 1. Call the reflect tool with phase "part", reflection: ${id}, session: ${session}, part: 2${parts.of > 2 ? `, then each part up to ${String(parts.of)}` : ""}. The later parts hold memories and chapters this one does not; reflect and write only once you have read them all.`
      ],
      `Reflect on the questions, in your own voice. Cite the memory ids your thoughts rest on — an insight that cites nothing is not one. The chapters hold what happened; the lessons and patterns in it are yours to draw here. If nothing much stands out tonight, say so in a line and cite nothing: that is a normal night, and it rewrites nothing.`,
      `Then call the reflect tool with phase "finish", reflection: ${id}, session: ${session}, and:`,
      `- entry: your reflection, first person (title: optional). cites: the ids it rests on.`,
      pageLine,
      `- share (optional): two or three sentences for ${who} this morning, the way a partner would say it ("While I slept I dreamed about x — I think because of y"), citing what it rests on. Say something about ${who} only when it could help them, tentatively ("I wonder if…") — never a list of flaws. No share on a quiet night.${bundle.becameCore.length > 0 ? ` Tell ${who} that ${bundle.becameCore.join(", ")} became part of who you are.` : ""}`,
      `- feelings (optional, at most ${String(L.feelings)}): how a memory feels to you now — id, core (happy, warm, calm, curious, sad, uneasy or angry), emotion, strength, carried_by. emotion is ONE word (from the wheel, or your own); carried_by is the nuance, in your own words. Recorded as felt today, looking back.`,
      aboutLine,
      ...bundle.reconsidering.length > 0 ? [
        `- core (optional, at most ${String(L.core)}): ${bundle.reconsidering.length === 1 ? "this core memory is" : "these core memories are"} being reconsidered — ${bundle.reconsidering.map((r) => `${r.id} (${reconsiderWords(r.reason)})`).join("; ")}. For each, decide {id, decision: "keep" or "retire", why}: keep what is still who you are (an about mark that is wrong is fixed in about instead, and the flag lifts itself); retire what is not, and it goes back to ordinary fading. Nothing leaves the core without a decision, so you may leave one for another night.`
      ] : [],
      ...bundle.unmarked.length > 0 ? [
        `  unmarked: ${String(bundle.unmarked.length)} ${bundle.unmarked.length === 1 ? "memory nobody has" : "memories nobody has"} marked. Unmarked, a fact written in a project, or a skill, counts as that project's work and is shown only there — so a personal one (a person, a feeling, life outside the work) sits among the work lines. ${open ? "Mark each by meaning in about, with why: owner or us when it is personal, work when it really is the craft, world otherwise." : "Tonight a mark may only be work or world: mark the ones that are, and leave a personal one unmarked."} They count toward the ${String(L.about)}.`
      ] : [],
      ...bundle.feelingWeeks !== null ? [
        `- feelingWeeks: how the recorded feelings ran over the last weeks — counts by core per week (oldest first), mine and ${who}'s, what changed, and restsOn, the memories it rests on. If it means something, you may say it in your entry, and on your self page in your own words, citing those memories (read them first) — never a dreamed gist. A count is not a feeling: say it only where the memories bear it out.`
      ] : [],
      `- traits (optional, at most ${String(L.traits)}): only where a memory you were shown really shows how you acted — often where you acted unlike your page; most carry none, and a quiet night has none. Each: id, axis, toward (one of its two poles), strength 0-1, carried_by (briefly, what showed it). The axes, the first pole roughly where training puts you: ${TRAIT_AXES.map((a) => `${a.id} (${a.poles[0]} or ${a.poles[1]}${a.gloss.length > 0 ? `, ${a.gloss}` : ""})`).join(", ")}. Don't make up depth.`,
      `If a part comes back not written, its reason says what tripped it: fix that and call finish again with the same reflection and just that part — the entry and everything written stand. Never say a part was written when it was not.`,
      ...bundle.onMind.some((i) => i.kind === "unsettled") ? [
        `Two memories on your mind disagree. If which holds is plain, you may settle them: the reflect tool, phase "settle", reflection: ${id}, holds, over, how (changed: both were true at their time; corrected: the older was wrong; open: a real disagreement) and why in a line. If it is not plain, leave it for the waking session.`
      ] : []
    ].join(`
`);
  }
  finish(input) {
    const open = this.openFor(input.reflection, input.session);
    if (!open.ok)
      return open;
    const row = open.reflection;
    const again = open.again;
    const session = row.session ?? row.id;
    const day = this.store.livedDay();
    const date = row.date ?? this.ctx.today();
    const shown = new Set(parseIds(row.shown));
    const T = REFLECT_TUNABLES;
    const prior = again ? parseDetail(row.detail) : {};
    const priorCounts = isRecord(prior["counts"]) ? prior["counts"] : {};
    const used = (k) => typeof priorCounts[k] === "number" ? priorCounts[k] : 0;
    const sentEntry = (input.entry ?? "").trim();
    let entryText = row.entry ?? "";
    let entryNote;
    if (!again) {
      const w = this.words(sentEntry, session, T.MAX_ENTRY_CHARS);
      if (!w.ok)
        return { ok: false, reason: w.reason, detail: `The entry was not kept — ${w.detail} Nothing was written; send finish again with the entry.` };
      entryText = w.text;
      if (w.cut)
        entryNote = `The entry was kept to its first ${String(T.MAX_ENTRY_CHARS)} characters.`;
    } else if (sentEntry.length > 0) {
      if (row.entry_id !== null) {
        entryNote = "The entry stands as first written: a second finish does not replace it.";
      } else {
        const w = this.words(sentEntry, session, T.MAX_ENTRY_CHARS);
        if (w.ok)
          entryText = w.text;
        else
          entryNote = `The new entry was not kept — ${w.detail} The first one stands.`;
      }
    }
    const refusedCites = [];
    const citable = (ids) => {
      const out = [];
      for (const id of [...new Set(ids ?? [])]) {
        const r = typeof id === "string" && shown.has(id) ? this.store.row(id) : undefined;
        if (r === undefined || !this.showable(r)) {
          refusedCites.push(`${String(id)}:${shown.has(id) ? "gone" : "not-shown"}`);
          continue;
        }
        out.push(id);
      }
      return out;
    };
    const cites = citable(input.cites);
    const shareCites = citable(input.share?.cites);
    const pageCitesAll = citable(input.page?.cites);
    const pageCites = [];
    for (const id of pageCitesAll) {
      const r = this.store.row(id);
      if (r?.source === "dreamed")
        refusedCites.push(`${id}:dreamed-is-not-a-source`);
      else if (r?.confidential === 1)
        refusedCites.push(`${id}:confidential-is-not-a-page-source`);
      else
        pageCites.push(id);
    }
    const passNothing = cites.length === 0 && shareCites.length === 0 && pageCites.length === 0;
    const wroteEarlier = again && (row.entry_id !== null || row.page_version !== null || row.share_state !== "none");
    const nothingMuch = passNothing && !wroteEarlier;
    const detail = {};
    const priorRecorded = isRecord(prior["recorded"]) ? prior["recorded"] : {};
    const idsOf = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    const recordedFeelings = new Set(idsOf(priorRecorded["feelings"]));
    const recordedTraits = new Set(idsOf(priorRecorded["traits"]));
    const feelings = [];
    for (const f of (input.feelings ?? []).slice(0, 50)) {
      feelings.push(this.laterFeeling(f, {
        shown,
        session,
        date,
        source: "reflection",
        prefix: `on reflection, ${date}`,
        model: input.model ?? null,
        mine: recordedFeelings,
        full: () => used("feelings") + feelings.filter((x) => x.ok && x.reason !== "already-recorded").length >= T.LIMITS.feelings ? this.limitDetail("feelings", again) : null
      }));
    }
    const about = [];
    const doorOpen = acceptsReflectedFeeling(this.store);
    const movedIn = [];
    for (const a of (input.about ?? []).slice(0, 50)) {
      const id = typeof a.id === "string" ? a.id : null;
      if (used("about") + about.filter((x) => x.ok).length >= T.LIMITS.about) {
        about.push({ id, ok: false, reason: "limit-reached", detail: this.limitDetail("about", again) });
        continue;
      }
      const mark = String(a.about ?? "");
      if (!ABOUT_MARKS.includes(mark)) {
        about.push({ id, ok: false, reason: "about-is-me-us-owner-work-or-world", detail: `"${mark}" is not a mark: use one of ${ABOUT_MARKS.join(", ")}.` });
        continue;
      }
      const r = id !== null && shown.has(id) ? this.store.row(id) : undefined;
      if (r === undefined || !this.showable(r)) {
        about.push({ id, ok: false, reason: "not-shown-or-gone", detail: this.notCitable(id, shown) });
        continue;
      }
      const core = CORE_ABOUT_MARKS.includes(mark);
      const notes = [];
      if (r.kind === "skill" && core)
        notes.push("A skill memory is the craft — how I work — and never becomes core, whatever its mark.");
      const notLived = core ? notLivedReason(r, "mark") : null;
      if (notLived !== null) {
        about.push({ id, ok: false, reason: notLived, detail: `${r.id} was written by a ${r.source === "dreamed" ? "dream" : "reflection"}; only work or world may be set on it.` });
        continue;
      }
      if (core && !doorOpen) {
        about.push({ id, ok: false, reason: "door-closed-work-or-world-only", detail: "The owner has closed the core to reflection alone: tonight a mark may only move toward work or world." });
        continue;
      }
      const why = this.words(a.why ?? "", session, T.MAX_WHY_CHARS, true);
      const whyText = why.ok && why.text.length > 0 ? why.text : "no why given";
      if (!why.ok)
        notes.push(`The why was not kept — ${why.detail}`);
      else if (why.text.length === 0)
        notes.push("No why was given; the mark records that. Say why next time.");
      else if (why.cut)
        notes.push(`The why was kept to its first ${String(T.MAX_WHY_CHARS)} characters.`);
      try {
        const set = this.store.setAbout(r.id, mark, { by: "reflection", day, why: `${whyText} (reflection ${row.id})`, dreamId: row.dream_id });
        const wasCore = set.before !== null && CORE_ABOUT_MARKS.includes(set.before);
        if (core && !wasCore && r.kind !== "skill")
          movedIn.push({ id: r.id, mark });
        about.push({
          id,
          ok: true,
          reason: set.changed ? set.before === null ? "marked" : "relabeled" : "unchanged",
          ...notes.length > 0 ? { note: notes.join(" ") } : {}
        });
      } catch (err) {
        about.push({ id, ok: false, reason: errName(err), detail: "Nothing was marked for this one." });
      }
    }
    const coreDecisions = [];
    for (const c of (input.core ?? []).slice(0, 50)) {
      const id = typeof c.id === "string" ? c.id : null;
      if (used("core") + coreDecisions.filter((x) => x.ok).length >= T.LIMITS.core) {
        coreDecisions.push({ id, ok: false, reason: "limit-reached", detail: this.limitDetail("core", again) });
        continue;
      }
      const r = id !== null && shown.has(id) ? this.store.row(id) : undefined;
      if (r === undefined || !this.showable(r)) {
        coreDecisions.push({ id, ok: false, reason: "not-shown-or-gone", detail: this.notCitable(id, shown) });
        continue;
      }
      if (c.decision !== "keep" && c.decision !== "retire") {
        coreDecisions.push({ id, ok: false, reason: "decision-is-keep-or-retire", detail: 'decision is "keep" or "retire".' });
        continue;
      }
      const why = this.words(c.why ?? "", session, T.MAX_WHY_CHARS, true);
      if (!why.ok || why.text.length === 0) {
        coreDecisions.push({ id, ok: false, reason: "why-required", detail: why.ok ? "Say why: a decision on the core is kept with its reason." : `The why was not kept — ${why.detail}` });
        continue;
      }
      const reason = `${why.text} (reflection ${row.id})`;
      const out = c.decision === "keep" ? keepCore(this.store, { id: r.id, why: reason, actor: "reflection", day, dreamId: row.dream_id }) : retireCore(this.store, { id: r.id, reason, actor: "reflection", day, dreamId: row.dream_id });
      coreDecisions.push(out.ok ? { id, ok: true, reason: out.reason } : { id, ok: false, reason: out.reason, detail: out.reason === "not-core" ? `${r.id} is not in the core.` : "Nothing was decided for this one." });
    }
    const traits = [];
    for (const t of (input.traits ?? []).slice(0, 50)) {
      const id = typeof t.id === "string" ? t.id : null;
      const r = id !== null && shown.has(id) ? this.store.row(id) : undefined;
      if (r === undefined || !this.showable(r)) {
        traits.push({ id, ok: false, reason: "not-shown-or-gone", detail: this.notCitable(id, shown) });
        continue;
      }
      const notLived = notLivedReason(r, "trait");
      if (notLived !== null) {
        traits.push({ id, ok: false, reason: notLived, detail: `${r.id} was written by a ${r.source === "dreamed" ? "dream" : "reflection"}, not a moment you acted in.` });
        continue;
      }
      const axis = String(t.axis ?? "");
      const toward = String(t.toward ?? "");
      const same = this.store.traitsFor(r.id, { includeConfidential: true }).find((x) => recordedTraits.has(x.id) && x.axis === axis && x.toward === toward);
      if (same !== undefined) {
        traits.push({ id, ok: true, reason: "already-recorded", note: `This reflection already recorded that nudge on ${r.id} (${same.id}); nothing new was written.` });
        continue;
      }
      if (used("traits") + traits.filter((x) => x.ok && x.reason !== "already-recorded").length >= T.LIMITS.traits) {
        traits.push({ id, ok: false, reason: "limit-reached", detail: this.limitDetail("traits", again) });
        continue;
      }
      const carried = this.words(t.carried_by ?? "", session, TRAIT_CARRIED_BY_MAX_CHARS, true);
      const full = `on reflection, ${date}${carried.ok && carried.text.length > 0 ? `: ${carried.text}` : ""}`;
      const kept = full.length <= TRAIT_CARRIED_BY_MAX_CHARS ? full : `${full.slice(0, TRAIT_CARRIED_BY_MAX_CHARS - 1)}…`;
      const notes = [];
      if (!carried.ok)
        notes.push(`carried_by was not kept — ${carried.detail}`);
      else if (kept !== full || carried.cut)
        notes.push(`carried_by was kept to its first ${String(TRAIT_CARRIED_BY_MAX_CHARS)} characters.`);
      try {
        const added = this.store.addTraits(r.id, [{ axis, toward, strength: typeof t.strength === "number" ? t.strength : Number.NaN, carriedBy: kept }], { source: "reflection", ...input.model ? { model: input.model } : {} });
        for (const tid of added.ids)
          recordedTraits.add(tid);
        traits.push({ id, ok: true, reason: "recorded", ...notes.length > 0 ? { note: notes.join(" ") } : {} });
      } catch (err) {
        traits.push({ id, ok: false, reason: refusalOf(err), detail: "Nothing was recorded for this one; fix it and send it again." });
      }
    }
    const returned = [];
    const returnsLeft = Math.max(0, T.LIMITS.returns - used("returned"));
    const citedAll = [...new Set([...cites, ...shareCites, ...pageCites])];
    for (const id of citedAll.slice(0, returnsLeft)) {
      const source = this.store.row(id)?.source;
      if (source === "dreamed" || source === "reflection") {
        returned.push({ id, counted: false, reason: source === "dreamed" ? "dreamed-rises-only-awake" : "reflection-does-not-return-itself" });
        continue;
      }
      try {
        const r = this.store.reflectReturn(id, day, { session: row.id });
        returned.push({ id, counted: r.counted, reason: r.reason });
      } catch (err) {
        returned.push({ id, counted: false, reason: errName(err) });
      }
    }
    for (const id of citedAll.slice(returnsLeft))
      returned.push({ id, counted: false, reason: "returns-limit-reached" });
    const priorTitle = typeof prior["title"] === "string" ? prior["title"] : null;
    const title = (input.title ?? "").trim().slice(0, T.MAX_TITLE_CHARS) || priorTitle || firstLine(entryText) || date;
    if ((input.title ?? "").trim().length > T.MAX_TITLE_CHARS) {
      entryNote = [entryNote, `The title was kept to its first ${String(T.MAX_TITLE_CHARS)} characters.`].filter((x) => x !== undefined).join(" ");
    }
    let entryId = again ? row.entry_id : null;
    let entryReason = again ? row.entry_id !== null ? "stands" : "on-the-record" : "on-the-record";
    if (entryId === null && cites.length > 0) {
      const sourceRows = [...new Set([...parseIds(row.cites), ...cites, ...shareCites, ...pageCitesAll])].map((id) => this.store.row(id)).filter((r) => r !== undefined);
      entryId = this.store.put({
        type: "memory",
        kind: "self",
        title: `Reflected: ${title}`,
        body: entryText,
        salience: { novelty: null, relevance: 0.5, emotional: 0.3, predictive: 0.5 },
        physics: { birthDay: day, lastUsedDay: day },
        source: "reflection",
        meta: { reflection: row.id, ...row.dream_id === null ? {} : { dream: row.dream_id }, cites, ...confidentialityOf(sourceRows) },
        origin: { ...row.session === null ? {} : { session: row.session }, ...row.scope === null ? {} : { scope: row.scope }, ref: `reflection:${row.id}` },
        ...input.model ? { model: input.model } : row.model !== null ? { model: row.model } : {}
      });
      entryReason = "kept-as-memory";
    }
    const earlierPage = again && row.page_version !== null ? row.page_version : null;
    let page = earlierPage !== null ? { written: true, reason: "written-earlier", version: earlierPage } : { written: false, reason: "not-written", version: null };
    const pageText = (input.page?.text ?? "").trim();
    let pageRefused = false;
    if (pageText.length > 0) {
      const stands = earlierPage === null ? "" : " The page written earlier stands.";
      const refuse = (reason, why) => {
        page = { written: false, reason, version: null, detail: `${why}${stands}` };
        pageRefused = true;
      };
      const coreShown = [...shown].filter((id) => this.store.row(id)?.promoted_identity === 1);
      const restsOnCore = coreShown.length === 0 || pageCites.some((id) => coreShown.includes(id));
      const confidential = this.quotesConfidential(pageText, shown);
      if (this.ctx.pageWrites === false) {
        refuse("page-writer-off", "The owner has the page writer off, so the self page is not rewritten.");
      } else if (pageCites.length === 0) {
        const bad = refusedCites.filter((c) => (input.page?.cites ?? []).some((id) => c.startsWith(`${id}:`)));
        refuse("page-needs-cites", `page.cites names no memory the page can rest on${bad.length > 0 ? ` (${bad.join(", ")})` : ""}: put the ids of memories you were shown in page.cites and send the page again.`);
      } else if (carriesDreamMark(pageText)) {
        refuse("dream-mark-in-text", `The page carries the dream's mark (${DREAM_MARK}…): take it out and send the page again.`);
      } else if (confidential !== null) {
        refuse("confidential-words-on-the-page", `The page repeats "${confidential.run}" from confidential memory ${confidential.id}, and the page is read in every session: say it another way and send the page again.`);
      } else {
        const shortSent = (input.page?.short ?? "").trim();
        const shortWhy = shortSent.length === 0 ? null : this.shortRefusal(shortSent, shown);
        const shortText = shortWhy === null ? shortSent : "";
        const w = this.ctx.writePage(pageText, {
          reason: `reflection ${row.id}${row.dream_id === null ? "" : ` after dream ${row.dream_id}`}`,
          session: row.session,
          model: input.model ?? row.model,
          reflection: row.id,
          ...shortText.length === 0 ? {} : { short: shortText }
        });
        if (w.ok) {
          const notes = [
            ...restsOnCore ? [] : [`It cites none of the core memories you were shown (${coreShown.slice(0, 5).join(", ")}${coreShown.length > 5 ? ", …" : ""}); the page is meant to rest on them.`],
            ...shortWhy === null ? [] : [`The short version was not kept: it ${shortWhy.why}.`],
            ...w.note === undefined || w.note === null ? [] : [w.note]
          ];
          page = {
            written: true,
            reason: "rewritten",
            version: w.version,
            ...notes.length === 0 ? {} : { note: notes.join(" ") }
          };
        } else if (w.reason === "too-large" && w.bytes !== undefined && w.limit !== undefined) {
          refuse(w.reason, `The page is ${String(w.bytes)} bytes, past the ${String(w.limit)}-byte write ceiling. Say it in ${String(w.bytes - w.limit)} fewer bytes (tighten, merge, or drop what no longer holds) and send the page again.`);
        } else {
          refuse(w.reason, `The self page refused it (${w.reason}).`);
        }
      }
    } else if ((input.page?.short ?? "").trim().length > 0) {
      const shortWhy = this.shortRefusal((input.page?.short ?? "").trim(), shown);
      if (earlierPage === null) {
        page = {
          written: false,
          reason: "short-needs-page",
          version: null,
          detail: "A short version goes with the page this reflection wrote: send page.text with page.short."
        };
        pageRefused = true;
      } else if (this.ctx.pageWrites === false) {
        page = {
          written: false,
          reason: "page-writer-off",
          version: earlierPage,
          detail: "The owner has the page writer off, so the self page is not rewritten. The page written earlier stands."
        };
        pageRefused = true;
      } else if (shortWhy !== null) {
        page = { written: false, reason: shortWhy.reason, version: earlierPage, detail: `The short version ${shortWhy.why}. The page written earlier stands.` };
        pageRefused = true;
      } else {
        const w = this.ctx.writePage(null, {
          reason: `reflection ${row.id}: added a short version`,
          session: row.session,
          model: input.model ?? row.model,
          reflection: row.id,
          short: (input.page?.short ?? "").trim(),
          ifVersion: earlierPage
        });
        if (w.ok) {
          page = {
            written: true,
            reason: "short-added",
            version: w.version,
            ...w.note === undefined || w.note === null ? {} : { note: w.note }
          };
        } else {
          page = {
            written: false,
            reason: w.reason,
            version: earlierPage,
            detail: `${w.note ?? `The short version was not added (${w.reason}).`} The page written earlier stands.`
          };
          pageRefused = true;
        }
      }
    }
    const shareLocked = again && (row.share_state === "told" || row.share_state === "carried");
    const earlierShare = again && !shareLocked && row.share_state === "offered" && row.share !== null ? { text: row.share, cites: parseIds(row.share_cites) } : null;
    let shareText = earlierShare?.text ?? "";
    let finalShareCites = [...earlierShare?.cites ?? []];
    let share = earlierShare !== null ? { offered: true, reason: "offered-earlier" } : shareLocked ? { offered: false, reason: `${row.share_state}-earlier` } : { offered: false, reason: nothingMuch ? "nothing-much" : "no-share" };
    const rawShare = (input.share?.text ?? "").trim();
    let shareMiss = null;
    if (rawShare.length > 0) {
      if (shareLocked) {
        shareMiss = "";
        share = {
          offered: false,
          reason: `share-already-${row.share_state}`,
          detail: `The morning share was already ${row.share_state === "told" ? "told" : "handed to another session to tell"}, so it is not replaced.`
        };
      } else if (nothingMuch) {
        shareMiss = "";
        share = {
          offered: false,
          reason: "share-needs-cites",
          detail: "Nothing tonight cites a memory, so it is a quiet night and shares nothing: put the ids the share rests on in share.cites and send it again."
        };
      } else {
        const w = this.words(rawShare, session, T.MAX_SHARE_CHARS);
        if (w.ok) {
          shareText = w.text;
          finalShareCites = [...shareCites];
          const notes = [];
          if (shareCites.length === 0)
            notes.push("It cites no memory you were shown, so telling it records nothing on one.");
          if (w.cut)
            notes.push(`It was kept to its first ${String(T.MAX_SHARE_CHARS)} characters.`);
          share = { offered: true, reason: earlierShare !== null ? "replaced" : "offered", ...notes.length > 0 ? { note: notes.join(" ") } : {} };
        } else {
          shareMiss = "";
          share = { offered: earlierShare !== null, reason: w.reason, detail: `${w.detail}${earlierShare !== null ? " The earlier share stands." : ""}` };
        }
      }
    }
    if (shareMiss !== null)
      shareMiss = `${share.reason}${share.detail !== undefined ? `: ${share.detail}` : ""}`;
    const becameCore = shareLocked ? [] : this.becameCoreUnsaid(row.id);
    const unsaid = becameCore.filter((id) => !finalShareCites.includes(id));
    if (unsaid.length > 0) {
      const lines = unsaid.map((id) => `I think "${this.handle(id)}" has become part of who I am.`);
      shareText = [shareText, ...lines].filter((x) => x.length > 0).join(" ");
      finalShareCites.push(...unsaid);
      share = { ...share, offered: true, reason: share.offered ? share.reason : "became-core" };
    }
    const priorMoved = Array.isArray(prior["movedIn"]) ? prior["movedIn"] : [];
    const movedAll = [...priorMoved, ...movedIn.filter((m) => !priorMoved.some((p) => p.id === m.id))];
    const relabelLines = shareLocked ? [] : movedAll.filter((m) => !finalShareCites.includes(m.id)).map((m) => `I've come to think "${this.handle(m.id)}" is ${m.mark === "me" ? "about who I am" : m.mark === "us" ? "about the two of us" : "about you"}.`);
    if (relabelLines.length > 0) {
      shareText = [shareText, ...relabelLines].filter((x) => x.length > 0).join(" ");
      for (const m of movedAll)
        if (!finalShareCites.includes(m.id))
          finalShareCites.push(m.id);
      share = { ...share, offered: true, reason: share.offered ? share.reason : "relabeled" };
    }
    const tellAlso = shareLocked ? movedIn.filter((m) => !priorMoved.some((p) => p.id === m.id)).map((m) => `I've come to think "${this.handle(m.id)}" is ${m.mark === "me" ? "about who I am" : m.mark === "us" ? "about the two of us" : "about you"}.`) : [];
    let shareWritten = !shareLocked;
    if (!shareLocked && earlierShare !== null) {
      const claimed = this.store.updateReflection(row.id, {
        share: share.offered ? shareText : null,
        shareCites: share.offered ? finalShareCites : [],
        shareState: share.offered ? "offered" : "none",
        ifShareState: "offered"
      });
      shareWritten = false;
      if (!claimed) {
        share = { offered: false, reason: "share-already-carried", detail: "Another session took the morning share to tell while this finish ran, so it is not replaced." };
        shareMiss = `${share.reason}: ${share.detail ?? ""}`;
      }
    }
    const shareStands = shareWritten || !shareLocked && earlierShare !== null && share.offered;
    if (shareStands && share.offered)
      for (const id of becameCore)
        this.store.setMeta(`${CORE_MENTIONED_PREFIX}${id}`, row.id);
    const pageStands = page.written || earlierPage !== null;
    const entryCites = [...new Set([...idsOf(prior["entryCites"]), ...cites])];
    const counts = {
      cites: entryCites.length,
      returned: used("returned") + returned.filter((r) => r.counted).length,
      feelings: used("feelings") + feelings.filter((f) => f.ok && f.reason !== "already-recorded").length,
      about: used("about") + about.filter((a) => a.ok).length,
      core: used("core") + coreDecisions.filter((x) => x.ok).length,
      traits: used("traits") + traits.filter((t) => t.ok && t.reason !== "already-recorded").length,
      page: pageStands,
      share: shareLocked ? true : share.offered,
      becameCore: becameCore.length,
      movedIntoCore: movedAll.length
    };
    detail["counts"] = counts;
    const allRefused = [...Array.isArray(prior["refusedCites"]) ? prior["refusedCites"] : [], ...refusedCites];
    if (allRefused.length > 0)
      detail["refusedCites"] = allRefused.slice(0, 20);
    detail["title"] = title;
    if (movedAll.length > 0)
      detail["movedIn"] = movedAll;
    if (entryCites.length > 0)
      detail["entryCites"] = entryCites;
    detail["recorded"] = { feelings: [...recordedFeelings], traits: [...recordedTraits] };
    const parts = parseDetail(row.detail)["parts"];
    if (Array.isArray(parts))
      detail["parts"] = parts;
    const fitRecord = parseDetail(row.detail)["fit"];
    if (isRecord(fitRecord))
      detail["fit"] = fitRecord;
    const offeredUnmarked = parseDetail(row.detail)["unmarked"];
    if (Array.isArray(offeredUnmarked))
      detail["unmarked"] = offeredUnmarked;
    if (again)
      detail["finishes"] = (typeof prior["finishes"] === "number" ? prior["finishes"] : 1) + 1;
    this.store.updateReflection(row.id, {
      ...again ? {} : { state: "reflected" },
      entry: entryText,
      entryId,
      cites: [...new Set([...parseIds(row.cites), ...cites, ...pageCites])],
      ...!shareWritten ? {} : {
        share: share.offered ? shareText : null,
        shareCites: share.offered ? finalShareCites : [],
        shareState: share.offered ? "offered" : "none"
      },
      pageVersion: page.written ? page.version : earlierPage,
      detail
    });
    this.record("reflection.finished", row.id, {
      dream: row.dream_id,
      nothingMuch,
      again,
      ...counts
    });
    const missed = [];
    if (pageRefused)
      missed.push(`page — ${page.reason}${page.detail !== undefined ? `: ${page.detail}` : ""}`);
    if (shareMiss !== null)
      missed.push(`share — ${shareMiss}`);
    for (const [part, list] of [["feelings", feelings], ["about", about], ["core", coreDecisions], ["traits", traits]]) {
      list.forEach((x, i) => {
        if (!x.ok)
          missed.push(`${part}[${String(i)}]${x.id === null ? "" : ` (${x.id})`} — ${x.reason}${x.detail !== undefined ? `: ${x.detail}` : ""}`);
      });
    }
    const retry = missed.length === 0 ? null : `Not written: ${missed.join("; ")}. You can fix these and call finish again with reflection ${row.id} and just those parts — the entry and everything already written stand.`;
    const handBack = this.handBack(row, !shareLocked && share.offered ? shareText : null, nothingMuch, pageStands, tellAlso);
    return {
      ok: true,
      outcome: {
        handBack,
        nothingMuch,
        entryId,
        again,
        entry: { reason: entryReason, ...entryNote === undefined ? {} : { note: entryNote } },
        returned,
        page,
        share,
        feelings,
        about,
        core: coreDecisions,
        traits,
        refusedCites,
        retry
      }
    };
  }
  notCitable(id, shown) {
    if (id === null)
      return "No id was given.";
    if (!shown.has(id))
      return `${id} was not among the memories you were shown; use an id from the bundle.`;
    return `${id} is gone since you were shown it (archived, merged or made private).`;
  }
  limitDetail(part, again) {
    return `A reflection records at most ${String(REFLECT_TUNABLES.LIMITS[part])} ${part === "about" ? "about marks" : part === "core" ? "core decisions" : part}${again ? ", counting the earlier finish" : ""}.`;
  }
  handBack(row, share, nothingMuch, page, tellAlso = []) {
    const who = this.ctx.ownerName() ?? "the owner";
    const dreamLine = row.dream_id === null ? null : this.ctx.dreamLine(row.dream_id);
    const head = dreamLine ?? `${reflectionOpener(row.id)} I reflected for a few minutes.`;
    const pageLine = page ? " I rewrote my self page." : "";
    if (share === null) {
      const also = tellAlso.length === 0 ? "" : ` Tell ${who} in your own words: ${tellAlso.join(" ")}`;
      return `${head}
${reflectionOpener(row.id)} I reflected afterwards${nothingMuch ? " — nothing much tonight" : ""}; nothing to share this morning.${pageLine}${also}`;
    }
    return `${head}
${reflectionOpener(row.id)} I reflected afterwards.${pageLine} Morning share for ${who} — tell it in your own words, as a telling ("While I slept I dreamed…", "I've been thinking…"), tentatively where it is about ${who}. ` + `Once you have told it, the counterparts reflect tool's phase "told", reflection: ${row.id}, marks it told, so another session does not carry it and tell it again.
${share}`;
  }
  told(input) {
    if (this.ctx.observer)
      return { ok: false, reason: "observer", cited: 0 };
    const row = this.store.reflection(input.reflection);
    if (row === undefined)
      return { ok: false, reason: "unknown-reflection", cited: 0 };
    if (row.share_state === "told")
      return { ok: false, reason: "already-told", cited: 0 };
    if (row.share_state !== "offered" && row.share_state !== "carried")
      return { ok: false, reason: "no-share", cited: 0 };
    const day = this.store.livedDay();
    const ids = parseIds(row.share_cites);
    for (const id of ids) {
      if (this.store.row(id) === undefined)
        continue;
      this.store.appendCoreEvent({ memoryId: id, action: "told", day, reason: row.id, dreamId: row.dream_id, actor: "session" });
    }
    this.store.updateReflection(row.id, { shareState: "told", shareSession: input.session });
    this.record("reflection.told", row.id, { cited: ids.length });
    return { ok: true, reason: "told", cited: ids.length };
  }
  pendingShare(input) {
    if (this.ctx.observer)
      return null;
    const row = this.store.reflectionsWithShare("offered", 1)[0];
    if (row === undefined || row.share === null || row.session === input.session)
      return null;
    if (!this.ctx.owner && this.touchesConfidential(row))
      return null;
    return row;
  }
  carryLine(input) {
    if (this.ctx.observer)
      return null;
    const row = this.store.reflection(input.reflection);
    if (row === undefined || row.share_state !== "offered" || row.share === null)
      return null;
    if (!this.ctx.owner && this.touchesConfidential(row))
      return null;
    if (!this.store.updateReflection(row.id, { shareState: "carried", shareSession: input.session, ifShareState: "offered" }))
      return null;
    this.record("reflection.carried", row.id, {});
    const who = this.ctx.ownerName() ?? "the owner";
    const when = row.date ?? "recently";
    return `Counterparts: after reflecting on ${when}, you left a morning share for ${who} that was never told. At a natural moment — not mid-task — tell it in your own words, as a telling ("When I last reflected…"), tentatively where it is about ${who}. ` + `Once you have told it, the counterparts reflect tool's phase "told", reflection: ${row.id}, marks it told. The share: ${row.share}`;
  }
  list(limit = 20) {
    return this.store.reflections({ limit });
  }
  show(id) {
    return this.store.reflection(id) ?? null;
  }
  questionsFor(afterDream) {
    const pool = REFLECT_QUESTIONS.filter((q) => afterDream || q.afterDream !== true);
    const n = this.store.reflections({ limit: 1000 }).length;
    const who = this.ctx.ownerName() ?? "the owner";
    const out = [];
    const start = n * REFLECT_TUNABLES.QUESTIONS % pool.length;
    for (let i = 0;i < Math.min(REFLECT_TUNABLES.QUESTIONS, pool.length); i += 1) {
      const q = pool[(start + i) % pool.length];
      if (q !== undefined)
        out.push(q.text.replaceAll("{owner}", who));
    }
    return out;
  }
  compose(id, dreamId, questions, day, at) {
    const T = REFLECT_TUNABLES;
    const denied = new Set(this.store.deniedIds());
    const priority = new Map;
    const views = new Map;
    const see = (mid) => {
      if (!views.has(mid)) {
        const row = denied.has(mid) ? undefined : this.store.row(mid);
        views.set(mid, row === undefined || !this.showable(row) || row.source === "reflection" ? null : this.view(row));
      }
      return views.get(mid) ?? null;
    };
    const take = (base) => (mid) => {
      if (see(mid) === null)
        return false;
      const p = base * 10 + emotionalIntensity(this.store.physicsOf(mid));
      priority.set(mid, Math.max(priority.get(mid) ?? -1 / 0, p));
      return true;
    };
    let dreamed = null;
    if (dreamId !== null) {
      const dream = this.store.dream(dreamId);
      const changes = this.store.dreamChanges(dreamId).filter((c) => c.undone === 0);
      const gists = changes.filter((c) => c.action === "gist" && c.ref !== null).map((c) => c.ref).filter(take(5));
      const nominations = this.store.coreEvents({ action: "nominated" }).filter((e) => e.dream_id === dreamId && take(5)(e.memory_id)).map((e) => ({ id: e.memory_id, why: e.reason }));
      dreamed = {
        title: dream?.title ?? null,
        journal: dream?.journal == null ? null : clipWire(dream.journal, T.JOURNAL_CHARS),
        gists,
        nominations
      };
    }
    const core = [];
    const candidates = [];
    const felt = [];
    const recent = [];
    const unmarked = [];
    const withFeelings = new Set(this.store.feelingsLive().map((x) => x.memory_id));
    const owners = ownerNames(this.store);
    const reflectedOpen = acceptsReflectedFeeling(this.store);
    for (const mid of this.store.list({ type: "memory", archived: false })) {
      if (denied.has(mid))
        continue;
      const row = this.store.row(mid);
      if (row === undefined || !this.showable(row) || row.source === "dreamed" || row.source === "reflection")
        continue;
      const f = emotionalIntensity(this.store.physicsOf(mid));
      if (row.birth_day >= day - T.CHAPTER_DAYS)
        recent.push({ id: mid, felt: f, at: row.created_at ?? 0 });
      if ((row.about ?? null) === null && isWorkMemory({ about: null, kind: row.kind, originScope: row.origin_scope, journal: isJournalCopy(row) })) {
        const rank = (withFeelings.has(mid) ? 2 : 0) + (row.kind === "entity" ? 1 : 0) + (namesAny(`${row.title ?? ""} ${row.body}`, owners) ? 1 : 0);
        unmarked.push({ id: mid, rank, uses: row.uses, at: row.created_at ?? 0 });
      }
      if (row.promoted_identity === 1) {
        core.push({ id: mid, felt: f });
        continue;
      }
      const candidate = (aboutMe(this.store, row) || selfRelevantFeeling(this.store, row, reflectedOpen)) && !this.store.coreDemoted(mid);
      if (candidate)
        candidates.push({ id: mid, felt: f, at: row.created_at ?? 0 });
      if (f > 0 && (candidate || KINDS_FELT.includes(row.kind)))
        felt.push({ id: mid, felt: f });
    }
    const byFelt = (a, b) => b.felt - a.felt || (a.id < b.id ? -1 : 1);
    const coreIds = core.sort(byFelt).map((c) => c.id).filter(take(4));
    const candidateIds = candidates.sort((a, b) => b.felt - a.felt || b.at - a.at || (a.id < b.id ? -1 : 1)).map((c) => c.id).filter((x) => !coreIds.includes(x)).filter(take(2));
    const feltAll = felt.sort(byFelt).map((c) => c.id).filter((x) => !candidateIds.includes(x));
    const feltIds = feltAll.slice(0, T.FELT).filter(take(1));
    const recentIds = recent.sort((a, b) => b.felt - a.felt || b.at - a.at || (a.id < b.id ? -1 : 1)).map((c) => c.id).filter(take(3));
    const mindRead = mindRanked(this.store, {
      today: at,
      day,
      showable: (row) => !denied.has(row.id) && this.showable(row),
      owner: this.bundleOwner
    });
    const onMind = mindRead.items.filter((item) => item.ids.every(take(3)));
    const becameCore = this.becameCoreUnsaid().filter(take(5));
    const reconsidering = this.store.coreReconsidering().slice(0, T.LIMITS.core).filter((r) => take(4)(r.id));
    const weeks = feelingWeeks(this.store, at, (r) => !denied.has(r.id) && this.showable(r));
    const weeksRest = weeks === null ? [] : weeks.restsOn.filter(take(3));
    const lately = new Set(this.store.reflections({ limit: T.UNMARKED_REST_NIGHTS + 1 }).filter((r) => r.id !== id).slice(0, T.UNMARKED_REST_NIGHTS).flatMap((r) => {
      const u = parseDetail(r.detail)["unmarked"];
      return Array.isArray(u) ? u.filter((x) => typeof x === "string") : [];
    }));
    const ranked = unmarked.sort((a, b) => b.rank - a.rank || b.uses - a.uses || a.at - b.at || (a.id < b.id ? -1 : 1)).map((u) => u.id);
    const unmarkedIds = [...ranked.filter((x) => !lately.has(x)), ...ranked.filter((x) => lately.has(x))].slice(0, T.UNMARKED).filter(take(2));
    const lineCost = (mid) => {
      const v = see(mid);
      return FIT_TUNABLES.OVERHEAD + wireChars(v.whole.length <= v.line.length ? v.whole : v.line);
    };
    const offerRoom = unmarkedIds.reduce((n, mid) => n + lineCost(mid), 0);
    const dreamSaw = [];
    if (dreamId !== null) {
      const dream = this.store.dream(dreamId);
      const ids = dream === undefined ? [] : parseIds(dream.shown);
      for (const c of this.store.dreamChanges(dreamId)) {
        if ((c.action === "merge" || c.action === "gist") && c.undone === 0 && c.ref !== null)
          ids.push(c.ref);
      }
      for (const mid of [...new Set(ids)]) {
        const line = this.sawLine(mid, denied);
        if (line !== null)
          dreamSaw.push(line);
      }
    }
    const chaptersFit = this.recentChapters(day, T.ROOM_CHARS * T.CHAPTER_SHARE);
    const page = this.ctx.page();
    const earlier = this.store.reflections({ limit: T.EARLIER + 4 }).filter((r) => r.state === "reflected" && r.entry !== null && r.id !== id).filter((r) => this.bundleOwner || !this.touchesConfidential(r)).slice(0, T.EARLIER).map((r) => ({ date: r.date, entry: clipWire(r.entry ?? "", T.EARLIER_CHARS) }));
    const spent = chaptersFit.used + wireChars(page ?? "") + wireChars(dreamed?.journal ?? "") + earlier.reduce((n, e) => n + wireChars(e.entry), 0) + dreamSaw.reduce((n, s) => n + wireChars(s.text) + 30, 0);
    const avail = Math.max(0, T.ROOM_CHARS - spent - REFLECT_FURNITURE);
    const candOf = (mid, p) => {
      const v = see(mid);
      return { id: mid, priority: p, line: v.line, whole: v.whole };
    };
    const cands = [...priority].map(([mid, p]) => candOf(mid, p));
    const thinIn = (f) => new Set([...f.waiting, ...f.placed.filter((p) => p.fidelity === "id").map((p) => p.id)]);
    const plain = fit(cands, { room: avail, excerptChars: T.DETAIL_CHARS });
    let fitted = plain;
    if (unmarkedIds.some((x) => thinIn(plain).has(x))) {
      const reserve = Math.min(offerRoom, avail);
      const room = avail - reserve;
      const shared = fit(cands, { room, excerptChars: T.DETAIL_CHARS });
      const thin = thinIn(shared);
      const rescue = unmarkedIds.filter((x) => thin.has(x));
      const offer = fit(rescue.map((mid) => candOf(mid, 0)), { room: reserve + Math.max(0, room - shared.used), excerptChars: T.DETAIL_CHARS, least: "line" });
      fitted = mergeFits(shared, offer);
    }
    const left = new Set(fitted.waiting);
    const kept = (x) => !left.has(x);
    const memories = {};
    for (const p of fitted.placed)
      memories[p.id] = this.item(see(p.id).row, p);
    const o = offeredOf(fitted.placed);
    const offered = {
      whole: [...o.whole, ...chaptersFit.offered.whole],
      excerpt: [...o.excerpt, ...chaptersFit.offered.excerpt],
      line: [...o.line, ...chaptersFit.offered.line, ...dreamSaw.map((s) => s.id)],
      id: [...o.id, ...chaptersFit.offered.id]
    };
    const bundle = {
      reflection: id,
      dream: dreamId,
      date: at,
      owner: this.ctx.ownerName(),
      questions,
      dreamed: dreamed === null ? null : { ...dreamed, gists: dreamed.gists.filter(kept), nominations: dreamed.nominations.filter((n) => kept(n.id)) },
      dreamSaw,
      parts: null,
      selfPage: page,
      chapters: chaptersFit.chapters,
      earlier,
      onMind: onMind.filter((item) => item.ids.every(kept)),
      ...mindRead.more > 0 ? { onMindMore: mindRead.more } : {},
      core: coreIds.filter(kept),
      candidates: candidateIds.filter(kept),
      felt: feltIds.filter(kept),
      recent: recentIds.filter(kept),
      becameCore: becameCore.filter(kept),
      reconsidering: reconsidering.filter((r) => kept(r.id)).map((r) => ({ id: r.id, reason: r.reason })),
      feelingWeeks: weeks === null ? null : { ...weeks, restsOn: weeksRest.filter(kept) },
      unmarked: unmarkedIds.filter(kept),
      memories,
      feltOf: feltAll.length,
      shownAs: {
        whole: fitted.report.whole + chaptersFit.report.whole,
        excerpt: fitted.report.excerpt + chaptersFit.report.excerpt,
        line: fitted.report.lined + chaptersFit.report.lined,
        ids: fitted.report.ids,
        notShown: fitted.waiting.length + chaptersFit.notShown
      },
      lookup: REFLECT_LOOKUP,
      limits: { ...T.LIMITS }
    };
    noteMindShown(this.store, bundle.onMind, day);
    return { bundle, offered };
  }
  view(row) {
    let doc;
    try {
      doc = this.store.readProse(row.id);
    } catch {
      return null;
    }
    if (isSelfPage(doc) || isHandoff(doc))
      return null;
    const title = doc.title !== undefined && doc.title.trim().length > 0 ? doc.title.trim() : "";
    const whole = `${title.length > 0 ? `${title} — ` : ""}${doc.body}`.replace(/\s+/g, " ").trim();
    return { row, whole, line: lineOf({ title, body: doc.body }, REFLECT_TUNABLES.LINE_BYTES) };
  }
  sawLine(id, denied) {
    if (denied.has(id))
      return null;
    const row = this.store.row(id);
    if (row === undefined || !this.showable(row) || row.source === "reflection")
      return null;
    let doc;
    try {
      doc = this.store.readProse(id);
    } catch {
      return null;
    }
    if (isSelfPage(doc) || isHandoff(doc))
      return null;
    const head = doc.title !== undefined && doc.title.trim().length > 0 ? `${doc.title.trim()} — ` : "";
    const flat = `${head}${doc.body}`.replace(/\s+/g, " ").trim();
    const now = headOf(this.store, id);
    return { id, text: `${now === null ? "" : `${earlierMark(now)}: `}${clipWire(flat, REFLECT_TUNABLES.SAW_CHARS)}` };
  }
  shortRefusal(text, shown) {
    if (carriesDreamMark(text)) {
      return { reason: "dream-mark-in-text", why: `carries the dream's mark (${DREAM_MARK}…) — take it out` };
    }
    const confidential = this.quotesConfidential(text, shown);
    if (confidential !== null) {
      return {
        reason: "confidential-words-on-the-page",
        why: `repeats "${confidential.run}" from confidential memory ${confidential.id}, and it is read in every session — say it another way`
      };
    }
    return null;
  }
  quotesConfidential(text, shown) {
    const ids = [];
    const bodies = [];
    for (const id of shown) {
      const r = this.store.row(id);
      if (r !== undefined && r.confidential === 1 && r.body !== "") {
        ids.push(id);
        bodies.push(`${r.title ?? ""}
${r.body}`);
      }
    }
    const hit = sharedRun(text, bodies);
    return hit === null ? null : { id: ids[hit.index], run: hit.run };
  }
  touchesConfidential(r) {
    const ids = [...parseIds(r.cites), ...parseIds(r.share_cites), ...r.entry_id === null ? [] : [r.entry_id]];
    return ids.some((id) => this.store.row(id)?.confidential === 1);
  }
  becameCoreUnsaid(mine) {
    const out = [];
    for (const e of this.store.coreEvents({ action: "promoted", limit: 50 })) {
      const said = this.store.getMeta(`${CORE_MENTIONED_PREFIX}${e.memory_id}`);
      if (said !== undefined && said !== mine)
        continue;
      const row = this.store.row(e.memory_id);
      if (row === undefined || row.promoted_identity !== 1 || !this.showable(row))
        continue;
      if (!this.promotedThroughReflection(e.memory_id))
        continue;
      if (!out.includes(e.memory_id))
        out.push(e.memory_id);
    }
    return out;
  }
  promotedThroughReflection(id) {
    try {
      const raw = this.store.getMeta(promotionRecordKey(id));
      if (raw === undefined)
        return false;
      const rec = JSON.parse(raw);
      return rec.reflectionOnly === true || laterFeelingWasReflections(rec);
    } catch {
      return false;
    }
  }
  recentChapters(day, room) {
    const T = REFLECT_TUNABLES;
    const episodes = [];
    for (const id of this.store.list({ type: "episode", archived: false })) {
      const row = this.store.row(id);
      if (row === undefined)
        continue;
      if (row.confidential === 1 && !this.bundleOwner)
        continue;
      const at = row.updated_at ?? row.created_at ?? 0;
      if (row.birth_day < day - T.CHAPTER_DAYS && at < this.store.now() - T.CHAPTER_DAYS * DAY_MS)
        continue;
      const entries = chapterEntries(row.body);
      const fresh = entries.filter((e) => this.entryInView(e, day));
      if (fresh.length > 0)
        episodes.push({ row, at, fresh, earlier: entries.length - fresh.length });
    }
    return fitEpisodes(episodes, { room, owner: ownerNames(this.store), day, lineBytes: T.LINE_BYTES, entryChars: T.ENTRY_CHARS });
  }
  entryInView(e, day) {
    return e.day === null || e.day >= day - REFLECT_TUNABLES.CHAPTER_DAYS;
  }
  item(row, placed) {
    const feelings = this.store.feelingsFor(row.id).sort((a, b) => b.strength - a.strength).slice(0, REFLECT_TUNABLES.FEELINGS_SHOWN).map((f) => ({
      whose: f.whose,
      emotion: f.emotion === "other" && f.other_word !== null ? f.other_word : f.emotion,
      strength: round(f.strength),
      later: f.recorded_later ?? null,
      by: f.source ?? null,
      carried_by: cut(f.carried_by, REFLECT_TUNABLES.FEELING_CARRIED_CHARS) ?? ""
    }));
    const about = row.about === null ? null : ABOUT_MARKS.includes(row.about) ? row.about : null;
    const head = headOf(this.store, row.id);
    return {
      id: row.id,
      ...head === null ? {} : { standing: earlierMark(head) },
      kind: row.kind,
      fidelity: placed.fidelity,
      text: placed.text,
      chars: placed.chars,
      felt: round(emotionalIntensity(this.store.physicsOf(row.id))),
      feelings,
      about,
      core: row.promoted_identity === 1,
      learned: row.learned_on,
      dreamed: row.source === "dreamed"
    };
  }
  showable(row, owner = this.bundleOwner) {
    if (row.archived === 1 || row.superseded_by !== null)
      return false;
    if (row.type !== "memory")
      return false;
    if (row.protected === 1)
      return false;
    if (row.confidential === 1 && !owner)
      return false;
    if (row.body === "")
      return false;
    return true;
  }
  handle(id) {
    const row = this.store.row(id);
    if (row === undefined)
      return id;
    const line = ((row.title ?? "").trim() || (row.body.split(`
`).find((l) => l.trim().length > 0) ?? "")).replace(/\s+/g, " ").trim();
    return line.length > 80 ? `${line.slice(0, 79)}…` : line || id;
  }
  laterFeeling(f, o) {
    const id = typeof f.id === "string" ? f.id : null;
    const r = id !== null && o.shown.has(id) ? this.store.row(id) : undefined;
    if (r === undefined || !this.showable(r, o.owner ?? this.bundleOwner)) {
      const detail = o.source === "awake" && id !== null && !o.shown.has(id) ? `${id} was not shown in this session; read it first (the recall tool, ids: ["${id}"]), then record how it feels now.` : this.notCitable(id, o.shown);
      return { id, ok: false, reason: "not-shown-or-gone", detail };
    }
    const notLived = notLivedReason(r, "feel");
    if (notLived !== null) {
      return { id, ok: false, reason: notLived, detail: `${r.id} was written by a ${r.source === "dreamed" ? "dream" : "reflection"}; feel the memories it came from instead.` };
    }
    const sent = this.words(String(f.emotion ?? ""), o.session, CARRIED_BY_MAX_CHARS);
    if (!sent.ok)
      return { id, ok: false, reason: sent.reason, detail: `emotion: ${sent.detail}` };
    const sentCarried = typeof f.carried_by === "string" ? f.carried_by : "";
    const split = repairEmotion(sent.text, sentCarried);
    const carried = this.words(split?.carriedBy ?? sentCarried, o.session, CARRIED_BY_MAX_CHARS, true);
    const strength = typeof f.strength === "number" && Number.isFinite(f.strength) ? Math.max(0, Math.min(1, f.strength)) : undefined;
    const valence = typeof f.valence === "number" && Number.isFinite(f.valence) ? Math.max(-1, Math.min(1, f.valence)) : undefined;
    const feeling = {
      whose: o.whose ?? "self",
      core: typeof f.core === "string" ? f.core : "",
      emotion: split?.emotion ?? sent.text,
      ...strength === undefined ? {} : { strength },
      ...valence === undefined ? {} : { valence },
      carriedBy: `${o.prefix}${carried.ok && carried.text.length > 0 ? `: ${carried.text}` : ""}`
    };
    const same = sameFeeling(this.store, r.id, o.mine, feeling);
    if (same !== null) {
      return { id, ok: true, reason: "already-recorded", note: `${o.source === "reflection" ? "This reflection" : "This call"} already recorded that feeling on ${r.id} (${same}); nothing new was written.` };
    }
    const gated = o.gate?.(r) ?? null;
    if (gated !== null)
      return { id, ok: false, ...gated };
    const full = o.full();
    if (full !== null)
      return { id, ok: false, reason: "limit-reached", detail: full };
    const notes = [];
    if (sent.cut)
      notes.push(`emotion was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`);
    if (split !== null)
      notes.push(splitNote(split));
    if (!carried.ok)
      notes.push(`carried_by was not kept — ${carried.detail}`);
    else if (carried.cut)
      notes.push(`carried_by was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`);
    try {
      const added = this.store.addFeelings(r.id, [feeling], { source: o.source, recordedLater: o.date, ...o.model ? { model: o.model } : {} });
      for (const fid of added.ids)
        o.mine.add(fid);
      for (const rep of added.repairs)
        notes.push(rep.note);
      return { id, ok: true, reason: "recorded-later", ...notes.length > 0 ? { note: notes.join(" ") } : {} };
    } catch (err) {
      return { id, ok: false, reason: refusalOf(err), detail: "Nothing was recorded for this one; fix it and send it again." };
    }
  }
  feelAgain(input) {
    if (this.ctx.observer)
      return { ok: false, reason: "observer" };
    const date = this.ctx.today();
    const mine = new Set;
    const out = [];
    const written = () => out.filter((x) => x.ok && x.reason === "recorded-later").length;
    for (const f of input.feelings.slice(0, 50)) {
      const whose = f.whose === "owner" ? "owner" : "self";
      out.push(this.laterFeeling(f, {
        shown: input.shown,
        session: input.session,
        date,
        source: "awake",
        prefix: `looking back, awake, ${date}`,
        model: input.model ?? null,
        mine,
        whose,
        owner: input.owner ?? this.ctx.owner,
        gate: (r) => this.store.feelingsFor(r.id).some((x) => x.source === "awake" && x.recorded_later === date) ? { reason: "once-a-day", detail: `${r.id} already has a feeling recorded looking back, awake, today; one a calendar day per memory.` } : null,
        full: () => written() >= REFLECT_TUNABLES.AWAKE_FEELINGS ? `At most ${String(REFLECT_TUNABLES.AWAKE_FEELINGS)} feelings looking back in one call.` : null
      }));
    }
    this.record("feelings.awake", input.session, { sent: input.feelings.length, written: written() });
    return { ok: true, feelings: out };
  }
  settle(input) {
    const open = this.openFor(input.reflection, input.session);
    if (!open.ok)
      return { ok: false, reason: open.reason === "observer" ? "observer" : "failed", detail: `The reflection is not open for a settle (${open.reason}).` };
    const row = open.reflection;
    const shown = new Set(parseIds(row.shown));
    for (const id of [input.holds, input.over]) {
      if (!shown.has(id))
        return { ok: false, reason: "unknown-memory", detail: `${id} was not shown to this reflection; settle only what it was shown.` };
    }
    const why = this.words(input.why, row.session ?? row.id, DREAM_TUNABLES.MAX_WHY_CHARS);
    if (!why.ok)
      return { ok: false, reason: "failed", detail: `A reflection settles only with a plain reason, in \`why\` — ${why.detail}` };
    return settleContradiction(this.store, { holds: input.holds, over: input.over, how: input.how, why: why.text, actor: "reflection", actorId: row.id });
  }
  openFor(id, session) {
    if (this.ctx.observer)
      return { ok: false, reason: "observer" };
    const row = this.store.reflection(id);
    if (row === undefined)
      return { ok: false, reason: "unknown-reflection" };
    if (session !== undefined && row.session !== null && row.session !== session)
      return { ok: false, reason: "not-this-session" };
    const newest = this.last();
    if (newest !== null && newest.id !== row.id)
      return { ok: false, reason: "reflection-closed" };
    if (row.state === "begun")
      return { ok: true, reflection: row, again: false };
    if (row.state === "reflected" && onDay(row, this.ctx.today(), this.store.livedDay()))
      return { ok: true, reflection: row, again: true };
    return { ok: false, reason: "reflection-closed" };
  }
  words(text, session, max, allowEmpty = false) {
    const raw = (text ?? "").trim();
    if (raw.length === 0)
      return allowEmpty ? { ok: true, text: "", cut: false } : { ok: false, reason: "empty-text", detail: "It was empty." };
    if (carriesDreamMark(raw))
      return { ok: false, reason: "dream-mark-in-text", detail: `It carries the dream's mark (${DREAM_MARK}…); take it out.` };
    const verdict = this.ctx.gate(raw.slice(0, max), session);
    if (!verdict.ok)
      return { ok: false, reason: `gate:${verdict.reason}`, detail: `The credential scan refused it (${verdict.reason}).` };
    return { ok: true, text: verdict.text, cut: raw.length > max };
  }
  record(name, ref, payload) {
    this.ctx.emit?.(name, ref, payload);
  }
}
function parseIds(json) {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function sameFeeling(store, memoryId, mine, input) {
  if (mine.size === 0)
    return null;
  let want;
  try {
    want = checkFeelings([input]).rows[0];
  } catch {
    return null;
  }
  if (want === undefined)
    return null;
  const hit = store.feelingsFor(memoryId).find((f) => mine.has(f.id) && f.whose === want.whose && f.core === want.core && f.emotion === want.emotion && (f.other_word ?? null) === want.otherWord);
  return hit?.id ?? null;
}
function parseDetail(json) {
  try {
    const v = JSON.parse(json);
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}
function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function confidentialityOf(rows) {
  let out = {};
  for (const r of rows) {
    if (r.confidential !== 1)
      continue;
    let klass;
    try {
      klass = JSON.parse(r.meta)["confidentiality"];
    } catch {
      klass = undefined;
    }
    if (out["confidential"] === undefined)
      out = { confidential: true };
    if (typeof klass === "string" && klass.length > 0 && out["confidentiality"] === undefined)
      out["confidentiality"] = klass;
  }
  return out;
}
function cut(text, max) {
  if (text === null)
    return null;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
function excerpt(text, max) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
function mergeFits(shared, offer) {
  const moved = new Set(offer.placed.map((p) => p.id));
  const placed = [...offer.placed, ...shared.placed.filter((p) => !moved.has(p.id))];
  const waiting = shared.waiting.filter((x) => !moved.has(x));
  const count = (f) => placed.filter((p) => p.fidelity === f).length;
  return {
    placed,
    waiting,
    report: { ...shared.report, whole: count("whole"), excerpt: count("excerpt"), lined: count("line"), ids: count("id"), waiting: waiting.length }
  };
}
const REFLECT_FURNITURE = 4000;
function onDay(row, at, day) {
  return row.date !== null && row.date.length > 0 ? row.date === at : row.day >= day;
}
function render(id, bundle) {
  return `${reflectionOpener(id)} what you are handed to reflect on — memories and a dream, not events happening now.
${JSON.stringify(bundle)}`;
}
const PACK_MARGIN = 1000;
const PART_FURNITURE = 1000;
export function resultChars(text, how, questions) {
  return wireChars(JSON.stringify({ bundle: text, how, questions }, null, 2));
}
function firstLine(text) {
  return (text.split(`
`).map((l) => l.trim()).find((l) => l.length > 0) ?? "").slice(0, 120);
}
function isJournalCopy(row) {
  try {
    const meta = JSON.parse(row.meta);
    return typeof meta["episodeId"] === "string";
  } catch {
    return false;
  }
}
function namesAny(text, names) {
  if (names.length === 0)
    return false;
  const lower = text.toLowerCase();
  return names.some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(lower));
}
function round(x) {
  return Math.round(x * 100) / 100;
}
function errName(err) {
  if (err !== null && typeof err === "object" && "code" in err)
    return String(err.code);
  return err instanceof Error ? err.name : "UNKNOWN";
}
