/**
 * CHAPTERS AS SLICES (2026-09-28, held lightly). An episode row is a session's
 * journal: every chapter in one body under `## chapter N — … · lived day D`
 * headings (`self/episodes.ts#chapterHeading`). Those headings are the seams a
 * remembered day is cut at — the brain keeps slices where something changed and
 * skips between them, and never drops the end. So the dream and the reflection
 * read an episode as its ENTRIES: a line for each, the whole of the ones that
 * matter most, and a count of the ones already dreamed over.
 *
 * Reads only; nothing here writes.
 */
import { FEELINGS_WHEEL } from "../feelings-wheel.js";
import { clipBytes, fit, lineOf, offeredOf } from "../fit/index.js";
import type { AliasMap, Fidelity, FitCandidate, FitReport, Placed } from "../fit/index.js";
import { readChapterLead } from "../self/episodes.js";
import { automaticSummaryText, chapterSummaries } from "../self/summaries.js";
import { liveHandoffRows } from "../handoff/index.js";
import { MERGE_DEPTH } from "../self/writer.js";
import type { ReadOnlyStore, Store } from "../store/index.js";
import { localDate, readableDate } from "../time.js";

/** One entry of a chapter as a dream or a reflection is shown it. */
export interface ShownEntry {
  readonly chapter: number | null;
  readonly day: number | null;
  readonly fidelity: Exclude<Fidelity, "id">;
  readonly text: string;
  /** The whole entry's length in characters. */
  readonly chars: number;
  /**
   * THE CHAPTER'S SUMMARY MEMORY (2026-10-23, lean bundles): set only when
   * the entry is shown as its summary (`fitEpisodes`' `summaries`), so a
   * lean bundle that shows that memory too can point to it instead of
   * saying it twice.
   */
  readonly summaryId?: string;
}

/** A session's journal as it is shown: its entries in view, sliced at the chapter headings. */
export interface ShownChapter {
  readonly id: string;
  readonly title: string | null;
  readonly entries: readonly ShownEntry[];
  /** Entries of this episode not in view (already seen, or older than the window) — a lookup reads them. */
  readonly earlier: number;
  /** Entries in view the room did not take — a lookup reads them. */
  readonly notShown?: number;
}

/** An entry's address in a fit and the lookup ledger: `<episode>#<its place among the entries>`. */
export function entryKey(episode: string, index: number): string {
  return `${episode}#${String(index)}`;
}

/** An entry as shown, at its fit. */
export function shownEntry(e: { readonly chapter: number | null; readonly day: number | null }, p: Pick<Placed, "fidelity" | "text" | "chars">): ShownEntry {
  return { chapter: e.chapter, day: e.day, fidelity: p.fidelity === "id" ? "line" : p.fidelity, text: p.text, chars: p.chars };
}

/** One entry of an episode, as its heading and body say. */
export interface ChapterEntry {
  /** Its place among the body's entries, from 0 — the stable part of its address. */
  readonly index: number;
  /** The chapter number its heading named, or null for text before any heading. */
  readonly chapter: number | null;
  /** The lived day its heading named, or null. */
  readonly day: number | null;
  /** The calendar date its heading named, as written (`Tue 23 Sep 2026`), or null. */
  readonly date: string | null;
  /** The entry's words, heading taken off. */
  readonly text: string;
  /**
   * The chapter's SUMMARY in the session's own words, when it wrote one
   * (2026-10-15, `self/summaries.ts`; `withSummaries` attaches it): shown as
   * the entry's line in place of its first words. An automatic summary is
   * not attached — it IS the first words.
   */
  readonly summary?: string;
  /** The chapter's summary memory's id, written or automatic, when it has a live one (2026-10-23). */
  readonly summaryId?: string;
}

/**
 * HOW LONG A SUMMARY MAY BE AS A LINE, in UTF-8 bytes (2026-10-15, measured on
 * a copy of the owner's store — dream NOTES): a session's summary is a few
 * sentences, and a day of them shown whole as lines would crowd out the
 * chapters the room lets in whole. Past this it is cut with "…", and the
 * chapter is a lookup away. CAL.
 */
export const SUMMARY_LINE_BYTES = 600;

/** A chapter's summary, as `withSummaries` takes it (`self/summaries.ts#ChapterSummary`'s shape). */
export interface SummaryForLine {
  readonly kind: "written" | "automatic";
  readonly body: string;
  readonly writtenAt?: number;
  /** The summary memory's id (2026-10-23). */
  readonly id?: string;
}

