/**
 * The hooks — this host's sensory and motor surface.
 *
 * Everything host-specific lives here so the core stays host-agnostic
 * (constitution 5). What a session is to this memory whatever the host — the
 * wake's composition, recall for a turn, the boundary, the ask's pacing, the
 * write-up pointer, the registry writes, the worker — is `../lifecycle.ts`'s
 * `Lifecycle` (2026-09-30), which `ClaudeCodeAdapter` extends; this file keeps
 * what is Claude Code's: its five events, its envelope and the room it
 * measures, its transcript's delivery check, the Stop ask's words, the
 * parallel run's primacy, the notices and the dream line. The rules this file
 * mechanizes, each from the CONTRACT (some of them now in the lifecycle's
 * methods it calls):
 *
 *   **G2 — no hook ever fails the host.** Every entry point below is wrapped in
 *   `guard()`: one try/catch, one logged failure, one safe return. There is no
 *   path out of this file that throws.
 *   **G3 — every session-ending path reaches the boundary.** `SESSION_ENDING`
 *   is the enumeration and `BOUNDARY_KIND` the mapping; `test/claude-code.test.ts`
 *   walks the list and asserts each one claims spans. Compaction destroying the
 *   transcript must not destroy the day (spec §2 G5).
 *   **G4 — host limits are reported, not assumed.** The injection ceiling comes
 *   from configuration and reaches the core as an argument; a bundle that
 *   exceeds it is an EVENT, never a silent truncation (scar §2.18/§2.4).
 *   **G7 — an observer stands down at the hook boundary**, and says so.
 *   **G8 — the read cursor is per-session and advances after a successful
 *   append**, which is `remember/`'s property; the adapter's job is to hand it
 *   the same session key every time and never to re-slice the transcript itself.
 *   **§2.3 — delivery telemetry is distinct from render telemetry.** The wake
 *   states its own sentinel; the FIRST PROMPT of the session reads the head of
 *   the host's transcript and reports what the host recorded as injected. The
 *   expectation is carried in the session registry record, because every hook is
 *   its own process. v1 shipped eleven days of truncated wakes because only the
 *   render was instrumented.
 *   **§2 G10/G11 — conversational text only, and injected context is excluded
 *   from PACING but kept in CAPTURE.** `substanceOf` counts one and
 *   `captureSpans` receives the other; the two are computed from the same turns
 *   in the same function, so they cannot drift apart.
 *   **The parallel run's G3/G5 — exactly one system delivers, and the shadow is
 *   ENCODE-ONLY.** Behind `parallel.enabled` (absent by default), every
 *   DELIVERING hook asks `primacy.ts` first and stands down when the answer is
 *   anything but a clean "engram". A stand-down withholds the wake, the recall
 *   and both asks; it withholds NOTHING from capture, because the shadow's whole
 *   job is to encode the same days v1 encodes. Both verdicts are durable
 *   (parallel-run G4: the mute is evidenced, not asserted).
 */
import {
  CHECKOUT_EVENT,
  ENVELOPE_GAVE_WAY_EVENT,
  ENVELOPE_OVERCAP_EVENT,
  INJECTION_OVERBUDGET_EVENT,
  NOTICE_DROPPED_EVENT,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  WAKE_DELIVERED_EVENT,
  WAKE_INJECTED_EVENT,
} from "../../core/counterpart.js";
import type { PlainReminder } from "../../core/counterpart.js";
import { newNightRunId } from "../../core/dream/index.js";
import type { DreamOffer } from "../../core/dream/index.js";
import type { BoundaryKind } from "../../core/remember/index.js";
import { homedir } from "node:os";

import { CODE_TAB_ENTRYPOINT, isDesktopScratchWorkspace } from "../hosts.js";
import { scopeCommand, scopeCommandContext, stanceOfMode } from "../scopes.js";
import type { ScopeCommandContext } from "../scopes.js";
import {
  NON_INTERACTIVE_ENTRYPOINTS,
  decideUpdateNotice,
  installedBuild,
  isLive,
  markUpdateNoticeShown,
  readSession,
  recordSession,
  stampSessionOpened,
} from "../sessions.js";
import type { SessionRecord } from "../sessions.js";
import { Lifecycle, codeOf, plainContextLine, plainLine } from "../lifecycle.js";
import type { LifecycleOptions, PlainLines, SessionInput } from "../lifecycle.js";

import { localDate } from "../../core/time.js";
import { TUNABLES } from "../config.js";
import { TUNABLES as RECALL_TUNABLES } from "../../core/recall/tunables.js";
import { SESSION_NOTICE_BUDGET_MS, checkoutIsGraded, doctorFindings, noticeMessage, readCheckout } from "./doctor.js";
import type { CheckoutReading } from "./doctor.js";
import { primacy } from "./primacy.js";
import { nightTimeoutMs, planNightRunner } from "./night-run.js";
import type { NightKind } from "./night-run.js";
import { spawnDetached } from "../spawn.js";
import type { SpawnOutcome } from "../spawn.js";
import { NO_ARRIVAL, STOP_ASK_OPENER, readWakeArrival } from "./transcript.js";
import type { WakeArrival } from "./transcript.js";

/**
 * WHAT MOVED TO THE LIFECYCLE, named here too (2026-09-30): this file's public
 * surface — and `index.ts`'s, which re-exports it — is what it was before the
 * host-neutral half moved out, so a caller that imported any of these from the
 * hooks still finds them.
 */
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
  writeUpPointer,
} from "../lifecycle.js";
export type { AdapterEvent, HostTurn } from "../lifecycle.js";

/** Every hook this adapter installs, by the name it is wired under. */
export const HOOKS = [
  "session-start",
  "user-prompt-submit",
  "stop",
  "session-end",
  "pre-compact",
] as const;
export type HookName = (typeof HOOKS)[number];

/**
 * The session-ending paths. THREE, not one — the whole point of G3. `stop` is
 * the ordinary turn end, `session-end` is the host closing the session, and
 * `pre-compact` is the transcript about to be destroyed.
 */
export const SESSION_ENDING = ["stop", "session-end", "pre-compact"] as const;
export type SessionEndingHook = (typeof SESSION_ENDING)[number];

/** Host event name → `remember/`'s boundary vocabulary. Total by construction. */
export const BOUNDARY_KIND: Record<SessionEndingHook, BoundaryKind> = {
  stop: "stop",
  "session-end": "session-end",
  "pre-compact": "pre-compaction",
};

/**
 * One hook event's input: the lifecycle's `SessionInput` (session, scope, the
 * transcript's turns and expansions — `transcript.ts#Expansion` — the prompt,
 * the model, the date, the nightly run's quiet, the entrypoint), and the two
 * facts only this host has.
 */
export interface HookInput extends SessionInput {
  /**
   * WHERE THE HOST IS KEEPING THIS SESSION'S TRANSCRIPT — the path the payload
   * named, carried so the delivery check can read the head of it and see what
   * the host recorded as injected at SessionStart (`transcript.ts`). The turns
   * above come from the same file, parsed for conversation; this is the same
   * file read for the one thing that parse deliberately skips.
   */
  readonly transcriptPath?: string;
  /**
   * THE HOST'S RE-FIRE. A blocked Stop comes back with `stop_hook_active`, and
   * that pass must ask nothing — v1's anti-loop, kept for the same reason. It is
   * checked HERE, not only at delivery, so the re-fire also burns no pacing and
   * no day-cap slot: a silent ask that still advanced the counters would spend
   * the day's chapters on nobody.
   */
  readonly reFired?: boolean;
  /**
   * IS A PERSON ATTENDING THIS SESSION, as the host says it
   * (`CLAUDE_CODE_SESSION_ATTENDED`, 2026-10-01): `1` read as true, `0` as
   * false, anything else or absent as unknown. Found in the environment Claude
   * Code gives the processes it starts (a terminal session read `1`, with
   * `CLAUDE_CODE_ENTRYPOINT=cli`). When present it decides `isInteractive`;
   * the entrypoint list is the fallback.
   */
  readonly attended?: boolean;
}

export interface HookResult {
  readonly hook: HookName;
  readonly ok: boolean;
  readonly reason: string;
  /** What to add to the host's context. The EMPTY STRING on a quiet hook. */
  readonly injection: string;
  readonly bytes: number;
  /**
   * The render's own tail line. At SessionStart it is also the expectation the
   * delivery check tests: it is written into the session registry record, and
   * the session's first prompt compares it against what the host's transcript
   * says arrived.
   */
  readonly sentinel: string | null;
  readonly surfaced: readonly string[];
  readonly footnotes: readonly string[];
  /**
   * THE ask this hook raises — at a Stop, memories and the chapter, one text,
   * one pacer. Null when this Stop is not due one. There is exactly one field
   * because there is exactly one ask at a boundary: two fields is how the
   * blocked moment grew back into two asks (§13 G3).
   *
   * SessionStart uses the same field for the first-launch scope question
   * (`scopeAsk`, G41) and, since S2, for the nightly page writer's block. It
   * is the same field for the same reason: it is the one channel that reaches
   * the model WITHOUT being inside the wake bundle, whose byte count and tail
   * line are stated by its own sentinel.
   *
   * **Three claimants, and the rule is not "they cannot collide" any more** —
   * that sentence was true when there were two, one at `session-start` and one
   * at `stop`. The Stop ask still cannot meet either of the others, and the
   * Stop pacer is untouched by both. The two SessionStart ones CAN want the
   * field on the same morning, and there the first-launch question wins: it is
   * asked once in the life of a directory and ends when anybody answers, while
   * the writer's comes back tomorrow at no cost. The loser is deferred with an
   * event, never concatenated — two unrelated requests in front of a session
   * that has just woken is the shape §13 G3 is about, even though the pacer is
   * not involved.
   */
  readonly ask: string | null;
  readonly spansAppended: number;
  readonly spawn: SpawnOutcome | null;
  readonly observer: boolean;
  /**
   * Lines for the PERSON — the host's `systemMessage`, which their terminal
   * shows (`bin/hook.ts#hostDelivery`). Today only plain reminders
   * (`Counterpart.plainDueToday`, 2026-09-26), at SessionStart and at a
   * prompt; absent when there are none. The same lines also ride in
   * `injection` (`plainContextLine`), for the model, so it can raise them.
   *
   * NOT YET CLAIMED (2026-09-26 review): `plain` is the records behind these
   * lines, in the same order, and the delivery claims them only once it knows
   * the envelope carries them (`bin/hook.ts#deliverTurn` → `claimPlain`); what
   * it cannot carry, or loses the race for, is stripped (`withoutPlain`) and
   * waits for the next prompt.
   */
  readonly notices?: readonly string[];
  readonly plain?: readonly PlainReminder[];
  /**
   * THE DAY'S DREAM LINE FOR THE PERSON (2026-09-29), at a prompt: shown in
   * the terminal beside the model's line, which already rides in `injection`.
   * NOT YET CLAIMED when `offer` is set — the delivery claims the day only once
   * it knows the envelope carries the person's line (`bin/hook.ts#deliverTurn`
   * → `claimDream`), and otherwise strips the model's line (`withoutDream`) so
   * the next prompt offers it again.
   */
  readonly dream?: DreamTold;
  /**
   * THE ONE-TIME LINE about `auto` set back to `ask` on this version (owner
   * decision A, 2026-09-29): shown in the terminal once, claimed at delivery
   * (`claimDreamNote`); its model line is stripped when it cannot be shown.
   */
  readonly dreamNote?: { readonly notice: string; readonly context: string };
}

