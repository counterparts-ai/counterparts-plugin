/**
 * The terminal view: the small braille brain beside the title (a `Raster`,
 * which only the terminal has), its frame rate, what it shows besides its
 * turning, and the header it sits in. The timer that drives it calls `$`, so
 * it stays in `register.tsx`; everything here is the module's own, no `$`.
 * The rest of the terminal view: `brain.ts` (the brain itself), `cells.ts`
 * (a Raster's cells), `width.ts` (cells a string takes) and `tail.ts` (the
 * quiet tail under the prompt).
 */

import type { Elements } from 'claude-code'

import type { SidebarBrain } from '../types'
import { Brain } from './brain'
import { encodeCells } from './cells'
import { mechById, stageOf } from './mechanisms'
import type { MechId } from './mechanisms'
import { searchBox, titleButton } from './pane'
import type { PaneActions, PaneEls } from './pane'
import { run } from './state'
import { P } from './theme'
import { cells } from './width'

/** The brain beside the title, in cells. */
export const BRAIN_COLS = 18

export const BRAIN_ROWS = 6

/** The header's right column starts this far in: the brain and two blank columns. */
export const HEAD_X = BRAIN_COLS + 2

/** "Dim at rest": what is not lit draws at this brightness, so a lit region stands out (the mockups' 0.72). */
export const DIM_REST = 0.72

/** The most the turning brain draws a second: a pulse's arc. Swaying it draws every other tick (`Brain.calmFps`), and at rest none. */
export const DEFAULT_FPS = 12

// ── the module's own (a reload starts these over; the host keeps the state) ──

export const brain = new Brain()

/** The Raster the terminal last mounted: a blit must match its size. */
export const raster = { cols: 0, rows: 0, live: false, cells: '', look: '' }

/** What the brain shows besides its turning, refreshed by each drawing. */
export const look = { mono: false, still: false, sel: null as MechId | null, firing: [] as readonly MechId[] }

export const fps = {
  target: DEFAULT_FPS,
  inFlight: false,
  lastTick: 0,
  /** `performance.now()` of each blit the surface took: the measurement. */
  blits: [] as number[],
  frameMs: [] as number[],
}

export function achievedFps(): number {
  const now = performance.now()
  const recent = fps.blits.filter(t => now - t < 10000)
  if (recent.length < 2) return 0
  const span = (recent[recent.length - 1] ?? 0) - (recent[0] ?? 0)
  return span <= 0 ? 0 : ((recent.length - 1) * 1000) / span
}

export function meanFrameMs(): number {
  if (fps.frameMs.length === 0) return 0
  return fps.frameMs.reduce((a, b) => a + b, 0) / fps.frameMs.length
}

export function paceWords(mode: SidebarBrain): string {
  if (mode === 'off') return 'off (no brain, no timer)'
  if (mode === 'still') return 'still (no timer; one frame when something fires, one when it goes out)'
  if (run.brainTimer === null) return run.brainPace === 'rest' ? 'at rest (no timer)' : 'stopped'
  return run.brainPace === 'burst' ? `in a burst (${String(fps.target)} fps)` : `swaying (${(1000 / paceMs('calm')).toFixed(0)} fps)`
}

export function fpsReport(mode: SidebarBrain): string {
  if (fps.blits.length < 2) {
    return `Brain: no frames measured yet (target ${String(fps.target)} fps), now ${paceWords(mode)}. It draws only while the sidebar shows in a terminal and something moves; ask again in a few seconds.`
  }
  return `Brain: ${achievedFps().toFixed(1)} fps achieved over the last 10 s (target ${String(fps.target)}), now ${paceWords(mode)}; a frame takes ${meanFrameMs().toFixed(2)} ms to compute.`
}

/** What the brain shows besides its turning: a frame drawn under another look is not reused. */
export function lookKey(): string {
  return `${String(look.mono)}|${String(look.still)}|${look.sel ?? ''}|${look.firing.join(',')}`
}

export function frameCells(cols: number, rows: number, now: number): string {
  if (look.still) {
    // The still brain: a fixed view, lit only while something fires (or a mechanism is opened).
    brain.dark()
    for (const id of new Set([...look.firing, ...(look.sel === null ? [] : [look.sel])])) {
      const m = mechById(id)
      if (m !== undefined && !look.mono) brain.flash(m.region, stageOf(m.id).col)
    }
  } else if (look.sel !== null) {
    const m = mechById(look.sel)
    if (m !== undefined) brain.light(m.region, stageOf(m.id).col)
  }
  const t0 = performance.now()
  const cells = encodeCells(brain.frame(cols, rows, now, { mono: look.mono, tag: null, bg: null, dimRest: DIM_REST }))
  fps.frameMs.push(performance.now() - t0)
  if (fps.frameMs.length > 120) fps.frameMs.shift()
  return cells
}

export function fireBrain(mech: MechId, now: number): void {
  const m = mechById(mech)
  if (m === undefined || look.mono || look.still) return
  brain.pulse(m.region, stageOf(m.id).col, now, mech === 'retrieval' ? 'prefrontal' : 'thalamus')
}

/** The timer's interval for a pace: every frame of the target while an arc flies, the calm rate while it sways. */
export function paceMs(pace: 'burst' | 'calm'): number {
  const every = pace === 'burst' ? 1 : Math.max(1, Math.round(fps.target / brain.calmFps))
  return Math.max(16, Math.round((every * 1000) / fps.target))
}

// ── the header with the brain ──

/**
 * The terminal's header: the brain (a `Raster`, reusing the last frame while
 * its look is the same) and beside it the title, the day, the count and the
 * search box; then a blank row. BRAIN_ROWS + 1 rows.
 */
export function brainHeader(
  els: PaneEls,
  Raster: Elements['terminal']['Raster'],
  actions: PaneActions,
  s: { w: number; paused: boolean; day: number | null; count: string },
): JSX.Element[] {
  const { Box, Text } = els
  const { w } = s
  const countText = s.count
  // From 1,000 memories the count (`1000 memories`, 13 cells) is one wider than the header's text column:
  // the column takes one cell of the gap beside the brain, every row of it, so the header stays six rows.
  const gap = cells(countText) > w - HEAD_X ? 1 : 2
  const headW = w - BRAIN_COLS - gap
  const reuse = raster.cols === BRAIN_COLS && raster.rows === BRAIN_ROWS && raster.cells !== '' && raster.look === lookKey()
  const cells0 = reuse ? raster.cells : frameCells(BRAIN_COLS, BRAIN_ROWS, Date.now())
  raster.cols = BRAIN_COLS
  raster.rows = BRAIN_ROWS
  raster.cells = cells0
  raster.look = lookKey()
  raster.live = true
  return [
    <Box key="head" flexDirection="row" width={w}>
      <Raster key="brain" columns={BRAIN_COLS} rows={BRAIN_ROWS} cells={cells0} />
      <Box width={gap} />
      <Box flexDirection="column" width={headW}>
        <Text> </Text>
        {titleButton(els, actions, { lead: false, paused: s.paused, dot: null })}
        <Text> </Text>
        <Text color={P.dim}>{s.day === null ? ' ' : `day ${String(s.day)}`}</Text>
        <Text color={P.dim}>{s.day === null ? ' ' : countText}</Text>
        {searchBox(els, actions, headW)}
      </Box>
    </Box>,
    <Text key="head-gap"> </Text>,
  ]
}