/**
 * THE ENTRIES WITH THEIR CHAPTERS' SUMMARIES ON (2026-10-15): each entry
 * whose chapter has a summary the session WROTE carries it, by the chapter
 * number its heading names; with `asOf`, only one written by then. Pure.
 */
export function withSummaries(
  entries: readonly ChapterEntry[],
  byChapter: ReadonlyMap<number, SummaryForLine> | undefined,
  /** Only a summary written by then — a later part renders the line its fit measured (review of #504). */
  asOf?: number,
): ChapterEntry[] {
  if (byChapter === undefined || byChapter.size === 0) return [...entries];
  return entries.map((e) => {
    const s = e.chapter === null ? undefined : byChapter.get(e.chapter);
    if (s !== undefined && asOf !== undefined && (s.writtenAt ?? 0) > asOf) return e;
    if (s === undefined || s.body.trim().length === 0) return e;
    // Its memory's id, written or automatic (2026-10-23): a lean bundle that
    // shows the summary memory points to it.
    const withId = s.id === undefined ? e : { ...e, summaryId: s.id };
    return s.kind !== "written" ? withId : { ...withId, summary: s.body };
  });
}

/**
 * EPISODES IN VIEW, their entries carrying their chapters' written summaries
 * (`withSummaries`), read in one pass over the store (`chapterSummaries`).
 * A store that will not answer leaves the entries as they were: a line of
 * first words, as before summaries.
 */
export function summarized(store: ReadOnlyStore, episodes: readonly EpisodeInView[]): EpisodeInView[] {
  if (episodes.length === 0) return [];
  let byEpisode: ReturnType<typeof chapterSummaries>;
  try {
    byEpisode = chapterSummaries(store, episodes.map((e) => e.row.id));
  } catch {
    return [...episodes];
  }
  return episodes.map((ep) => ({ ...ep, fresh: withSummaries(ep.fresh, byEpisode.get(ep.row.id)) }));
}

/**
 * AN ENTRY AS ONE LINE: its chapter's summary when the session wrote one
 * (flattened, kept to `summaryBytes`), else its first words as before
 * (`fit#lineOf`, kept to `lineBytes`).
 */
export function entryLine(e: Pick<ChapterEntry, "text" | "summary">, lineBytes: number, summaryBytes: number = SUMMARY_LINE_BYTES): string {
  if (e.summary !== undefined) {
    const flat = e.summary.replace(/\s+/g, " ").trim();
    if (flat.length > 0) return clipBytes(flat, Math.max(lineBytes, summaryBytes));
  }
  return lineOf({ body: e.text }, lineBytes);
}

/**
 * AN ENTRY AS ITS SUMMARY (2026-10-23, lean bundles): the summary the session
 * wrote, whole and on one line, else the chapter's opening as an automatic
 * summary keeps it (`self/summaries.ts#automaticSummaryText`) — or the whole
 * entry, when it is no longer than that.
 */
export function entrySummary(e: Pick<ChapterEntry, "text" | "summary">): string {
  const written = e.summary?.replace(/\s+/g, " ").trim() ?? "";
  const s = written.length > 0 ? written : automaticSummaryText(e.text).replace(/\s+/g, " ").trim();
  return s.length === 0 || s.length >= e.text.length ? e.text : s;
}

/** A line that opens a chapter (either written form, or a bare `## chapter N`). */
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]*chapter[ \t]+\d+\b/i;

/**
 * An episode body cut at its chapter headings. Stacked headings (a model's own
 * `## chapter 1` under the one the journal wrote) stay one entry. Text before
 * the first heading, if any, is an entry of its own with no chapter.
 */
