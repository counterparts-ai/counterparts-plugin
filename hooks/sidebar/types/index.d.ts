// The sidebar mod's state contract: every value it keeps in `$.state`, under
// the plugin's name. Self-contained (no imports), as a contract must be; the
// hooks module imports these types from here.
//
// v0.2 (2026-10-10): the pane is what memory is doing, in 35 columns. A small
// brain beside the title, then five sections (Memories, Subconscious, Saved
// this session, Mechanisms today, Last Dream), then three rows of switches.
// The v0.1 ACTIVITY list, its legend and its `feed` are gone.

export type SidebarMechId =
  | 'salience'
  | 'emotional'
  | 'decay'
  | 'interference'
  | 'retrieval'
  | 'association'
  | 'prospective'
  | 'consolidation'
  | 'dreaming'
  | 'reconsolidation'
  | 'episodic-semantic'
  | 'schema';

/**
 * One event the dashboard's feed narrates, as the sidebar reads it: which
 * mechanisms it proves (for the brain's lights and the day's counts), and
 * whose it is. Not kept in `$.state`; the pure feed hands these around.
 */
export type SidebarRow = {
  /** Stable: a dashboard seq, or a live row's own id. */
  id: string;
  /** The row's own mechanism: its word and its colour (a dream's row is Dreaming's). */
  mech: SidebarMechId;
  /**
   * Every mechanism the event proves, `mech` first (a mood-matched recall:
   * Retrieval and Emotion; a dream that merged and wrote a gist: Dreaming,
   * Gist, Interference, Consolidation). Each one pulses and lights.
   */
  mechs: SidebarMechId[];
  /** The short word (`kept`, `recalled`, `faded`, `dreamed`). */
  word: string;
  /** Milliseconds since the epoch. */
  at: number;
  /** The event in the narrator's words, or the sidebar's own. */
  text: string;
  /** What opening it adds. */
  more: string[];
  url: string;
  label: string;
  /** Seen live in this session rather than read from the dashboard. */
  live?: true;
  /** This session's (`here`), the night's or the background's (`night`), or another session's (`other`). */
  who: 'here' | 'night' | 'other';
  /** The row in one short line. */
  line: string;
  /** Keys a live row and its later dashboard twin share (`mem:<id>`, `turn:<session>:<n>`). */
  keys?: string[];
  /** The memory the event is about, when it names one: its id and its title as the feed gives it (cut at about 60 characters). */
  memory?: { id: string; title: string | null };
  /** The dream it belongs to (`drm_…`), for a dream's rows: one dream is one firing. */
  dream?: string;
};

/** One memory a search found. */
export type SidebarHit = {
  id: string;
  title: string;
  /** `memory` or `journal`. */
  kind: string;
  /** When it happened, else when it was learned, as `Oct 9`; empty when unknown. */
  date: string;
  /** Who said it, only when that is known (`you said it`, `I said it`, `inferred`). */
  who: string | null;
  /** `memory · Oct 9`, with who said it when known. */
  meta: string;
  excerpt: string;
};

export type SidebarSearch = {
  query: string;
  status: 'idle' | 'running' | 'done' | 'error';
  /** The answer's first line (`12 match · showing 10 …`). */
  header: string;
  /** How many matched in all, from that header; the hits are the page shown. */
  total: number;
  hits: SidebarHit[];
  error: string | null;
};

export type SidebarPulse = { day: number; memories: number; lastSeq: number };

/** A memory the sidebar names: its id when known, and its title (or, until the title is read, the words Claude was shown). */
export type SidebarMemoryRef = {
  id: string | null;
  title: string;
  /** A `recall` this session opened it by its id or its title (a footnote Claude looked at). */
  opened?: boolean;
};

/**
 * What was put in front of Claude for the person's last message that had any:
 * the recall block the classic UserPromptSubmit hook injects. `surfaced` is
 * its "Came to mind" lane (said in full: the pane's Memories), `footnotes`
 * its "Quietly available" lane (titles only: the pane's Subconscious).
 */
