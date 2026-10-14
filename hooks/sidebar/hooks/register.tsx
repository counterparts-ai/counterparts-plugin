/**
 * The Counterparts sidebar (v0.2): what memory is doing, in 35 columns.
 *
 * A small brain beside the title, the day and the count; then
 * what was put in front of Claude for the last message (Memories, said in
 * full; Subconscious, titles only), what this session saved, how often each
 * mechanism fired today, and the last dream; then three rows of switches
 * (Counterparts here, on · paused · off; the view; the brain), and Claude
 * Code's own memory for whoever opted in. While core's first meeting is put
 * off or not yet started, "Start the 5-minute intro" tops the body (the
 * speak-first, asking Claude to begin once per install, is `speak-first.tsx`,
 * a hooks module of its own). Closed
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
 *     to pause or resume, after the confirm;
 *   - this session: the recall block the classic UserPromptSubmit hook
 *     injects (Memories, Subconscious), and `tool.call` on remember (or
 *     its old name note) / session_end (Saved) and on recall by id (`↗ opened`).
 *
 * The engine lets `$` pass only to functions declared at the top of this
 * file, reads a `$.state` source only from an atom declared here, and reads
 * the surface modules (`<Client module=…>`) off this file's source, so those
 * live here: every function that touches the engine, the atoms, the hooks.
 * Everything else is beside it, with no `$` (a press reaches a view as a
 * closure made here). The shared core: `state.ts` (timings, `run`),
 * `words.ts` (what the sidebar says), `feed.ts` (the dashboard's rows and the
 * recall block, read), `sections.ts` (the body's sections, laid out),
 * `mechanisms.ts`, `scopes.ts`, `theme.ts` (the colours). The views: `pane.tsx` (the pane's
 * tree on every surface), `terminal.tsx` (the brain's header) with
 * `brain.ts`, `cells.ts`, `width.ts` and `tail.ts`, `desktop.tsx` (the
 * header without a brain), and `body.tsx` (the body, a Client surface module).
 */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  SidebarBrain,
  SidebarDream,
  SidebarLatest,
  SidebarMind,
  SidebarOnboarding,
  SidebarRow,
  SidebarSaved,
  SidebarScope,
  SidebarTheme,
  SidebarToday,
  SidebarView,
} from '../types'
import type { BodyProps } from './body'
import { brainlessHeader } from './desktop'
import {
  RULES,
  RULE_NAMES,
  UNKNOWN_ONBOARDING,
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
  meetShows,
  openedIds,
  otherStore,
  ourTool,
  parseOnboarding,
  parseOnboardingMarker,
  parseRecallBlock,
  parseStoreMarker,
  payloadOf,
  resolveServer,
  savedItems,
  shortDir,
  storeOf,
  surfacedIds,
  titled,
} from './feed'
import type { DashDream, DashEvent, Firing, RecallBlock } from './feed'
import {
  MECHS,
  dashboardBase,
  dashboardPort,
  isDashboardUrl,
  mechById,
  memoryUrl,
  stageOf,
} from './mechanisms'
import type { MechId } from './mechanisms'
import {
  IMAGE_COLS,
  IMAGE_ROWS,
  IMAGE_X0,
  STAGE_COLS,
  STAGE_MIN_PANE_ROWS,
  TIER_ENV,
  advance,
  fineCells,
  foxSvg,
  halfCells,
  newDirector,
  normDetail,
  pickTier,
  PNG_DIRS,
  pngName,
  runs,
  stage,
  stageRows,
  stepKey,
  trigger,
} from './fox'
import type { FoxDetail, FoxEvent, FoxTier, Step } from './fox'
import { aboveSwitches, footer, frame, meetRow, pausedBanner, plainBody } from './pane'
import type { PaneActions, PaneEls } from './pane'
import { lookup, parentOf, parseRegistry, settingsHookConfig } from './scopes'
import type { RegistryMode } from './scopes'
import { layoutBody } from './sections'
import type { Line } from './sections'
import {
  AUTO_CLOSE_MS,
  COUNT_EVENTS,
  FALLBACK_LIMIT,
  FALLBACK_MAX,
  FIRING_MS,
  DASHBOARD_COMMAND,
  MEET_COMMAND,
  MEET_FLAG,
  MEET_PRESS_MS,
  NAMES_NOTHING,
  OPEN_COLUMNS,
  POLL_IDLE_MS,
  POLL_MS,
  PULSE_SLOTS,
  PULSE_STAGGER_MS,
  ROOMY_ROWS,
  SCOPES_FILE_TTL_MS,
  SCOPE_RECHECK_MS,
  STALE_MS,
  UNKNOWN_SCOPE,
  quiet,
  run,
} from './state'
import { CLASSIC_HINT, NARROW_HINT, TAIL_HINT, TAIL_SPARE, narrowHint, quietTail } from './tail'
import { BRAIN_COLS, BRAIN_ROWS, brain, brainHeader, fireBrain, fps, fpsReport, frameCells, look, lookKey, paceMs, raster } from './terminal'
import { P, SURFACE, applyTheme, normTheme } from './theme'
import { cells } from './width'
import {
  CONFIRM_FROM,
  bodyOf,
  isAbsolutePath,
  isPaused,
  memoriesCount,
  memoryMeta,
  normBrain,
  normView,
  scopeOf,
  statusFor,
  stoodDownNote,
  failedPressNote,
  firedIn,
  isRefusal,
  storedWords,
  switchExplains,
  words,
} from './words'

// ── constants ───────────────────────────────────────────────────────────────

const PANE = 'counterparts'
const TITLE = 'Counterparts'

// ── state (the contract: ../types/index.d.ts) ──────────────────────────────

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
const scopeA = atom({ plugin: 'counterparts', key: 'scope' } as const, UNKNOWN_SCOPE)
const onboardingA = atom({ plugin: 'counterparts', key: 'onboarding' } as const, UNKNOWN_ONBOARDING as SidebarOnboarding)
const viewA = atom({ plugin: 'counterparts', key: 'view' } as const, 'sidebar')
const brainA = atom({ plugin: 'counterparts', key: 'brain' } as const, 'fox')
const themeA = atom({ plugin: 'counterparts', key: 'theme' } as const, 'tron')
const placedA = atom({ plugin: 'counterparts', key: 'placed' } as const, false)
const noteA = atom({ plugin: 'counterparts', key: 'switchNote' } as const, null)
const pauseAskA = atom({ plugin: 'counterparts', key: 'pauseAsk' } as const, null)
/** The person ran `/counterparts …` in this session: written here, read by `speak-first.tsx` (which never sees it). */
const typedInA = atom({ plugin: 'counterparts', key: 'typedIn' } as const, null)

