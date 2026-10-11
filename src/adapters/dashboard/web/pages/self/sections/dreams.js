/* The dream journal (2026-09-26): each dream, newest first — its date, its
   state, its title — and, opened, the journal entry in the dream's own words
   and every change it made, each naming the memories it touched (clickable).
   A change the owner undid is struck through. The journal is a dream, kept
   apart from the memories: nothing here is something that happened. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { said } from "../../../shared/format.js";
import { renderMarkdown } from "../markdown.js";
import { dateOr } from "../../../shared/dates.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";

export const markup = `
    <h2 id="self-dreams-h">Dreams <span id="self-dreams-q"></span></h2>
    <div id="self-dreams"></div>`;

let last = null;
/** Which dreams are open, by id — kept across redraws. */
const openIds = new Set();

const STATE = { begun: "dreaming", journaled: "woke", undone: "undone" };

/** One memory a change touched; an original the dream had less than whole says how it saw it. */
export function memoryRef(m) {
  return '<span class="dr-mem' + (m.confidential ? " withheld" : "") + '" role="button" tabindex="0" onclick="openMemory(\'' +
    esc(m.id) + '\')" onkeydown="if(event.key===\'Enter\')openMemory(\'' + esc(m.id) + '\')">' + said(m.text, m.confidential) + "</span>" +
    (m.seen ? ' <span class="dr-seen">(' + esc(m.seen) + ")</span>" : "");
}

function change(c) {
  return '<li class="dr-change' + (c.undone ? " undone" : "") + '">' +
    '<span class="dr-said">' + esc(c.said) + (c.undone ? " · undone" : "") + "</span>" +
    (c.memories.length > 0 ? '<span class="dr-mems">' + c.memories.map(memoryRef).join(" · ") + "</span>" : "") +
    "</li>";
}

function countsLine(counts) {
  const parts = Object.entries(counts).map(([k, n]) => n + " " + k);
  return parts.length === 0 ? "no changes" : parts.join(", ");
}

export function paint(d) {
  if (d) last = d;
  d = last;
  $("self-dreams-q").innerHTML = q("dreams", "Once a day, with the owner's yes, I dream for a few minutes over what was lived since the last dream: merging near-copies, linking what belongs together, replaying what matters, writing down a pattern. Every change can be undone as a whole (counterparts dream --undo <id>). A dream is never a memory of something that happened.");
  wireTips($("self-dreams-q"));
  const box = $("self-dreams");
  if (d.dreamsAbsent) {
    box.innerHTML = absenceLine(d.dreamsAbsent, "no dream yet");
    return;
  }
  const v = d.dreams;
  box.innerHTML = '<div class="card pad dr-list">' + v.dreams.map((x) => {
    const open = openIds.has(x.id);
    return '<div class="dr' + (open ? " open" : "") + (x.state === "undone" ? " undone" : "") + '">' +
      '<button type="button" class="dr-top" data-id="' + esc(x.id) + '" aria-expanded="' + open + '">' +
        '<span class="dr-date">' + esc(dateOr(x.date) || "lived day " + x.day) + "</span>" +
        '<span class="dr-title">' + esc(x.title || "(no journal yet)") + "</span>" +
        '<span class="chip">' + esc(STATE[x.state] || x.state) + "</span>" +
        '<span class="dr-counts">' + esc(countsLine(x.counts)) + "</span>" +
      "</button>" +
      (open
        ? '<div class="dr-body">' +
            (x.journal ? '<div class="dr-journal">' + renderMarkdown(x.journal) + "</div>" : '<p class="foot">No journal written.</p>') +
            (x.changes.length > 0 ? '<ol class="dr-changes">' + x.changes.map(change).join("") + "</ol>" : "") +
            '<p class="foot">Undo it all: <code>counterparts dream --undo ' + esc(x.id) + "</code></p>" +
          "</div>"
        : "") +
      "</div>";
  }).join("") +
    (v.more > 0
      ? '<p class="foot">The newest ' + v.dreams.length + " of " + (v.total ?? v.dreams.length + v.more) + " dreams. " +
        "Every one, newest first: <code>counterparts dream --list --all</code></p>"
      : "") +
    "</div>";
  box.querySelectorAll(".dr-top").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.id;
    if (openIds.has(id)) openIds.delete(id);
    else openIds.add(id);
    paint();
  }));
}
