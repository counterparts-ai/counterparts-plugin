/**
 * FACTS MODE — `recall` with `mode: "facts"` (Release B of deliberate recall,
 * 2026-10-03; design `~/counterparts-notes/2026-10-03-deliberate-recall-
 * design.md`, held lightly and revisited after a few days of use).
 *
 * A question asked on purpose gets EVERY memory it matches, by any of four
 * ways, ranked by how strongly it matched:
 *
 *   - **words** — every memory sharing a content word with the question (the
 *     token index, every hit: `store.search` with a limit of the word's own
 *     document count), each word weighted by its rarity (`cues.ts#
 *     informativeness`); the score is the share of the question's rarity a
 *     memory holds, shaded by how much of it (BM25 within the word);
 *   - **meaning** — the `FACTS_MEANING_CAP` nearest by the question's
 *     embedding, above the floor ambient recall uses for this embedder
 *     (`recall/tunables.ts#semanticTuning`, inline path);
 *   - **subjects** — every memory linked to an entity card the question names
 *     (`schemas#subjectsIn` → `store.memoriesNaming`, the v12 links), weighted
 *     by how rare the card is;
 *   - **time** — a window the question names (`recall/time-ask.ts`) FILTERS:
 *     only memories inside it, by when the thing happened (`occurred_on`) or,
 *     with no event date, when it was learned (and the line says which), plus a
 *     count of the matches outside it. A question that is only time ("what
 *     happened last week?") answers with everything in the window. An event
 *     anchor ("around the cut-over") is resolved by searching the phrase and
 *     taking the top match's date, shown in the header; "the last session" is
 *     the session the wake's "Last here" names (else the newest here), and its
 *     own rows lead.
 *
 * A memory matched several ways scores the sum, so it ranks higher; recency
 * only breaks ties. Nothing here calls `Recall.build()` — this is its own
 * path, with its own pool and its own ranking, and tuning ambient recall does
 * not move it (nor the reverse).
 *
 * REBUILT HERE, not inherited from the ambient path: a chapter and its own
 * copy are one result (the chapter); a near-duplicate of a result already
 * kept is left out (`NEAR_DUPLICATE`, token overlap); the self page and the
 * handoffs are never results; a chapter is labeled journal; a confidential
 * memory is left out of a non-owner's list, silently (counted on the durable
 * row only).
 *
 * FOLDING. Each result is the CURRENT version of a fact. Earlier versions are
 * folded under it: in-place revisions (`versions` rows whose words differ)
 * and memories it settled as `changed` (a contradiction pair) — an earlier
 * one that matched brings its current one in as the result. Corrected
 * versions (they were wrong) are never results — archived, they are out of
 * the word index — but are named under the memory that corrected them, up to
 * `FACTS_CORRECTED_SHOWN` with a count for the rest, each labeled "corrected
 * (was wrong)" with its id, so one a wrong correction archived can still be
 * opened (2026-10-09). An `open` pair says "disagrees with", an unsettled
 * older one "may be out of date".
 *
 * FADED. A matched memory BELOW REACH (physics `REACH`, 2026-10-10 — the line
 * ambient recall leaves out; `hasFaded`, the rule meaning mode uses too) is
 * ranked WITH the live matches, by how strongly it matched, with its body,
 * and labeled faded; the header counts how many of the matches are faded.
 * Journal chapters and schemas never fade here. Being shown strengthens
 * nothing; opening it by id, or quoting the words shown, credits it as for
 * any result, which brings it back. Forgetting lives in the ambient channels
 * (turn recall, spreading, the wake); this effortful door reaches weak traces.
 *
 * Revised by b2+f8, 2026-10-10, from Mike's 2026-10-03 ruling (faded matches
 * listed after the main results as title lines), lightly held. Why: the
 * benchmark dropped 15 (multi-session counts one item short — the missing
 * item was a faded title line past the pages read); inline-with-bodies
 * recovered it with no single-fact cost (bench R2-2,
 * ~/counterparts-bench/TUNING-LOG.md). Fallback if faded matches are ever
 * seen crowding fresh ones on a live store: variant (a″), a mild fade-scaled
 * penalty on the ORDER only (score × (1 − 0.3 × (1 − strength/REACH))).
 *
 * THE ANSWER (what `renderFacts` writes; the server ships it as `answer`):
 *
 *   12 match · showing 10 · 2 more → page 2 · 3 of them faded
 *   time: last week → 09-21..09-27, stretched 2 days each side · 4 more match outside it
 *   about: Han
 *   may not be everything: meaning search hit its cap (100) · 3 weak matches not shown
 *
 *   1. Gym moved to 6am · mem_… · words, subject
 *      you said · done · happened 09-28
 *      learned 09-28 in ~/counterparts · session a1b2c3d4 · CURRENT
 *      earlier: "gym at 7" (learned 09-12), changed 09-28 · mem_…
 *      corrected (was wrong): "gym on Tuesdays" (learned 09-10), corrected 09-11 · mem_…
 *      <the body whole when short, else a 300-character excerpt>
 *
 *   2. Old gym schedule · mem_… · words · faded: not used for a long while
 *      …its lines and body, as for any result
 *
 * The header counts DISTINCT facts (folded versions are not counted apart).
 * "may not be everything" is said only when a cap cut or a weak tail was left
 * out, with the reason. `page: N` pages in a stable order. Unknown fields say
 * so ("speaker unknown"): most rows predate v12. The whole answer stays under
 * `RECALL_RESULT_CHARS`.
 *
 * Pure: reads only, writes nothing — the console's `ask` runs it on a
 * read-only store. NO MODEL CALL.
 */
import type { Counterpart } from "../../core/counterpart.js";
import { sessionsHere } from "../../core/coverage/index.js";
import { chaptersOf } from "../../core/handoff/last-here.js";

import {
  OPEN_END,
  OPEN_START,
  informativeness,
  localKey,
  readTimeAsk,
  semanticTuning,
} from "../../core/recall/index.js";
import type { DayWindow, FeelingWhose, SemanticSource, TimeAsk } from "../../core/recall/index.js";
import { STOPWORDS } from "../../core/recall/reference.js";
import { tokenize } from "../../core/store/index.js";
import type { ContradictionRow, RecallRow } from "../../core/store/index.js";
import { addDays, localDate, parseCalendarDate } from "../../core/time.js";
import { UNBOUND_SESSION } from "../../core/types.js";
import {
  RECALL_EXCERPT_CHARS,
  RECALL_MAX_IDS,
  RECALL_RESULT_CHARS,
  cutExcerpt,
  hasFaded,
  nightlyMade,
  provenanceParts,
} from "./deliberate.js";

