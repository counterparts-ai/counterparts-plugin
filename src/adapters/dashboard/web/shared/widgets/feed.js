/* The activity feed: narrated durable-log rows, newest first. Any page may
   render one; a feed REGISTERED as live (the flow tab's) also receives the
   pulse's new rows (`shell/pulse.js`), prepended and flashed. The home tab's
   memory-only live feed, which filtered and folded the pulse's rows, went in
   home round 4 (2026-09-28).

   A row carries a small icon when it has one (`web/lanes.ts`), and "×N" when
   it stands for N neighbours that read the same (the mechanism panel's
   Lately), with the span of days they cover ("days 1–6"). */
import { absenceLine } from "../absence.js";
import { $, esc } from "../dom.js";
import { openEvent } from "../event-modal.js";

/** Tiny line icons, 14px, drawn in the row's own colour. */
const PATHS = {
  // a pen: something written down
  remembered: '<path d="M3 13l1-3 7-7 2 2-7 7-3 1z"/>',
  // an arrow up: held more firmly
  stronger: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  // two arrows: an older reading replaced by a newer one
  replaced: '<path d="M3 6h9l-2-2M13 10H4l2 2"/>',
  // an arrow down: fading, let go
  faded: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  // a page: a chapter
  chapter: '<path d="M4 2h6l2 2v10H4zM6 7h4M6 10h4"/>',
  // a moon: sleep
  sleep: '<path d="M11 3a5 5 0 1 0 2 7 4 4 0 0 1-2-7z"/>',
  // a clock: a reminder
  reminder: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  // a note passed on: a handoff
  handoff: '<path d="M2 8h9M8 5l3 3-3 3M13 3v10"/>',
};
const LABEL = {
  remembered: "remembered", stronger: "stronger", replaced: "replaced", faded: "faded",
  chapter: "chapter", sleep: "sleep", reminder: "reminder", handoff: "handoff",
};

function icon(name) {
  const p = name && PATHS[name];
  if (!p) return "";
  return '<svg class="ev-i" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="' + LABEL[name] + '">' + p + "</svg>";
}

/** "day 6", or "days 1–6" for a merged line whose rows span several days. */
export function dayLabel(e) {
  return typeof e.fromDay === "number" && e.fromDay < e.day ? "days " + e.fromDay + "–" + e.day : "day " + e.day;
}

function inner(e) {
  const times = e.repeats > 1 ? '<span class="ev-x"> ×' + e.repeats + "</span>" : "";
  return '<span class="d">' + dayLabel(e) + "</span>" +
    '<span class="t">' + icon(e.icon) + esc(e.text) + times + '<span class="k">' + esc(e.name) +
      (e.node ? " · " + esc(e.node) : "") + "</span></span>";
}

export function renderFeed(el, events, ctx) {
  if (!events || events.length === 0) {
    el.innerHTML = absenceLine(ctx && ctx.feedAbsent ? ctx.feedAbsent : "(never run)", "nothing has reached my durable log");
    return;
  }
  el.innerHTML = events.map((e) =>
    '<div class="ev ' + e.tone + (e.icon ? " has-i" : "") + '" data-seq="' + e.seq + '"' +
      ' onclick="openEvent(' + e.seq + ')">' + inner(e) + "</div>"
  ).join("");
}

/** The feeds the pulse writes into, in registration order (element ids). */
const LIVE = new Set();
export function registerLiveFeed(id) {
  LIVE.add(id);
}

/** New events arrive oldest-first; each one is inserted at the top, flashed.
 *  A feed still showing its absence line is left alone (its page repaints it). */
export function prependToLiveFeeds(fresh) {
  for (const id of LIVE) {
    const el = $(id);
    if (!el || el.querySelector(".empty")) continue;
    for (const e of fresh) {
      const row = document.createElement("div");
      row.className = "ev " + e.tone + (e.icon ? " has-i" : "") + " flash";
      row.dataset.seq = e.seq;
      row.onclick = () => openEvent(e.seq);
      row.innerHTML = inner(e);
      el.insertBefore(row, el.firstChild);
    }
    while (el.children.length > 60) el.removeChild(el.lastChild);
  }
}