export function chapterEntries(body: string): ChapterEntry[] {
  const lines = body.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let bodied = false;
  for (const line of lines) {
    if (HEADING_LINE.test(line) && bodied) {
      chunks.push(current.join("\n"));
      current = [];
      bodied = false;
    }
    current.push(line);
    if (!HEADING_LINE.test(line) && line.trim().length > 0) bodied = true;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  const out: ChapterEntry[] = [];
  for (const chunk of chunks) {
    const lead = readChapterLead(chunk);
    const text = lead.rest.trim();
    const headed = HEADING_LINE.test(chunk.trimStart());
    if (text.length === 0 && !headed) continue;
    out.push({
      index: out.length,
      chapter: headed ? (lead.chapters[0] ?? null) : null,
      day: lead.livedDay,
      date: lead.date,
      text,
    });
  }
  return out;
}

/** An episode as a mechanism views it: its entries in view, and how many it holds besides. */
export interface EpisodeInView {
  readonly row: { readonly id: string; readonly title: string | null };
  /** When it was last written, for the order episodes are shown in (newest first). */
  readonly at: number;
  /** Its entries in view, in body order. */
  readonly fresh: readonly ChapterEntry[];
  /** Its entries not in view. */
  readonly earlier: number;
}

/** Episodes, fitted: the chapters as shown and what the ledger needs. */
export interface EpisodesFit {
  readonly chapters: ShownChapter[];
  readonly used: number;
  readonly report: FitReport;
  /** Entries in view the room did not take. */
  readonly notShown: number;
  readonly offered: { whole: string[]; excerpt: string[]; line: string[]; id: string[] };
  /** `<episode>:<position among its shown entries>` → the entry's place among all its entries. */
  readonly entryIndex: Record<string, number>;
  /** How far this read each episode: its entry count when read. */
  readonly reads: Record<string, number>;
  /** Entries below that count the room did not take — they come next time. */
  readonly unread: Record<string, number[]>;
  /**
   * The longest a written summary was as a line in this fit (`summaryLineBytes`)
   * — kept in the mechanism's index, so a later part renders the same line
   * the fit measured.
   */
  readonly summaryBytes: number;
}

/**
 * THE SHARE OF A ROOM SUMMARY LINES MAY TAKE (2026-10-15, measured on a copy of
 * the owner's store — dream NOTES): with every entry's summary as its line at
 * full length, the busiest day (51 chapters, 75k characters) left one chapter
 * whole in the dream's 30k and none in the reflection's 24k, where its first
 * words had let nine and five in. So a summary's line is as long as this
 * share of the room spread over the entries in view allows — never shorter
 * than an ordinary line, never longer than `SUMMARY_LINE_BYTES`: a quiet day
 * reads its summaries whole, a busy one their opening. CAL.
 */
export const SUMMARY_ROOM_SHARE = 0.4;

/** The longest a written summary may be as one line, for `entries` entries in `room`. */
export function summaryLineBytes(room: number, entries: number, lineBytes: number): number {
  const spread = Math.floor((Math.max(0, room) * SUMMARY_ROOM_SHARE) / Math.max(1, entries));
  return Math.max(lineBytes, Math.min(SUMMARY_LINE_BYTES, spread));
}

/**
 * FIT THE ENTRIES IN VIEW (2026-09-28): a line for every entry, the whole of
 * the most important (`entryImportance`, then the newest), in `room`; what
 * the room cannot take is counted on its chapter. An episode shown only in
 * part is offered for lookup by its own id (recall reads it whole, in parts).
 */
export function fitEpisodes(
  episodes: readonly EpisodeInView[],
  opts: {
    room: number;
    owner: readonly string[];
    day: number;
    lineBytes: number;
    entryChars: number;
    /** The longest a written summary may be as an entry's line (`summaryLineBytes` of the room when absent). */
    summaryBytes?: number;
    reads?: Readonly<Record<string, number>>;
    unread?: Readonly<Record<string, readonly number[]>>;
    /**
     * CHAPTERS BY THEIR SUMMARIES (2026-10-23, lean bundles; Mike's go 10-23:
     * "summaries, with id in case dream wants to look up full chapter"): an
     * entry's most is its summary (`entrySummary`), never its whole text —
     * unless the whole entry is no longer than that — and the chapter's
     * address reads the rest. Its fidelity is `line` unless the whole entry
     * is shown.
     */
    summaries?: boolean;
  },
): EpisodesFit {
  const ordered = [...episodes].sort((a, b) => b.at - a.at);
  const cands: FitCandidate[] = [];
  const summaryBytes =
    opts.summaryBytes ?? summaryLineBytes(opts.room, ordered.reduce((n, ep) => n + ep.fresh.length, 0), opts.lineBytes);
  for (const ep of ordered) {
    for (const entry of ep.fresh) {
      cands.push({
        id: entryKey(ep.row.id, entry.index),
        // Importance first; on a tie the EARLIER entry (it has waited longer).
        priority: entryImportance(entry.text, opts.owner) - entry.index * 1e-6,
        // The chapter's own summary when the session wrote one (2026-10-15).
        line: entryLine(entry, opts.lineBytes, summaryBytes),
        whole: opts.summaries === true ? entrySummary(entry) : entry.text,
      });
    }
  }
  const fitted0 = fit(cands, { room: opts.room, excerptChars: opts.entryChars, least: "line" });
  // By summaries, "whole" is the summary's: only an entry shown entire counts whole.
  const fitted =
    opts.summaries !== true
      ? fitted0
      : (() => {
          const textOf = new Map(ordered.flatMap((ep) => ep.fresh.map((e) => [entryKey(ep.row.id, e.index), e.text] as const)));
          const placed = fitted0.placed.map((p) => (p.fidelity === "whole" && p.text !== textOf.get(p.id) ? { ...p, fidelity: "excerpt" as const } : p));
          const whole = placed.filter((p) => p.fidelity === "whole").length;
          return { ...fitted0, placed, report: { ...fitted0.report, whole, excerpt: 0, lined: fitted0.report.lined + fitted0.report.excerpt + (fitted0.report.whole - whole) } };
        })();
  const placed = new Map(fitted.placed.map((p) => [p.id, p]));
  const o = offeredOf(fitted.placed);
  const offered = { whole: [...o.whole], excerpt: [...o.excerpt], line: [...o.line], id: [...o.id] };
  const chapters: ShownChapter[] = [];
  const entryIndex: Record<string, number> = {};
  // HOW FAR EACH EPISODE WAS READ (review of build B): its entry count, and
  // the entries in view the room did not take — so they come next time, in
  // any order the fit placed the rest, and nothing between is lost.
  const reads: Record<string, number> = { ...(opts.reads ?? {}) };
  const unread: Record<string, number[]> = Object.fromEntries(Object.entries(opts.unread ?? {}).map(([k, v]) => [k, [...v]]));
  for (const ep of ordered) {
    const entries: ShownEntry[] = [];
    let more = 0;
    reads[ep.row.id] = ep.earlier + ep.fresh.length;
    unread[ep.row.id] = [];
    for (const entry of ep.fresh) {
      const p = placed.get(entryKey(ep.row.id, entry.index));
      if (p === undefined) {
        more += 1;
        unread[ep.row.id]?.push(entry.index);
        continue;
      }
      entryIndex[`${ep.row.id}:${String(entries.length)}`] = entry.index;
      const shown = shownEntry(entry, p);
      entries.push(opts.summaries === true && p.fidelity !== "whole" && entry.summaryId !== undefined ? { ...shown, summaryId: entry.summaryId } : shown);
    }
    if (entries.length === 0) continue;
    chapters.push({ id: ep.row.id, title: ep.row.title, entries, earlier: ep.earlier, ...(more > 0 ? { notShown: more } : {}) });
    if (ep.earlier > 0 || more > 0 || entries.some((e) => e.fidelity !== "whole")) offered.line.push(ep.row.id);
  }
  for (const [k, v] of Object.entries(unread)) if (v.length === 0) delete unread[k];
  return { chapters, used: fitted.used, report: fitted.report, notShown: fitted.waiting.length, offered, entryIndex, reads, unread, summaryBytes };
}

/** A calendar day's journal as the nightly page writer is shown it (`dayJournal`). */
export interface DayJournal {
  /** The day's entries in view, fitted: whole, an excerpt, or a line. */
  readonly chapters: ShownChapter[];
  /** The day's entries, across every session. */
  readonly entries: number;
  /** Entries the room did not take. */
  readonly notShown: number;
  /** Characters of the room used. */
  readonly used: number;
}

/**
 * ONE CALENDAR DAY'S JOURNAL, ACROSS SESSIONS (2026-10-15) — for the nightly
 * page writer, which saw the journal only through the full chapter copies
 * among the day's memories and would have gone blind without them. The day's
 * chapters are the ones whose heading names that date; each comes as the
 * dream and the reflection get them (`fitEpisodes`): a line for every one —
 * its summary when the session wrote one — and the most important whole, in
 * `room`. An episode last written before the day holds none of it and is not
 * read. With `summaries` (day's end, 2026-10-23), each entry by its
 * summary, never whole (`fitEpisodes`' `summaries`). Never throws.
 */
export function dayJournal(
  store: ReadOnlyStore,
  opts: {
    about: string;
    room: number;
    owner: readonly string[];
    day: number;
    lineBytes: number;
    entryChars: number;
    zone?: string;
    summaries?: boolean;
    /** What the night may not read (`dream/slices.ts`). */
    closed?: ReadonlySet<string>;
  },
): DayJournal {
  const empty: DayJournal = { chapters: [], entries: 0, notShown: 0, used: 0 };
  const said = readableDate(opts.about);
  if (said === "" || opts.room <= 0) return empty;
  let ids: string[];
  let zone: string;
  try {
    ids = store.list({ type: "episode", archived: false });
    zone = opts.zone ?? store.zone();
  } catch {
    return empty;
  }
  const episodes: EpisodeInView[] = [];
  let entries = 0;
  for (const id of ids) {
    try {
      if (opts.closed?.has(id) === true) continue;
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0) continue;
      const at = row.updated_at ?? row.created_at;
      if (at === null || localDate(at, zone) < opts.about) continue;
      const all = chapterEntries(row.body);
      const fresh = all.filter((e) => e.date === said);
      if (fresh.length === 0) continue;
      entries += fresh.length;
      episodes.push({ row: { id, title: row.title }, at, fresh, earlier: all.length - fresh.length });
    } catch {
      continue;
    }
  }
  if (episodes.length === 0) return empty;
  const fitted = fitEpisodes(summarized(store, episodes), {
    room: opts.room,
    owner: opts.owner,
    day: opts.day,
    lineBytes: opts.lineBytes,
    entryChars: opts.entryChars,
    ...(opts.summaries === true ? { summaries: true } : {}),
  });
  return { chapters: fitted.chapters, entries, notShown: fitted.notShown, used: fitted.used };
}