/** The day's dream line, as a prompt carries it (`HookResult.dream`). */
export interface DreamTold {
  /** The person's line, for the terminal. */
  readonly notice: string;
  /** The model's line exactly as it sits in `injection` (one line). */
  readonly context: string;
  /** The offer still to claim at delivery, or null when the day is already claimed. */
  readonly offer: DreamOffer | null;
  /**
   * The run whose HELD line this is (2026-10-01, lane 8): a run a session
   * nobody sees started, told here to an interactive one and claimed at
   * delivery (`ClaudeCodeAdapter#claimHeld`). Absent on the day's own line.
   */
  readonly held?: string;
}

/**
 * IS SOMEONE WATCHING THIS SESSION? (2026-10-01, lane 8.) The day's told lines
 * — the dream line, a night run's hand-back, a carried share, a raised
 * contradiction, plain reminders, the update notice — are claimed once and
 * never come back, so only a session a person can see may claim them: the
 * terminal (`cli`), Desktop's Code tab (`claude-desktop`), and any value this
 * code does not know. A headless or SDK one (`sessions.ts#NON_INTERACTIVE_
 * ENTRYPOINTS`: `claude -p` is `sdk-cli`) — or, first, one the host itself
 * says nobody attends (`HookInput.attended`) — leaves them for the next session
 * that is; it may still START the nightly run. Measured 2026-10-01: the day's
 * first prompt came from an SDK session with no terminal, which started the
 * run (fine) and claimed the dream line (nobody saw it).
 */
export function isInteractive(input: Pick<HookInput, "entrypoint" | "attended">): boolean {
  if (input.attended !== undefined) return input.attended;
  return input.entrypoint === undefined || !NON_INTERACTIVE_ENTRYPOINTS.has(input.entrypoint);
}

/** No plain reminders: what a session nobody watches is handed. */
const NO_PLAIN: PlainLines = { context: "", notices: [], due: [] };

/**
 * The lifecycle's options (`../lifecycle.ts#LifecycleOptions`: the brain, the
 * configuration, the worker's command, the clock, which configuration file this
 * process read, the scope verdict) and the one only this host has.
 *
 * The scope verdict does two things here beyond the lifecycle's record of it:
 * when it is `unset`, the first-launch question is appended to the wake, once
 * per session (G41). The `off` decision is NOT here: it is made in the entry
 * point, because "no output and no write" is only a guarantee if nothing was
 * constructed. `guard()` still refuses on it as a second, cheap site, for the
 * same reason the observer stand-down lives at the store seam as well as at
 * the entry point (observer-mode G8).
 */
export interface AdapterOptions extends LifecycleOptions {
  /**
   * The args that run `bin/nightly.ts` under `command` — the headless nightly
   * run's own process (2026-09-29). Absent: the headless run cannot start, and
   * the day's line asks instead (`could-not-start`, reason `runner`).
   */
  readonly nightArgs?: readonly string[];
  /**
   * What the console line the first-launch question names needs to work where
   * it is typed (`scopes.ts#ScopeCommandContext`): the plugin's launcher under
   * the plugin, and `--config` when the registry this hook read is not the
   * default's. Absent (a test, an embedder): the npm install's `counterparts`,
   * with `--config` only when `configPath` names another registry.
   */
  readonly scopeCommand?: ScopeCommandContext;
}

/**
 * THE FIRST-LAUNCH QUESTION (owner ask G41, 2026-09-10).
 *
 * The hooks are registered globally, so the first session in a new directory
 * already has capture running by the time anyone could have been asked. The
 * honest fix the owner asked for is a question asked once and remembered — and
 * the host offers `SessionStart` as the only place to ask and no place at all
 * to receive an answer, which is `INTERFACE-GAPS.md` gap 7's shape all over
 * again. So the block asks the MODEL to ask the PERSON, and names the console
 * line that records the reply.
 *
 * THE LINE NAMES THE FOLDER (2026-10-10, the follow-up to #362). It said
 * `counterparts scope . --on`, and `.` is wherever the shell stands when the
 * line is run: after a `cd` into a subfolder the answer landed on the
 * subfolder, and the session's own folder stayed unset. So it names the
 * session's folder, with the plugin's launcher and `--config` when this
 * install needs them (`scopes.ts#scopeCommand`). An `unset` folder has no
 * entry above it, so there is no inherited setting to name instead.
 *
 * Advisory wording, mechanized existence (CONTRACT §5 G9): what is guaranteed
 * is that an `unset` directory raises the question exactly once per session and
 * that setting any mode ends it, not the sentences.
 */
export function scopeAsk(folder: string, ctx: ScopeCommandContext): string {
  return [
    SCOPE_ASK_OPEN,
    "No setting yet for this directory, so Counterparts is remembering here by default.",
    "Early on, ask the user once which they want: on, observer (reads and recalls, records",
    "nothing), or off (nothing at all). Record the answer with the `scope` tool (mode: on |",
    `observer | off), or with \`${scopeCommand(folder, "--on", ctx)}\` (\`--observer\` or \`--off\``,
    "in place of `--on`). Then do not ask again.",
    "</counterparts-scope>",
  ].join("\n");
}

/** The first-launch question's opening tag, which no other block uses. */
export const SCOPE_ASK_OPEN = "<counterparts-scope>";

/** The budget a SessionStart's asks are measured against: the form the
 *  envelope will take, what the wake and its lead already cost in it, and how
 *  a piece of text is counted there. `plain` is how many reminders ride. */
interface EnvelopeRoom {
  readonly form: "json" | "plain";
  readonly spent: number;
  readonly limit: number;
  readonly cost: (text: string) => number;
  readonly plain: number;
}

/** What rode beside the wake when the pointer was measured, in words for
 *  doctor ("the first-launch question and 1 plain reminder"), or "". */
function besideWords(question: boolean, plain: number): string {
  const parts = [
    ...(question ? ["the first-launch question"] : []),
    ...(plain > 0 ? [`${String(plain)} plain reminder${plain === 1 ? "" : "s"}`] : []),
  ];
  return parts.join(" and ");
}

/**
 * THE PAGE'S TOOL, as a session's model names it. The nightly page writer's
 * SessionStart ask (S2, 2026-09-20 — "the first session of the next day is
 * handed that day") was RETIRED on 2026-09-28: the writer moved into the
 * nightly run (writer, then dream, then reflection, one background agent) and
 * gets its day through the dream tool's `writer` phase — a tool result, with
 * no injection ceiling, so no `no-room` deferral and no contest with the
 * first-launch question for the ask field. (Host mode, a windowless child
 * for the writer alone, was removed on 2026-09-29.)
 */
export const PAGE_WRITER_TOOL = "counterparts self_page";

/**
 * THE NEXT-SESSION WRITE-UP'S POINTER (roadmap C2) — its words, constants and
 * rules are the lifecycle's since 2026-09-30 (`../lifecycle.ts#writeUpPointer`,
 * `Lifecycle#deliverWriteUpAsk`), re-exported above. This host puts it beside
 * the wake in `HookResult.ask`, measured against the room its envelope has
 * (`sessionStart`).
 */
/**
 * THE ONE STOP ASK — v2's front door and its journal, in one text.
 *
 * The wording is advisory (remember G11 [A], CONTRACT §5 G9); that an ask exists
 * at a session-ending path is what is mechanized. It names the TOOLS, because
 * the RETURN channel is a tool, not a hook: a hook can only put text into the
 * context, and the deposits come back through `Counterpart.submitSessionEnd`
 * and `Counterpart.appendEpisode` — reached, in this host, by the MCP adapter's
 * `session_end` and `chapter` (`mcp/CONTRACT.md`). Filed in
 * `INTERFACE-GAPS.md` §7.
 *
 * **ONE ask, not two.** Behavioral-spec §13 G3 said it in v1's words — "the
 * blocked moment carries a single ask; new features do not get to grow it back
 * into two" — and v2 grew it back into two anyway: the authorship ask on its own
 * turn/byte pacer and the episode ask on the chapter pacer, firing at different
 * Stops. Measured 2026-09-04: about a dozen asks in a 13-turn evening. They are
 * one text on one pacer here, and the pacer is the chapter's.
 *
 * The other corrections, all measured the same day:
 *
 *   - **It names the session id and both tools.** The host's MCP servers are
 *     launched from a static config and never learn which session they are
 *     serving, so the id has to travel in the ask — it is what the server binds
 *     itself with (`adapters/sessions.ts`, `mcp/server.ts#requireBoundSession`).
 *     Without it the model reached for `note` (now `remember`) 34 times in one session and no
 *     session's dump ever landed. On the Stops where only the episode half
 *     fired, the model got no id and no tool name at all.
 *   - **`updates` is a FIELD.** The old wording said "say `updates: <id>`",
 *     and four notes duly arrived with `updates: mem_x.` as the first words of
 *     their prose — unlinked, because prose is not a field. It is a field on a
 *     `session_end` entry AND on `remember`, and since B1 it is the tool
 *     description that says so, not this text.
 *   - **The chapter number is the store's.** It is one past what was WRITTEN,
 *     never one past what was asked, so an unanswered ask does not silently
 *     renumber the journal.
 *   - **Salience is the author's to set.** An unclaimed authored memory takes
 *     a modest default floor, deliberately below the semantic band (`physics/`,
 *     2026-09-04), and the author's own claim is the only channel by which
 *     lived testimony outranks something a sweep noticed — the sweep's claim is
 *     capped where the author's is not. Since B1 the `salience` field's own
 *     description carries this.
 *
 * **SPLIT IN TWO, AND SHORT (B1, owner 2026-09-23).** The person used to read
 * all nine lines of this after every due Stop, printed as `Stop hook error:`,
 * though every word was written for the model (new-user finding #28). Now:
 *
 *   - the PERSON gets `STOP_HUMAN_LINE` — one plain line saying what is
 *     happening, carried as the hook's `systemMessage`
 *     (`bin/hook.ts#hostDelivery`);
 *   - the MODEL gets this: two numbered lines, both naming the session id and
 *     the tool that takes it, plus the two clauses that are about WHETHER to
 *     write — `handoff` only if work here is unfinished (it is a field on the
 *     same `session_end` call, not a third tool and not a second ask: §13 G3),
 *     and, since 2026-10-01, `retireHandoff` for a handoff here whose work is
 *     done, whoever left it (a handoff that waited on a release never learned
 *     the release landed: random-f2's item 1),
 *     and, also since 2026-10-01 (lane 8), to `updates` anything dated or open
 *     that got done here — a dated follow-up kept arriving after it was done,
 *     because nothing prompted the session to close it; how (`eventDate:
 *     null`, `unresolved: false`) is on the field's own description,
 *     and "nothing worth keeping is a real answer", which the server now
 *     accepts as `memories: []`.
 *
 * **WHAT CAUGHT YOUR ATTENTION, NOT WHAT'S WORTH KEEPING (2026-10-10, Group
 * 1c; 01 C1's text, verbatim).** "What's worth keeping" and "nothing worth
 * keeping is a real answer" were the filter: measured on the 10-10 snapshot,
 * what reached memory at the ask was work status rephrased as lasting fact,
 * and what it kept out was the passing material — a line read, news, a thing
 * said in passing — which nothing else would ever write, since the sweep has
 * been off since 09-24. The ask now asks for what caught attention since the
 * last write, one idea each, and names the three kinds. `[]` stays a legal
 * answer, said on the `memories` field, not here (01 D4). The ask is the
 * BACKSTOP: `remember`'s own text asks for the moment. With a real id and a
 * four-digit chapter number it is 474 characters, inside the 480 pin.
 *
 * Everything else the old text said — `updates` is a FIELD, salience is a floor
 * and the author's to claim, what an episode is for, what a handoff is — is
 * in the tools' own descriptions (`mcp/tools.ts`), where the model reads it at
 * the moment it fills the fields. Saying it again at every Stop is what made
 * this a wall.
 *
 * It opens with `STOP_ASK_OPENER` (`transcript.ts`), which is how the reader
 * recognises this text coming home on a host-written entry and refuses it from
 * capture (`ritual`, CONTRACT §5 G11) whichever emission shape carried it —
 * today's `additionalContext`, or the stderr and `reason` shapes older
 * transcripts hold.
 */
