/* Find a memory: ONE box (round 4, 2026-09-28) with a switch beside it
   (2026-09-30). Three ways since 2026-10-09, when recall took a mode (0.3.12):

   - "by word" finds memories by their words as you type (`/api/search`);
     Enter only runs it at once.
   - "facts" asks on Enter, in facts mode: every memory that answers the
     question, counted and paged, best first — each with who said it, when it
     happened or was learned, and whether it still holds.
   - "by meaning" asks on Enter, in meaning mode: what a person, a project or
     a feeling has been over time — the journal chapters that hold it, in time
     order, with their moments and the feelings recorded in them.

   Both asks are the console's own `counterparts ask --json` (with `--mode`),
   through the actions seam, and the page draws the answer the command
   returned: no label here stands for a field the answer does not carry. The
   drawing is pure (`factsRows`, `meaningRows`, …) and the tests feed it real
   answers from a temp store (`test/dashboard-ask-answers.test.ts`) — the page
   read the old answer's shape for a release after it changed, and nothing
   failed, because its tests were fed by hand.

   The switch never flips by itself. Either way the answers take the list's
   place — never a second list — and the "×" gives the list back. Ask is the
   owner talking to me, so the server turns the question into my voice before
   it searches (`web/ask-voice.ts`); that is not shown. */
import { absenceLine } from "../../../shared/absence.js";
import { act, resultHtml } from "../../../shared/actions.js";
import { api, fail } from "../../../shared/api.js";
import { dateOr } from "../../../shared/dates.js";
import { $, esc } from "../../../shared/dom.js";
import { withIdMarks } from "../../../shared/memory-marks.js";
import { memRow, searchWords } from "../row.js";
import { find, onFilter, setFilter } from "../state.js";

export const markup = `
        <div class="find">
          <label class="find-lab" for="q">Find a memory</label>
          <div class="find-bar">
            <div class="find-row">
              <input id="q" type="search" autocomplete="off" spellcheck="false">
              <button class="find-x" id="q-x" type="button" aria-label="clear, and show every memory" title="clear" hidden>×</button>
            </div>
            <div class="seggroup find-mode" id="q-mode" role="group" aria-label="find by"></div>
          </div>
          <div class="find-head" id="find-head" hidden></div>
        </div>`;

let qtimer = null;
let seq = 0;
/** The question and mode the answer on the page is for, so its pager asks the same again. */
let asked = null;

/** The three ways to find, as the switch says them, and what the box says for each. */
export const MODES = {
  word: { label: "by word", placeholder: "a word or two — the answers come as you type" },
  facts: { label: "facts", placeholder: "ask a question, then press Enter — every memory that answers it" },
  meaning: { label: "by meaning", placeholder: "who or what, over time — ask, then press Enter" },
};

/** The switch and the box's placeholder, as `find.mode` says. */
function paintMode() {
  $("q-mode").innerHTML = Object.entries(MODES).map(([m, x]) =>
    '<button type="button" class="fchip' + (find.mode === m ? " on" : "") + '" data-mode="' + m + '" aria-pressed="' +
      (find.mode === m) + '">' + x.label + "</button>").join("");
  $("q").placeholder = MODES[find.mode].placeholder;
}

