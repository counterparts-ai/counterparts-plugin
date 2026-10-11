/**
 * MEANING MODE — deliberate recall's second path (Release B, 2026-10-03).
 *
 * `recall` with `mode: "meaning"` answers "what has X been to me", "how have
 * things gone between us", "when was I uneasy": questions about a SUBJECT
 * over time, or a feeling, rather than a fact. Facts mode (`facts.ts`) finds
 * the memories that say something; this one ARRANGES what memory holds about
 * a subject so the reader can interpret it. Recall runs without a language
 * model, so the tool lays the material out and the counterpart writes "what
 * it adds up to" in its own reply, as today's reading (the design of
 * 2026-10-03, `~/counterparts-notes/2026-10-03-deliberate-recall-design.md`).
 *
 * **What an answer is**, in order:
 *
 *   1. A header: the subject, how many chapters and moments hold it, the page,
 *      the other subjects the question named (one line each, to ask for), and
 *      what makes the evidence thin when it is.
 *   2. The ARC: the chapters (`epi_…#N`, `self/chapter-address.ts`) that hold
 *      the subject, ranked by how much of it they hold and SHOWN IN TIME
 *      ORDER; under each, a line of what happened, the feelings recorded in
 *      it — whose they are, side by side, never merged — and two or three of
 *      its moments by id. A long arc keeps its start, its end and its turns;
 *      the stretches between fold to one line each. Moments a session wrote
 *      with no chapter — or under none of its chapters, when their moments
 *      are unknown or come after the last — are an entry per session,
 *      labelled which.
 *   3. Faded moments: a few title lines, labelled, after the arc.
 *   4. Earlier readings: dream gists and reflection entries that touched the
 *      subject, dated. The dream journal stays outside (dream CONTRACT).
 *   5. Still open with the subject: unresolved threads and dated reminders.
 *   6. Recurring: the subjects and feelings that come back across several
 *      chapters, side by side. Nothing names the pattern; the reader does.
 *
 * **The subject.** The question's names, read through the alias index
 * (`Schemas#subjectsIn`), reach their cards' memories (`memory_subjects`,
 * v12); the card the question is ABOUT is the arc — read off its grammar and
 * the order of its names, counts only breaking a tie (`subjectOf`, since
 * 2026-10-09; it was the card holding the most) — and the rest are
 * one-liners. The owner's "I" asked about ("what have you been like", in the
 * counterpart's voice) is his own card. A name asked about that has NO card
 * (2026-10-09) is never passed over in silence for another card: when every
 * card the question names sits in an aside ("what has Han been to Mike"),
 * the answer is the moments that mention it, as typed, and its first line
 * says so ("No card for Han yet; here is what mentions Han"); beside a card
 * asked about or named plainly, the card leads as before and the first line
 * says the name has none (`MeaningResult.noCard`). Naming no card, the
 * question's words and meaning answer it, as before. "us"
 * is the memories marked `about: us`. A question about feeling
 * (`recall/feeling-ask.ts#readFeelingAsk`, ranked) with no card is answered
 * by the stamps that match it — word, core, whose — and, when it names a
 * topic no card holds, by those of them the topic's words reach (none: all of
 * them, said so); with a card, it keeps the
 * chapters where the card's moments carry the feeling. Nothing named and no
 * feeling: the question's rarer words (BM25) and its meaning (the in-line
 * vector) find the moments, and the answer says no card named it.
 *
 * **What it never does.** It writes nothing (no physics, no memory, no host
 * state): a search credits nothing. Opening a moment by id, or quoting one
 * the caller was shown (`MeaningResult.shown`), is what credits. Confidential
 * material is left out of a non-owner's answer SILENTLY — not counted, not
 * hinted at (§9.1 G5's list rule). Corrected (archived), superseded and
 * removed memories are not moments. Ambient recall is untouched.
 *
 * **Reads, bounded.** Indexed reads only: `memoriesNaming`, `feelingsOn`,
 * `list` + `row`, `copiesOf`, `memoriesOfSession` for the chapters shown,
 * one prose read per subject memory (the `unresolved` flag). No scan of
 * every memory's prose.
 */
import type { Counterpart } from "../../core/counterpart.js";
import { nameRegex, wholeWordRegex } from "../../core/encode/words.js";
import { OTHER_EMOTION, wheelEntry } from "../../core/feelings-wheel.js";
import { wireChars } from "../../core/fit/index.js";
import { chaptersOf } from "../../core/handoff/last-here.js";
import { UNRESOLVED_META_KEY } from "../../core/mint.js";
import { softenedFeeling, strength } from "../../core/physics/index.js";
import type { MemoryPhysics } from "../../core/physics/index.js";
import { askedNames, feelingTokens, isFeelingFrameWord, readFeelingAsk, semanticTuning, stampCores } from "../../core/recall/index.js";
import type { FeelingWhose, SemanticSource } from "../../core/recall/index.js";
import { chapterAddress, chapterAt, chapterTimesOf, findIdentityCore, identityCoreName } from "../../core/self/index.js";
import type { ChapterTimes } from "../../core/self/index.js";
import { RECURRING_META, feelingValence, feltDay, tokenize } from "../../core/store/index.js";
import type { FeelingRow, MemoryRow } from "../../core/store/index.js";
import { calendarOverlaps, daysBetween, isDay, isRecurrence, localDate, occurrenceOnOrAfter, readableRecurrence } from "../../core/time.js";
import { RECALL_RESULT_CHARS, hasFaded } from "./deliberate.js";

// ── the numbers (working defaults, 2026-10-03; tune at the revisit) ──────────

/** Entries in the arc on one page. Past it, `page: 2`. */
export const MEANING_CHAPTERS_SHOWN = 8;
/** Moment ids under one chapter. */
export const MEANING_MOMENTS_PER_CHAPTER = 3;
/** Faded moments listed after the arc. */
export const MEANING_FADED_SHOWN = 4;
/** Earlier readings listed (the newest). */
export const MEANING_READINGS_SHOWN = 4;
/** Open items listed. */
export const MEANING_OPEN_SHOWN = 5;
/** Recurring subjects, and recurring feelings, listed (each). */
export const MEANING_PATTERNS_SHOWN = 4;
/** The meaning channel's reach on a question with no card: the nearest this many. */
export const MEANING_SEMANTIC_MAX = 100;
/** The words channel's reach on a question with no card. */
export const MEANING_WORDS_MAX = 200;
/** The rendered answer's room, in `wireChars`: the list budget every deliberate answer keeps. */
export const MEANING_RESULT_CHARS = RECALL_RESULT_CHARS;
/** A word held by more than this share of the indexed memories says nothing about a subject. */
const COMMON_SHARE = 0.25;
/** How long a chapter's line may be, before the fit trims it. */
const LINE_CHARS = 220;
/** How long a title line may be. */
const TITLE_CHARS = 90;

// ── the shapes ───────────────────────────────────────────────────────────────

/**
 * What the server holds that this path needs (`server.ts#recallTool`): the
 * brain, who is asking, whether it is the owner's session, and the question's
 * embedding — computed IN LINE by the caller (`deliberate.ts#embedQuestion`),
 * because this function is synchronous. Field names follow
 * `deliberate.ts#DeliberateOptions`.
 */
export interface MeaningContext {
  readonly counterpart: Counterpart;
  readonly sessionId: string;
  /** The owner's own session? Confidential material is left out otherwise, silently. */
  readonly owner: boolean;
  /** The question's embedding, or null / absent: the meaning channel is then off, and a no-card answer says so. */
  readonly vector?: readonly number[] | null;
  /** Why there is no vector, when there is none. Defaults to `embedder-off`. */
  readonly semantic?: SemanticSource;
  /** Whose "I" a question about feeling means: `self` (the default) for the counterpart's `recall`. */
  readonly asker?: FeelingWhose;
  /** The lived day, for a test; the store's own otherwise. */
  readonly day?: number;
}

/** What the arc is about. */
export type MeaningLens =
  | { readonly kind: "card"; readonly id: string; readonly name: string }
  | { readonly kind: "us"; readonly name: string }
  | { readonly kind: "feeling"; readonly name: string }
  | { readonly kind: "words"; readonly name: string };

export interface MeaningMoment {
  readonly id: string;
  readonly title: string;
  /** `YYYY-MM-DD`, local, when it was written. */
  readonly date: string;
}

export interface MeaningFeeling {
  readonly word: string;
  /** As recorded, 0..1. */
  readonly strength: number;
}

/** One entry of the arc: a chapter, or the moments of a session that wrote no chapter. */
export interface MeaningEntry {
  /** `epi_…#N` for a chapter; `session <id>` for a session's moments outside any chapter. */
  readonly address: string;
  readonly kind: "chapter" | "session";
  /**
   * A session entry whose session DID write chapters, these moments under
   * none of them: the chapters' moments are unknown (an episode from before
   * v12 whose versions are gone) or they were written after the last one (a
   * write-up). False for a session that wrote no chapter, and for a chapter.
   */
  readonly unplaced: boolean;
  /** The episode id, which opens the chapter's words; null for a session entry. */
  readonly episodeId: string | null;
  readonly chapter: number | null;
  readonly of: number | null;
  readonly title: string | null;
  /** `YYYY-MM-DD`, or null when nothing dates it. */
  readonly date: string | null;
  /** A line of what happened: the chapter's first sentence that names the subject, else its first. Empty for a session entry. */
  readonly line: string;
  /** How much of the subject it holds — what the ranking reads. */
  readonly hold: number;
  /** The subject's moments in it (not faded), and how many there are. */
  readonly moments: readonly MeaningMoment[];
  readonly momentCount: number;
  /** The feelings recorded in it, strongest first: the asker's, and the other's. Never merged. */
  readonly feelings: { readonly self: readonly MeaningFeeling[]; readonly owner: readonly MeaningFeeling[] };
  /** Where the feelings turn (valence flips from the entry before), or the first or last of a long arc. */
  readonly marks: readonly ("start" | "end" | "turn")[];
}

/** A stretch of the arc not shown on this page, folded to one line. */
export interface MeaningFold {
  readonly count: number;
  readonly from: string | null;
  readonly to: string | null;
}

export type MeaningArcLine = { readonly fold: false; readonly entry: MeaningEntry } | ({ readonly fold: true } & MeaningFold);

export interface MeaningReading {
  readonly id: string;
  readonly by: "dreamed" | "reflected";
  readonly date: string;
  readonly title: string;
  readonly excerpt: string;
}

