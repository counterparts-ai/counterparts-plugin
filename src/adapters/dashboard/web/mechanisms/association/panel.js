/* Association, pictured: the graph hubs — the memories the most is wired to,
   by summed link weight. (Moved here from the memories page.) */
import { bar, memLink, nothingYet, two } from "../picture.js";

export function picture(p) {
  if (!p || p.hubs.length === 0) {
    return nothingYet("Nothing has been wired together yet. Links form when memories are used in the same turn.");
  }
  const top = Math.max(...p.hubs.map((h) => h.weight), 0.0001);
  return '<div class="pic-hubs">' + p.hubs.map((h) =>
    '<div class="r">' + memLink(h, 90) +
      '<div class="pic-two">' + bar(h.weight / top, "#ffc94d") +
      '<span class="pic-meta">wired to ' + h.degree + " · weight " + two(h.weight) + "</span></div></div>"
  ).join("") + "</div>";
}