export function stopAsk(sessionId: string, chapter: number): string {
  return [
    `${STOP_ASK_OPENER} 1) hand back what caught your attention since you last wrote, one idea each — what you read, what they said, what happened — with the counterparts session_end tool, session: ${sessionId}. \`handoff\` only if work here is unfinished; \`retireHandoff\` any now done; \`updates\` anything dated or open now done.`,
    `2) Write chapter ${String(chapter)} with the counterparts chapter tool, session: ${sessionId}.`,
  ].join("\n");
}

/** Re-exported where the hooks' callers already look (`hosts.ts` owns it). */
export { CODE_TAB_ENTRYPOINT };

/**
 * THE ONE WAKE LINE A CODE-TAB SESSION GETS (2026-10-01). Measured: in Desktop's
 * Code tab the `counterparts` tools the model sees come from Claude Desktop's
 * own server (same name, shadowing this session's), which serves every Desktop
 * chat and cannot tell this session's calls from a chat's unless they name it.
 * So the wake states the id, once. The Stop ask needs no such line: it already
 * says `session: <id>` on the two tools it names, which take it everywhere.
 * Null outside the Code tab — a terminal session's wake is byte for byte what
 * it was.
 */
export function codeTabSessionLine(input: Pick<HookInput, "entrypoint" | "sessionId">): string | null {
  if (input.entrypoint !== CODE_TAB_ENTRYPOINT || input.sessionId.length === 0) return null;
  return `Counterparts, Desktop's Code tab: if your counterparts tools take a \`session\` parameter, pass session: ${input.sessionId} on every call — it is how they know this session from a Desktop chat.`;
}

/**
 * WHAT THE PERSON SEES WHEN THE STOP ASK GOES OUT — one line, theirs (B1).
 *
 * The owner's rule, 2026-09-23: "whatever we display in terminal should be
 * short and useful to the user since they're the one seeing it". It says what
 * is happening and who is doing it, and nothing the person has to act on.
 * Carried as the Stop hook's `systemMessage`, beside the ask's
 * `additionalContext` (`bin/hook.ts#hostDelivery`). The host also shows the
 * ask itself to the person, as `Stop hook feedback: …` — quieter than the
 * `Stop hook error:` it replaced (2026-09-24), not hidden.
 */
export const STOP_HUMAN_LINE = "Counterparts: asking the assistant to write up this session's memories.";

/**
 * THE CLAUDE CODE ADAPTER: the host lifecycle (`../lifecycle.ts#Lifecycle`),
 * driven by this host's five hook events. It EXTENDS the lifecycle rather than
 * holding one, so a hook body calls `this.composeWake`, `this.captureBoundary`,
 * `this.deliverWriteUpAsk` exactly where it called its own methods before
 * 2026-09-30, in the same order.
 */
export class ClaudeCodeAdapter extends Lifecycle {
  private readonly nightArgs: readonly string[] | undefined;
  private readonly scopeCommandCtx: ScopeCommandContext | undefined;
  /** The anti-loop guard: one hook per session in flight at a time. */
  private readonly inFlight = new Set<string>();

  constructor(opts: AdapterOptions) {
    super(opts);
    this.nightArgs = opts.nightArgs;
    this.scopeCommandCtx = opts.scopeCommand;
  }

  // ── session start: the wake ────────────────────────────────────────────────

  /**
   * Inject what the previous boundary published. Zero compute, zero model calls,
   * zero network (§1 G1) — and THE WAKE NEVER FAILS THE SESSION (§1 G7): every
   * failure below returns the empty string and a clean exit.
   */
  sessionStart(input: HookInput): HookResult {
    return this.guard("session-start", input, (out) => {
      // ASKED BEFORE THE REGISTRY IS REWRITTEN: `noteSession` rewrites the
      // record whole, so the flag that says "this session has already been
      // asked" has to be read while it is still the previous process's answer.
      const wantsAsk = this.scopeAskDue(input);
      // BEFORE the delivery verdict, because the registry is not delivery: a
      // muted shadow still lives a session, and the tool that writes its dump
      // still has to be able to find out that the session is real.
      this.noteSession("start", input);
      // FIRST, before anything is read or composed: is this ours to deliver?
      // A stand-down sets no delivery expectation, because there is no render
      // for the next hook to check — recording one would put a false negative
      // into scar §2.3's telemetry on every muted day.
      if (!this.deliveryVerdict("session-start", input)) {
        return { ...out, ok: true, reason: "primacy-standdown" };
      }
      const budget = this.config.injectionBudgetBytes;
      if (budget === undefined) {
        // The tripwire. We inject what exists, and we say that nobody told us
        // what this host can carry — an invented ceiling is scar §2.18.
        this.emit("adapter.budget.unreported", {});
      }
      // THE DELIVERY PREFACE is asked for here, at injection, and composed
      // nowhere else. The stored bundle was rendered at the last boundary and is
      // served unchanged to every session until the next one; on 2026-09-03 the
      // memory system under this host changed mid-day and the body went on
      // speaking as the old one, with only the HTML comment naming the new. The
      // date is the HOST's — this hook is the only place that has it — and
      // nothing in the line varies between two sessions of the same day, so the
      // delivery expectation below stays a stable string (§2.3).
      // WHERE this session woke rides beside WHEN (E1). The published bundle is
      // one per store and is read by sessions in every directory, so which
      // directory this one opened in is a delivery-time fact exactly as the date
      // is — and it is the only thing that can decide whose handoff pointer,
      // if any, belongs at the foot of this wake.
      // The composition and THE EXPECTATION, written where the next process
      // can read it (`Lifecycle#composeWake` → `noteWakeExpectation`).
      const woke = this.composeWake(input, budget);
      // The wake has just said what the other directories did today, so the
      // prompt's "Since you started" line counts from here (2026-10-11).
      this.noteSinceWoke(input);

      // THE PERSON'S CLOCK, as the wake's first line (docs/time.md rule 5,
      // 2026-09-25): `Now: Fri 25 Sep 2026, 1:40 pm MDT`, in the store's zone.
      // OUTSIDE the wake block, above its opening comment, so the block's own
      // byte count, both sentinels and the preface's reserve are untouched —
      // the delivery check finds its sentinels by prefix, not by line number.
      // It is counted wherever the host's ceiling is: the over-budget event
      // and the room an ask may take both measure `sent`, not `woke.bytes`.
      // PLAIN REMINDERS DUE TODAY (2026-09-26) ride right under the clock, outside
      // the wake block like the clock itself, and go to the person too
      // (`notices`). NOT claimed here: the delivery claims them once it knows
      // the envelope carries them, and a full wake that leaves no room sends
      // them to the first prompt instead (`bin/hook.ts#deliverTurn`).
      //
      // ONE BUDGET FOR THIS ENVELOPE (2026-09-29, audit item 9; made real by the
      // review of #285, S2): everything this event prints is measured against
      // one budget, and gives way in this order, first to last — each
      // DEFERRED, never cut, so nothing is spent on a line the session did
      // not get:
      //   1. the owner's notices (doctor, registry) — `bin/hook.ts#hostDelivery`
      //      drops them when either field of the JSON form would pass the
      //      host's cap (`fieldsFit`);
      //   2. the write-up pointer — the next start in this project is pointed;
      //   3. the first-launch scope question — the next session asks;
      //   4. plain reminders due today — the first prompt says them, its
      //      envelope is small, and their beat is not spent here;
      //   5. the wake, never cut here: it was composed to its own budget at the
      //      boundary, where it trims hints → craft → threads → horizon →
      //      identity, identity last. The clock line rides with it.
      // THE BUDGET IS THE MODEL'S FIELD, WHATEVER FORM THE ENVELOPE TAKES
      // (2026-10-10). The host caps each field of the JSON form on its own,
      // so the wake and its asks have `HOST_OUTPUT_CHARS` (in bytes, the safe
      // direction) in either form, and the reminders' line is the other field.
      // A plain reminder reaches the person only inside the JSON form, so it
      // rides when the wake and its context lines fit the model's field; the
      // asks are then measured beside it and it is they that give way, not the
      // reminder. A wake that does not leave the reminders room sends them to
      // the first prompt (the delivery decides, `deliverTurn`). Until
      // 2026-10-10 the JSON form was held to 9,500 characters of whole,
      // escaped envelope (`ENVELOPE_CHARS`), which cost a full wake its
      // reminders and both asks. What actually gave way is recorded by the
      // delivery (`noteGaveWay`) and by each ask's own deferral.
      const plain = isInteractive(input) ? this.plainFor(input) : NO_PLAIN;
      // DESKTOP'S CODE TAB (2026-10-01): one line, right under the clock,
      // naming this session's id — there the counterparts tools the model sees
      // are Claude Desktop's server, which serves a call as this session only
      // when the call names it. A terminal session's wake is unchanged.
      const codeTab = codeTabSessionLine(input);
      const lead = `${woke.text.length === 0 && plain.context.length === 0 && codeTab === null ? "" : `${this.nowLine()}\n`}${codeTab === null ? "" : `${codeTab}\n`}${plain.context}`;
      const sent = woke.bytes + Buffer.byteLength(lead, "utf8");
      const rides =
        plain.due.length > 0 &&
        sent <= TUNABLES.HOST_OUTPUT_CHARS &&
        Buffer.byteLength(plain.notices.join("\n"), "utf8") <= TUNABLES.HOST_OUTPUT_CHARS;
      const room: EnvelopeRoom = {
        form: rides ? "json" : "plain",
        spent: sent,
        limit: TUNABLES.HOST_OUTPUT_CHARS,
        cost: (t) => Buffer.byteLength(t, "utf8"),
        plain: rides ? plain.due.length : 0,
      };
      if (budget !== undefined && sent > budget) {
        // Exceeding a reported limit is an EVENT, never silent degradation. The
        // bundle still goes: truncated-and-detectable beats absent.
        this.noteDeliveryWarning(INJECTION_OVERBUDGET_EVENT, { hook: "session-start", bytes: sent, budget }, input);
      }
      this.record(WAKE_INJECTED_EVENT, input, {
        ok: woke.ok,
        reason: woke.reason,
        bytes: woke.bytes,
        budget: budget ?? null,
        sentinel: woke.sentinel !== null,
        preface: woke.preface !== null,
        // THE DURABLE HALF of a registry in trouble (#92 review, F2). It rides
        // the session-start row this hook already writes, for the reason
        // `adapter.scope.unreadable` is ring-only: a durable event NAME is a
        // core change (`AdapterDurableEventName`) and this fact is about
        // exactly the moment that row describes.
        scopeRegistry: this.scopeTrouble,
        // WHETHER ANYBODY COULD BE TOLD ANYTHING HERE (review of #337): the
        // same test that decides whether this session is handed plain
        // reminders. The `fired` report's plain-due check reads it, so a day
        // only the headless run or `claude -p` came is not a day a reminder
        // could have been said.
        interactive: isInteractive(input) && input.nightRun !== true,
      });
      // THE QUESTION RIDES BESIDE THE WAKE, NEVER INSIDE IT, and only if it
      // FITS.
      //
      // Beside, because the wake's own accounting is load-bearing: its sentinel
      // states the bundle's byte count and must be the LAST line of the bundle,
      // so a truncated wake is detectable from its tail alone (§1 G2, scar
      // §2.3). Text appended inside the injection would make `bytes`, the
      // sentinel's number and the tail all disagree — three lies to deliver one
      // question. `ask` is the field the host delivery already appends after
      // the injection (`bin/hook.ts#hostDelivery`), which is exactly the
      // placement asked for and costs the wake nothing.
      //
      // And only if it fits, because what the host places in context is the
      // whole block: the ceiling it reported governs the wake's bytes plus this
      // one's. With no room the ask is DEFERRED rather than truncated or
      // smuggled past the limit — the session record is left unmarked, so the
      // next session in this directory asks instead, and the deferral is an
      // event rather than a silence.
      //
      // ONE ASK WANTS THIS FIELD NOW: the first-launch question. The nightly
      // page writer's ask used to contend for it (and after two mornings of
      // losing went first); since 2026-09-28 the writer runs inside the
      // nightly run and is handed its day through a tool result instead.
      const chosen = wantsAsk ? this.deliverScopeAsk(input, room) : "";
      // THE WRITE-UP POINTER RIDES AFTER WHICHEVER ASK TOOK THE FIELD, never
      // instead of it (C2): it may coincide with either, it is measured against
      // the room BOTH of them left, and it is fail-open by construction — a
      // throw inside it costs the pointer and never the wake or the other ask.
      const chosenBytes = chosen.length === 0 ? 0 : room.cost(`\n\n${chosen}`);
      const writeUp = this.deliverWriteUpAsk(input, room.spent + chosenBytes, {
        limit: room.limit,
        cost: room.cost,
        beside: besideWords(chosen.length > 0, room.plain),
      });
      const asks = [chosen, writeUp].filter((a) => a.length > 0).join("\n\n");
      return {
        ...out,
        ok: woke.ok,
        reason: woke.reason,
        injection: `${lead}${woke.text}`,
        bytes: woke.bytes,
        sentinel: woke.sentinel,
        ask: asks.length === 0 ? null : asks,
        ...(plain.due.length === 0 ? {} : { notices: plain.notices, plain: plain.due }),
      };
    });
  }