export interface MeaningOpen {
  readonly id: string;
  readonly title: string;
  /** `open` — an unresolved thread; `dated` — a reminder on or after today. */
  readonly why: "open" | "dated";
  readonly date: string | null;
  /** A repeating reminder (2026-10-09): how often, in words — `date` is then
   *  its next occurrence. Absent on a date that happens once. */
  readonly every?: string;
}

export interface MeaningPattern {
  readonly label: string;
  /** In how many entries of the arc it recurs, of `of`. */
  readonly entries: number;
  readonly of: number;
}

export interface MeaningResult {
  readonly mode: "meaning";
  readonly reason: "answered" | "nothing-came";
  readonly semantic: SemanticSource;
  /**
   * A name the question asks about that has no card, said plainly — the
   * answer's FIRST line (2026-10-09): "No card for Han yet; here is what
   * mentions Han" when the answer follows the name (a `words` lens on it),
   * "… yet; this follows Ilya" when a card asked about alongside it leads.
   * Null when every name asked about has a card.
   */
  readonly noCard: string | null;
  readonly lens: MeaningLens | null;
  /** The other subjects the question named, as one-liners to ask for. */
  readonly others: readonly { readonly name: string; readonly memories: number }[];
  /** A question about feeling: the words it named and whose ("mine", "Mike's"), or null. */
  readonly feeling: { readonly words: readonly string[]; readonly whose: string | null } | null;
  readonly counts: {
    /** Chapters in the whole arc (all pages). */
    readonly chapters: number;
    /** Sessions with the subject's moments and no chapter for them. */
    readonly sessions: number;
    /** Of those, the sessions that did write chapters, the moments under none of them. */
    readonly unplaced: number;
    /** The subject's moments (not faded). */
    readonly moments: number;
    readonly faded: number;
    readonly readings: number;
    readonly open: number;
  };
  readonly page: number;
  readonly pages: number;
  readonly arc: readonly MeaningArcLine[];
  readonly faded: readonly MeaningMoment[];
  readonly readings: readonly MeaningReading[];
  readonly open: readonly MeaningOpen[];
  readonly patterns: { readonly subjects: readonly MeaningPattern[]; readonly feelings: readonly MeaningPattern[] };
  /** What makes the evidence thin, and other plain notes ("no card names it"). */
  readonly notes: readonly string[];
  /** Whose labels the renderer prints: the asker's and the other's. */
  readonly whose: { readonly self: string; readonly owner: string };
  /**
   * Every id the rendered answer shows — memories and episodes — for the
   * seen set (`server.ts#markSeen`, which `note.feelingsNow` reads) and quote
   * credit. Exactly what `renderMeaning` prints, after the fit.
   */
  readonly shown: readonly string[];
  /** The rendered size, `wireChars`, and whether the fit had to trim. */
  readonly chars: number;
  readonly trimmed: boolean;
}

// ── the path ─────────────────────────────────────────────────────────────────

/** Words a question is built from rather than about (the no-card words channel only). */
const FRAME = new Set([
  "what", "when", "where", "which", "who", "whom", "whose", "why", "how", "whats", "was", "were", "is", "are", "am",
  "be", "been", "being", "do", "does", "did", "have", "has", "had", "can", "could", "will", "would", "should", "may",
  "ive", "im", "the", "an", "this", "that", "these", "those", "some", "any", "them", "they", "their", "of", "to", "in",
  "on", "at", "for", "with", "about", "from", "by", "as", "into", "and", "or", "but", "if", "than", "then", "not",
  "very", "really", "me", "my", "mine", "you", "your", "yours", "we", "us", "our", "ours", "it", "its", "there",
  "been", "since", "ever", "over", "time", "times", "things", "thing", "between", "together", "keeps", "keep",
  "coming", "come", "comes", "up", "happened", "happen", "mean", "means", "meant", "think", "felt", "feel", "feeling",
  "feelings", "most", "all", "so", "far", "lately", "recently", "tell", "story", "arc", "been",
  // The asking itself ("what do I know about Will", review of #323).
  "know", "knew", "known", "remember", "remembered",
]);

/**
 * A feeling question's frame beyond `feeling-ask.ts#isFeelingFrameWord`: the
 * owner named as a role, and the recent past ("what have I felt lately") —
 * never a topic to read moments by.
 */
const FEELING_FRAME_MORE = new Set([
  "owner", "user", "recent", "recently", "lately", "latest", "last", "today", "yesterday", "tonight", "now",
]);

/** Words that make "us" the subject: the two of them together. Not "we" or "our", which a question uses for joint work. */
const US_WORDS = new Set(["us", "ourselves", "together"]);

/**
 * Just before a name, words that make it what the question is ABOUT: "what has
 * X been", "how has X changed", "who was X", "how did X take it", "tell me
 * about X", "my arc with X", "between X and Y" (and "between you and X").
 */
const ABOUT_BEFORE: readonly RegExp[] = [
  /\b(?:what|who|how)\s+(?:has|have|had|is|are|was|were)\s+$/i,
  /\bhow\s+did\s+$/i,
  /\babout\s+$/i,
  /\b(?:my|our|your)\s+(?:arc|history|story|relationship|time|work|things)\s+with\s+$/i,
  /\bbetween\s+$/i,
  /\bbetween\s+(?:you|me|him|her|them)\s+and\s+$/i,
];
/**
 * Just before a name, words that make it an ASIDE: who the subject matters to
 * ("been to Y", "meant for Y"), or when ("since Y arrived", "after Y left").
 * Not a bare "to": "what happened to X" asks about X.
 */
