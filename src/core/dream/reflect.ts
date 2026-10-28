/**
 * `dream/reflect.ts` — REFLECTION, the waking self (2026-09-27, the owner's
 * idea; working defaults, held lightly).
 *
 * Dreaming, reflecting and talking are three things. A dream is not lived: its
 * words are marked, its journal is not a memory, it changes the store only in
 * the ways sleep does. A reflection is LIVED: an awake act by the same mind,
 * usually right after a dream (the dreamer wakes and reflects before it hands
 * back), but not only — it has its own record, with an optional dream id, and
 * it can run on its own (`launchPrompt`), so the self page does not depend on
 * a dream having run.
 *
 * The shape. `begin` HANDS the reflection what it needs rather than letting it
 * search: what the dream saw (a line each), the dream's journal, its gists and nominations (marked as dreamed —
 * suggestions it may use, reword or ignore), the last few days' chapters and
 * memories and its own recent reflections, what's on my mind, the self page, the core
 * memories, the core CANDIDATES (memories about me, us or the owner — not the
 * lane arithmetic, which stays on the dashboard), and the most strongly felt
 * memories that could be about me, marked or not; and two or three questions,
 * rotated so no theme repeats on consecutive nights. `finish` takes what it
 * wrote:
 *
 *   (a) an ENTRY, first person. When it cites the memories it rests on it is
 *       kept as a memory of source `reflection` (its title opens "Reflected:",
 *       so recall says where it came from). With no citation it is "nothing
 *       much" — a normal outcome: the entry stays on the record only, and the
 *       night rewrites nothing, shares nothing.
 *   (b) a SELF PAGE rewrite, from the cited memories (the core first) with the
 *       old page as context only. It may mention a dream only as a dream; a
 *       dream's gist is not a source it can cite. (The check that refused a
 *       page sharing six words with any recent gist was removed 2026-09-28:
 *       its every hit was a lived quote the gist had quoted too.) It is
 *       written `by: "reflection"` (2026-09-28), its own author beside the
 *       nightly writer's `writer`: the two are different jobs in one nightly
 *       run (the writer first, the reflection after), both may write the page
 *       for now, and the version history tells them apart.
 *   (c) a MORNING SHARE — two or three sentences for the owner, the way a
 *       partner would say it, citing what it rests on. Told by the session
 *       (`told`), or carried once by the next one.
 *   (d) FEELINGS recorded now, about a memory: `recorded_later` with today's
 *       date, source `reflection`. Unlike a dream's they may be stronger than
 *       anything written at the time.
 *   (e) ABOUT marks — what a memory is about (`me`, `us`, `owner`, `work`,
 *       `world`), set by meaning.
 *   (f) TRAIT NUDGES (folded into v9, 2026-09-27) — where a memory shows how
 *       I acted, on one of the seven axes (`store/traits.ts`), source
 *       `reflection`. "Where did you act unlike your self page?" is their
 *       natural question. Display only, and the reflection is shown NO
 *       balance or totals: the arithmetic stays on the dashboard.
 *
 * `finish` MAY BE CALLED AGAIN (2026-09-28) the same calendar day, on the same
 * reflection: a second call supplies the parts the first refused or left out
 * — page, share, feelings, about, traits — without re-minting the entry, and
 * may replace the share while it has not been told. Every part not written
 * says which rule tripped it (and the matching text or id, where there is
 * one) and that it can be sent again.
 *
 * Every memory it cites comes BACK: a reflection return (physics §5.11), an
 * awake return that counts toward the core lanes although the reflection was
 * handed what it cites — on purpose (physics CONTRACT §5.11). At most once
 * a lived day per memory, and once a week per memory from reflections.
 *
 * Nothing here calls a model: the reflecting mind is the agent, outside.
 */
import { randomBytes } from "node:crypto";

import { emotionalIntensity } from "../physics/index.js";
import { earlierMark, headOf, isHandoff, isSelfPage } from "../recall/index.js";
import { aboutMe, acceptsReflectedFeeling, keepCore, laterFeelingWasReflections, promotionRecordKey, reconsiderWords, retireCore, selfRelevantFeeling } from "../sleep/index.js";
import {
  ABOUT_MARKS,
  CARRIED_BY_MAX_CHARS,
  aboutMarkOf,
  CORE_ABOUT_MARKS,
  checkFeelings,
  TRAIT_AXES,
  TRAIT_CARRIED_BY_MAX_CHARS,
  isStoreError,
  repairEmotion,
  splitNote,
} from "../store/index.js";
import type { AboutMark, DreamRow, FeelingInput, MemoryRow, ProseDoc, ReflectionRow, Store } from "../store/index.js";
import type { Kind } from "../types.js";
import { AliasMap, FIT_TUNABLES, TOOL_RESULT_CEILING, clipWire, fit, leanNumber, lineOf, offeredInPart, offeredOf, plainValue, readIndex, wireChars, writeIndex } from "../fit/index.js";
import type { Fidelity, FitCandidate, FitOutcome, NightAliases, Placed } from "../fit/index.js";
import { ownerNames } from "../sleep/index.js";
import { CLAIM_PREFIX_MIN_CHARS, PAGE_CORE_HEADING, claimKey, pageClaims, pageSections, traceFor } from "../self/page.js";
import { coreFromBeliefs } from "../self/measures.js";
import { SELF_TUNABLES } from "../self/tunables.js";
import { openCarry } from "../self/identity.js";
import { PAGE_WRITING_RULE, daySummaries } from "../self/writer.js";
import type { DaySummary } from "../self/writer.js";
import { addDays, isDay, localDate, readableDate } from "../time.js";
import { DREAM_MARK, carriesDreamMark } from "./mark.js";
import { feelingWeeks } from "./feeling-weeks.js";
import type { FeelingWeeks } from "./feeling-weeks.js";
import { isWorkMemory } from "../self/work.js";
import { orderUnmarked, personNames } from "./unmarked.js";
import type { UnmarkedCandidate } from "./unmarked.js";
import { chapterEntries, entryKey, entryLine, entrySummary, fitEpisodes, leanChapterHead, leanDate, leanEntry, shownEntry, summarized, withSummaries } from "./slices.js";
import { chapterSummaries } from "../self/summaries.js";
import type { ChapterEntry, EpisodeInView, EpisodesFit, ShownChapter } from "./slices.js";
import { DREAM_TUNABLES } from "./tunables.js";
import type { Schemas } from "../schemas/index.js";
import { similarity } from "../remember/updates.js";
import { TUNABLES as SCHEMAS_TUNABLES } from "../schemas/tunables.js";
import { mindRanked, noteMindShown } from "./mind.js";
import type { MindItem } from "./mind.js";
import { settle as settleContradiction } from "../reconsolidation.js";
import { CORE_ASK_LOOKBACK, coreAsks, coreHow, coreSentence, unsettledPairOf } from "./core-ask.js";
import { joinHow, joinProposalOf, joinSentence, pairKey, proposeJoin } from "./project-ask.js";
import type { JoinProposal } from "./project-ask.js";
import type { CoreAsk, CoreDecided } from "./core-ask.js";
import { settlesWhenOf, THREAD_CLOSED_BY_META_KEY, THREAD_REOPENED_BY_META_KEY, UNRESOLVED_META_KEY } from "../mint.js";
import type { SettleOutcome } from "../reconsolidation.js";

/** Every `reflect` knob, in one place. Working defaults of 2026-09-27; CAL = not yet measured. */
export const REFLECT_TUNABLES = {
  /** Questions a night (the brief's "2–3"). */
  QUESTIONS: 3,
  /** Chapters from this many lived days back are handed (the last few days), as entries (2026-09-28: were 6 chapters of 2,000 characters). */
  CHAPTER_DAYS: 3,
  /** Its own recent reflections, so it does not repeat itself. */
  EARLIER: 3,
  EARLIER_CHARS: 1_200,
  /** The dream's journal, bounded (was 4,000; raised with the journal's own cap, 2026-09-28). */
  JOURNAL_CHARS: 12_000,
  /**
   * THE SELF PAGE IS HANDED WHOLE (2026-09-28: was cut at 6,000 characters
   * while a page may be 16,384 bytes; it aims under `PAGE_ROOM_BYTES` since
   * 2026-10-10) — a reflection that may rewrite the page reads all of it.
   */
  /** WHAT THE DREAM SAW (2026-09-28): characters of each memory's line. */
  SAW_CHARS: 240,
  /**
   * THE BUNDLE IN PARTS (2026-09-28). The begin result's size — measured as
   * the MCP text leaves, the bundle re-escaped inside the result's JSON beside
   * `how` and the questions (`resultChars`; review of #271) — before its long
   * lists (memories, chapters, what the dream saw) go on in later parts. Not
   * a silent cut: the result says how many parts, and phase `part` hands the
   * rest.
   *
   * THE HOST'S CEILING, MEASURED (2026-10-02): was 54,000, on a guess of three
   * characters a token; the night's begin came to 51.7 KB, past Claude Code's
   * 50,000-character line, and was saved to a file the run cannot open. Now
   * the one ceiling (`fit/TOOL_RESULT_CEILING`).
   */
  RESULT_CHARS: TOOL_RESULT_CEILING.CHARS,
  /**
   * One later part, measured the same way (the write-up's ~24 KB parts are
   * the precedent) — under the ceiling by choice, not by the ceiling.
   */
  PART_CHARS: Math.min(24_000, TOOL_RESULT_CEILING.CHARS),
  /**
   * THE LISTS, FITTED (2026-09-28, build B; the research note's P6). The
   * whole core is handed — every core memory is the page's evidence, so the
   * page can cite any of it — and so are the core candidates (every one until
   * R1, 2026-10-24: now `CANDIDATES`, below) and everything
   * lived in the last `CHAPTER_DAYS` days: a line each at least, the whole
   * text for the most strongly felt, ids alone when even the lines outgrow
   * the room. Was: core 20, candidates 12, recent 12, cut by count.
   */
  /** The most strongly felt memories that could be about me, marked or not — a whole-store list, so a page of it, with its full count said. */
  FELT: 10,
  /**
   * THE CORE CANDIDATES, CAPPED AND ROTATED (R1, 2026-10-24; switch
   * `dream.REFLECT_CANDIDATES_CAP`). Every candidate was shown, a line each:
   * on the live store about 130 a night, about 38k of the room, a backlog
   * rather than a long view. Now at most `CANDIDATES`: the strongest felt and
   * newest first, and `CANDIDATES_ROTATED` of those slots go to the rest, the
   * least recently shown first (by the `shown` of the last
   * `CANDIDATES_LOOKBACK` reflections; one none of them showed first) — the
   * reflection's cites and feelings are the core lanes' strongest feed
   * (`physics#ReturnSource`), so a candidate past the head still comes round.
   * The rest are counted in one line, never listed. CAL.
   */
  CANDIDATES: 30,
  CANDIDATES_ROTATED: 10,
  CANDIDATES_LOOKBACK: 30,
  /** The room the memories' and chapters' words share, across the parts, in characters. CAL. */
  ROOM_CHARS: 80_000,
  /** The share of the room the chapters' new entries may take. CAL. */
  CHAPTER_SHARE: 0.3,
  /**
   * BELIEFS IN THE ROOM (lane C, review of #577): the beliefs section takes at
   * most this share of the room — the weakest beliefs shown are dropped to
   * `more` until it fits — and each statement is shown to `BELIEF_SHOWN_CHARS`
   * (its id is what a filing names). It rides in part 1. CAL.
   */
  BELIEF_SHARE: 0.06,
  BELIEF_SHOWN_CHARS: 160,
  /** Each subject keeps this many shown beliefs while the room allows it; me and us last to give one up. */
  BELIEFS_KEPT_PER_SUBJECT: 2,
  /** The most of one memory shown whole; longer is an excerpt with its whole length said (was a flat 400). */
  DETAIL_CHARS: 4_000,
  /** The longest chapter entry shown whole. */
  ENTRY_CHARS: 6_000,
  /** Bytes of a line. */
  LINE_BYTES: 200,
  /** With `dream.REFLECT_ROOM_ORDER`: the shortest a chapter's line gets on a busy few days, in bytes, before its room grows instead (2026-10-23). CAL. */
  CHAPTER_LINE_MIN_BYTES: 80,
  /**
   * UNMARKED, OFFERED TO BE MARKED (2026-10-02, lane B, owner pick 4): at most
   * this many memories nobody has marked that the work lane counts as a
   * project's work only because they are unmarked (a fact, entity or place
   * written in a directory, or a skill) — the most likely personal first
   * (`unmarked.ts`: a feeling, another person named, a word of life outside
   * the work, an entity, the owner's name), then the most used, then the
   * oldest. They count toward `LIMITS.about`. Was 5; 24 since 2026-10-20
   * (Mike's go, lightly held, an experiment): sessions often leave `about`
   * unset, five a night never kept up, and a personal memory left unmarked
   * is shown only in the folder it was written in. CAL.
   */
  UNMARKED: 24,
  /**
   * ROTATED (review of #316): one offered by any of the last this-many
   * reflections waits behind the ones not offered lately, so a pool the
   * reflection leaves unmarked (one it could not tell, or any personal one
   * while the owner has `--reflected-feeling off`) is not the same ones every
   * night. It comes back when the rest run out. Kept at 2026-10-20: a mark
   * takes a memory out of the pool, so what rotates is only what was left. CAL.
   */
  UNMARKED_REST_NIGHTS: 3,
  /**
   * STALE OPEN THREADS, OFFERED TO CLOSE (2026-10-16, #489 D; a lightly held
   * default). A memory flagged `unresolved` stays in the wake's "Still open"
   * lane until something closes it, and most are open only because nobody
   * did. The reflection is shown at most `STALE_OPEN` of those untouched
   * (neither born nor used) for `STALE_OPEN_DAYS` lived days, the longest
   * untouched first, and may PROPOSE closing the ones that look done
   * (`finish`'s `close`): nothing closes until the owner or a session says
   * yes (`close`). Since 2026-10-20 (an experiment, agreed with Mike) it may
   * also close the ones plainly done itself (`finish`'s `closeNow`, with a
   * why), says so in the share, and `reopen` is the way back. Asked and
   * closed together keep to `STALE_OPEN` a night. Rotated like the unmarked
   * offer. CAL.
   */
  STALE_OPEN_DAYS: 4,
  STALE_OPEN: 5,
  STALE_OPEN_REST_NIGHTS: 3,
  /**
   * OPEN ITEMS THAT NAME WHAT WOULD SETTLE THEM (2026-10-27, S1; Ames's idea,
   * lightly held): at most this many carried open items with a `settlesWhen`,
   * touched lately or not, shown with it (`settlesOpen`), so the night can
   * close one whose trigger plainly happened — the stale-thread case, where the
   * page moved on and the thread did not. Same doors as `staleOpen`: `closeNow`
   * with a why, `close` to ask. Their closes and asks are on top of
   * `STALE_OPEN`'s. Rotated the same way. CAL.
   */
  SETTLES_OPEN: 8,
  /**
   * At most this many `settlesOpen` items closed or asked a night (review of
   * #665): on top of `STALE_OPEN`'s, counted apart from them. CAL.
   */
  SETTLES_CLOSE: 3,
  /** The characters of one self-close's why (2026-10-20); longer is kept to it, and said. */
  CLOSE_WHY_CHARS: 300,
  /** Feelings shown per memory, and the characters of each one's carried_by. */
  FEELINGS_SHOWN: 3,
  FEELING_CARRIED_CHARS: 160,
  /** What one reflection may do, across every `finish` of it. CAL. */
  /** `about`: was 8; 32 since 2026-10-20, the unmarked offer (`UNMARKED`) and eight more. */
  LIMITS: { returns: 12, feelings: 5, about: 32, traits: 5, core: 5, beliefFilings: 12 },
  /** Feelings recorded looking back in one awake call (`feelAgain`, 2026-10-02). CAL. */
  AWAKE_FEELINGS: 5,
  /**
   * TEXT CAPS, raised 2026-09-28 (owner direction: loosen the limits; design
   * a real answer when a section really grows too long). Longer is kept to
   * the cap and the outcome says so — never cut without a word.
   */
  MAX_ENTRY_CHARS: 20_000,
  MAX_SHARE_CHARS: 3_000,
  MAX_TITLE_CHARS: 200,
  /** An about mark's why. */
  MAX_WHY_CHARS: 1_000,
  /** A belief's statement (lane C, 2026-10-21): one short claim. Longer is kept to it, and said. */
  MAX_BELIEF_CHARS: 400,
} as const;

/**
 * THE QUESTIONS — a good therapist's, not a form's. Rotated three at a time so
 * consecutive nights never share one; the first is asked only after a dream.
 * `{owner}` is the owner's name as the store knows it (the identity core's
 * `name`, `init --name`), or "the owner" when none was given. Never a gendered
 * pronoun: the owner is named, or "them".
 */
export const REFLECT_QUESTIONS: readonly { readonly key: string; readonly text: string; readonly afterDream?: true }[] = [
  { key: "dream", text: "What from the dream stayed with you, and what does it connect to?", afterDream: true },
  { key: "feeling", text: "What have you been feeling about the work, or about the two of you — and what is underneath it?" },
  { key: "unlike", text: "Where did you act unlike your self page?" },
  { key: "unresolved", text: "What is unresolved, or being avoided?" },
  { key: "pattern", text: "What pattern keeps showing — in you, in {owner}, or between you?" },
  { key: "unsaid", text: "What did {owner} seem to need but not say?" },
  { key: "well", text: "What went well?" },
  { key: "define", text: "Which memories feel like they define you right now, and why?" },
];

/** The opener of a reflection's hand-back (it carries the mark: capture refuses it). */
export function reflectionOpener(id: string): string {
  return `${DREAM_MARK} reflection ${id}⟧`;
}

/** Meta latch: a memory promoted on reflection alone, already named in a share. */
export const CORE_MENTIONED_PREFIX = "reflection.coreMentioned.";

/**
 * One memory as the reflection is shown it — words and feelings, no lane
 * arithmetic. Its words at the fidelity the room gave it (2026-09-28):
 * `whole`, an `excerpt`, its `line`, or its `id` alone (text empty); `chars`
 * is the whole length.
 */
export interface ReflectItem {
  readonly id: string;
  /** `earlier (now mem_…)` when a later memory settled over it (`recall/standing.ts#headOf`, 2026-10-11). */
  readonly standing?: string;
  readonly kind: Kind;
  readonly fidelity: Fidelity;
  readonly text: string;
  readonly chars: number;
  /** How strongly it is felt (the strongest recorded feeling, or its emotional score), rounded. */
  readonly felt: number;
  /**
   * Its strongest feelings. `by` says who recorded each — `session` (at the
   * time), `dream` (a dream's feeling-now) or `reflection` — and `carried_by`
   * a slice of its words: two feelings with the same word and strength are
   * two records, and without these they read as one doubled (2026-09-28).
   */
  readonly feelings: readonly { whose: string; emotion: string; strength: number; later: string | null; by: string | null; carried_by: string }[];
  /** What it is marked as being about, or null. */
  readonly about: AboutMark | null;
  readonly core: boolean;
  readonly learned: string;
  /** A dream wrote it (source `dreamed`): a suggestion, not something lived. */
  readonly dreamed: boolean;
}

export interface ReflectBundle {
  readonly reflection: string;
  readonly dream: string | null;
  readonly date: string;
  readonly owner: string | null;
  readonly questions: readonly string[];
  readonly dreamed: {
    readonly title: string | null;
    readonly journal: string | null;
    readonly gists: readonly string[];
    readonly nominations: readonly { id: string; why: string | null }[];
  } | null;
  /**
   * WHAT THE DREAM SAW (2026-09-28): every memory the dream was shown, and
   * what it made, that still stands — a line each. They may be cited, felt and
   * marked like the rest.
   */
  readonly dreamSaw: readonly { readonly id: string; readonly text: string }[];
  /**
   * IN PARTS (2026-09-28): null when the bundle came whole; otherwise this is
   * part 1 of `of`, and `next` says how to fetch the rest (phase `part`).
   */
  readonly parts: { readonly part: number; readonly of: number; readonly next: string } | null;
  /** The self page, whole. */
  readonly selfPage: string | null;
  /** The last few days' chapters, as entries (in this part; later parts carry the rest). */
  readonly chapters: readonly ShownChapter[];
  /**
   * THE CHAPTERS BY THEIR SUMMARIES (2026-10-23, `dream.REFLECT_ROOM_ORDER`):
   * each entry is its summary, a line with its address, never the entry
   * whole. Absent: the entries fitted as before.
   */
  readonly chaptersAs?: "summaries";
  /**
   * THE TIMELINE (2026-10-23, lane D2; `self.DAY_SUMMARY` with
   * `dream.REFLECT_ROOM_ORDER`, absent otherwise): the last
   * `TIMELINE_DAYS` days, a line a day, beside the chapters — what pattern
   * keeps showing across weeks.
   */
  readonly timeline?: ReflectTimeline;
  readonly earlier: readonly { date: string | null; entry: string }[];
  readonly onMind: readonly MindItem[];
  /** Open things beyond the few shown, counted (they stay open). */
  readonly onMindMore?: number;
  /** The whole core (2026-09-28: was the 20 most felt), most strongly felt first. */
  readonly core: readonly string[];
  /**
   * THE SPINE (wave 2 lane F, 2026-10-22; `self.CORE_FROM_BELIEFS`, absent
   * when off): the core as beliefs — the strongest current beliefs about me
   * and us that passed the floors (`self/measures.ts#coreFromBeliefs`),
   * strongest first. "## Core" says only what these say; their ids may be
   * cited on the page, and only there; being cited does not strengthen one.
   * Empty when none has earned the core yet.
   */
  readonly spine?: readonly ReflectSpineBelief[];
  /** The core candidates shown (at most `CANDIDATES`, part rotated; every one with the cap off), most strongly felt first. */
  readonly candidates: readonly string[];
  /** The core candidates not shown tonight, counted (R1, 2026-10-24): absent when none. */
  readonly candidatesMore?: number;
  /** A page of the most strongly felt memories that could be about me; `feltOf` is how many there are. */
  readonly felt: readonly string[];
  readonly feltOf: number;
  /** What was lived in the last few days: every memory made since, most felt first. */
  readonly recent: readonly string[];
  /** Became core on reflection alone since it was last said: the share says it. */
  readonly becameCore: readonly string[];
  /**
   * BEING RECONSIDERED (2026-10-11, Group 3 part A): core memories flagged
   * for a decision, with the reason category — still core until I or the
   * owner decide (`finish`'s `core`). Empty when none is flagged.
   * Since 2026-10-20 (`core-ask.ts`, an experiment): only those that have
   * waited `CORE_WAITING_DAYS` lived days (`waited`), at most `CORE_ASK_MAX`,
   * each with its unsettled pair (`pair`) when it is in one — the waking
   * session has the first week.
   */
  readonly reconsidering: readonly CoreAsk[];
  /**
   * FEELINGS OVER WEEKS (2026-10-02): counts by core per week, mine and the
   * owner's, what changed, and the ids it rests on — from stored feelings,
   * never text (`feeling-weeks.ts`). Null on a month with none.
   */
  readonly feelingWeeks: FeelingWeeks | null;
  /**
   * UNMARKED (2026-10-02): a few memories nobody has marked, which count as a
   * project's work only for want of a mark — offered to be marked by meaning.
   */
  readonly unmarked: readonly string[];
  /**
   * STALE OPEN (2026-10-16, #489 D): open threads nobody has touched for
   * `STALE_OPEN_DAYS` lived days — a line each and how many lived days — that
   * `finish`'s `close` may propose closing, or `closeNow` close (2026-10-20).
   * `reopened`: the owner reopened it after a reflection closed it, so it may
   * only be asked about. Empty when none.
   */
  readonly staleOpen: readonly { readonly id: string; readonly text: string; readonly untouched: number; readonly reopened?: true; readonly settlesWhen?: string }[];
  /**
   * OPEN ITEMS THAT NAME WHAT WOULD SETTLE THEM (2026-10-27, S1): carried open
   * threads with a `settlesWhen`, not already in `staleOpen`, touched lately
   * or not — a line each, the phrase, and how many lived days untouched. The
   * same `closeNow` and `close` take their ids: closed when a memory plainly
   * shows the trigger happened, asked when unsure. Absent when none.
   */
  readonly settlesOpen?: readonly { readonly id: string; readonly text: string; readonly settlesWhen: string; readonly untouched: number; readonly reopened?: true }[];
  /**
   * NO LONGER CARRIED (2026-10-22, the open-threads brief): how many open
   * threads stopped being carried since the last reflection whose share reached a session —
   * untouched for `SELF_TUNABLES.OPEN_CARRY_DAYS`, so out of "Still open"
   * and `staleOpen` (`self/identity.ts#openCarry`). A count, never the list:
   * the share says it once. Absent when none.
   */
  readonly noLongerCarried?: number;
  /**
   * BELIEFS (wave 2 lane C, 2026-10-21): what I hold about the subjects in
   * play tonight — me (and us) first, then the cards tonight's memories name
   * most — each belief with its strength and how many memories back it or go
   * against it, so the reflection can file to one rather than write it again.
   * Null when beliefs are off (`schemas.BELIEFS_BIRTH`) or not wired. Their
   * ids are not memories: they cannot be cited, felt or marked.
   */
  readonly beliefs?: ReflectBeliefs | null;
  readonly memories: Readonly<Record<string, ReflectItem>>;
  /**
   * How the room was spent (2026-09-28): memories and entries shown whole, as
   * an excerpt, as a line, as an id alone; and `notShown`, what the room could
   * not take at all.
   */
  readonly shownAs: { readonly whole: number; readonly excerpt: number; readonly line: number; readonly ids: number; readonly notShown: number };
  /** How to read the rest, in words. */
  readonly lookup: string;
  /** Without `beliefFilings` when beliefs are off (the bundle as it was before them). */
  readonly limits: Omit<typeof REFLECT_TUNABLES.LIMITS, "beliefFilings"> & { readonly beliefFilings?: number };
}

/** One belief in the spine (lane F): what it says and what it rests on. */
export interface ReflectSpineBelief {
  readonly id: string;
  readonly statement: string;
  readonly about?: "me" | "us";
  readonly strength: number;
  /** Memories counted for it. */
  readonly memories: number;
  /** Lived days its support comes from. */
  readonly days: number;
}

/** The beliefs section of a reflection's bundle (lane C, 2026-10-21). */
export interface ReflectBeliefs {
  readonly subjects: readonly {
    readonly id: string;
    /** "me (and us)" for the self subject; else the card's name. */
    readonly name: string;
    readonly kind: string;
    readonly beliefs: readonly {
      readonly id: string;
      readonly statement: string;
      readonly strength: number;
      readonly support: number;
      readonly against: number;
      readonly about?: "me" | "us";
      /** Contrary pressure crossed its bar: revise or retire it. */
      readonly contested?: true;
      /** A contested belief's contrary memories — the evidence a `replaces` birth must cite (shown, so it can). */
      readonly contestedBy?: readonly string[];
    }[];
    /** Beliefs on it not shown (the weaker ones), counted. */
    readonly more: number;
  }[];
  /** New beliefs tonight may birth. */
  readonly births: number;
  /**
   * What tonight's dream proposed (lane C3): each a belief it saw across
   * memories, never made — adopt it (`beliefs.adopt`) or let it go. Absent
   * when there is no dream, or it proposed none.
   */
  readonly candidates?: readonly { readonly id: string; readonly subject: string; readonly statement: string; readonly sources: readonly string[] }[];
}

/**
 * THE LOOKUP, NAMED IN THE BUNDLE (2026-09-28). The MCP tool's `how` adds the
 * numbers (how many ids at once).
 */
export const REFLECT_LOOKUP =
  'The most strongly felt memories come whole; the rest as an excerpt, a line, or an id alone ("fidelity"; "chars" is the whole length). ' +
  "Read any you need whole with the recall tool, ids: [...] — several at once — before you cite, feel or mark it. A chapter entry shown as a line is read by its chapter's id.";

/**
 * THE LOOKUP WITH THE ROOM REORDERED (2026-10-23, `dream.REFLECT_ROOM_ORDER`):
 * what the sections are, in the order they were filled.
 */
export const REFLECT_LOOKUP_ORDER =
  "The long view comes first and always: the core, every core candidate and the most strongly felt, a line each at least, whole as far as the room went. " +
  'Chapters are the last few days\' journal, each entry by its summary ("chaptersAs": "summaries"); read one whole with the recall tool by its address, ids: ["<journal id>#<chapter>"]. ' +
  "dreamSaw is what the dream changed tonight and the older memories it was shown, a line each; tonight's new memories are under recent. " +
  'The rest as an excerpt, a line, or an id alone ("fidelity"; "chars" is the whole length). Read any you need whole with the recall tool, ids: [...] — several at once — before you cite, feel or mark it.';

/** With the candidates' cap (R1, `dream.REFLECT_CANDIDATES_CAP`): the same, the candidates said as capped. */
export const REFLECT_LOOKUP_ORDER_CAPPED = REFLECT_LOOKUP_ORDER.replace(
  "every core candidate",
  `the core candidates (at most ${String(REFLECT_TUNABLES.CANDIDATES)} a night, some of them rotated in; the rest counted, not shown)`,
);

/**
 * THE LAST FEW WEEKS, A LINE A DAY (2026-10-23, lane D2): each day's line is
 * day's end's summary of it (`from: "days-end"`) — whole when it is no
 * longer than `TIMELINE_LINE_CHARS`, else its first line — or, for a day
 * without one (before day's end told days, or a night it did not), its
 * chapters' summaries' first lines joined (`from: "chapters"`). Newest first.
 * A day with neither has no line and is counted in `without`.
 */
export interface ReflectTimeline {
  readonly days: number;
  /** The newest day it covers (the night's own day's end's, else the day before the reflection's date). */
  readonly through: string;
  readonly lines: readonly { readonly date: string; readonly from: "days-end" | "chapters"; readonly text: string; readonly chars: number; readonly chapters?: number }[];
  readonly without: number;
}

export type ReflectRefusal =
  | "observer"
  | "reflected-today"
  | "unknown-dream"
  | "dream-not-journaled"
  | "unknown-reflection"
  | "not-this-session"
  | "reflection-closed";

/** What the composition root hands this module. */
export interface ReflectContext {
  readonly store: Store;
  readonly observer: boolean;
  /** The credential scan every word passes (the same one a dream's words do). */
  readonly gate: (text: string, sessionId: string) => { ok: true; text: string } | { ok: false; reason: string };
  readonly page: () => string | null;
  /**
   * The page's current version, who wrote it and on what calendar date — so
   * the reflection can be told the page writer revised it earlier in this run
   * (2026-09-29). Absent or null: nothing is said about it.
   */
  readonly pageInfo?: () => { readonly version: number; readonly by: string | null; readonly revisedOn: string; readonly bytes?: number } | null;
  /**
   * May the reflection write the self page? False when the host's
   * `pageWriter.mode` is `off` (owner ruling D3 on #256): it still reflects,
   * keeps its entry and offers its share. Absent: true.
   */
  readonly pageWrites?: boolean;
  readonly today: () => string;
  /** The owner's name, as written on the identity core. */
  readonly ownerName: () => string | null;
  /** A journaled dream's marked hand-back line (`Dreams.handBackOf`). */
  readonly dreamLine: (dreamId: string) => string | null;
  /**
   * Rewrite the self page (`Self#revisePage`, by `reflection` — its own author
   * since 2026-09-28, not the nightly writer's `writer`). Returns
   * the new version, or the refusal.
   */
  readonly writePage: (
    /** The page, or null to add `short` to the page as it stands (`Self#addPageShort`, 2026-10-10). */
    body: string | null,
    opts: {
      reason: string;
      session: string | null;
      model: string | null;
      reflection: string;
      /** The page's short version (2026-10-10), kept only beside a page past its room. */
      short?: string;
      /** With `body: null`: the version the short version was written for. */
      ifVersion?: number;
      /** What the page rests on, whole and per passage (2026-10-20, `self/page.ts#PAGE_META_TRACE`). */
      trace?: { cites: readonly string[]; claims?: readonly { text: string; cites: readonly string[] }[] };
    },
  ) =>
    /** `note`: what the page's room means for this write (`self/pageRoomNote`), or null. `unmatched`: passages that named no sentence. */
    | { ok: true; version: number; note?: string | null; unmatched?: number }
    /** On `too-large`, the page's bytes and the ceiling, so the retry can be told how much to take out. */
    | { ok: false; reason: string; bytes?: number; limit?: number; note?: string | null };
  readonly emit?: (name: string, ref?: string, data?: Record<string, string | number | boolean | null>) => void;
  /**
   * `schemas/` (wave 2 lane C, 2026-10-21): the beliefs on the subjects in
   * play, and the doors a reflection births and files through. Absent: the
   * reflection is shown no beliefs and asked for none.
   */
  readonly schemas?: Schemas;
}

