/* The small `?` that holds the explaining words, out of the reading path:
   hover floats them on a pointer that can hover; a tap (or a click, or Enter)
   pins them open in the flow under their line, and a second one closes them.
   What is pinned is kept here, by name, so a live refresh draws it open again.
   One copy for every page (the self tab's, from #245); a tip's name is unique
   across the dashboard. */
import { esc } from "../dom.js";

/** Pinned tips, by name. */
export const openTips = new Set();

/** The markup for one tip: a `?` button and its words beside it. */
export function q(key, text) {
  const open = openTips.has(key);
  return '<span class="q-wrap' + (open ? " open" : "") + '" data-tip="' + esc(key) + '">' +
    '<button type="button" class="q" aria-expanded="' + open + '" aria-label="What this means">?</button>' +
    '<span class="q-pop" role="note">' + esc(text) + "</span></span>";
}

/** Keep an open tip inside the window: shift it left when it would run past
 *  the right edge (a phone is where that happens). */
function clamp(wrap) {
  const pop = wrap.querySelector(".q-pop");
  if (!pop) return;
  pop.style.left = "";
  // A pinned tip sits in the flow and needs no help; only the floating one can
  // run past the edge.
  if (getComputedStyle(pop).position !== "absolute") return;
  const r = pop.getBoundingClientRect();
  if (r.width === 0) return;
  const room = document.documentElement.clientWidth - 12;
  if (r.right > room) pop.style.left = Math.round(-(r.right - room)) + "px";
  const r2 = pop.getBoundingClientRect();
  if (r2.left < 12) pop.style.left = Math.round(parseFloat(pop.style.left || "0") + (12 - r2.left)) + "px";
}

/** Wire every tip under `root` that is not wired yet. Safe to call after each
 *  repaint, and on a root whose tips were not all redrawn. */
export function wireTips(root) {
  root.querySelectorAll(".q-wrap:not([data-wired])").forEach((wrap) => {
    wrap.dataset.wired = "1";
    const key = wrap.dataset.tip;
    const btn = wrap.querySelector(".q");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const open = !openTips.has(key);
      if (open) openTips.add(key); else openTips.delete(key);
      wrap.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
      if (open) clamp(wrap);
    });
    wrap.addEventListener("mouseenter", () => clamp(wrap));
    if (openTips.has(key)) clamp(wrap);
  });
}
