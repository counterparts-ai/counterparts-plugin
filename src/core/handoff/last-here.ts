/**
 * LAST HERE — the wake's line for the session that last wrote a chapter in
 * this directory (2026-09-30, the continuity test).
 *
 * A handoff is for unfinished work, and a session that finished cleanly
 * leaves none, so the directory's pointer said nothing of it: Mike ended an
 * evening's session in ~/random (twenty notes, a chapter, session_end
 * memories, no handoff), opened a new one two minutes later, asked "what do
 * you remember from our most recent session?", and the new session could not
 * find any of it. Every session that writes a chapter writes this line,
 * finished or not, and the line is beside the handoff pointer, not instead of
 * it.
 *
 * **Derived, not stored.** Which directory a chapter was written in is read,
 * in order, off the episode's own `origin_scope` (set at birth since
 * 2026-09-30), off the chapter claims in that directory's coverage file
 * (`coverage/#chapterClaims`), and — for a chapter with neither — off the
 * directories its session's turn-ends are filed in (`coverage/#sessionsHere`,
 * which also gives when that session was here). No new row type, no write.
 *
 * Furniture, like the handoff pointer: spliced at delivery above it, never an
 * element, never a `- ` bullet, every line flattened. Its room comes out of
 * the same reserve, by the same share rule (`reserveBytes`), and it gives way
 * to the handoff — a fortnight's unfinished work outranks orientation.
 */
import { CORE_ABOUT_MARKS } from "../store/index.js";
import type { Store } from "../store/index.js";
import { localDate, localStamp, readableDate } from "../time.js";
import { isKnownSession, isModelId } from "../types.js";
import { HANDOFF_EXCERPT_BYTES, HANDOFF_LIFE_DAYS, excerpt, flatten, sessionWords } from "./index.js";

/**
 * How long a chapter is "last here", in LIVED days since it was written — the
 * handoff's fortnight, so the two kinds of working context age alike.
 */
export const LAST_HERE_LIFE_DAYS = HANDOFF_LIFE_DAYS;

/** How many sessions the line names in full (the newest with its first
 *  sentence, the one before it by title); the rest of that day by id. */
export const LAST_HERE_SHOWN = 2;

/** How many further chapters "+N more" names by id; past it, a count. */
export const LAST_HERE_LISTED = 3;

/** The title's cap in the line. The id is the door to the whole chapter. */
export const LAST_HERE_TITLE_BYTES = 100;

/**
 * THE DURABLE ROW A "LAST HERE" LINE DROPPED FOR ROOM LEAVES (2026-10-01, the
 * brief's item 9). It was a ring event only (`counterpart.lasthere.noroom`),
 * gone with the hook's process, so the dashboard's wake bar could not go amber
 * for it. One per chapter per lived day (`dedupKey`); the ref is the newest
 * chapter the line would have named; the payload says the bytes, the ceiling,
 * and whether a handoff was carried in its place. Never under observer.
 */
export const LAST_HERE_NOROOM_EVENT = "handoff.lasthere.noroom";

/** One session's latest chapter, as the line reads it. */
export interface ChapterHere {
  /** The episode row (`epi_…`). */
  readonly id: string;
  readonly session: string;
  /** The model that wrote it, when the row recorded one. */
  readonly model: string | null;
  readonly title: string | null;
  /**
   * The first sentence of its FIRST chapter (2026-10-01; its latest until
   * then). The title is set once, with chapter 1, so the two describe the
   * same thing; a later chapter has no title of its own, and printed under
   * the episode's title it read as the wrong evening (random-f2's item 3).
   */
  readonly excerpt: string;
  /** How many chapters the episode holds (1 when its body has no heading). */
  readonly chapters: number;
  /** Epoch ms of the latest write to it, and of its first. */
  readonly writtenAt: number;
  readonly createdAt: number;
  /** The lived day its latest chapter was written on, from the heading. */
  readonly writtenDay: number | null;
  /** The directory it was born in, when the row recorded one (2026-09-30 on). */
  readonly scope: string | null;
  /**
   * The episode, or any live memory minted from it, is confidential (review of
   * #311). The walk reports it and its callers decide: the wake names such a
   * chapter only to the owner, and never in another directory.
   */
  readonly confidential?: boolean;
  /** A live copy of it is marked about me, us or the owner (`CORE_ABOUT_MARKS`),
   *  read in the same grouped query (`Store#copiesOf`). */
  readonly aboutMe?: boolean;
}