// ── the brain's pulses ──────────────────────────────────────────────────────

/**
 * Every mechanism a read proved, one pulse each: the first at once, the rest
 * PULSE_STAGGER_MS apart, so they read as separate arcs. Two that would draw
 * the same arc (one region in one stage colour: Dreaming and Consolidation)
 * pulse once.
 */
function firePulses($: EngineInterface, ids: readonly MechId[], now: number): void {
  const arcs = new Set<string>()
  for (const id of ids) {
    const m = mechById(id)
    if (m === undefined) continue
    const arc = `${m.region}:${m.stage}:${id === 'retrieval' ? 'prefrontal' : 'thalamus'}`
    if (arcs.has(arc)) continue
    const delay = Math.min(arcs.size, PULSE_SLOTS - 1) * PULSE_STAGGER_MS
    arcs.add(arc)
    if (delay === 0) fireBrain(id, now)
    else $.clock.after(delay, () => fireBrain(id, now + delay))
  }
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
  // Another store's dashboard: nothing of it is read (`storeMatches`).
  if (run.foreign) throw new Error('the dashboard serves another store')
  const r = await $.http.fetch(`${await dashUrl($)}${path}`)
  if (!r.ok) throw new Error(`the dashboard answered ${String(r.status)}`)
  return JSON.parse(r.text) as unknown
}

/** The rows of a dashboard `/api/activity` read, or none when it fails. */
async function eventsOf($: EngineInterface, path: string): Promise<DashEvent[]> {
  try {
    return ((await fetchJson($, path)) as { events?: DashEvent[] }).events ?? []
  } catch {
    return []
  }
}

// ── the first meeting (core owns its steps and state; this triggers and draws) ──

/**
 * Where the first meeting stands, taken in: from the marker core writes on
 * every SessionStart wake (`feed.ts#ONBOARDING_MARKER`, the source), or from
 * the dashboard's `/api/onboarding` (a refresh while it is up). Only a known
 * state moves it: a missing marker or endpoint leaves what is known, and with
 * neither ever seen it stays `unknown` (an older core): nothing happens.
 */
async function takeOnboarding($: EngineInterface, next: SidebarOnboarding): Promise<void> {
  if (next.meet === 'unknown') return
  const before = await read($, onboardingA)
  if (before.meet === next.meet && before.where === next.where && before.style === next.style) return
  await update($, onboardingA, () => next)
}

/** The dashboard's `/api/onboarding`, a refresh: a 404, a refusal or another shape changes nothing, and never marks the dashboard down. */
async function readOnboarding($: EngineInterface): Promise<void> {
  try {
    if (run.foreign) return
    const r = await $.http.fetch(`${await dashUrl($)}/api/onboarding`)
    // Another store's meeting is not this one's (core #459's `store` on the answer).
    if (r.ok && !otherStore(run.wakeStore, storeOf(r.text))) await takeOnboarding($, parseOnboarding(r.text))
  } catch {
    // down: what the wake said stands
  }
}

/**
 * "Start the 5-minute intro", once a minute at most: the plugin's `/counterparts:meet`, as if
 * typed; the command carries its own instructions. This module never starts the meeting by
 * itself: the speak-first is a hooks module of its own (`speak-first.tsx`), which the
 * directory build leaves out. Run from a timer: `command.run` is refused inside a hook the
 * turn waits on.
 */
async function pressMeet($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (now - run.meetPressedAt < MEET_PRESS_MS) return
  const [onb, scope, mark] = await Promise.all([read($, onboardingA), read($, scopeA), $.store.get(MEET_FLAG)])
  if (!meetShows(onb.meet, scope.mode, firedIn(mark), run.session)) return
  run.meetPressedAt = now
  $.clock.after(0, () => quiet(runCommand($, MEET_COMMAND)))
}

/** A plugin command, as if the person typed it; a refusal (an unknown name) says so in a toast. */
async function runCommand($: EngineInterface, command: string): Promise<void> {
  try {
    await $.command.run({ command })
  } catch {
    $.ui.toast(`counterparts: couldn't run /${command}`)
  }
}

/**
 * WHICH STORE (core #459): the dashboard on the port must serve the store this
 * session's wake named. Both known and different: everything read from it is
 * dropped (the pulse, today's counts, the last dream) and nothing more is read
 * until it matches again; the Mechanisms section says so. Either unknown
 * (no marker yet, an older core, `store: null`): carry on.
 */
async function storeMatches($: EngineInterface): Promise<boolean> {
  if (run.wakeStore === null) return true
  let dash: string | null = null
  try {
    const r = await $.http.fetch(`${await dashUrl($)}/api/whoami`)
    dash = r.ok ? storeOf(r.text) : null
  } catch {
    dash = null // down: the next read says so
  }
  const other = otherStore(run.wakeStore, dash)
  if (other !== run.foreign) {
    run.foreign = other
    if (other) {
      await update($, dashA, () => 'other')
      await update($, pulseA, () => null)
      await update($, todayA, () => null)
      await update($, dreamA, () => null)
    }
    // Either way the next read is a cold one: all of it again, from the right store.
    run.cold = false
  }
  return !other
}

async function refreshStatus($: EngineInterface): Promise<void> {
  $.ui.status(statusFor(await read($, scopeA)))
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
  firePulses($, ids, now)
  await update($, firingA, () => ({ ids: [...ids], at: now }))
  $.clock.after(FIRING_MS + 100, () => $.ui.invalidate('ui.render'))
}

async function setLatest($: EngineInterface, text: string, mech: MechId, body?: string): Promise<void> {
  await setLatestAt($, text, mech, await $.clock.now(), body)
}

