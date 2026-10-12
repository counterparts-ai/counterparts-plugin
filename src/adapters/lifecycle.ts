/**
 * THE HOST LIFECYCLE — what every host does with a session, whatever the host.
 *
 * Until 2026-09-30 all of this lived inside `claude-code/hooks.ts`'s
 * `ClaudeCodeAdapter`, because Claude Code was the only host that had a
 * session to live. The parts below were never about Claude Code: they are what
 * a session IS to this memory — it wakes, it recalls at a turn, it is asked
 * (on one pacer) to write itself up, it reaches a boundary where what was said
 * is captured and credited, it may be pointed at an earlier session that ended
 * unwritten, it leaves a note in the live-session registry at each of those
 * moments, and it starts the detached worker that sleeps and decays. A second
 * host — Claude Desktop's chat, which has an MCP server and no hooks — has all
 * of these too, and has none of Claude Code's machinery: no event names, no
 * JSON envelope, no transcript file, no Stop re-fire, no terminal line.
 *
 * So the split is:
 *
 *   - **Here** — `HostLifecycle`, the interface a host adapter drives, and
 *     `Lifecycle`, its one implementation: the wake's composition and the
 *     registry's expectation of it, plain reminders, recall for a turn and its
 *     durable row, the boundary (capture, the retroactive-capture seal, credit,
 *     the orphan tail), the ask's PACING (whether this boundary asks, and for
 *     which chapter — not its words), the next-session write-up pointer, every
 *     registry write, and the worker spawn with its refusal and start counters.
 *   - **In the host's adapter** — how its events arrive and what they are
 *     called, how its output leaves and how much room it has, what its
 *     transcript looks like, the words of its ask, and anything only it has (for
 *     Claude Code: the parallel run's primacy, the wake-arrival check against
 *     the transcript, the update notice, the doctor notice, the first-launch
 *     question, the dream line and the headless nightly run). `ClaudeCodeAdapter`
 *     EXTENDS `Lifecycle`, so its hook bodies read exactly as they did.
 *
 * Nothing here was rewritten on the way over: the bodies moved as they were,
 * their order is their behaviour, and the rows and ring events they leave are
 * the same names with the same fields. `host` is the one addition — which host
 * this lifecycle serves, written onto every registry record it writes
 * (`sessions.ts#SessionRecord.host`, absent reads as Claude Code's).
 *
 * The rules each part keeps are stated where the part is, and they are the
 * claude-code CONTRACT's: no hook fails the host (every method here swallows its
 * own failures or is called inside the adapter's `guard`), telemetry never fails
 * a session, an observer writes nothing, and what cannot fit is deferred, never
 * truncated.
 *
 * It sits beside `sessions.ts` for the reason that file does: every host
 * adapter needs it, and no adapter may import another. It imports no adapter.
 */
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
  WRITE_UP_FAILED_EVENT,
} from "../core/counterpart.js";
import type { AdapterDurableEventName, DeliveryWarningName, PlainReminder, WakeHere } from "../core/counterpart.js";
import type {
  BoundaryKind,
  CaptureResult,
  Turn as CapturedTurn,
} from "../core/remember/index.js";
import { calendarDate } from "../core/self/index.js";
import { ahaDue, ahaLine, markAha, meetPending, meetState, noteOffered, offerDue, offerLine, onboardingMarker, settleOffer } from "../core/onboarding.js";
import { localClock, localDate, readableDate } from "../core/time.js";

import { CONFIG_FILE_EVENT } from "./config-path.js";
import { capabilities, TUNABLES } from "./config.js";
import type { AdapterConfig, CapabilityReport } from "./config.js";
import { countTranslated, readHandleResolutions, translateExpansions } from "./expansions.js";
import type { ExpansionsRead } from "./expansions.js";
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
  stanceOfMode,
} from "./scopes.js";
import type { ScopeVerdict } from "./scopes.js";
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
  writeUpEntries,
  writeUpParts,
  writeUpPlan,
} from "./sessions.js";
import type { SessionPhase } from "./sessions.js";
import { planSpawn, spawnDetached } from "./spawn.js";
import type { SpawnOutcome, Spawner } from "./spawn.js";

/** A turn as the host reports it. `source` is what makes G10/G11 decidable;
 *  `entry` (when the host has one) groups the blocks of one message, so pacing
 *  counts the message once (`claude-code/transcript.ts#TranscriptTurn`). */
export interface HostTurn extends CapturedTurn {
  readonly entry?: number;
}

/**
 * A deliberate-recall call, positioned against the session's turns: after turn
 * `atTurn`, these ids were asked for by name. Structural, so this file imports
 * no host's transcript reader (`claude-code/transcript.ts#Expansion` is one).
 */
export interface TurnExpansion {
  readonly atTurn: number;
  readonly ids: readonly string[];
}

/**
 * ONE MOMENT OF A SESSION, as any host reports it. A host with more to say
 * extends this (`claude-code/hooks.ts#HookInput` adds its transcript's path and
 * the Stop re-fire); what is here is all the lifecycle reads.
 */
export interface SessionInput {
  readonly sessionId: string;
  /** The project scope. The host's cwd, resolved — never a raw relative path. */
  readonly scope: string;
  /** The transcript slice the host can see. The cursor decides what is new. */
  readonly turns?: readonly HostTurn[];
  /** True when the host named a transcript this process could not read: the
   *  empty `turns` are then not a count, and pacing moves no watermark on them. */
  readonly turnsUnread?: boolean;
  /** Deliberate-recall calls positioned against `turns`. */
  readonly expansions?: readonly TurnExpansion[];
  /** What the user typed this turn (`user-prompt-submit`). */
  readonly prompt?: string;
  /** The model that wrote the transcript's last assistant entry, when known. */
  readonly model?: string;
  /** Today's calendar date, for the temporal channel and the horizon lane. */
  readonly at?: string;
  /**
   * This session is the HEADLESS NIGHTLY RUN this package started
   * (`claude-code/night-run.ts`, `COUNTERPARTS_NIGHT_RUN` in its environment,
   * 2026-09-29): `claude -p` running the page writer, the dream and the
   * reflection, which nobody watches. It is kept QUIET — it still wakes with
   * the ordinary wake, and nothing else: no capture (so it owes no write-up),
   * no dream lines, no plain reminders, no Stop ask, no write-up pointer, no
   * first-launch question.
   */
  readonly nightRun?: boolean;
  /**
   * How the host was started, from `CLAUDE_CODE_ENTRYPOINT` in the hook's
   * environment (`cli`, `sdk-cli` for `claude -p`, `sdk-ts` / `sdk-py` for the
   * Agent SDK, …). Kept on the session's registry record; a small owed
   * stretch from one that was not a person's interactive conversation is not
   * pointed at (`sessions.ts#NON_INTERACTIVE_ENTRYPOINTS`, review of #285 N2).
   */
  readonly entrypoint?: string;
}

export interface AdapterEvent {
  readonly at: number;
  readonly name: string;
  readonly data: Record<string, string | number | boolean | null>;
}

export interface LifecycleOptions {
  readonly counterpart: Counterpart;
  readonly config: AdapterConfig;
  /**
   * WHICH HOST THIS LIFECYCLE SERVES (`hosts.ts`), written onto every registry
   * record it writes. Absent: `DEFAULT_HOST`, Claude Code — which is what every
   * caller before 2026-09-30 was, and what a record with no host reads as.
   */
  readonly host?: string;
  /** The interpreter the detached worker runs under. */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly spawner?: Spawner;
  readonly onEvent?: (e: AdapterEvent) => void;
  readonly now?: () => number;
  /**
   * WHICH CONFIGURATION FILE THIS PROCESS READ — an absolute path, resolved by
   * the entry point (`claude-code/bin/hook.ts`, via `adapters/config-path.ts`)
   * and passed in because it is a fact about one process's startup, not
   * something the lifecycle may go and re-derive.
   *
   * The lifecycle does three things with it, all of them recording:
   *   - one ring event at construction;
   *   - the `config` field of every session registry record it writes, which is
   *     the only DURABLE trace a hook can leave of this (a hook has no stdout to
   *     tell the owner with — that channel is the model's context);
   *   - the pin onto the detached worker's environment, so parent and child read
   *     one file rather than resolving two.
   */
  readonly configPath?: string;
  /**
   * WHAT `<config dir>/scopes.json` SAYS ABOUT THIS DIRECTORY, resolved by the
   * entry point before anything opened (`claude-code/bin/hook.ts#hookScopeVerdict`).
   *
   * The lifecycle records it once; the host adapter decides what else it means
   * — for Claude Code, the first-launch question when it is `unset` (G41), and
   * the `off` refusal in its `guard()`, as a second, cheap site behind the
   * entry point's (observer-mode G8's shape).
   */
  readonly scope?: ScopeVerdict;
  /** The sentence a registry that IS there and could not be read produced. */
  readonly scopeUnreadable?: string;
  /**
   * The ENTRIES that registry refused, by key (#92 review, F2). A file can parse
   * while one directory's entry does not, and those directories read as unset —
   * which is ON. Ring event here, and a flag on the wake's durable row, because
   * a hook process lives for one turn and "why is this directory recording
   * again" has to be answerable tomorrow.
   */
  readonly scopeRefused?: readonly string[];
}

