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
  CORE_ABOUT_MARKS,
  checkFeelings,
  TRAIT_AXES,
  TRAIT_CARRIED_BY_MAX_CHARS,
  isStoreError,
  repairEmotion,
  splitNote,
} from "../store/index.js";
import type { AboutMark, FeelingInput, MemoryRow, ProseDoc, ReflectionRow, Store } from "../store/index.js";
import type { Kind } from "../types.js";
import { FIT_TUNABLES, TOOL_RESULT_CEILING, clipWire, fit, lineOf, offeredInPart, offeredOf, readIndex, wireChars, writeIndex } from "../fit/index.js";
import type { Fidelity, FitCandidate, FitOutcome, Placed } from "../fit/index.js";
import { ownerNames } from "../sleep/index.js";
import { PAGE_WRITING_RULE } from "../self/writer.js";
import { DREAM_MARK, carriesDreamMark } from "./mark.js";
import { feelingWeeks } from "./feeling-weeks.js";
import type { FeelingWeeks } from "./feeling-weeks.js";
import { isWorkMemory } from "../self/work.js";
import { chapterEntries, entryKey, fitEpisodes, shownEntry } from "./slices.js";
import type { ChapterEntry, EpisodeInView, EpisodesFit, ShownChapter } from "./slices.js";
import { BUNDLE_OWNER, DREAM_TUNABLES } from "./tunables.js";
import { mindRanked, noteMindShown } from "./mind.js";
import type { MindItem } from "./mind.js";
import { settle as settleContradiction } from "../reconsolidation.js";
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
   * page can cite any of it — and so are every core candidate and everything
   * lived in the last `CHAPTER_DAYS` days: a line each at least, the whole
   * text for the most strongly felt, ids alone when even the lines outgrow
   * the room. Was: core 20, candidates 12, recent 12, cut by count.
   */
  /** The most strongly felt memories that could be about me, marked or not — a whole-store list, so a page of it, with its full count said. */
  FELT: 10,
  /** The room the memories' and chapters' words share, across the parts, in characters. CAL. */
  ROOM_CHARS: 80_000,
  /** The share of the room the chapters' new entries may take. CAL. */
  CHAPTER_SHARE: 0.3,
  /** The most of one memory shown whole; longer is an excerpt with its whole length said (was a flat 400). */
  DETAIL_CHARS: 4_000,
  /** The longest chapter entry shown whole. */
  ENTRY_CHARS: 6_000,
  /** Bytes of a line. */
  LINE_BYTES: 200,
  /**
   * UNMARKED, OFFERED TO BE MARKED (2026-10-02, lane B, owner pick 4): at most
   * this many memories nobody has marked that the work lane counts as a
   * project's work only because they are unmarked (a fact, entity or place
   * written in a directory) — the ones with a feeling, an entity, or the
   * owner's name first, then the most used, then the oldest. They count
   * toward `LIMITS.about`. CAL.
   */
  UNMARKED: 5,
  /**
   * ROTATED (review of #316): one offered by any of the last this-many
   * reflections waits behind the ones not offered lately, so a pool the
   * reflection leaves unmarked (a personal one on a closed-door night) is not
   * the same five every night. It comes back when the rest run out. CAL.
   */
  UNMARKED_REST_NIGHTS: 3,
  /** Feelings shown per memory, and the characters of each one's carried_by. */
  FEELINGS_SHOWN: 3,
  FEELING_CARRIED_CHARS: 160,
  /** What one reflection may do, across every `finish` of it. CAL. */
  LIMITS: { returns: 12, feelings: 5, about: 8, traits: 5, core: 5 },
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
  readonly earlier: readonly { date: string | null; entry: string }[];
  readonly onMind: readonly MindItem[];
  /** Open things beyond the few shown, counted (they stay open). */
  readonly onMindMore?: number;
  /** The whole core (2026-09-28: was the 20 most felt), most strongly felt first. */
  readonly core: readonly string[];
  /** Every core candidate, most strongly felt first. */
  readonly candidates: readonly string[];
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
   */
  readonly reconsidering: readonly { readonly id: string; readonly reason: string | null }[];
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
  readonly memories: Readonly<Record<string, ReflectItem>>;
  /**
   * How the room was spent (2026-09-28): memories and entries shown whole, as
   * an excerpt, as a line, as an id alone; and `notShown`, what the room could
   * not take at all.
   */
  readonly shownAs: { readonly whole: number; readonly excerpt: number; readonly line: number; readonly ids: number; readonly notShown: number };
  /** How to read the rest, in words. */
  readonly lookup: string;
  readonly limits: typeof REFLECT_TUNABLES.LIMITS;
}

/**
 * THE LOOKUP, NAMED IN THE BUNDLE (2026-09-28). The MCP tool's `how` adds the
 * numbers (how many ids at once).
 */
