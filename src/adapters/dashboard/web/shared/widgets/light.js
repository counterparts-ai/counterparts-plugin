/* The status light: one small dot that says whether a mechanism is working.
     green   — built, and it fired in the window
     waiting — built, and simply not due: its scheduled run is ahead, or it
               holds nothing to act on yet (a ring, not a dot)
     amber   — built, and quiet when it should not be
     grey    — not built yet; it never claims activity
   The word travels with the dot (as its accessible name), so the colour is
   never the only carrier of the meaning. */
import { esc } from "../dom.js";

export const LIGHT_WORD = { green: "firing", waiting: "waiting", amber: "quiet", grey: "not built yet" };

/** A light's markup. Unknown statuses draw grey rather than guess. */
export function light(status) {
  const s = status === "green" || status === "amber" || status === "waiting" ? status : "grey";
  return '<span class="light light-' + s + '" role="img" aria-label="' + esc(LIGHT_WORD[s]) + '"></span>';
}
