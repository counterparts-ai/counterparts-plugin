/* Salience, pictured: the memories written this week, most salient first, each
   dot sized by the importance score it was written with — and how many were
   written, so five rows never read as all there is. */
import { esc } from "../../shared/dom.js";
import { memLink, nothingYet, two } from "../picture.js";

/** The line under the rows: which these are, of how many. */
export function caption(p) {
  const days = "the last " + p.days + " lived days";
  if (p.written > p.memories.length) {
    return "The " + p.memories.length + " most salient of the " + p.written + " memories written in " + days + ".";
  }
  return (p.written === 1 ? "The one memory" : "All " + p.written + " memories") + " written in " + days + ", most salient first.";
}

export function picture(p) {
  if (!p || p.memories.length === 0) {
    return nothingYet("Nothing was written in the last " + ((p && p.days) || 7) + " lived days, so nothing new has been scored.");
  }
  return '<ul class="pic-sal">' + p.memories.map((m) => {
    const size = 6 + Math.round(Math.sqrt(Math.max(0, Math.min(1, m.salience))) * 22);
    return '<li><span class="pic-dotwrap"><span class="pic-dot" style="width:' + size + "px;height:" + size + 'px"></span></span>' +
      "<span>" + memLink(m, 90) + '<span class="pic-meta">score ' + two(m.salience) + " · " + esc(m.memKind) + " · born day " + m.bornDay + "</span></span></li>";
  }).join("") + '</ul><p class="pic-cap">' + esc(caption(p)) + "</p>";
}
