/**
 * A CHAPTER'S SUMMARY MEMORY (2026-10-15, P1 — approved by Mike that day).
 *
 * Until now every chapter was also ingested as a FULL COPY: an ordinary
 * self-kind memory with the episode's whole body, written again (and the old
 * one archived) each time the chapter grew. On the owner's store that kept the
 * journal's words three times over — 101 live copies, 320 archived ones and
 * 326 version rows, every one an exact prefix of its chapter — while recall
 * already folded the copy into its chapter and the decay pass already skipped
 * it. What the copy still carried was its links, its marks and a row in the
 * memory list.
 *
 * Now each chapter gets ONE summary memory, written once and never regrown:
 * what the session wants to find the chapter by later — what happened, what
 * was decided, the names, numbers and words someone would search for. It has
 * the copy's shape (`source = 'episode'`, `origin_ref` = the chapter's id,
 * `meta.episodeId`) plus `meta.chapter`, so recall's fold, use credit, the
 * wake's confidential and `about` flags and every other reader of that shape
 * keep working; `meta.chapterSummary` says how it was written. The chapter
 * keeps every word.
 *
 * When the session gives none, the boundary writes an AUTOMATIC one — the
 * chapter's title and opening lines — marked `automatic`, so a chapter is
 * never without its memory and doctor can count how often sessions skip it.
 *
 * Unlike the copy, a summary FADES like any memory (Mike, 2026-10-15): it is
 * not reach-exempt and the decay and prune passes take it. The 101 frozen
 * copies from before keep their exemption (`store/operational.ts#
 * isChapterSummary` is what tells the two apart).
 *
 * Reads only; `Self` writes.
 */
import { chaptersOf } from "../handoff/last-here.js";
import type { ChapterSummaryKind, ReadOnlyStore } from "../store/index.js";
import { CHAPTER_SUMMARY_META, chapterSummaryKind } from "../store/index.js";
import { readChapterLead } from "./episodes.js";

export { CHAPTER_SUMMARY_META };
export type { ChapterSummaryKind };

/**
 * The archive reason of a second live summary of one chapter (review of #504):
 * a boundary's automatic summary and the session's own can cross between a
 * check and a write in two processes; the session's stands (`Self#settleSummaries`).
 */
export const SUMMARY_DUPLICATE_REASON = "summary-duplicate";

/** A summary's `meta` key for the chapter it stands for, 1-based (`chaptersOf`'s order, as in `epi_…#N`). */
export const SUMMARY_CHAPTER_META = "chapter";

/**
 * How much of a chapter's opening an AUTOMATIC summary keeps (2026-10-15, a
 * working default): about the length a session's own summary is asked for,
 * so the two read alike in a list. Cut at a sentence or a word, with "…".
 */
export const AUTO_SUMMARY_CHARS = 600;

/** One chapter's summary memory, as read. */
export interface ChapterSummary {
  readonly id: string;
  readonly episodeId: string;
  /** 1-based. */
  readonly chapter: number;
  readonly kind: ChapterSummaryKind;
  readonly body: string;
  readonly archived: boolean;
  readonly createdAt: number;
  /** When its words were last written (a rewrite over an automatic one moves it). */
  readonly writtenAt: number;
}

/**
 * The summaries of the given episodes, by episode and then chapter. Live ones
 * only, unless `archived` — "has this chapter EVER had one" (written once:
 * a summary the prune or a merge took is not written again). Where a chapter
 * has more than one, a written one stands over an automatic one, then the
 * live over the archived, then the newest. Never throws: what will not read
 * is left out.
 */
