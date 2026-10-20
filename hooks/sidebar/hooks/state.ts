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

import type { SidebarScope, SidebarMeet } from '../types'
import type { Glance } from './feed'
import type { FullPane } from './pane'
import type { Status } from './status'

/** How long the line under a clicked item says why the prompt box did not take its command. */
export const FILL_NOTE_MS = 8000

/**
 * Body columns the sidebar asks for: 34, which the dock draws 35 wide with its
 * divider (measured in v0.1: `columns: 44` gave a dock 45 wide), the mockups'
 * 35. The body is laid out to 32 text columns inside a column of padding each
 * side.
 */
export const OPEN_COLUMNS = 34

/** Rows of pane body from which the header gets a blank row above it (the mockups at 200x60 have one; at 160x48, not). */
export const ROOMY_ROWS = 44

/** The status file (`status.ts`) is read only while the pane is drawn: this often while things happen… */
export const POLL_MS = 15000

/** …and this often after four quiet reads in a row. */
export const POLL_IDLE_MS = 30000

/** How often the folder's registry is read again while no status poll reads it (the pane closed or not shown). */
export const SCOPE_RECHECK_MS = 60000

/** How long the registry's path, found from the settings, is trusted before it is looked up again. */
export const SCOPES_FILE_TTL_MS = 5 * 60000

export const FIRING_MS = 2600


/**
 * The speak-first's line (`speak-first.tsx`, a hooks module of its own): what it
 * submits, once per install at the first idle start while core says
 * `not_started`. Framed as the plugin's (not `asUser`): the model reads "The
 * counterparts plugin sent a message: …", and core's wake carries the meeting's
 * instructions. Claude Code shows this line to the person ("Prompt from the
 * counterparts plugin"), so it reads as a sentence to them, and still tells the
 * model to introduce itself (2026-10-12, owner's onboarding trial). Since the fox
 * trial it is "Meet your new counterpart." (the owner: Claude already has a
 * memory of its own), which core's wake names as this meeting. In any later
 * session the person types `/counterparts:meet` (the sidebar's footer says so).
 */
export const MEET_PROMPT = 'Meet your new counterpart.'

/**
 * `$.store`: the speak-first went out (`{ session, at }`), never again while it is there; or
 * `{ settled }` once core moved past not_started. Written and read by `speak-first.tsx`.
 */
export const MEET_FLAG = 'meetTriggered'

// ── the unknown folder, and what this module life knows ──

export const UNKNOWN_SCOPE: SidebarScope = { mode: 'unknown', own: false, setBy: null, dir: null, error: null, busy: false, unread: null }

export const run = {
  session: '',
  /** Where the first meeting stands, from the wake's onboarding marker: the footer drops its intro line once done or skipped. */
  meet: 'unknown' as SidebarMeet | 'unknown',
  /** The wake's first glance line (Last here, Coming up, Yesterday): shown until the session has something of its own. */
  glance: null as Glance | null,
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
  polling: false,
  /** A status read is scheduled or running. */
  pollArmed: false,
  quietPolls: 0,
  /** The newest seq of the file last read (-1: none read yet): rows after it are new. */
  lastSeq: -1,
  /** The status file's path, its stamp when last read, and what it said (`status.ts`). */
  statusFile: null as string | null,
  statusStamp: '',
  status: null as Status | null,
  liveSeq: 0,
  /** Memory tool calls (`savesMemory`) running now: the poll writes no notepad for their rows; the call's own return does. */
  saving: 0,
  /** An unasked pane this surface could not place yet: the tail says `/counterparts opens the sidebar` until it draws. */
  hint: false,
  /** When this session began: an event naming no session, from after it, is taken as this session's. */
  startedAt: 0,
  /** Fresh drawings asked for after refused blits since the last blit that was taken. */
  redraws: 0,
  /** The body's text width at the last drawing: what the expand threshold is measured at. */
  bodyW: 32,
  /** This session's rows were looked for in the status file (`seedSession`), once a module life. */
  seeded: false,
  /** The store this session's hooks opened, from the wake's `counterparts:store` marker; null until it says. */
  wakeStore: null as string | null,
  /** The status file is another store's: nothing of it is shown until it matches again. */
  foreign: false,
  /**
   * THE FULL PLUGIN'S PIECES (2026-10-16): the Meet row, the title's link to the dashboard, the footer's
   * clickable lines and switches. Set by `actions.tsx` when `full.tsx` registers it, the one place the full
   * build turns them on; null in the plugin directory's build, which never loads that file and draws none.
   */
  full: null as FullPane | null,
  /** Why the prompt box did not take a clicked item's command (`actions.tsx`): drawn under that item for FILL_NOTE_MS. */
  fillNote: null as { key: string; text: string; at: number } | null,
  /** The session in which a click on the Meet row put `/counterparts:meet` in the box: the meeting has begun there. */
  meetFilledIn: null as string | null,
}

// ── small helpers ───────────────────────────────────────────────────────────

/** Work left running on its own: a reload or the session's end may cut it off, and that is fine. */
export function quiet(p: Promise<unknown>): void {
  p.catch(() => undefined)
}

/** Event names whose rows name nothing (`feed.ts#mechFirings`) or need a dream read: not worth reading deeper. */
export const NAMES_NOTHING = new Set(['mcp.recall', 'associate.flush', 'contradiction.flagged', 'sleep.cycle', 'dream.journaled', 'dream.changed'])