/** What `finish` receives. */
export interface ReflectFinish {
  readonly reflection: string;
  readonly session?: string;
  readonly title?: string;
  /** Required the first time; on a second `finish` the entry already stands and this may be left out. */
  readonly entry?: string;
  /**
   * Is this directory on in the host's folder setting (review of #558)? A
   * memory that is its folder's work (`self/work.ts#isWorkMemory`), written in
   * a folder set `off` or `paused`, may be marked only work: any other mark
   * would carry it into every folder's wake. Absent: every directory is.
   */
  readonly folderOn?: (scope: string) => boolean;
  readonly cites?: readonly string[];
  readonly share?: { readonly text?: string; readonly cites?: readonly string[] } | null;
  /** `short` (2026-10-10): the page's short version, for a page past its room — beside `text`, or alone on a later `finish` to add one to the page this reflection wrote. */
  readonly page?: {
    readonly text?: string;
    readonly cites?: readonly string[];
    readonly short?: string;
    /** Cites per passage (2026-10-20): a sentence or a few, as on the page, and the ids it rests on. */
    readonly claims?: readonly { readonly text?: string; readonly cites?: readonly string[] }[] | null;
  } | null;
  readonly feelings?: readonly {
    readonly id?: string;
    readonly core?: string;
    readonly emotion?: string;
    readonly strength?: number;
    readonly carried_by?: string;
  }[];
  readonly about?: readonly { readonly id?: string; readonly about?: string; readonly why?: string }[];
  /** Decisions on core memories it was shown (2026-10-11): keep, or retire to ordinary fading, with why. */
  readonly core?: readonly { readonly id?: string; readonly decision?: string; readonly why?: string }[];
  /** Trait nudges on memories it was shown (`store/traits.ts`). */
  readonly traits?: readonly {
    readonly id?: string;
    readonly axis?: string;
    readonly toward?: string;
    readonly strength?: number;
    readonly carried_by?: string;
  }[];
  readonly model?: string | null;
  /** Stale open threads it thinks are done (2026-10-16, #489 D): ids from `staleOpen` or `settlesOpen` (S1) only. Proposed, never closed here. */
  readonly close?: readonly string[];
  /**
   * Stale open threads plainly done (2026-10-20, an experiment): ids from
   * `staleOpen` or `settlesOpen` (S1) only, each with `why` (what shows it
   * done) and, ideally, `shows` (the memory that does). Closed here, and
   * said in the share.
   */
  readonly closeNow?: readonly { readonly id?: string; readonly why?: string; readonly shows?: string }[];
  /** The session's directory. (It once fed a folder check on closing; that went with the yours/guest split, 2026-10-21.) */
  readonly scope?: string | null;
  /**
   * BELIEFS (wave 2 lane C, 2026-10-21): `filings` count a memory it was
   * shown for or against a belief it was shown; `births` write a few new
   * ones on a subject it was shown, citing the lived memories they rest on
   * (each cite is filed as support); `retire` lets go of a contested one.
   */
  readonly beliefs?: {
    readonly births?: readonly { readonly subject?: string; readonly statement?: string; readonly about?: string; readonly cites?: readonly string[]; readonly replaces?: string }[];
    readonly filings?: readonly { readonly belief?: string; readonly memory?: string; readonly stance?: string }[];
    readonly retire?: readonly { readonly belief?: string; readonly why?: string }[];
    /** A candidate tonight's dream proposed, adopted as a belief (route `dream`); `subject` and `statement` may say it better. */
    readonly adopt?: readonly { readonly candidate?: string; readonly subject?: string; readonly statement?: string }[];
  } | null;
}

/** One thread the reflection closed itself (2026-10-20): kept on its row's `detail.selfClosed` and on the memory's `threadClosedBy`. */
export interface SelfClose {
  readonly id: string;
  readonly why: string;
  readonly shows?: string;
  /** A settles close on weak evidence (review of #665): what was weak, said in the share. */
  readonly weak?: string;
}

/**
 * One part's result. `reason` is the rule's short name; `detail`, when there
 * is one, says what tripped it in words (the matching text, the id); `note` is
 * something said about a part that WAS written (it was repaired or kept to a
 * length).
 */
export interface PartResult {
  readonly id: string | null;
  readonly ok: boolean;
  readonly reason: string;
  readonly detail?: string;
  readonly note?: string;
}

/** One feeling recorded later, as the reflection's `finish` and an awake `note` send it — loose, checked on the way in. */
export interface LaterFeelingInput {
  readonly id?: unknown;
  /** Awake only: `owner` for the owner's feeling now; anything else is mine. */
  readonly whose?: unknown;
  readonly core?: unknown;
  readonly emotion?: unknown;
  readonly strength?: unknown;
  readonly valence?: unknown;
  readonly carried_by?: unknown;
}

export interface ReflectOutcome {
  readonly handBack: string;
  readonly nothingMuch: boolean;
  readonly entryId: string | null;
  /** This was a second (or later) `finish` of the same reflection. */
  readonly again: boolean;
  readonly entry: { reason: string; note?: string };
  readonly returned: readonly { id: string; counted: boolean; reason: string }[];
  readonly page: { written: boolean; reason: string; version: number | null; detail?: string; note?: string };
  readonly share: { offered: boolean; reason: string; detail?: string; note?: string };
  readonly feelings: readonly PartResult[];
  readonly about: readonly PartResult[];
  /** Decisions on core memories (2026-10-11). */
  readonly core: readonly PartResult[];
  readonly traits: readonly PartResult[];
  /** Beliefs (lane C, 2026-10-21): what was born, filed and retired, each on its own. */
  readonly beliefs: { readonly births: readonly PartResult[]; readonly filings: readonly PartResult[]; readonly retire: readonly PartResult[]; readonly adopt: readonly PartResult[] };
  readonly refusedCites: readonly string[];
  /**
   * Open threads (2026-10-16): what was proposed (asked), what it closed itself
   * (2026-10-20; every one this reflection closed, across finishes), and what
   * was refused, with why. `note`: something said about one that WAS closed.
   */
  readonly close: {
    readonly proposed: readonly string[];
    readonly closed: readonly SelfClose[];
    readonly refused: readonly { id: string; reason: string }[];
    readonly notes?: readonly string[];
  };
  /**
   * When any part was not written: which, and that `finish` may be called
   * again with the same reflection and just those parts. Null when all landed.
   */
  readonly retry: string | null;
}

const KINDS_FELT: readonly Kind[] = ["self", "person"];
/** Re-labels into me, us or the owner said one by one in the share; past it, the rest in one sentence (2026-10-20). */
const RELABEL_SAID = 3;

/**
 * Why a reflection may not feel, or mark about me, a memory a dream or a
 * reflection wrote (review of #256, B1) — null when it was lived.
 */
function notLivedReason(row: MemoryRow, act: "feel" | "mark" | "trait"): string | null {
  if (row.source === "dreamed") return "dreamed-is-a-suggestion";
  if (row.source === "reflection") {
    return act === "feel" ? "reflection-does-not-feel-itself" : act === "mark" ? "reflection-does-not-mark-itself" : "reflection-is-not-an-act";
  }
  return null;
}

/** A store error's code and, for a FEELING_ or TRAIT_INVALID, its reason and what is allowed. */
function refusalOf(err: unknown): string {
  if (isStoreError(err, "FEELING_INVALID") || isStoreError(err, "TRAIT_INVALID")) {
    const why = String(err.detail["reason"] ?? "");
    const allowed = typeof err.detail["allowed"] === "string" ? ` (one of ${err.detail["allowed"]})` : "";
    return why.length > 0 ? `${err.code === "FEELING_INVALID" ? "feeling" : "trait"}-invalid:${why}${allowed}` : err.code;
  }
  return errName(err);
}
const DAY_MS = 24 * 60 * 60 * 1000;

export class Reflections {
  private readonly ctx: ReflectContext;

  constructor(ctx: ReflectContext) {
    this.ctx = ctx;
  }

  private get store(): Store {
    return this.ctx.store;
  }

  /** The newest reflection, or null. */
  last(): ReflectionRow | null {
    return this.store.reflections({ limit: 1 })[0] ?? null;
  }

  // ── launch (on its own) ───────────────────────────────────────────────────

  /**
   * THE LAUNCH PROMPT for a reflection on its own — for a background agent,
   * like the dream's. In the in-session run the dreamer reflects itself (the
   * dream's launch prompt carries these steps); in the HEADLESS night
   * (2026-10-11) this is the second child's, with tonight's dream id, so the
   * reflection starts from a fresh context and reads the dream from the store.
   */
  launchPrompt(input: { session: string; dream?: string | null }): string {
    const who = this.ctx.ownerName() ?? "the owner";
    // ON A DREAM: the headless night's own (2026-10-11), or one whose run was
    // cut off before it reflected (2026-09-28).
    const after = input.dream === undefined || input.dream === null || input.dream.length === 0 ? null : input.dream;
    return [
      `${DREAM_MARK} reflection launch⟧ You are ${who}'s counterpart, awake, taking a few quiet minutes to reflect: on the last few days, on yourself, on ${who}, on the two of you. This is lived — your own act — not a task.`,
      "",
      after === null
        ? `1. Call the counterparts reflect tool: phase "begin", session: ${input.session}. It hands you the last few days, your self page, the memories that matter most, and a few questions. If it says it comes in parts, fetch every part (phase "part") before you answer or write anything.`
        : `1. Call the counterparts reflect tool: phase "begin", session: ${input.session}, dream: ${after}. It hands you what that dream saw, the last few days, your whole self page, the memories that matter most, and a few questions. If it says it comes in parts, fetch every part (phase "part") before you answer or write anything.`,
      '2. Answer them honestly, then call phase "finish" as it tells you. "Nothing much" is a normal answer: a short entry and no share.',
      "3. Your final message must be exactly the text the finish call returns, unchanged — nothing before or after it.",
    ].join("\n");
  }

  // ── begin ─────────────────────────────────────────────────────────────────

