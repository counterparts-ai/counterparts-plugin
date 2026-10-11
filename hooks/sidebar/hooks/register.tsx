/**
 * The Counterparts sidebar (v0.2): what memory is doing, in 35 columns.
 *
 * A small brain beside the title, the day, the count and a search box; then
 * what was put in front of Claude for the last message (Memories, said in
 * full; Subconscious, titles only), what this session saved, how often each
 * mechanism fired today, and the last dream; then three rows of switches
 * (Counterparts here, Claude Code's own memory; the view; the brain). Closed
 * (`quiet`), it is only a dim tail under the prompt, ending with how to open
 * it again. The design is the round-3 mockups Mike chose on 2026-10-10
 * (`~/counterparts-notes/mockups/2026-10-10-mod-round3/`); ../NOTES.md says
 * where the build differs and why.
 *
 * Where things come from:
 *   - the dashboard (`counterparts dashboard`, or `/counterparts:dashboard`
 *     for a plugin install; http://localhost:4747, or the port
 *     `COUNTERPARTS_DASHBOARD_PORT` names, as core reads it), read
 *     only: day and count (`/api/pulse`), times fired today
 *     (`/api/mechanisms`), the last dream (`/api/dreams`), a memory opened in
 *     place (`/api/memory?id=`), a mechanism's firings (`/api/mechanism?id=`),
 *     and the event feed that lights the brain (`/api/activity`). Never
 *     started from here;
 *   - the scope registry file the hooks read (`scopes.json` beside the
 *     configuration, read-only, `./scopes.ts`): where this folder stands;
 *   - the memory server over MCP, whichever this session connected: `scope`
 *     to pause or resume, after the confirm; `recall` (facts) for search;
 *   - this session: the recall block the classic UserPromptSubmit hook
 *     injects (Memories, Subconscious), and `tool.call` on remember (or
 *     its old name note) / session_end (Saved) and on recall by id (`↗ opened`).
 *
 * The engine lets `$` pass only to functions declared at the top of this
 * file, so everything that touches the engine lives here; the brain, the
 * cells, the feed, the layout and the mechanism table are pure modules beside
 * it, and the body is a Client surface module (`./body.tsx`).
 */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  SidebarBrain,
  SidebarDream,
  SidebarLatest,
  SidebarMind,
  SidebarRow,
  SidebarSaved,
  SidebarScope,
  SidebarSearch,
  SidebarToday,
  SidebarView,
} from '../types'
import type { BodyProps } from './body'
import { Brain } from './brain'
import { encodeCells } from './cells'
import {
  RULES,
  RULE_NAMES,
  classify,
  countToday,
  dateOf,
  decisionFor,
  firingIds,
  firingTitle,
  firstSentence,
  humanDates,
  mechFirings,
  mechsOf,
  openedIds,
  ourTool,
  parseFacts,
  parseRecallBlock,
  payloadOf,
  resolveServer,
  savedItems,
  shortDay,
  shortDir,
  surfacedIds,
  titled,
  wrap,
} from './feed'
import type { DashDream, DashEvent, Firing, RecallBlock } from './feed'
import {
  MECHS,
  dashboardBase,
  dashboardPort,
  dashboardRoutes,
  hex,
  isDashboardUrl,
  mechById,
  memoryUrl,
  stageOf,
} from './mechanisms'
import type { MechId } from './mechanisms'
import { lookup, parentOf, parseRegistry, settingsHookConfig } from './scopes'
import type { RegistryMode } from './scopes'
import { P, clip, layoutBody, quietTail } from './sections'
import type { Line } from './sections'
import { cells } from './width'

// ── constants ───────────────────────────────────────────────────────────────

const PANE = 'counterparts'
const TITLE = 'Counterparts'
/**
 * Body columns the sidebar asks for: 34, which the dock draws 35 wide with its
 * divider (measured in v0.1: `columns: 44` gave a dock 45 wide), the mockups'
 * 35. The body is laid out to 32 text columns inside a column of padding each
 * side.
 */
const OPEN_COLUMNS = 34
/** The brain beside the title, in cells. */
const BRAIN_COLS = 18
const BRAIN_ROWS = 6
/** The header's right column starts this far in: the brain and two blank columns. */
const HEAD_X = BRAIN_COLS + 2
/** "Dim at rest": what is not lit draws at this brightness, so a lit region stands out (the mockups' 0.72). */
const DIM_REST = 0.72
/** Rows of pane body from which the header gets a blank row above it (the mockups at 200x60 have one; at 160x48, not). */
const ROOMY_ROWS = 44
/** The dashboard is read only while the pane is drawn: this often while things happen… */
const POLL_MS = 15000
/** …and this often after four quiet reads in a row. */
const POLL_IDLE_MS = 30000
/** A gap longer than this since the last read starts over from a cold read. */
const STALE_MS = 10 * 60000
/** A switch's note and the pause confirm close by themselves after this. */
const AUTO_CLOSE_MS = 30000
/** How often the folder's registry is read again while no dashboard poll reads it (the pane closed or not shown). */
const SCOPE_RECHECK_MS = 60000
/** How long the registry's path, found from the settings, is trusted before it is looked up again. */
const SCOPES_FILE_TTL_MS = 5 * 60000
/**
 * Cells the quiet tail leaves beside the `hint` prop, so the engine never
 * cuts the ` · /counterparts opens it` at its end. Measured at 160 columns
 * (Claude Code 2.1.296, term-loop): the engine draws its line two cells in,
 * joins the tail with ` · `, keeps three cells clear at the row's end, and
 * draws more than the prop holds: `⏸ manual mode on · ? for shortcuts · ←
 * for agents` (49 cells) for a prop about 30 wide, 19 cells more (auto mode's
 * line, 16 more). 2 + 3 + 3 + 19, and five to spare for a wider line.
 */
const TAIL_SPARE = 32
/** The hover groups that show what a click on each memory switch does, over the rows above the footer. */
const HOVER_CP = 'counterparts-switch-cp'
const HOVER_MEM = 'counterparts-switch-mem'
const FIRING_MS = 2600
/**
 * One event can prove several mechanisms: their pulses go this far apart, so
 * each arc reads as its own. At most four slots: a fifth shares the fourth.
 */
const PULSE_STAGGER_MS = 300
const PULSE_SLOTS = 4
/** The most the turning brain draws a second: a pulse's arc. Swaying it draws every other tick (`Brain.calmFps`), and at rest none. */
const DEFAULT_FPS = 12
/** Events that change the memory count, worth one read of `/api/pulse` (the dear one). */
const COUNT_EVENTS = new Set(['gate.deposit', 'gate.chunk', 'memory.pruned', 'memory.merged', 'dream.changed', 'contradiction.settled'])
/**
 * A dashboard older than v0.2 says no `firedToday`: today's counts come from
 * each event's newest rows, this many first, read deeper (doubling) while all
 * of them are today's, to at most FALLBACK_MAX. Only on a cold read; polls add.
 */
const FALLBACK_LIMIT = 150
const FALLBACK_MAX = 1200

/**
 * The brain's cells take the terminal's default background (`bg: null` in
 * `frameCells`), so the panel's own black (`P.panel`) shows through them.
 * Measured: the engine draws a Raster's colours at 4 bits a channel, and the
 * panel colour given to the cells came out `#000011`, a navy box round the
 * brain.
 */
/** The search box: a shade above the panel, so it reads as a field without a border. */
const SEARCH_BG = '#121a22'
const CYAN_DIM = '#0b6f7c'

// ── state (the contract: ../types/index.d.ts) ──────────────────────────────

const IDLE_SEARCH: SidebarSearch = { query: '', status: 'idle', header: '', total: 0, hits: [], error: null }
const UNKNOWN_SCOPE: SidebarScope = { mode: 'unknown', own: false, setBy: null, dir: null, error: null, busy: false, unread: null }
const pulseA = atom({ plugin: 'counterparts', key: 'pulse' } as const, null)
const dashA = atom({ plugin: 'counterparts', key: 'dash' } as const, 'unknown')
const mindA = atom({ plugin: 'counterparts', key: 'mind' } as const, null)
const savedA = atom({ plugin: 'counterparts', key: 'saved' } as const, [])
const todayA = atom({ plugin: 'counterparts', key: 'today' } as const, null)
const dreamA = atom({ plugin: 'counterparts', key: 'dream' } as const, null)
const openA = atom({ plugin: 'counterparts', key: 'open' } as const, null)
const mechA = atom({ plugin: 'counterparts', key: 'mech' } as const, null)
const focusA = atom({ plugin: 'counterparts', key: 'focus' } as const, null)
const latestA = atom({ plugin: 'counterparts', key: 'latest' } as const, null)
const firingA = atom({ plugin: 'counterparts', key: 'firing' } as const, null)
const searchA = atom({ plugin: 'counterparts', key: 'search' } as const, IDLE_SEARCH)
const scopeA = atom({ plugin: 'counterparts', key: 'scope' } as const, UNKNOWN_SCOPE)
const memoryA = atom({ plugin: 'counterparts', key: 'claudeMemory' } as const, true)
const viewA = atom({ plugin: 'counterparts', key: 'view' } as const, 'sidebar')
const brainA = atom({ plugin: 'counterparts', key: 'brain' } as const, 'turning')
const placedA = atom({ plugin: 'counterparts', key: 'placed' } as const, false)
const noteA = atom({ plugin: 'counterparts', key: 'switchNote' } as const, null)
const pauseAskA = atom({ plugin: 'counterparts', key: 'pauseAsk' } as const, null)

// ── the module's own (a reload starts these over; the host keeps the state) ──

const brain = new Brain()
/** The Raster the terminal last mounted: a blit must match its size. */
const raster = { cols: 0, rows: 0, live: false, cells: '', look: '' }
/** What the brain shows besides its turning, refreshed by each drawing. */
const look = { mono: false, still: false, sel: null as MechId | null, firing: [] as readonly MechId[] }
const fps = {
  target: DEFAULT_FPS,
  inFlight: false,
  lastTick: 0,
  /** `performance.now()` of each blit the surface took: the measurement. */
  blits: [] as number[],
  frameMs: [] as number[],
}
const run = {
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
}

// ── pure helpers ────────────────────────────────────────────────────────────

/** Work left running on its own: a reload or the session's end may cut it off, and that is fine. */
function quiet(p: Promise<unknown>): void {
  p.catch(() => undefined)
}

/** Nothing is remembered and nothing comes to mind: paused for now, or set off. */
function isPaused(mode: string): boolean {
  return mode === 'paused' || mode === 'off'
}

/**
 * A stored view, from any version: v0.1's `full` is the sidebar; its `quiet`
 * (a narrow pane), `rail` and `hidden`, and v0.2's first `strip` (one line
 * above the prompt, dropped 2026-10-10), are quiet (no pane, the tail). Read
 * so, never written back: a v0.1 copy reading the same store keeps its word.
 */