  /**
   * Is this session owed the first-launch question (G41)?
   *
   * Three ways to be owed nothing: the directory has an entry (somebody
   * answered, whatever they answered); this session was already asked; or this
   * is an instrument, which has no business asking a person to change a store
   * it may not write — and, having written no session record, no way to
   * remember that it did.
   */
  private scopeAskDue(input: HookInput): boolean {
    if (this.scope.mode !== "unset") return false;
    if (this.observer) {
      this.emit("adapter.scope.ask.skipped", { reason: "observer" });
      return false;
    }
    if (input.sessionId.length === 0 || input.nightRun === true) return false;
    // A FOURTH (2026-09-30): Claude Desktop's Code tab, started with "No
    // folder", runs in a scratch directory it deletes with the session — an
    // answer recorded for it would outlive the folder it names.
    if (isDesktopScratchWorkspace(input.scope)) {
      this.emit("adapter.scope.ask.skipped", { reason: "scratch-workspace" });
      return false;
    }
    try {
      return readSession(this.counterpart.store.dir, input.sessionId)?.askedScope !== true;
    } catch {
      // A registry this cannot read is not a reason to ask twice OR to fail a
      // hook; the quiet answer is the safe one.
      return false;
    }
  }

  /**
   * Deliver the question, and remember that it was delivered. Returns the block
   * to append, or the empty string when there was no room for it. `budget` is
   * the envelope's one budget (the host's cap) since 2026-09-29; it was the
   * reported injection budget before, a second ceiling beside the pointer's.
   */
  private deliverScopeAsk(input: HookInput, room: EnvelopeRoom): string {
    const ask = scopeAsk(
      input.scope,
      this.scopeCommandCtx ?? scopeCommandContext({ configPath: this.configPath, pluginRoot: null, home: homedir() }),
    );
    const need = room.cost(`\n\n${ask}`);
    if (room.spent + need > room.limit) {
      this.emit("adapter.scope.ask.deferred", {
        wakeBytes: room.spent,
        budget: room.limit,
        need,
        form: room.form,
      });
      this.noteDeliveryWarning(ENVELOPE_GAVE_WAY_EVENT, { hook: "session-start", part: "question", form: room.form }, input);
      return "";
    }
    // The mark is a SECOND write of the same phase rather than a field folded
    // into the first: the first write happens before the delivery verdict (a
    // muted session still lives one) and the ask is decided after the wake, so
    // one write cannot carry both facts without moving the other.
    const marked = recordSession(this.counterpart.store.dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase: "start",
      at: this.nowFn(),
      askedScope: true,
      ...this.recordStamp(),
    });
    this.emit("adapter.scope.ask", { bytes: Buffer.byteLength(`\n\n${ask}`, "utf8"), recorded: marked !== null });
    return ask;
  }

  // ── the turn ───────────────────────────────────────────────────────────────

  /**
   * Recall for this turn. The check that the SESSION'S WAKE ARRIVED runs first,
   * once per session (scar §2.3), then the composed recall — all three borrowed
   * channels bound by the composition root, with today's date so the temporal
   * channel exists.
   */
  userPromptSubmit(input: HookInput): HookResult {
    return this.guard("user-prompt-submit", input, (out) => {
      // LIVENESS AT THE PROMPT TOO (2026-10-01, review of #309). Only a Stop
      // used to refresh the record, so a session idle past `SESSION_TTL_MS`
      // read as dead to the MCP side until its first answer ENDED — and in
      // Desktop's Code tab, whose tools are Desktop's server (mcp CONTRACT
      // G21), that turn's calls ran unbound, filed under `claude-desktop:`.
      // This hook runs before the model makes any call, so the session is live
      // again by the time it names its id. Before the delivery verdict, like
      // the Stop's: the registry is not delivery. It REFRESHES a record and
      // never creates one: a session with no record is the off→on flip
      // (#92 review, F1), which the Stop alone may make bindable.
      if (input.sessionId.length > 0 && readSession(this.counterpart.store.dir, input.sessionId) !== null) {
        this.noteSession("boundary", input);
      }
      // The stand-down precedes the delivery check for the same reason it
      // precedes the recall: a muted session rendered nothing, so there is no
      // expectation to test and a "not delivered" record would be a lie.
      if (!this.deliveryVerdict("user-prompt-submit", input)) {
        return { ...out, ok: true, reason: "primacy-standdown" };
      }
      this.checkWakeArrival(input);
      // A plain reminder whose day began while this session was already open —
      // the session that runs past midnight — or that SessionStart had no room
      // for, is said at the next prompt, once (claimed at delivery).
      const plain = isInteractive(input) ? this.plainFor(input) : NO_PLAIN;
      const told: { notices?: readonly string[]; plain?: readonly PlainReminder[]; dream?: DreamTold; dreamNote?: { notice: string; context: string } } =
        plain.due.length === 0 ? {} : { notices: plain.notices, plain: plain.due };
      // The DREAM lines (2026-09-26): the once-a-day line, and any contradiction
      // a dream flagged that is still unraised — for the model; since
      // 2026-09-29 the day's line is shown to the PERSON too (`dream`), and
      // claimed only once the delivery knows it is leaving.
      const dream = this.dreamLines(input);
      const context = `${plain.context}${dream.text}`;
      if (dream.told !== null) Object.assign(told, { dream: dream.told });
      if (dream.note !== null) Object.assign(told, { dreamNote: dream.note });
      const text = input.prompt ?? "";
      if (text.trim().length === 0) {
        return { ...out, ok: true, reason: "empty-prompt", injection: `${this.nowLine()}${context.length === 0 ? "" : `\n${context.trimEnd()}`}`, ...told };
      }
      // The person's lines (reminders, the dream's) are the JSON form's other
      // field, so they take nothing from recall's room (2026-10-10).
      const budgetBytes = this.recallRoom(input, context);
      // The composed recall and its durable row (`Lifecycle#recallTurn`).
      const result = this.recallTurn(input, text, {
        ...(budgetBytes === undefined ? {} : { budgetBytes }),
        // Said outright this turn, so not ALSO handed over as a quiet cue.
        ...(plain.due.length === 0 ? {} : { withhold: new Set(plain.due.map((r) => r.memoryId)) }),
      });
      const decision = result.decision;
      // "SINCE YOU STARTED" (2026-10-11): what changed in other directories
      // since this session last heard, for the model, at most once an hour
      // (`Lifecycle#sinceLine`). It rides with the context lines and GIVES WAY
      // TO EVERYTHING ALREADY HERE: it takes only what recall left of its
      // budget, inside the host's cap, and without room it waits for the next
      // prompt without spending its hour.
      const recallBudget = budgetBytes ?? this.config.injectionBudgetBytes ?? RECALL_TUNABLES.BUDGET_BYTES;
      const recallBytes = Buffer.byteLength(result.injection, "utf8");
      const spent = Buffer.byteLength(`${this.nowLine()}\n${context}`, "utf8") + recallBytes;
      const since = this.sinceLine(input, Math.min(recallBudget - recallBytes, TUNABLES.HOST_OUTPUT_CHARS - spent));
      const lines = since.length === 0 ? context : `${context}${since}\n`;
      return {
        ...out,
        ok: true,
        reason: decision.reason,
        // The current local time, EVERY turn (docs/time.md rule 5; the owner
        // asked for it on quiet turns too, 2026-09-25 — ~40 bytes), because a
        // session can run for hours. One line ABOVE the recall note when there
        // is one, outside it like the wake's, so the note's byte count and
        // sentinel stand; alone when recall surfaced nothing.
        injection:
          result.injection.length === 0
            ? `${this.nowLine()}${lines.length === 0 ? "" : `\n${lines.trimEnd()}`}`
            : `${this.nowLine()}\n${lines}${result.injection}`,
        bytes: decision.bytes,
        sentinel: decision.sentinel,
        // The footnote tier is carried SEPARATELY from the loud one, because the
        // two mean different things to reinforcement: a footnote trains nothing.
        surfaced: decision.surfaced,
        footnotes: decision.footnotes,
        ...told,
      };
    });
  }

  /**
   * THE TURN'S RECALL BUDGET, AFTER EVERYTHING ELSE THIS ENVELOPE CARRIES
   * (2026-09-29, audit item 9). One budget per envelope, and at a prompt the
   * order it gives way in is, first to last:
   *   1. the update notice — all or nothing, and it waits for the next prompt
   *      (`bin/hook.ts#deliverTurn`);
   *   2. the turn's RECALL — sized here to what the host's cap leaves after
   *      the lines below, and it trims itself to that (its own tiers), because
   *      the next turn recalls afresh;
   *   3. the dream's hand-back and carried share, a contradiction's raise
   *      line, the day's dream offer — claimed when composed (or, the offer,
   *      at delivery), so they are reserved rather than cut;
   *   4. plain reminders due today and the clock line — last.
   * The limit is the host's cap on the model's field, in either form: the
   * JSON form's person-facing line is a field of its own, and its escaping
   * costs nothing (measured 2026-10-10; until then the JSON form was held to
   * 9,500 characters of whole, escaped envelope). Undefined means "recall's
   * own default" (nothing to shrink); a number is the configured budget or less.
   */
  private recallRoom(input: HookInput, context: string): number | undefined {
    const configured = this.config.injectionBudgetBytes;
    const base = configured ?? RECALL_TUNABLES.BUDGET_BYTES;
    // What rides with recall in the model's field: the clock and context lines, as bytes.
    const extras = Buffer.byteLength(`${this.nowLine()}\n${context}`, "utf8");
    const room = Math.max(0, TUNABLES.HOST_OUTPUT_CHARS - extras);
    if (room >= base) return configured;
    this.noteDeliveryWarning(ENVELOPE_GAVE_WAY_EVENT, { hook: "user-prompt-submit", part: "recall", budget: room, base }, input);
    return room;
  }

  /**
   * THE DREAM LINES (2026-09-26, `core/dream/`), for the MODEL, each
   * ending in a newline: a contradiction a dream flagged, raised once awake,
   * and the day's line, which follows the owner's dreaming setting
   * (2026-09-28): `ask` (the default since 2026-09-29) shows the PERSON the
   * question in the terminal (`told`, claimed at delivery) and tells the model
   * what each answer means; `auto` STARTS the nightly run here, headless
   * (`startNightRun`), and tells both that it has — or, when the run cannot
   * start, asks instead and says why; `off` says nothing. A headless run that
   * ended hands back its dream's line and share at the next prompt
   * (`nightHandBack`).
   * The line is at most once a CALENDAR day across every session (the store's
   * `dream_asks` latch decides, so of two sessions racing one gets it), and
   * again only for a run that was left behind; a "no" is the dream tool's
   * `decline`, "no dreams" its `setting`. Never in
   * the headless nightly run's child, never under observer, never
   * without a date. Only what could surface here anyway is counted or raised
   * (the dream module applies recall's gates). Never throws.
   *
   * v9 (2026-09-27): a MORNING SHARE the reflecting session never told is
   * carried here, ONCE, by the next session — only when the session that
   * reflected has ended (its registry record is ended or quiet), so the two
   * do not both tell it. Here, on the prompt, rather than in the SessionStart
   * wake, whose byte ceiling is what stranded the page writer.
   */
  private dreamLines(input: HookInput): { text: string; told: DreamTold | null; note: { notice: string; context: string } | null } {
    const none = { text: "", told: null, note: null };
    if (this.observer || input.at === undefined || input.nightRun === true || input.sessionId.length === 0) return none;
    if (!isInteractive(input)) {
      this.startUnwatched(input);
      return none;
    }
    try {
      const dreams = this.counterpart.dreams;
      // `auto` CHANGED MEANING on this version: an explicit one is set back to
      // `ask` once, before anything is offered, and the owner is told once
      // (owner decision A, 2026-09-29).
      dreams.resetAutoOnce();
      const note = dreams.autoResetNotice();
      const lines = [...dreams.raiseLines({ session: input.sessionId })];
      if (note !== null) lines.push(note.context);
      // A HEADLESS RUN'S HAND-BACK (2026-09-29): no agent handed its last
      // message to a session, so the next prompt anywhere carries the dream's
      // line and the share — once, ever (`claimNightHandBack`).
      lines.push(...this.nightHandBack(input));
      const pending = this.counterpart.reflections.pendingShare({ session: input.sessionId });
      if (pending !== null) {
        const record = pending.session === null ? null : readSession(this.counterpart.store.dir, pending.session);
        if (record === null || !isLive(record, this.nowFn())) {
          const carried = this.counterpart.reflections.carryLine({ session: input.sessionId, reflection: pending.id });
          if (carried !== null) lines.push(carried);
        }
      }
      // THE DAY'S LINE, OFFERED (2026-09-29). An ASK is not claimed here: the
      // delivery claims it once the envelope is known to carry the person's
      // line (`claimDream`). HEADLESS (`auto`) is claimed now and the run
      // started now — the start is the point, the terminal line a courtesy —
      // and a run that cannot even be started falls back to the ask at once.
      let offer = dreams.offer({ at: input.at, session: input.sessionId });
      if (offer !== null && offer.headless) {
        const started = dreams.claimOffer(offer) ? this.startNightRun(input, offer) : null;
        if (started === null) offer = null;
        else if (!started) {
          const again = dreams.offer({ at: input.at, session: input.sessionId });
          offer = again !== null && !again.headless ? again : null;
        }
      }
      let told: DreamTold | null = null;
      let asked = false;
      if (offer !== null) {
        if (offer.notice !== null) told = { notice: offer.notice, context: offer.context, offer: offer.headless ? null : offer };
        asked = told !== null || dreams.claimOffer(offer);
        if (asked) lines.push(offer.context);
      } else {
        // A RUN A SESSION NOBODY SAW STARTED (2026-10-01, lane 8): its line,
        // held for this one, said once and claimed at delivery (`claimHeld`).
        const held = dreams.heldTold(input.at, input.sessionId);
        if (held !== null) {
          told = { notice: held.notice, context: held.context, offer: null, held: held.run };
          lines.push(held.context);
        }
      }
      if (lines.length > 0) this.emit("adapter.dream.lines", { asked, raised: lines.length - (asked ? 1 : 0) });
      return { text: lines.map((l) => `${l}\n`).join(""), told, note };
    } catch {
      return none;
    }
  }

  /**
   * A SESSION NOBODY WATCHES (2026-10-01, lane 8): it may START the day's
   * headless run — the start is the point — and the line it would have been
   * told is held for the next interactive session (`Dreams#holdTold`). An
   * ASK is left unclaimed for that session too: nobody here could answer it.
   * Nothing else is offered, raised, carried or claimed. Never throws.
   */
  private startUnwatched(input: HookInput): void {
    if (input.at === undefined) return;
    try {
      const dreams = this.counterpart.dreams;
      // The one-time setting change runs first here too, so an unwatched
      // first prompt never starts a run under an `auto` this version resets.
      dreams.resetAutoOnce();
      const offer = dreams.offer({ at: input.at, session: input.sessionId });
      if (offer === null || !offer.headless || !dreams.claimOffer(offer)) return;
      const started = this.startNightRun(input, offer);
      const night = dreams.nightRun();
      if (started && night !== null && night.state === "started") dreams.holdTold({ run: night.run, date: input.at });
      this.emit("adapter.dream.unwatched", { started, entrypoint: input.entrypoint ?? null });
    } catch {
      /* the run is a courtesy here; nothing is lost by not starting it */
    }
  }

  /** CLAIM A HELD LINE the delivery is certainly about to show. Never throws. */
  claimHeld(input: HookInput, run: string): boolean {
    try {
      const claimed = this.counterpart.dreams.claimHeldTold(run, input.sessionId);
      this.emit(claimed ? "adapter.dream.told" : "adapter.dream.lost", { state: "held", session: input.sessionId });
      return claimed;
    } catch {
      return false;
    }
  }

  /** The reset line was shown: claimed once, ever. Never throws. */
  claimDreamNote(input: HookInput): boolean {
    try {
      return this.counterpart.dreams.claimAutoResetNotice(input.sessionId);
    } catch {
      return false;
    }
  }

  /**
   * START THE HEADLESS NIGHTLY RUN (2026-09-29) for a day this process just
   * claimed: the detached process (`night-run.ts#planNightRunner`, run by
   * `bin/nightly.ts`) that starts `claude -p` and waits for it. True when it
   * started; false — with a `could-not-start` row saying why — when it did
   * not, so the next offer asks instead. Never throws.
   */
  private startNightRun(input: HookInput, offer: DreamOffer): boolean {
    const dreams = this.counterpart.dreams;
    const store = this.counterpart.store;
    const run = newNightRunId();
    const kind: NightKind = offer.reflects === null ? { kind: "night" } : { kind: "reflection", dream: offer.reflects };
    const base = {
      run,
      date: offer.at,
      kind: kind.kind,
      session: input.sessionId,
      startedAt: store.now(),
      timeoutMs: nightTimeoutMs(this.config),
      endedAt: null,
      reason: null,
      detail: null,
      code: null,
      dream: null,
      reflection: null,
    };
    const couldNot = (reason: string, detail: string | null): false => {
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
        ...(this.configPath === undefined ? {} : { configPath: this.configPath }),
      });
      if (!plan.ok) return couldNot(plan.reason === "NO_RUNNER" ? "runner" : "refused", plan.reason);
      const out = spawnDetached({ ...plan, reason: "ready" }, {
        ...(this.spawner === undefined ? {} : { spawner: this.spawner }),
        onEvent: (name, data) => this.emit(`night.${name}`, data),
      });
      if (!out.started) return couldNot("runner", out.code ?? String(out.reason));
      dreams.recordNightRun({ ...base, state: "started" });
      this.emit("adapter.night.started", { run, pid: out.pid, kind: kind.kind });
      return true;
    } catch (err) {
      return couldNot("runner", codeOf(err));
    }
  }

  /**
   * THE HAND-BACK OF A HEADLESS RUN THAT ENDED — the dream's line, then the
   * morning share if there is one, then the host's cut if the run's transcript
   * showed one (2026-10-09) — claimed once across every session. Empty when
   * there is nothing to hand back, or another prompt already did.
   */
  private nightHandBack(input: HookInput): string[] {
    const dreams = this.counterpart.dreams;
    const night = dreams.nightRun();
    if (night === null || night.state === "started" || night.state === "could-not-start") return [];
    // A run the host cut is told even when it journaled nothing: the cut may be why.
    if (night.dream === null && night.reflection === null && (night.spills ?? 0) === 0) return [];
    // A READ on the per-prompt path once it is handed: nothing is written again.
    if (night.handedAt !== undefined) return [];
    const claimed = dreams.claimNightHandBack(night.run, input.sessionId);
    // Marked whether this prompt won the latch or found it held, so no later
    // prompt tries again (the same run and state: the event latch adds no row).
    dreams.recordNightRun({ ...night, handedAt: this.counterpart.store.now() });
    if (!claimed) return [];
    const out: string[] = [];
    const line = dreams.nightHandBackLine(night);
    if (line !== null) out.push(line);
    if (night.reflection !== null) {
      const share = this.counterpart.reflections.carryLine({ session: input.sessionId, reflection: night.reflection });
      if (share !== null) out.push(share);
    }
    const spill = dreams.nightSpillLine(night);
    if (spill !== null) out.push(spill);
    this.emit("adapter.night.handed", { run: night.run, lines: out.length });
    return out;
  }

  /**
   * CLAIM THE DAY'S DREAM LINE the delivery is certainly about to show — the
   * `dream_asks` latch decides (`Dreams.claimOffer`), so of two processes
   * racing exactly one gets it. Never throws.
   */
  claimDream(input: HookInput, offer: DreamOffer): boolean {
    try {
      const claimed = this.counterpart.dreams.claimOffer(offer);
      this.emit(claimed ? "adapter.dream.told" : "adapter.dream.lost", { state: offer.state, session: input.sessionId });
      return claimed;
    } catch {
      return false;
    }
  }

  /**
   * "COUNTERPARTS WAS UPDATED" — the line this session's terminal gets, once,
   * when the MCP server it is talking to runs an older build than the one
   * installed (roadmap E, owner decisions 2026-09-23).
   *
   * Asked at `user-prompt-submit`, after the turn, the way `notice()` is asked
   * at `session-start` (`bin/hook.ts`): this process runs the INSTALLED build
   * every turn, so it is the one that knows what current is. It decides and
   * writes nothing (`sessions.ts#decideUpdateNotice`); `markUpdateNotice` is
   * the other half, called only once the line is actually on its way out. An
   * observer marks nothing, so it is never told.
   *
   * Never throws and never costs the turn: any failure is null.
   */
  updateNotice(input: HookInput): string | null {
    // Nobody watching, nobody told: the next interactive prompt is (lane 8).
    if (this.observer || input.sessionId.length === 0 || !isInteractive(input)) return null;
    try {
      const decision = decideUpdateNotice(this.counterpart.store.dir, {
        sessionId: input.sessionId,
        installed: installedBuild(),
      });
      // Ring rows only when there is something to say; `bin/hook.ts` copies
      // them to stderr, because this process lives for one hook.
      if (decision.reason === "due" || decision.reason === "failed") {
        this.emit("adapter.update.notice", {
          reason: decision.reason,
          matchedBy: decision.matchedBy,
          servers: decision.servers,
          hookPpid: decision.hookPpid,
        });
      }
      return decision.message;
    } catch {
      return null;
    }
  }

  /**
   * Record that the update notice went out — FIRST, before the line is
   * printed, and the line is printed only if this says true. So it is shown
   * once per session, and a mark that will not write is silence rather than
   * the same line every turn. One ring row either way.
   */
  markUpdateNotice(input: HookInput): boolean {
    if (this.observer || input.sessionId.length === 0) return false;
    const marked = markUpdateNoticeShown(this.counterpart.store.dir, input.sessionId);
    this.emit("adapter.update.notice", { reason: marked ? "shown" : "mark-failed" });
    return marked;
  }

  /**
   * SessionStart's stamp on a session that OPENS (`bin/hook.ts` decides which
   * sources do): the installed build and this hook's parent pid
   * (`sessions.ts#SessionRecord.opened`). A session without one opened before
   * any build stamped it, which is what lets the notice speak about a server
   * that records nothing about itself. Merged into the record `sessionStart`
   * just wrote; an observer writes nothing. Never throws.
   */
  stampOpened(input: HookInput): boolean {
    if (this.observer || input.sessionId.length === 0) return false;
    return stampSessionOpened(this.counterpart.store.dir, input.sessionId, {
      build: installedBuild(),
      hookPpid: process.ppid,
      at: Date.now(),
    });
  }

  // ── the boundary, and the three paths that reach it ────────────────────────

  /**
   * THE APPENDER. Microseconds, no model call, no judgment — and it cannot throw
   * into the host, because `SpanBuffer.capture` swallows its own failures and
   * `guard()` catches anything above it (§2 G1/G12).
   */
  boundary(hook: SessionEndingHook, input: HookInput): HookResult {
    return this.guard(hook, input, (out) => this.claim(hook, input, out));
  }

  /**
   * Stop: the boundary, then the ONE ask, then the detached worker.
   *
   * Order matters. The spans are durable before anything else is attempted, so a
   * crash between here and the worker costs a run, never a day. The ask's state
   * advance is committed inside `self.openChapter` BEFORE the ask is handed
   * back, so a crash cannot re-ask in a loop (§13 G3–G4); and any failure in the
   * ask is fail-open — collection never depends on the ritual (§13 G5).
   */
  stop(input: HookInput): HookResult {
    return this.guard("stop", input, (out) => {
      const claimed = this.claim("stop", input, out);
      // The clock the lazy bind reads, refreshed BEFORE the ask that names this
      // session id goes out: the id has to be live by the time the model reads
      // it, and a session already running when this shipped never saw a
      // SessionStart write — so this is also where it first becomes bindable.
      this.noteSession("boundary", input);
      // The boundary is UNCONDITIONAL — the shadow encodes the same days v1
      // encodes, and a parallel run that stopped capturing would be comparing
      // nothing (parallel-run G5: encode-only, and honest). What the stand-down
      // withholds is the ASK, which is delivery: an ask from a system the
      // owner is not talking to today is exactly the double-voice G3 forbids.
      const deliver = this.deliveryVerdict("stop", input);
      // THE WAKE'S ARRIVAL, closed here when the first prompt could not
      // (2026-10-08): the host writes the transcript only after that prompt, so
      // the end of the first turn is where every session can be read. Muted
      // sessions are not checked, for the prompt's reason. The check marks a
      // record that exists and never makes one; a session the boundary above
      // just sealed (no record before it) has one with no sentinel, and says
      // `no-wake-expected` — what its second prompt used to say.
      if (deliver) this.checkWakeArrival(input, { final: true });
      // THE AUTHORED FRONT DOOR, first: the experiencer writes its own memories
      // while it still has the pen, and the sweep the worker spawns below is
      // only the fallback for the day nobody got to (contract §4). The ask goes
      // out after the spans are durable, so a crash between the two costs a
      // dump, never a day.
      //
      // The worker below still spawns at EVERY boundary — it carries the
      // Hebbian flush and the sleep cycle, which are not optional — but since
      // 2026-09-04 its sweep step selects nothing unless a session is CRASHED
      // (`remember/fallback.ts`: uncovered spans, no `session-end` boundary,
      // silent past `CRASH_STALE_MS`). Before that gate this line was a comment
      // the code did not keep: one evening's Stops billed 13 chunks and minted
      // 61 memories beside 34 the model had authored itself.
      // The headless nightly run is asked nothing (`HookInput.nightRun`).
      const ask = deliver && input.nightRun !== true ? this.askAtStop(input) : null;
      const spawn = this.spawnWorker(input);
      return { ...claimed, ask, spawn };
    });
  }

  /** The host closing the session: a boundary, the tail measurement, a worker. */
  sessionEnd(input: HookInput): HookResult {
    return this.guard("session-end", input, (out) => {
      const claimed = this.claim("session-end", input, out);
      // One tiny rename, inside the 1.5 s this event's hooks share. It closes
      // the session to any later claim: a dump arriving after this is the
      // sweep's job, not the experiencer's.
      this.noteSession("end", input);
      this.noteTail(input);
      return { ...claimed, spawn: this.spawnWorker(input) };
    });
  }

  /**
   * Pre-compaction: the transcript is about to be destroyed. This is the
   * compaction-amnesia backstop, and it is why the boundary list has three
   * members instead of one.
   */
  preCompact(input: HookInput): HookResult {
    return this.guard("pre-compact", input, (out) => {
      const claimed = this.claim("pre-compact", input, out);
      this.noteTail(input);
      return claimed;
    });
  }

  /** Dispatch by name — what the entry script calls, and what the totality test walks. */
  hook(name: HookName, input: HookInput): HookResult {
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

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * MAY THIS HOOK DELIVER? — the parallel run's G3, at every delivering channel.
   *
   * Without the knob this is `true` and nothing is emitted at all: the flag's
   * absence must be indistinguishable from a build that never had it, or every
   * test and every ordinary session grows a primacy record it cannot explain.
   *
   * With the knob, `primacy()` decides and BOTH verdicts are recorded — the
   * stand-down because an unevidenced mute is indistinguishable from a broken
   * hook (parallel-run G4, scar §2.4), and the delivery because a Phase P day
   * has to be able to show positive evidence that v2 spoke. Each record goes to
   * the ring AND to box 2, because the ring dies with the hook process and the
   * daily count is a claim about the run.
   *
   * `date` rides in the durable payload deliberately: the log's `day` column is
   * the store's LIVED day, which only the heavy cycle advances, so a hook-path
   * row would stamp whatever lived day the store was already on.
   */
  private deliveryVerdict(hook: HookName, input: HookInput): boolean {
    if (this.config.parallel?.enabled !== true) return true;
    const verdict = primacy();
    const name = verdict.deliver ? PRIMACY_DELIVER_EVENT : PRIMACY_STANDDOWN_EVENT;
    const data = {
      hook,
      reason: verdict.reason,
      system: verdict.system,
      date: input.at ?? null,
      session: input.sessionId,
    };
    this.emit(name, data);
    this.counterpart.noteAdapterEvent(name, data);
    return verdict.deliver;
  }

  /**
   * Capture and record the boundary — `Lifecycle#captureBoundary`, under this
   * host's event name and boundary kind. ONE function for all three paths, so a
   * fourth session-ending event added later cannot accidentally get a different
   * shape (G3).
   */
  private claim(hook: SessionEndingHook, input: HookInput, out: HookResult): HookResult {
    const captured = this.captureBoundary(hook, BOUNDARY_KIND[hook], input);
    return { ...out, ok: true, reason: captured.reason, spansAppended: captured.spansAppended };
  }

  /**
   * THE ONE ASK at a Stop: the lifecycle's pacer (`Lifecycle#paceAsk`, one
   * pacer, fail-open — §13 G3–G5) decides whether this Stop asks and for which
   * chapter, and this host words it (`stopAsk`).
   *
   * **The re-fired Stop asks nothing and advances nothing.** The host's re-fire
   * of a blocked Stop is refused HERE, before the pacer is consulted: no pacing
   * advance, no ask slot, no row — the previous pass already left one.
   */
  private askAtStop(input: HookInput): string | null {
    if (input.reFired === true) return null;
    const chapter = this.paceAsk(input);
    // The ask NAMES this session and its chapter: the id is what the MCP
    // server binds itself with, so an ask that omitted it would be an
    // invitation the model has no way to accept on this host — and the
    // chapter number is the STORE's, one past what was written.
    return chapter === null ? null : stopAsk(input.sessionId, chapter);
  }

  /**
   * DID THE WAKE THIS SESSION COMPOSED REACH THE SESSION? — once, at the first
   * prompt or the end of the first turn, and never again for this session.
   *
   * **Why here and not at the end.** Nothing inside the SessionStart hook can
   * know what the host did with its return value, and SessionEnd's hooks share
   * 1.5 s between them. The first `UserPromptSubmit` was the earliest moment the
   * host had written the record of its own injection, and it is once per session
   * rather than once per turn.
   *
   * **And at the first Stop when the prompt was too early (2026-10-08).** Since
   * about 09-25 Claude Code creates the transcript only after the first prompt
   * is handled, so the prompt found no file and nearly every session's row said
   * `not-found` / `absent` — about a file that existed a moment later. A wake was
   * expected and there is no file: the prompt records nothing and leaves the
   * question open, and the next prompt or the first Stop (`final`) asks again.
   * The Stop is the bound: by the end of a turn the host has written the file,
   * so one that is still absent there will not appear, and the row says
   * `absent` once rather than the session asking at every turn. The Stop has
   * already read the whole transcript to capture the turn; this head read is
   * 256 KiB at most beside it.
   *
   * **What it reads.** The head of the host's transcript, bounded
   * (`transcript.ts#readWakeArrival`): this package's SessionStart attachment
   * carries what the hook printed beside what the host says it injected, and the
   * wake's two sentinels stand inside both. The comparison is against
   * `wakeSentinel` from the session record — the expectation a fresh process
   * cannot otherwise have.
   *
   * **What it records.** One `adapter.wake.delivered` row: ids, numbers, flags
   * and an outcome. Never a byte of the bundle.
   *
   * **What it cannot do.** Fail the hook (§5 G2) or cost the turn its recall. A
   * session with no registry record is left entirely alone — it is either an
   * observer, a session older than this code, or the off→on flip the
   * retroactive-capture guard reads that same absence to detect, and a record
   * written from here would take that evidence away.
   */
  private checkWakeArrival(input: HookInput, opts: { readonly final?: boolean } = {}): void {
    if (this.observer) return;
    if (input.sessionId.length === 0) return;
    const started = this.nowFn();
    let record: SessionRecord | null;
    try {
      record = readSession(this.counterpart.store.dir, input.sessionId);
    } catch {
      return;
    }
    if (record === null || record.wakeChecked === true) return;
    const expected = record.wakeSentinel ?? null;
    try {
      // Nothing was supposed to arrive: no expectation, no read. A cold start's
      // bootstrap line and a SessionStart that stood down both land here, and
      // the row says so rather than reporting a wake that was never composed.
      const arrival =
        expected === null ? NO_ARRIVAL : readWakeArrival(input.transcriptPath, { expect: expected });
      // Not written yet: no row and no mark, so the next prompt or the Stop
      // reads again (above). The ring says it waited, for whoever debugs it.
      if (expected !== null && arrival.reason === "absent" && opts.final !== true) {
        this.emit("adapter.wake.check.deferred", {
          transcript: arrival.reason,
          pathGiven: input.transcriptPath !== undefined,
          elapsedMs: this.nowFn() - started,
        });
        return;
      }
      const outcome = wakeOutcome(expected, arrival);
      this.record(WAKE_DELIVERED_EVENT, input, {
        outcome,
        // Which hook answered: the first prompt, or the end of the first turn.
        checkedAt: opts.final === true ? "stop" : "prompt",
        // `ok` and `delivered` say the same thing under the two names this row's
        // readers already look for.
        ok: outcome === "delivered",
        delivered: outcome === "delivered",
        expected: expected !== null,
        found: arrival.found,
        transcript: arrival.reason,
        // The two sentinels in what the HOST SAYS IT INJECTED, and in what the
        // hook PRINTED. A tail present in one and not the other is the shape
        // scar §2.3 is about: the render was whole and the delivery was not.
        headInContent: arrival.head.present,
        tailInContent: arrival.tail.present,
        headInStdout: arrival.headPrinted.present,
        tailInStdout: arrival.tailPrinted.present,
        // Whether the host recorded an injected `content` at all — the
        // difference between "it arrived empty" and "this build does not say".
        contentRecorded: arrival.contentRecorded,
        // What each sentinel DECLARED, against what actually arrived.
        headBytes: arrival.head.bytes,
        headElements: arrival.head.elements,
        tailBytes: arrival.tail.bytes,
        tailElements: arrival.tail.elements,
        contentBytes: arrival.contentBytes,
        stdoutBytes: arrival.stdoutBytes,
        linesRead: arrival.linesRead,
        bytesRead: arrival.bytesRead,
        corrupt: arrival.corrupt,
        elapsedMs: this.nowFn() - started,
      });
      // THE VERDICT CROSSES THE SEAM, NOT THE TEXT. `noteDelivered` asks two
      // questions of its argument — was a sentinel seen, and was it the
      // expectation — and both are already answered here. Handing it the
      // matched line would carry a string cut out of the wake bundle (memory
      // text, if a body opened a sentinel it never closed) into a core module;
      // `""` is "seen, and not the one we printed".
      this.counterpart.noteWakeDelivered(
        arrival.tail.present ? (arrival.tail.matchesExpected ? expected : "") : null,
        expected,
      );
    } catch (err) {
      this.emit("adapter.wake.check.failed", {
        code: codeOf(err),
        elapsedMs: this.nowFn() - started,
      });
    }
    // AFTER the row, never before: a flag written first and a row that then
    // failed would close the question for this session with nothing recorded,
    // which is I32's shape. This order can duplicate a row if the flag write
    // fails — the cheaper of the two.
    this.markWakeChecked(input, record);
  }

  /**
   * Close the question for this session. `boundary` creates a record when one is
   * missing, so this is only ever called with a record already read — and it is
   * written at the clock the record already carried (which, since 2026-10-01,
   * this same prompt has already refreshed: `userPromptSubmit`).
   */
  private markWakeChecked(input: HookInput, prior: SessionRecord): void {
    try {
      recordSession(this.counterpart.store.dir, {
        sessionId: input.sessionId,
        scope: input.scope,
        phase: "boundary",
        at: prior.lastBoundaryAt,
        wakeChecked: true,
        ...this.recordStamp(),
      });
    } catch {
      /* the check runs again next turn; a hook may not fail the host (§5 G2) */
    }
  }

  /**
   * THE ONE OR TWO LINES THE OWNER SEES AT SESSION START, or null.
   *
   * I32's closing move. #95 made the refusals durable and `doctor.ts` reads
   * them; this is the surface that puts the worst RED finding where a human
   * already looks — the terminal — instead of leaving it in a store for whoever
   * thinks to ask (adapter INTERFACE-GAPS, "Nothing SAYS the worker has not
   * run"). The owner's ruling, 2026-09-11: the warning must reach the USER's
   * terminal.
   *
   * Three properties, each load-bearing:
   *
   *   - **Red only.** Amber belongs to `counterparts doctor`, which the owner
   *     runs on purpose. A hook that spoke every time something was imperfect is
   *     a hook people learn to scroll past.
   *   - **An observer says nothing at all**, before any read: an instrument that
   *     narrated the host it is measuring would be doing more than reading.
   *   - **It cannot fail the wake** (§5 G2). Every failure — a store that will
   *     not read, a clock that throws — returns null and leaves ONE ring event,
   *     and the wake goes out on exactly the path it took yesterday.
   *
   * Bounded at `SESSION_NOTICE_BUDGET_MS` and checked between finding groups,
   * because this runs inside a foreground hook.
   */
  notice(
    input: HookInput,
    opts: { budgetMs?: number; now?: () => number; checkout?: CheckoutReading } = {},
  ): string | null {
    if (this.observer) return null;
    try {
      const today = input.at ?? localDate(this.nowFn(), this.counterpart.store.zone());
      // WHICH CODE IS LIVE, read before anything else and RECORDED. The reading
      // is bounded and never throws (`readCheckout`); the row is the mechanized
      // half — a day on master leaves one latched row, and a day the tree
      // wandered leaves one per state it wandered into.
      const checkout = opts.checkout ?? readCheckout();
      if (!checkoutIsGraded(checkout)) {
        // git missing, slow, or no repository at all: nothing to record, and
        // only a "git would not answer" is worth a ring row.
        if (checkout.reason === "unreadable") {
          // `why` separates the two silences: a git that answered "no
          // origin/master" is a fact about the repository, and a git that ran
          // out of `CHECKOUT_BUDGET_MS` is a fact about the machine — and only
          // the second one means the grade is missing on a morning it mattered.
          this.emit("adapter.checkout.unreadable", {
            root: checkout.root,
            why: checkout.timedOut ? "timeout" : "git",
          });
        }
      } else {
        try {
          this.counterpart.noteAdapterEvent(
            CHECKOUT_EVENT,
            {
              reason: checkout.reason,
              branch: checkout.branch,
              head: checkout.head,
              dirty: checkout.dirty,
              behindBy: checkout.behindBy,
              originMaster: checkout.originMaster,
              atMaster: checkout.atMaster,
              date: today,
            },
            // THE REASON IS PART OF THE LATCH. Date, head and dirtiness alone
            // let a day's first row stand for every later one: a `git fetch` in
            // the shared tree moves origin/master, so the SAME clean head that
            // graded `master` at breakfast grades `behind` by lunchtime — and
            // the day's record would still say master. One row per state the
            // tree was actually in, which is the claim the row is for.
            {
              dedupKey: `${CHECKOUT_EVENT}:${today}:${checkout.head ?? "none"}:${checkout.dirty}:${checkout.reason}`,
            },
          );
        } catch (err) {
          this.emit("adapter.checkout.record.failed", { code: codeOf(err) });
        }
      }
      const findings = doctorFindings({
        checkout,
        configPath: this.configPath ?? "(none)",
        // `bin/hook.ts` REFUSED an absent or unreadable NAMED configuration long
        // before this line, so there is no reason left for this reading to
        // re-derive: null says "the caller already vouched for the file".
        configReason: null,
        config: this.config,
        dir: this.config.dataDir ?? "",
        store: this.counterpart.store,
        today,
        refusals: this.spawnRefusals(),
        starts: this.spawnStarts(),
        budgetMs: opts.budgetMs ?? SESSION_NOTICE_BUDGET_MS,
        ...(opts.now === undefined ? {} : { now: opts.now }),
      });
      return noticeMessage(findings);
    } catch (err) {
      // A reading that failed is not a session that failed. One ring row, so the
      // silence is distinguishable from a clean bill of health (scar §2.4).
      this.emit("adapter.doctor.failed", { code: codeOf(err) });
      return null;
    }
  }

  /**
   * RECORD THAT THE TERMINAL DID NOT GET THE WARNING, and why.
   *
   * The host caps each field of a hook's JSON output at 10,000 characters and
   * previews one past it. `bin/hook.ts` prints the PLAIN wake and throws the
   * notice away when either field would not fit (`fieldsFit`; until 2026-10-10,
   * when the whole envelope passed 9,500), and this is how that choice stays
   * visible instead of looking like a healthy morning. `envelopeChars` is the
   * whole object's length, `limitChars` the per-field cap. Ids and counts only,
   * like every other row.
   */
  noteNoticeDropped(chars: { noticeChars: number; envelopeChars: number; limitChars: number }): void {
    this.noteDeliveryWarning(NOTICE_DROPPED_EVENT, { ...chars });
  }

  /** RECORD THAT EVEN THE PLAIN FORM WAS PAST THE HOST'S CAP
   *  (`bin/hook.ts#Delivery.overCap`, 2026-09-29). Counts only. */
  noteOverCap(chars: { chars: number; limitChars: number }): void {
    this.noteDeliveryWarning(ENVELOPE_OVERCAP_EVENT, { ...chars });
  }

  /** RECORD WHAT THE DELIVERY LEFT FOR LATER for want of room — plain
   *  reminders, the dream offer, the update notice (`bin/hook.ts#deliverTurn`).
   *  Recorded where it happened, so the event says what was actually
   *  delivered (review of #285, S2). Counts only. */
  noteGaveWay(input: HookInput, part: string, count: number): void {
    this.noteDeliveryWarning(ENVELOPE_GAVE_WAY_EVENT, { hook: "delivery", part, count }, input);
  }

  /**
   * The one wrapper. Stance first (an instrument stands down and SAYS SO), then
   * the anti-loop guard, then the work — and nothing that happens inside reaches
   * the host as an exception (G2, G7).
   */
  private guard(
    hook: HookName,
    input: HookInput,
    body: (out: HookResult) => HookResult,
  ): HookResult {
    const base: HookResult = {
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
      observer: this.observer,
    };
    const key = `${hook}:${input.sessionId}`;
    if (this.inFlight.has(key)) {
      // Re-entrancy: our own injection lands in the transcript, and a hook that
      // re-enters on it would recall on its own render forever.
      this.emit("adapter.reentrant", { hook, session: input.sessionId });
      return { ...base, ok: true, reason: "reentrant" };
    }
    this.inFlight.add(key);
    try {
      // THE SECOND `off` SITE. The entry point already refused before anything
      // opened, which is where the "no output, no write" guarantee actually
      // comes from; this is the same predicate at the seam a future caller
      // reaches, so a library user who constructs an adapter directly inherits
      // the rule instead of having to remember it (observer-mode G8's shape).
      // It is silent on purpose — see `bin/hook.ts` — and the ring event is
      // free here because the ring is already open.
      if (stanceOfMode(this.scope.mode) === "off") {
        this.emit("adapter.scope.off", { hook, matched: this.scope.matched });
        return { ...base, ok: true, reason: "scope-off" };
      }
      if (this.observer && hook !== "session-start" && hook !== "user-prompt-submit") {
        // An instrument reads (the wake is delivered, recall works) and deposits
        // nothing. The stand-down is logged: silence is indistinguishable from a
        // broken hook (scar E7, §2.4).
        this.emit("adapter.observer.standdown", { hook });
        return { ...base, ok: true, reason: "observer" };
      }
      return body(base);
    } catch (err) {
      // NO HOOK EVER FAILS THE HOST (G2). Logged, swallowed, clean exit.
      this.emit("adapter.hook.failed", { hook, code: codeOf(err) });
      return { ...base, ok: false, reason: "failed" };
    } finally {
      this.inFlight.delete(key);
    }
  }
}