let wheelWords: Set<string> | null = null;

function feelingWords(): Set<string> {
  if (wheelWords === null) wheelWords = new Set(FEELINGS_WHEEL.map((e) => e.word.toLowerCase()));
  return wheelWords;
}

const TURNS = /\b(decided|decide|chose|choose|realized|realised|noticed|learned|surprised|surprising|unexpected|mistake|wrong|finally|first time|never|promise|agreed|changed)\b/gi;

/**
 * HOW MUCH AN ENTRY LIKELY MATTERS — a working default for "the salient ones
 * come whole": feelings named (words of the wheel), the owner named, and the
 * words of a turn (decided, realized, surprised, a mistake). Higher first; a
 * tie keeps the entries' order. Held lightly: a heuristic until a model's own
 * label for an entry exists.
 */
export function entryImportance(text: string, owner: readonly string[]): number {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const wheel = feelingWords();
  let feelings = 0;
  for (const w of words) if (w.length > 2 && wheel.has(w)) feelings += 1;
  const names = owner.filter((n) => n.length > 1 && words.includes(n.toLowerCase())).length > 0 ? 1 : 0;
  const turns = (text.match(TURNS) ?? []).length;
  return Math.min(feelings, 5) * 0.2 + names * 0.5 + Math.min(turns, 5) * 0.3;
}

