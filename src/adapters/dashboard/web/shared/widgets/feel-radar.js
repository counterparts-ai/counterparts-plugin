/* "How it feels": the one feelings chart, drawn the same on Home and on
   Memories (round 4, 2026-09-28 — Mike's deliberate exception to "no repeats":
   one component, two callers). A radar of the feelings wheel's seven cores, in
   wheel order, with two shapes laid over each other — the owner's (the feelings
   recorded as his) and mine. Each axis sums the recorded strengths under that
   core across the live memories; both shapes share one scale (square root, so
   a little of a feeling still shows beside a lot).

   The only difference between the pages is what a click on an axis does, and
   the caller says it: on Home it opens Memories filtered to that feeling; on
   Memories it filters the list. Hover shows the counts in words. Plain SVG.

   The axes carry the stored cores (`data-core`); what they are CALLED is
   `memory-marks.js#feelingName` (the stored name, since the wheel v2).

   Data: `/api/overview`'s or `/api/memories`'s `feelings`
   (`views/memories.ts#feelingsView`) — the same numbers on both. */
import { esc } from "../dom.js";
import { FEELING_COLOURS, feelingName } from "../memory-marks.js";
import { hideTip, showTip } from "../tip.js";
import { ownersWord } from "../voice.js";
import { q, wireTips } from "./tips.js";

const OWNER = "#ffb74d";
const MINE = "#b388ff";
/** Under this many memories with feelings, say how few there are. */
const FEW = 20;

/** The chart's `?`: two sentences. */
export function feelTip(owner) {
  return "How the moments I kept felt: amber is " + ownersWord(owner) + " side, purple is mine. " +
    "The further a shape reaches toward a feeling, the more of it there is.";
}

/** The heading's `?`, as markup, wired by `wireRadar`. `key` keeps each page's tip apart. */
export function feelQ(key, owner) {
  return q(key, feelTip(owner));
}

/**
 * The radar itself, as SVG markup: a pure function of `feelings`. Each axis is
 * a `g[data-core]` to hover, click or tap. `picked` marks one axis as on (the
 * core the list is filtered to, on Memories).
 */
export function radarSvg(f, picked) {
  const cores = f.cores;
  const max = Math.max(0, ...cores.map((c) => Math.max(c.yours.sum, c.mine.sum)));
  const W = 300, H = 250, cx = W / 2, cy = H / 2 + 2, R = 86;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / cores.length;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const fmt = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
  const theirs = ownersWord(f.owner);
  let svg = '<svg class="feel-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' +
    esc("how it feels: " + cores.map((c) => feelingName(c.core) + " " + theirs + " " + c.yours.count + ", mine " + c.mine.count).join("; ")) + '">';
  for (const k of [1 / 3, 2 / 3, 1]) {
    svg += '<polygon class="feel-ring" points="' + cores.map((_, i) => fmt(pt(i, R * k))).join(" ") + '"/>';
  }
  cores.forEach((c, i) => {
    const [x, y] = pt(i, R);
    svg += '<line class="feel-spoke" x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>';
  });
  if (max > 0) {
    for (const [who, col] of [["yours", OWNER], ["mine", MINE]]) {
      if (cores.every((c) => c[who].sum === 0)) continue;
      const pts = cores.map((c, i) => fmt(pt(i, R * Math.sqrt(c[who].sum / max)))).join(" ");
      svg += '<polygon class="feel-shape" points="' + pts + '" style="fill:' + col + ";stroke:" + col + '"/>';
      cores.forEach((c, i) => {
        if (c[who].sum === 0) return;
        const [x, y] = pt(i, R * Math.sqrt(c[who].sum / max));
        svg += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.6" fill="' + col + '"/>';
      });
    }
  }
  // Each axis: a wedge to hover or tap, and its word at the rim.
  cores.forEach((c, i) => {
    const a0 = ang(i) - Math.PI / cores.length, a1 = ang(i) + Math.PI / cores.length;
    const w = [[cx, cy], [cx + (R + 34) * Math.cos(a0), cy + (R + 34) * Math.sin(a0)], [cx + (R + 34) * Math.cos(a1), cy + (R + 34) * Math.sin(a1)]];
    const [lx, ly] = pt(i, R + 16);
    const anchor = Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end";
    const on = picked === c.core;
    svg += '<g class="feel-axis' + (on ? " on filtering" : "") + '" data-core="' + esc(c.core) + '" tabindex="0" role="button" aria-pressed="' + on +
      '" aria-label="' + esc(feelingName(c.core)) + '">' +
      '<polygon class="feel-hit" points="' + w.map(fmt).join(" ") + '"/>' +
      '<circle cx="' + (lx + (anchor === "start" ? -8 : anchor === "end" ? 8 : 0)).toFixed(1) + '" cy="' + (ly - (anchor === "middle" ? 12 : 4)).toFixed(1) +
        '" r="3" fill="' + (FEELING_COLOURS[c.core] || "#8a95a3") + '"/>' +
      '<text class="feel-label" x="' + lx.toFixed(1) + '" y="' + (ly + (anchor === "middle" && ly > cy ? 8 : 0)).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(feelingName(c.core)) + "</text></g>";
  });
  return svg + "</svg>";
}

/** The two swatches: the owner's ("Mike's") and mine. */
export function radarLegend(owner) {
  return '<div class="feel-legend"><span><i style="background:' + OWNER + '"></i>' + esc(ownersWord(owner)) + "</span>" +
    '<span><i style="background:' + MINE + '"></i>mine</span></div>';
}

/** The whole chart's markup: the radar and its legend, or the empty line. */
export function radarHtml(f, picked) {
  if (!f || f.carrying === 0) {
    return '<p class="glance-empty">No feelings recorded yet. When a memory is kept with how it felt — ' +
      esc(ownersWord(f && f.owner)) + " or mine — it shows here.</p>";
  }
  return '<div class="feel-row">' + radarSvg(f, picked) + '<div class="feel-side">' + radarLegend(f.owner) + "</div></div>" +
    (f.carrying < FEW ? '<p class="glance-note">' + f.carrying + (f.carrying === 1 ? " memory carries" : " memories carry") + " feelings so far.</p>" : "");
}

/** One axis on hover, in words: "happy — Mike's 3 · mine 2". */
function hoverHtml(c, owner) {
  return '<b style="color:' + (FEELING_COLOURS[c.core] || "inherit") + '">' + esc(feelingName(c.core)) + "</b> — " +
    esc(ownersWord(owner)) + " " + c.yours.count + " · mine " + c.mine.count;
}

/**
 * Wire the chart once: a click, a tap or Enter on an axis calls `onPick(core)`;
 * a pointer over an axis floats its counts. `feelings()` returns the latest
 * data (the chart is redrawn on a live refresh; the listeners stay).
 */
export function wireRadar(el, feelings, onPick) {
  el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-core]");
    if (!a) return;
    hideTip();
    onPick(a.dataset.core);
  });
  el.addEventListener("keydown", (e) => {
    const a = e.target.closest("g[data-core]");
    if (a && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(a.dataset.core); }
  });
  el.addEventListener("mousemove", (e) => {
    const a = e.target.closest("g[data-core]");
    const f = feelings();
    const c = a && f ? f.cores.find((x) => x.core === a.dataset.core) : null;
    if (!c) return hideTip();
    showTip(e.clientX, e.clientY, hoverHtml(c, f.owner));
  });
  el.addEventListener("mouseleave", hideTip);
}

/** Wire the `?` beside a heading after it is (re)drawn. */
export { wireTips };
