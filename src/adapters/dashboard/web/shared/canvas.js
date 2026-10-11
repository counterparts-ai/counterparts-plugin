/* Canvas helpers: crisp on any display, laid out by CSS. */

/** The canvas's face: the page's `--sans` (Outfit), spelled out, because a
 *  canvas cannot read a CSS variable. Keep it in step with `tokens.css`. */
export const FACE = '"Outfit", system-ui, -apple-system, "Segoe UI", sans-serif';

export function fit(cv) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 600;
  // The intended CSS height is stashed on FIRST call and read from there after,
  // because assigning `cv.height` rewrites the height ATTRIBUTE — reading it
  // back on the next draw doubled the canvas every time it was redrawn.
  if (!cv.dataset.h) cv.dataset.h = String(Number(cv.getAttribute("height")) || 260);
  const h = Number(cv.dataset.h);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.height = h + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px " + FACE;
  return { ctx, w, h };
}

/** The nearest plotted point under the pointer, within a forgiving radius. */
export function hitTest(cv, ev, points) {
  const rect = cv.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  let best = null, bestD = 1e9;
  for (const pt of points) {
    const d = (pt.x - x) ** 2 + (pt.y - y) ** 2;
    if (d < bestD && d <= pt.r * pt.r * 2.2) { best = pt; bestD = d; }
  }
  return best;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/** Trim to fit AND SAY SO. A silent trim reads as the whole value — `SELF` was
 *  reporting "15 in the band · 2 pe" as if that were a sentence. */
export function clip(ctx, text, maxw) {
  const t = String(text);
  if (ctx.measureText(t).width <= maxw) return t;
  let cut = t;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > maxw) cut = cut.slice(0, -1);
  return cut.trimEnd() + "…";
}
export function wrapText(ctx, text, x, y, maxw, lh, maxLines) {
  const words = String(text).split(" ");
  let line = "", lines = 0;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxw && line) {
      ctx.fillText(line, x, y + lines * lh);
      lines += 1;
      line = word;
      if (lines >= maxLines) return;
    } else line = test;
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lh);
}
