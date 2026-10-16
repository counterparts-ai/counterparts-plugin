/**
 * WHAT ONLY THE FULL PLUGIN'S SIDEBAR DOES (2026-10-16), a hooks module of its
 * own beside `register.tsx`, like `speak-first.tsx`: `full.tsx` registers it,
 * the plugin directory's build never loads it (its module is `register.tsx`
 * alone), so none of this is in that build.
 *
 * The directory trim (2026-10-14) took everything that acts out of the shared
 * sidebar. These come back in the full build only, each acting as little as it
 * can:
 *
 *   - "Meet your counterpart", at the top of the body while core says the
 *     first meeting is not done or skipped: a click puts `/counterparts:meet`
 *     in the prompt box (`$.prompt.fill`), and the person presses Enter. Only
 *     into an empty box: a draft stays as it is, and the row says so; so does
 *     a box that would not take it (a dialog up).
 *     Terminal only, like the next: on the desktop `$.prompt.fill` may refuse
 *     (`no_composer`), unmeasured, so there the footer says the commands.
 *   - The footer's Dashboard line, the same way: a click puts
 *     `/counterparts:dashboard` in the prompt box (it starts the dashboard, or
 *     opens the browser on one already serving this store).
 *   - COUNTERPARTS ↗ on the terminal, a `Link` to the dashboard: the address
 *     is core's (`sidebar.json`'s `dashboard`, `src/adapters/sidebar-status.ts`),
 *     never built here, and drawn only when it names this machine. The desktop
 *     draws a link that is not https as plain text, so there the title stays
 *     words and the Dashboard line is the way.
 *   - The view and avatar switches in the footer, store-only: a click on
 *     `view` closes the pane to quiet; on `avatar`, the fox or none
 *     (`register.tsx#setSwitch`: `$.store.set` of `view` / `brain`, as
 *     `/counterparts quiet` and `/counterparts avatar` do). The brain is not
 *     back.
 *
 * Nothing here runs a command, calls a tool or submits a prompt. The rows are
 * lines of the body's surface module (`body.tsx`), clicked as every row is
 * (the engine's Buttons invert under the pointer, NOTES), posted as
 * `{ click: 'fill:…' }`; this module's one hook answers those, and is
 * registered before the sidebar so it is the outer one on `ui.message` (the
 * sidebar's answers every other click without passing it on).
 */

import type { Elements, EngineInterface, Register } from 'claude-code'

import { canMeet } from './feed'
import type { FullPane, TitleLink } from './pane'
import { clip } from './sections'
import type { Line, Seg } from './sections'
import { FILL_NOTE_MS, quiet, run } from './state'
import { P } from './theme'
import { cells } from './width'
import { footerLines } from './words'

/** What a click puts in the prompt box, by the key its row posts. */
export const FILLS: Readonly<Record<string, string>> = {
  'fill:meet': '/counterparts:meet',
  'fill:dash': '/counterparts:dashboard',
}

export const MEET_ROW = 'Meet your counterpart'

/**
 * Only the address core writes is drawn as a link (`sidebar-status.ts#dashboardUrl`): 127.0.0.1 on
 * a port, 1 to 65535. Anything else in the file draws the plain title.
 */
const DASHBOARD_AT = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/

function isDashboardAddress(href: string): boolean {
  const m = DASHBOARD_AT.exec(href)
  return m !== null && Number(m[1]) <= 65535
}

// ── the engine, through `$` (a click's command, put in the prompt box) ─────

/** Why the box did not take it, drawn under the row that was clicked until FILL_NOTE_MS passes. */
async function noteFor($: EngineInterface, key: string, text: string | null): Promise<void> {
  run.fillNote = text === null ? null : { key, text, at: await $.clock.now() }
  $.ui.invalidate('ui.render')
  if (text !== null) $.clock.after(FILL_NOTE_MS + 50, () => $.ui.invalidate('ui.render'))
}

/**
 * The command into the prompt box, for the person to send: only into an empty box (a slash command
 * goes at the start of a prompt, and a draft is the person's). Never submitted from here. Appended,
 * not replaced: on an empty box the same, and a draft typed between the read and the fill is never
 * wiped (the box then holds more than the command, and the note says so).
 */
async function fillPrompt($: EngineInterface, key: string, command: string): Promise<void> {
  const draftNote = `Your draft is in the prompt box: send or clear it, then click again (or type ${command}).`
  const box = await $.prompt.read()
  const draft = box.text.trim()
  if (draft === command) return noteFor($, key, null)
  if (draft !== '') return noteFor($, key, draftNote)
  const r = await $.prompt.fill({ text: command, mode: 'append' })
  if (r.isFilled) {
    if (r.text.trim() !== command) return noteFor($, key, draftNote)
    if (key === 'fill:meet') run.meetFilledIn = run.session
    return noteFor($, key, null)
  }
  return noteFor($, key, r.refusal === 'dialog' ? 'A dialog is open: close it, then click again.' : `The prompt box did not take it: type ${command}`)
}

// ── the pane's pieces (no `$`) ──────────────────────────────────────────────

/**
 * Whether the sidebar shows "Meet your counterpart" (as v0.2's "Start the 5-minute intro"): core
 * says the meeting never started (`not_started`), was put off (`later`), or was offered and not
 * finished (`offered`). Not once a meeting has begun in this very session, for `not_started` or
 * `offered`: its speak-first went out here (`firedIn`, the mark `speak-first.tsx` writes), or a click
 * on the row put `/counterparts:meet` in the box here (`filledIn`). Never in a folder where the
 * meeting can't keep anything (`canMeet`), and never for an unknown state.
 */
