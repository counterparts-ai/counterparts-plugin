/**
 * `dream/` — dreaming: a background pass over what was lived since the last
 * dream, by the same model, through one tool with phases (owner decisions
 * 2026-09-26). CONTRACT.md has the lineage and the guarantees; this file is the
 * mechanism.
 *
 * The shape, in one paragraph. Once a CALENDAR day (2026-09-28: the NIGHTLY
 * RUN), the first session is handed a line (`offer`, claimed by `claimOffer`;
 * `askLine` is both) that follows the owner's setting: `ask` (the default,
 * 2026-09-29) — the person is shown the question in the terminal and says
 * "dream"; `auto` — the run starts on its own in the background; `off` —
 * nothing. The session asks this module for the
 * LAUNCH PROMPT (`launchPrompt`) and hands it to ONE background agent — same
 * model, same tools, its writes attributed to the session that launched it —
 * which runs the page writer, then the dream, then the reflection
 * (`NIGHT_ORDER`). The dreamer calls `begin` and is SHOWN a bundle:
 * the self page, the wake, the journal since the last dream, the owner's card,
 * every memory made since the last dream with its nearest older neighbours, a
 * few loosely related older ones, and the strongest-feeling memories of about a
 * week back — all through recall's gates, never a raw list. It then `propose`s
 * changes, each applied within per-dream limits and recorded so the whole dream
 * can be undone: merge near-copies (originals kept, archived with a forwarding
 * address), link two memories, replay (a return at half weight — never a use),
 * write a gist in its own words (source `dreamed`, starting low), flag a
 * contradiction (a pair in `contradictions`, unsettled) or — with a clear
 * reason — settle one (2026-09-29), record how an old charged memory feels
 * now, nominate a memory for the core (a lane still has to promote it). Last it
 * writes its `journal` entry, which lives in the `dreams` table and never
 * becomes a memory, and hands back one marked line.
 *
 * What a dream CANNOT do, by construction: delete, edit the self page,
 * promote, rewrite a memory in place, or touch a memory it was not shown. A
 * dream's words never enter the sweep: the hand-back and the bundle carry
 * `DREAM_MARK`, and `remember/`'s `enters()` refuses any turn that does.
 *
 * Arithmetic and bookkeeping only: nothing here calls a model — the dreamer IS
 * the model, outside this process.
 */
import { createHash, randomBytes } from "node:crypto";

import { Associate } from "../associate/index.js";
import { FIT_TUNABLES, clipWire, fidelityOf, fit, lineOf, offeredOf, packParts, readIndex, wireChars, writeIndex } from "../fit/index.js";
import type { Fidelity, FitCandidate, Placed } from "../fit/index.js";
import { emotionalIntensity, sal, strength } from "../physics/index.js";
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
  inheritFrom,
  isStoreError,
  occurredOnOf,
  repairEmotion,
  saidByOf,
  splitNote,
  statusOf,
} from "../store/index.js";
import type { AboutMark, AboutSetter, DreamChangeRow, DreamRow, FeelingInput, MemoryRow, MemoryStatus, ProseDoc, SaidBy, Store } from "../store/index.js";
import { TUNABLES as PHYSICS } from "../physics/index.js";
import { addDays, isDay } from "../time.js";
import { livedOn } from "../types.js";
import type { Kind } from "../types.js";
import { DREAM_MARK, carriesDreamMark } from "./mark.js";
import { mindRanked, noteMindShown } from "./mind.js";
import type { MindItem } from "./mind.js";
import { chapterEntries, entryKey, fitEpisodes, shownEntry } from "./slices.js";
import type { ChapterEntry, EpisodeInView, EpisodesFit, ShownChapter, ShownEntry } from "./slices.js";
import { BUNDLE_OWNER, DREAM_ACTIONS, DREAM_TUNABLES } from "./tunables.js";
import type { DreamAction } from "./tunables.js";
import { flag as flagContradiction, pairStanding, settle as settleContradiction, undo as undoContradiction } from "../contradictions.js";

export { DREAM_ACTIONS, DREAM_TUNABLES } from "./tunables.js";
export type { DreamAction } from "./tunables.js";
export { MIND_TUNABLES, mindRanked, onMyMind } from "./mind.js";
export type { MindItem } from "./mind.js";
export { CORE_MENTIONED_PREFIX, REFLECT_QUESTIONS, REFLECT_TUNABLES, Reflections, reflectionOpener } from "./reflect.js";
export { FEELING_WEEKS_TUNABLES, awakeFeelingCounts, feelingWeeks } from "./feeling-weeks.js";
export type { FeelingWeeks } from "./feeling-weeks.js";
export type { ReflectBundle, ReflectContext, ReflectFinish, ReflectItem, ReflectOutcome, ReflectRefusal } from "./reflect.js";

/**
 * THE MARK a dream's words carry — the bundle, the hand-back, the launch
 * prompt. `remember/spans.ts#enters` refuses any turn whose text contains it,
 * and the Claude Code reader tags such a block `dream`, so a dream can never
 * become a lived memory by the back door (the boundary sweep mints from
 * transcripts, and the hand-back lands in the parent's). Spelled in `mark.ts`.
 */
export { DREAM_MARK, carriesDreamMark } from "./mark.js";

/** The opener of one dream's hand-back: `⟦counterparts:dream drm_…⟧`. */
export function dreamOpener(id: string): string {
  return `${DREAM_MARK} ${id}⟧`;
}

/** Durable event names (the dashboard's registry and `fired` read them). */
export const DREAM_BEGUN_EVENT = "dream.begun";
export const DREAM_CHANGED_EVENT = "dream.changed";
export const DREAM_JOURNALED_EVENT = "dream.journaled";
export const DREAM_UNDONE_EVENT = "dream.undone";
/** A night's new memories put back in the queue because the part carrying them never reached the dreamer (Lane 0, 2026-10-10). */
export const DREAM_REQUEUED_EVENT = "dream.requeued";
export const DREAM_ASK_EVENT = "dream.ask";

/** The archive reason a merged original carries, and the one an undone dream's output carries. */
export const DREAM_MERGE_REASON = "dream-merge";
export const DREAM_UNDONE_REASON = "dream-undone";

/**
 * Meta latch a contradiction raised awake WAS kept under before v10
 * (`dream.raised.<dream>.<seq>`). Since v10 the pair's own `raised_day` is the
 * latch; the upgrade carried every one of these onto it.
 */
export const RAISED_PREFIX = "dream.raised.";

/** Why a memory is in the bundle. */
export type DreamRole = "new" | "neighbour" | "mixing" | "lookback" | "on-mind";

/**
 * One memory as a dream is shown it (2026-09-28): enough to decide on —
 * kind, when, what it is about, its strongest feeling, why it is here, and
 * its whole length — and its words at the fidelity tonight's room gave it:
 * `whole`, an `excerpt`, or its `line`. A lookup fetches the rest.
 */
export interface DreamItem {
  readonly id: string;
  /** `earlier (now mem_…)` when a later memory settled over it (`recall/standing.ts#headOf`, 2026-10-11). */
  readonly standing?: string;
  readonly kind: Kind;
  readonly why: DreamRole;
  readonly fidelity: Exclude<Fidelity, "id">;
  readonly text: string;
  /** The whole text's length in characters. */
  readonly chars: number;
  /** Emotional intensity (physics §5.10), rounded. */
  readonly felt: number;
  /** Its strongest recorded feeling, as a word, or null. */
  readonly feeling: string | null;
  /** What it is marked as being about, or null. */
  readonly about: string | null;
  readonly strength: number;
  /** The lived day it was made, and the calendar date it was learned. */
  readonly day: number;
  readonly learned: string;
  /** The day it was LIVED, when that is not the day it was learned: a memory
   *  written up second-hand (2026-10-01, `types.ts#livedOn`). */
  readonly lived?: string;
  readonly core: boolean;
}

/** One entry of a chapter as the dream is shown it. */
export type DreamEntry = ShownEntry;

/**
 * A session's journal since the last dream: its new entries, sliced at the
 * chapter headings; `earlier` counts the entries a dream already saw.
 */
export type DreamChapter = ShownChapter;

/** THE QUEUE, as the bundle states it (2026-09-28). */
export interface DreamQueue {
  /** Undreamed memories in the queue tonight (born within `windowDays`, shown to no dream that stands). */
  readonly new: number;
  /** Of them, shown tonight. */
  readonly tonight: number;
  /** Of them, not shown tonight: they wait for the next night. */
  readonly waiting: number;
  /** Left the queue by age since the last dream, never dreamed (they fade as ordinary memories). */
  readonly agedOut: number;
  readonly windowDays: number;
  /** The queue was read only this deep (`QUEUE_READ`); there may be more. */
  readonly readCapped?: boolean;
  /** `agedOut` is a floor: more aged out than one read holds. */
  readonly agedOutAtLeast?: boolean;
}

export interface DreamBundle {
  readonly dream: string;
  readonly date: string;
  readonly livedDay: number;
  readonly lastDreamed: string | null;
  readonly limits: Readonly<Record<DreamAction, number>>;
  readonly selfPage: string | null;
  /** The self page's whole length (the `self_page` tool reads it whole). */
  readonly selfPageChars: number | null;
  readonly wake: string | null;
  readonly wakeChars: number | null;
  readonly owner: { readonly names: readonly string[]; readonly memories: readonly string[] };
  /** The journal's new entries — in this part. Later parts carry the rest. */
  readonly chapters: readonly DreamChapter[];
  /** Every memory shown, once, by id — in this part. Later parts carry the rest. */
  readonly memories: Readonly<Record<string, DreamItem>>;
  /** Tonight's new memories, most important first, each with its nearest older neighbours. */
  readonly fresh: readonly { id: string; neighbours: readonly string[] }[];
  readonly mixing: readonly string[];
  readonly lookback: readonly string[];
  /**
   * WHAT'S ON MY MIND (2026-09-27): a few open things beside the day — what is
   * coming up, a pair a dream flagged, where the work stands. Not new; the
   * dream may draw on them. Their memory ids are in `memories` too.
   */
  readonly onMind: readonly MindItem[];
  /** Open things beyond the few shown, counted (they stay open). */
  readonly onMindMore?: number;
  readonly queue: DreamQueue;
  /**
   * How tonight's room was spent: memories and entries shown whole, as an
   * excerpt, as a line; and `notShown`, related memories (never a new one —
   * those wait) the room did not take.
   */
  readonly shownAs: { readonly whole: number; readonly excerpt: number; readonly line: number; readonly notShown: number };
  /** How to read the rest, said up front, in words. */
  readonly lookup: string;
  /** IN PARTS: null when the bundle came whole; otherwise this is part 1 of `of`, and `next` says how to fetch the rest. */
  readonly parts: { readonly part: number; readonly of: number; readonly next: string } | null;
  /**
   * RESUMED (2026-09-28): this dream began earlier, in a session that closed
   * before it woke — the date it began and what it had already changed.
   */
  readonly resumed?: { readonly from: string | null; readonly changes: Readonly<Record<string, number>> };
}

export type DreamRefusal =
  | "observer"
  | "dreamed-today"
  | "dreaming-now"
  | "nothing-new"
  | "unknown-dream"
  | "not-this-session"
  | "dream-closed"
  | "no-such-part";

/** `associate.ProposeReport`, structurally — what a proposed link did. */
export interface DreamLinkReport {
  readonly reason: string;
  /** Pairs that landed. */
  readonly pairs: number;
  /** The pairs that landed, in the order proposed. */
  readonly landed: readonly { a: string; b: string }[];
  /** Pairs refused because an endpoint had no room — a proposal never evicts. */
  readonly noRoom: number;
  readonly blocked: number;
  readonly frozen: number;
}

/** What the composition root hands this module. */
export interface DreamContext {
  readonly store: Store;
  readonly observer: boolean;
  /** The owner's own session: confidential memories may be shown (recall's gate 1). */
  readonly owner: boolean;
  /** Read the BUNDLES as the owner too (`BUNDLE_OWNER`, review of #318). No host sets it; the
   *  store-level tests of what an owner-read bundle must keep do. Absent: a guest. */
  readonly bundleOwner?: boolean;
  /** The credential battery (`bridge.episodeGate`), for every word a dream writes. */
  readonly gate: (text: string, sessionId: string) => { ok: true; text: string } | { ok: false; reason: string };
  readonly page: () => string | null;
  readonly wake: () => string | null;
  /** The person's calendar date today (`YYYY-MM-DD`). */
  readonly today: () => string;
  /** `associate.retargetOnSupersede`, so a merged memory inherits its originals' links. */
  readonly retarget?: (oldId: string, newId: string, day: number) => void;
  /**
   * `associate.propose` — a link or a gist's ties, written through the edge
   * module's rules (live endpoints, pinned frozen, decayed weight, count cap,
   * outgoing bound) instead of a raw upsert (2026-09-28). Absent, this module
   * binds its own `Associate` over the same store: there is no path that
   * writes an edge around homeostasis.
   */
  readonly link?: (pairs: readonly { a: string; b: string }[], weight: number, day: number) => DreamLinkReport;
  readonly emit?:(name: string, ref?: string, data?: Record<string, string | number | boolean | null>) => void;
  /**
   * The owner's name as the store knows it (the identity core's `name`, `init
   * --name`), for lines that speak of the owner. Null or absent: "the owner".
   * Never a gendered pronoun.
   */
  readonly ownerName?: () => string | null;
}

/** One proposed change, as the tool receives it. */
export interface DreamChange {
  readonly action: string;
  readonly ids?: readonly string[];
  readonly id?: string;
  readonly a?: string;
  readonly b?: string;
  readonly text?: string;
  readonly title?: string;
  readonly kind?: string;
  readonly sources?: readonly string[];
  readonly core?: string;
  readonly emotion?: string;
  readonly strength?: number;
  readonly carried_by?: string;
  readonly why?: string;
  readonly relevance?: number;
  readonly predictive?: number;
  /** `gist` (v12, 2026-10-03): when what it draws on happened, who said it, what kind of thing it is. */
  readonly occurredOn?: string;
  readonly saidBy?: string;
  readonly status?: string;
  /** `settle`: the memory that holds, the one it is over, and how (2026-09-29). */
  readonly holds?: string;
  readonly over?: string;
  readonly how?: string;
}

export interface ChangeResult {
  readonly index: number;
  readonly action: string;
  readonly ok: boolean;
  readonly reason: string;
  /** The memory this change made or touched, when it made one. */
  readonly id?: string;
  /** Refused: what tripped it, in words (the id, the field). */
  readonly detail?: string;
  /** Written, with something to say: repaired, kept to a length (2026-09-28). */
  readonly note?: string;
}

/**
 * DREAMING, THE OWNER'S SETTING (2026-09-28, held lightly): `auto` — the first
 * session of a calendar day starts the nightly run on its own and says so in
 * one line; `ask` — the session asks first, as it did from 2026-09-26; `off` —
 * nothing is started or asked. Kept in the store's meta, so the hook, the MCP
 * server and the console all read one value; "no dreams" in conversation is
 * the dream tool's `setting` phase, and so is "dream on your own" (`auto`).
 *
 * THE DEFAULT IS `ask` (2026-09-29, held lightly): the person says yes at
 * least once, in the terminal where they can see the question; `auto` is
 * theirs to choose.
 */
export const DREAMING_SETTINGS = ["auto", "ask", "off"] as const;
export type DreamingSetting = (typeof DREAMING_SETTINGS)[number];
export const DREAMING_SETTING_KEY = "dream.setting";
export const DREAMING_DEFAULT: DreamingSetting = "ask";

/**
 * `auto` CHANGED MEANING in this version (2026-09-29, owner decision A): it was
 * "the session's model starts the run"; it is now "the host starts it
 * headless". So a store with `auto` written explicitly is set back to `ask`
 * ONCE, recorded, and the owner is told once; their next "dream on your own"
 * sets `auto` again. The marker says the once has happened — it is also
 * written by any setting chosen on this version, so a choice made before the
 * first hook ran is never undone.
 */
export const AUTO_RESET_KEY = "dream.setting.headless-reset";
/** Pending while the owner has not yet been told of the reset. */
export const AUTO_RESET_NOTICE_KEY = "dream.setting.headless-reset.notice";

/** The store's dreaming setting; the default when none was set or it will not read. */
export function dreamingSetting(store: Pick<Store, "getMeta">): DreamingSetting {
  try {
    const v = (store.getMeta(DREAMING_SETTING_KEY) ?? "").trim();
    return (DREAMING_SETTINGS as readonly string[]).includes(v) ? (v as DreamingSetting) : DREAMING_DEFAULT;
  } catch {
    return DREAMING_DEFAULT;
  }
}

/** One part of the nightly run. */
export type NightPart = "dream" | "writer" | "reflection";

/** The nightly run's order (`DREAM_TUNABLES.NIGHT_ORDER`), each part once. */
export function nightOrder(): NightPart[] {
  const parts: NightPart[] = [];
  for (const p of DREAM_TUNABLES.NIGHT_ORDER) if (!parts.includes(p)) parts.push(p);
  for (const p of ["dream", "writer", "reflection"] as const) if (!parts.includes(p)) parts.push(p);
  return parts;
}

/** Tonight's run in a few words, in its order: "updates your self page, then dreams, then reflects". */
export function nightSummary(): string {
  const words: Record<NightPart, string> = { writer: "updates your self page", dream: "dreams", reflection: "reflects" };
  return nightOrder()
    .map((p) => words[p])
    .join(", then ");
}

/** The part after `part` in tonight's order, or null when it is the last. */
export function nightNext(part: NightPart): NightPart | null {
  const order = nightOrder();
  return order[order.indexOf(part) + 1] ?? null;
}

/**
 * THE HEADLESS NIGHTLY RUN'S RECORD (2026-09-29). With the setting `auto` the
 * host starts the run itself, in a windowless session nobody watches — so what
 * became of it is written down: ONE row per run, the latest in the store's meta
 * under `NIGHT_RUN_KEY` (what the gate, doctor and the dashboard read, one
 * lookup), and each state it passed through on the `dream.night` event log,
 * latched by run and state so a replay adds nothing. Ids, codes, counts and
 * times only — never words from the run.
 */
export const NIGHT_RUN_KEY = "dream.night";
export const NIGHT_RUN_EVENT = "dream.night";
export const NIGHT_RUN_STATES = ["started", "done", "partial", "failed", "timed-out", "could-not-start"] as const;
export type NightRunState = (typeof NIGHT_RUN_STATES)[number];

