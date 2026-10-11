/* The one overlay. `#overlay` / `#modal` live in the shell; the memory and
   event cards that open in it are `memory-modal.js` and `event-modal.js`. */
import { $, esc } from "./dom.js";

export function closeModal() { $("overlay").classList.remove("show"); }
export function openModal(html) { $("modal").innerHTML = '<span class="x" onclick="closeModal()">×</span>' + html; $("overlay").classList.add("show"); }

/** A titled block inside a card, or its absence sentence. */
export function section(title, body, emptyMsg) {
  if (!body && !emptyMsg) return "";
  return "<h4>" + esc(title) + "</h4>" +
    (body || "<div style='color:var(--dim);font-size:11px'>" + esc(emptyMsg) + "</div>");
}

/** Wire the overlay once: a click on the backdrop or Escape closes it. The
 *  inline `onclick="closeModal()"` in every card needs the global. */
export function mountModal() {
  const overlay = $("overlay");
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  window.closeModal = closeModal;
}