const ASIDE_BEFORE = /\b(?:(?:be|been|is|was|are|were|mean|means|meant|matter|matters|mattered)\s+(?:to|for)|since|after|before|until|than)\s+$/i;
/** What lies between two names asked about alike: "X and Y", "X, Y", "X or Y". */
const JOINED = /^(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|&)\s+)$/i;
/** The owner's "I" when the asker is the counterpart (`asker: "self"`): "you". Not "your", which owns a topic ("your garden plan"). */
const OWNER_AS_YOU = /\b(?:you|yourself)\b(?!['’])/gi;
/** The owner's "I" when the asker is the owner. Not "my", for the same reason. */
const OWNER_AS_I = /\b(?:i|me|myself)\b(?!['’])/gi;

/** A card the question names, and its memories the asker may see. */
interface NamedCard {
  readonly id: string;
  readonly name: string;
  readonly ids: readonly string[];
}

interface Held {
  readonly row: MemoryRow;
  /** How strongly this memory holds the subject (1 for a card's; a stamp's value; a word/meaning score). */
  weight: number;
}

interface EpisodeInfo {
  readonly id: string;
  readonly session: string | null;
  readonly title: string | null;
  readonly createdAt: number;
  readonly chapters: readonly { text: string; date: string | null; heading: string | null }[];
}

interface Entry {
  readonly key: string;
  readonly kind: "chapter" | "session";
  readonly episode: EpisodeInfo | null;
  readonly chapter: number | null;
  readonly session: string | null;
  /** A session entry whose session did write chapters, these moments under none of them. */
  readonly unplaced: boolean;
  /** When it sits in time, UTC ms — what the arc is ordered by; +∞ when nothing dates it. */
  at: number;
  date: string | null;
  hold: number;
  textHold: number;
  readonly moments: Held[];
}

/**
 * Answer a question in meaning mode. Never throws on a store that will not
 * answer one of its reads: that part is empty and the rest stands. `page`
 * picks the arc's page (from 1); `roomChars` is the rendered room,
 * `MEANING_RESULT_CHARS` unless a test passes a small one to reach the trim.
 */
export function meaningRecall(ctx: MeaningContext, question: string, opts: { page?: number; roomChars?: number } = {}): MeaningResult {
  const c = ctx.counterpart;
  const store = c.store;
  const owner = ctx.owner;
  const day = ctx.day ?? safe(() => store.livedDay(), 0);
  const zone = safe(() => store.zone(), undefined);
  const today = safe(() => store.today(), localDate(Date.now(), zone));
  const vector = ctx.vector ?? null;
  const semantic: SemanticSource = vector !== null && vector.length > 0 ? "in-line" : (ctx.semantic ?? "embedder-off");
  const asker: FeelingWhose = ctx.asker ?? "self";
  const ownerName = ownerDisplayName(c);
  const whose = {
    self: asker === "self" ? "mine" : "the counterpart's",
    owner: asker === "owner" ? "mine" : ownerName === null ? "the owner's" : `${ownerName}'s`,
  };
  const page = Number.isInteger(opts.page) && (opts.page as number) >= 1 ? (opts.page as number) : 1;
  const denied = new Set(safe(() => store.deniedIds(), [] as string[]));
  const rows = new Map<string, MemoryRow | null>();
  /** A memory row the asker may see, or null: live, not superseded, not removed, not confidential to a non-owner. */
  const usable = (id: string): MemoryRow | null => {
    if (rows.has(id)) return rows.get(id) ?? null;
    let out: MemoryRow | null = null;
    try {
      const row = store.row(id);
      if (
        row !== undefined &&
        row.type === "memory" &&
        row.archived === 0 &&
        row.superseded_by === null &&
        !denied.has(id) &&
        (owner || row.confidential !== 1)
      ) {
        out = row;
      }
    } catch {
      out = null;
    }
    rows.set(id, out);
    return out;
  };

  // ── 1. the question: feeling, cards, "us" ──────────────────────────────────
  const stamps = safe(() => store.feelingsLive(), [] as (FeelingRow & { birth_day: number })[]);
  const tokensOf = stamps.map((f) => feelingTokens(f));
  const stored = new Set(tokensOf.flatMap((x) => [...x]));
  const minLen = c.recall.tunables.MIN_CUE_LENGTH;
  const ask = safe(
    () => readFeelingAsk(question, { asker, ownerNames: ownerNamesLower(c), owner }, stored, minLen),
    null,
  );
  const feelingAsked = ask !== null && ask.ranked;
  /** memory -> the strongest matching stamp's value (a core-tier match counts half). */
  const felt = new Map<string, number>();
  if (feelingAsked && ask !== null) {
    const every = ask.named.size === 0;
    stamps.forEach((f, i) => {
      if (ask.whose !== null && f.whose !== ask.whose) return;
      const answers = tokensOf[i] as Set<string>;
      const exact = every || [...ask.named].some((w) => answers.has(w));
      const core = !exact && stampCores(f).some((x) => ask.cores.has(x));
      if (!exact && !core) return;
      const soft = softenedFeeling(f.strength, day - feltDay(f), feelingValence(f));
      const value = (ask.strongest ? f.strength : soft) * (exact ? 1 : 0.5);
      if (!(value > 0)) return;
      if (usable(f.memory_id) === null) return;
      felt.set(f.memory_id, Math.max(felt.get(f.memory_id) ?? 0, value));
    });
  }

  const cardOf = (id: string): NamedCard | null => {
    const name = safe(() => c.schemas.entity(id)?.name ?? null, null);
    if (name === null) return null;
    return { id, name, ids: safe(() => store.memoriesNaming(id), [] as string[]).filter((m) => usable(m) !== null) };
  };
  const cards = safe(() => c.schemas.subjectsIn(question), [] as string[])
    .map(cardOf)
    .filter((x): x is NamedCard => x !== null)
    .sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
  const usAsked = tokenize(question).some((w) => US_WORDS.has(w)) || /\bbetween\s+(you\s+and\s+me|me\s+and\s+you)\b/i.test(question);
  const usIds = usAsked
    ? safe(() => store.list({ type: "memory", archived: false, about: "us" }), [] as string[]).filter((m) => usable(m) !== null)
    : [];
  const usName = ownerName === null ? "us" : `us (${ownerName} and me)`;

  // ── 2. the lens, and the memories that hold it ─────────────────────────────
  const held = new Map<string, Held>();
  const hold = (id: string, weight: number): void => {
    const row = usable(id);
    if (row === null || !(weight > 0)) return;
    const had = held.get(id);
    if (had === undefined) held.set(id, { row, weight });
    else had.weight = Math.max(had.weight, weight);
  };
  let lens: MeaningLens | null = null;
  /** A chapter's words hold the subject too: the card's terms, or the question's words. */
  let textMatch: ((text: string) => number) | null = null;
  /** The regexes a chapter's line is picked by. */
  let lineMatch: readonly RegExp[] = [];
  const others: { name: string; memories: number }[] = [];
  const notes: string[] = [];
  // THE SUBJECT IS THE CARD THE QUESTION IS ABOUT (2026-10-09), read off its
  // grammar and the order of its names; memory counts only break a tie. The
  // owner's "I" — "you" in my voice — asked about is his own card
  // (`subjectOf`). It was the card with the most memories, which on a real
  // store is usually the owner's: "what has Ilya been to Mike" answered
  // about Mike.
  const ownerCard = safe(() => findIdentityCore(store), null);
  /** Each word of a live card's name or alias, lower case → the cards it is a word of (read once, when asked). */
  let cardWords: Map<string, string[]> | null = null;
  const cardWord = (word: string): boolean => {
    if (cardWords === null) {
      const index = new Map<string, string[]>();
      for (const e of safe(() => c.schemas.entities(), [] as ReturnType<typeof c.schemas.entities>)) {
        for (const w of new Set([e.name, ...e.aliases].flatMap((t) => tokenize(t)))) index.set(w, [...(index.get(w) ?? []), e.id]);
      }
      cardWords = index;
    }
    // Only a card the asker may see something of: one that holds nothing for
    // him reads as no card, as everywhere else here.
    return (cardWords.get(word) ?? []).some((id) => (cardOf(id)?.ids.length ?? 0) > 0);
  };
  const subject = subjectOf(question, cards, {
    terms: (id) => cardTerms(c, id),
    ownerCard,
    ownerPronoun: feelingAsked || usAsked ? null : asker === "self" ? OWNER_AS_YOU : OWNER_AS_I,
    ownerCardOf: () => (ownerCard === null ? null : cardOf(ownerCard)),
    ownerNames: new Set(ownerNamesLower(c).flatMap((n) => tokenize(n))),
    cardWord,
  });
  const bestCard = subject.card;
  if (bestCard !== null && subject.alike.length > 0) {
    notes.push(`it asks about ${andList([bestCard.name, ...subject.alike])} alike: this follows ${bestCard.name}, named first`);
  }
  // A NAME WITH NO CARD, said first (2026-10-09): asked about alongside a
  // card, the card leads; asked about above every card, what mentions it is
  // the answer (below). Never an answer about another card in silence.
  let noCard: string | null =
    bestCard !== null && subject.bareAlike.length > 0 ? `No card for ${andList(subject.bareAlike)} yet; this follows ${bestCard.name}` : null;
  /** The name with no card the answer follows, when it follows one. */
  const bareName = bestCard === null && !feelingAsked ? subject.bare : null;

  if (bestCard !== null) {
    lens = { kind: "card", id: bestCard.id, name: bestCard.name };
    for (const id of bestCard.ids) hold(id, 1);
    // By the alias index's own name rule: "Han's" names Han.
    const terms = cardTerms(c, bestCard.id);
    const res = terms.map((t) => nameRegex(t, "giu"));
    lineMatch = terms.map((t) => nameRegex(t));
    if (res.length > 0) {
      textMatch = (text) => {
        let n = 0;
        for (const re of res) n += (text.match(re) ?? []).length;
        return Math.min(n, 4) * 0.5;
      };
    }
    for (const x of cards) if (x.id !== bestCard.id) others.push({ name: x.name, memories: x.ids.length });
    if (usIds.length > 0) others.push({ name: usName, memories: usIds.length });
  } else if (bareName !== null) {
    // What mentions the name, as typed ("Han", not "han"): its words only.
    // The question's meaning is left out — its vector carries the other
    // names too, and would bring "Mike" back in for "what has Han been to
    // Mike". The cards it named are one-liners to ask for.
    lens = { kind: "words", name: `"${bareName}"` };
    const byWords = holdByWords(store, nameTopic(bareName), usable, hold);
    textMatch = byWords.textMatch;
    lineMatch = byWords.lineMatch;
    notes.push("matched by the name as written, not by meaning");
    for (const x of cards) others.push({ name: x.name, memories: x.ids.length });
    if (usIds.length > 0) others.push({ name: usName, memories: usIds.length });
  } else if (usIds.length > 0) {
    lens = { kind: "us", name: usName };
    for (const id of usIds) hold(id, 1);
    for (const x of cards) others.push({ name: x.name, memories: x.ids.length });
  } else if (feelingAsked && ask !== null) {
    // A FEELING ABOUT A TOPIC NO CARD NAMES ("how did I feel about the garden
    // plan", review of #323): the felt moments the topic's words reach are the
    // answer. None reached: every felt moment, and the answer says plainly that
    // no card names the topic and none of them say it. Only the words — the
    // question's embedding carries the feeling, not the topic — and not a
    // "since …" clause, which is a time ("since I started living here"), not
    // a topic. Unstamped memories the words reach are never moments here: a
    // note ABOUT feelings is not a feeling (lane 6, item 3).
    const feelingAs = feelingName(ask.named, ask.whose, whose);
    const asked = question.replace(/\bsince\b[^?.!;]*/gi, " ");
    const proper = safe(() => askedNames(asked), new Set<string>());
    const owners = new Set(ownerNamesLower(c).flatMap((n) => tokenize(n)));
    // A name with no card that leads (`subjectOf`'s `bare`) is the topic, as
    // typed: the question's other words include the card it outranked, and
    // "no card names" would then name that card too (review of #347).
    const topic =
      subject.bare !== null
        ? nameTopic(subject.bare)
        : contentWords(
            c,
            asked,
            minLen,
            ask.named,
            (w) => isFeelingFrameWord(w, stored, proper) || owners.has(w) || FEELING_FRAME_MORE.has(w),
          );
    const reached = new Map<string, number>();
    if (topic.words.length > 0) {
      holdByWords(store, topic, usable, (id) => {
        const v = felt.get(id);
        if (v !== undefined) reached.set(id, v);
      });
    }
    const topicName = `"${topic.shown.join(" ")}"`;
    if (reached.size > 0) {
      lens = { kind: "feeling", name: `${feelingAs} about ${topicName}` };
      for (const [id, v] of reached) hold(id, v);
      notes.push(`no card names ${topicName}: the moments that carry ${feelingAs} and say it`);
    } else {
      lens = { kind: "feeling", name: feelingAs };
      for (const [id, v] of felt) hold(id, v);
      if (topic.words.length > 0) {
        notes.push(`no card names ${topicName}, and no moment that carries ${feelingAs} says it: every one follows`);
      }
    }
    for (const x of cards) others.push({ name: x.name, memories: x.ids.length });
  } else {
    const topic = contentWords(c, question, minLen, ask?.named ?? new Set());
    const words = topic.words;
    if (words.length > 0 || (vector !== null && vector.length > 0)) {
      lens = { kind: "words", name: words.length > 0 ? `"${topic.shown.join(" ")}"` : "the question's meaning" };
      if (words.length > 0) {
        const byWords = holdByWords(store, topic, usable, hold);
        textMatch = byWords.textMatch;
        lineMatch = byWords.lineMatch;
      }
      if (vector !== null && vector.length > 0) {
        const floor = safe(() => semanticTuning(c.recall.tunables, store.rankingIdentity(), "inline").floor, 0.45);
        for (const h of safe(() => store.nearestTo(vector, MEANING_SEMANTIC_MAX), [])) {
          if (h.score >= floor) hold(h.id, Math.min(1, h.score));
        }
      }
      notes.push(
        `no card names it: matched by its words${vector !== null && vector.length > 0 ? " and its meaning" : ` only (meaning search off: ${semantic})`}`,
      );
    }
    for (const x of cards) others.push({ name: x.name, memories: x.ids.length });
  }

  // Readings and chapter copies are not moments: set aside.
  const readingIds = new Set<string>();
  const copies = new Map<string, Held>();
  for (const [id, h] of held) {
    if (h.row.source === "dreamed" || h.row.source === "reflection") {
      readingIds.add(id);
      held.delete(id);
    } else if (h.row.source === "episode" && h.row.origin_ref !== null && h.row.origin_ref.startsWith("epi_")) {
      copies.set(id, h);
      held.delete(id);
    }
  }

  // Faded moments: listed after the arc, not in its slots.
  const strengthOf = new Map<string, number>();
  const fadedIds: string[] = [];
  for (const [id] of held) {
    const physics = safe(() => store.physicsOf(id), null);
    if (physics === null) continue;
    strengthOf.set(id, strength(physics, day));
    if (isFaded(physics, day)) fadedIds.push(id);
  }
  for (const id of fadedIds) held.delete(id);

  // A question about feeling WITH a subject keeps the subject's moments that
  // carry the feeling — if any do; otherwise the whole arc, and it says so.
  // Read after the readings, copies and faded are set aside: a gist or a
  // faded moment carrying it would keep nothing on the arc.
  let feelingFilter: ReadonlyMap<string, number> | null = null;
  if (feelingAsked && ask !== null && lens !== null && lens.kind !== "feeling") {
    const kept = [...held.keys()].filter((id) => felt.has(id));
    if (kept.length > 0) feelingFilter = felt;
    else notes.push(`none of ${lens.name}'s moments carry ${feelingName(ask.named, ask.whose, whose)}: the whole arc follows`);
  }

  // ── 3. the arc: place each moment under its chapter ────────────────────────
  const episodes = episodeIndex(c, owner, denied);
  const bySession = new Map<string, EpisodeInfo[]>();
  for (const e of episodes) {
    if (e.session === null) continue;
    const list = bySession.get(e.session) ?? [];
    list.push(e);
    bySession.set(e.session, list);
  }
  const times = new Map<string, ChapterTimes | null>();
  const timesOf = (id: string): ChapterTimes | null => {
    if (!times.has(id)) times.set(id, chapterTimesOf(store, id));
    return times.get(id) ?? null;
  };
  const entries = new Map<string, Entry>();
  const chapterEntry = (e: EpisodeInfo, k: number): Entry => {
    const key = chapterAddress(e.id, k);
    let entry = entries.get(key);
    if (entry === undefined) {
      const t = timesOf(e.id);
      const date = e.chapters[k - 1]?.date ?? null;
      const at = t?.moments[k] ?? (date !== null ? Date.parse(`${date}T12:00:00Z`) : e.createdAt);
      entry = { key, kind: "chapter", episode: e, chapter: k, session: e.session, unplaced: false, at, date: date ?? localDay(at, zone), hold: 0, textHold: 0, moments: [] };
      entries.set(key, entry);
    }
    return entry;
  };
  const momentList = [...held.values()].filter((h) => feelingFilter === null || feelingFilter.has(h.row.id));
  for (const h of momentList) {
    const session = h.row.origin_session;
    const at = h.row.created_at;
    let placed: Entry | null = null;
    if (session !== null && at !== null) {
      for (const e of bySession.get(session) ?? []) {
        const t = timesOf(e.id);
        const k = t === null ? null : chapterAt(t, at);
        if (k !== null) {
          placed = chapterEntry(e, k);
          break;
        }
      }
    }
    if (placed === null) {
      // Keyed by the whole session id: two sessions never share an entry.
      const key = `session ${session === null || session.length === 0 ? "unrecorded" : session}`;
      placed = entries.get(key) ?? null;
      if (placed === null) {
        // A session that did write chapters, these moments under none of them
        // (the chapters' moments unknown — an episode from before v12 — or a
        // later write-up), is not a session that wrote none.
        const unplaced = session !== null && bySession.has(session);
        placed = {
          key,
          kind: "session",
          episode: null,
          chapter: null,
          session,
          unplaced,
          at: at ?? Number.POSITIVE_INFINITY,
          date: at === null ? emptyNull(h.row.learned_on) : localDay(at, zone),
          hold: 0,
          textHold: 0,
          moments: [],
        };
        entries.set(key, placed);
      }
      if (at !== null && at < placed.at) {
        placed.at = at;
        placed.date = localDay(at, zone);
      }
    }
    placed.moments.push(h);
    placed.hold += feelingFilter !== null ? (feelingFilter.get(h.row.id) ?? 0) : h.weight;
  }
  // The chapters' own words (a card's terms, the question's words). Not on a
  // feeling-filtered arc: a chapter that names the subject without the feeling
  // is not where it was felt.
  if (textMatch !== null && feelingFilter === null) {
    for (const e of episodes) {
      e.chapters.forEach((ch, i) => {
        const n = textMatch(ch.text);
        if (n > 0) {
          const entry = chapterEntry(e, i + 1);
          entry.textHold += n;
          entry.hold += n;
        }
      });
    }
  } else if (feelingFilter === null) {
    // No words to read a chapter by ("us", a feeling): a chapter copy the lens
    // reached holds it in its episode's latest chapter (the copy's mark is the
    // latest chapter's, `self/episodes.ts#EPISODE_ABOUT_META`).
    const byId = new Map(episodes.map((e) => [e.id, e]));
    for (const h of copies.values()) {
      const e = byId.get(h.row.origin_ref ?? "");
      if (e === undefined) continue;
      const entry = chapterEntry(e, e.chapters.length);
      entry.hold += h.weight;
    }
  }
  // Time order; an entry nothing dates (at = +∞) goes last.
  const all = [...entries.values()].filter((e) => e.hold > 0).sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1) || a.key.localeCompare(b.key));

  // Feelings on the subject's moments, for the turns and the patterns.
  const momentIds = all.flatMap((e) => e.moments.map((m) => m.row.id));
  const feelingsAll = safe(() => store.feelingsOn(momentIds), new Map<string, (FeelingRow & { birth_day: number })[]>());
  const marks = new Map<string, ("start" | "end" | "turn")[]>();
  const mark = (key: string, m: "start" | "end" | "turn"): void => {
    const list = marks.get(key) ?? [];
    if (!list.includes(m)) list.push(m);
    marks.set(key, list);
  };
  // A TURN (working default): the entry where the feelings' valence flips
  // sign from the last entry that had a clear one.
  let lastSign = 0;
  for (const e of all) {
    const fs = e.moments.flatMap((m) => feelingsAll.get(m.row.id) ?? []);
    const sign = valenceSign(fs);
    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign) mark(e.key, "turn");
      lastSign = sign;
    }
  }
  const long = all.length > MEANING_CHAPTERS_SHOWN;
  if (long) {
    mark((all[0] as Entry).key, "start");
    mark((all[all.length - 1] as Entry).key, "end");
  }

  // Ranked: on a long arc its start and end first, then the turns, then by
  // how much each holds (the newer first on a tie). Shown in time order.
  const ranked = long
    ? [...all].sort((a, b) => {
        const ra = rankOf(marks.get(a.key));
        const rb = rankOf(marks.get(b.key));
        if (ra !== rb) return ra - rb;
        if (b.hold !== a.hold) return b.hold - a.hold;
        return a.at === b.at ? 0 : b.at < a.at ? -1 : 1;
      })
    : all;
  const pages = Math.max(1, Math.ceil(all.length / MEANING_CHAPTERS_SHOWN));
  const onPage = new Set(ranked.slice((page - 1) * MEANING_CHAPTERS_SHOWN, page * MEANING_CHAPTERS_SHOWN).map((e) => e.key));
  if (page > pages) notes.push(`page ${String(page)} is past the end: the arc has ${String(pages)} page${pages === 1 ? "" : "s"}`);

  // ── 4. the entries shown, in full ─────────────────────────────────────────
  const arc: MeaningArcLine[] = [];
  let gap: Entry[] = [];
  const flush = (): void => {
    if (gap.length === 0) return;
    arc.push({ fold: true, count: gap.length, from: (gap[0] as Entry).date, to: (gap[gap.length - 1] as Entry).date });
    gap = [];
  };
  for (const e of all) {
    if (!onPage.has(e.key)) {
      gap.push(e);
      continue;
    }
    flush();
    arc.push({ fold: false, entry: showEntry(c, e, { usable, strengthOf, lineMatch, zone, feelingFilter, marks: marks.get(e.key) ?? [], day }) });
  }
  flush();
  // A page past the end shows no entry, and so no fold either.
  const shownArc = arc.some((l) => !l.fold) ? arc : [];

  // ── 5. faded, readings, open, patterns ────────────────────────────────────
  const faded = fadedIds
    .map((id) => usable(id))
    .filter((r): r is MemoryRow => r !== null)
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .map((r) => momentOf(r, zone));

  const subjectSet = new Set([...momentList.map((h) => h.row.id), ...fadedIds, ...copies.keys()]);
  const readingsAll = readingsFor(c, subjectSet, readingIds, usable, zone);
  const openAll = openFor(c, [...momentList.map((h) => h.row.id), ...fadedIds], usable, today, zone);
  const patterns = patternsOf(c, all, lens, feelingsAll, whose);

  // ── 6. what makes the evidence thin ───────────────────────────────────────
  const chapters = all.filter((e) => e.kind === "chapter");
  const sessions = all.filter((e) => e.kind === "session");
  const momentCount = all.reduce((n, e) => n + e.moments.length, 0);
  if (lens !== null && all.length > 0) {
    if (chapters.length === 0) {
      notes.push(
        sessions.some((e) => e.unplaced)
          ? `no chapter holds it: ${plural(momentCount, "moment")} outside any chapter`
          : `no chapter holds it: ${plural(momentCount, "moment")} from sessions that wrote none`,
      );
    }
    else if (chapters.length <= 3) {
      const dates = chapters.map((e) => e.date).filter((d): d is string => d !== null).sort();
      const first = dates[0];
      const last = dates[dates.length - 1];
      if (chapters.length === 1) notes.push("one chapter");
      else if (first !== undefined && last !== undefined && daysApart(first, last) <= 7) notes.push(`${plural(chapters.length, "chapter")}, all from one week`);
    }
    const feltAny = all.some((e) => e.moments.some((m) => (feelingsAll.get(m.row.id) ?? []).length > 0));
    if (!feltAny) notes.push("no feelings recorded");
  }

  const nothing = lens === null || (all.length === 0 && faded.length === 0 && readingsAll.length === 0 && openAll.length === 0);
  if (bareName !== null) {
    noCard = nothing
      ? `No card for ${bareName} yet, and nothing in memory mentions ${bareName}`
      : `No card for ${bareName} yet; here is what mentions ${bareName}`;
  }
  const result: MeaningResult = {
    mode: "meaning",
    reason: nothing ? "nothing-came" : "answered",
    semantic,
    noCard,
    lens,
    others: others.filter((o) => o.memories > 0),
    feeling: feelingAsked && ask !== null ? { words: [...ask.named], whose: ask.whose === null ? null : whose[ask.whose] } : null,
    counts: {
      chapters: chapters.length,
      sessions: sessions.length,
      unplaced: sessions.filter((e) => e.unplaced).length,
      moments: momentCount,
      faded: faded.length,
      readings: readingsAll.length,
      open: openAll.length,
    },
    page,
    pages,
    arc: shownArc,
    faded: faded.slice(0, MEANING_FADED_SHOWN),
    readings: readingsAll.slice(-MEANING_READINGS_SHOWN),
    open: openAll.slice(0, MEANING_OPEN_SHOWN),
    patterns,
    notes,
    whose,
    shown: [],
    chars: 0,
    trimmed: false,
  };
  return fit(result, opts.roomChars ?? MEANING_RESULT_CHARS);
}

