/* Episodic → semantic, pictured (home round 3b, 2026-09-27): the patterns
   dreams wrote as memories of their own, newest first. */
import { dateOr } from "../../shared/dates.js";
import { esc } from "../../shared/dom.js";
import { memLink, nothingYet } from "../picture.js";

export function picture(p) {
  if (!p || p.gists.length === 0) return nothingYet("No pattern has been written down yet. A dream writes one when it sees it.");
  return '<ul class="pic-list pic-rows">' + p.gists.map((m) =>
    "<li>" + memLink(m, 90) + '<span class="pic-meta">dreamed ' + esc(dateOr(m.date) || "on day " + m.day) + "</span></li>"
  ).join("") + "</ul>";
}
