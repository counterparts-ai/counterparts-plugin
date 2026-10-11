/* HOW I ACT (2026-09-27, a try): the seven trait axes as spectrum bars, one
   thin row each — the left pole's word, a track, a marker, the right pole's
   word, and how many memories stand behind it. The left pole is roughly where
   training puts me, so a pull to the right is the one that says something.

   The balance is computed server side (`views/traits.ts`: a firmness-weighted
   mean of the nudges); this only draws it. A faint marker is where the axis
   stood a week ago. An axis with nothing behind it draws an empty track and no
   marker, never a centred one (the faint one still shows when the memories
   behind it a week ago have all left since). Tap a row for the memories behind it; each opens
   its card. What is open is kept in `state.js`, so a live refresh keeps it. */
import { $, esc } from "../../../shared/dom.js";
import { headline, said } from "../../../shared/format.js";
import { ui } from "../state.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";

export const markup = `
        <h2 id="self-traits-h">How I act <span id="self-traits-q"></span></h2>
        <div class="card pad" id="self-traits"></div>`;

export const EMPTY = "No memory carries a trait yet. They're recorded as memories are written.";

export const ABOUT = "Each line runs between two good ways to act, and the mark is where my memories put me. " +
  "The faint mark is where I stood a week ago.";

/** Where a balance (−1..+1) sits on the track, in percent; null draws no marker. */
export function markerAt(balance) {
  if (balance === null || balance === undefined || !Number.isFinite(balance)) return null;
  const b = Math.max(-1, Math.min(1, balance));
  return Math.round((b + 1) * 50 * 10) / 10;
}

/** "1 memory", "4 memories", "none yet". */
export function countWords(n) {
  return n === 0 ? "none yet" : n === 1 ? "1 memory" : n + " memories";
}

/** The row in words, for a screen reader and the hover title. */
export function leanWords(axis) {
  // A week ago can stand alone: the memories behind it may all have left since.
  const ago = axis.weekAgo === null || axis.weekAgo === undefined ? "" : "; a week ago " + (Math.abs(axis.weekAgo) < 0.1 ? "about even"
    : axis.weekAgo < 0 ? "toward " + axis.poles[0] : "toward " + axis.poles[1]);
  if (axis.balance === null) return axis.poles[0] + " to " + axis.poles[1] + ": no memory carries it yet" + ago;
  const b = axis.balance;
  const lean = Math.abs(b) < 0.1 ? "about even"
    : (Math.abs(b) >= 0.6 ? "strongly " : Math.abs(b) < 0.3 ? "a little " : "") + (b < 0 ? axis.poles[0] : axis.poles[1]);
  return axis.poles[0] + " to " + axis.poles[1] + ": " + lean + " (" + countWords(axis.memories) + ")" + ago;
}

let last = null;

export function paint(d) {
  if (d) last = d;
  d = last;
  const t = d.traits;
  $("self-traits-q").innerHTML = q("traits", ABOUT);
  wireTips($("self-traits-q"));
  const box = $("self-traits");
  if (!t || (t.nudges === 0 && t.axes.every((a) => a.weekAgo === null))) {
    ui.trait = null;
    box.innerHTML = '<p class="tr-empty">' + esc(EMPTY) + "</p>";
    return;
  }
  // A list that emptied closes.
  if (ui.trait && !t.axes.some((a) => a.id === ui.trait && a.nudges > 0)) ui.trait = null;
  box.innerHTML = '<div class="tr-axes">' + t.axes.map(row).join("") + "</div>";
  box.querySelectorAll(".tr-row").forEach((b) => b.addEventListener("click", () => {
    ui.trait = ui.trait === b.dataset.axis ? null : b.dataset.axis;
    paint();
  }));
  wireTips(box);
}

function row(a) {
  const open = ui.trait === a.id;
  const now = markerAt(a.balance);
  const ago = markerAt(a.weekAgo);
  const track = '<span class="tr-track' + (now === null ? " bare" : "") + '" aria-hidden="true">' +
    '<span class="tr-mid"></span>' +
    (ago === null ? "" : '<span class="tr-mark ago" style="left:' + ago + '%"></span>') +
    (now === null ? "" : '<span class="tr-mark" style="left:' + now + '%"></span>') +
    "</span>";
  const words = leanWords(a);
  const btn = '<button type="button" class="tr-row' + (open ? " on" : "") + '" data-axis="' + esc(a.id) + '"' +
    (a.nudges === 0 ? " disabled" : "") + ' aria-expanded="' + open + '" aria-label="' + esc(words) + '" title="' + esc(words) + '">' +
    '<span class="tr-pole l">' + esc(a.poles[0]) + "</span>" + track +
    '<span class="tr-pole r">' + esc(a.poles[1]) + "</span>" +
    '<span class="tr-n' + (a.memories === 0 ? " none" : "") + '">' + esc(countWords(a.memories)) + "</span></button>";
  const gloss = a.gloss ? q("trait-" + a.id, a.poles[0] + " to " + a.poles[1] + ": " + a.gloss + ".") : '<span class="tr-q-gap"></span>';
  return '<div class="tr-axis">' + btn + gloss + "</div>" + (open ? list(a) : "");
}

/** The memories behind one axis, the weightiest first; each opens its card. */
function list(a) {
  const rows = a.rows.map((r) =>
    '<button type="button" class="st-row click tr-item" onclick="openMemory(\'' + esc(r.id) + '\')">' +
      '<span class="st-text">' + said(headline(r.text), r.confidential) +
        '<span class="tr-why">' + (r.withheld ? '<span class="withheld">withheld</span>' : esc(r.carriedBy)) + "</span></span>" +
      '<span class="tr-toward k-' + (r.toward === a.poles[1] ? "r" : "l") + '">' + esc(r.toward) + "</span></button>").join("");
  const more = a.more > 0 ? '<p class="foot tr-more">and ' + a.more + " more</p>" : "";
  return '<div class="st-list tr-list">' + rows + more + "</div>";
}