function normView(v: unknown): SidebarView {
  return v === 'quiet' || v === 'rail' || v === 'hidden' || v === 'strip' ? 'quiet' : 'sidebar'
}

function normBrain(v: unknown): SidebarBrain {
  return v === 'still' || v === 'off' ? v : 'turning'
}

function achievedFps(): number {
  const now = performance.now()
  const recent = fps.blits.filter(t => now - t < 10000)
  if (recent.length < 2) return 0
  const span = (recent[recent.length - 1] ?? 0) - (recent[0] ?? 0)
  return span <= 0 ? 0 : ((recent.length - 1) * 1000) / span
}

function meanFrameMs(): number {
  if (fps.frameMs.length === 0) return 0
  return fps.frameMs.reduce((a, b) => a + b, 0) / fps.frameMs.length
}

function paceWords(mode: SidebarBrain): string {
  if (mode === 'off') return 'off (no brain, no timer)'
  if (mode === 'still') return 'still (no timer; one frame when something fires, one when it goes out)'
  if (run.brainTimer === null) return run.brainPace === 'rest' ? 'at rest (no timer)' : 'stopped'
  return run.brainPace === 'burst' ? `in a burst (${String(fps.target)} fps)` : `swaying (${(1000 / paceMs('calm')).toFixed(0)} fps)`
}

function fpsReport(mode: SidebarBrain): string {
  if (fps.blits.length < 2) {
    return `Brain: no frames measured yet (target ${String(fps.target)} fps), now ${paceWords(mode)}. It draws only while the sidebar shows in a terminal and something moves; ask again in a few seconds.`
  }
  return `Brain: ${achievedFps().toFixed(1)} fps achieved over the last 10 s (target ${String(fps.target)}), now ${paceWords(mode)}; a frame takes ${meanFrameMs().toFixed(2)} ms to compute.`
}

/**
 * The status line: only a warning. A folder paused or off says so in every
 * session there, whatever the view (`⚠ counterparts:` and amber are the
 * engine's); the normal case has no status line at all (v0.2).
 */
function statusFor(scope: SidebarScope, memoryOff: boolean): string | undefined {
  if (!isPaused(scope.mode)) return undefined
  const parts =
    scope.mode === 'paused'
      ? ['⏸ Counterparts memory paused in this folder', scope.own ? '/counterparts resume' : `resume it in ${shortDir(scope.setBy)}`]
      : ['◌ Counterparts memory off in this folder']
  if (memoryOff) parts.push('Claude memory off')
  return parts.join(' · ')
}

/** What the brain shows besides its turning: a frame drawn under another look is not reused. */
function lookKey(): string {
  return `${String(look.mono)}|${String(look.still)}|${look.sel ?? ''}|${look.firing.join(',')}`
}

function frameCells(cols: number, rows: number, now: number): string {
  if (look.still) {
    // The still brain: a fixed view, lit only while something fires (or a mechanism is opened).
    brain.dark()
    for (const id of new Set([...look.firing, ...(look.sel === null ? [] : [look.sel])])) {
      const m = mechById(id)
      if (m !== undefined && !look.mono) brain.flash(m.region, stageOf(m.id).col)
    }
  } else if (look.sel !== null) {
    const m = mechById(look.sel)
    if (m !== undefined) brain.light(m.region, stageOf(m.id).col)
  }
  const t0 = performance.now()
  const cells = encodeCells(brain.frame(cols, rows, now, { mono: look.mono, tag: null, bg: null, dimRest: DIM_REST }))
  fps.frameMs.push(performance.now() - t0)
  if (fps.frameMs.length > 120) fps.frameMs.shift()
  return cells
}

function fireBrain(mech: MechId, now: number): void {
  const m = mechById(mech)
  if (m === undefined || look.mono || look.still) return
  brain.pulse(m.region, stageOf(m.id).col, now, mech === 'retrieval' ? 'prefrontal' : 'thalamus')
}

/**
 * Every mechanism a read proved, one pulse each: the first at once, the rest
 * PULSE_STAGGER_MS apart, so they read as separate arcs. Two that would draw
 * the same arc (one region in one stage colour: Dreaming and Consolidation)
 * pulse once.
 */
function firePulses($: EngineInterface, ids: readonly MechId[]): void {
  const arcs = new Set<string>()
  for (const id of ids) {
    const m = mechById(id)
    if (m === undefined) continue
    const arc = `${m.region}:${m.stage}:${id === 'retrieval' ? 'prefrontal' : 'thalamus'}`
    if (arcs.has(arc)) continue
    const delay = Math.min(arcs.size, PULSE_SLOTS - 1) * PULSE_STAGGER_MS
    arcs.add(arc)
    if (delay === 0) fireBrain(id, Date.now())
    else $.clock.after(delay, () => fireBrain(id, Date.now()))
  }
}

/**
 * The brain-off header's `◉` while something fires: the mechanism's stage
 * colour, but never Retrieval's amber, which in this pane says only a warning
 * (Mike, 2026-10-10): cyan then.
 */
function litDot(id: MechId): string {
  const st = stageOf(id)
  return st.id === 'retrieval' ? P.cyan : hex(st.col, 0.95)
}

function trimSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

/**
 * What the switch says instead of acting, by where the folder stands. It acts
 * only on a folder whose OWN entry holds the mode: pausing anything else would
 * leave an entry of its own behind when resumed (the `scope` tool can set
 * on, observer, off, pause and resume, not "unset"), and it never turns an
 * `off` folder on.
 */
function switchExplains(scope: SidebarScope): string | null {
  const here = scope.dir ?? 'this folder'
  if (scope.mode === 'off') {
    return scope.own || scope.setBy === null
      ? `This folder is set off: nothing is remembered here and nothing comes to mind. The switch won't turn it back on; \`counterparts scope ${here} --on\` does.`
      : `This folder is off because ${scope.setBy} is set off. The switch won't turn it back on; \`counterparts scope ${scope.setBy} --on\` does.`
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
function scopeHover(scope: SidebarScope): string {
  if (scope.mode === 'unknown') return 'Not read yet: a click checks this folder, changing nothing.'
  if (switchExplains(scope) !== null) return "This switch can't change this folder. A click says why."
  if (scope.mode === 'paused') return 'Paused in this folder, for every session. A click resumes it.'
  if (scope.mode === 'observer') return 'Reads only here; a click pauses all sessions here (asks first).'
  return 'A click pauses Counterparts here for every session (asks first).'
}

/** What a click on the Claude Code memory switch does: whole sentences in two rows of 32. */
function memoryHover(on: boolean): string {
  return on ? "Claude Code's MEMORY.md: a click turns it off in every session." : "Claude Code's own memory is off everywhere. A click turns it on."
}

/**
 * The header's count, whole: `1000 memories` (13 cells, the header's text
 * column widened by one for it). From 10,000, `10k+ memories`, still 13: the
 * exact number is on the dashboard.
 */
function memoriesCount(n: number): string {
  return n >= 10000 ? `${String(Math.floor(n / 1000))}k+ memories` : `${String(n)} memories`
}

/** The newest thing in plain words, for the tail. */
function words(kind: 'remembered' | 'subconscious' | 'stored' | 'opened' | 'dreamed', what: string): string {
  return `${kind}: ${what}`
}

/** The memory text an opened item shows, and the line saying what it is. */
function memoryMeta(d: { kind?: unknown; learnedOn?: unknown; journal?: unknown }): string | null {
  const kind = d.journal === true ? 'journal' : typeof d.kind === 'string' ? d.kind : null
  // `Oct 9`, with the year only when it is not this one.
  const thisYear = String(new Date().getFullYear())
  const learned = typeof d.learnedOn === 'string' ? shortDay(d.learnedOn.startsWith(`${thisYear}-`) ? d.learnedOn.slice(5) : d.learnedOn) : ''
  if (kind === null) return null
  return learned === '' ? kind : `${kind} · learned ${learned}`
}

// ── the engine, through `$` ────────────────────────────────────────────────

/** The dashboard's port, as core's server picks it when no `--port` is given (`mechanisms.ts#dashboardPort`). */
async function dashPort($: EngineInterface): Promise<number> {
  if (run.port !== null) return run.port
  let raw: string | undefined
  try {
    raw = await $.env.get('COUNTERPARTS_DASHBOARD_PORT')
  } catch {
    raw = undefined
  }
  run.port = dashboardPort(raw)
  return run.port
}

async function dashUrl($: EngineInterface): Promise<string> {
  return dashboardBase(await dashPort($))
}

async function fetchJson($: EngineInterface, path: string): Promise<unknown> {
  const r = await $.http.fetch(`${await dashUrl($)}${path}`)
  if (!r.ok) throw new Error(`the dashboard answered ${String(r.status)}`)
  return JSON.parse(r.text) as unknown
}

/** Claude Code's own memory, as stored: one preference across sessions, on unless turned off. */
async function claudeMemoryOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('claudeMemory')) !== false
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const [scope, memoryOn] = await Promise.all([read($, scopeA), claudeMemoryOn($)])
  $.ui.status(statusFor(scope, !memoryOn))
}

/** The memory server this session connected: the npm install's first, then the plugin's. */
async function memoryServer($: EngineInterface): Promise<string | null> {
  if (run.server !== null) return run.server
  try {
    const tools = await $.tool.list()
    run.server = resolveServer(tools.filter(t => t.mcp).map(t => t.name))
  } catch {
    run.server = null
  }
  return run.server
}