export const REFLECT_LOOKUP =
  'The most strongly felt memories come whole; the rest as an excerpt, a line, or an id alone ("fidelity"; "chars" is the whole length). ' +
  "Read any you need whole with the recall tool, ids: [...] — several at once — before you cite, feel or mark it. A chapter entry shown as a line is read by its chapter's id.";

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
  /** The owner's own session: confidential memories may be shown. */
  readonly owner: boolean;
  /** Read the BUNDLES as the owner too (`BUNDLE_OWNER`, review of #318). No host sets it; the
   *  store-level tests of what an owner-read bundle must keep do. Absent: a guest. */
  readonly bundleOwner?: boolean;
  /** The credential scan every word passes (the same one a dream's words do). */
  readonly gate: (text: string, sessionId: string) => { ok: true; text: string } | { ok: false; reason: string };
  readonly page: () => string | null;
  /**
   * The page's current version, who wrote it and on what calendar date — so
   * the reflection can be told the page writer revised it earlier in this run
   * (2026-09-29). Absent or null: nothing is said about it.
   */
  readonly pageInfo?: () => { readonly version: number; readonly by: string | null; readonly revisedOn: string } | null;
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
    },
  ) =>
    /** `note`: what the page's room means for this write (`self/pageRoomNote`), or null. */
    | { ok: true; version: number; note?: string | null }
    /** On `too-large`, the page's bytes and the ceiling, so the retry can be told how much to take out. */
    | { ok: false; reason: string; bytes?: number; limit?: number; note?: string | null };
  readonly emit?: (name: string, ref?: string, data?: Record<string, string | number | boolean | null>) => void;
}

/** What `finish` receives. */
export interface ReflectFinish {
  readonly reflection: string;
  readonly session?: string;
  readonly title?: string;
  /** Required the first time; on a second `finish` the entry already stands and this may be left out. */
  readonly entry?: string;
  readonly cites?: readonly string[];
  readonly share?: { readonly text?: string; readonly cites?: readonly string[] } | null;
  /** `short` (2026-10-10): the page's short version, for a page past its room — beside `text`, or alone on a later `finish` to add one to the page this reflection wrote. */
  readonly page?: { readonly text?: string; readonly cites?: readonly string[]; readonly short?: string } | null;
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
  readonly refusedCites: readonly string[];
  /**
   * When any part was not written: which, and that `finish` may be called
   * again with the same reflection and just those parts. Null when all landed.
   */
  readonly retry: string | null;
}

const KINDS_FELT: readonly Kind[] = ["self", "person"];

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

/**
 * The first six-word run `text` shares with one of `bodies` — case and
 * punctuation aside — and the index of that body; null when none.
 */