export function mount() {
  const box = $("q");
  paintMode();
  box.addEventListener("input", () => {
    clearTimeout(qtimer);
    $("q-x").hidden = box.value.length === 0;
    if (find.mode === "word") qtimer = setTimeout(runSearch, 180);
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(qtimer);
      if (find.mode === "word") runSearch(); else ask(box.value.trim(), find.mode, 1);
    } else if (e.key === "Escape" && box.value) { e.preventDefault(); clear(); }
  });
  $("q-x").addEventListener("click", () => { clear(); box.focus(); });
  $("q-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b || b.dataset.mode === find.mode) return;
    find.mode = b.dataset.mode;
    paintMode();
    box.focus();
    const words = box.value;
    if (!words.trim()) return;
    if (find.mode === "word") { runSearch(); return; }
    // An ask waits for Enter: the list comes back, the question stays.
    seq++;
    if (find.on) setFilter({});
    box.value = words;
    $("q-x").hidden = false;
    $("find-head").hidden = false;
    $("find-head").innerHTML = '<span class="find-hint">press Enter to ask</span>';
  });
  // An answer's pages: the same question, in the same mode, again. (The
  // list's own pager buttons carry `data-off`; these carry `data-ask-page`.)
  $("mpager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ask-page]");
    if (!b || b.disabled || !asked || !find.on) return;
    ask(asked.q, asked.mode, Number(b.dataset.askPage));
    $("q").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  // A filter chosen anywhere else (a chip, the chart, a link from Home) ends
  // the find: the box empties so it never shows words the list isn't answering.
  onFilter(() => {
    if (find.on || !box.value) return;
    seq++;
    box.value = "";
    $("q-x").hidden = true;
    $("find-head").hidden = true;
  });
}

/** Give the list back: the box emptied, the list redrawn as it was. */
function clear() {
  seq++; // an answer still on its way is dropped
  $("q").value = "";
  $("q-x").hidden = true;
  $("find-head").hidden = true;
  setFilter({});
}

/** The list's own parts hide while the answers stand in its place. */
function takeList(head) {
  find.on = true;
  $("mfilters").hidden = true;
  $("msort").hidden = true;
  $("mpager").innerHTML = "";
  $("find-head").hidden = false;
  $("find-head").innerHTML = head;
}

/** How many matched, said honestly: "the closest 25 of 143 matches" when the list
 *  stops short of every match, "3 matches" when it is all of them. */
export function matchCount(shown, total) {
  const all = typeof total === "number" && total > shown ? total : shown;
  if (all > shown) return "the closest " + shown + " of " + all + " matches";
  return shown + (shown === 1 ? " match" : " matches");
}

async function runSearch() {
  const q = $("q").value.trim();
  if (q.length === 0) { if (find.on) clear(); return; }
  const mine = ++seq;
  let d;
  try { d = await api("/api/search?limit=25&q=" + encodeURIComponent(q)); }
  catch (e) { return fail("Search", e); }
  if (mine !== seq || $("q").value.trim() !== q) return;
  const close = d.close || [];
  takeList(esc(findHead(d.hits.length, d.total, close.length)));
  $("mlist").innerHTML = d.absent
    ? absenceLine(d.absent, "nothing I hold uses those words — try asking for the facts")
    : d.hits.map((h) => memRow({ ...h, text: h.shown, archived: null }, { mark: searchWords(q) })).join("") +
      (close.length > 0
        ? '<div class="mclose-h">Close matches <span>· a letter or two off</span></div>' +
          close.map((h) => memRow({ ...h, text: h.shown, archived: null }, { mark: h.matched })).join("")
        : "");
}

/** The line over the answers: the exact matches, then the close ones (M4, 2026-09-30). */
export function findHead(shown, total, close) {
  const exact = shown === 0 && close > 0 ? "no exact match" : matchCount(shown, total);
  return exact + (close > 0 ? " · " + close + (close === 1 ? " close match" : " close matches") : "");
}

/** Words too common to be worth marking in an answer to a question. */
const QUESTION_WORDS = new Set(("what when where which while that this these those there their they them then than " +
  "with from have does did about your you remember know said would could should been were into just some much many also ever").split(" "));

/** Ask's question, as words to mark in its answers: the longer ones, the common ones left out. */
export function questionWords(q) {
  return searchWords(q).filter((w) => w.length >= 4 && !QUESTION_WORDS.has(w));
}