async function callMemory($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<{ payload: Record<string, unknown> | null; isError: boolean }> {
  const server = await memoryServer($)
  if (server === null) throw new Error('no Counterparts memory server is connected in this session')
  const r = await $.mcp.call(server, tool, args)
  const text = r.content.find(b => b.type === 'text')?.text
  return { payload: payloadOf(text), isError: r.isError === true }
}

/** The mechanisms new rows prove light up: the turning brain pulses, the still one lights (both through `firing`). */
async function fire($: EngineInterface, ids: readonly MechId[]): Promise<void> {
  if (ids.length === 0) return
  const now = await $.clock.now()
  firePulses($, ids)
  await update($, firingA, () => ({ ids: [...ids], at: now }))
  $.clock.after(FIRING_MS + 100, () => $.ui.invalidate('ui.render'))
}

async function setLatest($: EngineInterface, text: string, mech: MechId): Promise<void> {
  await setLatestAt($, text, mech, await $.clock.now())
}

async function setLatestAt($: EngineInterface, text: string, mech: MechId, at: number): Promise<void> {
  const next: SidebarLatest = { text, mech, at }
  await update($, latestA, l => (l !== null && l.at > at ? l : next))
}

/** Day and count from `/api/pulse`: about 130 ms of the dashboard's time, so read only when they may have moved. */
async function readPulse($: EngineInterface): Promise<{ lastSeq: number }> {
  const pulse = (await fetchJson($, '/api/pulse')) as { day: number; memories: number; lastSeq: number }
  const before = await read($, pulseA)
  if (before === null || before.day !== pulse.day || before.memories !== pulse.memories || before.lastSeq !== pulse.lastSeq) {
    await update($, pulseA, () => ({ day: pulse.day, memories: pulse.memories, lastSeq: pulse.lastSeq }))
  }
  return { lastSeq: pulse.lastSeq }
}

/**
 * Times each mechanism fired today. The dashboard says it (`firedToday` on
 * `/api/mechanisms`, about 30-50 ms) from v0.2 on; an older one is counted
 * here from each event's newest rows (a cold read only; polls then add):
 * only rows up to `upTo`, the seq the polls go on from, so a row that lands
 * while this reads is counted by the next poll, not twice.
 */
async function readToday($: EngineInterface, upTo: number): Promise<void> {
  const asked = dateOf(await $.clock.now())
  const view = (await fetchJson($, '/api/mechanisms')) as { today?: unknown; mechanisms?: { id: string; firedToday?: unknown }[] }
  const list = view.mechanisms ?? []
  run.countedOn = asked
  if (typeof view.today === 'string' && list.some(m => 'firedToday' in m)) {
    run.firedToday = true
    const counts: SidebarToday['counts'] = {}
    for (const m of MECHS) {
      const v = list.find(x => x.id === m.id)?.firedToday
      counts[m.id] = typeof v === 'number' ? v : null
    }
    await update($, todayA, () => ({ date: view.today as string, counts, source: 'dashboard' as const }))
    return
  }
  run.firedToday = false
  const date = dateOf(await $.clock.now())
  // Each name's newest rows, read again twice as deep while every row read is still today's,
  // up to FALLBACK_MAX: a busy day's turns (about 250 on 2026-10-10) are counted whole.
  const todays = async (name: string): Promise<DashEvent[]> => {
    for (let limit = FALLBACK_LIMIT; ; limit *= 2) {
      const a = (await fetchJson($, `/api/activity?name=${encodeURIComponent(name)}&limit=${String(limit)}`).catch(() => null)) as { events?: DashEvent[] } | null
      const events = a?.events ?? []
      const oldest = events.reduce((m, e) => Math.min(m, e.at), Infinity)
      if (events.length < limit || dateOf(oldest) !== date || limit * 2 > FALLBACK_MAX) return events
    }
  }
  const answers = await Promise.all(RULE_NAMES.map(todays))
  const rows: SidebarRow[] = []
  for (const events of answers) {
    for (const e of events) {
      if (e.seq > upTo) continue
      const r = classify(e, run.session, run.startedAt)
      if (r !== null) rows.push(r)
    }
  }
  const { counts, dreams } = countToday(rows, date, dateOf)
  await update($, todayA, () => ({ date, counts, source: 'feed' as const, dreams }))
}

/** New rows from a poll, into today's counts: the dashboard asked again, or (an older one) added here. */
async function addToday($: EngineInterface, rows: readonly SidebarRow[]): Promise<void> {
  const today = await read($, todayA)
  const date = dateOf(await $.clock.now())
  // A new calendar day starts the count over, new rows or none: else yesterday's bars stand as today's until something fires.
  if (today !== null && run.countedOn !== date) {
    await readToday($, run.lastSeq)
    return
  }
  if (rows.length === 0) return
  if (run.firedToday === true || today === null) {
    await readToday($, run.lastSeq)
    return
  }
  const { counts, dreams } = countToday(rows, date, dateOf, today.counts, today.dreams ?? [])
  await update($, todayA, () => ({ ...today, counts, dreams }))
}

/**
 * The newest dream (`/api/dreams?limit=1`), in its own voice: its first
 * sentence and what follows. No "what changed that night" counts (Mike,
 * 2026-10-10): the room goes to the dream itself.
 */
async function readDream($: EngineInterface): Promise<void> {
  const view = (await fetchJson($, '/api/dreams?limit=1')) as { dreams?: DashDream[] }
  const d = view.dreams?.[0]
  if (d === undefined || typeof d.journal !== 'string' || d.journal.trim() === '') {
    await update($, dreamA, () => null)
    return
  }
  const journaled = await fetchJson($, '/api/activity?name=dream.journaled&limit=5').then(a => (a as { events?: DashEvent[] }).events ?? [], () => [] as DashEvent[])
  const atOf = journaled.find(e => e.subject === d.id)?.at ?? null
  const { first, rest } = firstSentence(d.journal)
  const next: SidebarDream = { id: d.id, at: atOf, date: d.date, first, rest }
  const before = await read($, dreamA)
  if (before === null || before.id !== next.id || before.at !== next.at || before.rest !== next.rest) {
    await update($, dreamA, () => next)
  }
  // A dream newer than anything this session did is the newest thing (the tail).
  const at = next.at
  if (at !== null) {
    const latest = await read($, latestA)
    if (latest === null || latest.at < at) await setLatestAt($, words('dreamed', next.first), 'dreaming', at)
  }
}

/**
 * One look at the dashboard. Cold (first, or after a long gap): the pulse,
 * today's counts and the last dream. Warm: only what is new since the last
 * seq (`/api/activity?sinceSeq=`, about 20 ms): it lights the brain, moves
 * today's counts, and reads the dream again when a dream landed. Says whether
 * anything new arrived.
 */
async function poll($: EngineInterface): Promise<boolean> {
  if (run.polling) return false
  run.polling = true
  try {
    const now = Date.now()
    const stale = run.lastPollAt > 0 && now - run.lastPollAt > STALE_MS
    run.lastPollAt = now
    if (!run.cold || run.lastSeq < 0 || stale) {
      const { lastSeq } = await readPulse($)
      if ((await read($, dashA)) !== 'up') await update($, dashA, () => 'up')
      const seed = run.seeded ? Promise.resolve() : seedSession($)
      run.seeded = true
      await Promise.all([readToday($, lastSeq).catch(() => undefined), readDream($).catch(() => undefined), seed.catch(() => undefined)])
      run.cold = true
      run.lastSeq = lastSeq
      return true
    }
    const view = (await fetchJson($, `/api/activity?sinceSeq=${String(run.lastSeq)}`)) as { events?: DashEvent[]; lastSeq?: number }
    if ((await read($, dashA)) !== 'up') await update($, dashA, () => 'up')
    const events = (view.events ?? []).filter(e => e.seq > run.lastSeq)
    if (typeof view.lastSeq === 'number' && view.lastSeq > run.lastSeq) run.lastSeq = view.lastSeq
    const rows = events.map(e => classify(e, run.session, run.startedAt)).filter((r): r is SidebarRow => r !== null)
    const lit = [...new Set(rows.filter(r => r.who !== 'other').sort((a, b) => b.at - a.at).flatMap(mechsOf))]
    await fire($, lit)
    await addToday($, rows).catch(() => undefined)
    if (events.some(e => e.name === 'dream.journaled' || e.name === 'dream.changed')) await readDream($).catch(() => undefined)
    const pulse = await read($, pulseA)
    const newDay = events.some(e => typeof e.day === 'number' && pulse !== null && e.day > pulse.day)
    if (newDay || events.some(e => COUNT_EVENTS.has(e.name))) await readPulse($)
    // The Claude memory switch is one preference for every session: follow a change made in another.
    const stored = await claudeMemoryOn($)
    if (stored !== (await read($, memoryA))) {
      await update($, memoryA, () => stored)
      $.ui.invalidate('prompt.section')
      $.ui.invalidate('prompt.context')
      await refreshStatus($)
    }
    return events.length > 0
  } catch {
    if ((await read($, dashA)) !== 'down') await update($, dashA, () => 'down')
    return false
  } finally {
    run.polling = false
  }
}

/** The pane is placed and the one shown: the only time the dashboard is polled and the brain drawn. */
async function paneShown($: EngineInterface): Promise<boolean> {
  try {
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    return pane !== undefined && pane.isShown && pane.isPlaced
  } catch {
    return false
  }
}

/** Reads the dashboard while the pane shows, faster while things happen; stops when it doesn't (a drawing starts it again). */
async function pollLoop($: EngineInterface): Promise<void> {
  if ((await read($, viewA)) !== 'sidebar' || !(await paneShown($))) {
    run.pollArmed = false
    return
  }
  const moved = await poll($)
  await refreshScope($)
  run.quietPolls = moved ? 0 : run.quietPolls + 1
  $.clock.after(run.quietPolls >= 4 ? POLL_IDLE_MS : POLL_MS, () => quiet(pollLoop($)))
}

function armPolling($: EngineInterface, delayMs: number): void {
  if (run.pollArmed) return
  run.pollArmed = true
  $.clock.after(delayMs, () => quiet(pollLoop($)))
}

// ── this session's own: the recall block, the memory tools ─────────────────

/**
 * The recall block for the person's message: Memories (the "Came to mind"
 * lane, said in full) and Subconscious (the "Quietly available" lane). The
 * block names a surfaced memory by its gist only; its title comes from the
 * dashboard's decision row for this turn (its `surfaced` ids) and then
 * `/api/memory?id=` (reads that write nothing). Until then, or with the
 * dashboard down, the gist stands: it is the text Claude was shown.
 */
async function onRecallBlock($: EngineInterface, block: RecallBlock): Promise<void> {
  if (block.surfaced.length + block.footnotes.length === 0) return
  const at = await $.clock.now()
  const mind: SidebarMind = {
    turn: block.turn,
    at,
    surfaced: block.surfaced.map(g => ({ id: null, title: g })),
    footnotes: block.footnotes.map(f => ({ id: f.id, title: f.title })),
  }
  await update($, mindA, () => mind)
  await update($, openA, o => (o !== null && (o.key.startsWith('mem:') || o.key.startsWith('sub:')) ? null : o))
  const firstSurfaced = mind.surfaced[0]
  const firstFoot = mind.footnotes[0]
  if (firstSurfaced !== undefined) await setLatest($, words('remembered', firstSurfaced.title), 'retrieval')
  else if (firstFoot !== undefined) await setLatest($, words('subconscious', firstFoot.title), 'retrieval')
  await fire($, ['retrieval'])
  if (block.surfaced.length > 0 && (await read($, dashA)) !== 'down') quiet(titleSurfaced($, block.turn))
}

/**
 * The surfaced memories' ids and titles, from the dashboard: once now, and
 * once more a moment later (a timer, not a wait inside the hook that made the
 * block) if the turn's row was not written yet.
 */
async function titleSurfaced($: EngineInterface, turn: number, again = true): Promise<void> {
  if (run.session === '') run.session = await $.session.id()
  let events: DashEvent[] = []
  try {
    events = ((await fetchJson($, '/api/activity?name=recall.decision&limit=8')) as { events?: DashEvent[] }).events ?? []
  } catch {
    return
  }
  const row = decisionFor(events, run.session, turn)
  if (row === undefined) {
    if (again) $.clock.after(1500, () => quiet(titleSurfaced($, turn, false)))
    return
  }
  const ids = surfacedIds(row)
  const titles = await Promise.all(ids.map(id => memoryTitle($, id)))
  const mind = await read($, mindA)
  if (mind === null || mind.turn !== turn) return
  const surfaced = mind.surfaced.map((s, i) => ({ id: ids[i] ?? s.id, title: titles[i] ?? s.title }))
  await update($, mindA, m => (m === null || m.turn !== turn ? m : { ...m, surfaced }))
  const first = surfaced[0]
  const latest = await read($, latestA)
  if (first !== undefined && latest !== null && latest.text.startsWith('remembered: ') && latest.at >= mind.at) {
    await update($, latestA, l => (l === null ? l : { ...l, text: words('remembered', first.title) }))
  }
}

/** A memory's title, from the dashboard (a read), or null. */
async function memoryTitle($: EngineInterface, id: string): Promise<string | null> {
  try {
    const d = (await fetchJson($, `/api/memory?id=${encodeURIComponent(id)}`)) as { found?: boolean; title?: string }
    return d.found === true && typeof d.title === 'string' && d.title !== '' ? d.title : null
  } catch {
    return null
  }
}

/**
 * On the first dashboard read, when this module has seen nothing of the
 * session yet (a resumed session, a pane opened after a reload that lost
 * nothing but the module): Memories, Subconscious and Saved from the
 * dashboard's rows for the session, read only. The session is this one; a
 * preview or a check may name another with `COUNTERPARTS_SIDEBAR_SESSION`
 * (the term-loop shots do, since their session sends no message).
 */
async function seedSession($: EngineInterface): Promise<void> {
  const preview = ((await $.env.get('COUNTERPARTS_SIDEBAR_SESSION')) ?? '').trim()
  // The pane can draw (and this run, once a module life) before session.start has named the session.
  const session = preview !== '' ? preview : run.session !== '' ? run.session : await $.session.id().catch(() => '')
  if (session === '') return
  const [mind0, saved0] = await Promise.all([read($, mindA), read($, savedA)])
  const rowsOf = async (q: string): Promise<DashEvent[]> =>
    ((await fetchJson($, `/api/activity?name=${q}`).catch(() => null)) as { events?: DashEvent[] } | null)?.events ?? []
  const ofSession = (e: DashEvent): boolean => e.detail?.some(d => (d.key === 'session' || d.key === 'actorId') && d.value === session) === true
  if (mind0 === null) {
    const decision = (await rowsOf('recall.decision&limit=200')).filter(ofSession).find(e => classify(e)?.mechs.includes('retrieval') === true)
    if (decision !== undefined) {
      const surfaced = surfacedIds(decision)
      let footnotes: string[] = []
      try {
        const list: unknown = JSON.parse(decision.detail?.find(d => d.key === 'footnotes')?.value ?? '[]')
        if (Array.isArray(list)) footnotes = list.map(x => (x as { id?: unknown })?.id).filter((x): x is string => typeof x === 'string')
      } catch {
        footnotes = []
      }
      const titles = await Promise.all([...surfaced, ...footnotes].map(id => memoryTitle($, id)))
      const ref = (id: string, i: number) => ({ id, title: titles[i] ?? id })
      const turn = Number(decision.detail?.find(d => d.key === 'turn')?.value ?? 0)
      const mind: SidebarMind = {
        turn: Number.isFinite(turn) ? turn : 0,
        at: decision.at,
        surfaced: surfaced.map((id, i) => ref(id, i)),
        footnotes: footnotes.map((id, i) => ref(id, surfaced.length + i)),
      }
      if (mind.surfaced.length + mind.footnotes.length > 0) await update($, mindA, m => m ?? mind)
    }
  }
  if (saved0.length === 0) {
    const [deposits, settles] = await Promise.all([rowsOf('gate.deposit&limit=150'), rowsOf('contradiction.settled&limit=60')])
    const mine = deposits.filter(e => ofSession(e) && Number(e.detail?.find(d => d.key === 'accepted')?.value ?? 0) > 0)
    const items = await Promise.all(
      mine.slice(0, 12).map(async (e): Promise<SidebarSaved | null> => {
        const row = classify(e)
        const id = row?.memory?.id ?? null
        if (id === null) return null
        const settle = settles.find(s => ofSession(s) && titled(s.detail?.find(d => d.key === 'holds')?.value).id === id && s.detail?.some(d => d.key === 'how' && d.value !== 'open') === true)
        const over = settle === undefined ? null : titled(settle.detail?.find(d => d.key === 'over')?.value)
        const title = (await memoryTitle($, id)) ?? row?.memory?.title ?? id
        const replaces = over === null || over.id === null ? null : ((await memoryTitle($, over.id)) ?? over.title)
        return { key: `seq:${String(e.seq)}`, id, title, at: e.at, replaces, replacesId: over?.id ?? null, kind: over === null ? 'new' : 'update' }
      }),
    )
    const list = items.filter((x): x is SidebarSaved => x !== null).sort((a, b) => b.at - a.at)
    if (list.length > 0) await update($, savedA, s => (s.length === 0 ? list : s))
  }
  // The newest of what was found, as the tail says it, unless something newer is known.
  const [mind, saved] = await Promise.all([read($, mindA), read($, savedA)])
  const said = mind?.surfaced[0] !== undefined ? words('remembered', mind.surfaced[0].title) : mind?.footnotes[0] !== undefined ? words('subconscious', mind.footnotes[0].title) : null
  const s = saved[0]
  if (s !== undefined && (mind === null || s.at > mind.at)) await setLatestAt($, words('stored', s.title), 'salience', s.at)
  else if (mind !== null && said !== null) await setLatestAt($, said, 'retrieval', mind.at)
}

/** What a memory tool saved: "Saved this session", newest first; an update's old title read from the dashboard. */
async function onSaved($: EngineInterface, items: readonly SidebarSaved[]): Promise<void> {
  if (items.length === 0) return
  await update($, savedA, list => [...[...items].reverse(), ...list])
  const first = items[0]
  if (first !== undefined) {
    await setLatest($, items.length === 1 ? words('stored', first.title) : `stored ${String(items.length)} memories: ${first.title}`, 'salience')
  }
  await fire($, items.some(i => i.kind === 'update') ? ['salience', 'reconsolidation'] : ['salience'])
  for (const it of items) {
    if (it.replacesId === null) continue
    const id = it.replacesId
    quiet(
      fetchJson($, `/api/memory?id=${encodeURIComponent(id)}`).then(async d => {
        const title = (d as { found?: boolean; title?: string }).found === true ? (d as { title?: string }).title : undefined
        if (typeof title !== 'string' || title === '') return
        await update($, savedA, list => list.map(s => (s.key === it.key ? { ...s, replaces: title } : s)))
      }),
    )
  }
}

/** A `recall` that opened memories by address: the footnotes it names get `↗ opened`. */
async function onOpened($: EngineInterface, ids: readonly string[], handle: string | null): Promise<void> {
  const mind = await read($, mindA)
  if (mind === null) return
  const hit = (f: { id: string | null; title: string }): boolean => (f.id !== null && ids.includes(f.id)) || (handle !== null && f.title.trim().toLowerCase() === handle.toLowerCase())
  if (!mind.footnotes.some(hit) && !mind.surfaced.some(hit)) return
  await update($, mindA, m =>
    m === null ? m : { ...m, footnotes: m.footnotes.map(f => (hit(f) ? { ...f, opened: true } : f)), surfaced: m.surfaced.map(s => (hit(s) ? { ...s, opened: true } : s)) },
  )
  const named = mind.footnotes.find(hit) ?? mind.surfaced.find(hit)
  if (named !== undefined) await setLatest($, words('opened', named.title), 'retrieval')
}

// ── a click in the body ────────────────────────────────────────────────────

/**
 * Opens a memory in place, every time, whatever its length: its title, text
 * and kind from `/api/memory?id=` (a read; it credits and counts nothing,
 * unlike the `recall` tool, and a Subconscious item is read this way too).
 * A click never opens the dashboard by itself (Mike, 2026-10-10): the layout
 * shows up to 20 lines and ends a longer text with `more`, the one link to
 * the memory's card there. Clicked again, it closes.
 */
async function openMemory($: EngineInterface, key: string, id: string | null, fallback: string): Promise<void> {
  const cur = await read($, openA)
  if (cur !== null && cur.key === key) {
    await update($, openA, () => null)
    return
  }
  const at = await $.clock.now()
  if (id === null) {
    // Named only by the words Claude was shown (the dashboard did not say which memory): those words, in place.
    await update($, openA, () => ({ key, id: null, status: 'ready' as const, title: fallback, text: '', meta: null, at }))
    return
  }
  await update($, openA, () => ({ key, id, status: 'loading' as const, title: null, text: '', meta: null, at }))
  try {
    const d = (await fetchJson($, `/api/memory?id=${encodeURIComponent(id)}`)) as {
      found?: boolean; title?: string; text?: string; kind?: string; learnedOn?: string; journal?: boolean; absence?: string | null
    }
    if (d.found !== true) {
      await update($, openA, o => (o?.key === key && o.at === at ? { ...o, status: 'error' as const, title: fallback, text: d.absence ?? 'no longer in memory' } : o))
      return
    }
    const title = d.title ?? fallback
    const text = (d.text ?? '').trim()
    const meta = memoryMeta(d)
    await update($, openA, o => (o?.key === key && o.at === at ? { key, id, status: 'ready' as const, title, text, meta, at } : o))
  } catch {
    await update($, openA, o => (o?.key === key && o.at === at ? { ...o, status: 'error' as const, title: fallback, text: '' } : o))
  }
}

/**
 * A mechanism in "Mechanisms today": what its recent firings were about,
 * from `/api/mechanism?id=` (one read), grouped by what and when: the
 * memories they name, titles read whole from `/api/memory?id=`, and for a
 * dream's rows the dream's own changes (`/api/dreams`, which names the
 * memories its row only counts). All reads. A firing that names nothing is
 * left out (`feed.ts#mechFirings`).
 */
async function openMech($: EngineInterface, id: MechId): Promise<void> {
  const cur = await read($, mechA)
  await update($, openA, o => (o !== null && o.key.startsWith('ev:') ? null : o))
  if (cur !== null && cur.id === id) {
    await update($, mechA, () => null)
    return
  }
  const at = await $.clock.now()
  await update($, mechA, () => ({ id, status: 'loading' as const, events: [], at }))
  try {
    const panel = (await fetchJson($, `/api/mechanism?id=${encodeURIComponent(id)}`)) as { activity?: DashEvent[] }
    const activity = panel.activity ?? []
    const dreams = activity.some(e => e.name.startsWith('dream.'))
      ? (((await fetchJson($, '/api/dreams?limit=3').catch(() => null)) as { dreams?: DashDream[] } | null)?.dreams ?? [])
      : []
    let firings = mechFirings(activity, id, dreams, 8)
    // The panel shows four lines, its repeats merged into one (Salience's deposits all narrate alike, so one
    // memory), from 200 rows an event name (Emotion's mood-matched recalls are sparse: the first of today's 27
    // was the 321st decision, 2026-10-10). A mechanism that fired today and names fewer than three there reads
    // its own rows deeper, as today's counts do.
    const want = Math.min(3, (await read($, todayA))?.counts[id] ?? 0)
    if (firings.length < want) firings = await deeperFirings($, id, activity, dreams, want)
    const ids = [...new Set(firings.flatMap(firingIds))]
    const read1 = await Promise.all(ids.map(async x => [x, await memoryTitle($, x)] as const))
    const titles: Record<string, string> = {}
    for (const [x, t] of read1) if (t !== null) titles[x] = t
    const events = firings.flatMap(f => {
      const title = firingTitle(f, titles)
      return title === null ? [] : [{ key: f.key, seq: f.seq, at: f.at, word: f.word, title, memoryId: f.memoryId, text: f.text }]
    })
    await update($, mechA, m => (m !== null && m.id === id && m.at === at ? { ...m, status: 'ready' as const, events } : m))
  } catch {
    await update($, mechA, m => (m !== null && m.id === id && m.at === at ? { ...m, status: 'error' as const } : m))
  }
}

/** Event names whose rows name nothing (`feed.ts#mechFirings`) or need a dream read: not worth reading deeper. */
const NAMES_NOTHING = new Set(['mcp.recall', 'associate.flush', 'contradiction.flagged', 'sleep.cycle', 'dream.journaled', 'dream.changed'])

/**
 * A mechanism's firings from the panel's rows and its own (`/api/activity?name=`,
 * reads), FALLBACK_LIMIT first, twice as deep while fewer than `want` name a
 * memory, to at most FALLBACK_MAX: only on a click, only when the panel named
 * fewer than that.
 */
async function deeperFirings($: EngineInterface, id: MechId, panel: readonly DashEvent[], dreams: readonly DashDream[], want: number): Promise<Firing[]> {
  const names = [...new Set(RULES.filter(r => r.mech === id && !NAMES_NOTHING.has(r.name)).map(r => r.name))]
  let firings = mechFirings(panel, id, dreams, 8)
  if (names.length === 0) return firings
  for (let limit = FALLBACK_LIMIT; ; limit *= 2) {
    const answers = await Promise.all(
      names.map(n => fetchJson($, `/api/activity?name=${encodeURIComponent(n)}&limit=${String(limit)}`).then(a => (a as { events?: DashEvent[] }).events ?? [], () => [] as DashEvent[])),
    )
    const seen = new Set<number>()
    const rows = [...panel, ...answers.flat()].filter(e => (seen.has(e.seq) ? false : (seen.add(e.seq), true)))
    firings = mechFirings(rows, id, dreams, 8)
    if (firings.length >= want || answers.every(a => a.length < limit) || limit * 2 > FALLBACK_MAX) return firings
  }
}

/** A click on a row of the body, by the key the layout gave it. */
async function clickBody($: EngineInterface, key: string): Promise<void> {
  if (key === 'search:clear') {
    await runSearch($, '')
    return
  }
  // The `more` that ends a cut text: the one click that opens the dashboard, on that memory.
  if (key.startsWith('more:')) {
    const id = key.slice(5)
    if (/^mem_[A-Za-z0-9]+$/.test(id)) await openUrl($, memoryUrl(id, await dashUrl($)))
    return
  }
  if (key.startsWith('head:')) {
    const section = key.slice(5)
    await update($, focusA, f => (f === section ? null : section))
    return
  }
  if (key === 'dream') {
    const at = await $.clock.now()
    const cur = await read($, openA)
    await update($, openA, () => (cur?.key === 'dream' ? null : { key, id: null, status: 'ready' as const, title: null, text: '', meta: null, at }))
    return
  }
  if (key.startsWith('mech:')) {
    const id = key.slice(5) as MechId
    if (mechById(id) !== undefined && mechById(id)?.notBuilt !== true) await openMech($, id)
    return
  }
  const mind = await read($, mindA)
  if (key.startsWith('mem:') || key.startsWith('sub:')) {
    const list = key.startsWith('mem:') ? mind?.surfaced : mind?.footnotes
    const r = list?.[Number(key.slice(4))]
    if (r !== undefined) await openMemory($, key, r.id, r.title)
    return
  }
  if (key.startsWith('saved:')) {
    const it = (await read($, savedA)).find(s => `saved:${s.key}` === key)
    if (it !== undefined) await openMemory($, key, it.id, it.title)
    return
  }
  if (key.startsWith('ev:')) {
    const mech = await read($, mechA)
    const ev = mech?.events.find(e => `ev:${e.key}` === key)
    if (ev === undefined) return
    if (ev.memoryId !== null) await openMemory($, key, ev.memoryId, ev.title)
    else {
      const cur = await read($, openA)
      const at = await $.clock.now()
      await update($, openA, () => (cur?.key === key ? null : { key, id: null, status: 'ready' as const, title: null, text: '', meta: null, at }))
    }
    return
  }
  if (key.startsWith('hit:')) {
    const cur = await read($, openA)
    const at = await $.clock.now()
    await update($, openA, () => (cur?.key === key ? null : { key, id: key.slice(4), status: 'ready' as const, title: null, text: '', meta: null, at }))
  }
}

// ── the folder's switch ────────────────────────────────────────────────────

function scopeOf(payload: Record<string, unknown> | null, isError: boolean, before: SidebarScope): SidebarScope {
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

/** Asks the memory server where this folder stands: only when the registry file could not be read and the person pressed. */
async function readScope($: EngineInterface): Promise<void> {
  const before = await read($, scopeA)
  await update($, scopeA, () => ({ ...before, busy: true }))
  try {
    const { payload, isError } = await callMemory($, 'scope', {})
    await update($, scopeA, () => scopeOf(payload, isError, before))
  } catch (err) {
    await update($, scopeA, () => ({ ...before, busy: false, error: err instanceof Error ? err.message : String(err) }))
  }
  look.mono = isPaused((await read($, scopeA)).mode)
  await refreshStatus($)
}

/** A file's text, or null when it is not there or can't be read. */
async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    if (!(await $.fs.exists(path))) return null
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * The registry this session's hooks read, found as they find it
 * (`config-path.ts`): the wired hook's `--config` (the user's settings, then
 * this folder's), else `COUNTERPARTS_CONFIG`, else
 * `~/.counterparts/claude-code.json`; `scopes.json` beside it. Read-only, no
 * permission asked. Found again after five minutes, or when asked to.
 */
async function scopesFile($: EngineInterface, fresh: boolean): Promise<string | null> {
  const now = await $.clock.now()
  if (!fresh && run.scopesFile !== null && now - run.scopesFileAt < SCOPES_FILE_TTL_MS) return run.scopesFile
  const home = ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').trim()
  const moved = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? '').trim()
  const settings = [
    ...(moved.length > 0 ? [`${moved}/settings.json`] : home.length > 0 ? [`${home}/.claude/settings.json`] : []),
    ...(run.cwd.length > 0 ? [`${run.cwd}/.claude/settings.json`, `${run.cwd}/.claude/settings.local.json`] : []),
  ]
  let named: string | null = null
  for (const file of settings) {
    const text = await readText($, file)
    const config = text === null ? undefined : settingsHookConfig(text)
    if (typeof config === 'string') {
      named = config
      break
    }
  }
  if (named === null) {
    const env = ((await $.env.get('COUNTERPARTS_CONFIG')) ?? '').trim()
    named = env.length > 0 ? env : home.length > 0 ? `${home}/.counterparts/claude-code.json` : null
  }
  // A named configuration that is not absolute is refused by the hooks too: nothing to read.
  run.scopesFile = named !== null && isAbsolutePath(named) ? `${parentOf(named)}/scopes.json` : null
  run.scopesFileAt = now
  return run.scopesFile
}

/** `scopes.ts#canonicalScopePath`: the deepest existing ancestor realpathed, the rest kept. */
async function canonicalPath($: EngineInterface, path: string): Promise<string> {
  const known = run.canon.get(path)
  if (known !== undefined) return known
  let head = path.length > 1 ? path.replace(/[/\\]+$/, '') : path
  const tail: string[] = []
  for (let i = 0; i < 64; i += 1) {
    const real = await $.fs.stat(head, { resolve: true }).then(
      st => st.realPath,
      () => undefined,
    )
    if (real !== undefined) {
      if (tail.length === 0) {
        if (run.canon.size > 200) run.canon.clear()
        run.canon.set(path, real)
        return real
      }
      return `${real.replace(/[/\\]+$/, '')}/${tail.join('/')}`
    }
    const parent = parentOf(head)
    if (parent === head || parent.length === 0) break
    tail.unshift(head.slice(parent.length).replace(/^[/\\]+/, ''))
    head = parent
  }
  return path
}

/** Where this folder stands, from the registry file: null when it can't be read (no home folder, no folder, a read refused). */
async function readScopeFile($: EngineInterface, fresh: boolean): Promise<SidebarScope | null> {
  if (run.cwd.length === 0) return null
  const file = await scopesFile($, fresh)
  if (file === null) return null
  let entries: Record<string, RegistryMode> = {}
  try {
    // Absent is ordinary: every folder is unset. Present and unparseable reads
    // the same way, as the hooks read it (`scopes.ts#readScopes`).
    if (await $.fs.exists(file)) entries = parseRegistry(String(await $.fs.read(file)))
  } catch {
    return null
  }
  const target = await canonicalPath($, run.cwd)
  const list = await Promise.all(
    Object.entries(entries).map(async ([key, mode]) => ({ key, mode, canonical: await canonicalPath($, key) })),
  )
  const v = lookup(list, target)
  return { mode: v.mode, own: v.canonical !== null && v.canonical === target, setBy: v.matched, dir: target, error: null, busy: false, unread: null }
}

/**
 * Reads this folder's registry entry and shows any change: at session start,
 * on each dashboard poll while the pane is drawn, once a minute otherwise, and
 * on every `/counterparts`. A pause made in another session shows here within
 * one of those. No tool is called and nothing is logged.
 */
async function refreshScope($: EngineInterface, fresh = false): Promise<void> {
  // Before session.start (the band may draw first) there is no folder yet: the state stays as it is, not "unreadable".
  if (run.scopeReading || run.cwd.length === 0) return
  run.scopeReading = true
  try {
    const found = await readScopeFile($, fresh).catch(() => null)
    const before = await read($, scopeA)
    if (before.busy) return
    const next: SidebarScope = found ?? (before.mode === 'unknown' ? { ...before, unread: 'unreadable' } : before)
    if (next.mode === before.mode && next.own === before.own && next.setBy === before.setBy && next.dir === before.dir && next.unread === before.unread && before.error === null) return
    await update($, scopeA, () => next)
    look.mono = isPaused(next.mode)
    await refreshStatus($)
  } finally {
    run.scopeReading = false
  }
}

async function noteSwitch($: EngineInterface, text: string | null): Promise<void> {
  const now = await $.clock.now()
  const mark = text === null ? null : { text, at: now }
  await update($, noteA, () => mark)
  if (mark !== null) {
    $.clock.after(AUTO_CLOSE_MS, () => {
      quiet(update($, noteA, n => (n !== null && n.at === mark.at ? null : n)))
    })
  }
}

/**
 * The switch. While the folder's state is unknown a press only learns it.
 * After that: a folder whose own entry is on or observer gets a confirm row
 * (`askPause`; only its [Pause] pauses), its own pause resumes at once, and
 * every other state is explained rather than changed (`switchExplains`).
 */
async function toggleScope($: EngineInterface): Promise<void> {
  const scope = await read($, scopeA)
  if (scope.busy) return
  if (scope.mode === 'unknown') {
    // The registry file first; only if it still can't be read, the server (which may ask permission: the person just pressed).
    await refreshScope($, true)
    if ((await read($, scopeA)).mode === 'unknown') await readScope($)
    const now = await read($, scopeA)
    if (now.mode === 'unknown' || now.error !== null) await noteSwitch($, `Couldn't read this folder: ${now.error ?? 'no answer'}`)
    else {
      const why = switchExplains(now)
      await noteSwitch(
        $,
        why ??
          (now.mode === 'paused'
            ? 'Counterparts memory is paused in this folder. Press again to turn it back on.'
            : now.mode === 'observer'
              ? 'Counterparts reads only in this folder: memories come to mind, nothing new is kept. Press again to pause it (it asks first).'
              : 'Counterparts memory is on in this folder. Press again to pause it (it asks first).'),
      )
    }
    return
  }
  const why = switchExplains(scope)
  if (why !== null) {
    await noteSwitch($, why)
    return
  }
  // Here the folder's own entry is on, observer or paused.
  if (scope.mode === 'paused') await setScope($, 'resume')
  else await askPause($, scope)
}

/** A pause asks first: the confirm row above the switches. Nothing is called until its [Pause]. */
async function askPause($: EngineInterface, scope: SidebarScope): Promise<void> {
  const at = await $.clock.now()
  const ask = { dir: scope.dir ?? 'this folder', at }
  await noteSwitch($, null)
  await update($, pauseAskA, () => ask)
  $.clock.after(AUTO_CLOSE_MS, () => {
    quiet(update($, pauseAskA, a => (a !== null && a.at === at ? null : a)))
  })
}

async function cancelPause($: EngineInterface): Promise<void> {
  await update($, pauseAskA, () => null)
}

/** The confirm row's [Pause]: the only press that pauses, and only a folder still on or observer by its own entry. */
async function confirmPause($: EngineInterface): Promise<void> {
  const ask = await read($, pauseAskA)
  await update($, pauseAskA, () => null)
  if (ask === null) return
  const scope = await read($, scopeA)
  if (scope.busy || switchExplains(scope) !== null || (scope.mode !== 'on' && scope.mode !== 'observer')) return
  await setScope($, 'pause')
}

/** One call: pause or resume this folder's own entry. */
async function setScope($: EngineInterface, to: 'pause' | 'resume'): Promise<void> {
  const scope = await read($, scopeA)
  await update($, scopeA, () => ({ ...scope, busy: true }))
  try {
    const { payload, isError } = await callMemory($, 'scope', { mode: to })
    const now = scopeOf(payload, isError, scope)
    await update($, scopeA, () => now)
    await noteSwitch($, now.error === null ? null : `The memory server said: ${now.error}`)
  } catch (err) {
    await update($, scopeA, () => ({ ...scope, busy: false }))
    await noteSwitch($, err instanceof Error ? err.message : String(err))
  }
  look.mono = isPaused((await read($, scopeA)).mode)
  await refreshStatus($)
}

async function toggleClaudeMemory($: EngineInterface): Promise<void> {
  const on = !(await claudeMemoryOn($))
  await $.store.set('claudeMemory', on)
  await update($, memoryA, () => on)
  // The memory section and the first message's context are cached answers:
  // asking again rebuilds them from the next message (and the prompt cache once).
  $.ui.invalidate('prompt.section')
  $.ui.invalidate('prompt.context')
  $.ui.toast(
    on
      ? "Claude Code's own memory is back from your next message."
      : "Claude Code's own memory is off from your next message, in every session until you turn it back on (Counterparts stays).",
  )
  await refreshStatus($)
}

async function runSearch($: EngineInterface, raw: string): Promise<void> {
  const query = raw.trim()
  await update($, openA, o => (o !== null && o.key.startsWith('hit:') ? null : o))
  if (query.length === 0) {
    await update($, searchA, () => IDLE_SEARCH)
    return
  }
  await update($, searchA, () => ({ ...IDLE_SEARCH, query, status: 'running' as const }))
  try {
    const { payload, isError } = await callMemory($, 'recall', { question: query, mode: 'facts' })
    const answer = payload?.['answer']
    if (isError || typeof answer !== 'string') {
      const why = String(payload?.['detail'] ?? payload?.['reason'] ?? 'the search was refused')
      await update($, searchA, () => ({ ...IDLE_SEARCH, query, status: 'error' as const, error: why }))
      return
    }
    const { header, total, hits } = parseFacts(answer)
    await update($, searchA, () => ({ query, status: 'done' as const, header, total, hits: hits.slice(0, 12), error: null }))
  } catch (err) {
    await update($, searchA, () => ({ ...IDLE_SEARCH, query, status: 'error' as const, error: err instanceof Error ? err.message : String(err) }))
  }
}

// ── views and the brain's mode ─────────────────────────────────────────────

/**
 * Opens (or re-opens) the pane and asks for a fresh drawing of it. Measured
 * live (v0.1): a pane closed by hand and opened again is drawn from the
 * terminal's settled evaluation, so this module's render hook never runs and
 * the brain, stopped at the close, would stay frozen.
 */
async function openPane($: EngineInterface): Promise<{ isPlaced: boolean }> {
  brain.wake() // opened, it eases out of rest
  await setView($, 'sidebar')
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: OPEN_COLUMNS })
  await update($, placedA, () => opened.isPlaced)
  $.ui.invalidate('ui.render')
  return { isPlaced: opened.isPlaced }
}

