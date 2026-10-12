/**
 * What the sidebar says, worked out with no `$` (shared core, no drawing):
 * the stored view and brain read from any version, the status line, what
 * the folder's switch says instead of acting and over its hover card, the
 * tail's words for what happened, an opened memory's meta line, the first
 * meeting's once-only mark, and a scope tool's answer read into a folder's
 * state.
 */

import type { SidebarBrain, SidebarSaved, SidebarScope, SidebarView } from '../types'
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

/** The avatar as stored: a mode someone chose stays; nothing stored (or one this version doesn't know) is the fox. */
export function normBrain(v: unknown): SidebarBrain {
  return v === 'still' || v === 'off' || v === 'turning' ? v : 'fox'
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
      ? ['⏸ Counterparts memory paused in this folder', scope.own ? '/counterparts resume' : `resume it in ${shortDir(scope.setBy)}`]
      : ['◌ Counterparts memory off in this folder']
  return parts.join(' · ')
}

export function trimSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

/**
 * What the switch says instead of acting, by where the folder stands. It acts
 * only on a folder whose OWN entry holds the mode: pausing anything else would
 * leave an entry of its own behind when resumed (the `scope` tool can set
 * on, observer, off, pause and resume, not "unset"), and it never turns an
 * `off` folder on.
 */
export function switchExplains(scope: SidebarScope): string | null {
  const here = scope.dir ?? 'this folder'
  // A folder off by its OWN entry: the switch turns it back on (after a confirm). Off by a parent's: never flipped from here.
  if (scope.mode === 'off' && !scope.own) {
    return scope.setBy === null
      ? `This folder is off, and not by a setting of its own. \`counterparts scope ${here} --on\` turns it on.`
      : `This folder is off because ${scope.setBy} is set off. The switch won't change that folder from here; \`counterparts scope ${scope.setBy} --on\` does.`
  }
  if (scope.mode === 'paused' && !scope.own) {
    return `Paused because ${scope.setBy ?? 'a folder above this one'} is paused. Resume it there: \`counterparts scope ${scope.setBy ?? '<that folder>'} --resume\`.`
  }
  if (scope.mode === 'unset') {
    return `Nothing is set for this folder, so Counterparts is on by default. The switch pauses only a folder with a setting of its own: a pause here would come back as an explicit “on”, and nothing can put a folder back to unset yet. \`counterparts scope ${here} --on\` gives it one.`
  }
  if ((scope.mode === 'on' || scope.mode === 'observer') && !scope.own) {
    return `This folder follows ${scope.setBy ?? 'a folder above it'} (${scope.mode}). The switch pauses only a folder with a setting of its own; \`counterparts scope ${here} --${scope.mode}\` gives it one.`
  }
  return null
}

/**
 * What a click on the Counterparts switch does, shown while the pointer is on
 * it: whole sentences in the card's two rows at the pane's 32 columns (a
 * longer one was cut mid-sentence there: "A click pauses it for").
 */
export function scopeHover(scope: SidebarScope): string {
  if (scope.mode === 'unknown') return 'Not read yet: a click checks this folder, changing nothing.'
  if (switchExplains(scope) !== null) return "This switch can't change this folder. A click says why."
  if (scope.mode === 'paused') return 'Paused here, for every session. on resumes it; off asks first.'
  if (scope.mode === 'off') return 'Off here, for every session. on turns it back on (asks first).'
  if (scope.mode === 'observer') return 'Reads only here. on, paused or off: each asks first.'
  return 'Paused or off holds for every session here; each asks first.'
}

/** Where the three-way switch stands: `on` for on, observer and unset (on by default); null while unknown. */
export function switchAt(mode: string): 'on' | 'paused' | 'off' | null {
  if (mode === 'unknown') return null
  return mode === 'paused' ? 'paused' : mode === 'off' ? 'off' : 'on'
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

// ── the folder's switch ────────────────────────────────────────────────────

export function scopeOf(payload: Record<string, unknown> | null, isError: boolean, before: SidebarScope): SidebarScope {
  if (isError || payload === null) {
    return { ...before, busy: false, error: String(payload?.['detail'] ?? payload?.['reason'] ?? 'refused') }
  }
  const mode = typeof payload['mode'] === 'string' ? (payload['mode'] as string) : before.mode
  const dir = typeof payload['scope'] === 'string' ? (payload['scope'] as string) : before.dir
  // A read names the entry that governs (`setBy`); a set wrote this folder's own.
  const setBy = payload['set'] === true ? dir : typeof payload['setBy'] === 'string' ? (payload['setBy'] as string) : null
  const own = setBy !== null && dir !== null && trimSlash(setBy) === trimSlash(dir)
  return { mode, own, setBy, dir, error: null, busy: false, unread: null }
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Which own modes each confirm may change: a pause from on or observer; an off from those or paused; an on from off or observer. */
export const CONFIRM_FROM: Record<'pause' | 'off' | 'on', readonly string[]> = {
  pause: ['on', 'observer'],
  off: ['on', 'observer', 'paused'],
  on: ['off', 'observer'],
}

/**
 * The scope tool stood down: this session's memory server started while the
 * folder read only (`observer`), and changes nothing for the session's life,
 * the scope setting included (`serve.ts`). The console still can.
 */
export function stoodDownNote(scope: SidebarScope, to: 'pause' | 'resume' | 'off' | 'on'): string {
  const flag = to === 'pause' ? '--pause' : to === 'off' ? '--off' : to === 'on' ? '--on' : '--resume'
  return `This session started while the folder read only, so its memory server can't change the setting. \`counterparts scope ${scope.dir ?? '<this folder>'} ${flag}\` does; a session started after that follows it.`
}
