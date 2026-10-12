/**
 * The desktop view, and any surface with no `Raster`: the header without the
 * brain. Its place is a dot before the title, lit in the stage colour of
 * whatever fires; the terminal draws this same header when the brain is set
 * off. Two rows: the title and the day, then the search box and the count.
 * No `$`.
 */

import type { MechId } from './mechanisms'
import { hex, stageOf } from './mechanisms'
import { searchBox, titleButton } from './pane'
import type { PaneActions, PaneEls } from './pane'
import { P } from './theme'

/**
 * The brain-off header's `◉` while something fires: the mechanism's stage
 * colour, but never Retrieval's amber, which in this pane says only a warning
 * (Mike, 2026-10-10): cyan then.
 */
export function litDot(id: MechId): string {
  const st = stageOf(id)
  return st.id === 'retrieval' ? P.accent : hex(st.col, 0.95)
}

/** The brainless header and the blank row under it: three rows. */
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
      <Text color={P.dim}>{s.day === null ? '' : `day ${String(s.day)}`}</Text>
    </Box>,
    <Box key="head2" flexDirection="row" justifyContent="space-between" width={w}>
      {searchBox(els, actions, 14)}
      <Text color={P.dim}>{s.count}</Text>
    </Box>,
    <Text key="head-gap"> </Text>,
  ]
}