/** Closes the pane for the quiet view: the tail draws again. */
async function closeQuiet($: EngineInterface): Promise<void> {
  await setView($, 'quiet')
  stopBrain()
  await update($, placedA, () => false)
  await $.ui.close({ id: PANE })
  $.ui.invalidate('ui.render')
}

/** The view, for this session and (in `$.store`) the next. */
async function setView($: EngineInterface, view: SidebarView): Promise<void> {
  if ((await read($, viewA)) !== view) await update($, viewA, () => view)
  await $.store.set('view', view)
  if (view !== 'sidebar') stopBrain()
}

/** The brain's mode, for every session (`$.store`): turning, still, or off. */
async function setBrain($: EngineInterface, mode: SidebarBrain): Promise<void> {
  await $.store.set('brain', mode)
  if ((await read($, brainA)) !== mode) await update($, brainA, () => mode)
  look.still = mode === 'still'
  brain.hold(mode === 'still')
  if (mode !== 'turning') stopBrain()
  else brain.wake()
  raster.look = ''
  $.ui.invalidate('ui.render')
}

/**
 * Opened without being asked: only where it docks as a sidebar, and only when
 * the stored view is the sidebar. Measured live (v0.1): the band draws BEFORE
 * `session.start` has read the stored view, so the view is read from the
 * store here.
 */
