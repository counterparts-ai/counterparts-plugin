/**
 * The desktop's fox: the PNG frame inside an SVG document, the desktop's one
 * picture element (`Svg`, drawn as an image, so the document needs its
 * namespace). A file of its own: it draws, and reads nothing.
 */

import { FOX_FINAL } from './fox-art'
import { HALF_X0, STAGE_COLS, halfPixels, hex6, stageRows } from './fox'
import type { Step } from './fox'

/** CSS pixels a half-block pixel takes on the desktop. */
export const SVG_PX = 6

/** The desktop's drawing: rects from the half-block pixels, run-length per row, then the PNG (`png`, base64; '' for none) over them. */
export function foxSvg(step: Pick<Step, 'frame' | 'fx'>, png: string): { source: string; width: number; height: number } {
  const cols = STAGE_COLS
  const H = stageRows('basic') * 2
  const px = halfPixels(step, cols)
  const rects: string[] = []
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < cols) {
      const c = px[y * cols + x] ?? null
      if (c === null) {
        x++
        continue
      }
      let n = 1
      while (x + n < cols && px[y * cols + x + n] === c) n++
      rects.push(`<rect x="${String(x)}" y="${String(y)}" width="${String(n)}" height="1" fill="${hex6(c)}"/>`)
      x += n
    }
  }
  // The PNG's box over the half-block fox's (the art lines both up: the same footprint, feet on the bottom line).
  const [bw, bh] = FOX_FINAL.half.box
  const image = png === '' ? '' : `<image x="${String(HALF_X0)}" y="${String(H - bh)}" width="${String(bw + 2)}" height="${String(bh)}" preserveAspectRatio="xMidYMax meet" style="image-rendering:pixelated" href="data:image/png;base64,${png}"/>`
  // The picture alone when there is one: the half-block fox under it showed as a dark ghost edge on the
  // desktop's light page (2026-10-13); it stays only as the fallback for a frame with no PNG.
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(cols)} ${String(H)}" shape-rendering="crispEdges">${image === '' ? rects.join('') : image}</svg>`
  return { source, width: cols * SVG_PX, height: H * SVG_PX }
}
