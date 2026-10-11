/* A confirmation the owner has to MEAN: a dialog that shows what is about to
   happen and asks for a phrase to be typed back before the button works.

   It sits above everything, the memory card included, and it resolves to the
   typed phrase (or null when the owner backs out). The phrase is not checked
   here beyond enabling the button: what was typed goes to the console, and the
   console's own comparison is what refuses a mismatch. */
import { esc } from "../dom.js";

let open = null;

/** confirmTyped({ title, bodyHtml, phrase, action }) → Promise<string|null> */
export function confirmTyped(opts) {
  if (open) open.close(null);
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "confirm-back";
    back.innerHTML =
      '<div class="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-title">' +
        '<h3 id="confirm-title">' + esc(opts.title) + "</h3>" +
        '<div class="confirm-body">' + (opts.bodyHtml || "") + "</div>" +
        '<label class="confirm-label">Type <b>' + esc(opts.phrase) + "</b> to confirm" +
          '<input class="confirm-input" type="text" autocomplete="off" spellcheck="false"></label>' +
        '<div class="confirm-buttons">' +
          '<button class="confirm-cancel" type="button">cancel</button>' +
          '<button class="confirm-go" type="button" disabled>' + esc(opts.action || "confirm") + "</button>" +
        "</div>" +
      "</div>";
    const input = back.querySelector(".confirm-input");
    const go = back.querySelector(".confirm-go");
    const close = (value) => {
      if (open !== handle) return;
      open = null;
      removeEventListener("keydown", onKey, true);
      back.parentNode && back.parentNode.removeChild(back);
      resolve(value);
    };
    const handle = { close };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(null); }
      if (e.key === "Enter" && !go.disabled) { e.stopPropagation(); close(input.value); }
    };
    input.addEventListener("input", () => { go.disabled = input.value.trim() !== opts.phrase; });
    go.addEventListener("click", () => close(input.value));
    back.querySelector(".confirm-cancel").addEventListener("click", () => close(null));
    back.addEventListener("click", (e) => { if (e.target === back) close(null); });
    addEventListener("keydown", onKey, true);
    open = handle;
    document.body.appendChild(back);
    input.focus();
  });
}