// ── showing one entry ────────────────────────────────────────────────────────

function showEntry(
  c: Counterpart,
  e: Entry,
  opts: {
    usable: (id: string) => MemoryRow | null;
    strengthOf: ReadonlyMap<string, number>;
    lineMatch: readonly RegExp[];
    zone: string | undefined;
    feelingFilter: ReadonlyMap<string, number> | null;
    marks: readonly ("start" | "end" | "turn")[];
    day: number;
  },
): MeaningEntry {
  const store = c.store;
  // The subject's moments, the ones holding it most first, then the stronger.
  const own = [...e.moments].sort(
    (a, b) =>
      (opts.feelingFilter?.get(b.row.id) ?? b.weight) - (opts.feelingFilter?.get(a.row.id) ?? a.weight) ||
      (opts.strengthOf.get(b.row.id) ?? 0) - (opts.strengthOf.get(a.row.id) ?? 0) ||
      (a.row.created_at ?? 0) - (b.row.created_at ?? 0),
  );
  // Chosen by how much they hold, shown in the order they were written.
  let shown = own
    .slice(0, MEANING_MOMENTS_PER_CHAPTER)
    .sort((a, b) => (a.row.created_at ?? 0) - (b.row.created_at ?? 0) || a.row.id.localeCompare(b.row.id))
    .map((h) => momentOf(h.row, opts.zone));
  // Every memory the stretch wrote, for its feelings (and to fill a chapter
  // that holds the subject by its words alone with two of its own moments).
  let span: MemoryRow[] = [];
  if (e.kind === "chapter" && e.episode !== null && e.session !== null && e.chapter !== null) {
    const t = chapterTimesOf(store, e.episode.id);
    if (t !== null) {
      span = safe(() => store.memoriesOfSession(e.session as string), [])
        .filter((m) => chapterAt(t, m.at) === e.chapter)
        .map((m) => opts.usable(m.id))
        .filter((r): r is MemoryRow => r !== null && !(r.source === "episode" && (r.origin_ref ?? "").startsWith("epi_")));
    }
  } else {
    span = e.moments.map((h) => h.row);
  }
  if (own.length === 0 && span.length > 0) {
    const have = new Set(shown.map((m) => m.id));
    const extra = span
      .filter((r) => !have.has(r.id))
      .map((r) => ({ r, p: safe(() => store.physicsOf(r.id), null) }))
      .filter((x): x is { r: MemoryRow; p: NonNullable<typeof x.p> } => x.p !== null && !isFaded(x.p, opts.day))
      .map((x) => ({ r: x.r, s: strength(x.p, opts.day) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 2 - shown.length)
      .map((x) => momentOf(x.r, opts.zone));
    shown = [...shown, ...extra];
  }
  const ids = [...new Set([...span.map((r) => r.id), ...e.moments.map((h) => h.row.id)])];
  const fs = [...safe(() => store.feelingsOn(ids), new Map<string, (FeelingRow & { birth_day: number })[]>()).values()].flat();
  const ep = e.episode;
  const text = ep !== null && e.chapter !== null ? (ep.chapters[e.chapter - 1]?.text ?? "") : "";
  return {
    address: e.key,
    kind: e.kind,
    unplaced: e.unplaced,
    episodeId: ep?.id ?? null,
    chapter: e.chapter,
    of: ep?.chapters.length ?? null,
    title: ep?.title ?? null,
    date: e.date,
    line: text.length === 0 ? "" : lineOf(text, opts.lineMatch, LINE_CHARS),
    hold: round2(e.hold),
    moments: shown,
    momentCount: e.moments.length,
    feelings: { self: topFeelings(fs, "self"), owner: topFeelings(fs, "owner") },
    marks: opts.marks,
  };
}

/** Faded: one rule for both question modes (`deliberate.ts#hasFaded`: below physics' `REACH`, 2026-10-10). */
function isFaded(p: MemoryPhysics, day: number): boolean {
  return hasFaded(p, day);
}

/** The strongest three distinct feeling words of one person. */
function topFeelings(fs: readonly FeelingRow[], who: FeelingWhose): MeaningFeeling[] {
  const best = new Map<string, number>();
  for (const f of fs) {
    if (f.whose !== who) continue;
    const word = feelingWord(f);
    best.set(word, Math.max(best.get(word) ?? 0, f.strength));
  }
  return [...best]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([word, s]) => ({ word, strength: round2(s) }));
}

/** A stamp's word as the wheel prints it, or the writer's own. */
function feelingWord(f: Pick<FeelingRow, "emotion" | "other_word">): string {
  if (f.emotion === OTHER_EMOTION) return f.other_word ?? "other";
  return wheelEntry(f.emotion)?.word ?? f.emotion.split(".").pop() ?? f.emotion;
}

/** −1, 0 or +1: the feelings' strength-weighted valence, with a dead band. */
function valenceSign(fs: readonly FeelingRow[]): number {
  let sum = 0;
  let weight = 0;
  for (const f of fs) {
    sum += f.strength * feelingValence(f);
    weight += f.strength;
  }
  if (!(weight > 0)) return 0;
  const v = sum / weight;
  return v > 0.15 ? 1 : v < -0.15 ? -1 : 0;
}

function rankOf(m: readonly string[] | undefined): number {
  if (m === undefined) return 3;
  if (m.includes("start") || m.includes("end")) return 0;
  if (m.includes("turn")) return 1;
  return 3;
}

// ── readings, open, patterns ─────────────────────────────────────────────────

/**
 * Dream gists and reflection entries that touched the subject — linked to it
 * themselves, or citing one of its memories (a gist's `sources`, an entry's
 * `cites`) — oldest first. The dream journal is not one of them.
 */
function readingsFor(
  c: Counterpart,
  subject: ReadonlySet<string>,
  linked: ReadonlySet<string>,
  usable: (id: string) => MemoryRow | null,
  zone: string | undefined,
): MeaningReading[] {
  const store = c.store;
  const out = new Map<string, MemoryRow>();
  for (const id of linked) {
    const r = usable(id);
    if (r !== null) out.set(id, r);
  }
  if (subject.size > 0) {
    for (const source of ["dreamed", "reflection"] as const) {
      for (const id of safe(() => store.list({ type: "memory", archived: false, source }), [] as string[])) {
        if (out.has(id)) continue;
        const r = usable(id);
        if (r === null) continue;
        const meta = parseMeta(r.meta);
        const cited = source === "dreamed" ? meta["sources"] : meta["cites"];
        if (Array.isArray(cited) && cited.some((x) => typeof x === "string" && subject.has(x))) out.set(id, r);
      }
    }
  }
  return [...out.values()]
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      by: r.source === "dreamed" ? ("dreamed" as const) : ("reflected" as const),
      date: r.created_at === null ? r.learned_on : localDay(r.created_at, zone) ?? r.learned_on,
      title: clip(oneLine(r.title ?? firstLine(r.body)), TITLE_CHARS),
      excerpt: clip(oneLine(r.body), 160),
    }));
}