async function setLatestAt($: EngineInterface, text: string, mech: MechId, at: number, body?: string): Promise<void> {
  const next: SidebarLatest = body === undefined ? { text, mech, at } : { text, mech, at, body }
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
  const journaled = await eventsOf($, '/api/activity?name=dream.journaled&limit=5')
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
    if (!(await storeMatches($))) return false
    const now = await $.clock.now()
    const stale = run.lastPollAt > 0 && now - run.lastPollAt > STALE_MS
    run.lastPollAt = now
    if (!run.cold || run.lastSeq < 0 || stale) {
      const { lastSeq } = await readPulse($)
      if ((await read($, dashA)) !== 'up') await update($, dashA, () => 'up')
      const seed = run.seeded ? Promise.resolve() : seedSession($)
      run.seeded = true
      await Promise.all([
        readToday($, lastSeq).catch(() => undefined),
        readDream($).catch(() => undefined),
        seed.catch(() => undefined),
        readOnboarding($),
      ])
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
    // The fox dreams while a dream runs (one begun, none ended since), in any session or at night.
    const dreams = events.filter(e => e.name === 'dream.begun' || e.name === 'dream.journaled' || e.name === 'dream.changed' || e.name === 'dream.undone')
    const lastDream = dreams.sort((a, b) => a.seq - b.seq).at(-1)
    if (lastDream !== undefined) await foxEvent($, lastDream.name === 'dream.begun' ? 'dream' : 'dreamEnd')
    const pulse = await read($, pulseA)
    const newDay = events.some(e => typeof e.day === 'number' && pulse !== null && e.day > pulse.day)
    if (newDay || events.some(e => COUNT_EVENTS.has(e.name))) await readPulse($)
    // The first meeting, a refresh while it can still move (done and skipped stay; unknown: an older core).
    const meet = (await read($, onboardingA)).meet
    if (meet !== 'unknown' && meet !== 'done' && meet !== 'skipped') await readOnboarding($)
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
    stopStage()
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
  await foxEvent($, 'came')
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
  if (s !== undefined && (mind === null || s.at > mind.at)) await setLatestAt($, storedWords(s.title), 'salience', s.at, bodyOf(s))
  else if (mind !== null && said !== null) await setLatestAt($, said, 'retrieval', mind.at)
}

/** What a memory tool saved: "Saved this session", newest first; an update's old title read from the dashboard. */
async function onSaved($: EngineInterface, items: readonly SidebarSaved[]): Promise<void> {
  if (items.length === 0) return
  await update($, savedA, list => [...[...items].reverse(), ...list])
  await foxEvent($, 'note')
  const first = items[0]
  if (first !== undefined) {
    await setLatest($, items.length === 1 ? storedWords(first.title) : storedWords(first.title, items.length), 'salience', bodyOf(first))
  }
  await fire($, items.some(i => i.kind === 'update') ? ['salience', 'reconsolidation'] : ['salience'])
  for (const it of items) {
    if (it.replacesId === null) continue
    const id = it.replacesId
    quiet(
      (async () => {
        const d = await fetchJson($, `/api/memory?id=${encodeURIComponent(id)}`)
        const title = (d as { found?: boolean; title?: string }).found === true ? (d as { title?: string }).title : undefined
        if (typeof title !== 'string' || title === '') return
        await update($, savedA, list => list.map(s => (s.key === it.key ? { ...s, replaces: title } : s)))
      })(),
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
      names.map(n => eventsOf($, `/api/activity?name=${encodeURIComponent(n)}&limit=${String(limit)}`)),
    )
    const seen = new Set<number>()
    const rows = [...panel, ...answers.flat()].filter(e => (seen.has(e.seq) ? false : (seen.add(e.seq), true)))
    firings = mechFirings(rows, id, dreams, 8)
    if (firings.length >= want || answers.every(a => a.length < limit) || limit * 2 > FALLBACK_MAX) return firings
  }
}

/** A click on a row of the body, by the key the layout gave it. */
async function clickBody($: EngineInterface, key: string): Promise<void> {
  // The Mechanisms section's link while the dashboard is down: the plugin's command starts it.
  // ... and off the terminal, the `more` that ends a cut text (no Link opens there): the same command, which opens
  // the dashboard when it is already up.
  if (key === 'dash:start' || key.startsWith('more:')) {
    $.clock.after(0, () => quiet(runCommand($, DASHBOARD_COMMAND)))
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
}

// ── the folder's switch ────────────────────────────────────────────────────

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
    let real: string | undefined
    try {
      real = (await $.fs.stat(head, { resolve: true })).realPath
    } catch {
      real = undefined
    }
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
 * The three-way switch, `on · paused · off` (2026-10-11; before, one
 * Counterparts dot that paused and resumed). Its safety is the old switch's,
 * with one change Mike made (2026-10-11, 15:25, lightly held):
 *
 * - While the folder's state is unknown, a press on any of the three only
 *   learns it (the registry file, then the server), and says what it found.
 * - It acts only on a folder whose OWN entry holds the mode; anything else
 *   (unset, following a parent, off or paused by a parent) is explained, not
 *   changed (`switchExplains`): the `scope` tool can't put a folder back to
 *   unset, and a parent is never flipped from here.
 * - `paused` and `off` ask first (the confirm row; only its button calls the
 *   tool); `on` resumes the folder's own pause at once.
 * - `on` turns a folder that is off by its own entry back on, or a reads-only
 *   (`observer`) one fully on, after the same confirm (Mike: the switch may
 *   undo an off). Through the `scope` tool, which answers in an off folder.
 */
async function pressScope($: EngineInterface, to: 'on' | 'paused' | 'off'): Promise<void> {
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
            ? 'Counterparts memory is paused in this folder. Press on to turn it back on.'
            : now.mode === 'off'
              ? 'Counterparts memory is off in this folder. Press on to turn it back on (it asks first).'
              : now.mode === 'observer'
                ? 'Counterparts reads only in this folder: memories come to mind, nothing new is kept. Paused or off asks first.'
                : 'Counterparts memory is on in this folder. Paused or off asks first.'),
      )
    }
    return
  }
  const why = switchExplains(scope)
  if (why !== null) {
    await noteSwitch($, why)
    return
  }
  // Here the folder's own entry is on, observer, paused or off.
  if (to === 'on') {
    if (scope.mode === 'paused') await setScope($, 'resume')
    else if (scope.mode === 'off' || scope.mode === 'observer') await askChange($, scope, 'on')
    return
  }
  if (scope.mode === 'off') {
    if (to === 'paused') await noteSwitch($, 'Counterparts memory is off in this folder. Press on to turn it back on (it asks first).')
    return
  }
  if (to === 'paused' && scope.mode === 'paused') return
  await askChange($, scope, to === 'paused' ? 'pause' : 'off')
}