/**
 * THE NEXT-SESSION WRITE-UP'S POINTER (roadmap C2, owner 2026-09-23).
 *
 * A session that ended before it was written up — it owes, by `core/coverage/`'s
 * rule, read through `remember/owes.ts#planRetention` — is written up by the
 * NEXT session that starts in its project. The host does not carry its words: it
 * puts a short POINTER beside the wake (Claude Code: in `HookResult.ask`) — how
 * many sessions here are waiting, the oldest one's id, date and size, and the
 * call that fetches it — and the words come back through the MCP door
 * (`mcp/write-up.ts`): `session_end` with `writeUp` and no memories returns the
 * next part, up to ~24 KB; the same call with memories — or `[]`, "nothing
 * worth keeping" — answers it. Nothing leaves the machine beyond what the host
 * already sees; the write-up is in the model's voice. (It is the only route:
 * the opt-in Anthropic API sweep was removed with the key, 2026-09-24.)
 *
 * **Retired under dreaming `auto` (2026-10-11).** There the nightly run writes
 * up everything owed in any directory, and `counterparts catch-up` does it on
 * demand, so a new session no longer spends its start on another session's
 * words (`writeUpPointerRetired`). The night starts for that alone when
 * write-ups from an earlier day are owed and the dream is not due
 * (`claude-code/hooks.ts#catchUpWhenOwed`), so a first day with few memories
 * is still written up. Under `ask` or `off` no night runs, and this
 * pointer is still the way a session in a quiet folder gets written up.
 *
 * **Why a pointer (owner's choice, 2026-09-23, option (b) of claude-code
 * INTERFACE-GAPS §15).** Claude Code caps a hook's whole output at 10,000
 * characters and turns anything longer into a preview — of the WAKE, which
 * comes first. On a store whose wake fills its budget there was no room for the
 * words; an MCP result is not under that cap. The pointer names the ended
 * session ONCE and this session once: ~410 bytes with the host's 36-character
 * ids (measured).
 *
 * **Measured against the host's plain-stdout cap, not the reported budget**
 * (PR #192 review, MAJOR 1). The budget is what the WAKE is composed to; with no
 * owner notice `claude-code/bin/hook.ts#hostDelivery` prints the wake and the
 * asks as PLAIN text, which the host caps at 10,000 characters with no JSON
 * escaping to allow for (bytes ≥ characters, so a byte count under the cap is a
 * character count under it). With a notice, `hostDelivery`'s own rule drops the
 * notice when the envelope would not fit — the wake and its asks win, as
 * always. A pointer that does not fit DEFERS, claims nothing, and says so
 * durably (`sessions.ts#WRITE_UP_POINTER_KEY`), which doctor reads. The count
 * is BYTES against a cap in characters — accepted (PR #192 re-review, NIT): it
 * is the safe direction, and it defers early only for a multi-byte wake over
 * ~9,575 bytes, which is already past the 9,000-byte budget `install` writes.
 *
 * **Once per session, and the day's allowance.** A compaction re-firing
 * SessionStart points at nothing; at most `WRITE_UP_ASKS_PER_DAY` sessions a
 * calendar day (local time) are pointed. It MAY COINCIDE with the page writer's
 * ask or the first-launch question — the roadmap's reading of §13 G3, which is
 * about the blocked Stop: both are carried, the other first. Never under
 * observer, never in a directory set `off` (the entry point returns before
 * anything opens).
 */
export const WRITE_UP_OPEN = "<counterparts-write-up>";
export const WRITE_UP_CLOSE = "</counterparts-write-up>";
/** The door, named the way the other asks name their tools. */
export const WRITE_UP_TOOL = "counterparts session_end";
/** Today's pointer count, beside the spawn tally in box 2's meta: two fixed
 *  keys, the date and the count, so nothing grows without a sweep. */
export const WRITE_UP_ASK_DATE_KEY = "adapter.writeup.asks.date";
export const WRITE_UP_ASK_COUNT_KEY = "adapter.writeup.asks.count";

/** What the pointer adds for a SMALL owed stretch (2026-09-29; since
 *  2026-09-30 `coverage/`'s `small`, under six pieces): one plain sentence. */
export const WRITE_UP_SHORT_LINE = "It was a short session: one line is enough, or memories: [] only if nothing in it held your attention.";

/** THE POINTER the model reads — short, because the words come from the door,
 *  and naming the ended session once. A small owed stretch (`short`) gets the
 *  same pointer and one sentence more. */
export function writeUpPointer(input: {
  waiting: number;
  ended: string;
  endedOn: string;
  bytes: number;
  part: number;
  of: number;
  live: string;
  short?: boolean;
}): string {
  const some =
    input.waiting === 1
      ? "An earlier session here ended before it was written up"
      : `${String(input.waiting)} earlier sessions here ended before they were written up`;
  const size = input.bytes < 1024 ? "under 1 KB" : `~${String(Math.round(input.bytes / 1024))} KB`;
  const part = input.of <= 1 ? "" : `, part ${String(input.part)} of ${String(input.of)}`;
  return [
    WRITE_UP_OPEN,
    `${some}; the oldest, from ${input.endedOn}, left ${size} of what was said there${part}. To write it up, call ${WRITE_UP_TOOL} with session: ${input.live}, writeUp: ${input.ended} and no memories to get the words, then again with what caught your attention, one idea each (memories: [] only if nothing did).${input.short === true ? ` ${WRITE_UP_SHORT_LINE}` : ""}`,
    WRITE_UP_CLOSE,
  ].join("\n");
}

const EVENT_RING = 500;

/**
 * Where the per-reason spawn refusal counters live: box 2's meta, under
 * `adapter.spawn.refusals.<reason>`.
 *
 * In the STORE because scar E4's escalation is a claim about a HOST over time
 * and a hook process lives for one turn. I32 is the bill for having kept it in
 * an instance field: the worker was refused at every boundary for a week and
 * `escalate` read false every single time, because every count was the first.
 *
 * Meta keys, not a schema change — the same shape `sleep.pruned.<id>` uses.
 */
export const SPAWN_REFUSAL_PREFIX = "adapter.spawn.refusals.";

/**
 * The other side's counter (2026-09-20, E2): how many times the worker HAS
 * started today. Two fixed keys rather than one per date, because nothing mows
 * meta and the only question the `adapter.spawn.started` row asks of it is "how
 * many today" — the row itself carries the date.
 */
export const SPAWN_START_DATE_KEY = "adapter.spawn.started.date";
export const SPAWN_START_COUNT_KEY = "adapter.spawn.started.count";

/** Plain reminders due today, in both renderings (`Lifecycle#plainFor`). */
export interface PlainLines {
  /** For the MODEL: one line each, each ending in a newline. */
  readonly context: string;
  /** For the PERSON: the bare lines, in the same order. */
  readonly notices: string[];
  /** The records behind them, in the same order — claimed only at delivery. */
  readonly due: PlainReminder[];
}

/**
 * THE INTERFACE A HOST ADAPTER DRIVES. One session's moments, in the order a
 * session lives them; every method is host-neutral, and the host adapter owns
 * when each is called and what its result is wrapped in.
 *
 * Every method is fail-open where its body always was: the registry writes, the
 * pointer, the pacing and the spawn never throw; `composeWake`, `recallTurn`
 * and `captureBoundary` are called inside the host adapter's own guard, as
 * they were inside the hooks'.
 */
export interface HostLifecycle {
  /** Which host this lifecycle serves (`hosts.ts`). */
  readonly host: string;
  readonly counterpart: Counterpart;
  readonly config: AdapterConfig;
  readonly observer: boolean;
  /** What the scope registry said about this directory. `unset` when nobody said. */
  readonly scope: ScopeVerdict;

  /** The ring: every event this lifecycle raised, newest last. */
  events(name?: string): AdapterEvent[];
  /** §4 G4: every host-dependent limit, as a checkable value. */
  capabilities(): CapabilityReport[];

  /** The live-session registry, at one of a session's three moments. */
  noteSession(phase: SessionPhase, input: SessionInput): void;
  /** The wake, composed to `budget` for this session and place, and the
   *  registry's note of the sentinel it was printed with. */
  composeWake(input: SessionInput, budget: number | undefined): ReturnType<Counterpart["wake"]>;
  /** `Now: Fri 25 Sep 2026, 1:40 pm MDT` — the lifecycle's clock, in the store's zone. */
  nowLine(): string;
  /** Plain reminders due today — a READ; nothing is claimed. */
  plainFor(input: SessionInput): PlainLines;
  /** Claim the plain reminders a delivery is certainly about to show. */
  claimPlain(input: SessionInput, due: readonly PlainReminder[]): PlainReminder[];

  /** Recall for a turn, and its durable `recall.delivered` row. */
  recallTurn(
    input: SessionInput,
    text: string,
    opts?: { budgetBytes?: number; withhold?: ReadonlySet<string> },
  ): ReturnType<Counterpart["recallForTurn"]>;

  /** The boundary: capture, the boundary record, credit, the durable row.
   *  `label` is the host's name for the event, recorded as `hook` on the row. */
  captureBoundary(label: string, kind: BoundaryKind, input: SessionInput): BoundaryCapture;
  /** The orphanable tail, measured at a session's end or a compaction. */
  noteTail(input: SessionInput): void;
  /** The ask's PACING: the chapter this boundary asks for, or null when it
   *  asks nothing. The host words the ask. */
  paceAsk(input: SessionInput): number | null;

  /** The next-session write-up pointer, measured against the room the caller
   *  names; the empty string when there is none, or no room for it. `label`
   *  is the host's name for the moment it rides on, recorded as `hook` when it
   *  gives way (Claude Code: `session-start`, the default; Desktop: `wake`). */
  deliverWriteUpAsk(
    input: SessionInput,
    spent: number,
    opts?: { limit?: number; cost?: (text: string) => number; beside?: string; label?: string },
  ): string;
  /** Whether that pointer is retired: dreaming `auto`, where the nightly run
   *  catches up on everything owed (2026-10-11). A read. */
  writeUpPointerRetired(): boolean;

  /** The detached worker, planned, started and counted. */
  spawnWorker(input?: SessionInput): SpawnOutcome;
  /** How many times the worker has started TODAY. A read. */
  spawnStarts(): { date: string | null; count: number };
  /** The per-reason refusal counters, as they stand. A read. */
  spawnRefusals(): Record<string, number>;
}

/** What a boundary captured, for the host to fold into its own result. */
export interface BoundaryCapture {
  /** The capture's reason (`remember/`'s vocabulary: `CAPTURED`, `NOTHING_NEW`, …). */
  readonly reason: string;
  readonly spansAppended: number;
}

export class Lifecycle implements HostLifecycle {
  readonly host: string;
  readonly counterpart: Counterpart;
  readonly config: AdapterConfig;
  readonly observer: boolean;

