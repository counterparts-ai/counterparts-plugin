/* The self page — the heart of the tab — on the left, whole and untrimmed; and
   in the side column its history as ONE strip of lived days (round 3b, item 1):
   a filled dot is a day the page was rewritten (click it to see what changed),
   a hollow dot a day it was not (hover or tap it for why, in the page writer's
   own recorded words). Nothing is open until a dot is clicked. Read-only: there
   is no write door here (the doors are the MCP tool and the console's
   `self-page`). */
import { absenceLine } from "../../../shared/absence.js";
import { dateWords } from "../../../shared/dates.js";
import { $, esc } from "../../../shared/dom.js";
import { diffStats, diffText } from "../diff.js";
import { renderMarkdown } from "../markdown.js";
import { ui } from "../state.js";
import { q, wireTips } from "../../../shared/widgets/tips.js";

/** The left column: an opened version (when one is), then the page. */
export const mainMarkup = `
      <div id="self-version"></div>
      <p class="sp-behind" id="self-behind" hidden></p>
      <section class="sp-card" id="self-page"></section>`;

/** The side column's top: the page's history, one dot per lived day. */
export const sideMarkup = `
      <div class="side-block" id="self-history"></div>`;

let steps = [];
let days = [];
let undated = 0;
let earlier = 0;

const WHO = { owner: "you, by hand", session: "a session", writer: "the page writer", reflection: "the reflection" };
export const who = (by) => (by ? WHO[by] || by : "someone unrecorded");

/** An id as the record writes it: `rfl_…`, `drm_…`, `mem_…` (a prefix, then hex). */
const RAW_ID = /\b[a-z]{2,6}_[0-9a-f]{6,}\b/g;

/** A reason's own words with the ids taken out, and what that leaves tidied. */
export function withoutIds(text) {
  return String(text || "").replace(RAW_ID, "").replace(/\(\s*\)/g, "").replace(/\s+([,.;:)])/g, "$1")
    .replace(/\s{2,}/g, " ").trim();
}

/**
 * Who rewrote the page and why, as a person would say it (2026-09-30). The
 * record's reason is a string each door writes its own way: the ones a door
 * writes by itself are said in plain words and need no quote; anything else (a
 * session's or the page writer's own sentence, the owner's `--reason`) is
 * quoted with its ids left out. Display only: the record is untouched. Pure.
 * `today`: the day being described is today.
 */
export function rewriteWords(by, reason, today) {
  const r = String(reason || "").trim();
  if (by === "reflection") {
    const m = /^reflection\s+\S+(\s+after dream\s+\S+)?$/.exec(r);
    if (m || r === "") return { who: who(by) + (m && m[1] ? " after " + (today ? "today's" : "that night's") + " dream" : ""), quote: null };
  }
  if (by === "owner") {
    if (r === "" || r === "owner edit") return { who: who(by), quote: null };
    if (/^restored version \d+$/.test(r)) return { who: "you, putting an earlier version back", quote: null };
  }
  const words = withoutIds(r);
  return { who: who(by), quote: words === "" ? null : words };
}

/** "rewritten twice, last by …": how many times, in words a person uses. */
const TIMES = { 2: "twice, last " };

export function paintPage(d) {
  const p = d.page;
  $("self-page").innerHTML = d.pageAbsent
    ? absenceLine(d.pageAbsent, "no page yet — once a day, the nightly run writes it from the day before; you can also write it by hand")
    : '<div class="sp-body">' + renderMarkdown(p.body) + "</div>";
}

/**
 * A page a few lived days behind says so, once, above it (round 3, S1): when it
 * was written and what has been lived since. Calm — a note, not a warning. The
 * view decides when (`pageBehind`); this only draws its line.
 */