// ── the working defaults (held lightly; revisit after a few days of use) ────

/** Results on one page. The design's judgment call; tune at the revisit. */
export const FACTS_PAGE_SIZE = 10;
/** The meaning search's cap: the only one of the four ways that is capped. */
export const FACTS_MEANING_CAP = 100;
/**
 * WEAK: a match scoring below this share of the best match's score is left
 * out, and counted ("3 weak matches not shown"). Not applied to a question
 * that is only a time window, where every row in it matched the same way.
 */
export const FACTS_WEAK_FRACTION = 0.2;
/** Earlier versions shown under a result; the rest are counted. */
export const FACTS_EARLIER_SHOWN = 2;
/**
 * Corrected versions named under a result; the rest are counted. One more than
 * the earlier ones: an earlier (`changed`) memory is still live, so a question's
 * words reach it and fold it under its current one, while a corrected one is
 * archived and out of the word index — this line is its only way in from a
 * question (2026-10-09).
 */
export const FACTS_CORRECTED_SHOWN = 3;
/** Token overlap at or above which two results are near-duplicates (the gate's `NEAR_DUPLICATE`). */
export const FACTS_NEAR_DUPLICATE = 0.85;
/** How far an event anchor's window reaches each side of its date. */
export const FACTS_ANCHOR_DAYS = 2;

/**
 * The journal label, once per answer that shows a chapter (owner ruling
 * 2026-09-04, §I14: a chapter stays recallable and is never presented as a
 * memory; `deliberate.ts#JOURNAL_GLOSS` says the same on the id path).
 */
export const FACTS_JOURNAL_GLOSS =
  "[journal] = a chapter: the first-person account memories were made from, not a memory — outside decay, dedup and the prune, and not a claim about the world the way a memory is.";

/** Words that ask nothing of their own in a question (beyond `reference.ts#STOPWORDS`). */
const ASKS_NOTHING = new Set([
  "remember", "remembered", "recall", "tell", "happened", "happen", "happens", "decide", "decided",
  "anything", "something", "everything", "ever", "else", "did", "does", "do", "talk", "talked",
  "discuss", "discussed", "mention", "mentioned", "about", "whats", "who", "whom", "whose",
]);

/** The words only a facts question's own wording carries, never its content. */
function contentTokens(text: string): string[] {
  return [...new Set(tokenize(text))].filter((t) => !STOPWORDS.has(t) && !ASKS_NOTHING.has(t) && !/^\d{1,2}$/.test(t));
}

/**
 * What facts mode reads off the counterpart — a `Counterpart` is one; a tool
 * holding only a store and a recall (`tools/recall-bench`) can pass those, and
 * the subject way and "the last session" then answer nothing.
 */
export interface FactsSource {
  readonly store: Counterpart["store"];
  readonly recall: { readonly tunables: Counterpart["recall"]["tunables"] };
  readonly schemas?: Pick<Counterpart["schemas"], "subjectsIn" | "aliasIndex">;
  readonly spans?: Counterpart["spans"];
  readonly chaptersHereFor?: Counterpart["chaptersHereFor"];
}

export interface FactsContext {
  readonly counterpart: FactsSource;
  readonly sessionId: string;
  /** The owner's own session? Confidentiality turns on this and nothing else. */
  readonly owner: boolean;
  /** The asking session's directory, for "the last session"; none at the console. */
  readonly scope?: string;
  /** The question embedded in line; null when it could not be. */
  readonly vector: readonly number[] | null;
  readonly semantic: SemanticSource;
  /** Not read by facts mode; here so one context object serves both modes. */
  readonly asker?: FeelingWhose;
}

export type FactWay = "words" | "meaning" | "subject" | "time" | "session";

export interface EarlierVersion {
  /** Its title, or the start of its words. */
  readonly text: string;
  readonly learned: string | null;
  /** When it stopped being current, `YYYY-MM-DD` in the store's zone. */
  readonly changed: string | null;
  /** A separate memory (a `changed` pair) has an id to open; an in-place version has none. */
  readonly id?: string;
}

/**
 * A version settled as `corrected` — it was wrong. Archived, so never a result
 * of its own; named under the memory that corrected it so it can be opened by
 * id (a wrong correction must not make a true memory unreachable).
 */
export interface CorrectedVersion {
  /** Its title, or the start of its words. */
  readonly text: string;
  readonly learned: string | null;
  /** When it was corrected, `YYYY-MM-DD` in the store's zone. */
  readonly corrected: string | null;
  readonly id: string;
}

export interface FactItem {
  readonly id: string;
  /** Below reach (`deliberate.ts#hasFaded`): ranked with the rest, body shown, labeled faded. */
  readonly faded: boolean;
  readonly title: string | null;
  /** The title, or the start of the words when there is none. */
  readonly line: string;
  readonly kind: string;
  readonly journal: boolean;
  /** For a journal entry: which chapter the excerpt is from, of how many. */
  readonly chapter?: { readonly n: number; readonly of: number };
  /** The words: whole when short, else an excerpt. */
  readonly body: string;
  readonly bodyChars: number;
  readonly whole: boolean;
  readonly saidBy: string | null;
  readonly status: string | null;
  readonly occurredOn: string | null;
  /** When it was learned, `YYYY-MM-DD` in the store's zone (a chapter: when first written). */
  readonly learned: string | null;
  /** A chapter's latest write, when later than `learned`. */
  readonly lastWritten?: string | null;
  readonly where: string | null;
  readonly who: string | null;
  /** True unless it is an earlier version shown on its own (its current one not shown). */
  readonly current: boolean;
  /** For an earlier version shown on its own: the current one's id ("a later version" when this asker may not be told it). */
  readonly now?: string;
  readonly earlier: readonly EarlierVersion[];
  readonly earlierMore: number;
  /** Corrected (wrong) versions of it: every one, named or not. */
  readonly corrected: number;
  /**
   * The corrected versions named, at most `FACTS_CORRECTED_SHOWN`: those the
   * question's words reach first, then the latest corrected. Absent when none
   * is named (none corrected, or none this asker may be told of).
   */
  readonly correctedShown?: readonly CorrectedVersion[];
  /** Pair labels besides earlier/corrected: disagrees with, unsettled. */
  readonly standing: readonly string[];
  readonly ways: readonly FactWay[];
  /** Under a time window: whether its event date or (none recorded) its learned date put it there. */
  readonly timeBy?: "event" | "learned";
  readonly score: number;
}

