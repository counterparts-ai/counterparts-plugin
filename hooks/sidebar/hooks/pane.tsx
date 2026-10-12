/**
 * The pane's tree, on every surface: the title and the search box (each
 * view's header places them), a paused folder's banner, "Meet your
 * counterpart", the confirm row and a switch's note, the body, and the
 * footer's switches. No `$`: the Pane hook in `register.tsx` reads the state,
 * builds the body (its `Client` tag must stay in the hooks module's own
 * source) and hands each press here as a closure. The header is the view's:
 * `terminal.tsx` (the brain, a `Raster`) or `desktop.tsx` (no brain).
 */

import type { Elements } from 'claude-code'

import type { SidebarBrain, SidebarScope, SidebarView } from '../types'
import { shortDir, wrap } from './feed'
import { clip } from './sections'
import type { Line } from './sections'
import { HOVER_CP, searchFlag } from './state'
import { P } from './theme'
import { CONFIRM_FROM, scopeHover, switchAt } from './words'

/** The constructors the pane draws with: every surface has these three; `Input` all but mobile. */
export type PaneEls = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Input: Elements['terminal']['Input'] | null }

/** What a press does: closures the Pane hook makes over its `$`. */
export type PaneActions = {
  search: (value: string) => Promise<unknown>
  openDashboard: () => Promise<unknown>
  pressScope: (to: 'on' | 'paused' | 'off') => Promise<unknown>
  pressMeet: () => Promise<unknown>
  confirmChange: () => Promise<unknown>
  cancelPause: () => Promise<unknown>
  view: (v: SidebarView) => Promise<unknown>
  brain: (b: SidebarBrain) => Promise<unknown>
}

// ── the title and the search box, which each view's header places ──

/** The search box: a shade above the panel, a fainter `search` inside. Hidden (`searchFlag`): an empty box as wide. */
export function searchBox(els: PaneEls, actions: PaneActions, width: number): JSX.Element {
  const { Box, Text, Input } = els
  if (!searchFlag.on) return <Box key="search" width={width} />
  return (
    <Box key="search" flexDirection="row" width={width} backgroundColor={P.searchBg}>
      <Text color={P.mid} backgroundColor={P.searchBg}>⌕ </Text>
      <Box flexGrow={1}>
        {Input === null ? (
          <Text color={P.dim} backgroundColor={P.searchBg}>search</Text>
        ) : (
          <Input key="q" placeholder="search" value="" submitLabel="find" onSubmit={(value: string) => actions.search(value)} />
        )}
      </Box>
    </Box>
  )
}

/** COUNTERPARTS, a link to the dashboard; `lead` (the brainless header) puts a dot before it and `↗` after. */
export function titleButton(els: PaneEls, actions: PaneActions, o: { lead: boolean; paused: boolean; dot: string | null }): JSX.Element {
  const { Text, Button } = els
  return (
    <Button key="title" plain onPress={() => actions.openDashboard()}>
      {o.lead ? <Text color={o.dot ?? P.accentDim}>◉ </Text> : ''}
      <Text color={o.paused ? P.dim : P.accent} bold>COUNTERPARTS</Text>
      {o.lead ? <Text color={P.accentDim}> ↗</Text> : ''}
    </Button>
  )
}

// ── under the header ──

/** A paused (or off) folder says so before anything else in the pane: three rows. */
export function pausedBanner(els: PaneEls, actions: PaneActions, scope: SidebarScope, w: number): JSX.Element[] {
  const { Text, Button } = els
  const off = scope.mode === 'off'
  return [
    <Text key="paused" color={P.accent2} bold>{clip(off ? '◌ Counterparts off here' : '⏸ Counterparts paused here', w)}</Text>,
    <Button key="resume-banner" plain onPress={() => actions.pressScope('on')}>
      <Text color={P.accent2} underline>
        {clip(off ? (scope.own ? 'click to turn it back on' : `off by ${shortDir(scope.setBy)} · why`) : scope.own ? 'click to resume' : `paused by ${shortDir(scope.setBy)} · how to resume`, w)}
      </Text>
    </Button>,
    <Text key="paused-gap"> </Text>,
  ]
}

/** The first meeting, put off or not finished: one cyan row at the top of the body, and a blank one. */
export function meetRow(els: PaneEls, actions: PaneActions, w: number): JSX.Element[] {
  const { Text, Button } = els
  return [
    <Button key="meet" plain onPress={() => actions.pressMeet()}>
      <Text color={P.accent} bold>{clip('Start the 5-minute intro', w)}</Text>
    </Button>,
    <Text key="meet-gap"> </Text>,
  ]
}

