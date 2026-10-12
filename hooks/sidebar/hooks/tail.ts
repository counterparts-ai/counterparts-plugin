/**
 * The terminal's quiet tail: the newest thing, dim, after the engine's own
 * line under the prompt, while the pane is closed, ending with how to open
 * it. Pure: no `$`.
 */

import { humanDates } from './feed'
import { TRAIL, clip } from './sections'
import { cells, headCells } from './width'

/**
 * Cells the quiet tail leaves beside the `hint` prop, so the engine never
 * cuts the ` · /counterparts opens it` at its end. Measured at 160 columns
 * (Claude Code 2.1.296, term-loop): the engine draws its line two cells in,
 * joins the tail with ` · `, keeps three cells clear at the row's end, and
 * draws more than the prop holds: `⏸ manual mode on · ? for shortcuts · ←
 * for agents` (49 cells) for a prop about 30 wide, 19 cells more (auto mode's
 * line, 16 more). 2 + 3 + 3 + 19, and five to spare for a wider line.
 */
export const TAIL_SPARE = 32

// ── the quiet view's tail ────────────────────────────────────────────────────

/** What ends the quiet tail, always: the way back to the pane (the tail is dim text; it can't be clicked). */
export const TAIL_HINT = '/counterparts opens it'

/**
 * What ends the tail on the classic renderer, where the pane can only go
 * inline and nothing opens unasked: a plugin cannot change the `tui` setting,
 * so it suggests it (owner's onboarding trial, 2026-10-12).
 */
export const CLASSIC_HINT = '/tui fullscreen shows the memory sidebar'

/** The classic hint on a row too narrow for the whole of it (80 columns leaves about 33 cells). */
export const CLASSIC_HINT_SHORT = '/tui fullscreen'

/** `text` cut at a word, with an ellipsis, to at most `w` cells; whole when it fits; null when under a few words' room. */
export function clipWords(text: string, w: number): string | null {
  if (cells(text) <= w) return text
  if (w < 8) return null
  const cut = headCells(text, w - 1)
  const sp = cut.lastIndexOf(' ')
  const head = (text.slice(cut.length, cut.length + 1) === ' ' ? cut : sp > 0 ? cut.slice(0, sp) : '').replace(TRAIL, '')
  return head === '' ? null : `${head}…`
}

/**
 * The quiet view's tail under the prompt: the newest thing, shortened so the
 * hint after it is never cut (the engine cuts a tail where its row ends),
 * then ` · ` and the hint (`/counterparts opens it`, Mike, 2026-10-10; on the
 * classic screen `CLASSIC_HINT`). `room` is the cells the tail may take (the
 * row less the engine's own line), null when the surface says no width.
 * Nothing new yet: `Watching quietly · nothing new yet · …`. A save's own words (`body`)
 * follow its title after a dash, as much as the row holds, cut at a word.
 */
export function quietTail(latest: string | null, room: number | null, now: number, body?: string, wanted: string = TAIL_HINT): string {
  const hint = wanted === CLASSIC_HINT && room !== null && cells(CLASSIC_HINT) > room ? CLASSIC_HINT_SHORT : wanted
  const end = ` · ${hint}`
  if (latest === null) {
    const whole = `Watching quietly · nothing new yet${end}`
    return room !== null && cells(whole) > room ? hint : whole
  }
  const r = room ?? 45 + cells(end)
  if (r - cells(end) < 12) return hint
  const avail = r - cells(end)
  const head = clip(humanDates(latest, now), avail)
  // the title whole, then the memory's own words in what is left (no body under a clipped title)
  const more = body === undefined || head.endsWith('…') ? null : clipWords(body, avail - cells(head) - 3)
  return `${head}${more === null ? '' : ` — ${more}`}${end}`
}
