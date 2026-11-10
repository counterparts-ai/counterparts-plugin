/* The one overlay. `#overlay` / `#modal` live in the shell; the memory and
   event cards that open in it are `memory-modal.js` and `event-modal.js`. */
import { $, esc } from "./dom.js";
import { onDo, wireClicks } from "./dom.js";

export function closeModal() { $("overlay").classList.remove("show"); }
export function openModal(html) { $("modal").innerHTML = '<span class="x" role="button" tabindex="0" aria-label="close" data-do="close-modal">×</span>' + html; $("overlay").classList.add("show"); }

/** A titled block inside a card, or its absence sentence. */
export function section(title, body, emptyMsg) {
  if (!body && !emptyMsg) return "";
  return "<h4>" + esc(title) + "</h4>" +
    (body || "<div style='color:var(--dim);font-size:11px'>" + esc(emptyMsg) + "</div>");
}

/** Wire the overlay once: a click on the backdrop or Escape closes it, and so
 *  does anything marked `data-do="close-modal"` (shared/dom.js, wired here:
 *  the page's one delegated listener). `closeModal` stays a global for the harness. */
export function mountModal() {
  const overlay = $("overlay");
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  window.closeModal = closeModal;
  wireClicks();
}

onDo("close-modal", () => closeModal());