export type SidebarMind = {
  turn: number;
  /** When the block arrived (the person's message), ms. */
  at: number;
  surfaced: SidebarMemoryRef[];
  footnotes: SidebarMemoryRef[];
};

/** A memory this session saved (`note`, `session_end`; a chapter is a journal entry, left out), newest first in the list. */
export type SidebarSaved = {
  key: string;
  id: string | null;
  title: string;
  at: number;
  /** An update: the memory it replaces (`updates`), by title once read, else null. Shown only when the item is opened. */
  replaces: string | null;
  replacesId: string | null;
  /** `new` (Salience's dot), `update` (Reconsolidation's). */
  kind: 'new' | 'update';
};

/**
 * Times each mechanism fired today: from the dashboard's `/api/mechanisms`
 * (`firedToday`, rows on the calendar day) where it says, else counted here
 * from the feed's rows of today (`feed`: a dashboard older than v0.2).
 * A count of null: not built.
 */
export type SidebarToday = {
  /** The calendar day counted, `YYYY-MM-DD`. */
  date: string;
  counts: Partial<Record<SidebarMechId, number | null>>;
  source: 'dashboard' | 'feed';
  /** Dream ids already counted (the feed's count: a dream's two rows are one firing). */
  dreams?: string[];
};

/** The newest dream, from `/api/dreams`, in its own first person. */
export type SidebarDream = {
  id: string;
  /** When it was journaled (its `dream.journaled` row), ms; null when not found. */
  at: number | null;
  /** Its calendar day, `YYYY-MM-DD`. */
  date: string | null;
  /** The journal's first sentence. */
  first: string;
  /** What follows it. */
  rest: string;
};

/**
 * The one item opened in place: `key` names it (`mem:0`, `sub:1`,
 * `saved:<key>`, `ev:<key>`, `hit:<id>`, `dream`), with what opening it
 * shows, read from the dashboard (`/api/memory?id=`, a read that writes
 * nothing). Every click opens in place, whatever the length (v0.2 polish,
 * 2026-10-10): the layout shows up to 20 lines of the text, and past that
 * ends the last with `more`, which opens `id` on the dashboard.
 */
export type SidebarOpen = {
  key: string;
  /** The memory it shows, when it is one: what `more` opens on the dashboard. */
  id: string | null;
  status: 'loading' | 'ready' | 'error';
  /** The title in full, when the item names a memory. */
  title: string | null;
  /** The body, unwrapped (the layout wraps it). */
  text: string;
  /** `fact · learned Oct 9`. */
  meta: string | null;
  at: number;
};

/**
 * One thing a mechanism's recent firing was about, as the opened mechanism
 * lists it: a memory's title, or a sentence naming two (`<A> holds over
 * <B>`), never a count. A firing that names nothing is not listed.
 */
export type SidebarMechEvent = {
  /** Unique in the list (`<seq>.<n>`): one firing can name several memories. */
  key: string;
  seq: number;
  at: number;
  /** `faded`, `kept`, `came to mind`: the group's word. */
  word: string;
  /** What it was about, titles read in full. */
  title: string;
  /** The memory it names, when it names one. */
  memoryId: string | null;
  /** What an item that names no memory shows opened (a dream's journal). */
  text: string;
};

/** The mechanism opened in "Mechanisms today", and its recent firings once read. */
export type SidebarMechOpen = {
  id: SidebarMechId;
  status: 'loading' | 'ready' | 'error';
  events: SidebarMechEvent[];
  at: number;
};

/** The newest thing, in plain words (`remembered: …`, `stored: …`): the dim tail under the prompt while the pane is closed. */
export type SidebarLatest = { text: string; mech: SidebarMechId; at: number };

