import {
  ADAPTER_ASK_EVENT,
  BOUNDARY_EVENT,
  Counterpart,
  ENVELOPE_GAVE_WAY_EVENT,
  RECALL_CREDIT_EVENT,
  RECALL_DELIVERED_EVENT,
  SPAWN_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  SPAWN_STARTED_EVENT,
  WRITE_UP_FAILED_EVENT
} from "../core/counterpart.js";
import { calendarDate } from "../core/self/index.js";
import { storeMarker } from "./store-id.js";
import { ahaDue, ahaLine, markAha, meetPending, meetState, noteOffered, offerDue, offerLine, onboardingMarker, settleOffer } from "../core/onboarding.js";
import { localClock, localDate, readableDate } from "../core/time.js";
import { CONFIG_FILE_EVENT } from "./config-path.js";
import { capabilities, TUNABLES } from "./config.js";
import { countTranslated, readHandleResolutions, translateExpansions } from "./expansions.js";
import { DEFAULT_HOST } from "./hosts.js";
import { pruneLog } from "./log/index.js";
import {
  SCOPE_EVENT,
  SCOPE_JOINED_LATE_EVENT,
  SCOPE_REFUSED_EVENT,
  SCOPE_UNREADABLE_EVENT,
  lookupScope,
  readScopes,
  scopesPath,
  stanceOfMode
} from "./scopes.js";
import {
  ASK_ROW_COUNTING,
  claimedByOther,
  isLive,
  listSessions,
  owedWriteUps,
  progressKey,
  pruneSessions,
  pruneWriteUpProgress,
  manifestVersionOnDisk,
  markSinceSeen,
  readSession,
  readWriteUpProgress,
  recordSession,
  saveWriteUpPointer,
  updateWriteUpProgress,
  WRITE_UP_PART_BYTES,
  firstUnwrittenPart,
  writeUpEntries,
  writeUpPartsDated,
  writeUpPlan
} from "./sessions.js";
import { planSpawn, spawnDetached } from "./spawn.js";
export const WRITE_UP_OPEN = "<counterparts-write-up>";
export const WRITE_UP_CLOSE = "</counterparts-write-up>";
export const WRITE_UP_TOOL = "counterparts session_end";
export const WRITE_UP_ASK_DATE_KEY = "adapter.writeup.asks.date";
export const WRITE_UP_ASK_COUNT_KEY = "adapter.writeup.asks.count";
export const WRITE_UP_SHORT_LINE = "It was a short session: one line is enough, or memories: [] only if nothing in it held your attention.";
export function writeUpPointer(input) {
  const some = input.waiting === 1 ? "An earlier session here ended before it was written up" : `${String(input.waiting)} earlier sessions here ended before they were written up`;
  const size = input.bytes < 1024 ? "under 1 KB" : `~${String(Math.round(input.bytes / 1024))} KB`;
  const part = input.of <= 1 ? "" : `, part ${String(input.part)} of ${String(input.of)}`;
  return [
    WRITE_UP_OPEN,
    `${some}; the oldest, from ${input.endedOn}, left ${size} of what was said there${part}. To write it up, call ${WRITE_UP_TOOL} with session: ${input.live}, writeUp: ${input.ended} and no memories to get the words, then again with what caught your attention, one idea each (memories: [] only if nothing did).${input.short === true ? ` ${WRITE_UP_SHORT_LINE}` : ""}`,
    WRITE_UP_CLOSE
  ].join(`
`);
}
const EVENT_RING = 500;
export const SPAWN_REFUSAL_PREFIX = "adapter.spawn.refusals.";
export const SPAWN_START_DATE_KEY = "adapter.spawn.started.date";
export const SPAWN_START_COUNT_KEY = "adapter.spawn.started.count";