// ── journals as lean lines (2026-10-23, the dream's and the reflection's) ────

/** A date as a lean line says it: `10-22` in the bundle's own year, else whole. */
export function leanDate(date: string, year: string): string {
  return date.startsWith(`${year}-`) ? date.slice(5) : date;
}

/** A journal's head line: its short id, its title, what of it is not here. */
export function leanChapterHead(ch: Pick<ShownChapter, "id" | "title"> & Partial<Pick<ShownChapter, "earlier" | "notShown">>, aliases: AliasMap): string {
  const f = [aliases.short(ch.id), ch.title ?? "(untitled)"];
  if ((ch.earlier ?? 0) > 0) f.push(`${String(ch.earlier)} chapters read before`);
  if ((ch.notShown ?? 0) > 0) f.push(`${String(ch.notShown)} not shown tonight`);
  return f.join(" · ");
}

/**
 * One chapter of a journal, indented under its head. `summaries` (the
 * dream's): an excerpt IS the chapter's summary, on one line. `fit` (the
 * reflection's): an excerpt is the chapter's opening, and its words keep
 * their lines.
 */
export function leanEntry(e: ShownEntry, chapterId: string, aliases: AliasMap, mode: "summaries" | "fit" = "summaries"): string {
  const c = aliases.short(chapterId);
  // An entry gone since begin says only that (review of #602).
  if (e.chars === 0 && e.text.startsWith("(gone")) return `  ${c} · ${e.text}`;
  const f = [e.chapter === null ? `${c} (before its first chapter)` : `${c}#${String(e.chapter)}`];
  if (e.day !== null) f.push(`d${String(e.day)}`);
  if (e.summaryId !== undefined && aliases.has(e.summaryId)) f.push(`summary ${aliases.short(e.summaryId)}`);
  const text = mode === "summaries" || e.fidelity === "line" ? e.text.replace(/\s*\n\s*/g, " ") : e.text;
  const tail =
    e.fidelity === "whole" ? "" : e.fidelity === "line" ? ` (line; ${String(e.chars)})` : mode === "summaries" ? ` (${String(e.chars)})` : ` (excerpt of ${String(e.chars)})`;
  return `  ${f.join(" · ")} · ${text}${tail}`;
}

