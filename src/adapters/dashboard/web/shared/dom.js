/* The DOM helpers every panel uses: `$`, `esc`, and the page's delegated clicks. */

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

/* THE PAGE'S MARKUP-BORN CLICKS, DELEGATED (HD2, 2026-11-10).

   A row drawn as a string says what a click on it does in data attributes —
   `data-do="open-memory" data-id="mem_…"` — never in an inline `onclick=`, so
   the same page runs under the hosted server's CSP, which allows no inline
   script. One listener on the document reads `data-do` and calls the handler
   its module registered here (`onDo`). An element with `role="button"` that is
   not a <button> answers Enter too, as its inline `onkeydown` used to.

   Registering touches nothing but this table, so a module can be imported
   where there is no document (bun tests); `wireClicks()` is called once, by
   the modal's mount (shared/modal.js). Here rather than a file of its own: the
   plugin directory's bundle is held to a file count. */

const HANDLERS = new Map();

/** Say what `data-do="<name>"` does: `fn(element, event)`. */
export function onDo(name, fn) {
  HANDLERS.set(name, fn);
}

/** The attributes for a click that opens a memory's card. The id comes already escaped (`esc`). */
export function openMemoryAttrs(escapedId) {
  return 'data-do="open-memory" data-id="' + escapedId + '"';
}

function run(el, e) {
  const fn = HANDLERS.get(el.getAttribute("data-do"));
  if (fn) fn(el, e);
}

let wired = false;

/** The one delegated listener (click, and Enter on a role=button). Idempotent. */
export function wireClicks(root = document) {
  if (wired) return;
  wired = true;
  root.addEventListener("click", (e) => {
    const el = e.target && e.target.closest ? e.target.closest("[data-do]") : null;
    if (el) run(el, e);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const el = e.target && e.target.closest ? e.target.closest('[data-do][role="button"]') : null;
    // A real <button> already turns Enter into a click.
    if (el && el.tagName !== "BUTTON") run(el, e);
  });
}
