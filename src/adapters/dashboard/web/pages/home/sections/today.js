/* "Today" (home round 4, 2026-09-28 — it replaced the live activity feed): a
   few plain lines about memory, newest first, each a link — a memory written
   today opens its card; one that became core, and the day's dream, go to the
   Self tab; memories let go go to the memories list. No event names, bytes or
   paths, and nothing here opens a raw record: the plumbing is on the flow tab.
   When today is empty the heading says which day is shown instead.

   Data: `/api/overview`'s `today` (`views/today.ts`). */
import { $, esc } from "../../../shared/dom.js";
import { headline } from "../../../shared/format.js";
import "../../../shared/memory-modal.js"; // window.openMemory

export const markup = `
      <section class="home-today" aria-labelledby="home-today-h">
        <h2 id="home-today-h">Today</h2>
        <ul class="td-list" id="home-today"></ul>
      </section>`;

export function mount() {
  $("home-today").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (b && typeof window.openMemory === "function") window.openMemory(b.dataset.id);
  });
}

function line(l) {
  const cls = "td-line td-" + l.kind;
  if (l.to.memory !== undefined) {
    const words = l.confidential ? '<span class="withheld">a private memory</span>' : esc(headline(l.text));
    return '<li class="' + cls + '"><button type="button" class="td-link" data-id="' + esc(l.to.memory) + '">' + words + "</button></li>";
  }
  return '<li class="' + cls + '"><a class="td-link" href="#' + esc(l.to.hash) + '">' + esc(l.text) + (l.kind === "more" ? " →" : "") + "</a></li>";
}

export function paint(d) {
  const t = d.today;
  $("home-today-h").textContent = t.label;
  $("home-today").innerHTML = t.lines.length === 0
    ? '<li class="td-none">Nothing yet. What I remember from our conversations shows up here.</li>'
    : t.lines.map(line).join("");
}
