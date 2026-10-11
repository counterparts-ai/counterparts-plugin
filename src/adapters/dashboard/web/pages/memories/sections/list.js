/* Every memory, with its words — newest first (or oldest), twenty at a time.
   The server filters, sorts and pages (`/api/memories/list`), so a store of
   twenty thousand rows sends twenty. Two rows of chips (round 4, 2026-09-28):
   the kinds (with the journal and ★ core), then the seven feelings, each with its
   count and a few words on hover; "showing: kept · put away · both" sits on
   the right. Click a row to open the memory. While the find box holds words,
   its answers stand here instead (`search.js`). */
import { absenceLine } from "../../../shared/absence.js";
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";
import { FEELING_COLOURS, feelingName, kindMark, kindOf } from "../../../shared/memory-marks.js";
import { memRow, wireRows } from "../row.js";
import { filters, find, onFilter, setFilter, toggle } from "../state.js";
import * as search from "./search.js";

export const PAGE = 20;

/** Each chip's few words, on hover (the kinds `?` went, round 4). */
export const KIND_HINT = {
  self: "who I am, in my words",
  person: "someone I know or met",
  entity: "a project, tool or thing",
  skill: "how to do something well",
  place: "somewhere that matters to us",
  fact: "a plain fact I learned",
};
export const JOURNAL_HINT = "my journal, kept as written";
export const CORE_HINT = "★ core — part of who I am";
/** The kept / put-away toggle. The values stay the server's (`live`, `archived`, `all`). */
export const SHOWING = [
  ["live", "kept", "what I hold now"],
  ["archived", "put away", "let go or replaced, kept aside"],
  ["all", "both", "everything, kept and put away"],
];
const HOLD_WORDS = { firm: "firm", settling: "settling", fading: "fading" };

export const markup = `
        <div class="mlist-head">
          <h2 id="mlist-h">Every memory</h2>
          <div class="msort seggroup" id="msort" role="group" aria-label="order"></div>
        </div>${search.markup}
        <div class="mfilters" id="mfilters"></div>
        <div class="card mlist" id="mlist"></div>
        <div class="mpager" id="mpager"></div>`;

let seq = 0;

export function mount() {
  wireRows($("mlist"));
  search.mount();
  $("mfilters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    const f = b.dataset.f, v = b.dataset.v || null;
    if (f === "state") setFilter({ state: v });
    else if (f === "clear") setFilter({ kind: null, core: false, journal: false, hold: null, feeling: null, feelingCore: null });
    else if (f === "feelingCore") setFilter({ feeling: null, feelingCore: filters.feelingCore === v ? null : v });
    else toggle(f, v);
  });
  $("msort").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sort]");
    if (b && b.dataset.sort !== filters.sort) setFilter({ sort: b.dataset.sort });
  });
  $("mpager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-off]");
    if (!b || b.disabled) return;
    setFilter({ offset: Number(b.dataset.off) });
    $("mlist-h").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  onFilter(() => { render(); });
}

export async function render() {
  const mine = ++seq;
  const qs = new URLSearchParams({ state: filters.state, sort: filters.sort, offset: String(filters.offset), limit: String(PAGE) });
  if (filters.kind) qs.set("kind", filters.kind);
  if (filters.core) qs.set("core", "1");
  if (filters.journal) qs.set("journal", "1");
  if (filters.hold) qs.set("hold", filters.hold);
  if (filters.feeling) { qs.set("feeling", filters.feeling.word); qs.set("whose", filters.feeling.whose); }
  else if (filters.feelingCore) qs.set("feelingCore", filters.feelingCore);
  let d;
  try { d = await api("/api/memories/list?" + qs.toString()); }
  catch (e) { return fail("The memory list", e); }
  if (mine !== seq) return; // a newer filter already asked
  paintSort(d);
  paintFilters(d);
  // The find box's answers hold the list's place until it is cleared.
  if (find.on) return;
  showList(true);
  paintRows(d);
  paintPager(d);
}

/** The list's own parts shown (or hidden while the find box answers). */
export function showList(on) {
  $("mfilters").hidden = !on;
  $("msort").hidden = !on;
  if (!on) $("mpager").innerHTML = "";
}

function paintSort(d) {
  $("msort").innerHTML = [["newest", "newest first"], ["oldest", "oldest first"]].map(([v, l]) =>
    '<button type="button" class="fchip' + (d.sort === v ? " on" : "") + '" data-sort="' + v + '" aria-pressed="' +
      (d.sort === v) + '">' + l + "</button>").join("");
}