/** What `scope` says this folder is set to, or why it could not be asked. */
export type SidebarScope = {
  /** `on`, `paused`, `off`, `observer`, `unset`; `unknown` before the first read. */
  mode: string;
  /** True when this folder's own entry holds the mode (not an ancestor's, not unset). */
  own: boolean;
  /** The folder whose entry governs here, when one does. */
  setBy: string | null;
  /** This folder, as the server names it. */
  dir: string | null;
  error: string | null;
  busy: boolean;
  /**
   * Why the mode is still `unknown`: `unreadable` (the scope registry file the
   * hooks read could not be found or read: no home folder, a read refused), or
   * null (not tried yet, or read). An unknown mode is never drawn as on.
   */
  unread: 'unreadable' | null;
};

/**
 * Where the first meeting stands, as core's `GET /api/onboarding` says it
 * (2026-10-11: core owns the steps and the state; the mod triggers and
 * draws). `unknown`: not read yet, the dashboard down, a 404 (a core from
 * before onboarding) or any other shape: the mod then does nothing about it.
 */
export type SidebarMeet = 'unknown' | 'not_started' | 'offered' | 'later' | 'done' | 'skipped';

export type SidebarOnboarding = {
  meet: SidebarMeet;
  /**
   * Core's answers, passed through as read (never drawn yet): `where` is
   * `every` or `this`, `style` `straight`, `think`, `friendly`, `character`
   * or `other` (core #419); null from the wake's marker, which names only `meet`.
   */
  where: string | null;
  style: string | null;
};

/** A line or two the switch explains itself with, above the switches. */
export type SidebarNote = { text: string; at: number };

/** The mechanisms that fired last, and when: the newest row's own first, then every other one the same read proved. */
export type SidebarFiring = { ids: SidebarMechId[]; at: number };

/**
 * Where the sidebar shows: the pane (`sidebar`), or only the dim tail under
 * the prompt (`quiet`). The strip (one line above the prompt) is gone
 * (2026-10-10); a stored `strip`, like v0.1's `rail` and `hidden`, reads as quiet.
 */
export type SidebarView = 'sidebar' | 'quiet';

/** The brain beside the title: swaying (`turning`), a fixed view that lights when something fires (`still`), or none (`off`). */
export type SidebarBrain = 'turning' | 'still' | 'off';

declare module 'claude-code' {
  interface PluginState {
    counterparts: {
      pulse: SidebarPulse | null;
      /** Whether the dashboard answered the last time it was asked. */
      dash: 'unknown' | 'up' | 'down';
      mind: SidebarMind | null;
      saved: SidebarSaved[];
      today: SidebarToday | null;
      dream: SidebarDream | null;
      open: SidebarOpen | null;
      mech: SidebarMechOpen | null;
      /** A section heading the person clicked while it was folded: kept unfolded until clicked again. */
      focus: string | null;
      latest: SidebarLatest | null;
      /** The mechanisms that fired last, and when: their regions light. */
      firing: SidebarFiring | null;
      search: SidebarSearch;
      scope: SidebarScope;
      /** Claude Code's own memory (MEMORY.md and its prompt section): on unless turned off. */
      claudeMemory: boolean;
      /**
       * Whether the footer draws the Claude memory switch: only for someone
       * who opted in (`COUNTERPARTS_SIDEBAR_CC_MEMORY=1`, or `$.store`
       * `claudeMemorySwitch`, set for whoever had already turned it off).
       */
      claudeMemorySwitch: boolean;
      /** Where the first meeting stands (core's `/api/onboarding`). */
      onboarding: SidebarOnboarding;
      view: SidebarView;
      brain: SidebarBrain;
      /** The pane is placed and showing (opened and not closed since). */
      placed: boolean;
      /** What the Counterparts switch said about a press it would not act on. */
      switchNote: SidebarNote | null;
      /**
       * The confirm row a press on the Counterparts switch opens before a
       * pause or an off (since 2026-10-09: a press meant for the other switch
       * paused a folder): `dir` is the folder it would change, `at` when it
       * opened, `to` what it would set (absent: a pause, as before the
       * three-way switch). Only its [Pause] / [Turn off] calls the scope
       * tool; [Cancel] or 30 s closes it.
       */
      pauseAsk: { dir: string; at: number; to?: 'pause' | 'off' | 'on' } | null;
    };
  }
}