/** The subject's open threads (`unresolved`) and its reminders dated today or later. Dated first, soonest first. */
function openFor(
  c: Counterpart,
  ids: readonly string[],
  usable: (id: string) => MemoryRow | null,
  today: string,
  zone: string | undefined,
): MeaningOpen[] {
  const dated: (MeaningOpen & { sort: string })[] = [];
  const open: (MeaningOpen & { at: number })[] = [];
  for (const id of new Set(ids)) {
    const r = usable(id);
    if (r === null) continue;
    const title = clip(oneLine(r.title ?? firstLine(r.body)), TITLE_CHARS);
    // A REPEATING reminder (2026-10-09) is dated by its next occurrence — a
    // birthday stated in 1990 is still coming — and says how often.
    const meta = r.event_date !== null && isDay(r.event_date) ? parseMeta(r.meta) : null;
    const rule = meta === null ? null : meta[RECURRING_META];
    if (r.event_date !== null && isRecurrence(rule)) {
      const next = occurrenceOnOrAfter(r.event_date, rule, today);
      if (next !== null) {
        dated.push({ id, title, why: "dated", date: next.date, every: readableRecurrence(r.event_date, rule), sort: next.date });
        continue;
      }
    }
    if (r.event_date !== null && calendarOverlaps(r.event_date, today, "9999-12-31")) {
      dated.push({ id, title, why: "dated", date: r.event_date, sort: r.event_date });
      continue;
    }
    if (parseMeta(r.meta)[UNRESOLVED_META_KEY] === true) {
      open.push({ id, title, why: "open", date: r.created_at === null ? emptyNull(r.learned_on) : localDay(r.created_at, zone), at: r.created_at ?? 0 });
    }
  }
  dated.sort((a, b) => a.sort.localeCompare(b.sort) || a.id.localeCompare(b.id));
  open.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return [...dated.map(({ sort: _s, ...x }) => x), ...open.map(({ at: _a, ...x }) => x)];
}

/**
 * THE SIMPLE PATTERNS (the design's "likeliest to disappoint", first thing to
 * check at the revisit): other subjects named by the moments of several
 * entries, and feelings recorded in several, side by side. Several: 2 on an
 * arc of up to 5 entries, 3 past that; nothing on an arc of fewer than 3.
 */
function patternsOf(
  c: Counterpart,
  all: readonly Entry[],
  lens: MeaningLens | null,
  feelings: ReadonlyMap<string, readonly FeelingRow[]>,
  whose: { readonly self: string; readonly owner: string },
): MeaningResult["patterns"] {
  const n = all.length;
  if (n < 3) return { subjects: [], feelings: [] };
  const min = n <= 5 ? 2 : 3;
  const subjectIn = new Map<string, Set<string>>();
  const feelingIn = new Map<string, Set<string>>();
  let looked = 0;
  for (const e of all) {
    for (const h of e.moments) {
      if (looked < 600) {
        looked += 1;
        for (const s of safe(() => c.store.subjectsOf(h.row.id), [] as string[])) {
          if (lens?.kind === "card" && s === lens.id) continue;
          const set = subjectIn.get(s) ?? new Set<string>();
          set.add(e.key);
          subjectIn.set(s, set);
        }
      }
      for (const f of feelings.get(h.row.id) ?? []) {
        const label = `${f.whose === "owner" ? whose.owner : whose.self} ${feelingWord(f)}`;
        const set = feelingIn.get(label) ?? new Set<string>();
        set.add(e.key);
        feelingIn.set(label, set);
      }
    }
  }
  const subjects = [...subjectIn]
    .filter(([, set]) => set.size >= min)
    .map(([id, set]) => ({ label: safe(() => c.schemas.entity(id)?.name ?? null, null), entries: set.size }))
    .filter((x): x is { label: string; entries: number } => x.label !== null)
    .sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label))
    .slice(0, MEANING_PATTERNS_SHOWN)
    .map((x) => ({ ...x, of: n }));
  const felt = [...feelingIn]
    .filter(([, set]) => set.size >= min)
    .map(([label, set]) => ({ label, entries: set.size, of: n }))
    .sort((a, b) => b.entries - a.entries || a.label.localeCompare(b.label))
    .slice(0, MEANING_PATTERNS_SHOWN);
  return { subjects, feelings: felt };
}

