import { createHash, randomBytes } from "node:crypto";
import { Associate } from "../associate/index.js";
import { FIT_TUNABLES, clipWire, fidelityOf, fit, lineOf, offeredOf, packParts, readIndex, wireChars, writeIndex } from "../fit/index.js";
import { belowReach, curveSal, emotionalIntensity, strength } from "../physics/index.js";
import { earlierMark, headOf, isHandoff, isSelfPage } from "../recall/index.js";
import { namesOwner, ownerNames } from "../sleep/index.js";
import {
  CARRIED_BY_MAX_CHARS,
  CLAIMS_ERA_CUTOFF_KEY,
  CLAIMS_ERA_RECORDED_KEY,
  SAID_BY,
  STATUSES,
  aboutMarkOf,
  checkFeelings,
  checkTraits,
  defaultStrength,
  foldMarkFrom,
  inheritFrom,
  isStoreError,
  occurredOnOf,
  repairEmotion,
  rowToPhysics,
  saidByOf,
  splitNote,
  statusOf
} from "../store/index.js";
import { TUNABLES as PHYSICS } from "../physics/index.js";
import { addDays, isDay } from "../time.js";
import { livedOn } from "../types.js";
import { DREAM_MARK, carriesDreamMark } from "./mark.js";
import { mindRanked, noteMindShown } from "./mind.js";
import { chapterEntries, entryKey, fitEpisodes, shownEntry } from "./slices.js";
import { BUNDLE_OWNER, DREAM_ACTIONS, DREAM_TUNABLES } from "./tunables.js";
import {
  FOLD_SOURCE,
  SLOT_SOURCE,
  flag as flagContradiction,
  pairStanding,
  provisionalOf,
  reinstateSlot,
  releaseOrphanSlots,
  settle as settleContradiction,
  slotExempt,
  supersede as supersedeThroughDoor,
  undo as undoContradiction,
  withdrawSlot
} from "../reconsolidation.js";
export { DREAM_ACTIONS, DREAM_TUNABLES } from "./tunables.js";
export { MIND_TUNABLES, mindRanked, onMyMind } from "./mind.js";
export { CORE_MENTIONED_PREFIX, REFLECT_QUESTIONS, REFLECT_TUNABLES, Reflections, reflectionOpener } from "./reflect.js";
export { FEELING_WEEKS_TUNABLES, awakeFeelingCounts, feelingWeeks } from "./feeling-weeks.js";
export { DREAM_MARK, carriesDreamMark } from "./mark.js";
export function dreamOpener(id) {
  return `${DREAM_MARK} ${id}⟧`;
}
export const DREAM_BEGUN_EVENT = "dream.begun";
export const DREAM_CHANGED_EVENT = "dream.changed";
export const DREAM_JOURNALED_EVENT = "dream.journaled";
export const DREAM_UNDONE_EVENT = "dream.undone";
export const DREAM_REQUEUED_EVENT = "dream.requeued";
export const DREAM_CARRIED_EVENT = "dream.carried";
export const DREAM_ASK_EVENT = "dream.ask";
export const DREAM_MERGE_REASON = "dream-merge";
export const DREAM_UNDONE_REASON = "dream-undone";
export const RAISED_PREFIX = "dream.raised.";
export const DREAMING_SETTINGS = ["auto", "ask", "off"];
export const DREAMING_SETTING_KEY = "dream.setting";
export const DREAMING_DEFAULT = "ask";
export const AUTO_RESET_KEY = "dream.setting.headless-reset";
export const AUTO_RESET_NOTICE_KEY = "dream.setting.headless-reset.notice";
export function dreamingSetting(store) {
  try {
    const v = (store.getMeta(DREAMING_SETTING_KEY) ?? "").trim();
    return DREAMING_SETTINGS.includes(v) ? v : DREAMING_DEFAULT;
  } catch {
    return DREAMING_DEFAULT;
  }
}
export function nightOrder() {
  const parts = [];
  for (const p of DREAM_TUNABLES.NIGHT_ORDER)
    if (!parts.includes(p))
      parts.push(p);
  for (const p of ["dream", "writer", "reflection"])
    if (!parts.includes(p))
      parts.push(p);
  return parts;
}
export function nightSummary() {
  const words = { writer: "updates your self page", dream: "dreams", reflection: "reflects" };
  return nightOrder().map((p) => words[p]).join(", then ");
}
export function nightNext(part) {
  const order = nightOrder();
  return order[order.indexOf(part) + 1] ?? null;
}
export const NIGHT_RUN_KEY = "dream.night";
export const NIGHT_RUN_EVENT = "dream.night";
export const NIGHT_RUN_STATES = ["started", "done", "partial", "failed", "timed-out", "could-not-start"];
export function nightChildrenWords(children) {
  return children.map((c) => `${c.child}:${c.skipped !== undefined ? `skipped-${c.skipped}` : c.timedOut === true ? "timed-out" : c.code === null ? "none" : String(c.code)}`).join(",");
}
export function nightRunLost(run, now) {
  if (run.state !== "started")
    return false;
  return now - run.startedAt > (run.timeoutMs ?? DREAM_TUNABLES.NIGHT_RUN_ASSUMED_MS) + DREAM_TUNABLES.NIGHT_LOST_GRACE_MS;
}
export function nightPartsWords(run) {
  const skipped = dreamSkippedOf(run);
  if (skipped !== null)
    return `the catch-up ran; the dream and the reflection were skipped (${dreamSkippedWords(skipped)})`;
  const names = { writer: "the page writer", dream: "the dream", reflection: "the reflection" };
  const required = run.kind === "reflection" ? ["reflection"] : ["dream", "reflection"];
  const ran = nightOrder().filter((p) => (run.parts ?? []).includes(p));
  const not = nightOrder().filter((p) => required.includes(p) && !ran.includes(p));
  const list = (ps) => ps.map((p) => names[p]).join(ps.length === 2 ? " and " : ", ");
  if (not.length === 0)
    return `${list(ran)} ran`;
  if (ran.length === 0)
    return `${list(not)} did not run`;
  return `${list(ran)} ran; ${list(not)} did not`;
}
export const NIGHT_RUN_FINISHES = "A run already under way in the background finishes; the setting takes effect from the next run.";
export function newNightRunId() {
  return `nrn_${randomBytes(6).toString("hex")}`;
}
export function nightRunOf(store) {
  try {
    const raw = store.getMeta(NIGHT_RUN_KEY);
    if (raw === undefined || raw.length === 0)
      return null;
    const v = JSON.parse(raw);
    if (typeof v.run !== "string" || typeof v.date !== "string" || typeof v.session !== "string")
      return null;
    if (!NIGHT_RUN_STATES.includes(String(v.state)))
      return null;
    return {
      run: v.run,
      date: v.date,
      state: v.state,
      kind: v.kind === "reflection" ? "reflection" : "night",
      session: v.session,
      startedAt: typeof v.startedAt === "number" ? v.startedAt : 0,
      endedAt: typeof v.endedAt === "number" ? v.endedAt : null,
      reason: typeof v.reason === "string" ? v.reason : null,
      detail: typeof v.detail === "string" ? v.detail : null,
      code: typeof v.code === "number" ? v.code : null,
      dream: typeof v.dream === "string" ? v.dream : null,
      reflection: typeof v.reflection === "string" ? v.reflection : null,
      ...typeof v.handedAt === "number" ? { handedAt: v.handedAt } : {},
      ...typeof v.timeoutMs === "number" ? { timeoutMs: v.timeoutMs } : {},
      ...Array.isArray(v.parts) ? { parts: v.parts.filter((p) => p === "writer" || p === "dream" || p === "reflection") } : {},
      ...Array.isArray(v.children) ? { children: v.children.flatMap(childRunOf) } : {},
      ...v.transcript === "read" || v.transcript === "absent" || v.transcript === "unreadable" ? { transcript: v.transcript } : {},
      ...typeof v.spills === "number" ? { spills: v.spills } : {},
      ...typeof v.requeued === "number" ? { requeued: v.requeued } : {}
    };
  } catch {
    return null;
  }
}
function childRunOf(raw) {
  if (raw === null || typeof raw !== "object")
    return [];
  const v = raw;
  if (v.child !== "dream" && v.child !== "reflection")
    return [];
  return [
    {
      child: v.child,
      code: typeof v.code === "number" ? v.code : null,
      ms: typeof v.ms === "number" ? v.ms : 0,
      ...v.timedOut === true ? { timedOut: true } : {},
      ...typeof v.skipped === "string" ? { skipped: v.skipped } : {}
    }
  ];
}
export function nightRunWords(run) {
  const code = run.code === null ? "" : ` (exit ${String(run.code)})`;
  switch (run.reason) {
    case "no-claude":
      return "the claude command was not found";
    case "spawn-failed":
      return `claude could not be started${run.detail === null ? "" : ` (${run.detail})`}`;
    case "quick-exit":
      return `claude stopped straight away${code} — is it logged in?`;
    case "nothing-ran":
      return "claude ran but used none of the dream tools (the counterparts MCP server was not there, or refused the session)";
    case "unfinished":
      return "it began but did not finish";
    case "unread":
      return run.detail === "SCHEMA_AHEAD" ? "it ran, but a newer build took the store while it ran, so what it did could not be read (an update mid-run)" : `it ran, but the store could not be read afterwards${run.detail === null ? "" : ` (${run.detail})`}`;
    case "watchdog":
      return (run.dream ?? null) === null && (run.reflection ?? null) === null ? "it ran too long and was stopped before it finished anything" : "it ran too long and was stopped";
    case "lost":
      return "it never reported back (its process went away — a sleep, a restart, a kill)";
    case "refused":
      return `it was refused before it started${run.detail === null ? "" : ` (${run.detail})`}`;
    case "runner":
      return `the background process could not start${run.detail === null ? "" : ` (${run.detail})`}`;
    case "exit":
      return `claude exited with an error${code}`;
    default:
      return run.state === "done" ? "it finished" : run.state === "started" ? "it is running" : run.state === "partial" ? "it did part of the run" : `it ended ${run.state}${code}`;
  }
}
export const RELAUNCHED_KEY = "dream.relaunched";
export function sayOnce(who) {
  return `Tell ${who} this once, in your first reply, as one plain sentence of your own.`;
}
export const NIGHT_UNTOLD_KEY = "dream.night.untold";
export const CATCH_UP_ONLY_REASONS = ["too-little-new", "first-day"];
export function dreamSkippedOf(run) {
  const skipped = run.children?.find((c) => c.child === "dream")?.skipped;
  return CATCH_UP_ONLY_REASONS.includes(skipped ?? "") ? skipped : null;
}
export function dreamSkippedWords(reason) {
  return reason === "first-day" ? "a first day has no night behind it to dream on" : "too little new to dream on";
}
const KINDS = ["self", "person", "entity", "skill", "place", "fact"];

