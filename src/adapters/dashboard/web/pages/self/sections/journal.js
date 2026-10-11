/* The journal as a strip of days: each day its date, its lived day and a dot
   per chapter, newest first. It opens on the newest day; picking a day lists
   that day's chapters as titles with the model that wrote each (when
   recorded), and picking a title opens its text in place. The whole entry
   still opens as a record. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { renderMarkdown } from "../markdown.js";
import { chapterKey, ui } from "../state.js";
import { dateWords } from "../../../shared/dates.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";

export const markup = `
    <h2 id="self-journal-h">Journal <span id="self-journal-q"></span></h2>
    <div id="self-journal"></div>`;

let last = null;

/**
 * A day's date in the strip, in ONE format for every day (round 3, S4): the
 * side column's "Jul 16th", from the view's `iso` (the chapter heading's date,
 * else the entry's own). "lived day 3" only when no date reads at all.
 */
export function dayLabel(day) {
  return dateWords(day.iso) || "lived day " + day.day;
}

/** The picked day's heading: "Thu, Jul 16th" (the year when it is not this one). */
export function dayTitle(day) {
  return dateWords(day.iso, { weekday: true }) || "lived day " + day.day;
}

/** "1 chapter" / "7 chapters": what the number in a day's cell counts. */
export function chapterCount(n) {
  return n + (n === 1 ? " chapter" : " chapters");
}

export function paint(d) {
  if (d) last = d;
  d = last;
  $("self-journal-q").innerHTML = q("journal", "A chapter is written at the end of a session; these do not fade. " +
    "Each day in the strip shows its date, its lived day, and how many chapters were written that day. Pick one to list them.");
  wireTips($("self-journal-q"));
  const box = $("self-journal");
  if (d.journalAbsent) {
    box.innerHTML = absenceLine(d.journalAbsent, "no chapter has been written yet");
    return;
  }
  const days = d.journal;
  // A picked day that is no longer sent falls back to the newest.
  const picked = days.find((x) => x.day === ui.day) || days[0];
  const strip = box.querySelector(".jd-strip");
  const scrollLeft = strip ? strip.scrollLeft : 0;

  const cells = days.map((x) => {
    const on = x === picked;
    const n = x.chapters.length;
    // The count says what it counts, the same way on every day.
    const marks = '<span class="jd-count" aria-hidden="true"><span class="jd-n">' + n + '</span> ' +
      (n === 1 ? "chapter" : "chapters") + "</span>";
    const dated = !!dateWords(x.iso);
    return '<button type="button" class="jd-day' + (on ? " on" : "") + '" data-day="' + x.day + '" aria-pressed="' + on + '"' +
      ' aria-label="' + esc(dayTitle(x) + (dated ? ", lived day " + x.day : "") + ", " + chapterCount(n)) + '">' +
      '<b>' + esc(dayLabel(x)) + "</b>" +
      (dated ? '<span class="jd-lived">day ' + x.day + "</span>" : "") + marks + "</button>";
  }).join("");

  const chapters = picked.chapters.map((c) => {
    const key = chapterKey(c);
    const open = ui.chapters.has(key);
    return '<div class="jc' + (open ? " open" : "") + '">' +
      '<button type="button" class="jc-top" data-key="' + esc(key) + '" aria-expanded="' + open + '">' +
        '<span class="jc-title">' + esc(c.title) + "</span>" +
        (c.model ? '<span class="chip model" title="the model that wrote it">' + esc(c.model) + "</span>" : "") +
      "</button>" +
      (open
        ? '<div class="jc-body">' + (c.text === null ? '<p class="foot">This chapter is withheld here, as it is everywhere.</p>' : renderMarkdown(c.text)) +
            '<button type="button" class="act-btn jc-open" onclick="openMemory(\'' + c.id + '\')">open the whole entry</button></div>'
        : "") +
    "</div>";
  }).join("");

  box.innerHTML =
    '<div class="jd-strip" role="group" aria-label="Days">' + cells + "</div>" +
    '<div class="jd-head"><b>' + esc(dayTitle(picked)) + "</b>" +
      (dateWords(picked.iso) ? "<span>lived day " + picked.day + " · " + esc(chapterCount(picked.chapters.length)) + "</span>" : "<span>" + esc(chapterCount(picked.chapters.length)) + "</span>") + "</div>" +
    '<div class="jd-list">' + chapters + "</div>" +
    (d.journalMore > 0 ? '<p class="foot">' + d.journalMore + " older chapters are not shown here.</p>" : "");
  box.querySelector(".jd-strip").scrollLeft = scrollLeft;

  box.querySelectorAll(".jd-day").forEach((b) => b.addEventListener("click", () => {
    ui.day = Number(b.dataset.day);
    paint();
  }));
  box.querySelectorAll(".jc-top").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.key;
    if (ui.chapters.has(key)) ui.chapters.delete(key); else ui.chapters.add(key);
    // Reading a day's chapter pins that day: a new day landing on a refresh
    // must not move the strip out from under an open chapter.
    if (ui.day === null) ui.day = picked.day;
    paint();
  }));
}