// ── the fit ──────────────────────────────────────────────────────────────────

/**
 * Keep the rendered answer inside `MEANING_RESULT_CHARS`, trimming in a fixed
 * order — fewer moments per entry, shorter lines, fewer readings and open
 * items, no patterns, then entries off the page's ranked tail (each becomes
 * part of a fold) — and set `shown` to exactly what is printed.
 */
function fit(r: MeaningResult, room: number): MeaningResult {
  const levels: ((x: MeaningResult) => MeaningResult)[] = [
    (x) => x,
    (x) => ({ ...x, arc: mapEntries(x.arc, (e) => ({ ...e, moments: e.moments.slice(0, 2), line: clip(e.line, 140) })) }),
    (x) => ({
      ...x,
      arc: mapEntries(x.arc, (e) => ({ ...e, moments: e.moments.slice(0, 1), line: clip(e.line, 100) })),
      readings: x.readings.slice(-2).map((g) => ({ ...g, excerpt: clip(g.excerpt, 80) })),
      faded: x.faded.slice(0, 2),
      open: x.open.slice(0, 3),
    }),
    (x) => ({ ...x, patterns: { subjects: [], feelings: [] }, others: x.others.slice(0, 2), arc: mapEntries(x.arc, (e) => ({ ...e, line: clip(e.line, 60) })) }),
  ];
  let cur = r;
  for (const level of levels) {
    cur = level(cur);
    const text = renderMeaning(cur);
    if (wireChars(text) <= room) return finish(cur, text, cur !== r);
  }
  // Still too big: drop entries from the page, the last-ranked first (an
  // entry's place in time stays a fold).
  let arc = cur.arc;
  while (arc.some((l) => !l.fold)) {
    const entries = arc.filter((l): l is { fold: false; entry: MeaningEntry } => !l.fold);
    const victim = [...entries].sort((a, b) => a.entry.hold - b.entry.hold)[0];
    if (victim === undefined) break;
    arc = refold(arc, victim.entry.address);
    cur = { ...cur, arc };
    const text = renderMeaning(cur);
    if (wireChars(text) <= room) return finish(cur, text, true);
  }
  cur = { ...cur, readings: [], open: [], faded: [], patterns: { subjects: [], feelings: [] } };
  return finish(cur, renderMeaning(cur), true);
}

function finish(r: MeaningResult, text: string, trimmed: boolean): MeaningResult {
  const shown = new Set<string>();
  for (const l of r.arc) {
    if (l.fold) continue;
    if (l.entry.episodeId !== null) shown.add(l.entry.episodeId);
    for (const m of l.entry.moments) shown.add(m.id);
  }
  for (const m of r.faded) shown.add(m.id);
  for (const g of r.readings) shown.add(g.id);
  for (const o of r.open) shown.add(o.id);
  return { ...r, shown: [...shown], chars: wireChars(text), trimmed: r.trimmed || trimmed };
}

function mapEntries(arc: readonly MeaningArcLine[], fn: (e: MeaningEntry) => MeaningEntry): MeaningArcLine[] {
  return arc.map((l) => (l.fold ? l : { fold: false, entry: fn(l.entry) }));
}

/** The arc with one entry folded into its neighbours' folds. */
function refold(arc: readonly MeaningArcLine[], address: string): MeaningArcLine[] {
  const out: MeaningArcLine[] = [];
  for (const l of arc) {
    const asFold: MeaningFold | null = l.fold ? l : l.entry.address === address ? { count: 1, from: l.entry.date, to: l.entry.date } : null;
    const prev = out[out.length - 1];
    if (asFold !== null && prev !== undefined && prev.fold) {
      out[out.length - 1] = { fold: true, count: prev.count + asFold.count, from: prev.from ?? asFold.from, to: asFold.to ?? prev.to };
    } else if (asFold !== null) {
      out.push({ fold: true, ...asFold });
    } else {
      out.push(l);
    }
  }
  return out;
}

// ── the words ────────────────────────────────────────────────────────────────

/**
 * What the tool returns: labelled lines, not prose. The reader interprets;
 * nothing here says what the arc means.
 */
export function renderMeaning(r: MeaningResult): string {
  const out: string[] = [];
  // Said first, before anything about another subject (2026-10-09).
  if (r.noCard !== null) out.push(`${r.noCard}.`);
  if (r.lens === null) {
    out.push("Nothing came: the question names no card, asks about no feeling, and none of its words reach a memory.");
    out.push("Try a person's or project's name, or facts mode for a single fact.");
    return out.join("\n");
  }
  const head = [r.lens.name];
  if (r.counts.chapters > 0) head.push(plural(r.counts.chapters, "chapter"));
  const chapterless = r.counts.sessions - r.counts.unplaced;
  if (chapterless > 0) head.push(`${plural(chapterless, "session")} with no chapter`);
  if (r.counts.unplaced > 0) head.push(`${plural(r.counts.unplaced, "session")} with moments outside its chapters`);
  head.push(`${plural(r.counts.moments, "moment")}${r.counts.faded > 0 ? ` (+${String(r.counts.faded)} faded)` : ""}`);
  out.push(head.join(" · "));
  if (r.feeling !== null) {
    out.push(`feeling asked: ${r.feeling.words.length > 0 ? r.feeling.words.join(", ") : "any"} · ${r.feeling.whose ?? "both of us"}`);
  }
  const total = r.counts.chapters + r.counts.sessions;
  if (r.pages > 1) {
    const showing = r.arc.filter((l) => !l.fold).length;
    out.push(
      `${plural(total, "entry", "entries")} · page ${String(r.page)} of ${String(r.pages)}, showing ${String(showing)}${r.page < r.pages ? ` → page ${String(r.page + 1)}` : ""}`,
    );
  }
  if (r.others.length > 0) {
    out.push(`also named: ${r.others.map((o) => `${o.name} (${plural(o.memories, "memory", "memories")})`).join(", ")} — ask about one by name for its arc`);
  }
  if (r.notes.length > 0) out.push(`note: ${r.notes.join("; ")}`);
  if (r.reason === "nothing-came") {
    out.push("Nothing holds it yet.");
    return out.join("\n");
  }

  if (r.arc.length > 0) {
    out.push("");
    out.push("ARC (time order; a chapter opens by its episode id, a moment by its mem_ id)");
    for (const l of r.arc) {
      if (l.fold) {
        const span = l.from === null ? "" : l.to === null || l.to === l.from ? `, ${short(l.from)}` : `, ${short(l.from)} → ${short(l.to)}`;
        out.push(`  · ${plural(l.count, r.page === 1 ? "quieter entry" : "entry", r.page === 1 ? "quieter entries" : "entries")} not shown here${span}`);
        continue;
      }
      const e = l.entry;
      const where =
        e.kind === "chapter"
          ? `${e.address}${e.of !== null && e.of > 1 ? ` (chapter ${String(e.chapter)} of ${String(e.of)})` : ""}${e.title !== null ? ` "${clip(oneLine(e.title), 60)}"` : ""}`
          : `${e.address} · ${e.unplaced ? "not under a chapter (its chapters' moments unknown, or written after the last)" : "no chapter written"}`;
      const flags = e.marks.length > 0 ? ` · ${e.marks.join(", ")}` : "";
      out.push(`${e.date === null ? "undated" : e.date}  ${where}${flags}`);
      if (e.line.length > 0) out.push(`  ${e.line}`);
      const mine = e.feelings.self.map((f) => `${f.word} ${num(f.strength)}`).join(", ");
      const theirs = e.feelings.owner.map((f) => `${f.word} ${num(f.strength)}`).join(", ");
      if (mine.length > 0 || theirs.length > 0) {
        const sides = [mine.length > 0 ? `${r.whose.self}: ${mine}` : null, theirs.length > 0 ? `${r.whose.owner}: ${theirs}` : null].filter((x) => x !== null);
        out.push(`  feelings — ${sides.join(" | ")}`);
      }
      for (const m of e.moments) out.push(`  ${m.id}  ${m.title}`);
      if (e.momentCount > e.moments.length) out.push(`  (+${String(e.momentCount - e.moments.length)} more of its moments hold it)`);
    }
  }
  if (r.faded.length > 0) {
    out.push("");
    out.push(`FADED (${String(r.counts.faded)}; still readable by id)`);
    for (const m of r.faded) out.push(`  ${short(m.date)}  ${m.id}  ${m.title}`);
  }
  if (r.readings.length > 0) {
    out.push("");
    out.push(`EARLIER READINGS (${String(r.counts.readings)}${r.counts.readings > r.readings.length ? `, the newest ${String(r.readings.length)}` : ""})`);
    for (const g of r.readings) out.push(`  ${short(g.date)} ${g.by}  ${g.id}  ${g.title} — ${g.excerpt}`);
  }
  if (r.open.length > 0) {
    out.push("");
    out.push(`STILL OPEN (${String(r.counts.open)})`);
    for (const o of r.open) out.push(`  ${o.id}  ${o.title} · ${o.why === "dated" ? `dated ${o.date ?? "?"}${o.every === undefined ? "" : `, ${o.every}`}` : `open since ${o.date === null ? "?" : short(o.date)}`}`);
  }
  if (r.patterns.subjects.length > 0 || r.patterns.feelings.length > 0) {
    out.push("");
    out.push("RECURRING (across entries of the arc)");
    if (r.patterns.subjects.length > 0) out.push(`  with: ${r.patterns.subjects.map((p) => `${p.label} (${String(p.entries)} of ${String(p.of)})`).join(", ")}`);
    if (r.patterns.feelings.length > 0) out.push(`  feelings: ${r.patterns.feelings.map((p) => `${p.label} (${String(p.entries)} of ${String(p.of)})`).join(", ")}`);
  }
  return out.join("\n");
}

// ── small readers ────────────────────────────────────────────────────────────

