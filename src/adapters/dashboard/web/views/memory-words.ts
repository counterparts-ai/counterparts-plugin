/**
 * How a memory's words are SHOWN on the memories tab — the row's text, the date
 * beside it, whether it is a journal chapter, and its feelings in words. Shared
 * by the list, search and the memory card (2026-09-26: an experiment, not a
 * rule).
 *
 * Display only. Nothing here writes, and a date lifted off the front of a
 * memory's text is lifted from what is SHOWN; the stored body is untouched.
 */
import { wheelEntry } from "../../../../core/feelings-wheel.js";
import { readChapterLead } from "../../../../core/self/index.js";
import { recurrenceOfRow } from "../../../../core/store/index.js";
import type { MemoryRow, ReadOnlyStore } from "../../../../core/store/index.js";
import { readableRecurrence } from "../../../../core/time.js";

/** Where the date shown beside a row came from. */
export type DateFrom = "text" | "chapter" | "recorded";

export interface Shown {
  /** The words to show, a date written at their front lifted off. */
  readonly text: string;
  /** `YYYY-MM-DD`, or null when nothing dates it. */
  readonly date: string | null;
  readonly dateFrom: DateFrom | null;
}

export interface FeelingShown {
  readonly core: string;
  /** The wheel's word, or the person's own word for an `other`. */
  readonly word: string;
  readonly whose: string;
  readonly strength: number;
}

/**
 * How often a row's date comes round, as a person says it — `every May 14`,
 * `every Monday` (`time#readableRecurrence`) — or null for a date that happens
 * once. The same predicate the prune's `recurring` gate reads
 * (`store#recurrenceOfRow`, 2026-10-09), so a row that says it repeats is one
 * the prune keeps for its next occurrence.
 */
export function repeatsOf(row: Pick<MemoryRow, "event_date" | "meta">): string | null {
  const rule = recurrenceOfRow(row);
  if (rule === null || row.event_date === null) return null;
  const words = readableRecurrence(row.event_date, rule);
  return words === "" ? null : words;
}

/**
 * A JOURNAL-CHAPTER MEMORY: a `memory` row minted from a chapter of the journal
 * (`source = episode`, `meta.episodeId`). Its text is the chapter as written,
 * with no salience of its own, so a strength beside it reads "0%" — which looks
 * like something failing. It is shown as "journal" instead. (The journal ENTRY
 * itself, `type = episode`, is `sleep#isJournal`, and is not in the list.)
 */
export function isChapterMemory(row: Pick<MemoryRow, "type" | "source" | "meta">): boolean {
  if (row.type !== "memory") return false;
  if (row.source === "episode") return true;
  if (!row.meta.includes("episodeId")) return false;
  try {
    return typeof (JSON.parse(row.meta) as Record<string, unknown>)["episodeId"] === "string";
  } catch {
    return false;
  }
}

/**
 * A full `YYYY-MM-DD` at the very start, then `:`, `,`, a dash, or a space.
 * "2026 was…" and "2026-09 was…" are not dates to lift.
 */
const LEAD_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ \t]*[:,—–-][ \t]*|[ \t]+)(?=\S)/;

/** The date written at the front of `text`, and the text after it — or `text` untouched. */
export function liftDate(text: string): { date: string | null; rest: string } {
  const m = LEAD_DATE.exec(text);
  if (m === null) return { date: null, rest: text };
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { date: null, rest: text };
  // "2026-07-08, the pass…" reads as a sentence once the date is beside it.
  const rest = text.slice(m[0].length);
  return { date: `${y}-${mo}-${d}`, rest: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A chapter heading's date (`Fri 10 Jul 2026`) as `2026-07-10`, or null. */
export function chapterDate(written: string | null): string | null {
  if (written === null) return null;
  const m = /^[A-Za-z]{3} (\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(written.trim());
  if (m === null) return null;
  const month = MONTHS.indexOf((m[2] ?? "").toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What a row shows: its words on one line (markdown headings dropped), the date
 * lifted off their front, and the date beside them — the written one, else a
 * chapter's own, else the day it was recorded. A confidential row lifts nothing
 * from its words: it shows `withheld` and the recorded day.
 */
export function shownOf(
  body: string,
  opts: { chapter: boolean; learnedOn: string; confidential: boolean; withheld?: string; width?: number },
): Shown {
  const recorded = DAY.test(opts.learnedOn) ? opts.learnedOn : null;
  const fallback = { date: recorded, dateFrom: recorded === null ? null : ("recorded" as const) };
  if (opts.confidential) return { text: opts.withheld ?? "", ...fallback };
  let words = body;
  let fromChapter: string | null = null;
  if (opts.chapter) {
    const lead = readChapterLead(body);
    words = lead.rest;
    fromChapter = chapterDate(lead.date);
  }
  let flat = words
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (opts.chapter) {
    const bare = stripChapterLead(flat);
    flat = bare.rest;
    fromChapter ??= bare.date;
  }
  const lifted = liftDate(flat);
  const width = opts.width ?? 320;
  const text = lifted.rest.length > width ? `${lifted.rest.slice(0, width - 1).trimEnd()}…` : lifted.rest;
  if (lifted.date !== null) return { text, date: lifted.date, dateFrom: "text" };
  if (fromChapter !== null) return { text, date: fromChapter, dateFrom: "chapter" };
  return { text, ...fallback };
}

/**
 * A chapter's heading left in its words WITHOUT the markdown `#` that
 * `readChapterLead` reads — "Sun 27 Sep 2026 · claude-opus-5-5 · lived day 6
 * Mike wanted…" (seen on a live store, 2026-09-28) — lifted off, with its date.
 * The model id and the lived day are the journal's bookkeeping, not its words.
 */
const BARE_LEAD =
  /^(?:chapter[ \t]+\d+[ \t]*[—–-][ \t]*)?(?:([A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4})[ \t]*·[ \t]*)?(?:[A-Za-z0-9][A-Za-z0-9._:[\]-]*[ \t]*·[ \t]*)?lived day[ \t]+\d+[ \t]*/i;

export function stripChapterLead(text: string): { rest: string; date: string | null } {
  const m = BARE_LEAD.exec(text);
  if (m === null) return { rest: text, date: null };
  return { rest: text.slice(m[0].length).trimStart(), date: chapterDate(m[1] ?? null) };
}

/** The first sentence of `text` (up to its first `.`, `!` or `?` followed by a
 *  space), or all of it when there is no such end within `width`. */
export function firstSentence(text: string, width = 240): string {
  const m = /^(.{12,}?[.!?])(?=\s|$)/.exec(text);
  if (m !== null && m[1] !== undefined && m[1].length <= width) return m[1];
  return text.length > width ? `${text.slice(0, width - 1).trimEnd()}…` : text;
}

/** A memory's feelings in words, oldest first. The `carried_by` words are not here. */
export function feelingsShown(store: ReadOnlyStore, id: string): FeelingShown[] {
  let rows;
  try {
    rows = store.feelingsFor(id);
  } catch {
    return [];
  }
  return rows.map((f) => ({
    core: f.core,
    word: f.emotion === "other" ? (f.other_word ?? "other") : (wheelEntry(f.emotion)?.word ?? f.emotion),
    whose: f.whose,
    strength: f.strength,
  }));
}