export function paintBehind(d) {
  const el = $("self-behind");
  const b = d.pageBehind;
  if (!b || d.pageAbsent) { el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = esc(b.line) + " " +
    q("behind", "The page is rewritten by the page writer, at most once a night, when something about who I am has moved. " +
      "It was last rewritten on lived day " + b.writtenDay + "; today is lived day " + (b.writtenDay + b.livedDays) +
      ". The strip beside the page says what happened on each day since.");
  wireTips(el);
}

/** A day's name on the strip: its date when the record gives one, else its lived day. */
export function dayName(x) {
  const date = dateWords(x.date);
  return (x.today ? "Today" + (date ? ", " + date : "") : date || "Lived day " + x.day) +
    (date || x.today ? " · lived day " + x.day : "");
}

/**
 * What the strip's caption says for one day: when, and either who rewrote the
 * page (and the reason they gave, said by `rewriteWords`) or the view's own
 * words for why it was not.
 * Pure, so it is tested without a page.
 */
export function dayWords(x) {
  if (x.seqs && x.seqs.length > 0) {
    const n = x.seqs.length;
    const times = n > 1 ? TIMES[n] || n + " times, last " : "";
    const w = rewriteWords(x.by, x.reason, x.today);
    return dayName(x) + " — rewritten " + times + "by " + w.who + (w.quote ? ": “" + w.quote + "”" : ".");
  }
  return dayName(x) + " — " + (x.why || "not rewritten.");
}

/** The caption when no day is picked or hovered: how often, and the newest. */
export function stripSummary(list) {
  const written = list.filter((x) => x.seqs.length > 0);
  if (list.length === 0) return "";
  const newest = written[written.length - 1];
  const n = list.length;
  return "Rewritten on " + written.length + " of " + n + " lived day" + (n === 1 ? "" : "s") +
    (newest ? " · newest " + (dateWords(newest.date) || "lived day " + newest.day) : "") + ".";
}

/** A filled day opens its newest version. */
const newestSeq = (x) => x.seqs[x.seqs.length - 1];

export function paintHistory(d) {
  if (d) { steps = d.pageHistory || []; days = d.pageDays || []; undated = d.pageDaysUndated || 0; earlier = d.pageDaysEarlier || 0; }
  const el = $("self-history");
  // A version, or a picked day, that is no longer there (a cleared page) closes.
  if (ui.version !== null && !steps.some((s) => s.seq === ui.version)) ui.version = null;
  if (ui.pageDay !== null && !days.some((x) => x.day === ui.pageDay)) ui.pageDay = null;
  if (days.length === 0) {
    // Versions with no lived day still exist: say so rather than draw nothing.
    el.hidden = undated === 0;
    el.innerHTML = undated === 0 ? "" : '<h3 class="sb-h">The page, day by day</h3><p class="ps-say">' +
      esc(undated + (undated === 1 ? " version carries" : " versions carry") + " no lived day, so no strip can draw " + (undated === 1 ? "it" : "them") + ".") + "</p>";
    paintVersion();
    return;
  }
  el.hidden = false;
  const dots = days.map((x) => {
    const filled = x.seqs.length > 0;
    const on = ui.pageDay === x.day;
    return '<button type="button" class="ps-dot' + (filled ? " filled" : "") + (on ? " on" : "") + (x.today ? " today" : "") +
      '" data-day="' + x.day + '" aria-pressed="' + on + '" aria-label="' + esc(dayWords(x)) + '"><i></i></button>';
  }).join("");
  const first = days[0], last = days[days.length - 1];
  const ends = '<div class="ps-ends"><span>' + esc(dateWords(first.date) || "lived day " + first.day) + "</span>" +
    (days.length > 1 ? "<span>" + esc(last.today ? "today" : dateWords(last.date) || "lived day " + last.day) + "</span>" : "") + "</div>";
  el.innerHTML =
    '<h3 class="sb-h">The page, day by day ' +
      q("history", "One dot per lived day since the page was first written. A filled dot is a day it was rewritten: click it to see what changed. " +
        "A hollow dot is a day it was not: hover or tap it for why, from the page writer's own record." +
        (undated > 0 ? " " + undated + (undated === 1 ? " older version carries" : " older versions carry") + " no lived day, so no dot shows it." : "")) + "</h3>" +
    '<div class="ps-strip" role="group" aria-label="The page\'s history, one dot per lived day">' + dots + "</div>" +
    ends +
    '<p class="ps-say" id="self-day-say" aria-live="polite"></p>';
  say();
  el.querySelectorAll(".ps-dot").forEach((b) => {
    const x = days.find((y) => y.day === Number(b.dataset.day));
    b.addEventListener("click", () => {
      const again = ui.pageDay === x.day;
      ui.pageDay = again ? null : x.day;
      ui.version = !again && x.seqs.length > 0 ? newestSeq(x) : null;
      ui.whole = false;
      paintHistory();
      // Only on a click, never on a refresh: bring the opened version into sight.
      const v = $("self-version");
      if (ui.version !== null && v.scrollIntoView) v.scrollIntoView({ block: "nearest" });
    });
    b.addEventListener("mouseenter", () => say(x));
    b.addEventListener("focus", () => say(x));
    b.addEventListener("mouseleave", () => say());
    b.addEventListener("blur", () => say());
  });
  wireTips(el);
  paintVersion();
}

/** The caption: the hovered day, else the picked one, else the summary. The
 *  picked day's longer story (the writer's record) sits behind its own `?`. */
function say(hover) {
  const box = $("self-day-say");
  if (!box) return;
  const picked = ui.pageDay === null ? null : days.find((y) => y.day === ui.pageDay) || null;
  const x = hover || picked;
  if (!x) {
    box.className = "ps-say";
    box.textContent = stripSummary(days) +
      (earlier > 0 ? " " + earlier + " earlier lived day" + (earlier === 1 ? " is" : "s are") + " not drawn." : "");
    return;
  }
  box.className = "ps-say" + (x === picked ? " picked" : "");
  box.innerHTML = esc(dayWords(x)) + (x === picked && x.more ? " " + q("pageday", x.more) : "");
  wireTips(box);
}

function paintVersion() {
  const box = $("self-version");
  const i = ui.version === null ? -1 : steps.findIndex((s) => s.seq === ui.version);
  if (i < 0) { box.innerHTML = ""; box.hidden = true; return; }
  box.hidden = false;
  const s = steps[i];
  const prev = i > 0 ? steps[i - 1] : null;
  const w = rewriteWords(s.by, s.reason, days.some((x) => x.day === s.day && x.today));
  const head =
    '<div class="tl-vhead"><b>' + (s.current ? "The page as it stands" : "Version " + (s.seq - 1)) + "</b>" +
    '<span class="tl-meta">' + esc(dateWords(s.date) || "undated") + (s.day !== null ? " · lived day " + s.day : "") +
    " · written by " + esc(w.who) + (s.bytes !== null ? " · " + s.bytes + " bytes" : "") + "</span>" +
    '<button type="button" class="tl-close" id="self-version-close" aria-label="Close this version">close</button></div>' +
    (w.quote ? '<div class="tl-why">“' + esc(w.quote) + "”</div>" : "");
  let toggle = "";
  let body;
  if (s.body === null) {
    body = '<div class="foot">This version\'s words could not be read.</div>';
  } else {
    const canDiff = prev !== null && prev.body !== null;
    toggle = canDiff
      ? '<div class="tl-toggle" role="group">' +
          '<button type="button" class="seg' + (ui.whole ? "" : " on") + '" data-whole="0">What changed</button>' +
          '<button type="button" class="seg' + (ui.whole ? " on" : "") + '" data-whole="1">The whole version</button></div>'
      : "";
    if (!canDiff || ui.whole) {
      body = (prev === null ? '<div class="foot">The first page — nothing came before it.</div>' : "") +
        '<div class="sp-body">' + renderMarkdown(s.body) + "</div>";
    } else {
      const rows = diffText(prev.body, s.body);
      const st = diffStats(rows);
      body = '<div class="foot">Compared with version ' + (prev.seq - 1) + ": " +
        '<span class="d-add">' + st.added + " line" + (st.added === 1 ? "" : "s") + " added or changed</span>, " +
        '<span class="d-del">' + st.removed + " taken out or changed</span>.</div>" +
        renderDiff(rows);
    }
  }
  box.innerHTML = '<div class="card pad tl-detail">' + head + toggle + body + "</div>";
  box.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
    ui.whole = b.dataset.whole === "1";
    paintVersion();
  }));
  $("self-version-close").addEventListener("click", () => {
    ui.version = null;
    ui.pageDay = null;
    paintHistory();
  });
}

