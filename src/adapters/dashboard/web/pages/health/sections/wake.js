/* Is the wake overflowing? One compact row (round 3b, item 3 — moved here from
   the self tab): the published wake's size against its ceiling, as one stacked
   bar of its parts (headers, self page, nearby memories, arriving, room left),
   and whether the last render had to trim anything to fit. What the wake says
   is on the self tab ("Next time I wake, I start with:"). */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
    <div class="card pad hwk" id="h-wake"></div>`;

export const kb = (b) => (b / 1000).toFixed(1) + " KB";

/** The parts, in reading order, with a colour each. */
const TONE = { furniture: "p-furn", page: "p-page", identity: "p-page", craft: "p-craft", threads: "p-threads", hints: "p-hints", horizon: "p-horizon" };

/**
 * FULL: the last render trimmed to fit, or less room is left than this share
 * of the ceiling. A full wake is the NORMAL state (Mike, 2026-10-01): the
 * composition fills the room it is given, so full is green and says so.
 */
export const FULL_SHARE = 0.03;

/**
 * What being full COST, in words — the view's `costs` (`views/health.ts#
 * wakeCosts`): the self page cut or left out, handoffs and "Last here" lines
 * a session start had no room for, "Work here" lines that did not all fit, the
 * page writer held back for lack of room.
 * Empty when nothing.
 */
export function costWords(c) {
  if (!c) return [];
  const out = [];
  if (c.page) {
    // The page's rung (2026-10-10): its outline or headings, one line, or —
    // in a wake published before 2026-10-09 — a cut.
    out.push(c.page.rung === "outline"
      ? "the self page (" + kb(c.page.whole) + ") showed only each section's heading and first sentence — it has no short version"
      : c.page.rung === "headings"
        ? "the self page (" + kb(c.page.whole) + ") showed only its section headings"
        : c.page.shown > 0
          ? "the self page was cut to fit (" + kb(c.page.shown) + " of " + kb(c.page.whole) + " shown)"
          : "the self page was left out (" + kb(c.page.whole) + ")");
  }
  if (c.handoffs > 0) out.push(c.handoffs + (c.handoffs === 1 ? " handoff" : " handoffs") + " had no room at a session start");
  if (c.lastHere > 0) out.push(c.lastHere + (c.lastHere === 1 ? " \"Last here\" line" : " \"Last here\" lines") + " had no room at a session start");
  if (c.work > 0) out.push("\"Work here\" lines did not all fit at a session start, in " + c.work + (c.work === 1 ? " directory" : " directories"));
  if (c.writerHeld) out.push("the page writer held back for lack of room");
  return out;
}

/** The row's words and its light. Pure. */
export function wakeLine(w) {
  if (!w.ok) return { tone: "grey", line: "No wake composed yet — one is written at the end of each day" };
  const size = w.budget ? kb(w.bytes) + " of " + kb(w.budget) : kb(w.bytes) + " (its ceiling was not recorded)";
  if (w.budget && w.bytes > w.budget) return { tone: "amber", line: "The wake runs over its ceiling: " + size };
  const full = w.trimmed > 0 || (w.budget && w.budget - w.bytes < w.budget * FULL_SHARE);
  const costs = costWords(w.costs);
  if (costs.length > 0) {
    return {
      tone: "amber",
      line: (full ? "The wake is full (" + size + "), and it cost something: " : "The wake has room (" + size + "), but ") + costs.join("; "),
    };
  }
  if (full) {
    return {
      tone: "green",
      line: "The wake is full — normal: " + size +
        (w.trimmed > 0
          ? "; " + w.trimmed + (w.trimmed === 1 ? " line" : " lines") + (w.trimmedFrom.length > 0 ? " (" + w.trimmedFrom.join(", ") + ")" : "") + " left out to fit"
          : ""),
    };
  }
  return { tone: "green", line: "The wake fits: " + size + (w.budget ? ", " + kb(w.budget - w.bytes) + " room left" : "") };
}

export function paint(d) {
  const w = d.wake;
  const { tone, line } = wakeLine(w);
  if (!w.ok) {
    $("h-wake").innerHTML = '<span class="hc-dot hc-' + tone + '"></span><span class="hwk-line">' + esc(line) + "</span>";
    return;
  }
  const total = w.budget && w.budget > w.bytes ? w.budget : w.bytes;
  const seg = w.parts.map((p) =>
    '<span class="wk-seg ' + (TONE[p.key] || "p-furn") + '" style="width:' + (p.bytes / total * 100).toFixed(2) + '%" title="' +
      esc(p.label) + ": " + kb(p.bytes) + '"></span>').join("");
  const legend = w.parts.map((p) =>
    '<span class="wk-key"><i class="' + (TONE[p.key] || "p-furn") + '"></i>' + esc(p.label) + " <em>" + kb(p.bytes) + "</em></span>").join("") +
    (w.budget && w.budget > w.bytes ? '<span class="wk-key"><i class="p-room"></i>room left <em>' + kb(w.budget - w.bytes) + "</em></span>" : "");
  $("h-wake").innerHTML =
    '<div class="hwk-top"><span class="hc-dot hc-' + tone + '"></span><span class="hwk-line">' + esc(line) + "</span></div>" +
    '<div class="wk-bar" role="img" aria-label="' + esc(w.parts.map((p) => p.label + " " + kb(p.bytes)).join(", ")) + '">' + seg + "</div>" +
    '<div class="wk-legend">' + legend + "</div>";
}
