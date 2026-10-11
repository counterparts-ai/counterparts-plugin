/* "How well I remember" (2026-09-30, Mike's pick of three): one square per
   memory, firm first, then settling, then fading (amber), each state keyed
   underneath with its exact count and one sentence of what it means. The
   journal is not in the grid: its chapters are kept as written and not scored,
   so it has a line of its own. Beside the feelings chart the grid keeps to the
   height that chart already takes; when one square each no longer fits, a
   square stands for several memories (`waffleScale`) and the key says how many.
   Click a square or a key to filter the list to it; again for everything. */
import { $, esc } from "../../../shared/dom.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";
import { filters, onFilter, toggle } from "../state.js";

/**
 * [key, words, what it means]. True to the forgetting rules (`views/memories.ts#holdOf`,
 * `physics`): firm is still settled into what I know 30 lived days on if unused
 * (and a lived day is never shorter than a calendar day); fading is what prune
 * could let go within 14 lived days, unless a revision still leans on it. A
 * date that still repeats is kept by prune, so it is never fading (2026-10-09).
 */
export const PARTS = [
  ["firm", "firm", "I'll still know these a month from now, even if they're never used."],
  ["settling", "settling", "Held for now. Used, they grow firmer; left alone, they slowly fade."],
  ["fading", "fading", "Unless one is used, I may put it away within my next two weeks of use."],
];
/** What the fading key says when there are none. */
export const NONE_FADING = "None right now; nothing is about to be put away.";
export const JOURNAL_WORDS = "kept as written — they aren't scored and never fade.";

/** The `?`: two plain sentences (round 4). */
export const HOLD_TIP = "Firm: I'll still know it a month from now even if it's never used. " +
  "Fading: unless it's used, I may put it away within my next two weeks of use.";

/** How many memories a square may stand for, smallest first: 1, 2, 5, 10, 20, 50, 100, … */
export function scaleSteps(max) {
  const out = [1];
  for (let p = 1; out[out.length - 1] < max; p *= 10) out.push(2 * p, 5 * p, 10 * p);
  return out;
}

/**
 * The fewest memories per square that fit `capacity` squares: each state
 * rounds to the nearest square, and a state with any memory keeps at least
 * one. Pure. `{ per, squares: { firm, settling, fading } }`.
 */
export function waffleScale(counts, capacity) {
  const keys = ["firm", "settling", "fading"];
  const total = keys.reduce((s, k) => s + (counts[k] || 0), 0);
  const squaresAt = (per) => Object.fromEntries(keys.map((k) => {
    const n = counts[k] || 0;
    return [k, n === 0 ? 0 : Math.max(1, Math.round(n / per))];
  }));
  const room = Math.max(1, capacity);
  for (const per of scaleSteps(Math.max(1, total))) {
    const squares = squaresAt(per);
    if (keys.reduce((s, k) => s + squares[k], 0) <= room) return { per, squares };
  }
  const per = scaleSteps(Math.max(1, total)).pop();
  return { per, squares: squaresAt(per) };
}

/** The key's line when a square is more than one memory. */
export const scaleWords = (per) => (per > 1 ? "each square is " + per + " memories" : "");

const SQ = 9, GAP = 3;
/** Room kept for the "each square is N memories" line, which shows only once the grid is scaled. */
const HSCALE = 22;
/** Rows the grid may take when nothing beside it sets a height (a phone, one column). */
const ROWS_ALONE = 16;

export const markup = `
          <div class="glance-card">
            <h2 id="hold-h">How well I remember<span id="hold-q"></span></h2>
            <div class="card pad hold" id="hold"></div>
          </div>`;

let data = null;

export function mount() {
  $("hold").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hold]");
    if (!b || b.disabled) return;
    if (b.dataset.hold === "journal") toggle("journal");
    else toggle("hold", b.dataset.hold);
  });
  onFilter(paintParts);
}

export function paint(d) {
  data = d;
  $("hold-q").innerHTML = q("hold", HOLD_TIP);
  wireTips($("hold-q"));
  paintParts();
}

