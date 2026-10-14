import { randomUUID } from "node:crypto";
import { Associate, appendPendingDeltas, claimPending, releasePending } from "./associate/index.js";
import { horizonFor } from "./briefing.js";
import { episodeGate } from "./bridge.js";
import { Dreams, Reflections } from "./dream/index.js";
import { meetingDay } from "./onboarding.js";
import { isObserver } from "./observer.js";
import { Prospective } from "./prospective/index.js";
import {
  ASKED_KIND,
  ASKED_MAX,
  askedTurn,
  Recall,
  headOf,
  judgedThrough,
  loadGateState,
  loadSessionSemantic,
  markJudged,
  saveSessionSemantic
} from "./recall/index.js";
import { DREW_ON_MAX_PER_BOUNDARY, resolveReferences } from "./recall/reference.js";
import {
  SpanBuffer,
  TUNABLES as REMEMBER,
  errCode
} from "./remember/index.js";
import { redactSecrets } from "./encode/index.js";
import { recallTurn } from "./retrieval.js";
import { applyRevision } from "./revision.js";
import {
  CORRECTED_REASON,
  settle as settleContradiction,
  settleMovedReminders,
  undo as undoContradiction,
  writeNeighbours
} from "./reconsolidation.js";
import { Schemas } from "./schemas/index.js";
import {
  HANDOFF_CLEARED_EVENT,
  HANDOFF_SHOWN_EVENT,
  HANDOFF_WRITTEN_EVENT,
  HANDOFF_REFUSED_EVENT,
  HANDOFF_RESERVE_MARGIN_BYTES,
  reserveBytes,
  Handoffs,
  isHandoffRow,
  staleWords
} from "./handoff/index.js";
import { CLAIM_CHAPTER, askFromStretch, chapterClaims, claimUnwritten, sessionStretch, sessionsHere, workSince } from "./coverage/index.js";
import { LAST_HERE_LIFE_DAYS, LAST_HERE_NOROOM_EVENT, chaptersBySession, chaptersHere, chaptersOn, elsewhereLine, lastHereLadder, sinceElsewhereLines, stampWords, todayElsewhereLines, yesterdayLine, yesterdayShorter } from "./handoff/last-here.js";
import { LAST_EXCHANGE_LINE_MAX_BYTES, exchangeLikely, lastExchange, lastExchangeLine, withExchange } from "./handoff/last-exchange.js";
import { addDays, isDay, localStamp, localStampAfter, startOfLocalDay } from "./time.js";
import { EPISODE_REGROWN_REASON, leftAs } from "./leaving.js";
import {
  BRIEFING_KEY,
  NIGHT_WRITER_MEMORY_MAX,
  NIGHT_WRITER_TOOL,
  PREFACE_RESERVE_BYTES,
  Self,
  byteLength,
  markWakeBehind,
  nearDue,
  pageRoomNote,
  readSentinel,
  settledOver,
  threadsShown,
  spliceBeforeSentinel,
  WORK_OVERFLOW_EVENT,
  rotateWork,
  workHere,
  workHereBlock,
  workHereBytes,
  writerInstruction,
  fitNightWriter
} from "./self/index.js";
import { acceptsReflectedFeeling, keepCore, retireCore } from "./sleep/index.js";
import { ABOUT_MARKS, CORE_ABOUT_MARKS, Store, assertSafeDataDir, rowTombstoned, hashText, indexTextOf } from "./store/index.js";
import { TUNABLES as PHYSICS, band as bandOf, fadeOf } from "./physics/index.js";
import { isKnownSession } from "./types.js";
import {
  SELF_BRIEFING_EVENT,
  CAPTURE_FAILED_EVENT,
  SEMANTIC_LAG_EVENT,
  RECALL_DECISION_EVENT,
  recallDecisionRecord,
  ASSOCIATE_FLUSH_EVENT,
  SUBJECTS_BACKFILL_META,
  REGROWN_RELINK_META,
  CORRECTED_RELINK_META
} from "./counterpart-events.js";
import * as boundaryPart from "./counterpart-boundary.js";
import { rowIds } from "./counterpart-boundary.js";
import * as sweepPart from "./counterpart-sweep.js";
import * as depositPart from "./counterpart-deposit.js";
export {
  GATE_CHUNK_EVENT,
  GATE_CHUNK_FIELDS,
  GATE_DEPOSIT_EVENT,
  GATE_DEPOSIT_FIELDS,
  RECALL_DECISION_EVENT,
  SWEEP_GATE_EVENT,
  SWEEP_WAKE_EVENT,
  SLEEP_CYCLE_EVENT,
  SELF_BRIEFING_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  PRIMACY_DELIVER_EVENT,
  WAKE_INJECTED_EVENT,
  WAKE_DELIVERED_EVENT,
  RECALL_DELIVERED_EVENT,
  EPISODE_ASK_EVENT,
  BOUNDARY_EVENT,
  AUTHORSHIP_ASK_EVENT,
  ADAPTER_ASK_EVENT,
  EMBED_BACKFILL_EVENT,
  SEMANTIC_LAG_EVENT,
  RECALL_CREDIT_EVENT,
  ASSOCIATE_FLUSH_EVENT,
  CONTIGUITY_CURSOR_META,
  SUBJECTS_BACKFILL_META,
  REGROWN_RELINK_META,
  CORRECTED_RELINK_META,
  SPAWN_REFUSED_EVENT,
  SPAWN_FAILED_EVENT,
  RUNNER_FAILED_EVENT,
  HOOK_CLAIM_LOST_EVENT,
  WRITE_UP_FAILED_EVENT,
  NIGHT_WRITE_UP_EVENT,
  CAPTURE_FAILED_EVENT,
  SPAWN_STARTED_EVENT,
  MCP_RECALL_EVENT,
  MCP_PART_EVENT,
  MCP_OVERSIZE_EVENT,
  MCP_SPILLED_EVENT,
  ENVELOPE_OVERCAP_EVENT,
  NOTICE_DROPPED_EVENT,
  ENVELOPE_GAVE_WAY_EVENT,
  INJECTION_OVERBUDGET_EVENT,
  CHECKOUT_EVENT,
  SNAPSHOT_TAKEN_EVENT,
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_ROTATED_EVENT,
  STORE_EXPORT_EVENT,
  RECALL_DECISION_FIELDS,
  surfaceSetFields
} from "./counterpart-events.js";
export { DREW_ON_MAX_PER_BOUNDARY };
export { ROW_IDS_MAX, boundedIds } from "./types.js";
const EVENT_RING = REMEMBER.CONSUMED_LEDGER_MAX;
function linksDespite(r) {
  if (r.reason === "already-credited-at-or-above")
    return true;
  if (r.reason !== "physics-refused")
    return false;
  const why = r.outcome?.reason;
  return why === "birth-day" || why === "stale-day" || why === "already-credited-today";
}