/** Unchanged runs longer than a few lines fold to one line saying so. */
function renderDiff(rows) {
  const out = [];
  let k = 0;
  while (k < rows.length) {
    if (rows[k].op === "=") {
      let e = k;
      while (e < rows.length && rows[e].op === "=") e++;
      const run = rows.slice(k, e);
      const keepHead = k === 0 ? 0 : 2, keepTail = e === rows.length ? 0 : 2;
      if (run.length > keepHead + keepTail + 1) {
        for (const r of run.slice(0, keepHead)) out.push(eqLine(r));
        out.push('<div class="d-fold">… ' + (run.length - keepHead - keepTail) + " unchanged lines …</div>");
        for (const r of run.slice(run.length - keepTail)) out.push(eqLine(r));
      } else {
        for (const r of run) out.push(eqLine(r));
      }
      k = e;
      continue;
    }
    const r = rows[k++];
    const cls = r.op === "+" ? "d-line add" : "d-line del";
    const sign = r.op === "+" ? "+" : "−";
    out.push('<div class="' + cls + '"><span class="d-sign" aria-hidden="true">' + sign + "</span><span>" +
      r.parts.map((p) => p.op === "=" ? esc(p.v) : p.op === "+" ? "<ins>" + esc(p.v) + "</ins>" : "<del>" + esc(p.v) + "</del>").join("") +
      "</span></div>");
  }
  return '<div class="diff">' + out.join("") + "</div>";
}

function eqLine(r) {
  return '<div class="d-line"><span class="d-sign" aria-hidden="true"> </span><span>' + (esc(r.text) || "&nbsp;") + "</span></div>";
}