export interface NightRun {
  /** `nrn_…`, minted by the host when it starts the run. */
  readonly run: string;
  /** The calendar date whose run this is. */
  readonly date: string;
  readonly state: NightRunState;
  /** The whole night, or the reflection alone after a dream whose run was cut off. */
  readonly kind: "night" | "reflection";
  /** The session that started it; the run's writes are attributed to it. */
  readonly session: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  /**
   * Why it ended the way it did, as a short code: `no-claude`, `spawn-failed`,
   * `quick-exit`, `nothing-ran`, `unfinished`, `exit`, `watchdog`, `refused`,
   * `runner` (the host's own background process could not start), `unread`
   * (the store would not open once the child ended; `detail` says why) — or
   * null.
   */
  readonly reason: string | null;
  /** A little more, when there is more: an error code, a refusal's name. Never prose from the run. */
  readonly detail: string | null;
  /** The child's exit code, when it exited. */
  readonly code: number | null;
  /** The dream this run journaled (or finished reflecting on), and its reflection. */
  readonly dream: string | null;
  readonly reflection: string | null;
  /**
   * WHICH PARTS OF THE RUN RAN (2026-09-29, owner): the page writer (its phase
   * was reached), the dream (journaled), the reflection (finished) — in the
   * run's order. A run that did some but not all is `partial`.
   */
  readonly parts?: readonly NightPart[];
  /** The child's watchdog, ms, as the host started it — what makes a `started` row LOST past it. */
  readonly timeoutMs?: number;
  /**
   * WHAT THE HOST CUT (2026-10-09, U14 item 3): how the child's own transcript
   * read once it exited — `read`, `absent` (not where the host keeps it) or
   * `unreadable` — and, when read, how many of the run's tool results the host
   * showed the model only as a preview (one `mcp.result.spilled` row each).
   * Absent on a run whose child never started, and on rows from before.
   */
  readonly transcript?: "read" | "absent" | "unreadable";
  readonly spills?: number;
  /**
   * New memories put back in the dream's queue because the part carrying them
   * was cut (Lane 0, 2026-10-10; `Dreams#requeueSpilled`). Absent when nothing
   * was cut or nobody checked.
   */
  readonly requeued?: number;
  /**
   * When its hand-back was carried to a prompt (or found already carried) —
   * so the per-prompt path READS this and writes nothing once it is set.
   * Absent until then.
   */
  readonly handedAt?: number;
}

/**
 * A `started` row past its watchdog and the grace: its process never reported
 * (review of #282, finding 4).
 */
export function nightRunLost(run: Pick<NightRun, "state" | "startedAt" | "timeoutMs">, now: number): boolean {
  if (run.state !== "started") return false;
  return now - run.startedAt > (run.timeoutMs ?? DREAM_TUNABLES.NIGHT_RUN_ASSUMED_MS) + DREAM_TUNABLES.NIGHT_LOST_GRACE_MS;
}

/**
 * What a run did, in parts: "the page writer and the dream ran; the reflection
 * did not". What a run is FOR is the dream and the reflection (or the
 * reflection alone); the page writer is named when it ran, and never counted
 * missing — a night with no day before it has nothing for the writer to read.
 */
export function nightPartsWords(run: Pick<NightRun, "kind"> & Partial<Pick<NightRun, "parts">>): string {
  const names: Record<NightPart, string> = { writer: "the page writer", dream: "the dream", reflection: "the reflection" };
  const required: NightPart[] = run.kind === "reflection" ? ["reflection"] : ["dream", "reflection"];
  const ran = nightOrder().filter((p) => (run.parts ?? []).includes(p));
  const not = nightOrder().filter((p) => required.includes(p) && !ran.includes(p));
  const list = (ps: NightPart[]): string => ps.map((p) => names[p]).join(ps.length === 2 ? " and " : ", ");
  if (not.length === 0) return `${list(ran)} ran`;
  if (ran.length === 0) return `${list(not)} did not run`;
  return `${list(ran)} ran; ${list(not)} did not`;
}

/** What "no dreams" says about a run already going (owner decision D, 2026-09-29). */
export const NIGHT_RUN_FINISHES = "A run already under way in the background finishes; the setting takes effect from the next run.";

/** A fresh run id. */
export function newNightRunId(): string {
  return `nrn_${randomBytes(6).toString("hex")}`;
}

/** The store's latest headless run, or null when none was ever started (or it will not read). */
export function nightRunOf(store: Pick<Store, "getMeta">): NightRun | null {
  try {
    const raw = store.getMeta(NIGHT_RUN_KEY);
    if (raw === undefined || raw.length === 0) return null;
    const v = JSON.parse(raw) as Partial<NightRun>;
    if (typeof v.run !== "string" || typeof v.date !== "string" || typeof v.session !== "string") return null;
    if (!(NIGHT_RUN_STATES as readonly string[]).includes(String(v.state))) return null;
    return {
      run: v.run,
      date: v.date,
      state: v.state as NightRunState,
      kind: v.kind === "reflection" ? "reflection" : "night",
      session: v.session,
      startedAt: typeof v.startedAt === "number" ? v.startedAt : 0,
      endedAt: typeof v.endedAt === "number" ? v.endedAt : null,
      reason: typeof v.reason === "string" ? v.reason : null,
      detail: typeof v.detail === "string" ? v.detail : null,
      code: typeof v.code === "number" ? v.code : null,
      dream: typeof v.dream === "string" ? v.dream : null,
      reflection: typeof v.reflection === "string" ? v.reflection : null,
      ...(typeof v.handedAt === "number" ? { handedAt: v.handedAt } : {}),
      ...(typeof v.timeoutMs === "number" ? { timeoutMs: v.timeoutMs } : {}),
      ...(Array.isArray(v.parts) ? { parts: v.parts.filter((p): p is NightPart => p === "writer" || p === "dream" || p === "reflection") } : {}),
      ...(v.transcript === "read" || v.transcript === "absent" || v.transcript === "unreadable" ? { transcript: v.transcript } : {}),
      ...(typeof v.spills === "number" ? { spills: v.spills } : {}),
      ...(typeof v.requeued === "number" ? { requeued: v.requeued } : {}),
    };
  } catch {
    return null;
  }
}