/** Ask the console, in `mode`, and put its answer where the list is. */
async function ask(q, mode, page) {
  if (!q) return;
  const mine = ++seq;
  asked = { q, mode };
  takeList("thinking…");
  $("mlist").innerHTML = "";
  const r = await act("ask", { question: q, json: true, mode, ...(page > 1 ? { page } : {}) });
  if (mine !== seq) return;
  let result = null;
  if (r && r.ok && Array.isArray(r.out)) {
    try { result = JSON.parse(r.out.join("\n")); } catch (e) { result = null; }
  }
  // An answer in another mode than the one asked is not drawn as if it were.
  if (!result || result.mode !== mode) { takeList("I couldn't ask that"); $("mlist").innerHTML = resultHtml(r); return; }
  const meaning = mode === "meaning";
  takeList(meaning ? meaningHead(result) : factsHead(result));
  $("mlist").innerHTML = meaning ? meaningRows(result) : factsRows(result, q);
  $("mpager").innerHTML = askPager(result);
}

// ── the answers, drawn (pure: no DOM, so `bun test` draws real ones) ─────────

/** Results on one page of a facts answer: `mcp/facts.ts#FACTS_PAGE_SIZE` (a test holds the two equal). */
export const FACTS_PAGE = 10;

/** Who said it (`FactItem.saidBy`), in my voice — the console's words (`facts.ts`). */
export const SAID = { owner: "you said", self: "I said", inferred: "inferred" };

const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");

/** Why words alone answered, when they did (`facts.ts#channelWords`); null when meaning searched too. */
export function channelWords(semantic) {
  if (semantic === "embedder-off") return "by words only — recall by meaning is off";
  if (semantic === "embed-failed") return "by words only — the question could not be embedded";
  return null;
}

/** The notes under a head line, quieter, or nothing. */
const noteLine = (notes) => (notes.length > 0 ? '<span class="find-note">' + esc(notes.join(" · ")) + "</span>" : "");

/** The open ends of a window ("before 7/22", "after 7/22"): `recall/time-ask.ts`'s
 *  `OPEN_START` and `OPEN_END` (2026-10-09). */
const OPEN_START = "0001-01-01";
const OPEN_END = "9999-12-31";

/** A window of days: "Sep 21st – Sep 27th", one day, "through Jul 21st" or "Jul 23rd onward". */
function span(w) {
  if (!w) return "";
  if (w.from === OPEN_START) return "through " + dateOr(w.to);
  if (w.to === OPEN_END) return dateOr(w.from) + " onward";
  return w.from === w.to ? dateOr(w.from) : dateOr(w.from) + " – " + dateOr(w.to);
}

/** The time a facts question named (`FactsResult.time`), in a line; "" when it named none. */
export function timeWords(t) {
  if (!t) return "";
  const outside = t.outside > 0 ? ", " + t.outside + " more outside it" : "";
  if (t.anchor && t.anchor.date === null) {
    return t.anchor.kind === "event"
      ? "nothing I hold names “" + t.anchor.phrase + "”, so time left nothing out"
      : "no earlier session found, so time left nothing out";
  }
  if (t.anchor) {
    return (t.anchor.kind === "event" ? t.anchor.phrase : t.cue) + " → " + dateOr(t.anchor.date) +
      (t.anchor.kind === "event" && t.window ? " (" + span(t.window) + ")" : "") + outside;
  }
  return t.cue + " → " + span(t.said) + (t.stretch > 0 ? ", give or take " + plural(t.stretch, "day") : "") + outside;
}

/** A facts answer's head: how many answer it, then the quieter notes. Markup. */
export function factsHead(r) {
  const lead = r.matched === 0
    ? "nothing answers it"
    : plural(r.matched, "memory answers it", "memories answer it") + (r.matched > 1 ? ", best first" : "");
  const notes = [];
  // Faded matches rank with the rest, each labelled (2026-10-10, `facts.ts`).
  if (r.faded > 0) notes.push(r.faded === r.matched ? (r.matched === 1 ? "it has faded" : "all faded") : r.faded + " of them faded");
  if (r.subjects.length > 0) notes.push("about " + r.subjects.map((s) => s.name).join(", "));
  const t = timeWords(r.time);
  if (t) notes.push(t);
  const ch = channelWords(r.semantic);
  if (ch) notes.push(ch);
  if (r.weak > 0) notes.push(plural(r.weak, "weak match", "weak matches") + " not shown");
  if (r.meaningCapped) notes.push("the search by meaning stopped at its cap, so this may not be everything");
  if (r.duplicates > 0) notes.push(plural(r.duplicates, "near-copy", "near-copies") + " of an answer left out");
  return esc(lead) + noteLine(notes);
}