export interface FactsTime {
  readonly cue: string;
  readonly said: DayWindow | null;
  readonly window: DayWindow | null;
  readonly stretch: number;
  /** An event or the last session, resolved — or `date: null` when it could not be. */
  readonly anchor?: {
    readonly kind: "event" | "session";
    readonly phrase: string;
    readonly date: string | null;
    readonly id?: string;
    readonly session?: string;
  };
  /** Matches that fell outside the window (the same ways, not weak). */
  readonly outside: number;
}

export interface FactsResult {
  readonly mode: "facts";
  readonly reason: "answered" | "nothing-came";
  readonly semantic: SemanticSource;
  /** Distinct facts that matched (main list, folded versions not counted apart). */
  readonly matched: number;
  readonly page: number;
  readonly pages: number;
  /** The page's results, in order. */
  readonly memories: readonly FactItem[];
  /** How many of the `matched` facts are faded (below reach): ranked with the rest, each labeled. */
  readonly faded: number;
  readonly weak: number;
  readonly duplicates: number;
  readonly meaningCapped: boolean;
  readonly time: FactsTime | null;
  readonly subjects: readonly { readonly id: string; readonly name: string }[];
  /** Every candidate any way reached, before the window, folding and the weak tail. */
  readonly considered: number;
  /** Live rows in the store. */
  readonly storeSize: number;
  /** What kept a matched row out, counted — for the durable row only, never the wire. */
  readonly blockedBy: Readonly<Record<string, number>>;
  /** Today in the store's zone — what the answer's short dates are relative to. */
  readonly today: string;
}

interface Candidate {
  readonly id: string;
  score: number;
  readonly ways: Set<FactWay>;
  timeBy?: "event" | "learned";
  /** Earlier memories (changed pairs) folded into this one because they matched. */
  readonly foldedEarlier: Set<string>;
}

/** The row's learned moment and dates in the store's zone. */
function learnedOf(row: RecallRow, zone: string): string | null {
  if (row.created_at !== null && row.created_at > 0) return localDate(row.created_at, zone);
  return row.learned_on.length > 0 ? row.learned_on : null;
}