/** A pause, an off, or an on from off or observer asks first: the confirm row above the switches. Nothing is called until its button. */
async function askChange($: EngineInterface, scope: SidebarScope, to: 'pause' | 'off' | 'on'): Promise<void> {
  const at = await $.clock.now()
  const ask = { dir: scope.dir ?? 'this folder', at, to }
  await noteSwitch($, null)
  await update($, pauseAskA, () => ask)
  $.clock.after(AUTO_CLOSE_MS, () => {
    quiet(update($, pauseAskA, a => (a !== null && a.at === at ? null : a)))
  })
}

async function cancelPause($: EngineInterface): Promise<void> {
  await update($, pauseAskA, () => null)
}

/**
 * The confirm row's [Pause], [Turn off] or [Turn on]: the only presses that
 * pause, turn off, or turn on from off, and only a folder still holding its
 * own entry in a mode that confirm may change (`CONFIRM_FROM`).
 */
async function confirmChange($: EngineInterface): Promise<void> {
  const ask = await read($, pauseAskA)
  await update($, pauseAskA, () => null)
  if (ask === null) return
  const to = ask.to ?? 'pause'
  const scope = await read($, scopeA)
  if (scope.busy || switchExplains(scope) !== null || !scope.own) return
  if (!CONFIRM_FROM[to].includes(scope.mode)) return
  await setScope($, to)
}

/** One call: pause, resume, turn off or turn on this folder's own entry. */
async function setScope($: EngineInterface, to: 'pause' | 'resume' | 'off' | 'on'): Promise<void> {
  const scope = await read($, scopeA)
  await update($, scopeA, () => ({ ...scope, busy: true }))
  try {
    const { payload, isError } = await callMemory($, 'scope', { mode: to })
    const now = scopeOf(payload, isError, scope)
    await update($, scopeA, () => now)
    await noteSwitch($, now.error === null ? null : payload?.['stoodDown'] === true ? stoodDownNote(scope, to) : isRefusal(now.error) ? failedPressNote(to, now.error) : `The memory server said: ${now.error}`)
  } catch (err) {
    await update($, scopeA, () => ({ ...scope, busy: false }))
    await noteSwitch($, failedPressNote(to, err))
  }
  look.mono = isPaused((await read($, scopeA)).mode)
  await refreshStatus($)
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
  // The desktop asks for a narrower pane: its font fits a fifth more in a cell's width (Mike, 2026-10-13).
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: run.surface === 'desktop' ? OPEN_COLUMNS - 4 : OPEN_COLUMNS })
  await update($, placedA, () => opened.isPlaced)
  $.ui.invalidate('ui.render')
  return { isPlaced: opened.isPlaced }
}

/** Closes the pane for the quiet view: the tail draws again. */
async function closeQuiet($: EngineInterface): Promise<void> {
  await setView($, 'quiet')
  stopBrain()
  stopStage()
  await update($, placedA, () => false)
  await $.ui.close({ id: PANE })
  $.ui.invalidate('ui.render')
}

/** The view, for this session and (in `$.store`) the next. */
async function setView($: EngineInterface, view: SidebarView): Promise<void> {
  if ((await read($, viewA)) !== view) await update($, viewA, () => view)
  await $.store.set('view', view)
  if (view !== 'sidebar') {
    stopBrain()
    stopStage()
  }
}

/** The avatar, for every session (`$.store` `brain`): the fox, the brain turning or still, or none. */
async function setBrain($: EngineInterface, mode: SidebarBrain): Promise<void> {
  await $.store.set('brain', mode)
  if ((await read($, brainA)) !== mode) await update($, brainA, () => mode)
  look.still = mode === 'still'
  brain.hold(mode === 'still')
  if (mode !== 'turning') stopBrain()
  else brain.wake()
  if (mode !== 'fox') stopStage()
  raster.look = ''
  $.ui.invalidate('ui.render')
}

/** The pane's colours, for every session (`$.store`): tron or cozy. The Pane hook applies it at each drawing. */
async function setTheme($: EngineInterface, name: SidebarTheme): Promise<void> {
  await $.store.set('theme', name)
  if ((await read($, themeA)) !== name) await update($, themeA, () => name)
}

/**
 * Opened without being asked: only where it docks as a sidebar, and only when
 * the stored view is the sidebar. Measured live (v0.1): the band draws BEFORE
 * `session.start` has read the stored view, so the view (and the theme) is
 * read from the store here.
 */
