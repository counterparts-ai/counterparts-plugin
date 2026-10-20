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

/**
 * A SHORT STAMP AS A PERSON READS IT (2026-10-12, plain words): `10-11` is
 * `Oct 11` and `10-11 16:01` is `Oct 11 16:01`; a bare clock (`16:01`) or
 * anything else passes through. The stamps are made by `time.ts#localStamp`,
 * which other lines still print as `MM-DD`.
 */
export function stampWords(stamp: string): string {
  const m = /^(\d{2})-(\d{2})(?=$| )/.exec(stamp);
  const mo = m === null ? undefined : SHORT_MONTHS[Number(m[1]) - 1];
  return m === null || mo === undefined ? stamp : `${mo} ${String(Number(m[2]))}${stamp.slice(5)}`;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

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

/** `— "Title" (epi_…)`, or `— epi_…` when the chapter has no title. The count
 *  of chapters inside the episode is not printed (2026-10-12, plain words):
 *  the id is what `recall` opens, and a person reading the line has no use
 *  for the numbering. */
function named(c: ChapterHere): string {
  return c.title === null ? `— ${c.id}` : `— "${excerpt(c.title, LAST_HERE_TITLE_BYTES)}" (${c.id})`;
}

/**
 * THE LINES, for the newest `shown` sessions here (1 or 2): the newest with the
 * first sentence of its first chapter, the one before it by title, and the rest written THAT DAY by
 * id. `more` false leaves the "+N more" line off — the narrowest rung.
 *
 * `named` (2026-10-20, Mike's go, lightly held: each episode once in the
 * wake): an episode the wake's body already names — the Yesterday line, by
 * title — is left out of "Before it" and "+N more", which would only repeat
 * it (the second by bare id). The newest is never left out: "Last here" is
 * the line that says when, and the session-start Yesterday line leaves it to
 * this one (`Counterpart#yesterdayFor`).
 */
export function lastHereBlock(
  entries: readonly LastHere[],
  opts: {
    readonly shown?: number;
    readonly more?: boolean;
    readonly reader?: string | null;
    readonly named?: (id: string) => boolean;
  } = {},
): string | null {
  const first = entries[0];
  if (first === undefined) return null;
  const reader = opts.reader ?? null;
  const said = opts.named;
  const sameDay = entries.filter((e, i) => e.date === first.date && (i === 0 || said === undefined || !said(e.chapter.id)));
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
 * `places` (2026-10-18, the wake-polish builder, lightly held; a bare count
 * of "sessions in other projects" from 2026-10-11): that day's episodes the
 * caller left out of `day` because their directory's chapters may not be
 * named here (`Counterpart#yesterdayFor`'s gate), BY FOLDER — "and 2 sessions
 * in ~/random" — never by title or id. A folder name is not content: the
 * caller lists only the folders the "Today, elsewhere" line may name (the
 * scope setting on; not this one, not the store's own), and the rest are not
 * said at all, as that line does not say them. When they are all there is,
 * the line is the folders alone.
 */
export interface YesterdayPlace {
  readonly scope: string;
  readonly sessions: number;
}

/** How many folders the Yesterday line names; the rest are counted (`+2
 *  more`). As many as "Today, elsewhere" names (`TODAY_ELSEWHERE_MAX_DIRS`). */
export const YESTERDAY_PLACES_SHOWN = 5;

/** `3 sessions in ~/random (2), ~/deadfront`, or null for none. */
function placesWords(places: readonly YesterdayPlace[]): string | null {
  const real = places.filter((p) => p.sessions > 0 && p.scope.trim().length > 0);
  if (real.length === 0) return null;
  const sorted = [...real].sort((a, b) => b.sessions - a.sessions || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0));
  const total = sorted.reduce((n, p) => n + p.sessions, 0);
  const shown = sorted.slice(0, YESTERDAY_PLACES_SHOWN).map((p) => `${placeWords(p.scope)}${p.sessions > 1 && sorted.length > 1 ? ` (${String(p.sessions)})` : ""}`);
  const more = sorted.length - shown.length;
  return `${total === 1 ? "a session" : `${String(total)} sessions`} in ${shown.join(", ")}${more > 0 ? `, +${String(more)} more` : ""}`;
}

export function yesterdayLine(
  day: readonly ChaptersOnDate[],
  date: string,
  titles = YESTERDAY_SHOWN,
  places: readonly YesterdayPlace[] = [],
  dated = true,
): string | null {
  const head = dated ? `Yesterday, ${stampWords(date.slice(5))}:` : "Yesterday:";
  const where = placesWords(places);
  if (day.length === 0) {
    if (where === null) return null;
    return flatten(`${head} ${where}.`);
  }
  // NO BARE IDS AS ITEMS (2026-10-20, Mike's go, lightly held): the first
  // `titles` chapters that HAVE a title are named, by title and id (at most
  // `YESTERDAY_SHOWN`); every other one — untitled, or with no room for its
  // title — joins the count. Until then a title given up left its id in its
  // place ("pointers instead of titles", 2026-10-10), and a lone `epi_…` read
  // as noise in the 10-20 wakes.
  const shown = day
    .filter((c) => c.title !== null)
    .slice(0, Math.max(0, Math.min(titles, YESTERDAY_SHOWN)))
    .map((c) => `"${excerpt(c.title ?? "", YESTERDAY_TITLE_BYTES)}" (${c.id})`);
  const rest = day.length - shown.length;
  const elsewhere = where === null ? "" : rest > 0 || shown.length === 0 ? `; ${where}` : `; and ${where}`;
  if (shown.length === 0) return flatten(`${head} ${String(rest)} ${rest === 1 ? "session" : "sessions"}${elsewhere}.`);
  const more = rest > 0 ? `; and ${String(rest)} more` : "";
  return flatten(`${head} ${shown.join("; ")}${more}${elsewhere}.`);
}

/**
 * "YESTERDAY:" WITHOUT ITS DATE AT A SESSION START (2026-10-16, the wake
 * trims; Mike, lightly held, review 2026-10-18). The wake assembled at a
 * session start is read that day, under the `Now:` line that carries the
 * date, so the line says "Yesterday:" alone. The turn-end's published render
 * keeps "Yesterday, Oct 15:" — the reason the line carried a date (above) is
 * still true of it, read the next morning when a session start cannot
 * assemble its own. `false` dates both again.
 */
export const YESTERDAY_UNDATED_AT_START = true;

/**
 * THE SAME LINE, SHORTER (review of #350, 2026-10-09): one title fewer at a
 * time, down to ONE — widest first, each strictly narrower than the one
 * before, and none when the line names one title or none. A title given up
 * joins the count (2026-10-20: no bare ids as items; from 2026-10-10 until
 * then it left its id in its place), and the count is the whole line's, so
 * it stays honest: it is counted here, where the chapters are. The narrowest
 * form keeps one title, because "Yesterday: 4 sessions" alone names nothing a
 * reader can open; under more pressure the line drops whole. The wake steps
 * down these to make room for what ranks above the line
 * (`self/briefing.ts#ROOM_ORDER`): the Arriving lane and "Still open"'s first
 * item. `places` as `yesterdayLine`'s.
 */
export function yesterdayShorter(day: readonly ChaptersOnDate[], date: string, places: readonly YesterdayPlace[] = [], dated = true): string[] {
  const out: string[] = [];
  let last = yesterdayLine(day, date, YESTERDAY_SHOWN, places, dated);
  const titled = day.filter((c) => c.title !== null).length;
  for (let n = Math.min(YESTERDAY_SHOWN, titled) - 1; n >= 1; n--) {
    const line = yesterdayLine(day, date, n, places, dated);
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
 *
 * THE FOLDER LEADS (2026-10-20, Mike's go, lightly held): "About me, from
 * another project: session …, Oct 19 in ~/x — "…"" read as a teaser in a
 * folder that cannot follow it. Now it says what it is and where first: "A
 * chapter about me from ~/x: session …, Oct 19 — "…" (epi_…)." Left out when
 * the wake's body already names that episode (`Counterpart#lastHereLadder`).
 */
export function elsewhereLine(chapter: ChapterHere, date: string, reader: string | null = null): string {
  const where = chapter.scope === null ? "another project" : placeWords(chapter.scope);
  return flatten(`${ELSEWHERE_HEAD} ${where}: ${sessionWords(chapter.session, chapter.model, reader)}, ${date} ${named(chapter)}.`);
}

/** How the "about me, from another folder" line opens (`elsewhereLine`). */
export const ELSEWHERE_HEAD = "A chapter about me from";

/**
 * THE BLOCKS A DELIVERY MAY TRY, widest first — `pointerLadder`'s shape: every
 * session of that day shown, then the newest with the count of the rest, then
 * the newest alone. Duplicates dropped.
 */
export function lastHereLadder(entries: readonly LastHere[], reader: string | null = null, named?: (id: string) => boolean): string[] {
  const out: string[] = [];
  const also = named === undefined ? {} : { named };
  for (const block of [
    lastHereBlock(entries, { reader, ...also }),
    lastHereBlock(entries, { reader, shown: 1, ...also }),
    lastHereBlock(entries, { reader, shown: 1, more: false, ...also }),
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
  /** How many memories were written there today. */
  readonly memories: number;
  /** The one or two of them named by title (2026-10-20, Mike's go, an
   *  experiment): gated and chosen by the caller, the first named first. */
  readonly titles?: readonly MemoryHere[];
}

/**
 * HOW MANY OF A DIRECTORY'S MEMORIES AN ELSEWHERE LINE NAMES BY TITLE, at most
 * (2026-10-20, Mike's go, lightly held, an experiment): the newest piece or
 * two of work there, so a session starting here knows what the one there is
 * doing, not only that it wrote something. The line's ladder gives them up
 * one at a time before it gives up a chapter or a directory.
 */
export const ELSEWHERE_TITLES_MAX = 2;

/**
 * HOW LONG A MEMORY'S TITLE MAY RUN IN AN ELSEWHERE LINE, IN BYTES (2026-10-20,
 * lightly held): enough to say what the work is, short enough that two
 * directories with a title each fit `TODAY_ELSEWHERE_MAX_BYTES`. The id
 * beside it is whole, so recall can expand it.
 */
export const ELSEWHERE_TITLE_BYTES = 48;

/** A memory an elsewhere line names: its id, its title (or first words), when it was written. */
export interface MemoryHere {
  readonly id: string;
  readonly title: string;
  readonly at: number;
}

/**
 * ANOTHER SESSION OPEN IN THIS SAME FOLDER (2026-10-20, Mike's go via the
 * coordinator, an experiment): the commoner case of parallel work — several
 * sessions in one folder at once. Named by the elsewhere lines in a clause of
 * their own ("Here, also open: session 25e12e7d on Opus 5.5 since 10:05:
 * "…" (mem_…)"), first in the line's room: what a session beside this one
 * is doing is what is likeliest to be done twice.
 */
export interface HereSession {
  readonly session: string;
  /** The model the host last saw in it (`SessionRecord.model`), or null. */
  readonly model: string | null;
  /** When it started, epoch ms — for "Since you started", only when it started
   *  inside the window, else null. */
  readonly startedAt: number | null;
  /** Its last activity, epoch ms, so a start on an earlier day says the day. */
  readonly lastAt?: number;
  /** Up to two of its memories by title, gated and chosen by the caller. */
  readonly titles: readonly MemoryHere[];
}

/** How the clause naming this folder's other sessions opens. */
export const HERE_ALSO_OPEN = "Here, also open:";

/**
 * The memory ids a wake's elsewhere line printed (2026-10-20), so the work
 * lines spliced below it leave them to it: the line that says who is at work
 * on them. Read off the printed text, so a title the line gave up for room
 * is not counted. Pure.
 */
export function elsewhereNamedIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("Today, elsewhere: ") && !line.startsWith(`${HERE_ALSO_OPEN} `)) continue;
    for (const m of line.matchAll(/\((mem_[0-9a-f]+)\)/g)) if (m[1] !== undefined) out.add(m[1]);
  }
  return out;
}

/**
 * THE "TODAY, ELSEWHERE" LINE (2026-10-10, b2 + random-f8; Mike approved the
 * option that day): what the other directories did today, for a session
 * starting in this one — so a morning of several sessions in several
 * directories is not several sessions each unaware of the others.
 *
 *   Today, elsewhere: ~/counterparts open since 08:02 (live) — "Reading the
 *   overnight benchmark" (epi_…), 6 memories: "Wake check 10-20" (mem_…),
 *   "Spans out of backups" (mem_…); ~/deadfront 08:05–09:40, 2 memories.
 *
 * Times and counts, a chapter's title only when the caller's gate let it
 * through — the "About me, from another directory" line's: the scope setting,
 * the confidential mark, and a copy marked about me, us or the owner — and
 * since 2026-10-20 (Mike's go, an experiment) one or two memory titles a
 * directory, by the same gate's folder rule and the confidential mark
 * (`TodayElsewhere.titles`, chosen by the caller). Never a word of a span or
 * a handoff: those stay where they were made. Returns the line and its
 * shorter forms — fewer titles, fewer chapters, fewer directories, the rest
 * counted — every one within `TODAY_ELSEWHERE_MAX_BYTES`, or null when there
 * is nothing to say. Pure.
 */
export function todayElsewhereLines(
  dirs: readonly TodayElsewhere[],
  zone?: string,
  here: readonly HereSession[] = [],
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
  // A session that started on an earlier day and is still active today
  // (2026-10-18, random-6c's wake: "open since 09:08" for a start the day
  // before) says its start with the day. `lastAt` is today's, by the caller.
  const start = (firstAt: number, lastAt: number | null): string =>
    lastAt !== null && localDate(firstAt, zone) !== localDate(lastAt, zone) ? localStamp(firstAt, zone) : clock(firstAt);
  const one = (d: TodayElsewhere, chapters: boolean, titles: number): string => {
    const when =
      d.firstAt === null
        ? ""
        : d.live
          ? ` open since ${start(d.firstAt, d.lastAt)} (live)`
          : ` ${start(d.firstAt, d.lastAt)}–${clock(d.lastAt ?? d.firstAt)}`;
    const chapter = !chapters || d.chapter === null ? "" : ` — ${chapterWords(d.chapter)}`;
    return `${placeWords(d.scope)}${when}${chapter}${countWords(d.memories, d.titles, titles)}`;
  };
  const oneHere = (h: HereSession, titles: number): string =>
    `${sessionWords(h.session, h.model)}${h.startedAt === null ? "" : ` since ${start(h.startedAt, h.lastAt ?? null)}`}${titleWords(h.titles, titles)}`;
  return elsewhereForms("Today, elsewhere:", named, one, { sessions: hereOrder(here), one: oneHere, head: HERE_ALSO_OPEN });
}

/** This folder's other sessions, the newest work first, then the newest start. */
function hereOrder(here: readonly HereSession[]): HereSession[] {
  const newest = (h: HereSession): number => Math.max(h.startedAt ?? 0, ...h.titles.map((m) => m.at));
  return [...here].sort((a, b) => newest(b) - newest(a) || (a.session < b.session ? -1 : a.session > b.session ? 1 : 0));
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
  one: (d: D, chapters: boolean, titles: number) => string,
  here: {
    readonly sessions: readonly HereSession[];
    readonly one: (h: HereSession, titles: number) => string;
    /** The clause's opening when the line names no other directory. */
    readonly head: string;
  } = { sessions: [], one: () => "", head: HERE_ALSO_OPEN },
): { line: string; shorter: string[] } | null {
  const sessions = here.sessions;
  if (named.length === 0 && sessions.length === 0) return null;
  // This folder's other sessions take the line's room first (2026-10-20), so
  // the first `k` entries are theirs before any other directory's.
  const all: ({ here: true; h: HereSession } | { here: false; d: D })[] = [
    ...sessions.map((h) => ({ here: true as const, h })),
    ...named.map((d) => ({ here: false as const, d })),
  ];
  // Each entry's words, once per (chapters, titles): the ladder asks for the
  // same few many times over (up to 21 allotments a count), and a clock time
  // is a time-zone format, so the per-prompt line pays for each one.
  const words = new Map<string, string>();
  const wordsOf = (i: number, chapters: boolean, t: number): string => {
    const e = all[i];
    if (e === undefined) return "";
    const key = `${String(i)}|${e.here || !chapters ? "" : "c"}|${String(t)}`;
    let w = words.get(key);
    if (w === undefined) {
      w = e.here ? here.one(e.h, t) : one(e.d, chapters, t);
      words.set(key, w);
    }
    return w;
  };
  const line = (k: number, chapters: boolean, titles: readonly number[]): string => {
    const shown = all.slice(0, k);
    const hereWords: string[] = [];
    const dirWords: string[] = [];
    shown.forEach((e, i) => (e.here ? hereWords : dirWords).push(wordsOf(i, chapters, titles[i] ?? 0)));
    const restDirs = named.length - dirWords.length;
    const restHere = sessions.length - hereWords.length;
    const dirs =
      dirWords.length > 0
        ? `${dirWords.join("; ")}${restDirs === 0 ? "" : `; +${String(restDirs)} more`}`
        : restDirs > 0
          ? `${String(restDirs)} other ${restDirs === 1 ? "project" : "projects"}`
          : "";
    const mine =
      hereWords.length > 0
        ? `${hereWords.join("; ")}${restHere === 0 ? "" : `; +${String(restHere)} more`}`
        : restHere > 0
          ? `${String(restHere)} other ${restHere === 1 ? "session" : "sessions"}`
          : "";
    if (mine.length === 0) return flatten(`${head} ${dirs}.`);
    if (dirs.length === 0) return flatten(`${here.head} ${mine}.`);
    return flatten(`${head} ${dirs}. ${HERE_ALSO_OPEN} ${mine}.`);
  };
  // For each count of entries, widest first — and within it (2026-10-20)
  // the most memory titles first, spread across the entries before two go to
  // one, the first-named keeping theirs longest — each with the chapters and
  // then without. So titles give way before a directory does, and a
  // chapter's title before a memory's: what a session is working on now is
  // what the line is for. Last, the counts alone. With no titles and no
  // session here to name, the forms are exactly the 2026-10-10 ones.
  const candidates: string[] = [];
  for (let k = Math.min(all.length, TODAY_ELSEWHERE_MAX_DIRS); k >= 1; k--) {
    const allots = allotments(k, ELSEWHERE_TITLES_MAX).sort(
      (a, b) => sum(b) - sum(a) || Math.max(0, ...a) - Math.max(0, ...b),
    );
    for (const titles of allots) candidates.push(line(k, true, titles), line(k, false, titles));
  }
  candidates.push(line(0, false, []));
  const forms: string[] = [];
  let lastSize = Infinity;
  for (const form of candidates) {
    const size = Buffer.byteLength(form, "utf8");
    if (size > TODAY_ELSEWHERE_MAX_BYTES || size >= lastSize) continue;
    forms.push(form);
    lastSize = size;
  }
  const [widest, ...shorter] = forms;
  return widest === undefined ? null : { line: widest, shorter };
}

/** Every way to give `k` directories up to `max` titles each, never more to a later one than an earlier. */
function allotments(k: number, max: number): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  for (let first = max; first >= 0; first--) for (const rest of allotments(k - 1, first)) out.push([first, ...rest]);
  return out;
}

function sum(xs: readonly number[]): number {
  return xs.reduce((n, x) => n + x, 0);
}

/** A gated chapter as an elsewhere line names it: its title and id, or the id alone. */
function chapterWords(c: ChapterHere): string {
  return c.title === null ? c.id : `"${excerpt(c.title, LAST_HERE_TITLE_BYTES)}" (${c.id})`;
}

/**
 * A directory's memories as an elsewhere line says them (2026-10-20): the
 * count, and then up to `shown` of the titles the caller chose — `, 8
 * memories: "Wake check 10-20" (mem_…), "Spans out of backups" (mem_…)`.
 * Each title one line (`excerpt`), at most `ELSEWHERE_TITLE_BYTES`.
 */
function countWords(memories: number, titles: readonly MemoryHere[] | undefined, shown: number): string {
  const listed = (titles ?? []).slice(0, Math.max(0, shown)).map((m) => `"${excerpt(m.title, ELSEWHERE_TITLE_BYTES)}" (${m.id})`);
  const n = Math.max(memories, listed.length);
  if (n === 0) return "";
  const count = `, ${String(n)} ${n === 1 ? "memory" : "memories"}`;
  return listed.length === 0 ? count : `${count}: ${listed.join(", ")}`;
}

/** A session's titles as the "Here, also open" clause says them: `: "…" (mem_…), "…" (mem_…)`, or nothing. */
function titleWords(titles: readonly MemoryHere[], shown: number): string {
  const listed = titles.slice(0, Math.max(0, shown)).map((m) => `"${excerpt(m.title, ELSEWHERE_TITLE_BYTES)}" (${m.id})`);
  return listed.length === 0 ? "" : `: ${listed.join(", ")}`;
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
  /** How many memories were written there since then. */
  readonly memories: number;
  /** The one or two of them named by title (2026-10-20), as `TodayElsewhere.titles`:
   *  only ones written since then, so a title is named once. */
  readonly titles?: readonly MemoryHere[];
}

/**
 * THE "SINCE YOU STARTED" LINE (2026-10-11; option C of the fresh-wake brief,
 * Mike approved it 2026-10-10): for a session ALREADY OPEN, which never reads
 * a wake again, what changed in the other directories since it last heard —
 * a session there started or ended, a chapter, new memories (counts).
 *
 *   Since you started (10:40): ~/deadfront ended 11:05, chapter "Fixing the
 *   gate" (epi_…), 3 memories: "Gate test passes" (mem_…); ~/random open
 *   since 10:52, 2 memories.
 *
 * `since` is when the session last heard (its wake, or the last such line):
 * the first line says "Since you started (10:40)", a later one "Since 11:40".
 * The same gates as "Today, elsewhere" — the caller applies them, the one
 * gate for both — and the same ladder of forms within
 * `TODAY_ELSEWHERE_MAX_BYTES`. A directory where nothing changed is not
 * named. The titles (2026-10-20) are of memories written since `since`, so
 * what one line named the next does not name again. Null when there is
 * nothing to say. Pure.
 */
export function sinceElsewhereLines(
  dirs: readonly SinceElsewhere[],
  since: { readonly at: number; readonly started: boolean; readonly now: number },
  zone?: string,
  here: readonly HereSession[] = [],
): { line: string; shorter: string[] } | null {
  const named = dirs
    .filter((d) => d.startedAt !== null || d.endedAt !== null || d.memories > 0 || d.chapter !== null)
    .sort(
      (a, b) =>
        Math.max(b.startedAt ?? 0, b.endedAt ?? 0, b.chapter?.writtenAt ?? 0, ...(b.titles ?? []).map((m) => m.at)) -
          Math.max(a.startedAt ?? 0, a.endedAt ?? 0, a.chapter?.writtenAt ?? 0, ...(a.titles ?? []).map((m) => m.at)) ||
        b.memories - a.memories ||
        (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0),
    );
  const clock = (at: number): string => localStamp(at, zone).split(" ")[1] ?? "";
  // A clock time alone while it is the same day; the day as well when not.
  const when = (at: number): string =>
    localDate(at, zone) === localDate(since.now, zone) ? clock(at) : localStamp(at, zone);
  const one = (d: SinceElsewhere, chapters: boolean, titles: number): string => {
    const state =
      d.startedAt !== null
        ? ` open since ${when(d.startedAt)}`
        : d.live
          ? " open"
          : d.endedAt !== null
            ? ` ended ${when(d.endedAt)}`
            : "";
    const chapter = !chapters || d.chapter === null ? "" : `, chapter ${chapterWords(d.chapter)}`;
    return `${placeWords(d.scope)}${state}${chapter}${countWords(d.memories, d.titles, titles)}`;
  };
  const head = since.started ? `Since you started (${when(since.at)}):` : `Since ${when(since.at)}:`;
  // A session here is named only when something changed in it: it started,
  // or wrote something that may be named.
  const changed = here.filter((h) => h.startedAt !== null || h.titles.length > 0);
  const oneHere = (h: HereSession, titles: number): string =>
    `${sessionWords(h.session, h.model)}${h.startedAt === null ? "" : ` open since ${when(h.startedAt)}`}${titleWords(h.titles, titles)}`;
  return elsewhereForms(head, named, one, { sessions: hereOrder(changed), one: oneHere, head: `${head} ${HERE_ALSO_OPEN.toLowerCase()}` });
}