export function meetShows(meet: string, folderMode: string, firedIn: string | null, session: string, filledIn: string | null = null): boolean {
  if (!canMeet(folderMode)) return false
  const begunHere = session !== '' && (firedIn === session || filledIn === session)
  if (meet === 'not_started' || meet === 'offered') return !begunHere
  return meet === 'later'
}

/** COUNTERPARTS as a link to the dashboard: only to an address on this machine. */
export function titleLink(els: Pick<Elements['terminal'], 'Link'>, href: string | null): TitleLink {
  if (href === null || !isDashboardAddress(href)) return null
  const { Link } = els
  return (words: JSX.Element[]) => <Link href={href}>{words}</Link>
}

/** A note, word-wrapped to `w`, on the lines of the row it is about (a click on it is that row's). */
function noteLines(note: string, w: number, key: string): Line[] {
  const out: Line[] = []
  let cur = ''
  for (const word of note.split(/\s+/).filter(Boolean)) {
    if (cur !== '' && [...`${cur} ${word}`].length > w) {
      out.push({ segs: [{ t: clip(cur, w), c: P.accent2 }], key })
      cur = word
    } else cur = cur === '' ? word : `${cur} ${word}`
  }
  if (cur !== '') out.push({ segs: [{ t: clip(cur, w), c: P.accent2 }], key })
  return out
}

/** The Meet row, a note under it when the box did not take the command, and a blank row. */
export function meetLines(w: number, note: string | null): Line[] {
  return [
    { segs: [{ t: clip(MEET_ROW, w), c: P.accent, b: true }], key: 'fill:meet' },
    ...(note === null ? [] : noteLines(note, w, 'fill:meet')),
    { segs: [] },
  ]
}

/** Pieces cut to `w` cells: a row wider than its box would wrap and move every row under it off its click. */
function fitSegs(segs: readonly Seg[], w: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const s of segs) {
    if (used >= w) break
    const t = cells(s.t) <= w - used ? s.t : clip(s.t, w - used)
    out.push({ ...s, t })
    used += cells(t)
  }
  return out
}

/**
 * One switch: `view ● sidebar ○ quiet`, the one that is on lit; a click on the row turns it to the other.
 * Narrower than that (an inline pane), the label goes first, then the words are cut.
 */
function switchLine(label: string, opts: readonly [string, string][], on: string, key: string, w: number): Line {
  const dots: Seg[] = []
  for (const [value, word] of opts) {
    const lit = value === on
    dots.push({ t: ' ', c: P.mid })
    dots.push({ t: lit ? '●' : '○', c: lit ? P.accent : P.dim })
    dots.push({ t: ` ${word}`, c: lit ? P.hi : P.dim })
  }
  const whole: Seg[] = [{ t: label, c: P.mid }, ...dots]
  const width = (ss: readonly Seg[]): number => ss.reduce((n, s) => n + cells(s.t), 0)
  return { segs: width(whole) <= w ? whole : fitSegs(dots.slice(1), w), key }
}

/**
 * The full build's footer: the rule (a blank row on the desktop), the instructions as the
 * directory's footer says them less the hide line (the view switch does it), and the intro only
 * while `intro` (the meeting waits but the Meet row is not drawn: core's state unknown, a folder
 * paused), the Dashboard line clickable, then the view and avatar switches.
 */
export function footLines(s: { fit: number; w: number; prose: boolean; paused: boolean; view: string; avatar: string; note: string | null; intro: boolean; fills: boolean }): Line[] {
  const out: Line[] = [s.prose ? { segs: [] } : { segs: [{ t: '─'.repeat(s.w), c: P.faint }] }]
  for (const l of footerLines(s.fit, s.paused, { intro: s.intro, fox: false, hide: false })) {
    const segs: Seg[] = [...(l.label === '' ? [] : [{ t: l.label, c: P.mid }]), ...(l.how === '' ? [] : [{ t: l.how, c: P.hi }])]
    const key = s.fills && l.of === FILLS['fill:dash'] ? 'fill:dash' : undefined
    out.push(key === undefined ? { segs } : { segs, key })
  }
  if (s.note !== null) out.push(...noteLines(s.note, s.fit, 'fill:dash'))
  out.push(switchLine('view', [['sidebar', 'sidebar'], ['quiet', 'quiet']], s.view === 'quiet' ? 'quiet' : 'sidebar', s.view === 'quiet' ? 'set:view:sidebar' : 'set:view:quiet', s.w))
  out.push(switchLine('avatar', [['fox', 'animal'], ['off', 'off']], s.avatar === 'off' ? 'off' : 'fox', s.avatar === 'off' ? 'set:avatar:fox' : 'set:avatar:off', s.w))
  return out
}

export const FULL_PANE: FullPane = { titleLink, meetShows, meetLines, footLines }

// ── the hook ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  // The pane draws these pieces from here on (`state.ts#run.full`): this registration is what turns them on.
  run.full = FULL_PANE
  run.fillNote = null
  // A click on a row that puts a command in the prompt box. Answered here, never passed on.
  on('ui.message', { data: { click: ['fill:meet', 'fill:dash'] } }, async ($, e) => {
    const key = (e.data as { click?: unknown } | null)?.click
    const command = typeof key === 'string' ? FILLS[key] : undefined
    // Off the hook's own path: the fill goes through the other plugins' prompt.fill hooks.
    if (typeof key === 'string' && command !== undefined) $.clock.after(0, () => quiet(fillPrompt($, key, command)))
    return {}
  })
}