async function openUnasked($: EngineInterface): Promise<void> {
  const view = normView(await $.store.get('view'))
  if ((await read($, viewA)) !== view) await update($, viewA, () => view)
  if (view !== 'sidebar') return
  const opened = await openPane($)
  if (!opened.isPlaced && run.interactive) {
    run.hint = true
    $.ui.invalidate('ui.render')
  }
}

function stopBrain(): void {
  run.brainGen += 1
  run.brainTimer?.cancel()
  run.brainTimer = null
  raster.live = false
  fps.inFlight = false
}

/** At rest the timer stops altogether; the Raster stays mounted and the last frame stands. */
function restBrain(): void {
  run.brainGen += 1
  run.brainTimer?.cancel()
  run.brainTimer = null
  run.brainPace = 'rest'
  fps.inFlight = false
}

/** A refused blit is a Raster gone or not mounted yet: ask for a fresh drawing, a few times at most until one is taken. */
function redrawAfterRefusal($: EngineInterface): void {
  if (run.redraws >= 3) return
  run.redraws += 1
  $.ui.invalidate('ui.render')
}

/** The timer's interval for a pace: every frame of the target while an arc flies, the calm rate while it sways. */
function paceMs(pace: 'burst' | 'calm'): number {
  const every = pace === 'burst' ? 1 : Math.max(1, Math.round(fps.target / brain.calmFps))
  return Math.max(16, Math.round((every * 1000) / fps.target))
}