export function chapterSummaries(
  store: ReadOnlyStore,
  episodeIds: readonly string[],
  opts: { archived?: boolean } = {},
): Map<string, Map<number, ChapterSummary>> {
  const out = new Map<string, Map<number, ChapterSummary>>();
  const ids = [...new Set(episodeIds)];
  if (ids.length === 0) return out;
  const candidates: string[] = [];
  try {
    if (opts.archived === true) {
      for (const e of ids) candidates.push(...store.list({ type: "memory", source: "episode", originRef: e }));
    } else {
      for (const held of store.copiesOf(ids).values()) for (const h of held) candidates.push(h.id);
    }
  } catch {
    return out;
  }
  for (const id of candidates) {
    const s = summaryOf(store, id);
    if (s === null) continue;
    const byChapter = out.get(s.episodeId) ?? new Map<number, ChapterSummary>();
    const held = byChapter.get(s.chapter);
    if (held === undefined || ranks(s) > ranks(held) || (ranks(s) === ranks(held) && s.createdAt > held.createdAt)) byChapter.set(s.chapter, s);
    out.set(s.episodeId, byChapter);
  }
  return out;
}

function ranks(s: ChapterSummary): number {
  return (s.kind === "written" ? 2 : 0) + (s.archived ? 0 : 1);
}

/** The summary a row is, or null when it is not one. */
export function summaryOf(store: ReadOnlyStore, id: string): ChapterSummary | null {
  try {
    const row = store.row(id);
    if (row === undefined || row.type !== "memory" || row.source !== "episode" || row.origin_ref === null) return null;
    const meta = JSON.parse(row.meta || "{}") as Record<string, unknown>;
    const kind = chapterSummaryKind(meta);
    const chapter = meta[SUMMARY_CHAPTER_META];
    if (kind === null || typeof chapter !== "number" || !Number.isInteger(chapter) || chapter < 1) return null;
    return { id, episodeId: row.origin_ref, chapter, kind, body: row.body, archived: row.archived === 1, createdAt: row.created_at ?? 0, writtenAt: row.updated_at ?? row.created_at ?? 0 };
  } catch {
    return null;
  }
}

/**
 * THE CHAPTERS A FROZEN COPY ALREADY STANDS FOR: the most chapters any full
 * copy of this episode (live or archived) held when it was made. Those
 * chapters get no automatic summary — the copy is their memory, as it was —
 * so the first boundary after the change does not write a summary for every
 * chapter the store already holds. Chapters past it (an episode still being
 * written when the change landed, or grown after its regrow window closed)
 * are summarized as new ones are. 0 when the episode has no copy.
 */
export function chaptersCoveredByCopies(store: ReadOnlyStore, episodeId: string): number {
  let covered = 0;
  try {
    for (const id of store.list({ type: "memory", source: "episode", originRef: episodeId })) {
      const row = store.row(id);
      if (row === undefined || row.type !== "memory" || row.body.length === 0) continue;
      if (chapterSummaryKind(row.meta) !== null) continue;
      covered = Math.max(covered, chaptersOf(row.body).length);
    }
  } catch {
    return covered;
  }
  return covered;
}

/**
 * An AUTOMATIC summary's words: the chapter's opening, its heading taken off,
 * kept to `AUTO_SUMMARY_CHARS` — cut at the last sentence end in the second
 * half of the room, else at a word, with "…". The title rides as the row's
 * own title (`summaryTitle`). Empty when the chapter says nothing.
 */
export function automaticSummaryText(chapterText: string, max: number = AUTO_SUMMARY_CHARS): string {
  const text = readChapterLead(chapterText).rest.trim();
  if (text.length <= max) return text;
  const room = text.slice(0, max);
  const sentence = Math.max(room.lastIndexOf(". "), room.lastIndexOf(".\n"), room.lastIndexOf("! "), room.lastIndexOf("? "));
  if (sentence >= max / 2) return `${room.slice(0, sentence + 1).trimEnd()} …`;
  const word = room.lastIndexOf(" ");
  return `${(word >= max / 2 ? room.slice(0, word) : room).trimEnd()}…`;
}

/**
 * A summary's title: the episode's own for its first chapter, `<title> —
 * chapter N` for a later one, so a session's summaries are told apart in a
 * list instead of reading as duplicates. None when the episode has none.
 */
export function summaryTitle(episodeTitle: string | null | undefined, chapter: number): string | undefined {
  const t = (episodeTitle ?? "").trim();
  if (t.length === 0) return undefined;
  return chapter <= 1 ? t : `${t} — chapter ${String(chapter)}`;
}