/**
 * WHAT THE NIGHT MAY NOT READ (2026-10-30, round 2 of the day-summary fix). The
 * night's children — day's end, the dream, the reflection, the tagging — read
 * the store whole, whatever folder wrote a row, and what they write is what
 * every session then reads: the page, a summary, a merge filed under the
 * folder the night ran in. So a folder that does not export (`off`, `paused`,
 * `observer`, and anything under one) is closed to them, by the rule the host's
 * `foldersOn` answers: a row whose folder it says no to is not shown to a night
 * and cannot go into a merge or a gist.
 *
 * Which folder a row counts as: a memory's own (`memoryFolder`: its chapter's,
 * for a chapter's summary); an episode's; and a night's own row (a merge, a
 * gist, a reflection's entry), filed under wherever the night ran, by its
 * originals', so a merge made from a closed row is closed too.
 *
 * Where it can't tell, it reads the row as open, the other way from the wake's
 * gate (`Counterpart#daySummaryShown`, which fails closed): a row with no folder
 * recorded, or a night row whose originals are gone, has no folder to refuse,
 * and hiding every such row would blind the night to its older memories. A
 * setting file that will not read closes every folder (`foldersOn`).
 *
 * This decides reading and writing from now on. It changes no row: what is in
 * the store stays there, and an ordinary session's recall does not come here.
 */
/** How much of a closed row's opening counts as naming it (`namesClosed`). */
const OPENING_CHARS = 24;

/** The host's word on one folder (`adapters/scopes.ts#foldersOn`). */
export type FolderOn = (scope: string) => boolean;

/** Nothing closed: a host with no folder setting. */
export const NOTHING_CLOSED: ReadonlySet<string> = new Set<string>();

type FolderRow = { type: string; origin_scope: string | null; origin_ref: string | null };

/**
 * A ROW THE NIGHTLY RUN WROTE — a dream's merge or gist, a reflection's entry —
 * told by origin (`dream:` / `reflection:`, which catches a merge, whose
 * `source` is its best source's) or by source, as the store's `NIGHTLY_SQL`
 * tells it. Filed under the folder the night ran in, whatever folders its words
 * came from.
 */
export function isNightRow(row: { source: string | null; origin_ref: string | null }): boolean {
  const ref = row.origin_ref ?? "";
  return row.source === "dreamed" || row.source === "reflection" || ref.startsWith("dream:") || ref.startsWith("reflection:");
}

/**
 * THE FOLDER A MEMORY WAS WRITTEN IN (2026-10-25, Y1): its own `origin_scope`;
 * else, for a memory written from a chapter (its `origin_ref` an episode's id),
 * that chapter's. Chapter-written memories were born with no folder until Y1,
 * while the chapter itself always recorded one, so this reads the rows already
 * written without a migration. Null when neither says. Never throws.
 */
export function memoryFolder(store: Pick<Store, "row">, row: FolderRow): string | null {
  if (row.origin_scope !== null && row.origin_scope.trim().length > 0) return row.origin_scope;
  const ref = row.origin_ref ?? "";
  if (row.type !== "memory" || !ref.startsWith("epi_")) return null;
  try {
    const chapter = store.row(ref);
    if (chapter === undefined || chapter.type !== "episode") return null;
    return chapter.origin_scope !== null && chapter.origin_scope.trim().length > 0 ? chapter.origin_scope : null;
  } catch {
    return null;
  }
}

