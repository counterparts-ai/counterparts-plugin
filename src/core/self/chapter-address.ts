/**
 * CHAPTER ADDRESSES (v12, 2026-10-03, the write side of deliberate recall) —
 * one chapter of an episode, named `epi_…#N` (N counted from 1), resolved to
 * its heading, its text, its span in time, and the memories its session
 * wrote during that span.
 *
 * **Derived, not stored.** The address is the episode's id and the chapter's
 * place among the engine headings in its body (`handoff/last-here.ts#
 * chaptersOf`, the one reader of them); nothing records it. What IS stored is
 * the moment each chapter was written (`episodes.ts#CHAPTER_AT_META`, from
 * v12 on), because the only other record of it — the version row each new
 * chapter leaves behind (`reason: episode-chapter`, its `archived_at` the
 * moment the next chapter opened) — is pruned after the retention window. An
 * episode written before v12 is read from those versions while they last;
 * past them, a chapter's moment is unknown and the resolver says so rather
 * than guessing one from the heading's calendar day.
 *
 * **A chapter's span** is the stretch it wrote up: from the moment the
 * chapter before it was written (none for the first: open) to the moment it
 * was written. The memories under it are its session's own (`origin_session`),
 * live, minus the chapter copies themselves, written inside that span — with
 * `CHAPTER_MOMENT_GRACE_MS` after each edge, because the end-of-stretch answer
 * writes its memories and its chapter in one turn, in either order, and the
 * memories written a moment after the chapter belong to it rather than to the
 * next. A write-up's memories (another session writing this one's stretch
 * up later) carry this session's id but a later moment, so they fall after
 * the last chapter and are not listed under any.
 *
 * Recall's meaning mode (Release B) places many memories at once: it reads
 * each episode's chapter moments once (`chapterTimesOf`) and puts a memory
 * under a chapter by the same span rule (`chapterAt`), resolving in full only
 * the chapters it shows.
 */
import { chaptersOf } from "../handoff/last-here.js";
import type { ReadOnlyStore } from "../store/index.js";
import { CHAPTER_AT_META, chapterMoments } from "./episodes.js";

/**
 * How long after a chapter is written a memory of its session still counts
 * as that chapter's (a working default, 2026-10-03): the end-of-stretch
 * answer lands `session_end` entries and the chapter in one turn, in either
 * order, seconds apart. Five minutes covers a slow turn without taking much
 * of the next stretch.
 */
export const CHAPTER_MOMENT_GRACE_MS = 5 * 60_000;

