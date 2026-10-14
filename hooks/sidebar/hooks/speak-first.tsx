/**
 * SPEAK FIRST, a hooks module of its own (moved out of `register.tsx`,
 * 2026-10-14): once per store, at an interactive start, while the wake's
 * onboarding marker says `not_started`, it submits MEET_PROMPT, which the
 * engine runs once the session is idle, so Claude opens the first meeting.
 *
 * The plugin's own build lists it beside the sidebar (`hooks/hooks.json`,
 * "modules"); the plugin directory's build lists only the sidebar, which then
 * offers the meeting by its "Start the 5-minute intro" button alone. Neither
 * module imports the other: they share pure helpers (`feed.ts`, `words.ts`,
 * `state.ts`'s constants) and, through the engine, two things of the plugin's:
 *   - `$.state` `counterparts.scope`, where this folder stands, which the
 *     sidebar reads from the registry and this module only reads (alone, it
 *     stays unknown, and the speak-first never fires: it never acts on an
 *     unknown folder);
 *   - `$.store` MEET_FLAG, the once-per-install mark this module writes
 *     (`{ session, at }`, or `{ settled }` once core moved past not_started),
 *     which the sidebar reads to hide its button while this session's
 *     speak-first is the introduction.
 *
 * Never headless, never where the folder is paused, off, observer or unknown,
 * never once the person has typed a prompt or run a slash command (or is
 * typing one), and never over a binding mark. The mark is written before the
 * submit, so a crash between them loses the trigger rather than repeating it.
 * A speak-first still queued when the person's own prompt goes first is
 * dropped: their prompt comes first, and core offers the meeting in that reply.
 *
 * KEYED TO THE STORE without a store id: core says `not_started` only for a
 * store that never got past it (`start-fresh` resets it). So every known state
 * past it is written over the mark as `{ settled }`, and a settled mark doesn't
 * block the speak-first: a `not_started` after it is a new store, which gets
 * its own first meeting.
 */

import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SidebarMeet } from '../types'
import { canMeet, parseOnboardingMarker } from './feed'
import { MEET_FLAG, MEET_PROMPT, SCOPE_RECHECK_MS, UNKNOWN_SCOPE, quiet } from './state'
import { firedIn } from './words'

/** The sidebar's view of this folder (`register.tsx` writes it); read here, never written. */
const scopeA = atom({ plugin: 'counterparts', key: 'scope' } as const, UNKNOWN_SCOPE)

/**
 * The session in which the person ran `/counterparts …` (the sidebar writes it: its command hook answers
 * without passing the command on, so this module's `command.run` hook never sees that one).
 */
const typedInA = atom({ plugin: 'counterparts', key: 'typedIn' } as const, null)

/** How often a start that could not decide yet (the folder or the marker not read) looks again, and for how long. */
const RETRY_MS = 1000
const RETRIES = 120

/** What this module life knows. */
const sf = {
  interactive: false,
  session: '',
  /** Where the first meeting stands, from the wake's marker; unknown until one says. */
  meet: 'unknown' as SidebarMeet,
  /** The person sent a prompt of their own, or ran a slash command, this session. */
  typed: false,
  /**
   * The person sent a PROMPT of their own, not only a command: only this drops a speak-first
   * already queued, since only a prompt gets a reply where core can offer the meeting.
   */
  prompted: false,
  /** The speak-first was considered this module life (it goes out at most once per install). */
  tried: false,
  /** This module life submitted the speak-first. */
  spoke: false,
  retry: null as { cancel: () => void } | null,
}

/** The marker's state, taken in: past not_started settles a binding mark (a new store's not_started speaks again). */
async function takeMeet($: EngineInterface, meet: SidebarMeet): Promise<void> {
  if (meet === 'unknown') return
  sf.meet = meet
  if (meet === 'not_started') return
  const mark = (await $.store.get(MEET_FLAG)) as { settled?: unknown } | undefined
  if (mark?.settled !== meet) await $.store.set(MEET_FLAG, { settled: meet, at: await $.clock.now() })
}

