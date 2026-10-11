/* Dreaming, pictured (home round 3b, 2026-09-27): the memories the last dream
   changed, and a link to the dream journal on the Self tab, where each dream is
   told in full. The journal is not repeated here. */
import { dateOr } from "../../shared/dates.js";
import { esc } from "../../shared/dom.js";
import { memLink, nothingYet } from "../picture.js";

const JOURNAL = '<p class="pic-cap"><a class="pic-more" href="#self/dreams">the dream journal →</a></p>';

export function picture(p) {
  if (!p || !p.dream) return nothingYet("No dream yet. A session asks once a day, when there is something new.") + JOURNAL;
  const d = p.dream;
  const head = '<div class="pic-head">The last dream' + (d.title ? ", “" + esc(d.title) + "”" : "") +
    " · " + esc(dateOr(d.date) || "day " + d.day) + "</div>";
  const rows = p.memories.length === 0
    ? nothingYet("It changed no memory.")
    : '<ul class="pic-list pic-rows">' + p.memories.map((m) =>
        "<li>" + memLink(m, 90) + '<span class="pic-meta">' + esc(m.did) + "</span></li>"
      ).join("") + "</ul>";
  return head + rows + JOURNAL;
}
