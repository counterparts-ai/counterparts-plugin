/**
 * The sidebar's own state and timings (shared core, no drawing): the
 * timings and limits the hooks keep, the first meeting's line and its
 * once-only mark, the unknown folder, and `run`, what
 * this module life knows (a reload starts it over; the host keeps `$.state`).
 *
 * The `$.state` atoms themselves stay in `register.tsx`: the engine's scan
 * reads a `read($, x)` source only where `x` is an atom declared in the same
 * file (NOTES, "The split").
 */

import type { SidebarScope } from '../types'

/**
 * Body columns the sidebar asks for: 34, which the dock draws 35 wide with its
 * divider (measured in v0.1: `columns: 44` gave a dock 45 wide), the mockups'
 * 35. The body is laid out to 32 text columns inside a column of padding each
 * side.
 */
export const OPEN_COLUMNS = 34

/** Rows of pane body from which the header gets a blank row above it (the mockups at 200x60 have one; at 160x48, not). */
export const ROOMY_ROWS = 44

/** The dashboard is read only while the pane is drawn: this often while things happen… */
export const POLL_MS = 15000

/** …and this often after four quiet reads in a row. */
export const POLL_IDLE_MS = 30000

/** A gap longer than this since the last read starts over from a cold read. */
export const STALE_MS = 10 * 60000

/** A switch's note and the pause confirm close by themselves after this. */
export const AUTO_CLOSE_MS = 30000

/** How often the folder's registry is read again while no dashboard poll reads it (the pane closed or not shown). */
export const SCOPE_RECHECK_MS = 60000

/** How long the registry's path, found from the settings, is trusted before it is looked up again. */
export const SCOPES_FILE_TTL_MS = 5 * 60000

/** The hover group that shows what a click on the Counterparts switch does, over the rows above the footer. */
export const HOVER_CP = 'counterparts-switch-cp'

export const FIRING_MS = 2600

/**
 * One event can prove several mechanisms: their pulses go this far apart, so
 * each arc reads as its own. At most four slots: a fifth shares the fourth.
 */
export const PULSE_STAGGER_MS = 300

export const PULSE_SLOTS = 4

/** Events that change the memory count, worth one read of `/api/pulse` (the dear one). */
export const COUNT_EVENTS = new Set(['gate.deposit', 'gate.chunk', 'memory.pruned', 'memory.merged', 'dream.changed', 'contradiction.settled'])

/**
 * A dashboard older than v0.2 says no `firedToday`: today's counts come from
 * each event's newest rows, this many first, read deeper (doubling) while all
 * of them are today's, to at most FALLBACK_MAX. Only on a cold read; polls add.
 */
export const FALLBACK_LIMIT = 150

export const FALLBACK_MAX = 1200

/**
 * The speak-first's line (`speak-first.tsx`, a hooks module of its own): what it
 * submits, once per install at the first idle start while core says
 * `not_started`. Framed as the plugin's (not `asUser`): the model reads "The
 * counterparts plugin sent a message: …", and core's wake carries the meeting's
 * instructions. Claude Code shows this line to the person ("Prompt from the
 * counterparts plugin"), so it reads as a sentence to them, and still tells the
 * model to introduce itself (2026-10-12, owner's onboarding trial). Since the fox
 * trial it is "Meet your new counterpart." (the owner: Claude already has a
 * memory of its own), which core's wake names as this meeting. The button runs
 * `/counterparts:meet` instead, which carries its own instructions in any later
 * session (MEET_COMMAND).
 */
export const MEET_PROMPT = 'Meet your new counterpart.'

/**
 * `$.store`: the speak-first went out (`{ session, at }`), never again while it is there; or
 * `{ settled }` once core moved past not_started. Written by `speak-first.tsx`; the sidebar
 * reads it to hide its button in the session whose speak-first is introducing.
 */
export const MEET_FLAG = 'meetTriggered'

/** "Start the 5-minute intro": the plugin's command (commands/meet.md), run as if typed. */
export const MEET_COMMAND = 'counterparts:meet'

