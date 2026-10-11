/* Consolidation, pictured (home round 3b, 2026-09-27 — a try): what it did to
   our memories this week. Which came back in conversation (bright: the only
   returns the core counts), which merged, and which a dream replayed (dim).
   Who is close to the core is the Self tab's; this picture does not repeat it. */
import { esc } from "../../shared/dom.js";
import { q } from "../../shared/widgets/tips.js";
import { memLink, nothingYet } from "../picture.js";

const RETURNS_TIP =
  "A memory \"comes back\" when it is used again after a gap; each return makes it fade more slowly. " +
  "Only coming back in conversation counts toward the core. A dream replay counts a little toward fading more slowly, and nothing else. " +
  "History carried over at the upgrade is not counted here.";

const HOW = {
  awake: (m) => "came back in conversation" + (m.times > 1 ? " ×" + m.times : ""),
  merged: (m) => "merged" + (m.times > 1 ? " ×" + m.times : ""),
  dream: (m) => "replayed in a dream" + (m.times > 1 ? " ×" + m.times : ""),
};

function tally(p) {
  const r = p.returns;
  const parts = [r.awake + " came back in conversation"];
  if (p.merges > 0) parts.push(p.merges + " merged");
  if (r.dream > 0) parts.push('<span class="pic-dim">' + r.dream + " replayed in a dream</span>");
  return '<p class="pic-cap">Last ' + r.days + " lived days: " + parts.join(" · ") + " " + q("pic-returns", RETURNS_TIP) + "</p>";
}

export function picture(p) {
  if (!p) return "";
  const rows = p.memories.length === 0
    ? nothingYet("Nothing came back, merged or was replayed this week.")
    : '<ul class="pic-list pic-rows">' + p.memories.map((m) =>
        '<li class="pic-' + esc(m.how) + '">' + memLink(m, 90) +
        '<span class="pic-meta">' + esc(HOW[m.how] ? HOW[m.how](m) : m.how) + " · day " + m.day + "</span></li>"
      ).join("") + "</ul>";
  return rows + tally(p);
}