/** A chapter's heading at the front of its words ("chapter 2 — Mon 1 Jun 2026 ·
 *  lived day 3"), stacked or not, taken off — the row's title says the day and
 *  its line says which chapter (`self/episodes.ts#readChapterLead`, flattened).
 *  Display only. */
export function withoutChapterHeading(text) {
  const lead = /^\s*chapter\s+\d+(?:\s*[—–-]\s*(?:[A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{4}\s*·\s*)?(?:[A-Za-z0-9][A-Za-z0-9._:[\]-]*\s*·\s*)?lived day\s+\d+)?\s*/i;
  let rest = String(text || "");
  for (let m = lead.exec(rest); m && m[0].length > 0; m = lead.exec(rest)) rest = rest.slice(m[0].length);
  return rest;
}

/** Under one fact's words: who said it, its status, when it was learned
 *  (when the right-hand date is when it happened), which chapter, and what it
 *  was before. Only what the answer carries; markup, or "". */
export function factLines(m) {
  const said = [];
  if (m.journal) {
    if (m.chapter) said.push("chapter " + m.chapter.n + " of " + m.chapter.of);
    if (m.lastWritten) said.push("written until " + dateOr(m.lastWritten));
  } else {
    if (m.saidBy) said.push(SAID[m.saidBy] || m.saidBy);
    if (m.status) said.push(m.status);
    if (m.occurredOn && m.learned && m.learned !== m.occurredOn) said.push("learned " + dateOr(m.learned));
  }
  const parts = said.map(esc);
  if (m.faded) parts.push(esc("faded: not used for a long while"));
  if (!m.current) {
    parts.push(/^(mem|epi|sch)_/.test(m.now || "") ? "an earlier version — now " + withIdMarks(m.now) : "an earlier version — a later one holds now");
  }
  for (const s of m.standing || []) parts.push(withIdMarks(s));
  // Corrected versions were wrong: each named and linked like an earlier one,
  // labelled so (`facts.ts#itemLines`); the rest counted.
  const wrong = m.correctedShown || [];
  const unnamed = (m.corrected || 0) - wrong.length;
  if (unnamed > 0 && wrong.length === 0) parts.push(esc(plural(unnamed, "corrected version") + " hidden"));
  const earlier = (m.earlier || []).map((e) =>
    '<div class="mearlier">earlier: “' + esc(e.text) + "”" +
      esc((e.learned ? " (learned " + dateOr(e.learned) + ")" : "") + (e.changed ? ", changed " + dateOr(e.changed) : "")) +
      (e.id ? " " + withIdMarks(e.id) : "") + "</div>").join("") +
    (m.earlierMore > 0 ? '<div class="mearlier">+' + m.earlierMore + " more earlier</div>" : "") +
    wrong.map((e) =>
      '<div class="mearlier">corrected (was wrong): “' + esc(e.text) + "”" +
        esc((e.learned ? " (learned " + dateOr(e.learned) + ")" : "") + (e.corrected ? ", corrected " + dateOr(e.corrected) : "")) +
        " " + withIdMarks(e.id) + "</div>").join("") +
    (unnamed > 0 && wrong.length > 0 ? '<div class="mearlier">+' + unnamed + " more corrected (was wrong)</div>" : "");
  if (parts.length === 0 && !earlier) return "";
  return '<div class="mfacts">' + (parts.length > 0 ? "<div>" + parts.join(" · ") + "</div>" : "") + earlier + "</div>";
}

/** One fact as a row: its date is when it happened, else when it was learned
 *  (a chapter: when it was written, in its title). */
export function factRow(m, words) {
  return memRow({
    id: m.id,
    title: m.title,
    text: m.journal ? withoutChapterHeading(m.body) : m.body,
    kind: m.kind,
    journal: m.journal,
    date: m.journal ? m.learned : m.occurredOn || m.learned,
    dateFrom: m.journal ? null : m.occurredOn ? "happened" : "learned",
    confidential: false, core: false, feelings: [], archived: null,
  }, { mark: words, under: factLines(m) });
}

/** A facts answer's rows: the page's results, faded ones among them, labelled. Markup. */
export function factsRows(r, q) {
  const words = questionWords(q);
  const rows = r.memories.map((m) => factRow(m, words)).join("");
  if (!rows) {
    return '<div class="empty">Nothing I hold answers that. Try the words the memory itself would use, a person or a project it names, or a wider time.</div>';
  }
  return rows;
}

/** A name asked about that has no card (`MeaningResult.noCard`), said first, on its own line. */
const leadLine = (r) => (r.noCard ? '<span class="find-lead">' + esc(r.noCard) + ".</span>" : "");

/** A meaning answer's head: a name with no card first, then what it is about, how much holds it, then the quieter notes. Markup. */
export function meaningHead(r) {
  return leadLine(r) + meaningHeadLine(r);
}

function meaningHeadLine(r) {
  if (r.lens === null) return esc("nothing came");
  const c = r.counts;
  const parts = [r.lens.name];
  if (c.chapters > 0) parts.push(plural(c.chapters, "chapter"));
  const chapterless = c.sessions - c.unplaced;
  if (chapterless > 0) parts.push(plural(chapterless, "session") + " with no chapter");
  if (c.unplaced > 0) parts.push(plural(c.unplaced, "session") + " with moments outside its chapters");
  parts.push(plural(c.moments, "moment") + (c.faded > 0 ? " (+" + c.faded + " faded)" : ""));
  const notes = [];
  if (r.feeling) notes.push("feeling asked: " + (r.feeling.words.length > 0 ? r.feeling.words.join(", ") : "any") + " · " + (r.feeling.whose || "both of us"));
  if (r.others.length > 0) {
    notes.push("also named: " + r.others.map((o) => o.name + " (" + plural(o.memories, "memory", "memories") + ")").join(", ") + " — ask about one by name");
  }
  // Its own notes say what makes it thin — words alone, when no card or
  // feeling found the moments, among them — so no channel line is added here.
  for (const n of r.notes) notes.push(n);
  return esc(parts.join(" · ")) + noteLine(notes);
}

/** What a mark on an arc entry says (`MeaningEntry.marks`). */
const MARK_WORDS = { start: "where it starts", end: "the latest", turn: "the feelings turn here" };

/** Whose feelings, side by side and never merged: "mine: proud · Mike's: worried". */
function feelingSides(f, whose) {
  const side = (list, who) => (list && list.length > 0 ? who + ": " + list.map((x) => x.word).join(", ") : null);
  return [side(f.self, whose.self), side(f.owner, whose.owner)].filter(Boolean).join(" · ");
}

/** One entry of the arc: a chapter (opens its journal), or a session's moments
 *  with no chapter (opens nothing). Its moments are links under it. */
export function arcRow(e, whose) {
  const chapter = e.kind === "chapter";
  const lines = [];
  if (chapter && e.of > 1) lines.push("chapter " + e.chapter + " of " + e.of);
  for (const mk of e.marks) lines.push(MARK_WORDS[mk] || mk);
  const felt = feelingSides(e.feelings, whose);
  if (felt) lines.push(felt);
  const more = e.momentCount - e.moments.length;
  const moments = e.moments.map((m) =>
    '<button type="button" class="mmoment" data-open="' + esc(m.id) + '">' + withIdMarks(m.title, true) + "</button>").join("") +
    (more > 0 ? '<span class="mmore">+' + more + " more of its moments</span>" : "");
  const under = (lines.length > 0 ? '<div class="mfacts"><div>' + esc(lines.join(" · ")) + "</div></div>" : "") +
    (moments ? '<div class="mmoments">' + moments + "</div>" : "");
  return memRow(chapter
    ? { id: e.episodeId, title: e.title, text: e.line, journal: true, date: e.date, feelings: [] }
    : { id: null, title: e.unplaced ? "Moments outside that session's chapters" : "A session with no chapter written", text: "",
        date: e.date, dateFrom: "recorded", feelings: [] },
  { under });
}

/** A stretch of the arc this page does not show, as one quiet line. */
function foldRow(l, page) {
  const what = page === 1 ? plural(l.count, "quieter entry", "quieter entries") : plural(l.count, "entry", "entries");
  const when = l.from === null ? "" : l.to === null || l.to === l.from ? ", " + dateOr(l.from) : ", " + dateOr(l.from) + " – " + dateOr(l.to);
  return '<div class="mfold">' + esc("· " + what + " not shown here" + when) + "</div>";
}

/** A titled part after the arc, or nothing when it is empty. */
function part(title, note, rows) {
  return rows ? '<div class="mclose-h">' + esc(title) + (note ? " <span>· " + esc(note) + "</span>" : "") + "</div>" + rows : "";
}

/** A meaning answer's rows: the arc in time order, then the faded moments,
 *  what I made of it before, what is still open, and what recurs. Markup. */
export function meaningRows(r) {
  if (r.lens === null) {
    return '<div class="empty">Nothing came: the question names no one and nothing I keep a card for, asks about no feeling, and none of its words reach a memory. Try a person’s or a project’s name — or ask for the facts.</div>';
  }
  if (r.reason === "nothing-came") return '<div class="empty">Nothing I hold is about that yet. Try a person’s or a project’s name — or ask for the facts.</div>';
  const plain = (x, under) => memRow({ id: x.id, title: x.title, text: x.excerpt || "", date: x.date, dateFrom: "recorded", feelings: [] },
    under ? { under: '<div class="mfacts"><div>' + esc(under) + "</div></div>" } : {});
  const p = r.patterns;
  const recurring = [
    p.subjects.length > 0 ? "with " + p.subjects.map((x) => x.label + " (" + x.entries + " of " + x.of + ")").join(", ") : "",
    p.feelings.length > 0 ? "feelings: " + p.feelings.map((x) => x.label + " (" + x.entries + " of " + x.of + ")").join(", ") : "",
  ].filter(Boolean);
  return r.arc.map((l) => (l.fold ? foldRow(l, r.page) : arcRow(l.entry, r.whose))).join("") +
    part("Faded", plural(r.counts.faded, "moment") + " not used for a long while", r.faded.map((m) => plain(m)).join("")) +
    part("What I made of it before", "dreams and reflections", r.readings.map((g) => plain(g, g.by === "dreamed" ? "from a dream" : "from a reflection")).join("")) +
    part("Still open", "", r.open.map((o) => plain(o, o.why === "dated" ? "a date still ahead" : "not settled yet")).join("")) +
    part("Recurring", "across the entries of the arc", recurring.map((x) => '<div class="mfold">' + esc(x) + "</div>").join(""));
}

/** An answer's pages, as the list's pager looks: back, where, more. "" for one page. */
export function askPager(r) {
  if (!(r.pages > 1)) return "";
  const first = (r.page - 1) * FACTS_PAGE;
  const range = r.mode === "facts" && r.memories.length > 0
    ? '<span class="mpage">' + (first + 1) + "–" + (first + r.memories.length) + " of " + r.matched + "</span>" : "";
  const button = (page, words, off) =>
    '<button type="button" class="mbtn" data-ask-page="' + page + '"' + (off ? " disabled" : "") + ">" + words + "</button>";
  return button(r.page - 1, "← back", r.page <= 1) + range +
    '<span class="mpage mpage-n">page ' + r.page + " of " + r.pages + "</span>" + button(r.page + 1, "more →", r.page >= r.pages);
}