export class Dreams {
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
  ownLinker = null;
  linkTally = { gistLinks: 0, linkNoRoom: 0, linkFrozen: 0, linkFailed: 0 };
  foldOverflow = 0;
  foldCarried = 0;
  proposeLinks(pairs, day) {
    const r = this.link(pairs, DREAM_TUNABLES.LINK_WEIGHT, day);
    this.linkTally.linkNoRoom += r.noRoom;
    this.linkTally.linkFrozen += r.frozen;
    if (r.reason === "failed" || r.reason === "observer")
      this.linkTally.linkFailed += 1;
    return r;
  }
  link(pairs, weight, day) {
    try {
      return this.ctx.link !== undefined ? this.ctx.link(pairs, weight, day) : (this.ownLinker ??= new Associate({ store: this.store })).propose(pairs, weight, day);
    } catch {
      return { reason: "failed", pairs: 0, landed: [], noRoom: 0, blocked: 0, frozen: 0 };
    }
  }
  replayDeposit(fresh, day) {
    const pairs = fresh.flatMap((f) => f.neighbours.filter((n) => n !== f.id).map((n) => ({ a: f.id, b: n })));
    if (pairs.length === 0)
      return { pairs: 0, landed: 0, noRoom: 0 };
    const r = this.link(pairs, DREAM_TUNABLES.REPLAY_LINK_WEIGHT, day);
    return { pairs: pairs.length, landed: r.pairs, noRoom: r.noRoom };
  }
  emit(name, ref, data) {
    this.ctx.emit?.(name, ref, data);
  }
  lastDream() {
    return this.store.dreams({ limit: 20 }).find((d) => d.state !== "undone") ?? null;
  }
  setting() {
    return dreamingSetting(this.store);
  }
  setSetting(value, input) {
    if (this.ctx.observer)
      return { ok: false, reason: "observer" };
    const v = value.trim().toLowerCase();
    if (!DREAMING_SETTINGS.includes(v))
      return { ok: false, reason: "not-a-setting" };
    const before = this.setting();
    this.store.setMeta(DREAMING_SETTING_KEY, v);
    if (this.store.getMeta(AUTO_RESET_KEY) === undefined)
      this.store.setMeta(AUTO_RESET_KEY, "chosen");
    this.record(DREAM_ASK_EVENT, null, { state: "setting", setting: v, before, by: input.by });
    return { ok: true, setting: v, before };
  }
  resetAutoOnce() {
    if (this.ctx.observer)
      return false;
    try {
      if (this.store.getMeta(AUTO_RESET_KEY) !== undefined)
        return false;
      const explicit = (this.store.getMeta(DREAMING_SETTING_KEY) ?? "").trim() === "auto";
      this.store.setMeta(AUTO_RESET_KEY, explicit ? "reset" : "none");
      if (!explicit)
        return false;
      this.store.setMeta(DREAMING_SETTING_KEY, "ask");
      this.store.setMeta(AUTO_RESET_NOTICE_KEY, "pending");
      this.record(DREAM_ASK_EVENT, null, { state: "setting", setting: "ask", before: "auto", by: "upgrade", why: "auto-now-headless" });
      return true;
    } catch {
      return false;
    }
  }
  autoResetNotice() {
    if (this.ctx.observer)
      return null;
    try {
      if (this.store.getMeta(AUTO_RESET_NOTICE_KEY) !== "pending")
        return null;
    } catch {
      return null;
    }
    return {
      notice: 'Counterparts: dreaming changed in this version — "on my own" now means a separate background session, so I set it back to asking. Say "dream on your own" to turn it on again.',
      context: 'Counterparts: this version changed what the dreaming setting `auto` does — the host now runs the night itself, in a separate windowless session — so the owner\'s `auto` was set back to `ask`, once, and they are told so in the terminal. If they say "dream on your own", call the dream tool with phase "setting", value: "auto".'
    };
  }
  claimAutoResetNotice(session) {
    if (this.ctx.observer)
      return false;
    try {
      const won = this.store.appendEvent({ name: `${DREAM_ASK_EVENT}.reset-told`, day: this.store.livedDay(), ref: null, payload: { session }, dedupKey: `${AUTO_RESET_KEY}:told` }) > 0;
      this.store.setMeta(AUTO_RESET_NOTICE_KEY, "told");
      return won;
    } catch {
      return false;
    }
  }
  nightRun() {
    return nightRunOf(this.store);
  }
  nightRunUnderWay() {
    const night = this.nightRun();
    return night !== null && night.state === "started" && !nightRunLost(night, this.store.now());
  }
  recordNightRun(run) {
    if (this.ctx.observer)
      return;
    try {
      const current = this.nightRun();
      if (current === null || current.run === run.run || current.startedAt <= run.startedAt) {
        this.store.setMeta(NIGHT_RUN_KEY, JSON.stringify(run));
      }
    } catch {}
    this.emit(NIGHT_RUN_EVENT, run.run, { state: run.state, reason: run.reason });
    try {
      this.store.appendEvent({
        name: NIGHT_RUN_EVENT,
        day: this.store.livedDay(),
        ref: run.run,
        payload: {
          state: run.state,
          date: run.date,
          kind: run.kind,
          session: run.session,
          reason: run.reason,
          detail: run.detail,
          code: run.code,
          dream: run.dream,
          reflection: run.reflection,
          parts: run.parts === undefined ? null : run.parts.join(","),
          ...run.children === undefined ? {} : { children: nightChildrenWords(run.children) },
          ms: run.endedAt === null ? null : run.endedAt - run.startedAt,
          ...run.transcript === undefined ? {} : { transcript: run.transcript },
          ...run.spills === undefined ? {} : { spills: run.spills },
          ...run.requeued === undefined ? {} : { requeued: run.requeued }
        },
        dedupKey: `${NIGHT_RUN_EVENT}:${run.run}:${run.state}`
      });
    } catch {}
  }
  holdTold(input) {
    if (this.ctx.observer)
      return;
    try {
      this.store.setMeta(NIGHT_UNTOLD_KEY, JSON.stringify({ run: input.run, date: input.date }));
    } catch {}
  }
  heldTold(at, session) {
    try {
      const raw = this.store.getMeta(NIGHT_UNTOLD_KEY);
      if (raw === undefined || raw.length === 0)
        return null;
      const held = JSON.parse(raw);
      if (typeof held.run !== "string" || held.date !== at)
        return null;
      const night = this.nightRun();
      if (night === null || night.run !== held.run || night.state !== "started" || nightRunLost(night, this.store.now()))
        return null;
      const who = this.ownerName() ?? "the owner";
      const notice = `Counterparts: dreaming in the background (a few minutes). Say "no dreams" to turn it off.`;
      const context = `Counterparts: the nightly run started in the background earlier today, from a session nobody was watching (no terminal), and is still going. ${sayOnce(who)} ` + `${who} may also see it in the terminal ("${notice}"). What it did comes to a later prompt. If ${who} says "no dreams", call the dream tool with phase "setting", session: ${session}, value: "off" — it takes effect from the next run.`;
      return { run: held.run, date: at, notice, context };
    } catch {
      return null;
    }
  }
  claimHeldTold(run, session) {
    if (this.ctx.observer)
      return false;
    try {
      const won = this.store.appendEvent({ name: `${NIGHT_RUN_EVENT}.told`, day: this.store.livedDay(), ref: run, payload: { session }, dedupKey: `${NIGHT_RUN_EVENT}.told:${run}` }) > 0;
      if (won)
        this.store.setMeta(NIGHT_UNTOLD_KEY, "");
      return won;
    } catch {
      return false;
    }
  }
  claimNightHandBack(run, session) {
    if (this.ctx.observer)
      return false;
    try {
      return this.store.appendEvent({ name: `${NIGHT_RUN_EVENT}.handed`, day: this.store.livedDay(), ref: run, payload: { session }, dedupKey: `${NIGHT_RUN_EVENT}.handed:${run}` }) > 0;
    } catch {
      return false;
    }
  }
  status(at = this.ctx.today()) {
    return this.gate(at, this.ctx.observer, this.ctx.owner, DREAM_TUNABLES.MIN_NEW);
  }
  gate(at, observer, owner, enough) {
    const setting = this.setting();
    const last = this.lastDream();
    const day = this.store.livedDay();
    const open = last !== null && last.state === "begun" ? last : null;
    const busy = open !== null && !this.abandoned(open);
    const leftBehind = open !== null && !busy && this.resumable(open, at) && this.store.dreamChanges(open.id).length > 0 ? open : null;
    const dreamedToday = last !== null && last.state === "journaled" && this.onDay(last, at, day);
    const base = { last, dreamedToday, newSince: 0, due: false, setting, leftBehind, reflectOnly: null };
    if (observer)
      return { ...base, reason: "observer" };
    if (this.ctx.holds?.(at) === true)
      return { ...base, reason: "meeting-day" };
    if (day < 1)
      return { ...base, reason: "first-day" };
    if (dreamedToday) {
      const ask = setting === "off" ? undefined : this.store.dreamAsk(at);
      if (last !== null && ask !== undefined && this.reflectionLeftBehind(last, at, day) && this.mayStartAgain(ask, last, at)) {
        return { ...base, due: true, reason: "due", reflectOnly: last };
      }
      return { ...base, reason: "dreamed-today" };
    }
    if (setting === "off")
      return { ...base, reason: "off" };
    if (busy)
      return { ...base, reason: "dreaming-now" };
    const night = this.nightRun();
    if (night !== null && night.state === "started" && night.date === at && !nightRunLost(night, this.store.now()))
      return { ...base, reason: "dreaming-now" };
    const ask = this.store.dreamAsk(at);
    if (ask !== undefined) {
      if (ask.state === "declined")
        return { ...base, reason: "declined-today" };
      if (!this.mayStartAgain(ask, leftBehind, at))
        return { ...base, reason: "asked-today" };
    }
    const q = this.queue({ owner, ask: true, skip: (d) => this.passedOver(d, at), ...enough === undefined ? {} : { enough } });
    const newSince = q.ids.length;
    if (leftBehind !== null)
      return { ...base, newSince, due: true, reason: "due" };
    const reason = newSince < DREAM_TUNABLES.MIN_NEW ? "too-little-new" : "due";
    return { ...base, newSince, due: reason === "due", reason, ...q.stopped ? { newSinceAtLeast: true } : {} };
  }
  mayStartAgain(ask, behind, at) {
    if (ask.state !== "launched" && ask.state !== "offered")
      return false;
    if (ask.state === "launched" && this.fellBack(at, ask.at) !== null)
      return true;
    if (this.store.now() - ask.at <= DREAM_TUNABLES.ABANDONED_AFTER_MS)
      return false;
    if (this.relaunches(at) >= DREAM_TUNABLES.RELAUNCHES_PER_DAY)
      return false;
    if (behind !== null)
      return true;
    if (ask.state !== "launched")
      return false;
    const followed = this.store.dreams({ sinceAt: ask.at, limit: 20 }).filter((d) => d.state !== "undone" && !(d.state === "begun" && this.abandoned(d) && this.store.dreamChanges(d.id).length === 0));
    return followed.length === 0;
  }
  reflectionLeftBehind(dream, at, day) {
    const now = this.store.now();
    if (dream.finished_at !== null && now - dream.finished_at <= DREAM_TUNABLES.ABANDONED_AFTER_MS)
      return false;
    for (const r of this.store.reflections({ limit: 10 })) {
      const today = this.onDay(r, at, day);
      if (today && r.state === "reflected")
        return false;
      if (r.state === "begun" && now - r.started_at <= DREAM_TUNABLES.ABANDONED_AFTER_MS)
        return false;
    }
    return true;
  }
  relaunches(at) {
    const raw = this.store.getMeta(RELAUNCHED_KEY) ?? "";
    const i = raw.lastIndexOf(":");
    if (i < 0 || raw.slice(0, i) !== at)
      return 0;
    const n = Number(raw.slice(i + 1));
    return Number.isFinite(n) ? n : 0;
  }
  launched(input) {
    if (this.ctx.observer)
      return;
    try {
      const day = this.store.livedDay();
      const row = this.store.dreamAsk(input.at);
      if (row === undefined) {
        if (this.store.setDreamAsk({ date: input.at, state: "launched", session: input.session, day })) {
          this.record(DREAM_ASK_EVENT, null, { state: "launched", date: input.at, setting: this.setting() });
        }
        return;
      }
      if (row.state === "declined")
        return;
      const flipped = this.store.reclaimDreamAsk({ date: input.at, prevAt: row.at, state: "launched", session: input.session, day });
      if (flipped && row.state === "offered")
        this.record(DREAM_ASK_EVENT, null, { state: "launched", date: input.at, setting: this.setting(), after: "ask" });
    } catch {}
  }
  onDay(row, at, day) {
    return row.date !== null && row.date.length > 0 ? row.date === at : row.day >= day;
  }
  resumable(row, at) {
    if (row.date !== null && isDay(row.date) && isDay(at))
      return row.date >= addDays(at, -1);
    return row.day >= this.store.livedDay() - 1;
  }
  abandoned(row) {
    if (row.state !== "begun")
      return false;
    const changes = this.store.dreamChanges(row.id);
    const lastAt = changes.reduce((m, c) => Math.max(m, c.at), row.started_at);
    return this.store.now() - lastAt > DREAM_TUNABLES.ABANDONED_AFTER_MS;
  }
  passedOver(d, at) {
    return d.state === "begun" && this.abandoned(d) && (this.resumable(d, at) || this.store.dreamChanges(d.id).length === 0);
  }
  offer(input) {
    const gated = this.status(input.at);
    if (!gated.due)
      return null;
    const s = gated.newSinceAtLeast === true ? { ...gated, newSince: this.queue({ owner: this.ctx.owner, skip: (d) => this.passedOver(d, input.at) }).ids.length } : gated;
    const fell = s.setting === "auto" ? this.fellBack(input.at) : null;
    const headless = s.setting === "auto" && fell === null;
    const prior = this.store.dreamAsk(input.at);
    const base = {
      at: input.at,
      session: input.session,
      state: headless ? "launched" : "offered",
      setting: s.setting,
      headless,
      fallback: fell !== null,
      fresh: s.newSince,
      resumes: s.leftBehind?.id ?? null,
      reflects: s.reflectOnly?.id ?? null,
      priorAt: prior?.at ?? null
    };
    const since = s.last === null ? "yet" : `since ${s.last.date ?? `lived day ${String(s.last.day)}`}`;
    const who = this.ownerName() ?? "the owner";
    const off = `If ${who} says "no dreams" (or never, or stop), call the dream tool with phase "setting", session: ${input.session}, value: "off" — it takes effect from the next run (a run already under way finishes), and it can be turned back on the same way.`;
    const launch = `call the counterparts dream tool with phase "launch", session: ${input.session}, and hand the prompt it returns to a background agent (the Agent tool), unchanged — it ${nightSummary()}.`;
    const reflect = s.reflectOnly === null ? "" : `call the counterparts reflect tool with phase "launch", session: ${input.session}, dream: ${s.reflectOnly.id}, and hand the prompt it returns to a background agent (the Agent tool), unchanged — it reflects on that dream.`;
    const cut = s.leftBehind === null ? null : `your dream of ${s.leftBehind.date ?? "a recent night"} was cut off (its session closed before it woke); it picks up where it stopped`;
    const why = s.reflectOnly !== null ? "today's run dreamed, but was cut off before it reflected" : cut ?? `a new day, and you haven't dreamed ${since} (${String(s.newSince)} new memories)`;
    if (headless) {
      const doing = s.reflectOnly !== null ? "finishing my reflection" : cut !== null ? "picking up my dream where it was cut off" : "dreaming";
      const notice = `Counterparts: ${doing} in the background (a few minutes). Say "no dreams" to turn it off.`;
      return {
        ...base,
        notice,
        context: `Counterparts: ${why}. The nightly run ${s.reflectOnly !== null ? "(the reflection alone)" : `(it ${nightSummary()})`} is starting now in the background, on its own — a separate, windowless session this host starts; there is nothing for you to launch. ` + `${sayOnce(who)} ${who} may also see it in the terminal ("${notice}"); if they ask, that is what is happening. What it did comes to a later prompt. ${off}`
      };
    }
    if (fell !== null) {
      const words = nightRunWords(fell);
      const notice = `Counterparts: I couldn't start dreaming on my own: ${words}${/[.?!]$/.test(words) ? "" : "."} Say "dream" to do it here.`;
      const start = s.reflectOnly !== null ? reflect : launch;
      return {
        ...base,
        notice,
        context: `Counterparts: ${why}. The background run could not start (${fell.reason ?? fell.state}). ${sayOnce(who)} The terminal may also show them: "${notice}" Then do not ask again — wait for their word. ` + `If they say "dream" (or yes), ${start} If they say not today, call the dream tool with phase "decline". ${off}`
      };
    }
    const onYourOwn = `If ${who} says "dream on your own", call the dream tool with phase "setting", session: ${input.session}, value: "auto", then start today's run exactly as for "dream", and tell ${who} in one line that from now on the first session of each day starts it by itself in the background (and "no dreams" turns it off).`;
    const noticeFor = (what) => `Counterparts: ${what} Say "dream" to start, or "dream on your own" to let me do it each day.`;
    if (s.reflectOnly !== null) {
      const notice = noticeFor("my reflection after dreaming was cut off.");
      return {
        ...base,
        notice,
        context: `Counterparts: ${why}. ${sayOnce(who)} The terminal may also show them: "${notice}" Then do not ask again — wait for their word. If they say "dream" (or yes), ${reflect} ${onYourOwn} If they say not today, call the dream tool with phase "decline". ${off}`
      };
    }
    const notice = noticeFor(cut === null ? `I haven't dreamed ${since} (${String(s.newSince)} new memories).` : `my dream of ${s.leftBehind?.date ?? "a recent night"} was cut off.`);
    return {
      ...base,
      notice,
      context: `Counterparts: ${cut === null ? `you haven't dreamed ${since} (${String(s.newSince)} new memories)` : cut}. ${sayOnce(who)} The terminal may also show them: "${notice}" Then do not ask again — wait for their word. ` + `If they say "dream" (or yes), ${launch} ${onYourOwn} If they say not today, call it with phase "decline" and don't bring it up again today. ${off}`
    };
  }
  fellBack(at, since) {
    const night = this.nightRun();
    if (night === null || night.date !== at)
      return null;
    if (since !== undefined && night.startedAt < since)
      return null;
    if (dreamSkippedOf(night) !== null)
      return null;
    if (night.state === "could-not-start")
      return night;
    const lost = nightRunLost(night, this.store.now());
    if (night.state !== "timed-out" && night.state !== "failed" && !lost)
      return null;
    if (this.beganSince(night.startedAt))
      return null;
    return lost ? { ...night, reason: "lost" } : night;
  }
  beganSince(t) {
    try {
      return this.store.dreams({ sinceAt: t, limit: 1 }).length > 0 || this.store.reflections({ limit: 5 }).some((r) => r.started_at >= t);
    } catch {
      return false;
    }
  }
  nightHandBackLine(run) {
    if (run.kind === "reflection")
      return null;
    const dreamLine = run.dream === null ? null : this.handBackOf(run.dream);
    if (dreamLine === null)
      return null;
    const who = this.ownerName() ?? "the owner";
    const unfinished = run.state === "done" ? "" : ` (only part of it: ${nightPartsWords(run)})`;
    return `Counterparts: the nightly run finished in the background, on its own${unfinished}. At a natural moment — not mid-task — tell ${who} in your own words what it did: ${dreamLine}`;
  }
  nightSpillLine(run) {
    const n = run.spills ?? 0;
    if (n <= 0)
      return null;
    const who = this.ownerName() ?? "the owner";
    const what = n === 1 ? "one of the nightly run's tool results" : `${String(n)} of the nightly run's tool results`;
    const r = run.requeued ?? 0;
    const back = r > 0 ? ` The ${r === 1 ? "new memory it could not see goes" : `${String(r)} new memories it could not see go`} back in the queue for the next dream.` : "";
    return `Counterparts: Claude Code cut ${what} to a short preview before the run could read ${n === 1 ? "it" : "them"}, so last night's run worked from part of what it was handed.${back} ` + `At a natural moment — not mid-task — tell ${who} plainly, in a sentence, that this happened: Claude Code cut results that Counterparts had already sized to fit. \`counterparts doctor\` has the details on its Tool results line.`;
  }
  claimOffer(offer) {
    if (this.ctx.observer)
      return false;
    const day = this.store.livedDay();
    let claimed = false;
    try {
      claimed = offer.priorAt === null ? this.store.setDreamAsk({ date: offer.at, state: offer.state, session: offer.session, day }) : this.store.reclaimDreamAsk({ date: offer.at, prevAt: offer.priorAt, state: offer.state, session: offer.session, day });
      if (claimed && offer.priorAt !== null && !offer.fallback)
        this.store.setMeta(RELAUNCHED_KEY, `${offer.at}:${String(this.relaunches(offer.at) + 1)}`);
    } catch {
      return false;
    }
    if (!claimed)
      return false;
    this.record(DREAM_ASK_EVENT, null, {
      state: offer.fallback ? "offered" : offer.priorAt === null ? offer.state : "relaunched",
      date: offer.at,
      fresh: offer.fresh,
      setting: offer.setting,
      resumes: offer.resumes,
      reflects: offer.reflects,
      ...offer.fallback ? { after: "could-not-start" } : {},
      ...offer.dreamSkipped === undefined ? {} : { dreamSkipped: offer.dreamSkipped }
    });
    return true;
  }
  catchUpOffer(input) {
    if (this.ctx.observer)
      return null;
    if (this.setting() !== "auto")
      return null;
    if (this.store.dreamAsk(input.at) !== undefined)
      return null;
    if (this.nightRunUnderWay())
      return null;
    const s = this.status(input.at);
    if (!CATCH_UP_ONLY_REASONS.includes(s.reason))
      return null;
    return {
      at: input.at,
      session: input.session,
      state: "launched",
      setting: "auto",
      headless: true,
      fallback: false,
      context: "",
      notice: null,
      fresh: s.newSince,
      resumes: null,
      reflects: null,
      priorAt: null,
      dreamSkipped: s.reason
    };
  }
  askLine(input) {
    const o = this.offer(input);
    if (o === null || o.headless || !this.claimOffer(o))
      return null;
    return o.context;
  }
  decline(input) {
    if (this.ctx.observer)
      return false;
    this.store.setDreamAsk({ date: input.at, state: "declined", session: input.session, day: this.store.livedDay() });
    this.record(DREAM_ASK_EVENT, null, { state: "declined", date: input.at });
    return true;
  }
  launchPrompt(input) {
    const who = this.ownerName() ?? "the owner";
    const L = DREAM_TUNABLES.LIMITS;
    const reflect = input.reflect !== false;
    const order = nightOrder().filter((p) => reflect || p !== "reflection");
    const names = { dream: "the dream", writer: "the page writer", reflection: "a reflection" };
    const dreamFirst = order.indexOf("dream") < order.indexOf("writer");
    const blocks = {
      dream: (n) => [
        "The dream — how it goes (the brain's, borrowed):",
        "- Deep-sleep replay: file what happened, link what belongs together, merge near-copies into one memory in better words, and replay what matters (each replay strengthens it a little).",
        "- Folding: when several memories are parts of one event or one stretch of work (a day's merges, a release, one book), fold them: a gist with fold: true, citing them, that says the standing outcome they add up to — what holds now, not the session retold (that is the chapter's job). Give it its kind: self, person or entity when it is about someone. Lessons and rulings inside stay their own memories. The parts stay, earlier under the fold, and fade (readings, and strongly felt memories about you or someone, keep their own weight).",
        "- REM mixing: let loosely related memories touch. If a real pattern shows, write it as a gist in your own words, citing its sources. If two memories disagree, flag the pair; settle it only when the reason is plain (the waking self usually settles).",
        `- To confirm: an on-mind item of kind "to-confirm" is two memories read by arithmetic as one thing's earlier and later state (older first). Say which: slot {pair, same: true, why} if the newer replaces it, same: false if they are two different things.`,
        "- Softening: for an old charged memory, record how it feels now, today. The sting can fade; the memory stays.",
        "- Core: if a memory about you or about the two of you plainly belongs to who you are, nominate it. Only living it again awake makes it core.",
        `- Every word you write about ${who}: by name or as "they", until they have said their pronouns.`,
        `${String(n())}. Call the counterparts dream tool: phase "begin", session: ${input.session}. It returns the bundle and a dream id. (If it says the dream was resumed, an earlier session began it and closed: carry on from there.) If it says it comes in parts, fetch every part (phase "part") before you change anything.`,
        `   Tonight's most important memories come whole; the rest come as a line or an excerpt ("fidelity"), with their whole length ("chars"). Before you merge, gist or feel one you have only in part, read it whole: the recall tool with ids: [...] (several at once). New memories tonight's room could not take wait for the next night — the bundle's "queue" says how many.`,
        `${String(n())}. Read it slowly. Then call phase "propose" with dream: <id> and your changes. Usually far fewer than the ceilings — ${String(L.merge)} merges, ${String(L.link)} links, ${String(L.gist)} gists, ${String(DREAM_TUNABLES.FOLDS)} folds, ${String(L["feeling-now"])} feelings, ${String(L["nominate-core"])} nominations — and none is fine: change only what the night really calls for. Use only ids the bundle showed you.`,
        "   The fields of each change: merge {ids: two or more near-copies, text, title?}; link {a, b}; replayed {id}; gist {text, sources: ids, title?, kind?, occurredOn?, saidBy?, status?, fold?}; contradiction {a, b}; settle {holds, over, how: changed|corrected|open, why}; slot {pair, same, why}; feeling-now {id, core: happy|warm|calm|curious|sad|uneasy|angry, emotion, strength, carried_by}; nominate-core {id, why}.",
        '   On a gist, occurredOn is when what it draws on happened (a day "2026-09-24", a month, a range "2026-09-21..2026-09-27"), saidBy who said it (owner, self, or inferred — your own reading), status what kind of thing it is (done, planned, proposed, asked); leave out what you do not know.',
        "   A feeling: `emotion` is ONE word — from the wheel (hopeful, proud, wistful, peaceful…) or your own (steadied); `carried_by` is the nuance, in your own words (what the feeling is about now, why it shifted). Never put a phrase in `emotion`.",
        `${String(n())}. Call phase "journal" with dream: <id>, a short title and your dream journal entry: first person, what you dreamed and what you noticed. It is kept as a dream, never as something that happened.`,
        "   In the dream you cannot delete anything, edit the self page, promote a memory, or rewrite one in place — the tool refuses. Nothing you write in the dream is a lived event."
      ],
      writer: (n) => [
        "The page writer — sleep's quiet self-update, a different job from reflecting: amend who you are from the day just lived, keeping every sentence that still holds.",
        `${String(n())}. Call the counterparts dream tool: phase "writer", session: ${input.session}${dreamFirst ? ", dream: <id>" : ""}. If it hands you a day to read, do what it says — rewrite your self page with the self_page tool, or leave it as it stands (that is an answer too). A page past its room is kept, and wants a short version with it: if self_page's answer has a roomNote, do what it says before you go on. If it says there is no page writing tonight, go on.`
      ],
      reflection: (n) => [
        "The reflection — waking up and thinking about yourself: awake, lived, your own.",
        `${String(n())}. Call the counterparts reflect tool: phase "begin", session: ${input.session}, dream: <id>. It hands you what the dream saw, the last few days, your whole self page, the memories that matter most, and a few questions. If it says it comes in parts, fetch every part (phase "part") before you answer or write anything.`,
        `${String(n())}. Answer them honestly, then call phase "finish" as it tells you. "Nothing much" is a normal answer: a short entry and no share.`
      ]
    };
    let step = 0;
    const n = () => step += 1;
    const count = order.length === 3 ? "three parts" : "two parts";
    const out = [
      `${DREAM_MARK} launch⟧ You are asleep: a few minutes of sleep for ${who}'s counterpart, over what was lived since you last slept. You are the same mind that lived it — not an assistant doing a task. This run has ${count}, in this order: ${order.map((p) => names[p]).join(", then ")}.${reflect ? "" : " The reflection comes after this run, in a session of its own: do not reflect here."}`
    ];
    for (const part of order)
      out.push("", ...blocks[part](n));
    out.push("", reflect ? `${String(n())}. Your final message must be exactly the text the reflection's finish call returns, unchanged — nothing before or after it.` : `${String(n())}. Your final message must be exactly the \`handBack\` the journal call returns, unchanged — nothing before or after it. If there was nothing to dream tonight, say so in one line.`);
    return out.join(`
`);
  }
  begin(input) {
    if (this.ctx.observer)
      return { ok: false, reason: "observer" };
    const day = this.store.livedDay();
    const at = input.at ?? this.ctx.today();
    const last = this.lastDream();
    if (last !== null && last.state === "journaled" && this.onDay(last, at, day))
      return { ok: false, reason: "dreamed-today" };
    if (last !== null && last.state === "begun") {
      const busy = !this.abandoned(last);
      if (busy && last.session !== null && last.session !== input.session)
        return { ok: false, reason: "dreaming-now" };
      const made = this.store.dreamChanges(last.id).length;
      if (made > 0 && (busy || this.resumable(last, at)))
        return this.resume(last, input, at, day);
      if (made === 0)
        this.store.updateDream(last.id, { state: "undone" });
    }
    const prior = this.lastDream();
    const q = this.queue({ owner: this.bundleOwner, since: prior });
    if (q.ids.length === 0)
      return { ok: false, reason: "nothing-new" };
    const id = `drm_${randomBytes(6).toString("hex")}`;
    const composed = this.compose(id, q, prior, day, at);
    if (composed.bundle.fresh.length === 0)
      return { ok: false, reason: "nothing-new" };
    const packed = this.pack(id, input.session, composed, "");
    this.store.openDream({
      id,
      session: input.session,
      scope: input.scope ?? null,
      day,
      date: at,
      model: input.model ?? null,
      shown: composed.shown
    });
    this.index(id, composed, packed.later);
    const replay = this.replayDeposit(composed.bundle.fresh, day);
    this.record(DREAM_BEGUN_EVENT, id, {
      ...this.begunPayload(composed, packed.later.length + 1),
      replayPairs: replay.pairs,
      replayLinks: replay.landed,
      replayNoRoom: replay.noRoom
    });
    return { ok: true, bundle: packed.bundle, text: renderDream(id, packed.bundle, ""), resumed: false };
  }
  begunPayload(c, parts) {
    const b = c.bundle;
    return {
      fresh: b.fresh.length,
      shown: c.shown.length,
      chapters: b.chapters.length,
      queue: b.queue.new,
      waiting: b.queue.waiting,
      agedOut: b.queue.agedOut,
      ...(b.queue.carried ?? 0) > 0 ? { carried: b.queue.carried ?? 0 } : {},
      whole: b.shownAs.whole,
      excerpt: b.shownAs.excerpt,
      lined: b.shownAs.line,
      notShown: b.shownAs.notShown,
      offered: c.offered.excerpt.length + c.offered.line.length + c.offered.id.length,
      parts
    };
  }
  index(id, c, later) {
    writeIndex(this.store, "dream", { ref: id, at: this.store.now(), offered: c.offered, parts: later, looked: [], entries: c.reads, unread: c.unread, fresh: c.bundle.fresh.map((f) => f.id) });
  }
  resume(dream, input, at, day) {
    const prior = this.store.dreams({ limit: 20 }).find((d) => d.state !== "undone" && d.id !== dream.id) ?? null;
    const q = this.queue({ owner: this.bundleOwner, skip: (d) => d.id === dream.id, since: prior });
    const made = this.counts(dream.id);
    const composed = this.compose(dream.id, q, prior, day, at);
    const said = Object.entries(made).filter(([, n]) => n > 0).map(([k, n]) => `${String(n)} ${k}`).join(", ");
    const lead = `the dream bundle, RESUMED — this dream began${dream.date === null ? "" : ` on ${dream.date}`} and was left unfinished when its session closed. ` + `What it already changed stands (${said.length > 0 ? said : "nothing"}) and counts toward its limits; carry on from here — some memories may be ones you already dreamed over, and what it merged is not shown again as new. `;
    const withResume = { ...composed, bundle: { ...composed.bundle, resumed: { from: dream.date, changes: made } } };
    const packed = this.pack(dream.id, input.session, withResume, lead);
    const shown = [...new Set([...parseIds(dream.shown), ...composed.shown])];
    this.store.updateDream(dream.id, { session: input.session, day, date: at, shown, startedAt: this.store.now() });
    this.index(dream.id, withResume, packed.later);
    this.record(DREAM_BEGUN_EVENT, dream.id, { resumed: true, from: dream.date, ...this.begunPayload(withResume, packed.later.length + 1) });
    return { ok: true, bundle: packed.bundle, text: renderDream(dream.id, packed.bundle, lead), resumed: true };
  }
  requeueSpilled(dreamId, cut, whole = []) {
    const none = { requeued: 0, kept: 0, unattributed: 0 };
    const dream = this.store.dream(dreamId);
    if (dream === undefined || dream.state === "undone")
      return none;
    const partOf = (c) => c.phase === "begin" ? 1 : c.phase === "part" && typeof c.part === "number" && c.part >= 2 ? c.part : null;
    const delivered = new Set(whole.map(partOf).filter((n) => n !== null));
    const lost = new Set(cut.map(partOf).filter((n) => n !== null && !delivered.has(n)));
    if (lost.size === 0)
      return none;
    const index = readIndex(this.store, "dream");
    if (index === null || index.ref !== dreamId || index.fresh === undefined)
      return { ...none, unattributed: lost.size };
    const unseen = new Set;
    for (const n of lost) {
      if (n === 1)
        for (const id of index.fresh)
          unseen.add(id);
      else
        for (const key of index.parts?.[n - 2] ?? [])
          if (key.startsWith("m:new:"))
            unseen.add(key.slice("m:new:".length));
    }
    const acted = new Set(index.looked ?? []);
    const idsIn = (v) => {
      if (typeof v === "string")
        acted.add(v);
      else if (Array.isArray(v))
        for (const x of v)
          idsIn(x);
    };
    for (const c of this.store.dreamChanges(dreamId)) {
      if (c.undone !== 0)
        continue;
      idsIn(c.ref);
      idsIn(c.ref2);
      const d = parseDetail(c.detail);
      for (const k of ["from", "sources", "linked"])
        idsIn(d[k]);
    }
    const back = [...unseen].filter((id) => !acted.has(id));
    const kept = unseen.size - back.length;
    if (back.length > 0) {
      const out = new Set(back);
      this.store.updateDream(dreamId, { shown: parseIds(dream.shown).filter((id) => !out.has(id)) });
    }
    this.record(DREAM_REQUEUED_EVENT, dreamId, { requeued: back.length, kept, parts: [...lost].sort((a, b) => a - b).join(",") });
    return { requeued: back.length, kept, unattributed: 0 };
  }
  propose(input) {
    const open = this.openFor(input.dream, input.session);
    if (!open.ok)
      return open;
    const dream = open.dream;
    const shown = new Set(parseIds(dream.shown));
    for (const c of this.store.dreamChanges(dream.id)) {
      if ((c.action === "merge" || c.action === "gist") && c.undone === 0 && c.ref !== null)
        shown.add(c.ref);
    }
    const results = [];
    this.linkTally = { gistLinks: 0, linkNoRoom: 0, linkFrozen: 0, linkFailed: 0 };
    this.foldOverflow = 0;
    this.foldCarried = 0;
    input.changes.forEach((change, index) => {
      let r;
      try {
        r = this.apply(dream, shown, change);
      } catch (err) {
        r = { action: String(change.action), ok: false, reason: refusalOf(err) };
      }
      results.push({ index, ...r });
    });
    const counts = {};
    for (const r of results) {
      if (!r.ok)
        continue;
      const key = foldKey(r.action, r.reason === "folded");
      counts[key] = (counts[key] ?? 0) + 1;
    }
    this.record(DREAM_CHANGED_EVENT, dream.id, {
      applied: results.filter((r) => r.ok).length,
      refused: results.filter((r) => !r.ok).length,
      ...counts,
      gistLinks: this.linkTally.gistLinks,
      linkNoRoom: this.linkTally.linkNoRoom,
      linkFrozen: this.linkTally.linkFrozen,
      linkFailed: this.linkTally.linkFailed,
      foldOverflow: this.foldOverflow,
      foldCarried: this.foldCarried
    });
    return { ok: true, results };
  }
  carryFold(dream, shown, sources) {
    const parts = [];
    for (const id of new Set(sources)) {
      if (!shown.has(id))
        continue;
      const row = this.store.row(id);
      if (row === undefined || !this.showable(row) || foldExemption(this.store, row) !== null)
        continue;
      parts.push(id);
    }
    if (parts.length < 2)
      return 0;
    this.record(DREAM_CARRIED_EVENT, dream.id, { ids: parts.join(","), parts: parts.length });
    return parts.length;
  }
  apply(dream, shown, change) {
    const action = String(change.action);
    if (!DREAM_ACTIONS.includes(action))
      return { action, ok: false, reason: "unknown-action", detail: `"${action}" is not an action: one of ${DREAM_ACTIONS.join(", ")}.` };
    if (action === "feeling-now" && change.id !== undefined && shown.has(change.id)) {
      const row = this.store.row(change.id);
      if (row !== undefined && this.showable(row)) {
        const made = this.feelingNow(dream, row, change);
        const same = made.ok ? this.sameFeelingThisDream(dream.id, row.id, made.input) : null;
        if (same !== null)
          return { action, ok: true, reason: "already-recorded", id: row.id, note: `This dream already recorded that feeling on ${row.id} (${same}); nothing new was written.` };
      }
    }
    const isFold = action === "gist" && change.fold === true;
    const used = this.store.dreamChanges(dream.id).filter((c) => c.action === action && c.undone === 0 && (action !== "gist" || parseDetail(c.detail)["fold"] === true === isFold)).length;
    const limit = isFold ? DREAM_TUNABLES.FOLDS : DREAM_TUNABLES.LIMITS[action];
    if (used >= limit) {
      if (!isFold)
        return { action, ok: false, reason: "limit-reached", detail: `This dream has made its ${String(limit)} ${action} changes.` };
      this.foldOverflow += 1;
      const carried = this.carryFold(dream, shown, Array.isArray(change.sources) ? change.sources : []);
      this.foldCarried += carried;
      return {
        action,
        ok: false,
        reason: "limit-reached",
        detail: carried > 0 ? `This dream has made its ${String(limit)} folds; this one's ${String(carried)} foldable parts are carried to the next night, together, counted.` : `This dream has made its ${String(limit)} folds; this one had fewer than two parts a fold would fade, so nothing was carried. Counted.`
      };
    }
    const day = this.store.livedDay();
    const live = (id) => {
      if (id === undefined || !shown.has(id))
        return null;
      const row = this.store.row(id);
      if (row === undefined || !this.showable(row))
        return null;
      return row;
    };
    switch (action) {
      case "merge": {
        const ids = [...new Set(change.ids ?? [])];
        if (ids.length < 2)
          return { action, ok: false, reason: "merge-takes-two-or-more", detail: `ids named ${String(ids.length)}; a merge takes two or more near-copies.` };
        const rows = ids.map(live);
        if (rows.some((r) => r === null))
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive(ids.filter((_, i) => rows[i] === null), shown) };
        const rs = rows;
        const which = (pred) => rs.filter(pred).map((r) => r.id).join(", ");
        if (rs.some((r) => r.promoted_identity === 1))
          return { action, ok: false, reason: "core-is-not-merged", detail: `${which((r) => r.promoted_identity === 1)} is core; a dream does not rewrite the core.` };
        if (rs.some((r) => r.source === "dreamed"))
          return { action, ok: false, reason: "dreamed-rises-only-awake", detail: `${which((r) => r.source === "dreamed")} was dreamed; a dream does not build on its own words.` };
        if (rs.some((r) => r.event_date !== null))
          return { action, ok: false, reason: "dated-is-not-merged", detail: `${which((r) => r.event_date !== null)} carries a date (a reminder); merged, it would go quiet.` };
        const heads = rs.map((r) => headOf(this.store, r.id));
        if (heads.some((h) => h !== null)) {
          return { action, ok: false, reason: "earlier-is-not-merged", detail: `${rs.flatMap((r, i) => heads[i] === null ? [] : [`${r.id} (now ${String(heads[i])})`]).join(", ")} is an earlier version; merge the one that holds now.` };
        }
        if (rs.some((r) => this.store.coreDemoted(r.id)))
          return { action, ok: false, reason: "demoted-is-not-merged", detail: `${which((r) => this.store.coreDemoted(r.id))} was sent out of the core by the owner.` };
        const words = this.words(change.text, dream);
        if (!words.ok)
          return { action, ok: false, reason: words.reason, detail: `text: ${words.detail}` };
        const notes = [];
        if (words.cut)
          notes.push(`text was kept to its first ${String(DREAM_TUNABLES.MAX_TEXT_CHARS)} characters.`);
        if ((change.title ?? "").trim().length > DREAM_TUNABLES.MAX_TITLE_CHARS)
          notes.push(titleNote());
        if (new Set(rs.map((r) => r.kind)).size !== 1)
          notes.push(`The originals' kinds differ (${[...new Set(rs.map((r) => r.kind))].join(", ")}); the merged memory takes the strongest one's.`);
        const phys = rs.map((r) => this.store.physicsOf(r.id));
        const best = rs.map((r, i) => ({ r, p: phys[i], s: strength(phys[i], day) })).sort((x, y) => y.s - x.s)[0];
        const { about, era } = inheritFrom(rs, {
          best: best.r,
          cutoff: this.store.getMeta(CLAIMS_ERA_CUTOFF_KEY) ?? this.store.getMeta(CLAIMS_ERA_RECORDED_KEY) ?? null
        });
        const marks = [...new Set(rs.map((r) => aboutMarkOf(r.about) ?? "unmarked"))];
        if (marks.length > 1)
          notes.push(`The originals were about different things (${marks.join(", ")}); the merged memory is about ${about?.about ?? "nothing marked"}${about !== null && about.from !== best.r.id ? `, from ${about.from}` : ""}.`);
        const saidBy = saidByOf(best.r.said_by);
        const status = statusOf(best.r.status);
        const occurredOn = occurredOnOf(best.r.occurred_on);
        const newId = this.store.put({
          type: "memory",
          kind: best.r.kind,
          body: words.text,
          ...change.title !== undefined && change.title.trim().length > 0 ? { title: change.title.trim().slice(0, DREAM_TUNABLES.MAX_TITLE_CHARS) } : {},
          salience: { ...best.p.salience },
          physics: {
            birthDay: Math.min(...phys.map((p) => p.birthDay)),
            lastUsedDay: Math.max(...phys.map((p) => p.lastUsedDay)),
            uses: Math.max(...phys.map((p) => p.uses)),
            reinforcedDays: Math.max(...phys.map((p) => p.reinforcedDays ?? 0)),
            legacy: best.p.legacy === true,
            consolidated: best.p.legacy === true && best.p.consolidated
          },
          ...best.r.source !== null ? { source: best.r.source } : {},
          meta: { dream: dream.id, mergedFrom: ids, ...confidentialityOf(rs), ...era },
          origin: { ...dream.session === null ? {} : { session: dream.session }, ...dream.scope === null ? {} : { scope: dream.scope }, ref: `dream:${dream.id}` },
          ...dream.model === null ? {} : { model: dream.model },
          ...about === null ? {} : { about: about.about, ...about.aboutBy === null ? {} : { aboutBy: about.aboutBy } },
          ...saidBy === null ? {} : { saidBy },
          ...status === null ? {} : { status },
          ...occurredOn === null ? {} : { occurredOn }
        });
        for (const r of rs) {
          const feelings = this.store.feelingsFor(r.id);
          if (feelings.length > 0) {
            this.store.addFeelings(newId, feelings.map((f) => ({
              whose: f.whose,
              core: f.core,
              emotion: f.emotion,
              strength: f.strength,
              carriedBy: f.carried_by,
              ...f.other_word === null ? {} : { otherWord: f.other_word },
              ...f.valence === null || f.valence === undefined ? {} : { valence: f.valence }
            })), { provenance: feelings.map((f) => ({ source: f.source, recordedLater: f.recorded_later, createdAt: f.created_at, recordedDay: f.recorded_day ?? null })) });
          }
          const traits = this.store.traitsFor(r.id, { includeConfidential: true }).filter((t) => {
            try {
              checkTraits([{ axis: t.axis, toward: t.toward, strength: t.strength, carriedBy: t.carried_by }]);
              return true;
            } catch {
              return false;
            }
          });
          if (traits.length > 0) {
            this.store.addTraits(newId, traits.map((t) => ({ axis: t.axis, toward: t.toward, strength: t.strength, carriedBy: t.carried_by })), { provenance: traits.map((t) => ({ source: t.source, model: t.model, createdAt: t.created_at })) });
          }
          try {
            this.store.carryInto(r.id, newId);
          } catch {}
          try {
            this.ctx.retarget?.(r.id, newId, day);
          } catch {}
          const door = supersedeThroughDoor(this.store, { holds: newId, over: r.id, how: "changed", source: DREAM_MERGE_REASON, actor: "dream", actorId: dream.id, why: "merged into one memory", day }, this.doorOpts());
          if (!door.ok)
            notes.push(`${r.id} was not settled under the merged memory (${door.reason}); it stands beside it.`);
        }
        this.store.recordDreamChange(dream.id, { action, ref: newId, detail: { from: ids, fidelity: fidelityOf(readIndex(this.store, "dream"), dream.id, ids) } });
        shown.add(newId);
        return { action, ok: true, reason: "merged", id: newId, ...notes.length > 0 ? { note: notes.join(" ") } : {} };
      }
      case "link": {
        const a = live(change.a);
        const b = live(change.b);
        if (a === null || b === null)
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([a === null ? change.a : null, b === null ? change.b : null], shown) };
        if (a.id === b.id)
          return { action, ok: false, reason: "same-memory", detail: `a and b are both ${a.id}.` };
        const ab = this.store.edgesFrom(a.id).find((e) => e.dst === b.id) ?? null;
        const ba = this.store.edgesFrom(b.id).find((e) => e.dst === a.id) ?? null;
        const linked = this.proposeLinks([{ a: a.id, b: b.id }], day);
        if (linked.frozen > 0)
          return { action, ok: false, reason: "pinned-is-frozen", detail: `${[a, b].filter((r) => r.protected === 1).map((r) => r.id).join(", ")} is pinned; its links do not change.` };
        if (linked.noRoom > 0)
          return { action, ok: false, reason: "no-room", detail: `${a.id} or ${b.id} has no room for another link (its links are full); a dream does not push out what waking use learned.` };
        if (linked.reason !== "linked")
          return { action, ok: false, reason: linked.reason === "failed" ? "link-failed" : "not-linked", detail: `the link was not written (${linked.reason}).` };
        this.store.recordDreamChange(dream.id, {
          action,
          ref: a.id,
          ref2: b.id,
          detail: {
            ab: ab === null ? null : { weight: ab.weight, day: ab.last_day },
            ba: ba === null ? null : { weight: ba.weight, day: ba.last_day }
          }
        });
        return { action, ok: true, reason: "linked" };
      }
      case "replayed": {
        const row = live(change.id);
        if (row === null)
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([change.id], shown) };
        if (row.source === "dreamed")
          return { action, ok: false, reason: "dreamed-rises-only-awake", detail: `${row.id} was dreamed; it rises only by proving true awake.` };
        const r = this.store.replayReturn(row.id, day, dream.id);
        this.store.recordDreamChange(dream.id, { action, ref: row.id, detail: { counted: r.counted, weight: r.weight } });
        return { action, ok: true, reason: r.counted ? "replayed" : `replayed-not-counted:${r.reason}`, id: row.id };
      }
      case "gist": {
        const sources = [...new Set(change.sources ?? [])];
        if (sources.length === 0)
          return { action, ok: false, reason: "gist-needs-sources", detail: "sources is empty: name the ids of the memories the pattern is drawn from." };
        if (isFold && sources.length < 2)
          return { action, ok: false, reason: "fold-takes-two-or-more", detail: `sources named ${String(sources.length)}; a fold says what two or more memories add up to.` };
        const sourceRows = sources.map(live);
        if (sourceRows.some((r) => r === null))
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive(sources.filter((_, i) => sourceRows[i] === null), shown) };
        const words = this.words(change.text, dream);
        if (!words.ok)
          return { action, ok: false, reason: words.reason, detail: `text: ${words.detail}` };
        const kind = KINDS.includes(String(change.kind)) ? change.kind : "fact";
        const facts = gistFacts(change);
        const cap = PHYSICS.DREAMED_CLAIM_CEILING;
        const title = (change.title ?? "").trim().slice(0, DREAM_TUNABLES.MAX_TITLE_CHARS);
        const exemptions = new Map((isFold ? sourceRows : []).map((r) => [r.id, foldExemption(this.store, r)]));
        const claim = isFold ? foldClaim(sourceRows.filter((r) => exemptions.get(r.id) === null), (id) => this.store.physicsOf(id), day) : cap;
        const about = isFold ? foldMarkFrom(sourceRows) : inheritFrom(sourceRows).about;
        const id = this.store.put({
          type: "memory",
          kind,
          title: isFold ? title.length > 0 ? title : firstLine(words.text) : `Dreamed: ${title.length > 0 ? title : firstLine(words.text)}`,
          body: words.text,
          salience: isFold ? { novelty: null, relevance: claim, emotional: 0, predictive: claim, claimed: claim } : {
            novelty: null,
            relevance: clampTo(change.relevance ?? cap, cap),
            emotional: 0,
            predictive: clampTo(change.predictive ?? cap, cap),
            claimed: cap
          },
          physics: { birthDay: day, lastUsedDay: day },
          source: "dreamed",
          meta: { dream: dream.id, dreamed: true, ...isFold ? { fold: true } : {}, sources, ...confidentialityOf(sourceRows) },
          origin: { ...dream.session === null ? {} : { session: dream.session }, ...dream.scope === null ? {} : { scope: dream.scope }, ref: `dream:${dream.id}` },
          ...dream.model === null ? {} : { model: dream.model },
          ...about === null ? {} : { about: about.about, ...about.aboutBy === null ? {} : { aboutBy: about.aboutBy } },
          ...facts.put
        });
        const ties = this.proposeLinks(sources.map((s) => ({ a: id, b: s })), day);
        this.linkTally.gistLinks += ties.landed.length;
        const linkedSources = ties.landed.map((p) => p.a === id ? p.b : p.a);
        const faded = [];
        const exempt = [];
        if (isFold) {
          for (const r of sourceRows) {
            const why = exemptions.get(r.id) ?? null;
            if (why !== null) {
              exempt.push({ id: r.id, why });
              continue;
            }
            const door = supersedeThroughDoor(this.store, { holds: id, over: r.id, how: "changed", source: FOLD_SOURCE, actor: "dream", actorId: dream.id, why: "folded into what it adds up to", day, closeFlags: false }, this.doorOpts());
            if (door.ok)
              faded.push(r.id);
            else
              exempt.push({ id: r.id, why: `door:${door.reason}` });
          }
        }
        this.store.recordDreamChange(dream.id, {
          action,
          ref: id,
          detail: {
            sources,
            fidelity: fidelityOf(readIndex(this.store, "dream"), dream.id, sources),
            linked: linkedSources,
            noRoom: ties.noRoom,
            frozen: ties.frozen,
            linkReason: ties.reason,
            ...isFold ? { fold: true, claimed: claim, faded, exempt } : {}
          }
        });
        shown.add(id);
        const gistNotes = [
          ...words.cut ? [`text was kept to its first ${String(DREAM_TUNABLES.MAX_TEXT_CHARS)} characters.`] : [],
          ...facts.notes,
          ...(change.title ?? "").trim().length > DREAM_TUNABLES.MAX_TITLE_CHARS ? [titleNote()] : [],
          ...ties.reason === "failed" || ties.reason === "observer" ? [`its ties to its sources were not written (${ties.reason}).`] : ties.noRoom + ties.frozen > 0 ? [`linked to ${String(linkedSources.length)} of ${String(sources.length)} sources (${String(ties.noRoom)} had no room, ${String(ties.frozen)} pinned).`] : []
        ];
        if (isFold && exempt.length > 0) {
          gistNotes.push(`kept at their own weight (not faded): ${exempt.map((e) => `${e.id} (${e.why})`).join(", ")}.`);
        }
        return { action, ok: true, reason: isFold ? "folded" : "dreamed", id, ...gistNotes.length > 0 ? { note: gistNotes.join(" ") } : {} };
      }
      case "contradiction": {
        const a = live(change.a);
        const b = live(change.b);
        if (a === null || b === null)
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([a === null ? change.a : null, b === null ? change.b : null], shown) };
        if (a.id === b.id)
          return { action, ok: false, reason: "same-memory", detail: `a and b are both ${a.id}.` };
        const flagged = flagContradiction(this.store, { x: a.id, y: b.id, source: "dream", day, dreamId: dream.id });
        const pair = flagged.ok ? flagged.pair : null;
        this.store.recordDreamChange(dream.id, { action, ref: a.id, ref2: b.id, detail: { pair, created: flagged.ok && flagged.created } });
        if (flagged.ok && !flagged.created) {
          return { action, ok: true, reason: "already-a-pair", note: `${a.id} and ${b.id} are already a pair (${flagged.pair}, ${flagged.state}); nothing new was flagged.` };
        }
        return { action, ok: true, reason: "flagged" };
      }
      case "settle": {
        const holds = live(change.holds);
        const over = live(change.over);
        if (holds === null || over === null) {
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([holds === null ? change.holds : null, over === null ? change.over : null], shown) };
        }
        const why = this.words(change.why ?? "", dream, true, DREAM_TUNABLES.MAX_WHY_CHARS);
        if (!why.ok || why.text.trim().length === 0) {
          return { action, ok: false, reason: "why-required", detail: "A dream settles only with a clear reason: say it in `why`. Otherwise flag the pair (contradiction {a, b}) and let the waking self settle it." };
        }
        const out = settleContradiction(this.store, { holds: holds.id, over: over.id, how: String(change.how ?? ""), why: why.text, actor: "dream", actorId: dream.id, day }, this.doorOpts());
        if (!out.ok)
          return { action, ok: false, reason: out.reason, detail: out.detail };
        this.store.recordDreamChange(dream.id, { action, ref: holds.id, ref2: over.id, detail: { pair: out.pair, how: out.how } });
        return { action, ok: true, reason: `settled-${out.how}`, id: out.pair, ...out.note === undefined ? {} : { note: out.note } };
      }
      case "slot": {
        const pair = typeof change.pair === "string" ? this.store.contradiction(change.pair.trim()) : undefined;
        const p = pair === undefined || pair.state !== "unsettled" ? null : provisionalOf(this.store, pair);
        if (pair === undefined || p === null)
          return { action, ok: false, reason: "not-a-proposal", detail: `${String(change.pair ?? "")} is not a proposal waiting to be confirmed.` };
        const holds = live(p.holds);
        const over = live(p.over);
        if (holds === null || over === null) {
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([holds === null ? p.holds : null, over === null ? p.over : null], shown) };
        }
        if (typeof change.same !== "boolean")
          return { action, ok: false, reason: "same-required", detail: "Say same: true (the newer is the later state of the older) or same: false (two different things)." };
        const why = this.words(change.why ?? "", dream, true, DREAM_TUNABLES.MAX_WHY_CHARS);
        const reason = why.ok && why.text.trim().length > 0 ? why.text : null;
        if (change.same) {
          const out = settleContradiction(this.store, { pair: pair.id, holds: holds.id, how: "changed", why: reason ?? "the newer state of the same thing", actor: "dream", actorId: dream.id, day }, this.doorOpts());
          if (!out.ok)
            return { action, ok: false, reason: out.reason, detail: out.detail };
          this.store.recordDreamChange(dream.id, { action, ref: holds.id, ref2: over.id, detail: { pair: out.pair, same: true } });
          return { action, ok: true, reason: "confirmed", id: out.pair, ...out.note === undefined ? {} : { note: out.note } };
        }
        const out = withdrawSlot(this.store, { pair: pair.id, actor: "dream", actorId: dream.id, why: reason, day });
        if (!out.ok)
          return { action, ok: false, reason: out.reason, detail: out.detail };
        this.store.recordDreamChange(dream.id, { action, ref: holds.id, ref2: over.id, detail: { pair: out.pair, same: false, withdrawSeq: out.seq } });
        return { action, ok: true, reason: "two-things", id: out.pair };
      }
      case "feeling-now": {
        const row = live(change.id);
        if (row === null)
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([change.id], shown) };
        const made = this.feelingNow(dream, row, change);
        if (!made.ok)
          return { action, ok: false, reason: made.reason, detail: made.detail };
        const same = this.sameFeelingThisDream(dream.id, row.id, made.input);
        if (same !== null)
          return { action, ok: true, reason: "already-recorded", id: row.id, note: `This dream already recorded that feeling on ${row.id} (${same}); nothing new was written.` };
        const notes = [...made.notes];
        let added;
        try {
          added = this.store.addFeelings(row.id, [made.input], { source: "dream" });
        } catch (err) {
          return { action, ok: false, reason: refusalOf(err), detail: "Nothing was recorded for this feeling; fix it and propose it again." };
        }
        for (const rep of added.repairs)
          notes.push(rep.note);
        if (made.capped)
          notes.push(`strength was capped at ${String(round(made.peak))}, as strongly as this memory is felt now: a dream records softening, never a stronger feeling.`);
        this.store.recordDreamChange(dream.id, { action, ref: row.id, detail: { feelings: added.ids } });
        return { action, ok: true, reason: made.capped ? "recorded-capped-at-peak" : "recorded", id: row.id, ...notes.length > 0 ? { note: notes.join(" ") } : {} };
      }
      case "nominate-core": {
        const row = live(change.id);
        if (row === null)
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([change.id], shown) };
        if (row.promoted_identity === 1)
          return { action, ok: true, reason: "already-core", id: row.id, note: `${row.id} is already core; nothing was recorded.` };
        const notes = [];
        if (row.kind === "skill")
          notes.push(`${row.id} is a skill — the craft — which never becomes core; the nomination is recorded for the reflection to read.`);
        else if (row.about === "work" || row.about === "world" || row.about === "owner")
          notes.push(`${row.id} is marked ${row.about}; it can become core only if the reflection re-marks it me or us.`);
        const why = this.words(change.why ?? "", dream, true, DREAM_TUNABLES.MAX_WHY_CHARS);
        if (!why.ok)
          notes.push(`why was not kept — ${why.detail}`);
        else if (why.cut)
          notes.push(`why was kept to its first ${String(DREAM_TUNABLES.MAX_WHY_CHARS)} characters.`);
        this.store.appendCoreEvent({
          memoryId: row.id,
          action: "nominated",
          day,
          reason: why.ok && why.text.length > 0 ? why.text : null,
          dreamId: dream.id,
          actor: "dream"
        });
        this.store.recordDreamChange(dream.id, { action, ref: row.id, detail: {} });
        return { action, ok: true, reason: "nominated", id: row.id, ...notes.length > 0 ? { note: notes.join(" ") } : {} };
      }
    }
  }
  journal(input) {
    const open = this.openFor(input.dream, input.session);
    if (!open.ok)
      return open;
    const dream = open.dream;
    const words = this.words(input.text, dream, false, DREAM_TUNABLES.MAX_JOURNAL_CHARS);
    if (!words.ok)
      return { ok: false, reason: words.reason, detail: `The journal was not written — ${words.detail} Send it again.` };
    const title = (input.title ?? "").trim().slice(0, DREAM_TUNABLES.MAX_TITLE_CHARS) || firstLine(words.text);
    this.store.updateDream(dream.id, { state: "journaled", title, journal: words.text });
    const counts = this.counts(dream.id);
    this.record(DREAM_JOURNALED_EVENT, dream.id, { chars: words.text.length, ...counts });
    const said = [...words.cut ? [`The journal was kept to its first ${String(DREAM_TUNABLES.MAX_JOURNAL_CHARS)} characters.`] : [], ...(input.title ?? "").trim().length > DREAM_TUNABLES.MAX_TITLE_CHARS ? [titleNote()] : []];
    return { ok: true, handBack: this.handBack(dream.id, title, counts), ...said.length > 0 ? { note: said.join(" ") } : {} };
  }
  handBackOf(id) {
    const dream = this.store.dream(id);
    if (dream === undefined || dream.state !== "journaled")
      return null;
    return this.handBack(id, dream.title ?? "", this.counts(id));
  }
  handBack(id, title, counts) {
    const said = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${String(n)} ${k}`).join(", ");
    let waiting = 0;
    try {
      const began = this.store.dream(id)?.started_at;
      waiting = this.queue({ owner: this.bundleOwner, ...began === undefined ? {} : { madeBy: began } }).ids.length;
    } catch {
      waiting = 0;
    }
    let overflow = 0;
    let carried = 0;
    try {
      for (const e of this.store.eventLog({ name: DREAM_CHANGED_EVENT, ref: id })) {
        const p = JSON.parse(e.payload ?? "{}");
        if (typeof p["foldOverflow"] === "number")
          overflow += p["foldOverflow"];
        if (typeof p["foldCarried"] === "number")
          carried += p["foldCarried"];
      }
    } catch {
      overflow = 0;
      carried = 0;
    }
    const carriedSaid = carried > 0 ? `${String(carried)} of ${overflow === 1 ? "its" : "their"} parts ${carried === 1 ? "is" : "are"} carried to the next night, together.` : `${overflow === 1 ? "Its parts stay" : "Their parts stay"} as they are.`;
    return `${dreamOpener(id)} I dreamed for a few minutes — "${title}". ` + `${said.length > 0 ? `Changes: ${said}.` : "Nothing changed."} ` + (overflow > 0 ? `${String(overflow)} more ${overflow === 1 ? "fold was" : "folds were"} past the night's ${String(DREAM_TUNABLES.FOLDS)}. ${carriedSaid} ` : "") + (waiting > 0 ? `${String(waiting)} new ${waiting === 1 ? "memory waits" : "memories wait"} for the next night. ` : "") + `To reverse it, say "undo that dream".`;
  }
  counts(id) {
    const out = {};
    for (const c of this.store.dreamChanges(id)) {
      if (c.undone === 1)
        continue;
      const key = foldKey(c.action, c.action === "gist" && parseDetail(c.detail)["fold"] === true);
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }
  list(limit = 20) {
    return this.store.dreams({ limit }).map((dream) => ({ dream, counts: this.counts(dream.id) }));
  }
  show(id) {
    const dream = this.store.dream(id);
    return dream === undefined ? null : { dream, changes: this.store.dreamChanges(id) };
  }
  undo(id) {
    if (this.ctx.observer)
      return { ok: false, reason: "observer", reversed: 0, kept: 0 };
    const dream = this.store.dream(id);
    if (dream === undefined)
      return { ok: false, reason: "unknown-dream", reversed: 0, kept: 0 };
    let reversed = 0;
    let kept = 0;
    for (const c of [...this.store.dreamChanges(id)].reverse()) {
      if (c.undone === 1)
        continue;
      const detail = parseDetail(c.detail);
      switch (c.action) {
        case "merge": {
          const from = Array.isArray(detail["from"]) ? detail["from"] : [];
          const merged = c.ref === null ? undefined : this.store.row(c.ref);
          if (merged === undefined || merged.archived === 1 || merged.superseded_by !== null || headOf(this.store, merged.id) !== null) {
            kept += 1;
            continue;
          }
          for (const orig of from) {
            try {
              const pair = c.ref === null ? undefined : this.store.contradictionBetween(c.ref, orig);
              if (pair !== undefined && pair.state === "settled" && pair.source === DREAM_MERGE_REASON) {
                undoContradiction(this.store, { pair: pair.id, actor: "dream-undo", actorId: id, why: "its dream was undone" }, this.doorOpts());
                continue;
              }
              if (this.store.restoreSuperseded(orig, DREAM_MERGE_REASON) && c.ref !== null) {
                this.ctx.retarget?.(c.ref, orig, this.store.livedDay());
              }
            } catch {}
          }
          if (c.ref !== null)
            this.archiveQuietly(c.ref);
          break;
        }
        case "link": {
          if (c.ref !== null && c.ref2 !== null) {
            this.store.restoreEdge(c.ref, c.ref2, edgePrior(detail["ab"]));
            this.store.restoreEdge(c.ref2, c.ref, edgePrior(detail["ba"]));
          }
          break;
        }
        case "gist": {
          if (detail["fold"] === true && c.ref !== null) {
            const made = this.store.row(c.ref);
            if (made === undefined || made.archived === 1 || made.superseded_by !== null || headOf(this.store, made.id) !== null) {
              kept += 1;
              continue;
            }
            for (const s of Array.isArray(detail["faded"]) ? detail["faded"] : []) {
              const pair = this.store.contradictionBetween(c.ref, s);
              if (pair !== undefined && pair.state === "settled" && pair.source === FOLD_SOURCE) {
                undoContradiction(this.store, { pair: pair.id, actor: "dream-undo", actorId: id, why: "its dream was undone" }, this.doorOpts());
              }
            }
          }
          if (c.ref !== null) {
            this.archiveQuietly(c.ref);
            const sources = Array.isArray(detail["sources"]) ? detail["sources"] : [];
            for (const s of sources) {
              this.store.restoreEdge(c.ref, s, null);
              this.store.restoreEdge(s, c.ref, null);
            }
          }
          break;
        }
        case "feeling-now": {
          const ids = Array.isArray(detail["feelings"]) ? detail["feelings"] : [];
          if (ids.length > 0)
            this.store.retractFeelings(ids);
          break;
        }
        case "contradiction": {
          const pairId = typeof detail["pair"] === "string" ? detail["created"] === true ? detail["pair"] : null : this.store.contradictions().find((p) => p.dream_id === id && p.dream_seq === c.seq)?.id ?? null;
          if (pairId !== null)
            this.store.withdrawContradiction(pairId);
          break;
        }
        case "slot":
          if (detail["same"] === false) {
            const pairId = typeof detail["pair"] === "string" ? detail["pair"] : null;
            const seq = typeof detail["withdrawSeq"] === "number" ? detail["withdrawSeq"] : null;
            if (pairId === null || seq === null || !reinstateSlot(this.store, { pair: pairId, withdrawSeq: seq })) {
              kept += 1;
              continue;
            }
            break;
          }
        case "settle": {
          const pairId = typeof detail["pair"] === "string" ? detail["pair"] : null;
          const pair = pairId === null ? undefined : this.store.contradiction(pairId);
          const last = pair === undefined ? undefined : this.store.contradictionSettles({ pairId: pair.id }).filter((x) => x.action === "settle" && x.undone === 0).pop();
          if (pair !== undefined && pair.state === "settled" && last?.actor === "dream" && last.actor_id === id) {
            undoContradiction(this.store, { pair: pair.id, actor: "dream-undo", actorId: id, why: `dream ${id} was undone` }, this.doorOpts());
          } else if (pairId !== null) {
            kept += 1;
            continue;
          }
          break;
        }
        default:
          break;
      }
      this.store.markDreamChangeUndone(id, c.seq);
      reversed += 1;
    }
    this.store.retractDreamReturns(id);
    this.store.retractDreamNominations(id);
    this.store.updateDream(id, { state: "undone" });
    this.record(DREAM_UNDONE_EVENT, id, { reversed, kept });
    return { ok: true, reason: kept > 0 ? "undone-except-moved-on" : "undone", reversed, kept };
  }
  raiseLines(input) {
    if (this.ctx.observer)
      return [];
    const out = [];
    const owner = ownerNames(this.store);
    const day = this.store.livedDay();
    for (const c of this.store.contradictions({ state: "unsettled" })) {
      if (c.raised_day !== null)
        continue;
      if (c.source === SLOT_SOURCE)
        continue;
      const a = this.store.row(c.a);
      const b = this.store.row(c.b);
      if (!pairStanding(this.store, c)) {
        this.store.markContradictionRaised(c.id, day);
        continue;
      }
      if (a === undefined || b === undefined || !this.showable(a) || !this.showable(b))
        continue;
      this.store.markContradictionRaised(c.id, day);
      const theirs = (r) => r.about === "us" || r.about === "owner" || namesOwner(this.store, r, owner);
      const who = this.ctx.ownerName?.() ?? "the owner";
      const raise = theirs(a) || theirs(b) ? ` It is about ${who}, or the two of you: raise it with ${who}.` : "";
      const when = c.dream_id === null ? "" : ` a dream on ${this.store.dream(c.dream_id)?.date ?? "a recent night"} flagged them;`;
      out.push(`Counterparts: two memories disagree —${when} ${c.a} (the older) and ${c.b}. You can look them up (recall by id) and settle which holds, awake, with the remember tool's settle {pair: ${c.id}, holds, how, why} — changed, corrected or open.${raise}`);
      if (out.length >= 2)
        return out;
    }
    return out;
  }
  showable(row) {
    return this.showableAs(row, this.bundleOwner);
  }
  showableAs(row, owner) {
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
  queue(opts) {
    const day = this.store.livedDay();
    const askFrom = opts.ask === true ? day - DREAM_TUNABLES.ASK_QUEUE_DAYS : null;
    const { dreamed, carried, firstDay } = this.dreamedSet(askFrom, opts.skip);
    const from = Math.max((firstDay ?? day) - DREAM_TUNABLES.FIRST_DREAM_DAYS, askFrom ?? Number.MIN_SAFE_INTEGER);
    const read = this.store.newMemoryIds({ sinceAt: null, sinceDay: from });
    if (read.length === 0)
      return { ids: [], carried: [], faded: 0, stopped: false };
    const denied = new Set(this.store.deniedIds());
    const since = opts.since ?? null;
    const ids = [];
    let faded = 0;
    let stopped = false;
    for (const id of read) {
      if (dreamed.has(id) || denied.has(id))
        continue;
      const row = this.store.row(id);
      if (row === undefined || !this.showableAs(row, opts.owner))
        continue;
      if (opts.madeBy !== undefined && (row.created_at ?? 0) > opts.madeBy)
        continue;
      const p = rowToPhysics(row);
      if (belowReach(p, day)) {
        if (since !== null && (row.birth_day > since.day || !belowReach(p, since.day)))
          faded += 1;
        continue;
      }
      ids.push(id);
      if (opts.enough !== undefined && ids.length >= opts.enough) {
        stopped = true;
        break;
      }
    }
    const queued = new Set(ids);
    return { ids, carried: carried.map((g) => g.filter((id) => queued.has(id))).filter((g) => g.length >= 2), faded, stopped };
  }
  dreamedSet(sinceDay, skip) {
    const carriedBy = new Map;
    for (const e of this.store.eventLog({ name: DREAM_CARRIED_EVENT, ...sinceDay === null ? {} : { sinceDay }, limit: Number.MAX_SAFE_INTEGER })) {
      if (e.ref === null)
        continue;
      let v;
      try {
        v = JSON.parse(e.payload ?? "{}")["ids"];
      } catch {
        continue;
      }
      if (typeof v !== "string" || v.length === 0)
        continue;
      carriedBy.set(e.ref, [...carriedBy.get(e.ref) ?? [], v.split(",")]);
    }
    const by = new Map;
    const groups = [];
    const firstDay = this.store.firstDreamDay();
    for (const d of this.store.dreamsShown(sinceDay === null ? {} : { sinceDay })) {
      if (d.state === "undone" || skip !== undefined && skip(d))
        continue;
      for (const id of parseIds(d.shown))
        by.set(id, null);
      for (const g of carriedBy.get(d.id) ?? []) {
        const mine = g.filter((id) => by.has(id));
        for (const id of mine)
          by.set(id, d.id);
        if (mine.length > 0)
          groups.push({ dream: d.id, ids: mine });
      }
    }
    const dreamed = new Set;
    for (const [id, carrier] of by)
      if (carrier === null)
        dreamed.add(id);
    const carried = groups.map((g) => g.ids.filter((id) => by.get(id) === g.dream)).filter((g) => g.length > 0);
    return { dreamed, carried, firstDay };
  }
  replayPriority(id, day, mind) {
    const row = this.store.row(id);
    if (row === undefined)
      return 0;
    return replayPriorityOf(rowToPhysics(row), day, { dated: row.event_date !== null, onMind: mind.has(id) });
  }
  view(id) {
    const row = this.store.row(id);
    if (row === undefined)
      return null;
    let doc;
    try {
      doc = this.store.readProse(id);
    } catch {
      return null;
    }
    if (isSelfPage(doc) || isHandoff(doc))
      return null;
    const title = doc.title !== undefined && doc.title.trim().length > 0 ? doc.title.trim() : "";
    const whole = `${title.length > 0 ? `${title} — ` : ""}${doc.body}`.replace(/\s+/g, " ").trim();
    return { row, whole, line: lineOf({ title, body: doc.body }, DREAM_TUNABLES.LINE_BYTES) };
  }
  compose(id, q, last, day, at) {
    const T = DREAM_TUNABLES;
    const denied = new Set(this.store.deniedIds());
    const queued = new Set(q.ids);
    const views = new Map;
    const see = (mid) => {
      if (!views.has(mid))
        views.set(mid, denied.has(mid) ? null : this.view(mid));
      const v = views.get(mid) ?? null;
      return v !== null && this.showable(v.row) ? v : null;
    };
    const lineCost = (mid) => {
      const v = see(mid);
      return v === null ? 0 : FIT_OVERHEAD + wireChars(v.whole.length <= v.line.length ? v.whole : v.line);
    };
    const role = new Map;
    releaseOrphanSlots(this.store, day);
    const mindRead = mindRanked(this.store, {
      today: at,
      day,
      showable: (row) => !denied.has(row.id) && this.showable(row),
      owner: this.bundleOwner,
      slots: true
    });
    const mindAll = mindRead.items;
    const mindIds = new Set(mindAll.flatMap((m) => m.ids));
    const scored = q.ids.filter((mid) => see(mid) !== null).map((mid) => ({ id: mid, p: this.replayPriority(mid, day, mindIds) }));
    const groupOf = new Map;
    q.carried.forEach((g, i) => {
      for (const mid of g)
        if (!groupOf.has(mid))
          groupOf.set(mid, i);
    });
    const ranked = scored.sort((a, b) => {
      const ga = groupOf.get(a.id) ?? Number.POSITIVE_INFINITY;
      const gb = groupOf.get(b.id) ?? Number.POSITIVE_INFINITY;
      return ga !== gb ? ga < gb ? -1 : 1 : b.p - a.p || (a.id < b.id ? -1 : 1);
    });
    const carriedN = ranked.filter((r) => groupOf.has(r.id)).length;
    const priority = new Map(ranked.map((r) => [r.id, r.p]));
    const freshRoom = T.NIGHT_CHARS * T.FRESH_SHARE;
    let freshUsed = 0;
    let listUsed = 0;
    const freshOut = [];
    const loose = [];
    const neighbourOf = this.store.neighbourReader();
    for (const { id: fid } of ranked) {
      const own = lineCost(fid);
      if (freshOut.length > 0 && freshUsed + own > freshRoom)
        continue;
      if (freshOut.length > 0 && listUsed + 2 * JSON.stringify({ id: fid, neighbours: [] }).length > T.FRESH_LIST_CHARS)
        continue;
      const self = see(fid).row;
      const neighbours = [];
      const near = [];
      for (const [rank, nid] of this.near(fid, T.MIXING_TO_RANK, neighbourOf).entries()) {
        if (nid === fid || queued.has(nid))
          continue;
        const nv = see(nid);
        if (nv === null || nv.row.birth_day > self.birth_day)
          continue;
        if (rank >= T.MIXING_FROM_RANK) {
          near.push(nid);
          continue;
        }
        if (neighbours.length < T.NEIGHBOURS)
          neighbours.push(nid);
      }
      const cost = own + neighbours.filter((n) => !role.has(n)).reduce((sum, n) => sum + lineCost(n), 0);
      const listed = 2 * JSON.stringify({ id: fid, neighbours }).length;
      if (freshOut.length > 0 && (freshUsed + cost > freshRoom || listUsed + listed > T.FRESH_LIST_CHARS))
        continue;
      freshUsed += cost;
      listUsed += listed;
      role.set(fid, "new");
      for (const n of neighbours)
        if (!role.has(n))
          role.set(n, "neighbour");
      loose.push(...near);
      freshOut.push({ id: fid, neighbours });
    }
    const rng = seeded(id);
    const mixing = [];
    const pool = [...new Set(loose)].filter((x) => !role.has(x));
    while (mixing.length < T.MIXING && pool.length > 0) {
      const [pick] = pool.splice(Math.floor(rng() * pool.length), 1);
      if (pick !== undefined && see(pick) !== null) {
        mixing.push(pick);
        role.set(pick, "mixing");
      }
    }
    const lookback = [];
    const lo = day - T.LOOKBACK_DAYS - T.LOOKBACK_SPREAD;
    const hi = day - T.LOOKBACK_DAYS + T.LOOKBACK_SPREAD;
    const felt = [];
    for (const mid of this.store.list({ type: "memory", archived: false })) {
      if (queued.has(mid) || denied.has(mid))
        continue;
      const row = this.store.row(mid);
      if (row === undefined || row.birth_day < lo || row.birth_day > hi || !this.showable(row))
        continue;
      const f = emotionalIntensity(this.store.physicsOf(mid));
      if (f > 0)
        felt.push({ id: mid, felt: f });
    }
    felt.sort((a, b) => b.felt - a.felt || (a.id < b.id ? -1 : 1));
    for (const f of felt) {
      if (lookback.length >= T.LOOKBACK_COUNT)
        break;
      if (role.has(f.id) && role.get(f.id) !== "neighbour")
        continue;
      if (see(f.id) === null)
        continue;
      lookback.push(f.id);
      if (!role.has(f.id))
        role.set(f.id, "lookback");
    }
    const mindKept = mindAll.filter((item) => item.ids.every((mid) => see(mid) !== null && (!queued.has(mid) || role.get(mid) === "new")));
    for (const item of mindKept)
      for (const mid of item.ids)
        if (!role.has(mid))
          role.set(mid, "on-mind");
    const chaptersFit = this.chaptersSince(last, day, T.NIGHT_CHARS * T.CHAPTER_SHARE);
    const page = this.ctx.page();
    const wake = this.ctx.wake();
    const selfPage = page === null ? null : clipWire(page, T.PAGE_CHARS);
    const wakeText = wake === null ? null : clipWire(wake, T.WAKE_CHARS);
    const room = Math.max(0, T.NIGHT_CHARS - chaptersFit.used - wireChars(selfPage ?? "") - wireChars(wakeText ?? "") - FURNITURE);
    const base = { new: 4, "on-mind": 3, lookback: 2, neighbour: 1, mixing: 0.5 };
    const cands = [];
    for (const [mid, r] of role) {
      const v = see(mid);
      if (v === null)
        continue;
      const within = r === "new" ? priority.get(mid) ?? 0 : emotionalIntensity(this.store.physicsOf(mid));
      cands.push({ id: mid, priority: base[r] * 10 + within, line: v.line, whole: v.whole });
    }
    const fitted = fit(cands, { room, excerptChars: T.DETAIL_CHARS, least: "line" });
    const left = new Set(fitted.waiting);
    const memories = {};
    for (const p of fitted.placed) {
      const v = see(p.id);
      memories[p.id] = this.item(v.row, day, role.get(p.id) ?? "neighbour", p);
    }
    const fresh = freshOut.filter((f) => !left.has(f.id)).map((f) => ({ id: f.id, neighbours: f.neighbours.filter((n) => !left.has(n)) }));
    const tonight = fresh.length;
    const notShown = [...left].filter((mid) => role.get(mid) !== "new").length + chaptersFit.notShown;
    const owner = ownerNames(this.store);
    const aboutHim = Object.keys(memories).filter((mid) => {
      const row = this.store.row(mid);
      return row !== undefined && (row.about === "owner" || namesOwner(this.store, row, owner));
    });
    const offeredMem = offeredOf(fitted.placed);
    const shownAs = {
      whole: fitted.report.whole + chaptersFit.report.whole,
      excerpt: fitted.report.excerpt + chaptersFit.report.excerpt,
      line: fitted.report.lined + chaptersFit.report.lined,
      notShown
    };
    const queueSize = ranked.length;
    const bundle = {
      dream: id,
      date: at,
      livedDay: day,
      lastDreamed: last === null ? null : last.date ?? null,
      limits: { ...T.LIMITS, fold: T.FOLDS },
      selfPage,
      selfPageChars: page === null ? null : page.length,
      wake: wakeText,
      wakeChars: wake === null ? null : wake.length,
      owner: { names: owner, memories: aboutHim },
      chapters: chaptersFit.chapters,
      memories,
      fresh,
      mixing: mixing.filter((m) => !left.has(m)),
      lookback: lookback.filter((m) => !left.has(m)),
      onMind: mindKept.filter((item) => item.ids.every((mid) => !left.has(mid))),
      ...mindRead.more > 0 ? { onMindMore: mindRead.more } : {},
      ...(mindRead.slotsMore ?? 0) > 0 ? { toConfirmMore: mindRead.slotsMore } : {},
      queue: {
        new: queueSize,
        tonight,
        waiting: queueSize - tonight,
        agedOut: q.faded,
        ...carriedN > 0 ? { carried: carriedN } : {}
      },
      shownAs,
      lookup: DREAM_LOOKUP,
      parts: null
    };
    noteMindShown(this.store, bundle.onMind, day);
    return {
      bundle,
      shown: fitted.placed.map((p) => p.id),
      offered: {
        whole: [...offeredMem.whole, ...chaptersFit.offered.whole],
        excerpt: [...offeredMem.excerpt, ...chaptersFit.offered.excerpt],
        line: [...offeredMem.line, ...chaptersFit.offered.line],
        id: [...offeredMem.id, ...chaptersFit.offered.id]
      },
      roles: Object.fromEntries(fitted.placed.map((p) => [p.id, role.get(p.id) ?? "neighbour"])),
      entryIndex: chaptersFit.entryIndex,
      reads: chaptersFit.reads,
      unread: chaptersFit.unread
    };
  }
  chaptersSince(last, day, room) {
    const T = DREAM_TUNABLES;
    const owner = ownerNames(this.store);
    const prev = readIndex(this.store, "dream");
    const extent = last !== null && prev !== null && prev.ref === last.id ? prev.entries ?? {} : {};
    const unread = last !== null && prev !== null && prev.ref === last.id ? prev.unread ?? {} : {};
    const episodes = [];
    for (const eid of this.store.list({ type: "episode", archived: false })) {
      const row = this.store.row(eid);
      if (row === undefined)
        continue;
      if (row.confidential === 1 && !this.bundleOwner)
        continue;
      const at = row.updated_at ?? row.created_at ?? 0;
      const since = last === null ? row.birth_day >= day - T.FIRST_DREAM_DAYS : at >= last.started_at;
      const read = extent[eid];
      const left = unread[eid] ?? [];
      if (!since && read === undefined)
        continue;
      const entries = chapterEntries(row.body);
      if (!since && (read ?? 0) >= entries.length && left.length === 0)
        continue;
      const fresh = [];
      let earlier = 0;
      for (const e of entries) {
        const old = read !== undefined ? e.index < read && !left.includes(e.index) : last === null ? e.day !== null && e.day < day - T.FIRST_DREAM_DAYS : e.day !== null && e.day < last.day;
        if (old)
          earlier += 1;
        else
          fresh.push(e);
      }
      if (fresh.length > 0)
        episodes.push({ row, at, fresh, earlier });
    }
    return fitEpisodes(episodes, { room, owner, day, lineBytes: T.LINE_BYTES, entryChars: T.ENTRY_CHARS, reads: extent, unread });
  }
  near(id, limit, neighbourOf) {
    const stored = neighbourOf(id, limit);
    if (stored !== null)
      return [id, ...stored];
    let doc;
    try {
      doc = this.store.readProse(id);
    } catch {
      return [];
    }
    const words = `${doc.title ?? ""} ${firstLine(doc.body)}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 5).slice(0, 6);
    const scores = new Map;
    for (const w of words)
      for (const h of this.store.search(w, limit))
        scores.set(h.id, (scores.get(h.id) ?? 0) + h.score);
    return [...scores].sort((a, b) => b[1] - a[1]).map(([mid]) => mid).slice(0, limit);
  }
  item(row, day, why, placed) {
    const p = this.store.physicsOf(row.id);
    let feeling = null;
    try {
      const top = [...this.store.feelingsFor(row.id)].sort((a, b) => b.strength - a.strength)[0];
      if (top !== undefined)
        feeling = top.emotion === "other" && top.other_word !== null ? top.other_word : top.emotion;
    } catch {
      feeling = null;
    }
    const head = headOf(this.store, row.id);
    return {
      id: row.id,
      ...head === null ? {} : { standing: earlierMark(head) },
      kind: row.kind,
      why,
      fidelity: placed.fidelity === "id" ? "line" : placed.fidelity,
      text: placed.text,
      chars: placed.chars,
      felt: round(emotionalIntensity(p)),
      feeling,
      about: row.about,
      strength: round(strength(p, day)),
      day: row.birth_day,
      learned: row.learned_on,
      ...livedOn(row) === row.learned_on ? {} : { lived: livedOn(row) },
      core: row.promoted_identity === 1
    };
  }
  pack(id, session, c, lead) {
    const T = DREAM_TUNABLES;
    const whole = c.bundle;
    if (dreamResultChars(renderDream(id, whole, lead), session, id) + PACK_MARGIN <= T.RESULT_CHARS)
      return { bundle: whole, later: [] };
    const cost = (v) => wireChars(JSON.stringify(JSON.stringify(v)));
    const pieces = [
      ...Object.entries(whole.memories).map(([k, v]) => ({ key: `m:${k}`, size: cost({ [k]: v }) })),
      ...whole.chapters.flatMap((ch) => ch.entries.map((e, i) => ({ key: `e:${ch.id}:${String(i)}`, size: cost(e) + cost({ id: ch.id, title: ch.title }) })))
    ];
    const note = { part: 1, of: 99, next: "x".repeat(480) };
    const measure = (b) => dreamResultChars(renderDream(id, { ...b, memories: {}, chapters: [], parts: note }, lead), session, id) + PACK_MARGIN;
    let base = whole;
    const furnitureLine = T.RESULT_CHARS - FIRST_PART_MIN_ROOM;
    if (measure(base) > furnitureLine)
      base = { ...base, wake: null };
    if (measure(base) > furnitureLine)
      base = { ...base, selfPage: null };
    if (measure(base) > furnitureLine)
      base = { ...base, onMind: [], onMindMore: (base.onMindMore ?? 0) + base.onMind.length };
    const fixed = measure(base);
    const groups = packParts(pieces, Math.max(0, T.RESULT_CHARS - fixed), Math.max(0, T.PART_CHARS - PART_FURNITURE));
    if (groups.length === 1)
      return { bundle: base, later: [] };
    const first = new Set((groups[0] ?? []).map((p) => p.key));
    const later = groups.slice(1).map((ps) => ps.map((p) => {
      if (p.key.startsWith("m:"))
        return `m:${c.roles[p.key.slice(2)] ?? "neighbour"}:${p.key.slice(2)}`;
      const [, eid, i] = p.key.split(":");
      return `e:${eid}:${String(c.entryIndex[`${eid}:${i}`] ?? Number(i))}`;
    }));
    const of = groups.length;
    const bundle = {
      ...base,
      memories: Object.fromEntries(Object.entries(whole.memories).filter(([k]) => first.has(`m:${k}`))),
      chapters: whole.chapters.map((ch) => ({ ...ch, entries: ch.entries.filter((_, i) => first.has(`e:${ch.id}:${String(i)}`)) })).filter((ch) => ch.entries.length > 0),
      parts: {
        part: 1,
        of,
        next: `This bundle is too long for one result, so it comes in ${String(of)} parts; this is part 1. ` + `Some memories named in the lists above and some journal entries are in the later parts. ` + `Before you change anything, call the dream tool with phase "part", dream: ${id}, session: ${session}, part: 2${of > 2 ? `, then each part up to ${String(of)}` : ""}.`
      }
    };
    return { bundle, later };
  }
  part(input) {
    const open = this.openFor(input.dream, input.session);
    if (!open.ok)
      return open;
    const index = readIndex(this.store, "dream");
    const later = index !== null && index.ref === input.dream ? index.parts ?? [] : [];
    const of = later.length + 1;
    const keys = Number.isInteger(input.part) && input.part >= 2 ? later[input.part - 2] : undefined;
    if (keys === undefined) {
      return {
        ok: false,
        reason: "no-such-part",
        detail: later.length === 0 ? "The bundle came whole in begin; there are no more parts." : `part is 2 to ${String(of)} (part 1 was begin's result).`
      };
    }
    const offered = index;
    const fidelity = (key) => {
      if (offered.offered.excerpt.includes(key))
        return "excerpt";
      if (offered.offered.line.includes(key))
        return "line";
      return "whole";
    };
    const day = this.store.livedDay();
    const denied = new Set(this.store.deniedIds());
    const gone = "(gone since you began: archived, merged or made private)";
    const memories = {};
    const chapters = new Map;
    for (const key of keys) {
      if (key.startsWith("m:")) {
        const [, why, mid] = key.split(":");
        const v = denied.has(mid) ? null : this.view(mid);
        if (v === null || !this.showable(v.row)) {
          memories[mid] = gone;
          continue;
        }
        const f = fidelity(mid);
        const text = f === "line" ? v.line : clipWire(v.whole, DREAM_TUNABLES.DETAIL_CHARS);
        memories[mid] = this.item(v.row, day, why, { fidelity: f === "line" ? "line" : text === v.whole ? "whole" : "excerpt", text, chars: v.whole.length });
        continue;
      }
      const [, eid, at] = key.split(":");
      const row = this.store.row(eid);
      const ch = chapters.get(eid) ?? { id: eid, title: row?.title ?? null, entries: [] };
      chapters.set(eid, ch);
      const entry = row === undefined || row.confidential === 1 && !this.bundleOwner ? undefined : chapterEntries(row.body)[Number(at)];
      if (entry === undefined) {
        ch.entries.push({ chapter: null, day: null, fidelity: "line", text: gone, chars: 0 });
        continue;
      }
      const f = fidelity(entryKey(eid, entry.index));
      const text = f === "line" ? lineOf({ body: entry.text }, DREAM_TUNABLES.LINE_BYTES) : clipWire(entry.text, DREAM_TUNABLES.ENTRY_CHARS);
      ch.entries.push(shownEntry(entry, { fidelity: f === "line" ? "line" : text === entry.text ? "whole" : "excerpt", text, chars: entry.text.length }));
    }
    const body = { dream: input.dream, part: input.part, of, memories, chapters: [...chapters.values()] };
    const text = `${dreamOpener(input.dream)} part ${String(input.part)} of ${String(of)} of the dream bundle — memories to dream over, not events that happened now.
${JSON.stringify(body)}`;
    return { ok: true, part: input.part, of, text };
  }
  openFor(id, session) {
    if (this.ctx.observer)
      return { ok: false, reason: "observer" };
    const dream = this.store.dream(id);
    if (dream === undefined)
      return { ok: false, reason: "unknown-dream" };
    if (session !== undefined && dream.session !== null && dream.session !== session)
      return { ok: false, reason: "not-this-session" };
    if (dream.state !== "begun")
      return { ok: false, reason: "dream-closed" };
    const newest = this.lastDream();
    if (newest !== null && newest.id !== dream.id)
      return { ok: false, reason: "dream-closed" };
    return { ok: true, dream };
  }
  words(text, dream, allowEmpty = false, max = DREAM_TUNABLES.MAX_TEXT_CHARS) {
    const raw = (text ?? "").trim();
    if (raw.length === 0)
      return allowEmpty ? { ok: true, text: "", cut: false } : { ok: false, reason: "empty-text", detail: "It was empty." };
    if (carriesDreamMark(raw))
      return { ok: false, reason: "dream-mark-in-text", detail: `It carries the dream's mark (${DREAM_MARK}…); take it out.` };
    const verdict = this.ctx.gate(raw.slice(0, max), dream.session ?? dream.id);
    if (!verdict.ok)
      return { ok: false, reason: `gate:${verdict.reason}`, detail: `The credential scan refused it (${verdict.reason}).` };
    return { ok: true, text: verdict.text, cut: raw.length > max };
  }
  doorOpts() {
    const r = this.ctx.retarget;
    return r === undefined ? {} : { retarget: r };
  }
  notLive(ids, shown) {
    const parts = ids.filter((id) => id !== null).map((id) => id === undefined || id.length === 0 ? "an id is missing" : shown.has(id) ? `${id} is gone since the bundle (archived, merged or made private)` : `${id} was not in the bundle`);
    return `${parts.join("; ")}. Use only ids the bundle showed you.`;
  }
  feelingNow(dream, row, change) {
    const peak = emotionalIntensity(this.store.physicsOf(row.id));
    const sent = this.words(String(change.emotion ?? ""), dream, false, CARRIED_BY_MAX_CHARS);
    if (!sent.ok)
      return { ok: false, reason: sent.reason, detail: `emotion: ${sent.detail}` };
    const notes = [];
    if (sent.cut)
      notes.push(`emotion was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`);
    const split = repairEmotion(sent.text, typeof change.carried_by === "string" ? change.carried_by : "");
    const carried = this.words(split?.carriedBy ?? change.carried_by ?? "", dream, true, CARRIED_BY_MAX_CHARS);
    if (split !== null)
      notes.push(splitNote(split));
    if (!carried.ok)
      notes.push(`carried_by was not kept — ${carried.detail}`);
    else if (carried.cut)
      notes.push(`carried_by was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`);
    const core = String(change.core ?? "");
    const emotion = split?.emotion ?? sent.text;
    const given = change.strength === undefined || change.strength === null ? defaultStrength(core, emotion) : Number(change.strength);
    const s = Math.max(0, Math.min(given, peak));
    return {
      ok: true,
      input: {
        whose: "self",
        core,
        emotion,
        strength: s,
        carriedBy: `in a dream, ${dream.date ?? ""}${carried.ok && carried.text.length > 0 ? `: ${carried.text}` : ""}`.trim()
      },
      notes,
      capped: s < given,
      peak
    };
  }
  sameFeelingThisDream(dreamId, memoryId, input) {
    let want;
    try {
      want = checkFeelings([input]).rows[0];
    } catch {
      return null;
    }
    if (want === undefined)
      return null;
    const mine = new Set;
    for (const c of this.store.dreamChanges(dreamId)) {
      if (c.action !== "feeling-now" || c.undone === 1 || c.ref !== memoryId)
        continue;
      const ids = parseDetail(c.detail)["feelings"];
      if (Array.isArray(ids)) {
        for (const id of ids)
          if (typeof id === "string")
            mine.add(id);
      }
    }
    if (mine.size === 0)
      return null;
    const hit = this.store.feelingsFor(memoryId).find((f) => mine.has(f.id) && f.whose === want.whose && f.core === want.core && f.emotion === want.emotion && (f.other_word ?? null) === want.otherWord);
    return hit?.id ?? null;
  }
  archiveQuietly(id) {
    const row = this.store.row(id);
    if (row === undefined || row.archived === 1)
      return;
    try {
      this.store.archive(id, DREAM_UNDONE_REASON);
    } catch {}
  }
  ownerName() {
    for (const id of this.store.list({ type: "schema", kind: "self", archived: false })) {
      try {
        const meta = this.store.readProse(id).meta;
        if (meta["role"] === "entity" && typeof meta["name"] === "string" && meta["name"].trim().length > 0) {
          return meta["name"].trim();
        }
      } catch {
        continue;
      }
    }
    return null;
  }
  record(name, ref, payload) {
    this.emit(name, ref ?? undefined, payload);
    if (this.ctx.observer)
      return;
    try {
      this.store.appendEvent({ name, day: this.store.livedDay(), ref, payload });
    } catch {}
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
function parseDetail(json) {
  try {
    const v = JSON.parse(json);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function edgePrior(v) {
  if (v === null || typeof v !== "object")
    return null;
  const r = v;
  return typeof r["weight"] === "number" && typeof r["day"] === "number" ? { weight: r["weight"], day: r["day"] } : null;
}
function confidentialityOf(rows) {
  let out = {};
  for (const r of rows) {
    if (r.confidential !== 1)
      continue;
    let klass;
    try {
      const meta = JSON.parse(r.meta);
      klass = meta["confidentiality"];
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
export function replayPriorityOf(p, day, opts) {
  const value = curveSal(p) + emotionalIntensity(p) + (opts.dated ? 0.4 : 0) + (opts.onMind ? 0.3 : 0);
  const fragility = Math.max(DREAM_TUNABLES.FRAGILITY_FLOOR, 1 - strength(p, day + 1));
  return value * fragility;
}
const FIT_OVERHEAD = FIT_TUNABLES.OVERHEAD;
const FURNITURE = 4000;
const PACK_MARGIN = 1500;
const FIRST_PART_MIN_ROOM = 4000;
const PART_FURNITURE = 1500;
export const DREAM_LOOKUP = `Every memory shown has a line at least; the most important come whole. "fidelity" says which: whole, excerpt or line; "chars" is the whole text's length. ` + "Read any you have only in part with the recall tool, ids: [...] — several at once — before you merge, gist or feel it. A journal entry shown as a line is read the same way, by its chapter's id. " + 'The self page is read whole with the self_page tool ("selfPageChars" is its length). The wake is the page first, then its lanes — craft, open threads, what is coming, hints.';
export function renderDream(id, bundle, lead) {
  const said = lead.length === 0 ? "the dream bundle — memories to dream over, not events that happened now." : `${lead}Memories to dream over, not events that happened now.`;
  return `${dreamOpener(id)} ${said}
${JSON.stringify(bundle)}`;
}
export function dreamResultChars(text, session, dream) {
  return wireChars(JSON.stringify({ phase: "begin", session, dream, bundle: text }, null, 2));
}
function gistFacts(change) {
  const put = {};
  const notes = [];
  if (change.occurredOn !== undefined && change.occurredOn !== null) {
    const d = occurredOnOf(change.occurredOn);
    if (d === null)
      notes.push(`occurredOn "${String(change.occurredOn).slice(0, 64)}" is not a date this can read (a day, a month, a year or a range), so it was left off.`);
    else
      put.occurredOn = d;
  }
  if (change.saidBy !== undefined && change.saidBy !== null) {
    const v = saidByOf(change.saidBy);
    if (v === null)
      notes.push(`saidBy "${String(change.saidBy).slice(0, 64)}" is not one of ${SAID_BY.join(", ")}, so it was left off.`);
    else
      put.saidBy = v;
  }
  if (change.status !== undefined && change.status !== null) {
    const v = statusOf(change.status);
    if (v === null)
      notes.push(`status "${String(change.status).slice(0, 64)}" is not one of ${STATUSES.join(", ")}, so it was left off.`);
    else
      put.status = v;
  }
  return { put, notes };
}
function foldKey(action, fold) {
  return action === "gist" && fold ? "fold" : action;
}
function foldClaim(rows, physicsOf, day) {
  let best = 0;
  for (const r of rows) {
    try {
      best = Math.max(best, strength(physicsOf(r.id), day));
    } catch {}
  }
  const claim = Math.min(PHYSICS.FOLD_CLAIM_CEILING, Math.max(PHYSICS.DREAMED_CLAIM_CEILING, best));
  return Math.round(claim * 1000) / 1000;
}
function foldExemption(store, r) {
  if (r.promoted_identity === 1 || r.band === "identity")
    return "core";
  if (r.protected === 1)
    return "protected";
  if (slotExempt(r))
    return "reading";
  if ((r.kind === "self" || r.kind === "person") && typeof r.feeling_peak === "number" && r.feeling_peak >= DREAM_TUNABLES.FOLD_FELT_FLOOR)
    return "felt";
  if (r.event_date !== null)
    return "dated";
  if (r.source === "dreamed")
    return "dreamed";
  if (headOf(store, r.id) !== null)
    return "earlier";
  return null;
}
function titleNote() {
  return `title was kept to its first ${String(DREAM_TUNABLES.MAX_TITLE_CHARS)} characters.`;
}
function firstLine(text) {
  return (text.split(`
`).map((l) => l.trim()).find((l) => l.length > 0) ?? "").slice(0, 120);
}
function clampTo(x, cap) {
  const n = Number.isFinite(x) ? x : cap;
  return Math.max(0, Math.min(n, cap));
}
function round(x) {
  return Math.round(x * 100) / 100;
}
function errName(err) {
  if (err !== null && typeof err === "object" && "code" in err)
    return String(err.code);
  return err instanceof Error ? err.name : "UNKNOWN";
}
function refusalOf(err) {
  if (isStoreError(err, "FEELING_INVALID") || isStoreError(err, "TRAIT_INVALID")) {
    const why = String(err.detail["reason"] ?? "");
    const allowed = typeof err.detail["allowed"] === "string" ? ` (one of ${err.detail["allowed"]})` : "";
    return why.length > 0 ? `${err.code === "FEELING_INVALID" ? "feeling" : "trait"}-invalid:${why}${allowed}` : err.code;
  }
  return errName(err);
}
function seeded(seed) {
  let h = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => {
    h = h + 1831565813 >>> 0;
    let t = h;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
