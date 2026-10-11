/* Reconsolidation, pictured: recent corrections weighed against an old memory,
   and how far each pushed toward the bar it would take to change it. */
import { bar, memLink, nothingYet, two } from "../picture.js";

export function picture(p) {
  if (!p || p.revisions.length === 0) return nothingYet("Nothing new has argued with an old memory yet.");
  return '<ul class="pic-climb">' + p.revisions.map((r) =>
    '<li><div class="pic-head">day ' + r.day + (r.crossed ? ' · <span class="pic-crossed">changed my mind</span>' : " · holding for now") + "</div>" +
      '<div class="pic-rev">' + memLink(r.challenger, 70) + ' <span class="pic-meta">argued with</span> ' + memLink(r.target, 70) + "</div>" +
      '<div class="pic-two"><span class="pic-lab">pressure ' + two(r.pressure) + " of " + two(r.bar) + "</span>" +
      bar(r.bar > 0 ? r.pressure / r.bar : 0, r.crossed ? "#ffd740" : "#00bfa5") + "</div></li>"
  ).join("") + "</ul>";
}