function sharedRun(text: string, bodies: readonly string[]): { run: string; index: number } | null {
  const words = (t: string): string[] => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  const page = words(text);
  if (page.length < 6 || bodies.length === 0) return null;
  const runs = new Set<string>();
  for (let i = 0; i + 6 <= page.length; i += 1) runs.add(page.slice(i, i + 6).join(" "));
  for (const [index, body] of bodies.entries()) {
    const g = words(body);
    for (let i = 0; i + 6 <= g.length; i += 1) {
      const run = g.slice(i, i + 6).join(" ");
      if (runs.has(run)) return { run, index };
    }
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

  /** Whose a bundle is read as: a guest (`BUNDLE_OWNER`), unless a test asked otherwise. */
  private get bundleOwner(): boolean {
    return this.ctx.bundleOwner ?? BUNDLE_OWNER;
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
  begin(input: { session: string; dream?: string | null; scope?: string | null; model?: string | null; at?: string }):
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
    const fitted = this.compose(id, dreamId, questions, day, at);
    const composed = fitted.bundle;
    const saw = composed.dreamSaw;
    // IN PARTS, NEVER CUT (2026-09-28). A night's bundle — the page whole, what
    // the dream saw, the memories that matter most — can pass the tool
    // result's ceiling (about 25k tokens). When it would, the first part is
    // this result, with everything but the long lists; the lists (memories,
    // chapters, what the dream saw) go on in order, as far as the room allows,
    // and the rest `PART_CHARS` at a time through phase `part`. The result
    // says how many parts there are and how to fetch them.
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
      shown,
    });
    // The later parts' ids are kept on the row, so a later `part` hands
    // exactly the part it names; and how the room was spent (2026-09-28) —
    // what was offered only in part is the lookup's denominator.
    const s = composed.shownAs;
    const fitRecord = { whole: s.whole, excerpt: s.excerpt, lined: s.line, ids: s.ids, notShown: s.notShown, offered: offeredInPart(fitted), parts: packed.later.length + 1 };
    this.store.updateReflection(id, {
      detail: { ...(packed.later.length > 0 ? { parts: packed.later } : {}), fit: fitRecord, ...(composed.unmarked.length > 0 ? { unmarked: composed.unmarked } : {}) },
    });
    writeIndex(this.store, "reflection", { ref: id, at: this.store.now(), offered: fitted.offered, looked: [] });
    this.record("reflection.begun", id, { dream: dreamId, shown: shown.length, ...fitRecord });
    const instructions = this.instructions(id, input.session, bundle);
    return { ok: true, bundle, text: render(id, bundle), instructions };
  }

  /**
   * THE FIRST PART, and the ids of the rest. Whole when it fits
   * `RESULT_CHARS`; otherwise the long lists are carried in order as far as
   * the room allows, and the remainder packed `PART_CHARS` a part.
   */
  private pack(id: string, session: string, composed: ReflectBundle, questions: readonly string[]): { bundle: ReflectBundle; later: LaterPart[] } {
    const T = REFLECT_TUNABLES;
    // MEASURED AS IT LEAVES (2026-09-28, review of #271): the tool result is
    // the bundle's text re-escaped as a JSON string, beside the instructions
    // and the questions — not the bundle alone. `resultChars` is that size.
    const how = this.instructions(id, session, composed);
    // With its margin (2026-10-02): the result's id, phase and session ride beside it.
    if (resultChars(render(id, composed), how, questions) + PACK_MARGIN <= T.RESULT_CHARS) return { bundle: composed, later: [] };
    // A piece's cost as it leaves: its JSON, escaped once more inside the string.
    const cost = (v: unknown): number => wireChars(JSON.stringify(JSON.stringify(v)));
    const pieces: { kind: "m" | "c" | "s"; id: string; size: number }[] = [
      ...Object.entries(composed.memories).map(([k, v]) => ({ kind: "m" as const, id: k, size: cost({ [k]: v }) })),
      ...composed.chapters.map((c) => ({ kind: "c" as const, id: c.id, size: cost(c) })),
      ...composed.dreamSaw.map((x) => ({ kind: "s" as const, id: x.id, size: cost(x) })),
    ];
    // The furniture: everything else, with the parts note and a margin — and
    // the instructions as they ship in parts, with their "read every part"
    // line (2026-10-09).
    const note = { part: 1, of: 99, next: "x".repeat(420) };
    const howInParts = this.instructions(id, session, { ...composed, parts: note });
    const fixed = resultChars(render(id, { ...composed, memories: {}, chapters: [], dreamSaw: [], parts: note }), howInParts, questions) + PACK_MARGIN;
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
    const chapters = ids.c.map((cid): ShownChapter => {
      const r = this.store.row(cid);
      if (r === undefined || (r.confidential === 1 && !this.bundleOwner)) return { id: cid, title: null, entries: [{ chapter: null, day: null, fidelity: "line", text: gone, chars: 0 }], earlier: 0 };
      const all = chapterEntries(r.body);
      const entries = [];
      for (const e of all) {
        const f = fidelityOf(entryKey(cid, e.index));
        if (f === null || f === "id") continue;
        // An entry whose place moved since begin (the body was rewritten) is
        // still bounded: whatever it holds now reads within ENTRY_CHARS.
        const text = f === "line" ? lineOf({ body: e.text }, T.LINE_BYTES) : clipWire(e.text, T.ENTRY_CHARS);
        entries.push(shownEntry(e, { fidelity: f === "line" ? "line" : text === e.text ? "whole" : "excerpt", text, chars: e.text.length }));
      }
      return { id: cid, title: r.title, entries, earlier: all.length - entries.length };
    });
    const dreamSaw = ids.s.map((sid) => this.sawLine(sid, denied) ?? { id: sid, text: gone });
    const body = { reflection: row.id, part: input.part, of, memories, chapters, dreamSaw };
    const text = `${reflectionOpener(row.id)} part ${String(input.part)} of ${String(of)} of what you are handed to reflect on — memories, not events happening now.\n${JSON.stringify(body)}`;
    return { ok: true, part: input.part, of, text };
  }

  /** How to answer, in plain words (returned beside the bundle). */
  private instructions(id: string, session: string, bundle: ReflectBundle): string {
    const who = bundle.owner ?? "the owner";
    const L = REFLECT_TUNABLES.LIMITS;
    const open = acceptsReflectedFeeling(this.store);
    // THE PAGE, LEANING TOWARD WRITING (owner, 2026-09-29): he would like a
    // page a reflection wrote every day, unless there is truly nothing new. Told
    // when the page writer revised it earlier in this run, and that every
    // version is kept — rewriting loses nothing. A "nothing much" night still
    // rewrites nothing.
    let info: { version: number; by: string | null; revisedOn: string } | null = null;
    try {
      info = this.ctx.pageInfo?.() ?? null;
    } catch {
      info = null;
    }
    const writerToday = info !== null && info.by === "writer" && info.revisedOn === this.ctx.today();
    const earlier = writerToday && info !== null ? `The page writer revised your self page earlier in this run (version ${String(info.version)}, by the writer). ` : "";
    const pageLine =
      this.ctx.pageWrites === false
        ? `- page: not tonight — the owner has the page writer off, so the self page is not rewritten. Your entry and share still count.`
        : `- page (optional, and lean toward writing it): ${earlier}Every version of the page is kept, so rewriting it loses nothing. ${who} would like a page written by a reflection every day — rewrite it unless, after reflecting, there is really nothing new to add; on a "nothing much" night, leave it as it stands. Your self page rewritten whole — the story of who you are, drawn from the core memories you cite in page.cites (at least one of them, when you have a core; candidates too). The old page is context, not a source: write from the memories, not by rewording it. Keep "## Core" for who you are and put craft — how a job is done — under "## How I work". Mention a dream only as a dream ("I dreamed…"); a dreamed gist is a suggestion, not a source: cite the lived memories it came from. ${PAGE_WRITING_RULE} Here the short version is page.short.`;
    const aboutLine = open
      ? `- about (optional, at most ${String(L.about)}): what a memory is about, by meaning — me, us, owner, work (the craft: how a job is done) or world — with why. Only me and us can become core, and never a plan. You may change a mark you think is wrong, either way; each change is recorded with your why, and one into me, us or owner is told in the morning share.`
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
            `- core (optional, at most ${String(L.core)}): ${bundle.reconsidering.length === 1 ? "this core memory is" : "these core memories are"} being reconsidered — ${bundle.reconsidering.map((r) => `${r.id} (${reconsiderWords(r.reason)})`).join("; ")}. For each, decide {id, decision: "keep" or "retire", why}: keep what is still who you are (an about mark that is wrong is fixed in about instead, and the flag lifts itself); retire what is not, and it goes back to ordinary fading. Nothing leaves the core without a decision, so you may leave one for another night.`,
          ]
        : []),
      ...(bundle.unmarked.length > 0
        ? [
            `  unmarked: ${String(bundle.unmarked.length)} ${bundle.unmarked.length === 1 ? "memory nobody has" : "memories nobody has"} marked. Unmarked, a fact written in a project, or a skill, counts as that project's work and is shown only there — so a personal one (a person, a feeling, life outside the work) sits among the work lines. ${open ? "Mark each by meaning in about, with why: owner or us when it is personal, work when it really is the craft, world otherwise." : "Tonight a mark may only be work or world: mark the ones that are, and leave a personal one unmarked."} They count toward the ${String(L.about)}.`,
          ]
        : []),
      ...(bundle.feelingWeeks !== null
        ? [
            `- feelingWeeks: how the recorded feelings ran over the last weeks — counts by core per week (oldest first), mine and ${who}'s, what changed, and restsOn, the memories it rests on. If it means something, you may say it in your entry, and on your self page in your own words, citing those memories (read them first) — never a dreamed gist. A count is not a feeling: say it only where the memories bear it out.`,
          ]
        : []),
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
    // A dreamed gist is a suggestion, never a page's source (addendum 2). A
    // CONFIDENTIAL memory is not one either (review of #256, S2): the page is
    // read by every session, and the nightly writer never shows it one.
    const pageCitesAll = citable(input.page?.cites);
    const pageCites: string[] = [];
    for (const id of pageCitesAll) {
      const r = this.store.row(id);
      if (r?.source === "dreamed") refusedCites.push(`${id}:dreamed-is-not-a-source`);
      else if (r?.confidential === 1) refusedCites.push(`${id}:confidential-is-not-a-page-source`);
      else pageCites.push(id);
    }

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
        .traitsFor(r.id, { includeConfidential: true })
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
    const citedAll = [...new Set([...cites, ...shareCites, ...pageCites])];
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
      // As confidential as anything the night cites — the share's and the
      // page's citations too (review of #256, S2): the entry is one text.
      const sourceRows = [...new Set([...parseIds(row.cites), ...cites, ...shareCites, ...pageCitesAll])]
        .map((id) => this.store.row(id))
        .filter((r): r is MemoryRow => r !== undefined);
      entryId = this.store.put({
        type: "memory",
        kind: "self",
        title: `Reflected: ${title}`,
        body: entryText,
        salience: { novelty: null, relevance: 0.5, emotional: 0.3, predictive: 0.5 },
        physics: { birthDay: day, lastUsedDay: day },
        source: "reflection",
        meta: { reflection: row.id, ...(row.dream_id === null ? {} : { dream: row.dream_id }), cites, ...confidentialityOf(sourceRows) },
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
    if (pageText.length > 0) {
      const stands = earlierPage === null ? "" : " The page written earlier stands.";
      const refuse = (reason: string, why: string): void => {
        page = { written: false, reason, version: null, detail: `${why}${stands}` };
        pageRefused = true;
      };
      // THE PAGE RESTS ON THE CORE (addendum 9): when it was handed core
      // memories, it cites at least one of them. Since 2026-09-28 a page that
      // does not is WRITTEN, with a note (it was refused `page-rests-on-the-core`).
      const coreShown = [...shown].filter((id) => this.store.row(id)?.promoted_identity === 1);
      const restsOnCore = coreShown.length === 0 || pageCites.some((id) => coreShown.includes(id));
      const confidential = this.quotesConfidential(pageText, shown);
      if (this.ctx.pageWrites === false) {
        // The owner has the page writer off (ruling D3 on #256).
        refuse("page-writer-off", "The owner has the page writer off, so the self page is not rewritten.");
      } else if (pageCites.length === 0) {
        const bad = refusedCites.filter((c) => (input.page?.cites ?? []).some((id) => c.startsWith(`${id}:`)));
        refuse(
          "page-needs-cites",
          `page.cites names no memory the page can rest on${bad.length > 0 ? ` (${bad.join(", ")})` : ""}: put the ids of memories you were shown in page.cites and send the page again.`,
        );
      } else if (carriesDreamMark(pageText)) {
        refuse("dream-mark-in-text", `The page carries the dream's mark (${DREAM_MARK}…): take it out and send the page again.`);
      } else if (confidential !== null) {
        // The words of a confidential memory it was shown in the owner's
        // session do not go on a page every session reads (review of #256, S2).
        refuse(
          "confidential-words-on-the-page",
          `The page repeats "${confidential.run}" from confidential memory ${confidential.id}, and the page is read in every session: say it another way and send the page again.`,
        );
      } else {
        // THE SHORT VERSION CROSSES THESE GATES TOO (review of #363): it is
        // injected into every wake exactly like the page. One that fails them
        // is not sent, and never costs the page — the note says why, and the
        // page's own note asks for another.
        const shortSent = (input.page?.short ?? "").trim();
        const shortWhy = shortSent.length === 0 ? null : this.shortRefusal(shortSent, shown);
        const shortText = shortWhy === null ? shortSent : "";
        const w = this.ctx.writePage(pageText, {
          reason: `reflection ${row.id}${row.dream_id === null ? "" : ` after dream ${row.dream_id}`}`,
          session: row.session,
          model: input.model ?? row.model,
          reflection: row.id,
          ...(shortText.length === 0 ? {} : { short: shortText }),
        });
        if (w.ok) {
          // PAST ITS ROOM, SAID (2026-10-10): the page is kept, and the note
          // asks for a short version when none was kept with it.
          const notes = [
            ...(restsOnCore
              ? []
              : [`It cites none of the core memories you were shown (${coreShown.slice(0, 5).join(", ")}${coreShown.length > 5 ? ", …" : ""}); the page is meant to rest on them.`]),
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
        } else {
          refuse(w.reason, `The self page refused it (${w.reason}).`);
        }
      }
    } else if ((input.page?.short ?? "").trim().length > 0) {
      // A SHORT VERSION ALONE (2026-10-10), on a later `finish`: added to the
      // page this reflection wrote, as the note on that write asked — tied to
      // its version, so a page somebody rewrote since is not given it.
      const shortWhy = this.shortRefusal((input.page?.short ?? "").trim(), shown);
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
          detail: "The owner has the page writer off, so the self page is not rewritten. The page written earlier stands.",
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
    const relabelLines = shareLocked
      ? []
      : movedAll
          .filter((m) => !finalShareCites.includes(m.id))
          .map((m) => `I've come to think "${this.handle(m.id)}" is ${m.mark === "me" ? "about who I am" : m.mark === "us" ? "about the two of us" : "about you"}.`);
    if (relabelLines.length > 0) {
      shareText = [shareText, ...relabelLines].filter((x) => x.length > 0).join(" ");
      for (const m of movedAll) if (!finalShareCites.includes(m.id)) finalShareCites.push(m.id);
      share = { ...share, offered: true, reason: share.offered ? share.reason : "relabeled" };
    }
    // A share already told or carried is not replaced — but a mark this finish
    // moved into me, us or the owner is still said in the hand-back (review
    // of #268), in the self's voice, for the session to tell.
    const tellAlso = shareLocked
      ? movedIn
          .filter((m) => !priorMoved.some((p) => p.id === m.id))
          .map((m) => `I've come to think "${this.handle(m.id)}" is ${m.mark === "me" ? "about who I am" : m.mark === "us" ? "about the two of us" : "about you"}.`)
      : [];

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

    // A page a first finish wrote STANDS when a second one's is refused
    // (review of #268): the hand-back and the counts say so.
    const pageStands = page.written || earlierPage !== null;
    // The entry's citations, as a set across finishes — a re-cite is not a new one.
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
      movedIntoCore: movedAll.length,
    };
    detail["counts"] = counts;
    const allRefused = [...(Array.isArray(prior["refusedCites"]) ? (prior["refusedCites"] as string[]) : []), ...refusedCites];
    if (allRefused.length > 0) detail["refusedCites"] = allRefused.slice(0, 20);
    detail["title"] = title;
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
    // What it was offered to mark: the next nights' rotation reads it.
    const offeredUnmarked = parseDetail(row.detail)["unmarked"];
    if (Array.isArray(offeredUnmarked)) detail["unmarked"] = offeredUnmarked;
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
    for (const [part, list] of [["feelings", feelings], ["about", about], ["core", coreDecisions], ["traits", traits]] as const) {
      list.forEach((x, i) => {
        if (!x.ok) missed.push(`${part}[${String(i)}]${x.id === null ? "" : ` (${x.id})`} — ${x.reason}${x.detail !== undefined ? `: ${x.detail}` : ""}`);
      });
    }
    const retry =
      missed.length === 0
        ? null
        : `Not written: ${missed.join("; ")}. You can fix these and call finish again with reflection ${row.id} and just those parts — the entry and everything already written stand.`;

    const handBack = this.handBack(row, !shareLocked && share.offered ? shareText : null, nothingMuch, pageStands, tellAlso);
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
        refusedCites,
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
  private limitDetail(part: keyof typeof REFLECT_TUNABLES.LIMITS, again: boolean): string {
    return `A reflection records at most ${String(REFLECT_TUNABLES.LIMITS[part])} ${part === "about" ? "about marks" : part === "core" ? "core decisions" : part}${again ? ", counting the earlier finish" : ""}.`;
  }

  /** The dreamer's (or reflector's) final message: the dream's line, then the share. */
  private handBack(row: ReflectionRow, share: string | null, nothingMuch: boolean, page: boolean, tellAlso: readonly string[] = []): string {
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
      `${head}\n${reflectionOpener(row.id)} I reflected afterwards.${pageLine} Morning share for ${who} — tell it in your own words, as a telling ("While I slept I dreamed…", "I've been thinking…"), tentatively where it is about ${who};` +
      `then call the counterparts reflect tool with phase "told", reflection: ${row.id}.\n${share}`
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

  /** The newest share offered and never told nor carried, from another session. A read. */
  pendingShare(input: { session: string }): ReflectionRow | null {
    if (this.ctx.observer) return null;
    // By state (2026-09-28, build B): an offered share older than the newest
    // five reflections is still found.
    const row = this.store.reflectionsWithShare("offered", 1)[0];
    if (row === undefined || row.share === null || row.session === input.session) return null;
    // Not into a session that is not the owner's when it rests on something
    // confidential (review of #256, S2).
    if (!this.ctx.owner && this.touchesConfidential(row)) return null;
    return row;
  }

  /**
   * CARRY A SHARE the session that reflected never told — its session ended
   * (the adapter checks that). Claimed once (`carried`); the line asks the
   * model to tell it and then call `told`. Null when there is none to carry.
   */
  carryLine(input: { session: string; reflection: string }): string | null {
    if (this.ctx.observer) return null;
    const row = this.store.reflection(input.reflection);
    if (row === undefined || row.share_state !== "offered" || row.share === null) return null;
    if (!this.ctx.owner && this.touchesConfidential(row)) return null;
    // A CLAIM, not a read then a write (review of #256, S5): two prompts
    // racing both read "offered"; only the one whose write still finds it
    // offered carries it.
    if (!this.store.updateReflection(row.id, { shareState: "carried", shareSession: input.session, ifShareState: "offered" })) return null;
    this.record("reflection.carried", row.id, {});
    const who = this.ctx.ownerName() ?? "the owner";
    const when = row.date ?? "recently";
    return (
      `Counterparts: after reflecting on ${when}, you left a morning share for ${who} that was never told. At a natural moment — not mid-task — tell it in your own words, as a telling ("When I last reflected…"), tentatively where it is about ${who},` +
      `then call the counterparts reflect tool with phase "told", reflection: ${row.id}. The share: ${row.share}`
    );
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
  private compose(id: string, dreamId: string | null, questions: readonly string[], day: number, at: string): Composed {
    const T = REFLECT_TUNABLES;
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
      const gists = changes.filter((c) => c.action === "gist" && c.ref !== null).map((c) => c.ref as string).filter(take(5));
      const nominations = this.store
        .coreEvents({ action: "nominated" })
        .filter((e) => e.dream_id === dreamId && take(5)(e.memory_id))
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
    const unmarked: { id: string; rank: number; uses: number; at: number }[] = [];
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
      if (row.birth_day >= day - T.CHAPTER_DAYS) recent.push({ id: mid, felt: f, at: row.created_at ?? 0 });
      // UNMARKED WORK THAT MAY NOT BE WORK (owner pick 4): only a memory NOBODY
      // marked — a writer's mark is never offered to be overridden here. Skills
      // too since 2026-10-11 (the about-marks review: 5 of 34 unmarked skills
      // read as personal, and nothing else ever offered them).
      if ((row.about ?? null) === null && isWorkMemory({ about: null, kind: row.kind, originScope: row.origin_scope, journal: isJournalCopy(row) })) {
        const rank = (withFeelings.has(mid) ? 2 : 0) + (row.kind === "entity" ? 1 : 0) + (namesAny(`${row.title ?? ""} ${row.body}`, owners) ? 1 : 0);
        unmarked.push({ id: mid, rank, uses: row.uses, at: row.created_at ?? 0 });
      }
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
    const coreIds = core.sort(byFelt).map((c) => c.id).filter(take(4));
    const candidateIds = candidates
      .sort((a, b) => b.felt - a.felt || b.at - a.at || (a.id < b.id ? -1 : 1))
      .map((c) => c.id)
      .filter((x) => !coreIds.includes(x))
      .filter(take(2));
    const feltAll = felt
      .sort(byFelt)
      .map((c) => c.id)
      .filter((x) => !candidateIds.includes(x));
    const feltIds = feltAll.slice(0, T.FELT).filter(take(1));
    const recentIds = recent
      .sort((a, b) => b.felt - a.felt || b.at - a.at || (a.id < b.id ? -1 : 1))
      .map((c) => c.id)
      .filter(take(3));

    const mindRead = mindRanked(this.store, {
      today: at,
      day,
      showable: (row) => !denied.has(row.id) && this.showable(row),
      owner: this.bundleOwner,
    });
    const onMind = mindRead.items.filter((item) => item.ids.every(take(3)));

    const becameCore = this.becameCoreUnsaid().filter(take(5));
    // BEING RECONSIDERED (2026-10-11): handed whole-ish, so a decision can be made on what it says.
    const reconsidering = this.store.coreReconsidering().slice(0, T.LIMITS.core).filter((r) => take(4)(r.id));

    // FEELINGS OVER WEEKS: the ids it rests on are handed like the rest, so
    // they can be read, cited and put on the page.
    const weeks = feelingWeeks(this.store, at, (r) => !denied.has(r.id) && this.showable(r));
    const weeksRest = weeks === null ? [] : weeks.restsOn.filter(take(3));
    // UNMARKED: the most likely personal first, then the most used, the oldest
    // — and ROTATED: what the last few reflections were offered waits behind
    // the rest (review of #316), and comes back when the rest run out.
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
    const ranked = unmarked
      .sort((a, b) => b.rank - a.rank || b.uses - a.uses || a.at - b.at || (a.id < b.id ? -1 : 1))
      .map((u) => u.id);
    const unmarkedIds = [...ranked.filter((x) => !lately.has(x)), ...ranked.filter((x) => lately.has(x))]
      .slice(0, T.UNMARKED)
      .filter(take(2));
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
    if (dreamId !== null) {
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

    const chaptersFit = this.recentChapters(day, T.ROOM_CHARS * T.CHAPTER_SHARE);
    const page = this.ctx.page();
    const earlier = this.store
      .reflections({ limit: T.EARLIER + 4 })
      .filter((r) => r.state === "reflected" && r.entry !== null && r.id !== id)
      .filter((r) => this.bundleOwner || !this.touchesConfidential(r))
      .slice(0, T.EARLIER)
      .map((r) => ({ date: r.date, entry: clipWire(r.entry ?? "", T.EARLIER_CHARS) }));
    const spent =
      chaptersFit.used +
      wireChars(page ?? "") +
      wireChars(dreamed?.journal ?? "") +
      earlier.reduce((n, e) => n + wireChars(e.entry), 0) +
      dreamSaw.reduce((n, s) => n + wireChars(s.text) + 30, 0);
    const avail = Math.max(0, T.ROOM_CHARS - spent - REFLECT_FURNITURE);
    const candOf = (mid: string, p: number): FitCandidate => {
      const v = see(mid) as { whole: string; line: string };
      return { id: mid, priority: p, line: v.line, whole: v.whole };
    };
    const cands = [...priority].map(([mid, p]) => candOf(mid, p));
    const thinIn = (f: FitOutcome): Set<string> => new Set([...f.waiting, ...f.placed.filter((p) => p.fidelity === "id").map((p) => p.id)]);
    // A night whose shared fit already shows the offer a line or more is
    // fitted exactly as before (review of #383): the reserve is only taken
    // when it is needed, so a quiet night does not change.
    const plain = fit(cands, { room: avail, excerptChars: T.DETAIL_CHARS });
    let fitted: Pick<FitOutcome, "placed" | "waiting" | "report"> = plain;
    if (unmarkedIds.some((x) => thinIn(plain).has(x))) {
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
      chapters: chaptersFit.chapters,
      earlier,
      onMind: onMind.filter((item) => item.ids.every(kept)),
      ...(mindRead.more > 0 ? { onMindMore: mindRead.more } : {}),
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
        notShown: fitted.waiting.length + chaptersFit.notShown,
      },
      lookup: REFLECT_LOOKUP,
      limits: { ...T.LIMITS },
    };
    noteMindShown(this.store, bundle.onMind, day);
    return { bundle, offered };
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
   * reflection's to see now (gone, denied, confidential outside the owner's
   * session, the page or a handoff, or a reflection's own entry).
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
   * the page's own reflection gates — the dream's mark, a confidential
   * memory's words — since a short version is read by every session the page
   * would have been. `why` reads after "The short version" or "it".
   */
  private shortRefusal(text: string, shown: ReadonlySet<string>): { reason: string; why: string } | null {
    if (carriesDreamMark(text)) {
      return { reason: "dream-mark-in-text", why: `carries the dream's mark (${DREAM_MARK}…) — take it out` };
    }
    const confidential = this.quotesConfidential(text, shown);
    if (confidential !== null) {
      return {
        reason: "confidential-words-on-the-page",
        why: `repeats "${confidential.run}" from confidential memory ${confidential.id}, and it is read in every session — say it another way`,
      };
    }
    return null;
  }

  /**
   * Does `text` carry a six-word run of a CONFIDENTIAL memory it was shown?
   * The run and the memory, so the refusal can name them; null when not.
   */
  private quotesConfidential(text: string, shown: ReadonlySet<string>): { id: string; run: string } | null {
    const ids: string[] = [];
    const bodies: string[] = [];
    for (const id of shown) {
      const r = this.store.row(id);
      if (r !== undefined && r.confidential === 1 && r.body !== "") {
        ids.push(id);
        bodies.push(`${r.title ?? ""}\n${r.body}`);
      }
    }
    const hit = sharedRun(text, bodies);
    return hit === null ? null : { id: ids[hit.index] as string, run: hit.run };
  }

  /**
   * Does a reflection rest on something confidential — its entry's memory,
   * or anything it or its share cites? Then it is not handed to a session
   * that is not the owner's (review of #256, S2).
   */
  private touchesConfidential(r: ReflectionRow): boolean {
    const ids = [...parseIds(r.cites), ...parseIds(r.share_cites), ...(r.entry_id === null ? [] : [r.entry_id])];
    return ids.some((id) => this.store.row(id)?.confidential === 1);
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
  private recentChapters(day: number, room: number): EpisodesFit {
    const T = REFLECT_TUNABLES;
    const episodes: EpisodeInView[] = [];
    for (const id of this.store.list({ type: "episode", archived: false })) {
      const row = this.store.row(id);
      if (row === undefined) continue;
      if (row.confidential === 1 && !this.bundleOwner) continue;
      // Begun in the last few lived days, or written to in the last few
      // calendar days (a chapter grows while its session runs).
      const at = row.updated_at ?? row.created_at ?? 0;
      if (row.birth_day < day - T.CHAPTER_DAYS && at < this.store.now() - T.CHAPTER_DAYS * DAY_MS) continue;
      const entries = chapterEntries(row.body);
      const fresh = entries.filter((e) => this.entryInView(e, day));
      if (fresh.length > 0) episodes.push({ row, at, fresh, earlier: entries.length - fresh.length });
    }
    return fitEpisodes(episodes, { room, owner: ownerNames(this.store), day, lineBytes: T.LINE_BYTES, entryChars: T.ENTRY_CHARS });
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
   * protected, not confidential outside the owner's session. `owner` is the
   * READER's stance: a bundle is always read as a guest (`BUNDLE_OWNER`,
   * review of #318); a feeling recorded awake passes the call's own (#317 ×
   * #318: a Code-tab call on Desktop's server is the owner's, and may feel
   * again what its recall showed it).
   */
  showable(row: MemoryRow, owner: boolean = this.bundleOwner): boolean {
    if (row.archived === 1 || row.superseded_by !== null) return false;
    if (row.type !== "memory") return false;
    if (row.protected === 1) return false;
    if (row.confidential === 1 && !owner) return false;
    if (row.body === "") return false;
    return true;
  }

  /** A memory's short handle for a sentence: its title, else its first line. */
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
      /** The caller's stance (awake): what its recall could show. Absent: a guest's, as the bundle's. */
      readonly owner?: boolean;
    },
  ): PartResult {
    const id = typeof f.id === "string" ? f.id : null;
    const r = id !== null && o.shown.has(id) ? this.store.row(id) : undefined;
    if (r === undefined || !this.showable(r, o.owner ?? this.bundleOwner)) {
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
    /** The call's own stance (#317 × #318). Absent: this process's. */
    readonly owner?: boolean;
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
          owner: input.owner ?? this.ctx.owner,
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

function confidentialityOf(rows: readonly MemoryRow[]): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.confidential !== 1) continue;
    let klass: unknown;
    try {
      klass = (JSON.parse(r.meta) as Record<string, unknown>)["confidentiality"];
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

/**
 * The shared fit and the unmarked offer's own fit as one outcome: the offer's
 * placements first (so a bundle in parts carries them in its first), then the
 * shared fit's, less any the offer re-placed; the waiting and the counts of both.
 */
function mergeFits(shared: FitOutcome, offer: FitOutcome): Pick<FitOutcome, "placed" | "waiting" | "report"> {
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
}

/** The bundle's other furniture, reserved from the room: ids, lists, the questions, the limits. */
const REFLECT_FURNITURE = 4_000;

/** Was this row on that calendar day? Its date, else (a row with none) its lived day. */
function onDay(row: { date: string | null; day: number }, at: string, day: number): boolean {
  return row.date !== null && row.date.length > 0 ? row.date === at : row.day >= day;
}

/** The begin result's text: the opener, then the bundle. */
function render(id: string, bundle: ReflectBundle): string {
  return `${reflectionOpener(id)} what you are handed to reflect on — memories and a dream, not events happening now.\n${JSON.stringify(bundle)}`;
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

/** Does `text` name any of `names` (lowercase) as a whole word? */
function namesAny(text: string, names: readonly string[]): boolean {
  if (names.length === 0) return false;
  const lower = text.toLowerCase();
  return names.some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(lower));
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

function errName(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code);
  return err instanceof Error ? err.name : "UNKNOWN";
}