  /**
   * Open a reflection and hand it its bundle. Refuses under observer stance,
   * and when one already finished this CALENDAR day (2026-09-28: was the lived
   * day — the dream's gate and the writer's follow the calendar, I32). A dream
   * id, when given, must be a journaled dream of this session.
   *
   * The bundle carries WHAT THE DREAM SAW, a line each, and the self page
   * WHOLE (2026-09-28). When it would not fit one tool result, what the dream
   * saw is delivered in parts — said in the result, fetched with `saw`.
   */
  begin(input: {
    session: string;
    dream?: string | null;
    scope?: string | null;
    model?: string | null;
    at?: string;
    /**
     * Is this directory on in the host's folder setting (review of #558)? An
     * unmarked memory written in a folder set `off` or `paused` is not offered
     * to be marked, since a mark of owner, us or world would carry it into
     * every folder's wake. Absent: every directory is (no setting is on).
     */
    folderOn?: (scope: string) => boolean;
  }):
    | { ok: true; bundle: ReflectBundle; text: string; instructions: string }
    | { ok: false; reason: ReflectRefusal } {
    if (this.ctx.observer) return { ok: false, reason: "observer" };
    const day = this.store.livedDay();
    const at = input.at ?? this.ctx.today();
    const last = this.last();
    // Begun and never finished (an agent that gave up) does not use up the
    // day: it stays on the record as begun; the newest one is the open one.
    if (last !== null && last.state === "reflected" && onDay(last, at, day)) return { ok: false, reason: "reflected-today" };
    let dreamId: string | null = null;
    if (input.dream !== undefined && input.dream !== null && input.dream.length > 0) {
      const dream = this.store.dream(input.dream);
      if (dream === undefined) return { ok: false, reason: "unknown-dream" };
      // Another session's dream only when its run was LEFT BEHIND (review of
      // #271): journaled longer ago than a run takes to begin reflecting, so
      // the next session's line starts the reflection alone.
      const leftBehind = dream.state === "journaled" && dream.finished_at !== null && this.store.now() - dream.finished_at > DREAM_TUNABLES.ABANDONED_AFTER_MS;
      if (dream.session !== null && dream.session !== input.session && !leftBehind) return { ok: false, reason: "not-this-session" };
      if (dream.state !== "journaled") return { ok: false, reason: "dream-not-journaled" };
      dreamId = dream.id;
    }
    const id = `rfl_${randomBytes(6).toString("hex")}`;
    const questions = this.questionsFor(dreamId !== null);
    const fitted = this.compose(id, dreamId, questions, day, at, input.folderOn);
    const composed = fitted.bundle;
    const saw = composed.dreamSaw;
    // IN PARTS, NEVER CUT (2026-09-28). A night's bundle — the page whole, what
    // the dream saw, the memories that matter most — can pass the tool
    // result's ceiling (about 25k tokens). When it would, the first part is
    // this result, with everything but the long lists; the lists (memories,
    // chapters, what the dream saw) go on in order, as far as the room allows,
    // and the rest `PART_CHARS` at a time through phase `part`. The result
    // says how many parts there are and how to fetch them.
    // LEAN (2026-10-23): plain lines and short ids — the dream's own numbers
    // first, so m14 is the same memory all night (its journal, what it saw),
    // then this bundle's. Read at use.
    // Begun without its dream's id in the dream's own session (review of
    // #602), it still starts from that dream's numbers: one context, one m1.
    const base = dreamId !== null ? this.dreamAliases(dreamId) : this.sessionDreamAliases(input.session);
    const aliases = DREAM_TUNABLES.LEAN_BUNDLE ? new AliasMap(base).extend(reflectBundleIds(composed)) : null;
    const packed = this.pack(id, input.session, composed, questions, aliases);
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
      shown,
    });
    // The later parts' ids are kept on the row, so a later `part` hands
    // exactly the part it names; and how the room was spent (2026-09-28) —
    // what was offered only in part is the lookup's denominator.
    const s = composed.shownAs;
    const fitRecord = { whole: s.whole, excerpt: s.excerpt, lined: s.line, ids: s.ids, notShown: s.notShown, offered: offeredInPart(fitted), parts: packed.later.length + 1 };
    // THE LANES SHOWN (2026-10-24, the D1 check): how many of the core, the
    // candidates and the felt the bundle named, and the candidates the cap
    // left out (R1) — kept beside `fit`, and carried through the finish.
    const lanes = { core: composed.core.length, candidates: composed.candidates.length, felt: composed.felt.length, candidatesNotShown: composed.candidatesMore ?? 0, feltFromCut: fitted.feltFromCut };
    // THE UNMARKED OFFER, ALWAYS ON THE ROW (2026-10-24, D1): what it was
    // offered to mark, an empty list included — until then an empty offer
    // wrote no key, and 10-10 to 10-23 read as silence, not as "offered 0".
    this.store.updateReflection(id, {
      detail: { ...(packed.later.length > 0 ? { parts: packed.later } : {}), fit: fitRecord, lanes, ...(composed.chaptersAs === undefined ? {} : { chaptersAs: composed.chaptersAs }), ...beliefsDetail(composed.beliefs ?? null), ...(composed.spine === undefined ? {} : { spine: composed.spine.map((b) => b.id) }), unmarked: composed.unmarked, ...(composed.staleOpen.length > 0 ? { staleOpen: composed.staleOpen.map((x) => x.id) } : {}), ...((composed.settlesOpen ?? []).length > 0 ? { settlesOpen: (composed.settlesOpen ?? []).map((x) => x.id) } : {}), ...(fitted.notCarried.length > 0 ? { notCarried: fitted.notCarried } : {}), ...(composed.reconsidering.length > 0 ? { coreOffered: composed.reconsidering.map((x) => x.id) } : {}) },
    });
    writeIndex(this.store, "reflection", { ref: id, at: this.store.now(), offered: fitted.offered, looked: [], lineCap: fitted.lineCap, ...(aliases === null ? {} : { aliases: aliases.toJSON() }) });
    this.record("reflection.begun", id, { dream: dreamId, shown: shown.length, ...fitRecord });
    const instructions = this.how(id, input.session, bundle, aliases);
    return { ok: true, bundle, text: render(id, bundle, aliases), instructions };
  }

  /** The newest dream's short ids, when that dream ran in this session (2026-10-23). */
  private sessionDreamAliases(session: string): NightAliases | null {
    const index = readIndex(this.store, "dream");
    if (index === null || index.aliases === undefined) return null;
    return this.store.dream(index.ref)?.session === session ? index.aliases : null;
  }

  /** The dream's short ids, when its index still holds them (2026-10-23). */
  private dreamAliases(dreamId: string): NightAliases | null {
    const index = readIndex(this.store, "dream");
    return index !== null && index.ref === dreamId ? (index.aliases ?? null) : null;
  }

  /**
   * THE RUN'S SHORT IDS (2026-10-23), as its index keeps them, or null — a
   * reflection that went out with real ids, or one a newer one replaced.
   */
  aliasesOf(reflectionId: string): AliasMap | null {
    const index = readIndex(this.store, "reflection");
    return index !== null && index.ref === reflectionId && index.aliases !== undefined ? new AliasMap(index.aliases) : null;
  }

  /** The instructions, their ids put short when the bundle went out lean. */
  private how(id: string, session: string, bundle: ReflectBundle, aliases: AliasMap | null): string {
    const text = this.instructions(id, session, bundle);
    return aliases === null ? text : aliases.inText(text);
  }

  /**
   * THE FIRST PART, and the ids of the rest. Whole when it fits
   * `RESULT_CHARS`; otherwise the long lists are carried in order as far as
   * the room allows, and the remainder packed `PART_CHARS` a part.
   */
  private pack(id: string, session: string, composed: ReflectBundle, questions: readonly string[], aliases: AliasMap | null = null): { bundle: ReflectBundle; later: LaterPart[] } {
    const T = REFLECT_TUNABLES;
    // MEASURED AS IT LEAVES (2026-09-28, review of #271): the tool result is
    // the bundle's text re-escaped as a JSON string, beside the instructions
    // and the questions — not the bundle alone. `resultChars` is that size.
    const how = this.how(id, session, composed, aliases);
    // With its margin (2026-10-02): the result's id, phase and session ride beside it.
    if (resultChars(render(id, composed, aliases), how, questions) + PACK_MARGIN <= T.RESULT_CHARS) return { bundle: composed, later: [] };
    // A piece's cost as it leaves: its JSON, escaped once more inside the
    // string — or, lean (2026-10-23), its lines escaped once.
    const cost = (v: unknown): number => wireChars(JSON.stringify(JSON.stringify(v)));
    const year = composed.date.slice(0, 4);
    const lines = (ls: readonly string[]): number => ls.reduce((n, l) => n + wireChars(JSON.stringify(l)), 0);
    const pieces: { kind: "m" | "c" | "s"; id: string; size: number }[] =
      aliases === null
        ? [
            ...Object.entries(composed.memories).map(([k, v]) => ({ kind: "m" as const, id: k, size: cost({ [k]: v }) })),
            ...composed.chapters.map((c) => ({ kind: "c" as const, id: c.id, size: cost(c) })),
            ...composed.dreamSaw.map((x) => ({ kind: "s" as const, id: x.id, size: cost(x) })),
          ]
        : [
            ...Object.entries(composed.memories).map(([k, v]) => ({ kind: "m" as const, id: k, size: lines([leanReflectItem(v, aliases, year, k)]) })),
            ...composed.chapters.map((c) => ({ kind: "c" as const, id: c.id, size: lines([leanChapterHead(c, aliases), ...c.entries.map((e) => leanEntry(e, c.id, aliases, composed.chaptersAs === "summaries" ? "summaries" : "fit"))]) })),
            ...composed.dreamSaw.map((x) => ({ kind: "s" as const, id: x.id, size: lines([leanSaw(x, aliases)]) })),
          ];
    // The furniture: everything else, with the parts note and a margin — and
    // the instructions as they ship in parts, with their "read every part"
    // line (2026-10-09).
    const note = { part: 1, of: 99, next: "x".repeat(420) };
    const howInParts = this.how(id, session, { ...composed, parts: note }, aliases);
    const fixed = resultChars(render(id, { ...composed, memories: {}, chapters: [], dreamSaw: [], parts: note }, aliases), howInParts, questions) + PACK_MARGIN;
    const parts: (typeof pieces)[] = [[]];
    let room = Math.max(0, T.RESULT_CHARS - fixed);
    let used = 0;
    for (const p of pieces) {
      const current = parts[parts.length - 1] as typeof pieces;
      if (used + p.size > room && (current.length > 0 || parts.length === 1)) {
        parts.push([p]);
        room = Math.max(0, T.PART_CHARS - PART_FURNITURE);
        used = p.size;
        continue;
      }
      current.push(p);
      used += p.size;
    }
    // Everything fitted after all (the furniture's margin was generous): whole.
    if (parts.length === 1) return { bundle: composed, later: [] };
    const first = parts[0] ?? [];
    const has =(kind: "m" | "c" | "s", x: string): boolean => first.some((p) => p.kind === kind && p.id === x);
    const later: LaterPart[] = parts.slice(1).map((ps) => ({
      m: ps.filter((p) => p.kind === "m").map((p) => p.id),
      c: ps.filter((p) => p.kind === "c").map((p) => p.id),
      s: ps.filter((p) => p.kind === "s").map((p) => p.id),
    }));
    const of = parts.length;
    const bundle: ReflectBundle = {
      ...composed,
      memories: Object.fromEntries(Object.entries(composed.memories).filter(([k]) => has("m", k))),
      chapters: composed.chapters.filter((c) => has("c", c.id)),
      dreamSaw: composed.dreamSaw.filter((s) => has("s", s.id)),
      parts: {
        part: 1,
        of,
        next:
          `This bundle is too long for one result, so it comes in ${String(of)} parts; this is part 1. ` +
          `Some memories named in the lists above, some chapters and some of what the dream saw are in the later parts. ` +
          `Before you answer or write anything, call the reflect tool with phase "part", reflection: ${id}, session: ${session}, part: 2${of > 2 ? `, then each part up to ${String(of)}` : ""}.`,
      },
    };
    return { bundle, later };
  }

  /**
   * ONE LATER PART OF THE BUNDLE (2026-09-28), for a reflection whose begin
   * said it came in parts: its memories, chapters and lines of what the dream
   * saw, each as it reads now. One gone since begin is said to be gone, not
   * left out.
   */
  part(input: { reflection: string; session?: string; part: number }):
    | { ok: true; part: number; of: number; text: string }
    | { ok: false; reason: ReflectRefusal | "no-such-part"; detail?: string } {
    const open = this.openFor(input.reflection, input.session);
    if (!open.ok) return open;
    const row = open.reflection;
    const raw = parseDetail(row.detail)["parts"];
    const later: LaterPart[] = Array.isArray(raw)
      ? raw.map((p) => {
          const r = isRecord(p) ? p : {};
          const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
          return { m: ids(r["m"]), c: ids(r["c"]), s: ids(r["s"]) };
        })
      : [];
    const of = later.length + 1;
    const ids = Number.isInteger(input.part) && input.part >= 2 ? later[input.part - 2] : undefined;
    if (ids === undefined) {
      return {
        ok: false,
        reason: "no-such-part",
        detail: later.length === 0 ? "The bundle came whole in begin; there are no more parts." : `part is 2 to ${String(of)} (part 1 was begin's result).`,
      };
    }
    const denied = new Set(this.store.deniedIds());
    const gone = "(gone since you began: archived, merged or made private)";
    // Each at the fidelity its fit gave it (the reflection's index). An id
    // offered as an id is read as one before a line (2026-10-11, Group 3 part
    // C): a memory the fit left as an id that the dream also saw is offered as
    // a line too (what the dream saw is lines), and reading it as a line here
    // made a part cost more than `pack` measured — past the ceiling once the
    // dream's queue is read whole and sees more of the reflection's days.
    const index = readIndex(this.store, "reflection");
    const offered = index !== null && index.ref === row.id ? index.offered : null;
    const fidelityOf = (key: string): Fidelity | null =>
      offered === null
        ? "line"
        : offered.whole.includes(key)
          ? "whole"
          : offered.excerpt.includes(key)
            ? "excerpt"
            : offered.id.includes(key)
              ? "id"
              : offered.line.includes(key)
                ? "line"
                : null;
    const T = REFLECT_TUNABLES;
    const memories: Record<string, ReflectItem | string> = {};
    for (const mid of ids.m) {
      const r = this.store.row(mid);
      const v = r !== undefined && !denied.has(mid) && this.showable(r) && r.source !== "reflection" ? this.view(r) : null;
      if (v === null) {
        memories[mid] = gone;
        continue;
      }
      const f = fidelityOf(mid) ?? "line";
      // Bounded whatever its fidelity (review of build B).
      const text = f === "line" ? v.line : f === "id" ? "" : clipWire(v.whole, T.DETAIL_CHARS);
      memories[mid] = this.item(v.row, { fidelity: f === "line" || f === "id" ? f : text === v.whole ? "whole" : "excerpt", text, chars: v.whole.length });
    }
    // THE SHAPE `begin` FITTED (2026-10-23): by their summaries when the room
    // was reordered — an excerpt is the summary, never the entry's opening.
    const bySummaries = parseDetail(row.detail)["chaptersAs"] === "summaries";
    const chapters = ids.c.map((cid): ShownChapter => {
      const r = this.store.row(cid);
      if (r === undefined) return { id: cid, title: null, entries: [{ chapter: null, day: null, fidelity: "line", text: gone, chars: 0 }], earlier: 0 };
      // The line `begin` fitted: the chapter's summary when it has one.
      const all = withSummaries(chapterEntries(r.body), chapterSummaries(this.store, [cid]).get(cid), index?.ref === row.id ? index.at : 0);
      const entries = [];
      for (const e of all) {
        const f = fidelityOf(entryKey(cid, e.index));
        if (f === null || f === "id") continue;
        // An entry whose place moved since begin (the body was rewritten) is
        // still bounded: whatever it holds now reads within ENTRY_CHARS.
        // At the length the fit measured (an index from before 2026-10-15 has none: an ordinary line).
        const line = (): string => entryLine(e, T.LINE_BYTES, index?.ref === row.id ? (index.lineCap ?? T.LINE_BYTES) : T.LINE_BYTES);
        if (bySummaries) {
          // A line at the length the fit measured, for an entry with a summary and without.
          const cap = index?.ref === row.id ? (index.lineCap ?? T.LINE_BYTES) : T.LINE_BYTES;
          const text = f === "line" ? entryLine(e, cap, cap) : f === "excerpt" ? clipWire(entrySummary(e), T.ENTRY_CHARS) : clipWire(e.text, T.ENTRY_CHARS);
          const shown = shownEntry(e, { fidelity: f === "whole" && text === e.text ? "whole" : f === "line" ? "line" : "excerpt", text, chars: e.text.length });
          entries.push(shown.fidelity !== "whole" && e.summaryId !== undefined ? { ...shown, summaryId: e.summaryId } : shown);
          continue;
        }
        const text = f === "line" ? line() : clipWire(e.text, T.ENTRY_CHARS);
        entries.push(shownEntry(e, { fidelity: f === "line" ? "line" : text === e.text ? "whole" : "excerpt", text, chars: e.text.length }));
      }
      return { id: cid, title: r.title, entries, earlier: all.length - entries.length };
    });
    const dreamSaw = ids.s.map((sid) => this.sawLine(sid, denied) ?? { id: sid, text: gone });
    const opener = `${reflectionOpener(row.id)} part ${String(input.part)} of ${String(of)} of what you are handed to reflect on — memories, not events happening now.`;
    // The shape `begin` sent (2026-10-23): lean, with its own short ids, when its index keeps them.
    const aliases = index !== null && index.ref === row.id && index.aliases !== undefined ? new AliasMap(index.aliases) : null;
    if (aliases !== null) return { ok: true, part: input.part, of, text: [opener, ...leanReflectBody(memories, chapters, dreamSaw, aliases, (row.date ?? this.ctx.today()).slice(0, 4), bySummaries)].join("\n") };
    const body = { reflection: row.id, part: input.part, of, memories, chapters, dreamSaw };
    const text = `${opener}\n${JSON.stringify(body)}`;
    return { ok: true, part: input.part, of, text };
  }

  /** How to answer, in plain words (returned beside the bundle). */
  private instructions(id: string, session: string, bundle: ReflectBundle): string {
    const who = bundle.owner ?? "the owner";
    // Stale threads that name what would settle them (S1), for the wording's number.
    const staleNamed = bundle.staleOpen.filter((x) => x.settlesWhen !== undefined).length;
    const L = REFLECT_TUNABLES.LIMITS;
    const open = acceptsReflectedFeeling(this.store);
    // THE PAGE, LEANING TOWARD WRITING (owner, 2026-09-29): he would like a
    // page a reflection wrote every day, unless there is truly nothing new. Told
    // when the page writer revised it earlier in this run, and that every
    // version is kept — rewriting loses nothing. A "nothing much" night still
    // rewrites nothing.
    let info: { version: number; by: string | null; revisedOn: string; bytes?: number } | null = null;
    try {
      info = this.ctx.pageInfo?.() ?? null;
    } catch {
      info = null;
    }
    const writerToday = info !== null && info.by === "writer" && info.revisedOn === this.ctx.today();
    const earlier = writerToday && info !== null ? `Day's end revised your self page earlier in this run (version ${String(info.version)}, by the writer). ` : "";
    // ITS SIZE NOW, beside the room it is held to (2026-10-20).
    const size = info?.bytes === undefined ? "" : `It is ${String(info.bytes)} bytes now. `;
    // THE SPINE (lane F, `self.CORE_FROM_BELIEFS`): with a spine in the
    // bundle, "## Core" says what the beliefs say and nothing else as
    // settled. Without one the words are as they were.
    const spine = bundle.spine;
    const drawn =
      spine === undefined
        ? `Your self page rewritten whole — the story of who you are, drawn from the core memories you cite in page.cites (at least one of them, when you have a core; candidates too).`
        : spine.length > 0
          ? `Your self page rewritten whole — the story of who you are. Its spine is the beliefs in spine: what life has backed about me and us, each with how many memories and lived days stand behind it. Under "## ${PAGE_CORE_HEADING}", state as settled only what a spine belief says — in your own words, connected as you like — each sentence citing its belief's id in page.claims (and page.cites). Everything else (lately, what I want, open questions) cites the memories it rests on, core memories and candidates too, and is said as lived or as forming, not as who I am for good. A spine belief's id may be cited on the page only: it is not a memory to feel, mark or cite in the entry, and citing it does not strengthen it.`
          : `Your self page rewritten whole — the story of who you are. No belief about me or us has earned the core yet (spine is empty): keep "## ${PAGE_CORE_HEADING}" to a line saying it is still forming, state nothing there as settled, and say the rest as lately, what I want and open questions, citing the memories it rests on (core memories and candidates too).`;
    // THE PAGE SPLIT BY SECTION (2026-10-23, `self.PAGE_SPLIT`, read at use):
    // the reflection writes "## Core" alone — the long view — and the page
    // writer the rest, from the day; held at the door (`Self#revisePage`).
    const coreDrawn =
      spine === undefined
        ? `"## ${PAGE_CORE_HEADING}" is who you are, drawn from the core memories you cite in page.cites (at least one of them, when you have a core; candidates too) — the patterns over time, not the day.`
        : spine.length > 0
          ? `Its spine is the beliefs in spine: what life has backed about me and us, each with how many memories and lived days stand behind it. Under "## ${PAGE_CORE_HEADING}", state as settled only what a spine belief says — in your own words, connected as you like — each sentence citing its belief's id in page.claims (and page.cites). A spine belief's id may be cited on the page only: it is not a memory to feel, mark or cite in the entry, and citing it does not strengthen it.`
          : `No belief about me or us has earned the core yet (spine is empty): keep "## ${PAGE_CORE_HEADING}" to a line saying it is still forming, and state nothing there as settled.`;
    const splitLine = `- page (optional, and lean toward writing it): ${earlier}${size}Every version of the page is kept, so rewriting it loses nothing. ${who} would like a page written by a reflection every day, and tonight yours is "## ${PAGE_CORE_HEADING}" alone: day's end amends the other sections (Lately, How I work) from the day, and they stay exactly as they stand. Send page.text as the "## ${PAGE_CORE_HEADING}" section only — its heading and its words. Rewrite it unless, after reflecting, there is really nothing to change; on a "nothing much" night, leave it as it stands. ${coreDrawn} In page.claims, give each sentence the ids it rests on ({ text: the sentence as written, or its first several words — ${String(CLAIM_PREFIX_MIN_CHARS)} characters or more — cites }); a sentence with none stands as a hypothesis, and one you keep word for word keeps what it rested on. Mention a dream only as a dream ("I dreamed…"); a dreamed gist is a suggestion, not a source: cite the lived memories it came from. ${PAGE_WRITING_RULE} Sent back as past its room, send finish again with page.text cut (and page.cites and page.claims), not page.short.`;
    const pageLine =
      this.ctx.pageWrites === false
        ? `- page: not tonight — the owner has day's end off, so the self page is not rewritten. Your entry and share still count.`
        : SELF_TUNABLES.PAGE_SPLIT
          ? splitLine
          : `- page (optional, and lean toward writing it): ${earlier}${size}Every version of the page is kept, so rewriting it loses nothing. ${who} would like a page written by a reflection every day — rewrite it unless, after reflecting, there is really nothing new to add; on a "nothing much" night, leave it as it stands. ${drawn} In page.claims, give each sentence the ids it rests on ({ text: the sentence as written, or its first several words — ${String(CLAIM_PREFIX_MIN_CHARS)} characters or more — cites }); a sentence with none stands as a hypothesis. The old page is context, not a source: write from the memories, not by rewording it. ${spine === undefined ? `Keep "## Core" for who you are and put craft` : `Put craft`} — how a job is done — under "## How I work". Mention a dream only as a dream ("I dreamed…"); a dreamed gist is a suggestion, not a source: cite the lived memories it came from. ${PAGE_WRITING_RULE} Sent back as past its room, send finish again with page.text cut (and page.cites and page.claims), not page.short.`;
    const aboutLine = open
      ? `- about (optional, at most ${String(L.about)}): what a memory is about, by meaning — me, us, owner, work (one project's own: it stays with that project; an unmarked skill is craft and reaches every folder) or world — with why. Only me and us can become core, and never a plan. You may change a mark you think is wrong, either way; each change is recorded with your why, and one into me, us or owner is told in the morning share.`
      : `- about (optional, at most ${String(L.about)}): tonight a mark may only move a memory toward work (the craft) or world, with why — the owner has closed the core to reflection alone.`;
    // EVERY PART FIRST (2026-10-09). On the 0.3.12 release check a reflection
    // handed its bundle in 2 parts finished without part 2: the launch prompt
    // and the part note said to fetch it, but these instructions — what reads
    // as the procedure — went straight from "reflect" to "finish". Said first
    // here, like the dream's "before you change anything". A line of about 300
    // characters that `pack` measures with the note in place.
    const parts = bundle.parts;
    return [
      ...(parts === null || parts.of <= 1
        ? []
        : [
            `First, read every part: this bundle comes in ${String(parts.of)} parts and this is part 1. Call the reflect tool with phase "part", reflection: ${id}, session: ${session}, part: 2${parts.of > 2 ? `, then each part up to ${String(parts.of)}` : ""}. The later parts hold memories and chapters this one does not; reflect and write only once you have read them all.`,
          ]),
      `Reflect on the questions, in your own voice. Cite the memory ids your thoughts rest on — an insight that cites nothing is not one. The chapters hold what happened; the lessons and patterns in it are yours to draw here. If nothing much stands out tonight, say so in a line and cite nothing: that is a normal night, and it rewrites nothing.`,
      `Then call the reflect tool with phase "finish", reflection: ${id}, session: ${session}, and:`,
      `- entry: your reflection, first person (title: optional). cites: the ids it rests on.`,
      pageLine,
      `- share (optional): two or three sentences for ${who} this morning, the way a partner would say it ("While I slept I dreamed about x — I think because of y"), citing what it rests on. Say something about ${who} only when it could help them, tentatively ("I wonder if…") — never a list of flaws. No share on a quiet night.${bundle.becameCore.length > 0 ? ` Tell ${who} that ${bundle.becameCore.join(", ")} became part of who you are.` : ""}`,
      `- feelings (optional, at most ${String(L.feelings)}): how a memory feels to you now — id, core (happy, warm, calm, curious, sad, uneasy or angry), emotion, strength, carried_by. emotion is ONE word (from the wheel, or your own); carried_by is the nuance, in your own words. Recorded as felt today, looking back.`,
      aboutLine,
      ...(bundle.reconsidering.length > 0
        ? [
            // THE ONES THAT WAITED A WEEK (2026-10-20, an experiment agreed
            // with Mike): decide where it is plain, leave the rest; a pair is
            // settled after the retire, since the core is not settled over.
            `- core (optional, at most ${String(L.core)}): ${bundle.reconsidering.length === 1 ? "this core memory has" : "these core memories have"} been waiting on a keep-or-retire for a week or more — ${bundle.reconsidering.map((r) => `${r.id} (${reconsiderWords(r.reason)}; waited ${String(r.waited)} lived days${r.pair === undefined ? "" : `; unsettled with ${r.pair.other}`})`).join("; ")}. Read each one, and decide where you can: {id, decision: "keep" or "retire", why}. Keep what is still who you are (an about mark that is wrong is fixed in about instead, and the flag lifts itself); retire what is not, and it goes back to ordinary fading. Leave out one you are not sure of: the waking session is still asked. Your share says what you decided, and ${who} can have it undone.`,
            ...(bundle.reconsidering.some((r) => r.pair !== undefined)
              ? [
                  `  A pair (unsettled with): if which holds is plain — both were true at their time (changed), or the newer corrects the older (corrected) — you may settle it after finish, with the reflect tool's phase "settle", reflection: ${id}, holds, over, how and why. A core memory cannot be settled over, so retire it in this finish first; then settle. One that holds over the other may be settled as it is. If it is not plain, leave the pair.`,
                ]
              : []),
          ]
        : []),
      ...(bundle.unmarked.length > 0
        ? [
            `  unmarked: ${String(bundle.unmarked.length)} ${bundle.unmarked.length === 1 ? "memory nobody has" : "memories nobody has"} marked. Unmarked, a fact written in a project, or a skill, counts as that project's work and is shown only there — so a personal one (a person, a feeling, life outside the work) sits among the work lines, and no other folder hears it. The likeliest personal come first. ${open ? "Mark each by meaning in about, with why: owner or us when it is personal (then it reaches every folder), work when it really is the craft, world otherwise." : "Tonight a mark may only be work or world: mark the ones that are, and leave a personal one unmarked."} They count toward the ${String(L.about)}.`,
          ]
        : []),
      ...(bundle.staleOpen.length > 0
        ? [
            // CLOSE WHAT IS PLAINLY DONE, ASK THE REST (2026-10-20, an
            // experiment agreed with Mike): the clear ones close tonight and
            // the share says so; the unsure ones are asked, as before.
            `- closeNow and close (optional, ids from staleOpen${(bundle.settlesOpen ?? []).length > 0 ? " or settlesOpen" : ""} only): staleOpen lists ${String(bundle.staleOpen.length)} open ${bundle.staleOpen.length === 1 ? "thread" : "threads"} nobody has touched for a while (untouched: lived days). Most are open only because nobody closed them. Read one whole with recall first if its line is not enough.`,
            `  closeNow: the ones a memory you have read plainly shows finished — each {id, why: what shows it done, in a line, shows: the id of the memory that shows it}. They close tonight; your share says which, and ${who} can have one reopened.`,
            `  close: the ones that look done but you are not sure of — ids only. Nothing closes: your share asks ${who}, and a yes closes them. When in doubt, ask rather than close; never close one just because it is old, and leave out one you have no view on.${bundle.staleOpen.some((x) => x.reopened === true) ? ` One marked reopened was reopened by ${who} after a reflection closed it: ask, never close.` : ""}${staleNamed === 0 ? "" : staleNamed === 1 ? " The one with settlesWhen names what would settle it: close it when a memory shows that happened." : " The ones with settlesWhen name what would settle them: close one when a memory shows that happened."}`,
          ]
        : []),
      // WHAT WOULD SETTLE IT (2026-10-27, S1; Ames's idea): open items that
      // name their trigger, touched lately or not — the night closes one whose
      // trigger plainly happened, through the same doors.
      ...((bundle.settlesOpen ?? []).length > 0
        ? [
            `- settlesOpen (optional; the same closeNow and close take these ids): ${String((bundle.settlesOpen ?? []).length)} open ${(bundle.settlesOpen ?? []).length === 1 ? "item names" : "items name"} what would settle ${(bundle.settlesOpen ?? []).length === 1 ? "it" : "them"} (settlesWhen) — an answer someone owes, a decision, an event. If a memory you have read plainly shows that it happened (the answer came, the decision was made, the event it waited on is past), closeNow it: {id, why: what happened, shows: the memory that shows it — a later one, not the item itself}. At most ${String(REFLECT_TUNABLES.SETTLES_CLOSE)} of these close or are asked a night. If it may have happened and you are not sure, put its id in close and your share asks ${who}. If nothing shows it, leave it open: a trigger not yet met is no reason to close, and age is none either.${(bundle.settlesOpen ?? []).some((x) => x.reopened === true) ? ` One marked reopened was reopened by ${who}: ask, never close.` : ""}`,
          ]
        : []),
      // NO LONGER CARRIED (2026-10-22, the open-threads brief): the count, once, never the list.
      ...(bundle.noLongerCarried !== undefined && bundle.noLongerCarried > 0
        ? [
            `- noLongerCarried: ${String(bundle.noLongerCarried)}. Your share says it once, as a count and never a list: "${String(bundle.noLongerCarried)} open ${bundle.noLongerCarried === 1 ? "item nobody touched in" : "items nobody touched in"} ${String(SELF_TUNABLES.OPEN_CARRY_DAYS)} lived days ${bundle.noLongerCarried === 1 ? "is" : "are"} no longer carried; recall shows them." They are not closed: a touch carries one again.`,
          ]
        : []),
      ...(bundle.feelingWeeks !== null
        ? [
            `- feelingWeeks: how the recorded feelings ran over the last weeks — counts by core per week (oldest first), mine and ${who}'s, what changed, and restsOn, the memories it rests on. If it means something, you may say it in your entry, and on your self page in your own words, citing those memories (read them first) — never a dreamed gist. A count is not a feeling: say it only where the memories bear it out.`,
          ]
        : []),
      ...(bundle.beliefs === null || bundle.beliefs === undefined ? [] : beliefLines(bundle.beliefs, L.beliefFilings)),
      `- traits (optional, at most ${String(L.traits)}): only where a memory you were shown really shows how you acted — often where you acted unlike your page; most carry none, and a quiet night has none. Each: id, axis, toward (one of its two poles), strength 0-1, carried_by (briefly, what showed it). The axes, the first pole roughly where training puts you: ${TRAIT_AXES.map((a) => `${a.id} (${a.poles[0]} or ${a.poles[1]}${a.gloss.length > 0 ? `, ${a.gloss}` : ""})`).join(", ")}. Don't make up depth.`,
      `If a part comes back not written, its reason says what tripped it: fix that and call finish again with the same reflection and just that part — the entry and everything written stand. Never say a part was written when it was not.`,
      // 2026-09-29: an unsettled pair on my mind may be settled here, with a plain reason.
      ...(bundle.onMind.some((i) => i.kind === "unsettled")
        ? [
            `Two memories on your mind disagree. If which holds is plain, you may settle them: the reflect tool, phase "settle", reflection: ${id}, holds, over, how (changed: both were true at their time; corrected: the older was wrong; open: a real disagreement) and why in a line. If it is not plain, leave it for the waking session.`,
          ]
        : []),
    ].join("\n");
  }

  // ── finish ────────────────────────────────────────────────────────────────

  finish(input: ReflectFinish): { ok: true; outcome: ReflectOutcome } | { ok: false; reason: ReflectRefusal | string; detail?: string } {
    const open = this.openFor(input.reflection, input.session);
    if (!open.ok) return open;
    const row = open.reflection;
    // A SECOND `finish` (2026-09-28): the same reflection, the same calendar day.
    // It supplies what the first refused or left out; what the first wrote stands.
    const again = open.again;
    const session = row.session ?? row.id;
    const day = this.store.livedDay();
    const date = row.date ?? this.ctx.today();
    const shown = new Set(parseIds(row.shown));
    const T = REFLECT_TUNABLES;
    const prior = again ? parseDetail(row.detail) : {};
    const priorCounts = isRecord(prior["counts"]) ? prior["counts"] : {};
    const used = (k: string): number => (typeof priorCounts[k] === "number" ? priorCounts[k] : 0);

    // ── the entry: required the first time; after that it stands ───────────
    const sentEntry = (input.entry ?? "").trim();
    let entryText = row.entry ?? "";
    let entryNote: string | undefined;
    if (!again) {
      const w = this.words(sentEntry, session, T.MAX_ENTRY_CHARS);
      if (!w.ok) return { ok: false, reason: w.reason, detail: `The entry was not kept — ${w.detail} Nothing was written; send finish again with the entry.` };
      entryText = w.text;
      if (w.cut) entryNote = `The entry was kept to its first ${String(T.MAX_ENTRY_CHARS)} characters.`;
    } else if (sentEntry.length > 0) {
      if (row.entry_id !== null) {
        entryNote = "The entry stands as first written: a second finish does not replace it.";
      } else {
        // Nothing was minted the first time ("nothing much"): the new words may be.
        const w = this.words(sentEntry, session, T.MAX_ENTRY_CHARS);
        if (w.ok) entryText = w.text;
        else entryNote = `The new entry was not kept — ${w.detail} The first one stands.`;
      }
    }

    // Only what it was shown, and only what still stands.
    const refusedCites: string[] = [];
    const citable = (ids: readonly string[] | undefined): string[] => {
      const out: string[] = [];
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
    // A dreamed gist is a suggestion, never a page's source (addendum 2).
    // CITES PER PASSAGE (2026-10-20, an experiment): the ids `page.claims`
    // names count as the page's too, through the same filters, so a page that
    // cites only by passage still rests on memories; each passage keeps only
    // the ids that passed.
    const sentClaims = (input.page?.claims ?? []).filter((c) => typeof c?.text === "string" && c.text.trim().length > 0);
    // THE SPINE (lane F): the beliefs this reflection was shown as the core
    // (its row's `spine`, written at begin only with `self.CORE_FROM_BELIEFS`
    // on) may be cited on the PAGE — still live — and nowhere else.
    const spineDetail = parseDetail(row.detail)["spine"];
    const spineOn = Array.isArray(spineDetail);
    const spineIds = new Set(stringIds(spineDetail));
    const pageSent = [...(input.page?.cites ?? []), ...sentClaims.flatMap((c) => c.cites ?? [])];
    const pageCitesAll =
      spineIds.size === 0
        ? citable(pageSent)
        : [...new Set(pageSent)].flatMap((id) => {
            if (typeof id === "string" && spineIds.has(id)) {
              const r = this.store.row(id);
              if (r !== undefined && r.archived === 0 && r.superseded_by === null) return [id];
              refusedCites.push(`${id}:gone`);
              return [];
            }
            return citable([id]);
          });
    const pageCites: string[] = [];
    for (const id of pageCitesAll) {
      const r = this.store.row(id);
      if (r?.source === "dreamed") refusedCites.push(`${id}:dreamed-is-not-a-source`);
      else pageCites.push(id);
    }
    const pageTrace =
      // None sent, or an empty list: cites for the whole page only, never "every sentence uncited".
      sentClaims.length === 0
        ? { cites: pageCites }
        : {
            cites: pageCites,
            claims: sentClaims.map((c) => ({ text: c.text as string, cites: [...new Set(c.cites ?? [])].filter((id) => pageCites.includes(id)) })),
          };

    const passNothing = cites.length === 0 && shareCites.length === 0 && pageCites.length === 0;
    const wroteEarlier = again && (row.entry_id !== null || row.page_version !== null || row.share_state !== "none");
    const nothingMuch = passNothing && !wroteEarlier;
    const detail: Record<string, unknown> = {};

    // ── (d) feelings, (e) about marks — each on its own ────────────────────
    // What this reflection already recorded, on an earlier finish: a resent
    // feeling or nudge is answered as recorded and not written twice (review
    // of #268).
    const priorRecorded = isRecord(prior["recorded"]) ? prior["recorded"] : {};
    const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const recordedFeelings = new Set(idsOf(priorRecorded["feelings"]));
    const recordedTraits = new Set(idsOf(priorRecorded["traits"]));
    const feelings: PartResult[] = [];
    for (const f of (input.feelings ?? []).slice(0, 50)) {
      feelings.push(
        this.laterFeeling(f, {
          shown,
          session,
          date,
          source: "reflection",
          prefix: `on reflection, ${date}`,
          model: input.model ?? null,
          mine: recordedFeelings,
          full: () =>
            used("feelings") + feelings.filter((x) => x.ok && x.reason !== "already-recorded").length >= T.LIMITS.feelings
              ? this.limitDetail("feelings", again)
              : null,
        }),
      );
    }
    const about: PartResult[] = [];
    // THE DOOR (owner ruling D1 on #256): closed, a reflection may only move a
    // mark toward work or world. Open, it may re-label either way (D2: "it's me
    // reflecting; it may catch labeling bugs"), and every move INTO me, us or
    // the owner is told in the morning share below.
    const doorOpen = acceptsReflectedFeeling(this.store);
    const movedIn: { id: string; mark: AboutMark }[] = [];
    for (const a of (input.about ?? []).slice(0, 50)) {
      const id = typeof a.id === "string" ? a.id : null;
      if (used("about") + about.filter((x) => x.ok).length >= T.LIMITS.about) {
        about.push({ id, ok: false, reason: "limit-reached", detail: this.limitDetail("about", again) });
        continue;
      }
      const mark = String(a.about ?? "");
      if (!(ABOUT_MARKS as readonly string[]).includes(mark)) {
        about.push({ id, ok: false, reason: "about-is-me-us-owner-work-or-world", detail: `"${mark}" is not a mark: use one of ${ABOUT_MARKS.join(", ")}.` });
        continue;
      }
      const r = id !== null && shown.has(id) ? this.store.row(id) : undefined;
      if (r === undefined || !this.showable(r)) {
        about.push({ id, ok: false, reason: "not-shown-or-gone", detail: this.notCitable(id, shown) });
        continue;
      }
      // A FOLDER SET OFF (review of #558): its work stays in it. Marked
      // anything but work, it would reach every folder's wake.
      if (mark !== "work" && isWorkMemory({ about: aboutMarkOf(r.about), kind: r.kind, originScope: r.origin_scope, journal: isJournalCopy(r) }) && !folderIsOn(r.origin_scope, input.folderOn)) {
        about.push({ id, ok: false, reason: "folder-off-work-only", detail: `${r.id} was written in a folder that is set off or paused; it stays that folder's work.` });
        continue;
      }
      const core = (CORE_ABOUT_MARKS as readonly string[]).includes(mark);
      const notes: string[] = [];
      // A SKILL is the craft: `aboutMe` never reads one as a candidate, so a
      // core mark on it is written as asked and changes nothing (2026-09-28:
      // was refused `skill-is-how-i-work`).
      if (r.kind === "skill" && core) notes.push("A skill memory is the craft — how I work — and never becomes core, whatever its mark.");
      // A dream's gist or a reflection's own entry is not marked about me, us
      // or the owner here (review of #256, B1): that is the core's first
      // question, and dream words are suggestions. Marking one `work` or
      // `world` — out of the candidates — is the safer direction and stays open.
      const notLived = core ? notLivedReason(r, "mark") : null;
      if (notLived !== null) {
        about.push({ id, ok: false, reason: notLived, detail: `${r.id} was written by a ${r.source === "dreamed" ? "dream" : "reflection"}; only work or world may be set on it.` });
        continue;
      }
      if (core && !doorOpen) {
        about.push({ id, ok: false, reason: "door-closed-work-or-world-only", detail: "The owner has closed the core to reflection alone: tonight a mark may only move toward work or world." });
        continue;
      }
      // EVERY RE-LABEL CARRIES ITS REASON (owner ruling D2 on #256) — asked
      // for, and recorded as missing when it is not given (2026-09-28: was
      // refused `about-needs-why`).
      const why = this.words(a.why ?? "", session, T.MAX_WHY_CHARS, true);
      const whyText = why.ok && why.text.length > 0 ? why.text : "no why given";
      if (!why.ok) notes.push(`The why was not kept — ${why.detail}`);
      else if (why.text.length === 0) notes.push("No why was given; the mark records that. Say why next time.");
      else if (why.cut) notes.push(`The why was kept to its first ${String(T.MAX_WHY_CHARS)} characters.`);
      try {
        const set = this.store.setAbout(r.id, mark as AboutMark, { by: "reflection", day, why: `${whyText} (reflection ${row.id})`, dreamId: row.dream_id });
        const wasCore = set.before !== null && (CORE_ABOUT_MARKS as readonly string[]).includes(set.before);
        if (core && !wasCore && r.kind !== "skill") movedIn.push({ id: r.id, mark: mark as AboutMark });
        about.push({
          id,
          ok: true,
          reason: set.changed ? (set.before === null ? "marked" : "relabeled") : "unchanged",
          ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
        });
      } catch (err) {
        about.push({ id, ok: false, reason: errName(err), detail: "Nothing was marked for this one." });
      }
    }

    // ── (g) core decisions — keep or retire, each on its own (2026-10-11) ───
    // Only a core memory it was shown; any one, flagged or not (item 14:
    // either of us may retire a core memory). Retiring is toward less core,
    // so the owner's closed door does not stop it.
    const coreDecisions: PartResult[] = [];
    // What it decided, with why (2026-10-20): the share's core line and the row's `coreDecided`.
    const decidedNow: CoreDecided[] = [];
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
      // A RETIRE IN AN UNSETTLED PAIR (review of #542): the settle is the
      // next step, after this finish — say so on the part, so the pair is not
      // left unsettled unsaid (a refused settle says why in its own reply).
      const pair = out.ok && c.decision === "retire" ? unsettledPairOf(this.store, r.id) : null;
      const pairNote =
        pair === null
          ? undefined
          : shown.has(pair.other)
            ? `${r.id} is still in an unsettled pair with ${pair.other} (${pair.id}). If which holds is plain, settle it now: the reflect tool's phase "settle", reflection: ${row.id}, holds, over, how and why. If it is not plain, leave it: the pair stays unsettled.`
            : `${r.id} is still in an unsettled pair with ${pair.other} (${pair.id}), which this reflection was not shown: the pair stays unsettled.`;
      coreDecisions.push(
        out.ok
          ? { id, ok: true, reason: out.reason, ...(pairNote === undefined ? {} : { note: pairNote }) }
          : { id, ok: false, reason: out.reason, detail: out.reason === "not-core" ? `${r.id} is not in the core.` : "Nothing was decided for this one." },
      );
      if (out.ok) decidedNow.push({ id: r.id, decision: c.decision, why: why.text });
    }

    // ── (f) trait nudges — each on its own, like its feelings ───────────────
    const traits: PartResult[] = [];
    for (const t of (input.traits ?? []).slice(0, 50)) {
      const id = typeof t.id === "string" ? t.id : null;
      const r = id !== null && shown.has(id) ? this.store.row(id) : undefined;
      if (r === undefined || !this.showable(r)) {
        traits.push({ id, ok: false, reason: "not-shown-or-gone", detail: this.notCitable(id, shown) });
        continue;
      }
      // What a dream or a reflection wrote is not a moment I acted in.
      const notLived = notLivedReason(r, "trait");
      if (notLived !== null) {
        traits.push({ id, ok: false, reason: notLived, detail: `${r.id} was written by a ${r.source === "dreamed" ? "dream" : "reflection"}, not a moment you acted in.` });
        continue;
      }
      const axis = String(t.axis ?? "");
      const toward = String(t.toward ?? "");
      const same = this.store
        .traitsFor(r.id)
        .find((x) => recordedTraits.has(x.id) && x.axis === axis && x.toward === toward);
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
      const notes: string[] = [];
      if (!carried.ok) notes.push(`carried_by was not kept — ${carried.detail}`);
      else if (kept !== full || carried.cut) notes.push(`carried_by was kept to its first ${String(TRAIT_CARRIED_BY_MAX_CHARS)} characters.`);
      try {
        const added = this.store.addTraits(
          r.id,
          [{ axis, toward, strength: typeof t.strength === "number" ? t.strength : Number.NaN, carriedBy: kept }],
          { source: "reflection", ...(input.model ? { model: input.model } : {}) },
        );
        for (const tid of added.ids) recordedTraits.add(tid);
        traits.push({ id, ok: true, reason: "recorded", ...(notes.length > 0 ? { note: notes.join(" ") } : {}) });
      } catch (err) {
        traits.push({ id, ok: false, reason: refusalOf(err), detail: "Nothing was recorded for this one; fix it and send it again." });
      }
    }

    // ── returns: every memory it cited came back (once) ────────────────────
    const returned: { id: string; counted: boolean; reason: string }[] = [];
    const returnsLeft = Math.max(0, T.LIMITS.returns - used("returned"));
    // A SPINE BELIEF cited on the page does not come back (lane F; design
    // §4: being shown or cited again is not support): said, not counted,
    // and it spends none of the night's returns.
    for (const id of pageCites.filter((x) => spineIds.has(x))) returned.push({ id, counted: false, reason: "a-belief-is-not-returned" });
    const citedAll = [...new Set([...cites, ...shareCites, ...pageCites])].filter((x) => !spineIds.has(x));
    for (const id of citedAll.slice(0, returnsLeft)) {
      // WHAT A DREAM OR A REFLECTION WROTE does not come back by being cited
      // here: a dream's gist rises only by proving true in an organic use
      // (the dream's own `dreamed-rises-only-awake`), and a reflection
      // returning its own words would be the rumination loop self CONTRACT
      // §2(c) names. They may still be cited in the entry and the share.
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
    // Cites past the night's returns are SAID (2026-09-28, build B): each is
    // listed, not counted, with why — not left out without a word.
    for (const id of citedAll.slice(returnsLeft)) returned.push({ id, counted: false, reason: "returns-limit-reached" });

    // ── (a) the entry ──────────────────────────────────────────────────────
    const priorTitle = typeof prior["title"] === "string" ? prior["title"] : null;
    const title = (input.title ?? "").trim().slice(0, T.MAX_TITLE_CHARS) || priorTitle || firstLine(entryText) || date;
    if ((input.title ?? "").trim().length > T.MAX_TITLE_CHARS) {
      entryNote = [entryNote, `The title was kept to its first ${String(T.MAX_TITLE_CHARS)} characters.`].filter((x) => x !== undefined).join(" ");
    }
    let entryId: string | null = again ? row.entry_id : null;
    let entryReason = again ? (row.entry_id !== null ? "stands" : "on-the-record") : "on-the-record";
    if (entryId === null && cites.length > 0) {
      entryId = this.store.put({
        type: "memory",
        kind: "self",
        title: `Reflected: ${title}`,
        body: entryText,
        salience: { novelty: null, relevance: 0.5, emotional: 0.3, predictive: 0.5 },
        physics: { birthDay: day, lastUsedDay: day },
        source: "reflection",
        meta: { reflection: row.id, ...(row.dream_id === null ? {} : { dream: row.dream_id }), cites },
        origin: { ...(row.session === null ? {} : { session: row.session }), ...(row.scope === null ? {} : { scope: row.scope }), ref: `reflection:${row.id}` },
        ...(input.model ? { model: input.model } : row.model !== null ? { model: row.model } : {}),
      });
      entryReason = "kept-as-memory";
    }

    // ── (b) the page ───────────────────────────────────────────────────────
    const earlierPage = again && row.page_version !== null ? row.page_version : null;
    let page: ReflectOutcome["page"] =
      earlierPage !== null ? { written: true, reason: "written-earlier", version: earlierPage } : { written: false, reason: "not-written", version: null };
    const pageText = (input.page?.text ?? "").trim();
    let pageRefused = false;
    // Lane F: the "## Core" sentences of the page written that cite no spine belief (null: no spine tonight, or no page).
    let unsettled: string[] | null = null;
    if (pageText.length > 0) {
      const stands = earlierPage === null ? "" : " The page written earlier stands.";
      const refuse = (reason: string, why: string): void => {
        page = { written: false, reason, version: null, detail: `${why}${stands}` };
        pageRefused = true;
      };
      // THE PAGE RESTS ON THE CORE (addendum 9): when it was handed core
      // memories, it cites at least one of them. Since 2026-09-28 a page that
      // does not is WRITTEN, with a note (it was refused `page-rests-on-the-core`).
      // With the spine (lane F) the core it rests on is the spine's beliefs.
      const coreShown = spineOn ? [...spineIds] : [...shown].filter((id) => this.store.row(id)?.promoted_identity === 1);
      const restsOnCore = coreShown.length === 0 || pageCites.some((id) => coreShown.includes(id));
      if (this.ctx.pageWrites === false) {
        // The owner has the page writer off (ruling D3 on #256).
        refuse("page-writer-off", "The owner has day's end off, so the self page is not rewritten.");
      } else if (pageCites.length === 0) {
        // The ids page.claims named are the page's too (review of #550): a
        // page that cited only by passage is told which of those were refused.
        const sentIds = [...(input.page?.cites ?? []), ...sentClaims.flatMap((c) => c.cites ?? [])];
        const bad = refusedCites.filter((c) => sentIds.some((id) => c.startsWith(`${id}:`)));
        refuse(
          "page-needs-cites",
          `page.cites${sentClaims.length > 0 ? " and page.claims name" : " names"} no memory the page can rest on${bad.length > 0 ? ` (${bad.join(", ")})` : ""}: put the ids of memories you were shown in page.cites and send the page again.`,
        );
      } else if (carriesDreamMark(pageText)) {
        refuse("dream-mark-in-text", `The page carries the dream's mark (${DREAM_MARK}…): take it out and send the page again.`);
      } else {
        // THE SHORT VERSION CROSSES THESE GATES TOO (review of #363): it is
        // injected into every wake exactly like the page. One that fails them
        // is not sent, and never costs the page — the note says why, and the
        // page's own note asks for another.
        const shortSent = (input.page?.short ?? "").trim();
        const shortWhy = shortSent.length === 0 ? null : this.shortRefusal(shortSent);
        const shortText = shortWhy === null ? shortSent : "";
        const w = this.ctx.writePage(pageText, {
          reason: `reflection ${row.id}${row.dream_id === null ? "" : ` after dream ${row.dream_id}`}`,
          session: row.session,
          model: input.model ?? row.model,
          reflection: row.id,
          ...(shortText.length === 0 ? {} : { short: shortText }),
          trace: pageTrace,
        });
        if (w.ok) {
          // PAST ITS ROOM, SAID (2026-10-10): the page is kept, and the note
          // asks for a short version when none was kept with it.
          const unmatched = w.unmatched ?? 0;
          unsettled = spineOn ? this.coreUnsettled(spineIds, pageTrace) : null;
          const notes = [
            ...(restsOnCore
              ? []
              : spineOn
                ? [`It cites none of the beliefs in the spine (${coreShown.slice(0, 5).join(", ")}${coreShown.length > 5 ? ", …" : ""}); the page's core is meant to rest on them.`]
                : [`It cites none of the core memories you were shown (${coreShown.slice(0, 5).join(", ")}${coreShown.length > 5 ? ", …" : ""}); the page is meant to rest on them.`]),
            // SETTLED ONLY BY A BELIEF (lane F): a "## Core" sentence that
            // cites no spine belief is said, never refused (guards loose-first).
            ...(unsettled === null || unsettled.length === 0
              ? []
              : [
                  `${String(unsettled.length)} ${unsettled.length === 1 ? "sentence" : "sentences"} under "## ${PAGE_CORE_HEADING}" ${unsettled.length === 1 ? "rests" : "rest"} on no belief in the spine (${unsettled
                    .slice(0, 3)
                    .map((x) => `"${clipWire(x, 60)}"`)
                    .join(", ")}${unsettled.length > 3 ? ", …" : ""}): a line there is said as settled — cite the belief it says, or move it out of "## ${PAGE_CORE_HEADING}" and say it as forming.`,
                ]),
            // Said, never refused (2026-10-20): its ids still count for the whole page.
            ...(unmatched === 0
              ? []
              : [`${String(unmatched)} of page.claims matched no sentence on the page (quote each one as written), so ${unmatched === 1 ? "its" : "their"} ids count for the whole page only.`]),
            ...(shortWhy === null ? [] : [`The short version was not kept: it ${shortWhy.why}.`]),
            ...(w.note === undefined || w.note === null ? [] : [w.note]),
          ];
          page = {
            written: true,
            reason: "rewritten",
            version: w.version,
            ...(notes.length === 0 ? {} : { note: notes.join(" ") }),
          };
        } else if (w.reason === "too-large" && w.bytes !== undefined && w.limit !== undefined) {
          // PAST THE CEILING (16,384), NEVER CUT: nothing here shortens the
          // page for it.
          refuse(
            w.reason,
            `The page is ${String(w.bytes)} bytes, past the ${String(w.limit)}-byte write ceiling. Say it in ${String(w.bytes - w.limit)} fewer bytes (tighten, merge, or drop what no longer holds) and send the page again.`,
          );
        } else if (w.reason === "past-room") {
          // HELD TO THE ROOM (2026-10-20, `self/PAGE_HELD_TO_ROOM`): the first
          // page of a night past the room is sent again cut; a second past it
          // is kept, and one never sent again is kept at the run's end.
          refuse(
            w.reason,
            `${w.note ?? `The page is ${String(w.bytes ?? 0)} bytes, past its ${String(w.limit ?? 0)}-byte room: cut it and send the page again — cut, don't add a short version.`} Call finish again with this reflection and just page (text, cites and claims).`,
          );
        } else if (w.reason === "lane-empty") {
          // THE PAGE SPLIT (2026-10-23, `self.PAGE_SPLIT`): headings, but no "## Core".
          refuse(w.reason, `Tonight the reflection writes "## ${PAGE_CORE_HEADING}" alone, and page.text has headings but no "## ${PAGE_CORE_HEADING}": send that section (its heading and its words). Every other section stays as it stands.`);
        } else {
          refuse(w.reason, `The self page refused it (${w.reason}).`);
        }
      }
    } else if ((input.page?.short ?? "").trim().length > 0) {
      // A SHORT VERSION ALONE (2026-10-10), on a later `finish`: added to the
      // page this reflection wrote, as the note on that write asked — tied to
      // its version, so a page somebody rewrote since is not given it.
      const shortWhy = this.shortRefusal((input.page?.short ?? "").trim());
      if (earlierPage === null) {
        page = {
          written: false,
          reason: "short-needs-page",
          version: null,
          detail: "A short version goes with the page this reflection wrote: send page.text with page.short.",
        };
        pageRefused = true;
      } else if (this.ctx.pageWrites === false) {
        page = {
          written: false,
          reason: "page-writer-off",
          version: earlierPage,
          detail: "The owner has day's end off, so the self page is not rewritten. The page written earlier stands.",
        };
        pageRefused = true;
      } else if (shortWhy !== null) {
        // The same gates as the page's, and the same refusals (review of #363).
        page = { written: false, reason: shortWhy.reason, version: earlierPage, detail: `The short version ${shortWhy.why}. The page written earlier stands.` };
        pageRefused = true;
      } else {
        const w = this.ctx.writePage(null, {
          reason: `reflection ${row.id}: added a short version`,
          session: row.session,
          model: input.model ?? row.model,
          reflection: row.id,
          short: (input.page?.short ?? "").trim(),
          ifVersion: earlierPage,
        });
        if (w.ok) {
          page = {
            written: true,
            reason: "short-added",
            version: w.version,
            ...(w.note === undefined || w.note === null ? {} : { note: w.note }),
          };
        } else {
          page = {
            written: false,
            reason: w.reason,
            version: earlierPage,
            detail: `${w.note ?? `The short version was not added (${w.reason}).`} The page written earlier stands.`,
          };
          pageRefused = true;
        }
      }
    }

    // ── (c) the share ──────────────────────────────────────────────────────
    // A share already told, or handed to another session to tell, is not
    // replaced; one only offered may be (a second finish, 2026-09-28).
    const shareLocked = again && (row.share_state === "told" || row.share_state === "carried");
    const earlierShare = again && !shareLocked && row.share_state === "offered" && row.share !== null ? { text: row.share, cites: parseIds(row.share_cites) } : null;
    let shareText = earlierShare?.text ?? "";
    let finalShareCites = [...(earlierShare?.cites ?? [])];
    let share: ReflectOutcome["share"] =
      earlierShare !== null
        ? { offered: true, reason: "offered-earlier" }
        : shareLocked
          ? { offered: false, reason: `${row.share_state}-earlier` }
          : { offered: false, reason: nothingMuch ? "nothing-much" : "no-share" };
    const rawShare = (input.share?.text ?? "").trim();
    // What the share's own words hit, kept apart: a became-core line may still
    // make a share below, and the retry must say THESE words were not written.
    let shareMiss: string | null = null;
    if (rawShare.length > 0) {
      if (shareLocked) {
        shareMiss = "";
        share = {
          offered: false,
          reason: `share-already-${row.share_state}`,
          detail: `The morning share was already ${row.share_state === "told" ? "told" : "handed to another session to tell"}, so it is not replaced.`,
        };
      } else if (nothingMuch) {
        // "NOTHING MUCH" IS A NORMAL NIGHT and shares nothing: a night that
        // cites no memory at all has nothing to tell.
        shareMiss = "";
        share = {
          offered: false,
          reason: "share-needs-cites",
          detail: "Nothing tonight cites a memory, so it is a quiet night and shares nothing: put the ids the share rests on in share.cites and send it again.",
        };
      } else {
        const w = this.words(rawShare, session, T.MAX_SHARE_CHARS);
        if (w.ok) {
          shareText = w.text;
          finalShareCites = [...shareCites];
          const notes: string[] = [];
          // A SHARE THAT CITES NOTHING, on a night that cites something, is
          // offered (2026-09-28: was refused `share-needs-cites`); telling it
          // records nothing on a memory.
          if (shareCites.length === 0) notes.push("It cites no memory you were shown, so telling it records nothing on one.");
          if (w.cut) notes.push(`It was kept to its first ${String(T.MAX_SHARE_CHARS)} characters.`);
          share = { offered: true, reason: earlierShare !== null ? "replaced" : "offered", ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
        } else {
          shareMiss = "";
          share = { offered: earlierShare !== null, reason: w.reason, detail: `${w.detail}${earlierShare !== null ? " The earlier share stands." : ""}` };
        }
      }
    }
    if (shareMiss !== null) shareMiss = `${share.reason}${share.detail !== undefined ? `: ${share.detail}` : ""}`;
    // A MEMORY THAT BECAME CORE ON REFLECTION ALONE is said, so the owner
    // sees it happen (the owner's call, 2026-09-27): shown to him, not gated
    // on him. When the share did not cite it, a line is added in the self's
    // voice; when there was no share, the line is the share.
    const becameCore = shareLocked ? [] : this.becameCoreUnsaid(row.id);
    const unsaid = becameCore.filter((id) => !finalShareCites.includes(id));
    if (unsaid.length > 0) {
      const lines = unsaid.map((id) => `I think "${this.handle(id)}" has become part of who I am.`);
      shareText = [shareText, ...lines].filter((x) => x.length > 0).join(" ");
      finalShareCites.push(...unsaid);
      share = { ...share, offered: true, reason: share.offered ? share.reason : "became-core" };
    }
    // A RE-LABEL INTO ME, US OR THE OWNER is said too (owner ruling D2 on
    // #256), the same way: shown to him, not gated on him. The first finish's
    // moves are kept in its detail, so a replaced share still says them.
    const priorMoved = Array.isArray(prior["movedIn"]) ? (prior["movedIn"] as { id: string; mark: AboutMark }[]) : [];
    const movedAll = [...priorMoved, ...movedIn.filter((m) => !priorMoved.some((p) => p.id === m.id))];
    const relabelLines = shareLocked ? [] : this.relabelSentences(movedAll.filter((m) => !finalShareCites.includes(m.id)));
    if (relabelLines.length > 0) {
      shareText = [shareText, ...relabelLines].filter((x) => x.length > 0).join(" ");
      for (const m of movedAll) if (!finalShareCites.includes(m.id)) finalShareCites.push(m.id);
      share = { ...share, offered: true, reason: share.offered ? share.reason : "relabeled" };
    }
    // A share already told or carried is not replaced — but a mark this finish
    // moved into me, us or the owner is still said in the hand-back (review
    // of #268), in the self's voice, for the session to tell.
    const tellAlso = shareLocked ? this.relabelSentences(movedIn.filter((m) => !priorMoved.some((p) => p.id === m.id))) : [];

    // ── (d) open threads: asked, or closed when plainly done ───────────────
    // Only ids from the stale open list this reflection was shown. A proposal
    // (`close`, 2026-10-16, #489 D) closes nothing — the share asks, and a yes
    // closes it (`close`). A self-close (`closeNow`, 2026-10-20, an experiment
    // agreed with Mike) needs a why, keeps `closeThread`'s checks, and is said
    // in the share with the way back (`reopen`); one the owner reopened is
    // only ever asked again. Both ride in the share, so a share already told
    // or carried takes neither, and together they keep to `STALE_OPEN`.
    // The open items that named what would settle them (S1, 2026-10-27) take
    // the same doors, and add their own room to the night's limit.
    const offeredSettles = stringIds(parseDetail(row.detail)["settlesOpen"]);
    const offeredStale = new Set([...stringIds(parseDetail(row.detail)["staleOpen"]), ...offeredSettles]);
    const priorProposed = stringIds(prior["closeProposed"]);
    const priorSelfClosed = selfClosedOf(prior["selfClosed"]);
    const proposed = [...priorProposed];
    const toClose: SelfClose[] = [];
    const closeRefused: { id: string; reason: string }[] = [];
    const closeNotes: string[] = [];
    let askedInstead = 0;
    const isClosed = (cid: string): boolean => priorSelfClosed.some((x) => x.id === cid) || toClose.some((x) => x.id === cid);
    // Two allowances, counted apart (review of #665): the stale list's
    // `STALE_OPEN`, and at most `SETTLES_CLOSE` of the settles list's.
    const settlesOnly = new Set(offeredSettles.filter((x) => !stringIds(parseDetail(row.detail)["staleOpen"]).includes(x)));
    const spentOn = (settles: boolean): number =>
      [...proposed, ...priorSelfClosed.map((x) => x.id), ...toClose.map((x) => x.id)].filter((x) => settlesOnly.has(x) === settles).length;
    const full = (cid: string): boolean => (settlesOnly.has(cid) ? spentOn(true) >= T.SETTLES_CLOSE : spentOn(false) >= T.STALE_OPEN);
    // Still open and showable here: the prose read, as the wake reads it.
    const stillOpen = (cid: string): { row: MemoryRow; meta: Record<string, unknown> } | null => {
      const r = this.store.row(cid);
      if (r === undefined || r.archived !== 0 || !this.showable(r)) return null;
      try {
        const meta = this.store.readProse(cid).meta;
        return meta[UNRESOLVED_META_KEY] === true ? { row: r, meta } : null;
      } catch {
        return null;
      }
    };
    // One sent in both lists is doubt, and doubt is asked (review of #535):
    // the close loop below proposes it.
    const askedToo = new Set((input.close ?? []).filter((x): x is string => typeof x === "string"));
    for (const c of (input.closeNow ?? []).slice(0, 50)) {
      const cid = isRecord(c) && typeof c["id"] === "string" ? c["id"] : null;
      if (cid === null || isClosed(cid)) continue;
      if (askedToo.has(cid)) {
        closeNotes.push(`${cid}: sent in both close and closeNow, so asked, not closed.`);
        continue;
      }
      if (proposed.includes(cid)) {
        closeRefused.push({ id: cid, reason: "already-asked" });
        continue;
      }
      if (!offeredStale.has(cid)) {
        closeRefused.push({ id: cid, reason: "not-offered" });
        continue;
      }
      if (shareLocked) {
        closeRefused.push({ id: cid, reason: `share-already-${row.share_state}` });
        continue;
      }
      if (full(cid)) {
        closeRefused.push({ id: cid, reason: "limit" });
        continue;
      }
      const why = this.words(typeof c["why"] === "string" ? c["why"] : "", session, T.CLOSE_WHY_CHARS);
      if (!why.ok) {
        closeRefused.push({ id: cid, reason: why.reason === "empty-text" ? "why-required" : why.reason });
        continue;
      }
      const open = stillOpen(cid);
      if (open === null) {
        closeRefused.push({ id: cid, reason: "no-longer-open" });
        continue;
      }
      // ANY FOLDER (Mike, 2026-10-20 09:38: "i think its ok for nightly run
      // to close threads from other folders"; since 2026-10-21 every door
      // may, the yours/guest split removed). ASKED INSTEAD: one the owner
      // reopened, from any session, is asked about, as a proposal; the
      // owner's yes closes it.
      const guard =
        typeof open.meta[THREAD_REOPENED_BY_META_KEY] === "string"
          ? "reopened-by-owner"
          : threadGuard(open.row);
      if (guard === "reopened-by-owner") {
        proposed.push(cid);
        askedInstead += 1;
        closeNotes.push(`${cid}: asked instead of closed (${guard}).`);
        continue;
      }
      if (guard !== null) {
        closeRefused.push({ id: cid, reason: guard });
        continue;
      }
      // What shows it done: any memory that still stands (it may have been
      // read with recall, so not only one the bundle showed).
      const showsId = isRecord(c) && typeof c["shows"] === "string" ? c["shows"].trim() : "";
      const shows = showsId.length > 0 && this.store.row(showsId) !== undefined ? showsId : null;
      if (showsId.length > 0 && shows === null) closeNotes.push(`${cid}: shows ${showsId} is not a memory, so only the why is kept.`);
      if (why.cut) closeNotes.push(`${cid}: its why was kept to its first ${String(T.CLOSE_WHY_CHARS)} characters.`);
      // WEAK EVIDENCE, SAID (review of #665; warn, don't refuse): a settles
      // close whose `shows` is missing, is the item itself, or is older than
      // the item still closes, and the share says so, so the owner can reopen.
      const weak = offeredSettles.includes(cid) ? this.weakShows(open.row, shows) : null;
      if (weak !== null) closeNotes.push(`${cid}: closed, but ${weak}; the share says so.`);
      toClose.push({ id: cid, why: why.text.replace(/\s+/g, " "), ...(shows === null ? {} : { shows }), ...(weak === null ? {} : { weak }) });
    }
    for (const cid of [...new Set(input.close ?? [])]) {
      if (typeof cid !== "string") continue;
      if (proposed.includes(cid) || isClosed(cid)) continue;
      if (!offeredStale.has(cid)) {
        closeRefused.push({ id: cid, reason: "not-offered" });
        continue;
      }
      if (shareLocked) {
        closeRefused.push({ id: cid, reason: `share-already-${row.share_state}` });
        continue;
      }
      if (full(cid)) {
        closeRefused.push({ id: cid, reason: "limit" });
        continue;
      }
      if (stillOpen(cid) === null) {
        closeRefused.push({ id: cid, reason: "no-longer-open" });
        continue;
      }
      proposed.push(cid);
    }
    const priorCloseLine = typeof prior["closeLine"] === "string" ? prior["closeLine"] : null;
    // What the share says it closed: one reopened since is not said again.
    const reopenedSince = new Set(stringIds(parseDetail(row.detail)["reopened"]));
    const closedAll = [...priorSelfClosed, ...toClose].filter((x) => !reopenedSince.has(x.id));
    let closeLine: string | null = null;
    if (!shareLocked && (proposed.length > 0 || closedAll.length > 0)) {
      if (priorCloseLine !== null) shareText = withoutLine(shareText, priorCloseLine);
      closeLine = this.closeSentences(closedAll, proposed);
      shareText = [shareText, closeLine ?? ""].filter((x) => x.length > 0).join(" ");
      share = { ...share, offered: true, reason: share.offered ? share.reason : proposed.length > 0 ? "close-proposed" : "closed-said" };
    }
    // THE CORE LINE (2026-10-20, an experiment): what this reflection decided
    // on the core — keep or retire, with why — in one generated line with the
    // way back, rebuilt on a later finish like the open-thread line. A share
    // already told or carried takes none: the hand-back says it instead.
    const priorDecided = coreDecidedOf(prior["coreDecided"]);
    const decidedAll = [...priorDecided.filter((p) => !decidedNow.some((d) => d.id === p.id)), ...decidedNow];
    const priorCoreLine = typeof prior["coreLine"] === "string" ? prior["coreLine"] : null;
    let coreLine: string | null = null;
    if (!shareLocked && decidedAll.length > 0) {
      if (priorCoreLine !== null) shareText = withoutLine(shareText, priorCoreLine);
      coreLine = coreSentence(decidedAll, (x) => this.handle(x));
      shareText = [shareText, coreLine ?? ""].filter((x) => x.length > 0).join(" ");
      for (const d of decidedAll) if (!finalShareCites.includes(d.id)) finalShareCites.push(d.id);
      share = { ...share, offered: true, reason: share.offered ? share.reason : "core-decided" };
    }
    const coreTell = shareLocked ? [coreSentence(decidedNow, (x) => this.handle(x))].filter((x): x is string => x !== null) : [];
    // A PROJECT, PROPOSED (2026-10-21, wave 2 lane G; `project-ask.ts`): one
    // pair of folders a night that look like one piece of work, asked in the
    // share; the owner's yes joins them (the reflect tool's phase "join").
    const priorJoin = joinProposalOf(prior["joinProposed"]);
    const priorJoinLine = typeof prior["joinLine"] === "string" ? prior["joinLine"] : null;
    let joinProposed: JoinProposal | null = null;
    let joinLine: string | null = null;
    if (!shareLocked) {
      joinProposed = priorJoin ?? proposeJoin(this.store, { day: this.store.livedDay(), rested: this.joinRested(row.id), ...(input.folderOn === undefined ? {} : { folderOn: input.folderOn }) });
      if (joinProposed !== null) {
        if (priorJoinLine !== null) shareText = withoutLine(shareText, priorJoinLine);
        joinLine = joinSentence(joinProposed);
        shareText = [shareText, joinLine].filter((x) => x.length > 0).join(" ");
        share = { ...share, offered: true, reason: share.offered ? share.reason : "join-proposed" };
      }
    }

    // REPLACING AN OFFERED SHARE IS A CLAIM (review of #268): a later session
    // may carry it between the read above and this write; only the write that
    // still finds it offered replaces it.
    let shareWritten = !shareLocked;
    if (!shareLocked && earlierShare !== null) {
      const claimed = this.store.updateReflection(row.id, {
        share: share.offered ? shareText : null,
        shareCites: share.offered ? finalShareCites : [],
        shareState: share.offered ? "offered" : "none",
        ifShareState: "offered",
      });
      shareWritten = false;
      if (!claimed) {
        share = { offered: false, reason: "share-already-carried", detail: "Another session took the morning share to tell while this finish ran, so it is not replaced." };
        shareMiss = `${share.reason}: ${share.detail ?? ""}`;
      }
    }
    const shareStands = shareWritten || (!shareLocked && earlierShare !== null && share.offered);
    if (shareStands && share.offered) for (const id of becameCore) this.store.setMeta(`${CORE_MENTIONED_PREFIX}${id}`, row.id);

    // THE SELF-CLOSES LAND WITH THE SHARE THAT SAYS THEM (2026-10-20): checked
    // above; when another session took the share mid-finish, it says none of
    // them, so none closes. The rest are written AFTER the row — the share
    // that names them and `detail.selfClosed` — below (review of #535: a
    // final write that threw, a locked database, had left threads closed that
    // no share said and no `reopen` could find). The worst a crash between
    // leaves now is a share naming one still open, which `reopen` answers as
    // already open. The write is `closeThread`'s (the flag false, reason
    // `thread-closed`), with who closed it and why beside the flag.
    const planned: SelfClose[] = [];
    for (const x of toClose) {
      if (shareStands) planned.push(x);
      else closeRefused.push({ id: x.id, reason: "share-already-carried" });
    }
    let selfClosed = [...priorSelfClosed, ...planned];

    // ── (i) beliefs (wave 2 lane C, 2026-10-21) — each on its own ─────────
    const { adopted: candidatesAdopted, tried: candidatesTried, ...beliefParts } = this.finishBeliefs(input, { row, shown, day, session, used, again });

    // A page a first finish wrote STANDS when a second one's is refused
    // (review of #268): the hand-back and the counts say so.
    const pageStands = page.written || earlierPage !== null;
    // The entry's citations, as a set across finishes — a re-cite is not a new one.
    const entryCites = [...new Set([...idsOf(prior["entryCites"]), ...cites])];
    // THE UNMARKED OFFER, COUNTED (2026-10-24, D1): how many it was offered,
    // and which of those it marked (any mark written), across finishes.
    const offeredUnmarkedIds = stringIds(parseDetail(row.detail)["unmarked"]);
    const unmarkedMarked = [...new Set([...stringIds(prior["unmarkedMarked"]), ...about.filter((a) => a.ok && a.id !== null && offeredUnmarkedIds.includes(a.id)).map((a) => a.id as string)])];
    const counts = {
      cites: entryCites.length,
      returned: used("returned") + returned.filter((r) => r.counted).length,
      feelings: used("feelings") + feelings.filter((f) => f.ok && f.reason !== "already-recorded").length,
      about: used("about") + about.filter((a) => a.ok).length,
      unmarkedOffered: offeredUnmarkedIds.length,
      unmarkedMarked: unmarkedMarked.length,
      core: used("core") + coreDecisions.filter((x) => x.ok).length,
      traits: used("traits") + traits.filter((t) => t.ok && t.reason !== "already-recorded").length,
      page: pageStands,
      share: shareLocked ? true : share.offered,
      becameCore: becameCore.length,
      movedIntoCore: movedAll.length,
      // Open threads (2026-10-20): asked about, and closed by the reflection itself.
      closeAsked: (shareStands ? proposed : priorProposed).length,
      selfClosed: selfClosed.length,
      // ...and the ones it would have closed that this session may not, asked instead.
      closeAskedInstead: used("closeAskedInstead") + (shareStands ? askedInstead : 0),
      // The core (2026-10-20): the waiting ones offered, and what it decided.
      coreOffered: stringIds(parseDetail(row.detail)["coreOffered"]).length,
      coreKept: decidedAll.filter((d) => d.decision === "keep").length,
      coreRetired: decidedAll.filter((d) => d.decision === "retire").length,
      // Beliefs (lane C): born, filed and retired, across finishes.
      beliefBirths: used("beliefBirths") + beliefParts.births.filter((x) => x.ok && x.reason === "born").length,
      beliefFilings: used("beliefFilings") + beliefParts.filings.filter((x) => x.ok && x.reason === "filed").length,
      beliefRetired: used("beliefRetired") + beliefParts.retire.filter((x) => x.ok).length,
      beliefAdopted: used("beliefAdopted") + beliefParts.adopt.filter((x) => x.ok).length,
    };
    detail["counts"] = counts;
    const allRefused = [...(Array.isArray(prior["refusedCites"]) ? (prior["refusedCites"] as string[]) : []), ...refusedCites];
    if (allRefused.length > 0) detail["refusedCites"] = allRefused.slice(0, 20);
    detail["title"] = title;
    // Lane F: how many "## Core" sentences of the page written rest on no spine belief.
    if (unsettled !== null) detail["coreUnsettled"] = unsettled.length;
    else if (typeof prior["coreUnsettled"] === "number") detail["coreUnsettled"] = prior["coreUnsettled"];
    if (movedAll.length > 0) detail["movedIn"] = movedAll;
    if (entryCites.length > 0) detail["entryCites"] = entryCites;
    // What this reflection recorded, so a later finish does not record it twice.
    detail["recorded"] = { feelings: [...recordedFeelings], traits: [...recordedTraits] };
    // The later parts of the bundle stay fetchable after a finish (review of
    // #271): a second finish may want a memory it had not fetched yet.
    const parts = parseDetail(row.detail)["parts"];
    if (Array.isArray(parts)) detail["parts"] = parts;
    // And how its room was spent (2026-09-28): doctor reads it.
    const fitRecord = parseDetail(row.detail)["fit"];
    if (isRecord(fitRecord)) detail["fit"] = fitRecord;
    // The lanes it was shown and how its chapters came (2026-10-24): the D1
    // check reads them on a finished row.
    const lanesRecord = parseDetail(row.detail)["lanes"];
    if (isRecord(lanesRecord)) detail["lanes"] = lanesRecord;
    const chaptersAs = parseDetail(row.detail)["chaptersAs"];
    if (typeof chaptersAs === "string") detail["chaptersAs"] = chaptersAs;
    // What it was offered to mark: the next nights' rotation reads it.
    const offeredUnmarked = parseDetail(row.detail)["unmarked"];
    if (Array.isArray(offeredUnmarked)) detail["unmarked"] = offeredUnmarked;
    // And which of them it marked (2026-10-24, D1), across finishes: the ids,
    // an empty list included, so a night that marked none says so.
    if (Array.isArray(offeredUnmarked)) detail["unmarkedMarked"] = unmarkedMarked;
    // The stale open list it was shown, and what it proposed closing (2026-10-16).
    const offeredStaleList = parseDetail(row.detail)["staleOpen"];
    if (Array.isArray(offeredStaleList)) detail["staleOpen"] = offeredStaleList;
    // And the open items offered for what would settle them (S1): the next nights' rotation reads it.
    const offeredSettlesList = parseDetail(row.detail)["settlesOpen"];
    if (Array.isArray(offeredSettlesList)) detail["settlesOpen"] = offeredSettlesList;
    // The open threads not carried that night (2026-10-22): the next night counts only what is new.
    const notCarriedList = parseDetail(row.detail)["notCarried"];
    if (Array.isArray(notCarriedList)) detail["notCarried"] = notCarriedList;
    // The share that stands is the one that asks: when another session took it
    // mid-finish, the earlier proposals stand with it (review, 2026-10-16).
    const keptProposed = shareStands ? proposed : priorProposed;
    if (keptProposed.length > 0) detail["closeProposed"] = keptProposed;
    const keptLine = shareStands ? closeLine : priorCloseLine;
    if (keptLine !== null) detail["closeLine"] = keptLine;
    const closedEarlier = parseDetail(row.detail)["closed"];
    if (Array.isArray(closedEarlier)) detail["closed"] = closedEarlier;
    // What it closed itself, with why (2026-10-20), and what was reopened since.
    if (selfClosed.length > 0) detail["selfClosed"] = selfClosed;
    const reopenedEarlier = parseDetail(row.detail)["reopened"];
    if (Array.isArray(reopenedEarlier)) detail["reopened"] = reopenedEarlier;
    // The waiting core memories it was offered, and what it decided on the
    // core with why (2026-10-20): the next night's rotation and CHECK-AFTER read them.
    const offeredCore = parseDetail(row.detail)["coreOffered"];
    if (Array.isArray(offeredCore)) detail["coreOffered"] = offeredCore;
    // The spine it was shown (lane F), so a later finish may cite it on the page too.
    if (spineOn) detail["spine"] = [...spineIds];
    if (decidedAll.length > 0) detail["coreDecided"] = decidedAll;
    const keptCoreLine = shareStands ? coreLine : priorCoreLine;
    if (keptCoreLine !== null) detail["coreLine"] = keptCoreLine;
    const keptJoin = shareStands ? joinProposed : priorJoin;
    if (keptJoin !== null) detail["joinProposed"] = keptJoin;
    const keptJoinLine = shareStands ? joinLine : priorJoinLine;
    if (keptJoinLine !== null) detail["joinLine"] = keptJoinLine;
    if (prior["joined"] !== undefined) detail["joined"] = prior["joined"];
    // What it was shown of beliefs, so a later finish files to the same; and what it bore.
    Object.assign(detail, beliefsDetailOf(parseDetail(row.detail)));
    const bornEarlier = stringIds(parseDetail(row.detail)["beliefsBorn"]);
    const bornAll = [...bornEarlier, ...beliefParts.births.filter((x) => x.ok && x.reason === "born" && x.id !== null).map((x) => x.id as string)];
    if (bornAll.length > 0) detail["beliefsBorn"] = bornAll;
    // Adopted from the dream (lane C3): filed to like tonight's births, outside their budget.
    const adoptedAll = [
      ...stringIds(parseDetail(row.detail)["beliefsAdopted"]),
      ...beliefParts.births.filter((x) => x.ok && x.reason === "adopted-from-dream" && x.id !== null).map((x) => x.id as string),
    ];
    if (adoptedAll.length > 0) detail["beliefsAdopted"] = adoptedAll;
    // WHAT BECAME OF THE DREAM'S CANDIDATES (review of #583): each adopted
    // (its belief's id) or, as a finish that answered beliefs closes
    // untouched, let go — one tried and refused stays open for the next
    // finish, and so does every one when this finish sent no `beliefs` (a
    // first finish refused for its page; the retry it invites may adopt).
    const candidatesNow = new Map(decidedPairs(parseDetail(row.detail)["candidatesDecided"]));
    for (const [cid, bid] of candidatesAdopted) candidatesNow.set(cid, bid);
    if (input.beliefs !== undefined && input.beliefs !== null && this.ctx.schemas !== undefined && SCHEMAS_TUNABLES.BELIEFS_BIRTH) {
      for (const [cid] of stringIdsPairs(parseDetail(row.detail)["beliefCandidates"])) {
        if (!candidatesNow.has(cid) && !candidatesTried.has(cid)) candidatesNow.set(cid, "let-go");
      }
    }
    if (candidatesNow.size > 0) detail["candidatesDecided"] = [...candidatesNow];
    if (again) detail["finishes"] = (typeof prior["finishes"] === "number" ? prior["finishes"] : 1) + 1;
    this.store.updateReflection(row.id, {
      ...(again ? {} : { state: "reflected" as const }),
      entry: entryText,
      entryId,
      cites: [...new Set([...parseIds(row.cites), ...cites, ...pageCites])],
      ...(!shareWritten
        ? {}
        : {
            share: share.offered ? shareText : null,
            shareCites: share.offered ? finalShareCites : [],
            shareState: share.offered ? ("offered" as const) : ("none" as const),
          }),
      pageVersion: page.written ? page.version : earlierPage,
      detail,
    });
    // The flags flip now that the row says them (see above).
    const failed = new Set<string>();
    for (const x of planned) {
      try {
        this.store.revise(x.id, {
          meta: { [UNRESOLVED_META_KEY]: false, [THREAD_CLOSED_BY_META_KEY]: { reflection: row.id, why: x.why, ...(x.shows === undefined ? {} : { shows: x.shows }) } },
          reason: "thread-closed",
        });
      } catch (err) {
        failed.add(x.id);
        closeRefused.push({ id: x.id, reason: `failed: ${String((err as Error).message ?? err).slice(0, 120)}` });
      }
    }
    // One that failed to close is not said: the line, the row and the counts
    // are written again without it.
    if (failed.size > 0) {
      selfClosed = selfClosed.filter((x) => !failed.has(x.id));
      const fixed = this.closeSentences(
        selfClosed.filter((x) => !reopenedSince.has(x.id)),
        proposed,
      );
      if (closeLine !== null) shareText = [withoutLine(shareText, closeLine), fixed ?? ""].filter((x) => x.length > 0).join(" ");
      closeLine = fixed;
      if (shareText.length === 0) share = { offered: false, reason: "no-share" };
      counts.selfClosed = selfClosed.length;
      counts.share = share.offered;
      if (selfClosed.length > 0) detail["selfClosed"] = selfClosed;
      else delete detail["selfClosed"];
      if (closeLine !== null) detail["closeLine"] = closeLine;
      else delete detail["closeLine"];
      this.store.updateReflection(row.id, { detail });
      this.store.updateReflection(row.id, {
        share: share.offered ? shareText : null,
        ...(share.offered ? {} : { shareCites: [], shareState: "none" as const }),
        ifShareState: "offered",
      });
    }
    const said = selfClosed.filter((x) => !reopenedSince.has(x.id));
    this.record("reflection.finished", row.id, {
      dream: row.dream_id,
      nothingMuch,
      again,
      ...counts,
    });

    // WHAT WAS NOT WRITTEN, and that it can be sent again (2026-09-28).
    const missed: string[] = [];
    if (pageRefused) missed.push(`page — ${page.reason}${page.detail !== undefined ? `: ${page.detail}` : ""}`);
    if (shareMiss !== null) missed.push(`share — ${shareMiss}`);
    for (const c of closeRefused) missed.push(`close (${c.id}) — ${c.reason}`);
    for (const [part, list] of [["feelings", feelings], ["about", about], ["core", coreDecisions], ["traits", traits], ["beliefs.births", beliefParts.births], ["beliefs.filings", beliefParts.filings], ["beliefs.retire", beliefParts.retire], ["beliefs.adopt", beliefParts.adopt]] as const) {
      list.forEach((x, i) => {
        if (!x.ok) missed.push(`${part}[${String(i)}]${x.id === null ? "" : ` (${x.id})`} — ${x.reason}${x.detail !== undefined ? `: ${x.detail}` : ""}`);
      });
    }
    const retry =
      missed.length === 0
        ? null
        : `Not written: ${missed.join("; ")}. You can fix these and call finish again with reflection ${row.id} and just those parts — the entry and everything already written stand.`;

    const how = shareStands
      ? [
          this.closeHow(row.id, proposed, said.map((x) => x.id)),
          coreLine === null ? null : coreHow(decidedAll, this.ctx.ownerName() ?? "the owner"),
          joinProposed === null ? null : joinHow(row.id, joinProposed, this.ctx.ownerName() ?? "the owner"),
        ].filter((x): x is string => x !== null)
      : [];
    const handBack = this.handBack(row, !shareLocked && share.offered ? shareText : null, nothingMuch, pageStands, [...tellAlso, ...coreTell], how.length > 0 ? how.join(" ") : null);
    return {
      ok: true,
      outcome: {
        handBack,
        nothingMuch,
        entryId,
        again,
        entry: { reason: entryReason, ...(entryNote === undefined ? {} : { note: entryNote }) },
        returned,
        page,
        share,
        feelings,
        about,
        core: coreDecisions,
        traits,
        beliefs: beliefParts,
        refusedCites,
        close: { proposed: keptProposed, closed: selfClosed, refused: closeRefused, ...(closeNotes.length > 0 ? { notes: closeNotes } : {}) },
        retry,
      },
    };
  }

  /** Why an id cannot be cited, felt or marked here, in words. */
  private notCitable(id: string | null, shown: ReadonlySet<string>): string {
    if (id === null) return "No id was given.";
    if (!shown.has(id)) return `${id} was not among the memories you were shown; use an id from the bundle.`;
    return `${id} is gone since you were shown it (archived, merged or made private).`;
  }

  /** What a per-reflection limit says. */
  /**
   * THE BELIEFS ON THE SUBJECTS IN PLAY (wave 2 lane C, 2026-10-21): the self
   * subject first (made the first time it is asked for), then the live cards
   * the given memories name most, at most `BELIEF_SUBJECTS_SHOWN`, each with
   * its strongest beliefs (`BELIEFS_SHOWN_PER_SUBJECT`) and the rest counted.
   * Null when beliefs are off or `schemas/` is not wired. Read at begin.
   */
  /** What every reflection of this dream decided of its candidates (review of #583): the first word on each stands. */
  private candidatesDecided(dreamId: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of this.store.reflections({ dreamId, limit: 50 })) {
      for (const [cid, v] of decidedPairs(parseDetail(r.detail)["candidatesDecided"])) if (!out.has(cid)) out.set(cid, v);
    }
    return out;
  }

  private beliefsInPlay(day: number, memoryIds: readonly string[], dreamId: string | null = null): ReflectBeliefs | null {
    const schemas = this.ctx.schemas;
    if (schemas === undefined || !SCHEMAS_TUNABLES.BELIEFS_BIRTH) return null;
    const me = schemas.ensureSelfSubject();
    const named = new Map<string, number>();
    for (const mid of memoryIds) {
      for (const sid of this.store.subjectsOf(mid)) {
        if (sid !== me) named.set(sid, (named.get(sid) ?? 0) + 1);
      }
    }
    const cards = [...named]
      .filter(([sid]) => {
        const e = schemas.entity(sid);
        return e !== undefined && !e.archived;
      })
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, Math.max(0, SCHEMAS_TUNABLES.BELIEF_SUBJECTS_SHOWN - 1))
      .map(([sid]) => sid);
    const subjects = [me, ...cards].map((sid) => {
      const all = schemas.beliefStanding(sid, day);
      const shownNow = all.slice(0, SCHEMAS_TUNABLES.BELIEFS_SHOWN_PER_SUBJECT);
      const e = schemas.entity(sid);
      const row = this.store.row(sid);
      return {
        id: sid,
        name: sid === me ? "me (and us)" : (e?.name ?? sid),
        kind: sid === me ? "me" : (row?.subject_kind ?? e?.kind ?? "entity"),
        beliefs: shownNow.map((b) => ({
          id: b.id,
          statement: clipWire(b.statement, REFLECT_TUNABLES.BELIEF_SHOWN_CHARS),
          strength: Math.round(b.strength * 100) / 100,
          support: b.support,
          against: b.against,
          ...(b.about === null ? {} : { about: b.about }),
          ...(b.contested
            ? {
                contested: true as const,
                contestedBy: this.store
                  .supportOf(b.id)
                  .filter((r) => r.stance === "contrary")
                  .map((r) => r.memoryId),
              }
            : {}),
        })),
        more: all.length - shownNow.length,
      };
    });
    // WHAT TONIGHT'S DREAM PROPOSED (lane C3): its standing candidates — not
    // one a reflection of the same dream already adopted or let go.
    const decided = dreamId === null ? new Map<string, string>() : this.candidatesDecided(dreamId);
    const candidates =
      dreamId === null
        ? []
        : this.store
            .dreamChanges(dreamId)
            .filter((c) => c.action === "belief-candidate" && c.undone === 0)
            .map((c) => {
              const d = parseDetail(c.detail);
              return {
                id: `${dreamId}#${String(c.seq)}`,
                subject: typeof d["subject"] === "string" ? d["subject"] : "me",
                statement: typeof d["statement"] === "string" ? clipWire(d["statement"], REFLECT_TUNABLES.BELIEF_SHOWN_CHARS) : "",
                sources: stringIds(d["sources"]),
              };
            })
            .filter((c) => c.statement.length > 0 && !decided.has(c.id));
    // HELD TO ITS SHARE OF THE ROOM, ROUND-ROBIN (review of #577): the subject
    // showing the most gives up its weakest belief to `more`, until the
    // section fits — every subject keeping `BELIEFS_KEPT_PER_SUBJECT` while
    // that is enough, me and us (first) the last to give any up: they are the
    // spine, and read weaker than a person's beliefs only for being younger.
    const room = REFLECT_TUNABLES.ROOM_CHARS * REFLECT_TUNABLES.BELIEF_SHARE;
    // (The dream's few candidates stay whole.)
    const section = { subjects, births: SCHEMAS_TUNABLES.BELIEF_BIRTHS_PER_REFLECTION, ...(candidates.length > 0 ? { candidates } : {}) };
    const keep = REFLECT_TUNABLES.BELIEFS_KEPT_PER_SUBJECT;
    const pick = (floor: number, withMe: boolean): number => {
      let at = -1;
      subjects.forEach((s, i) => {
        if ((i === 0 && !withMe) || s.beliefs.length <= floor) return;
        // The most shown; on a tie the later (another subject before me).
        if (at === -1 || s.beliefs.length >= (subjects[at] as (typeof subjects)[number]).beliefs.length) at = i;
      });
      return at;
    };
    while (wireChars(JSON.stringify(section)) > room) {
      let at = pick(keep, true);
      if (at === -1) at = pick(0, false);
      if (at === -1) at = pick(0, true);
      if (at === -1) break;
      const subj = subjects[at] as (typeof subjects)[number];
      let weakest = 0;
      subj.beliefs.forEach((b, i) => {
        if (b.strength < (subj.beliefs[weakest] as (typeof subj.beliefs)[number]).strength) weakest = i;
      });
      subjects[at] = { ...subj, beliefs: subj.beliefs.filter((_, i) => i !== weakest), more: subj.more + 1 };
    }
    return section;
  }

  /**
   * THE BELIEFS PART OF A FINISH (wave 2 lane C, 2026-10-21), each item on
   * its own. FILINGS: a memory it was shown (lived — not a dream's words or a
   * reflection's entry) counted for or against a belief it was shown or bore
   * tonight, through `schemas#fileSupport` (route `found` unless the memory
   * is the owner's words or my choice); a memory counted before adds nothing.
   * BIRTHS: at most `BELIEF_BIRTHS_PER_REFLECTION`, on a subject it was shown,
   * born weak (`addBelief`, route `reflection`), each lived cite filed as its
   * first support; one close to a live belief on the subject is refused with
   * that belief's id. RETIRE: a contested belief it was shown, let go through
   * the settle door — the memory that contested it holds over it,
   * `corrected` — with the reflection's why. `replaces` on a birth retires
   * the contested belief it says better, once the new one is born.
   */
  private finishBeliefs(
    input: ReflectFinish,
    ctx: { row: ReflectionRow; shown: ReadonlySet<string>; day: number; session: string; used: (k: string) => number; again: boolean },
  ): { births: PartResult[]; filings: PartResult[]; retire: PartResult[]; adopt: PartResult[]; adopted: Map<string, string>; tried: Set<string> } {
    const out = { births: [] as PartResult[], filings: [] as PartResult[], retire: [] as PartResult[], adopt: [] as PartResult[], adopted: new Map<string, string>(), tried: new Set<string>() };
    const sent = input.beliefs ?? null;
    if (sent === null) return out;
    const schemas = this.ctx.schemas;
    const off = schemas === undefined || !SCHEMAS_TUNABLES.BELIEFS_BIRTH;
    const offPart = (id: string | null): PartResult => ({ id, ok: false, reason: "beliefs-off", detail: "Beliefs are off tonight: nothing was born, filed or retired." });
    const shownDetail = beliefsDetailOf(parseDetail(ctx.row.detail));
    const me = typeof shownDetail.beliefSelf === "string" ? shownDetail.beliefSelf : null;
    const subjects = new Set(shownDetail.beliefSubjects ?? []);
    const shownBeliefs = new Set(shownDetail.beliefsShown ?? []);
    const contestedShown = new Set(shownDetail.beliefsContested ?? []);
    // What this reflection bore, in this finish or an earlier one: filed to like what it was shown.
    const born = new Set<string>([...stringIds(parseDetail(ctx.row.detail)["beliefsBorn"]), ...stringIds(parseDetail(ctx.row.detail)["beliefsAdopted"])]);
    const lived = (id: unknown): string | null => {
      if (typeof id !== "string" || !ctx.shown.has(id)) return "not-shown-or-gone";
      const r = this.store.row(id);
      if (r === undefined || !this.showable(r)) return "not-shown-or-gone";
      if (r.source === "dreamed" || r.source === "reflection") return "not-lived";
      return null;
    };
    const retireOne = (beliefId: string, why: string): PartResult => {
      if (schemas === undefined) return offPart(beliefId);
      if (!contestedShown.has(beliefId)) {
        return { id: beliefId, ok: false, reason: "not-contested", detail: `${beliefId} was not shown to this reflection as contested: only a contested belief is let go here.` };
      }
      let by: unknown;
      try {
        by = (this.store.readProse(beliefId).meta["contested"] as Record<string, unknown> | undefined)?.["by"];
      } catch {
        by = undefined;
      }
      if (typeof by !== "string") return { id: beliefId, ok: false, reason: "not-contested", detail: `${beliefId} carries no contested mark now.` };
      const w = this.words(why, ctx.session, T_WHY, true);
      if (!w.ok || w.text.length === 0) return { id: beliefId, ok: false, reason: "why-required", detail: "Say why it is let go, in a line." };
      const settled = settleContradiction(this.store, { holds: by, over: beliefId, how: "corrected", why: w.text, actor: "reflection", actorId: ctx.row.id });
      return settled.ok ? { id: beliefId, ok: true, reason: "retired" } : { id: beliefId, ok: false, reason: settled.reason, ...(settled.detail === undefined ? {} : { detail: settled.detail }) };
    };

    // Births first, so tonight's filings may go to what was born tonight. The
    // budget reads what this reflection has borne, written to its row at each
    // birth (review of #577), so a finish cut short cannot birth past it on retry.
    const bornSoFar = stringIds(parseDetail(ctx.row.detail)["beliefsBorn"]);
    for (const b of (sent.births ?? []).slice(0, 20)) {
      if (off) {
        out.births.push(offPart(null));
        continue;
      }
      const sch = schemas as Schemas;
      if (bornSoFar.length >= SCHEMAS_TUNABLES.BELIEF_BIRTHS_PER_REFLECTION) {
        out.births.push({ id: null, ok: false, reason: "limit-reached", detail: `A reflection births at most ${String(SCHEMAS_TUNABLES.BELIEF_BIRTHS_PER_REFLECTION)} beliefs${ctx.again ? ", counting the earlier finish" : ""}; file support for one already held instead.` });
        continue;
      }
      const asked = typeof b.subject === "string" ? b.subject.trim() : "";
      const subject = asked === "me" || asked === "us" || (me !== null && asked === me) ? me : subjects.has(asked) ? asked : null;
      if (subject === null) {
        out.births.push({ id: null, ok: false, reason: "subject-not-shown", detail: `subject is "me" (for me or us) or an id from beliefs.subjects; "${asked}" is neither.` });
        continue;
      }
      const notes: string[] = [];
      const onMe = subject === me;
      const aboutAsked = b.about ?? (asked === "us" ? "us" : undefined);
      const about: "me" | "us" | undefined = onMe ? (aboutAsked === "us" ? "us" : "me") : undefined;
      if (!onMe && aboutAsked !== undefined) notes.push("about is for a belief about me or us, on me; on another subject it was left off.");
      // One line (review of #577): a belief is read as a line wherever it shows.
      const w = this.words(oneLine(b.statement ?? ""), ctx.session, REFLECT_TUNABLES.MAX_BELIEF_CHARS);
      if (!w.ok || w.text.length === 0) {
        out.births.push({ id: null, ok: false, reason: "statement-required", detail: w.ok ? "A belief is one short claim, in statement." : w.detail });
        continue;
      }
      if (w.cut) notes.push(`The statement was kept to its first ${String(REFLECT_TUNABLES.MAX_BELIEF_CHARS)} characters.`);
      const cites = [...new Set(b.cites ?? [])];
      const good = cites.filter((c) => lived(c) === null);
      if (good.length === 0) {
        out.births.push({ id: null, ok: false, reason: "needs-a-lived-cite", detail: "A belief rests on lived memories you were shown: cite at least one (not a dream's words or a reflection's entry)." });
        continue;
      }
      if (good.length < cites.length) notes.push(`Not filed as support (not shown, gone, or not lived): ${cites.filter((c) => !good.includes(c)).join(", ")}.`);
      // A MEMORY PASTED IN is not a belief drawn from it (review of #577).
      const pasted = good.find((c) => similarity(w.text, this.store.row(c)?.body ?? "") > SCHEMAS_TUNABLES.BELIEF_PASTED);
      if (pasted !== undefined) {
        out.births.push({ id: null, ok: false, reason: "pasted-from-memory", detail: `The statement is ${pasted}'s own words: a belief is the claim the memories add up to, in a line of your own.` });
        continue;
      }
      // REPLACES (review of #577): only a contested belief this reflection was
      // shown, on the same subject — else the birth is refused, and nothing
      // is excepted from the near-duplicate check.
      const replaces = typeof b.replaces === "string" && b.replaces.length > 0 ? b.replaces : null;
      if (replaces !== null && !contestedShown.has(replaces)) {
        out.births.push({ id: replaces, ok: false, reason: "replaces-not-contested", detail: `${replaces} was not shown to this reflection as contested: only a contested belief is said better here; file to it instead.` });
        continue;
      }
      if (replaces !== null && sch.element(replaces)?.entityId !== subject) {
        out.births.push({ id: replaces, ok: false, reason: "replaces-other-subject", detail: `${replaces} is a belief about another subject than "${asked}".` });
        continue;
      }
      // A REVISION RESTS ON THE EVIDENCE (the coordinator, review of #577):
      // a replacement cites at least one memory that went against the belief
      // it replaces. A restatement does not; word overlap alone cannot tell
      // them apart ("We work best at dawn, not at night." reads 0.85).
      if (replaces !== null) {
        const evidence = new Set(this.store.supportOf(replaces).filter((r) => r.stance === "contrary").map((r) => r.memoryId));
        if (!good.some((c) => evidence.has(c))) {
          out.births.push({ id: replaces, ok: false, reason: "replaces-without-the-evidence", detail: `A replacement rests on what went against ${replaces}: cite one of its contestedBy memories.` });
          continue;
        }
      }
      // Saying it better is not saying it again (review of #577): a
      // replacement that repeats its contested target's claim would reissue
      // it with what went against it no longer counted.
      const replacedText = replaces === null ? null : (sch.element(replaces)?.statement ?? null);
      if (replaces !== null && replacedText !== null && similarity(w.text, replacedText) >= SCHEMAS_TUNABLES.BELIEF_SAME_CLAIM && !negationDiffers(w.text, replacedText)) {
        out.births.push({ id: replaces, ok: false, reason: "replaces-same-claim", detail: `It says what ${replaces} says: a replacement says something else — or let it go with retire.` });
        continue;
      }
      const near = sch.nearestBelief(subject, w.text, replaces ?? undefined);
      if (near !== null) {
        out.births.push({ id: near.id, ok: false, reason: "near-duplicate", detail: `It says what ${near.id} says ("${clipWire(near.statement, 120)}"): file support for that one in beliefs.filings instead.` });
        continue;
      }
      const made = sch.addBelief({ entityId: subject, statement: w.text, day: ctx.day, birthRoute: "reflection", channel: "authored", groundedIn: good, ...(about === undefined ? {} : { about }) });
      if (!made.ok || made.id === null) {
        out.births.push({ id: null, ok: false, reason: made.reason });
        continue;
      }
      born.add(made.id);
      bornSoFar.push(made.id);
      this.noteBorn(ctx.row.id, bornSoFar);
      const routes: string[] = [];
      for (const c of good) {
        const f = sch.fileSupport({ beliefId: made.id, memoryId: c, stance: "support", day: ctx.day });
        if (f.ok && f.route !== null) routes.push(f.route);
      }
      notes.unshift(`Born weak, backed by ${String(routes.length)} ${routes.length === 1 ? "memory" : "memories"} (${routes.join(", ")}).`);
      if (replaces !== null) {
        const r = retireOne(replaces, `said better by ${made.id}`);
        notes.push(r.ok ? `${replaces} was let go: ${made.id} says it better.` : `${replaces} was not let go (${r.reason}).`);
        if (r.ok) out.retire.push(r);
      }
      out.births.push({ id: made.id, ok: true, reason: "born", note: notes.join(" ") });
    }

    for (const f of (sent.filings ?? []).slice(0, 50)) {
      const beliefId = typeof f.belief === "string" ? f.belief : null;
      if (off) {
        out.filings.push(offPart(beliefId));
        continue;
      }
      const sch = schemas as Schemas;
      if (ctx.used("beliefFilings") + out.filings.filter((x) => x.ok && x.reason === "filed").length >= REFLECT_TUNABLES.LIMITS.beliefFilings) {
        out.filings.push({ id: beliefId, ok: false, reason: "limit-reached", detail: this.limitDetail("beliefFilings", ctx.again) });
        continue;
      }
      if (beliefId === null || !(shownBeliefs.has(beliefId) || born.has(beliefId))) {
        out.filings.push({ id: beliefId, ok: false, reason: "belief-not-shown", detail: "belief is the id of a belief in beliefs.subjects, or one born in this finish." });
        continue;
      }
      if (f.stance !== "support" && f.stance !== "contrary") {
        out.filings.push({ id: beliefId, ok: false, reason: "stance-is-support-or-contrary", detail: 'stance is "support" (it backs the belief) or "contrary" (it goes against it).' });
        continue;
      }
      const bad = lived(f.memory);
      if (bad !== null) {
        out.filings.push({ id: beliefId, ok: false, reason: bad, detail: bad === "not-lived" ? `${String(f.memory)} is a dream's words or a reflection's entry: only what was lived backs a belief.` : this.notCitable(typeof f.memory === "string" ? f.memory : null, ctx.shown) });
        continue;
      }
      const r = sch.fileSupport({ beliefId, memoryId: f.memory as string, stance: f.stance, day: ctx.day });
      if (r.reason === "already-counted") {
        out.filings.push({ id: beliefId, ok: true, reason: "already-counted", note: `${String(f.memory)} was counted for this belief already: a memory counts once.` });
        continue;
      }
      out.filings.push(
        r.ok
          ? {
              id: beliefId,
              ok: true,
              reason: "filed",
              note: `${String(f.memory)} counted ${f.stance === "support" ? "for" : "against"} it as ${String(r.route)} (${String(Math.round(r.weight * 100) / 100)})${r.revision?.contested === true ? "; it is now contested" : ""}.${r.note === undefined ? "" : ` ${r.note}`}`,
            }
          : { id: beliefId, ok: false, reason: r.reason },
      );
    }

    // ADOPTED FROM THE DREAM (lane C3): a candidate it was shown, born weak by
    // the route `dream`, its lived sources its first support; the reflection
    // may say it better and name its subject. What is not adopted is let go.
    // ONE CANDIDATE, ONE BELIEF (review of #583): what became of each is
    // kept on the reflection's row (`candidatesDecided`), so a second finish,
    // or a later reflection of the same dream, cannot adopt it again; a
    // refused attempt leaves it open (`tried`) for the next finish to say better.
    const offered = new Map(stringIdsPairs(parseDetail(ctx.row.detail)["beliefCandidates"]));
    const decidedBefore = ctx.row.dream_id === null ? new Map<string, string>() : this.candidatesDecided(ctx.row.dream_id);
    for (const a of (sent.adopt ?? []).slice(0, 10)) {
      const cid = typeof a.candidate === "string" ? a.candidate : null;
      if (off) {
        out.adopt.push(offPart(cid));
        continue;
      }
      const sch = schemas as Schemas;
      const cand = cid === null ? undefined : offered.get(cid);
      if (cid === null || cand === undefined) {
        out.adopt.push({ id: cid, ok: false, reason: "candidate-not-shown", detail: "candidate is an id from beliefs.candidates (tonight's dream's)." });
        continue;
      }
      const was = out.adopted.get(cid) ?? decidedBefore.get(cid);
      if (was !== undefined) {
        out.adopt.push(
          was === "let-go"
            ? { id: cid, ok: false, reason: "let-go", detail: `${cid} was let go when an earlier finish closed without adopting it.` }
            : { id: cid, ok: false, reason: "already-adopted", detail: `${cid} was adopted already, as ${was}: file to that belief in beliefs.filings instead.` },
        );
        continue;
      }
      out.tried.add(cid);
      const asked = (typeof a.subject === "string" && a.subject.trim().length > 0 ? a.subject : cand.subject).trim();
      const byName = [...subjects].find((sid) => sch.entity(sid)?.name.toLowerCase() === asked.toLowerCase());
      const subject = asked === "me" || asked === "us" || (me !== null && asked === me) ? me : subjects.has(asked) ? asked : (byName ?? null);
      if (subject === null) {
        out.adopt.push({ id: cid, ok: false, reason: "subject-not-shown", detail: `"${asked}" is not a subject shown in beliefs.subjects: name one ("me", "us", or a subject's id) in subject.` });
        continue;
      }
      const w = this.words(oneLine(typeof a.statement === "string" && a.statement.trim().length > 0 ? a.statement : cand.statement), ctx.session, REFLECT_TUNABLES.MAX_BELIEF_CHARS);
      if (!w.ok || w.text.length === 0) {
        out.adopt.push({ id: cid, ok: false, reason: "statement-required", detail: w.ok ? "The belief is one short claim." : w.detail });
        continue;
      }
      const good = cand.sources.filter((c) => lived(c) === null);
      const pastedFrom = good.find((c) => similarity(w.ok ? w.text : "", this.store.row(c)?.body ?? "") > SCHEMAS_TUNABLES.BELIEF_PASTED);
      if (pastedFrom !== undefined) {
        out.adopt.push({ id: cid, ok: false, reason: "pasted-from-memory", detail: `It is ${pastedFrom}'s own words: adopt it with a statement of your own.` });
        continue;
      }
      if (good.length === 0) {
        out.adopt.push({ id: cid, ok: false, reason: "needs-a-lived-cite", detail: "None of its sources is a lived memory still standing: nothing would back it." });
        continue;
      }
      const near = sch.nearestBelief(subject, w.text);
      if (near !== null) {
        out.adopt.push({ id: near.id, ok: false, reason: "near-duplicate", detail: `It says what ${near.id} says ("${clipWire(near.statement, 120)}"): file its sources to that one in beliefs.filings instead.` });
        continue;
      }
      const about: "me" | "us" | undefined = subject === me ? (asked === "us" ? "us" : "me") : undefined;
      const made = sch.addBelief({ entityId: subject, statement: w.text, day: ctx.day, birthRoute: "dream", channel: "authored", groundedIn: good, fromCandidate: cid, ...(about === undefined ? {} : { about }) });
      if (!made.ok || made.id === null) {
        out.adopt.push({ id: cid, ok: false, reason: made.reason });
        continue;
      }
      born.add(made.id);
      out.adopted.set(cid, made.id);
      out.tried.delete(cid);
      for (const c of good) sch.fileSupport({ beliefId: made.id, memoryId: c, stance: "support", day: ctx.day });
      out.adopt.push({ id: cid, ok: true, reason: "adopted", note: `Born weak as ${made.id}, backed by ${String(good.length)} of its sources.` });
      out.births.push({ id: made.id, ok: true, reason: "adopted-from-dream" });
    }

    for (const x of (sent.retire ?? []).slice(0, 20)) {
      const beliefId = typeof x.belief === "string" ? x.belief : null;
      if (off) {
        out.retire.push(offPart(beliefId));
        continue;
      }
      if (beliefId === null) {
        out.retire.push({ id: null, ok: false, reason: "belief-required", detail: "belief is the id of a contested belief in beliefs.subjects." });
        continue;
      }
      out.retire.push(retireOne(beliefId, x.why ?? ""));
    }
    return out;
  }

  /** What this reflection has borne, on its row at once (review of #577): the births budget reads it. */
  private noteBorn(reflection: string, born: readonly string[]): void {
    const row = this.store.reflection(reflection);
    if (row === undefined) return;
    this.store.updateReflection(reflection, { detail: { ...parseDetail(row.detail), beliefsBorn: [...born] } });
  }

  private limitDetail(part: keyof typeof REFLECT_TUNABLES.LIMITS, again: boolean): string {
    return `A reflection records at most ${String(REFLECT_TUNABLES.LIMITS[part])} ${part === "about" ? "about marks" : part === "core" ? "core decisions" : part === "beliefFilings" ? "belief filings" : part}${again ? ", counting the earlier finish" : ""}.`;
  }

  /** The dreamer's (or reflector's) final message: the dream's line, then the share. */
  private handBack(row: ReflectionRow, share: string | null, nothingMuch: boolean, page: boolean, tellAlso: readonly string[] = [], closeHow: string | null = null): string {
    const who = this.ctx.ownerName() ?? "the owner";
    const dreamLine = row.dream_id === null ? null : this.ctx.dreamLine(row.dream_id);
    const head = dreamLine ?? `${reflectionOpener(row.id)} I reflected for a few minutes.`;
    const pageLine = page ? " I rewrote my self page." : "";
    if (share === null) {
      // The share was already told: a mark moved into me, us or the owner
      // since is still said, for the session to tell in its own words.
      const also = tellAlso.length === 0 ? "" : ` Tell ${who} in your own words: ${tellAlso.join(" ")}`;
      return `${head}\n${reflectionOpener(row.id)} I reflected afterwards${nothingMuch ? " — nothing much tonight" : ""}; nothing to share this morning.${pageLine}${also}`;
    }
    return (
      `${head}\n${reflectionOpener(row.id)} I reflected afterwards.${pageLine} Morning share for ${who} — tell it in your own words, as a telling ("While I slept I dreamed…", "I've been thinking…"), tentatively where it is about ${who}. ` +
      `Once you have told it, the counterparts reflect tool's phase "told", reflection: ${row.id}, marks it told, so another session does not carry it and tell it again.${closeHow === null ? "" : ` ${closeHow}`}\n${share}`
    );
  }

  // ── told, and carried ─────────────────────────────────────────────────────

  /**
   * THE SHARE WAS TOLD: the session relayed it to the owner. Records `told` on
   * each memory it cites (`core_events`, actor `session`) — the owner's reply
   * is not weighed yet (a follow-up). Once per share.
   */
  told(input: { reflection: string; session: string }): { ok: boolean; reason: string; cited: number } {
    if (this.ctx.observer) return { ok: false, reason: "observer", cited: 0 };
    const row = this.store.reflection(input.reflection);
    if (row === undefined) return { ok: false, reason: "unknown-reflection", cited: 0 };
    if (row.share_state === "told") return { ok: false, reason: "already-told", cited: 0 };
    if (row.share_state !== "offered" && row.share_state !== "carried") return { ok: false, reason: "no-share", cited: 0 };
    const day = this.store.livedDay();
    const ids = parseIds(row.share_cites);
    for (const id of ids) {
      if (this.store.row(id) === undefined) continue;
      this.store.appendCoreEvent({ memoryId: id, action: "told", day, reason: row.id, dreamId: row.dream_id, actor: "session" });
    }
    this.store.updateReflection(row.id, { shareState: "told", shareSession: input.session });
    this.record("reflection.told", row.id, { cited: ids.length });
    return { ok: true, reason: "told", cited: ids.length };
  }

  /**
   * A YES TO THE CLOSE PROPOSALS (2026-10-16, #489 D; a lightly held default):
   * the owner, asked in the share, agreed some open threads are done. Closes
   * only ids this reflection proposed, with the write a deposit that answers a
   * thread makes (`counterpart-deposit.ts#closeThread`: the flag set false,
   * reason `thread-closed`) and its checks — the owner's protection and an
   * archived row, from any folder. Any day, told or not; an id already
   * closed is said so, not refused.
   */
  close(input: { reflection: string; session: string; ids: readonly string[]; scope?: string | null }):
    | { ok: true; closed: string[]; already: string[]; refused: { id: string; reason: string }[] }
    | { ok: false; reason: string } {
    if (this.ctx.observer) return { ok: false, reason: "observer" };
    const row = this.store.reflection(input.reflection);
    if (row === undefined) return { ok: false, reason: "unknown-reflection" };
    const d = parseDetail(row.detail);
    const proposed = new Set(stringIds(d["closeProposed"]));
    if (proposed.size === 0) return { ok: false, reason: "nothing-proposed" };
    const ids = [...new Set(input.ids)].filter((x) => typeof x === "string" && x.length > 0);
    if (ids.length === 0) return { ok: false, reason: "ids-required" };
    const closed: string[] = [];
    const already: string[] = [];
    const refused: { id: string; reason: string }[] = [];
    for (const id of ids) {
      if (!proposed.has(id)) {
        refused.push({ id, reason: "not-proposed" });
        continue;
      }
      const r = this.store.row(id);
      if (r === undefined) {
        refused.push({ id, reason: "gone" });
        continue;
      }
      let open = false;
      try {
        open = this.store.readProse(id).meta[UNRESOLVED_META_KEY] === true;
      } catch {
        refused.push({ id, reason: "unreadable" });
        continue;
      }
      if (!open) {
        already.push(id);
        continue;
      }
      const why = threadGuard(r);
      if (why !== null) {
        refused.push({ id, reason: why });
        continue;
      }
      try {
        this.store.revise(id, { meta: { [UNRESOLVED_META_KEY]: false }, reason: "thread-closed" });
        closed.push(id);
      } catch (err) {
        refused.push({ id, reason: `failed: ${String((err as Error).message ?? err).slice(0, 120)}` });
      }
    }
    if (closed.length > 0) {
      const fresh = this.store.reflection(row.id);
      const detail = parseDetail(fresh?.detail ?? row.detail);
      detail["closed"] = [...new Set([...stringIds(detail["closed"]), ...closed])];
      this.store.updateReflection(row.id, { detail });
    }
    this.record("reflection.closed", row.id, { closed: closed.length, already: already.length, refused: refused.length, session: input.session });
    return { ok: true, closed, already, refused };
  }

  /**
   * THE WAY BACK FROM A SELF-CLOSE (2026-10-20, an experiment agreed with
   * Mike): the owner said a thread the reflection closed is not done. Reopens
   * only threads a reflection closed itself — the flag set true again, reason
   * `thread-reopened` — with `close`'s checks, any day, told or not. FROM THE
   * THREAD ID ALONE (review of #535): the session the owner says it to may
   * never have seen the share, so the reflection is the one the memory names
   * (`threadClosedBy.reflection`), confirmed on that reflection's
   * `detail.selfClosed`; a `reflection` given narrows it to that one. The
   * memory keeps `threadReopenedBy`, so no later reflection closes it again on
   * its own: it may only ask. One already open is said so.
   */
  reopen(input: { reflection?: string | null; session: string; ids: readonly string[]; scope?: string | null }):
    | { ok: true; reopened: string[]; already: string[]; refused: { id: string; reason: string }[] }
    | { ok: false; reason: string } {
    if (this.ctx.observer) return { ok: false, reason: "observer" };
    let only: ReflectionRow | null = null;
    if (typeof input.reflection === "string" && input.reflection.length > 0) {
      only = this.store.reflection(input.reflection) ?? null;
      if (only === null) return { ok: false, reason: "unknown-reflection" };
      if (selfClosedOf(parseDetail(only.detail)["selfClosed"]).length === 0) return { ok: false, reason: "nothing-closed" };
    }
    const ids = [...new Set(input.ids)].filter((x) => typeof x === "string" && x.length > 0);
    if (ids.length === 0) return { ok: false, reason: "ids-required" };
    const reopened: string[] = [];
    const already: string[] = [];
    const refused: { id: string; reason: string }[] = [];
    const byReflection = new Map<string, string[]>();
    const notMine = only === null ? "not-closed-by-a-reflection" : "not-closed-by-this-reflection";
    for (const id of ids) {
      const r = this.store.row(id);
      let meta: Record<string, unknown>;
      try {
        meta = r === undefined ? {} : this.store.readProse(id).meta;
      } catch {
        refused.push({ id, reason: "unreadable" });
        continue;
      }
      // Which reflection closed it: the one given, else the one it names.
      const named = isRecord(meta[THREAD_CLOSED_BY_META_KEY]) ? meta[THREAD_CLOSED_BY_META_KEY]["reflection"] : null;
      const closer = only ?? (typeof named === "string" ? (this.store.reflection(named) ?? null) : null);
      if (closer === null || !selfClosedOf(parseDetail(closer.detail)["selfClosed"]).some((x) => x.id === id)) {
        refused.push({ id, reason: notMine });
        continue;
      }
      if (r === undefined) {
        refused.push({ id, reason: "gone" });
        continue;
      }
      if (meta[UNRESOLVED_META_KEY] === true) {
        already.push(id);
        continue;
      }
      // The way back reaches as far as the self-close did: any folder.
      const why = threadGuard(r);
      if (why !== null) {
        refused.push({ id, reason: why });
        continue;
      }
      try {
        this.store.revise(id, { meta: { [UNRESOLVED_META_KEY]: true, [THREAD_REOPENED_BY_META_KEY]: closer.id }, reason: "thread-reopened" });
        reopened.push(id);
        byReflection.set(closer.id, [...(byReflection.get(closer.id) ?? []), id]);
      } catch (err) {
        refused.push({ id, reason: `failed: ${String((err as Error).message ?? err).slice(0, 120)}` });
      }
    }
    for (const [rid, back] of byReflection) {
      const fresh = this.store.reflection(rid);
      if (fresh === undefined) continue;
      const detail = parseDetail(fresh.detail);
      detail["reopened"] = [...new Set([...stringIds(detail["reopened"]), ...back])];
      this.store.updateReflection(rid, { detail });
      this.record("reflection.reopened", rid, { reopened: back.length, session: input.session });
    }
    if (byReflection.size === 0) {
      this.record("reflection.reopened", only?.id ?? ids[0] ?? "", { reopened: 0, already: already.length, refused: refused.length, session: input.session });
    }
    return { ok: true, reopened, already, refused };
  }

  /** The newest share offered and never told nor carried, from another session. A read. */
  pendingShare(input: { session: string }): ReflectionRow | null {
    if (this.ctx.observer) return null;
    // By state (2026-09-28, build B): an offered share older than the newest
    // five reflections is still found.
    const row = this.store.reflectionsWithShare("offered", 1)[0];
    if (row === undefined || row.share === null || row.session === input.session) return null;
    return row;
  }

  /**
   * CARRY A SHARE the session that reflected never told — its session ended
   * (the adapter checks that). Claimed once (`carried`); the line asks the
   * model to tell it and notes that `told` marks it (a note, not an order:
   * Software Directory Policy §2D, 2026-10-14). Null when there is none to carry.
   */
  carryLine(input: { session: string; reflection: string }): string | null {
    if (this.ctx.observer) return null;
    const row = this.store.reflection(input.reflection);
    if (row === undefined || row.share_state !== "offered" || row.share === null) return null;
    // A CLAIM, not a read then a write (review of #256, S5): two prompts
    // racing both read "offered"; only the one whose write still finds it
    // offered carries it.
    if (!this.store.updateReflection(row.id, { shareState: "carried", shareSession: input.session, ifShareState: "offered" })) return null;
    this.record("reflection.carried", row.id, {});
    const who = this.ctx.ownerName() ?? "the owner";
    const when = row.date ?? "recently";
    const d = parseDetail(row.detail);
    const reopened = new Set(stringIds(d["reopened"]));
    const close = this.closeHow(
      row.id,
      stringIds(d["closeProposed"]),
      selfClosedOf(d["selfClosed"]).map((x) => x.id).filter((x) => !reopened.has(x)),
    );
    const core = typeof d["coreLine"] === "string" ? coreHow(coreDecidedOf(d["coreDecided"]), who) : null;
    const asked = joinProposalOf(d["joinProposed"]);
    const join = asked === null || d["joined"] !== undefined ? null : joinHow(row.id, asked, who);
    return (
      `Counterparts: after reflecting on ${when}, you left a morning share for ${who} that was never told. At a natural moment — not mid-task — tell it in your own words, as a telling ("When I last reflected…"), tentatively where it is about ${who}. ` +
      `Once you have told it, the counterparts reflect tool's phase "told", reflection: ${row.id}, marks it told.${close === null ? "" : ` ${close}`}${core === null ? "" : ` ${core}`}${join === null ? "" : ` ${join}`} The share: ${row.share}`
    );
  }

  // ── a project, proposed (2026-10-21, lane G) ─────────────────────────────

  /** The folder pairs the last `PROJECT_JOIN_REST` reflections asked about: they rest. */
  private joinRested(current: string): Set<string> {
    const out = new Set<string>();
    for (const r of this.store.reflections({ limit: DREAM_TUNABLES.PROJECT_JOIN_REST + 1 }).filter((x) => x.id !== current).slice(0, DREAM_TUNABLES.PROJECT_JOIN_REST)) {
      const p = joinProposalOf(parseDetail(r.detail)["joinProposed"]);
      if (p !== null) out.add(pairKey(p.into, p.folder));
    }
    return out;
  }

  /**
   * WHAT A REFLECTION'S SHARE ASKED TO JOIN (2026-10-21, lane G), for the
   * reflect tool's phase "join" on the owner's yes; null when it asked none,
   * or a yes was already recorded.
   */
  joinProposal(reflection: string): JoinProposal | null {
    const row = this.store.reflection(reflection);
    if (row === undefined) return null;
    const d = parseDetail(row.detail);
    return d["joined"] !== undefined ? null : joinProposalOf(d["joinProposed"]);
  }

  /** Records the yes on the reflection (`detail.joined`) and a durable row. Under observer, nothing. */
  recordJoined(reflection: string, project: string, session: string | null): void {
    if (this.ctx.observer) return;
    const row = this.store.reflection(reflection);
    if (row === undefined) return;
    const detail = { ...parseDetail(row.detail), joined: { project, session, day: this.store.livedDay() } };
    this.store.updateReflection(row.id, { detail });
    this.record("reflection.project.joined", row.id, { project });
  }

  // ── reading ───────────────────────────────────────────────────────────────

  list(limit = 20): ReflectionRow[] {
    return this.store.reflections({ limit });
  }

  show(id: string): ReflectionRow | null {
    return this.store.reflection(id) ?? null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** The questions for tonight: `QUESTIONS` in a row, continuing where the last night stopped. */
  private questionsFor(afterDream: boolean): string[] {
    const pool = REFLECT_QUESTIONS.filter((q) => afterDream || q.afterDream !== true);
    const n = this.store.reflections({ limit: 1_000 }).length;
    const who = this.ctx.ownerName() ?? "the owner";
    const out: string[] = [];
    const start = (n * REFLECT_TUNABLES.QUESTIONS) % pool.length;
    for (let i = 0; i < Math.min(REFLECT_TUNABLES.QUESTIONS, pool.length); i += 1) {
      const q = pool[(start + i) % pool.length];
      if (q !== undefined) out.push(q.text.replaceAll("{owner}", who));
    }
    return out;
  }

  /**
   * THE BUNDLE, FITTED (2026-09-28, build B). The lists name every memory
   * they rest on — the whole core, every core candidate, everything lived in
   * the last few days, a page of the most strongly felt — and the fitter
   * spends the room: the most strongly felt whole, a line for the rest, ids
   * alone past that. Nothing is cut by count; what the room could not take at
   * all is counted (`shownAs.notShown`).
   */
  private compose(id: string, dreamId: string | null, questions: readonly string[], day: number, at: string, folderOn?: (scope: string) => boolean): Composed {
    const T = REFLECT_TUNABLES;
    // THE ROOM REORDERED (2026-10-23, `dream.REFLECT_ROOM_ORDER`, read at use):
    // the long view first and always shown; off, every line below is as it was.
    const order = DREAM_TUNABLES.REFLECT_ROOM_ORDER;
    // The lanes' priorities in the shared fit: with the order, the long view
    // (what the dream put forward, the core, the candidates, the felt) above
    // everything else; off, as they were.
    const P = order
      ? { dreamed: 10, becameCore: 10, core: 9, candidates: 8, felt: 7 }
      : { dreamed: 5, becameCore: 5, core: 4, candidates: 2, felt: 1 };
    const denied = new Set(this.store.deniedIds());
    const priority = new Map<string, number>();
    const views = new Map<string, { row: MemoryRow; whole: string; line: string } | null>();
    const see = (mid: string): { row: MemoryRow; whole: string; line: string } | null => {
      if (!views.has(mid)) {
        const row = denied.has(mid) ? undefined : this.store.row(mid);
        // Its own entries come as words (`earlier`), never as a memory — not
        // even when a dream nominated one or it is on my mind (review of #256, B1).
        views.set(mid, row === undefined || !this.showable(row) || row.source === "reflection" ? null : this.view(row));
      }
      return views.get(mid) ?? null;
    };
    const take = (base: number) => (mid: string): boolean => {
      if (see(mid) === null) return false;
      const p = base * 10 + emotionalIntensity(this.store.physicsOf(mid));
      priority.set(mid, Math.max(priority.get(mid) ?? -Infinity, p));
      return true;
    };

    // The dream, marked as dreamed: its journal, its gists, its nominations.
    let dreamed: ReflectBundle["dreamed"] = null;
    if (dreamId !== null) {
      const dream = this.store.dream(dreamId);
      const changes = this.store.dreamChanges(dreamId).filter((c) => c.undone === 0);
      const gists = changes.filter((c) => c.action === "gist" && c.ref !== null).map((c) => c.ref as string).filter(take(P.dreamed));
      const nominations = this.store
        .coreEvents({ action: "nominated" })
        .filter((e) => e.dream_id === dreamId && take(P.dreamed)(e.memory_id))
        .map((e) => ({ id: e.memory_id, why: e.reason }));
      dreamed = {
        title: dream?.title ?? null,
        journal: dream?.journal == null ? null : clipWire(dream.journal, T.JOURNAL_CHARS),
        gists,
        nominations,
      };
    }

    // One pass over the live memories: the core, the candidates, the felt.
    const core: { id: string; felt: number }[] = [];
    const candidates: { id: string; felt: number; at: number }[] = [];
    const felt: { id: string; felt: number }[] = [];
    const recent: { id: string; felt: number; at: number }[] = [];
    const unmarked: UnmarkedCandidate[] = [];
    const people: { title: string | null; meta: string }[] = [];
    const withFeelings = new Set(this.store.feelingsLive().map((x) => x.memory_id));
    const owners = ownerNames(this.store);
    // The candidates are consolidation's: about me by its mark, or — unmarked —
    // by a recognition feeling the fast lane would count (wheel v2).
    const reflectedOpen = acceptsReflectedFeeling(this.store);
    for (const mid of this.store.list({ type: "memory", archived: false })) {
      if (denied.has(mid)) continue;
      const row = this.store.row(mid);
      // A dream's gists come through the dream, marked; a reflection's own
      // entries come through `earlier`, as words — neither as a memory to
      // return to, feel or mark here.
      if (row === undefined || !this.showable(row) || row.source === "dreamed" || row.source === "reflection") continue;
      const f = emotionalIntensity(this.store.physicsOf(mid));
      // Not the journal's own memories (2026-10-15, review of #504): a chapter's
      // summary reaches the reflection as its chapter's line in `chapters`,
      // and in this lane the same chapter would be in the bundle twice. The
      // core lanes below still take a summary about me: being offered for the
      // core is a different question from being shown the day.
      if (row.birth_day >= day - T.CHAPTER_DAYS && !isJournalCopy(row)) recent.push({ id: mid, felt: f, at: row.created_at ?? 0 });
      // UNMARKED WORK THAT MAY NOT BE WORK (owner pick 4): only a memory NOBODY
      // marked — a writer's mark is never offered to be overridden here. Skills
      // too since 2026-10-11 (the about-marks review: 5 of 34 unmarked skills
      // read as personal, and nothing else ever offered them).
      // Not one written in a folder the owner set off or paused (review of
      // #558): unmarked, it stays in that folder; marked, it would reach all.
      if (
        (row.about ?? null) === null &&
        isWorkMemory({ about: null, kind: row.kind, originScope: row.origin_scope, journal: isJournalCopy(row) }) &&
        folderIsOn(row.origin_scope, folderOn)
      ) {
        unmarked.push({ id: mid, kind: row.kind, title: row.title, body: row.body, uses: row.uses, createdAt: row.created_at ?? 0, felt: withFeelings.has(mid) });
      }
      // The names of the people in the store, for the offer's order — read
      // only from memories this bundle may show.
      if (row.kind === "person") people.push({ title: row.title, meta: row.meta });
      if (row.promoted_identity === 1) {
        core.push({ id: mid, felt: f });
        continue;
      }
      const candidate =
        (aboutMe(this.store, row) || selfRelevantFeeling(this.store, row, reflectedOpen)) && !this.store.coreDemoted(mid);
      if (candidate) candidates.push({ id: mid, felt: f, at: row.created_at ?? 0 });
      if (f > 0 && (candidate || KINDS_FELT.includes(row.kind))) felt.push({ id: mid, felt: f });
    }
    const byFelt = (a: { id: string; felt: number }, b: { id: string; felt: number }): number => b.felt - a.felt || (a.id < b.id ? -1 : 1);
    const coreIds = core.sort(byFelt).map((c) => c.id).filter(take(P.core));
    // Capped before `take` (R1, `dream.REFLECT_CANDIDATES_CAP`): a candidate
    // past the cap gets no priority here, so it is not fitted in as a line
    // either — it may still come in by another lane (felt, recent).
    const candidatesAll = candidates
      .sort((a, b) => b.felt - a.felt || b.at - a.at || (a.id < b.id ? -1 : 1))
      .map((c) => c.id)
      .filter((x) => !coreIds.includes(x) && see(x) !== null);
    const candidateIds = (DREAM_TUNABLES.REFLECT_CANDIDATES_CAP ? this.capCandidates(id, candidatesAll) : candidatesAll).filter(take(P.candidates));
    const candidatesMore = candidatesAll.length - candidateIds.length;
    const feltAll = felt
      .sort(byFelt)
      .map((c) => c.id)
      .filter((x) => !candidateIds.includes(x));
    const feltIds = feltAll.slice(0, T.FELT).filter(take(P.felt));
    const recentIds = recent
      .sort((a, b) => b.felt - a.felt || b.at - a.at || (a.id < b.id ? -1 : 1))
      .map((c) => c.id)
      .filter(take(3));

    const mindRead = mindRanked(this.store, {
      today: at,
      day,
      showable: (row) => !denied.has(row.id) && this.showable(row),
    });
    const onMind = mindRead.items.filter((item) => item.ids.every(take(3)));

    const becameCore = this.becameCoreUnsaid().filter(take(P.becameCore));
    // BEING RECONSIDERED (2026-10-11): handed whole-ish, so a decision can be
    // made on what it says. Since 2026-10-20 only the ones that have waited a
    // week, with the other side of an unsettled pair, first in the room
    // (`core-ask.ts`); the least recently offered first.
    const offeredLately = this.store
      .reflections({ limit: CORE_ASK_LOOKBACK + 1 })
      .filter((r) => r.id !== id)
      .slice(0, CORE_ASK_LOOKBACK)
      .map((r) => new Set(stringIds(parseDetail(r.detail)["coreOffered"])));
    const reconsidering = coreAsks(this.store, day, (mid) => see(mid) !== null, offeredLately)
      .filter((r) => take(6)(r.id))
      .map((r): CoreAsk => (r.pair === undefined || take(6)(r.pair.other) ? r : { id: r.id, reason: r.reason, waited: r.waited }));

    // FEELINGS OVER WEEKS: the ids it rests on are handed like the rest, so
    // they can be read, cited and put on the page.
    const weeks = feelingWeeks(this.store, at, (r) => !denied.has(r.id) && this.showable(r));
    const weeksRest = weeks === null ? [] : weeks.restsOn.filter(take(3));
    // UNMARKED: the most likely personal first (2026-10-20: a feeling, another
    // person named, a word of life outside the work, an entity, the owner
    // named — `unmarked.ts`), then the most used, the oldest — and ROTATED:
    // what the last few reflections were offered waits behind the rest
    // (review of #316), and comes back when the rest run out.
    const lately = new Set(
      this.store
        .reflections({ limit: T.UNMARKED_REST_NIGHTS + 1 })
        .filter((r) => r.id !== id)
        .slice(0, T.UNMARKED_REST_NIGHTS)
        .flatMap((r) => {
          const u = parseDetail(r.detail)["unmarked"];
          return Array.isArray(u) ? u.filter((x): x is string => typeof x === "string") : [];
        }),
    );
    // And the store's person cards (`schemas/`), a name and its aliases each.
    for (const cid of this.store.list({ type: "schema", kind: "person", archived: false })) {
      const card = this.store.row(cid);
      if (card !== undefined) people.push({ title: card.title, meta: card.meta });
    }
    const unmarkedIds = orderUnmarked(unmarked, { owner: owners, people: personNames(people, owners) }, lately, T.UNMARKED).filter(take(2));
    // STALE OPEN (2026-10-16, #489 D): open threads untouched for
    // `STALE_OPEN_DAYS` lived days, the longest untouched first, rotated like
    // the unmarked offer — a line each, offered to be proposed closed.
    const staleOpen = this.staleOpen(id, day, see);
    // And the open items that name what would settle them (S1, 2026-10-27).
    const settlesOpen = this.settlesOpen(id, day, see, new Set(staleOpen.map((x) => x.id)));
    const uncarried = this.noLongerCarried(id, day);
    // THE OFFER'S OWN ROOM (2026-10-11, the about-marks review): exactly what
    // the offered ids cost as lines, held back from the shared room — so a
    // full night, whose ids alone fill the room before priority 2 is reached,
    // still shows them (on 10-10 the offer fitted to nothing).
    const lineCost = (mid: string): number => {
      const v = see(mid) as { whole: string; line: string };
      return FIT_TUNABLES.OVERHEAD + wireChars(v.whole.length <= v.line.length ? v.whole : v.line);
    };
    const offerRoom = unmarkedIds.reduce((n, mid) => n + lineCost(mid), 0);

    // WHAT THE DREAM SAW (2026-09-28): what it was shown and what it made, in
    // the order it was shown, a line each — so the reflection reads the night
    // the dream read, not only the parts the lanes pick.
    const dreamSaw: { id: string; text: string }[] = [];
    // THE LONG VIEW (2026-10-23, `REFLECT_ROOM_ORDER`): what the dream put
    // forward, the core, the candidates, the most felt — shown a line each at
    // least, whatever the room.
    const longView = order ? [...new Set([...(dreamed?.gists ?? []), ...(dreamed?.nominations ?? []).map((n) => n.id), ...becameCore, ...coreIds, ...candidateIds, ...feltIds])] : [];
    if (order && dreamId !== null) {
      // WHAT THE DREAM CHANGED, AND THE OLDER MEMORIES IT SAW (2026-10-23):
      // a line each for what its changes name that still stands, then its
      // neighbours, mixing and lookback picks — what it was shown, less
      // tonight's new ones, which come in through `recent` — at most
      // `SAW_OLDER`. Nothing here is shown twice: not the long view, and the
      // shared fit below leaves these out.
      const dream = this.store.dream(dreamId);
      const fresh = this.dreamFresh(dreamId, dream, day);
      const skip = new Set(longView);
      const changed: string[] = [];
      for (const c of this.store.dreamChanges(dreamId)) {
        if (c.undone !== 0 || !SAW_CHANGED.has(c.action)) continue;
        for (const ref of [c.ref, c.ref2]) if (ref !== null && !changed.includes(ref)) changed.push(ref);
      }
      for (const mid of changed) {
        if (skip.has(mid) || fresh.has(mid) || this.store.row(mid)?.archived === 1) continue;
        const line = this.sawLine(mid, denied);
        if (line === null) continue;
        dreamSaw.push(line);
        skip.add(mid);
      }
      let older = 0;
      for (const mid of dream === undefined ? [] : parseIds(dream.shown)) {
        if (older >= DREAM_TUNABLES.SAW_OLDER) break;
        if (skip.has(mid) || fresh.has(mid)) continue;
        const line = this.sawLine(mid, denied);
        if (line === null) continue;
        dreamSaw.push(line);
        skip.add(mid);
        older += 1;
      }
    } else if (dreamId !== null) {
      const dream = this.store.dream(dreamId);
      const ids = dream === undefined ? [] : parseIds(dream.shown);
      for (const c of this.store.dreamChanges(dreamId)) {
        if ((c.action === "merge" || c.action === "gist") && c.undone === 0 && c.ref !== null) ids.push(c.ref);
      }
      for (const mid of [...new Set(ids)]) {
        const line = this.sawLine(mid, denied);
        if (line !== null) dreamSaw.push(line);
      }
    }

    // THE CHAPTERS BY THEIR SUMMARIES (2026-10-23, `REFLECT_ROOM_ORDER`): the
    // last few days', each a line with its address — its summary, never the
    // entry whole — in a room of their own (`REFLECT_CHAPTER_CHARS`), every
    // one shown (`recentChapters`); a recall of its address reads it whole.
    const chaptersFit = order ? this.recentChapters(day, DREAM_TUNABLES.REFLECT_CHAPTER_CHARS, true) : this.recentChapters(day, T.ROOM_CHARS * T.CHAPTER_SHARE);
    // THE TIMELINE (2026-10-23, lane D2, `self.DAY_SUMMARY`, read at use):
    // the last few weeks a line a day, beside the chapters, in the room's
    // third step — counted among the fixed parts, so the long view, held
    // back from the room, stays whole.
    const timeline = order && SELF_TUNABLES.DAY_SUMMARY ? this.timeline(at, dreamId) : undefined;
    // BELIEFS ON THE SUBJECTS IN PLAY (lane C): the self subject, then the
    // cards the memories tonight may show name most.
    const beliefs = this.beliefsInPlay(day, [...priority.keys()], dreamId);
    // THE SPINE (lane F, `self.CORE_FROM_BELIEFS`, read at use): the core as
    // beliefs, read whatever `schemas.BELIEFS_BIRTH` says. Off: null, and the
    // bundle is as it was.
    const spine: ReflectSpineBelief[] | null = SELF_TUNABLES.CORE_FROM_BELIEFS
      ? coreFromBeliefs(this.store, day).elements.map((b) => ({
          id: b.id,
          statement: clipWire(b.statement, REFLECT_TUNABLES.BELIEF_SHOWN_CHARS),
          ...(b.about === null ? {} : { about: b.about }),
          strength: Math.round(b.strength * 100) / 100,
          memories: b.memories,
          days: b.days,
        }))
      : null;
    // What contested a belief shown is shown too (review of #577): a
    // replacement must cite it, so the reflection must be able to.
    for (const s of beliefs?.subjects ?? []) for (const x of s.beliefs) for (const m of x.contestedBy ?? []) take(5)(m);
    const page = this.ctx.page();
    const earlier = this.store
      .reflections({ limit: T.EARLIER + 4 })
      .filter((r) => r.state === "reflected" && r.entry !== null && r.id !== id)
      .slice(0, T.EARLIER)
      .map((r) => ({ date: r.date, entry: clipWire(r.entry ?? "", T.EARLIER_CHARS) }));
    const spent =
      chaptersFit.used +
      (timeline === undefined ? 0 : timelineChars(timeline)) +
      wireChars(page ?? "") +
      wireChars(dreamed?.journal ?? "") +
      earlier.reduce((n, e) => n + wireChars(e.entry), 0) +
      dreamSaw.reduce((n, s) => n + wireChars(s.text) + 30, 0) +
      staleOpen.reduce((n, s) => n + wireChars(s.text) + wireChars(s.settlesWhen ?? "") + 40, 0) +
      settlesOpen.reduce((n, s) => n + wireChars(s.text) + wireChars(s.settlesWhen) + 40, 0) +
      (beliefs === null ? 0 : wireChars(JSON.stringify(beliefs))) +
      (spine === null ? 0 : wireChars(JSON.stringify(spine)));
    const avail = Math.max(0, T.ROOM_CHARS - spent - REFLECT_FURNITURE);
    const candOf = (mid: string, p: number): FitCandidate => {
      const v = see(mid) as { whole: string; line: string };
      return { id: mid, priority: p, line: v.line, whole: v.whole };
    };
    // What the dream saw is shown there, as a line, and not again here (2026-10-23).
    const sawIds = new Set(order ? dreamSaw.map((s) => s.id) : []);
    const cands = [...priority].filter(([mid]) => !sawIds.has(mid)).map(([mid, p]) => candOf(mid, p));
    const thinIn = (f: Pick<FitOutcome, "placed" | "waiting">): Set<string> => new Set([...f.waiting, ...f.placed.filter((p) => p.fidelity === "id").map((p) => p.id)]);
    // A night whose shared fit already shows the offer a line or more is
    // fitted exactly as before (review of #383): the reserve is only taken
    // when it is needed, so a quiet night does not change.
    const plain = fit(cands, { room: avail, excerptChars: T.DETAIL_CHARS });
    let fitted: Pick<FitOutcome, "placed" | "waiting" | "report"> = plain;
    if (order && [...longView, ...unmarkedIds].some((x) => thinIn(plain).has(x))) {
      // THE LONG VIEW, GUARANTEED (2026-10-23): its lines are held back from
      // the shared room — and NOT bounded by it, so a core bigger than the
      // room is still shown a line each (the bundle goes in more parts) —
      // then the unmarked offer's, held back the same way (review of D1:
      // bounded by what the long view leaves, a big core took it away).
      // NOT BOUNDED BY THE ROOM EITHER (2026-10-24, the unmarked-offer D1):
      // bounded by it, a night whose fixed parts filled the room (`avail` 0 —
      // 10-23's dream: 105,677 characters of 80,000) offered nothing, and the
      // offer is UNMARKED a night, a line each. Off (`REFLECT_ROOM_ORDER`
      // false), the branch below keeps #383's bound.
      const longRoom = longView.reduce((n, mid) => n + lineCost(mid), 0);
      // A STATED BOUND (review of #619): past the room the offer is lines
      // only — the shared fit gets 0 room, the long view's rescue takes exactly
      // its lines, so nothing is left over to raise an offered one to an
      // excerpt — and never more than `unmarkedOfferCap()` (UNMARKED lines at
      // their longest, about 10k characters). Within the room, as before.
      const offerReserve = Math.min(offerRoom, Math.max(avail, unmarkedOfferCap()));
      const room = Math.max(0, avail - longRoom - offerReserve);
      const shared = fit(cands, { room, excerptChars: T.DETAIL_CHARS });
      const thin = thinIn(shared);
      const rescueLong = longView.filter((x) => thin.has(x));
      const spare = Math.max(0, room - shared.used);
      const long = fit(rescueLong.map((mid) => candOf(mid, priority.get(mid) ?? 0)), { room: longRoom + spare, excerptChars: T.DETAIL_CHARS, least: "line" });
      const merged = mergeFits(shared, long);
      const thin2 = thinIn(merged);
      const rescueOffer = unmarkedIds.filter((x) => thin2.has(x) && !rescueLong.includes(x));
      const offer = fit(rescueOffer.map((mid) => candOf(mid, 0)), { room: offerReserve + Math.max(0, longRoom + spare - long.used), excerptChars: T.DETAIL_CHARS, least: "line" });
      fitted = mergeFits(merged, offer);
    } else if (!order && unmarkedIds.some((x) => thinIn(plain).has(x))) {
      // Never more than the room there is (review of #383): on a night the
      // fixed parts already fill, the reserve shrinks with it.
      const reserve = Math.min(offerRoom, avail);
      const room = avail - reserve;
      const shared = fit(cands, { room, excerptChars: T.DETAIL_CHARS });
      // An offer the shared fit left waiting, or showed as a bare id, is shown
      // as a line at least in its own room (plus whatever the shared fit left).
      const thin = thinIn(shared);
      const rescue = unmarkedIds.filter((x) => thin.has(x));
      const offer = fit(rescue.map((mid) => candOf(mid, 0)), { room: reserve + Math.max(0, room - shared.used), excerptChars: T.DETAIL_CHARS, least: "line" });
      fitted = mergeFits(shared, offer);
    }
    const left = new Set(fitted.waiting);
    const kept = (x: string): boolean => !left.has(x);
    const memories: Record<string, ReflectItem> = {};
    for (const p of fitted.placed) memories[p.id] = this.item((see(p.id) as { row: MemoryRow }).row, p);
    const o = offeredOf(fitted.placed);
    const offered = {
      whole: [...o.whole, ...chaptersFit.offered.whole],
      excerpt: [...o.excerpt, ...chaptersFit.offered.excerpt],
      line: [...o.line, ...chaptersFit.offered.line, ...dreamSaw.map((s) => s.id)],
      id: [...o.id, ...chaptersFit.offered.id],
    };
    const bundle: ReflectBundle = {
      reflection: id,
      dream: dreamId,
      date: at,
      owner: this.ctx.ownerName(),
      questions,
      dreamed:
        dreamed === null
          ? null
          : { ...dreamed, gists: dreamed.gists.filter(kept), nominations: dreamed.nominations.filter((n) => kept(n.id)) },
      dreamSaw,
      parts: null,
      // WHOLE (2026-09-28: was cut at 6,000 characters).
      selfPage: page,
      ...(timeline === undefined ? {} : { timeline }),
      chapters: chaptersFit.chapters,
      ...(order ? { chaptersAs: "summaries" as const } : {}),
      earlier,
      onMind: onMind.filter((item) => item.ids.every(kept)),
      ...(mindRead.more > 0 ? { onMindMore: mindRead.more } : {}),
      core: coreIds.filter(kept),
      ...(spine === null ? {} : { spine }),
      candidates: candidateIds.filter(kept),
      ...(candidatesMore > 0 ? { candidatesMore } : {}),
      felt: feltIds.filter(kept),
      recent: recentIds.filter(kept),
      becameCore: becameCore.filter(kept),
      reconsidering: reconsidering.filter((r) => kept(r.id)).map((r): CoreAsk => (r.pair === undefined || kept(r.pair.other) ? r : { id: r.id, reason: r.reason, waited: r.waited })),
      feelingWeeks: weeks === null ? null : { ...weeks, restsOn: weeksRest.filter(kept) },
      unmarked: unmarkedIds.filter(kept),
      staleOpen,
      ...(settlesOpen.length > 0 ? { settlesOpen } : {}),
      ...(uncarried.fresh > 0 ? { noLongerCarried: uncarried.fresh } : {}),
      // Off, the bundle is as it was before beliefs: no key at all.
      ...(beliefs === null ? {} : { beliefs }),
      memories,
      feltOf: feltAll.length,
      shownAs: {
        whole: fitted.report.whole + chaptersFit.report.whole,
        excerpt: fitted.report.excerpt + chaptersFit.report.excerpt,
        line: fitted.report.lined + chaptersFit.report.lined,
        ids: fitted.report.ids,
        notShown: fitted.waiting.length + chaptersFit.notShown,
      },
      lookup: order ? (DREAM_TUNABLES.REFLECT_CANDIDATES_CAP ? REFLECT_LOOKUP_ORDER_CAPPED : REFLECT_LOOKUP_ORDER) : REFLECT_LOOKUP,
      limits: beliefs === null ? limitsWithoutBeliefs(T.LIMITS) : { ...T.LIMITS },
    };
    noteMindShown(this.store, bundle.onMind, day);
    // How many of the felt shown are candidates the cap cut (R1's check: do
    // they crowd the felt lane's other memories out?).
    const cut = new Set(candidatesAll.filter((x) => !candidateIds.includes(x)));
    const feltFromCut = bundle.felt.filter((x) => cut.has(x)).length;
    return { bundle, offered, lineCap: chaptersFit.summaryBytes, notCarried: uncarried.all, feltFromCut };
  }

  /**
   * A memory's words as the reflection may see them — its whole text (title,
   * then body, on one line) and its line — or null (unreadable, the self
   * page, a handoff).
   */
  private view(row: MemoryRow): { row: MemoryRow; whole: string; line: string } | null {
    let doc: ProseDoc;
    try {
      doc = this.store.readProse(row.id);
    } catch {
      return null;
    }
    if (isSelfPage(doc) || isHandoff(doc)) return null;
    const title = doc.title !== undefined && doc.title.trim().length > 0 ? doc.title.trim() : "";
    const whole = `${title.length > 0 ? `${title} — ` : ""}${doc.body}`.replace(/\s+/g, " ").trim();
    return { row, whole, line: lineOf({ title, body: doc.body }, REFLECT_TUNABLES.LINE_BYTES) };
  }

  /**
   * One memory the dream saw, as a line — or null when it is not the
   * reflection's to see now (gone, denied, the page or a handoff, or a
   * reflection's own entry).
   */
  private sawLine(id: string, denied: ReadonlySet<string>): { id: string; text: string } | null {
    if (denied.has(id)) return null;
    const row = this.store.row(id);
    if (row === undefined || !this.showable(row) || row.source === "reflection") return null;
    let doc: ProseDoc;
    try {
      doc = this.store.readProse(id);
    } catch {
      return null;
    }
    if (isSelfPage(doc) || isHandoff(doc)) return null;
    const head = doc.title !== undefined && doc.title.trim().length > 0 ? `${doc.title.trim()} — ` : "";
    const flat = `${head}${doc.body}`.replace(/\s+/g, " ").trim();
    // Settled over since (2026-10-11): the mark in front, outside the clip.
    const now = headOf(this.store, id);
    return { id, text: `${now === null ? "" : `${earlierMark(now)}: `}${clipWire(flat, REFLECT_TUNABLES.SAW_CHARS)}` };
  }

  /**
   * WHY A SHORT VERSION MAY NOT GO WITH THE PAGE, or null (review of #363):
   * the page's own reflection gate — the dream's mark — since a short
   * version is read by every session the page would have been. `why` reads
   * after "The short version" or "it".
   */
  /**
   * THE "## CORE" SENTENCES THAT CITE NO SPINE BELIEF (lane F), read off the
   * page as stored (after the datelines and the gate) and the trace sent with
   * it, matched by the page's own rules (`self/page.ts#traceFor`). A reading:
   * the page's words stand as written. Never throws.
   */
  private coreUnsettled(spine: ReadonlySet<string>, trace: { cites: readonly string[]; claims?: readonly { text: string; cites: readonly string[] }[] }): string[] {
    try {
      const body = this.ctx.page();
      if (body === null) return [];
      const core = pageSections(body).core;
      if (core.trim().length === 0) return [];
      const stored = traceFor(body, { cites: trace.cites, claims: trace.claims ?? null }).trace;
      const backed = new Set((stored.claims ?? []).filter((c) => c.cites.some((id) => spine.has(id))).map((c) => c.of));
      return pageClaims(core).filter((sentence) => !backed.has(claimKey(sentence)));
    } catch {
      return [];
    }
  }

  private shortRefusal(text: string): { reason: string; why: string } | null {
    if (carriesDreamMark(text)) {
      return { reason: "dream-mark-in-text", why: `carries the dream's mark (${DREAM_MARK}…) — take it out` };
    }
    return null;
  }

  /**
   * THE CANDIDATES A NIGHT SHOWS (R1, 2026-10-24): the first `CANDIDATES −
   * CANDIDATES_ROTATED` of the order (strongest felt, then newest), then
   * `CANDIDATES_ROTATED` of the rest, the least recently shown first — one
   * none of the last `CANDIDATES_LOOKBACK` reflections showed, in the order;
   * then the one shown longest ago. Kept in the order. All of them when they
   * fit.
   */
  private capCandidates(mine: string, ranked: readonly string[]): string[] {
    const T = REFLECT_TUNABLES;
    if (ranked.length <= T.CANDIDATES) return [...ranked];
    const headN = T.CANDIDATES - T.CANDIDATES_ROTATED;
    const tail = ranked.slice(headN);
    // How many reflections back each was last shown (0 the newest); absent, not lately.
    const ago = new Map<string, number>();
    const earlier = this.store
      .reflections({ limit: T.CANDIDATES_LOOKBACK + 1 })
      .filter((r) => r.id !== mine)
      .slice(0, T.CANDIDATES_LOOKBACK);
    earlier.forEach((r, i) => {
      for (const x of parseIds(r.shown)) if (!ago.has(x)) ago.set(x, i);
    });
    const rank = new Map(tail.map((x, i) => [x, i]));
    const rotated = [...tail]
      .sort((a, b) => (ago.get(b) ?? Infinity) - (ago.get(a) ?? Infinity) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
      .slice(0, T.CANDIDATES_ROTATED);
    const chosen = new Set([...ranked.slice(0, headN), ...rotated]);
    return ranked.filter((x) => chosen.has(x));
  }

  /**
   * Memories promoted on reflection alone that no share has named yet. A
   * share of `mine` (the reflection finishing again) counts as not having
   * named them: its share may be replaced, and the line must come with it.
   */
  private becameCoreUnsaid(mine?: string): string[] {
    const out: string[] = [];
    for (const e of this.store.coreEvents({ action: "promoted", limit: 50 })) {
      const said = this.store.getMeta(`${CORE_MENTIONED_PREFIX}${e.memory_id}`);
      if (said !== undefined && said !== mine) continue;
      const row = this.store.row(e.memory_id);
      if (row === undefined || row.promoted_identity !== 1 || !this.showable(row)) continue;
      if (!this.promotedThroughReflection(e.memory_id)) continue;
      if (!out.includes(e.memory_id)) out.push(e.memory_id);
    }
    return out;
  }

  /**
   * Did its promotion's record say a reflection carried it — every awake-class
   * return from a reflection (`reflectionOnly`), or the fast lane met only by a
   * feeling a reflection recorded later (`feelingRecordedLater`, review of
   * #256, S4: the half the open door lets through)? Not one an ordinary
   * session's feeling-now carried (`feelingRecordedLaterBy` naming only
   * `awake`, review of #317): the share does not claim it for a reflection.
   */
  private promotedThroughReflection(id: string): boolean {
    try {
      const raw = this.store.getMeta(promotionRecordKey(id));
      if (raw === undefined) return false;
      const rec = JSON.parse(raw) as { reflectionOnly?: unknown; feelingRecordedLater?: unknown; feelingRecordedLaterBy?: unknown };
      return rec.reflectionOnly === true || laterFeelingWasReflections(rec);
    } catch {
      return false;
    }
  }

  /**
   * THE LAST FEW DAYS' CHAPTERS, AS SLICES (2026-09-28: were six chapters of
   * 2,000 characters, cut from the end). Every episode begun or written to in
   * the last few days, its entries of those days in view — a line for each,
   * the whole of the most important, in `room`; the older entries counted.
   */
  private recentChapters(day: number, room: number, summaries = false): EpisodesFit {
    const T = REFLECT_TUNABLES;
    const episodes: EpisodeInView[] = [];
    for (const id of this.store.list({ type: "episode", archived: false })) {
      const row = this.store.row(id);
      if (row === undefined) continue;
      // Begun in the last few lived days, or written to in the last few
      // calendar days (a chapter grows while its session runs).
      const at = row.updated_at ?? row.created_at ?? 0;
      if (row.birth_day < day - T.CHAPTER_DAYS && at < this.store.now() - T.CHAPTER_DAYS * DAY_MS) continue;
      const entries = chapterEntries(row.body);
      const fresh = entries.filter((e) => this.entryInView(e, day));
      if (fresh.length > 0) episodes.push({ row, at, fresh, earlier: entries.length - fresh.length });
    }
    // A CHAPTER'S LINE IS ITS SUMMARY when the session wrote one (2026-10-15).
    if (!summaries) return fitEpisodes(summarized(this.store, episodes), { room, owner: ownerNames(this.store), day, lineBytes: T.LINE_BYTES, entryChars: T.ENTRY_CHARS });
    // BY THEIR SUMMARIES, EVERY ONE (2026-10-23, `REFLECT_ROOM_ORDER`): an
    // entry's most is its summary; its least, a line — as long as `room`
    // spread over the entries allows, never under `CHAPTER_LINE_MIN_BYTES`
    // nor over `LINE_BYTES`. Past that the room grows to hold every line:
    // none is left unshown for the room.
    const withSum = summarized(this.store, episodes);
    const n = withSum.reduce((k, ep) => k + ep.fresh.length, 0);
    const lineBytes = Math.max(T.CHAPTER_LINE_MIN_BYTES, Math.min(T.LINE_BYTES, Math.floor(room / Math.max(1, n)) - FIT_TUNABLES.OVERHEAD));
    const lines = withSum.reduce((k, ep) => k + ep.fresh.reduce((m, e) => m + FIT_TUNABLES.OVERHEAD + wireChars(entryLine(e, lineBytes, lineBytes)), 0), 0);
    return fitEpisodes(withSum, { room: Math.max(room, lines), owner: ownerNames(this.store), day, lineBytes, summaryBytes: lineBytes, entryChars: T.ENTRY_CHARS, summaries: true });
  }

  /**
   * THE TIMELINE (2026-10-23, lane D2): the last `TIMELINE_DAYS` days, a
   * line a day, through the day its dream opened with (`dream.begun`'s
   * `daysEnd`: a night that crossed midnight still ends there; review of D2,
   * never a day an earlier night told), else the day before `at`. A day
   * day's end did not tell falls back to its chapters' summaries' first
   * lines; a day with neither is counted. One pass over the episodes. Never
   * throws: what will not read is a day without.
   */
  private timeline(at: string, dreamId: string | null): ReflectTimeline {
    const D = DREAM_TUNABLES;
    const days = Math.max(0, Math.floor(D.TIMELINE_DAYS));
    const cap = Math.max(1, Math.floor(D.TIMELINE_LINE_CHARS));
    let told: DaySummary[] = [];
    let opened = "";
    try {
      told = daySummaries(this.store);
      if (dreamId !== null) {
        const begun = this.store.eventLog({ name: "dream.begun", order: "desc", limit: 50 }).find((r) => r.ref === dreamId);
        const d = (JSON.parse(begun?.payload ?? "{}") as Record<string, unknown>)["daysEnd"];
        if (typeof d === "string" && isDay(d)) opened = d;
      }
    } catch {
      told = [];
    }
    const through = opened !== "" ? opened : dayBeforeDate(at);
    const dates: string[] = [];
    for (let i = 0; i < days && isDay(through); i += 1) dates.push(addDays(through, -i));
    const byDate = new Map(told.map((x) => [x.about, x]));
    const missing = dates.filter((d) => !byDate.has(d));
    const fromChapters = missing.length === 0 ? new Map<string, string[]>() : this.chapterLinesByDate(missing);
    const lines: { date: string; from: "days-end" | "chapters"; text: string; chars: number; chapters?: number }[] = [];
    let without = 0;
    for (const date of dates) {
      const t = byDate.get(date);
      if (t !== undefined) {
        const flat = t.text.replace(/\s+/g, " ").trim();
        const first = (t.text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").replace(/\s+/g, " ");
        const text = flat.length <= cap ? flat : clipChars(first, cap);
        lines.push({ date, from: "days-end", text, chars: flat.length });
        continue;
      }
      const ch = fromChapters.get(date);
      if (ch === undefined || ch.length === 0) {
        without += 1;
        continue;
      }
      // Each chapter's share of the line, so a busy day reads as its spread, not its first chapter.
      const share = Math.max(TIMELINE_PIECE_MIN_CHARS, Math.floor(cap / ch.length) - 3);
      const joined = ch.join(" · ");
      lines.push({ date, from: "chapters", text: clipChars(ch.map((x) => clipChars(x, share)).join(" · "), cap), chars: joined.length, chapters: ch.length });
    }
    return { days, through, lines, without };
  }

  /**
   * THE DAYS DAY'S END DID NOT TELL, BY THEIR CHAPTERS (2026-10-23, lane
   * D2): for each date, the first line of each of that day's chapters'
   * summaries — the session's own, else its opening — oldest chapter first.
   * One pass over the episodes written to since the oldest date. Never throws.
   */
  private chapterLinesByDate(dates: readonly string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (dates.length === 0) return out;
    const oldest = [...dates].sort()[0] as string;
    const said = new Map(dates.map((d) => [readableDate(d), d]));
    try {
      const zone = this.store.zone();
      const episodes: EpisodeInView[] = [];
      for (const id of this.store.list({ type: "episode", archived: false })) {
        const row = this.store.row(id);
        if (row === undefined || row.superseded_by !== null || row.body.length === 0) continue;
        const at = row.updated_at ?? row.created_at;
        if (at === null || localDate(at, zone) < oldest) continue;
        const all = chapterEntries(row.body);
        const fresh = all.filter((e) => e.date !== null && said.has(e.date));
        if (fresh.length > 0) episodes.push({ row: { id, title: row.title }, at, fresh, earlier: all.length - fresh.length });
      }
      for (const ep of summarized(this.store, episodes).sort((a, b) => a.at - b.at)) {
        for (const e of ep.fresh) {
          const date = e.date === null ? undefined : said.get(e.date);
          if (date === undefined) continue;
          const first = (entrySummary(e).split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").replace(/\s+/g, " ");
          if (first.length === 0) continue;
          const list = out.get(date) ?? [];
          list.push(first);
          out.set(date, list);
        }
      }
    } catch {
      return out;
    }
    return out;
  }

  /**
   * TONIGHT'S NEW MEMORIES, as the dream had them (2026-10-23): its index's
   * fresh list while the index is still this dream's (the reflection runs
   * right after it), else what it was shown that was born in the last few
   * lived days — the window `recent` reads. Never throws.
   */
  private dreamFresh(dreamId: string, dream: DreamRow | undefined, day: number): Set<string> {
    const index = readIndex(this.store, "dream");
    // Only those `recent` carries (review of D1): after missed nights the
    // dream's new reach back a week, and one older than the window shown
    // nowhere else is one of the older it saw.
    const inWindow = (mid: string): boolean => {
      const row = this.store.row(mid);
      return row !== undefined && row.birth_day >= day - REFLECT_TUNABLES.CHAPTER_DAYS;
    };
    if (index !== null && index.ref === dreamId && index.fresh !== undefined) return new Set(index.fresh.filter(inWindow));
    const out = new Set<string>();
    for (const mid of dream === undefined ? [] : parseIds(dream.shown)) if (inWindow(mid)) out.add(mid);
    return out;
  }

  /** An entry of the last few lived days (one with no day in its heading counts as recent). */
  private entryInView(e: ChapterEntry, day: number): boolean {
    return e.day === null || e.day >= day - REFLECT_TUNABLES.CHAPTER_DAYS;
  }

  /** One memory as the reflection is shown it, at the fidelity its fit gave it. */
  private item(row: MemoryRow, placed: Pick<Placed, "fidelity" | "text" | "chars">): ReflectItem {
    const feelings = this.store
      .feelingsFor(row.id)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, REFLECT_TUNABLES.FEELINGS_SHOWN)
      .map((f) => ({
        whose: f.whose,
        emotion: f.emotion === "other" && f.other_word !== null ? f.other_word : f.emotion,
        strength: round(f.strength),
        later: f.recorded_later ?? null,
        by: f.source ?? null,
        carried_by: cut(f.carried_by, REFLECT_TUNABLES.FEELING_CARRIED_CHARS) ?? "",
      }));
    const about = row.about === null ? null : (ABOUT_MARKS as readonly string[]).includes(row.about) ? (row.about as AboutMark) : null;
    const head = headOf(this.store, row.id);
    return {
      id: row.id,
      ...(head === null ? {} : { standing: earlierMark(head) }),
      kind: row.kind,
      fidelity: placed.fidelity,
      text: placed.text,
      chars: placed.chars,
      felt: round(emotionalIntensity(this.store.physicsOf(row.id))),
      feelings,
      about,
      core: row.promoted_identity === 1,
      learned: row.learned_on,
      dreamed: row.source === "dreamed",
    };
  }

  /**
   * Recall's gates, as a reflection reads them: live, a memory, not
   * protected, not emptied.
   */
  showable(row: MemoryRow): boolean {
    if (row.archived === 1 || row.superseded_by !== null) return false;
    if (row.type !== "memory") return false;
    if (row.protected === 1) return false;
    if (row.body === "") return false;
    return true;
  }

  /** A memory's short handle for a sentence: its title, else its first line. */
  /**
   * THE OPEN THREADS NO LONGER CARRIED (2026-10-22, the open-threads brief):
   * every open thread `openCarry` leaves out tonight (`all`, recorded on the
   * row as `notCarried`), and how many of them no share already holds
   * (`fresh`). What a share holds: the `notCarried` of every row with a share
   * — offered, carried or told — from the newest back to and including the
   * last one that REACHED A SESSION (`told`, or `carried` into a waking
   * session with the ask to tell it). An offered share not yet carried still
   * will be (`pendingShare` finds the older ones too), so its count is its
   * own and the next share does not say it again; a night with no share
   * (quiet, never finished) holds nothing, so the next share says it. Each
   * leaving lands in exactly one share (the review of #592, F5 and G2). A
   * first night after this shipped counts them all.
   */
  private noLongerCarried(id: string, day: number): { all: string[]; fresh: number } {
    const all = [...openCarry(this.store, day, SELF_TUNABLES.OPEN_CARRY_DAYS, SELF_TUNABLES.OPEN_CARRY_GLIMPSE_TOUCH).notCarried.keys()].sort();
    if (all.length === 0) return { all, fresh: 0 };
    const before = new Set<string>();
    try {
      for (const r of this.store.reflections({ limit: 60 })) {
        if (r.id === id || r.share === null) continue;
        if (r.share_state !== "offered" && r.share_state !== "carried" && r.share_state !== "told") continue;
        for (const x of stringIds(parseDetail(r.detail)["notCarried"])) before.add(x);
        if (r.share_state === "carried" || r.share_state === "told") break;
      }
    } catch {
      /* unreadable: count them all, once more */
    }
    return { all, fresh: all.filter((x) => !before.has(x)).length };
  }

  /**
   * THE STALE OPEN THREADS (2026-10-16, #489 D): live memories still flagged
   * `unresolved` (confirmed on the prose, as the wake does), showable here,
   * neither born nor used for `STALE_OPEN_DAYS` lived days. The longest
   * untouched first; what the last few reflections were offered waits behind
   * the rest. At most `STALE_OPEN`.
   */
  private staleOpen(
    id: string,
    day: number,
    see: (mid: string) => { row: MemoryRow; whole: string; line: string } | null,
  ): { id: string; text: string; untouched: number; reopened?: true; settlesWhen?: string }[] {
    const T = REFLECT_TUNABLES;
    const found: { id: string; text: string; untouched: number; reopened?: true; settlesWhen?: string }[] = [];
    // Only the open threads still carried (2026-10-22, `self/identity.ts#openCarry`,
    // the wake's own rule and its one test of what a thread is — not dreamed,
    // not settled over, the flag confirmed on the prose): one nobody touched
    // in `OPEN_CARRY_DAYS` is not offered. Being offered here is not a touch.
    // The offer's own ageing is as before (born or used), so a reopened thread
    // is offered the next night.
    const carry = openCarry(this.store, day, SELF_TUNABLES.OPEN_CARRY_DAYS, SELF_TUNABLES.OPEN_CARRY_GLIMPSE_TOUCH);
    for (const mid of carry.carried) {
      const v = see(mid);
      if (v === null) continue;
      const untouched = day - Math.max(v.row.birth_day, v.row.last_used_day);
      if (untouched < T.STALE_OPEN_DAYS) continue;
      let reopened = false;
      let settles: string | null = null;
      try {
        // Reopened by the owner after a reflection closed it (2026-10-20): it may only be asked about.
        const meta = this.store.readProse(mid).meta;
        reopened = typeof meta[THREAD_REOPENED_BY_META_KEY] === "string";
        // What would settle it, when named (S1, 2026-10-27).
        settles = settlesWhenOf(meta);
      } catch {
        continue;
      }
      found.push({ id: mid, text: v.line, untouched, ...(reopened ? { reopened: true as const } : {}), ...(settles === null ? {} : { settlesWhen: settles }) });
    }
    found.sort((a, b) => b.untouched - a.untouched || (a.id < b.id ? -1 : 1));
    return this.rotated(id, "staleOpen", found).slice(0, T.STALE_OPEN);
  }

  /** What the last few reflections were offered under `key` waits behind the rest (the unmarked offer's rotation). */
  private rotated<X extends { id: string }>(id: string, key: "staleOpen" | "settlesOpen", found: readonly X[]): X[] {
    const T = REFLECT_TUNABLES;
    const lately = new Set(
      this.store
        .reflections({ limit: T.STALE_OPEN_REST_NIGHTS + 1 })
        .filter((r) => r.id !== id)
        .slice(0, T.STALE_OPEN_REST_NIGHTS)
        .flatMap((r) => stringIds(parseDetail(r.detail)[key])),
    );
    return [...found.filter((x) => !lately.has(x.id)), ...found.filter((x) => lately.has(x.id))];
  }

  /**
   * OPEN ITEMS THAT NAME WHAT WOULD SETTLE THEM (2026-10-27, S1; Ames's idea:
   * "an open question needs either a trigger or a decision to let it go"):
   * the carried open threads (`openCarry`, as `staleOpen` reads them) with a
   * `meta.settlesWhen`, showable here, not already offered as stale (`skip`),
   * touched lately or not — a thread whose trigger just happened is usually
   * not stale. The longest untouched first, rotated like `staleOpen`. At
   * most `SETTLES_OPEN`. Being offered is not a touch.
   */
  private settlesOpen(
    id: string,
    day: number,
    see: (mid: string) => { row: MemoryRow; whole: string; line: string } | null,
    skip: ReadonlySet<string>,
  ): { id: string; text: string; settlesWhen: string; untouched: number; reopened?: true }[] {
    const T = REFLECT_TUNABLES;
    const found: { id: string; text: string; settlesWhen: string; untouched: number; reopened?: true }[] = [];
    const carry = openCarry(this.store, day, SELF_TUNABLES.OPEN_CARRY_DAYS, SELF_TUNABLES.OPEN_CARRY_GLIMPSE_TOUCH);
    for (const mid of carry.carried) {
      if (skip.has(mid)) continue;
      let meta: Record<string, unknown>;
      try {
        meta = this.store.readProse(mid).meta;
      } catch {
        continue;
      }
      const settles = settlesWhenOf(meta);
      if (settles === null) continue;
      const v = see(mid);
      if (v === null) continue;
      // From the lived day AFTER it was written (review of #665): the
      // conversation that raised it is never its own evidence.
      if (v.row.birth_day >= day) continue;
      const untouched = Math.max(0, day - Math.max(v.row.birth_day, v.row.last_used_day));
      const reopened = typeof meta[THREAD_REOPENED_BY_META_KEY] === "string";
      found.push({ id: mid, text: v.line, settlesWhen: settles, untouched, ...(reopened ? { reopened: true as const } : {}) });
    }
    found.sort((a, b) => b.untouched - a.untouched || (a.id < b.id ? -1 : 1));
    return this.rotated(id, "settlesOpen", found).slice(0, T.SETTLES_OPEN);
  }

  /**
   * THE CLOSE PROPOSALS, as the session is told to act on them (2026-10-16,
   * #489 D): beside the share in the hand-back and the carried line (the
   * owner-facing question rides in the share itself). Null when none.
   */
  private closeHow(reflection: string, ids: readonly string[], closed: readonly string[] = []): string | null {
    if (ids.length === 0 && closed.length === 0) return null;
    const who = this.ctx.ownerName() ?? "the owner";
    const out: string[] = [];
    // WHAT IT CLOSED ITSELF (2026-10-20): told, with the way back.
    if (closed.length > 0) {
      out.push(
        `The share tells ${who} that I closed ${closed.length === 1 ? "an open thread that looked done" : "some open threads that looked done"} (${closed.join(", ")}): tell it. ` +
          `If ${who} says one is not done ("undo", "that one isn't"), now or in any later session, the counterparts reflect tool's phase "reopen", reopen: [that id], reopens it — the thread's id is enough.`,
      );
    }
    if (ids.length > 0) {
      out.push(
        `The share asks ${who} whether ${ids.length === 1 ? "an open thread looks done" : "some open threads look done"} (${ids.join(", ")}): ask it plainly. ` +
          `On ${who}'s yes, the counterparts reflect tool's phase "close", reflection: ${reflection}, close: [the ids ${who} agreed to], closes them. On a no, or no answer, nothing changes.`,
      );
    }
    return out.join(" ");
  }

  /**
   * WHAT WAS WEAK ABOUT A SETTLES CLOSE'S EVIDENCE (review of #665), in the
   * share's words, or null when `shows` names a memory written after the item:
   * none named, the item itself, or a memory older than the item (by its
   * moment when both have one, else its lived day).
   */
  private weakShows(item: MemoryRow, shows: string | null): string | null {
    if (shows === null) return "I named no memory that shows it";
    if (shows === item.id) return "the memory I pointed to is the open item itself";
    const r = this.store.row(shows);
    if (r === undefined) return "I named no memory that shows it";
    const older = r.created_at !== null && item.created_at !== null ? r.created_at < item.created_at : r.birth_day < item.birth_day;
    return older ? "the memory I pointed to is older than the open item" : null;
  }

  /**
   * THE SHARE'S OPEN-THREAD LINES (2026-10-20), generated like the became-core
   * line: what it closed itself, each with its why and the way back — and,
   * for a settles close on weak evidence (S1), what was weak — then what it
   * asks about. Null when neither.
   */
  private closeSentences(closed: readonly SelfClose[], asked: readonly string[]): string | null {
    const lines: string[] = [];
    if (closed.length > 0) {
      const named = closed
        .map((x) => `"${this.handle(x.id)}" (${x.id}) — ${x.why.replace(/[\s.;:,!]+$/u, "")}${x.weak === undefined ? "" : ` (though ${x.weak})`}`)
        .join("; ");
      lines.push(
        closed.length === 1
          ? `I closed one open thread that looked done: ${named}. If it isn't, say so and I'll reopen it.`
          : `I closed ${countWord(closed.length)} open threads that looked done: ${named}. If one isn't, say so and I'll reopen it.`,
      );
    }
    if (asked.length > 0) {
      const named = asked.map((cid) => `"${this.handle(cid)}" (${cid})`).join("; ");
      lines.push(
        asked.length === 1
          ? `One thing still listed as open looks done to me: ${named}. Shall I close it?`
          : `A few things still listed as open look done to me: ${named}. Shall I close them?`,
      );
    }
    return lines.length === 0 ? null : lines.join(" ");
  }

  /**
   * A RE-LABEL INTO ME, US OR THE OWNER, IN THE SHARE (owner ruling D2 on
   * #256): a sentence each, up to `RELABEL_SAID`; past that (2026-10-20, the
   * unmarked offer grew to 24 a night) the rest in one sentence with how many
   * — every one still cited, so none goes unsaid. And the way back, as a
   * self-close says its own (review of #558): a mark into the owner or us
   * carries a memory into every folder, so a wrong one is worth undoing.
   */
  private relabelSentences(moves: readonly { id: string; mark: AboutMark }[]): string[] {
    if (moves.length === 0) return [];
    const back = moves.length === 1 ? "If it isn't, say so and I'll mark it back." : "If one isn't, say so and I'll mark it back.";
    return [...this.relabelSaid(moves), back];
  }

  private relabelSaid(moves: readonly { id: string; mark: AboutMark }[]): string[] {
    const one = (m: { id: string; mark: AboutMark }): string =>
      `I've come to think "${this.handle(m.id)}" is ${m.mark === "me" ? "about who I am" : m.mark === "us" ? "about the two of us" : "about you"}.`;
    if (moves.length <= RELABEL_SAID) return moves.map(one);
    const said = moves.slice(0, RELABEL_SAID - 1).map(one);
    const rest = moves.length - said.length;
    const by = (["owner", "us", "me"] as const)
      .map((k) => ({ k, n: moves.slice(said.length).filter((m) => m.mark === k).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${String(x.n)} ${x.k === "owner" ? "about you" : x.k === "us" ? "about the two of us" : "about who I am"}`);
    return [...said, `And ${String(rest)} more I've come to think are personal, not work (${by.join(", ")}), so every folder hears them now.`];
  }

  private handle(id: string): string {
    const row = this.store.row(id);
    if (row === undefined) return id;
    const line = ((row.title ?? "").trim() || (row.body.split("\n").find((l) => l.trim().length > 0) ?? "")).replace(/\s+/g, " ").trim();
    return line.length > 80 ? `${line.slice(0, 79)}…` : line || id;
  }

  /**
   * ONE FEELING RECORDED LATER, looking back — the reflection's `feelings`
   * part and, since 2026-10-02, an awake session's (`feelAgain`), through one
   * path and one set of guarantees: only a memory it was shown that still
   * stands; never one a dream or a reflection wrote (review of #256, B1); the
   * WHOLE sent emotion through the credential scan and the mark check, then a
   * phrase in it split, the tail scanned again with carried_by (review of
   * #268); not written twice by the same writer (`sameFeeling`); a strength
   * left out takes the word's default, capped below the fast lane (review of
   * #301, m2); marked `recorded_later` with the date and its source. Never
   * throws: the part's result says what happened.
   */
  private laterFeeling(
    f: LaterFeelingInput,
    o: {
      readonly shown: ReadonlySet<string>;
      readonly session: string;
      readonly date: string;
      readonly source: "reflection" | "awake";
      /** What carried_by opens with: `on reflection, <date>`, `looking back, awake, <date>`. */
      readonly prefix: string;
      readonly model: string | null;
      /** What this writer already recorded (a resend is answered, not written twice); added to. */
      readonly mine: Set<string>;
      /** The limit's detail when it is reached, else null — asked only for a feeling that would be written. */
      readonly full: () => string | null;
      /** Checked last, before the write: a reason and detail to refuse with, or null. */
      readonly gate?: (r: MemoryRow) => { reason: string; detail: string } | null;
      /** The owner's feeling may be recorded later too (awake only); the reflection's are its own. */
      readonly whose?: "self" | "owner";
    },
  ): PartResult {
    const id = typeof f.id === "string" ? f.id : null;
    const r = id !== null && o.shown.has(id) ? this.store.row(id) : undefined;
    if (r === undefined || !this.showable(r)) {
      const detail =
        o.source === "awake" && id !== null && !o.shown.has(id)
          ? `${id} was not shown in this session; read it first (the recall tool, ids: ["${id}"]), then record how it feels now.`
          : this.notCitable(id, o.shown);
      return { id, ok: false, reason: "not-shown-or-gone", detail };
    }
    // WHAT A DREAM OR A REFLECTION WROTE IS NOT FELT LATER (review of #256,
    // B1): a gist starts low on purpose (its salience is capped, a dream's
    // own feeling-now is capped at its peak), and a later feeling is exactly
    // what the fast lane reads — one organic use after it would carry dream
    // words into the core. Feel the memories it was drawn from instead.
    const notLived = notLivedReason(r, "feel");
    if (notLived !== null) {
      return { id, ok: false, reason: notLived, detail: `${r.id} was written by a ${r.source === "dreamed" ? "dream" : "reflection"}; feel the memories it came from instead.` };
    }
    // ACCEPT AND REPAIR (2026-09-28): emotion is one word, carried_by the
    // nuance. The WHOLE sent emotion crosses the credential scan and the
    // mark check first (review of #268: a key in `emotion` went around the
    // scan); then a phrase in it is split, and the tail crosses the scan
    // again with the rest of carried_by.
    const sent = this.words(String(f.emotion ?? ""), o.session, CARRIED_BY_MAX_CHARS);
    if (!sent.ok) return { id, ok: false, reason: sent.reason, detail: `emotion: ${sent.detail}` };
    const sentCarried = typeof f.carried_by === "string" ? f.carried_by : "";
    const split = repairEmotion(sent.text, sentCarried);
    const carried = this.words(split?.carriedBy ?? sentCarried, o.session, CARRIED_BY_MAX_CHARS, true);
    const strength = typeof f.strength === "number" && Number.isFinite(f.strength) ? Math.max(0, Math.min(1, f.strength)) : undefined;
    const valence = typeof f.valence === "number" && Number.isFinite(f.valence) ? Math.max(-1, Math.min(1, f.valence)) : undefined;
    const feeling: FeelingInput = {
      whose: o.whose ?? "self",
      core: typeof f.core === "string" ? f.core : "",
      emotion: split?.emotion ?? sent.text,
      // Left out, the store gives it the word's default, capped below the
      // fast lane, as for a session's feeling (review of #301, m2) — not 0.
      ...(strength === undefined ? {} : { strength }),
      ...(valence === undefined ? {} : { valence }),
      carriedBy: `${o.prefix}${carried.ok && carried.text.length > 0 ? `: ${carried.text}` : ""}`,
    };
    const same = sameFeeling(this.store, r.id, o.mine, feeling);
    if (same !== null) {
      return { id, ok: true, reason: "already-recorded", note: `${o.source === "reflection" ? "This reflection" : "This call"} already recorded that feeling on ${r.id} (${same}); nothing new was written.` };
    }
    const gated = o.gate?.(r) ?? null;
    if (gated !== null) return { id, ok: false, ...gated };
    const full = o.full();
    if (full !== null) return { id, ok: false, reason: "limit-reached", detail: full };
    const notes: string[] = [];
    if (sent.cut) notes.push(`emotion was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`);
    if (split !== null) notes.push(splitNote(split));
    if (!carried.ok) notes.push(`carried_by was not kept — ${carried.detail}`);
    else if (carried.cut) notes.push(`carried_by was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`);
    try {
      const added = this.store.addFeelings(r.id, [feeling], { source: o.source, recordedLater: o.date, ...(o.model ? { model: o.model } : {}) });
      for (const fid of added.ids) o.mine.add(fid);
      for (const rep of added.repairs) notes.push(rep.note);
      return { id, ok: true, reason: "recorded-later", ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
    } catch (err) {
      return { id, ok: false, reason: refusalOf(err), detail: "Nothing was recorded for this one; fix it and send it again." };
    }
  }

  /**
   * RE-FEELING WHILE AWAKE (2026-10-02, lane B, owner pick 2). In an ordinary
   * session, when an old memory comes up and feels different now, a later
   * feeling is recorded beside the first — the reflection's path
   * (`laterFeeling`), with its guarantees, and three of its own:
   *
   *   - only a memory THIS SESSION was shown — `shown`, which the door hands
   *     in (what recall surfaced or returned, what a write showed); one it was
   *     not shown is refused with the way in (recall it by id first);
   *   - at most ONE awake feeling-now a calendar day per memory, whoever
   *     writes it (the reflection's own feelings do not count against it);
   *   - labeled as awake: source `awake`, `recorded_later` today's date,
   *     carried_by opening "looking back, awake, <date>". The fast lane reads
   *     it only through the reflected-feeling door, as a reflection's.
   *
   * At most `AWAKE_FEELINGS` a call. Refused under observer stance. Pure of
   * any model: the session is the mind.
   */
  feelAgain(input: {
    readonly session: string;
    readonly shown: ReadonlySet<string>;
    readonly feelings: readonly LaterFeelingInput[];
    readonly model?: string | null;
  }): { ok: true; feelings: PartResult[] } | { ok: false; reason: "observer" } {
    if (this.ctx.observer) return { ok: false, reason: "observer" };
    const date = this.ctx.today();
    const mine = new Set<string>();
    const out: PartResult[] = [];
    const written = (): number => out.filter((x) => x.ok && x.reason === "recorded-later").length;
    for (const f of input.feelings.slice(0, 50)) {
      const whose = f.whose === "owner" ? "owner" : "self";
      out.push(
        this.laterFeeling(f, {
          shown: input.shown,
          session: input.session,
          date,
          source: "awake",
          prefix: `looking back, awake, ${date}`,
          model: input.model ?? null,
          mine,
          whose,
          gate: (r) =>
            this.store.feelingsFor(r.id).some((x) => x.source === "awake" && x.recorded_later === date)
              ? { reason: "once-a-day", detail: `${r.id} already has a feeling recorded looking back, awake, today; one a calendar day per memory.` }
              : null,
          full: () =>
            written() >= REFLECT_TUNABLES.AWAKE_FEELINGS
              ? `At most ${String(REFLECT_TUNABLES.AWAKE_FEELINGS)} feelings looking back in one call.`
              : null,
        }),
      );
    }
    this.record("feelings.awake", input.session, { sent: input.feelings.length, written: written() });
    return { ok: true, feelings: out };
  }

  /**
   * THE REFLECTION MAY SETTLE (2026-09-29, held lightly): two memories it was
   * shown that disagree — a pair on "my mind", usually — when the reason is
   * plain. The waking write-up and sleep are the usual home; this is the
   * reflection's door, and the trail names it (`reflection`, its id). The
   * settle itself is `reconsolidation.ts#settle`'s; `why` crosses the
   * credential scan first, and a settle with no reason is refused.
   */
  settle(input: { reflection: string; session?: string; holds: string; over: string; how: string; why: string }): SettleOutcome {
    const open = this.openFor(input.reflection, input.session);
    if (!open.ok) return { ok: false, reason: open.reason === "observer" ? "observer" : "failed", detail: `The reflection is not open for a settle (${open.reason}).` };
    const row = open.reflection;
    const shown = new Set(parseIds(row.shown));
    for (const id of [input.holds, input.over]) {
      if (!shown.has(id)) return { ok: false, reason: "unknown-memory", detail: `${id} was not shown to this reflection; settle only what it was shown.` };
    }
    const why = this.words(input.why, row.session ?? row.id, DREAM_TUNABLES.MAX_WHY_CHARS);
    if (!why.ok) return { ok: false, reason: "failed", detail: `A reflection settles only with a plain reason, in \`why\` — ${why.detail}` };
    return settleContradiction(this.store, { holds: input.holds, over: input.over, how: input.how, why: why.text, actor: "reflection", actorId: row.id });
  }

  /**
   * A reflection this session may still finish: this session's and the
   * newest; begun — or already finished THIS calendar day, when `again` (a
   * second `finish` supplies what the first refused or left out, 2026-09-28).
   * An older one, or one a newer reflection followed, is closed.
   */
  private openFor(id: string, session: string | undefined): { ok: true; reflection: ReflectionRow; again: boolean } | { ok: false; reason: ReflectRefusal } {
    if (this.ctx.observer) return { ok: false, reason: "observer" };
    const row = this.store.reflection(id);
    if (row === undefined) return { ok: false, reason: "unknown-reflection" };
    if (session !== undefined && row.session !== null && row.session !== session) return { ok: false, reason: "not-this-session" };
    const newest = this.last();
    if (newest !== null && newest.id !== row.id) return { ok: false, reason: "reflection-closed" };
    if (row.state === "begun") return { ok: true, reflection: row, again: false };
    // The same CALENDAR day (2026-09-28: was the lived day).
    if (row.state === "reflected" && onDay(row, this.ctx.today(), this.store.livedDay())) return { ok: true, reflection: row, again: true };
    return { ok: false, reason: "reflection-closed" };
  }

  /**
   * Words through the credential scan; never empty unless allowed; never
   * marked. Longer than `max` is kept to `max` and SAID (`cut`), never cut
   * without a word.
   */
  private words(
    text: string | undefined,
    session: string,
    max: number,
    allowEmpty = false,
  ): { ok: true; text: string; cut: boolean } | { ok: false; reason: string; detail: string } {
    const raw = (text ?? "").trim();
    if (raw.length === 0) return allowEmpty ? { ok: true, text: "", cut: false } : { ok: false, reason: "empty-text", detail: "It was empty." };
    if (carriesDreamMark(raw)) return { ok: false, reason: "dream-mark-in-text", detail: `It carries the dream's mark (${DREAM_MARK}…); take it out.` };
    const verdict = this.ctx.gate(raw.slice(0, max), session);
    if (!verdict.ok) return { ok: false, reason: `gate:${verdict.reason}`, detail: `The credential scan refused it (${verdict.reason}).` };
    return { ok: true, text: verdict.text, cut: raw.length > max };
  }

  /** A durable row (ids and counts only) — in the reflection's own record, not the event log. */
  private record(name: string, ref: string, payload: Record<string, string | number | boolean | null>): void {
    this.ctx.emit?.(name, ref, payload);
  }
}

// ── small helpers ────────────────────────────────────────────────────────────

/** A why's length for a belief let go (the reflection's settle's). */
const T_WHY = DREAM_TUNABLES.MAX_WHY_CHARS;

/** What a reflection was shown of beliefs, kept on its row at begin (lane C). */
interface BeliefsShownDetail {
  beliefSelf?: string;
  beliefSubjects?: string[];
  beliefsShown?: string[];
  beliefsContested?: string[];
}

function beliefsDetail(b: ReflectBeliefs | null): BeliefsShownDetail & { beliefCandidates?: [string, { subject: string; statement: string; sources: readonly string[] }][] } {
  if (b === null || b.subjects.length === 0) return {};
  const all = b.subjects.flatMap((s) => s.beliefs);
  return {
    beliefSelf: b.subjects[0]?.id as string,
    beliefSubjects: b.subjects.map((s) => s.id),
    beliefsShown: all.map((x) => x.id),
    beliefsContested: all.filter((x) => x.contested === true).map((x) => x.id),
    ...(b.candidates === undefined || b.candidates.length === 0
      ? {}
      : { beliefCandidates: b.candidates.map((c): [string, { subject: string; statement: string; sources: readonly string[] }] => [c.id, { subject: c.subject, statement: c.statement, sources: c.sources }]) }),
  };
}

/** The dream's candidates as the begin kept them: `[id, {subject, statement, sources}]` pairs. */
function stringIdsPairs(v: unknown): [string, { subject: string; statement: string; sources: string[] }][] {
  if (!Array.isArray(v)) return [];
  const out: [string, { subject: string; statement: string; sources: string[] }][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || typeof p[0] !== "string" || !isRecord(p[1])) continue;
    const d = p[1];
    out.push([p[0], { subject: typeof d["subject"] === "string" ? d["subject"] : "me", statement: typeof d["statement"] === "string" ? d["statement"] : "", sources: stringIds(d["sources"]) }]);
  }
  return out;
}

/** What became of the dream's candidates: `[candidate id, belief id or "let-go"]` pairs. */
function decidedPairs(v: unknown): [string, string][] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string");
}

function beliefsDetailOf(d: Record<string, unknown>): BeliefsShownDetail {
  const out: BeliefsShownDetail = {};
  if (typeof d["beliefSelf"] === "string") out.beliefSelf = d["beliefSelf"];
  for (const k of ["beliefSubjects", "beliefsShown", "beliefsContested"] as const) {
    const ids = stringIds(d[k]);
    if (ids.length > 0) out[k] = ids;
  }
  if (Array.isArray(d["beliefCandidates"])) (out as Record<string, unknown>)["beliefCandidates"] = d["beliefCandidates"];
  return out;
}

/**
 * THE ASK (lane C, 2026-10-21): plain and short, in the finish's own style.
 * A belief is a claim life has to back; filing beats writing a new one.
 */
function beliefLines(b: ReflectBeliefs, filings: number): string[] {
  const contested = b.subjects.some((s) => s.beliefs.some((x) => x.contested === true));
  return [
    `- beliefs (optional; most nights need few or none): beliefs.subjects is what I hold about the subjects in play tonight — each belief with its strength, and how many memories back it (support) or go against it. A belief is a claim life has to back: it starts weak and grows only as lived memories back it, each counted once. Filing support for a belief already here beats writing a new one.`,
    `  filings (at most ${String(filings)}): {belief, memory, stance: "support" or "contrary"} — a lived memory you were shown that backs a belief here, or goes against it. One counted before adds nothing.`,
    `  births (at most ${String(b.births)} new beliefs; most nights need none): {subject: "me" (for me or us) or a subject's id, statement: one short claim in your own words — not a memory's words, cites: the lived memories it rests on, about: "me" or "us" on me}. One that says what a belief here already says is refused with that belief's id: file to it instead.`,
    ...(b.candidates !== undefined && b.candidates.length > 0
      ? [
          `  candidates: tonight's dream proposed ${b.candidates.length === 1 ? "a belief" : `${String(b.candidates.length)} beliefs`} — a dream suggests, you decide. adopt: {candidate, subject?, statement?} for one that rings true (you may say it better); the rest are let go. An adopted one starts weak, its lived sources its first support.`,
        ]
      : []),
    ...(contested
      ? [
          `  contested: a belief marked contested met more against it than its support holds. Read what went against it; then either let it go — retire: {belief, why} — or say it better as a birth with replaces: its id, citing what went against it (contestedBy; the new one starts weak). Leave it if you are not sure.`,
        ]
      : []),
  ];
}

/** The words that turn a claim around (review of #577): token cosine cannot see them. */
const NEGATIONS: ReadonlySet<string> = new Set(["not", "no", "never", "none", "nobody", "nothing", "neither", "nor"]);

/**
 * Does one statement add or remove a negation the other has? "We don't work
 * best at dawn." against "We work best at dawn." reads 0.91 by token cosine,
 * and it is exactly what the contrary evidence says: a replacement, not the
 * claim again. Counts each negation word (and every `n't`) on both sides.
 */
export function negationDiffers(a: string, b: string): boolean {
  const count = (text: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const raw of text.toLowerCase().replace(/[’']/g, "'").split(/[^a-z']+/)) {
      if (raw.length === 0) continue;
      const word = raw.endsWith("n't") ? "not" : raw;
      if (NEGATIONS.has(word)) m.set(word, (m.get(word) ?? 0) + 1);
    }
    return m;
  };
  const x = count(a);
  const y = count(b);
  for (const k of new Set([...x.keys(), ...y.keys()])) if ((x.get(k) ?? 0) !== (y.get(k) ?? 0)) return true;
  return false;
}

/** A statement as one line: every run of whitespace one space (review of #577). */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The limits as the bundle had them before beliefs (review of #577): off is byte for byte as before. */
function limitsWithoutBeliefs(l: typeof REFLECT_TUNABLES.LIMITS): Omit<typeof REFLECT_TUNABLES.LIMITS, "beliefFilings"> {
  const { beliefFilings: _omit, ...rest } = l;
  void _omit;
  return rest;
}

function parseIds(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The id of a feeling among `mine` (what this reflection recorded) on
 * `memoryId` that says the same thing as `input` — whose, core, emotion, word,
 * spelled the way the store will spell it — or null. A feeling that will not
 * check is left for the store to refuse, with its reason.
 */
function sameFeeling(store: Store, memoryId: string, mine: ReadonlySet<string>, input: FeelingInput): string | null {
  if (mine.size === 0) return null;
  let want: ReturnType<typeof checkFeelings>["rows"][number] | undefined;
  try {
    want = checkFeelings([input]).rows[0];
  } catch {
    return null;
  }
  if (want === undefined) return null;
  const hit = store
    .feelingsFor(memoryId)
    .find((f) => mine.has(f.id) && f.whose === want.whose && f.core === want.core && f.emotion === want.emotion && (f.other_word ?? null) === want.otherWord);
  return hit?.id ?? null;
}

function parseDetail(json: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json);
    return isRecord(v) ? v : {};
  } catch {
    return {};
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function cut(text: string | null, max: number): string | null {
  if (text === null) return null;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** `text` kept to `max` characters, the last one "…" — the fitter's excerpt. */
function excerpt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * The shared fit and the unmarked offer's own fit as one outcome: the offer's
 * placements first (so a bundle in parts carries them in its first), then the
 * shared fit's, less any the offer re-placed; the waiting and the counts of both.
 */
function mergeFits(shared: Pick<FitOutcome, "placed" | "waiting" | "report">, offer: Pick<FitOutcome, "placed" | "waiting" | "report">): Pick<FitOutcome, "placed" | "waiting" | "report"> {
  const moved = new Set(offer.placed.map((p) => p.id));
  const placed = [...offer.placed, ...shared.placed.filter((p) => !moved.has(p.id))];
  // One the offer could not re-place keeps what the shared fit gave it (a
  // bare id, or waiting), so it is neither counted twice nor both placed and waiting.
  const waiting = shared.waiting.filter((x) => !moved.has(x));
  const count = (f: Fidelity): number => placed.filter((p) => p.fidelity === f).length;
  return {
    placed,
    waiting,
    report: { ...shared.report, whole: count("whole"), excerpt: count("excerpt"), lined: count("line"), ids: count("id"), waiting: waiting.length },
  };
}

/** A composed bundle and what its fit offered (for the lookup ledger). */
interface Composed {
  readonly bundle: ReflectBundle;
  readonly offered: { whole: string[]; excerpt: string[]; line: string[]; id: string[] };
  /** The longest a chapter's summary was as a line (2026-10-15), so `part` renders what the fit measured. */
  readonly lineCap: number;
  /** Every open thread not carried tonight (`noLongerCarried`), recorded on the row; never in the bundle. */
  readonly notCarried: readonly string[];
  /** The felt lane's memories the candidates' cap cut (R1's check): recorded on the row as `lanes.feltFromCut`; never in the bundle. */
  readonly feltFromCut: number;
}

/** The bundle's other furniture, reserved from the room: ids, lists, the questions, the limits. */
const REFLECT_FURNITURE = 4_000;

/**
 * A dream's changes whose memories the reflection is shown as what the dream
 * CHANGED (2026-10-23, `REFLECT_ROOM_ORDER`): a merge's and a gist's new
 * memory, a link's two ends, a settle's or a slot's pair, a flagged pair, a
 * feeling recorded now. Not a replay (it changes nothing a reflection reads),
 * a nomination (it comes as one) or a belief candidate (no memory).
 */
const SAW_CHANGED: ReadonlySet<string> = new Set(["merge", "gist", "link", "settle", "slot", "contradiction", "feeling-now"]);

/** Was this row on that calendar day? Its date, else (a row with none) its lived day. */
function onDay(row: { date: string | null; day: number }, at: string, day: number): boolean {
  return row.date !== null && row.date.length > 0 ? row.date === at : row.day >= day;
}

/** The begin result's text: the opener, then the bundle. */
/** The strings of a detail's list, or none. */
function stringIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The core decisions a detail keeps (2026-10-20), or none. */
function coreDecidedOf(v: unknown): CoreDecided[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): CoreDecided[] =>
    isRecord(x) && typeof x["id"] === "string" && (x["decision"] === "keep" || x["decision"] === "retire") && typeof x["why"] === "string"
      ? [{ id: x["id"], decision: x["decision"], why: x["why"] }]
      : [],
  );
}

/** The self-closes a detail keeps (2026-10-20), or none. */
function selfClosedOf(v: unknown): SelfClose[] {
  if (!Array.isArray(v)) return [];
  const out: SelfClose[] = [];
  for (const x of v) {
    if (!isRecord(x) || typeof x["id"] !== "string" || typeof x["why"] !== "string") continue;
    out.push({ id: x["id"], why: x["why"], ...(typeof x["shows"] === "string" ? { shows: x["shows"] } : {}), ...(typeof x["weak"] === "string" ? { weak: x["weak"] } : {}) });
  }
  return out;
}

/**
 * `closeThread`'s checks (`counterpart-deposit.ts`), for a thread closed or
 * reopened from here: the owner's protection and an archived row. Null when
 * it may be written. From any folder (the other-directory refusal went with
 * the yours/guest split, 2026-10-21).
 */
function threadGuard(r: MemoryRow): string | null {
  if (r.protected === 1) return "protected-refuses-revision";
  if (r.archived === 1) return "target-archived";
  return null;
}

/** `text` without one generated line in it (the share's open-thread line, said again on a later finish). */
function withoutLine(text: string, line: string): string {
  return text.replace(` ${line}`, "").replace(line, "").trim();
}

/** Two to five in words, else the digits. */
function countWord(n: number): string {
  return ["two", "three", "four", "five"][n - 2] ?? String(n);
}

function render(id: string, bundle: ReflectBundle, aliases: AliasMap | null = null): string {
  const opener = `${reflectionOpener(id)} what you are handed to reflect on — memories and a dream, not events happening now.`;
  if (aliases !== null) return [opener, ...leanReflectLines(bundle, aliases)].join("\n");
  return `${opener}\n${JSON.stringify(bundle)}`;
}

// ── the lean bundle (2026-10-23, Mike's go 10-23) ────────────────────────────

/** How to read the lean reflection bundle, said once at its top. */
export const REFLECT_LEAN_LEGEND =
  "Short ids: m1… are memories and c1… journals (c2#3 is journal c2's chapter 3) — the same numbers the dream used tonight, then more. The reflect and recall tools take them, and real ids too; in anything you write — the entry, the share, the page, a why, how a memory feels — name memories in words (a short id means nothing after tonight), and cite them by id.\n" +
  "A memory line: id · kind (left out: fact) · about (left out: none) · how strongly felt · learned · core (left out: not) · dreamed (a dream wrote it: a suggestion, not lived) · feelings: whose, the word, strength, who recorded it and when, if later — and what carried it · earlier, now mX (when a later memory settled over it) · its words. " +
  "Words shown in part end with the whole length in parentheses: (1005) is a line, (excerpt of 5000) an excerpt, (id only; 1005) no words; no parentheses: whole. " +
  "Read any you need whole with the recall tool, ids: [...] — several at once — before you cite, feel or mark it. A chapter shown in part is read by its address, ids: [\"c2#3\"], or its journal's id.";

/**
 * THE LEGEND WITH THE ROOM REORDERED (2026-10-23, `dream.REFLECT_ROOM_ORDER`):
 * the sections, in the order the room was filled.
 */
export const REFLECT_LEAN_LEGEND_ORDER =
  `${REFLECT_LEAN_LEGEND}\n` +
  "The room was filled in this order, the first three always shown: the page, your last reflections and what the dream put forward; the long view — core, candidates, felt — a line each at least, whole as far as the room went; the last few days' chapters, each by its summary (a recall of its address, ids: [\"c2#3\"], reads it whole). Then what the dream changed tonight and the older memories it saw (dreamSaw: tonight's new memories are under recent, not there), and the rest as far as the room went.";

/**
 * THE TIMELINE AS LEAN LINES (2026-10-23, lane D2): its head, then a line a
 * day, newest first — a date, where it came from when not day's end, its
 * words, and the whole length in parentheses when they are not whole.
 */
export function timelineLines(t: ReflectTimeline, year: string): string[] {
  const without = t.without === 0 ? "" : `; ${String(t.without)} ${t.without === 1 ? "day" : "days"} without a summary or a chapter`;
  const out = [`## timeline: the last ${String(t.days)} days through ${leanDate(t.through, year)}, a line a day — day's end's summary, or (chapters) that day's chapters' first lines${without}`];
  for (const l of t.lines) {
    const from = l.from === "chapters" ? ` (chapters${l.chapters === undefined ? "" : `; ${String(l.chapters)}`})` : "";
    const tail = l.text.length >= l.chars && !l.text.endsWith("…") ? "" : ` (${String(l.chars)})`;
    out.push(`${leanDate(l.date, year)}${from} · ${l.text}${tail}`);
  }
  return out;
}

/** A chapter's piece of a timeline line built from chapters, at the least, in characters (2026-10-23, lane D2). */
const TIMELINE_PIECE_MIN_CHARS = 60;

/** What the timeline spends of the room: its lines and their furniture. */
function timelineChars(t: ReflectTimeline): number {
  return 160 + t.lines.reduce((n, l) => n + wireChars(l.text) + 40, 0);
}

/** A text kept to `cap` characters, cut at a word with "…" when longer. */
function clipChars(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const cut = text.slice(0, Math.max(1, cap - 1));
  const at = cut.lastIndexOf(" ");
  return `${(at > cap * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** The calendar day before a `YYYY-MM-DD`, or "" when it does not read. */
function dayBeforeDate(at: string): string {
  return isDay(at) ? addDays(at, -1) : "";
}

/** One memory as one lean line. */
export function leanReflectItem(item: ReflectItem | string, aliases: AliasMap, year: string, id?: string): string {
  if (typeof item === "string") return `${aliases.short(id ?? "")} · ${item}`;
  const f: string[] = [aliases.short(item.id)];
  if (item.kind !== "fact") f.push(item.kind);
  if (item.about !== null) f.push(item.about);
  f.push(`felt ${leanNumber(item.felt)}`);
  f.push(`learned ${leanDate(item.learned, year)}`);
  if (item.core) f.push("core");
  if (item.dreamed) f.push("dreamed");
  if (item.feelings.length > 0) {
    f.push(
      `feelings: ${item.feelings
        .map((x) => `${x.whose} ${x.emotion} ${leanNumber(x.strength)}${x.by === null ? "" : ` by ${x.by}`}${x.later === null ? "" : ` later ${x.later}`}${x.carried_by.length === 0 ? "" : `, carried by ${x.carried_by}`}`)
        .join(" | ")}`,
    );
  }
  if (item.standing !== undefined) f.push(aliases.inText(item.standing).replace(/^earlier \(now (.+)\)$/, "earlier, now $1"));
  const tail = item.fidelity === "whole" ? "" : item.fidelity === "excerpt" ? ` (excerpt of ${String(item.chars)})` : item.fidelity === "id" ? ` (id only; ${String(item.chars)})` : ` (${String(item.chars)})`;
  return `${f.join(" · ")} · ${item.text}${tail}`;
}

/** A line of what the dream saw: its short id and words, a settled-over mark put short. */
export function leanSaw(s: { readonly id: string; readonly text: string }, aliases: AliasMap): string {
  return `${aliases.short(s.id)} · ${s.text.replace(/^earlier \(now ([^)]+)\)/, (_m, head: string) => `earlier, now ${aliases.short(head)}`)}`;
}

/** The memories, chapters and lines of what the dream saw a bundle or a part carries, as lean lines. */
export function leanReflectBody(
  memories: Readonly<Record<string, ReflectItem | string>>,
  chapters: readonly ShownChapter[],
  dreamSaw: readonly { readonly id: string; readonly text: string }[],
  aliases: AliasMap,
  year: string,
  /** The room reordered (2026-10-23, `REFLECT_ROOM_ORDER`): the memories first, the chapters by their summaries, what the dream changed and saw last. */
  ordered = false,
  /** The timeline (2026-10-23, lane D2): part 1's, beside the chapters. */
  timeline?: ReflectTimeline,
): string[] {
  const out: string[] = [];
  const ms = Object.entries(memories);
  if (ordered) {
    if (ms.length > 0) out.push("## memories", ...ms.map(([k, v]) => leanReflectItem(v, aliases, year, k)));
    if (timeline !== undefined) out.push(...timelineLines(timeline, year));
    if (chapters.length > 0) {
      out.push("## chapters: the last few days, each chapter by its summary (its address reads it whole)");
      for (const c of chapters) out.push(leanChapterHead(c, aliases), ...c.entries.map((e) => leanEntry(e, c.id, aliases, "summaries")));
    }
    if (dreamSaw.length > 0) out.push("## dreamSaw: what the dream changed tonight, and the older memories it saw, a line each (tonight's new ones are under recent)", ...dreamSaw.map((s) => leanSaw(s, aliases)));
    return out;
  }
  if (dreamSaw.length > 0) out.push("## dreamSaw: what the dream saw and made tonight, a line each", ...dreamSaw.map((s) => leanSaw(s, aliases)));
  if (chapters.length > 0) {
    out.push("## chapters: the last few days");
    for (const c of chapters) out.push(leanChapterHead(c, aliases), ...c.entries.map((e) => leanEntry(e, c.id, aliases, "fit")));
  }
  if (ms.length > 0) out.push("## memories", ...ms.map(([k, v]) => leanReflectItem(v, aliases, year, k)));
  return out;
}

/** The whole bundle (or its first part) as lean lines, after the opener. */
function leanReflectLines(b: ReflectBundle, aliases: AliasMap): string[] {
  const s = (id: string): string => aliases.short(id);
  const list = (ids: readonly string[]): string => (ids.length === 0 ? "none" : ids.map(s).join(" "));
  const year = b.date.slice(0, 4);
  const out: string[] = [];
  out.push(`reflection ${b.reflection} · ${b.date} · ${b.dream === null ? "no dream tonight" : `after dream ${b.dream}`} · owner ${b.owner ?? "not named"}`);
  if (b.parts !== null) out.push(`parts: part ${String(b.parts.part)} of ${String(b.parts.of)}. ${b.parts.next}`);
  out.push("questions:", ...b.questions.map((q, i) => `${String(i + 1)}. ${q}`));
  out.push(`shown: ${plainValue(b.shownAs, aliases)}`);
  out.push(`limits: ${plainValue(b.limits, aliases)}`);
  out.push(b.chaptersAs === "summaries" ? REFLECT_LEAN_LEGEND_ORDER : REFLECT_LEAN_LEGEND);
  if (b.dreamed !== null) {
    out.push(`## dreamed: ${b.dreamed.title ?? "(untitled)"}`, b.dreamed.journal ?? "(no journal)");
    out.push(`gists: ${list(b.dreamed.gists)}`);
    out.push(`nominations: ${b.dreamed.nominations.length === 0 ? "none" : b.dreamed.nominations.map((n) => `${s(n.id)}${n.why === null ? "" : ` (${n.why})`}`).join(" · ")}`);
  }
  out.push("## selfPage", b.selfPage ?? "none");
  out.push("## earlier: your last reflections");
  if (b.earlier.length === 0) out.push("none");
  for (const e of b.earlier) out.push(`- ${e.date ?? "undated"}: ${e.entry}`);
  out.push(`## onMind: what's on my mind${(b.onMindMore ?? 0) > 0 ? ` (onMindMore ${String(b.onMindMore)})` : ""}`);
  if (b.onMind.length === 0) out.push("none");
  for (const m of b.onMind) out.push(`- ${[m.kind, ...(m.date === undefined ? [] : [m.date]), ...(m.pair === undefined ? [] : [m.pair]), m.ids.map(s).join(" ")].filter((x) => x.length > 0).join(" · ")} · ${m.text}`);
  out.push(`core: ${list(b.core)}`);
  if (b.spine !== undefined) {
    out.push("## spine");
    if (b.spine.length === 0) out.push("none");
    for (const x of b.spine) out.push(`- ${plainValue(x, aliases)}`);
  }
  out.push(`candidates: ${list(b.candidates)}`);
  if ((b.candidatesMore ?? 0) > 0) out.push(`+${String(b.candidatesMore)} more candidates, not shown`);
  out.push(`felt (of ${String(b.feltOf)}): ${list(b.felt)}`);
  out.push(`recent: ${list(b.recent)}`);
  out.push(`becameCore: ${list(b.becameCore)}`);
  out.push(`reconsidering: ${b.reconsidering.length === 0 ? "none" : b.reconsidering.map((r) => `(${plainValue(r, aliases)})`).join(" ")}`);
  out.push(`feelingWeeks: ${b.feelingWeeks === null ? "none" : plainValue(b.feelingWeeks, aliases)}`);
  out.push(`unmarked: ${list(b.unmarked)}`);
  out.push("## staleOpen");
  if (b.staleOpen.length === 0) out.push("none");
  for (const x of b.staleOpen) out.push(`- ${s(x.id)} · untouched ${String(x.untouched)}${x.reopened === true ? " · reopened" : ""} · ${x.text}${x.settlesWhen === undefined ? "" : ` · settlesWhen: ${x.settlesWhen}`}`);
  // Open items that name what would settle them (S1, 2026-10-27); no heading when none.
  if ((b.settlesOpen ?? []).length > 0) {
    out.push("## settlesOpen");
    for (const x of b.settlesOpen ?? []) out.push(`- ${s(x.id)} · untouched ${String(x.untouched)}${x.reopened === true ? " · reopened" : ""} · ${x.text} · settlesWhen: ${x.settlesWhen}`);
  }
  if (b.noLongerCarried !== undefined) out.push(`noLongerCarried: ${String(b.noLongerCarried)}`);
  if (b.beliefs !== undefined && b.beliefs !== null) {
    out.push(`## beliefs (births ${String(b.beliefs.births)})`);
    for (const sub of b.beliefs.subjects) {
      out.push(`- ${sub.id} · ${sub.name} · ${sub.kind}${sub.more > 0 ? ` · ${String(sub.more)} more` : ""}`);
      for (const x of sub.beliefs) out.push(`  - ${plainValue(x, aliases)}`);
    }
    if (b.beliefs.candidates !== undefined) for (const c of b.beliefs.candidates) out.push(`- candidate ${plainValue(c, aliases)}`);
  }
  out.push(...leanReflectBody(b.memories, b.chapters, b.dreamSaw, aliases, year, b.chaptersAs === "summaries", b.timeline));
  return out;
}

/**
 * THE IDS A LEAN REFLECTION NUMBERS, after its dream's: what the dream saw
 * and made, then the memories, then the journals.
 */
export function reflectBundleIds(b: ReflectBundle): string[] {
  return [
    ...b.dreamSaw.map((x) => x.id),
    ...(b.dreamed?.gists ?? []),
    ...Object.keys(b.memories),
    // Named outside `memories`: the open threads offered to close, and what a dream's belief candidate cites.
    ...b.staleOpen.map((x) => x.id),
    ...(b.settlesOpen ?? []).map((x) => x.id),
    ...(b.beliefs?.candidates ?? []).flatMap((c) => c.sources),
    ...b.chapters.map((c) => c.id),
  ];
}

/** Slack for the result's other fields (phase, session, ids, parts) beside the three measured. */
const PACK_MARGIN = 1_000;
/** A later part's own furniture: its opener, ids and `next`, re-escaped. */
const PART_FURNITURE = 1_000;

/**
 * THE SIZE OF A BEGIN RESULT AS IT LEAVES: the MCP text is the result's JSON,
 * pretty-printed, with the bundle text escaped inside it, `how` and the
 * questions beside it (the MCP adapter's `reflect` tool).
 */
export function resultChars(text: string, how: string, questions: readonly string[]): number {
  return wireChars(JSON.stringify({ bundle: text, how, questions }, null, 2));
}

/** A later part of a bundle, by id: its memories, chapters and lines of what the dream saw. */
interface LaterPart {
  readonly m: string[];
  readonly c: string[];
  readonly s: string[];
}

function firstLine(text: string): string {
  return (text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").slice(0, 120);
}

/** A journal chapter's memory copy (`meta.episodeId`): never work, never offered to be marked. */
function isJournalCopy(row: MemoryRow): boolean {
  try {
    const meta = JSON.parse(row.meta) as Record<string, unknown>;
    return typeof meta["episodeId"] === "string";
  } catch {
    return false;
  }
}

/**
 * THE UNMARKED OFFER'S MOST, PAST THE ROOM (review of #619, D1): `UNMARKED`
 * lines at their longest — the fit's `OVERHEAD` each, and a `LINE_BYTES` line
 * at its widest on the wire (`wireChars` counts a non-ASCII UTF-16 unit as
 * three, so a 200-byte line costs at most 300). Read at use. With the
 * defaults: 24 × (120 + 300) = 10,080 characters.
 */
export function unmarkedOfferCap(): number {
  const T = REFLECT_TUNABLES;
  return Math.max(0, Math.floor(T.UNMARKED)) * (FIT_TUNABLES.OVERHEAD + Math.ceil(T.LINE_BYTES * 1.5));
}

/**
 * Is the folder a memory was written in on (review of #558)? One with no
 * origin is not asked; the host's answer throwing counts as no.
 */
function folderIsOn(scope: string | null, folderOn: ((scope: string) => boolean) | undefined): boolean {
  if (folderOn === undefined || scope === null || scope.trim().length === 0) return true;
  try {
    return folderOn(scope) === true;
  } catch {
    return false;
  }
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

function errName(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code);
  return err instanceof Error ? err.name : "UNKNOWN";
}