/**
 * One frame of the turning brain onto the mounted Raster; the blit's time is
 * the measurement. The burst rate only while a pulse's arc is in flight, the
 * calm rate while it sways, and no timer at all at rest.
 */
function tick($: EngineInterface, gen: number): void {
  if (gen !== run.brainGen) return
  const now = Date.now()
  const pace = run.brainPace === 'burst' ? 'burst' : 'calm'
  const dt = fps.lastTick === 0 ? paceMs(pace) : Math.min(250, Math.max(now - fps.lastTick, paceMs(pace)))
  fps.lastTick = now
  if (look.sel !== null) {
    const m = mechById(look.sel)
    if (m !== undefined) brain.light(m.region, stageOf(m.id).col)
  }
  brain.step(now, dt)
  if (!raster.live) {
    stopBrain()
    return
  }
  const mode = brain.mode()
  if (mode === 'rest') {
    restBrain()
    return
  }
  if (mode !== run.brainPace) startBrain($, mode)
  if (fps.inFlight) return
  const cells = frameCells(raster.cols, raster.rows, now)
  raster.cells = cells
  raster.look = lookKey()
  if (!brain.fresh) return // nothing moved a fifth of a dot: the frame on screen stands, no blit
  fps.inFlight = true
  const blitGen = run.brainGen
  void $.ui.blit({ requestId: PANE, key: 'brain', cells, columns: raster.cols, rows: raster.rows }).then(
    r => {
      if (blitGen !== run.brainGen) return
      fps.inFlight = false
      if (r.deny !== undefined) {
        stopBrain()
        redrawAfterRefusal($)
        return
      }
      run.redraws = 0
      fps.blits.push(performance.now())
      if (fps.blits.length > 240) fps.blits.shift()
    },
    () => {
      if (blitGen !== run.brainGen) return
      stopBrain()
      redrawAfterRefusal($)
    },
  )
}

/** Starts (or re-paces) the brain's timer under a new generation; a fresh start begins at the calm rate. */
function startBrain($: EngineInterface, pace: 'burst' | 'calm' = 'calm'): void {
  const fresh = run.brainTimer === null
  run.brainTimer?.cancel()
  run.brainGen += 1
  const gen = run.brainGen
  fps.inFlight = false
  if (fresh) fps.lastTick = 0
  run.brainPace = pace
  run.brainTimer = $.clock.every(paceMs(pace), () => tick($, gen))
}

