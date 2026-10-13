/**
 * The sidebar's own state and timings (shared core, no drawing): the
 * timings and limits the hooks keep, the first meeting's line and its
 * once-only mark, the empty search and the unknown folder, and `run`, what
 * this module life knows (a reload starts it over; the host keeps `$.state`).
 *
 * The `$.state` atoms themselves stay in `register.tsx`: the engine's scan
 * reads a `read($, x)` source only where `x` is an atom declared in the same
 * file (NOTES, "The split").
 */

import type { SidebarScope, SidebarSearch } from '../types'

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
 * The first meeting's line: what the sidebar submits, once per install at the
 * first idle start while core says `not_started`, and on each press of "Start
 * the 5-minute intro". Framed as the plugin's (not `asUser`): the model reads
 * "The counterparts plugin sent a message: …", and core's wake carries the
 * meeting's instructions. Claude Code shows this line to the person ("Prompt
 * from the counterparts plugin"), so it reads as a sentence to them, and still
 * tells the model to introduce itself (2026-10-12, owner's onboarding trial).
 * Since the fox trial it is "Meet your new counterpart." (the owner: Claude
 * already has a memory of its own), which core's wake names as this meeting.
 * Only the automatic speak-first sends it: the button runs `/counterparts:meet`,
 * which carries its own instructions in any later session (MEET_COMMAND).
 */
export const MEET_PROMPT = 'Meet your new counterpart.'

/** "Start the 5-minute intro": the plugin's command (commands/meet.md), run as if typed. */
export const MEET_COMMAND = 'counterparts:meet'

/** The Mechanisms section's link when the dashboard is down: the plugin's command (commands/dashboard.md). */
export const DASHBOARD_COMMAND = 'counterparts:dashboard'

/**
 * The search box, hidden for 0.3.20 (2026-10-12): in the owner's real sessions a
 * click never put the keyboard in it (fox trial rounds 1 and 2), and it could not
 * be checked live here (NOTES). `COUNTERPARTS_SIDEBAR_SEARCH=1` brings it back,
 * read at session start.
 */
export const searchFlag = { on: false }

/** `$.store`: the speak-first went out (`{ session, at }`); never again while it is there. */
export const MEET_FLAG = 'meetTriggered'

/** A second press of "Start the 5-minute intro" this soon after the first submits nothing. */
export const MEET_PRESS_MS = 60000

// ── the empty search, the unknown folder, and what this module life knows ──

export const IDLE_SEARCH: SidebarSearch = { query: '', status: 'idle', header: '', total: 0, hits: [], error: null }

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
  /** The command that opens a URL here, once found. */
  opener: null as readonly string[] | null,
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
  /** The person sent a prompt of their own, or ran a slash command, this session: the speak-first stands down. */
  typed: false,
  /**
   * The person sent a PROMPT of their own (`prompt.submit`), not only a command: only this drops a
   * speak-first already queued, since only a prompt gets a reply where core can offer the meeting.
   */
  prompted: false,
  /** The speak-first was considered this module life (it goes out at most once per install, `MEET_FLAG`). */
  meetTried: false,
  /** The session whose start sent the speak-first, as stored; null when it never went out. */
  meetFiredIn: null as string | null,
  /**
   * This module life submitted the speak-first. Unlike `meetFiredIn`, core's state moving on
   * never clears it: the person's reply calling `meet` (state `offered`) must not let a
   * speak-first still queued behind it through (`prompt.submit`).
   */
  spokeFirst: false,
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
