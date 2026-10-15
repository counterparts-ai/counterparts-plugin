/**
 * What the sidebar says, worked out with no `$` (shared core, no drawing):
 * the stored view and avatar read from any version, the status line, what
 * `/counterparts resume` says, the footer's instructions, the tail's words
 * for what happened, an opened memory's meta line, and the first meeting's
 * once-only mark.
 */

import type { SidebarAvatar, SidebarSaved, SidebarScope, SidebarView } from '../types'
import { shortDay, shortDir } from './feed'

/** Nothing is remembered and nothing comes to mind: paused for now, or set off. */
export function isPaused(mode: string): boolean {
  return mode === 'paused' || mode === 'off'
}

/**
 * A stored view, from any version: v0.1's `full` is the sidebar; its `quiet`
 * (a narrow pane), `rail` and `hidden`, and v0.2's first `strip` (one line
 * above the prompt, dropped 2026-10-10), are quiet (no pane, the tail). Read
 * so, never written back: a v0.1 copy reading the same store keeps its word.
 */
export function normView(v: unknown): SidebarView {
  return v === 'quiet' || v === 'rail' || v === 'hidden' || v === 'strip' ? 'quiet' : 'sidebar'
}

/**
 * The avatar as stored: `off` stays; anything else is the fox, including the
 * brain (`turning`, `still`) an older version stored, which v1 no longer draws.
 */
export function normAvatar(v: unknown): SidebarAvatar {
  return v === 'off' ? 'off' : 'fox'
}

/**
 * The status line: only a warning. A folder paused or off says so in every
 * session there, whatever the view (`⚠ counterparts:` and amber are the
 * engine's); the normal case has no status line at all (v0.2).
 */
export function statusFor(scope: SidebarScope): string | undefined {
  if (!isPaused(scope.mode)) return undefined
  const parts =
    scope.mode === 'paused'
      ? ['⏸ Counterparts memory paused in this folder', scope.own ? RESUME_SAY : `resume it in ${shortDir(scope.setBy)}`]
      : ['◌ Counterparts memory off in this folder']
  return parts.join(' · ')
}

/** An opt-in written in the environment: `1`, `true`, `yes` or `on`. */
export function truthy(v: string | undefined): boolean {
  return v !== undefined && /^(1|true|yes|on)$/i.test(v.trim())
}

/**
 * The header's count, whole: `1000 memories` (13 cells, the header's text
 * column widened by one for it). From 10,000, `10k+ memories`, still 13: the
 * exact number is on the dashboard.
 */
export function memoriesCount(n: number): string {
  return n >= 10000 ? `${String(Math.floor(n / 1000))}k+ memories` : `${String(n)} memories`
}

/** The newest thing in plain words, for the tail. */
export function words(kind: 'remembered' | 'subconscious' | 'stored' | 'opened' | 'dreamed', what: string): string {
  return `${kind}: ${what}`
}

/** What the tail says of a save: `Stored “title”` (the quotes keep a title's own `Answered:` from doubling the lead), or `Stored 2 memories, the first “title”`. */
export function storedWords(title: string, count = 1): string {
  return count > 1 ? `Stored ${String(count)} memories, the first “${title}”` : `Stored “${title}”`
}

/** What a save wrote beyond its title, for the tail; none when the title was cut from the text itself. */
export function bodyOf(s: SidebarSaved): string | undefined {
  return s.text === undefined || s.text.startsWith(s.title) ? undefined : s.text
}

/** The memory text an opened item shows, and the line saying what it is. */
export function memoryMeta(d: { kind?: unknown; learnedOn?: unknown; journal?: unknown }): string | null {
  const kind = d.journal === true ? 'journal' : typeof d.kind === 'string' ? d.kind : null
  // `Oct 9`, with the year only when it is not this one.
  const thisYear = String(new Date().getFullYear())
  const learned = typeof d.learnedOn === 'string' ? shortDay(d.learnedOn.startsWith(`${thisYear}-`) ? d.learnedOn.slice(5) : d.learnedOn) : ''
  if (kind === null) return null
  return learned === '' ? kind : `${kind} · learned ${learned}`
}