/** A drawing of the pane: the turning brain's timer starts, and the dashboard is read from here on, until the pane stops showing. */
function wake($: EngineInterface, turning: boolean): void {
  if (run.hint) {
    run.hint = false
    $.ui.invalidate('ui.render')
  }
  if (turning && run.brainTimer === null) startBrain($)
  armPolling($, run.cold ? POLL_MS : 0)
  if (!run.woke) {
    run.woke = true
    quiet(refreshScope($))
  }
  // Drawn, it is placed: the tail under the prompt stands down (written after the drawing, never during it).
  $.clock.after(0, () => {
    quiet(
      (async () => {
        if (!(await read($, placedA))) await update($, placedA, () => true)
      })(),
    )
  })
}

/** How this machine opens a URL, found once: `open` (macOS), `xdg-open` (Linux), `start` (Windows). */
async function opener($: EngineInterface): Promise<readonly string[]> {
  if (run.opener !== null) return run.opener
  let os = ''
  try {
    os = (await $.process.run(['uname', '-s'], { timeoutMs: 3000 })).stdout.trim()
  } catch {
    os = 'Windows'
  }
  // Never `cmd /c start`: cmd would read & | ^ % in a URL as its own.
  run.opener = os === 'Darwin' ? ['open'] : os === 'Windows' ? ['rundll32', 'url.dll,FileProtocolHandler'] : ['xdg-open']
  return run.opener
}

/**
 * A plain click opens the dashboard in the browser (an OSC 8 link opens only
 * on ⌘-click in iTerm2). A new tab each time: no browser lets a page bring an
 * already-open tab forward without the person's click there, and finding the
 * tab from here (AppleScript) needs an automation permission (NOTES).
 */
async function openUrl($: EngineInterface, url: string): Promise<void> {
  // The only links the sidebar opens: the dashboard's, on localhost and the port it read (`isDashboardUrl`).
  if (!isDashboardUrl(url, await dashPort($))) return
  try {
    const argv = await opener($)
    const r = await $.process.run([...argv, url], { timeoutMs: 10000 })
    if (r.exitCode !== 0) $.ui.toast(`counterparts: couldn't open ${url}`)
  } catch {
    $.ui.toast(`counterparts: couldn't open ${url}`)
  }
}

/** A dashboard page (`/`, `/#memories`), on the port the sidebar read. */
async function openDashboard($: EngineInterface, path: string): Promise<void> {
  await openUrl($, `${await dashUrl($)}${path}`)
}

