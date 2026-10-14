import { wheelEntry } from "../../../../core/feelings-wheel.js";
import { readChapterLead } from "../../../../core/self/index.js";
import { recurrenceOfRow } from "../../../../core/store/index.js";
import { readableRecurrence } from "../../../../core/time.js";
export function repeatsOf(row) {
  const rule = recurrenceOfRow(row);
  if (rule === null || row.event_date === null)
    return null;
  const words = readableRecurrence(row.event_date, rule);
  return words === "" ? null : words;
}
export function isChapterMemory(row) {
  if (row.type !== "memory")
    return false;
  if (row.source === "episode")
    return true;
  if (!row.meta.includes("episodeId"))
    return false;
  try {
    return typeof JSON.parse(row.meta)["episodeId"] === "string";
  } catch {
    return false;
  }
}
const LEAD_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ \t]*[:,—–-][ \t]*|[ \t]+)(?=\S)/;
export function liftDate(text) {
  const m = LEAD_DATE.exec(text);
  if (m === null)
    return { date: null, rest: text };
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31)
    return { date: null, rest: text };
  const rest = text.slice(m[0].length);
  return { date: `${y}-${mo}-${d}`, rest: rest.charAt(0).toUpperCase() + rest.slice(1) };
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function chapterDate(written) {
  if (written === null)
    return null;
  const m = /^[A-Za-z]{3} (\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(written.trim());
  if (m === null)
    return null;
  const month = MONTHS.indexOf((m[2] ?? "").toLowerCase());
  if (month < 0)
    return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function shownOf(body, opts) {
  const recorded = DAY.test(opts.learnedOn) ? opts.learnedOn : null;
  const fallback = { date: recorded, dateFrom: recorded === null ? null : "recorded" };
  if (opts.confidential)
    return { text: opts.withheld ?? "", ...fallback };
  let words = body;
  let fromChapter = null;
  if (opts.chapter) {
    const lead = readChapterLead(body);
    words = lead.rest;
    fromChapter = chapterDate(lead.date);
  }
  let flat = words.split(`
`).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#")).join(" ").replace(/\s+/g, " ").trim();
  if (opts.chapter) {
    const bare = stripChapterLead(flat);
    flat = bare.rest;
    fromChapter ??= bare.date;
  }
  const lifted = liftDate(flat);
  const width = opts.width ?? 320;
  const text = lifted.rest.length > width ? `${lifted.rest.slice(0, width - 1).trimEnd()}…` : lifted.rest;
  if (lifted.date !== null)
    return { text, date: lifted.date, dateFrom: "text" };
  if (fromChapter !== null)
    return { text, date: fromChapter, dateFrom: "chapter" };
  return { text, ...fallback };
}
const BARE_LEAD = /^(?:chapter[ \t]+\d+[ \t]*[—–-][ \t]*)?(?:([A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4})[ \t]*·[ \t]*)?(?:[A-Za-z0-9][A-Za-z0-9._:[\]-]*[ \t]*·[ \t]*)?lived day[ \t]+\d+[ \t]*/i;
export function stripChapterLead(text) {
  const m = BARE_LEAD.exec(text);
  if (m === null)
    return { rest: text, date: null };
  return { rest: text.slice(m[0].length).trimStart(), date: chapterDate(m[1] ?? null) };
}
export function firstSentence(text, width = 240) {
  const m = /^(.{12,}?[.!?])(?=\s|$)/.exec(text);
  if (m !== null && m[1] !== undefined && m[1].length <= width)
    return m[1];
  return text.length > width ? `${text.slice(0, width - 1).trimEnd()}…` : text;
}
export function feelingsShown(store, id) {
  let rows;
  try {
    rows = store.feelingsFor(id);
  } catch {
    return [];
  }
  return rows.map((f) => ({
    core: f.core,
    word: f.emotion === "other" ? f.other_word ?? "other" : wheelEntry(f.emotion)?.word ?? f.emotion,
    whose: f.whose,
    strength: f.strength
  }));
}