/** The session a still-binding speak-first went out in, or null (none, or settled since: core moved past not_started). */
export function firedIn(stored: unknown): string | null {
  const session = (stored as { session?: unknown } | null | undefined)?.session
  return typeof session === 'string' ? session : null
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

// ── pausing: said, not done (v1 trim, 2026-10-14) ───────────────────────────

/** What to say to Claude to pause or resume memory in this folder: Claude calls Counterparts' `scope` tool. */
export const PAUSE_SAY = 'say “pause memory here”'
export const RESUME_SAY = 'say “resume memory here”'

/**
 * What `/counterparts resume` answers: the sidebar changes no setting, so it
 * says where the folder stands and how to resume it.
 */
export function resumeWords(scope: SidebarScope): string {
  if (scope.mode === 'unknown') return `Couldn't read this folder's setting. To resume memory here, ${RESUME_SAY} to Claude.`
  const here = shortDir(scope.dir)
  if (scope.mode === 'paused' && scope.own) return `Counterparts memory is paused in ${here}. To resume it, ${RESUME_SAY} to Claude.`
  // Set by a folder above: resumed there (a session in that folder, or the npm install's console).
  if (scope.mode === 'paused') {
    const there = scope.setBy ?? '<that folder>'
    return `Counterparts memory is paused here because ${shortDir(scope.setBy)} is paused. To resume, ${RESUME_SAY} to Claude in a session there, or, with the npm install, run \`counterparts scope ${shellQuote(there)} --resume\`.`
  }
  if (scope.mode === 'off') {
    const where = scope.setBy ?? scope.dir ?? '<this folder>'
    return `Counterparts memory is off in ${here}. To turn it back on, ask Claude in a session in ${shortDir(where)}, or, with the npm install, run \`counterparts scope ${shellQuote(where)} --on\`.`
  }
  return `Counterparts memory isn't paused in ${here}.`
}

/** A path as one shell word, as core's `scopes.ts#shellWord` writes it: plain, or in single quotes. */
export function shellQuote(path: string): string {
  return /^[A-Za-z0-9_./@%+=:,-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`
}

/**
 * The footer (v1 trim, 2026-10-14): how to do what the sidebar no longer does
 * itself, a few words and a command each. One line, `label · command`, the
 * labels shortened where a whole line won't fit in `w` cells (all four short
 * ones fit the docked pane's 32); narrower still, the short label, then the
 * command under it, indented.
 */
export const FOOTER_ITEMS: readonly { label: string; short: string; how: string }[] = [
  { label: '5-minute intro', short: 'Intro', how: '/counterparts:meet' },
  { label: 'Dashboard', short: 'Dash', how: '/counterparts:dashboard' },
  { label: 'Pause here', short: 'Pause', how: PAUSE_SAY },
  { label: 'Hide this', short: 'Hide', how: '/counterparts quiet' },
]

/** One footer line: its label part (dim) and its command part (bright); either may be empty. */
export type FooterLine = { label: string; how: string }

/** Where memory is paused or off, the pause line says how to resume instead. */
const RESUME_ITEM = { label: 'Resume here', short: 'Resume', how: RESUME_SAY }

/** The footer's lines at `w` cells; `paused`: this folder is paused or off. */
export function footerLines(w: number, paused = false): FooterLine[] {
  const items = paused ? FOOTER_ITEMS.map(it => (it.how === PAUSE_SAY ? RESUME_ITEM : it)) : FOOTER_ITEMS
  const fits = (label: string, how: string): boolean => [...`${label} · ${how}`].length <= w
  // One set of labels for every line, so they read alike: the long ones only where all of them fit.
  const long = items.every(it => fits(it.label, it.how))
  const out: FooterLine[] = []
  for (const it of items) {
    const label = long ? it.label : it.short
    if (fits(label, it.how)) out.push({ label: `${label} · `, how: it.how })
    else {
      // A command is never cut: indented where that fits, else at the margin (under 25 cells the longest wraps).
      out.push({ label: it.short, how: '' })
      out.push({ label: [...it.how].length + 2 <= w ? '  ' : '', how: it.how })
    }
  }
  return out
}