/** `epi_…#N`: an episode id (no whitespace, no `#`) and a 1-based chapter number. */
const ADDRESS = /^(epi_[^\s#/]+)#([1-9]\d*)$/;

/** The address of chapter `n` (1-based) of an episode. */
export function chapterAddress(episodeId: string, n: number): string {
  return `${episodeId}#${String(n)}`;
}

/** An address read, or null when it is not one. */
export function parseChapterAddress(text: unknown): { episodeId: string; chapter: number } | null {
  if (typeof text !== "string") return null;
  const m = ADDRESS.exec(text.trim());
  if (m === null) return null;
  return { episodeId: m[1] as string, chapter: Number(m[2]) };
}

/** Where a chapter's moments were read from. */
export type ChapterMomentSource = "stored" | "versions" | "unknown";

export interface ResolvedChapter {
  readonly address: string;
  readonly episodeId: string;
  /** 1-based. */
  readonly chapter: number;
  /** How many chapters the episode holds. */
  readonly of: number;
  /** The engine heading line, or null for a body with none (one chapter, whole). */
  readonly heading: string | null;
  /** The chapter's own words, without its heading. */
  readonly text: string;
  /** The calendar date its heading names (`YYYY-MM-DD`), or null. */
  readonly date: string | null;
  /** The session that wrote the episode, or null when its meta does not say. */
  readonly session: string | null;
  /** The episode's title, when it has one. */
  readonly title: string | null;
  /**
   * The stretch it wrote up, UTC ms: `from` is when the chapter before it was
   * written (null for the first chapter: open), `to` when this one was (null
   * when unknown). Without the grace: these are the moments themselves.
   */
  readonly span: { readonly from: number | null; readonly to: number | null };
  readonly momentsFrom: ChapterMomentSource;
  /**
   * The session's live memories written inside the span (with the grace),
   * oldest first — not the chapter copies. Empty, and `momentsFrom:
   * "unknown"`, when the chapter's own moment cannot be read.
   */
  readonly moments: readonly string[];
}

export type ChapterResolution =
  | { readonly ok: true; readonly chapter: ResolvedChapter }
  | { readonly ok: false; readonly reason: "not-an-address" | "no-episode" | "no-such-chapter"; readonly of?: number };

/**
 * Resolve `epi_…#N`. Reads only: the episode row, its version rows when it
 * predates stored moments, and its session's memories. Never throws on a
 * store that will not answer one of those — the part it could not read is
 * empty and the rest stands.
 */
export function resolveChapter(store: ReadOnlyStore, address: string): ChapterResolution {
  const parsed = parseChapterAddress(address);
  if (parsed === null) return { ok: false, reason: "not-an-address" };
  const row = store.row(parsed.episodeId);
  if (row === undefined || row.type !== "episode" || row.body.length === 0) return { ok: false, reason: "no-episode" };
  let meta: Record<string, unknown> = {};
  try {
    meta = store.readProse(parsed.episodeId).meta;
  } catch {
    return { ok: false, reason: "no-episode" };
  }
  const all = chaptersOf(row.body);
  const at = all[parsed.chapter - 1];
  if (at === undefined) return { ok: false, reason: "no-such-chapter", of: all.length };

  const { moments: written, from: momentsFrom } = chapterTimes(store, parsed.episodeId, meta, all.length, row.created_at);
  const to = written[parsed.chapter] ?? null;
  const from = parsed.chapter === 1 ? null : (written[parsed.chapter - 1] ?? null);
  const session = typeof meta["sessionId"] === "string" ? (meta["sessionId"] as string) : null;
  // The chapter before's moment unknown while this one's is known: the span
  // cannot be cut at its start, so nothing is listed rather than too much.
  const cuttable = to !== null && (parsed.chapter === 1 || from !== null);
  const moments = cuttable && session !== null ? momentsIn(store, session, parsed.episodeId, from, to) : [];
  return {
    ok: true,
    chapter: {
      address: chapterAddress(parsed.episodeId, parsed.chapter),
      episodeId: parsed.episodeId,
      chapter: parsed.chapter,
      of: all.length,
      heading: at.heading,
      text: at.text.trim(),
      date: at.date,
      session,
      title: row.title,
      span: { from, to },
      momentsFrom: cuttable ? momentsFrom : "unknown",
      moments,
    },
  };
}

/** When each chapter of an episode was written, read once (`chapterTimesOf`). */
export interface ChapterTimes {
  readonly episodeId: string;
  /** How many chapters the episode holds. */
  readonly of: number;
  /** Chapter number (1-based) -> the moment it was written, UTC ms; a chapter missing here is unknown. */
  readonly moments: Readonly<Record<number, number>>;
  readonly from: ChapterMomentSource;
}

/**
 * The moments an episode's chapters were written, by `resolveChapter`'s own
 * reading (stored, else the versions), without resolving each chapter's
 * memories — for a caller that places many memories at once. Null when the
 * id is not an episode with words. Never throws.
 */
export function chapterTimesOf(store: ReadOnlyStore, episodeId: string): ChapterTimes | null {
  try {
    const row = store.row(episodeId);
    if (row === undefined || row.type !== "episode" || row.body.length === 0) return null;
    const meta = store.readProse(episodeId).meta;
    const of = chaptersOf(row.body).length;
    const { moments, from } = chapterTimes(store, episodeId, meta, of, row.created_at);
    return { episodeId, of, moments, from };
  } catch {
    return null;
  }
}

/**
 * The chapter (1-based) a memory of the episode's session written at `at`
 * falls under, by `resolveChapter`'s span rule — after the chapter before it
 * was written (plus the grace), up to this one's moment plus the grace — or
 * null when no chapter's span can be cut there (its moment, or the one
 * before it, unknown) or `at` is past the last chapter (a later write-up).
 */
export function chapterAt(times: ChapterTimes, at: number): number | null {
  for (let k = 1; k <= times.of; k++) {
    const to = times.moments[k];
    if (to === undefined) continue;
    const from = k === 1 ? null : times.moments[k - 1];
    if (from === undefined) continue;
    const lo = from === null ? Number.NEGATIVE_INFINITY : from + CHAPTER_MOMENT_GRACE_MS;
    if (at > lo && at <= to + CHAPTER_MOMENT_GRACE_MS) return k;
  }
  return null;
}

/**
 * When each chapter was written, by number: the stored map (v12 on), else
 * the episode's own version rows — chapter 1 at the row's birth, chapter k+1
 * at the `archived_at` of the `episode-chapter` version whose words held k
 * chapters — while they last.
 */
function chapterTimes(
  store: ReadOnlyStore,
  episodeId: string,
  meta: Record<string, unknown>,
  count: number,
  createdAt: number | null,
): { moments: Record<number, number>; from: ChapterMomentSource } {
  const stored = meta[CHAPTER_AT_META] === undefined ? {} : chapterMoments(meta);
  const out: Record<number, number> = {};
  // An episode that began before v12 and went on after it has stored moments
  // for its later chapters only: the versions give the earlier ones.
  if (Object.keys(stored).length < count) {
    if (createdAt !== null) out[1] = createdAt;
    try {
      for (const v of store.versions(episodeId)) {
        if (v.reason !== "episode-chapter" || v.body.length === 0) continue;
        const held = chaptersOf(v.body).filter((c) => c.heading !== null).length;
        if (held >= 1 && held < count && out[held + 1] === undefined) out[held + 1] = v.archived_at;
      }
    } catch {
      /* versions unreadable: what the row gives */
    }
  }
  for (const [k, v] of Object.entries(stored)) out[Number(k)] = v;
  const from: ChapterMomentSource = Object.keys(stored).length > 0 ? "stored" : Object.keys(out).length > 0 ? "versions" : "unknown";
  return { moments: out, from };
}

/** The session's live memories written in (from, to], each edge shifted by the grace; chapter copies left out. */
function momentsIn(store: ReadOnlyStore, session: string, episodeId: string, from: number | null, to: number): string[] {
  const lo = from === null ? Number.NEGATIVE_INFINITY : from + CHAPTER_MOMENT_GRACE_MS;
  const hi = to + CHAPTER_MOMENT_GRACE_MS;
  const out: string[] = [];
  try {
    for (const m of store.memoriesOfSession(session)) {
      if (m.at <= lo || m.at > hi) continue;
      const row = store.row(m.id);
      if (row === undefined || row.source === "episode") continue;
      let copy = false;
      try {
        copy = store.readProse(m.id).meta["episodeId"] === episodeId;
      } catch {
        copy = false;
      }
      if (!copy) out.push(m.id);
    }
  } catch {
    return [];
  }
  return out;
}
