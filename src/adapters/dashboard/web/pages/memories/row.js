/* One memory as a row — the shape the list and the find box's answers share.
   Title on its own line with the words dimmer beneath (two lines, clipped); the
   date, the kind and the marks on the right. Every row is drawn at the same
   brightness (round 4, 2026-09-28): how well it is remembered shows only when
   it is not the usual — the one word "fading", or for a date that still
   repeats, how often ("repeats every May 14"). A plain fact carries no kind
   tag (the quiet default); a journal chapter is titled by its day. An id
   written inside the words is a small link to that memory (2026-10-09). */
import { esc } from "../../shared/dom.js";
import { dateOr, dateWords } from "../../shared/dates.js";
import { ID_IN_WORDS, badges, feelingDots, idMark, kindMark, kindOf } from "../../shared/memory-marks.js";
import { openMemory } from "../../shared/memory-modal.js";

/** Rows under `container` open their memory on a click or Enter (one listener
 *  for every row it will ever hold, so a repaint needs no rewiring). */
export function wireRows(container) {
  const open = (e) => {
    // A link inside a row (an id in its words, a moment under a chapter) opens what it names, not the row.
    const link = e.target.closest("[data-open]");
    if (link && container.contains(link)) { openMemory(link.dataset.open); return; }
    const row = e.target.closest(".mrow[data-id]");
    if (row && container.contains(row)) openMemory(row.dataset.id);
  };
  container.addEventListener("click", open);
  // Enter on a button inside a row is already a click; only the row itself needs this.
  container.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.target.closest("button")) open(e); });
}

const DATE_WORDS = {
  text: "the date written in the memory",
  chapter: "the day its journal chapter names",
  recorded: "the day it was recorded",
  happened: "the day it happened",
  learned: "the day I learned it",
};

/** A journal chapter's title: "Journal · Sun, Sep 27th", or "Journal" with no day. */
export function journalTitle(date) {
  const day = dateWords(date, { weekday: true });
  return day ? "Journal · " + day : "Journal";
}

/** A search's words as the word index splits them (`store/cache.ts#tokenize`):
 *  lower case, letters and digits, two or more. */
export function searchWords(q) {
  return String(q || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

const ID_SPLIT = new RegExp("(" + ID_IN_WORDS.source + ")");

/**
 * `text` with every whole word that is one of `words` (any case) in a
 * `<mark>` (M5, 2026-09-30), and every memory id in it drawn as a link to that
 * memory (`memory-marks.js#idMark`, 2026-10-09; `quiet`: drawn, not linked).
 * Escaped piece by piece BEFORE marking, so nothing unescaped reaches the page
 * and no mark lands inside an entity or an id.
 */
export function marked(text, words, quiet) {
  const want = new Set((words || []).map((w) => String(w).toLowerCase()));
  return String(text || "").split(ID_SPLIT)
    .map((piece, j) => (j % 2 === 1 ? idMark(piece, quiet) : markWords(piece, want)))
    .join("");
}

function markWords(text, want) {
  if (want.size === 0) return esc(text);
  return text.split(/([A-Za-z0-9]+)/)
    .map((part, i) => (i % 2 === 1 && want.has(part.toLowerCase()) ? "<mark>" + esc(part) + "</mark>" : esc(part)))
    .join("");
}

/**
 * A row's title and words without the date the right-hand column already
 * shows (M6, 2026-09-30): "… session (2026-09-30)" at the end of a title, and
 * "On 2026-09-30 …" or "2026-09-30: …" at the start of the words, only when
 * that date IS the row's date. Anything else is left as written. Display only:
 * the card and the memory keep every date.
 */
export function withoutRowDate(title, text, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return { title, text };
  const t = /^(.*\S)\s*[([]\s*(\d{4}-\d{2}-\d{2})\s*[)\]]$/.exec(String(title || ""));
  const w = /^(?:on\s+)?(\d{4}-\d{2}-\d{2})(?:\s*[:,—–-]\s*|\s+)(?=\S)/i.exec(String(text || ""));
  const rest = w && w[1] === date ? String(text).slice(w[0].length) : null;
  return {
    title: t && t[2] === date ? t[1] : title,
    text: rest === null ? text : rest.charAt(0).toUpperCase() + rest.slice(1),
  };
}

/**
 * `r`: { id, title, text, confidential, kind, date, dateFrom, core, protected,
 * journal, feelings, archived, hold, versions, schemaRole }. With no `id` the
 * row opens nothing (a session's moments in an Ask by meaning); with no
 * `kind` it carries no kind tag (an answer that does not say). `opts.under`
 * is markup, already escaped, drawn under the words (an Ask answer's who said
 * it, when, and what it was before); `opts.mark` (words) marks where a
 * search's words appear.
 */
export function memRow(r, opts = {}) {
  // The date on the right is not said again in the words beside it.
  const own = r.journal || r.confidential ? { title: r.title, text: r.text } : withoutRowDate(r.title, r.text, r.date);
  const words = r.confidential ? '<span class="withheld">' + esc(r.text) + "</span>" : marked(own.text, opts.mark);
  const title = r.journal && !r.confidential ? journalTitle(r.date) : own.title;
  const main = title
    ? '<div class="mtitle">' + marked(title, opts.mark) + "</div>" + (own.text ? '<div class="mtext">' + words + "</div>" : "")
    : '<div class="mtext solo">' + words + "</div>";
  const k = kindOf(r.kind);
  const kindWords = k.label + (r.schemaRole ? " · " + r.schemaRole : "");
  // A plain fact is the quiet default: no tag. A journal chapter says so in its title.
  const kindTag = !r.kind || (r.kind === "fact" && !r.schemaRole) || r.journal ? ""
    : '<span class="mkind" title="' + esc(kindWords) + '">' + kindMark(r.kind, false) + '<span class="klabel">' + esc(kindWords) + "</span></span>";
  // A date that still repeats is kept for its next time, however faint (2026-10-09): it is never "fading", and says how often instead.
  const held = r.hold === "fading" ? '<span class="mfading" title="unless it is used, I may put it away within my next two weeks of use">fading</span>'
    : r.repeats ? '<span class="mrepeats" title="' + esc("it comes round " + r.repeats + ", so I'll keep it while it does") + '">repeats ' + esc(r.repeats) + "</span>" : "";
  const date = r.date && !r.journal
    ? '<span class="mdate" title="' + esc(DATE_WORDS[r.dateFrom] || "") + '">' + esc(dateOr(r.date)) + "</span>" : "";
  const put = r.archived
    ? '<div class="mwhy">put away: ' + esc(r.archived) + (r.versions > 1 ? " · " + r.versions + " versions" : "") + "</div>" : "";
  const open = r.id ? ' click" role="button" tabindex="0" data-id="' + esc(r.id) + '"' : '"';
  return '<div class="mrow' + (r.archived ? " arch" : "") + open + ">" +
    '<div class="mmain">' + main + (opts.under || "") + put + "</div>" +
    '<div class="mside">' +
      '<span class="mline">' + held + date + "</span>" +
      '<span class="mline">' + badges({ ...r, journal: false }) + feelingDots(r.feelings, true) + kindTag + "</span>" +
    "</div></div>";
}
