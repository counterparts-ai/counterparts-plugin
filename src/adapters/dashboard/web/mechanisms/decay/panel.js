/* Forgetting, pictured: the fade curves of a few of this store's own memories,
   from their last use to sixty lived days ahead, as the physics computes them.
   Solid is what has happened; dashed is what will, if nobody uses it. */
import { memLink, nothingYet, two } from "../picture.js";

const COLOURS = ["#00e5ff", "#b388ff", "#ffd740", "#00bfa5"];


export function picture(p) {
  if (!p || p.curves.length === 0) return nothingYet("There is nothing here that can fade yet.");
  const W = 560, H = 190, L = 34, R = 10, T = 10, B = 26;
  const span = Math.max(1, p.to - p.from);
  const x = (d) => L + ((d - p.from) / span) * (W - L - R);
  const y = (s) => T + (1 - Math.max(0, Math.min(1, s))) * (H - T - B);
  const path = (pts) => pts.map((q, i) => (i === 0 ? "M" : "L") + x(q[0]).toFixed(1) + " " + y(q[1]).toFixed(1)).join(" ");
  let svg = '<svg class="pic-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Fade curves of ' + p.curves.length + ' memories">';
  // the two lines a memory crosses on its way down
  svg += '<line class="pic-guide" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(p.semanticFloor) + '" y2="' + y(p.semanticFloor) + '"/>' +
    '<text class="pic-tick" x="' + (L + 4) + '" y="' + (y(p.semanticFloor) - 4) + '">settled knowledge above this line</text>' +
    '<line class="pic-guide" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(p.archiveLine) + '" y2="' + y(p.archiveLine) + '"/>' +
    '<text class="pic-tick" text-anchor="end" x="' + (W - R) + '" y="' + (y(p.archiveLine) - 4) + '">archived below this line (kept, not deleted)</text>';
  svg += '<line class="pic-now" x1="' + x(p.day) + '" x2="' + x(p.day) + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
    '<text class="pic-tick" x="' + (x(p.day) + 4) + '" y="' + (H - B - 4) + '">today</text>';
  svg += '<text class="pic-tick" x="' + L + '" y="' + (H - 8) + '">day ' + p.from + "</text>" +
    '<text class="pic-tick" text-anchor="end" x="' + (W - R) + '" y="' + (H - 8) + '">day ' + p.to + "</text>" +
    '<text class="pic-tick" text-anchor="end" x="' + (L - 6) + '" y="' + (y(1) + 4) + '">1</text>' +
    '<text class="pic-tick" text-anchor="end" x="' + (L - 6) + '" y="' + (y(0) + 4) + '">0</text>';
  p.curves.forEach((c, i) => {
    const col = COLOURS[i % COLOURS.length];
    const past = c.points.filter((q) => q[0] <= p.day);
    const ahead = c.points.filter((q) => q[0] >= p.day);
    if (past.length > 1) svg += '<path d="' + path(past) + '" fill="none" stroke="' + col + '" stroke-width="2"/>';
    if (ahead.length > 1) svg += '<path d="' + path(ahead) + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-dasharray="4 4" opacity=".8"/>';
    svg += '<circle cx="' + x(p.day) + '" cy="' + y(c.now) + '" r="3.5" fill="' + col + '"/>';
  });
  svg += "</svg>";
  const legend = p.curves.map((c, i) =>
    '<li><span class="pic-swatch" style="background:' + COLOURS[i % COLOURS.length] + '"></span><span>' + memLink(c, 90) +
    '<span class="pic-meta">strength ' + two(c.now) + " now · last used day " + c.lastUsedDay +
    (c.now < p.archiveLine ? " · already below the archive line" : c.archiveDay === null ? "" : " · reaches the archive line around day " + c.archiveDay + " if unused") + "</span></span></li>"
  ).join("");
  return svg + '<ul class="pic-legend">' + legend + "</ul>";
}
