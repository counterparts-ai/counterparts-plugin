import {
  CHECKOUT_EVENT,
  ENVELOPE_GAVE_WAY_EVENT,
  ENVELOPE_OVERCAP_EVENT,
  INJECTION_OVERBUDGET_EVENT,
  NOTICE_DROPPED_EVENT,
  WAKE_DELIVERED_EVENT,
  WAKE_INJECTED_EVENT
} from "../../core/counterpart.js";
import { newNightRunId } from "../../core/dream/index.js";
import { PRONOUN_RULE, coverFinish, meetingHold } from "../../core/onboarding.js";
import { homedir } from "node:os";
import { CODE_TAB_ENTRYPOINT, isDesktopScratchWorkspace } from "../hosts.js";
import { scopeCommand, scopeCommandContext, stanceOfMode } from "../scopes.js";
import {
  NON_INTERACTIVE_ENTRYPOINTS,
  decideUpdateNotice,
  installedBuild,
  isLive,
  markUpdateNoticeShown,
  readSession,
  recordSession,
  stampSessionOpened
} from "../sessions.js";
import { Lifecycle, codeOf, plainContextLine, plainLine } from "../lifecycle.js";
import { localDate } from "../../core/time.js";
import { TUNABLES } from "../config.js";
import { TUNABLES as RECALL_TUNABLES } from "../../core/recall/tunables.js";
import { SESSION_NOTICE_BUDGET_MS, checkoutIsGraded, doctorFindings, noticeMessage, readCheckout } from "./doctor.js";
import { nightRowTimeoutMs, planNightRunner } from "./night-run.js";
import { NOTHING_OWED_BEFORE_KEY, catchUpOf, catchUpWords, owedBefore } from "./night-catch-up.js";
import { spawnDetached } from "../spawn.js";
import { NO_ARRIVAL, STOP_ASK_OPENER, readWakeArrival, startedByHost } from "./transcript.js";
export {
  SPAWN_REFUSAL_PREFIX,
  SPAWN_START_COUNT_KEY,
  SPAWN_START_DATE_KEY,
  WRITE_UP_ASK_COUNT_KEY,
  WRITE_UP_ASK_DATE_KEY,
  WRITE_UP_CLOSE,
  WRITE_UP_OPEN,
  WRITE_UP_SHORT_LINE,
  WRITE_UP_TOOL,
  plainContextLine,
  plainLine,
  substanceOf,
  writeUpPointer
} from "../lifecycle.js";
export const HOOKS = [
  "session-start",
  "user-prompt-submit",
  "stop",
  "session-end",
  "pre-compact"
];
export const SESSION_ENDING = ["stop", "session-end", "pre-compact"];
export const WAKE_CHECK_ENV = "COUNTERPARTS_WAKE_CHECK";
export const BOUNDARY_KIND = {
  stop: "stop",
  "session-end": "session-end",
  "pre-compact": "pre-compaction"
};
export function isInteractive(input) {
  if (input.attended !== undefined)
    return input.attended;
  return input.entrypoint === undefined || !NON_INTERACTIVE_ENTRYPOINTS.has(input.entrypoint);
}
export function watchedAtStart(input) {
  return isInteractive(input) && input.nightRun !== true && input.source !== "compact";
}
const NO_PLAIN = { context: "", notices: [], due: [] };
export function scopeAsk(folder, ctx) {
  return [
    SCOPE_ASK_OPEN,
    "No setting yet for this directory, so Counterparts is remembering here by default.",
    "Early on, ask the user once which they want: on, observer (reads and recalls, records",
    "nothing), or off (nothing at all). Record the answer with the `scope` tool (mode: on |",
    `observer | off), or with \`${scopeCommand(folder, "--on", ctx)}\` (\`--observer\` or \`--off\``,
    "in place of `--on`). Then do not ask again.",
    "</counterparts-scope>"
  ].join(`
`);
}
export const SCOPE_ASK_OPEN = "<counterparts-scope>";
function besideWords(question, plain, meet = false) {
  const parts = [
    ...meet ? ["the first meeting's line"] : [],
    ...question ? ["the first-launch question"] : [],
    ...plain > 0 ? [`${String(plain)} plain reminder${plain === 1 ? "" : "s"}`] : []
  ];
  return parts.join(" and ");
}
export const PAGE_WRITER_TOOL = "counterparts self_page";
export function stopAsk(sessionId, chapter) {
  return [
    `${STOP_ASK_OPENER} 1) hand back what caught your attention since you last wrote, one idea each — what you read, what they said, what happened — with the counterparts session_end tool, session: ${sessionId}. \`handoff\` only if work here is unfinished; \`retireHandoff\` any now done; \`updates\` anything dated or open now done. ${PRONOUN_RULE}`,
    `2) Write chapter ${String(chapter)} with the counterparts chapter tool, session: ${sessionId}.`
  ].join(`
`);
}
export const RESUME_WAKE_LINE = "Counterparts: this session was resumed; the wake it was handed when it started (above) still holds.";

