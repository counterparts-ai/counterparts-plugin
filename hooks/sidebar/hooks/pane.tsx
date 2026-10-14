/**
 * The pane's tree, on every surface: the title (the header in `desktop.tsx`
 * places it), a paused folder's banner, the body, and the footer of
 * instructions. No `$`: the Pane hook in `register.tsx` reads the state and
 * builds the body (its `Client` tag must stay in the hooks module's own
 * source).
 *
 * v1 (the directory trim, 2026-10-14): nothing in the pane acts. No Button
 * runs a command or calls a tool: the intro row, the folder switch and its
 * confirm, and the view and avatar switches are gone; the footer says how to
 * do each instead (`words.ts#footerLines`). Nothing is a link either
 * (2026-10-14): COUNTERPARTS is its name, and the dashboard is
 * `/counterparts:dashboard`, which the footer says.
 */

import type { Elements } from 'claude-code'

import type { SidebarScope } from '../types'
import { shortDir } from './feed'
import { clip } from './sections'
import type { Line } from './sections'
import { P, bg } from './theme'
import { RESUME_SAY, footerLines } from './words'

/** The constructors the pane draws with: every surface has these. */
export type PaneEls = Pick<Elements['terminal'], 'Box' | 'Text'>

// ── the title, which the header places ──

/** COUNTERPARTS, plain text on every surface (no link, 2026-10-14). `lead` puts a dot before it. */
export function titleButton(els: PaneEls, o: { lead: boolean; paused: boolean; dot: string | null }): JSX.Element {
  const { Box, Text } = els
  const words = [
    ...(o.lead ? [<Text key="dot" color={o.dot ?? P.accentDim}>◉ </Text>] : []),
    <Text key="name" color={o.paused ? P.dim : P.accent} bold>COUNTERPARTS</Text>,
  ]
  return (
    <Box key="title" flexDirection="row">
      <Text>{words}</Text>
    </Box>
  )
}

// ── under the header ──

/** A paused (or off) folder says so before anything else in the pane: three rows, said, not pressed. */
export function pausedBanner(els: PaneEls, scope: SidebarScope, w: number): JSX.Element[] {
  const { Text } = els
  const off = scope.mode === 'off'
  const how = off
    ? scope.own ? 'ask Claude to turn it back on' : `off by ${shortDir(scope.setBy)}`
    : scope.own ? RESUME_SAY : `paused by ${shortDir(scope.setBy)}`
  return [
    <Text key="paused" color={P.accent2} bold>{clip(off ? '◌ Counterparts off here' : '⏸ Counterparts paused here', w)}</Text>,
    <Text key="paused-how" color={P.accent2}>{clip(how, w)}</Text>,
    <Text key="paused-gap"> </Text>,
  ]
}

// ── the footer: how to do what the pane doesn't ──

/** The footer's rows at `w` (`fit`: the cells its text may take, wider on a surface with its own font): a rule (or a blank) and the lines. */
export function footerRows(fit: number, paused = false): number {
  return 1 + footerLines(fit, paused).length
}

export function footer(els: PaneEls, s: { w: number; fit: number; prose: boolean; paused: boolean }): JSX.Element {
  const { Box, Text } = els
  const { w, fit, prose, paused } = s
  return (
    <Box key="footer" flexDirection="column" width={w}>
      {prose ? <Text> </Text> : <Text color={P.faint}>{'─'.repeat(w)}</Text>}
      {footerLines(fit, paused).map((l, i) => (
        <Text key={`f${String(i)}`}>
          <Text color={P.mid}>{l.label}</Text>
          {l.how === '' ? null : <Text color={P.hi}>{l.how}</Text>}
        </Text>
      ))}
    </Box>
  )
}

/** The body on a surface with no Client modules (mobile, an editor): the same lines, not clickable. */
export function plainBody(els: PaneEls, lines: readonly Line[]): JSX.Element {
  const { Box, Text } = els
  return (
    <Box key="body" flexDirection="column">
      {lines.map((l: Line, y: number) => (
        <Text key={`b${String(y)}`} color={l.segs[0]?.c ?? P.text}>{l.segs.map(s => s.t).join('') || ' '}</Text>
      ))}
    </Box>
  )
}

/**
 * The pane's frame: the rows in a column, the panel's colour behind them, at least as tall as the pane.
 * `top` (the fox's stage): rows above, the last of them (the stage) drawn edge to edge, outside the padding.
 */
export function frame(els: PaneEls, W: number, fill: number, rows: JSX.Element[], top: JSX.Element[] | null = null): JSX.Element {
  const { Box } = els
  if (top !== null && top.length > 0) {
    return (
      <Box flexDirection="column" width={W} minHeight={fill} {...bg(P.panel)}>
        <Box key="stage-head" flexDirection="column" paddingX={1}>{top.slice(0, -1)}</Box>
        {top[top.length - 1]}
        <Box key="stage-rest" flexDirection="column" paddingX={1} flexGrow={1}>{rows}</Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingX={1} width={W} minHeight={fill} {...bg(P.panel)}>
      {rows}
    </Box>
  )
}