/** Every live, readable episode: its session, title and chapters. Confidential ones are left out for a non-owner. */
function episodeIndex(c: Counterpart, owner: boolean, denied: ReadonlySet<string>): EpisodeInfo[] {
  const store = c.store;
  const ids = safe(() => store.list({ type: "episode", archived: false }), [] as string[]).filter((id) => !denied.has(id));
  const copies = owner ? null : safe(() => store.copiesOf(ids), null);
  const out: EpisodeInfo[] = [];
  for (const id of ids) {
    try {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0) continue;
      // A store that will not say is read as confidential (`chaptersBySession`'s rule).
      if (!owner && (row.confidential === 1 || copies === null || (copies.get(id) ?? []).some((x) => x.confidential))) continue;
      let session = row.origin_session;
      if (session === null || session.length === 0) {
        const s = parseMeta(row.meta)["sessionId"];
        session = typeof s === "string" ? s : null;
      }
      out.push({
        id,
        session,
        title: row.title === null || row.title.trim().length === 0 ? null : row.title,
        createdAt: row.created_at ?? 0,
        chapters: chaptersOf(row.body),
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** A card's own terms, the ones it alone holds (a handle two cards hold names neither). */
function cardTerms(c: Counterpart, id: string): string[] {
  try {
    const index = c.schemas.aliasIndex();
    const terms = index.termsFor(id);
    if (terms === undefined) return [];
    return [terms.name, ...terms.aliases].filter((t) => t.trim().length >= 2 && index.lookup(t).length === 1);
  } catch {
    return [];
  }
}

/** Where a name sits in the question: what it is about, a plain mention, or an aside. */
type Slot = "about" | "plain" | "aside";
const SLOT_RANK: Readonly<Record<Slot, number>> = { about: 2, plain: 1, aside: 0 };

/**
 * How strongly one mention says the question is about its card (review of
 * #334). A name: twice its place's rank, plus one when it is typed as its card
 * writes it — so "will" for a card named Will, or "hope" for Hope, sits a step
 * under a name in the same place typed with its capital ("how will Driftwood
 * go" is Driftwood's, not Will's); in a question typed all in lower case every
 * name loses the same step and the grammar still decides. The owner's
 * pronoun asked about: under every name in a plain or about place (2 and up),
 * over every aside (1 at most) — "what have I done on Driftwood" is
 * Driftwood's, "how have I been since Driftwood" is his.
 */
function mentionRank(m: { readonly slot: Slot; readonly pronoun: boolean; readonly lowered: boolean }): number {
  if (m.pronoun) return 1.5;
  return SLOT_RANK[m.slot] * 2 + (m.lowered ? 0 : 1);
}

/**
 * WHICH CARD THE QUESTION IS ABOUT (2026-10-09). Deterministic; no model.
 *
 *   1. Each name the question gives a card is read in place: ABOUT when the
 *      words just before it ask about it ("what has X been", "how has X
 *      changed", "about X", `ABOUT_BEFORE`), an ASIDE when they say who it
 *      matters to or since when ("been to Y", "since Y arrived"), plain
 *      otherwise. A name joined to the one before it ("X and Y", "X, Y")
 *      takes that one's place. A name typed in lower case where its card
 *      writes a capital ("will" for Will) is a step under the same place
 *      (`mentionRank`). A card's place is its best mention's.
 *   2. Of the cards with memories, those in the best place are the field. The
 *      owner's own card leaves a field it shares — every memory here is his,
 *      so the other one says more ("Rosalind's arc with Ilya").
 *   3. The first named wins the field; a longer name at the same spot, then
 *      more memories, then the name, break a tie. More than one left in the
 *      field is asked about alike, and `alike` names the rest so the answer
 *      can say so.
 *
 * The owner's "I" — "you" in the counterpart's voice, as `feeling-ask.ts`
 * reads whose — names his card (by its id, not his name) where it sits in an
 * about place: "what have you been like", "how have I changed", "how have you
 * and Ilya been". It ranks under any card named in a plain or about place and
 * over an aside, so "what have I done on Driftwood" is still Driftwood's (as
 * it was before the pronoun counted) and "how have I been since Driftwood" is
 * his. Anywhere else a pronoun names nothing, so "do you remember
 * the budget" is still read by its words. Off (`ownerPronoun` null) for a
 * question about feeling, where the pronoun says whose feeling, and for "us".
 *
 * A NAME WITH NO CARD (2026-10-09, the 0.3.13 release check): "what has Han
 * been to Mike", on a store whose one card is Mike's, answered with Mike's
 * arc and no word about Han. A name the asker capitalised mid-sentence
 * (`askedNames`) that no card with memories covers — not the owner's, not a
 * month or a weekday, not a word of a card's longer name, not an acronym — is
 * read in place like a card's, typed as written, when the question names a
 * card too (with none named, nothing is answered in its place, and the
 * question's words and meaning follow it as before). In
 * an aside it is passed over. When EVERY card the question names sits in an
 * aside ("been to Mike", "since Driftwood"), it is `bare`: the answer is what
 * mentions it, said so first. A card asked about or named plainly leads, as
 * it did before (review of #347: "what did Teodoro say about Postgres" is
 * Teodoro's, "how did I feel about Han at Driftwood" is Driftwood's), and
 * `bareAlike` names each such name ranked as high as that card, so the
 * answer can say it has no card.
 */
function subjectOf(
  question: string,
  cards: readonly NamedCard[],
  o: {
    readonly terms: (id: string) => readonly string[];
    readonly ownerCard: string | null;
    readonly ownerPronoun: RegExp | null;
    readonly ownerCardOf: () => NamedCard | null;
    /** The owner's names, lower case, word by word: never a name without a card. */
    readonly ownerNames: ReadonlySet<string>;
    /**
     * Is this word (lower case) part of the name or an alias of a card the
     * asker may see — "Marguerite" of Marguerite Solberg? Never a name
     * without a card, though `subjectsIn` does not read it as that card.
     */
    readonly cardWord: (word: string) => boolean;
  },
): { card: NamedCard | null; alike: readonly string[]; bare: string | null; bareAlike: readonly string[] } {
  const live = cards.filter((x) => x.ids.length > 0);
  // Every mention of every card, in the order they are named.
  const mentions: { card: NamedCard; at: number; end: number; slot: Slot; pronoun: boolean; lowered: boolean }[] = [];
  for (const card of live) {
    for (const term of o.terms(card.id)) {
      // Typed in lower case where the card writes a capital: "will" for Will.
      const capital = term !== term.toLowerCase();
      for (const m of question.matchAll(nameRegex(term, "giu"))) {
        const lowered = capital && m[0] === m[0].toLowerCase();
        mentions.push({ card, at: m.index, end: m.index + m[0].length, slot: slotAt(question, m.index), pronoun: false, lowered });
      }
    }
  }
  if (o.ownerCard !== null && o.ownerPronoun !== null) {
    const asked = [...question.matchAll(o.ownerPronoun)].filter((m) => slotAt(question, m.index) === "about");
    const own = asked.length === 0 ? null : (live.find((x) => x.id === o.ownerCard) ?? o.ownerCardOf());
    if (own !== null && own.ids.length > 0) {
      if (!live.includes(own)) live.push(own);
      for (const m of asked) {
        mentions.push({ card: own, at: m.index, end: m.index + m[0].length, slot: "about", pronoun: true, lowered: false });
      }
    }
  }
  mentions.sort((a, b) => a.at - b.at || b.end - a.end);
  const kept: typeof mentions = [];
  for (const m of mentions) {
    const prev = kept[kept.length - 1];
    // A name inside a longer one ("Han" in "Han Seo") is not a mention of its own.
    if (prev !== undefined && m.at < prev.end) continue;
    kept.push(m);
  }
  // The names no card covers, between and around the cards' own.
  const uncarded = uncardedNames(question, kept, o.ownerNames, o.cardWord);
  // Joined to the name before it ("X and Y", "X, Y"), a name takes that one's
  // place — and joined to the owner's pronoun ("how have you and Ilya been"),
  // the place the grammar gives, not the pronoun's lower rank. Cards and
  // names with no card alike: "how have Han and Ilya been" asks about both.
  const inOrder: { at: number; end: number; slot: Slot }[] = [...kept, ...uncarded].sort((a, b) => a.at - b.at);
  for (let i = 1; i < inOrder.length; i += 1) {
    const prev = inOrder[i - 1] as { at: number; end: number; slot: Slot };
    const m = inOrder[i] as { at: number; end: number; slot: Slot };
    if (JOINED.test(question.slice(prev.end, m.at))) m.slot = prev.slot;
  }
  // In an aside a name with no card is passed over; the first named breaks a tie.
  // With no card named at all, none is: nothing would be answered in its
  // place, and the question's own words and meaning already follow it — "what
  // did I learn about Postgres indexing" stays a question about indexing too
  // (review of #347).
  const bare = (kept.length === 0 ? [] : uncarded)
    .map((b) => ({ ...b, rank: mentionRank({ slot: b.slot, pronoun: false, lowered: false }) }))
    .filter((b) => b.slot !== "aside");
  const bareBest = bare.reduce((r, b) => Math.max(r, b.rank), Number.NEGATIVE_INFINITY);
  const bareFirst = bare.find((b) => b.rank === bareBest)?.name ?? null;
  if (live.length === 0) return { card: null, alike: [], bare: bareFirst, bareAlike: [] };
  const place = new Map<string, { rank: number; at: number; length: number }>();
  for (const m of kept) {
    const had = place.get(m.card.id);
    const rank = mentionRank(m);
    if (had === undefined || rank > had.rank) place.set(m.card.id, { rank, at: m.at, length: m.end - m.at });
  }
  // A card named only inside another's longer name: the least of them.
  const placeOf = (x: NamedCard) => place.get(x.id) ?? { rank: -1, at: Number.POSITIVE_INFINITY, length: 0 };
  const best = Math.max(...live.map((x) => placeOf(x).rank));
  let field = live.filter((x) => placeOf(x).rank === best);
  // A name with no card leads only when every card named sits in an aside
  // ("what has Han been to Mike"). A card asked about or named plainly leads
  // as before, and the name is said to have none (review of #347).
  if (bareFirst !== null && kept.every((m) => m.slot === "aside")) {
    return { card: null, alike: [], bare: bareFirst, bareAlike: [] };
  }
  if (field.length > 1 && o.ownerCard !== null) field = field.filter((x) => x.id !== o.ownerCard);
  field.sort((a, b) => {
    const pa = placeOf(a);
    const pb = placeOf(b);
    return pa.at - pb.at || pb.length - pa.length || b.ids.length - a.ids.length || a.name.localeCompare(b.name);
  });
  const [card, ...rest] = field;
  return {
    card: card ?? null,
    alike: rest.map((x) => x.name),
    bare: null,
    // Each name with no card asked about as high as the card that leads, or higher.
    bareAlike: bare.filter((b) => b.rank >= best).map((b) => b.name),
  };
}

/** Month and weekday names: capitalised, and a time, never a subject. */
const CALENDAR_NAMES = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

/**
 * Words a question is built from, never a name: one of them capitalised
 * mid-sentence means the question was typed in Title Case ("What Has Changed
 * Since Monday"), which capitalises nothing in particular (review of #347).
 * Not "will", "may" or "can", which are names too.
 */
const TITLE_CASE_TELLS = new Set([
  "has", "have", "had", "is", "are", "was", "were", "been", "did", "does",
  "the", "of", "to", "in", "on", "at", "for", "with", "about", "from", "into", "than", "and", "or", "since",
  "what", "how", "when", "why", "where", "who", "this", "that", "it", "you", "your", "we", "our",
  "they", "their", "his", "her", "him", "them",
]);

/**
 * The names the asker capitalised mid-sentence (`askedNames`) that no kept
 * card mention covers — "Han", or "Han Seo" for two in a row — with where
 * each sits. Not the owner's name, not a month or a weekday ("since March"
 * is a time), and not a word of a card's longer name ("Marguerite" when
 * Marguerite Solberg has a card: there IS a card). Not an acronym or a word
 * with a digit ("API", "Q3"): a thing's label, not a name. Nothing in a
 * question typed in Title Case. A possessive is dropped ("Han's" names Han).
 */
function uncardedNames(
  question: string,
  taken: readonly { readonly at: number; readonly end: number }[],
  ownerNames: ReadonlySet<string>,
  cardWord: (word: string) => boolean,
): { name: string; at: number; end: number; slot: Slot }[] {
  const proper = safe(() => askedNames(question), new Set<string>());
  if (proper.size === 0) return [];
  if ([...proper].some((w) => TITLE_CASE_TELLS.has(w))) return [];
  const out: { name: string; at: number; end: number; slot: Slot }[] = [];
  let run: { at: number; end: number; parts: string[]; closed: boolean } | null = null;
  const flush = (): void => {
    const r = run as { at: number; end: number; parts: string[]; closed: boolean } | null;
    if (r !== null) out.push({ name: r.parts.join(" "), at: r.at, end: r.end, slot: slotAt(question, r.at) });
    run = null;
  };
  for (const m of question.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*/g)) {
    const tok = m[0];
    const at = m.index;
    const end = at + tok.length;
    const word = tok.replace(/['’]s?$/, "");
    const low = word.toLowerCase();
    const isName =
      /^[A-Z]/.test(tok) &&
      proper.has(tok.toLowerCase().replace(/['’]/g, "")) &&
      !/\d/.test(word) &&
      !/^[A-Z][A-Z]/.test(word) &&
      !CALENDAR_NAMES.has(low) &&
      !ownerNames.has(low) &&
      !taken.some((t) => at < t.end && end > t.at) &&
      !tokenize(word).some((w) => cardWord(w));
    const current = run as { at: number; end: number; parts: string[]; closed: boolean } | null;
    if (isName && current !== null && !current.closed && /^[ \t]+$/.test(question.slice(current.end, at))) {
      current.parts.push(word);
      current.end = end;
      current.closed = word !== tok;
      continue;
    }
    flush();
    if (isName) run = { at, end, parts: [word], closed: word !== tok };
  }
  flush();
  return out;
}

/** A name with no card as a topic, as typed ("Han", not "han"): its words only. */
function nameTopic(name: string): TopicWords {
  const typed = name.split(/\s+/).filter((w) => w.length > 0);
  return {
    words: typed.map((w) => w.toLowerCase()),
    names: new Map(typed.map((w) => [w.toLowerCase(), nameRegex(w, "gu")])),
    shown: [name],
  };
}

/** The place a name at `index` sits in: about, aside, or plain. */
function slotAt(question: string, index: number): Slot {
  const before = question.slice(0, index);
  if (ABOUT_BEFORE.some((re) => re.test(before))) return "about";
  return ASIDE_BEFORE.test(before) ? "aside" : "plain";
}

/** "A", "A and B", "A, B and C". */
function andList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] as string}`;
}

/**
 * The question's words a topic is read by. `words` are lower-case tokens;
 * `names` maps the ones the asker CAPITALISED mid-sentence (a name or a
 * proper noun, `feeling-ask.ts#askedNames`) to a regex for the word as typed,
 * case kept; `shown` is the words as a header prints them.
 */
interface TopicWords {
  readonly words: readonly string[];
  readonly names: ReadonlyMap<string, RegExp>;
  readonly shown: readonly string[];
}

/**
 * The question's rarer words: not its frame, not a feeling word, not held by a
 * quarter of the store. A word the asker capitalised mid-sentence is kept
 * whatever it is ("what do I know about Will": lower-case "will" is frame, the
 * asker's Will is a name, as `feeling-ask.ts#askedNames` reads it), and is
 * matched as typed, case kept, so the modal "will" in a hundred memories does
 * not stand in for him (review of #323). `skip` leaves out more (a feeling
 * question's own frame).
 */
function contentWords(
  c: Counterpart,
  question: string,
  minLen: number,
  feelingNamed: ReadonlySet<string>,
  skip: (w: string) => boolean = () => false,
): TopicWords {
  const proper = safe(() => askedNames(question), new Set<string>());
  const asTyped = new Map<string, string>();
  for (const m of question.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*/g)) {
    const tok = m[0].replace(/['’]s?$/, "");
    const low = tok.toLowerCase();
    if (proper.has(low) && /^[A-Z]/.test(tok) && !asTyped.has(low)) asTyped.set(low, tok);
  }
  const names = new Map<string, RegExp>();
  for (const [low, typed] of asTyped) names.set(low, nameRegex(typed, "gu"));
  const candidates = [...new Set(tokenize(question))].filter(
    (w) => !skip(w) && (names.has(w) || (w.length >= minLen && !FRAME.has(w) && !feelingNamed.has(w))),
  );
  const out = (words: string[]): TopicWords => ({ words, names, shown: words.map((w) => asTyped.get(w) ?? w) });
  if (candidates.length === 0) return out([]);
  const total = safe(() => c.store.countMemories({ archived: false }), 0);
  if (total < 20) return out(candidates);
  const df = safe(() => c.store.docFrequency(candidates), new Map<string, number>());
  return out(candidates.filter((w) => names.has(w) || (df.get(w) ?? 0) <= total * COMMON_SHARE));
}

/** How many times `text` names the asker's capitalised word, case kept. */
function namedCount(text: string, re: RegExp): number {
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}

/**
 * HOLD WHAT THE QUESTION'S WORDS REACH (BM25, `MEANING_WORDS_MAX`), and the
 * matchers a chapter's words and line are read by. A memory the search reached
 * only through a capitalised word must name it as typed: "Will" is not "will".
 * Returns how many memories it held.
 */
function holdByWords(
  store: Counterpart["store"],
  topic: TopicWords,
  usable: (id: string) => MemoryRow | null,
  hold: (id: string, weight: number) => void,
): { textMatch: (text: string) => number; lineMatch: RegExp[]; held: number } {
  const words = topic.words;
  const plain = words.filter((w) => !topic.names.has(w));
  const hits = safe(() => store.search(words.join(" "), MEANING_WORDS_MAX), []).filter((h) => {
    if (topic.names.size === 0) return true;
    const row = usable(h.id);
    if (row === null) return false;
    const text = `${row.title ?? ""}\n${row.body}`;
    if ([...topic.names.values()].some((re) => namedCount(text, re) > 0)) return true;
    const have = new Set(tokenize(text));
    return plain.some((w) => have.has(w));
  });
  const top = hits[0]?.score ?? 0;
  let held = 0;
  for (const h of hits) {
    if (top > 0 && usable(h.id) !== null) {
      hold(h.id, h.score / top);
      held += 1;
    }
  }
  const need = Math.max(1, Math.ceil(words.length / 2));
  const textMatch = (text: string): number => {
    const have = new Set(tokenize(text));
    const n = words.filter((w) => {
      const re = topic.names.get(w);
      return re === undefined ? have.has(w) : namedCount(text, re) > 0;
    }).length;
    return n >= need ? n / words.length : 0;
  };
  const lineMatch = words.map((w) => {
    const re = topic.names.get(w);
    return re === undefined ? wholeWordRegex(w) : new RegExp(re.source, "u");
  });
  return { textMatch, lineMatch, held };
}

function feelingName(named: ReadonlySet<string>, who: FeelingWhose | null, whose: { readonly self: string; readonly owner: string }): string {
  const words = [...named].filter((w) => w.length > 0);
  const what = words.length > 0 ? words.slice(0, 3).join(" / ") : "feelings";
  return who === null ? what : `${what} (${whose[who]})`;
}

/** The owner's name as written on the identity core, or null. */
function ownerDisplayName(c: Counterpart): string | null {
  const name = safe(() => identityCoreName(c.store), null);
  return name === null || name.length < 2 ? null : (name.split(/\s+/)[0] ?? null);
}

function ownerNamesLower(c: Counterpart): string[] {
  const n = ownerDisplayName(c);
  return n === null ? [] : [n.toLowerCase()];
}

function momentOf(r: MemoryRow, zone: string | undefined): MeaningMoment {
  return {
    id: r.id,
    title: clip(oneLine(r.title !== null && r.title.trim().length > 0 ? r.title : firstLine(r.body)), TITLE_CHARS),
    date: (r.created_at === null ? null : localDay(r.created_at, zone)) ?? r.learned_on,
  };
}

/** A chapter's line: the first sentence a matcher finds, else its first; headings and markup off. */
function lineOf(text: string, matchers: readonly RegExp[], max: number): string {
  const flat = oneLine(text.replace(/^#{1,6}[^\n]*$/gm, " ").replace(/[*_`>]+/g, ""));
  const sentences = flat.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const hit = sentences.find((s) => matchers.some((re) => re.test(s)));
  return clip(hit ?? sentences[0] ?? flat, max);
}

function parseMeta(meta: string): Record<string, unknown> {
  try {
    const v = JSON.parse(meta || "{}") as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function localDay(at: number, zone: string | undefined): string | null {
  const d = localDate(at, zone);
  return d.length === 0 ? null : d;
}

function emptyNull(s: string): string | null {
  return s.length === 0 ? null : s;
}

function daysApart(a: string, b: string): number {
  return safe(() => Math.abs(daysBetween(a, b)), Number.POSITIVE_INFINITY);
}

/** `MM-DD` for a whole day (the arc's own entries keep the year); ranges and months as written. */
function short(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.slice(5) : ymd;
}

function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim().length > 0) ?? body;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function num(x: number): string {
  return x.toFixed(1).replace(/^0\./, ".");
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