  protected readonly command: string;
  protected readonly args: readonly string[];
  protected readonly spawner: Spawner | undefined;
  protected readonly onEvent: ((e: AdapterEvent) => void) | undefined;
  protected readonly nowFn: () => number;
  /** The configuration file this process read — recorded, pinned, never re-derived. */
  protected readonly configPath: string | undefined;
  /** What the scope registry said about this directory. `unset` when nobody said. */
  readonly scope: ScopeVerdict;
  /**
   * WHETHER THE REGISTRY ITSELF WAS IN TROUBLE when this process read it, for
   * the wake's durable row (#92 review, F2): `unreadable` is the whole file,
   * `partial` is one or more entries refused by name. Null is the ordinary day,
   * and the field is `null` on the row rather than absent, so a reader can tell
   * "the registry was fine" from "this row predates the question".
   */
  protected scopeTrouble: "unreadable" | "partial" | null = null;
  private readonly ring: AdapterEvent[] = [];
  /**
   * Consecutive identical spawn refusals, per reason (scar E4's escalation) —
   * IN MEMORY ONLY when this lifecycle cannot write, which is the observer case.
   *
   * The durable copy lives in box 2's meta under `adapter.spawn.refusals.<reason>`
   * and is the one that counts. This map used to BE the counter, and that is
   * half of why I32 ran for a week: a hook process lives for one turn, so
   * "consecutive" was always 1, `escalate` was always false, and scar E4's
   * widening — a repeated refusal reaches a human — was inert on this host after
   * shipping. An instrument still counts here and nowhere else (§15 G3).
   */
  private readonly volatileRefusals = new Map<string, number>();

  constructor(opts: LifecycleOptions) {
    this.host = opts.host ?? DEFAULT_HOST;
    this.counterpart = opts.counterpart;
    this.config = opts.config;
    this.observer = opts.counterpart.observer;
    this.command = opts.command ?? process.execPath;
    this.args = opts.args ?? [];
    this.spawner = opts.spawner;
    this.onEvent = opts.onEvent;
    this.nowFn = opts.now ?? ((): number => Date.now());
    this.configPath = opts.configPath;
    this.scope = opts.scope ?? { mode: "unset", matched: null, entry: null };
    // ONE event naming the configuration this process read: a hook's stdout
    // belongs to the model, so
    // "which file answered" has nowhere else to go in-process. The durable half
    // is the session record's `config` field (`noteSession`).
    if (opts.configPath !== undefined && opts.configPath.length > 0) {
      this.emit(CONFIG_FILE_EVENT, { path: opts.configPath });
    }
    // ONE event naming the scope verdict this process ran under, and which
    // entry produced it — the answer to "why did this directory record nothing
    // today", which is otherwise a question only a person reading two JSON
    // files can answer.
    this.emit(SCOPE_EVENT, {
      mode: this.scope.mode,
      matched: this.scope.matched,
      stance: stanceOfMode(this.scope.mode),
    });
    // A registry that IS there and could not be read resolved to `unset` — on,
    // today's behaviour — and says so, because a silent fall-back to the
    // default is exactly the shape scar §2.4 is about.
    if (opts.scopeUnreadable !== undefined && opts.scopeUnreadable.length > 0) {
      this.emit(SCOPE_UNREADABLE_EVENT, { detail: opts.scopeUnreadable });
    }
    // The per-ENTRY half of the same fact. Those directories read as unset,
    // which is on: an `off` somebody typed badly is an `off` nobody is keeping.
    if (opts.scopeRefused !== undefined && opts.scopeRefused.length > 0) {
      this.scopeTrouble = "partial";
      this.emit(SCOPE_REFUSED_EVENT, {
        count: opts.scopeRefused.length,
        keys: opts.scopeRefused.join(", "),
      });
    }
    // An unreadable FILE outranks refused entries: there were no entries.
    if (opts.scopeUnreadable !== undefined && opts.scopeUnreadable.length > 0) {
      this.scopeTrouble = "unreadable";
    }
  }

  events(name?: string): AdapterEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  /** §4 G4: every host-dependent limit, as a checkable value. */
  capabilities(): CapabilityReport[] {
    return capabilities(this.config);
  }

  /**
   * The registry fields every write from this lifecycle carries: which
   * configuration it read (when it was told), and which host it serves.
   */
  protected recordStamp(): { config?: string; host: string } {
    return {
      ...(this.configPath === undefined || this.configPath.length === 0 ? {} : { config: this.configPath }),
      host: this.host,
    };
  }

  // ── the wake ───────────────────────────────────────────────────────────────

  /**
   * THE WAKE, composed for this session: what the previous boundary published,
   * with the delivery preface (which system, which day, which date) and — WHERE
   * this session woke riding beside WHEN (E1) — the handoff pointer that
   * belongs to this directory, if any. Reads only: no model call, no network,
   * no state written (claude-code §1 G1) — since 2026-10-10 the core ASSEMBLES
   * the lanes that are plain reads for this moment (self CONTRACT §5 G1), and
   * the registry's sessions ride along for its "Today, elsewhere" line.
   *
   * Then THE EXPECTATION, WRITTEN WHERE THE NEXT PROCESS CAN READ IT. This used
   * to be a `Map` on the adapter instance, which is a line that only looks like
   * it works: every hook is its own process, so the hook that tests it always
   * met an empty map. `adapter.wake.delivered` wrote no row in two weeks of
   * running (mechanism inventory 2026-09-17, S2).
   */
  composeWake(input: SessionInput, budget: number | undefined): ReturnType<Counterpart["wake"]> {
    const dir = this.counterpart.store.dir;
    const woke = this.counterpart.wake(
      budget,
      { ...(input.at === undefined ? {} : { date: input.at }) },
      {
        ...this.elsewhereHere(input),
        // What a handoff's release is compared with (2026-10-01): the version
        // on disk NOW, which a long-running server's own may not be.
        installed: manifestVersionOnDisk(),
        openedWith: (session) => readSession(dir, session)?.opened?.build.version ?? null,
      },
    );
    this.noteWakeExpectation(input, woke.sentinel);
    return woke;
  }

