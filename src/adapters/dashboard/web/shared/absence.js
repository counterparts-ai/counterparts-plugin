/* The "(none yet)" / "(never run)" block. Absence has two words, and every
   panel says which; none is blank. */
import { esc } from "./dom.js";

export function emptyBox(msg, extra) {
  return '<div class="empty"><b>' + esc(msg) + "</b>" + (extra ? " " + esc(extra) : "") + "</div>";
}
/** The two words, given their meaning back. */
export function absenceLine(marker, whatItWouldHold) {
  const why = marker === "(never run)" ? "It hasn't run yet." : "Nothing here yet.";
  return emptyBox(marker + " — " + whatItWouldHold + ".", why);
}