async function openUnasked($: EngineInterface): Promise<void> {
  const view = normView(await $.store.get('view'))
  if ((await read($, viewA)) !== view) await update($, viewA, () => view)
  const theme = normTheme(await $.store.get('theme'))
  if ((await read($, themeA)) !== theme) await update($, themeA, () => theme)
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

/**
 * One frame of the turning brain onto the mounted Raster; the blit's time is
 * the measurement. The burst rate only while a pulse's arc is in flight, the
 * calm rate while it sways, and no timer at all at rest.
 */
async function tick($: EngineInterface, gen: number): Promise<void> {
  if (gen !== run.brainGen) return
  // The engine's clock, read once a frame (a round trip to the host). One read at a time: a tick that comes while
  // one waits is skipped, so ticks never overlap and the time never runs backwards.
  if (fps.ticking) return
  fps.ticking = true
  let now: number
  try {
    now = await $.clock.now()
  } finally {
    fps.ticking = false
  }
  if (gen !== run.brainGen) return
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
  // Not awaited: the next tick runs on its timer whatever the blit's answer (`inFlight` holds the next blit back).
  quiet(
    (async () => {
      let r: Awaited<ReturnType<EngineInterface['ui']['blit']>>
      try {
        r = await $.ui.blit({ requestId: PANE, key: 'brain', cells, columns: raster.cols, rows: raster.rows })
      } catch {
        if (blitGen !== run.brainGen) return
        stopBrain()
        redrawAfterRefusal($)
        return
      }
      if (blitGen !== run.brainGen) return
      fps.inFlight = false
      if (r.deny !== undefined) {
        stopBrain()
        redrawAfterRefusal($)
        return
      }
      run.redraws = 0
      // The frame's time (the clock read once): the measurement.
      fps.blits.push(now)
      if (fps.blits.length > 240) fps.blits.shift()
    })(),
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
  run.brainTimer = $.clock.every(paceMs(pace), () => quiet(tick($, gen)))
}

// ── the fox (fox.ts holds what it does and how each frame looks) ──

function stopStage(): void {
  stage.gen += 1
  stage.live = false
}

/** Something real happened: the fox's moment for it plays now, if the stage is up (else the next drawing shows where it is). */
async function foxEvent($: EngineInterface, ev: FoxEvent): Promise<void> {
  const now = await $.clock.now()
  stage.director ??= newDirector(now)
  trigger(stage.director, ev, now)
  if (stage.live) {
    stage.gen += 1
    const gen = stage.gen
    $.clock.after(0, () => quiet(stageStep($, gen)))
  }
}

/**
 * What is on screen next, then one wait until it changes: no timer runs in
 * between (a still hold is one wait of 4–9 s). A change on a Raster or an
 * Image is a blit; in sextants (Text) or on the desktop (an Svg) a redraw of
 * the pane. A pane no longer shown stops it (the next drawing starts it). A
 * refused blit stops it; an Image refused twice in a row (it draws its alt
 * here) leaves `auto` drawing sextants for the session.
 */
async function stageStep($: EngineInterface, gen: number): Promise<void> {
  if (gen !== stage.gen || !stage.live) return
  const now = await $.clock.now()
  stage.director ??= newDirector(now)
  const { step, next } = advance(stage.director, now)
  const key = stepKey(step)
  if (key !== stage.shown) {
    if (!(await paneShown($))) {
      stopStage()
      return
    }
    if (gen !== stage.gen) return
    stage.shown = key
    const tier = stage.tier
    if (tier === 'basic' || tier === 'image') {
      const args =
        tier === 'basic'
          ? { requestId: PANE, key: 'stage', cells: halfCells(step), columns: STAGE_COLS, rows: stageRows('basic') }
          : { requestId: PANE, key: 'stage', source: pngFile(step), columns: IMAGE_COLS, rows: IMAGE_ROWS }
      // Not awaited: the next wait is set below at once, whatever the blit's answer.
      quiet(
        (async () => {
          let r: Awaited<ReturnType<EngineInterface['ui']['blit']>>
          try {
            r = await $.ui.blit(args)
          } catch {
            if (gen === stage.gen) stopStage()
            return
          }
          if (gen !== stage.gen) return
          if (r.deny === undefined) {
            run.redraws = 0
            if (tier === 'image') stage.imageDenies = 0
            return
          }
          if (tier === 'image') {
            stage.imageDenies += 1
            if (stage.imageDenies >= 2) stage.noImages = true
          }
          stopStage()
          redrawAfterRefusal($)
        })(),
      )
    } else $.ui.invalidate('ui.render')
  }
  $.clock.after(Math.max(16, next - now), () => quiet(stageStep($, gen)))
}

/** Starts the stage's timer under a new generation, once its element is mounted. */
function startStage($: EngineInterface): void {
  if (stage.live) return
  stage.gen += 1
  stage.live = true
  const gen = stage.gen
  $.clock.after(0, () => quiet(stageStep($, gen)))
}

/**
 * The desktop's pane, as wide as the person drags it (it keeps their width, not the one a plugin asks for;
 * measured 2026-10-13): the fox shows down to this many columns, scaled to fit, where the terminal needs
 * STAGE_COLS. `w` is the last drawing's width.
 */
const STAGE_MIN_PROSE_COLS = 22
const prosePane = { w: STAGE_COLS }

/** The Image's source for a step: the PNG file, which the terminal reads itself. */
function pngFile(step: Step): { file: string; format: 'png' } {
  return { file: `${stage.pngDir ?? ''}/${pngName(step)}`, format: 'png' }
}

/** The folder of the fox's PNGs under the plugin's, or null when neither place holds them. */
async function findPngDir($: EngineInterface): Promise<string | null> {
  const root = $.plugin.root.replace(/[/\\]+$/, '')
  for (const rel of PNG_DIRS) {
    const dir = `${root}/${rel}`
    try {
      if (await $.fs.exists(`${dir}/idle.png`)) return dir
    } catch {
      // not readable: the next place
    }
  }
  return null
}

/** A PNG's bytes (base64) for the desktop's Svg, read once from the plugin's folder; '' when it can't be. */
async function pngData($: EngineInterface, name: string): Promise<string> {
  const known = stage.pngData.get(name)
  if (known !== undefined) return known
  let data = ''
  if (stage.pngDir !== null) {
    try {
      data = (await $.fs.read(`${stage.pngDir}/${name}`, { as: 'bytes' })).base64
    } catch {
      data = ''
    }
  }
  stage.pngData.set(name, data)
  return data
}

/** The stage's element in a tier, for the step on screen (`png`: the desktop's picture, base64). */
function stageElement(els: ReturnType<EngineInterface['ui']['resolve']>, tier: FoxTier, step: Step, png: string): JSX.Element {
  if (tier === 'basic' && 'Raster' in els) {
    const { Raster } = els
    return <Raster key="stage" columns={STAGE_COLS} rows={stageRows('basic')} cells={halfCells(step)} />
  }
  if (tier === 'image' && 'Image' in els) {
    const { Box, Image } = els
    return (
      <Box key="stage-box" flexDirection="row" paddingLeft={IMAGE_X0}>
        <Image key="stage" source={pngFile(step)} columns={IMAGE_COLS} rows={IMAGE_ROWS} alt="a small fox" />
      </Box>
    )
  }
  if (tier === 'svg' && 'Svg' in els) {
    const { Svg } = els
    const svg = foxSvg(step, png)
    // A pane dragged narrower than the fox: the fox scales down with it (about 7 px a cell on the desktop).
    const k = Math.min(1, (prosePane.w * 7) / svg.width)
    return <Svg key="stage" source={svg.source} alt="a small fox" width={Math.round(svg.width * k)} height={Math.round(svg.height * k)} />
  }
  // fine: each row as runs of one colour pair; a cell with no colour is the panel's.
  const { Box, Text } = els
  return (
    <Box key="stage" flexDirection="column" width={STAGE_COLS}>
      {fineCells(step).map((line, y) => (
        <Box key={`s${String(y)}`} flexDirection="row">
          {runs(line).map((r, i) => (
            <Text key={String(i)} {...(r.fg === null ? {} : { color: r.fg })} {...(r.bg === null ? {} : { backgroundColor: r.bg })}>
              {r.ch}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

/** The fox's detail, for every session (`$.store` `avatarDetail`): auto, images, fine or basic. */
async function setDetail($: EngineInterface, detail: FoxDetail): Promise<void> {
  await $.store.set('avatarDetail', detail)
  stage.detail = detail
  stage.noImages = false
  stage.imageDenies = 0
  stopStage()
  stage.shown = ''
  $.ui.invalidate('ui.render')
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

/**
 * The links the sidebar draws (`Link`): the dashboard's, on localhost and the
 * port it read (`isDashboardUrl`), or none. A click opens what the surface
 * opens: on the terminal an OSC 8 link (⌘-click in iTerm2), on the desktop
 * plain text, since a remote surface links only `https:`. The sidebar runs no
 * process to open one (the plugin directory build, 2026-10-14).
 */
async function dashboardHref($: EngineInterface, path: string): Promise<string | null> {
  const url = `${await dashUrl($)}${path}`
  return isDashboardUrl(url, await dashPort($)) ? url : null
}

/** The body's lines, each `more` that ends a cut text given the link to its memory on the dashboard. */
function linkMore(lines: readonly Line[], base: string, port: number): Line[] {
  return lines.map(l => {
    const id = l.link?.key.startsWith('more:') === true ? l.link.key.slice(5) : null
    if (l.link === undefined || id === null || !/^mem_[A-Za-z0-9]+$/.test(id)) return l
    const href = memoryUrl(id, base)
    return isDashboardUrl(href, port) ? { ...l, link: { ...l.link, href } } : l
  })
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
      description: 'Counterparts sidebar: open it, make it quiet, or set the avatar or the theme',
      argumentHint: '[quiet | avatar animal|brain|off | avatar detail auto|images|fine|basic | theme tron|cozy | resume | fps [n]]',
    })
    // (A `claudeMemory` or `claudeMemorySwitch` left in the store by an older version is never read.)
    const [viewPref, brainPref, fpsPref, themePref, detailPref] = await Promise.all([
      $.store.get('view'),
      $.store.get('brain'),
      $.store.get('fps'),
      $.store.get('theme'),
      $.store.get('avatarDetail'),
    ])
    // A new module life's fox starts fresh: still, awake, trying pictures again where they may show.
    stage.director = null
    stage.noImages = false
    stage.imageDenies = 0
    stage.detail = normDetail(detailPref)
    // The PNGs ship as files beside the module (art/fox/): found once; none found, the terminal draws no pictures.
    stage.pngDir = await findPngDir($)
    stage.pngData.clear()
    if (stage.pngDir === null) stage.noImages = true
    // What this terminal can draw the fox with, read once (fox.ts, `pickTier`).
    // (Each name spelled out: the engine lists the variables a module reads.)
    const envVals = await Promise.all([
      $.env.get('TERM_PROGRAM').catch(() => undefined),
      $.env.get('TERM').catch(() => undefined),
      $.env.get('KITTY_WINDOW_ID').catch(() => undefined),
      $.env.get('WEZTERM_EXECUTABLE').catch(() => undefined),
      $.env.get('TMUX').catch(() => undefined),
      $.env.get('STY').catch(() => undefined),
      $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES').catch(() => undefined),
    ])
    stage.env = Object.fromEntries(TIER_ENV.map((k, i) => [k, envVals[i]]).filter(([, v]) => typeof v === 'string'))
    await update($, themeA, () => normTheme(themePref))
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
      // Where this folder stands, now and every few minutes.
      $.clock.after(0, () => quiet(refreshScope($)))
      run.scopeTimer?.cancel()
      run.scopeTimer = $.clock.every(SCOPE_RECHECK_MS, () => quiet(refreshScope($)))
    }
    return next(e)
  })

  on('command.run', { command: 'counterparts' }, async ($, e) => {
    // This hook answers without `next`, so no hook beneath sees the command: the speak-first learns it from here.
    const kind = (e.origin as { kind?: string } | undefined)?.kind
    if (kind === 'composer' || kind === 'bridge') {
      if (run.session === '') run.session = await $.session.id()
      await update($, typedInA, () => run.session)
    }
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
        return { text: `Brain target set to ${String(n)} fps. ${fpsReport(mode, await $.clock.now())}` }
      }
      return { text: fpsReport(mode, await $.clock.now()) }
    }
    // `strip` (dropped 2026-10-10) is quiet now: an older term-loop's put-back can still type it.
    if (verb === 'quiet' || verb === 'hide' || verb === 'rail' || verb === 'strip') {
      await closeQuiet($)
      return { text: 'Counterparts quiet: the newest thing shows dim after the line under the prompt. /counterparts opens the sidebar.' }
    }
    if (verb === 'avatar') {
      if (arg === 'detail') {
        const d = e.args.trim().split(/\s+/)[2] ?? ''
        if (d !== 'auto' && d !== 'images' && d !== 'fine' && d !== 'basic') {
          return { text: `counterparts avatar detail: auto, images, fine or basic (now ${stage.detail}, drawn ${stage.tier === 'image' ? 'as a picture' : stage.tier === 'fine' ? 'in sextants' : stage.tier === 'svg' ? 'as a drawing' : 'in half-blocks'}).` }
        }
        await setDetail($, d)
        return {
          text:
            d === 'auto'
              ? 'The fox is drawn the finest way this terminal is known to show.'
              : d === 'images'
                ? 'The fox is drawn as a picture (kitty, Ghostty); a terminal that cannot shows its name instead.'
                : d === 'fine'
                  ? 'The fox is drawn in sextants (six pixels a cell), for a font that has them.'
                  : 'The fox is drawn in half-blocks, which every terminal shows.',
        }
      }
      if (arg === 'animal' || arg === 'fox') {
        await setBrain($, 'fox')
        return { text: 'The avatar is the fox: it sits still, now and then blinks or looks around, naps when nothing happens, and shows what memory is doing.' }
      }
      if (arg === 'brain') {
        const now = await read($, brainA)
        await setBrain($, now === 'still' ? 'still' : 'turning')
        return { text: 'The avatar is the brain: it turns slowly, and lights where something fires.' }
      }
      if (arg === 'off') {
        await setBrain($, 'off')
        return { text: 'No avatar: the header is two lines.' }
      }
      return { text: 'counterparts avatar: animal, brain or off; or detail auto, images, fine or basic.' }
    }
    if (verb === 'brain') {
      if (arg !== 'turning' && arg !== 'still' && arg !== 'off') return { text: 'counterparts brain: turning, still or off.' }
      await setBrain($, arg)
      return { text: arg === 'off' ? 'The brain is off: the header is one line.' : arg === 'still' ? 'The brain holds still, and lights where something fires.' : 'The brain turns slowly, and lights where something fires.' }
    }
    if (verb === 'theme') {
      if (arg !== 'tron' && arg !== 'cozy') return { text: `counterparts theme: tron or cozy (now ${normTheme(await read($, themeA))}).` }
      await setTheme($, arg)
      return { text: arg === 'cozy' ? 'Theme cozy: walnut, parchment, leaf green and pumpkin, in every session.' : 'Theme tron: black, cyan and amber, in every session.' }
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
      return { text: 'Usage: /counterparts [quiet | avatar animal|brain|off | avatar detail auto|images|fine|basic | theme tron|cozy | resume | fps [n]]. With nothing after it, opens the sidebar.' }
    }
    // Asked for: placed at any width, whatever view it was left in.
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Counterparts sidebar opened.' : 'Counterparts sidebar is open but this surface does not place panes.' }
  })

  // Saved this session, and footnotes Claude opened: the memory tools, after a call that answered without error
  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    const ours = ourTool(name)
    // The fox dreams while this session's dream runs.
    if (ours?.tool === 'dream') await foxEvent($, 'dream')
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } finally {
      if (ours?.tool === 'dream') await foxEvent($, 'dreamEnd')
    }
    if (ran.deny !== undefined || ran.isError === true) return ran
    if (ours === null) return ran
    // Core's first-meeting tool moved the state: read it again (the button shows or hides); the fox says hello.
    if (ours.tool === 'meet') {
      quiet(readOnboarding($))
      await foxEvent($, 'hello')
    }
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

  // A prompt the person sent: the fox looks up.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if (kind === 'composer' || kind === 'bridge') await foxEvent($, 'prompt')
    return next(e)
  }).catch(($, e, next) => next(e))

  // Memories and Subconscious: the recall block the classic hook injects; and the wake's onboarding marker
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
      // The wake's store marker: which store this session's hooks opened (the dashboard must serve the same).
      const storeId = parseStoreMarker(text)
      if (storeId !== null) run.wakeStore = storeId
      // The wake's onboarding marker: where the first meeting stands (the button shows or hides).
      const meet = parseOnboardingMarker(text)
      if (meet !== null) await takeOnboarding($, { meet, where: null, style: null })
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
      stopStage()
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

  // Under the prompt: the newest thing, dim, after the engine's own hint line
  // (its pills stay live), only while the pane is closed, and not while the
  // folder is paused (the amber status says so). It always ends with
  // ` · /counterparts opens it`, the newest thing shortened to keep that whole.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [view, placed, latest, scope] = await Promise.all([read($, viewA), read($, placedA), read($, latestA), read($, scopeA)])
    if ((normView(view) === 'sidebar' && placed) || isPaused(scope.mode)) return next(e)
    const cols = e.viewport?.columns
    // The engine's line is wider than its `hint` prop, and it cuts the tail short of the row's end (TAIL_SPARE).
    const room = typeof cols === 'number' ? cols - cells(e.props.hint) - TAIL_SPARE : null
    if (latest === null && normView(view) === 'sidebar') {
      // an unasked pane this surface could not place (the window too narrow to dock it): say to widen it, until it draws
      return run.hint ? next({ ...e, props: { ...e.props, tail: narrowHint(room) } }) : next(e)
    }
    // Fullscreen docks the pane (and opens it); the classic screen cannot, so the hint there points at /tui fullscreen.
    // A window still too narrow to place the asked-for pane keeps saying to widen it after something new.
    const docks = e.viewport?.isFullscreen ?? run.docks
    const wanted = run.hint && normView(view) === 'sidebar' ? NARROW_HINT : docks === false ? CLASSIC_HINT : TAIL_HINT
    const tail = quietTail(latest?.text ?? null, room, await $.clock.now(), latest?.body, wanted)
    return next({ ...e, props: { ...e.props, tail } })
  }).catch(($, e, next) => next(e))

  // The band above the prompt: its first drawing says whether this surface
  // docks a pane (the sidebar opens unasked only then). Nothing is drawn there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const docks = e.viewport?.isFullscreen
    if (docks !== undefined) run.docks = docks
    run.surface = e.surface
    if (docks !== undefined && !run.placementDecided) {
      run.placementDecided = true
      if (docks) $.clock.after(0, () => quiet(openUnasked($)))
    }
    return next(e)
  })

  // ── the pane ──────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    const now = await $.clock.now()
    const [pulse, dash, mind, saved, today, dreamNow, open, mech, focus, firing, scope, view, brainMode, note, pauseAsk] = await Promise.all([
      read($, pulseA), read($, dashA), read($, mindA), read($, savedA), read($, todayA), read($, dreamA), read($, openA), read($, mechA),
      read($, focusA), read($, firingA), read($, scopeA), read($, viewA), read($, brainA), read($, noteA), read($, pauseAskA),
    ])
    const [onboarding, theme] = await Promise.all([read($, onboardingA), read($, themeA)])
    // Every colour below (and in the body's lines) is read from the palette in use: this session's theme.
    applyTheme(normTheme(theme), e.surface)
    const paused = isPaused(scope.mode)
    // The desktop draws no brain yet (no Raster; a static Svg brain didn't light up, Mike 2026-10-13: next
    // version): a stored brain choice shows the fox there, and the terminal keeps the brain.
    const mode = SURFACE.prose && normBrain(brainMode) !== 'off' ? 'fox' : normBrain(brainMode)
    look.mono = paused
    look.still = mode === 'still'
    look.sel = mech === null ? null : mech.id
    // A reload keeps the state: a `firing` written by v0.1 (`{ id, at }`, no `ids`) lights nothing.
    const firingNow: readonly MechId[] =
      !paused && firing !== null && now - firing.at < FIRING_MS && Array.isArray(firing.ids) ? firing.ids : []
    look.firing = firingNow
    const W = Math.max(e.props.bodyColumns, 1)
    prosePane.w = W
    const fill = Math.max(1, e.props.scroll?.bodyRows ?? 1)
    const inline = e.props.placement === 'inline'
    const w = Math.max(16, inline ? Math.min(W - 2, 64) : W - 2)
    run.bodyW = w
    const hasRaster = e.surface === 'terminal' && mode !== 'off'
    // The fox's stage: on a pane tall and wide enough (shorter, the brain's header, standing still), in the
    // tier this surface draws (fox.ts); on a surface with no way to draw it, the header with no avatar.
    const tier = pickTier(e.surface, stage.detail, stage.env, stage.noImages, stage.pngDir !== null)
    const drawsStage = tier === 'svg' ? 'Svg' in els : 'Raster' in els
    const hasStage = mode === 'fox' && drawsStage && !inline && fill >= STAGE_MIN_PANE_ROWS && W >= (SURFACE.prose ? STAGE_MIN_PROSE_COLS : STAGE_COLS)
    // While the pane holds the keyboard the brain and the fox hold still.
    const holding = e.props.isFocused === true
    if (!hasStage || holding || tier !== stage.tier) stopStage()
    stage.tier = tier
    if (e.surface === 'terminal' && (holding || mode !== 'turning')) stopBrain()
    if (normView(view) === 'sidebar') wake($, hasRaster && mode === 'turning' && !holding)

    const roomy = fill >= ROOMY_ROWS
    const lit = firingNow[0] ?? look.sel
    // Every press in the pane, as a closure over this hook's `$` (the views take no `$`).
    const actions: PaneActions = {
      dashboardHref: e.surface === 'terminal' ? await dashboardHref($, '/') : null,
      openDashboard: async () => $.clock.after(0, () => quiet(runCommand($, DASHBOARD_COMMAND))),
      pressScope: to => pressScope($, to),
      pressMeet: () => pressMeet($),
      confirmChange: () => confirmChange($),
      cancelPause: () => cancelPause($),
      view: v => (v === 'sidebar' ? openPane($) : closeQuiet($)),
      brain: b => setBrain($, b),
    }
    const paneEls: PaneEls = { Box, Text, Button, Link }
    const rows: JSX.Element[] = []
    let used = 0
    if (roomy) {
      rows.push(<Text key="top"> </Text>)
      used += 1
    }

    // ── the header: the terminal's brain beside the title, or (desktop, the brain off) a dot before it ──
    const countText = pulse === null ? '' : memoriesCount(pulse.memories)
    const day = pulse === null ? null : pulse.day
    let stageTop: JSX.Element[] | null = null
    if (hasStage) {
      // The title row (the count and the day on its right), the stage edge to edge (outside the frame's
      // padding) and a thin rule.
      stage.director ??= newDirector(now)
      const step = advance(stage.director, now).step
      // An Image's first frame is blitted once mounted too: a refusal says it draws its alt here.
      stage.shown = tier === 'image' ? '' : stepKey(step)
      const [title] = brainlessHeader(paneEls, actions, { w, paused, lit, day, count: countText })
      const png = tier === 'svg' ? await pngData($, pngName(step)) : ''
      stageTop = [...rows, ...(title === undefined ? [] : [title]), stageElement(els, tier, step, png)]
      rows.length = 0
      rows.push(SURFACE.prose ? <Text key="stage-rule"> </Text> : <Text key="stage-rule" color={P.faint}>{'─'.repeat(w)}</Text>)
      // The desktop's Svg is 180 px tall, about ten of its text rows (measured 2026-10-13), not the cells' fifteen;
      // fewer when a narrow pane scales it down (stageElement's factor).
      used += 1 + (tier === 'svg' ? (SURFACE.prose ? Math.ceil(10 * Math.min(1, (W * 7) / (STAGE_COLS * 6))) : 15) : stageRows(tier)) + 1
      if (!holding) startStage($)
    } else if (mode === 'fox' && !hasRaster) {
      rows.push(...brainlessHeader(paneEls, actions, { w, paused, lit, day, count: countText }))
      used += 2
    } else if (hasRaster) {
      const { Raster } = $.ui.resolve(e)
      rows.push(...brainHeader(paneEls, Raster, actions, { w, paused, day, count: countText, now }))
      used += BRAIN_ROWS + 1
    } else {
      rows.push(...brainlessHeader(paneEls, actions, { w, paused, lit, day, count: countText }))
      used += 2
    }

    // ── a paused folder says so before anything else in the pane ──
    if (paused) {
      rows.push(...pausedBanner(paneEls, actions, scope, w))
      used += 3
    }

    // ── the first meeting, not started, put off or not finished: one cyan row at the top of the body ──
    // (The speak-first's mark, when that module is loaded and fired in this session: it is the introduction.)
    if (meetShows(onboarding.meet, scope.mode, firedIn(await $.store.get(MEET_FLAG)), run.session)) {
      rows.push(...meetRow(paneEls, actions, w))
      used += 2
    }

    // ── what the switches say, above them: the pause (or off) confirm, a note ──
    const above = aboveSwitches(paneEls, actions, { scope, pauseAsk, note, w })

    // ── the body: the five sections, folded to the room left ──
    // The rule, the Counterparts switch, the view, the brain.
    const footRows = 4
    // The desktop's rows are its font's, a little taller than the cells it reports: two rows of headroom keep its
    // pane from scrolling by a line (2026-10-13).
    const bodyRows = Math.max(4, fill - used - above.length - footRows - (SURFACE.prose ? 2 : 0))
    // The desktop sets the body in its own font, about a fifth narrower than the cells the pane is measured in:
    // wrap to that, and a blank row between items there (2026-10-13, Mike: "hard to read").
    const bodyW = SURFACE.prose ? Math.floor(w * 1.2) : w
    const { lines } = layoutBody({ w: bodyW, rows: bodyRows, now, mind, saved, today, dream: dreamNow, open, mech, focus, dash, prose: SURFACE.prose, cellsW: w })
    // The body's surface module stays here, its module a literal on the tag's own line: the engine reads a hooks
    // module's surface modules off its own source.
    if ('Client' in els) {
      // A Link only on the terminal: the desktop draws a non-https link as plain text, so `more` posts its key there.
      const bodyLines = e.surface === 'terminal' ? linkMore(lines, await dashUrl($), await dashPort($)) : lines
      const bodyProps: BodyProps = { lines: bodyLines, prose: SURFACE.prose }
      rows.push(<els.Client key="body" module="./body.tsx" width={w} props={bodyProps} />)
    } else rows.push(plainBody(paneEls, lines))
    rows.push(<Box key="spacer" flexGrow={1} />)
    rows.push(...above)

    // ── the footer: each dot and its word one hit target ──
    // While the pause asks (or a note explains), those rows sit right above the footer, and the pointer is still
    // on the switch it just pressed: a card there would cover [Pause] [Cancel] or the note's last line.
    rows.push(footer(paneEls, actions, { scope, w, view: normView(view), mode, cards: above.length === 0 }))

    return frame(paneEls, W, fill, rows, stageTop)
  })
}