/** Does this night row rest on a closed row, following night rows among its originals? An original that is gone says nothing. */
function restsOnClosed(store: Pick<Store, "row">, meta: string, shut: (scope: string | null) => boolean, depth: number): boolean {
  if (depth >= MERGE_DEPTH) return false;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(meta) as Record<string, unknown>;
  } catch {
    return false;
  }
  for (const key of ["mergedFrom", "sources", "cites"]) {
    const ids = parsed[key];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== "string" || id.length === 0) continue;
      const orig = store.row(id);
      if (orig === undefined) continue;
      if (orig.type === "episode" ? shut(orig.origin_scope) : orig.type === "memory" && (isNightRow(orig) ? restsOnClosed(store, orig.meta, shut, depth + 1) : shut(memoryFolder(store, orig)))) return true;
    }
  }
  return false;
}

/**
 * DOES THIS TEXT NAME A CLOSED ROW, by id, title or its opening words? For the
 * published wake a dream is handed: it was composed for no reader, so its
 * Yesterday line and its lists may name any folder's, and since the wake stopped
 * printing bare ids (#687) a line quoting an untitled row has only its words.
 * A short opening is passed over: too little to tell it from anything else. Never throws.
 */
export function namesClosed(store: Pick<Store, "row">, text: string, closed: ReadonlySet<string>): boolean {
  const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
  const wake = flat(text);
  for (const id of closed) {
    if (text.includes(id)) return true;
    try {
      const row = store.row(id);
      const title = row?.title ?? null;
      if (title !== null && title.trim().length > 0 && text.includes(title)) return true;
      const opening = flat(row?.body ?? "").slice(0, OPENING_CHARS);
      if (opening.length === OPENING_CHARS && wake.includes(opening)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** A folder's stance as the fence reads it: no folder says nothing; a setting that throws reads as closed. */
function shutUnder(on: FolderOn): (scope: string | null) => boolean {
  return (scope) => {
    if (scope === null || scope.trim().length === 0) return false;
    try {
      return on(scope) !== true;
    } catch {
      return true;
    }
  };
}

function memoryShut(store: Pick<Store, "row">, row: FolderRow & { readonly source: string | null; readonly meta: string }, shut: (scope: string | null) => boolean): boolean {
  return isNightRow(row) ? restsOnClosed(store, row.meta, shut, 0) : shut(memoryFolder(store, row));
}

/**
 * ONE MEMORY, BY THE FENCE'S OWN RULE, for a door that asks of a row rather than
 * walking the store: see-also (FI1, 2026-10-30), since a named id reaches a memory
 * with no word of the turn's behind it. `here` is the turn's folder, which is its
 * own to read, as the wake's gate has it; a night's row is filed where the night
 * ran, which says nothing about where its words came from, so it doesn't get
 * that. Never throws: an unreadable row is closed.
 */
export function memoryClosedTo(store: Pick<Store, "row">, row: FolderRow & { readonly source: string | null; readonly meta: string }, on: FolderOn, here?: string): boolean {
  try {
    if (here !== undefined && !isNightRow(row) && memoryFolder(store, row) === here) return false;
    return memoryShut(store, row, shutUnder(on));
  } catch {
    return true;
  }
}

/**
 * EVERY MEMORY AND CHAPTER CLOSED TO THE NIGHT under `on`, archived and merged
 * rows included, and each live handoff, by the folder it was left in (a schema
 * row, which is on my mind's open loops and has no folder of its own). A walk of the store, so one read per night call, never per
 * turn: only the night's doors ask. Never throws row by row.
 */
export function closedToNight(store: Store, on: FolderOn): ReadonlySet<string> {
  const shut = shutUnder(on);
  const closed = new Set<string>();
  for (const type of ["memory", "episode"] as const) {
    for (const id of store.list({ type })) {
      try {
        const row = store.row(id);
        if (row === undefined) continue;
        const isClosed = type === "episode" ? shut(row.origin_scope) : memoryShut(store, row, shut);
        if (isClosed) closed.add(id);
      } catch {
        continue;
      }
    }
  }
  try {
    for (const h of liveHandoffRows(store)) if (shut(h.scope)) closed.add(h.id);
  } catch {
    /* no handoffs to close */
  }
  return closed;
}