/** The Mechanisms section's link when the dashboard is down: the plugin's command (commands/dashboard.md). */
export const DASHBOARD_COMMAND = 'counterparts:dashboard'

/** A second press of "Start the 5-minute intro" this soon after the first submits nothing. */
export const MEET_PRESS_MS = 60000

// ── the unknown folder, and what this module life knows ──

export const UNKNOWN_SCOPE: SidebarScope = { mode: 'unknown', own: false, setBy: null, dir: null, error: null, busy: false, unread: null }

export const run = {
  session: '',
  interactive: false,
  /** The first drawing's one-time work (a quiet scope read, if the start's found none) is done. */
  woke: false,
  /** A read of this folder's registry is on its way. */
  scopeReading: false,
  /** The folder this session started in (`session.start`'s `cwd`). */
  cwd: '',
  /** The registry the hooks read, and when (`$.clock`) that was found. */
  scopesFile: null as string | null,
  scopesFileAt: 0,
  scopeTimer: null as { cancel: () => void } | null,
  /** Canonical forms of paths that resolved whole (a folder's realpath rarely moves). */
  canon: new Map<string, string>(),
  /** Whether to open the pane unasked has been decided (from the first band drawing). */
  placementDecided: false,
  /** Whether this surface docks a pane (the fullscreen renderer), once the band or the hint has said. */
  docks: undefined as boolean | undefined,
  /** The surface the band above the prompt last drew on (the pane opens narrower on the desktop). */
  surface: null as string | null,
  cold: false,
  polling: false,
  /** A dashboard read is scheduled or running. */
  pollArmed: false,
  quietPolls: 0,
  lastPollAt: 0,
  lastSeq: -1,
  server: null as string | null,
  /** The dashboard's port, read once (`dashPort`). */
  port: null as number | null,
  liveSeq: 0,
  /** An unasked pane this surface could not place yet: the tail says `/counterparts opens the sidebar` until it draws. */
  hint: false,
  brainTimer: null as { cancel: () => void } | null,
  /** Which timer is the brain's now: a tick or a blit answer of an older one changes nothing. */
  brainGen: 0,
  /** The pace the brain's timer runs at; `rest` while it is stopped at rest. */
  brainPace: 'calm' as 'burst' | 'calm' | 'rest',
  /** When this session began: an event naming no session, from after it, is taken as this session's. */
  startedAt: 0,
  /** Fresh drawings asked for after refused blits since the last blit that was taken. */
  redraws: 0,
  /** The body's text width at the last drawing: what the expand threshold is measured at. */
  bodyW: 32,
  /** Whether the dashboard says `firedToday` (v0.2 and later); null until asked. */
  firedToday: null as boolean | null,
  /**
   * The calendar day on this machine's clock when today's counts were last read: a new one starts them over.
   * Not the dashboard's `today`, which is the store's zone: a store set to another zone would differ from this
   * clock all day and read the counts again on every poll.
   */
  countedOn: '',
  /** This session's rows were looked for on the dashboard (`seedSession`), once a module life. */
  seeded: false,
  /** When "Start the 5-minute intro" was last pressed (`$.clock`). */
  meetPressedAt: -Infinity,
  /** The store this session's hooks opened, from the wake's `counterparts:store` marker; null until it says. */
  wakeStore: null as string | null,
  /** The dashboard serves another store (`/api/whoami`): nothing is read from it until it matches again. */
  foreign: false,
}

// ── small helpers ───────────────────────────────────────────────────────────

/** Work left running on its own: a reload or the session's end may cut it off, and that is fine. */
export function quiet(p: Promise<unknown>): void {
  p.catch(() => undefined)
}

/** Event names whose rows name nothing (`feed.ts#mechFirings`) or need a dream read: not worth reading deeper. */
export const NAMES_NOTHING = new Set(['mcp.recall', 'associate.flush', 'contradiction.flagged', 'sleep.cycle', 'dream.journaled', 'dream.changed'])