export class Counterpart {
  store;
  spans;
  associate;
  schemas;
  self;
  recall;
  prospective;
  handoffs;
  dreams;
  reflections;
  observer;
  vectors;
  owner;
  pageWriterModeOpt;
  build;
  reportedBudget;
  onEvent;
  nowFn;
  ring = [];
  briefingEvents = null;
  deliveredThreads = null;
  delivering = false;
  deliveryWalk = null;
  constructor(opts) {
    if (opts.dir !== undefined)
      assertSafeDataDir(opts.dir);
    this.observer = isObserver(opts);
    this.owner = opts.owner === true && !this.observer;
    this.pageWriterModeOpt = opts.pageWriterMode ?? "session";
    this.build = typeof opts.build === "string" && opts.build.length > 0 ? opts.build : null;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? (() => Date.now());
    this.reportedBudget = opts.budgetBytes ?? null;
    this.store = Store.open({
      observer: this.observer,
      now: this.nowFn,
      ...opts.dir === undefined ? {} : { dir: opts.dir },
      ...opts.embed === undefined ? {} : { embed: opts.embed },
      ...opts.retentionDays === undefined ? {} : { retentionDays: opts.retentionDays },
      ...opts.snapshotsDir === undefined ? {} : { snapshotsDir: opts.snapshotsDir },
      ...opts.timeZone === undefined ? {} : { timeZone: opts.timeZone },
      onEvent: (e) => this.relay("store", e)
    });
    const embed = opts.embed;
    const live = opts.vectors;
    this.vectors = this.observer || embed === undefined && live === undefined ? undefined : {
      vector: async (title, content) => live === undefined ? embed?.(indexTextOf(title, content)) ?? null : live.vector(indexTextOf(title, content)),
      warm: async (items) => {
        if (live === undefined)
          return;
        await live.warm(items.map((i) => indexTextOf(i.title, i.content)));
      },
      context: (vec) => this.store.neighbourVectors(vec, PHYSICS.K_NEAREST)
    };
    this.associate = new Associate({
      store: this.store,
      onEvent: (e) => this.relay("associate", e)
    });
    this.schemas = Schemas.open({
      store: this.store,
      retarget: (oldId, newId, day) => {
        this.associate.retargetOnSupersede(oldId, newId, day);
      },
      onEvent: (e) => this.relay("schemas", { at: e.at, name: e.event, ...e.ref === undefined ? {} : { ref: e.ref }, ...e.data === undefined ? {} : { data: e.data } })
    });
    this.store.findSubjectsWith((text) => this.schemas.subjectsIn(text));
    if (!this.observer)
      this.backfillSubjects();
    if (!this.observer)
      this.relinkRegrownCopies();
    if (!this.observer)
      this.relinkCorrected();
    if (!this.observer)
      settleMovedReminders(this.store, { retarget: this.retargetLinks });
    this.self = new Self({
      store: this.store,
      gate: episodeGate(),
      onEvent: (e) => {
        if (this.briefingEvents !== null && e.name.startsWith(SELF_BRIEFING_EVENT)) {
          this.briefingEvents.push({ ...e });
        }
        this.relay("self", e);
      },
      onMemoryMinted: (m) => this.creditNamedIn(m.title, m.body, m.day, m.id, "episode"),
      retarget: (oldId, newId, day) => {
        this.associate.retargetOnSupersede(oldId, newId, day);
      },
      now: this.nowFn,
      ...opts.selfTunables === undefined ? {} : { tunables: opts.selfTunables }
    });
    this.recall = new Recall({
      store: this.store,
      owner: opts.owner === true,
      ...this.reportedBudget === null ? {} : { budgetBytes: this.reportedBudget },
      onEvent: (e) => this.relay("recall", e),
      now: this.nowFn
    });
    this.prospective = new Prospective({
      store: this.store,
      onEvent: (e) => this.relay("prospective", e),
      now: this.nowFn
    });
    this.handoffs = new Handoffs({
      store: this.store,
      gate: episodeGate(),
      observer: this.observer,
      onEvent: (e) => this.relay("handoff", e),
      now: this.nowFn,
      owner: this.owner,
      settled: () => settledOver(this.store),
      listed: () => this.deliveredThreads ?? threadsShown(this.store)
    });
    this.spans = new SpanBuffer({
      dir: this.store.dir,
      observer: this.observer,
      day: () => this.store.livedDay(),
      now: this.nowFn,
      onEvent: (e) => this.relay("remember", e)
    });
    this.dreams = new Dreams({
      store: this.store,
      observer: this.observer,
      owner: this.owner,
      ...opts.bundlesAsOwner === true ? { bundleOwner: this.owner } : {},
      gate: (text) => {
        const redacted = redactSecrets(text);
        return redacted.replace(/\[REDACTED[^\]]*\]/g, "").trim().length === 0 ? { ok: false, reason: "only-a-credential" } : { ok: true, text: redacted };
      },
      page: () => this.self.page()?.body ?? null,
      wake: () => this.store.getMeta(BRIEFING_KEY) ?? null,
      today: () => this.store.today(),
      holds: (at) => meetingDay(this.store, at),
      retarget: (oldId, newId, day) => {
        this.associate.retargetOnSupersede(oldId, newId, day);
      },
      link: (pairs, weight, day) => this.associate.propose(pairs, weight, day),
      emit: (name, ref, data) => this.emit(name, ref, data),
      ownerName: () => this.ownerDisplayName()
    });
    this.reflections = new Reflections({
      store: this.store,
      observer: this.observer,
      owner: this.owner,
      ...opts.bundlesAsOwner === true ? { bundleOwner: this.owner } : {},
      gate: (text) => {
        const redacted = redactSecrets(text);
        return redacted.replace(/\[REDACTED[^\]]*\]/g, "").trim().length === 0 ? { ok: false, reason: "only-a-credential" } : { ok: true, text: redacted };
      },
      page: () => this.self.page()?.body ?? null,
      pageInfo: () => {
        const p = this.self.page();
        return p === null ? null : { version: p.version, by: p.by, revisedOn: p.revisedOn };
      },
      pageWrites: opts.pageWriterMode !== "off",
      today: () => this.store.today(),
      ownerName: () => this.ownerDisplayName(),
      dreamLine: (dreamId) => this.dreams.handBackOf(dreamId),
      writePage: (body, o) => {
        const common = {
          by: "reflection",
          reason: o.reason,
          session: o.session,
          ...o.model === null ? {} : { model: o.model }
        };
        const written = body === null ? this.self.addPageShort(o.short ?? "", { ...common, ...o.ifVersion === undefined ? {} : { ifVersion: o.ifVersion } }) : this.self.revisePage(body, { ...common, ...o.short === undefined ? {} : { short: o.short } });
        const note = pageRoomNote(written, this.self.tunables.PAGE_ROOM_BYTES, "call finish again with page.short alone (the entry and the page stand)");
        return written.written && written.version !== null ? { ok: true, version: written.version, note } : written.reason === "too-large" ? { ok: false, reason: written.reason, bytes: written.bytes, limit: this.self.tunables.PAGE_MAX_BYTES, note } : { ok: false, reason: written.reason, note };
      },
      emit: (name, ref, data) => this.emit(name, ref, data)
    });
    if (opts.identity !== undefined)
      this.self.ensureIdentityCore(opts.identity);
  }
  static open(opts = {}) {
    return new Counterpart(opts);
  }
  close() {
    this.store.close();
  }
  budgetBytes() {
    return this.reportedBudget;
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }
  wake(budgetBytes, delivery, here) {
    if (budgetBytes === undefined) {
      this.emit("counterpart.budget.unreported", undefined, { had: this.reportedBudget });
    } else {
      this.reportedBudget = budgetBytes;
      this.emit("counterpart.budget.reported", undefined, { budgetBytes });
    }
    let withPointer;
    this.delivering = delivery !== undefined;
    try {
      const assembled = delivery === undefined ? null : this.assembleWake(delivery, here);
      const result = delivery === undefined ? this.self.wake() : this.self.wake(delivery, assembled?.text);
      this.deliveredThreads = assembled === null ? null : new Set(assembled.kept.threads);
      withPointer = delivery === undefined ? result : this.addHandoffPointer(result, here);
    } finally {
      this.deliveredThreads = null;
      this.delivering = false;
      this.deliveryWalk = null;
    }
    this.emit("counterpart.wake", undefined, {
      ok: withPointer.ok,
      reason: withPointer.reason,
      bytes: withPointer.bytes,
      preface: withPointer.preface !== null,
      budgetBytes: this.reportedBudget
    });
    return { ...withPointer, budgetBytes: this.reportedBudget };
  }
  assembleWake(delivery, here) {
    const budget = this.reportedBudget;
    const at = delivery.date;
    if (budget === null || at === undefined || !isDay(at))
      return null;
    const started = performance.now();
    try {
      const stored = this.store.getMeta(BRIEFING_KEY);
      if (stored === undefined || stored.length === 0 || !readSentinel(stored).intact)
        return null;
      const day = this.store.livedDay();
      const asked = horizonFor(this.prospective, at, day);
      const horizon = asked.items.map((i) => nearDue(i.due, at) ? { ...i, near: true } : i);
      const out = this.self.assemble({
        day,
        ceilingBytes: budget,
        publishedHash: hashText(stored),
        horizon,
        ...asked.more.length === 0 ? {} : { horizonMore: asked.more },
        ...this.yesterdayFor(at, { here }),
        ...this.elsewhereFor(at, here)
      });
      if (out === null)
        return null;
      this.emit("counterpart.wake.assembled", undefined, {
        ms: performance.now() - started,
        bytes: out.bytes,
        threads: out.kept.threads.length,
        horizon: out.kept.horizon.length,
        elsewhere: out.elsewhere !== undefined,
        page: out.page?.rung ?? "",
        counted: Object.values(out.more).reduce((n, k) => n + (k ?? 0), 0),
        untold: Object.values(out.untold).reduce((n, k) => n + (k ?? 0), 0),
        quiet: Object.values(out.quiet).reduce((n, k) => n + (k ?? 0), 0)
      });
      return out;
    } catch (err) {
      this.emit("counterpart.wake.assemble.failed", undefined, { code: errCode(err) });
      return null;
    }
  }
  elsewhereFor(at, here) {
    const gate = this.elsewhereGate(here);
    if (gate === null)
      return {};
    try {
      const { named, reader } = gate;
      const zone = this.store.zone();
      const since = startOfLocalDay(at, zone);
      const until = startOfLocalDay(addDays(at, 1), zone);
      const dirs = new Map;
      const dirOf = (scope) => {
        const key = gate.norm(scope);
        let d = dirs.get(key);
        if (d === undefined) {
          d = { scope: key, firstAt: null, lastAt: null, live: false, chapter: null, memories: 0 };
          dirs.set(key, d);
        }
        return d;
      };
      for (const s of here?.sessions?.() ?? []) {
        if (s.session === reader || s.lastAt < since || s.startedAt >= until || !named(s.scope))
          continue;
        const d = dirOf(s.scope);
        d.firstAt = d.firstAt === null ? s.startedAt : Math.min(d.firstAt, s.startedAt);
        d.lastAt = d.lastAt === null ? s.lastAt : Math.max(d.lastAt, s.lastAt);
        d.live = d.live || s.live;
      }
      for (const { scope, count } of this.store.memoryCountsByScopeSince(since, { confidential: this.owner })) {
        if (named(scope))
          dirOf(scope).memories = count;
      }
      const chapters = this.chaptersInWindow(this.store.livedDay());
      const hereIds = new Set(this.chaptersHereFor(here?.scope ?? "", reader, chapters).map((f) => f.chapter.id));
      const aboutMe = this.selfChapterElsewhere(chapters, hereIds, reader, here?.exportsFrom);
      for (const c of chapters.values()) {
        if (c.scope === null || c.writtenAt < since || c.writtenAt >= until || hereIds.has(c.id))
          continue;
        if (c.id === aboutMe?.id || !gate.crosses(c))
          continue;
        const d = dirOf(c.scope);
        if (d.chapter === null || d.chapter.writtenAt < c.writtenAt)
          d.chapter = c;
      }
      const lines = todayElsewhereLines([...dirs.values()], zone);
      if (lines === null)
        return {};
      return lines.shorter.length === 0 ? { elsewhere: lines.line } : { elsewhere: lines.line, elsewhereShorter: lines.shorter };
    } catch {
      return {};
    }
  }
  elsewhereGate(here) {
    const exportsFrom = here?.exportsFrom;
    if (exportsFrom === undefined)
      return null;
    const norm = (scope) => scope.trim().replace(/\/+$/, "");
    const own = norm(here?.scope ?? "");
    const reader = here?.session ?? null;
    const allowed = new Map;
    const named = (scope) => {
      const key = norm(scope);
      if (key.length === 0 || key === own || key === norm(this.store.dir))
        return false;
      let open = allowed.get(key);
      if (open === undefined) {
        try {
          open = exportsFrom(scope) === true;
        } catch {
          open = false;
        }
        allowed.set(key, open);
      }
      return open;
    };
    const crosses = (c) => {
      if (c.scope === null || c.confidential === true || c.aboutMe !== true)
        return false;
      if (reader !== null && c.session === reader)
        return false;
      return named(c.scope);
    };
    return { named, crosses, norm, reader };
  }
  sinceElsewhere(window, here) {
    const gate = this.elsewhereGate(here);
    if (gate === null || !(window.until > window.since))
      return null;
    try {
      const { named, reader } = gate;
      const { since, until } = window;
      const dirs = new Map;
      const dirOf = (scope) => {
        const key = gate.norm(scope);
        let d = dirs.get(key);
        if (d === undefined) {
          d = { scope: key, startedAt: null, live: false, endedAt: null, chapter: null, memories: 0 };
          dirs.set(key, d);
        }
        return d;
      };
      for (const s of here.sessions?.() ?? []) {
        if (s.session === reader || s.startedAt >= until || !named(s.scope))
          continue;
        const ended = s.endedAt ?? null;
        const startedSince = s.live && s.startedAt >= since;
        const endedSince = ended !== null && ended >= since && ended < until;
        if (!startedSince && !endedSince && !s.live)
          continue;
        const d = dirOf(s.scope);
        d.live = d.live || s.live;
        if (startedSince)
          d.startedAt = Math.max(d.startedAt ?? 0, s.startedAt);
        if (endedSince)
          d.endedAt = Math.max(d.endedAt ?? 0, ended);
      }
      for (const { scope, count } of this.store.memoryCountsByScopeSince(since, { confidential: this.owner })) {
        if (named(scope))
          dirOf(scope).memories = count;
      }
      for (const c of this.chaptersInWindow(this.store.livedDay()).values()) {
        if (c.scope === null || c.writtenAt < since || c.writtenAt >= until || !gate.crosses(c))
          continue;
        const d = dirOf(c.scope);
        if (d.chapter === null || d.chapter.writtenAt < c.writtenAt)
          d.chapter = c;
      }
      return sinceElsewhereLines([...dirs.values()], { at: since, started: window.started, now: until }, this.store.zone());
    } catch {
      return null;
    }
  }
  addHandoffPointer(result, here) {
    const scope = here?.scope?.trim() ?? "";
    if (scope.length === 0 || !result.ok)
      return result;
    let chapters = new Map;
    let allHere = [];
    try {
      chapters = this.chaptersInWindow(this.store.livedDay());
      allHere = this.chaptersHereFor(scope, null, chapters);
    } catch {
      chapters = new Map;
      allHere = [];
    }
    let ladder = [];
    try {
      ladder = this.handoffs.pointerChoices(scope, undefined, (h, newest) => this.handoffSince(h, scope, newest, here, allHere), here?.session ?? null);
    } catch {
      ladder = [];
    }
    const lastHere = this.lastHereLadder(scope, here?.session ?? null, chapters, here?.exportsFrom);
    const exchange = here === undefined ? null : this.lastExchangeLine(here);
    const aboveLadder = withExchange(lastHere, exchange);
    const reader = here?.session ?? null;
    const named = lastHere.some((b) => b.startsWith("Last here:"));
    const lastHereId = !named ? null : allHere.find((c) => (reader === null || c.chapter.session !== reader) && (this.owner || c.chapter.confidential !== true))?.chapter.id ?? null;
    const newest = ladder[0];
    const budget = this.reportedBudget;
    const work = this.workHereLines(scope);
    if (newest === undefined && aboveLadder.length === 0)
      return this.withWorkHere(result, null, work, budget, scope);
    const fits = (block) => {
      const spliced = spliceBeforeSentinel(result.text, block);
      return spliced.applied && (budget === null || spliced.bytes <= budget) ? spliced : null;
    };
    if (!spliceBeforeSentinel(result.text, ladder[0]?.block ?? aboveLadder[0] ?? "").applied)
      return result;
    const best = ladder.find((rung) => fits(rung.block) !== null) ?? null;
    const tries = best !== null ? [...aboveLadder.map((above) => ({ rung: best, above })), { rung: best, above: null }] : aboveLadder.map((above) => ({ rung: null, above }));
    const last = ladder[ladder.length - 1];
    const smallest = last === undefined ? null : spliceBeforeSentinel(result.text, last.block);
    for (const { rung, above } of tries) {
      const block = [above, rung?.block ?? null].filter((b) => b !== null).join(`
`);
      const spliced = fits(block);
      if (spliced === null)
        continue;
      const total = spliced.bytes - result.bytes;
      const aboveBytes = above === null ? 0 : rung === null ? total : new TextEncoder().encode(above).length + 1;
      if (rung !== null) {
        const cost = total - aboveBytes;
        const lines = rung.block.split(`
`);
        const own = (i) => rung.shown.length === 1 ? cost : new TextEncoder().encode(lines[i + 1] ?? "").length + 1;
        const others = rung.shown.slice(1).reduce((n, _, i) => n + own(i + 1), 0);
        rung.shown.forEach((h, i) => {
          this.handoffs.noteShown(h, {
            bytes: i === 0 ? cost - others : own(i),
            session: here?.session ?? null,
            among: rung.live,
            ...i === 0 ? { plans: rung.plans.length } : {}
          });
        });
      } else if (newest !== undefined) {
        this.noteHandoffNoRoom(newest.handoff, smallest?.bytes ?? result.bytes, budget, result.bytes);
      }
      const saidShown = exchange !== null && above !== null && (above === exchange || above.endsWith(`
${exchange}`));
      const hereShown = above !== null && above !== exchange;
      if (hereShown) {
        const said = saidShown ? byteLength(exchange) + 1 : 0;
        this.emit("counterpart.lasthere.shown", undefined, { bytes: aboveBytes - said, lines: above.split(`
`).length - (saidShown ? 1 : 0) });
      } else if (lastHere.length > 0) {
        this.noteLastHereNoRoom(lastHereId, { budget, was: result.bytes, besideHandoff: true });
      }
      if (exchange !== null)
        this.emit(saidShown ? "counterpart.lastexchange.shown" : "counterpart.lastexchange.noroom", undefined, { bytes: byteLength(exchange) });
      const named = rung?.plans ?? [];
      const lines = work.lines.filter((l) => !named.some((id) => l.endsWith(`(${id})`)));
      return this.withWorkHere(result, block, { lines, found: work.found - (work.lines.length - lines.length) }, budget, scope);
    }
    if (newest !== undefined)
      this.noteHandoffNoRoom(newest.handoff, smallest?.bytes ?? result.bytes, budget, result.bytes);
    if (lastHere.length > 0)
      this.noteLastHereNoRoom(lastHereId, { budget, was: result.bytes, besideHandoff: false });
    if (exchange !== null)
      this.emit("counterpart.lastexchange.noroom", undefined, { bytes: byteLength(exchange) });
    return this.withWorkHere(result, null, work, budget, scope);
  }
  lastExchange(here) {
    const scope = here.scope?.trim() ?? "";
    if (scope.length === 0)
      return null;
    let sessions = [];
    try {
      sessions = here.sessions?.() ?? [];
    } catch {
      sessions = [];
    }
    return lastExchange({
      buffer: this.spans,
      scope,
      reader: here.session ?? null,
      now: this.nowFn(),
      sessions: sessions.map((s) => ({ session: s.session, scope: s.scope, lastAt: s.lastAt }))
    });
  }
  lastExchangeLine(here) {
    if (!this.owner)
      return null;
    try {
      const ex = this.lastExchange(here);
      return ex === null ? null : lastExchangeLine(ex, { zone: this.store.zone(), now: this.nowFn() });
    } catch {
      return null;
    }
  }
  workHereLines(scope) {
    const t = this.self.tunables;
    if (!t.CRAFT_AT_DELIVERY || scope.trim().length === 0)
      return { lines: [], found: 0 };
    try {
      const day = this.store.livedDay();
      const ranked = workHere(this.store, scope, {
        day,
        max: t.WORK_HERE_MAX,
        pool: t.WORK_HERE_POOL,
        excerpt: t.WORK_HERE_EXCERPT,
        skip: settledOver(this.store)
      });
      return { lines: rotateWork(ranked, t.WORK_HERE_MAX, day), found: ranked.length };
    } catch {
      return { lines: [], found: 0 };
    }
  }
  noteWorkOverflow(scope, opts) {
    const max = this.self.tunables.WORK_HERE_MAX;
    const cause = opts.shown < Math.min(opts.found, max) ? "room" : "cap";
    this.emit("counterpart.work.overflow", undefined, { cause, found: opts.found, shown: opts.shown });
    if (this.observer)
      return;
    try {
      const day = this.store.livedDay();
      this.store.appendEvent({
        name: WORK_OVERFLOW_EVENT,
        day,
        dedupKey: `${WORK_OVERFLOW_EVENT}:${cause}:${scope}:${String(day)}`,
        payload: { scope, cause, found: opts.found, shown: opts.shown, max, budget: opts.budget ?? 0, bytes: opts.was }
      });
    } catch {}
  }
  withWorkHere(result, block, work, budget, scope) {
    const { lines, found } = work;
    const spliced = (text) => {
      const s = spliceBeforeSentinel(result.text, text);
      if (!s.applied || budget !== null && s.bytes > budget)
        return null;
      return { ...result, text: s.text, bytes: s.bytes, sentinel: s.sentinel };
    };
    for (let k = lines.length;k > 0; k--) {
      const shown = workHereBlock(lines.slice(0, k));
      const out = spliced(block === null ? shown : `${shown}

${block}`);
      if (out === null)
        continue;
      this.emit("counterpart.work.shown", undefined, { lines: k, of: lines.length, bytes: out.bytes - result.bytes });
      if (found > k)
        this.noteWorkOverflow(scope, { found, shown: k, budget, was: result.bytes });
      return out;
    }
    if (lines.length > 0) {
      this.emit("counterpart.work.noroom", undefined, { lines: lines.length, budget, was: result.bytes });
      this.noteWorkOverflow(scope, { found, shown: 0, budget, was: result.bytes });
    }
    if (block === null)
      return result;
    const s = spliceBeforeSentinel(result.text, block);
    return s.applied ? { ...result, text: s.text, bytes: s.bytes, sentinel: s.sentinel } : result;
  }
  noteLastHereNoRoom(chapterId, opts) {
    this.emit("counterpart.lasthere.noroom", chapterId ?? undefined, { budget: opts.budget, was: opts.was, besideHandoff: opts.besideHandoff });
    if (this.observer || chapterId === null)
      return;
    try {
      const day = this.store.livedDay();
      this.store.appendEvent({
        name: LAST_HERE_NOROOM_EVENT,
        day,
        ref: chapterId,
        dedupKey: `${LAST_HERE_NOROOM_EVENT}:${chapterId}:${String(day)}`,
        payload: { budget: opts.budget ?? 0, bytes: opts.was, besideHandoff: opts.besideHandoff }
      });
    } catch {}
  }
  noteHandoffNoRoom(h, bytes, budget, was) {
    this.emit("counterpart.handoff.noroom", h.id, { bytes, budget, was });
    this.handoffs.noteNoRoom(h, { bytes, budget: budget ?? 0 });
  }
  lastHereLadder(scope, reader, chapters, exportsFrom) {
    try {
      const all = chapters ?? this.chaptersInWindow(this.store.livedDay());
      const found = this.chaptersHereFor(scope, reader, all);
      const zone = this.store.zone();
      const entries = found.map((f) => ({
        chapter: f.chapter,
        when: `${stampWords(localStamp(f.firstAt, zone))}–${stampWords(localStampAfter(f.lastAt, f.firstAt, zone))}`,
        date: stampWords(localStamp(f.chapter.writtenAt, zone).split(" ")[0] ?? "")
      }));
      const base = entries.length === 0 ? [] : lastHereLadder(entries, reader);
      const away = this.selfChapterElsewhere(all, new Set(found.map((f) => f.chapter.id)), reader, exportsFrom);
      if (away === null)
        return base;
      const line = elsewhereLine(away, stampWords(localStamp(away.writtenAt, zone).split(" ")[0] ?? ""), reader);
      return base.length === 0 ? [line] : [...base.map((b) => `${b}
${line}`), ...base];
    } catch {
      return [];
    }
  }
  selfChapterElsewhere(chapters, here, reader, exportsFrom) {
    if (exportsFrom === undefined)
      return null;
    let best = null;
    for (const c of chapters.values()) {
      if (here.has(c.id) || reader !== null && c.session === reader)
        continue;
      if (c.confidential === true || c.scope === null || c.aboutMe !== true)
        continue;
      if (best !== null && best.writtenAt >= c.writtenAt)
        continue;
      let open = false;
      try {
        open = exportsFrom(c.scope);
      } catch {
        open = false;
      }
      if (!open)
        continue;
      best = c;
    }
    return best;
  }
  chaptersHereFor(scope, reader, chapters) {
    const day = this.store.livedDay();
    const all = chapters ?? this.chaptersInWindow(day);
    if (all.size === 0)
      return [];
    const only = new Set(all.keys());
    const sessions = new Map(sessionsHere(this.spans, scope, { only }).map((s) => [s.session, s]));
    return chaptersHere(all, { scope, claimed: chapterClaims(this.spans, scope), sessions }, day, { reader });
  }
  yesterdayFor(at, reader) {
    if (at === undefined || !isDay(at))
      return {};
    try {
      const date = addDays(at, -1);
      const fromDay = Math.max(0, this.store.livedDay() - LAST_HERE_LIFE_DAYS + 1);
      const all = chaptersOn(this.store, date, { fromDay });
      const day = reader === undefined ? all : all.filter((c) => this.nameableHere(c.scope ?? null, c.aboutMe === true, reader.here));
      const hidden = all.length - day.length;
      const line = yesterdayLine(day, date, undefined, hidden);
      if (line === null)
        return {};
      const shorter = yesterdayShorter(day, date, hidden);
      return shorter.length === 0 ? { yesterday: line } : { yesterday: line, yesterdayShorter: shorter };
    } catch {
      return {};
    }
  }
  nameableHere(scope, aboutMe, here) {
    if (scope === null)
      return false;
    const norm = (s) => s.trim().replace(/\/+$/, "");
    const own = norm(here?.scope ?? "");
    if (own.length > 0 && norm(scope) === own)
      return true;
    const exportsFrom = here?.exportsFrom;
    if (!aboutMe || exportsFrom === undefined)
      return false;
    try {
      return exportsFrom(scope) === true;
    } catch {
      return false;
    }
  }
  chaptersInWindow(day) {
    if (this.delivering && this.deliveryWalk?.day === day)
      return this.deliveryWalk.chapters;
    const all = chaptersBySession(this.store, { fromDay: Math.max(0, day - LAST_HERE_LIFE_DAYS + 1) });
    const out = this.owner ? all : new Map([...all].filter(([, c]) => c.confidential !== true));
    if (this.delivering)
      this.deliveryWalk = { day, chapters: out };
    return out;
  }
  handoffSince(h, scope, newest = true, here, allHere) {
    const writtenAt = this.handoffs.writtenAt(h);
    if (writtenAt === null)
      return null;
    const zone = this.store.zone();
    const stale = this.handoffStale(h, scope, writtenAt, here, allHere);
    if (!newest)
      return { written: localStamp(writtenAt, zone), after: null, stale };
    const work = workSince(this.spans, scope, writtenAt, { writer: h.session });
    if (!work.overFloor || work.firstAt === null || work.lastAt === null) {
      return { written: localStamp(writtenAt, zone), after: null, stale };
    }
    return {
      written: localStamp(writtenAt, zone),
      stale,
      after: {
        from: localStampAfter(work.firstAt, writtenAt, zone),
        to: localStampAfter(work.lastAt, work.firstAt, zone),
        writtenUp: work.unwritten === 0,
        upTo: work.writtenUpTo === null ? null : localStampAfter(work.writtenUpTo, work.firstAt, zone),
        by: work.writtenUpBy,
        unwritten: work.unwritten,
        unwrittenAfter: work.unwrittenAfter
      }
    };
  }
  handoffStale(h, scope, writtenAt, here, allHere) {
    try {
      let writtenWith = h.build ?? null;
      if (writtenWith === null && h.session !== null && here?.openedWith !== undefined) {
        try {
          writtenWith = here.openedWith(h.session);
        } catch {
          writtenWith = null;
        }
      }
      let newerChapter = false;
      try {
        newerChapter = (allHere ?? this.chaptersHereFor(scope, null)).some((c) => c.chapter.session !== h.session && c.chapter.writtenAt > writtenAt);
      } catch {
        newerChapter = false;
      }
      return staleWords({ writtenWith, installed: here?.installed ?? null, newerChapter });
    } catch {
      return null;
    }
  }
  writeHandoff(body, ctx) {
    return this.handoffBehind(this.handoffs.write({
      body,
      scope: ctx.scope,
      ...ctx.session === undefined ? {} : { session: ctx.session },
      ...ctx.model === undefined ? {} : { model: ctx.model },
      ...ctx.build === undefined ? {} : { build: ctx.build },
      ...ctx.day === undefined ? {} : { day: ctx.day }
    }));
  }
  handoffBehind(out) {
    if (out.written)
      markWakeBehind(this.store, "handoff");
    return out;
  }
  retireHandoff(id, ctx) {
    return this.handoffBehind(this.handoffs.retire(id, {
      scope: ctx.scope,
      ...ctx.session === undefined ? {} : { session: ctx.session },
      ...ctx.day === undefined ? {} : { day: ctx.day }
    }));
  }
  clearHandoff(ctx) {
    return this.handoffBehind(this.handoffs.clear(ctx.scope, {
      ...ctx.session === undefined ? {} : { session: ctx.session },
      ...ctx.day === undefined ? {} : { day: ctx.day }
    }));
  }
  refuseHandoff(reason, ctx = {}) {
    return this.handoffs.refuseWrite(reason, ctx);
  }
  readHandoff(scope) {
    return this.handoffs.read(scope);
  }
  readHandoffs(scope) {
    return this.handoffs.readAll(scope);
  }
  wakeReserveBytes(budgetBytes, work = this.workReserveBytes(budgetBytes), handoff = this.handoffRoom(budgetBytes).reserve) {
    return PREFACE_RESERVE_BYTES + handoff + work;
  }
  handoffRoom(budgetBytes) {
    const norm = (s) => s.trim().replace(/\/+$/, "");
    const blocks = [];
    let byScope = new Map;
    try {
      byScope = this.handoffs.liveBlockBytesByScope();
    } catch {
      byScope = new Map;
    }
    const handoffBytes = new Map;
    for (const [scope, rungs] of byScope) {
      handoffBytes.set(norm(scope), [...handoffBytes.get(norm(scope)) ?? [], ...rungs]);
      blocks.push(...rungs);
    }
    try {
      const chapters = this.chaptersInWindow(this.store.livedDay());
      if (chapters.size > 0) {
        for (const scope of this.spans.scopes()) {
          const lines = this.lastHereLadder(scope, null, chapters, () => true).map((b) => byteLength(b));
          for (const l of lines) {
            blocks.push(l);
            for (const h of handoffBytes.get(norm(scope)) ?? [])
              blocks.push(l + 1 + h);
          }
        }
      }
    } catch {}
    const reserve = reserveBytes(blocks, budgetBytes);
    let kept = 0;
    for (const rungs of handoffBytes.values()) {
      const smallest = Math.min(...rungs.filter((b) => b > 0));
      if (Number.isFinite(smallest))
        kept = Math.max(kept, smallest + HANDOFF_RESERVE_MARGIN_BYTES);
    }
    const lend = Math.max(0, reserve - kept);
    return { reserve, lend, keep: reserve - lend };
  }
  workReserveBytes(budgetBytes) {
    const said = this.exchangeWithin() ? LAST_EXCHANGE_LINE_MAX_BYTES + 1 : 0;
    const blocks = said > 0 ? [said] : [];
    if (!this.self.tunables.CRAFT_AT_DELIVERY)
      return reserveBytes(blocks, budgetBytes);
    try {
      for (const scope of this.spans.scopes()) {
        const { lines } = this.workHereLines(scope);
        if (lines.length === 0)
          continue;
        blocks.push(workHereBytes(lines));
        if (said > 0)
          blocks.push(workHereBytes(lines) + said);
      }
      return reserveBytes(blocks, budgetBytes);
    } catch {
      return reserveBytes(said > 0 ? [said] : [], budgetBytes);
    }
  }
  exchangeWithin() {
    try {
      const now = this.nowFn();
      const norm = (s) => s.trim().replace(/\/+$/, "");
      const own = norm(this.store.dir);
      return this.spans.scopes().some((scope) => norm(scope) !== own && exchangeLikely(this.spans, scope, now));
    } catch {
      return false;
    }
  }
  noteWakeDelivered(sentinelSeen, expected) {
    return this.self.noteDelivered(sentinelSeen, expected);
  }
  captureSpans(input) {
    const out = this.spans.capture(input);
    if (out.reason === "IO_FAILED")
      this.noteCaptureFailed(input.session);
    return out;
  }
  noteCaptureFailed(session) {
    if (this.observer)
      return;
    const failed = this.spans.events().reverse().find((e) => e.name === "remember.write.failed" || e.name === "remember.capture.failed");
    const site = failed?.data?.["site"];
    const code = failed?.data?.["code"];
    try {
      this.store.appendEvent({
        name: CAPTURE_FAILED_EVENT,
        day: this.store.livedDay(),
        payload: {
          session,
          site: typeof site === "string" ? site : "capture",
          code: typeof code === "string" ? code : "UNKNOWN",
          date: this.store.today()
        }
      });
    } catch (err) {
      this.emit("counterpart.capture.record.failed", undefined, { code: errCode(err) });
    }
  }
  captureJot(input) {
    return this.spans.jot(input);
  }
  recallForTurn(turn, opts = {}) {
    const arrived = opts.at === undefined || turn.temporal !== undefined ? null : opts.noCues === true ? [] : this.prospective.arrivals({
      at: opts.at,
      ...turn.day === undefined ? {} : { day: turn.day },
      sessionId: turn.sessionId
    }).arrivals.filter((a) => opts.withhold?.has(a.memoryId) !== true);
    const withCues = arrived === null ? turn : { ...turn, temporal: arrived.map((a) => ({ id: a.memoryId, weight: a.cueWeight })) };
    const result = recallTurn(this.recall, this.withSemantic(withCues), {
      schemas: this.schemas,
      prospective: this.prospective,
      associate: this.associate,
      ...opts.at === undefined ? {} : { at: opts.at }
    });
    this.recordDecision(result.decision, opts.at ?? null);
    if (arrived !== null && opts.at !== undefined)
      this.spendArrivals(arrived, result.decision, opts.at);
    return result;
  }
  spendArrivals(arrived, decision, at) {
    if (decision.aborted || arrived.length === 0)
      return;
    const shown = new Set([...decision.surfaced, ...decision.footnotes]);
    for (const a of arrived) {
      if (!shown.has(a.memoryId))
        continue;
      try {
        const first = this.prospective.occurrenceUndelivered(a.memoryId, a.windowKey);
        const fired = this.prospective.fire({
          memoryId: a.memoryId,
          windowKey: a.windowKey,
          at,
          day: decision.day,
          sessionId: decision.sessionId
        });
        if (fired.fired && first)
          this.creditOccurrence(a.memoryId, a.windowKey, decision.day, "quiet");
      } catch (err) {
        this.emit("counterpart.prospective.fire.failed", a.memoryId, { code: errCode(err) });
      }
    }
  }
  creditOccurrence(memoryId, windowKey, day, via) {
    try {
      const out = this.store.reinforce(memoryId, day, "surfaced");
      this.emit("counterpart.prospective.occurrence.credited", memoryId, {
        window: windowKey,
        via,
        credited: out.credited,
        reason: out.reason,
        day
      });
    } catch (err) {
      this.emit("counterpart.prospective.occurrence.failed", memoryId, { window: windowKey, code: errCode(err) });
    }
  }
  plainDueToday(input) {
    if (this.observer)
      return [];
    const out = [];
    try {
      for (const due of this.prospective.plainDue({ at: input.at })) {
        let what = "";
        try {
          const read = this.store.read(due.memoryId);
          if (read.confidential && !this.owner)
            continue;
          const doc = read.doc;
          const title = doc.title?.trim() ?? "";
          const line = doc.body.split(`
`).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
          what = (title.length > 0 ? title : line).replace(/\s+/g, " ").trim();
        } catch {
          continue;
        }
        if (what.length === 0)
          continue;
        out.push({ ...due, what });
      }
    } catch (err) {
      this.emit("counterpart.prospective.plain.failed", undefined, { code: errCode(err) });
    }
    return out;
  }
  claimPlainReminder(reminder, input) {
    if (this.observer)
      return false;
    try {
      const day = input.day ?? this.store.livedDay();
      const first = this.prospective.occurrenceUndelivered(reminder.memoryId, reminder.windowKey);
      const claimed = this.prospective.claimPlain(reminder, {
        at: input.at,
        day,
        ...input.session === undefined ? {} : { session: input.session }
      });
      if (claimed && first)
        this.creditOccurrence(reminder.memoryId, reminder.windowKey, day, "plain");
      if (claimed && reminder.beat !== "opens")
        markWakeBehind(this.store, "told");
      return claimed;
    } catch (err) {
      this.emit("counterpart.prospective.plain.failed", reminder.memoryId, { code: errCode(err) });
      return false;
    }
  }
  plainReminders(input) {
    return this.plainDueToday({ at: input.at }).filter((r) => this.claimPlainReminder(r, input));
  }
  withSemantic(turn) {
    if (turn.vector !== undefined || turn.semanticHits !== undefined)
      return turn;
    const lag = loadSessionSemantic(this.store, turn.sessionId);
    return {
      ...turn,
      ...lag.hits === null ? {} : { semanticHits: lag.hits },
      semanticSource: lag.source,
      ...lag.fromTurn === null ? {} : { semanticFromTurn: lag.fromTurn }
    };
  }
  noteSessionSemantic(input) {
    const vec = input.vector ?? null;
    const reason = input.reason === "ok" && (vec === null || vec.length === 0) ? "embed-failed" : input.reason;
    const hits = reason === "ok" && vec !== null ? this.store.nearestTo(vec, this.recall.tunables.SEMANTIC_TOP_M, { minStrength: PHYSICS.REACH }) : [];
    if (this.observer) {
      this.emit(SEMANTIC_LAG_EVENT, input.sessionId, { reason, hits: hits.length, stored: false });
      return { stored: false, hits: hits.length, reason, turn: null };
    }
    const served = loadGateState(this.store, input.sessionId).state.turn;
    try {
      saveSessionSemantic(this.store, {
        sessionId: input.sessionId,
        turn: served,
        lastDay: this.store.livedDay(),
        reason,
        model: input.model ?? null,
        dim: vec?.length ?? 0,
        hits
      });
    } catch {
      this.emit(SEMANTIC_LAG_EVENT, input.sessionId, { reason, hits: hits.length, stored: false });
      return { stored: false, hits: hits.length, reason, turn: served };
    }
    this.emit(SEMANTIC_LAG_EVENT, input.sessionId, { reason, hits: hits.length, stored: true });
    return { stored: true, hits: hits.length, reason, turn: served };
  }
  recordDecision(d, date) {
    if (d.aborted)
      return;
    let durable = !this.observer;
    if (durable) {
      try {
        this.store.appendEvent({
          name: RECALL_DECISION_EVENT,
          day: d.day,
          ref: d.sessionId,
          payload: recallDecisionRecord(d, { date })
        });
      } catch (err) {
        durable = false;
        this.emit("counterpart.recall.decision.failed", d.sessionId, { code: errCode(err) });
      }
    }
    this.emit("counterpart.recall.decision", d.sessionId, {
      turn: d.turn,
      reason: d.reason,
      surfaced: d.surfaced.length,
      footnotes: d.footnotes.length,
      bytes: d.bytes,
      durable,
      standdown: durable ? null : "observer"
    });
  }
  resolveUse(sessionId, memoryId, tier, opts = {}) {
    return this.recall.resolveUse(sessionId, memoryId, tier, opts);
  }
  noteAsked(sessionId, ids) {
    if (ids.length === 0)
      return;
    const day = this.store.livedDay();
    const at = askedTurn(this.store.now());
    this.store.setGateRecords([...new Set(ids)].map((id) => ({ sessionId, kind: ASKED_KIND, ref: id, turn: at, lastDay: day, tier: "asked", trains: true })));
  }
  creditReferences(sessionId, input) {
    const day = this.store.livedDay();
    const now = input.now ?? Date.now;
    const state = this.recall.gateState(sessionId);
    const candidates = [];
    let unreadable = 0;
    let budgetExceeded = false;
    for (const [id, rec] of Object.entries(state.surfaced)) {
      if (rec.tier !== "surfaced" || !rec.trains)
        continue;
      if (input.deadline !== undefined && now() > input.deadline) {
        budgetExceeded = true;
        candidates.push({ id, tier: "surfaced", body: "" });
        continue;
      }
      try {
        candidates.push({ id, tier: "surfaced", body: this.store.readProse(id).body });
      } catch {
        unreadable += 1;
      }
    }
    const have = new Set(candidates.map((c) => c.id));
    let asked = [];
    try {
      asked = this.store.gateRecords(sessionId, ASKED_KIND).sort((a, b) => b.turn - a.turn).slice(0, ASKED_MAX);
    } catch {
      asked = [];
    }
    for (const rec of asked) {
      if (have.has(rec.ref))
        continue;
      have.add(rec.ref);
      if (input.deadline !== undefined && now() > input.deadline) {
        budgetExceeded = true;
        candidates.push({ id: rec.ref, tier: "surfaced", body: "" });
        continue;
      }
      try {
        candidates.push({ id: rec.ref, tier: "surfaced", body: this.store.readProse(rec.ref).body });
      } catch {
        unreadable += 1;
      }
    }
    const refs = resolveReferences({
      assistantTurns: input.assistantTurns,
      expansions: input.expansions,
      candidates,
      ...input.deadline === undefined ? {} : { deadline: input.deadline },
      ...input.now === undefined ? {} : { now: input.now }
    });
    const replied = input.assistantTurns.length > 0 || input.expansions.length > 0;
    const showings = this.scoreShowings(sessionId, state, refs.uses, day, replied);
    const refused = {};
    const refuse = (why) => {
      refused[why] = (refused[why] ?? 0) + 1;
    };
    const uses = refs.uses.filter((u) => {
      const row = this.store.row(u.memoryId);
      if (row === undefined) {
        refuse("unknown-id");
        return false;
      }
      if (row.archived === 1) {
        refuse("archived");
        return false;
      }
      if (isHandoffRow(this.store, u.memoryId)) {
        refuse("handoff");
        return false;
      }
      return true;
    });
    const ids = [];
    const how = [];
    const coactivated = [];
    let credited = 0;
    let linkedDespite = 0;
    for (const u of uses) {
      try {
        const r = this.resolveUse(sessionId, u.memoryId, "referenced", u.how === "quoted" ? { cued: true } : {});
        if (r.credited || linksDespite(r))
          coactivated.push({ id: u.memoryId, tier: "referenced" });
        if (!r.credited && linksDespite(r))
          linkedDespite += 1;
        if (r.credited) {
          credited += 1;
          ids.push(u.memoryId);
          how.push(u.how);
          continue;
        }
        refuse(r.outcome?.reason ?? r.reason);
      } catch (err) {
        refuse(errCode(err));
      }
    }
    if (coactivated.length > 0)
      this.publishCoactivation(coactivated, day);
    const reason = refs.budgetExceeded || budgetExceeded ? "budget-exceeded" : credited > 0 ? "credited" : candidates.length === 0 && refs.uses.length === 0 ? "no-candidates" : "nothing-to-credit";
    const expandedIds = refs.uses.filter((u) => u.how === "expanded").map((u) => u.memoryId);
    const pointersExpanded = expandedIds.filter((id) => state.surfaced[id]?.via === "link").length;
    const summary = {
      reason,
      day,
      expandedIds,
      pointersExpanded,
      considered: refs.considered,
      expanded: refs.expanded,
      quoted: refs.quoted,
      credited,
      unresolvedHandles: refs.unresolvedHandles,
      skippedForBudget: refs.skippedForBudget,
      unreadable,
      refused,
      ids,
      how,
      linkedDespite,
      shown: showings.shown,
      unused: showings.unused,
      shownNotUsed: showings.shownNotUsed,
      judgedThrough: showings.judgedThrough
    };
    this.emit("counterpart.credit", sessionId, {
      reason,
      day,
      considered: summary.considered,
      expanded: summary.expanded,
      quoted: summary.quoted,
      credited,
      linkedDespite,
      pointersExpanded,
      shown: showings.shown.loud + showings.shown.footnotes + showings.shown.pointers,
      shownNotUsed: showings.shownNotUsed.length
    });
    return summary;
  }
  creditDrewOn(sessionId, named, opts = {}) {
    const day = this.store.livedDay();
    const ids = [...new Set(named.map((id) => id.trim()).filter((id) => id.length > 0))];
    const credited = [];
    const refused = [];
    const capped = [];
    const actedOn = [];
    let linked = 0;
    const done = () => ({ day, named: ids.length, credited, refused, capped, actedOn, linked });
    if (this.observer) {
      for (const id of ids)
        refused.push({ id, reason: "observer" });
      return done();
    }
    const state = this.recall.gateState(sessionId);
    const shown = new Set(Object.keys(state.surfaced));
    try {
      for (const rec of this.store.gateRecords(sessionId, ASKED_KIND))
        shown.add(rec.ref);
    } catch {}
    const members = [];
    let slots = DREW_ON_MAX_PER_BOUNDARY - Object.values(state.credited).filter((c) => c.tier === "engaged" && c.day === day && c.turn === state.turn).length;
    for (const id of ids) {
      const refuse = (reason) => {
        refused.push({ id, reason });
      };
      if (!shown.has(id)) {
        refuse("not-shown");
        continue;
      }
      const row = this.store.row(id);
      if (row === undefined) {
        refuse("unknown-id");
        continue;
      }
      if (row.archived === 1) {
        refuse("archived");
        continue;
      }
      if (isHandoffRow(this.store, id)) {
        refuse("handoff");
        continue;
      }
      if (row.superseded_by !== null) {
        refuse("superseded");
        continue;
      }
      if (fadeOf({ fade: row.fade }) < 1) {
        refuse("faded-under-newer");
        continue;
      }
      if (opts.at !== undefined && row.event_date !== null) {
        try {
          if (this.prospective.actedOn(id, opts.at, day).length > 0)
            actedOn.push(id);
        } catch (err) {
          this.emit("counterpart.drewOn.actedOn.failed", id, { code: errCode(err) });
        }
      }
      if (slots <= 0) {
        capped.push(id);
        continue;
      }
      try {
        const r = this.resolveUse(sessionId, id, "engaged");
        if ((r.credited || linksDespite(r)) && members.length < DREW_ON_MAX_PER_BOUNDARY)
          members.push({ id, tier: "referenced" });
        if (r.credited) {
          credited.push(id);
          slots -= 1;
          continue;
        }
        refuse(r.outcome?.reason ?? r.reason);
      } catch (err) {
        refuse(errCode(err));
      }
    }
    if (members.length > 1)
      linked = this.publishCoactivation(members, day);
    this.emit("counterpart.drewOn", sessionId, {
      day,
      named: ids.length,
      credited: credited.length,
      refused: refused.length,
      capped: capped.length,
      actedOn: actedOn.length,
      linked
    });
    return done();
  }
  scoreShowings(sessionId, state, uses, day, replied) {
    let from = 0;
    try {
      from = judgedThrough(this.store, sessionId);
    } catch {
      from = 0;
    }
    const used = new Set(uses.map((u) => u.memoryId));
    const shown = { loud: 0, footnotes: 0, pointers: 0 };
    const unused = { loud: 0, footnotes: 0, pointers: 0 };
    const shownNotUsed = [];
    if (!replied)
      return { shown, unused, shownNotUsed: [], judgedThrough: from };
    for (const [id, rec] of Object.entries(state.surfaced)) {
      if (rec.turn <= from)
        continue;
      const lane = rec.tier === "surfaced" ? "loud" : rec.via === "link" ? "pointers" : "footnotes";
      shown[lane] += 1;
      if (used.has(id))
        continue;
      unused[lane] += 1;
      shownNotUsed.push({ id, turn: rec.turn });
    }
    shownNotUsed.sort((a, b) => a.turn - b.turn || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const through = Math.max(from, state.turn);
    if (through > from && !this.observer) {
      try {
        markJudged(this.store, sessionId, through, day);
      } catch (err) {
        this.emit("counterpart.credit.judged.failed", sessionId, { code: errCode(err) });
      }
    }
    return { shown, unused, shownNotUsed: shownNotUsed.map((s) => s.id), judgedThrough: through };
  }
  publishCoactivation(members, day) {
    const started = this.store.now();
    let co = null;
    let deltas = [];
    let thrown = null;
    try {
      co = this.associate.coactivate(members);
      deltas = this.associate.drain();
    } catch (err) {
      thrown = errCode(err);
    }
    if (this.observer) {
      this.emit("counterpart.associate.standdown", undefined, { site: "pending" });
      return 0;
    }
    const eligible = co?.members.filter((m) => m.reason === "eligible").length ?? 0;
    const append = deltas.length === 0 ? { ok: thrown === null, lines: 0, pairs: 0, droppedPairs: 0, code: thrown } : appendPendingDeltas(this.store.dir, deltas, { day, at: started });
    this.emit("counterpart.associate.pending", undefined, {
      day,
      members: co?.members.length ?? members.length,
      eligible,
      pairs: deltas.length,
      written: append.pairs,
      dropped: append.droppedPairs + (append.ok ? 0 : deltas.length - append.pairs),
      code: append.code,
      elapsedMs: this.store.now() - started
    });
    return append.pairs;
  }
  applyPendingAssociations(opts = {}) {
    const idle = {
      reason: "nothing-pending",
      claims: 0,
      passes: 0,
      pairs: 0,
      rows: 0,
      blocked: 0,
      evicted: 0,
      swept: 0,
      dropped: 0,
      pendingDropped: 0,
      corrupt: 0,
      stuck: 0,
      oldestMs: 0
    };
    if (this.observer) {
      this.emit("counterpart.associate.standdown", undefined, { site: "apply" });
      return { ...idle, reason: "observer" };
    }
    const now = opts.now ?? this.store.now();
    let claims = [];
    try {
      claims = claimPending(this.store.dir, {
        now,
        ...opts.staleMs === undefined ? {} : { staleMs: opts.staleMs }
      });
    } catch (err) {
      this.emit("counterpart.associate.claim.failed", undefined, { code: errCode(err) });
      return { ...idle, reason: "failed" };
    }
    if (claims.length === 0)
      return idle;
    const out = {
      ...idle,
      reason: "flushed",
      claims: claims.length,
      oldestMs: Math.max(0, ...claims.map((c) => c.oldestAt === null ? 0 : now - c.oldestAt))
    };
    let failure = null;
    const linked = [];
    for (const claim of claims) {
      out.passes += claim.passes;
      out.pairs += claim.deltas.length;
      out.pendingDropped += claim.droppedPairs;
      out.corrupt += claim.corrupt;
      let report = null;
      let threw = null;
      try {
        this.associate.absorb(claim.deltas);
        report = this.associate.flush(claim.day ?? this.store.livedDay());
      } catch (err) {
        threw = errCode(err);
      }
      if (report !== null) {
        out.rows += report.rows;
        out.blocked += report.blocked;
        out.evicted += report.evictions.length;
        out.swept += report.swept;
        out.dropped += report.dropped;
        linked.push(...report.linkedIds ?? []);
      }
      const applied = threw === null && report !== null && report.reason !== "failed" && report.reason !== "busy";
      if (!applied) {
        failure = threw ?? report?.code ?? "UNKNOWN";
        out.dropped += threw === null ? 0 : claim.deltas.length;
        continue;
      }
      const released = releasePending(claim);
      if (released.stuck) {
        out.stuck += 1;
        this.emit("counterpart.associate.claim.stuck", undefined, { code: released.code });
      }
    }
    if (failure !== null)
      out.reason = "failed";
    else if (out.pairs === 0)
      out.reason = "nothing-buffered";
    let rowDay = null;
    try {
      rowDay = this.store.livedDay();
    } catch {
      rowDay = null;
    }
    const data = {
      reason: out.reason,
      day: rowDay ?? Math.max(0, ...claims.map((c) => c.day ?? 0)),
      dayFrom: rowDay === null ? "claim" : "clock",
      claims: out.claims,
      passes: out.passes,
      pairs: out.pairs,
      rows: out.rows,
      blocked: out.blocked,
      evicted: out.evicted,
      swept: out.swept,
      dropped: out.dropped,
      pendingDropped: out.pendingDropped,
      corrupt: out.corrupt,
      stuck: out.stuck,
      oldestMs: out.oldestMs,
      deposited: Math.max(0, out.pairs - out.blocked - out.dropped),
      ...rowIds(linked),
      ...isKnownSession(opts.session) ? { session: opts.session } : {}
    };
    if (failure !== null)
      data["error"] = failure;
    this.emit("counterpart.associate.applied", undefined, {
      reason: out.reason,
      claims: out.claims,
      pairs: out.pairs,
      rows: out.rows,
      dropped: out.dropped,
      oldestMs: out.oldestMs
    });
    try {
      this.store.appendEvent({
        name: ASSOCIATE_FLUSH_EVENT,
        day: Number(data["day"]),
        payload: data
      });
    } catch (err) {
      this.emit("counterpart.associate.flush.unrecorded", undefined, { code: errCode(err) });
    }
    return out;
  }
  resolveUses(sessionId, uses) {
    const results = [];
    const credited = [];
    for (const use of uses) {
      const result = this.resolveUse(sessionId, use.memoryId, use.tier);
      results.push(result);
      if (result.credited || linksDespite(result))
        credited.push({ id: use.memoryId, tier: use.tier });
    }
    this.associate.coactivate(credited);
    return results;
  }
  async submitSessionEnd(draft, ctx) {
    return this.deposit(draft, "session-end", ctx);
  }
  addFeelings(memoryId, inputs, opts = {}) {
    const clean = inputs.map((f) => ({
      ...f,
      ...typeof f.emotion === "string" ? { emotion: redactSecrets(f.emotion) } : {},
      ...typeof f.carriedBy === "string" ? { carriedBy: redactSecrets(f.carriedBy) } : {},
      ...typeof f.otherWord === "string" ? { otherWord: redactSecrets(f.otherWord) } : {}
    }));
    return this.store.addFeelings(memoryId, clean, opts);
  }
  addTraits(memoryId, inputs, opts = {}) {
    const clean = inputs.map((t) => ({
      ...t,
      ...typeof t.carriedBy === "string" ? { carriedBy: redactSecrets(t.carriedBy) } : {}
    }));
    return this.store.addTraits(memoryId, clean, opts);
  }
  settleContradiction(input) {
    return settleContradiction(this.store, {
      ...input,
      ...typeof input.why === "string" ? { why: redactSecrets(input.why) } : {}
    }, { retarget: this.retargetLinks });
  }
  undoContradiction(input) {
    return undoContradiction(this.store, {
      ...input,
      ...typeof input.why === "string" ? { why: redactSecrets(input.why) } : {}
    }, { retarget: this.retargetLinks });
  }
  retargetLinks = (oldId, newId, day) => {
    this.associate.retargetOnSupersede(oldId, newId, day);
  };
  writeNeighbours(id, opts) {
    try {
      return writeNeighbours(this.store, {
        id,
        owner: opts.owner,
        ...opts.exclude === undefined ? {} : { exclude: opts.exclude },
        ...opts.session === undefined ? {} : { session: opts.session }
      });
    } catch {
      return [];
    }
  }
  async submitJot(draft, ctx) {
    return this.deposit(draft, "jot", {
      session: ctx.session,
      scope: ctx.scope,
      ...ctx.ownSpanHash === undefined ? {} : { ownSpanHash: ctx.ownSpanHash },
      ...ctx.model === undefined ? {} : { model: ctx.model },
      ...ctx.owner === undefined ? {} : { owner: ctx.owner },
      ...ctx.facts === undefined ? {} : { facts: ctx.facts },
      ...ctx.about === undefined ? {} : { about: ctx.about }
    });
  }
  episodeAsk(sessionId, substance, day, opts = {}) {
    const { scope, ...pace } = opts;
    let stretch = null;
    if (scope !== undefined && scope.length > 0 && sessionId.length > 0) {
      try {
        stretch = sessionStretch(this.spans, sessionId, [scope]);
      } catch {
        stretch = null;
      }
    }
    const now = this.nowFn();
    return this.self.openChapter(sessionId, substance, day, {
      ...pace,
      ...stretch === null ? {} : {
        unwritten: {
          pieces: stretch.pieces,
          minutes: stretch.minutes,
          due: (lastAskAt) => askFromStretch(stretch, lastAskAt, now)
        }
      }
    });
  }
  appendEpisode(sessionId, text, opts = {}) {
    const verdict = episodeGate()({ text, handles: [], sessionId });
    if (!verdict.ok) {
      this.emit("counterpart.episode.chapter.refused", sessionId, {
        gate: verdict.gate,
        reason: verdict.reason
      });
      return {
        appended: false,
        reason: "gate-refused",
        gate: { gate: verdict.gate, reason: verdict.reason },
        episodeId: null,
        chapter: 0,
        created: false
      };
    }
    const body = verdict.text !== undefined && verdict.text.length > 0 ? verdict.text : text;
    const { scope } = opts;
    const written = this.self.appendChapter(sessionId, body, opts);
    if (written.reason === "appended" && written.episodeId !== null && !this.observer && scope !== undefined && scope.length > 0) {
      claimUnwritten(this.spans, {
        session: sessionId,
        scope,
        by: CLAIM_CHAPTER,
        ref: `${written.episodeId}#${String(written.chapter)}`
      });
    }
    if (written.reason === "appended" && !this.observer)
      markWakeBehind(this.store, "write-up");
    return {
      appended: written.reason === "appended",
      reason: written.reason,
      gate: null,
      episodeId: written.episodeId,
      chapter: written.chapter,
      created: written.created
    };
  }
  ingestEpisode(input) {
    return this.self.ingestEpisode(input);
  }
  leftAs(reason, superseded = false) {
    return leftAs(reason, superseded);
  }
  ownerDisplayName() {
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
  coreList() {
    const core = [];
    for (const id of this.store.list({ archived: false })) {
      const row = this.store.row(id);
      if (row === undefined || row.promoted_identity !== 1)
        continue;
      const promoted = this.store.coreEvents({ memoryId: id, action: "promoted", limit: 1 })[0];
      let body = null;
      try {
        const doc = this.store.readProse(id);
        body = row.confidential === 1 && !this.owner ? null : (doc.title ?? doc.body).split(`
`)[0] ?? "";
      } catch {
        body = null;
      }
      core.push({
        id,
        kind: row.kind,
        lane: promoted?.lane ?? null,
        day: promoted?.day ?? null,
        body,
        confidential: row.confidential === 1
      });
    }
    const nominated = this.store.coreEvents({ action: "nominated" }).map((e) => ({ id: e.memory_id, day: e.day, reason: e.reason, dream: e.dream_id }));
    const demoted = this.store.coreEvents({ action: "demoted" }).map((e) => ({ id: e.memory_id, day: e.day, reason: e.reason }));
    const reconsidering = this.store.coreReconsidering().map((r) => ({ id: r.id, day: r.day, reason: r.reason }));
    return { core, nominated, demoted, reconsidering };
  }
  demoteCore(id, opts) {
    const out = retireCore(this.store, { id, reason: opts.reason, actor: opts.actor ?? "owner" });
    if (out.ok)
      this.emit("counterpart.core.demoted", id, { day: this.store.livedDay() });
    return out;
  }
  keepCore(id, opts) {
    const out = keepCore(this.store, { id, why: opts.why, actor: opts.actor ?? "owner" });
    if (out.ok)
      this.emit("counterpart.core.kept", id, { day: this.store.livedDay() });
    return out;
  }
  markAbout(input) {
    if (this.observer)
      return { ok: false, reason: "observer", detail: "This is an observer; it reads and changes nothing." };
    const mark = input.mark.trim();
    if (!ABOUT_MARKS.includes(mark)) {
      return { ok: false, reason: "about-is-me-us-owner-work-or-world", detail: `"${mark}" is not a mark: use one of ${ABOUT_MARKS.join(", ")}.` };
    }
    const asked = input.id.trim();
    const missing = { ok: false, reason: "unknown-id", detail: `No memory ${asked} in this store.` };
    let id;
    try {
      id = this.store.resolve(asked);
    } catch {
      return missing;
    }
    const row = this.store.row(id);
    if (row === undefined || rowTombstoned(row))
      return missing;
    if (row.type !== "memory")
      return { ok: false, reason: "not-a-memory", detail: `${asked} is a ${row.type}, not a memory; only a memory is marked.` };
    const core = CORE_ABOUT_MARKS.includes(mark);
    if (input.by === "self") {
      if (row.confidential === 1 && input.owner !== true)
        return missing;
      if (core && (row.source === "dreamed" || row.source === "reflection")) {
        return {
          ok: false,
          reason: row.source === "dreamed" ? "dreamed-is-a-suggestion" : "reflection-does-not-mark-itself",
          detail: `${id} was written by a ${row.source === "dreamed" ? "dream" : "reflection"}; only work or world may be set on it (the owner can mark it anything).`
        };
      }
      if (core && input.night === true && !acceptsReflectedFeeling(this.store)) {
        return {
          ok: false,
          reason: "door-closed-work-or-world-only",
          detail: "The owner has closed the core to the night's own judgment: from a night run, a mark may only move toward work or world."
        };
      }
    }
    const notes = [];
    const why = redactSecrets((input.why ?? "").trim());
    if (input.by === "self" && why.length === 0)
      notes.push("No why was given; the mark records that. Say why next time.");
    if (row.kind === "skill" && core)
      notes.push("A skill memory is the craft and never becomes core, whatever its mark.");
    if (row.archived === 1)
      notes.push("It is archived: the mark is kept, and counts if it comes back.");
    const set = this.store.setAbout(id, mark, {
      by: input.by,
      why: why.length > 0 ? why : input.by === "self" ? "no why given" : null
    });
    return {
      ok: true,
      id,
      ...id !== asked ? { forwardedFrom: asked } : {},
      mark,
      before: set.before,
      changed: set.changed,
      archived: row.archived === 1,
      why: why.length > 0 ? why : null,
      ...notes.length > 0 ? { note: notes.join(" ") } : {}
    };
  }
  selfPage() {
    return this.self.page();
  }
  selfPageVersions(opts = {}) {
    return this.self.pageVersions(opts);
  }
  selfPageVersionCount() {
    return this.self.pageVersionCount();
  }
  restorePage(seq, opts = {}) {
    return this.self.restorePage(seq, opts);
  }
  clearPage(opts) {
    return this.self.clearPage(opts);
  }
  revisePage(body, opts) {
    return this.self.revisePage(body, opts);
  }
  addPageShort(short, opts) {
    return this.self.addPageShort(short, opts);
  }
  pageWriterDue(opts) {
    return this.self.pageWriterDue(opts);
  }
  pageWriterInput(opts) {
    return this.self.pageWriterInput({
      ...opts,
      omit: opts.omit ?? ((m) => m.confidential)
    });
  }
  recordPageWriterRun(run) {
    return this.self.recordPageWriterRun(run);
  }
  pageWriterStatus(about, today) {
    return this.self.pageWriterStatus(about, today);
  }
  pageWriterRuns(opts = {}) {
    return this.self.pageWriterRuns(opts);
  }
  pageWriterClaimOpen(about, today) {
    return this.self.pageWriterClaimOpen(about, today);
  }
  nightClaimFor(session) {
    return this.self.nightClaimFor(session);
  }
  claimNightWriter(input) {
    try {
      if (this.observer)
        return { claimed: false, about: "", reason: "observer" };
      const mode = this.pageWriterModeOpt;
      if (mode !== "session")
        return { claimed: false, about: "", reason: "off" };
      const open = this.self.nightClaimFor(input.session);
      if (open !== null)
        return { claimed: true, about: open.about, reason: "claimed-earlier" };
      const due = this.self.pageWriterDue({ mode: "session" });
      if (!due.due) {
        if (due.reason === "no-memories" || due.reason === "asks-spent") {
          this.self.recordPageWriterRun({
            about: due.about,
            mode: "session",
            outcome: "skipped",
            detail: due.reason,
            session: input.session,
            run: input.run,
            dedupKey: `self.page.writer.ran:night:${due.about}:${due.reason}`
          });
        }
        return { claimed: false, about: due.about, reason: due.reason };
      }
      const built = this.nightWriterFitted({ about: due.about, session: input.session, tool: NIGHT_WRITER_TOOL }).built;
      const ok = this.self.recordPageWriterRun({
        about: due.about,
        mode: "session",
        outcome: "asked",
        detail: `nightly run ${input.run}, attempt ${String(due.attempt)}`,
        bytesBefore: built.page?.bytes ?? 0,
        considered: built.memories.length,
        omitted: built.omitted,
        session: input.session,
        run: input.run
      });
      return { claimed: ok, about: due.about, reason: ok ? "claimed" : "unrecorded" };
    } catch (err) {
      return { claimed: false, about: "", reason: err instanceof Error ? err.name : "UNKNOWN" };
    }
  }
  closeNightWriter(input) {
    try {
      if (this.observer)
        return false;
      const open = this.self.nightClaimFor(input.session);
      if (open === null)
        return false;
      const page = this.self.page();
      const refused = this.self.pageWriterRuns({ about: open.about }).find((r) => r.outcome === "refused" && (r.at > open.at || r.at === open.at && r.seq > open.seq));
      return this.self.recordPageWriterRun({
        about: open.about,
        mode: open.mode,
        outcome: refused === undefined ? "nothing-to-say" : "failed",
        detail: refused === undefined ? `the run moved on to ${input.phase} without writing` : `${refused.detail === "" ? "refused" : refused.detail}; not sent again before the run moved on to ${input.phase}`,
        bytesBefore: open.bytesBefore,
        bytesAfter: page === null ? 0 : byteLength(page.body),
        considered: open.considered,
        omitted: open.omitted,
        session: input.session,
        run: open.run
      });
    } catch {
      return false;
    }
  }
  nightWriter(input) {
    const claim = this.self.nightClaimFor(input.session);
    if (claim === null)
      return { ok: false, reason: "no-claim" };
    const { built, text } = this.nightWriterFitted({ about: claim.about, session: input.session, tool: input.tool });
    return {
      ok: true,
      about: claim.about,
      text,
      considered: built.memories.length,
      dropped: built.dropped,
      omitted: built.omitted,
      version: built.page?.version ?? null
    };
  }
  nightWriterFitted(input) {
    return fitNightWriter((budgetBytes) => this.pageWriterInput({ about: input.about, budgetBytes, max: NIGHT_WRITER_MEMORY_MAX }), (built) => writerInstruction(built, { tool: input.tool, session: input.session, pageInline: true }));
  }
  noteOrphanTail(sessionId, substance, day, opts = {}) {
    this.self.noteOrphanTail(sessionId, substance, day, opts);
  }
  noteAdapterEvent(name, data, opts = {}) {
    if (this.observer) {
      this.emit("counterpart.adapter.standdown", undefined, { name });
      return false;
    }
    try {
      const seq = this.store.appendEvent({
        name,
        day: this.store.livedDay(),
        payload: data,
        ...opts.dedupKey === undefined ? {} : { dedupKey: opts.dedupKey }
      });
      return seq > 0 || opts.dedupKey !== undefined;
    } catch (err) {
      this.emit("counterpart.adapter.event.failed", undefined, { name, code: errCode(err) });
      return false;
    }
  }
  boundary(input) {
    return this.spans.boundary(input);
  }
  sessionEnd(input) {
    return boundaryPart.sessionEnd(this, input);
  }
  contiguityPass() {
    return boundaryPart.contiguityPass(this);
  }
  bufferContiguity() {
    return boundaryPart.bufferContiguity(this);
  }
  linkAtWrite(fresh, day) {
    return boundaryPart.linkAtWrite(this, fresh, day);
  }
  jotsAmong(fresh) {
    return boundaryPart.jotsAmong(this, fresh);
  }
  contiguityOutcome(planned, edges) {
    return boundaryPart.contiguityOutcome(this, planned, edges);
  }
  recordBoundaryFlush(edges, contiguity, session) {
    return boundaryPart.recordBoundaryFlush(this, edges, contiguity, session);
  }
  clearContiguityPending() {
    return boundaryPart.clearContiguityPending(this);
  }
  rebrief(input) {
    return boundaryPart.rebrief(this, input);
  }
  refreshWake(input) {
    return boundaryPart.refreshWake(this, input);
  }
  republish(input, why, triggers) {
    return boundaryPart.republish(this, input, why, triggers);
  }
  sweepFallback(entry) {
    return sweepPart.sweepFallback(this, entry);
  }
  recordSweepGate(reports, date, reason) {
    return sweepPart.recordSweepGate(this, reports, date, reason);
  }
  takeBriefingEvents() {
    return boundaryPart.takeBriefingEvents(this);
  }
  recordSleepCycle(report, date, briefing, threwCode, partial) {
    return boundaryPart.recordSleepCycle(this, report, date, briefing, threwCode, partial);
  }
  recordSelfBriefing(briefing, date, reason, triggers) {
    return boundaryPart.recordSelfBriefing(this, briefing, date, reason, triggers);
  }
  sweepSlices() {
    return sweepPart.sweepSlices(this);
  }
  sweepWake(override) {
    return sweepPart.sweepWake(this, override);
  }
  recordSweepWake(wake, chunks, date) {
    return sweepPart.recordSweepWake(this, wake, chunks, date);
  }
  wrapSweepInterpret(interpret, slices, vectorFor, fenceNonce, wakeText) {
    return sweepPart.wrapSweepInterpret(this, interpret, slices, vectorFor, fenceNonce, wakeText);
  }
  sweepCardBlock(chunk, chunkKey, slices, vectorFor, fenceNonce) {
    return sweepPart.sweepCardBlock(this, chunk, chunkKey, slices, vectorFor, fenceNonce);
  }
  recordDeposit(result, ctx, source, mint) {
    return depositPart.recordDeposit(this, result, ctx, source, mint);
  }
  deposit(draft, source, ctx) {
    return depositPart.deposit(this, draft, source, ctx);
  }
  proposeSlotFor(id, p, session, siblings) {
    return depositPart.proposeSlotFor(this, id, p, session, siblings);
  }
  guardUpdate(p, ctx) {
    return depositPart.guardUpdate(this, p, ctx);
  }
  closesOrRedates(p, target, row, sent) {
    return depositPart.closesOrRedates(this, p, target, row, sent);
  }
  recordHold(held, holds, source, ctx, day) {
    return depositPart.recordHold(this, held, holds, source, ctx, day);
  }
  carryAbout(p, sent) {
    return depositPart.carryAbout(this, p, sent);
  }
  carryFacts(p, sent) {
    return depositPart.carryFacts(this, p, sent);
  }
  closeThread(p, successor, owner) {
    return depositPart.closeThread(this, p, successor, owner);
  }
  carryReminder(p, sentStatus) {
    return depositPart.carryReminder(this, p, sentStatus);
  }
  reminderHolder(target) {
    return depositPart.reminderHolder(this, target);
  }
  moveReminder(carry, successor) {
    return depositPart.moveReminder(this, carry, successor);
  }
  applySweep(raw, chunk, slices, vectorFor) {
    return sweepPart.applySweep(this, raw, chunk, slices, vectorFor);
  }
  applyDeclaredRevision(proposal, mint, door, session) {
    return sweepPart.applyDeclaredRevision(this, proposal, mint, door, session);
  }
  resolveUpdatesFor(scope, declared, content) {
    return sweepPart.resolveUpdatesFor(this, scope, declared, content);
  }
  relay(module, event) {
    const out = { at: event.at, name: event.name };
    if (event.ref !== undefined)
      out.ref = event.ref;
    out.data = { ...event.data ?? {}, module };
    this.push(out);
  }
  creditNamedIn(title, body, day, memoryId, door) {
    return depositPart.creditNamedIn(this, title, body, day, memoryId, door);
  }
  backfillSubjects() {
    try {
      if (this.store.getMeta(SUBJECTS_BACKFILL_META) !== undefined)
        return;
      const started = this.nowFn();
      const found = this.schemas.subjectLinksForAll();
      const added = found.links.length === 0 ? 0 : this.store.linkSubjects(found.links, "backfill");
      this.store.setMeta(SUBJECTS_BACKFILL_META, JSON.stringify({ at: this.nowFn(), ms: this.nowFn() - started, memories: found.memories, links: added, cards: found.cards }));
      this.emit("counterpart.subjects.backfill", undefined, { memories: found.memories, links: added, cards: found.cards });
    } catch (err) {
      this.emit("counterpart.subjects.backfill.failed", undefined, { code: errCode(err) });
    }
  }
  relinkRegrownCopies() {
    try {
      if (this.store.getMeta(REGROWN_RELINK_META) !== undefined)
        return;
      const started = this.nowFn();
      const day = this.store.livedDay();
      const denied = new Set(this.store.deniedIds());
      const archived = new Set(this.store.list({ type: "memory", archived: true }));
      let removed = 0;
      const stale = [];
      for (const src of new Set(this.store.allEdges().map((e) => e.src))) {
        if (!archived.has(src))
          continue;
        const row = this.store.row(src);
        if (row === undefined || row.archived !== 1 || row.archived_reason !== EPISODE_REGROWN_REASON)
          continue;
        if (denied.has(src)) {
          removed += 1;
          continue;
        }
        stale.push({ id: src, episode: row.origin_ref });
      }
      const episodes = stale.flatMap((s) => s.episode === null ? [] : [s.episode]);
      const held = episodes.length === 0 ? new Map : this.store.copiesOf(episodes);
      const liveCopy = new Map;
      for (const [episode, found] of held) {
        const ids = found.map((f) => f.id).filter((id) => !denied.has(id));
        liveCopy.set(episode, ids.length === 0 ? null : ids.reduce((a, b) => (this.store.row(b)?.created_at ?? 0) > (this.store.row(a)?.created_at ?? 0) ? b : a));
      }
      let copies = 0;
      let edges = 0;
      let noLiveCopy = 0;
      let failed = 0;
      for (const { id: src, episode } of stale) {
        const to = episode === null ? null : liveCopy.get(episode) ?? null;
        if (to === null) {
          noLiveCopy += 1;
          continue;
        }
        const out = this.associate.retargetOnSupersede(src, to, day);
        if (out.reason === "failed") {
          failed += 1;
          continue;
        }
        copies += 1;
        edges += out.pairs;
      }
      this.emit("counterpart.regrown.relink", undefined, { copies, edges, noLiveCopy, removed, failed, day });
      if (failed > 0)
        return;
      this.store.setMeta(REGROWN_RELINK_META, JSON.stringify({ at: this.nowFn(), ms: this.nowFn() - started, day, copies, edges, noLiveCopy, removed }));
    } catch (err) {
      this.emit("counterpart.regrown.relink.failed", undefined, { code: errCode(err) });
    }
  }
  relinkCorrected() {
    try {
      if (this.store.getMeta(CORRECTED_RELINK_META) !== undefined)
        return;
      const day = this.store.livedDay();
      let carried = 0;
      let failed = 0;
      for (const p of this.store.contradictions({ state: "settled", limit: 1e5 })) {
        if (p.how !== "corrected" || p.via !== null || p.over === null || p.holds === null)
          continue;
        const over = this.store.row(p.over);
        if (over === undefined || over.archived !== 1 || over.archived_reason !== CORRECTED_REASON)
          continue;
        const holder = this.store.row(p.holds);
        const to = holder !== undefined && holder.archived === 0 && holder.superseded_by === null ? p.holds : headOf(this.store, p.holds);
        if (to === null)
          continue;
        const out = this.associate.retargetOnSupersede(p.over, to, day);
        if (out.reason === "failed")
          failed += 1;
        else
          carried += 1;
      }
      this.emit("counterpart.corrected.relink", undefined, { carried, failed, day });
      if (failed > 0)
        return;
      this.store.setMeta(CORRECTED_RELINK_META, JSON.stringify({ at: this.nowFn(), day, carried }));
    } catch (err) {
      this.emit("counterpart.corrected.relink.failed", undefined, { code: errCode(err) });
    }
  }
  emit(name, ref, data) {
    const event = { at: this.nowFn(), name };
    if (ref !== undefined)
      event.ref = ref;
    if (data !== undefined)
      event.data = data;
    this.push(event);
  }
  push(event) {
    this.ring.push(event);
    if (this.ring.length > EVENT_RING)
      this.ring.shift();
    this.onEvent?.(event);
  }
}