// ── hooks ───────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    run.interactive = e.isInteractive
    run.cwd = e.cwd
    run.session = await $.session.id()
    if (run.startedAt === 0) run.startedAt = await $.clock.now()
    await $.command.register({
      name: 'counterparts',
      description: 'Counterparts sidebar: open it, make it quiet, or set the brain',
      argumentHint: '[quiet | brain turning|still|off | resume | fps [n]]',
    })
    const [mem, viewPref, brainPref, fpsPref] = await Promise.all([
      $.store.get('claudeMemory'),
      $.store.get('view'),
      $.store.get('brain'),
      $.store.get('fps'),
    ])
    await update($, memoryA, () => mem !== false)
    await update($, viewA, () => normView(viewPref))
    const mode = normBrain(brainPref)
    await update($, brainA, () => mode)
    look.still = mode === 'still'
    brain.hold(mode === 'still')
    if (typeof fpsPref === 'number' && fpsPref >= 1 && fpsPref <= 30) fps.target = fpsPref
    // Nothing is opened or drawn here, and the dashboard is not read. The pane
    // opens unasked from the first drawing of the band above the prompt, which
    // says whether this surface docks a pane; the brain and the dashboard start
    // with the pane's own first drawing. One thing is read: where this folder
    // stands, so a session started in a paused folder says so at once.
    quiet(refreshStatus($))
    if (run.interactive) {
      quiet(refreshScope($))
      run.scopeTimer?.cancel()
      run.scopeTimer = $.clock.every(SCOPE_RECHECK_MS, () => quiet(refreshScope($)))
    }
    return next(e)
  })

  on('command.run', { command: 'counterparts' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    await refreshScope($, true)
    if (verb === 'fps') {
      const mode = await read($, brainA)
      if (arg !== '') {
        const n = Math.round(Number(arg))
        if (!Number.isFinite(n) || n < 1 || n > 30) return { text: 'counterparts fps: give a whole number from 1 to 30.' }
        fps.target = n
        await $.store.set('fps', n)
        if (run.brainTimer !== null) startBrain($)
        return { text: `Brain target set to ${String(n)} fps. ${fpsReport(mode)}` }
      }
      return { text: fpsReport(mode) }
    }
    // `strip` (dropped 2026-10-10) is quiet now: an older term-loop's put-back can still type it.
    if (verb === 'quiet' || verb === 'hide' || verb === 'rail' || verb === 'strip') {
      await closeQuiet($)
      return { text: 'Counterparts quiet: the newest thing shows dim after the line under the prompt. /counterparts opens the sidebar.' }
    }
    if (verb === 'brain') {
      if (arg !== 'turning' && arg !== 'still' && arg !== 'off') return { text: 'counterparts brain: turning, still or off.' }
      await setBrain($, arg)
      return { text: arg === 'off' ? 'The brain is off: the header is one line.' : arg === 'still' ? 'The brain holds still, and lights where something fires.' : 'The brain turns slowly, and lights where something fires.' }
    }
    if (verb === 'resume') {
      if ((await read($, scopeA)).mode === 'unknown') await readScope($) // the registry could not be read: ask the server
      const scope = await read($, scopeA)
      if (scope.mode === 'paused' && scope.own) {
        await setScope($, 'resume')
        const after = await read($, scopeA)
        return { text: after.error === null ? `Counterparts memory is back on in ${shortDir(after.dir)}.` : `The memory server said: ${after.error}` }
      }
      if (scope.mode === 'unknown') return { text: `Couldn't read this folder: ${scope.error ?? 'no answer'}` }
      return { text: switchExplains(scope) ?? `Counterparts memory isn't paused in ${shortDir(scope.dir)}.` }
    }
    if (verb !== '' && verb !== 'open' && verb !== 'sidebar') {
      return { text: 'Usage: /counterparts [quiet | brain turning|still|off | resume | fps [n]]. With nothing after it, opens the sidebar.' }
    }
    // Asked for: placed at any width, whatever view it was left in.
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Counterparts sidebar opened.' : 'Counterparts sidebar is open but this surface does not place panes.' }
  })

  // Saved this session, and footnotes Claude opened: the memory tools, after a call that answered without error
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const name = String(e.tool)
    if (ourTool(name) === null) return ran
    try {
      const args = e as unknown as Record<string, unknown>
      const opened = openedIds(name, args)
      if (opened.ids.length > 0 || opened.handle !== null) await onOpened($, opened.ids, opened.handle)
      run.liveSeq += 1
      await onSaved($, savedItems(name, args, ran.text, await $.clock.now(), run.liveSeq))
    } catch {
      // the call stands whatever the sidebar made of it
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Memories and Subconscious: the recall block the classic hook injects
  on('session.append', { door: 'hook-context' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined) return stored
    try {
      const text = e.message.content.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')
      const block = parseRecallBlock(text)
      if (block !== null) {
        if (run.session === '') run.session = await $.session.id()
        await onRecallBlock($, block)
      }
    } catch {
      // the row is stored whatever the sidebar made of it
    }
    return stored
  }).catch(($, e, next) => next(e))

  // a /clear (or a resume) goes on under another session id, and no session.start fires for it
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      run.session = ''
      run.startedAt = await $.clock.now()
      await update($, savedA, () => [])
      await update($, mindA, () => null)
      await update($, openA, () => null)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // closed by hand (the pane's ✕): quiet, for this session and the next, until /counterparts opens it
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      stopBrain()
      await setView($, 'quiet')
      await update($, placedA, () => false)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // a click in the body (the Client posts the row's key)
  on('ui.message', async ($, e) => {
    const data = e.data as { click?: unknown } | null
    if (typeof data?.click === 'string') await clickBody($, data.click)
    return {}
  })

  // Claude Code's own memory: its MEMORY.md files and its section of the system prompt
  on('prompt.context', async ($, e, next) => {
    if ((await claudeMemoryOn($)) || e.instructionFiles === undefined) return next(e)
    return next({ ...e, instructionFiles: e.instructionFiles.filter(f => f.kind !== 'memory') })
  }).catch(($, e, next) => next(e))

  on('prompt.section', { name: 'memory' }, async ($, e, next) => ((await claudeMemoryOn($)) ? next(e) : { text: null })).catch(
    ($, e, next) => next(e),
  )

  // Under the prompt: the newest thing, dim, after the engine's own hint line
  // (its pills stay live), only while the pane is closed, and not while the
  // folder is paused (the amber status says so). It always ends with
  // ` · /counterparts opens it`, the newest thing shortened to keep that whole.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [view, placed, latest, scope] = await Promise.all([read($, viewA), read($, placedA), read($, latestA), read($, scopeA)])
    if ((normView(view) === 'sidebar' && placed) || isPaused(scope.mode)) return next(e)
    if (latest === null && normView(view) === 'sidebar') {
      // an unasked pane this surface could not place yet: say how to open it, until it draws
      return run.hint ? next({ ...e, props: { ...e.props, tail: '/counterparts opens the sidebar' } }) : next(e)
    }
    const cols = e.viewport?.columns
    // The engine's line is wider than its `hint` prop, and it cuts the tail short of the row's end (TAIL_SPARE).
    const room = typeof cols === 'number' ? cols - cells(e.props.hint) - TAIL_SPARE : null
    const tail = quietTail(latest?.text ?? null, room, await $.clock.now())
    return next({ ...e, props: { ...e.props, tail } })
  }).catch(($, e, next) => next(e))

  // The band above the prompt: its first drawing says whether this surface
  // docks a pane (the sidebar opens unasked only then). Nothing is drawn there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const docks = e.viewport?.isFullscreen
    if (docks !== undefined && !run.placementDecided) {
      run.placementDecided = true
      if (docks) $.clock.after(0, () => quiet(openUnasked($)))
    }
    return next(e)
  })

  // ── the pane ──────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : null
    const Client = 'Client' in els ? els.Client : null
    const now = await $.clock.now()
    const [pulse, dash, mind, saved, today, dreamNow, open, mech, focus, firing, search, scope, view, brainMode, note, pauseAsk] = await Promise.all([
      read($, pulseA), read($, dashA), read($, mindA), read($, savedA), read($, todayA), read($, dreamA), read($, openA), read($, mechA),
      read($, focusA), read($, firingA), read($, searchA), read($, scopeA), read($, viewA), read($, brainA), read($, noteA), read($, pauseAskA),
    ])
    // The stored preference, not this session's copy: another session may have turned it. (This
    // session's copy is read too, so a turn of the switch here draws again.)
    await read($, memoryA)
    const memoryOn = await claudeMemoryOn($)
    const paused = isPaused(scope.mode)
    const mode = normBrain(brainMode)
    look.mono = paused
    look.still = mode === 'still'
    look.sel = mech === null ? null : mech.id
    // A reload keeps the state: a `firing` written by v0.1 (`{ id, at }`, no `ids`) lights nothing.
    const firingNow: readonly MechId[] =
      !paused && firing !== null && now - firing.at < FIRING_MS && Array.isArray(firing.ids) ? firing.ids : []
    look.firing = firingNow
    const W = Math.max(e.props.bodyColumns, 1)
    const fill = Math.max(1, e.props.scroll?.bodyRows ?? 1)
    const inline = e.props.placement === 'inline'
    const w = Math.max(16, inline ? Math.min(W - 2, 64) : W - 2)
    run.bodyW = w
    const hasRaster = e.surface === 'terminal' && mode !== 'off'
    // While the pane holds the keyboard (typing a search) the brain holds still.
    const holding = e.props.isFocused === true
    if (e.surface === 'terminal' && (holding || mode !== 'turning')) stopBrain()
    if (normView(view) === 'sidebar') wake($, hasRaster && mode === 'turning' && !holding)

    const roomy = fill >= ROOMY_ROWS
    const lit = firingNow[0] ?? look.sel
    const rows: JSX.Element[] = []
    let used = 0
    if (roomy) {
      rows.push(<Text key="top"> </Text>)
      used += 1
    }

    // ── the search box: a shade above the panel, a fainter `search` inside ──
    const searchBox = (width: number) => (
      <Box key="search" flexDirection="row" width={width} backgroundColor={SEARCH_BG}>
        <Text color={P.mid} backgroundColor={SEARCH_BG}>⌕ </Text>
        <Box flexGrow={1}>
          {Input === null ? (
            <Text color={P.dim} backgroundColor={SEARCH_BG}>search</Text>
          ) : (
            <Input key="q" placeholder="search" value="" submitLabel="find" onSubmit={(value: string) => runSearch($, value)} />
          )}
        </Box>
      </Box>
    )
    const titleButton = (lead: boolean) => (
      <Button key="title" plain onPress={() => openDashboard($, '/')}>
        {lead ? <Text color={lit === null ? CYAN_DIM : litDot(lit)}>◉ </Text> : ''}
        <Text color={paused ? P.dim : P.cyan} bold>COUNTERPARTS</Text>
        {lead ? <Text color={CYAN_DIM}> ↗</Text> : ''}
      </Button>
    )

    // ── the header ──
    const countText = pulse === null ? '' : memoriesCount(pulse.memories)
    // From 1,000 memories the count (`1000 memories`, 13 cells) is one wider than the header's text column:
    // the column takes one cell of the gap beside the brain, every row of it, so the header stays six rows.
    const gap = cells(countText) > w - HEAD_X ? 1 : 2
    const headW = w - BRAIN_COLS - gap
    if (hasRaster) {
      const { Raster } = $.ui.resolve(e)
      const reuse = raster.cols === BRAIN_COLS && raster.rows === BRAIN_ROWS && raster.cells !== '' && raster.look === lookKey()
      const cells0 = reuse ? raster.cells : frameCells(BRAIN_COLS, BRAIN_ROWS, Date.now())
      raster.cols = BRAIN_COLS
      raster.rows = BRAIN_ROWS
      raster.cells = cells0
      raster.look = lookKey()
      raster.live = true
      rows.push(
        <Box key="head" flexDirection="row" width={w}>
          <Raster key="brain" columns={BRAIN_COLS} rows={BRAIN_ROWS} cells={cells0} />
          <Box width={gap} />
          <Box flexDirection="column" width={headW}>
            <Text> </Text>
            {titleButton(false)}
            <Text> </Text>
            <Text color={P.dim}>{pulse === null ? ' ' : `day ${String(pulse.day)}`}</Text>
            <Text color={P.dim}>{pulse === null ? ' ' : countText}</Text>
            {searchBox(headW)}
          </Box>
        </Box>,
      )
      rows.push(<Text key="head-gap"> </Text>)
      used += BRAIN_ROWS + 1
    } else {
      rows.push(
        <Box key="head1" flexDirection="row" justifyContent="space-between" width={w}>
          {titleButton(true)}
          <Text color={P.dim}>{pulse === null ? '' : `day ${String(pulse.day)}`}</Text>
        </Box>,
      )
      rows.push(
        <Box key="head2" flexDirection="row" justifyContent="space-between" width={w}>
          {searchBox(14)}
          <Text color={P.dim}>{countText}</Text>
        </Box>,
      )
      rows.push(<Text key="head-gap"> </Text>)
      used += 3
    }

    // ── a paused folder says so before anything else in the pane ──
    if (paused) {
      const off = scope.mode === 'off'
      rows.push(<Text key="paused" color={P.amber} bold>{clip(off ? '◌ Counterparts off here' : '⏸ Counterparts paused here', w)}</Text>)
      rows.push(
        <Button key="resume-banner" plain onPress={() => toggleScope($)}>
          <Text color={P.amber} underline>
            {clip(off ? 'why, and how to turn it on' : scope.own ? 'click to resume' : `paused by ${shortDir(scope.setBy)} · how to resume`, w)}
          </Text>
        </Button>,
      )
      rows.push(<Text key="paused-gap"> </Text>)
      used += 3
    }

    // ── what the switches say, above them: the pause confirm, a note ──
    const above: JSX.Element[] = []
    if (pauseAsk !== null && !paused && scope.mode !== 'unknown') {
      wrap(`Pause Counterparts memory in ${shortDir(pauseAsk.dir)} for every session here?`, w).forEach((l, i) =>
        above.push(<Text key={`ask${String(i)}`} color={P.amber}>{l}</Text>),
      )
      above.push(
        <Box key="pause-ask" flexDirection="row">
          <Button key="confirm-pause" onPress={() => confirmPause($)}>Pause</Button>
          <Text> </Text>
          <Button key="cancel-pause" onPress={() => cancelPause($)}>Cancel</Button>
        </Box>,
      )
    }
    if (note !== null) wrap(note.text, w).forEach((l, i) => above.push(<Text key={`note${String(i)}`} color={P.text}>{l}</Text>))
    if (above.length > 0) above.push(<Text key="above-gap"> </Text>)

    // ── the body: the five sections, folded to the room left ──
    const footRows = 4
    const bodyRows = Math.max(4, fill - used - above.length - footRows)
    // Down, the chart names how THIS install starts the dashboard: which memory server the session connected says.
    const routes = dashboardRoutes(dash === 'down' ? await memoryServer($) : run.server)
    const { lines } = layoutBody({ w, rows: bodyRows, now, mind, saved, today, dream: dreamNow, open, mech, focus, dash, routes, search })
    if (Client !== null) {
      rows.push(<Client key="body" module="./body.tsx" width={w} props={{ lines } satisfies BodyProps} />)
    } else {
      // A surface with no Client modules (mobile, an editor): the same lines, not clickable.
      rows.push(
        <Box key="body" flexDirection="column">
          {lines.map((l: Line, y: number) => (
            <Text key={`b${String(y)}`} color={l.segs[0]?.c ?? P.text}>{l.segs.map(s => s.t).join('') || ' '}</Text>
          ))}
        </Box>,
      )
    }
    rows.push(<Box key="spacer" flexGrow={1} />)
    rows.push(...above)

    // ── the footer: each dot and its word one hit target ──
    const known = scope.mode !== 'unknown'
    const cpOn = known && !paused
    const readsOnly = scope.mode === 'observer'
    const cpDot = !known ? (scope.busy ? '…' : '?') : scope.busy ? '…' : cpOn ? (readsOnly ? '◐' : '●') : '○'
    const dotWord = (key: string, isOn: boolean, word: string, onPress: () => Promise<unknown>, dot?: string, dim = false) => (
      <Button key={key} plain onPress={onPress}>
        <Text color={isOn && !dim ? P.cyan : P.dim}>{dot ?? (isOn ? '●' : '○')}</Text>
        <Text color={isOn && !dim ? P.hi : P.dim}>{` ${word}`}</Text>
      </Button>
    )
    // What a click on a memory switch does, over the two rows above the footer while hovered: nothing moves under the pointer.
    const hoverCard = (key: string, group: string, text: string) => (
      <Box key={key} position="absolute" top={-2} left={0} width={w} height={2} display="none" hover={{ display: 'flex', scope: group }} flexDirection="column" backgroundColor={P.panel}>
        {wrap(text, w)
          .slice(0, 2)
          .map((l, i) => (
            <Text key={`${key}${String(i)}`} color={P.mid}>{l}</Text>
          ))}
      </Box>
    )
    const viewNow = normView(view)
    // While the pause asks (or a note explains), those rows sit right above the footer, and the pointer is still
    // on the switch it just pressed: a card there would cover [Pause] [Cancel] or the note's last line.
    const cards = above.length === 0
    rows.push(
      <Box key="footer" flexDirection="column" width={w}>
        {cards ? hoverCard('cp-why', HOVER_CP, scopeHover(scope)) : null}
        {cards ? hoverCard('mem-why', HOVER_MEM, memoryHover(memoryOn)) : null}
        <Text color={P.faint}>{'─'.repeat(w)}</Text>
        <Box flexDirection="row">
          <Box key="row-cp" hover={{ scope: HOVER_CP }}>
            {dotWord('toggle-cp', cpOn, 'Counterparts', () => toggleScope($), cpDot, !known)}
          </Box>
          <Text>{'  '}</Text>
          <Box key="row-mem" hover={{ scope: HOVER_MEM }}>
            {dotWord('toggle-mem', memoryOn, 'Claude memory', () => toggleClaudeMemory($))}
          </Box>
        </Box>
        <Box flexDirection="row">
          <Text color={P.mid}>view</Text>
          {(['sidebar', 'quiet'] as const).map(v => (
            <Box key={`v-${v}`} flexDirection="row">
              <Text> </Text>
              {dotWord(`view-${v}`, viewNow === v, v, () => (v === 'sidebar' ? openPane($) : closeQuiet($)))}
            </Box>
          ))}
        </Box>
        <Box flexDirection="row">
          <Text color={P.mid}>brain</Text>
          {(['turning', 'still', 'off'] as const).map(b => (
            <Box key={`b-${b}`} flexDirection="row">
              <Text> </Text>
              {dotWord(`brain-${b}`, mode === b, b, () => setBrain($, b))}
            </Box>
          ))}
        </Box>
      </Box>,
    )

    return (
      <Box flexDirection="column" paddingX={1} width={W} minHeight={fill} backgroundColor={P.panel}>
        {rows}
      </Box>
    )
  })
}
