/* Prospective memory, pictured (home round 3b, 2026-09-27): the reminders that
   came back this week, then the dated memories still waiting for their day —
   with how many of each, so a short list never reads as all there is. */
import { dateOr } from "../../shared/dates.js";
import { esc } from "../../shared/dom.js";
import { memLink, nothingYet } from "../picture.js";

/** The line under the rows: how many came back, how many wait, and how many of them are listed. */
export function caption(p) {
  const c = p.counts || { came: p.came.length, waiting: p.waiting.length };
  const listed = p.came.length + p.waiting.length;
  const line = c.came + " came back this week · " + c.waiting + " waiting for their day";
  return listed < c.came + c.waiting ? line + " (" + listed + " listed)" : line;
}

export function picture(p) {
  if (!p || (p.came.length === 0 && p.waiting.length === 0)) {
    return nothingYet("Nothing dated yet: a note or a memory given a date comes back around that day.");
  }
  return '<ul class="pic-list pic-rows">' +
    p.came.map((m) =>
      "<li>" + memLink(m, 90) + '<span class="pic-meta">' + (m.plain ? "said plainly" : "came back as a quiet footnote") + " · day " + m.day + "</span></li>"
    ).join("") +
    p.waiting.map((m) =>
      "<li>" + memLink(m, 90) + '<span class="pic-meta pic-dim">waiting for ' + esc(dateOr(m.date)) + "</span></li>"
    ).join("") +
    '</ul><p class="pic-cap">' + esc(caption(p)) + "</p>";
}
