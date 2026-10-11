/* "Next time I wake, I start with:" — what the next session's wake holds, as a
   short list (round 3b, item 2): the self page and its age, the nearby
   memories by title (each opens its card), and anything arriving. "read it"
   opens the whole wake in place, as it will be read. Its size against the
   budget is the health tab's now; the rebuild button comes back when it is
   built (the console's `counterparts rebrief` is unchanged). */
import { absenceLine } from "../../../shared/absence.js";
import { dateWords } from "../../../shared/dates.js";
import { $, esc } from "../../../shared/dom.js";
import { headline, said } from "../../../shared/format.js";
import { ui } from "../state.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";

export const markup = `
      <div class="side-block">
        <h3 class="sb-h" id="self-wake-h">Next time I wake, I start with: <span id="self-wake-q"></span></h3>
        <div id="self-wake"></div>
      </div>`;

const EXPLAIN = "The wake is what a session is handed before its first word: composed without a model at the end of each day, from the page and the memories that are nearby. " +
  "When a session starts, a line with today's date goes on top, and in a folder with a handoff note, a pointer to it. " +
  "How much room it takes is on the health tab.";

let last = null;

/** The page's line: when it was written, and how many lived days ago. Pure. */
export function pageAge(p) {
  if (!p) return "";
  const date = dateWords(p.date);
  const ago = p.livedDaysAgo === null ? "" : p.livedDaysAgo === 0 ? "today" : p.livedDaysAgo === 1 ? "1 lived day ago" : p.livedDaysAgo + " lived days ago";
  const when = date && ago ? "written " + date + ", " + ago : date ? "written " + date : ago ? "written " + ago : "";
  return when + (p.newerThanWake ? (when ? " — " : "") + "rewritten since; the next wake carries the new one" : "");
}

/**
 * One memory in the list, the same for nearby and arriving (2026-09-30): its
 * title, or its first sentence when it has none, opening its card; the whole
 * words on hover. A line no memory was found for is its first sentence, plain.
 */
export function memoryItem(m) {
  const name = m.title || headline(m.text);
  if (!m.id) return '<li class="wk-line-i" title="' + esc(m.text) + '">' + esc(name) + "</li>";
  return '<li><button type="button" class="wk-mem" onclick="openMemory(\'' + esc(m.id) + '\')" title="' +
    esc(m.confidential ? "withheld" : m.text) + '">' + said(name, m.confidential) + "</button></li>";
}

export function paint(d) {
  if (d) last = d;
  d = last;
  $("self-wake-q").innerHTML = q("wake", EXPLAIN);
  wireTips($("self-wake-q"));
  const w = d.wake;
  const l = d.wakeList;
  if (!w.ok || !l || !l.ok) {
    $("self-wake").innerHTML = absenceLine(w.absent || "(never run)", "no wake has been composed yet (" + w.reason + ")");
    return;
  }
  const items = [];
  if (l.page) {
    items.push('<li class="wk-it"><span class="wk-what">The self page</span>' +
      (pageAge(l.page) ? '<span class="wk-sub">' + esc(pageAge(l.page)) + "</span>" : "") + "</li>");
  }
  const nearby = l.nearby.length > 0
    ? l.nearby.map(memoryItem).join("")
    : l.nearbyLines.map((t) => '<li class="wk-line-i">' + esc(headline(t)) + "</li>").join("");
  const nNear = l.nearby.length || l.nearbyLines.length;
  if (nNear > 0) {
    items.push('<li class="wk-it"><span class="wk-what">' + (nNear === 1 ? "A memory nearby" : nNear + " memories nearby") + "</span>" +
      '<ul class="wk-sublist">' + nearby + "</ul></li>");
  }
  items.push(l.arriving.length > 0
    ? '<li class="wk-it"><span class="wk-what">Arriving</span><ul class="wk-sublist">' +
        l.arriving.map(memoryItem).join("") + "</ul></li>"
    : '<li class="wk-it wk-none"><span class="wk-what">Nothing arriving</span></li>');
  const also = l.also.length > 0
    ? '<p class="wk-also">Also ' + l.also.map((a) => a.lines + " line" + (a.lines === 1 ? "" : "s") + " of " + esc(a.label)).join(", ") + ".</p>"
    : "";
  $("self-wake").innerHTML =
    '<ul class="wk-list">' + items.join("") + "</ul>" + also +
    '<button type="button" class="wk-read" id="wake-toggle" aria-expanded="' + ui.wake + '">' + (ui.wake ? "hide it" : "read it") + "</button>" +
    '<div class="wk-full" id="wake-full"' + (ui.wake ? "" : " hidden") + ">" + fullText(w) + "</div>";
  $("wake-toggle").addEventListener("click", () => { ui.wake = !ui.wake; paint(); });
}

function fullText(w) {
  return (w.preface ? '<div class="wakehead">Delivery preface: ' + esc(w.preface) + "</div>" : "") +
    w.lanes.map((lane) =>
      '<div class="lane"><h4>' + esc(lane.heading) + "</h4>" +
      lane.items.map((item) => {
        const m = /^(\S+\s·\s|by\s\S+\s·\s)/.exec(item);
        return '<div class="item">' + (m ? '<span class="date">' + esc(m[1]) + "</span>" + esc(item.slice(m[1].length)) : esc(item)) + "</div>";
      }).join("") + "</div>"
    ).join("");
}
