/* Small pieces every mechanism's picture is drawn from. Pure: each returns
   markup, touches no DOM and fetches nothing, so a picture is a function of the
   `/api/mechanism` payload alone. A memory is always clickable (the page's
   `openMemory`), and a withheld one reads as withheld. */
import { esc } from "../shared/dom.js";

/** A memory's words, clickable. `width` trims long ones for a tight row. */
export function memLink(m, width) {
  const text = width && m.text.length > width ? m.text.slice(0, width - 1).trimEnd() + "…" : m.text;
  const cls = "pic-mem" + (m.confidential ? " withheld" : "");
  return '<span class="' + cls + '" role="button" tabindex="0" title="' + esc(m.text) + '" onclick="openMemory(\'' +
    esc(m.id) + '\')" onkeydown="if(event.key===\'Enter\')openMemory(\'' + esc(m.id) + '\')">' + esc(text) + "</span>";
}

/** A thin horizontal bar, `frac` of the way, with a mark at `mark` if given. */
export function bar(frac, colour, mark) {
  const w = Math.max(0, Math.min(1, frac || 0)) * 100;
  return '<span class="pic-bar"><span class="pic-fill" style="width:' + w.toFixed(1) + "%;background:" + colour + '"></span>' +
    (mark === undefined ? "" : '<span class="pic-mark" style="left:' + (Math.max(0, Math.min(1, mark)) * 100).toFixed(1) + '%"></span>') +
    "</span>";
}

/** The line a picture shows when this store has nothing to draw yet. */
export function nothingYet(text) {
  return '<p class="pic-none">' + esc(text) + "</p>";
}

export const two = (x) => (typeof x === "number" && isFinite(x) ? x.toFixed(2) : "—");
