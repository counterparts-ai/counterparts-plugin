/* Interference, pictured (2026-09-29): the newest pairs of memories that
   disagree — flagged and waiting, or settled, and how. */
import { memLink, nothingYet } from "../picture.js";

const HOW = { changed: "changed — the older fades", corrected: "corrected — the older left recall", open: "open — both kept" };

export function picture(p) {
  if (!p || !Array.isArray(p.pairs) || p.pairs.length === 0) return nothingYet("No two memories have been found to disagree yet.");
  return '<ul class="pic-climb">' + p.pairs.map((r) =>
    '<li><div class="pic-head">day ' + r.day + " · " + (r.state === "unsettled" ? "unsettled" : (HOW[r.how] || "settled")) + "</div>" +
      '<div class="pic-rev">' + memLink(r.older, 70) + ' <span class="pic-meta">and</span> ' + memLink(r.newer, 70) + "</div></li>"
  ).join("") + "</ul>";
}