  /**
   * WHERE AND WHO, AND WHAT MAY BE NAMED FROM ELSEWHERE — what both elsewhere
   * lines are handed (the wake's "Today, elsewhere", 2026-10-10, and the
   * prompt's "Since you started", 2026-10-11), so the two read the registry
   * and the scope setting the same way. The registry is host state only —
   * which directory, when, live or ended; the core keeps what the scope
   * setting lets it name.
   */
  protected elsewhereHere(input: SessionInput): Pick<WakeHere, "scope" | "session" | "exportsFrom" | "sessions"> {
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
          endedAt: r.endedAt,
        }));
      },
    };
  }

  /**
   * A SESSION THAT HAS JUST BEEN HANDED ITS WAKE has heard what the other
   * directories did (2026-10-11): its "Since you started" line counts from
   * now, and says nothing at the next prompt. SessionStart's call, after the
   * wake is composed — a compaction's too, which hands it a fresh wake. Not
   * under observer, not for the nightly run, not without an id. Never throws.
   */
  protected noteSinceWoke(input: SessionInput & { nightRun?: boolean }): void {
    if (this.observer || input.nightRun === true || input.sessionId.length === 0) return;
    try {
      markSinceSeen(this.counterpart.store.dir, input.sessionId, { at: this.nowFn(), state: "woke" });
    } catch {
      /* a mark that will not write costs the line, never the wake */
    }
  }

  /**
   * THE "SINCE YOU STARTED" LINE, for a prompt in a session already open
   * (2026-10-11; option C, Mike approved 2026-10-10): one line for the MODEL,
   * naming what changed in the other directories since this session last
   * heard — or the empty string. `room` is the bytes this prompt's envelope
   * has left once everything already in it is counted: the line gives way to
   * all of it, and takes the widest of its forms that fits.
   *
   * At most once an hour, and never at the first prompt after a wake, by the
   * session's own state in the registry (`SessionRecord.sinceSeen`):
   *   - `woke` (or no state, a session older than this build): this prompt
   *     arms it and says nothing — the wake just covered it;
   *   - `armed`: the line goes out when something changed and it fits;
   *   - `shown`: nothing, not even a read, until an hour after the last line.
   * A line that does not fit is not marked: the next prompt tries again and
   * the hour is not spent. The state moves only when it arms or a line goes
   * out, so a quiet prompt writes nothing more than it did.
   *
   * Reads only from the store (the counts and the chapter walk), the registry
   * and the scope setting: no model, no embedding, no store write. Nothing
   * under observer or for the nightly run; a folder that is off or paused
   * never reaches here (`guard`). Never throws.
   */
  sinceLine(
    input: SessionInput & { nightRun?: boolean },
    room: number,
    /** A RESUMED session's start (2026-10-11): its short wake says what changed
     *  since it last heard, whatever the state and the hour. */
    opts: { readonly resumed?: boolean } = {},
  ): string {
    if (this.observer || input.nightRun === true || input.sessionId.length === 0) return "";
    try {
      const dir = this.counterpart.store.dir;
      const record = readSession(dir, input.sessionId);
      if (record === null) return "";
      const now = this.nowFn();
      const seen = record.sinceSeen ?? { at: record.startedAt, state: "woke" as const };
      if (seen.state === "woke" && opts.resumed !== true) {
        markSinceSeen(dir, input.sessionId, { at: seen.at, state: "armed" });
        return "";
      }
      if (seen.state === "shown" && now - seen.at < TUNABLES.SINCE_LINE_EVERY_MS && opts.resumed !== true) return "";
      const lines = this.counterpart.sinceElsewhere(
        { since: seen.at, until: now, started: seen.state !== "shown" },
        this.elsewhereHere(input),
      );
      if (lines === null) return "";
      const line = [lines.line, ...lines.shorter].find((l) => Buffer.byteLength(`${l}\n`, "utf8") <= room);
      if (line === undefined) {
        this.emit("adapter.since.deferred", { room, need: Buffer.byteLength(`${lines.line}\n`, "utf8") });
        return "";
      }
      if (!markSinceSeen(dir, input.sessionId, { at: now, state: "shown" })) return "";
      this.emit("adapter.since.shown", { bytes: Buffer.byteLength(line, "utf8") });
      return line;
    } catch (err) {
      this.emit("adapter.since.failed", { code: err instanceof Error ? err.name : "unknown" });
      return "";
    }
  }

  /**
   * THE FIRST MEETING'S LINE BESIDE THE WAKE (2026-10-11, `core/onboarding.ts`),
   * for every host: the offer while the meeting is due (at most once a calendar
   * day, never twice in a session, none once done or skipped), else — in the
   * first session after it was finished — one memory from it. A READ, but for
   * moving a stale `offered` to `later`: the caller measures the line against
   * its envelope and calls `commit` only once the envelope certainly carries
   * it, so a line that gave way is offered again next time. Null when nothing
   * is due, under observer, for the nightly run, without an id; never throws.
   * Whether a person can see the reply at all (`claude -p`) is the host's
   * test: the hook asks only for an interactive session.
   */
  onboardingLine(input: SessionInput & { nightRun?: boolean }): { kind: "offer" | "aha"; text: string; commit: () => void } | null {
    if (this.observer || input.nightRun === true || input.sessionId.length === 0) return null;
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
          },
        };
      }
      const live = (id: string): boolean => {
        const r = store.row(id);
        // Not one marked confidential since (review of #419): this line rides
        // into wakes that are not the owner's own, such as a Desktop chat.
        return r !== undefined && r.archived === 0 && r.superseded_by === null && r.confidential === 0;
      };
      const aha = ahaDue(store, input.sessionId, live);
      if (aha === null) return null;
      return {
        kind: "aha",
        text: ahaLine(store.readProse(aha.memoryId).body, aha.memoryId),
        commit: () => {
          markAha(store, input.sessionId);
          this.emit("adapter.meet.aha", { step: aha.step });
        },
      };
    } catch (err) {
      this.emit("adapter.meet.failed", { code: err instanceof Error ? err.name : "unknown" });
      return null;
    }
  }

  /**
   * The first meeting's machine marker for a session-start wake
   * (`core/onboarding.ts#onboardingMarker`). Given the session, it says the
   * SETTLED state (review of #419): an `offered` from an earlier day is moved
   * to `later` first, as the line beside the wake would move it, so the two
   * never disagree. Under observer, for the nightly run or without an id it
   * only reads. Never throws.
   */
  onboardingMarker(input?: SessionInput & { nightRun?: boolean }): string {
    const store = this.counterpart.store;
    if (input !== undefined && !this.observer && input.nightRun !== true && input.sessionId.length > 0) {
      try {
        return onboardingMarker(settleOffer(store, input.at ?? store.today()));
      } catch {
        /* the read below says what it can */
      }
    }
    return onboardingMarker(meetState(store));
  }

  /** Is the first meeting still to happen? The first-launch scope question waits while it is: the meeting asks where. */
  meetPending(): boolean {
    try {
      return meetPending(this.counterpart.store);
    } catch {
      return false;
    }
  }

  /**
   * WHICH DIRECTORIES' CHAPTERS MAY BE NAMED IN ANOTHER DIRECTORY'S WAKE
   * (review of #311): those the scope setting has `on` (or unset, which is on).
   * The setting is read once per wake, from beside this lifecycle's
   * configuration; with no configuration named, or a setting that will not
   * read, nothing crosses. A pseudo-scope (`claude-desktop:`) is a place, not
   * a path, and is looked up as written. Never throws.
   */
  protected chapterExports(): ((scope: string) => boolean) | undefined {
    const config = this.configPath;
    if (config === undefined || config.length === 0) return undefined;
    let read: ReturnType<typeof readScopes>;
    try {
      read = readScopes(scopesPath(config));
    } catch {
      return undefined;
    }
    if (read.error !== null) return undefined;
    return (scope) => {
      try {
        return stanceOfMode(lookupScope(read.registry, scope).mode) === "on";
      } catch {
        return false;
      }
    };
  }

  /**
   * WRITE DOWN WHAT THE HOST WAS JUST HANDED, so a later process can ask whether
   * it arrived. A second write of the same phase, for the same reason
   * the first-launch question makes one: the first write happens before the
   * delivery verdict and the bundle is composed after it.
   *
   * A wake with NO sentinel — the bootstrap line a store with nothing in it
   * publishes — writes nothing, and the absence is the answer: there was no
   * checkable bundle, so nothing was supposed to arrive.
   */
  protected noteWakeExpectation(input: SessionInput, sentinel: string | null): void {
    if (this.observer) return;
    if (input.sessionId.length === 0) return;
    if (sentinel === null || sentinel.length === 0) return;
    const marked = recordSession(this.counterpart.store.dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase: "start",
      at: this.nowFn(),
      wakeSentinel: sentinel,
      ...this.recordStamp(),
    });
    this.emit("adapter.wake.expected", { recorded: marked !== null });
  }

  /** `Now: Fri 25 Sep 2026, 1:40 pm MDT` — this lifecycle's clock, in the store's zone. */
  nowLine(): string {
    return `Now: ${localClock(this.nowFn(), this.counterpart.store.zone())}`;
  }

  /**
   * PLAIN REMINDERS, in words (owner decision 2026-09-25/26): "Today: pay your
   * taxes". Two renderings of each, from the same record —
   *
   *   - `notices`, for the PERSON, bare: Claude Code shows them as the hook's
   *     `systemMessage` in the terminal (`claude-code/bin/hook.ts#hostDelivery`);
   *   - `context`, for the MODEL, one line each ending in a newline, saying it
   *     was asked for and naming the memory, so it can raise it and look it up.
   *
   * A READ (2026-09-26 review): nothing is claimed here. The delivery claims
   * what its envelope will certainly carry (`claimPlain`, from
   * `claude-code/bin/hook.ts#deliverTurn`) and strips the rest, so a beat is
   * never spent on a line the person did not get. No date (`input.at` absent)
   * means no calendar, and so nothing; the headless nightly run is told nothing
   * (`SessionInput.nightRun`). Never throws.
   */
  plainFor(input: SessionInput): PlainLines {
    const none = { context: "", notices: [], due: [] };
    if (input.at === undefined || input.nightRun === true) return none;
    try {
      const due = this.counterpart.plainDueToday({ at: input.at });
      return {
        context: due.map((r) => `${plainContextLine(r)}\n`).join(""),
        notices: due.map(plainLine),
        due,
      };
    } catch {
      return none;
    }
  }

  /**
   * CLAIM plain reminders the delivery is certainly about to show — the latch
   * (`Counterpart.claimPlainReminder`) decides, so of two processes racing for
   * one beat exactly one gets it back. Returns the ones this call claimed, in
   * order; the caller shows only those. Never throws.
   */
  claimPlain(input: SessionInput, due: readonly PlainReminder[]): PlainReminder[] {
    if (input.at === undefined || due.length === 0) return [];
    const at = input.at;
    const claimed = due.filter((r) => {
      try {
        return this.counterpart.claimPlainReminder(r, { at, session: input.sessionId });
      } catch {
        return false;
      }
    });
    if (claimed.length > 0) this.emit("adapter.plain.told", { count: claimed.length });
    if (claimed.length < due.length) this.emit("adapter.plain.lost", { count: due.length - claimed.length });
    return claimed;
  }

  /**
   * IS THE POINTER RETIRED? True under dreaming `auto`, where the nightly run
   * catches up on everything owed (2026-10-11). A setting that will not read
   * keeps the pointer: the safe direction is a session that may be asked.
   */
  writeUpPointerRetired(): boolean {
    try {
      return this.counterpart.dreams.setting() === "auto";
    } catch {
      return false;
    }
  }

  /**
   * THE NEXT-SESSION WRITE-UP'S POINTER (C2) — find the session in this project
   * that ended owing a write-up and was pointed at least recently (oldest first
   * among equals), and point this session at it. Returns the block, or the empty
   * string.
   *
   * `spent` is the bytes the wake and any other ask already take, separators
   * included. **The whole body is fail-open**: a pointer that cannot be
   * composed costs the pointer and never the wake (§1 G7).
   *
   * The marks come before the words, the page writer's order: the progress
   * entry (so the rotation moves on even if nobody fetches), then this
   * session's `writeUpPointer` — the door's evidence that this session may
   * fetch that session's words — then the day's count and the durable outcome.
   * A mark that will not land hands nothing over.
   */
  deliverWriteUpAsk(
    input: SessionInput,
    spent: number,
    opts: { limit?: number; cost?: (text: string) => number; beside?: string; label?: string } = {},
  ): string {
    try {
      // Never under observer: an instrument asks nobody to write into a store
      // it may not write, and has no registry mark to remember that it did.
      if (this.observer) return "";
      if (input.sessionId.length === 0 || input.nightRun === true) return "";
      // RETIRED WHERE THE NIGHT CATCHES UP (2026-10-11): under dreaming `auto`
      // the nightly run writes up everything owed, in any directory, and
      // `counterparts catch-up` does it on demand — so a new session no longer
      // spends its start on another session's words, out of order. Under `ask`
      // or `off` no night runs, and the pointer is still the way an ended
      // session in a quiet folder gets written up.
      if (this.writeUpPointerRetired()) {
        this.emit("adapter.writeup.skipped", { reason: "night-catches-up" });
        return "";
      }
      const store = this.counterpart.store;
      const dir = store.dir;
      // ONE PER SESSION. A compaction re-fires SessionStart, and the record
      // carries the mark forward (`sessions.ts#recordSession`).
      const record = readSession(dir, input.sessionId);
      if (record?.writeUpPointer !== undefined) return "";
      // THE DAY'S ALLOWANCE, before anything is read — a spent day costs two
      // meta reads and nothing else.
      const today = this.counterpart.self.calendarToday();
      const spentToday =
        store.getMeta(WRITE_UP_ASK_DATE_KEY) === today ? Number(store.getMeta(WRITE_UP_ASK_COUNT_KEY) ?? "0") : 0;
      if (spentToday >= TUNABLES.WRITE_UP_ASKS_PER_DAY) {
        this.emit("adapter.writeup.skipped", { reason: "asks-spent", today: spentToday });
        return "";
      }
      const now = this.nowFn();
      const plan = writeUpPlan({ store, spans: this.counterpart.spans });
      // Entries whose session stopped owing some other way go first.
      pruneWriteUpProgress(store, plan);
      const inFlight = readWriteUpProgress(store);
      const zone = this.counterpart.store.zone();
      const owed = owedWriteUps(plan, dir, input.scope, now, {
        exclude: input.sessionId,
        progress: inFlight,
        pointedToday: (at) => calendarDate(at, zone) === today,
      });
      // Full write-ups come first (`owedWriteUps`), so a SMALL one is pointed
      // at only when no full one is waiting: it takes what is left of the
      // day's allowance.
      const first = owed[0];
      if (first === undefined) return "";
      const { held, here, short } = first;
      // THIS PROJECT'S WORDS ONLY (MAJOR 6).
      const entries = writeUpEntries(this.counterpart.spans, { session: held.session, scopes: [here] });
      if (entries.length === 0) return "";
      const key = progressKey(held.session, here);
      const progress = inFlight[key];
      const chunk = progress?.chunk ?? WRITE_UP_PART_BYTES;
      // ONCE THE LAST PART HAS COME BACK (`answer` set, the mark still to
      // land), the count is frozen: the words now read as kept, their marks
      // lengthen the text, and a recount could find a part that was never
      // served (re-review, m-B). The fetch finishes the mark.
      const finished = progress !== undefined && progress.answer !== undefined;
      const cut = finished ? [] : writeUpParts(entries, chunk);
      if (!finished && cut.length === 0) return "";
      const partsCount = finished ? progress.parts : cut.length;
      const done = finished ? progress.parts : Math.min(progress?.done ?? 0, partsCount);
      const text = writeUpPointer({
        waiting: owed.length,
        ended: held.session,
        endedOn: calendarDate(held.clockFrom, this.counterpart.store.zone()),
        bytes: cut.slice(done).reduce((n, p) => n + Buffer.byteLength(p, "utf8"), 0),
        part: Math.min(done + 1, partsCount),
        of: partsCount,
        live: input.sessionId,
        short,
      });
      const bytes = (opts.cost ?? ((t: string): number => Buffer.byteLength(t, "utf8")))(`\n\n${text}`);
      const limit = opts.limit ?? TUNABLES.HOST_OUTPUT_CHARS;
      const room = limit - spent;
      const outcome = (o: "pointed" | "deferred", reason?: string): void => {
        saveWriteUpPointer(store, {
          at: now,
          date: today,
          outcome: o,
          ...(reason === undefined ? {} : { reason }),
          need: bytes,
          room,
          ...(limit === TUNABLES.HOST_OUTPUT_CHARS ? {} : { limit }),
          ...(opts.beside === undefined || opts.beside.length === 0 ? {} : { beside: opts.beside }),
        });
      };
      if (bytes > room) {
        // DEFERRED, never truncated: nothing is claimed, so the next start in
        // this project is pointed instead — and the deferral is DURABLE, so
        // doctor can say the wake is too full and by how much.
        this.emit("adapter.writeup.deferred", { reason: "host-cap", need: bytes, room });
        // WHICH MOMENT gave way is the host's word for it (2026-09-30): Claude
        // Code's SessionStart, or Desktop's `wake` tool result.
        this.noteDeliveryWarning(ENVELOPE_GAVE_WAY_EVENT, { hook: opts.label ?? "session-start", part: "pointer", need: bytes, room }, input);
        outcome("deferred", "host-cap");
        return "";
      }
      // SAVED INSIDE ONE TRANSACTION THAT RE-READS THE MAP (review of #308): a
      // claim the nightly run took since `inFlight` was read — its `claim` and
      // `upTo` — is kept, never overwritten from the stale copy, and a subject
      // another writer now holds is not pointed at: the pointer defers.
      let heldElsewhere = false;
      const saved = updateWriteUpProgress(store, (all) => {
        heldElsewhere = claimedByOther(all, held.session, input.sessionId, now) !== null;
        if (heldElsewhere) return false;
        const cur = all[key];
        all[key] = {
          ...(cur ?? {}),
          chunk: cur?.chunk ?? chunk,
          parts: partsCount,
          done: Math.min(cur?.done ?? done, partsCount),
          handedAt: now,
        };
        return true;
      });
      if (heldElsewhere) {
        this.emit("adapter.writeup.deferred", { reason: "claimed", need: bytes, room });
        return "";
      }
      const marked =
        saved &&
        recordSession(dir, {
          sessionId: input.sessionId,
          scope: input.scope,
          phase: "start",
          at: now,
          writeUpPointer: held.session,
          ...this.recordStamp(),
        }) !== null;
      if (!marked) {
        this.emit("adapter.writeup.deferred", { reason: "mark-unwritten", need: bytes, room });
        outcome("deferred", "mark-unwritten");
        return "";
      }
      try {
        if (store.getMeta(WRITE_UP_ASK_DATE_KEY) !== today) store.setMeta(WRITE_UP_ASK_DATE_KEY, today);
        store.setMeta(WRITE_UP_ASK_COUNT_KEY, String(spentToday + 1));
      } catch {
        /* a lost count is never a lost hook (§5 G2) */
      }
      outcome("pointed");
      this.emit("adapter.writeup.ask", {
        ended: held.session,
        part: Math.min(done + 1, partsCount),
        of: partsCount,
        bytes,
        owed: owed.length,
        short,
      });
      return text;
    } catch (err) {
      // DURABLE since 2026-09-30: whether a session was ever offered its
      // write-up is a fact a later reading needs, and this ring dies with the hook.
      this.record(WRITE_UP_FAILED_EVENT, input, { code: codeOf(err) });
      return "";
    }
  }

  // ── the turn ───────────────────────────────────────────────────────────────

  /**
   * RECALL FOR THIS TURN — the composed recall, all three borrowed channels
   * bound by the composition root, with today's date so the temporal channel
   * exists — and its durable row. The budget is the host's to size: what its
   * envelope leaves once everything else it carries is measured (Claude Code:
   * `hooks.ts#recallRoom`); undefined is recall's own default.
   */
  recallTurn(
    input: SessionInput,
    text: string,
    opts: { budgetBytes?: number; withhold?: ReadonlySet<string> } = {},
  ): ReturnType<Counterpart["recallForTurn"]> {
    const result = this.counterpart.recallForTurn(
      {
        sessionId: input.sessionId,
        text,
        ...(opts.budgetBytes === undefined ? {} : { budgetBytes: opts.budgetBytes }),
      },
      {
        ...(input.at === undefined ? {} : { at: input.at }),
        // Said outright this turn, so not ALSO handed over as a quiet cue.
        ...(opts.withhold === undefined ? {} : { withhold: opts.withhold }),
      },
    );
    const decision = result.decision;
    // The recall block states its own sentinel too, and nothing checks it: the
    // line that used to hold it was the same dead `Map` the wake's expectation
    // lived in. A recall-arrival check would need the same shape as the wake's
    // — a persisted expectation and a turn-scoped read — and is an open ask
    // (claude-code INTERFACE-GAPS §11), not a thing this row can pretend to.
    this.record(RECALL_DELIVERED_EVENT, input, {
      reason: decision.reason,
      surfaced: decision.surfaced.length,
      footnotes: decision.footnotes.length,
      bytes: decision.bytes,
      budget: decision.budgetBytes,
      observer: decision.observer,
      // WHERE the semantic channel's input came from, on the row a coverage
      // watch can read out of the store tomorrow. `semantic: "none"` on every
      // real turn is exactly the finding this PR closes; anything but
      // "lagged" here after a worker ran is the lag failing, by name.
      semantic: decision.semanticSource,
      semanticFrom: decision.semanticFromTurn,
    });
    return result;
  }

  // ── the boundary ───────────────────────────────────────────────────────────

  /**
   * Capture and record the boundary. ONE function for every session-ending
   * path a host has, so a path added later cannot accidentally get a different
   * shape (claude-code G3). `label` is the host's own name for the event, and
   * is what the rows record as `hook`.
   *
   * THE APPENDER. Microseconds, no model call, no judgment — and it cannot throw
   * into the host, because `SpanBuffer.capture` swallows its own failures and
   * the host adapter's guard catches anything above it (§2 G1/G12).
   */
  captureBoundary(label: string, kind: BoundaryKind, input: SessionInput): BoundaryCapture {
    // THE HEADLESS NIGHTLY RUN CAPTURES NOTHING (2026-09-29): its turns are the
    // launch prompt and the run's own tool calls — sleep, not lived — and a
    // session with no captured text owes no write-up (`remember/owes.ts`).
    const turns = input.nightRun === true ? [] : (input.turns ?? []);
    // THE STRETCH THIS MEMORY WAS TOLD NOT TO HAVE, sealed before anything is
    // captured. After a `sealed` the ordinary capture below reads NOTHING_NEW;
    // after a `failed` it does not run at all, because a cursor that would not
    // move is a boundary with no way to tell what is new from what was lived
    // outside this memory — and an append lands before a cursor write does.
    const seal = this.sealJoinedLate(label, input, turns);
    // G10/G11 computed side by side: capture takes EVERYTHING conversational
    // including host-injected context; pacing counts only what the user said.
    const captured: CaptureResult =
      seal === "failed"
        ? {
            captured: false,
            reason: "IO_FAILED",
            spans: [],
            deduped: 0,
            excluded: turns.length,
            cursorBefore: 0,
            cursorAfter: 0,
          }
        : this.counterpart.captureSpans({
            session: input.sessionId,
            scope: input.scope,
            turns,
          });
    const record = this.counterpart.boundary({
      session: input.sessionId,
      scope: input.scope,
      kind,
    });
    // Reference resolution (recall §9.2) over the SAME slice capture just took:
    // the cursor is the one authority on what is new, for credit as for spans.
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
      // The DURABLE half of `adapter.scope.joined-late`: the boundary row is
      // the one durable name a boundary already has, and this is a fact about
      // THIS boundary. A row that says `joinedLate: true, captured: false` is
      // the whole evidence that a stretch was sealed rather than lost.
      joinedLate: seal !== "none",
    });
    return { reason: captured.reason, spansAppended: captured.spans.length };
  }

  /**
   * THE RETROACTIVE-CAPTURE GUARD (PR #92 review, F1) — the one place a
   * directory that was `off` can still lose its silence.
   *
   * A session that lived under `off` or `paused` wrote NOTHING: no session
   * record, because the hook process returned before a store was opened, and no
   * span cursor for the same reason. Turn the directory back on mid-session —
   * `counterparts scope . --resume`, or the `scope` tool, which is deliberately
   * the one tool that answers in an off directory — and the next boundary sees
   * a cursor of 0 against a transcript holding the WHOLE off conversation. It
   * would deposit all of it. Measured on this branch before this guard: six
   * marker hits in the buffer after the flip.
   *
   * So a boundary that finds NO SESSION RECORD and a cursor still at 0 treats
   * the stretch as somebody else's: it advances the cursor to the end of what
   * it can see, deposits nothing, and records that it did. What follows the
   * flip is captured normally, because the cursor now starts there.
   *
   * **How the cursor moves without a deposit.** `SpanBuffer.capture` advances
   * to `turns.length` when nothing in the slice is capture-eligible
   * (`remember/spans.ts`, the ALL_EXCLUDED arm: "still advance, or the same
   * tool output is re-scanned forever"). So the seal hands it `turns.length`
   * PLACEHOLDERS whose source is `tool` — `enters()` refuses them — and the
   * real turns are never passed to the core at all. That is the only
   * adapter-reachable way to set a cursor today; a `SpanBuffer.sealCursor` in
   * core would be the honest one, and is named in the PR as a core ask.
   *
   * Three conditions, each load-bearing:
   *   - **not an observer**: an observer captures nothing and writes no session
   *     record anyway, and a cursor it cannot write would make the seal a lie.
   *     An `off → observer → on` session is therefore still sealed at the first
   *     boundary after it reaches `on` — the observer stretch left no record.
   *   - **no session record**: the positive evidence that SessionStart ran
   *     inside this memory. It is what a live session has and an off one does not.
   *   - **cursor still 0**: a record PRUNED out from under a long-lived session
   *     (seven days, `sessions.ts`) leaves a cursor behind; that session has
   *     been captured all along and must not lose the turns since its last
   *     boundary.
   */
  protected sealJoinedLate(
    label: string,
    input: SessionInput,
    turns: readonly HostTurn[],
  ): "none" | "sealed" | "failed" {
    if (this.observer) return "none";
    if (input.sessionId.length === 0) return "none";
    try {
      if (readSession(this.counterpart.store.dir, input.sessionId) !== null) return "none";
      if (this.counterpart.spans.cursor(input.scope, input.sessionId) !== 0) return "none";
    } catch {
      // A registry or a cursor this cannot read is not a reason to fail a hook
      // (§5 G2). The quiet answer here is the ordinary path.
      return "none";
    }
    const placeholders: CapturedTurn[] = turns.map(() => ({
      role: "user",
      text: "",
      source: "tool",
    }));
    const sealed = this.counterpart.captureSpans({
      session: input.sessionId,
      scope: input.scope,
      turns: placeholders,
    });
    const moved = sealed.cursorAfter === turns.length;
    this.emit(SCOPE_JOINED_LATE_EVENT, {
      hook: label,
      mode: this.scope.mode,
      turns: turns.length,
      cursor: sealed.cursorAfter,
      sealed: moved,
      reason: sealed.reason,
    });
    // THE ORDER IS THE SAFETY. The cursor moves first and the session record is
    // written only if it did: a record written beside a cursor that stayed at 0
    // would make the NEXT boundary read this session as an ordinary one and
    // deposit the whole off stretch after all. A seal that could not move the
    // cursor leaves no record either, so the next boundary tries again.
    if (!moved) return "failed";
    // The session becomes bindable HERE, at the first boundary inside the
    // memory — `pre-compact` never calls `noteSession`, and a session with no
    // record is a session the MCP tools refuse.
    this.noteSession("boundary", input);
    return "sealed";
  }

  /**
   * THE CREDIT SEAM — the consumer recall INTERFACE-GAPS §5 said had no home.
   *
   * Assistant `conversation` turns and deliberate-recall calls from the new
   * slice go to `Counterpart.creditReferences`, which decides (`reference.ts`)
   * and credits (`resolveUses`). One durable row per boundary, `recall.credit`,
   * with a `reason` the daily's readers split on: `credited` is the signal the
   * `memory.reinforced` watch turns green on; `failed` and `budget-exceeded`
   * are the ones to alarm on. A boundary that credits nothing still leaves its
   * row (`nothing-to-credit` / `no-candidates`) — silence must never masquerade
   * as health, and a seam that only wrote rows when it worked would be the ring
   * this repo already learned from (I32).
   *
   * Never fails the boundary: telemetry may not fail the host (§1 G7), and a
   * credit that could not be decided is a `failed` row, not a lost capture.
   */
  protected creditAtBoundary(input: SessionInput, from: number, to: number): void {
    const started = this.nowFn();
    // Read before the try: the failed row carries the day too.
    const day = this.counterpart.store.livedDay();
    const turns = input.turns ?? [];
    const slice = turns.slice(Math.max(0, from), Math.max(from, to));
    const assistantTurns = slice
      .filter((t) => t.role === "assistant" && (t.source === undefined || t.source === "conversation"))
      .map((t) => t.text);
    // Half-open on the left: a call positioned AT `from` sat before the first
    // new turn and belonged to the previous slice, which already judged it.
    const raw = (input.expansions ?? [])
      .filter((e) => e.atTurn > from && e.atTurn <= to)
      .flatMap((e) => [...e.ids]);
    // G50: a handle the recall tool RESOLVED becomes the id it resolved to.
    // The transcript still decides WHICH handles and WHEN; what it cannot say is
    // whose answer resolved them, so the translation is filtered to THIS
    // PROJECT's resolutions — the same `sameScope` comparison the MCP server
    // already trusts to bind a session. Without it the log hands this boundary
    // the last answer anyone anywhere got, including the owner's resolution of a
    // confidential memory this session was refused (or never asked for at all).
    // A handle nobody resolved in this scope still counts `unresolvedHandles`.
    //
    // The SECOND filter is this session's own start, out of the same registry
    // (`sessions.ts`): a project is a place, not a conversation, so one
    // directory's table also holds last week's answers, and a resolution
    // recorded before this session existed cannot be an answer to anything this
    // session asked. A session whose first hook event is this very Stop has no
    // record yet — the capture runs before the Stop's `noteSession("boundary")`
    // — and gets no floor; that is under-credit's direction only in the sense
    // that it does not tighten, and it is the residual §9 records.
    //
    // The file is read only when there is something to translate — and the row
    // says which of those two it was. `resolvedHandles: 0` alone cannot tell an
    // idle table from a dead one, which is the exact shape of I32's failure.
    //
    // ALL OF IT INSIDE THE TRY. The first draft translated before the try, which
    // meant any throw on this path cost the boundary its row entirely — and a
    // seam that only writes rows when it works is the ring I32 is named for.
    // Only the `expansionsRead` declaration, which cannot throw, sits outside,
    // so the `failed` row can still say how far the read had got.
    let expansionsRead: ExpansionsRead | "not-read" = "not-read";
    try {
      let resolutions = new Map<string, string | null>();
      // Carried off the read rather than fetched again: the key a handle lands
      // on is the store's salt plus the handle (G58), and the two halves of one
      // lookup must not be able to disagree about which salt that was.
      let salt = "";
      if (raw.length > 0) {
        const dataDir = this.counterpart.store.dir;
        const sessionStartedAt = readSession(dataDir, input.sessionId)?.startedAt;
        const read = readHandleResolutions(dataDir, {
          now: this.nowFn(),
          scope: input.scope,
          ...(sessionStartedAt === undefined ? {} : { since: sessionStartedAt }),
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
        now: this.nowFn,
      });
      this.emit(RECALL_CREDIT_EVENT, {
        reason: summary.reason,
        considered: summary.considered,
        expanded: summary.expanded,
        quoted: summary.quoted,
        credited: summary.credited,
        elapsedMs: this.nowFn() - started,
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
        /** Uses refused strength credit for their day cadence that still joined
         *  the turn's links (2026-09-28). */
        linkedDespite: summary.linkedDespite,
        unresolvedHandles: summary.unresolvedHandles,
        /** G50: expansions the handle-resolution log translated on the way in.
         *  Beside `unresolvedHandles`, it is the pair that says whether a
         *  by-title expansion earned credit or fell through the old gap. */
        resolvedHandles,
        /** WHY the log answered the way it did. `resolvedHandles: 0` on its own
         *  cannot tell an idle table from an absent, unreadable or corrupt one,
         *  and a number that cannot say which is how I32 stayed invisible.
         *  `not-read` means this slice carried no expansion to translate. */
        expansionsRead,
        skippedForBudget: summary.skippedForBudget,
        unreadable: summary.unreadable,
        refused: summary.refused,
        ids: summary.ids.slice(0, 64),
        /** How each of `ids` was earned, aligned with it (2026-10-11):
         *  `expanded` or `quoted` here; `drewOn` on the tools' own rows. */
        how: summary.how.slice(0, 64),
        idsTotal: summary.ids.length,
        expandedIds: summary.expandedIds.slice(0, 64),
        expandedTotal: summary.expandedIds.length,
        /** Of the expanded, how many this session had seen as a QUIET POINTER
         *  (reached only through links, 2026-09-28) — whether pointers are used. */
        pointersExpanded: summary.pointersExpanded,
        /** RECALL'S HIT RATE (2026-10-09, measurement only): what recall showed
         *  this session since the last boundary that judged, by lane, and how
         *  many of those the replies neither expanded nor quoted — with their
         *  ids. Footnotes are the cued ones; a quiet pointer counts as a pointer.
         *  On a `budget-exceeded` row a quote may have gone unchecked. */
        shownLoud: summary.shown.loud,
        shownFootnotes: summary.shown.footnotes,
        shownPointers: summary.shown.pointers,
        unusedLoud: summary.unused.loud,
        unusedFootnotes: summary.unused.footnotes,
        unusedPointers: summary.unused.pointers,
        shownNotUsed: summary.shownNotUsed.slice(0, 64),
        shownNotUsedTotal: summary.shownNotUsed.length,
        judgedThrough: summary.judgedThrough,
        elapsedMs: this.nowFn() - started,
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
        // The RAW count: the translated list may not exist on this path, and a
        // translation is one-for-one anyway.
        expansions: raw.length,
        expansionsRead,
      });
    }
  }

  /** The orphanable tail: bounded and measured, never pretended away (§13). */
  noteTail(input: SessionInput): void {
    try {
      // The same session state the ask reads (`paceAsk`), for the same reason:
      // a tail line that disagreed with the ask about why is how this bug gets
      // found twice.
      this.counterpart.noteOrphanTail(input.sessionId, substanceOf(input.turns ?? []), undefined, {
        rebase: input.turnsUnread !== true,
      });
    } catch (err) {
      this.emit("adapter.tail.failed", { code: codeOf(err) });
    }
  }

  // ── the ask ────────────────────────────────────────────────────────────────

  /**
   * THE ONE ASK, ON ONE PACER, fail-open: an error in the ritual never costs the
   * collection (§13 G5). Returns the chapter this boundary asks for, or null;
   * the host words the ask (Claude Code: `hooks.ts#stopAsk`) and decides which
   * of its boundaries may ask at all (its Stop's re-fire may not).
   *
   * What changed on 2026-09-04, and why:
   *
   *   - **One pacer.** The authorship ask paced itself on turns-and-bytes since
   *     its own last ask; the episode ask paced itself on the chapter rule. They
   *     fired on different Stops, so the model was asked about a dozen times in
   *     one 13-turn evening. `episodeAsk` is now the only pacer, and its verdict
   *     decides whether this boundary says anything at all.
   *   - **The coverage read stays, as a RECORD and not a gate.** It measures
   *     rather than assumes (§2 G12) and it puts the unaskable tail on the
   *     record as a number instead of a hope; what it must not do is add a
   *     second condition to a single ask.
   *   - **The re-fired Stop asks nothing and advances nothing** — the host's
   *     to refuse, before this is called.
   */
  paceAsk(input: SessionInput): number | null {
    try {
      // Typed turns and both roles' text (`substanceOf`). The pacing and the
      // per-session, per-calendar-day cap are `self/episodes.ts#askDue`'s; the
      // history of both is in self NOTES. The date on every `adapter.ask` row
      // below answers "how often was the pen offered today" across sessions.
      const substance = substanceOf(input.turns ?? []);
      // `scope`: what this session has not written up here is the pacer's
      // third arm (`core/coverage/`, 2026-09-30), `due-unwritten` on the row.
      const chapter = this.counterpart.episodeAsk(input.sessionId, substance, undefined, {
        rebase: input.turnsUnread !== true,
        scope: input.scope,
      });
      const outcome = chapter.asked
        ? "asked"
        : chapter.verdict.reason === "session-ask-cap"
          ? "capped"
          : "paced";
      let coverage: { spans: number; covered: number; uncovered: number; unaskableSpans: number; unaskableBytes: number } | null =
        null;
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
        // What `turns` counts, so a reader can tell these rows from older ones.
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
      });
      // The chapter number is the STORE's, one past what was written; the ask
      // that carries it must also name this session, because the id is what
      // the MCP server binds itself with.
      return chapter.asked ? chapter.chapter : null;
    } catch (err) {
      this.emit("adapter.ask.failed", { code: codeOf(err) });
      return null;
    }
  }

  // ── the registry ───────────────────────────────────────────────────────────

  /**
   * THE LIVE-SESSION REGISTRY (`adapters/sessions.ts`), written here because the
   * host adapter is the only thing that knows the session id.
   *
   * Host state, not memory: an id, a scope, three timestamps, no content. It is
   * what lets the MCP server — which Claude Code launches from a static config
   * that carries no session — bind itself to the session the ask named, and
   * refuse anything else. Ring-only telemetry: this fires at every Stop, and a
   * durable row per turn to say "the file was written" is not evidence anyone
   * needs.
   *
   * Under observer NOTHING is recorded (the tools stand down anyway), and every
   * failure is silent by construction: `recordSession` returns null rather than
   * throwing, because a hook may not fail the host (§5 G2).
   */
  noteSession(phase: SessionPhase, input: SessionInput): void {
    if (this.observer) return;
    if (input.sessionId.length === 0) return;
    // The STORE's dir, not the config's: it is the one that went through
    // `assertSafeDataDir`, and it is the same value the MCP server resolves on
    // its own side. Reading the raw config here could put the registry in a
    // sibling directory the tool never looks in, over a trailing slash.
    const dir = this.counterpart.store.dir;
    const record = recordSession(dir, {
      sessionId: input.sessionId,
      scope: input.scope,
      phase,
      at: this.nowFn(),
      // THE DURABLE ANSWER TO "WHICH CONFIG DID THIS HOOK READ". A hook cannot
      // print it — stdout is the model's context — so it is recorded here, in
      // the one file this process writes that is host state rather than memory,
      // under the store the configuration itself named. A record written by a
      // process that was told nothing carries no field at all. Beside it, the
      // host this lifecycle serves.
      ...this.recordStamp(),
      // Which model answered last. A Stop writes this before its ask goes out,
      // so the chapter that answers the ask finds it on the record.
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.entrypoint === undefined ? {} : { entrypoint: input.entrypoint }),
    });
    this.emit("adapter.session.registry", { phase, ok: record !== null });
    // Bounded growth, once per session rather than once per turn — and never on
    // the SessionEnd path, whose hooks share 1.5 s between them.
    if (phase === "start") {
      const pruned = pruneSessions(dir, this.nowFn());
      if (pruned > 0) this.emit("adapter.session.registry.pruned", { removed: pruned });
      // The process log's week (`adapters/log/`), by the dates in its file names.
      const logs = pruneLog(dir, localDate(this.nowFn(), this.counterpart.store.zone()));
      if (logs > 0) this.emit("adapter.log.pruned", { removed: logs });
    }
  }

  // ── the worker ─────────────────────────────────────────────────────────────

  /**
   * The detached worker. The plan is checked BEFORE anything starts — watchdog
   * against the staleness window, data dir, stance — and a refusal that repeats
   * ESCALATES rather than re-logging (scar E4's widening).
   *
   * **The credential was never a precondition after I32** (2026-09-11), and
   * since 2026-09-24 there is no credential at all; see `spawn.ts`'s §2.18
   * paragraph for why refusing was worse than running.
   *
   * **Every refusal and every failure now leaves a DURABLE row**, one per reason
   * per calendar date, and the per-reason counter that decides escalation lives
   * in box 2's meta rather than in this object. Both halves are the same repair:
   * a hook process lives for one turn, so anything it knows about a repeated
   * failure dies before the next hook could act on it.
   */
  spawnWorker(input?: SessionInput): SpawnOutcome {
    // The child is TOLD whose turn it just followed. Without it the worker can
    // sweep and sleep but cannot leave the next turn a semantic cue, because
    // that cue is per-session state (`recall/session.ts`).
    const bound = {
      ...(input?.sessionId === undefined || input.sessionId.length === 0
        ? {}
        : { session: input.sessionId }),
      ...(input?.scope === undefined || input.scope.length === 0 ? {} : { scope: input.scope }),
      // The child reads the SAME configuration this process read. Without the
      // pin the worker would resolve its own — and a hook driven by `--config`
      // would spawn a worker that went back to the default file, which is the
      // shape scar §2.13 is about: parent and child resolving one value twice.
      ...(this.configPath === undefined || this.configPath.length === 0
        ? {}
        : { configPath: this.configPath }),
    };
    const plan = planSpawn({
      config: this.config,
      command: this.command,
      args: this.args,
      priorFailures: 0,
      ...bound,
    });
    // The PERSISTED count, read before the replan: `escalate` is a claim about
    // how often this has happened on this host, not about this process.
    const prior = plan.ok ? 0 : this.refusalCount(plan.reason);
    const replanned = plan.ok
      ? plan
      : planSpawn({
          config: this.config,
          command: this.command,
          args: this.args,
          priorFailures: prior,
          ...bound,
        });
    const outcome = spawnDetached(replanned, {
      ...(this.spawner === undefined ? {} : { spawner: this.spawner }),
      onEvent: (name, data) => this.emit(name, data),
    });
    if (outcome.started) {
      // A start clears the slate for every reason: whatever was wrong is not
      // wrong now, and a counter that only ever climbed would escalate forever
      // off one bad afternoon.
      this.clearRefusals();
      this.noteSpawnStart(input);
      return outcome;
    }
    const count = this.bumpRefusal(String(outcome.reason));
    this.noteSpawnRefusal(outcome, count, input);
    return outcome;
  }

  /**
   * THE DURABLE ROW for a worker that DID start (2026-09-20, E2).
   *
   * I32 made every refusal durable and left the other half open: a healthy
   * start wrote nothing, so a worker dead all week and a week with nothing to
   * do read exactly alike, and the fired view could only call the mechanism
   * blind (inventory §2 row 23). Scar §2.4 is symmetrical — a door that opened
   * and a door nobody opened must not be the same absence either.
   *
   * ONE ROW PER CALENDAR DATE, latched at the store exactly like the refusals
   * beside it. This runs at every boundary, which is a hot path, and three
   * hundred identical rows a day would drown the log the view reads.
   *
   * **THE ROW CARRIES NO COUNT, on purpose.** The latch means only the FIRST
   * start of a day ever writes, so any tally put here would read `1` forever —
   * a number that looks like a measurement and is an artefact of the latch. The
   * day's real tally lives in box 2's meta beside the refusal counters, where
   * `spawnStarts()` reads it and doctor's Spawn line prints it.
   *
   * Never throws, writes nothing under observer, and is not on the critical
   * path: the worker has already been started by the time this runs.
   */
  private noteSpawnStart(input?: SessionInput): void {
    if (this.observer) return;
    const date = input?.at ?? localDate(this.nowFn(), this.counterpart.store.zone());
    try {
      this.bumpStart(date);
      this.counterpart.noteAdapterEvent(
        SPAWN_STARTED_EVENT,
        { date, session: input?.sessionId ?? null },
        { dedupKey: `${SPAWN_STARTED_EVENT}:${date}` },
      );
    } catch (err) {
      this.emit("adapter.spawn.record.failed", { code: codeOf(err) });
    }
  }

  /** How many times the worker has started TODAY, and the date that tally is
   *  for. The row says it happened; this says how often. A read, never a write. */
  spawnStarts(): { date: string | null; count: number } {
    try {
      const store = this.counterpart.store;
      const date = store.getMeta(SPAWN_START_DATE_KEY) ?? null;
      return { date, count: Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0") };
    } catch {
      return { date: null, count: 0 };
    }
  }

  /**
   * The day's start tally, beside the refusal counters in box 2's meta. TWO
   * KEYS, not one per date: a key per day would grow without a sweep to mow it,
   * and the only question this answers is "how many today". The tally resets
   * the moment the date it was stamped with is no longer today.
   */
  private bumpStart(date: string): number {
    try {
      const store = this.counterpart.store;
      const on = store.getMeta(SPAWN_START_DATE_KEY);
      const next = on === date ? Number(store.getMeta(SPAWN_START_COUNT_KEY) ?? "0") + 1 : 1;
      if (on !== date) store.setMeta(SPAWN_START_DATE_KEY, date);
      store.setMeta(SPAWN_START_COUNT_KEY, String(next));
      return next;
    } catch {
      // A lost count is never a lost hook (§5 G2). The row still lands, and it
      // still says the worker started today, which is what it is for.
      return 1;
    }
  }

  /**
   * THE DURABLE ROW for a worker that did not start (I32).
   *
   * One row per reason per CALENDAR DATE — `dedupKey` does the gating at the
   * store, so a refusal repeating at every boundary writes once and not three
   * hundred times. `count` is the persisted counter AT THIS MOMENT, so the day's
   * one row still says how deep the hole was by the time it was written; the
   * live depth is `spawnRefusals()`.
   *
   * Never throws: this is the tail of a hook, and a hook may not fail the host
   * (§5 G2). An observer writes nothing — `noteAdapterEvent` stands down at the
   * core's own seam, and the counter above stayed in memory for the same reason.
   */
  private noteSpawnRefusal(outcome: SpawnOutcome, count: number, input?: SessionInput): void {
    if (this.observer) return;
    const name = outcome.reason === "SPAWN_FAILED" ? SPAWN_FAILED_EVENT : SPAWN_REFUSED_EVENT;
    const date = input?.at ?? null;
    try {
      this.counterpart.noteAdapterEvent(
        name,
        {
          reason: String(outcome.reason),
          code: outcome.code,
          count,
          escalate: outcome.escalate,
          date,
          session: input?.sessionId ?? null,
        },
        // No date is still one row per reason per RUN OF DAYS rather than per
        // boundary: a caller that knows no date is a test or a bare invocation,
        // and neither should be able to flood the log.
        { dedupKey: `${name}:${String(outcome.reason)}:${date ?? "no-date"}` },
      );
    } catch (err) {
      this.emit("adapter.spawn.record.failed", { code: codeOf(err) });
    }
  }

  /**
   * The per-reason refusal counters, as they stand. PR 2's session-start notice
   * reads this — "your background worker has not started in four days" is a
   * sentence somebody has to be able to say — and it is a read, never a write.
   */
  spawnRefusals(): Record<string, number> {
    const out: Record<string, number> = {};
    if (this.observer) {
      for (const [reason, n] of this.volatileRefusals) out[reason] = n;
      return out;
    }
    try {
      for (const [key, value] of this.counterpart.store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
        const n = Number(value);
        if (n > 0) out[key.slice(SPAWN_REFUSAL_PREFIX.length)] = n;
      }
    } catch (err) {
      this.emit("adapter.spawn.refusals.failed", { code: codeOf(err) });
    }
    return out;
  }

  private refusalCount(reason: string): number {
    if (this.observer) return this.volatileRefusals.get(reason) ?? 0;
    try {
      return Number(this.counterpart.store.getMeta(`${SPAWN_REFUSAL_PREFIX}${reason}`) ?? "0");
    } catch {
      return 0;
    }
  }

  /** Returns the count AFTER this refusal. A meta write that loses the lock to
   *  an overlapping runner costs the count, never the hook (§5 G2). */
  private bumpRefusal(reason: string): number {
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

  private clearRefusals(): void {
    this.volatileRefusals.clear();
    if (this.observer) return;
    try {
      const store = this.counterpart.store;
      for (const [key, value] of store.metaWithPrefix(SPAWN_REFUSAL_PREFIX)) {
        // Zero, not deleted: `meta` has no delete on the write seam's allowlist,
        // and a zero reads identically everywhere the counter is consulted.
        if (value !== "0") store.setMeta(key, "0");
      }
    } catch (err) {
      this.emit("adapter.spawn.count.failed", { code: codeOf(err) });
    }
  }

  // ── telemetry ──────────────────────────────────────────────────────────────

  /**
   * A DELIVERY record: to the ring and to box 2, with the calendar date and the
   * session riding in the payload for the same reason the parallel run's
   * verdict rows put them there — the store's `day` column is the lived day,
   * and the parallel run counts these per calendar day, per session, after the
   * process is gone.
   */
  protected record(
    name: AdapterDurableEventName,
    input: SessionInput,
    data: Record<string, string | number | boolean | null>,
  ): void {
    const row = { ...data, date: input.at ?? null, session: input.sessionId };
    this.emit(name, row);
    this.counterpart.noteAdapterEvent(name, row);
  }

  /**
   * A DELIVERY WARNING, to the ring and, since 2026-10-02, to box 2 — what an
   * envelope could not carry (`counterpart.ts#ENVELOPE_GAVE_WAY_EVENT` and its
   * three siblings). One row per name, hook, part and session per lived day:
   * the count doctor reads is of sessions and days, not of prompts. The
   * session is null where the caller has none. Never throws.
   */
  protected noteDeliveryWarning(
    name: DeliveryWarningName,
    data: Record<string, string | number | boolean | null>,
    input?: SessionInput,
  ): void {
    this.emit(name, data);
    try {
      const store = this.counterpart.store;
      const day = store.livedDay();
      const session = input?.sessionId ?? null;
      const date = input?.at ?? localDate(this.nowFn(), store.zone());
      const key = [name, String(data["hook"] ?? ""), String(data["part"] ?? ""), session ?? "", String(day)].join(":");
      this.counterpart.noteAdapterEvent(name, { ...data, date, session }, { dedupKey: key });
    } catch {
      /* a warning that cannot be recorded is still said on the ring */
    }
  }

  protected emit(name: string, data: Record<string, string | number | boolean | null>): void {
    const event: AdapterEvent = { at: this.nowFn(), name, data };
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    try {
      this.onEvent?.(event);
    } catch {
      // Even telemetry may not fail the host (§1 G7: "failed telemetry means
      // the bootstrap line or nothing, and a clean exit").
    }
  }
}

/**
 * Substance for PACING.
 *
 *   - **turns** — messages the PERSON typed: user-role `conversation` turns,
 *     one per transcript entry however many text blocks it holds. The
 *     assistant's text never counts as a turn, so its own writing cannot pace
 *     the ask turn by turn (measured 2026-09-24: 8 assistant blocks against the
 *     owner's 2 messages fired the first ask after his second message).
 *   - **bytes** — conversation text from BOTH roles, which is how a one-prompt
 *     agentic session still reaches an ask.
 *
 * Host-injected material is user-role but is not the user speaking, so it
 * counts toward neither (§2 G11); tool output, file contents and images are the
 * declared blind spot (§2 G10). The same turn list feeds `captureSpans`, where
 * injected context IS kept — the two rules live one function apart on purpose.
 */
export function substanceOf(turns: readonly HostTurn[]): { turns: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  let lastEntry: number | undefined;
  for (const turn of turns) {
    if ((turn.source ?? "conversation") !== "conversation") continue;
    bytes += Buffer.byteLength(turn.text, "utf8");
    if (turn.role !== "user") continue;
    if (turn.entry !== undefined && turn.entry === lastEntry) continue;
    lastEntry = turn.entry;
    count += 1;
  }
  return { turns: count, bytes };
}

/**
 * ONE PLAIN REMINDER, AS A PERSON READS IT (2026-09-26). The owner's example is
 * the whole spec — "Today: pay your taxes" — so each beat is the shortest
 * sentence that says when:
 *
 *   day        `Today: pay your taxes`
 *   opens      `This month: launch the beta` / `Until Sat 31 Oct 2026: book flights`
 *   last-day   `Last day today: file the extension`
 *   late       `This was for Mon 12 Oct 2026: pay your taxes`
 *
 * A LATE one (2026-10-11) is a day item whose day passed untold, said once
 * inside its grace (`PlainDue.late`), so it says which day it was for.
 *
 * `what` is the memory's title or first line (`Counterpart.plainReminders`).
 */
export function plainLine(r: Pick<PlainReminder, "beat" | "precision" | "lastDay" | "what" | "late">): string {
  const max = TUNABLES.PLAIN_WHAT_MAX_CHARS;
  const what = r.what.length <= max ? r.what : `${r.what.slice(0, max - 1).trimEnd()}…`;
  if (r.late === true) return `This was for ${readableDate(r.lastDay)}: ${what}`;
  if (r.beat === "day") return `Today: ${what}`;
  if (r.beat === "last-day") return `Last day today: ${what}`;
  if (r.precision === "month") return `This month: ${what}`;
  return `Until ${readableDate(r.lastDay)}: ${what}`;
}

/**
 * The MODEL's copy of one plain reminder: says it was asked for, and names the
 * memory so it can be looked up. One line, no newline — `what` is folded to
 * single spaces upstream — so `withoutPlain` can take it back out by line.
 */
export function plainContextLine(r: Pick<PlainReminder, "beat" | "precision" | "lastDay" | "what" | "memoryId" | "late">): string {
  return `Plain reminder (they asked to be told) — ${plainLine(r)} [${r.memoryId}]`;
}

/** An error's code, or its name, or `UNKNOWN` — ids and codes only on a row. */
export function codeOf(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "UNKNOWN";
}