function metaOf(row: RecallRow): Record<string, unknown> {
  if (row.meta === null || row.meta.length === 0) return {};
  try {
    const m = JSON.parse(row.meta) as unknown;
    return m !== null && typeof m === "object" ? (m as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Never a result: the self page (delivered whole at the wake) and a handoff (a directory's pointer). */
function neverAResult(row: RecallRow): boolean {
  if (row.type !== "schema") return false;
  const role = metaOf(row)["role"];
  return role === "page" || role === "handoff";
}

function sessionOf(row: RecallRow): string | null {
  if (row.origin_session !== null && row.origin_session.length > 0) return row.origin_session;
  if (row.type === "episode") {
    const s = metaOf(row)["sessionId"];
    return typeof s === "string" ? s : null;
  }
  return null;
}

/**
 * Is the row inside the window — by its event date when it has one, else by
 * when it was learned (a chapter: anywhere between its first and latest
 * write)? A clock window also asks the learned moment's time of day.
 */
function inWindow(
  row: RecallRow,
  window: DayWindow,
  clock: TimeAsk["clock"],
  zone: string,
  chapterDates?: (id: string) => readonly string[],
): "event" | "learned" | null {
  // A chapter is also inside the window when one of its headings is dated
  // there: an episode written up the next morning names the day it was about.
  if (row.type === "episode" && chapterDates !== undefined && clock === null) {
    if (chapterDates(row.id).some((d) => d >= window.from && d <= window.to)) return "learned";
  }
  if (row.occurred_on !== null) {
    const c = parseCalendarDate(row.occurred_on);
    if (c !== null) return c.first <= window.to && c.last >= window.from ? "event" : null;
  }
  const first = row.created_at;
  if (first === null || first <= 0) {
    const d = row.learned_on;
    return d.length > 0 && d >= window.from && d <= window.to ? "learned" : null;
  }
  const last = row.type === "episode" && row.updated_at !== null ? Math.max(first, row.updated_at) : first;
  if (clock !== null) {
    return localKey(last, zone) >= clock.from && localKey(first, zone) <= clock.to ? "learned" : null;
  }
  return localDate(last, zone) >= window.from && localDate(first, zone) <= window.to ? "learned" : null;
}

/** A date for a header or a line: `MM-DD` this year, else the whole date. */
export function shortDate(ymd: string | null, today: string): string {
  if (ymd === null || ymd.length === 0) return "";
  const c = parseCalendarDate(ymd);
  if (c === null) return ymd;
  const year = today.slice(0, 4);
  const one = (d: string): string => (d.slice(0, 4) === year ? d.slice(5) : d);
  if (c.precision === "day") return one(c.first);
  if (c.precision === "range") return `${one(c.first)}..${one(c.last)}`;
  return c.text;
}

function plainLine(text: string, max: number): string {
  const flat = text
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * THE FACTS ANSWER to one question. Reads only; never throws on a row that
 * will not read (that row is skipped).
 */
export function factsRecall(ctx: FactsContext, question: string, opts: { page?: number } = {}): FactsResult {
  const store = ctx.counterpart.store;
  const zone = store.zone();
  const now = store.now();
  const today = localDate(now, zone);
  const day = store.livedDay();
  const page = opts.page !== undefined && Number.isInteger(opts.page) && opts.page >= 1 ? opts.page : 1;

  // ── the rows, once ──────────────────────────────────────────────────────
  const denied = new Set(safe(() => store.deniedIds(), [] as string[]));
  const rows = new Map<string, RecallRow>();
  for (const r of safe(() => store.recallRows(), [] as RecallRow[])) {
    if (denied.has(r.id)) continue;
    rows.set(r.id, r);
  }
  const storeSize = rows.size;
  const blockedBy: Record<string, number> = {};
  const blocked = (why: string): void => {
    blockedBy[why] = (blockedBy[why] ?? 0) + 1;
  };
  /** A row that may be a result for this asker. */
  const visible = (id: string): RecallRow | undefined => {
    const r = rows.get(id);
    if (r === undefined || neverAResult(r)) return undefined;
    if (!ctx.owner && r.confidential === 1) return undefined;
    return r;
  };

  // ── time ────────────────────────────────────────────────────────────────
  const time = safe(() => readTimeAsk(question, { now, zone }), null);
  let rest = time?.rest ?? question;
  let window: DayWindow | null = time?.window ?? null;
  let anchor: FactsTime["anchor"];
  let anchorSession: string | null = null;
  let anchorStretch: Stretch | null = null;

  const words = (text: string): { scores: Map<string, number>; idfTotal: number; tokens: string[] } => {
    const tokens = contentTokens(text);
    const df = safe(() => store.docFrequency(tokens), new Map<string, number>());
    const scores = new Map<string, number>();
    let idfTotal = 0;
    for (const tok of tokens) {
      const n = df.get(tok) ?? 0;
      const idf = informativeness(n, storeSize);
      if (n <= 0 || idf <= 0) continue;
      idfTotal += idf;
      const hits = safe(() => store.search(tok, n), []);
      const top = hits[0]?.score ?? 0;
      for (const h of hits) {
        const shade = top > 0 ? 0.5 + 0.5 * (h.score / top) : 1;
        scores.set(h.id, (scores.get(h.id) ?? 0) + idf * shade);
      }
    }
    if (idfTotal > 0) for (const [id, s] of scores) scores.set(id, s / idfTotal);
    return { scores, idfTotal, tokens };
  };

  if (time?.anchor?.kind === "event") {
    const phrase = time.anchor.phrase;
    const found = words(phrase).scores;
    let best: { id: string; score: number } | null = null;
    for (const [id, score] of found) {
      if (visible(id) === undefined) continue;
      if (best === null || score > best.score || (score === best.score && id < best.id)) best = { id, score };
    }
    const row = best === null ? undefined : rows.get(best.id);
    const date = row === undefined ? null : (parseCalendarDate(row.occurred_on ?? "")?.first ?? learnedOf(row, zone));
    if (date !== null && best !== null) {
      window = { from: addDays(date, -FACTS_ANCHOR_DAYS), to: addDays(date, FACTS_ANCHOR_DAYS) };
      anchor = { kind: "event", phrase, date, id: best.id };
    } else {
      // Nothing names it: the phrase stays part of the question, and nothing is filtered by time.
      anchor = { kind: "event", phrase, date: null };
      rest = question;
    }
  } else if (time?.anchor?.kind === "session") {
    const found = lastSession(ctx, rows, zone);
    if (found !== null) {
      window = { from: found.from, to: found.to };
      anchorSession = found.session;
      anchorStretch = found.stretch;
      anchor = { kind: "session", phrase: time.cue, date: found.from === found.to ? found.from : `${found.from}..${found.to}`, session: found.session };
    } else {
      anchor = { kind: "session", phrase: time.cue, date: null };
    }
  }

  // ── the four ways ───────────────────────────────────────────────────────
  const w = words(rest);
  const subjectIds = safe(() => ctx.counterpart.schemas?.subjectsIn(rest) ?? [], [] as string[]);
  const subjects: { id: string; name: string }[] = [];
  const subjectScore = new Map<string, number>();
  const unit = Math.max(w.idfTotal, informativeness(1, storeSize), 1e-9);
  for (const s of subjectIds) {
    const members = safe(() => store.memoriesNaming(s), [] as string[]);
    const name = safe(() => ctx.counterpart.schemas?.aliasIndex().termsFor(s)?.name ?? null, null) ?? s;
    subjects.push({ id: s, name });
    if (members.length === 0) continue;
    const weight = Math.min(1, informativeness(members.length, storeSize) / unit);
    for (const m of members) subjectScore.set(m, Math.max(subjectScore.get(m) ?? 0, Math.max(weight, 0.05)));
  }
  // A question that is only time asks for the window, and its meaning is
  // "what happened": the embedding of that would rank noise.
  const onlyTime = window !== null && w.tokens.length === 0 && subjectIds.length === 0;
  const meaningScore = new Map<string, number>();
  let meaningCapped = false;
  if (ctx.vector !== null && ctx.vector.length > 0 && !onlyTime) {
    const hits = safe(() => store.nearestTo(ctx.vector as number[], FACTS_MEANING_CAP), []);
    const tuning = semanticTuning(ctx.counterpart.recall.tunables, safe(() => store.rankingIdentity(), null), "inline");
    const floor = tuning.floor;
    for (const h of hits) {
      if (h.score < floor) continue;
      meaningScore.set(h.id, floor >= 1 ? h.score : (h.score - floor) / (1 - floor));
    }
    const last = hits[hits.length - 1];
    meaningCapped = hits.length >= FACTS_MEANING_CAP && last !== undefined && last.score >= floor;
  }

  const pool = new Map<string, Candidate>();
  const add = (id: string, way: FactWay, score: number): void => {
    let c = pool.get(id);
    if (c === undefined) {
      c = { id, score: 0, ways: new Set(), foldedEarlier: new Set() };
      pool.set(id, c);
    }
    c.score += score;
    c.ways.add(way);
  };
  for (const [id, s] of w.scores) add(id, "words", s);
  for (const [id, s] of meaningScore) add(id, "meaning", s);
  for (const [id, s] of subjectScore) add(id, "subject", s);
  const datesHeld = new Map<string, readonly string[]>();
  const chapterDates = (id: string): readonly string[] => {
    const held = datesHeld.get(id);
    if (held !== undefined) return held;
    const dates = safe(
      () => chaptersOf(store.readProse(id).body).map((ch) => ch.date).filter((d): d is string => d !== null),
      [] as string[],
    );
    datesHeld.set(id, dates);
    return dates;
  };
  if (onlyTime && window !== null) {
    for (const [id, r] of rows) {
      if (r.type === "schema") continue;
      if (inWindow(r, window, time?.clock ?? null, zone, chapterDates) !== null) add(id, "time", 0.1);
    }
  }
  /** Is this row the anchor session's own — its words, not the nightly run's? */
  const ofAnchorSession = (r: RecallRow): boolean => {
    if (anchorSession === null || nightlyMade(r) !== null) return false;
    const s = sessionOf(r);
    if (s === anchorSession) return true;
    // A note from before the server knew its session, placed by when it was
    // written: in this directory, inside the session's stretch and no other's.
    return s === UNBOUND_SESSION && anchorStretch !== null && placedIn(r, anchorStretch);
  };
  const considered = pool.size;

  // ── visibility, the window, the session ────────────────────────────────
  // Matches outside the window are held apart, not dropped: they are folded
  // and weighed as the results are, so the count says "N more match outside
  // it" in distinct facts, without the weak tail (review of #323).
  const beyond = new Map<string, Candidate>();
  for (const [id, c] of [...pool]) {
    const r = rows.get(id);
    if (r === undefined || neverAResult(r)) {
      pool.delete(id);
      continue;
    }
    if (!ctx.owner && r.confidential === 1) {
      blocked("confidential-withheld");
      pool.delete(id);
      continue;
    }
    if (window !== null) {
      const by = inWindow(r, window, time?.clock ?? null, zone, chapterDates);
      if (by === null) {
        beyond.set(id, c);
        pool.delete(id);
        continue;
      }
      c.timeBy = by;
      c.ways.add("time");
    }
    if (ofAnchorSession(r)) {
      c.score += 1;
      c.ways.add("session");
    }
  }

  // ── a chapter and its own copy are one result: the chapter ─────────────
  const foldCopies = (into: Map<string, Candidate>): void => {
    for (const [id, c] of [...into]) {
      const r = rows.get(id) as RecallRow;
      if (r.type !== "memory" || r.source !== "episode" || r.origin_ref === null || !r.origin_ref.startsWith("epi_")) continue;
      const chapter = r.origin_ref;
      if (visible(chapter) === undefined) continue;
      const to = into.get(chapter) ?? { id: chapter, score: 0, ways: new Set<FactWay>(), foldedEarlier: new Set<string>(), ...(c.timeBy === undefined ? {} : { timeBy: c.timeBy }) };
      to.score = Math.max(to.score, c.score);
      for (const way of c.ways) to.ways.add(way);
      into.set(chapter, to);
      into.delete(id);
    }
  };

  // ── current first: an earlier version that matched brings its current one ──
  const pairs = safe(() => store.contradictions({ limit: 100_000 }), [] as ContradictionRow[]).filter(
    (p) => p.via === null && p.state !== "withdrawn",
  );
  const nowOf = new Map<string, string>();
  for (const p of pairs) {
    if (p.state === "settled" && p.how === "changed" && p.over !== null && p.holds !== null) nowOf.set(p.over, p.holds);
  }
  const foldEarlier = (into: Map<string, Candidate>): void => {
    for (const [id, c] of [...into]) {
      let head = id;
      for (let i = 0; i < 8; i += 1) {
        const next = nowOf.get(head);
        if (next === undefined || visible(next) === undefined) break;
        head = next;
      }
      if (head === id) continue;
      const to = into.get(head) ?? { id: head, score: 0, ways: new Set<FactWay>(), foldedEarlier: new Set<string>(), ...(c.timeBy === undefined ? {} : { timeBy: c.timeBy }) };
      to.score = Math.max(to.score, c.score);
      for (const way of c.ways) to.ways.add(way);
      to.foldedEarlier.add(id);
      into.set(head, to);
      into.delete(id);
    }
  };
  foldCopies(pool);
  foldEarlier(pool);
  foldCopies(beyond);
  foldEarlier(beyond);
  // A fact the window brought in (its chapter, its current version) is not also outside it.
  for (const id of pool.keys()) beyond.delete(id);

  // ── the weak tail ───────────────────────────────────────────────────────
  let weak = 0;
  const best = (m: ReadonlyMap<string, Candidate>): number => {
    let b = 0;
    for (const c of m.values()) if (c.score > b) b = c.score;
    return b;
  };
  const top = best(pool);
  if (!onlyTime && top > 0) {
    for (const [id, c] of [...pool]) {
      if (c.score < FACTS_WEAK_FRACTION * top) {
        weak += 1;
        pool.delete(id);
      }
    }
  }
  // Outside the window, by the same bar — the best match anywhere sets it.
  const topAll = Math.max(top, best(beyond));
  let outside = 0;
  for (const c of beyond.values()) if (onlyTime || topAll <= 0 || c.score >= FACTS_WEAK_FRACTION * topAll) outside += 1;

  // ── faded, and the order ────────────────────────────────────────────────
  // One ranking: a faded match is ranked with the live ones by how strongly
  // it matched, and only labeled (revised 2026-10-10, see the header's FADED).
  const main: Candidate[] = [...pool.values()];
  const fadedIds = new Set<string>();
  for (const c of main) {
    const r = rows.get(c.id) as RecallRow;
    if (r.type !== "memory") continue;
    try {
      if (hasFaded(store.physicsOf(c.id), day)) fadedIds.add(c.id);
    } catch {
      // No physics row: not faded.
    }
  }
  const moment = (id: string): number => {
    const r = rows.get(id);
    return r === undefined ? 0 : (r.type === "episode" ? (r.updated_at ?? r.created_at ?? 0) : (r.created_at ?? 0));
  };
  const order = (a: Candidate, b: Candidate): number =>
    b.score - a.score || moment(b.id) - moment(a.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  main.sort(order);

  // ── near-duplicates, walked in order as far as this page needs ─────────
  const bodies = new Map<string, { title: string | null; body: string }>();
  const read = (id: string): { title: string | null; body: string } | null => {
    const held = bodies.get(id);
    if (held !== undefined) return held;
    try {
      const doc = store.readProse(id);
      const got = { title: doc.title ?? null, body: doc.body };
      bodies.set(id, got);
      return got;
    } catch {
      return null;
    }
  };
  const kept: Candidate[] = [];
  const keptTokens: Set<string>[] = [];
  let duplicates = 0;
  let unreadable = 0;
  const need = page * FACTS_PAGE_SIZE;
  let walked = 0;
  for (const c of main) {
    if (kept.length >= need) break;
    walked += 1;
    const doc = read(c.id);
    if (doc === null) {
      unreadable += 1;
      continue;
    }
    const toks = new Set(tokenize(`${doc.title ?? ""}\n${doc.body}`));
    if (keptTokens.some((k) => jaccard(k, toks) >= FACTS_NEAR_DUPLICATE)) {
      duplicates += 1;
      continue;
    }
    kept.push(c);
    keptTokens.push(toks);
  }
  const matched = kept.length + (main.length - walked);
  if (unreadable > 0) blocked("unreadable");
  if (duplicates > 0) blockedBy["near-duplicate"] = duplicates;
  if (weak > 0) blockedBy["weak"] = weak;
  if (outside > 0) blockedBy["outside-window"] = outside;

  const shown = kept.slice((page - 1) * FACTS_PAGE_SIZE, page * FACTS_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(matched / FACTS_PAGE_SIZE));
  // Faded among the matched: those kept, and those past the walk (not yet
  // checked for near-duplicates, as `matched` counts them).
  const fadedMatched = [...kept, ...main.slice(walked)].filter((c) => fadedIds.has(c.id)).length;

  /**
   * May this asker be told this id exists? A pair line names its other side
   * (`disagrees with mem_…`, `now mem_…`): a confidential or removed memory is
   * not named to a non-owner, as a list never shows it (review of #323).
   */
  const canName = (id: string): boolean => {
    if (denied.has(id)) return false;
    if (ctx.owner) return true;
    const r = rows.get(id) ?? safe(() => store.row(id), undefined);
    return r !== undefined && r.confidential !== 1;
  };
  const memories = shown.map((c) =>
    factItem(ctx, c, rows.get(c.id) as RecallRow, read(c.id) as { title: string | null; body: string }, pairs, w.tokens, today, zone, window, canName, fadedIds.has(c.id)),
  );

  return {
    mode: "facts",
    reason: matched === 0 ? "nothing-came" : "answered",
    semantic: ctx.vector !== null && ctx.vector.length > 0 ? "in-line" : ctx.semantic,
    matched,
    page,
    pages,
    memories,
    faded: fadedMatched,
    weak,
    duplicates,
    meaningCapped,
    time:
      time === null
        ? null
        : {
            cue: time.cue,
            said: anchor !== undefined ? window : time.said,
            window,
            stretch: anchor?.kind === "event" && anchor.date !== null ? FACTS_ANCHOR_DAYS : time.stretch,
            ...(anchor === undefined ? {} : { anchor }),
            outside,
          },
    subjects,
    considered,
    storeSize,
    blockedBy,
    today,
  };
}

/** One result, with its labeled lines' fields filled. */
function factItem(
  ctx: FactsContext,
  c: Candidate,
  row: RecallRow,
  doc: { title: string | null; body: string },
  pairs: readonly ContradictionRow[],
  tokens: readonly string[],
  today: string,
  zone: string,
  window: DayWindow | null,
  canName: (id: string) => boolean,
  faded: boolean,
): FactItem {
  const store = ctx.counterpart.store;
  const journal = row.type === "episode";
  let text = doc.body;
  let chapter: FactItem["chapter"];
  if (journal) {
    // The chapter the question's words reach most, else the first — among
    // the chapters dated inside the question's window, when it named one and
    // any are.
    const all = chaptersOf(doc.body);
    if (all.length > 1) {
      const dated = window === null ? [] : all.map((ch, i) => ({ ch, i })).filter(({ ch }) => ch.date !== null && ch.date >= window.from && ch.date <= window.to);
      const among = dated.length > 0 ? dated : all.map((ch, i) => ({ ch, i }));
      let best = among[0]?.i ?? 0;
      let bestHits = -1;
      for (const { ch, i } of among) {
        const toks = new Set(tokenize(ch.text));
        const hits = tokens.filter((t) => toks.has(t)).length;
        if (hits > bestHits) {
          best = i;
          bestHits = hits;
        }
      }
      text = all[best]?.text ?? doc.body;
      chapter = { n: best + 1, of: all.length };
    }
  }
  const flat = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(/\s+/g, " ").trim();
  const body = cutExcerpt(flat, RECALL_EXCERPT_CHARS);
  const parts = provenanceParts(store, c.id, ctx.sessionId, ctx.counterpart.spans);
  const learned = learnedOf(row, zone);
  const lastWritten = journal && row.updated_at !== null ? localDate(row.updated_at, zone) : null;

  // Earlier: in-place versions whose words differ, then `changed` pairs it holds.
  const earlier: EarlierVersion[] = [];
  const versions = safe(() => store.versions(c.id), []);
  for (const v of [...versions].reverse()) {
    if (v.body.length === 0 || v.body === doc.body || v.reason === "episode-chapter") continue;
    earlier.push({
      text: plainLine(v.title ?? v.body, 60),
      learned: v.learned_on.length > 0 ? v.learned_on : null,
      changed: v.archived_at > 0 ? localDate(v.archived_at, zone) : null,
    });
  }
  let corrected = 0;
  const wrong: (CorrectedVersion & { reached: number })[] = [];
  const asked = new Set(tokens);
  const standing: string[] = [];
  let now: string | undefined;
  for (const p of pairs) {
    if (p.a !== c.id && p.b !== c.id) continue;
    const other = p.a === c.id ? p.b : p.a;
    if (p.state === "settled" && p.how === "changed" && p.holds === c.id && p.over !== null) {
      const o = store.row(p.over);
      if (o === undefined || !canName(p.over)) continue;
      earlier.push({
        text: plainLine(o.title ?? o.body, 60),
        learned: o.learned_on.length > 0 ? o.learned_on : null,
        changed: localDate(p.updated_at, zone),
        id: p.over,
      });
    } else if (p.state === "settled" && p.how === "changed" && p.over === c.id && p.holds !== null) {
      now = canName(p.holds) ? p.holds : "a later version";
    } else if (p.state === "settled" && p.how === "corrected" && p.holds === c.id) {
      corrected += 1;
      // Named so it can be opened by id: counted, but not named, when this
      // asker may not be told of it or nothing of it is left to read.
      const over = p.over;
      const o = over === null ? undefined : safe(() => store.row(over), undefined);
      if (over === null || o === undefined || o.body.length === 0 || !canName(over)) continue;
      const held = new Set(tokenize(`${o.title ?? ""}\n${o.body}`));
      wrong.push({
        text: plainLine(o.title ?? o.body, 60),
        learned: o.learned_on.length > 0 ? o.learned_on : null,
        corrected: localDate(p.updated_at, zone),
        id: over,
        reached: [...asked].filter((t) => held.has(t)).length,
      });
    } else if (p.state === "settled" && p.how === "open") {
      if (canName(other)) standing.push(`disagrees with ${other}`);
    } else if (p.state === "unsettled" && p.a === c.id) {
      const b = store.row(p.b);
      if (b !== undefined && b.archived === 0 && b.superseded_by === null && canName(p.b)) standing.push(`unsettled — may be out of date, see ${p.b}`);
    }
  }
  // Matched earlier memories first, then by when they changed, newest first.
  earlier.sort((a, b) => {
    const fa = a.id !== undefined && c.foldedEarlier.has(a.id) ? 0 : 1;
    const fb = b.id !== undefined && c.foldedEarlier.has(b.id) ? 0 : 1;
    return fa - fb || (b.changed ?? "").localeCompare(a.changed ?? "");
  });
  // Corrected: those the question's words reach first (a search that names
  // one should find it here), then the latest corrected.
  wrong.sort((a, b) => b.reached - a.reached || (b.corrected ?? "").localeCompare(a.corrected ?? "") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const correctedShown = wrong.slice(0, FACTS_CORRECTED_SHOWN).map(({ text, learned, corrected: on, id }) => ({ text, learned, corrected: on, id }));
  const title = row.title ?? doc.title;
  return {
    id: c.id,
    faded,
    title,
    line: title !== null && title.trim().length > 0 ? plainLine(title, 100) : plainLine(text, 80),
    kind: row.kind,
    journal,
    ...(chapter === undefined ? {} : { chapter }),
    body,
    bodyChars: doc.body.length,
    whole: body.length === flat.length && chapter === undefined,
    saidBy: row.said_by,
    status: row.status,
    occurredOn: row.occurred_on,
    learned,
    ...(lastWritten !== null && lastWritten !== learned ? { lastWritten } : {}),
    where: parts?.where ?? null,
    who: parts?.who ?? null,
    current: now === undefined,
    ...(now === undefined ? {} : { now }),
    earlier: earlier.slice(0, FACTS_EARLIER_SHOWN),
    earlierMore: Math.max(0, earlier.length - FACTS_EARLIER_SHOWN),
    corrected,
    ...(correctedShown.length === 0 ? {} : { correctedShown }),
    standing: standing.slice(0, 2),
    ways: (["words", "meaning", "subject", "session", "time"] as const).filter((x) => c.ways.has(x)),
    ...(c.timeBy === undefined ? {} : { timeBy: c.timeBy }),
    score: Math.round(c.score * 1000) / 1000,
  };
}

/** Where and when the anchor session was at work, and who else was here then. */
interface Stretch {
  readonly scope: string;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly others: readonly { readonly firstAt: number; readonly lastAt: number }[];
}

const normScope = (s: string): string => s.trim().replace(/\/+$/, "");

/**
 * A note an unbound server wrote, read as the anchor session's when it can be
 * no one else's (`deliberate.ts#provenanceParts`' rule): written in this
 * directory, inside the session's stretch, and inside no other session's.
 */
function placedIn(r: RecallRow, s: Stretch): boolean {
  const at = r.created_at;
  if (at === null || r.origin_scope === null || normScope(r.origin_scope) !== normScope(s.scope)) return false;
  if (at < s.firstAt || at > s.lastAt) return false;
  return !s.others.some((o) => at >= o.firstAt && at <= o.lastAt);
}

/**
 * THE LAST SESSION a question means: in a directory, the session the wake's
 * "Last here" names, else the newest other session at work here; without one
 * (the console), the newest journal's session anywhere. Its window is the
 * days it was at work. Null when there is none.
 */
function lastSession(
  ctx: FactsContext,
  rows: ReadonlyMap<string, RecallRow>,
  zone: string,
): { session: string; from: string; to: string; stretch: Stretch | null } | null {
  const scope = ctx.scope?.trim() ?? "";
  if (scope.length > 0) {
    const spans = ctx.counterpart.spans;
    const here = spans === undefined ? [] : safe(() => sessionsHere(spans, scope), []);
    const stretchOf = (session: string, firstAt: number, lastAt: number): Stretch => ({
      scope,
      firstAt,
      lastAt,
      others: here.filter((h) => h.session !== session),
    });
    try {
      const named = ctx.counterpart.chaptersHereFor?.(scope, ctx.sessionId)[0];
      if (named !== undefined) {
        const session = named.chapter.session;
        const own = here.find((h) => h.session === session);
        return {
          session,
          from: localDate(named.firstAt, zone),
          to: localDate(named.lastAt, zone),
          stretch: stretchOf(session, own?.firstAt ?? named.firstAt, own?.lastAt ?? named.lastAt),
        };
      }
    } catch {
      /* fall through to the sessions here */
    }
    const s = here.filter((h) => h.session !== ctx.sessionId).sort((a, b) => b.lastAt - a.lastAt)[0];
    if (s !== undefined) {
      return { session: s.session, from: localDate(s.firstAt, zone), to: localDate(s.lastAt, zone), stretch: stretchOf(s.session, s.firstAt, s.lastAt) };
    }
  }
  let best: RecallRow | null = null;
  for (const r of rows.values()) {
    if (r.type !== "episode") continue;
    const s = sessionOf(r);
    if (s === null || s === ctx.sessionId) continue;
    if (best === null || (r.updated_at ?? 0) > (best.updated_at ?? 0)) best = r;
  }
  if (best === null) return null;
  const session = sessionOf(best) as string;
  const first = best.created_at ?? best.updated_at ?? 0;
  const last = best.updated_at ?? first;
  if (first <= 0) return null;
  return { session, from: localDate(first, zone), to: localDate(last, zone), stretch: null };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ── the answer, as labeled lines ───────────────────────────────────────────

const SAID: Readonly<Record<string, string>> = { owner: "you said", self: "I said", inferred: "inferred" };

/** Why words alone answered, in plain words. */
function channelWords(semantic: SemanticSource): string | null {
  if (semantic === "in-line") return null;
  if (semantic === "embedder-off") return "by words only — recall by meaning is off";
  if (semantic === "embed-failed") return "by words only — the question could not be embedded";
  return null;
}

/** The labeled lines of one result. */
function itemLines(m: FactItem, i: number, today: string, excerptChars: number): string[] {
  const out: string[] = [];
  const mark = m.journal ? "[journal] " : "";
  const ch = m.chapter === undefined ? "" : ` (chapter ${String(m.chapter.n)} of ${String(m.chapter.of)})`;
  out.push(`${String(i)}. ${mark}${m.line} · ${m.id}${ch} · ${m.ways.join(", ")}${m.faded ? " · faded: not used for a long while" : ""}`);
  if (m.journal) {
    out.push(`   my journal · written ${shortDate(m.learned, today)}${m.lastWritten === undefined || m.lastWritten === null ? "" : `..${shortDate(m.lastWritten, today)}`}${m.where === null ? "" : ` in ${m.where}`}${m.who === null ? "" : ` · ${m.who}`}`);
  } else {
    const said = m.saidBy === null ? "speaker unknown" : (SAID[m.saidBy] ?? m.saidBy);
    const status = m.status ?? "status unknown";
    const occurred =
      m.occurredOn === null
        ? "no event date"
        : `${m.status === "planned" || m.status === "proposed" || m.status === "asked" ? "for" : "happened"} ${shortDate(m.occurredOn, today)}`;
    out.push(`   ${said} · ${status} · ${occurred}`);
    const where = m.where === null ? "" : ` in ${m.where}`;
    const who = m.who === null ? "" : ` · ${m.who}`;
    const standing = m.current ? "CURRENT" : `earlier — now ${m.now ?? "?"}`;
    const extra = m.standing.length === 0 ? "" : ` · ${m.standing.join(" · ")}`;
    const by = m.timeBy === "learned" && m.occurredOn === null ? " (in the window by this date)" : "";
    out.push(`   learned ${m.learned === null ? "date unknown" : shortDate(m.learned, today)}${by}${where}${who} · ${standing}${extra}`);
  }
  for (const e of m.earlier) {
    const learned = e.learned === null ? "" : ` (learned ${shortDate(e.learned, today)})`;
    const changed = e.changed === null ? "" : `, changed ${shortDate(e.changed, today)}`;
    out.push(`   earlier: "${e.text}"${learned}${changed}${e.id === undefined ? "" : ` · ${e.id}`}`);
  }
  if (m.earlierMore > 0) out.push(`   +${String(m.earlierMore)} more earlier`);
  // Corrected versions were WRONG: said so in front, never read as a fact,
  // each with its id so it can be opened (a correction can itself be wrong).
  const named = m.correctedShown ?? [];
  for (const e of named) {
    const learned = e.learned === null ? "" : ` (learned ${shortDate(e.learned, today)})`;
    const on = e.corrected === null ? "" : `, corrected ${shortDate(e.corrected, today)}`;
    out.push(`   corrected (was wrong): "${e.text}"${learned}${on} · ${e.id}`);
  }
  const unnamed = m.corrected - named.length;
  if (unnamed > 0) {
    out.push(
      named.length === 0
        ? `   ${String(unnamed)} corrected version${unnamed === 1 ? "" : "s"} hidden`
        : `   +${String(unnamed)} more corrected (was wrong)`,
    );
  }
  const words = m.body.length <= excerptChars ? m.body : cutExcerpt(m.body, excerptChars);
  out.push(`   ${words}`);
  return out;
}

/**
 * The answer a facts question returns, as labeled lines. Bounded by
 * `RECALL_RESULT_CHARS`: past it, excerpts are cut shorter until it fits.
 */
export function renderFacts(r: FactsResult): string {
  for (const excerpt of [RECALL_EXCERPT_CHARS, 150, 60, 0]) {
    const text = renderAt(r, r.today, excerpt);
    if (text.length <= RECALL_RESULT_CHARS || excerpt === 0) return text.length <= RECALL_RESULT_CHARS ? text : cutExcerpt(text, RECALL_RESULT_CHARS);
  }
  return "";
}

function renderAt(r: FactsResult, today: string, excerpt: number): string {
  const lines: string[] = [];
  const first = (r.page - 1) * FACTS_PAGE_SIZE;
  const shown = r.memories.length;
  const after = Math.max(0, r.matched - first - shown);
  const head: string[] = [`${String(r.matched)} match`];
  if (r.page > 1) head.push(`page ${String(r.page)}`);
  if (shown > 0) head.push(r.page > 1 ? `showing ${String(first + 1)}–${String(first + shown)}` : `showing ${String(shown)}`);
  if (r.page < r.pages) head.push(`${after > 0 ? `${String(after)} more` : "more"} → page ${String(r.page + 1)}`);
  if (r.faded > 0) head.push(r.faded === r.matched ? (r.matched === 1 ? "faded" : "all faded") : `${String(r.faded)} of them faded`);
  lines.push(head.join(" · "));
  if (r.time !== null) {
    const t = r.time;
    // An open end ("before 7/22", "after 7/22") reads as a cutoff, not as year 1 or 9999.
    const span = (w: DayWindow | null): string =>
      w === null
        ? ""
        : w.from === OPEN_START
          ? `through ${shortDate(w.to, today)}`
          : w.to === OPEN_END
            ? `${shortDate(w.from, today)} onward`
            : w.from === w.to
              ? shortDate(w.from, today)
              : `${shortDate(w.from, today)}..${shortDate(w.to, today)}`;
    const out = t.outside > 0 ? ` · ${String(t.outside)} more match outside it` : "";
    if (t.anchor !== undefined && t.anchor.date === null) {
      lines.push(
        t.anchor.kind === "event"
          ? `time: ${t.cue} — no memory names "${t.anchor.phrase}", so nothing was filtered by time`
          : `time: ${t.cue} — no earlier session found, so nothing was filtered by time`,
      );
    } else if (t.anchor !== undefined) {
      const what = t.anchor.kind === "event" ? `${t.anchor.phrase} → ${shortDate(t.anchor.date, today)}${t.anchor.id === undefined ? "" : ` (${t.anchor.id})`}` : `${t.cue} → ${shortDate(t.anchor.date, today)}${t.anchor.session === undefined ? "" : ` (session ${t.anchor.session.slice(0, 8)}, its rows first)`}`;
      const stretch = t.anchor.kind === "event" ? `, window ${span(t.window)}` : "";
      lines.push(`time: ${what}${stretch}${out}`);
    } else {
      const stretch = t.stretch > 0 ? `, stretched ${String(t.stretch)} day${t.stretch === 1 ? "" : "s"} each side` : "";
      lines.push(`time: ${t.cue} → ${span(t.said)}${stretch}${out}`);
    }
  }
  if (r.subjects.length > 0) lines.push(`about: ${r.subjects.map((s) => s.name).join(", ")}`);
  const channel = channelWords(r.semantic);
  if (channel !== null) lines.push(channel);
  const notAll: string[] = [];
  if (r.meaningCapped) notAll.push(`meaning search hit its cap (${String(FACTS_MEANING_CAP)})`);
  if (r.weak > 0) notAll.push(`${String(r.weak)} weak match${r.weak === 1 ? "" : "es"} not shown`);
  if (notAll.length > 0) lines.push(`may not be everything: ${notAll.join(" · ")}`);
  if (r.duplicates > 0) {
    lines.push(`${String(r.duplicates)} near-duplicate${r.duplicates === 1 ? "" : "s"} of a result shown left out`);
  }
  if (r.matched === 0) {
    lines.push("");
    lines.push("Nothing matched. Try the words the memory itself would use, a person or project it names, or a wider time.");
    return lines.join("\n");
  }
  r.memories.forEach((m, i) => {
    lines.push("");
    lines.push(...itemLines(m, first + i + 1, today, excerpt));
  });
  lines.push("");
  const foot: string[] = [];
  if (r.memories.some((m) => !m.whole)) foot.push(`read any whole with ids: [...] (up to ${String(RECALL_MAX_IDS)})`);
  if (r.page < r.pages) foot.push(`page: ${String(r.page + 1)} for the next`);
  if (foot.length > 0) lines.push(`${foot.join(" · ")}.`);
  if (r.memories.some((m) => m.journal)) lines.push(FACTS_JOURNAL_GLOSS);
  return lines.join("\n").trimEnd();
}