export { CODE_TAB_ENTRYPOINT };
export function codeTabSessionLine(input) {
  if (input.entrypoint !== CODE_TAB_ENTRYPOINT || input.sessionId.length === 0)
    return null;
  return `Counterparts, Desktop's Code tab: if your counterparts tools take a \`session\` parameter, pass session: ${input.sessionId} on every call — it is how they know this session from a Desktop chat.`;
}
export const STOP_HUMAN_LINE = "Counterparts: asking the assistant to write up this session's memories.";

export class ClaudeCodeAdapter extends Lifecycle {
  nightArgs;
  scopeCommandCtx;
  install;
  inFlight = new Set;
  constructor(opts) {
    super(opts);
    this.nightArgs = opts.nightArgs;
    this.scopeCommandCtx = opts.scopeCommand;
    this.install = opts.install;
  }
  sessionStart(input) {
    return this.guard("session-start", input, (out) => {
      const wantsAsk = this.scopeAskDue(input);
      const resumed = this.resumesToday(input);
      this.noteSession("start", input);
      const budget = this.config.injectionBudgetBytes;
      if (budget === undefined || this.config.injectionBudgetDefaulted === true) {
        this.emit("adapter.budget.unreported", budget === undefined ? {} : { defaulted: budget });
      }
      const woke = resumed ? this.resumeWake(input) : this.composeWake(input, budget);
      if (!resumed)
        this.noteSinceWoke(input);
      const watched = watchedAtStart(input);
      const plain = watched ? this.plainFor(input) : NO_PLAIN;
      const codeTab = codeTabSessionLine(input);
      const storeLine = this.storeMarker();
      const marker = `${this.onboardingMarker(input)}
${storeLine.length === 0 ? "" : `${storeLine}
`}`;
      const lead = `${woke.text.length === 0 && plain.context.length === 0 && codeTab === null ? "" : `${this.nowLine()}
`}${marker}${codeTab === null ? "" : `${codeTab}
`}${plain.context}`;
      const sent = woke.bytes + Buffer.byteLength(lead, "utf8");
      const rides = plain.due.length > 0 && sent <= TUNABLES.HOST_OUTPUT_CHARS && Buffer.byteLength(plain.notices.join(`
`), "utf8") <= TUNABLES.HOST_OUTPUT_CHARS;
      const room = {
        form: rides ? "json" : "plain",
        spent: sent,
        limit: TUNABLES.HOST_OUTPUT_CHARS,
        cost: (t) => Buffer.byteLength(t, "utf8"),
        plain: rides ? plain.due.length : 0
      };
      if (budget !== undefined && sent > budget) {
        this.noteDeliveryWarning(INJECTION_OVERBUDGET_EVENT, { hook: "session-start", bytes: sent, budget }, input);
      }
      this.record(WAKE_INJECTED_EVENT, input, {
        ok: woke.ok,
        reason: woke.reason,
        bytes: woke.bytes,
        budget: budget ?? null,
        sentinel: woke.sentinel !== null,
        preface: woke.preface !== null,
        scopeRegistry: this.scopeTrouble,
        interactive: isInteractive(input) && input.nightRun !== true,
        resumed
      });
      const meet = watched ? this.deliverMeetLine(input, room) : "";
      const meetBytes = meet.length === 0 ? 0 : room.cost(`

${meet}`);
      const scope = wantsAsk && !this.meetPending() ? this.deliverScopeAsk(input, { ...room, spent: room.spent + meetBytes }) : "";
      const chosen = [meet, scope].filter((a) => a.length > 0).join(`

`);
      const chosenBytes = chosen.length === 0 ? 0 : room.cost(`

${chosen}`);
      const writeUp = this.deliverWriteUpAsk(input, room.spent + chosenBytes, {
        limit: room.limit,
        cost: room.cost,
        beside: besideWords(scope.length > 0, room.plain, meet.length > 0)
      });
      const asks = [chosen, writeUp].filter((a) => a.length > 0).join(`

`);
      return {
        ...out,
        ok: woke.ok,
        reason: woke.reason,
        injection: `${lead}${woke.text}`,
        bytes: woke.bytes,
        sentinel: woke.sentinel,
        ask: asks.length === 0 ? null : asks,
        ...plain.due.length === 0 ? {} : { notices: plain.notices, plain: plain.due }
      };
    });
  }
  resumesToday(input) {
    if (input.source !== "resume" || input.sessionId.length === 0 || input.nightRun === true)
      return false;
    try {
      const record = readSession(this.counterpart.store.dir, input.sessionId);
      if (record === null || record.wakeSentinel === undefined || record.wakeSentinel.length === 0)
        return false;
      const zone = this.counterpart.store.zone();
      const today = input.at ?? localDate(this.nowFn(), zone);
      return localDate(record.startedAt, zone) === today;
    } catch {
      return false;
    }
  }
  resumeWake(input) {
    const room = TUNABLES.HOST_OUTPUT_CHARS - Buffer.byteLength(`${RESUME_WAKE_LINE}
`, "utf8");
    const since = this.sinceLine(input, room, { resumed: true });
    const text = since.length === 0 ? RESUME_WAKE_LINE : `${RESUME_WAKE_LINE}
${since}`;
    return { text, ok: true, reason: "resumed", bytes: Buffer.byteLength(text, "utf8"), sentinel: null, preface: null };
  }
  scopeAskDue(input) {
    if (this.scope.mode !== "unset")
      return false;
    if (this.observer) {
      this.emit("adapter.scope.ask.skipped", { reason: "observer" });
      return false;
    }
    if (input.sessionId.length === 0 || input.nightRun === true)
      return false;
    if (isDesktopScratchWorkspace(input.scope)) {
      this.emit("adapter.scope.ask.skipped", { reason: "scratch-workspace" });
      return false;
    }
    try {
      return readSession(this.counterpart.store.dir, input.sessionId)?.askedScope !== true;
    } catch {
      return false;
    }
  }
  deliverMeetLine(input, room) {
    const line = this.onboardingLine(input);
    if (line === null)
      return "";
    const need = room.cost(`

${line.text}`);
    if (room.spent + need > room.limit) {
      this.emit("adapter.meet.deferred", { kind: line.kind, wakeBytes: room.spent, budget: room.limit, need, form: room.form });
      return "";
    }
    line.commit();
    return line.text;
  }
  deliverScopeAsk(input, room) {
    const ask = scopeAsk(input.scope, this.scopeCommandCtx ?? scopeCommandContext({ configPath: this.configPath, pluginRoot: null, home: homedir() }));
    const need = room.cost(`

${ask}`);
    if (room.spent + need > room.limit) {
      this.emit("adapter.scope.ask.deferred", {
        wakeBytes: room.spent,
        budget: room.limit,
        need,
        form: room.form
      });
      this.noteDeliveryWarning(ENVELOPE_GAVE_WAY_EVENT, { hook: "session-start", part: "question", form: room.form }, input);
      return "";
    }
    const marked = recordSession(this.counterpart.store.dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase: "start",
      at: this.nowFn(),
      askedScope: true,
      ...this.recordStamp()
    });
    this.emit("adapter.scope.ask", { bytes: Buffer.byteLength(`

${ask}`, "utf8"), recorded: marked !== null });
    return ask;
  }
  userPromptSubmit(input) {
    return this.guard("user-prompt-submit", input, (out) => {
      if (input.sessionId.length > 0 && readSession(this.counterpart.store.dir, input.sessionId) !== null) {
        this.noteSession("boundary", input);
      }
      this.checkWakeArrival(input);
      const text = input.prompt ?? "";
      const byHost = isInteractive(input) && startedByHost(text);
      const plain = isInteractive(input) && !byHost ? this.plainFor(input) : NO_PLAIN;
      const waiting = plain.due;
      const told = plain.due.length === 0 ? {} : { notices: plain.notices, plain: plain.due };
      const dream = this.dreamLines(input, byHost);
      const context = `${plain.context}${dream.text}`;
      if (dream.told !== null)
        Object.assign(told, { dream: dream.told });
      if (dream.note !== null)
        Object.assign(told, { dreamNote: dream.note });
      if (text.trim().length === 0) {
        return { ...out, ok: true, reason: "empty-prompt", injection: `${this.nowLine()}${context.length === 0 ? "" : `
${context.trimEnd()}`}`, ...told };
      }
      const budgetBytes = this.recallRoom(input, context);
      const result = this.recallTurn(input, text, {
        ...budgetBytes === undefined ? {} : { budgetBytes },
        ...waiting.length === 0 ? {} : { withhold: new Set(waiting.map((r) => r.memoryId)) },
        ...byHost ? { noCues: true } : {}
      });
      const decision = result.decision;
      const recallBudget = budgetBytes ?? this.config.injectionBudgetBytes ?? RECALL_TUNABLES.BUDGET_BYTES;
      const recallBytes = Buffer.byteLength(result.injection, "utf8");
      const spent = Buffer.byteLength(`${this.nowLine()}
${context}`, "utf8") + recallBytes;
      const since = this.sinceLine(input, Math.min(recallBudget - recallBytes, TUNABLES.HOST_OUTPUT_CHARS - spent));
      const lines = since.length === 0 ? context : `${context}${since}
`;
      return {
        ...out,
        ok: true,
        reason: decision.reason,
        injection: result.injection.length === 0 ? `${this.nowLine()}${lines.length === 0 ? "" : `
${lines.trimEnd()}`}` : `${this.nowLine()}
${lines}${result.injection}`,
        bytes: decision.bytes,
        sentinel: decision.sentinel,
        surfaced: decision.surfaced,
        footnotes: decision.footnotes,
        ...told
      };
    });
  }
  recallRoom(input, context) {
    const configured = this.config.injectionBudgetBytes;
    const base = configured ?? RECALL_TUNABLES.BUDGET_BYTES;
    const extras = Buffer.byteLength(`${this.nowLine()}
${context}`, "utf8");
    const room = Math.max(0, TUNABLES.HOST_OUTPUT_CHARS - extras);
    if (room >= base)
      return configured;
    this.noteDeliveryWarning(ENVELOPE_GAVE_WAY_EVENT, { hook: "user-prompt-submit", part: "recall", budget: room, base }, input);
    return room;
  }
  dreamLines(input, byHost = false) {
    const none = { text: "", told: null, note: null };
    if (this.observer || input.at === undefined || input.nightRun === true || input.sessionId.length === 0)
      return none;
    if (!isInteractive(input) || byHost) {
      this.startUnwatched(input);
      return none;
    }
    try {
      const dreams = this.counterpart.dreams;
      dreams.resetAutoOnce();
      const note = dreams.autoResetNotice();
      const lines = [...dreams.raiseLines({ session: input.sessionId })];
      if (note !== null)
        lines.push(note.context);
      lines.push(...this.nightHandBack(input));
      const pending = this.counterpart.reflections.pendingShare({ session: input.sessionId });
      if (pending !== null) {
        const record = pending.session === null ? null : readSession(this.counterpart.store.dir, pending.session);
        if (record === null || !isLive(record, this.nowFn())) {
          const carried = this.counterpart.reflections.carryLine({ session: input.sessionId, reflection: pending.id });
          if (carried !== null)
            lines.push(carried);
        }
      }
      let offer = dreams.offer({ at: input.at, session: input.sessionId });
      if (offer === null)
        this.catchUpWhenOwed(input);
      if (offer !== null && offer.headless) {
        const started = dreams.claimOffer(offer) ? this.startNightRun(input, offer) : null;
        if (started === null)
          offer = null;
        else if (!started) {
          const again = dreams.offer({ at: input.at, session: input.sessionId });
          offer = again !== null && !again.headless ? again : null;
        }
      }
      let told = null;
      let asked = false;
      if (offer !== null) {
        if (offer.notice !== null)
          told = { notice: offer.notice, context: offer.context, offer: offer.headless ? null : offer };
        asked = told !== null || dreams.claimOffer(offer);
        if (asked)
          lines.push(offer.context);
      } else {
        const held = dreams.heldTold(input.at, input.sessionId);
        if (held !== null) {
          told = { notice: held.notice, context: held.context, offer: null, held: held.run };
          lines.push(held.context);
        }
      }
      if (lines.length > 0)
        this.emit("adapter.dream.lines", { asked, raised: lines.length - (asked ? 1 : 0) });
      return { text: lines.map((l) => `${l}
`).join(""), told, note };
    } catch {
      return none;
    }
  }
  startUnwatched(input) {
    if (input.at === undefined)
      return;
    try {
      const dreams = this.counterpart.dreams;
      dreams.resetAutoOnce();
      const offer = dreams.offer({ at: input.at, session: input.sessionId });
      if (offer === null) {
        const started = this.catchUpWhenOwed(input);
        if (started)
          this.emit("adapter.dream.unwatched", { started, catchUpOnly: true, entrypoint: input.entrypoint ?? null });
        return;
      }
      if (!offer.headless || !dreams.claimOffer(offer))
        return;
      const started = this.startNightRun(input, offer);
      const night = dreams.nightRun();
      if (started && night !== null && night.state === "started")
        dreams.holdTold({ run: night.run, date: input.at });
      this.emit("adapter.dream.unwatched", { started, entrypoint: input.entrypoint ?? null });
    } catch {}
  }
  catchUpWhenOwed(input) {
    if (input.at === undefined)
      return false;
    try {
      const dreams = this.counterpart.dreams;
      const offer = dreams.catchUpOffer({ at: input.at, session: input.sessionId });
      if (offer === null)
        return false;
      const store = this.counterpart.store;
      if (store.getMeta(NOTHING_OWED_BEFORE_KEY) === input.at)
        return false;
      const owed = owedBefore(this.counterpart, input.at);
      if (owed === null)
        return false;
      if (owed === 0) {
        store.setMeta(NOTHING_OWED_BEFORE_KEY, input.at);
        return false;
      }
      if (!dreams.claimOffer(offer))
        return false;
      const started = this.startNightRun(input, offer);
      this.emit("adapter.night.catch-up-only", { started, owed, dream: offer.dreamSkipped ?? null });
      return started;
    } catch {
      return false;
    }
  }
  claimHeld(input, run) {
    try {
      const claimed = this.counterpart.dreams.claimHeldTold(run, input.sessionId);
      this.emit(claimed ? "adapter.dream.told" : "adapter.dream.lost", { state: "held", session: input.sessionId });
      return claimed;
    } catch {
      return false;
    }
  }
  claimDreamNote(input) {
    try {
      return this.counterpart.dreams.claimAutoResetNotice(input.sessionId);
    } catch {
      return false;
    }
  }
  startNightRun(input, offer) {
    const dreams = this.counterpart.dreams;
    const store = this.counterpart.store;
    const run = newNightRunId();
    const kind = offer.reflects !== null ? { kind: "reflection", dream: offer.reflects } : offer.dreamSkipped === undefined ? { kind: "night" } : { kind: "night", dreamSkipped: offer.dreamSkipped };
    const base = {
      run,
      date: offer.at,
      kind: kind.kind,
      session: input.sessionId,
      startedAt: store.now(),
      timeoutMs: nightRowTimeoutMs(this.config, kind.kind),
      endedAt: null,
      reason: null,
      detail: null,
      code: null,
      dream: null,
      reflection: null,
      ...offer.dreamSkipped === undefined ? {} : {
        children: [
          { child: "dream", code: null, ms: 0, skipped: offer.dreamSkipped },
          { child: "reflection", code: null, ms: 0, skipped: offer.dreamSkipped }
        ]
      }
    };
    const couldNot = (reason, detail) => {
      dreams.recordNightRun({ ...base, state: "could-not-start", endedAt: store.now(), reason, detail });
      this.emit("adapter.night.failed", { run, reason, detail });
      return false;
    };
    try {
      const plan = planNightRunner({
        config: this.config,
        command: this.command,
        args: this.nightArgs,
        run,
        session: input.sessionId,
        scope: input.scope,
        kind,
        ...this.configPath === undefined ? {} : { configPath: this.configPath }
      });
      if (!plan.ok)
        return couldNot(plan.reason === "NO_RUNNER" ? "runner" : "refused", plan.reason);
      const out = spawnDetached({ ...plan, reason: "ready" }, {
        ...this.spawner === undefined ? {} : { spawner: this.spawner },
        onEvent: (name, data) => this.emit(`night.${name}`, data)
      });
      if (!out.started)
        return couldNot("runner", out.code ?? String(out.reason));
      dreams.recordNightRun({ ...base, state: "started" });
      this.emit("adapter.night.started", { run, pid: out.pid, kind: kind.kind, ...offer.dreamSkipped === undefined ? {} : { dreamSkipped: offer.dreamSkipped } });
      return true;
    } catch (err) {
      return couldNot("runner", codeOf(err));
    }
  }
  nightHandBack(input) {
    const dreams = this.counterpart.dreams;
    const night = dreams.nightRun();
    if (night === null || night.state === "started" || night.state === "could-not-start")
      return [];
    if (night.dream === null && night.reflection === null && (night.spills ?? 0) === 0)
      return [];
    if (night.handedAt !== undefined)
      return [];
    const claimed = dreams.claimNightHandBack(night.run, input.sessionId);
    dreams.recordNightRun({ ...night, handedAt: this.counterpart.store.now() });
    if (!claimed)
      return [];
    const out = [];
    const line = dreams.nightHandBackLine(night);
    if (line !== null)
      out.push(line);
    if (night.reflection !== null) {
      const share = this.counterpart.reflections.carryLine({ session: input.sessionId, reflection: night.reflection });
      if (share !== null)
        out.push(share);
    }
    const spill = dreams.nightSpillLine(night);
    if (spill !== null)
      out.push(spill);
    try {
      const cu = catchUpOf(this.counterpart.store, night.run);
      if (cu !== null && cu.granted > 0) {
        out.push(`Counterparts: before it dreamed, the nightly run caught up on sessions that had ended before they were written up — ${catchUpWords(cu)}. Nothing to do; mention it only if asked.`);
      }
    } catch {}
    this.emit("adapter.night.handed", { run: night.run, lines: out.length });
    return out;
  }
  claimDream(input, offer) {
    try {
      const claimed = this.counterpart.dreams.claimOffer(offer);
      this.emit(claimed ? "adapter.dream.told" : "adapter.dream.lost", { state: offer.state, session: input.sessionId });
      return claimed;
    } catch {
      return false;
    }
  }
  updateNotice(input) {
    if (this.observer || input.sessionId.length === 0 || !isInteractive(input))
      return null;
    try {
      const decision = decideUpdateNotice(this.counterpart.store.dir, {
        sessionId: input.sessionId,
        installed: installedBuild()
      });
      if (decision.reason === "due" || decision.reason === "failed") {
        this.emit("adapter.update.notice", {
          reason: decision.reason,
          matchedBy: decision.matchedBy,
          servers: decision.servers,
          hookPpid: decision.hookPpid
        });
      }
      return decision.message;
    } catch {
      return null;
    }
  }
  markUpdateNotice(input) {
    if (this.observer || input.sessionId.length === 0)
      return false;
    const marked = markUpdateNoticeShown(this.counterpart.store.dir, input.sessionId);
    this.emit("adapter.update.notice", { reason: marked ? "shown" : "mark-failed" });
    return marked;
  }
  stampOpened(input) {
    if (this.observer || input.sessionId.length === 0)
      return false;
    return stampSessionOpened(this.counterpart.store.dir, input.sessionId, {
      build: installedBuild(),
      hookPpid: process.ppid,
      at: Date.now()
    });
  }
  boundary(hook, input) {
    return this.guard(hook, input, (out) => this.claim(hook, input, out));
  }
  stop(input) {
    return this.guard("stop", input, (out) => {
      const claimed = this.claim("stop", input, out);
      this.noteSession("boundary", input);
      this.checkWakeArrival(input, { final: true });
      const ask = input.nightRun !== true ? this.askAtStop(input) : null;
      const spawn = this.spawnWorker(input);
      return { ...claimed, ask, spawn };
    });
  }
  sessionEnd(input) {
    return this.guard("session-end", input, (out) => {
      const claimed = this.claim("session-end", input, out);
      this.noteSession("end", input);
      this.noteTail(input);
      return { ...claimed, spawn: this.spawnWorker(input) };
    });
  }
  preCompact(input) {
    return this.guard("pre-compact", input, (out) => {
      const claimed = this.claim("pre-compact", input, out);
      this.noteTail(input);
      return claimed;
    });
  }
  hook(name, input) {
    switch (name) {
      case "session-start":
        return this.sessionStart(input);
      case "user-prompt-submit":
        return this.userPromptSubmit(input);
      case "stop":
        return this.stop(input);
      case "session-end":
        return this.sessionEnd(input);
      case "pre-compact":
        return this.preCompact(input);
    }
  }
  claim(hook, input, out) {
    const captured = this.captureBoundary(hook, BOUNDARY_KIND[hook], input);
    return { ...out, ok: true, reason: captured.reason, spansAppended: captured.spansAppended };
  }
  askAtStop(input) {
    if (input.reFired === true)
      return null;
    const hold = meetingHold(this.counterpart.store, input.sessionId, this.nowFn());
    if (hold === "running") {
      this.emit("adapter.ask.held", { by: "meeting" });
      return null;
    }
    if (hold === "finished") {
      try {
        coverFinish(this.counterpart.store);
      } catch {}
      this.paceAsk(input, { coveredBy: "meeting" });
      return null;
    }
    const chapter = this.paceAsk(input);
    return chapter === null ? null : stopAsk(input.sessionId, chapter);
  }
  checkWakeArrival(input, opts = {}) {
    if (process.env[WAKE_CHECK_ENV] !== "1")
      return;
    if (this.observer)
      return;
    if (input.sessionId.length === 0)
      return;
    const started = this.nowFn();
    let record;
    try {
      record = readSession(this.counterpart.store.dir, input.sessionId);
    } catch {
      return;
    }
    if (record === null || record.wakeChecked === true)
      return;
    const expected = record.wakeSentinel ?? null;
    try {
      const arrival = expected === null ? NO_ARRIVAL : readWakeArrival(input.transcriptPath, { expect: expected });
      if (expected !== null && arrival.reason === "absent" && opts.final !== true) {
        this.emit("adapter.wake.check.deferred", {
          transcript: arrival.reason,
          pathGiven: input.transcriptPath !== undefined,
          elapsedMs: this.nowFn() - started
        });
        return;
      }
      const outcome = wakeOutcome(expected, arrival);
      this.record(WAKE_DELIVERED_EVENT, input, {
        outcome,
        checkedAt: opts.final === true ? "stop" : "prompt",
        ok: outcome === "delivered",
        delivered: outcome === "delivered",
        expected: expected !== null,
        found: arrival.found,
        transcript: arrival.reason,
        headInContent: arrival.head.present,
        tailInContent: arrival.tail.present,
        headInStdout: arrival.headPrinted.present,
        tailInStdout: arrival.tailPrinted.present,
        contentRecorded: arrival.contentRecorded,
        headBytes: arrival.head.bytes,
        headElements: arrival.head.elements,
        tailBytes: arrival.tail.bytes,
        tailElements: arrival.tail.elements,
        contentBytes: arrival.contentBytes,
        stdoutBytes: arrival.stdoutBytes,
        linesRead: arrival.linesRead,
        bytesRead: arrival.bytesRead,
        corrupt: arrival.corrupt,
        elapsedMs: this.nowFn() - started
      });
      this.counterpart.noteWakeDelivered(arrival.tail.present ? arrival.tail.matchesExpected ? expected : "" : null, expected);
    } catch (err) {
      this.emit("adapter.wake.check.failed", {
        code: codeOf(err),
        elapsedMs: this.nowFn() - started
      });
    }
    this.markWakeChecked(input, record);
  }
  markWakeChecked(input, prior) {
    try {
      recordSession(this.counterpart.store.dir, {
        sessionId: input.sessionId,
        scope: input.scope,
        phase: "boundary",
        at: prior.lastBoundaryAt,
        wakeChecked: true,
        ...this.recordStamp()
      });
    } catch {}
  }
  notice(input, opts = {}) {
    if (this.observer)
      return null;
    try {
      const today = input.at ?? localDate(this.nowFn(), this.counterpart.store.zone());
      const checkout = opts.checkout ?? readCheckout();
      if (!checkoutIsGraded(checkout)) {
        if (checkout.reason === "unreadable") {
          this.emit("adapter.checkout.unreadable", {
            root: checkout.root,
            why: checkout.timedOut ? "timeout" : "git"
          });
        }
      } else {
        try {
          this.counterpart.noteAdapterEvent(CHECKOUT_EVENT, {
            reason: checkout.reason,
            branch: checkout.branch,
            head: checkout.head,
            dirty: checkout.dirty,
            behindBy: checkout.behindBy,
            originMaster: checkout.originMaster,
            atMaster: checkout.atMaster,
            date: today
          }, {
            dedupKey: `${CHECKOUT_EVENT}:${today}:${checkout.head ?? "none"}:${checkout.dirty}:${checkout.reason}`
          });
        } catch (err) {
          this.emit("adapter.checkout.record.failed", { code: codeOf(err) });
        }
      }
      const findings = doctorFindings({
        checkout,
        configPath: this.configPath ?? "(none)",
        configReason: null,
        config: this.config,
        dir: this.config.dataDir ?? "",
        store: this.counterpart.store,
        today,
        refusals: this.spawnRefusals(),
        starts: this.spawnStarts(),
        budgetMs: opts.budgetMs ?? SESSION_NOTICE_BUDGET_MS,
        ...opts.now === undefined ? {} : { now: opts.now },
        ...this.install === undefined ? {} : { install: this.install }
      });
      return noticeMessage(findings);
    } catch (err) {
      this.emit("adapter.doctor.failed", { code: codeOf(err) });
      return null;
    }
  }
  noteNoticeDropped(chars) {
    this.noteDeliveryWarning(NOTICE_DROPPED_EVENT, { ...chars });
  }
  noteOverCap(chars) {
    this.noteDeliveryWarning(ENVELOPE_OVERCAP_EVENT, { ...chars });
  }
  noteGaveWay(input, part, count) {
    this.noteDeliveryWarning(ENVELOPE_GAVE_WAY_EVENT, { hook: "delivery", part, count }, input);
  }
  guard(hook, input, body) {
    const base = {
      hook,
      ok: false,
      reason: "unknown",
      injection: "",
      bytes: 0,
      sentinel: null,
      surfaced: [],
      footnotes: [],
      ask: null,
      spansAppended: 0,
      spawn: null,
      observer: this.observer
    };
    const key = `${hook}:${input.sessionId}`;
    if (this.inFlight.has(key)) {
      this.emit("adapter.reentrant", { hook, session: input.sessionId });
      return { ...base, ok: true, reason: "reentrant" };
    }
    this.inFlight.add(key);
    try {
      if (stanceOfMode(this.scope.mode) === "off") {
        this.emit("adapter.scope.off", { hook, matched: this.scope.matched });
        return { ...base, ok: true, reason: "scope-off" };
      }
      if (this.observer && hook !== "session-start" && hook !== "user-prompt-submit") {
        this.emit("adapter.observer.standdown", { hook });
        return { ...base, ok: true, reason: "observer" };
      }
      return body(base);
    } catch (err) {
      this.emit("adapter.hook.failed", { hook, code: codeOf(err) });
      return { ...base, ok: false, reason: "failed" };
    } finally {
      this.inFlight.delete(key);
    }
  }
}
export function wakeOutcome(expected, arrival) {
  if (expected === null)
    return "no-wake-expected";
  if (!arrival.found)
    return "not-found";
  if (arrival.tail.present)
    return arrival.tail.matchesExpected ? "delivered" : "mismatch";
  if (!arrival.contentRecorded) {
    if (arrival.tailPrinted.matchesExpected)
      return "printed-unverified";
    if (arrival.tailPrinted.present)
      return "mismatch";
    if (!arrival.headPrinted.present)
      return "not-found";
  }
  return "truncated";
}
export function withoutPlain(result, drop) {
  if (drop.length === 0)
    return result;
  const keyOf = (r) => `${r.memoryId} ${r.windowKey} ${r.beat}`;
  const gone = new Set(drop.map(keyOf));
  const lines = new Set(drop.map(plainContextLine));
  const plain = (result.plain ?? []).filter((r) => !gone.has(keyOf(r)));
  const injection = result.injection === null ? null : result.injection.split(`
`).filter((l) => !lines.has(l)).join(`
`);
  const rest = { ...result, injection };
  delete rest.notices;
  delete rest.plain;
  return plain.length === 0 ? rest : { ...rest, notices: plain.map(plainLine), plain };
}
export function withoutDreamNote(result) {
  const note = result.dreamNote;
  if (note === undefined)
    return result;
  const injection = result.injection === null ? null : result.injection.split(`
`).filter((l) => l !== note.context).join(`
`);
  const rest = { ...result, injection };
  delete rest.dreamNote;
  return rest;
}
export function withoutDream(result) {
  const told = result.dream;
  if (told === undefined)
    return result;
  const injection = result.injection === null ? null : result.injection.split(`
`).filter((l) => l !== told.context).join(`
`);
  const rest = { ...result, injection };
  delete rest.dream;
  return rest;
}
