/**
 * The header, on every surface and with the avatar on or off: a dot before
 * the title, lit in the stage colour of whatever fires; the count and the day
 * on the right. With the fox up, the stage follows it (`register.tsx`). Two
 * rows: the title row, then a blank row. No `$`.
 *
 * (Until v1, 2026-10-14, the terminal could draw a braille brain beside the
 * title instead; it is gone, and this header is the only one.)
 */

import type { MechId } from './mechanisms'
import { hex, stageOf } from './mechanisms'
import { titleButton } from './pane'
import type { PaneEls } from './pane'
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
 * The header's `◉` while something fires: the mechanism's stage colour, but
 * never Retrieval's amber, which in this pane says only a warning (Mike,
 * 2026-10-10): cyan then.
 */
export function litDot(id: MechId): string {
  const st = stageOf(id)
  return st.id === 'retrieval' ? P.accent : hex(st.col, 0.95)
}

/** The header and the blank row under it: two rows. */
export function header(
  els: PaneEls,
  s: { w: number; paused: boolean; lit: MechId | null; day: number | null; count: string },
): JSX.Element[] {
  const { Box, Text } = els
  const { w } = s
  return [
    <Box key="head1" flexDirection="row" justifyContent="space-between" width={w}>
      {titleButton(els, { lead: true, paused: s.paused, dot: s.lit === null ? null : litDot(s.lit) })}
      <Text color={P.dim}>{headRight(s.day, s.count, w)}</Text>
    </Box>,
    <Text key="head-gap"> </Text>,
  ]
}