/** The six answers the delivery check can give, in plain words. */
export type WakeOutcome =
  | "delivered"
  | "truncated"
  | "mismatch"
  | "printed-unverified"
  | "not-found"
  | "no-wake-expected";

/**
 * THE VERDICT, read from the TAIL SENTINEL ALONE — which is the whole point of
 * the sentinel: "verify arrival from the last line" (§1 G2, scar §2.3). The
 * head sentinel and the measured lengths ride on the row as evidence; they are
 * not inputs to this answer, because a bundle clipped in transit loses its tail
 * first and a reader that needed both would report nothing when it mattered.
 *
 * `mismatch` is the case a resumed session produces: the head of the file holds
 * the SessionStart attachment of the run that created it, so a wake arrived and
 * it is not the one this session composed. "Something else arrived" and "it was
 * cut off" are different mornings.
 *
 * `printed-unverified` is the case a HOST BUILD produces. The verdict is read
 * from `content`, a field of the host's private transcript format measured once;
 * a build that does not record it leaves nothing to read, and answering
 * `truncated` there would say v1's silent-loss bug was happening to every
 * session on that host. When the field is absent the printed side answers
 * instead — it is this package's own stdout, so an intact sentinel there says
 * the hook did its half and the host's half is simply not on the record.
 */
export function wakeOutcome(expected: string | null, arrival: WakeArrival): WakeOutcome {
  if (expected === null) return "no-wake-expected";
  if (!arrival.found) return "not-found";
  if (arrival.tail.present) return arrival.tail.matchesExpected ? "delivered" : "mismatch";
  if (!arrival.contentRecorded) {
    if (arrival.tailPrinted.matchesExpected) return "printed-unverified";
    if (arrival.tailPrinted.present) return "mismatch";
    // Neither recorded nor printed: the attachment is not a wake at all.
    if (!arrival.headPrinted.present) return "not-found";
  }
  return "truncated";
}