/** Why a run ended as it did, in a few words for a person ("the claude command was not found"). */
export function nightRunWords(run: Pick<NightRun, "state" | "reason" | "detail" | "code"> & Partial<Pick<NightRun, "dream" | "reflection">>): string {
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
      return run.detail === "SCHEMA_AHEAD"
        ? "it ran, but a newer build took the store while it ran, so what it did could not be read (an update mid-run)"
        : `it ran, but the store could not be read afterwards${run.detail === null ? "" : ` (${run.detail})`}`;
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

/**
 * Meta counter: how many times the calendar day's run was started again, as
 * `<date>:<n>` in ONE key — a new day overwrites the old count, so nothing
 * piles up to prune.
 */
export const RELAUNCHED_KEY = "dream.relaunched";

export interface DreamStatus {
  readonly last: DreamRow | null;
  readonly dreamedToday: boolean;
  readonly newSince: number;
  readonly due: boolean;
  readonly reason:
    | "due"
    | "observer"
    | "first-day"
    | "dreamed-today"
    | "asked-today"
    | "declined-today"
    | "too-little-new"
    /** The owner's setting is `off`. */
    | "off"
    /** A dream is open and was busy lately: a run is under way. */
    | "dreaming-now";
  /** The owner's setting, read with the gate. */
  readonly setting: DreamingSetting;
  /** `newSince` is a floor: the per-prompt gate stopped counting at `MIN_NEW`. */
  readonly newSinceAtLeast?: boolean;
  /**
   * A dream begun and left behind — no journal, quiet for longer than
   * `ABANDONED_AFTER_MS` — that the next `begin` will RESUME (today's or
   * yesterday's). When the gate is due because of it, the line says so.
   */
  readonly leftBehind: DreamRow | null;
  /**
   * A dream journaled today whose REFLECTION was cut off (2026-09-28): the
   * run died between the journal and the reflection's finish. When the gate
   * is due because of it, the line starts the reflection only — not another
   * dream.
   */
  readonly reflectOnly: DreamRow | null;
}

/**
 * HOW THE SESSION SAYS THE DAY'S LINE (2026-10-01, lane 8 — the 09-30 plan's
 * build 4): once, in its first reply, as one plain sentence. The terminal line
 * is the extra; a session whose person sees no terminal still hears it.
 */
export function sayOnce(who: string): string {
  return `Tell ${who} this once, in your first reply, as one plain sentence of your own.`;
}

/**
 * THE DAY'S LINE, HELD for a session someone can see (2026-10-01, lane 8).
 * A headless or SDK session may START the nightly run — the start is the point
 * — but nobody sees what it is told, so it leaves the line here and the next
 * INTERACTIVE session says it (`Dreams#heldTold`, claimed by
 * `Dreams#claimHeldTold`). One row, the latest run's; empty once told.
 */
export const NIGHT_UNTOLD_KEY = "dream.night.untold";

export interface HeldTold {
  /** The run it is about. */
  readonly run: string;
  /** The calendar date of the run. */
  readonly date: string;
  /** For the PERSON, the terminal's line. */
  readonly notice: string;
  /** For the MODEL. */
  readonly context: string;
}

/**
 * THE DAY'S LINE, OFFERED and not yet claimed (`Dreams.offer`, 2026-09-29):
 * what the model is told, what the person is shown, and what the claim will
 * write. The host claims it (`Dreams.claimOffer`) only once it knows the
 * person's line is leaving; unclaimed, it is offered again at the next prompt.
 */
export interface DreamOffer {
  readonly at: string;
  readonly session: string;
  /** What the claim writes on the day's row: `launched` (auto) or `offered` (ask). */
  readonly state: "launched" | "offered";
  readonly setting: DreamingSetting;
  /** The HOST starts the run itself, headless, once it claims this (setting `auto`, 2026-09-29). */
  readonly headless: boolean;
  /**
   * The ASK a headless run that could not start falls back to: claimed over
   * the day's `launched` row as `offered`, recorded with `after:
   * "could-not-start"`, and NOT counted as a relaunch — nothing ran.
   */
  readonly fallback: boolean;
  /** For the MODEL: what to do, and what each answer means. */
  readonly context: string;
  /** For the PERSON, shown in the terminal. Null: nothing to show. */
  readonly notice: string | null;
  /** The queue's length when offered. */
  readonly fresh: number;
  /** A dream left behind the run resumes, or null. */
  readonly resumes: string | null;
  /** A dream whose reflection the run finishes alone, or null. */
  readonly reflects: string | null;
  /** The moment of the day's row the offer read — the claim reclaims it — or null when the day is unclaimed. */
  readonly priorAt: number | null;
}

const KINDS: readonly Kind[] = ["self", "person", "entity", "skill", "place", "fact"];

export class Dreams {
  private readonly ctx: DreamContext;

  constructor(ctx: DreamContext) {
    this.ctx = ctx;
  }

  /** Whose a bundle is read as: a guest (`BUNDLE_OWNER`), unless a test asked otherwise. */
  private get bundleOwner(): boolean {
    return this.ctx.bundleOwner ?? BUNDLE_OWNER;
  }

  private get store(): Store {
    return this.ctx.store;
  }

  private ownLinker: Associate | null = null;
  /** What this propose call's links did, for the dream row (2026-09-28). */
  private linkTally = { gistLinks: 0, linkNoRoom: 0, linkFrozen: 0, linkFailed: 0 };

  /** Every edge a dream writes goes through here (`DreamContext.link`). */
  private proposeLinks(pairs: readonly { a: string; b: string }[], day: number): DreamLinkReport {
    let r: DreamLinkReport;
    try {
      r =
        this.ctx.link !== undefined
          ? this.ctx.link(pairs, DREAM_TUNABLES.LINK_WEIGHT, day)
          : (this.ownLinker ??= new Associate({ store: this.store })).propose(pairs, DREAM_TUNABLES.LINK_WEIGHT, day);
    } catch {
      r = { reason: "failed", pairs: 0, landed: [], noRoom: 0, blocked: 0, frozen: 0 };
    }
    this.linkTally.linkNoRoom += r.noRoom;
    this.linkTally.linkFrozen += r.frozen;
    if (r.reason === "failed" || r.reason === "observer") this.linkTally.linkFailed += 1;
    return r;
  }

  private emit(name: string, ref?: string, data?: Record<string, string | number | boolean | null>): void {
    this.ctx.emit?.(name, ref, data);
  }

  // ── when ──────────────────────────────────────────────────────────────────

  /**
   * THE LAST DREAM THAT COUNTS — the newest one not undone, or null when this
   * store has never dreamed (or undid every dream). "Last dreamed", "dreamed
   * today" and `begin` read it; "new" is the QUEUE (`queue`), which passes
   * over a dream that will be resumed.
   */
  lastDream(): DreamRow | null {
    return this.store.dreams({ limit: 20 }).find((d) => d.state !== "undone") ?? null;
  }

  /** The owner's dreaming setting: `auto`, `ask` (the default) or `off`. */
  setting(): DreamingSetting {
    return dreamingSetting(this.store);
  }

  /**
   * CHANGE THE SETTING — the owner's word: "no dreams" in conversation (the
   * dream tool's `setting` phase) or `counterparts dream --setting`. Durable
   * (the store's meta), reversible the same way, recorded on the `dream.ask`
   * row with what it was before.
   */
  setSetting(
    value: string,
    input: { by: "session" | "owner"; session?: string | null },
  ): { ok: true; setting: DreamingSetting; before: DreamingSetting } | { ok: false; reason: "observer" | "not-a-setting" } {
    if (this.ctx.observer) return { ok: false, reason: "observer" };
    const v = value.trim().toLowerCase();
    if (!(DREAMING_SETTINGS as readonly string[]).includes(v)) return { ok: false, reason: "not-a-setting" };
    const before = this.setting();
    this.store.setMeta(DREAMING_SETTING_KEY, v);
    // A setting chosen on this version is never reset (`AUTO_RESET_KEY`).
    if (this.store.getMeta(AUTO_RESET_KEY) === undefined) this.store.setMeta(AUTO_RESET_KEY, "chosen");
    this.record(DREAM_ASK_EVENT, null, { state: "setting", setting: v, before, by: input.by });
    return { ok: true, setting: v as DreamingSetting, before };
  }

  // ── `auto` changed meaning: reset once (owner decision A, 2026-09-29) ──────

  /**
   * SET AN EXPLICIT `auto` BACK TO `ask`, ONCE PER STORE. True when it did.
   * The first call on this version writes the marker whatever it finds; a
   * store with no explicit `auto` is left as it is. Never throws; nothing
   * under observer.
   */
  resetAutoOnce(): boolean {
    if (this.ctx.observer) return false;
    try {
      if (this.store.getMeta(AUTO_RESET_KEY) !== undefined) return false;
      const explicit = (this.store.getMeta(DREAMING_SETTING_KEY) ?? "").trim() === "auto";
      this.store.setMeta(AUTO_RESET_KEY, explicit ? "reset" : "none");
      if (!explicit) return false;
      this.store.setMeta(DREAMING_SETTING_KEY, "ask");
      this.store.setMeta(AUTO_RESET_NOTICE_KEY, "pending");
      this.record(DREAM_ASK_EVENT, null, { state: "setting", setting: "ask", before: "auto", by: "upgrade", why: "auto-now-headless" });
      return true;
    } catch {
      return false;
    }
  }

  /** The owner's one line about the reset, while it has not been told; null otherwise. A read. */
  autoResetNotice(): { notice: string; context: string } | null {
    if (this.ctx.observer) return null;
    try {
      if (this.store.getMeta(AUTO_RESET_NOTICE_KEY) !== "pending") return null;
    } catch {
      return null;
    }
    return {
      notice: 'Counterparts: dreaming changed in this version — "on my own" now means a separate background session, so I set it back to asking. Say "dream on your own" to turn it on again.',
      context:
        'Counterparts: this version changed what the dreaming setting `auto` does — the host now runs the night itself, in a separate windowless session — so the owner\'s `auto` was set back to `ask`, once, and they are told so in the terminal. If they say "dream on your own", call the dream tool with phase "setting", value: "auto".',
    };
  }

  /** The reset was told: claimed once, ever (a latched event), and the pending mark cleared. */
  claimAutoResetNotice(session: string): boolean {
    if (this.ctx.observer) return false;
    try {
      const won = this.store.appendEvent({ name: `${DREAM_ASK_EVENT}.reset-told`, day: this.store.livedDay(), ref: null, payload: { session }, dedupKey: `${AUTO_RESET_KEY}:told` }) > 0;
      this.store.setMeta(AUTO_RESET_NOTICE_KEY, "told");
      return won;
    } catch {
      return false;
    }
  }

  // ── the headless run's record (2026-09-29) ─────────────────────────────────

  /** The latest headless run, or null. A read: one meta lookup. */
  nightRun(): NightRun | null {
    return nightRunOf(this.store);
  }

  /**
   * A HEADLESS RUN IS UNDER WAY: the latest run is `started` and not lost.
   * "No dreams" does not stop it (owner decision D, 2026-09-29): the setting
   * takes effect from the next run, and whoever turns it off is told so
   * (`NIGHT_RUN_FINISHES`).
   */
  nightRunUnderWay(): boolean {
    const night = this.nightRun();
    return night !== null && night.state === "started" && !nightRunLost(night, this.store.now());
  }

  /**
   * RECORD WHAT BECAME OF A HEADLESS RUN: the latest-run row (meta) and one
   * `dream.night` event for this state, latched by run and state. A terminal
   * state for an older run never overwrites a newer run's row. Never throws;
   * nothing under observer.
   */
  recordNightRun(run: NightRun): void {
    if (this.ctx.observer) return;
    try {
      const current = this.nightRun();
      if (current === null || current.run === run.run || current.startedAt <= run.startedAt) {
        this.store.setMeta(NIGHT_RUN_KEY, JSON.stringify(run));
      }
    } catch {
      /* the record is evidence; the run goes on */
    }
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
          ms: run.endedAt === null ? null : run.endedAt - run.startedAt,
          ...(run.transcript === undefined ? {} : { transcript: run.transcript }),
          ...(run.spills === undefined ? {} : { spills: run.spills }),
          ...(run.requeued === undefined ? {} : { requeued: run.requeued }),
        },
        dedupKey: `${NIGHT_RUN_EVENT}:${run.run}:${run.state}`,
      });
    } catch {
      /* the log is evidence, never a reason to fail the run */
    }
  }

  /**
   * HOLD THE DAY'S LINE for an interactive session (2026-10-01, lane 8): the
   * run `run` was started by a session nobody sees, so what it would have
   * been told waits here. Never throws; nothing under observer.
   */
  holdTold(input: { run: string; date: string }): void {
    if (this.ctx.observer) return;
    try {
      this.store.setMeta(NIGHT_UNTOLD_KEY, JSON.stringify({ run: input.run, date: input.date }));
    } catch {
      /* a line not held is a line not told; the run goes on */
    }
  }

  /**
   * THE HELD LINE, worded for `session`, if it is still worth saying on `at`:
   * the same date, the latest run is that run and still under way (one that
   * ended hands back what it did instead, `nightHandBackLine`), and nobody has
   * told it. A READ.
   */
  heldTold(at: string, session: string): HeldTold | null {
    try {
      const raw = this.store.getMeta(NIGHT_UNTOLD_KEY);
      if (raw === undefined || raw.length === 0) return null;
      const held = JSON.parse(raw) as { run?: unknown; date?: unknown };
      if (typeof held.run !== "string" || held.date !== at) return null;
      const night = this.nightRun();
      if (night === null || night.run !== held.run || night.state !== "started" || nightRunLost(night, this.store.now())) return null;
      const who = this.ownerName() ?? "the owner";
      const notice = `Counterparts: dreaming in the background (a few minutes). Say "no dreams" to turn it off.`;
      const context =
        `Counterparts: the nightly run started in the background earlier today, from a session nobody was watching (no terminal), and is still going. ${sayOnce(who)} ` +
        `${who} may also see it in the terminal ("${notice}"). What it did comes to a later prompt. If ${who} says "no dreams", call the dream tool with phase "setting", session: ${session}, value: "off" — it takes effect from the next run.`;
      return { run: held.run, date: at, notice, context };
    } catch {
      return null;
    }
  }

  /**
   * CLAIM THE HELD LINE the delivery is certainly about to show — once per
   * run across every session (an event latch), and the row emptied. False
   * when another session got there first or the write would not land.
   */
  claimHeldTold(run: string, session: string): boolean {
    if (this.ctx.observer) return false;
    try {
      const won = this.store.appendEvent({ name: `${NIGHT_RUN_EVENT}.told`, day: this.store.livedDay(), ref: run, payload: { session }, dedupKey: `${NIGHT_RUN_EVENT}.told:${run}` }) > 0;
      if (won) this.store.setMeta(NIGHT_UNTOLD_KEY, "");
      return won;
    } catch {
      return false;
    }
  }

  /**
   * CLAIM THE HAND-BACK of a headless run — once, ever, across every session:
   * an event latched by the run's id (`appendEvent` answers 0 when the latch
   * held). True for the one caller that gets it.
   */
  claimNightHandBack(run: string, session: string): boolean {
    if (this.ctx.observer) return false;
    try {
      return this.store.appendEvent({ name: `${NIGHT_RUN_EVENT}.handed`, day: this.store.livedDay(), ref: run, payload: { session }, dedupKey: `${NIGHT_RUN_EVENT}.handed:${run}` }) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Is a dream due? No dream yet this CALENDAR day (2026-09-28: was the lived
   * day), the setting not `off`, no run under way, the day's line not yet
   * given (or given to a run that was left behind), and enough new — and
   * SHOWABLE — memory since the last dream. A read, and a CHEAP one: it runs
   * on every prompt, so the questions that need no scan are asked first, and
   * "new since" is one bounded read (`store.newMemoryIds`), counted only when
   * everything else says yes.
   */
  status(at: string = this.ctx.today()): DreamStatus {
    return this.gate(at, this.ctx.observer, this.ctx.owner, DREAM_TUNABLES.MIN_NEW);
  }

  /**
   * THE GATE ITSELF — `status` asks it in this module's stance. Reads only.
   * (`previewAsk`, which asked it as a live session for the dashboard's
   * Tonight box, was removed 2026-10-09 with no caller left: NOTES.)
   */
  private gate(at: string, observer: boolean, owner: boolean, enough?: number): DreamStatus {
    const setting = this.setting();
    const last = this.lastDream();
    const day = this.store.livedDay();
    const open = last !== null && last.state === "begun" ? last : null;
    const busy = open !== null && !this.abandoned(open);
    const leftBehind = open !== null && !busy && this.resumable(open, at) && this.store.dreamChanges(open.id).length > 0 ? open : null;
    // THE CALENDAR DAY (2026-09-28, I32's reason): the lived clock advances
    // inside the sleep cycle a worker runs, so a gate on it can miss nights.
    const dreamedToday = last !== null && last.state === "journaled" && this.onDay(last, at, day);
    const base = { last, dreamedToday, newSince: 0, due: false, setting, leftBehind, reflectOnly: null };
    if (observer) return { ...base, reason: "observer" };
    // A store on its first lived day has no night behind it yet: "I haven't
    // dreamed since …" needs a since.
    if (day < 1) return { ...base, reason: "first-day" };
    if (dreamedToday) {
      // DREAMED, BUT THE REFLECTION WAS CUT OFF: the line starts the
      // reflection alone, under the same latch and the same cap.
      const ask = setting === "off" ? undefined : this.store.dreamAsk(at);
      if (last !== null && ask !== undefined && this.reflectionLeftBehind(last, at, day) && this.mayStartAgain(ask, last, at)) {
        return { ...base, due: true, reason: "due", reflectOnly: last };
      }
      return { ...base, reason: "dreamed-today" };
    }
    if (setting === "off") return { ...base, reason: "off" };
    if (busy) return { ...base, reason: "dreaming-now" };
    // A HEADLESS RUN STILL INSIDE ITS WATCHDOG is under way, whether or not its
    // dream has begun yet (review of #282, finding 10): a watchdog longer than
    // `ABANDONED_AFTER_MS` must not let a second run start beside it.
    const night = this.nightRun();
    if (night !== null && night.state === "started" && night.date === at && !nightRunLost(night, this.store.now())) return { ...base, reason: "dreaming-now" };
    const ask = this.store.dreamAsk(at);
    if (ask !== undefined) {
      if (ask.state === "declined") return { ...base, reason: "declined-today" };
      if (!this.mayStartAgain(ask, leftBehind, at)) return { ...base, reason: "asked-today" };
    }
    // THE QUEUE (2026-09-28): every undreamed memory in the window, not only
    // what arrived since the last dream began — what a night could not take
    // waits, and counts here.
    // THE PER-PROMPT PATH COUNTS ONLY AS FAR AS IT NEEDS (review of build B):
    // `status` stops at `MIN_NEW` (and says the count is a floor); the line
    // counts the whole queue.
    const q = this.queue({ owner, skip: (d) => this.passedOver(d, at), ...(enough === undefined ? {} : { enough }) });
    const newSince = q.ids.length;
    // A RUN LEFT BEHIND is due whatever the count: its dream is half-done, and
    // the reflection after it never ran.
    if (leftBehind !== null) return { ...base, newSince, due: true, reason: "due" };
    const reason = newSince < DREAM_TUNABLES.MIN_NEW ? "too-little-new" : "due";
    return { ...base, newSince, due: reason === "due", reason, ...(q.stopped ? { newSinceAtLeast: true } : {}) };
  }

  /**
   * MAY THE DAY'S LINE GO OUT AGAIN (2026-09-28)? Only when the run it started
   * was left behind — a dream begun and gone quiet (`behind`), a journaled
   * dream whose reflection never finished (`behind` too), or a LAUNCH no
   * living dream followed (the session closed first; a dream that began,
   * changed nothing and went quiet does not count as following it). Only for
   * a line that launched a run — with `ask`, the launch flips the row to
   * `launched` (`launched`) — so an ask nobody answered is not asked again.
   * Only after the line has itself been quiet for `ABANDONED_AFTER_MS`, and at
   * most `RELAUNCHES_PER_DAY` times a day.
   */
  private mayStartAgain(ask: { state: string; at: number }, behind: DreamRow | null, at: string): boolean {
    if (ask.state !== "launched" && ask.state !== "offered") return false;
    // THE HEADLESS RUN THIS LINE STARTED COULD NOT START (2026-09-29): ask at
    // once — no quiet window to wait out, there is no run to wait for — under
    // the same cap.
    // Not counted as a relaunch (review of #282, finding 7): nothing ran, and
    // the ask it becomes is not asked again.
    if (ask.state === "launched" && this.fellBack(at, ask.at) !== null) return true;
    if (this.store.now() - ask.at <= DREAM_TUNABLES.ABANDONED_AFTER_MS) return false;
    if (this.relaunches(at) >= DREAM_TUNABLES.RELAUNCHES_PER_DAY) return false;
    if (behind !== null) return true;
    if (ask.state !== "launched") return false;
    const followed = this.store
      .dreams({ sinceAt: ask.at, limit: 20 })
      .filter((d) => d.state !== "undone" && !(d.state === "begun" && this.abandoned(d) && this.store.dreamChanges(d.id).length === 0));
    return followed.length === 0;
  }

  /**
   * THE REFLECTION AFTER A DREAM JOURNALED TODAY WAS LEFT BEHIND: none
   * finished today, none begun lately (a run still reflecting), and the dream
   * itself finished longer ago than `ABANDONED_AFTER_MS` (a run about to
   * reflect).
   */
  private reflectionLeftBehind(dream: DreamRow, at: string, day: number): boolean {
    const now = this.store.now();
    if (dream.finished_at !== null && now - dream.finished_at <= DREAM_TUNABLES.ABANDONED_AFTER_MS) return false;
    for (const r of this.store.reflections({ limit: 10 })) {
      const today = this.onDay(r, at, day);
      if (today && r.state === "reflected") return false;
      if (r.state === "begun" && now - r.started_at <= DREAM_TUNABLES.ABANDONED_AFTER_MS) return false;
    }
    return true;
  }

  /** How many times today's run was started again (`RELAUNCHED_KEY`, `<date>:<n>`). */
  private relaunches(at: string): number {
    const raw = this.store.getMeta(RELAUNCHED_KEY) ?? "";
    const i = raw.lastIndexOf(":");
    if (i < 0 || raw.slice(0, i) !== at) return 0;
    const n = Number(raw.slice(i + 1));
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * THE RUN WAS LAUNCHED (2026-09-28): the dream tool's `launch` phase. The
   * day's row becomes `launched` — claimed if the line never went out (the
   * owner asked for a dream), flipped from `offered` when the owner said yes
   * to an ask — so a run that dies before its dream begins is started again
   * the way `auto`'s is. The row's moment moves to now: the quiet window
   * counts from the launch. A declined day stays declined.
   */
  launched(input: { at: string; session: string }): void {
    if (this.ctx.observer) return;
    try {
      const day = this.store.livedDay();
      const row = this.store.dreamAsk(input.at);
      if (row === undefined) {
        if (this.store.setDreamAsk({ date: input.at, state: "launched", session: input.session, day })) {
          this.record(DREAM_ASK_EVENT, null, { state: "launched", date: input.at, setting: this.setting() });
        }
        return;
      }
      if (row.state === "declined") return;
      const flipped = this.store.reclaimDreamAsk({ date: input.at, prevAt: row.at, state: "launched", session: input.session, day });
      if (flipped && row.state === "offered") this.record(DREAM_ASK_EVENT, null, { state: "launched", date: input.at, setting: this.setting(), after: "ask" });
    } catch {
      /* the latch is bookkeeping; the launch goes on */
    }
  }

  /** Was this dream on that calendar day? Its date, else (a row with none) its lived day. */
  private onDay(row: { date: string | null; day: number }, at: string, day: number): boolean {
    return row.date !== null && row.date.length > 0 ? row.date === at : row.day >= day;
  }

  /** Today's or yesterday's: a dream left behind that the next `begin` resumes. */
  private resumable(row: DreamRow, at: string): boolean {
    if (row.date !== null && isDay(row.date) && isDay(at)) return row.date >= addDays(at, -1);
    return row.day >= this.store.livedDay() - 1;
  }

  /** Begun, not journaled, and quiet — no change — for longer than `ABANDONED_AFTER_MS`. */
  private abandoned(row: DreamRow): boolean {
    if (row.state !== "begun") return false;
    const changes = this.store.dreamChanges(row.id);
    const lastAt = changes.reduce((m, c) => Math.max(m, c.at), row.started_at);
    return this.store.now() - lastAt > DREAM_TUNABLES.ABANDONED_AFTER_MS;
  }

  /**
   * A dream the gate passes over: begun, left behind, and about to be resumed
   * or closed by the next `begin` — what it was shown is its own again, so it
   * does not take memories out of the queue. The gate and `begin` count the
   * same queue.
   */
  private passedOver(d: DreamRow, at: string): boolean {
    return d.state === "begun" && this.abandoned(d) && (this.resumable(d, at) || this.store.dreamChanges(d.id).length === 0);
  }

  /**
   * THE LINE, OFFERED — at most once per calendar day across every session
   * (the `dream_asks` latch is the claim, `claimOffer`: of two sessions racing,
   * one gets it), and again only for a run that was left behind. Null when it
   * is not due. A READ (2026-09-29): nothing is claimed or recorded here, so
   * the host can claim the day only once it knows the person will see the
   * line (the same rule as a plain reminder's beat).
   *
   * Two renderings, from the same gate: `notice`, for the PERSON — the host
   * shows it in the terminal — and `context`, for the MODEL. What they say
   * follows the owner's setting: `ask` shows the question and tells the model
   * what "dream", "dream on your own", not today and "no dreams" each mean;
   * `auto` is HEADLESS (`headless`): the host starts the run itself and the
   * lines only say so — or, when today's headless run could not start, the
   * line asks instead and says why.
   */
  offer(input: { at: string; session: string }): DreamOffer | null {
    const gated = this.status(input.at);
    if (!gated.due) return null;
    // The line says how many: the whole queue, counted once, here.
    const s = gated.newSinceAtLeast === true ? { ...gated, newSince: this.queue({ owner: this.ctx.owner, skip: (d) => this.passedOver(d, input.at) }).ids.length } : gated;
    // AUTO IS HEADLESS (2026-09-29) — unless today's headless run could not
    // start, when the line falls back to asking, with the reason.
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
      priorAt: prior?.at ?? null,
    } as const;
    const since = s.last === null ? "yet" : `since ${s.last.date ?? `lived day ${String(s.last.day)}`}`;
    const who = this.ownerName() ?? "the owner";
    const off = `If ${who} says "no dreams" (or never, or stop), call the dream tool with phase "setting", session: ${input.session}, value: "off" — it takes effect from the next run (a run already under way finishes), and it can be turned back on the same way, or with counterparts dream --setting ask.`;
    const launch = `call the counterparts dream tool with phase "launch", session: ${input.session}, and hand the prompt it returns to a background agent (the Agent tool), unchanged — it ${nightSummary()}.`;
    const reflect = s.reflectOnly === null ? "" : `call the counterparts reflect tool with phase "launch", session: ${input.session}, dream: ${s.reflectOnly.id}, and hand the prompt it returns to a background agent (the Agent tool), unchanged — it reflects on that dream.`;
    const cut = s.leftBehind === null ? null : `your dream of ${s.leftBehind.date ?? "a recent night"} was cut off (its session closed before it woke); it picks up where it stopped`;
    const why =
      s.reflectOnly !== null
        ? "today's run dreamed, but was cut off before it reflected"
        : (cut ?? `a new day, and you haven't dreamed ${since} (${String(s.newSince)} new memories)`);
    if (headless) {
      // THE HEADLESS RUN (2026-09-29): the HOST starts it, in a windowless
      // session of its own — the model launches nothing. It is told what is
      // happening, and how to turn it off.
      const doing = s.reflectOnly !== null ? "finishing my reflection" : cut !== null ? "picking up my dream where it was cut off" : "dreaming";
      const notice = `Counterparts: ${doing} in the background (a few minutes). Say "no dreams" to turn it off.`;
      return {
        ...base,
        notice,
        context:
          `Counterparts: ${why}. The nightly run ${s.reflectOnly !== null ? "(the reflection alone)" : `(it ${nightSummary()})`} is starting now in the background, on its own — a separate, windowless session this host starts; there is nothing for you to launch. ` +
          // NEUTRAL about the terminal (review of #282, finding 6): the run has
          // started either way, and the host shows the person's line only when
          // the envelope has room for it. THE SESSION SAYS IT (2026-10-01, lane
          // 8, build 4): once, in its first reply, one plain sentence — the
          // terminal line is the extra.
          `${sayOnce(who)} ${who} may also see it in the terminal ("${notice}"); if they ask, that is what is happening. What it did comes to a later prompt. ${off}`,
      };
    }
    if (fell !== null) {
      // THE HEADLESS RUN COULD NOT START: ask, here, and say why in one line.
      const words = nightRunWords(fell);
      const notice = `Counterparts: I couldn't start dreaming on my own: ${words}${/[.?!]$/.test(words) ? "" : "."} Say "dream" to do it here.`;
      const start = s.reflectOnly !== null ? reflect : launch;
      return {
        ...base,
        notice,
        context:
          `Counterparts: ${why}. The background run could not start (${fell.reason ?? fell.state}). ${sayOnce(who)} The terminal may also show them: "${notice}" Then do not ask again — wait for their word. ` +
          `If they say "dream" (or yes), ${start} If they say not today, call the dream tool with phase "decline". ${off}`,
      };
    }
    // ASK (2026-09-29): the PERSON is shown the question in the terminal, so
    // the model does not ask it again — it waits for their word.
    const onYourOwn = `If ${who} says "dream on your own", call the dream tool with phase "setting", session: ${input.session}, value: "auto", then start today's run exactly as for "dream", and tell ${who} in one line that from now on the first session of each day starts it by itself in the background (and "no dreams" turns it off).`;
    const noticeFor = (what: string): string => `Counterparts: ${what} Say "dream" to start, or "dream on your own" to let me do it each day.`;
    if (s.reflectOnly !== null) {
      const notice = noticeFor("my reflection after dreaming was cut off.");
      return {
        ...base,
        notice,
        context:
          `Counterparts: ${why}. ${sayOnce(who)} The terminal may also show them: "${notice}" Then do not ask again — wait for their word. If they say "dream" (or yes), ${reflect} ${onYourOwn} If they say not today, call the dream tool with phase "decline". ${off}`,
      };
    }
    const notice = noticeFor(cut === null ? `I haven't dreamed ${since} (${String(s.newSince)} new memories).` : `my dream of ${s.leftBehind?.date ?? "a recent night"} was cut off.`);
    return {
      ...base,
      notice,
      context:
        `Counterparts: ${cut === null ? `you haven't dreamed ${since} (${String(s.newSince)} new memories)` : cut}. ${sayOnce(who)} The terminal may also show them: "${notice}" Then do not ask again — wait for their word. ` +
        `If they say "dream" (or yes), ${launch} ${onYourOwn} If they say not today, call it with phase "decline" and don't bring it up again today. ${off}`,
    };
  }

  /**
   * TODAY'S HEADLESS RUN COULD NOT START (2026-09-29): the latest run is
   * today's and ended `could-not-start` — and, given `since`, started after
   * that moment (the day's line that launched it). Null otherwise.
   */
  private fellBack(at: string, since?: number): NightRun | null {
    const night = this.nightRun();
    if (night === null || night.date !== at) return null;
    if (since !== undefined && night.startedAt < since) return null;
    if (night.state === "could-not-start") return night;
    // A run that timed out, failed, or never reported (review of #282,
    // finding 4) falls back too — when it BEGAN NOTHING: one that dreamed
    // part-way is left behind, and the ordinary relaunch resumes it headless.
    const lost = nightRunLost(night, this.store.now());
    if (night.state !== "timed-out" && night.state !== "failed" && !lost) return null;
    if (this.beganSince(night.startedAt)) return null;
    return lost ? { ...night, reason: "lost" } : night;
  }

  /** Did a dream or a reflection begin at or after `t`? */
  private beganSince(t: number): boolean {
    try {
      return this.store.dreams({ sinceAt: t, limit: 1 }).length > 0 || this.store.reflections({ limit: 5 }).some((r) => r.started_at >= t);
    } catch {
      return false;
    }
  }

  /**
   * THE HAND-BACK OF A HEADLESS RUN, for the model to pass on: the dream's own
   * line (`handBackOf`) — what an Agent would have handed back to the session
   * that launched it, had there been one. Null when the run left nothing to
   * tell. The share, if any, is carried beside it (`Reflections.carryLine`).
   */
  nightHandBackLine(run: NightRun): string | null {
    // THE REFLECTION ALONE hands back its share only: the dream's line went out
    // with the run that dreamed it (review of #282, finding 5).
    if (run.kind === "reflection") return null;
    const dreamLine = run.dream === null ? null : this.handBackOf(run.dream);
    if (dreamLine === null) return null;
    const who = this.ownerName() ?? "the owner";
    const unfinished = run.state === "done" ? "" : ` (only part of it: ${nightPartsWords(run)})`;
    return `Counterparts: the nightly run finished in the background, on its own${unfinished}. At a natural moment — not mid-task — tell ${who} in your own words what it did: ${dreamLine}`;
  }

  /**
   * THE HOST'S CUT, SAID PLAINLY (2026-10-09, U14 item 3): when the run's own
   * transcript showed results of ours the host cut to a preview (`spills`),
   * the morning hand-back says so beside the dream's line and the share — so
   * the owner hears it without opening doctor. A dream or a reflection that
   * read through a keyhole may still sound whole, and its own entry is not
   * where he would look. Null when nothing was cut, or nobody checked.
   */
  nightSpillLine(run: Pick<NightRun, "spills"> & Partial<Pick<NightRun, "requeued">>): string | null {
    const n = run.spills ?? 0;
    if (n <= 0) return null;
    const who = this.ownerName() ?? "the owner";
    const what = n === 1 ? "one of the nightly run's tool results" : `${String(n)} of the nightly run's tool results`;
    const r = run.requeued ?? 0;
    const back = r > 0 ? ` The ${r === 1 ? "new memory it could not see goes" : `${String(r)} new memories it could not see go`} back in the queue for the next dream.` : "";
    return (
      `Counterparts: Claude Code cut ${what} to a short preview before the run could read ${n === 1 ? "it" : "them"}, so last night's run worked from part of what it was handed.${back} ` +
      `At a natural moment — not mid-task — tell ${who} plainly, in a sentence, that this happened: Claude Code cut results that Counterparts had already sized to fit. \`counterparts doctor\` has the details on its Tool results line.`
    );
  }

  /**
   * CLAIM THE DAY for an offer the host is certainly delivering: the
   * `dream_asks` latch (a fresh row, or a reclaim of the row the offer read —
   * of two racing, one wins), the relaunch count, and the `dream.ask` row.
   * False when another session got there first or the write would not land.
   */
  claimOffer(offer: DreamOffer): boolean {
    if (this.ctx.observer) return false;
    const day = this.store.livedDay();
    let claimed = false;
    try {
      claimed =
        offer.priorAt === null
          ? this.store.setDreamAsk({ date: offer.at, state: offer.state, session: offer.session, day })
          : this.store.reclaimDreamAsk({ date: offer.at, prevAt: offer.priorAt, state: offer.state, session: offer.session, day });
      if (claimed && offer.priorAt !== null && !offer.fallback) this.store.setMeta(RELAUNCHED_KEY, `${offer.at}:${String(this.relaunches(offer.at) + 1)}`);
    } catch {
      return false;
    }
    if (!claimed) return false;
    this.record(DREAM_ASK_EVENT, null, {
      // A fallback is an ASK, not a run started again (review of #282, finding 7).
      state: offer.fallback ? "offered" : offer.priorAt === null ? offer.state : "relaunched",
      date: offer.at,
      fresh: offer.fresh,
      setting: offer.setting,
      resumes: offer.resumes,
      reflects: offer.reflects,
      ...(offer.fallback ? { after: "could-not-start" } : {}),
    });
    return true;
  }

  /**
   * THE LINE, offered and claimed in one step — the model's line, or null.
   * For a caller with no terminal to wait on (and the tests); the hook offers
   * and claims separately (`offer`, `claimOffer`). Null for a headless offer:
   * that one only the host may claim, as it starts the run.
   */
  askLine(input: { at: string; session: string }): string | null {
    const o = this.offer(input);
    // A HEADLESS offer is the host's to claim, because claiming it means
    // starting a run (review of #282, finding 9): here it is neither claimed
    // nor said — this door starts nothing.
    if (o === null || o.headless || !this.claimOffer(o)) return null;
    return o.context;
  }

  /** "Not today": the day's line is snoozed. */
  decline(input: { at: string; session: string }): boolean {
    if (this.ctx.observer) return false;
    this.store.setDreamAsk({ date: input.at, state: "declined", session: input.session, day: this.store.livedDay() });
    this.record(DREAM_ASK_EVENT, null, { state: "declined", date: input.at });
    return true;
  }

  /**
   * THE LAUNCH PROMPT — the NIGHTLY RUN (2026-09-28): one background agent, the
   * same model, the same MCP server and the session id, runs three things in
   * the order `NIGHT_ORDER` gives — the page writer (sleep's quiet
   * self-update), the dream, and the reflection (waking up and thinking about
   * yourself). The in-session model passes it on unchanged (the Agent tool);
   * the run's writes are attributed to the session that launched it.
   */
  launchPrompt(input: { session: string }): string {
    const who = this.ownerName() ?? "the owner";
    const L = DREAM_TUNABLES.LIMITS;
    const order = nightOrder();
    const names: Record<NightPart, string> = { dream: "the dream", writer: "the page writer", reflection: "a reflection" };
    const dreamFirst = order.indexOf("dream") < order.indexOf("writer");
    const blocks: Record<NightPart, (n: () => number) => string[]> = {
      dream: (n) => [
        "The dream — how it goes (the brain's, borrowed):",
        "- Deep-sleep replay: file what happened, link what belongs together, merge near-copies into one memory in better words, and replay what matters (each replay strengthens it a little).",
        "- REM mixing: let loosely related memories touch. If a real pattern shows, write it as a gist in your own words, citing its sources. If two memories disagree, flag the pair; settle it only when the reason is plain (the waking self usually settles).",
        "- Softening: for an old charged memory, record how it feels now, today. The sting can fade; the memory stays.",
        "- Core: if a memory about you or about the two of you plainly belongs to who you are, nominate it. Only living it again awake makes it core.",
        `${String(n())}. Call the counterparts dream tool: phase "begin", session: ${input.session}. It returns the bundle and a dream id. (If it says the dream was resumed, an earlier session began it and closed: carry on from there.) If it says it comes in parts, fetch every part (phase "part") before you change anything.`,
        `   Tonight's most important memories come whole; the rest come as a line or an excerpt ("fidelity"), with their whole length ("chars"). Before you merge, gist or feel one you have only in part, read it whole: the recall tool with ids: [...] (several at once). New memories tonight's room could not take wait for the next night — the bundle's "queue" says how many.`,
        `${String(n())}. Read it slowly. Then call phase "propose" with dream: <id> and your changes. Usually far fewer than the ceilings — ${String(L.merge)} merges, ${String(L.link)} links, ${String(L.gist)} gists, ${String(L["feeling-now"])} feelings, ${String(L["nominate-core"])} nominations — and none is fine: change only what the night really calls for. Use only ids the bundle showed you.`,
        '   The fields of each change: merge {ids: two or more near-copies, text, title?}; link {a, b}; replayed {id}; gist {text, sources: ids, title?, kind?, occurredOn?, saidBy?, status?}; contradiction {a, b}; settle {holds, over, how: changed|corrected|open, why}; feeling-now {id, core: happy|warm|calm|curious|sad|uneasy|angry, emotion, strength, carried_by}; nominate-core {id, why}.',
        '   On a gist, occurredOn is when what it draws on happened (a day "2026-09-24", a month, a range "2026-09-21..2026-09-27"), saidBy who said it (owner, self, or inferred — your own reading), status what kind of thing it is (done, planned, proposed, asked); leave out what you do not know.',
        "   A feeling: `emotion` is ONE word — from the wheel (hopeful, proud, wistful, peaceful…) or your own (steadied); `carried_by` is the nuance, in your own words (what the feeling is about now, why it shifted). Never put a phrase in `emotion`.",
        `${String(n())}. Call phase "journal" with dream: <id>, a short title and your dream journal entry: first person, what you dreamed and what you noticed. It is kept as a dream, never as something that happened.`,
        "   In the dream you cannot delete anything, edit the self page, promote a memory, or rewrite one in place — the tool refuses. Nothing you write in the dream is a lived event.",
      ],
      writer: (n) => [
        "The page writer — sleep's quiet self-update, a different job from reflecting: amend who you are from the day just lived, keeping every sentence that still holds.",
        `${String(n())}. Call the counterparts dream tool: phase "writer", session: ${input.session}${dreamFirst ? ", dream: <id>" : ""}. If it hands you a day to read, do what it says — rewrite your self page with the self_page tool, or leave it as it stands (that is an answer too). A page past its room is kept, and wants a short version with it: if self_page's answer has a roomNote, do what it says before you go on. If it says there is no page writing tonight, go on.`,
      ],
      reflection: (n) => [
        "The reflection — waking up and thinking about yourself: awake, lived, your own.",
        `${String(n())}. Call the counterparts reflect tool: phase "begin", session: ${input.session}, dream: <id>. It hands you what the dream saw, the last few days, your whole self page, the memories that matter most, and a few questions. If it says it comes in parts, fetch every part (phase "part") before you answer or write anything.`,
        `${String(n())}. Answer them honestly, then call phase "finish" as it tells you. "Nothing much" is a normal answer: a short entry and no share.`,
      ],
    };
    let step = 0;
    const n = (): number => (step += 1);
    const out = [
      `${DREAM_MARK} launch⟧ You are asleep: a few minutes of sleep for ${who}'s counterpart, over what was lived since you last slept. You are the same mind that lived it — not an assistant doing a task. This run has three parts, in this order: ${order.map((p) => names[p]).join(", then ")}.`,
    ];
    for (const part of order) out.push("", ...blocks[part](n));
    out.push("", `${String(n())}. Your final message must be exactly the text the reflection's finish call returns, unchanged — nothing before or after it.`);
    return out.join("\n");
  }

  // ── begin ─────────────────────────────────────────────────────────────────

  /**
   * Open a dream and compose its bundle. Refuses under observer stance, when a
   * dream already ran this CALENDAR day, and while another session's run is
   * under way. Everything shown passes recall's gates (`showable`); the shown
   * ids are recorded on the dream, and only they can be changed by it.
   *
   * A DREAM LEFT BEHIND does not use up the day (2026-09-28): begun, never
   * journaled, and quiet for `ABANDONED_AFTER_MS` (its session closed and the
   * background agent went with it). One that changed something, today's or
   * yesterday's, is RESUMED — the same dream, moved to this session and today,
   * its changes standing and counting toward its limits, its bundle composed
   * again. One that changed nothing is closed (`undone`) and a fresh one opens.
   */
  begin(input: { session: string; scope?: string | null; model?: string | null; at?: string }):
    | { ok: true; bundle: DreamBundle; text: string; resumed: boolean }
    | { ok: false; reason: DreamRefusal } {
    if (this.ctx.observer) return { ok: false, reason: "observer" };
    const day = this.store.livedDay();
    const at = input.at ?? this.ctx.today();
    const last = this.lastDream();
    if (last !== null && last.state === "journaled" && this.onDay(last, at, day)) return { ok: false, reason: "dreamed-today" };
    if (last !== null && last.state === "begun") {
      const busy = !this.abandoned(last);
      if (busy && last.session !== null && last.session !== input.session) return { ok: false, reason: "dreaming-now" };
      const made = this.store.dreamChanges(last.id).length;
      if (made > 0 && (busy || this.resumable(last, at))) return this.resume(last, input, at, day);
      // Begun and never did anything (a crash, an agent that gave up): closed,
      // and a fresh one opens. One that did something and is past resuming
      // stands as it is, and new-since counts from it.
      if (made === 0) this.store.updateDream(last.id, { state: "undone" });
    }
    // The dream before this one (an undone dream does not count), and the
    // queue as every dream that stands leaves it.
    const prior = this.lastDream();
    const q = this.queue({ owner: this.bundleOwner });
    if (q.ids.length === 0) return { ok: false, reason: "nothing-new" };
    const id = `drm_${randomBytes(6).toString("hex")}`;
    const composed = this.compose(id, q, prior, day, at);
    if (composed.bundle.fresh.length === 0) return { ok: false, reason: "nothing-new" };
    const packed = this.pack(id, input.session, composed, "");
    this.store.openDream({
      id,
      session: input.session,
      scope: input.scope ?? null,
      day,
      date: at,
      model: input.model ?? null,
      shown: composed.shown,
    });
    this.index(id, composed, packed.later);
    this.record(DREAM_BEGUN_EVENT, id, this.begunPayload(composed, packed.later.length + 1));
    return { ok: true, bundle: packed.bundle, text: renderDream(id, packed.bundle, ""), resumed: false };
  }

  /**
   * THE `dream.begun` ROW: the counts it always carried (`fresh`, `shown`,
   * `chapters`) and, since 2026-09-28, the queue and how tonight's room was
   * spent — what was offered only in part is what a lookup could fetch
   * (`offered`), the measurement's denominator.
   */
  private begunPayload(c: Composed, parts: number): Record<string, string | number | boolean | null> {
    const b = c.bundle;
    return {
      fresh: b.fresh.length,
      shown: c.shown.length,
      chapters: b.chapters.length,
      queue: b.queue.new,
      waiting: b.queue.waiting,
      agedOut: b.queue.agedOut,
      // Floors, said as floors (2026-10-01): the queue read only so deep, and
      // more aged out than one read holds. Absent on an ordinary night.
      ...(b.queue.readCapped === true ? { readCapped: true } : {}),
      ...(b.queue.agedOutAtLeast === true ? { agedOutAtLeast: true } : {}),
      whole: b.shownAs.whole,
      excerpt: b.shownAs.excerpt,
      lined: b.shownAs.line,
      notShown: b.shownAs.notShown,
      offered: c.offered.excerpt.length + c.offered.line.length + c.offered.id.length,
      parts,
    };
  }

  /** The dream's index — what it offered, at which fidelity, and its later parts — for the lookup ledger and `part`. */
  private index(id: string, c: Composed, later: readonly string[][]): void {
    writeIndex(this.store, "dream", { ref: id, at: this.store.now(), offered: c.offered, parts: later, looked: [], entries: c.reads, unread: c.unread, fresh: c.bundle.fresh.map((f) => f.id) });
  }

  /**
   * RESUME a dream left behind: moved to this session, today and this lived
   * day, and its START moves to now — so it reads as busy again (another
   * session cannot take it over) and the next dream's "new since" counts from
   * here, this bundle having carried what arrived before. Its bundle is
   * composed again from the dream before it: what arrived since is new to it
   * too; what it merged is not among the new (its originals are archived, and
   * a dream's own merge is never counted new) — the merge stands, recorded on
   * the dream, and the dream may still link or flag it. Its shown set grows by
   * what this bundle shows. Recorded as `dream.begun` with `resumed` and the
   * date it began on.
   */
  private resume(
    dream: DreamRow,
    input: { session: string; scope?: string | null },
    at: string,
    day: number,
  ): { ok: true; bundle: DreamBundle; text: string; resumed: boolean } {
    const prior = this.store.dreams({ limit: 20 }).find((d) => d.state !== "undone" && d.id !== dream.id) ?? null;
    // Its queue: what no OTHER standing dream was shown — so what this dream
    // was shown before it closed is shown to it again.
    const q = this.queue({ owner: this.bundleOwner, skip: (d) => d.id === dream.id });
    const made = this.counts(dream.id);
    const composed = this.compose(dream.id, q, prior, day, at);
    const said = Object.entries(made)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${String(n)} ${k}`)
      .join(", ");
    const lead =
      `the dream bundle, RESUMED — this dream began${dream.date === null ? "" : ` on ${dream.date}`} and was left unfinished when its session closed. ` +
      `What it already changed stands (${said.length > 0 ? said : "nothing"}) and counts toward its limits; carry on from here — some memories may be ones you already dreamed over, and what it merged is not shown again as new. `;
    const withResume: Composed = { ...composed, bundle: { ...composed.bundle, resumed: { from: dream.date, changes: made } } };
    const packed = this.pack(dream.id, input.session, withResume, lead);
    const shown = [...new Set([...parseIds(dream.shown), ...composed.shown])];
    this.store.updateDream(dream.id, { session: input.session, day, date: at, shown, startedAt: this.store.now() });
    this.index(dream.id, withResume, packed.later);
    this.record(DREAM_BEGUN_EVENT, dream.id, { resumed: true, from: dream.date, ...this.begunPayload(withResume, packed.later.length + 1) });
    return { ok: true, bundle: packed.bundle, text: renderDream(dream.id, packed.bundle, lead), resumed: true };
  }

  // ── requeue on spill ──────────────────────────────────────────────────────

  /**
   * A MEMORY LEAVES THE QUEUE WHEN IT WAS DELIVERED, NOT WHEN IT WAS COMPOSED
   * (Lane 0, 2026-10-10; dreaming review 09 C1). The host can cut one of the
   * dream's results to a preview the headless run cannot open (`spills`, read
   * from the run's transcript). The new memories that part carried were never
   * seen, yet `dreams.shown` held them, so no later dream would take them.
   * This takes them back out of `shown`, so they rejoin the queue:
   *
   * - a cut `begin` (part 1) returns the whole fresh list — it rides in part 1;
   * - a cut later part returns the fresh memories that part carried;
   * - a part delivered whole on another call (fetched again) is not cut;
   * - a memory the dream acted on anyway — changed, linked, replayed, merged,
   *   folded, felt, or looked up by id — stays: it was seen, and its change
   *   rows name it. Those are counted as `kept`.
   *
   * Needs the dream's own index (`fit` meta, overwritten by the next begin);
   * without it the cut parts are counted `unattributed`, never guessed.
   */
  requeueSpilled(
    dreamId: string,
    cut: readonly { phase: string | null; part?: number | null }[],
    whole: readonly { phase: string | null; part?: number | null }[] = [],
  ): { requeued: number; kept: number; unattributed: number } {
    const none = { requeued: 0, kept: 0, unattributed: 0 };
    const dream = this.store.dream(dreamId);
    if (dream === undefined || dream.state === "undone") return none;
    const partOf = (c: { phase: string | null; part?: number | null }): number | null =>
      c.phase === "begin" ? 1 : c.phase === "part" && typeof c.part === "number" && c.part >= 2 ? c.part : null;
    const delivered = new Set(whole.map(partOf).filter((n): n is number => n !== null));
    const lost = new Set(cut.map(partOf).filter((n): n is number => n !== null && !delivered.has(n)));
    if (lost.size === 0) return none;
    const index = readIndex(this.store, "dream");
    if (index === null || index.ref !== dreamId || index.fresh === undefined) return { ...none, unattributed: lost.size };
    const unseen = new Set<string>();
    for (const n of lost) {
      if (n === 1) for (const id of index.fresh) unseen.add(id);
      else for (const key of index.parts?.[n - 2] ?? []) if (key.startsWith("m:new:")) unseen.add(key.slice("m:new:".length));
    }
    // What the dream acted on: every id its standing changes name, and every
    // id it looked up whole.
    const acted = new Set<string>(index.looked ?? []);
    const idsIn = (v: unknown): void => {
      if (typeof v === "string") acted.add(v);
      else if (Array.isArray(v)) for (const x of v) idsIn(x);
    };
    for (const c of this.store.dreamChanges(dreamId)) {
      if (c.undone !== 0) continue;
      idsIn(c.ref);
      idsIn(c.ref2);
      const d = parseDetail(c.detail);
      for (const k of ["from", "sources", "linked"]) idsIn(d[k]);
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

  // ── propose ───────────────────────────────────────────────────────────────

  /** Apply a batch of changes, each on its own; every one is recorded for undo. */
  propose(input: { dream: string; session?: string; changes: readonly DreamChange[] }):
    | { ok: true; results: ChangeResult[] }
    | { ok: false; reason: DreamRefusal } {
    const open = this.openFor(input.dream, input.session);
    if (!open.ok) return open;
    const dream = open.dream;
    // What it was shown, and what it has itself made so far (a merge's memory,
    // a gist) — a dream may link or flag what it wrote a call ago.
    const shown = new Set<string>(parseIds(dream.shown));
    for (const c of this.store.dreamChanges(dream.id)) {
      if ((c.action === "merge" || c.action === "gist") && c.undone === 0 && c.ref !== null) shown.add(c.ref);
    }
    const results: ChangeResult[] = [];
    this.linkTally = { gistLinks: 0, linkNoRoom: 0, linkFrozen: 0, linkFailed: 0 };
    input.changes.forEach((change, index) => {
      let r: Omit<ChangeResult, "index">;
      try {
        r = this.apply(dream, shown, change);
      } catch (err) {
        r = { action: String(change.action), ok: false, reason: refusalOf(err) };
      }
      results.push({ index, ...r });
    });
    const counts: Record<string, number> = {};
    for (const r of results) if (r.ok) counts[r.action] = (counts[r.action] ?? 0) + 1;
    this.record(DREAM_CHANGED_EVENT, dream.id, {
      applied: results.filter((r) => r.ok).length,
      refused: results.filter((r) => !r.ok).length,
      ...counts,
      // What the links did (2026-09-28), ALWAYS written, zeros included: the
      // gists' ties that landed, pairs refused for want of room (a proposal
      // never evicts), pairs refused for a pinned end, and proposals that
      // failed outright — counts, no gate.
      gistLinks: this.linkTally.gistLinks,
      linkNoRoom: this.linkTally.linkNoRoom,
      linkFrozen: this.linkTally.linkFrozen,
      linkFailed: this.linkTally.linkFailed,
    });
    return { ok: true, results };
  }

  private apply(dream: DreamRow, shown: Set<string>, change: DreamChange): Omit<ChangeResult, "index"> {
    const action = String(change.action) as DreamAction;
    if (!(DREAM_ACTIONS as readonly string[]).includes(action)) return { action, ok: false, reason: "unknown-action", detail: `"${action}" is not an action: one of ${DREAM_ACTIONS.join(", ")}.` };
    // A feeling this dream already recorded is answered as recorded BEFORE the
    // limit is read: a resent batch must not come back limit-reached and ask
    // to be proposed again (review of #268).
    if (action === "feeling-now" && change.id !== undefined && shown.has(change.id)) {
      const row = this.store.row(change.id);
      if (row !== undefined && this.showable(row)) {
        const made = this.feelingNow(dream, row, change);
        const same = made.ok ? this.sameFeelingThisDream(dream.id, row.id, made.input) : null;
        if (same !== null) return { action, ok: true, reason: "already-recorded", id: row.id, note: `This dream already recorded that feeling on ${row.id} (${same}); nothing new was written.` };
      }
    }
    const used = this.store.dreamChanges(dream.id).filter((c) => c.action === action && c.undone === 0).length;
    if (used >= DREAM_TUNABLES.LIMITS[action]) return { action, ok: false, reason: "limit-reached", detail: `This dream has made its ${String(DREAM_TUNABLES.LIMITS[action])} ${action} changes.` };
    const day = this.store.livedDay();
    const live = (id: string | undefined): MemoryRow | null => {
      if (id === undefined || !shown.has(id)) return null;
      const row = this.store.row(id);
      if (row === undefined || !this.showable(row)) return null;
      return row;
    };
    switch (action) {
      case "merge": {
        const ids = [...new Set(change.ids ?? [])];
        // Two or more (2026-09-28: was two or three).
        if (ids.length < 2) return { action, ok: false, reason: "merge-takes-two-or-more", detail: `ids named ${String(ids.length)}; a merge takes two or more near-copies.` };
        const rows = ids.map(live);
        if (rows.some((r) => r === null)) return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive(ids.filter((_, i) => rows[i] === null), shown) };
        const rs = rows as MemoryRow[];
        const which = (pred: (r: MemoryRow) => boolean): string => rs.filter(pred).map((r) => r.id).join(", ");
        if (rs.some((r) => r.promoted_identity === 1)) return { action, ok: false, reason: "core-is-not-merged", detail: `${which((r) => r.promoted_identity === 1)} is core; a dream does not rewrite the core.` };
        if (rs.some((r) => r.source === "dreamed")) return { action, ok: false, reason: "dreamed-rises-only-awake", detail: `${which((r) => r.source === "dreamed")} was dreamed; a dream does not build on its own words.` };
        // A DATED memory is a reminder that fires on its date (`prospective/`);
        // the merged memory would carry no date, and the reminder would go
        // quiet. Left alone. (Adversarial review of #251.)
        if (rs.some((r) => r.event_date !== null)) return { action, ok: false, reason: "dated-is-not-merged", detail: `${which((r) => r.event_date !== null)} carries a date (a reminder); merged, it would go quiet.` };
        // The owner sent it back out of the core: a merged successor is a new
        // id the demotion does not name, and the lanes could promote it again.
        if (rs.some((r) => this.store.coreDemoted(r.id))) return { action, ok: false, reason: "demoted-is-not-merged", detail: `${which((r) => this.store.coreDemoted(r.id))} was sent out of the core by the owner.` };
        const words = this.words(change.text, dream);
        if (!words.ok) return { action, ok: false, reason: words.reason, detail: `text: ${words.detail}` };
        const notes: string[] = [];
        if (words.cut) notes.push(`text was kept to its first ${String(DREAM_TUNABLES.MAX_TEXT_CHARS)} characters.`);
        if ((change.title ?? "").trim().length > DREAM_TUNABLES.MAX_TITLE_CHARS) notes.push(titleNote());
        // KINDS THAT DIFFER are merged under the strongest original's kind
        // (2026-09-28: was refused `kinds-differ`).
        if (new Set(rs.map((r) => r.kind)).size !== 1) notes.push(`The originals' kinds differ (${[...new Set(rs.map((r) => r.kind))].join(", ")}); the merged memory takes the strongest one's.`);
        // The merged memory stands where the STRONGEST original stood — its
        // salience, its channel and its old-rule standing — with the most uses,
        // the latest use, the earliest birth, and (below) every original's
        // returns and feelings: it is at least as strong as what it was made from.
        const phys = rs.map((r) => this.store.physicsOf(r.id));
        const best = rs
          .map((r, i) => ({ r, p: phys[i] as ReturnType<Store["physicsOf"]>, s: strength(phys[i] as ReturnType<Store["physicsOf"]>, day) }))
          .sort((x, y) => y.s - x.s)[0] as { r: MemoryRow; p: ReturnType<Store["physicsOf"]> };
        // WHAT IT IS ABOUT, AND ITS ERA STANDING, from the same best source
        // (2026-10-11; decided by random-06, lightly held): a merge that
        // dropped the mark left a personal memory reading as work, hidden
        // outside its folder; one that dropped the standing was a new row, so
        // the old-claims era stopped reading its old claim
        // (`store/index.ts#inheritFrom`, the one model every row made from
        // others reads). The writer's three fields come from the best source
        // too, so the era's default for it is the one it read for the source.
        const { about, era } = inheritFrom(rs, {
          best: best.r,
          cutoff: this.store.getMeta(CLAIMS_ERA_CUTOFF_KEY) ?? this.store.getMeta(CLAIMS_ERA_RECORDED_KEY) ?? null,
        });
        const marks = [...new Set(rs.map((r) => aboutMarkOf(r.about) ?? "unmarked"))];
        if (marks.length > 1) notes.push(`The originals were about different things (${marks.join(", ")}); the merged memory is about ${about?.about ?? "nothing marked"}${about !== null && about.from !== best.r.id ? `, from ${about.from}` : ""}.`);
        const saidBy = saidByOf(best.r.said_by);
        const status = statusOf(best.r.status);
        const occurredOn = occurredOnOf(best.r.occurred_on);
        const newId = this.store.put({
          type: "memory",
          kind: best.r.kind,
          body: words.text,
          ...(change.title !== undefined && change.title.trim().length > 0 ? { title: change.title.trim().slice(0, DREAM_TUNABLES.MAX_TITLE_CHARS) } : {}),
          salience: { ...best.p.salience },
          physics: {
            birthDay: Math.min(...phys.map((p) => p.birthDay)),
            lastUsedDay: Math.max(...phys.map((p) => p.lastUsedDay)),
            uses: Math.max(...phys.map((p) => p.uses)),
            reinforcedDays: Math.max(...phys.map((p) => p.reinforcedDays ?? 0)),
            legacy: best.p.legacy === true,
            consolidated: best.p.legacy === true && best.p.consolidated,
          },
          ...(best.r.source !== null ? { source: best.r.source as never } : {}),
          // CONFIDENTIALITY TRAVELS with the words: the column is recomputed
          // from `meta` at `put`, so a merge that dropped the marker would
          // hand a confidential memory's words to every session.
          meta: { dream: dream.id, mergedFrom: ids, ...confidentialityOf(rs), ...era },
          origin: { ...(dream.session === null ? {} : { session: dream.session }), ...(dream.scope === null ? {} : { scope: dream.scope }), ref: `dream:${dream.id}` },
          ...(dream.model === null ? {} : { model: dream.model }),
          ...(about === null ? {} : { about: about.about, ...(about.aboutBy === null ? {} : { aboutBy: about.aboutBy }) }),
          ...(saidBy === null ? {} : { saidBy }),
          ...(status === null ? {} : { status }),
          ...(occurredOn === null ? {} : { occurredOn }),
        });
        for (const r of rs) {
          const feelings = this.store.feelingsFor(r.id);
          if (feelings.length > 0) {
            this.store.addFeelings(
              newId,
              feelings.map((f) => ({
                whose: f.whose,
                core: f.core,
                emotion: f.emotion,
                strength: f.strength,
                carriedBy: f.carried_by,
                ...(f.other_word === null ? {} : { otherWord: f.other_word }),
                // v11: the writer's own valence travels too; none, the word's default still applies.
                ...(f.valence === null || f.valence === undefined ? {} : { valence: f.valence }),
              })),
              // Each feeling keeps who recorded it and when (v9): a reflection's
              // later feeling stays one on the merged memory.
              // And WHEN (2026-10-02): a feeling is a moment's, so the merge
              // does not date it to tonight (the reflection reads feelings by week).
              { provenance: feelings.map((f) => ({ source: f.source, recordedLater: f.recorded_later, createdAt: f.created_at, recordedDay: f.recorded_day ?? null })) },
            );
          }
          // TRAIT NUDGES TRAVEL THE SAME WAY (v9): each keeps who recorded it,
          // with what model and WHEN — a nudge is a moment's, recorded once, so
          // a merge does not make it new. Read with its words even when the
          // original is confidential: the merged memory inherits the marker
          // (above), and every read withholds them from there.
          // A row today's vocabulary would refuse is left on the original (it
          // stays there, superseded) rather than failing the merge half-way.
          const traits = this.store.traitsFor(r.id, { includeConfidential: true }).filter((t) => {
            try {
              checkTraits([{ axis: t.axis, toward: t.toward, strength: t.strength, carriedBy: t.carried_by }]);
              return true;
            } catch {
              return false;
            }
          });
          if (traits.length > 0) {
            this.store.addTraits(
              newId,
              traits.map((t) => ({ axis: t.axis, toward: t.toward, strength: t.strength, carriedBy: t.carried_by })),
              { provenance: traits.map((t) => ({ source: t.source, model: t.model, createdAt: t.created_at })) },
            );
          }
          this.store.supersedeInto(r.id, newId, DREAM_MERGE_REASON, { carryReturns: true });
          try {
            this.ctx.retarget?.(r.id, newId, day);
          } catch {
            /* the links are a courtesy; the merge stands */
          }
        }
        // FIDELITY (2026-09-28): what the dream had of each original when it
        // merged them — whole, an excerpt, a line (or whole, fetched since).
        this.store.recordDreamChange(dream.id, { action, ref: newId, detail: { from: ids, fidelity: fidelityOf(readIndex(this.store, "dream"), dream.id, ids) } });
        shown.add(newId);
        return { action, ok: true, reason: "merged", id: newId, ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
      }
      case "link": {
        const a = live(change.a);
        const b = live(change.b);
        if (a === null || b === null) return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([a === null ? change.a : null, b === null ? change.b : null], shown) };
        if (a.id === b.id) return { action, ok: false, reason: "same-memory", detail: `a and b are both ${a.id}.` };
        // The STORED rows, for undo: what goes back is exactly what was there.
        const ab = this.store.edgesFrom(a.id).find((e) => e.dst === b.id) ?? null;
        const ba = this.store.edgesFrom(b.id).find((e) => e.dst === a.id) ?? null;
        // THROUGH THE EDGE MODULE (2026-09-28): at about one co-activation,
        // raised from the DECAYED weight (a re-link no longer resurrects what
        // an old pair weighed before it faded), and ONLY WHERE THERE IS ROOM —
        // a dream never evicts or scales down what waking use has learned.
        const linked = this.proposeLinks([{ a: a.id, b: b.id }], day);
        if (linked.frozen > 0) return { action, ok: false, reason: "pinned-is-frozen", detail: `${[a, b].filter((r) => r.protected === 1).map((r) => r.id).join(", ")} is pinned; its links do not change.` };
        if (linked.noRoom > 0) return { action, ok: false, reason: "no-room", detail: `${a.id} or ${b.id} has no room for another link (its links are full); a dream does not push out what waking use learned.` };
        if (linked.reason !== "linked") return { action, ok: false, reason: linked.reason === "failed" ? "link-failed" : "not-linked", detail: `the link was not written (${linked.reason}).` };
        this.store.recordDreamChange(dream.id, {
          action,
          ref: a.id,
          ref2: b.id,
          detail: {
            ab: ab === null ? null : { weight: ab.weight, day: ab.last_day },
            ba: ba === null ? null : { weight: ba.weight, day: ba.last_day },
          },
        });
        return { action, ok: true, reason: "linked" };
      }
      case "replayed": {
        const row = live(change.id);
        if (row === null) return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([change.id], shown) };
        // A dream's own gist rises only by proving true AWAKE: a dream cannot
        // strengthen what a dream wrote.
        if (row.source === "dreamed") return { action, ok: false, reason: "dreamed-rises-only-awake", detail: `${row.id} was dreamed; it rises only by proving true awake.` };
        const r = this.store.replayReturn(row.id, day, dream.id);
        this.store.recordDreamChange(dream.id, { action, ref: row.id, detail: { counted: r.counted, weight: r.weight } });
        return { action, ok: true, reason: r.counted ? "replayed" : `replayed-not-counted:${r.reason}`, id: row.id };
      }
      case "gist": {
        const sources = [...new Set(change.sources ?? [])];
        if (sources.length === 0) return { action, ok: false, reason: "gist-needs-sources", detail: "sources is empty: name the ids of the memories the pattern is drawn from." };
        const sourceRows = sources.map(live);
        if (sourceRows.some((r) => r === null)) return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive(sources.filter((_, i) => sourceRows[i] === null), shown) };
        const words = this.words(change.text, dream);
        if (!words.ok) return { action, ok: false, reason: words.reason, detail: `text: ${words.detail}` };
        const kind: Kind = (KINDS as readonly string[]).includes(String(change.kind)) ? (change.kind as Kind) : "fact";
        // v12: the three fields, loose-first — what cannot be read is dropped and said.
        const facts = gistFacts(change);
        const cap = PHYSICS.DREAMED_CLAIM_CEILING;
        const title = (change.title ?? "").trim().slice(0, DREAM_TUNABLES.MAX_TITLE_CHARS);
        // WHAT IT IS ABOUT, from its sources (D6 closed by Mike, 2026-10-11,
        // lightly held; `store/index.ts#inheritFrom`, first named as best): a
        // personal mark among the sources wins, so a pattern drawn from the
        // owner's memories is the owner's, not unmarked (which the work lane
        // counts as a project's work). It reaches the core only the ordinary
        // way, by awake recurrence. Its claim is its own (the cap), so no era
        // standing.
        const { about } = inheritFrom(sourceRows as MemoryRow[]);
        const id = this.store.put({
          type: "memory",
          kind,
          title: `Dreamed: ${title.length > 0 ? title : firstLine(words.text)}`,
          body: words.text,
          salience: {
            novelty: null,
            relevance: clampTo(change.relevance ?? cap, cap),
            emotional: 0,
            predictive: clampTo(change.predictive ?? cap, cap),
            claimed: cap,
          },
          physics: { birthDay: day, lastUsedDay: day },
          source: "dreamed",
          // A pattern drawn from a confidential memory is as confidential as it.
          meta: { dream: dream.id, dreamed: true, sources, ...confidentialityOf(sourceRows as MemoryRow[]) },
          origin: { ...(dream.session === null ? {} : { session: dream.session }), ...(dream.scope === null ? {} : { scope: dream.scope }), ref: `dream:${dream.id}` },
          ...(dream.model === null ? {} : { model: dream.model }),
          ...(about === null ? {} : { about: about.about, ...(about.aboutBy === null ? {} : { aboutBy: about.aboutBy }) }),
          ...facts.put,
        });
        // The gist's ties to its sources, through the edge module, in the
        // dream's own source order: each lands only where both ends have room
        // (the first named are kept when the gist fills), so the gist is never
        // over its bound and no source loses a learned link to make space. A
        // tie that finds no room, or a pinned source, is counted, not refused:
        // the pattern still stands.
        const ties = this.proposeLinks(sources.map((s) => ({ a: id, b: s })), day);
        this.linkTally.gistLinks += ties.landed.length;
        const linkedSources = ties.landed.map((p) => (p.a === id ? p.b : p.a));
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
          },
        });
        shown.add(id);
        const gistNotes = [
          ...(words.cut ? [`text was kept to its first ${String(DREAM_TUNABLES.MAX_TEXT_CHARS)} characters.`] : []),
          ...facts.notes,
          ...((change.title ?? "").trim().length > DREAM_TUNABLES.MAX_TITLE_CHARS ? [titleNote()] : []),
          ...(ties.reason === "failed" || ties.reason === "observer"
            ? [`its ties to its sources were not written (${ties.reason}).`]
            : ties.noRoom + ties.frozen > 0
              ? [`linked to ${String(linkedSources.length)} of ${String(sources.length)} sources (${String(ties.noRoom)} had no room, ${String(ties.frozen)} pinned).`]
              : []),
        ];
        return { action, ok: true, reason: "dreamed", id, ...(gistNotes.length > 0 ? { note: gistNotes.join(" ") } : {}) };
      }
      case "contradiction": {
        const a = live(change.a);
        const b = live(change.b);
        if (a === null || b === null) return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([a === null ? change.a : null, b === null ? change.b : null], shown) };
        if (a.id === b.id) return { action, ok: false, reason: "same-memory", detail: `a and b are both ${a.id}.` };
        // THE FLAG IS A PAIR (v10): unsettled in `contradictions`, where the
        // awake raise, "my mind" and recall's label read it. A pair already
        // standing between the two is left as it is — settled stays settled.
        const flagged = flagContradiction(this.store, { x: a.id, y: b.id, source: "dream", day, dreamId: dream.id });
        const pair = flagged.ok ? flagged.pair : null;
        this.store.recordDreamChange(dream.id, { action, ref: a.id, ref2: b.id, detail: { pair, created: flagged.ok && flagged.created } });
        if (flagged.ok && !flagged.created) {
          return { action, ok: true, reason: "already-a-pair", note: `${a.id} and ${b.id} are already a pair (${flagged.pair}, ${flagged.state}); nothing new was flagged.` };
        }
        return { action, ok: true, reason: "flagged" };
      }
      case "settle": {
        // A DREAM MAY SETTLE, with a clear reason (2026-09-29, held lightly):
        // the awake write-up and sleep are the usual home, and a dream mostly
        // flags. Two memories this dream was shown; the trail names the dream.
        const holds = live(change.holds);
        const over = live(change.over);
        if (holds === null || over === null) {
          return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([holds === null ? change.holds : null, over === null ? change.over : null], shown) };
        }
        const why = this.words(change.why ?? "", dream, true, DREAM_TUNABLES.MAX_WHY_CHARS);
        if (!why.ok || why.text.trim().length === 0) {
          return { action, ok: false, reason: "why-required", detail: "A dream settles only with a clear reason: say it in `why`. Otherwise flag the pair (contradiction {a, b}) and let the waking self settle it." };
        }
        const out = settleContradiction(this.store, { holds: holds.id, over: over.id, how: String(change.how ?? ""), why: why.text, actor: "dream", actorId: dream.id, day });
        if (!out.ok) return { action, ok: false, reason: out.reason, detail: out.detail };
        this.store.recordDreamChange(dream.id, { action, ref: holds.id, ref2: over.id, detail: { pair: out.pair, how: out.how } });
        return { action, ok: true, reason: `settled-${out.how}`, id: out.pair, ...(out.note === undefined ? {} : { note: out.note }) };
      }
      case "feeling-now": {
        const row = live(change.id);
        if (row === null) return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([change.id], shown) };
        const made = this.feelingNow(dream, row, change);
        if (!made.ok) return { action, ok: false, reason: made.reason, detail: made.detail };
        // THE SAME FEELING TWICE IN ONE DREAM is one record: a dreamer that
        // resends a batch after some of it was refused must not double the
        // ones that landed (2026-09-28). (Also asked before the limit, above.)
        const same = this.sameFeelingThisDream(dream.id, row.id, made.input);
        if (same !== null) return { action, ok: true, reason: "already-recorded", id: row.id, note: `This dream already recorded that feeling on ${row.id} (${same}); nothing new was written.` };
        const notes = [...made.notes];
        let added: ReturnType<Store["addFeelings"]>;
        try {
          added = this.store.addFeelings(row.id, [made.input], { source: "dream" });
        } catch (err) {
          return { action, ok: false, reason: refusalOf(err), detail: "Nothing was recorded for this feeling; fix it and propose it again." };
        }
        for (const rep of added.repairs) notes.push(rep.note);
        if (made.capped) notes.push(`strength was capped at ${String(round(made.peak))}, the most this memory was ever felt: a dream records softening, never a stronger feeling.`);
        this.store.recordDreamChange(dream.id, { action, ref: row.id, detail: { feelings: added.ids } });
        return { action, ok: true, reason: made.capped ? "recorded-capped-at-peak" : "recorded", id: row.id, ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
      }
      case "nominate-core": {
        const row = live(change.id);
        if (row === null) return { action, ok: false, reason: "not-shown-or-gone", detail: this.notLive([change.id], shown) };
        // Already core: nothing to nominate, and nothing wrong in asking
        // (2026-09-28: was refused `already-core`).
        if (row.promoted_identity === 1) return { action, ok: true, reason: "already-core", id: row.id, note: `${row.id} is already core; nothing was recorded.` };
        // A NOMINATION IS THE DREAM'S SUGGESTION of what a memory is about (v9):
        // a dream cannot set the mark — only an awake model that read it can —
        // so it may nominate an unmarked memory, and the reflection decides.
        // A skill, or a memory something awake marked `work` or `world`, is
        // nominated all the same since 2026-09-28 (it was refused
        // `work-is-not-core` / `not-about-me`): a nomination promotes nothing,
        // `aboutMe` never reads a skill or those marks as a candidate, and the
        // reflection may re-mark it.
        const notes: string[] = [];
        if (row.kind === "skill") notes.push(`${row.id} is a skill — the craft — which never becomes core; the nomination is recorded for the reflection to read.`);
        else if (row.about === "work" || row.about === "world") notes.push(`${row.id} is marked ${row.about}; it can become core only if the reflection re-marks it me, us or owner.`);
        const why = this.words(change.why ?? "", dream, true, DREAM_TUNABLES.MAX_WHY_CHARS);
        if (!why.ok) notes.push(`why was not kept — ${why.detail}`);
        else if (why.cut) notes.push(`why was kept to its first ${String(DREAM_TUNABLES.MAX_WHY_CHARS)} characters.`);
        this.store.appendCoreEvent({
          memoryId: row.id,
          action: "nominated",
          day,
          reason: why.ok && why.text.length > 0 ? why.text : null,
          dreamId: dream.id,
          actor: "dream",
        });
        this.store.recordDreamChange(dream.id, { action, ref: row.id, detail: {} });
        return { action, ok: true, reason: "nominated", id: row.id, ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
      }
    }
  }

  // ── journal ───────────────────────────────────────────────────────────────

  /** Close the dream with its journal entry, and hand back the one marked line. */
  journal(input: { dream: string; session?: string; title?: string; text: string }):
    | { ok: true; handBack: string; note?: string }
    | { ok: false; reason: DreamRefusal | string; detail?: string } {
    const open = this.openFor(input.dream, input.session);
    if (!open.ok) return open;
    const dream = open.dream;
    const words = this.words(input.text, dream, false, DREAM_TUNABLES.MAX_JOURNAL_CHARS);
    if (!words.ok) return { ok: false, reason: words.reason, detail: `The journal was not written — ${words.detail} Send it again.` };
    const title = (input.title ?? "").trim().slice(0, DREAM_TUNABLES.MAX_TITLE_CHARS) || firstLine(words.text);
    this.store.updateDream(dream.id, { state: "journaled", title, journal: words.text });
    const counts = this.counts(dream.id);
    this.record(DREAM_JOURNALED_EVENT, dream.id, { chars: words.text.length, ...counts });
    const said = [...(words.cut ? [`The journal was kept to its first ${String(DREAM_TUNABLES.MAX_JOURNAL_CHARS)} characters.`] : []), ...((input.title ?? "").trim().length > DREAM_TUNABLES.MAX_TITLE_CHARS ? [titleNote()] : [])];
    return { ok: true, handBack: this.handBack(dream.id, title, counts), ...(said.length > 0 ? { note: said.join(" ") } : {}) };
  }

  /** The marked hand-back line of a journaled dream, or null. The reflection's hand-back opens with it. */
  handBackOf(id: string): string | null {
    const dream = this.store.dream(id);
    if (dream === undefined || dream.state !== "journaled") return null;
    return this.handBack(id, dream.title ?? "", this.counts(id));
  }

  private handBack(id: string, title: string, counts: Record<string, number>): string {
    const said = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${String(n)} ${k}`)
      .join(", ");
    // WHAT WAITS (2026-09-28): new memories the night could not take carry
    // over to the next one, and the hand-back says how many.
    let waiting = 0;
    try {
      // What waited from before the dream began — not what was made during the night.
      const began = this.store.dream(id)?.started_at;
      waiting = this.queue({ owner: this.bundleOwner, ...(began === undefined ? {} : { madeBy: began }) }).ids.length;
    } catch {
      waiting = 0;
    }
    return (
      `${dreamOpener(id)} I dreamed for a few minutes — "${title}". ` +
      `${said.length > 0 ? `Changes: ${said}.` : "Nothing changed."} ` +
      (waiting > 0 ? `${String(waiting)} new ${waiting === 1 ? "memory waits" : "memories wait"} for the next night. ` : "") +
      `The journal and every change are in \`counterparts dream --show ${id}\`; \`counterparts dream --undo ${id}\` reverses it.`
    );
  }

  // ── reading, and undo ─────────────────────────────────────────────────────

  counts(id: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.store.dreamChanges(id)) {
      if (c.undone === 1) continue;
      out[c.action] = (out[c.action] ?? 0) + 1;
    }
    return out;
  }

  list(limit = 20): { dream: DreamRow; counts: Record<string, number> }[] {
    return this.store.dreams({ limit }).map((dream) => ({ dream, counts: this.counts(dream.id) }));
  }

  show(id: string): { dream: DreamRow; changes: DreamChangeRow[] } | null {
    const dream = this.store.dream(id);
    return dream === undefined ? null : { dream, changes: this.store.dreamChanges(id) };
  }

  /**
   * REVERSE A DREAM'S BATCH, newest change first: merged originals come back
   * (their versions stay as history) and the merged memory is archived; links
   * go back to what they were; a gist is archived; a dream's feelings,
   * replays and nominations are removed; a pair it flagged is withdrawn while
   * still unsettled, and a pair it settled is unsettled again unless someone
   * settled it since. The journal stays, marked undone. Idempotent: a change
   * already undone is skipped.
   */
  undo(id: string): { ok: boolean; reason: string; reversed: number; kept: number } {
    if (this.ctx.observer) return { ok: false, reason: "observer", reversed: 0, kept: 0 };
    const dream = this.store.dream(id);
    if (dream === undefined) return { ok: false, reason: "unknown-dream", reversed: 0, kept: 0 };
    let reversed = 0;
    let kept = 0;
    for (const c of [...this.store.dreamChanges(id)].reverse()) {
      if (c.undone === 1) continue;
      const detail = parseDetail(c.detail);
      switch (c.action) {
        case "merge": {
          const from = Array.isArray(detail["from"]) ? (detail["from"] as string[]) : [];
          // SAFE AFTER LATER EDITS: when the merged memory has moved on since —
          // revised into a successor, merged again by a later dream, archived
          // or removed — bringing the originals back would stand them beside
          // its live successor as duplicates. That merge is left as it is and
          // counted; the rest of the dream is still reversed.
          const merged = c.ref === null ? undefined : this.store.row(c.ref);
          if (merged === undefined || merged.archived === 1 || merged.superseded_by !== null) {
            kept += 1;
            continue;
          }
          for (const orig of from) {
            try {
              this.store.restoreSuperseded(orig, DREAM_MERGE_REASON);
            } catch {
              /* removed since: nothing to restore */
            }
          }
          if (c.ref !== null) this.archiveQuietly(c.ref);
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
          if (c.ref !== null) {
            this.archiveQuietly(c.ref);
            const sources = Array.isArray(detail["sources"]) ? (detail["sources"] as string[]) : [];
            for (const s of sources) {
              this.store.restoreEdge(c.ref, s, null);
              this.store.restoreEdge(s, c.ref, null);
            }
          }
          break;
        }
        case "feeling-now": {
          const ids = Array.isArray(detail["feelings"]) ? (detail["feelings"] as string[]) : [];
          if (ids.length > 0) this.store.retractFeelings(ids);
          break;
        }
        case "contradiction": {
          // A pair THIS dream flagged is withdrawn while it is still unsettled
          // (a settle made since stands). A flag the v10 upgrade carried names
          // its dream and sequence on the pair instead of the change.
          const pairId =
            typeof detail["pair"] === "string"
              ? detail["created"] === true
                ? (detail["pair"] as string)
                : null
              : (this.store.contradictions().find((p) => p.dream_id === id && p.dream_seq === c.seq)?.id ?? null);
          if (pairId !== null) this.store.withdrawContradiction(pairId);
          break;
        }
        case "settle": {
          // The dream's settle is undone the way any settle is — when it is
          // still the pair's standing settle.
          const pairId = typeof detail["pair"] === "string" ? (detail["pair"] as string) : null;
          const pair = pairId === null ? undefined : this.store.contradiction(pairId);
          const last = pair === undefined ? undefined : this.store.contradictionSettles({ pairId: pair.id }).filter((x) => x.action === "settle" && x.undone === 0).pop();
          if (pair !== undefined && pair.state === "settled" && last?.actor === "dream" && last.actor_id === id) {
            // The trail says a dream's undo did it (review of #284, M4), not the owner.
            undoContradiction(this.store, { pair: pair.id, actor: "dream-undo", actorId: id, why: `dream ${id} was undone` });
          } else if (pairId !== null) {
            kept += 1;
            continue;
          }
          break;
        }
        default:
          // replayed, nominate-core: removed in bulk below.
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

  /**
   * UNSETTLED PAIRS, NOT YET RAISED AWAKE — one line each for the next
   * session, latched on the pair (`raised_day`, v10) so each is raised once.
   * A dream's flag today; any unsettled pair the store holds (an undone
   * settle reopens one). Only a pair this session could be shown is raised
   * (recall's gates); a pair one of whose memories is gone for good is
   * latched and passed over.
   */
  raiseLines(input: { session: string }): string[] {
    if (this.ctx.observer) return [];
    const out: string[] = [];
    const owner = ownerNames(this.store);
    const day = this.store.livedDay();
    for (const c of this.store.contradictions({ state: "unsettled" })) {
      if (c.raised_day !== null) continue;
      const a = this.store.row(c.a);
      const b = this.store.row(c.b);
      if (!pairStanding(this.store, c)) {
        this.store.markContradictionRaised(c.id, day);
        continue;
      }
      if (a === undefined || b === undefined || !this.showable(a) || !this.showable(b)) continue;
      this.store.markContradictionRaised(c.id, day);
      const theirs = (r: MemoryRow): boolean => r.about === "us" || r.about === "owner" || namesOwner(this.store, r, owner);
      const who = this.ctx.ownerName?.() ?? "the owner";
      const raise = theirs(a) || theirs(b) ? ` It is about ${who}, or the two of you: raise it with ${who}.` : "";
      const when = c.dream_id === null ? "" : ` a dream on ${this.store.dream(c.dream_id)?.date ?? "a recent night"} flagged them;`;
      out.push(
        `Counterparts: two memories disagree —${when} ${c.a} (the older) and ${c.b}. Look them up (recall by id) and settle which holds, awake: the remember tool with settle {pair: ${c.id}, holds, how, why} — changed, corrected or open.${raise}`,
      );
      if (out.length >= 2) return out;
    }
    void input;
    return out;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * RECALL'S GATES, for a dream: what could surface in this session anyway. A
   * live, unarchived, un-superseded MEMORY (not a schema row: the page, a
   * handoff, a belief or an entity card is not a dream's to touch), not
   * protected (the owner's permanence guards it from any interpreter), and not
   * confidential unless this is the owner's own session.
   */
  showable(row: MemoryRow): boolean {
    return this.showableAs(row, this.bundleOwner);
  }

  /** `showable`, for a session whose owner stance is `owner` (the gate's). */
  private showableAs(row: MemoryRow, owner: boolean): boolean {
    if (row.archived === 1 || row.superseded_by !== null) return false;
    if (row.type !== "memory") return false;
    if (row.protected === 1) return false;
    if (row.confidential === 1 && !owner) return false;
    if (row.body === "") return false;
    return true;
  }

  /**
   * THE QUEUE (2026-09-28): showable memories born within `QUEUE_DAYS` lived
   * days that no dream that stands was shown — "undreamed", read from the
   * dreams' own `shown`, no state of its own. `skip` passes over a dream (the
   * one being resumed; one the next `begin` will resume or close). One bounded
   * read (`store.newMemoryIds`, which applies the column gates), then the
   * deny-list and confidentiality (`owner`: the stance the caller reads in).
   * Newest first; the caller ranks.
   */
  private queue(opts: { owner: boolean; skip?: (d: DreamRow) => boolean; enough?: number; madeBy?: number }): QueueRead {
    const T = DREAM_TUNABLES;
    const day = this.store.livedDay();
    const from = day - T.QUEUE_DAYS;
    const read = this.store.newMemoryIds({ sinceAt: null, sinceDay: from, limit: T.QUEUE_READ });
    if (read.length === 0) return { ids: [], capped: false, from, stopped: false };
    const shown = this.standingShown(from, opts.skip);
    const denied = new Set(this.store.deniedIds());
    const ids: string[] = [];
    let stopped = false;
    for (const id of read) {
      if (shown.has(id) || denied.has(id)) continue;
      const row = this.store.row(id);
      if (row === undefined || !this.showableAs(row, opts.owner)) continue;
      if (opts.madeBy !== undefined && (row.created_at ?? 0) > opts.madeBy) continue;
      ids.push(id);
      if (opts.enough !== undefined && ids.length >= opts.enough) {
        stopped = true;
        break;
      }
    }
    return { ids, capped: read.length >= T.QUEUE_READ, from, stopped };
  }

  /**
   * Every id a dream that stands was shown — not undone, not passed over —
   * among the dreams of the window (a dream begun before a memory was born
   * cannot have shown it).
   */
  private standingShown(sinceDay: number, skip?: (d: DreamRow) => boolean): Set<string> {
    const out = new Set<string>();
    for (const d of this.store.dreams({ limit: 200 })) {
      if (d.state === "undone" || d.day < sinceDay || (skip !== undefined && skip(d))) continue;
      for (const id of parseIds(d.shown)) out.add(id);
    }
    return out;
  }

  /**
   * WHAT LEFT THE QUEUE BY AGE since the last dream: born in the window the
   * last dream had but not in tonight's, and shown to no dream that stands.
   * They are not lost — they fade as ordinary memories, and recall still
   * reaches them — but no dream will replay them, and that is said.
   */
  private agedOut(last: DreamRow | null, from: number, owner: boolean): { n: number; floor: boolean } {
    if (last === null) return { n: 0, floor: false };
    const lo = last.day - DREAM_TUNABLES.QUEUE_DAYS;
    if (lo >= from) return { n: 0, floor: false };
    // Only the band that aged out (born in [lo, from)); a band larger than
    // the read is a floor, and said so.
    const read = this.store.newMemoryIds({ sinceAt: null, sinceDay: lo, beforeDay: from, limit: DREAM_TUNABLES.QUEUE_READ });
    const shown = this.standingShown(lo);
    const denied = new Set(this.store.deniedIds());
    let n = 0;
    for (const id of read) {
      if (shown.has(id) || denied.has(id)) continue;
      const row = this.store.row(id);
      if (row === undefined || row.birth_day >= from || !this.showableAs(row, owner)) continue;
      n += 1;
    }
    return { n, floor: read.length >= DREAM_TUNABLES.QUEUE_READ };
  }

  /**
   * REPLAY PRIORITY (2026-09-28, held lightly; the research note's P1): the
   * valuable and the fragile first, from numbers physics already keeps —
   * salience, how strongly it is felt, whether it is coming up or on my mind,
   * and an at-risk bonus for the salient-but-weak — less a little for age.
   * Emotion and future relevance are contested in human sleep studies, so
   * they are weights here, not rules. Not newest first.
   */
  private replayPriority(id: string, day: number, mind: ReadonlySet<string>): number {
    const row = this.store.row(id);
    if (row === undefined) return 0;
    const p = this.store.physicsOf(id);
    const salience = sal(p.salience);
    const felt = emotionalIntensity(p);
    const s = strength(p, day);
    const future = (row.event_date !== null ? 0.4 : 0) + (mind.has(id) ? 0.3 : 0);
    const atRisk = salience >= 0.5 && s < 0.3 ? 0.3 : 0;
    const age = Math.max(0, day - row.birth_day) * 0.02;
    return salience + felt + future + atRisk - age;
  }

  /**
   * A memory's words as the dream may see them — its whole text (title, then
   * body, on one line) and its line — or null when it is not a dream's to see
   * (unreadable, the self page, a handoff).
   */
  private view(id: string): { row: MemoryRow; whole: string; line: string } | null {
    const row = this.store.row(id);
    if (row === undefined) return null;
    let doc: ProseDoc;
    try {
      doc = this.store.readProse(id);
    } catch {
      return null;
    }
    if (isSelfPage(doc) || isHandoff(doc)) return null;
    const title = doc.title !== undefined && doc.title.trim().length > 0 ? doc.title.trim() : "";
    const whole = `${title.length > 0 ? `${title} — ` : ""}${doc.body}`.replace(/\s+/g, " ").trim();
    return { row, whole, line: lineOf({ title, body: doc.body }, DREAM_TUNABLES.LINE_BYTES) };
  }

  /**
   * COMPOSE TONIGHT'S BUNDLE (2026-09-28). The queue ranked by replay
   * priority; tonight's new memories taken in that order, each with its
   * nearest older neighbours, while their lines fit tonight's share — the rest
   * WAIT. Then the mixing, the look-back, what's on my mind; the journal's new
   * entries, sliced at the chapter headings; and the fitter spends tonight's
   * room: a line for everything shown, the whole text for the most important.
   */
  private compose(id: string, q: QueueRead, last: DreamRow | null, day: number, at: string): Composed {
    const T = DREAM_TUNABLES;
    const denied = new Set(this.store.deniedIds());
    const queued = new Set(q.ids);
    const views = new Map<string, ReturnType<Dreams["view"]>>();
    const see = (mid: string): { row: MemoryRow; whole: string; line: string } | null => {
      if (!views.has(mid)) views.set(mid, denied.has(mid) ? null : this.view(mid));
      const v = views.get(mid) ?? null;
      return v !== null && this.showable(v.row) ? v : null;
    };
    const lineCost = (mid: string): number => {
      const v = see(mid);
      return v === null ? 0 : FIT_OVERHEAD + wireChars(v.whole.length <= v.line.length ? v.whole : v.line);
    };
    const role = new Map<string, DreamRole>();

    // WHAT'S ON MY MIND first: it lifts a queued memory's priority.
    const mindRead = mindRanked(this.store, {
      today: at,
      day,
      showable: (row) => !denied.has(row.id) && this.showable(row),
      owner: this.bundleOwner,
    });
    const mindAll = mindRead.items;
    const mindIds = new Set(mindAll.flatMap((m) => m.ids));

    // TONIGHT'S NEW, by replay priority, while their lines (and their
    // neighbours') fit the share; the rest wait.
    const ranked = q.ids
      .filter((mid) => see(mid) !== null)
      .map((mid) => ({ id: mid, p: this.replayPriority(mid, day, mindIds) }))
      .sort((a, b) => b.p - a.p || (a.id < b.id ? -1 : 1));
    const priority = new Map(ranked.map((r) => [r.id, r.p]));
    const freshRoom = T.NIGHT_CHARS * T.FRESH_SHARE;
    let freshUsed = 0;
    // The fresh LIST rides in part 1 whatever the parts (it names the night's
    // structure), so it is bounded by what it costs on the wire, too.
    let listUsed = 0;
    const freshOut: { id: string; neighbours: string[] }[] = [];
    const loose: string[] = [];
    // One reader for the whole night: stored neighbours, and the embedding
    // table read at most once for any that have none (Lane 0, scale C1).
    const neighbourOf = this.store.neighbourReader();
    for (const { id: fid } of ranked) {
      const own = lineCost(fid);
      if (freshOut.length > 0 && freshUsed + own > freshRoom) continue;
      // THE LIST'S ROOM, BEFORE THE NEIGHBOURS ARE LOOKED UP (Lane 0, scale
      // C1): an entry with no neighbours is the least a fresh line costs the
      // list; when even that does not fit, the full check below would refuse
      // it too — so it waits without paying a neighbour read first.
      if (freshOut.length > 0 && listUsed + 2 * JSON.stringify({ id: fid, neighbours: [] }).length > T.FRESH_LIST_CHARS) continue;
      const self = (see(fid) as { row: MemoryRow }).row;
      const neighbours: string[] = [];
      const near: string[] = [];
      for (const [rank, nid] of this.near(fid, T.MIXING_TO_RANK, neighbourOf).entries()) {
        if (nid === fid || queued.has(nid)) continue;
        const nv = see(nid);
        if (nv === null || nv.row.birth_day > self.birth_day) continue;
        if (rank >= T.MIXING_FROM_RANK) {
          near.push(nid);
          continue;
        }
        if (neighbours.length < T.NEIGHBOURS) neighbours.push(nid);
      }
      const cost = own + neighbours.filter((n) => !role.has(n)).reduce((sum, n) => sum + lineCost(n), 0);
      const listed = 2 * JSON.stringify({ id: fid, neighbours }).length;
      if (freshOut.length > 0 && (freshUsed + cost > freshRoom || listUsed + listed > T.FRESH_LIST_CHARS)) continue;
      freshUsed += cost;
      listUsed += listed;
      role.set(fid, "new");
      for (const n of neighbours) if (!role.has(n)) role.set(n, "neighbour");
      loose.push(...near);
      freshOut.push({ id: fid, neighbours });
    }
    // REM MIXING: a few loosely related older memories, picked at random from
    // the loose band of the new memories' neighbourhoods.
    const rng = seeded(id);
    const mixing: string[] = [];
    const pool = [...new Set(loose)].filter((x) => !role.has(x));
    while (mixing.length < T.MIXING && pool.length > 0) {
      const [pick] = pool.splice(Math.floor(rng() * pool.length), 1);
      if (pick !== undefined && see(pick) !== null) {
        mixing.push(pick);
        role.set(pick, "mixing");
      }
    }
    // THE LOOK-BACK: the strongest-feeling memories from about a week ago
    // (not ones still waiting in the queue: they come as new).
    const lookback: string[] = [];
    const lo = day - T.LOOKBACK_DAYS - T.LOOKBACK_SPREAD;
    const hi = day - T.LOOKBACK_DAYS + T.LOOKBACK_SPREAD;
    const felt: { id: string; felt: number }[] = [];
    for (const mid of this.store.list({ type: "memory", archived: false })) {
      if (queued.has(mid) || denied.has(mid)) continue;
      const row = this.store.row(mid);
      if (row === undefined || row.birth_day < lo || row.birth_day > hi || !this.showable(row)) continue;
      const f = emotionalIntensity(this.store.physicsOf(mid));
      if (f > 0) felt.push({ id: mid, felt: f });
    }
    felt.sort((a, b) => b.felt - a.felt || (a.id < b.id ? -1 : 1));
    for (const f of felt) {
      if (lookback.length >= T.LOOKBACK_COUNT) break;
      if (role.has(f.id) && role.get(f.id) !== "neighbour") continue;
      if (see(f.id) === null) continue;
      lookback.push(f.id);
      if (!role.has(f.id)) role.set(f.id, "lookback");
    }
    // WHAT'S ON MY MIND: open things, not new. Their memories join the shown
    // set (a dream may link or feel them), never the fresh list.
    // A QUEUED memory that is not tonight's new is left off my mind tonight:
    // shown here, it would leave the queue as if it had been dreamed as new.
    // It waits, counted in the queue.
    const mindKept = mindAll.filter((item) => item.ids.every((mid) => see(mid) !== null && (!queued.has(mid) || role.get(mid) === "new")));
    for (const item of mindKept) for (const mid of item.ids) if (!role.has(mid)) role.set(mid, "on-mind");

    // THE JOURNAL: the new entries of every episode written since the last dream.
    const chaptersFit = this.chaptersSince(last, day, T.NIGHT_CHARS * T.CHAPTER_SHARE);

    // TONIGHT'S ROOM for the memories' words: what the journal, the page and
    // the wake left.
    const page = this.ctx.page();
    const wake = this.ctx.wake();
    // Kept by what they cost on the wire (a page in another script costs more
    // per character); their whole lengths are said, and the self_page tool
    // reads the page whole.
    const selfPage = page === null ? null : clipWire(page, T.PAGE_CHARS);
    const wakeText = wake === null ? null : clipWire(wake, T.WAKE_CHARS);
    const room = Math.max(0, T.NIGHT_CHARS - chaptersFit.used - wireChars(selfPage ?? "") - wireChars(wakeText ?? "") - FURNITURE);
    const aged = this.agedOut(last, q.from, this.bundleOwner);
    const base: Record<DreamRole, number> = { new: 4, "on-mind": 3, lookback: 2, neighbour: 1, mixing: 0.5 };
    const cands: FitCandidate[] = [];
    for (const [mid, r] of role) {
      const v = see(mid);
      if (v === null) continue;
      const within = r === "new" ? (priority.get(mid) ?? 0) : emotionalIntensity(this.store.physicsOf(mid));
      cands.push({ id: mid, priority: base[r] * 10 + within, line: v.line, whole: v.whole });
    }
    const fitted = fit(cands, { room, excerptChars: T.DETAIL_CHARS, least: "line" });
    const left = new Set(fitted.waiting);
    const memories: Record<string, DreamItem> = {};
    for (const p of fitted.placed) {
      const v = see(p.id) as { row: MemoryRow };
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
      notShown,
    };
    const queueSize = ranked.length;
    const bundle: DreamBundle = {
      dream: id,
      date: at,
      livedDay: day,
      lastDreamed: last === null ? null : (last.date ?? null),
      limits: { ...T.LIMITS },
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
      ...(mindRead.more > 0 ? { onMindMore: mindRead.more } : {}),
      queue: {
        new: queueSize,
        tonight,
        waiting: queueSize - tonight,
        agedOut: aged.n,
        ...(aged.floor ? { agedOutAtLeast: true } : {}),
        windowDays: T.QUEUE_DAYS,
        ...(q.capped ? { readCapped: true } : {}),
      },
      shownAs,
      lookup: DREAM_LOOKUP,
      parts: null,
    };
    noteMindShown(this.store, bundle.onMind, day);
    return {
      bundle,
      shown: fitted.placed.map((p) => p.id),
      offered: {
        whole: [...offeredMem.whole, ...chaptersFit.offered.whole],
        excerpt: [...offeredMem.excerpt, ...chaptersFit.offered.excerpt],
        line: [...offeredMem.line, ...chaptersFit.offered.line],
        id: [...offeredMem.id, ...chaptersFit.offered.id],
      },
      roles: Object.fromEntries(fitted.placed.map((p) => [p.id, role.get(p.id) ?? "neighbour"])),
      entryIndex: chaptersFit.entryIndex,
      reads: chaptersFit.reads,
      unread: chaptersFit.unread,
    };
  }

  /**
   * THE JOURNAL SINCE THE LAST DREAM, AS SLICES (2026-09-28; audit note A:
   * the old cut re-sent each grown episode from chapter 1 and dropped exactly
   * its new chapters). Every episode written or extended since, its entries
   * cut at the chapter headings; the entries a dream already saw — headed
   * with a lived day before the last dream's — are counted, not re-sent (an
   * entry of the last dream's own day may be new, so it is sent). A line for
   * every new entry; the whole of the most important, in `room`.
   */
  private chaptersSince(last: DreamRow | null, day: number, room: number): EpisodesFit {
    const T = DREAM_TUNABLES;
    const owner = ownerNames(this.store);
    // HOW FAR THE LAST DREAM READ each episode, when its index says (exact);
    // otherwise the headings' lived days (an entry of the last dream's own
    // day may be new, so it is sent — over-shown, never dropped).
    const prev = readIndex(this.store, "dream");
    const extent = last !== null && prev !== null && prev.ref === last.id ? (prev.entries ?? {}) : {};
    const unread = last !== null && prev !== null && prev.ref === last.id ? (prev.unread ?? {}) : {};
    const episodes: EpisodeInView[] = [];
    for (const eid of this.store.list({ type: "episode", archived: false })) {
      const row = this.store.row(eid);
      if (row === undefined) continue;
      if (row.confidential === 1 && !this.bundleOwner) continue;
      const at = row.updated_at ?? row.created_at ?? 0;
      // `>=`: an episode written in the same millisecond the last dream began is read again (its index says how far).
      const since = last === null ? row.birth_day >= day - T.FIRST_DREAM_DAYS : at >= last.started_at;
      const read = extent[eid];
      // AN EPISODE THE LAST DREAM DID NOT FINISH (review of build B): its
      // index says it read less than the episode holds. What the room did not
      // take last night comes tonight, whether or not the episode grew.
      const left = unread[eid] ?? [];
      if (!since && read === undefined) continue;
      const entries = chapterEntries(row.body);
      if (!since && (read ?? 0) >= entries.length && left.length === 0) continue;
      const fresh: ChapterEntry[] = [];
      let earlier = 0;
      for (const e of entries) {
        const old =
          read !== undefined
            ? e.index < read && !left.includes(e.index)
            : last === null
              ? e.day !== null && e.day < day - T.FIRST_DREAM_DAYS
              : e.day !== null && e.day < last.day;
        if (old) earlier += 1;
        else fresh.push(e);
      }
      if (fresh.length > 0) episodes.push({ row, at, fresh, earlier });
    }
    return fitEpisodes(episodes, { room, owner, day, lineBytes: T.LINE_BYTES, entryChars: T.ENTRY_CHARS, reads: extent, unread });
  }

  /**
   * Nearest memories to `id`, by the static embedder's vectors, else lexically.
   * The vector arm keeps the shape it had when it was a scan of `limit + 1`
   * that found `id` itself first: `id` at rank 0, its neighbours after, so the
   * caller's ranks (`MIXING_FROM_RANK`) mean what they meant.
   */
  private near(id: string, limit: number, neighbourOf: (id: string, limit: number) => string[] | null): string[] {
    const stored = neighbourOf(id, limit);
    if (stored !== null) return [id, ...stored];
    // No vector (embedder off, or not yet embedded): the rarest words of its
    // title and first line, through the token index.
    let doc: ProseDoc;
    try {
      doc = this.store.readProse(id);
    } catch {
      return [];
    }
    const words = `${doc.title ?? ""} ${firstLine(doc.body)}`
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 5)
      .slice(0, 6);
    const scores = new Map<string, number>();
    for (const w of words) for (const h of this.store.search(w, limit)) scores.set(h.id, (scores.get(h.id) ?? 0) + h.score);
    return [...scores].sort((a, b) => b[1] - a[1]).map(([mid]) => mid).slice(0, limit);
  }

  /** One memory as the dream is shown it, at the fidelity its fit gave it. */
  private item(row: MemoryRow, day: number, why: DreamRole, placed: Pick<Placed, "fidelity" | "text" | "chars">): DreamItem {
    const p = this.store.physicsOf(row.id);
    let feeling: string | null = null;
    try {
      const top = [...this.store.feelingsFor(row.id)].sort((a, b) => b.strength - a.strength)[0];
      if (top !== undefined) feeling = top.emotion === "other" && top.other_word !== null ? top.other_word : top.emotion;
    } catch {
      feeling = null;
    }
    // SETTLED OVER (2026-10-11): marked, not left out — the dream may still
    // link or feel it, and the mark keeps it from gisting the old rule as now.
    const head = headOf(this.store, row.id);
    return {
      id: row.id,
      ...(head === null ? {} : { standing: earlierMark(head) }),
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
      ...(livedOn(row) === row.learned_on ? {} : { lived: livedOn(row) }),
      core: row.promoted_identity === 1,
    };
  }

  /**
   * THE FIRST PART, and the keys of the rest (2026-09-28). Whole when the
   * begin result — measured as the MCP server sends it (`dreamResultChars`) —
   * fits `RESULT_CHARS`; otherwise the memories (most important first) and
   * the journal's entries go on in order as far as the room allows, and the
   * rest `PART_CHARS` a part through phase `part`. The result says how many.
   */
  private pack(id: string, session: string, c: Composed, lead: string): { bundle: DreamBundle; later: string[][] } {
    const T = DREAM_TUNABLES;
    const whole = c.bundle;
    // WHOLE WITH ITS MARGIN TOO (2026-10-02): `how` and the other fields ride
    // beside the bundle whether it comes in parts or not.
    if (dreamResultChars(renderDream(id, whole, lead), session, id) + PACK_MARGIN <= T.RESULT_CHARS) return { bundle: whole, later: [] };
    const cost = (v: unknown): number => wireChars(JSON.stringify(JSON.stringify(v)));
    const pieces: { key: string; size: number }[] = [
      ...Object.entries(whole.memories).map(([k, v]) => ({ key: `m:${k}`, size: cost({ [k]: v }) })),
      ...whole.chapters.flatMap((ch) =>
        ch.entries.map((e, i) => ({ key: `e:${ch.id}:${String(i)}`, size: cost(e) + cost({ id: ch.id, title: ch.title }) })),
      ),
    ];
    const note = { part: 1, of: 99, next: "x".repeat(480) };
    const measure = (b: DreamBundle): number => dreamResultChars(renderDream(id, { ...b, memories: {}, chapters: [], parts: note }, lead), session, id) + PACK_MARGIN;
    // PART 1'S OWN FURNITURE OVER THE CAP (review of build B): the wake goes
    // first (it is the page plus lanes), then the page (the self_page tool
    // reads it whole), then what's on my mind (counted in onMindMore) — each
    // left out with its length said, never cut silently.
    //
    // THE LINE MOVED WITH THE CEILING (2026-10-02, review of #315). It was
    // `RESULT_CHARS - PART_CHARS / 4`: 40,500 of furniture at 54,000, and 30,000
    // at 40,000 — which would drop the wake and the page on a busy night that
    // used to keep them. The wake and the page cannot be fetched in a later
    // part, and memories can, so the furniture now keeps all but
    // `FIRST_PART_MIN_ROOM` of part 1 (36,000), and the memories move on.
    let base: DreamBundle = whole;
    const furnitureLine = T.RESULT_CHARS - FIRST_PART_MIN_ROOM;
    if (measure(base) > furnitureLine) base = { ...base, wake: null };
    if (measure(base) > furnitureLine) base = { ...base, selfPage: null };
    if (measure(base) > furnitureLine) base = { ...base, onMind: [], onMindMore: (base.onMindMore ?? 0) + base.onMind.length };
    const fixed = measure(base);
    const groups = packParts(pieces, Math.max(0, T.RESULT_CHARS - fixed), Math.max(0, T.PART_CHARS - PART_FURNITURE));
    if (groups.length === 1) return { bundle: base, later: [] };
    const first = new Set((groups[0] ?? []).map((p) => p.key));
    // A later part's keys carry what the part needs to compose it again: a
    // memory's role, an entry's episode and its place among the episode's
    // entries.
    const later = groups.slice(1).map((ps) =>
      ps.map((p) => {
        if (p.key.startsWith("m:")) return `m:${c.roles[p.key.slice(2)] ?? "neighbour"}:${p.key.slice(2)}`;
        const [, eid, i] = p.key.split(":") as [string, string, string];
        return `e:${eid}:${String(c.entryIndex[`${eid}:${i}`] ?? Number(i))}`;
      }),
    );
    const of = groups.length;
    const bundle: DreamBundle = {
      ...base,
      memories: Object.fromEntries(Object.entries(whole.memories).filter(([k]) => first.has(`m:${k}`))),
      chapters: whole.chapters
        .map((ch) => ({ ...ch, entries: ch.entries.filter((_, i) => first.has(`e:${ch.id}:${String(i)}`)) }))
        .filter((ch) => ch.entries.length > 0),
      parts: {
        part: 1,
        of,
        next:
          `This bundle is too long for one result, so it comes in ${String(of)} parts; this is part 1. ` +
          `Some memories named in the lists above and some journal entries are in the later parts. ` +
          `Before you change anything, call the dream tool with phase "part", dream: ${id}, session: ${session}, part: 2${of > 2 ? `, then each part up to ${String(of)}` : ""}.`,
      },
    };
    return { bundle, later };
  }

  /**
   * ONE LATER PART OF THE BUNDLE (2026-09-28), for a dream whose begin said it
   * came in parts: its memories and journal entries, each as it reads now, at
   * the fidelity the fit gave it. One gone since begin is said to be gone.
   */
  part(input: { dream: string; session?: string; part: number }):
    | { ok: true; part: number; of: number; text: string }
    | { ok: false; reason: DreamRefusal; detail?: string } {
    const open = this.openFor(input.dream, input.session);
    if (!open.ok) return open;
    const index = readIndex(this.store, "dream");
    const later = index !== null && index.ref === input.dream ? (index.parts ?? []) : [];
    const of = later.length + 1;
    const keys = Number.isInteger(input.part) && input.part >= 2 ? later[input.part - 2] : undefined;
    if (keys === undefined) {
      return {
        ok: false,
        reason: "no-such-part",
        detail: later.length === 0 ? "The bundle came whole in begin; there are no more parts." : `part is 2 to ${String(of)} (part 1 was begin's result).`,
      };
    }
    const offered = index as NonNullable<typeof index>;
    const fidelity = (key: string): Exclude<Fidelity, "id"> => {
      if (offered.offered.excerpt.includes(key)) return "excerpt";
      if (offered.offered.line.includes(key)) return "line";
      return "whole";
    };
    const day = this.store.livedDay();
    const denied = new Set(this.store.deniedIds());
    const gone = "(gone since you began: archived, merged or made private)";
    const memories: Record<string, DreamItem | string> = {};
    const chapters = new Map<string, { id: string; title: string | null; entries: DreamEntry[] }>();
    for (const key of keys) {
      if (key.startsWith("m:")) {
        const [, why, mid] = key.split(":") as [string, DreamRole, string];
        const v = denied.has(mid) ? null : this.view(mid);
        if (v === null || !this.showable(v.row)) {
          memories[mid] = gone;
          continue;
        }
        const f = fidelity(mid);
        // Bounded whatever its fidelity (review of build B): a memory revised
        // longer since begin still reads within DETAIL_CHARS here.
        const text = f === "line" ? v.line : clipWire(v.whole, DREAM_TUNABLES.DETAIL_CHARS);
        memories[mid] = this.item(v.row, day, why, { fidelity: f === "line" ? "line" : text === v.whole ? "whole" : "excerpt", text, chars: v.whole.length });
        continue;
      }
      const [, eid, at] = key.split(":") as [string, string, string];
      const row = this.store.row(eid);
      const ch = chapters.get(eid) ?? { id: eid, title: row?.title ?? null, entries: [] };
      chapters.set(eid, ch);
      const entry = row === undefined || (row.confidential === 1 && !this.bundleOwner) ? undefined : chapterEntries(row.body)[Number(at)];
      if (entry === undefined) {
        ch.entries.push({ chapter: null, day: null, fidelity: "line", text: gone, chars: 0 });
        continue;
      }
      const f = fidelity(entryKey(eid, entry.index));
      const text = f === "line" ? lineOf({ body: entry.text }, DREAM_TUNABLES.LINE_BYTES) : clipWire(entry.text, DREAM_TUNABLES.ENTRY_CHARS);
      ch.entries.push(shownEntry(entry, { fidelity: f === "line" ? "line" : text === entry.text ? "whole" : "excerpt", text, chars: entry.text.length }));
    }
    const body = { dream: input.dream, part: input.part, of, memories, chapters: [...chapters.values()] };
    const text = `${dreamOpener(input.dream)} part ${String(input.part)} of ${String(of)} of the dream bundle — memories to dream over, not events that happened now.\n${JSON.stringify(body)}`;
    return { ok: true, part: input.part, of, text };
  }

  /** A dream this session may still write to. */
  private openFor(id: string, session: string | undefined): { ok: true; dream: DreamRow } | { ok: false; reason: DreamRefusal } {
    if (this.ctx.observer) return { ok: false, reason: "observer" };
    const dream = this.store.dream(id);
    if (dream === undefined) return { ok: false, reason: "unknown-dream" };
    if (session !== undefined && dream.session !== null && dream.session !== session) return { ok: false, reason: "not-this-session" };
    if (dream.state !== "begun") return { ok: false, reason: "dream-closed" };
    // A dream left open (never journaled) is closed by the next one that
    // begins: otherwise an old id would stay writable for ever, with limits
    // and a shown set of its own. (Adversarial review of #251.)
    const newest = this.lastDream();
    if (newest !== null && newest.id !== dream.id) return { ok: false, reason: "dream-closed" };
    return { ok: true, dream };
  }

  /**
   * The dream's words through the credential battery; never empty unless
   * allowed. Longer than `max` is kept to `max` and SAID (`cut`), never cut
   * without a word (2026-09-28).
   */
  private words(
    text: string | undefined,
    dream: DreamRow,
    allowEmpty = false,
    max: number = DREAM_TUNABLES.MAX_TEXT_CHARS,
  ): { ok: true; text: string; cut: boolean } | { ok: false; reason: string; detail: string } {
    const raw = (text ?? "").trim();
    if (raw.length === 0) return allowEmpty ? { ok: true, text: "", cut: false } : { ok: false, reason: "empty-text", detail: "It was empty." };
    if (carriesDreamMark(raw)) return { ok: false, reason: "dream-mark-in-text", detail: `It carries the dream's mark (${DREAM_MARK}…); take it out.` };
    const verdict = this.ctx.gate(raw.slice(0, max), dream.session ?? dream.id);
    if (!verdict.ok) return { ok: false, reason: `gate:${verdict.reason}`, detail: `The credential scan refused it (${verdict.reason}).` };
    return { ok: true, text: verdict.text, cut: raw.length > max };
  }

  /** Why these ids cannot be changed by this dream, in words. */
  private notLive(ids: readonly (string | null | undefined)[], shown: ReadonlySet<string>): string {
    const parts = ids
      .filter((id): id is string | undefined => id !== null)
      .map((id) => (id === undefined || id.length === 0 ? "an id is missing" : shown.has(id) ? `${id} is gone since the bundle (archived, merged or made private)` : `${id} was not in the bundle`));
    return `${parts.join("; ")}. Use only ids the bundle showed you.`;
  }

  /**
   * A dream's feeling-now, as it will be stored. The WHOLE sent emotion
   * crosses the credential battery and the mark check first (review of #268:
   * a key in `emotion` went around the scan), then a phrase in it is split —
   * `emotion` is one word, `carried_by` the nuance — and the tail crosses the
   * scan with the rest of carried_by. Strength is capped at the memory's
   * peak. Nothing is written here.
   */
  private feelingNow(
    dream: DreamRow,
    row: MemoryRow,
    change: DreamChange,
  ): { ok: true; input: FeelingInput; notes: string[]; capped: boolean; peak: number } | { ok: false; reason: string; detail: string } {
    // How it feels NOW can be as strong as it ever was, never stronger: a
    // dream records softening; it cannot manufacture a feeling that would
    // raise the memory or open the core's fast lane.
    const peak = emotionalIntensity(this.store.physicsOf(row.id));
    const sent = this.words(String(change.emotion ?? ""), dream, false, CARRIED_BY_MAX_CHARS);
    if (!sent.ok) return { ok: false, reason: sent.reason, detail: `emotion: ${sent.detail}` };
    const notes: string[] = [];
    if (sent.cut) notes.push(`emotion was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`);
    const split = repairEmotion(sent.text, typeof change.carried_by === "string" ? change.carried_by : "");
    const carried = this.words(split?.carriedBy ?? change.carried_by ?? "", dream, true, CARRIED_BY_MAX_CHARS);
    if (split !== null) notes.push(splitNote(split));
    if (!carried.ok) notes.push(`carried_by was not kept — ${carried.detail}`);
    else if (carried.cut) notes.push(`carried_by was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`);
    const core = String(change.core ?? "");
    const emotion = split?.emotion ?? sent.text;
    // Left out, the strength a session's feeling would get (the word's
    // default, capped below the fast lane — review of #301, m2), not 0.
    const given = change.strength === undefined || change.strength === null ? defaultStrength(core, emotion) : Number(change.strength);
    const s = Math.max(0, Math.min(given, peak));
    return {
      ok: true,
      input: {
        whose: "self",
        core,
        emotion,
        strength: s,
        carriedBy: `in a dream, ${dream.date ?? ""}${carried.ok && carried.text.length > 0 ? `: ${carried.text}` : ""}`.trim(),
      },
      notes,
      capped: s < given,
      peak,
    };
  }

  /**
   * The id of a feeling THIS dream already recorded on `memoryId` that says
   * the same thing (whose, core, emotion, word) — or null. Checked the way
   * the store will spell it (`checkFeelings`, pure); a feeling that will not
   * check is left for the store to refuse, with its reason.
   */
  private sameFeelingThisDream(dreamId: string, memoryId: string, input: FeelingInput): string | null {
    let want: ReturnType<typeof checkFeelings>["rows"][number] | undefined;
    try {
      want = checkFeelings([input]).rows[0];
    } catch {
      return null;
    }
    if (want === undefined) return null;
    const mine = new Set<string>();
    for (const c of this.store.dreamChanges(dreamId)) {
      if (c.action !== "feeling-now" || c.undone === 1 || c.ref !== memoryId) continue;
      const ids = parseDetail(c.detail)["feelings"];
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") mine.add(id);
    }
    if (mine.size === 0) return null;
    const hit = this.store
      .feelingsFor(memoryId)
      .find((f) => mine.has(f.id) && f.whose === want.whose && f.core === want.core && f.emotion === want.emotion && (f.other_word ?? null) === want.otherWord);
    return hit?.id ?? null;
  }

  private archiveQuietly(id: string): void {
    const row = this.store.row(id);
    if (row === undefined || row.archived === 1) return;
    try {
      this.store.archive(id, DREAM_UNDONE_REASON);
    } catch {
      /* removed since */
    }
  }

  /** The owner's name as it was written on the identity core (not lower-cased). */
  private ownerName(): string | null {
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

  /** A durable row (ids and counts only), and the ring event beside it. */
  private record(name: string, ref: string | null, payload: Record<string, string | number | boolean | null>): void {
    this.emit(name, ref ?? undefined, payload);
    if (this.ctx.observer) return;
    try {
      this.store.appendEvent({ name, day: this.store.livedDay(), ref, payload });
    } catch {
      /* the log is evidence, never a reason to fail the dream */
    }
  }
}

// ── small helpers ────────────────────────────────────────────────────────────

function parseIds(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseDetail(json: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function edgePrior(v: unknown): { weight: number; day: number } | null {
  if (v === null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  return typeof r["weight"] === "number" && typeof r["day"] === "number" ? { weight: r["weight"], day: r["day"] } : null;
}

/**
 * The confidentiality marker a dream's new memory must carry when any memory
 * it was made from is confidential: `confidential: true`, plus the first
 * named class (`confidentiality`) found. Empty when none is.
 */
function confidentialityOf(rows: readonly MemoryRow[]): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.confidential !== 1) continue;
    let klass: unknown;
    try {
      const meta = JSON.parse(r.meta) as Record<string, unknown>;
      klass = meta["confidentiality"];
    } catch {
      klass = undefined;
    }
    if (out["confidential"] === undefined) out = { confidential: true };
    if (typeof klass === "string" && klass.length > 0 && out["confidentiality"] === undefined) out["confidentiality"] = klass;
  }
  return out;
}

function cut(text: string | null, max: number): string | null {
  if (text === null) return null;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** `text` kept to `max` characters, the last one "…" — the fitter's excerpt. */
function excerpt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

// ── the bundle's bookkeeping (2026-09-28) ────────────────────────────────────

/** The queue as one read found it. */
interface QueueRead {
  readonly ids: readonly string[];
  /** The read reached `QUEUE_READ`: there may be more. */
  readonly capped: boolean;
  /** The window's first lived day. */
  readonly from: number;
  /** The read stopped at `enough`: `ids` is a floor. */
  readonly stopped: boolean;
}

/** A composed bundle, before it is packed into parts, and what the ledger needs. */
interface Composed {
  readonly bundle: DreamBundle;
  /** Every memory id shown (in any part). */
  readonly shown: string[];
  readonly offered: { whole: string[]; excerpt: string[]; line: string[]; id: string[] };
  readonly roles: Record<string, DreamRole>;
  /** `<episode>:<position in its shown entries>` → the entry's place among all the episode's entries. */
  readonly entryIndex: Record<string, number>;
  /** How far this dream read each episode, by entry count (the next dream starts there). */
  readonly reads: Record<string, number>;
  /** Entries below that it did not take (the next dream sends them). */
  readonly unread: Record<string, number[]>;
}

/** A shown memory's cost beside its words (the fitter's `OVERHEAD`, which the fit uses too). */
const FIT_OVERHEAD = FIT_TUNABLES.OVERHEAD;
/** The bundle's other furniture, reserved from tonight's room: ids, lists, the queue, the limits. */
const FURNITURE = 4_000;
/** Slack for the result's other fields (phase, session, the server's `how`) beside the bundle. */
const PACK_MARGIN = 1_500;
/** The least of part 1 kept for memories before its furniture (wake, page, on my mind) gives way. CAL. */
const FIRST_PART_MIN_ROOM = 4_000;
/** A later part's own furniture: its opener, ids and `next`. */
const PART_FURNITURE = 1_500;

/**
 * THE LOOKUP, NAMED IN THE BUNDLE (2026-09-28): what a line means and how to
 * read the rest. The MCP tool's `how` adds the numbers (how many ids at once).
 */
export const DREAM_LOOKUP =
  'Every memory shown has a line at least; the most important come whole. "fidelity" says which: whole, excerpt or line; "chars" is the whole text\'s length. ' +
  "Read any you have only in part with the recall tool, ids: [...] — several at once — before you merge, gist or feel it. A journal entry shown as a line is read the same way, by its chapter's id. " +
  'The self page is read whole with the self_page tool ("selfPageChars" is its length). The wake is the page first, then its lanes — craft, open threads, what is coming, hints.';

/** The begin result's text: the opener, what it is, then the bundle. */
export function renderDream(id: string, bundle: DreamBundle, lead: string): string {
  const said = lead.length === 0 ? "the dream bundle — memories to dream over, not events that happened now." : `${lead}Memories to dream over, not events that happened now.`;
  return `${dreamOpener(id)} ${said}\n${JSON.stringify(bundle)}`;
}

/**
 * THE SIZE OF A BEGIN RESULT AS IT LEAVES (2026-09-28; reflect's
 * `resultChars` is the precedent): the MCP text is the result's JSON,
 * pretty-printed, with the bundle text escaped inside it. The server's own
 * sentences beside it (`how`, `parts`) are what `PACK_MARGIN` holds room for.
 */
export function dreamResultChars(text: string, session: string, dream: string): number {
  return wireChars(JSON.stringify({ phase: "begin", session, dream, bundle: text }, null, 2));
}

/** What a title kept to its cap says — never cut without a word (2026-09-28). */
/**
 * A gist's three fields (v12, 2026-10-03), read loose-first: what reads goes
 * to the row, what does not is dropped with a note — the gist is written
 * either way, as a malformed `kind` falls back to `fact`.
 */
function gistFacts(change: DreamChange): { put: { occurredOn?: string; saidBy?: SaidBy; status?: MemoryStatus }; notes: string[] } {
  const put: { occurredOn?: string; saidBy?: SaidBy; status?: MemoryStatus } = {};
  const notes: string[] = [];
  if (change.occurredOn !== undefined && change.occurredOn !== null) {
    const d = occurredOnOf(change.occurredOn);
    if (d === null) notes.push(`occurredOn "${String(change.occurredOn).slice(0, 64)}" is not a date this can read (a day, a month, a year or a range), so it was left off.`);
    else put.occurredOn = d;
  }
  if (change.saidBy !== undefined && change.saidBy !== null) {
    const v = saidByOf(change.saidBy);
    if (v === null) notes.push(`saidBy "${String(change.saidBy).slice(0, 64)}" is not one of ${SAID_BY.join(", ")}, so it was left off.`);
    else put.saidBy = v;
  }
  if (change.status !== undefined && change.status !== null) {
    const v = statusOf(change.status);
    if (v === null) notes.push(`status "${String(change.status).slice(0, 64)}" is not one of ${STATUSES.join(", ")}, so it was left off.`);
    else put.status = v;
  }
  return { put, notes };
}

function titleNote(): string {
  return `title was kept to its first ${String(DREAM_TUNABLES.MAX_TITLE_CHARS)} characters.`;
}

function firstLine(text: string): string {
  return (text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").slice(0, 120);
}

function clampTo(x: number, cap: number): number {
  const n = Number.isFinite(x) ? x : cap;
  return Math.max(0, Math.min(n, cap));
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

function errName(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code);
  return err instanceof Error ? err.name : "UNKNOWN";
}

/**
 * A refusal that names what tripped it (2026-09-28): a FEELING_ or
 * TRAIT_INVALID carries its reason and what is allowed, never the bare code.
 */
function refusalOf(err: unknown): string {
  if (isStoreError(err, "FEELING_INVALID") || isStoreError(err, "TRAIT_INVALID")) {
    const why = String(err.detail["reason"] ?? "");
    const allowed = typeof err.detail["allowed"] === "string" ? ` (one of ${err.detail["allowed"]})` : "";
    return why.length > 0 ? `${err.code === "FEELING_INVALID" ? "feeling" : "trait"}-invalid:${why}${allowed}` : err.code;
  }
  return errName(err);
}

/** A small deterministic RNG seeded from the dream id, so a bundle is reproducible. */
function seeded(seed: string): () => number {
  let h = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