/** A new width (the window, or the tab first shown): the grid is laid out again. */
export const redraw = () => paintParts();

const isOn = (k) => (k === "journal" ? filters.journal : filters.hold === k);

const BOOK = '<svg class="hbook" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z"/>' +
  '<path d="M3 11.5a2 2 0 0 1 2-2h7.5"/></svg>';

function paintParts() {
  if (!data) return;
  const h = data.hold;
  const box = $("hold");
  if (h.firm + h.settling + h.fading + h.journal === 0) {
    box.innerHTML = '<p class="glance-empty">Nothing held yet. It fills in as we talk.</p>';
    return;
  }
  const any = PARTS.some(([k]) => isOn(k)) || isOn("journal");
  const keys = PARTS.map(([k, label, says]) => {
    const on = isOn(k);
    return '<button type="button" class="hkey ' + k + (on ? " on" : "") + (any && !on ? " off" : "") + '" data-hold="' + k + '" aria-pressed="' + on + '"' +
      (h[k] === 0 ? " disabled" : "") + '><i></i><span><b>' + esc(label) + '</b> <span class="fn">' + h[k] + "</span> — " +
      esc(h[k] === 0 && k === "fading" ? NONE_FADING : says) + "</span></button>";
  }).join("");
  const journal = h.journal > 0
    ? '<button type="button" class="hjournal' + (isOn("journal") ? " on" : "") + '" data-hold="journal" aria-pressed="' + isOn("journal") + '">' +
        BOOK + '<span><span class="fn">' + h.journal + "</span> journal chapter" + (h.journal === 1 ? "" : "s") + ", " + esc(JOURNAL_WORDS) + "</span></button>"
    : "";
  box.innerHTML = '<div class="hgrid" id="hgrid" role="group" aria-label="how well I remember, one square per memory — click to filter the list"></div>' +
    '<p class="hscale" id="hscale" hidden></p><div class="hkeys">' + keys + "</div>" + journal;
  const grid = $("hgrid");
  const cols = Math.max(1, Math.floor(((grid.clientWidth || 360) + GAP) / (SQ + GAP)));
  const { per, squares } = waffleScale(h, cols * rowsAllowed(box, grid));
  $("hscale").hidden = per === 1;
  $("hscale").textContent = scaleWords(per);
  grid.innerHTML = PARTS.map(([k, label]) => {
    const on = isOn(k);
    const cls = "hsq " + k + (on ? " on" : "") + (any && !on ? " off" : "");
    const title = esc(label + " " + h[k] + (per > 1 ? " — each square is " + per + " memories" : ""));
    return ('<i class="' + cls + '" data-hold="' + k + '" title="' + title + '"></i>').repeat(squares[k]);
  }).join("");
}

/**
 * How many rows of squares fit. Beside the feelings chart: the height that
 * chart takes on its own, less what the key under the grid needs, and never
 * under half the chart's height. Alone (a narrow window, one column): a fixed
 * few rows.
 */
function rowsAllowed(box, grid) {
  const feel = document.getElementById("feel");
  const cards = [box.closest(".glance-card"), feel && feel.closest(".glance-card")];
  const beside = cards[0] && cards[1] && Math.abs(cards[0].offsetTop - cards[1].offsetTop) < 4 && feel.offsetParent !== null;
  if (!beside) return ROWS_ALONE;
  // Each card's own contents, not the height the row may stretch it to.
  const inner = (el, skip) => [...el.children].reduce((sum, c) => {
    if (c === skip || c.hidden) return sum;
    const s = getComputedStyle(c);
    return sum + c.getBoundingClientRect().height + parseFloat(s.marginTop) + parseFloat(s.marginBottom);
  }, 0) + parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
  // What the key leaves of the chart's height, but never less than half of it:
  // the key's sentences are tall, and a grid squeezed to a strip says little.
  const chart = inner(feel);
  const room = Math.max(chart - inner(box, grid) - HSCALE, chart / 2);
  return Math.max(3, Math.floor((room + GAP) / (SQ + GAP)));
}
