/**
 * The desktop view, and any surface with no `Raster`: the header without the
 * brain. Its place is a dot before the title, lit in the stage colour of
 * whatever fires; the terminal draws this same header when the brain is set
 * off. Two rows: the title with the count and the day, then a blank row.
 * No `$`.
 */

import type { MechId } from './mechanisms'
import { hex, stageOf } from './mechanisms'
import { titleButton } from './pane'
import type { PaneActions, PaneEls } from './pane'
import { P, SURFACE } from './theme'
import { cells } from './width'

/** The title row's cells: `◉ COUNTERPARTS ↗`. */
const TITLE_CELLS = 16

/**
 * What the title row says on its right: the memories and the day on one line (Mike, 2026-10-13: "save a
 * line"), shortened to what fits beside the title: `1511 memories · day 22`, `1511 · day 22`, `day 22`.
 * A surface with its own font fits about a fifth more than its cells say.
 */
export function headRight(day: number | null, count: string, w: number): string {
  const room = Math.floor((w - TITLE_CELLS - 1) * (SURFACE.prose ? 1.2 : 1))
  const d = day === null ? '' : `day ${String(day)}`
  const n = count.replace(/ memories?$/, '')
  for (const t of [[count, d], [n, d], [d]]) {
    const s = t.filter(x => x !== '').join(' · ')
    if (cells(s) <= room) return s
  }
  return d
}

/**
 * The brain-off header's `◉` while something fires: the mechanism's stage
 * colour, but never Retrieval's amber, which in this pane says only a warning
 * (Mike, 2026-10-10): cyan then.
 */
export function litDot(id: MechId): string {
  const st = stageOf(id)
  return st.id === 'retrieval' ? P.accent : hex(st.col, 0.95)
}

/** The brainless header and the blank row under it: two rows. */
export function brainlessHeader(
  els: PaneEls,
  actions: PaneActions,
  s: { w: number; paused: boolean; lit: MechId | null; day: number | null; count: string },
): JSX.Element[] {
  const { Box, Text } = els
  const { w } = s
  return [
    <Box key="head1" flexDirection="row" justifyContent="space-between" width={w}>
      {titleButton(els, actions, { lead: true, paused: s.paused, dot: s.lit === null ? null : litDot(s.lit) })}
      <Text color={P.dim}>{headRight(s.day, s.count, w)}</Text>
    </Box>,
    <Text key="head-gap"> </Text>,
  ]
}