/** One look: speaks first when every condition holds, else waits for what is missing or stands down for good. */
async function speakFirst($: EngineInterface): Promise<void> {
  if (!sf.interactive || sf.tried) return
  const scope = await read($, scopeA)
  // Not read yet: a later look tries again.
  if (scope.mode === 'unknown' && scope.unread === null) return
  // No state yet: the wake's marker, when it comes, tries again (no marker at all: an older core, nothing).
  if (sf.meet === 'unknown') return
  sf.tried = true
  stopRetry()
  if (sf.session === '') sf.session = await $.session.id()
  if ((await read($, typedInA)) === sf.session) sf.typed = true
  if (sf.meet !== 'not_started' || sf.typed || !canMeet(scope.mode)) return
  if (firedIn(await $.store.get(MEET_FLAG)) !== null) return
  // The last looks, right before: no prompt sent or typed, no other session got there meanwhile.
  if (sf.typed || (await read($, typedInA)) === sf.session || (await turnsSoFar($)) > 0) return
  if ((await draftNow($)).trim() !== '') return
  if (firedIn(await $.store.get(MEET_FLAG)) !== null) return
  await $.store.set(MEET_FLAG, { session: sf.session, at: await $.clock.now() })
  sf.spoke = true
  // Not awaited inside a hook: the engine queues it until the session is idle.
  $.clock.after(0, () => quiet($.prompt.submit({ text: MEET_PROMPT })))
}

async function turnsSoFar($: EngineInterface): Promise<number> {
  try {
    return await $.session.turns()
  } catch {
    return 1
  }
}

async function draftNow($: EngineInterface): Promise<string> {
  try {
    return (await $.prompt.read()).text
  } catch {
    return ''
  }
}

function stopRetry(): void {
  sf.retry?.cancel()
  sf.retry = null
}

export const register: Register = on => {
  // (Each hook here carries a matcher: the sidebar's own hooks on these events carry none, and two of one
  // plugin on one event with none are refused when both modules load as one.)
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    sf.interactive = e.isInteractive
    sf.session = await $.session.id()
    if (sf.interactive && !sf.tried) {
      // The sidebar reads where this folder stands as the session starts; look once it has, and again a
      // few times while either that or the wake's marker is missing.
      $.clock.after(0, () => quiet(speakFirst($)))
      stopRetry()
      let left = RETRIES
      sf.retry = $.clock.every(RETRY_MS, () => {
        left -= 1
        if (sf.tried) stopRetry()
        else if (left > 0) quiet(speakFirst($))
        else {
          // Still undecided after two minutes (the folder's state or the marker late): once a minute after,
          // as the sidebar's own scope recheck used to carry it.
          stopRetry()
          sf.retry = $.clock.every(SCOPE_RECHECK_MS, () => (sf.tried ? stopRetry() : quiet(speakFirst($))))
        }
      })
    }
    return next(e)
  })

  // A slash command the person ran (any: /model, /counterparts…) counts as having spoken: no
  // command starts a turn, so `session.turns()` would not see it.
  // (`/counterparts …` never reaches here: the sidebar answers it without `next`, and says so in `typedIn`.)
  on('command.run', { origin: { kind: /^(composer|bridge)$/ } }, async ($, e, next) => {
    sf.typed = true
    return next(e)
  }).catch(($, e, next) => next(e))

  // A prompt the person sent: the speak-first stands down for good in this session. If it was
  // already queued behind it, it is dropped: their prompt comes first, and core offers the
  // meeting in that reply instead.
  on('prompt.submit', { origin: { kind: /^(composer|bridge|plugin)$/ } }, async ($, e, next) => {
    const kind = e.origin.kind
    if (kind === 'composer' || kind === 'bridge') sf.typed = sf.prompted = true
    if (kind === 'plugin' && e.origin.name === 'counterparts' && e.text === MEET_PROMPT && sf.prompted && sf.spoke) {
      return { drop: 'the person spoke first' }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The wake's onboarding marker: where the first meeting stands, then a look.
  on('session.append', { door: 'hook-context', origin: { kind: 'hook', event: 'SessionStart' } }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined) return stored
    try {
      const text = e.message.content.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')
      const meet = parseOnboardingMarker(text)
      if (meet !== null) {
        await takeMeet($, meet)
        $.clock.after(0, () => quiet(speakFirst($)))
      }
    } catch {
      // the row is stored whatever this module made of it
    }
    return stored
  }).catch(($, e, next) => next(e))
}