/** What the switches say, above them: the pause (or off, or on) confirm, a note. */
export function aboveSwitches(
  els: PaneEls,
  actions: PaneActions,
  s: { scope: SidebarScope; pauseAsk: { dir: string; to?: 'pause' | 'off' | 'on' } | null; note: { text: string } | null; w: number },
): JSX.Element[] {
  const { Box, Text, Button } = els
  const { scope, pauseAsk, note, w } = s
  const above: JSX.Element[] = []
  const askTo = pauseAsk?.to ?? 'pause'
  if (pauseAsk !== null && scope.mode !== 'unknown' && CONFIRM_FROM[askTo].includes(scope.mode)) {
    const where = shortDir(pauseAsk.dir)
    const ask =
      askTo === 'off'
        ? `Turn Counterparts memory off in ${where} for every session here? Nothing is kept or recalled while it's off.`
        : askTo === 'on'
          ? scope.mode === 'off'
            ? `Turn memory back on in ${where}? Nothing from while it was off was kept.`
            : `Turn memory fully on in ${where}? New memories will be kept here, for every session.`
          : `Pause Counterparts memory in ${where} for every session here?`
    wrap(ask, w).forEach((l, i) => above.push(<Text key={`ask${String(i)}`} color={P.accent2}>{l}</Text>))
    above.push(
      <Box key="pause-ask" flexDirection="row">
        <Button key={`confirm-${askTo}`} onPress={() => actions.confirmChange()}>{askTo === 'off' ? 'Turn off' : askTo === 'on' ? 'Turn on' : 'Pause'}</Button>
        <Text> </Text>
        <Button key="cancel-pause" onPress={() => actions.cancelPause()}>Cancel</Button>
      </Box>,
    )
  }
  if (note !== null) wrap(note.text, w).forEach((l, i) => above.push(<Text key={`note${String(i)}`} color={P.text}>{l}</Text>))
  if (above.length > 0) above.push(<Text key="above-gap"> </Text>)
  return above
}

// ── the footer: each dot and its word one hit target ──

export function footer(
  els: PaneEls,
  actions: PaneActions,
  s: { scope: SidebarScope; w: number; view: SidebarView; mode: SidebarBrain; cards: boolean },
): JSX.Element {
  const { Box, Text, Button } = els
  const { scope, w, mode, cards } = s
  const dotWord = (key: string, isOn: boolean, word: string, onPress: () => Promise<unknown>, dot?: string, dim = false, lit: string = P.accent) => (
    <Button key={key} plain onPress={onPress}>
      <Text color={isOn && !dim ? lit : P.dim}>{dot ?? (isOn ? '●' : '○')}</Text>
      <Text color={isOn && !dim ? P.hi : P.dim}>{` ${word}`}</Text>
    </Button>
  )
  // The Counterparts switch, three-way: `on` (◐ for reads-only), `paused` and `off` (amber, a warning, as
  // the status line says it). Unknown: every dot `?` and dim, never one lit; `…` while a press is answered.
  const at = switchAt(scope.mode)
  const cpDot = (pos: 'on' | 'paused' | 'off'): string => {
    if (at === null) return scope.busy ? '…' : '?'
    if (pos !== at) return '○'
    if (scope.busy) return '…'
    return pos === 'on' && scope.mode === 'observer' ? '◐' : '●'
  }
  // `Counterparts ● on ○ paused ○ off` is 32 cells, the docked pane's text width; narrower, a shorter word.
  const cpLabel = w >= 32 ? 'Counterparts' : 'memory'
  // What a click on the Counterparts switch does, over the two rows above the footer while hovered: nothing moves under the pointer.
  const hoverCard = (key: string, group: string, text: string) => (
    <Box key={key} position="absolute" top={-2} left={0} width={w} height={2} display="none" hover={{ display: 'flex', scope: group }} flexDirection="column" backgroundColor={P.panel}>
      {wrap(text, w)
        .slice(0, 2)
        .map((l, i) => (
          <Text key={`${key}${String(i)}`} color={P.mid}>{l}</Text>
        ))}
    </Box>
  )
  const viewNow = s.view
  return (
    <Box key="footer" flexDirection="column" width={w}>
      {cards ? hoverCard('cp-why', HOVER_CP, scopeHover(scope)) : null}
      <Text color={P.faint}>{'─'.repeat(w)}</Text>
      <Box key="row-cp" flexDirection="row" hover={{ scope: HOVER_CP }}>
        <Text color={P.mid}>{cpLabel}</Text>
        {(['on', 'paused', 'off'] as const).map(pos => (
          <Box key={`cp-${pos}-box`} flexDirection="row">
            <Text> </Text>
            {dotWord(`cp-${pos}`, at === pos, pos, () => actions.pressScope(pos), cpDot(pos), at === null, pos === 'on' ? P.accent : P.accent2)}
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        <Text color={P.mid}>view</Text>
        {(['sidebar', 'quiet'] as const).map(v => (
          <Box key={`v-${v}`} flexDirection="row">
            <Text> </Text>
            {dotWord(`view-${v}`, viewNow === v, v, () => actions.view(v))}
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        <Text color={P.mid}>avatar</Text>
        {([['turning', 'brain'], ['fox', 'animal'], ['off', 'off']] as const).map(([b, word]) => (
          <Box key={`b-${b}`} flexDirection="row">
            <Text> </Text>
            {/* The brain is one dot, turning or still: a press on it keeps whichever it was. */}
            {dotWord(`brain-${b}`, mode === b || (b === 'turning' && mode === 'still'), word, () => actions.brain(b === 'turning' && mode === 'still' ? 'still' : b))}
          </Box>
        ))}
      </Box>
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
      <Box flexDirection="column" width={W} minHeight={fill} backgroundColor={P.panel}>
        <Box key="stage-head" flexDirection="column" paddingX={1}>{top.slice(0, -1)}</Box>
        {top[top.length - 1]}
        <Box key="stage-rest" flexDirection="column" paddingX={1} flexGrow={1}>{rows}</Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingX={1} width={W} minHeight={fill} backgroundColor={P.panel}>
      {rows}
    </Box>
  )
}