/**
 * A hook result WITHOUT the given plain reminders — their terminal lines, their
 * records and their context lines — for a delivery that could not carry them or
 * lost the race to claim them (`bin/hook.ts#deliverTurn`). They are not spent:
 * the next prompt reads them again. Everything else is untouched.
 */
export function withoutPlain<R extends { injection: string | null; notices?: readonly string[]; plain?: readonly PlainReminder[] }>(
  result: R,
  drop: readonly PlainReminder[],
): R {
  if (drop.length === 0) return result;
  const keyOf = (r: PlainReminder): string => `${r.memoryId} ${r.windowKey} ${r.beat}`;
  const gone = new Set(drop.map(keyOf));
  const lines = new Set(drop.map(plainContextLine));
  const plain = (result.plain ?? []).filter((r) => !gone.has(keyOf(r)));
  const injection =
    result.injection === null
      ? null
      : result.injection
          .split("\n")
          .filter((l) => !lines.has(l))
          .join("\n");
  const rest: R = { ...result, injection };
  delete (rest as { notices?: unknown }).notices;
  delete (rest as { plain?: unknown }).plain;
  return plain.length === 0 ? rest : { ...rest, notices: plain.map(plainLine), plain };
}

/**
 * A hook result WITHOUT the day's dream line — its terminal line and its model
 * line — for a delivery that could not carry it or lost the race to claim it
 * (`bin/hook.ts#deliverTurn`). Not spent: the next prompt offers it again.
 */
export function withoutDreamNote<R extends { injection: string | null; dreamNote?: { notice: string; context: string } }>(result: R): R {
  const note = result.dreamNote;
  if (note === undefined) return result;
  const injection = result.injection === null ? null : result.injection.split("\n").filter((l) => l !== note.context).join("\n");
  const rest: R = { ...result, injection };
  delete (rest as { dreamNote?: unknown }).dreamNote;
  return rest;
}

export function withoutDream<R extends { injection: string | null; dream?: DreamTold }>(result: R): R {
  const told = result.dream;
  if (told === undefined) return result;
  const injection =
    result.injection === null
      ? null
      : result.injection
          .split("\n")
          .filter((l) => l !== told.context)
          .join("\n");
  const rest: R = { ...result, injection };
  delete (rest as { dream?: unknown }).dream;
  return rest;
}