/** A chapter's session here, with the times the line prints, spelled by the caller. */
export interface LastHere {
  readonly chapter: ChapterHere;
  /** `09-30 16:01–17:53`: when the session was here. */
  readonly when: string;
  /** `09-30`: the date its chapter was written, for "+N more here on …". */
  readonly date: string;
}

/**
 * The engine's own chapter heading (`self/episodes.ts#chapterHeading`), in
 * both its written forms — and nothing a model writes inside a chapter's text,
 * like "## Chapter two" (review of #300, NIT).
 */
const HEADING = /^## chapter \d+ — (?:[^\n]* · )?lived day \d+[ \t]*$/gm;

/**
 * EVERY SESSION'S LATEST CHAPTER, by session, among the live episodes born on
 * or after `fromDay` — one SQL-bounded walk. A row the owner removed is not
 * read. Never throws: a store that will not answer has no chapters.
 */
export function chaptersBySession(store: Store, opts: { fromDay?: number } = {}): Map<string, ChapterHere> {
  const out = new Map<string, ChapterHere>();
  let ids: string[];
  let denied: Set<string>;
  try {
    ids = store.list({
      type: "episode",
      archived: false,
      ...(opts.fromDay === undefined ? {} : { bornFromDay: opts.fromDay }),
    });
    denied = ids.length === 0 ? new Set() : new Set(store.deniedIds());
  } catch {
    return out;
  }
  // Every copy of every episode in the window, in ONE query (review of #311).
  let copies: ReturnType<Store["copiesOf"]> | null;
  try {
    copies = store.copiesOf(ids);
  } catch {
    copies = null;
  }
  for (const id of ids) {
    if (denied.has(id)) continue;
    try {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0) continue;
      let session = row.origin_session;
      if (session === null || session.length === 0) {
        const meta = JSON.parse(row.meta || "{}") as Record<string, unknown>;
        session = typeof meta["sessionId"] === "string" ? meta["sessionId"] : null;
      }
      // A chapter needs a bound session, so this is a guard: the unbound id names no one.
      if (!isKnownSession(session)) continue;
      const createdAt = row.created_at ?? 0;
      const writtenAt = row.updated_at ?? createdAt;
      const held = out.get(session);
      if (held !== undefined && held.writtenAt >= writtenAt) continue;
      const { day } = latestChapter(row.body);
      const first = firstChapter(row.body);
      out.set(session, {
        id,
        session,
        model: isModelId(row.model) ? row.model : null,
        title: row.title === null || row.title.trim().length === 0 ? null : row.title,
        excerpt: excerpt(first.text),
        chapters: first.count,
        writtenAt,
        createdAt,
        writtenDay: day ?? (Number.isFinite(row.birth_day) ? row.birth_day : null),
        scope: row.origin_scope === null || row.origin_scope.length === 0 ? null : row.origin_scope,
        // A store that will not say reads as confidential, and about nothing.
        confidential: row.confidential === 1 || copies === null || (copies.get(id) ?? []).some((c) => c.confidential),
        aboutMe: (copies?.get(id) ?? []).some((c) => c.about !== null && (CORE_ABOUT_MARKS as readonly string[]).includes(c.about)),
      });
    } catch {
      continue;
    }
  }
  return out;
}

/** The text of an episode's LAST chapter, and the lived day its heading names. */
export function latestChapter(body: string): { text: string; day: number | null } {
  let last: RegExpExecArray | null = null;
  for (const m of body.matchAll(HEADING)) last = m as RegExpExecArray;
  if (last === null) return { text: body, day: null };
  const day = /lived day (\d+)/.exec(last[0])?.[1];
  return { text: body.slice((last.index ?? 0) + last[0].length), day: day === undefined ? null : Number(day) };
}