function chip(f, v, inner, on, extraClass, title) {
  return '<button type="button" class="fchip' + (on ? " on" : "") + (extraClass ? " " + extraClass : "") +
    '" data-f="' + f + '"' + (v ? ' data-v="' + esc(v) + '"' : "") + ' aria-pressed="' + on + '"' +
    (title ? ' title="' + esc(title) + '"' : "") + ">" + inner + "</button>";
}
const count = (n) => ' <span class="fn">' + n + "</span>";

function paintFilters(d) {
  const c = d.counts;
  const showing = '<span class="fshow-lab">showing:</span>' + SHOWING.map(([v, words, hint]) =>
    chip("state", v, esc(words) + count(v === "live" ? c.live : v === "archived" ? c.archived : c.live + c.archived), d.state === v, "seg", hint)).join("");
  const kinds = Object.keys(c.kinds).map((k) => chip("kind", k, kindMark(k, false) + esc(kindOf(k).label) + count(c.kinds[k]),
    d.kind === k, "kchip" + (c.kinds[k] === 0 ? " zero" : ""), KIND_HINT[k])).join("");
  const special =
    chip("journal", null, "journal" + count(c.journal), d.journal, c.journal === 0 ? "zero" : "", JOURNAL_HINT) +
    chip("core", null, '<span class="star">★</span>core' + count(c.core), d.core, c.core === 0 ? "zero" : "", CORE_HINT);
  const feelings = Object.keys(c.feelings || {}).map((core) => chip("feelingCore", core,
    '<i class="fcdot" style="background:' + (FEELING_COLOURS[core] || "#8a95a3") + '"></i>' + esc(feelingName(core)) + count(c.feelings[core]),
    d.feelingCore === core, c.feelings[core] === 0 ? "zero" : "", "memories that felt " + feelingName(core))).join("");
  const any = d.kind || d.core || d.journal || d.hold || d.feeling || d.feelingCore;
  const holdChip = d.hold ? chip("hold", d.hold, '<span class="hdot ' + esc(d.hold) + '"></span>' + esc(HOLD_WORDS[d.hold] || d.hold) +
    count(c.hold[d.hold]) + ' <span class="fx" aria-hidden="true">✕</span>', true, "", "from the bar above — click to clear") : "";
  $("mfilters").innerHTML =
    '<div class="frow">' +
      '<div class="fgroup" role="group" aria-label="kind">' + kinds + special + "</div>" +
      '<div class="fgroup seggroup fshow" role="group" aria-label="showing kept or put away">' + showing + "</div>" +
    "</div>" +
    '<div class="frow">' +
      '<div class="fgroup" role="group" aria-label="feeling">' + feelings + holdChip +
        (any ? chip("clear", null, "show all", false, "clear") : "") + "</div>" +
    "</div>";
}

function paintRows(d) {
  if (d.rows.length === 0) {
    const narrowed = d.kind || d.core || d.journal || d.hold || d.feeling || d.feelingCore;
    $("mlist").innerHTML = absenceLine(d.absent || "(none yet)",
      d.state === "archived" ? "nothing has been put away" + (narrowed ? " that matches these filters" : "")
        : "no memory matches these filters");
    return;
  }
  $("mlist").innerHTML = d.rows.map((r) => memRow(r)).join("");
}

/** "1–20 of 320", by the pager — the only place the list says its range. */
export function rangeWords(offset, shown, total) {
  if (total === 0) return "";
  return (offset + 1) + "–" + (offset + shown) + " of " + total;
}

function paintPager(d) {
  const range = '<span class="mpage">' + rangeWords(d.offset, d.rows.length, d.total) + "</span>";
  if (d.total <= d.limit) { $("mpager").innerHTML = d.total > 0 ? range : ""; return; }
  const prev = Math.max(0, d.offset - d.limit);
  const next = d.offset + d.limit;
  const page = Math.floor(d.offset / d.limit) + 1;
  const pages = Math.ceil(d.total / d.limit);
  const [back, fwd] = d.sort === "oldest" ? ["← older", "newer →"] : ["← newer", "older →"];
  $("mpager").innerHTML =
    '<button type="button" class="mbtn" data-off="' + prev + '"' + (d.offset === 0 ? " disabled" : "") + ">" + back + "</button>" +
    range + '<span class="mpage mpage-n">page ' + page + " of " + pages + "</span>" +
    '<button type="button" class="mbtn" data-off="' + next + '"' + (next >= d.total ? " disabled" : "") + ">" + fwd + "</button>";
}
