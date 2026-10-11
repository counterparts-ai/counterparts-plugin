/* Emotional modulation, pictured (home round 3b, 2026-09-27): the newest
   memories a feeling holds higher, each with its feeling. Which memories a
   matching mood brought closer is counted per turn but not recorded per memory,
   so they are not guessed at here. */
import { esc } from "../../shared/dom.js";
import { FEELING_COLOURS, feelingWord } from "../../shared/memory-marks.js";
import { memLink, nothingYet, two } from "../picture.js";

const WHOSE = { owner: "you", self: "me" };

function chip(f) {
  return '<span class="pic-feel"><i style="background:' + (FEELING_COLOURS[f.core] || "#8a95a3") + '"></i>' +
    esc(feelingWord(f)) + (WHOSE[f.whose] ? " · " + WHOSE[f.whose] : "") + "</span>";
}

export function picture(p) {
  if (!p || p.memories.length === 0) return nothingYet("No memory carries a feeling that weighs on it yet.");
  return '<div class="pic-head">Held higher for the feeling they carry, newest first</div>' +
    '<ul class="pic-list pic-rows">' + p.memories.map((m) =>
    "<li>" + memLink(m, 90) + '<span class="pic-meta">' +
      (m.feelings.length > 0 ? m.feelings.map(chip).join(" ") : "feeling score " + two(m.emotional)) +
      " · day " + m.bornDay + "</span></li>"
  ).join("") + "</ul>";
}