/**
 * The text of an episode's FIRST chapter — what the episode's title names —
 * and how many chapters it holds. A body with no engine heading is one
 * chapter, whole.
 */
export function firstChapter(body: string): { text: string; count: number } {
  const heads = [...body.matchAll(HEADING)];
  const first = heads[0];
  if (first === undefined) return { text: body, count: 1 };
  const start = (first.index ?? 0) + first[0].length;
  const next = heads[1];
  return { text: body.slice(start, next === undefined ? undefined : next.index), count: heads.length };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * EVERY CHAPTER OF AN EPISODE, in order, with the calendar date its engine
 * heading names (`YYYY-MM-DD`, or null for a heading from before headings
 * carried one), and the heading line itself (v12: a chapter's address
 * resolves to it — `self/chapter-address.ts`). A body with no heading is one
 * chapter with no date and no heading.
 */
export function chaptersOf(body: string): { text: string; date: string | null; heading: string | null }[] {
  const heads = [...body.matchAll(HEADING)];
  if (heads.length === 0) return [{ text: body, date: null, heading: null }];
  return heads.map((h, i) => {
    const start = (h.index ?? 0) + h[0].length;
    const next = heads[i + 1];
    const m = /(\d{1,2}) ([A-Za-z]{3}) (\d{4})/.exec(h[0]);
    const month = m === null ? -1 : MONTHS.indexOf((m[2] ?? "").toLowerCase());
    const date = m === null || month < 0 ? null : `${m[3] as string}-${String(month + 1).padStart(2, "0")}-${(m[1] as string).padStart(2, "0")}`;
    return { text: body.slice(start, next === undefined ? undefined : next.index), date, heading: h[0].trim() };
  });
}

/**
 * THE CHAPTER A QUESTION ABOUT A WINDOW MEANS (review of #311): the first
 * chapter dated inside it (`from` and `to` are `YYYY-MM-DD HH:MM` keys; the
 * date part is compared), else the first chapter. Which one it is and how
 * many there are, for the line that says so.
 */
export function chapterFor(body: string, window: { readonly from: string; readonly to: string } | null): { text: string; index: number; count: number } {
  const all = chaptersOf(body);
  let index = 0;
  if (window !== null) {
    const from = window.from.slice(0, 10);
    const to = window.to.slice(0, 10);
    const hit = all.findIndex((c) => c.date !== null && c.date >= from && c.date <= to);
    if (hit >= 0) index = hit;
  }
  return { text: all[index]?.text ?? body, index, count: all.length };
}

const norm = (s: string): string => s.trim().replace(/\/+$/, "");

/**
 * THE CHAPTERS WRITTEN HERE, newest first, each with when its session was
 * here. A chapter is HERE when its row says this directory; with no directory
 * on the row, when this directory's coverage file holds its chapter claim
 * (`claimed`), or failing that when its session's turn-ends are filed here
 * (`sessions`). The waking session's own chapter is not "last here" (review
 * of #300 MINOR-3). Kept while its latest chapter is inside the fortnight.
 */
export function chaptersHere(
  chapters: ReadonlyMap<string, ChapterHere>,
  here: {
    readonly scope: string;
    readonly claimed: ReadonlySet<string>;
    readonly sessions: ReadonlyMap<string, { firstAt: number; lastAt: number }>;
  },
  day: number,
  opts: { readonly reader?: string | null; readonly lifeDays?: number } = {},
): { chapter: ChapterHere; firstAt: number; lastAt: number }[] {
  const lifeDays = opts.lifeDays ?? LAST_HERE_LIFE_DAYS;
  const out: { chapter: ChapterHere; firstAt: number; lastAt: number }[] = [];
  for (const chapter of chapters.values()) {
    if (opts.reader !== undefined && opts.reader !== null && chapter.session === opts.reader) continue;
    if (chapter.writtenDay !== null && day - chapter.writtenDay >= lifeDays) continue;
    const s = here.sessions.get(chapter.session);
    const isHere =
      chapter.scope !== null ? norm(chapter.scope) === norm(here.scope) : here.claimed.has(chapter.id) || s !== undefined;
    if (!isHere) continue;
    out.push({
      chapter,
      firstAt: Math.min(s?.firstAt ?? chapter.createdAt, chapter.createdAt || Infinity),
      lastAt: Math.max(s?.lastAt ?? 0, chapter.writtenAt),
    });
  }
  return out.sort((a, b) => b.chapter.writtenAt - a.chapter.writtenAt || (a.chapter.id < b.chapter.id ? 1 : -1));
}

/** `— "Title" (epi_…)`, or `— epi_…` when the chapter has no title; with
 *  `, N chapters` inside the brackets when there is more than the first. */
function named(c: ChapterHere): string {
  const more = c.chapters > 1 ? `, ${String(c.chapters)} chapters` : "";
  return c.title === null ? `— ${c.id}${more === "" ? "" : ` (${more.slice(2)})`}` : `— "${excerpt(c.title, LAST_HERE_TITLE_BYTES)}" (${c.id}${more})`;
}

/**
 * THE LINES, for the newest `shown` sessions here (1 or 2): the newest with the
 * first sentence of its first chapter, the one before it by title, and the rest written THAT DAY by
 * id. `more` false leaves the "+N more" line off — the narrowest rung.
 */
export function lastHereBlock(
  entries: readonly LastHere[],
  opts: { readonly shown?: number; readonly more?: boolean; readonly reader?: string | null } = {},
): string | null {
  const first = entries[0];
  if (first === undefined) return null;
  const reader = opts.reader ?? null;
  const sameDay = entries.filter((e) => e.date === first.date);
  const shown = Math.max(1, Math.min(opts.shown ?? LAST_HERE_SHOWN, sameDay.length));
  const who = (e: LastHere): string => sessionWords(e.chapter.session, e.chapter.model, reader);
  const lines = [
    `Last here: ${who(first)}, ${first.when} ${named(first.chapter)}.${first.chapter.excerpt.length > 0 ? ` ${excerpt(first.chapter.excerpt, HANDOFF_EXCERPT_BYTES)}` : ""}`,
  ];
  for (const e of sameDay.slice(1, shown)) lines.push(`Before it: ${who(e)}, ${e.when} ${named(e.chapter)}.`);
  const rest = sameDay.slice(shown);
  if (opts.more !== false && rest.length > 0) {
    const ids = rest.slice(0, LAST_HERE_LISTED).map((e) => e.chapter.id);
    const unnamed = rest.length - ids.length;
    lines.push(`+${rest.length} more here on ${first.date}: ${ids.join(", ")}${unnamed > 0 ? `, and ${unnamed} more` : ""}.`);
  }
  return lines.map(flatten).join("\n");
}

/** How many of yesterday's chapters the "Yesterday" line names by title. */
export const YESTERDAY_SHOWN = 4;

/** A title's cap in the "Yesterday" line; the id is the door to the rest. */
export const YESTERDAY_TITLE_BYTES = 60;

/** One episode's chapters written on a date (`chaptersOn`). */
export interface ChaptersOnDate {
  /** The episode row (`epi_…`). */
  readonly id: string;
  readonly title: string | null;
  /** How many of its chapters were written that day. */
  readonly chapters: number;
  /** When the episode was born, for the order. */
  readonly createdAt: number;
  /** The directory it was born in, when the row recorded one — for the
   *  wake's gate on another directory's titles (`Counterpart#yesterdayFor`). */
  readonly scope?: string | null;
  /** A live copy of it is marked about me, us or the owner, as `ChapterHere.aboutMe`. */
  readonly aboutMe?: boolean;
}

/** Every chapter heading in an episode body, with the date it names when it names one. */
const DATED_HEADING = /^## chapter \d+ — (?:([A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4}) · )?(?:[^\n]* · )?lived day \d+[ \t]*$/gm;

/**
 * THE CHAPTERS WRITTEN ON `date`, store-wide, per episode, oldest episode
 * first (review of #308): read off each chapter's own heading, which prints
 * the calendar day it was written beside the lived day (`self/episodes.ts#
 * chapterHeading`, since 2026-09-24) — so a session that wrote a chapter that
 * day and another the next is still that day's, and two chapters that day
 * count as two. An episode whose headings carry no date falls back to its
 * row's first and latest write. Bounded to the episodes born inside
 * `fromDay`. A removed or superseded row is not read. Never throws.
 */
export function chaptersOn(store: Store, date: string, opts: { fromDay?: number } = {}): ChaptersOnDate[] {
  const out: ChaptersOnDate[] = [];
  const said = readableDate(date);
  if (said.length === 0) return out;
  let ids: string[];
  let denied: Set<string>;
  try {
    ids = store.list({ type: "episode", archived: false, ...(opts.fromDay === undefined ? {} : { bornFromDay: opts.fromDay }) });
    denied = ids.length === 0 ? new Set() : new Set(store.deniedIds());
  } catch {
    return out;
  }
  const zone = store.zone();
  // CONFIDENTIAL CHAPTERS ARE NOT LISTED (review of #311): the line is
  // composed once and read by every session, the owner's or not, so a title a
  // non-owner may not see is left out for all. One grouped read for the copies.
  let copies: ReturnType<Store["copiesOf"]> | null;
  try {
    copies = store.copiesOf(ids);
  } catch {
    copies = null;
  }
  for (const id of ids) {
    if (denied.has(id)) continue;
    try {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null || row.body.length === 0) continue;
      if (row.confidential === 1 || copies === null || (copies.get(id) ?? []).some((c) => c.confidential)) continue;
      let dated = 0;
      let that = 0;
      for (const m of row.body.matchAll(DATED_HEADING)) {
        if (m[1] === undefined) continue;
        dated += 1;
        if (m[1] === said) that += 1;
      }
      // THE HEADING'S DATE ONLY (second review of #308): a row's own write
      // times move for a retitle or a revision too, so they would list a day
      // no chapter was written on. An episode from before headings carried a
      // date (2026-09-24) is read by the day it was born, and only then.
      if (dated === 0 && localDate(row.created_at ?? 0, zone) === date) that = 1;
      if (that === 0) continue;
      out.push({
        id,
        title: row.title === null || row.title.trim().length === 0 ? null : row.title,
        chapters: that,
        createdAt: row.created_at ?? 0,
        scope: row.origin_scope === null || row.origin_scope.length === 0 ? null : row.origin_scope,
        aboutMe: (copies.get(id) ?? []).some((c) => c.about !== null && (CORE_ABOUT_MARKS as readonly string[]).includes(c.about)),
      });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * THE "YESTERDAY" LINE (2026-10-01, build 3) — store-wide, from the chapters
 * written on `date` (`chaptersOn`), oldest episode first, each by its title and
 * id (and how many chapters, when more than one); the rest by count. One line,
 * CARRYING ITS DATE — "Yesterday, 09-30: …" — because the wake is composed at a
 * boundary and served as it stands until the next: a bundle built late at
 * night is read in the morning, and a date stays true where "yesterday" alone
 * would not. No model run: titles and ids only. Null when that day has no
 * chapter.
 *
 * `hidden` (2026-10-11): how many more of that day's episodes the caller
 * left out of `day` because their directory's chapters may not be named
 * here (`Counterpart#yesterdayFor`'s gate). They join the count, never by
 * title or id; when they are all there is, the line is the count alone.
 */
export function yesterdayLine(day: readonly ChaptersOnDate[], date: string, titles = YESTERDAY_SHOWN, hidden = 0): string | null {
  if (day.length === 0) {
    if (hidden <= 0) return null;
    return flatten(`Yesterday, ${date.slice(5)}: chapters from ${String(hidden)} session${hidden === 1 ? "" : "s"} in other directories.`);
  }
  // The first `YESTERDAY_SHOWN` are named, the first `titles` of them by
  // title and id and the rest by id alone — pointers instead of titles
  // (2026-10-10, `yesterdayShorter`); past them, a count.
  const named = Math.min(day.length, YESTERDAY_SHOWN);
  const shown = day.slice(0, named).map((c, i) => {
    const n = c.chapters > 1 ? `, ${String(c.chapters)} chapters` : "";
    return c.title === null || i >= titles
      ? `${c.id}${n === "" ? "" : ` (${n.slice(2)})`}`
      : `"${excerpt(c.title, YESTERDAY_TITLE_BYTES)}" (${c.id}${n})`;
  });
  const rest = day.length - shown.length + Math.max(0, hidden);
  return flatten(`Yesterday, ${date.slice(5)}: ${shown.join("; ")}${rest > 0 ? `; and ${String(rest)} more` : ""}.`);
}

/**
 * THE SAME LINE, SHORTER (review of #350, 2026-10-09): one title fewer at a
 * time, down to none — widest first, each strictly narrower than the one
 * before, and none when the line names no title. Since 2026-10-10 a title
 * given up leaves its id in its place — POINTERS INSTEAD OF TITLES — so every
 * chapter the whole line names is still named, by the id `recall` opens, and
 * the count past them is the whole line's. The wake steps down these to make
 * room for what ranks above the line (`self/briefing.ts#ROOM_ORDER`): the
 * Arriving lane and "Still open"'s first item; the count is honest because it
 * is counted here, where the chapters are. `hidden` as `yesterdayLine`'s.
 */
export function yesterdayShorter(day: readonly ChaptersOnDate[], date: string, hidden = 0): string[] {
  const out: string[] = [];
  let last = yesterdayLine(day, date, YESTERDAY_SHOWN, hidden);
  for (let n = Math.min(YESTERDAY_SHOWN, day.length) - 1; n >= 0; n--) {
    const line = yesterdayLine(day, date, n, hidden);
    if (line === null || last === null || line.length >= last.length) continue;
    out.push(line);
    last = line;
  }
  return out;
}

/**
 * A DIRECTORY AS THE LINE SAYS IT: the home directory as `~`, read off the
 * path's shape (`/Users/<name>`, `/home/<name>`) so this module needs no
 * process state. Anything else is printed as it is.
 */
export function placeWords(scope: string): string {
  return flatten(scope.trim().replace(/\/+$/, "").replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~"));
}

/**
 * ABOUT ME, FROM ANOTHER DIRECTORY (2026-10-01, random-f2's item 6): a
 * chapter written elsewhere whose copy is marked about me, us or the owner
 * (`about`, the reflection's and the writer's mark) reaches a wake in every
 * directory — one written in the code repository but about who I am, not
 * about the code — did not reach a wake in another directory. Work stays where it was done: an unmarked chapter, or one marked
 * work or world, is "last here" in its own directory only. One line, the
 * newest such chapter, by title and id; the id is the door.
 */
export function elsewhereLine(chapter: ChapterHere, date: string, reader: string | null = null): string {
  const where = chapter.scope === null ? "" : ` in ${placeWords(chapter.scope)}`;
  return flatten(`About me, from another directory: ${sessionWords(chapter.session, chapter.model, reader)}, ${date}${where} ${named(chapter)}.`);
}

/**
 * THE BLOCKS A DELIVERY MAY TRY, widest first — `pointerLadder`'s shape: every
 * session of that day shown, then the newest with the count of the rest, then
 * the newest alone. Duplicates dropped.
 */
export function lastHereLadder(entries: readonly LastHere[], reader: string | null = null): string[] {
  const out: string[] = [];
  for (const block of [
    lastHereBlock(entries, { reader }),
    lastHereBlock(entries, { reader, shown: 1 }),
    lastHereBlock(entries, { reader, shown: 1, more: false }),
  ]) {
    if (block !== null && !out.includes(block)) out.push(block);
  }
  return out;
}

/**
 * HOW MANY DIRECTORIES THE "TODAY, ELSEWHERE" LINE NAMES AT MOST (2026-10-10):
 * one short line, the live ones and the most recently active first; the rest
 * by count — and fewer when the line would pass its bytes, below.
 */
export const TODAY_ELSEWHERE_MAX_DIRS = 5;

/**
 * HOW LONG THE LINE MAY BE, IN BYTES (2026-10-10, b2 + random-f8, lightly
 * held): every form `todayElsewhereLines` returns fits it, the directories
 * past it counted ("+N more"). It is the most room the line asks of the
 * lanes below it (`briefing.ts#ROOM_ORDER`'s `elsewhere`), so a long morning
 * elsewhere cannot grow into the wake.
 */
export const TODAY_ELSEWHERE_MAX_BYTES = 300;

/** One other directory, as the "Today, elsewhere" line names it. */
export interface TodayElsewhere {
  readonly scope: string;
  /** The first session's start and the last activity there today, epoch ms;
   *  null when the host's registry holds no session there (memories alone). */
  readonly firstAt: number | null;
  readonly lastAt: number | null;
  /** A session there is still open, by the host's registry. */
  readonly live: boolean;
  /** Today's newest chapter there that may be named in another directory —
   *  gated by the caller — or null. */
  readonly chapter: ChapterHere | null;
  /** How many memories were written there today. A count, never a title. */
  readonly memories: number;
}

/**
 * THE "TODAY, ELSEWHERE" LINE (2026-10-10, b2 + random-f8; Mike approved the
 * option that day): what the other directories did today, for a session
 * starting in this one — so a morning of several sessions in several
 * directories is not several sessions each unaware of the others.
 *
 *   Today, elsewhere: ~/counterparts open since 08:02 (live) — "Reading the
 *   overnight benchmark" (epi_…), 6 memories; ~/deadfront 08:05–09:40, 2
 *   memories.
 *
 * Times and counts, and a chapter's title only when the caller's gate let it
 * through — the "About me, from another directory" line's: the scope setting,
 * the confidential mark, and a copy marked about me, us or the owner. Never a
 * word of a span, a work memory's title, or a handoff: those stay where they
 * were made. Returns the line and its shorter forms — fewer chapters, fewer
 * directories, the rest counted — every one within
 * `TODAY_ELSEWHERE_MAX_BYTES`, or null when there is nothing to say. Pure.
 */
export function todayElsewhereLines(
  dirs: readonly TodayElsewhere[],
  zone?: string,
): { line: string; shorter: string[] } | null {
  const named = dirs
    .filter((d) => d.firstAt !== null || d.memories > 0 || d.chapter !== null)
    .sort(
      (a, b) =>
        Number(b.live) - Number(a.live) ||
        (b.lastAt ?? 0) - (a.lastAt ?? 0) ||
        b.memories - a.memories ||
        (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0),
    );
  const clock = (at: number): string => localStamp(at, zone).split(" ")[1] ?? "";
  const one = (d: TodayElsewhere, chapters: boolean): string => {
    const when =
      d.firstAt === null
        ? ""
        : d.live
          ? ` open since ${clock(d.firstAt)} (live)`
          : ` ${clock(d.firstAt)}–${clock(d.lastAt ?? d.firstAt)}`;
    const chapter = !chapters || d.chapter === null ? "" : ` — ${chapterWords(d.chapter)}`;
    const count = d.memories === 0 ? "" : `, ${String(d.memories)} ${d.memories === 1 ? "memory" : "memories"}`;
    return `${placeWords(d.scope)}${when}${chapter}${count}`;
  };
  return elsewhereForms("Today, elsewhere:", named, one);
}

/**
 * THE FORMS OF AN ELSEWHERE LINE, widest first (2026-10-10): the first `k`
 * directories with their chapters, then without, for `k` down to one — the
 * rest counted — and last the count alone. Only those within
 * `TODAY_ELSEWHERE_MAX_BYTES`, each narrower than the one before it. One
 * ladder for "Today, elsewhere" and "Since you started" (2026-10-11), so the
 * two lines cannot come to disagree about how much room a folder takes.
 */
function elsewhereForms<D>(
  head: string,
  named: readonly D[],
  one: (d: D, chapters: boolean) => string,
): { line: string; shorter: string[] } | null {
  if (named.length === 0) return null;
  const line = (k: number, chapters: boolean): string => {
    const rest = named.length - k;
    const tail = rest === 0 ? "" : `; +${String(rest)} more`;
    return flatten(`${head} ${named.slice(0, k).map((d) => one(d, chapters)).join("; ")}${tail}.`);
  };
  const candidates: string[] = [];
  for (let k = Math.min(named.length, TODAY_ELSEWHERE_MAX_DIRS); k >= 1; k--) candidates.push(line(k, true), line(k, false));
  candidates.push(`${head} ${String(named.length)} other ${named.length === 1 ? "directory" : "directories"}.`);
  const size = (s: string): number => new TextEncoder().encode(s).length;
  const forms: string[] = [];
  for (const form of candidates) {
    if (size(form) > TODAY_ELSEWHERE_MAX_BYTES) continue;
    const last = forms[forms.length - 1];
    if (last !== undefined && size(form) >= size(last)) continue;
    forms.push(form);
  }
  const [widest, ...shorter] = forms;
  return widest === undefined ? null : { line: widest, shorter };
}

/** A gated chapter as an elsewhere line names it: its title and id, or the id alone. */
function chapterWords(c: ChapterHere): string {
  return c.title === null ? c.id : `"${excerpt(c.title, LAST_HERE_TITLE_BYTES)}" (${c.id})`;
}

/** One other directory, as the "Since you started" line names it: what CHANGED there since `since`. */
export interface SinceElsewhere {
  readonly scope: string;
  /** The newest session there that STARTED since then and is still open, epoch ms; null when none. */
  readonly startedAt: number | null;
  /** A session there is open now (started then or before). */
  readonly live: boolean;
  /** The last session there that ENDED since then, epoch ms; null when none. */
  readonly endedAt: number | null;
  /** The newest chapter written there since then that may be named here — gated by the caller — or null. */
  readonly chapter: ChapterHere | null;
  /** How many memories were written there since then. A count, never a title. */
  readonly memories: number;
}

/**
 * THE "SINCE YOU STARTED" LINE (2026-10-11; option C of the fresh-wake brief,
 * Mike approved it 2026-10-10): for a session ALREADY OPEN, which never reads
 * a wake again, what changed in the other directories since it last heard —
 * a session there started or ended, a chapter, new memories (counts).
 *
 *   Since you started (10:40): ~/deadfront ended 11:05, chapter "Fixing the
 *   gate" (epi_…), 3 memories; ~/random open since 10:52, 2 memories.
 *
 * `since` is when the session last heard (its wake, or the last such line):
 * the first line says "Since you started (10:40)", a later one "Since 11:40".
 * The same gates as "Today, elsewhere" — the caller applies them, the one
 * gate for both — and the same ladder of forms within
 * `TODAY_ELSEWHERE_MAX_BYTES`. A directory where nothing changed is not
 * named. Null when there is nothing to say. Pure.
 */
export function sinceElsewhereLines(
  dirs: readonly SinceElsewhere[],
  since: { readonly at: number; readonly started: boolean; readonly now: number },
  zone?: string,
): { line: string; shorter: string[] } | null {
  const named = dirs
    .filter((d) => d.startedAt !== null || d.endedAt !== null || d.memories > 0 || d.chapter !== null)
    .sort(
      (a, b) =>
        Math.max(b.startedAt ?? 0, b.endedAt ?? 0, b.chapter?.writtenAt ?? 0) -
          Math.max(a.startedAt ?? 0, a.endedAt ?? 0, a.chapter?.writtenAt ?? 0) ||
        b.memories - a.memories ||
        (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0),
    );
  const clock = (at: number): string => localStamp(at, zone).split(" ")[1] ?? "";
  // A clock time alone while it is the same day; the day as well when not.
  const when = (at: number): string =>
    localDate(at, zone) === localDate(since.now, zone) ? clock(at) : localStamp(at, zone);
  const one = (d: SinceElsewhere, chapters: boolean): string => {
    const state =
      d.startedAt !== null
        ? ` open since ${when(d.startedAt)}`
        : d.live
          ? " open"
          : d.endedAt !== null
            ? ` ended ${when(d.endedAt)}`
            : "";
    const chapter = !chapters || d.chapter === null ? "" : `, chapter ${chapterWords(d.chapter)}`;
    const count = d.memories === 0 ? "" : `, ${String(d.memories)} ${d.memories === 1 ? "memory" : "memories"}`;
    return `${placeWords(d.scope)}${state}${chapter}${count}`;
  };
  const head = since.started ? `Since you started (${when(since.at)}):` : `Since ${when(since.at)}:`;
  return elsewhereForms(head, named, one);
}