export class Lifecycle {
  host;
  counterpart;
  config;
  observer;
  command;
  args;
  spawner;
  onEvent;
  nowFn;
  configPath;
  scope;
  scopeTrouble = null;
  ring = [];
  volatileRefusals = new Map;
  constructor(opts) {
    this.host = opts.host ?? DEFAULT_HOST;
    this.counterpart = opts.counterpart;
    this.config = opts.config;
    this.observer = opts.counterpart.observer;
    this.command = opts.command ?? process.execPath;
    this.args = opts.args ?? [];
    this.spawner = opts.spawner;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? (() => Date.now());
    this.configPath = opts.configPath;
    this.scope = opts.scope ?? { mode: "unset", matched: null, entry: null };
    if (opts.configPath !== undefined && opts.configPath.length > 0) {
      this.emit(CONFIG_FILE_EVENT, { path: opts.configPath });
    }
    this.emit(SCOPE_EVENT, {
      mode: this.scope.mode,
      matched: this.scope.matched,
      stance: stanceOfMode(this.scope.mode)
    });
    if (opts.scopeUnreadable !== undefined && opts.scopeUnreadable.length > 0) {
      this.emit(SCOPE_UNREADABLE_EVENT, { detail: opts.scopeUnreadable });
    }
    if (opts.scopeRefused !== undefined && opts.scopeRefused.length > 0) {
      this.scopeTrouble = "partial";
      this.emit(SCOPE_REFUSED_EVENT, {
        count: opts.scopeRefused.length,
        keys: opts.scopeRefused.join(", ")
      });
    }
    if (opts.scopeUnreadable !== undefined && opts.scopeUnreadable.length > 0) {
      this.scopeTrouble = "unreadable";
    }
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }
  capabilities() {
    return capabilities(this.config);
  }
  recordStamp() {
    return {
      ...this.configPath === undefined || this.configPath.length === 0 ? {} : { config: this.configPath },
      host: this.host
    };
  }
  composeWake(input, budget) {
    const dir = this.counterpart.store.dir;
    const woke = this.counterpart.wake(budget, { ...input.at === undefined ? {} : { date: input.at } }, {
      ...this.elsewhereHere(input),
      installed: manifestVersionOnDisk(),
      openedWith: (session) => readSession(dir, session)?.opened?.build.version ?? null
    });
    this.noteWakeExpectation(input, woke.sentinel);
    return woke;
  }
  elsewhereHere(input) {
    const dir = this.counterpart.store.dir;
    return {
      scope: input.scope,
      session: input.sessionId.length === 0 ? null : input.sessionId,
      exportsFrom: this.chapterExports(),
      sessions: () => {
        const now = this.nowFn();
        return listSessions(dir).map((r) => ({
          session: r.sessionId,
          scope: r.scope,
          startedAt: r.startedAt,
          lastAt: Math.max(r.lastBoundaryAt, r.endedAt ?? 0),
          live: isLive(r, now),
          endedAt: r.endedAt
        }));
      }
    };
  }
  noteSinceWoke(input) {
    if (this.observer || input.nightRun === true || input.sessionId.length === 0)
      return;
    try {
      markSinceSeen(this.counterpart.store.dir, input.sessionId, { at: this.nowFn(), state: "woke" });
    } catch {}
  }
  sinceLine(input, room, opts = {}) {
    if (this.observer || input.nightRun === true || input.sessionId.length === 0)
      return "";
    try {
      const dir = this.counterpart.store.dir;
      const record = readSession(dir, input.sessionId);
      if (record === null)
        return "";
      const now = this.nowFn();
      const seen = record.sinceSeen ?? { at: record.startedAt, state: "woke" };
      if (seen.state === "woke" && opts.resumed !== true) {
        markSinceSeen(dir, input.sessionId, { at: seen.at, state: "armed" });
        return "";
      }
      if (seen.state === "shown" && now - seen.at < TUNABLES.SINCE_LINE_EVERY_MS && opts.resumed !== true)
        return "";
      const lines = this.counterpart.sinceElsewhere({ since: seen.at, until: now, started: seen.state !== "shown" }, this.elsewhereHere(input));
      if (lines === null)
        return "";
      const line = [lines.line, ...lines.shorter].find((l) => Buffer.byteLength(`${l}
`, "utf8") <= room);
      if (line === undefined) {
        this.emit("adapter.since.deferred", { room, need: Buffer.byteLength(`${lines.line}
`, "utf8") });
        return "";
      }
      if (!markSinceSeen(dir, input.sessionId, { at: now, state: "shown" }))
        return "";
      this.emit("adapter.since.shown", { bytes: Buffer.byteLength(line, "utf8") });
      return line;
    } catch (err) {
      this.emit("adapter.since.failed", { code: err instanceof Error ? err.name : "unknown" });
      return "";
    }
  }
  onboardingLine(input) {
    if (this.observer || input.nightRun === true || input.sessionId.length === 0)
      return null;
    const store = this.counterpart.store;
    try {
      const on = input.at ?? store.today();
      const offer = offerDue(store, { on, session: input.sessionId });
      if (offer.due) {
        return {
          kind: "offer",
          text: offerLine(offer.state),
          commit: () => {
            noteOffered(store, { on, session: input.sessionId, state: false });
            this.emit("adapter.meet.offered", { state: offer.state });
          }
        };
      }
      const live = (id) => {
        const r = store.row(id);
        return r !== undefined && r.archived === 0 && r.superseded_by === null && r.confidential === 0;
      };
      const aha = ahaDue(store, input.sessionId, live);
      if (aha === null)
        return null;
      return {
        kind: "aha",
        text: ahaLine(store.readProse(aha.memoryId).body, aha.memoryId),
        commit: () => {
          markAha(store, input.sessionId);
          this.emit("adapter.meet.aha", { step: aha.step });
        }
      };
    } catch (err) {
      this.emit("adapter.meet.failed", { code: err instanceof Error ? err.name : "unknown" });
      return null;
    }
  }
  onboardingMarker(input) {
    const store = this.counterpart.store;
    if (input !== undefined && !this.observer && input.nightRun !== true && input.sessionId.length > 0) {
      try {
        return onboardingMarker(settleOffer(store, input.at ?? store.today()));
      } catch {}
    }
    return onboardingMarker(meetState(store));
  }
  storeMarker() {
    try {
      return storeMarker(this.counterpart.store.dir);
    } catch {
      return "";
    }
  }
  meetPending() {
    try {
      return meetPending(this.counterpart.store);
    } catch {
      return false;
    }
  }
  chapterExports() {
    const config = this.configPath;
    if (config === undefined || config.length === 0)
      return;
    let read;
    try {
      read = readScopes(scopesPath(config));
    } catch {
      return;
    }
    if (read.error !== null)
      return;
    return (scope) => {
      try {
        return stanceOfMode(lookupScope(read.registry, scope).mode) === "on";
      } catch {
        return false;
      }
    };
  }
  noteWakeExpectation(input, sentinel) {
    if (this.observer)
      return;
    if (input.sessionId.length === 0)
      return;
    if (sentinel === null || sentinel.length === 0)
      return;
    const marked = recordSession(this.counterpart.store.dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase: "start",
      at: this.nowFn(),
      wakeSentinel: sentinel,
      ...this.recordStamp()
    });
    this.emit("adapter.wake.expected", { recorded: marked !== null });
  }
  nowLine() {
    return `Now: ${localClock(this.nowFn(), this.counterpart.store.zone())}`;
  }
  plainFor(input) {
    const none = { context: "", notices: [], due: [] };
    if (input.at === undefined || input.nightRun === true)
      return none;
    try {
      const due = this.counterpart.plainDueToday({ at: input.at });
      return {
        context: due.map((r) => `${plainContextLine(r)}
`).join(""),
        notices: due.map(plainLine),
        due
      };
    } catch {
      return none;
    }
  }
  claimPlain(input, due) {
    if (input.at === undefined || due.length === 0)
      return [];
    const at = input.at;
    const claimed = due.filter((r) => {
      try {
        return this.counterpart.claimPlainReminder(r, { at, session: input.sessionId });
      } catch {
        return false;
      }
    });
    if (claimed.length > 0)
      this.emit("adapter.plain.told", { count: claimed.length });
    if (claimed.length < due.length)
      this.emit("adapter.plain.lost", { count: due.length - claimed.length });
    return claimed;
  }
  writeUpPointerRetired() {
    try {
      return this.counterpart.dreams.setting() === "auto";
    } catch {
      return false;
    }
  }
  deliverWriteUpAsk(input, spent, opts = {}) {
    try {
      if (this.observer)
        return "";
      if (input.sessionId.length === 0 || input.nightRun === true)
        return "";
      if (this.writeUpPointerRetired()) {
        this.emit("adapter.writeup.skipped", { reason: "night-catches-up" });
        return "";
      }
      const store = this.counterpart.store;
      const dir = store.dir;
      const record = readSession(dir, input.sessionId);
      if (record?.writeUpPointer !== undefined)
        return "";
      const today = this.counterpart.self.calendarToday();
      const spentToday = store.getMeta(WRITE_UP_ASK_DATE_KEY) === today ? Number(store.getMeta(WRITE_UP_ASK_COUNT_KEY) ?? "0") : 0;
      if (spentToday >= TUNABLES.WRITE_UP_ASKS_PER_DAY) {
        this.emit("adapter.writeup.skipped", { reason: "asks-spent", today: spentToday });
        return "";
      }
      const now = this.nowFn();
      const plan = writeUpPlan({ store, spans: this.counterpart.spans });
      pruneWriteUpProgress(store, plan);
      const inFlight = readWriteUpProgress(store);
      const zone = this.counterpart.store.zone();
      const owed = owedWriteUps(plan, dir, input.scope, now, {
        exclude: input.sessionId,
        progress: inFlight,
        pointedToday: (at) => calendarDate(at, zone) === today
      });
      const first = owed[0];
      if (first === undefined)
        return "";
      const { held, here, short } = first;
      const entries = writeUpEntries(this.counterpart.spans, { session: held.session, scopes: [here] });
      if (entries.length === 0)
        return "";
      const key = progressKey(held.session, here);
      const progress = inFlight[key];
      const chunk = progress?.chunk ?? WRITE_UP_PART_BYTES;
      const finished = progress !== undefined && progress.answer !== undefined;
      const cut = finished ? [] : writeUpPartsDated(entries, chunk);
      if (!finished && cut.length === 0)
        return "";
      const partsCount = finished ? progress.parts : cut.length;
      const done = finished ? progress.parts : Math.min(progress?.done ?? 0, partsCount);
      const next = finished ? Math.min(done + 1, partsCount) : firstUnwrittenPart(cut, Math.min(done + 1, partsCount));
      const left = cut.slice(next - 1).filter((p, i, rest) => p.unwritten > 0 || i === rest.length - 1);
      const text = writeUpPointer({
        waiting: owed.length,
        ended: held.session,
        endedOn: calendarDate(held.clockFrom, this.counterpart.store.zone()),
        bytes: left.reduce((n, p) => n + Buffer.byteLength(p.text, "utf8"), 0),
        part: next,
        of: partsCount,
        live: input.sessionId,
        short
      });
      const bytes = (opts.cost ?? ((t) => Buffer.byteLength(t, "utf8")))(`

${text}`);
      const limit = opts.limit ?? TUNABLES.HOST_OUTPUT_CHARS;
      const room = limit - spent;
      const outcome = (o, reason) => {
        saveWriteUpPointer(store, {
          at: now,
          date: today,
          outcome: o,
          ...reason === undefined ? {} : { reason },
          need: bytes,
          room,
          ...limit === TUNABLES.HOST_OUTPUT_CHARS ? {} : { limit },
          ...opts.beside === undefined || opts.beside.length === 0 ? {} : { beside: opts.beside }
        });
      };
      if (bytes > room) {
        this.emit("adapter.writeup.deferred", { reason: "host-cap", need: bytes, room });
        this.noteDeliveryWarning(ENVELOPE_GAVE_WAY_EVENT, { hook: opts.label ?? "session-start", part: "pointer", need: bytes, room }, input);
        outcome("deferred", "host-cap");
        return "";
      }
      let heldElsewhere = false;
      const saved = updateWriteUpProgress(store, (all) => {
        heldElsewhere = claimedByOther(all, held.session, input.sessionId, now) !== null;
        if (heldElsewhere)
          return false;
        const cur = all[key];
        all[key] = {
          ...cur ?? {},
          chunk: cur?.chunk ?? chunk,
          parts: partsCount,
          done: Math.min(cur?.done ?? done, partsCount),
          handedAt: now
        };
        return true;
      });
      if (heldElsewhere) {
        this.emit("adapter.writeup.deferred", { reason: "claimed", need: bytes, room });
        return "";
      }
      const marked = saved && recordSession(dir, {
        sessionId: input.sessionId,
        scope: input.scope,
        phase: "start",
        at: now,
        writeUpPointer: held.session,
        ...this.recordStamp()
      }) !== null;
      if (!marked) {
        this.emit("adapter.writeup.deferred", { reason: "mark-unwritten", need: bytes, room });
        outcome("deferred", "mark-unwritten");
        return "";
      }
      try {
        if (store.getMeta(WRITE_UP_ASK_DATE_KEY) !== today)
          store.setMeta(WRITE_UP_ASK_DATE_KEY, today);
        store.setMeta(WRITE_UP_ASK_COUNT_KEY, String(spentToday + 1));
      } catch {}
      outcome("pointed");
      this.emit("adapter.writeup.ask", {
        ended: held.session,
        part: next,
        of: partsCount,
        bytes,
        owed: owed.length,
        short
      });
      return text;
    } catch (err) {
      this.record(WRITE_UP_FAILED_EVENT, input, { code: codeOf(err) });
      return "";
    }
  }
  recallTurn(input, text, opts = {}) {
    const result = this.counterpart.recallForTurn({
      sessionId: input.sessionId,
      text,
      ...opts.budgetBytes === undefined ? {} : { budgetBytes: opts.budgetBytes }
    }, {
      ...input.at === undefined ? {} : { at: input.at },
      ...opts.withhold === undefined ? {} : { withhold: opts.withhold },
      ...input.nightRun === true || opts.noCues === true ? { noCues: true } : {}
    });
    const decision = result.decision;
    this.record(RECALL_DELIVERED_EVENT, input, {
      reason: decision.reason,
      surfaced: decision.surfaced.length,
      footnotes: decision.footnotes.length,
      bytes: decision.bytes,
      budget: decision.budgetBytes,
      observer: decision.observer,
      semantic: decision.semanticSource,
      semanticFrom: decision.semanticFromTurn
    });
    return result;
  }
  captureBoundary(label, kind, input) {
    const turns = input.nightRun === true ? [] : input.turns ?? [];
    const seal = this.sealJoinedLate(label, input, turns);
    const captured = seal === "failed" ? {
      captured: false,
      reason: "IO_FAILED",
      spans: [],
      deduped: 0,
      excluded: turns.length,
      cursorBefore: 0,
      cursorAfter: 0
    } : this.counterpart.captureSpans({
      session: input.sessionId,
      scope: input.scope,
      turns
    });
    const record = this.counterpart.boundary({
      session: input.sessionId,
      scope: input.scope,
      kind
    });
    this.creditAtBoundary(input, captured.cursorBefore, captured.cursorAfter);
    this.record(BOUNDARY_EVENT, input, {
      hook: label,
      kind: record.kind,
      captured: captured.captured,
      reason: captured.reason,
      spans: captured.spans.length,
      deduped: captured.deduped,
      excluded: captured.excluded,
      cursorBefore: captured.cursorBefore,
      cursorAfter: captured.cursorAfter,
      ask: record.askRaised,
      joinedLate: seal !== "none"
    });
    return { reason: captured.reason, spansAppended: captured.spans.length };
  }
  sealJoinedLate(label, input, turns) {
    if (this.observer)
      return "none";
    if (input.sessionId.length === 0)
      return "none";
    try {
      if (readSession(this.counterpart.store.dir, input.sessionId) !== null)
        return "none";
      if (this.counterpart.spans.cursor(input.scope, input.sessionId) !== 0)
        return "none";
    } catch {
      return "none";
    }
    const placeholders = turns.map(() => ({
      role: "user",
      text: "",
      source: "tool"
    }));
    const sealed = this.counterpart.captureSpans({
      session: input.sessionId,
      scope: input.scope,
      turns: placeholders
    });
    const moved = sealed.cursorAfter === turns.length;
    this.emit(SCOPE_JOINED_LATE_EVENT, {
      hook: label,
      mode: this.scope.mode,
      turns: turns.length,
      cursor: sealed.cursorAfter,
      sealed: moved,
      reason: sealed.reason
    });
    if (!moved)
      return "failed";
    this.noteSession("boundary", input);
    return "sealed";
  }
  creditAtBoundary(input, from, to) {
    const started = this.nowFn();
    const day = this.counterpart.store.livedDay();
    const turns = input.turns ?? [];
    const slice = turns.slice(Math.max(0, from), Math.max(from, to));
    const assistantTurns = slice.filter((t) => t.role === "assistant" && (t.source === undefined || t.source === "conversation")).map((t) => t.text);
    const raw = (input.expansions ?? []).filter((e) => e.atTurn > from && e.atTurn <= to).flatMap((e) => [...e.ids]);
    let expansionsRead = "not-read";
    try {
      let resolutions = new Map;
      let salt = "";
      if (raw.length > 0) {
        const dataDir = this.counterpart.store.dir;
        const sessionStartedAt = readSession(dataDir, input.sessionId)?.startedAt;
        const read = readHandleResolutions(dataDir, {
          now: this.nowFn(),
          scope: input.scope,
          ...sessionStartedAt === undefined ? {} : { since: sessionStartedAt }
        });
        resolutions = read.map;
        salt = read.salt;
        expansionsRead = read.reason;
      }
      const resolvedHandles = countTranslated(raw, resolutions, salt);
      const expansions = translateExpansions(raw, resolutions, salt);
      const summary = this.counterpart.creditReferences(input.sessionId, {
        assistantTurns,
        expansions,
        deadline: started + TUNABLES.CREDIT_BUDGET_MS,
        now: this.nowFn
      });
      this.emit(RECALL_CREDIT_EVENT, {
        reason: summary.reason,
        considered: summary.considered,
        expanded: summary.expanded,
        quoted: summary.quoted,
        credited: summary.credited,
        elapsedMs: this.nowFn() - started
      });
      this.counterpart.noteAdapterEvent(RECALL_CREDIT_EVENT, {
        reason: summary.reason,
        session: input.sessionId,
        date: input.at ?? null,
        day: summary.day,
        turns: assistantTurns.length,
        considered: summary.considered,
        expanded: summary.expanded,
        quoted: summary.quoted,
        credited: summary.credited,
        linkedDespite: summary.linkedDespite,
        unresolvedHandles: summary.unresolvedHandles,
        resolvedHandles,
        expansionsRead,
        skippedForBudget: summary.skippedForBudget,
        unreadable: summary.unreadable,
        refused: summary.refused,
        ids: summary.ids.slice(0, 64),
        how: summary.how.slice(0, 64),
        idsTotal: summary.ids.length,
        expandedIds: summary.expandedIds.slice(0, 64),
        expandedTotal: summary.expandedIds.length,
        pointersExpanded: summary.pointersExpanded,
        shownLoud: summary.shown.loud,
        shownFootnotes: summary.shown.footnotes,
        shownPointers: summary.shown.pointers,
        unusedLoud: summary.unused.loud,
        unusedFootnotes: summary.unused.footnotes,
        unusedPointers: summary.unused.pointers,
        shownNotUsed: summary.shownNotUsed.slice(0, 64),
        shownNotUsedTotal: summary.shownNotUsed.length,
        judgedThrough: summary.judgedThrough,
        elapsedMs: this.nowFn() - started
      });
    } catch (err) {
      const code = codeOf(err);
      this.emit(RECALL_CREDIT_EVENT, { reason: "failed", code });
      this.counterpart.noteAdapterEvent(RECALL_CREDIT_EVENT, {
        reason: "failed",
        session: input.sessionId,
        date: input.at ?? null,
        day,
        code,
        turns: assistantTurns.length,
        expansions: raw.length,
        expansionsRead
      });
    }
  }
  noteTail(input) {
    try {
      this.counterpart.noteOrphanTail(input.sessionId, substanceOf(input.turns ?? []), undefined, {
        rebase: input.turnsUnread !== true
      });
    } catch (err) {
      this.emit("adapter.tail.failed", { code: codeOf(err) });
    }
  }
  paceAsk(input, opts = {}) {
    try {
      const substance = substanceOf(input.turns ?? []);
      const chapter = this.counterpart.episodeAsk(input.sessionId, substance, undefined, {
        rebase: input.turnsUnread !== true,
        scope: input.scope
      });
      const outcome = chapter.asked ? "asked" : chapter.verdict.reason === "session-ask-cap" ? "capped" : "paced";
      let coverage = null;
      try {
        coverage = this.counterpart.spans.coverageReport(input.scope);
      } catch (err) {
        this.emit("adapter.coverage.failed", { code: codeOf(err) });
      }
      this.record(ADAPTER_ASK_EVENT, input, {
        asked: chapter.asked,
        outcome,
        reason: chapter.verdict.reason,
        chapter: chapter.chapter,
        turns: substance.turns,
        bytes: substance.bytes,
        counting: ASK_ROW_COUNTING,
        sinceTurns: chapter.verdict.sinceTurns,
        sinceBytes: chapter.verdict.sinceBytes,
        spans: coverage?.spans ?? null,
        covered: coverage?.covered ?? null,
        uncovered: coverage?.uncovered ?? null,
        unaskableSpans: coverage?.unaskableSpans ?? null,
        unaskableBytes: coverage?.unaskableBytes ?? null,
        unwritten: chapter.verdict.unwritten?.pieces ?? null,
        unwrittenMinutes: chapter.verdict.unwritten?.minutes ?? null,
        ...opts.coveredBy === undefined ? {} : { coveredBy: opts.coveredBy }
      });
      return chapter.asked ? chapter.chapter : null;
    } catch (err) {
      this.emit("adapter.ask.failed", { code: codeOf(err) });
      return null;
    }
  }
  noteSession(phase, input) {
    if (this.observer)
      return;
    if (input.sessionId.length === 0)
      return;
    const dir = this.counterpart.store.dir;
    const record = recordSession(dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase,
      at: this.nowFn(),
      ...this.recordStamp(),
      ...input.model === undefined ? {} : { model: input.model },
      ...input.entrypoint === undefined ? {} : { entrypoint: input.entrypoint }
    });
    this.emit("adapter.session.registry", { phase, ok: record !== null });
    if (phase === "start") {
      const pruned = pruneSessions(dir, this.nowFn());
      if (pruned > 0)
        this.emit("adapter.session.registry.pruned", { removed: pruned });
      const logs = pruneLog(dir, localDate(this.nowFn(), this.counterpart.store.zone()));
      if (logs > 0)
        this.emit("adapter.log.pruned", { removed: logs });
    }
  }
  spawnWorker(input) {
    const bound = {
      ...input?.sessionId === undefined || input.sessionId.length === 0 ? {} : { session: input.sessionId },
      ...input?.scope === undefined || input.scope.length === 0 ? {} : { scope: input.scope },
      ...this.configPath === undefined || this.configPath.length === 0 ? {} : { configPath: this.configPath }
    };
    const plan = planSpawn({
      config: this.config,
      command: this.command,
      args: this.args,
      priorFailures: 0,
      ...bound
    });
    const prior = plan.ok ? 0 : this.refusalCount(plan.reason);
    const replanned = plan.ok ? plan : planSpawn({
      config: this.config,
      command: this.command,
      args: this.args,
      priorFailures: prior,
      ...bound
    });
    const outcome = spawnDetached(replanned, {
      ...this.spawner === undefined ? {} : { spawner: this.spawner },
      onEvent: (name, data) => this.emit(name, data)
    });
    if (outcome.started) {
      this.clearRefusals();
      this.noteSpawnStart(input);
      return outcome;
    }
    const count = this.bumpRefusal(String(outcome.reason));
    this.noteSpawnRefusal(outcome, count, input);
    return outcome;
  }
  noteSpawnStart(input) {
    if (this.observer)
      return;
    const date = input?.at ?? localDate(this.nowFn(), this.counterpart.store.zone());
    try {
      this.bumpStart(date);
      this.counterpart.noteAdapterEvent(SPAWN_STARTED_EVENT, { date, session: input?.sessionId ?? null }, { dedupKey: `${SPAWN_STARTED_EVENT}:${date}` });
    } catch (err) {
      this.emit("adapter.spawn.record.failed", { code: codeOf(err) });
    }
  }
  spawnStarts() {
    try {
      const store = this.counterpart.store;
      const date = store.getMeta(SPAWN_START_DATE_KEY) ?? null;
      return { date, count: Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0") };
    } catch {
      return { date: null, count: 0 };
    }
  }
  bumpStart(date) {
    try {
      const store = this.counterpart.store;
      const on = store.getMeta(SPAWN_START_DATE_KEY);
      const next = on === date ? Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0") + 1 : 1;
      if (on !== date)
        store.setMeta(SPAWN_START_DATE_KEY, date);
      store.setMeta(SPAWN_START_COUNT_KEY, String(next));
      return next;
    } catch {
      return 1;
    }
  }
  noteSpawnRefusal(outcome, count, input) {
    if (this.observer)
      return;
    const name = outcome.reason === "SPAWN_FAILED" ? SPAWN_FAILED_EVENT : SPAWN_REFUSED_EVENT;
    const date = input?.at ?? null;
    try {
      this.counterpart.noteAdapterEvent(name, {
        reason: String(outcome.reason),
        code: outcome.code,
        count,
        escalate: outcome.escalate,
        date,
        session: input?.sessionId ?? null
      }, { dedupKey: `${name}:${String(outcome.reason)}:${date ?? "no-date"}` });
    } catch (err) {
      this.emit("adapter.spawn.record.failed", { code: codeOf(err) });
    }
  }
  spawnRefusals() {
    const out = {};
    if (this.observer) {
      for (const [reason, n] of this.volatileRefusals)
        out[reason] = n;
      return out;
    }
    try {
      for (const [key, value] of this.counterpart.store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
        const n = Number(value);
        if (n > 0)
          out[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
      }
    } catch (err) {
      this.emit("adapter.spawn.refusals.failed", { code: codeOf(err) });
    }
    return out;
  }
  refusalCount(reason) {
    if (this.observer)
      return this.volatileRefusals.get(reason) ?? 0;
    try {
      return Number(this.counterpart.store.getMeta(`${SPAWN_REFUSAL_PREFIX}${reason}`) ?? "0");
    } catch {
      return 0;
    }
  }
  bumpRefusal(reason) {
    const next = this.refusalCount(reason) + 1;
    if (this.observer) {
      this.volatileRefusals.set(reason, next);
      return next;
    }
    try {
      this.counterpart.store.setMeta(`${SPAWN_REFUSAL_PREFIX}${reason}`, String(next));
    } catch (err) {
      this.emit("adapter.spawn.count.failed", { code: codeOf(err) });
    }
    return next;
  }
  clearRefusals() {
    this.volatileRefusals.clear();
    if (this.observer)
      return;
    try {
      const store = this.counterpart.store;
      for (const [key, value] of store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
        if (value !== "0")
          store.setMeta(key, "0");
      }
    } catch (err) {
      this.emit("adapter.spawn.count.failed", { code: codeOf(err) });
    }
  }
  record(name, input, data) {
    const row = { ...data, date: input.at ?? null, session: input.sessionId };
    this.emit(name, row);
    this.counterpart.noteAdapterEvent(name, row);
  }
  noteDeliveryWarning(name, data, input) {
    this.emit(name, data);
    try {
      const store = this.counterpart.store;
      const day = store.livedDay();
      const session = input?.sessionId ?? null;
      const date = input?.at ?? localDate(this.nowFn(), store.zone());
      const key = [name, String(data["hook"] ?? ""), String(data["part"] ?? ""), session ?? "", String(day)].join(":");
      this.counterpart.noteAdapterEvent(name, { ...data, date, session }, { dedupKey: key });
    } catch {}
  }
  emit(name, data) {
    const event = { at: this.nowFn(), name, data };
    this.ring.push(event);
    if (this.ring.length > EVENT_RING)
      this.ring.shift();
    try {
      this.onEvent?.(event);
    } catch {}
  }
}
export function substanceOf(turns) {
  let count = 0;
  let bytes = 0;
  let lastEntry;
  for (const turn of turns) {
    if ((turn.source ?? "conversation") !== "conversation")
      continue;
    bytes += Buffer.byteLength(turn.text, "utf8");
    if (turn.role !== "user")
      continue;
    if (turn.entry !== undefined && turn.entry === lastEntry)
      continue;
    lastEntry = turn.entry;
    count += 1;
  }
  return { turns: count, bytes };
}
export function plainLine(r) {
  const max = TUNABLES.PLAIN_WHAT_MAX_CHARS;
  const what = r.what.length <= max ? r.what : `${r.what.slice(0, max - 1).trimEnd()}…`;
  if (r.late === true)
    return `This was for ${readableDate(r.lastDay)}: ${what}`;
  if (r.beat === "day")
    return `Today: ${what}`;
  if (r.beat === "last-day")
    return `Last day today: ${what}`;
  if (r.precision === "month")
    return `This month: ${what}`;
  return `Until ${readableDate(r.lastDay)}: ${what}`;
}
export function plainContextLine(r) {
  return `Plain reminder (they asked to be told) — ${plainLine(r)} [${r.memoryId}]`;
}
export function codeOf(err) {
  if (err !== null && typeof err === "object") {
    const code = err.code;
    if (typeof code === "string")
      return code;
    const name = err.name;
    if (typeof name === "string")
      return name;
  }
  return "UNKNOWN";
}
