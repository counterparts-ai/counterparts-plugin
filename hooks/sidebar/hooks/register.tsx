/**
 * The Counterparts sidebar (v1, the directory trim of 2026-10-14): what
 * memory is doing, in 35 columns. It shows; it does not act.
 *
 * The fox (or no avatar) above the title, the day and the count; then what
 * was put in front of Claude for the last message (Memories, said in full;
 * Subconscious, titles only), what this session saved, how often each
 * mechanism fired today, and the last dream; then a footer of instructions:
 * how to start the intro, open the dashboard, pause memory here, or hide the
 * pane (`words.ts#footerLines`). Closed (`quiet`), it is only a dim tail under
 * the prompt, ending with how to open it again. `/counterparts` opens it and
 * sets the avatar and the theme. The design is the round-3 mockups Mike chose
 * on 2026-10-10 (`~/counterparts-notes/mockups/2026-10-10-mod-round3/`);
 * ../NOTES.md says where the build differs and why. The fuller v0.2 (the
 * brain, the folder switch, the intro and dashboard buttons) is kept on the
 * branch `sidebar-full-0.3.22`.
 *
 * Where things come from (no network, 2026-10-14):
 *   - the status file Counterparts writes for it (`sidebar.json` beside the
 *     configuration, next to `scopes.json`; `./status.ts`), read-only, on a
 *     timer while the pane shows: which memory wrote it (another one's
 *     numbers are never shown), day and count, times fired today, the last
 *     dream, the activity log's newest rows (a mechanism's firings, this
 *     session's rows on a resume) and the memories they name (opened in
 *     place). Core's own processes write it: the worker after each turn, the
 *     memory server after its tool calls and when the log moves;
 *   - the scope registry file the hooks read (`scopes.json` beside the
 *     configuration, read-only, `./scopes.ts`): where this folder stands, for
 *     the paused banner and the status line;
 *   - this session: the recall block the classic UserPromptSubmit hook
 *     injects (Memories, Subconscious), and `tool.call` on remember (or
 *     its old name note) / session_end (Saved) and on recall by id (`↗ opened`).
 *
 * No command is run, no tool is called, no process is started and nothing is
 * fetched from here (the directory build's policy read, 2026-10-14), and
 * nothing is a link: the footer says `/counterparts:dashboard`. The speak-first, which submits one prompt once per install, is
 * `speak-first.tsx`, a hooks module of its own that only the full build
 * carries. So is `actions.tsx` (2026-10-16), which gives the full build's pane
 * the Meet row, the title's link to the dashboard and a footer of clickable
 * rows (`state.ts#run.full`); with it unset, as in the directory's build, none
 * of them is drawn and a `set:` click does nothing.
 *
 * The engine lets `$` pass only to functions declared at the top of this
 * file, reads a `$.state` source only from an atom declared here, and reads
 * the surface modules (`<Client module=…>`) off this file's source, so those
 * live here: every function that touches the engine, the atoms, the hooks.
 * Everything else is beside it, with no `$`. The shared core: `state.ts`
 * (timings, `run`), `words.ts` (what the sidebar says), `status.ts` (the
 * status file, read), `feed.ts` (the log's rows and the recall block, read), `sections.ts` (the body's
 * sections, laid out), `mechanisms.ts`, `scopes.ts`, `theme.ts` (the colours).
 * The views: `pane.tsx` (the pane's tree on every surface), `desktop.tsx` (the
 * header), `fox.ts` with `fox-art.ts` and `cells.ts` (the fox), `width.ts`
 * and `tail.ts`, and `body.tsx` (the body, a Client surface module).
 */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  SidebarAvatar,
  SidebarDream,
  SidebarLatest,
  SidebarMind,
  SidebarRow,
  SidebarSaved,
  SidebarScope,
  SidebarTheme,
  SidebarToday,
  SidebarView,
} from '../types'
import type { BodyProps } from './body'
import { header } from './desktop'
import {
  RULES,
  classify,
  dateOf,
  decisionFor,
  firingIds,
  firingTitle,
  firstSentence,
  mechFirings,
  mechsOf,
  openedIds,
  otherStore,
  ourTool,
  parseRecallBlock,
  parseGlance,
  parseOnboardingMarker,
  parseStoreMarker,
  savedItems,
  surfacedIds,
  titled,
} from './feed'
import type { DashDream, DashEvent, Firing, RecallBlock } from './feed'
import { MECHS, mechById } from './mechanisms'
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
import { foxSvg } from './fox-svg'
import { footer, footerRows, frame, pausedBanner, plainBody } from './pane'
import type { PaneEls } from './pane'
import { lookup, parentOf, parseRegistry, settingsHookConfig } from './scopes'
import type { RegistryMode } from './scopes'
import { layoutBody } from './sections'
import type { Line } from './sections'
import {
  FILL_NOTE_MS,
  FIRING_MS,
  MEET_FLAG,
  NAMES_NOTHING,
  OPEN_COLUMNS,
  POLL_IDLE_MS,
  POLL_MS,
  ROOMY_ROWS,
  SCOPES_FILE_TTL_MS,
  SCOPE_RECHECK_MS,
  UNKNOWN_SCOPE,
  quiet,
  run,
} from './state'
import { NOT_CARRIED, STATUS_FILE, keepsBefore, memoryIn, parseStatus, rowsNamed, rowsSince } from './status'
import type { Status } from './status'
import { CLASSIC_HINT, NARROW_HINT, TAIL_HINT, TAIL_SPARE, narrowHint, quietTail } from './tail'
import { P, SURFACE, applyTheme, normTheme } from './theme'
import { cells } from './width'
import {
  bodyOf,
  firedIn,
  isAbsolutePath,
  isPaused,
  memoriesCount,
  memoryMeta,
  normAvatar,
  normView,
  resumeWords,
  statusFor,
  storedWords,
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
const viewA = atom({ plugin: 'counterparts', key: 'view' } as const, 'sidebar')
const brainA = atom({ plugin: 'counterparts', key: 'brain' } as const, 'fox')
const themeA = atom({ plugin: 'counterparts', key: 'theme' } as const, 'tron')
const placedA = atom({ plugin: 'counterparts', key: 'placed' } as const, false)
/** The person ran `/counterparts …` in this session: written here, read by `speak-first.tsx` (which never sees it). */
const typedInA = atom({ plugin: 'counterparts', key: 'typedIn' } as const, null)

// ── the engine, through `$` ────────────────────────────────────────────────

/**
 * The status file, read as it stands (`status.ts`): found beside the
 * registry (`scopesFile`, the hooks' own configuration's folder), read again
 * only when its size or time changed, and kept for this module life. Null:
 * not there (no session has written it yet), unreadable, or not a version
 * this sidebar reads. Read only, no permission asked, and no network.
 */
async function readStatus($: EngineInterface): Promise<Status | null> {
  const scopes = await scopesFile($, false)
  if (scopes === null) return null
  const file = `${parentOf(scopes)}/${STATUS_FILE}`
  if (file !== run.statusFile) {
    run.statusFile = file
    run.statusStamp = ''
    run.status = null
  }
  try {
    if (!(await $.fs.exists(file))) {
      run.statusStamp = ''
      run.status = null
      return null
    }
    const st = await $.fs.stat(file)
    const stamp = `${String(st.size)}:${String(st.mtimeMs)}`
    if (stamp === run.statusStamp && run.status !== null) return run.status
    const text = await $.fs.read(file)
    const parsed = typeof text === 'string' ? parseStatus(text) : null
    // A file caught half-written (never by its writers, who rename a whole one in) or of another version:
    // the last good one stands until the next read.
    if (parsed === null) return run.status
    run.statusStamp = stamp
    // Two writers racing: an older file of the same store over a newer one is not shown (the log only grows),
    // unless it is newer by more than a race makes it — a store put back (`keepsBefore`).
    const before = run.status
    if (keepsBefore(before, parsed)) return before
    run.status = parsed
    return parsed
  } catch {
    return run.status
  }
}

/**
 * WHICH STORE (core #459): the status file must be the store's this session's
 * wake named. Both known and different: everything shown from it is dropped
 * (the pulse, today's counts, the last dream) and nothing more is shown until
 * it matches again; the Mechanisms section says so. Either unknown (no marker
 * yet, an older core, a store with no id yet): carry on.
 */
async function storeMatches($: EngineInterface, s: Status): Promise<boolean> {
  const other = otherStore(run.wakeStore, s.storeId)
  if (other !== run.foreign) {
    run.foreign = other
    if (other) {
      await update($, dashA, () => 'other')
      await update($, pulseA, () => null)
      await update($, todayA, () => null)
      await update($, dreamA, () => null)
    }
    // Either way the next look takes all of it again, from the right store.
    run.lastSeq = -1
  }
  return !other
}

async function refreshStatus($: EngineInterface): Promise<void> {
  $.ui.status(statusFor(await read($, scopeA)))
}

/** The mechanisms new rows prove: the header's dot lights in the newest one's colour for a moment (`firing`). */
async function fire($: EngineInterface, ids: readonly MechId[]): Promise<void> {
  if (ids.length === 0) return
  const now = await $.clock.now()
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

/** Day, count, and when the file was written. */
async function showPulse($: EngineInterface, s: Status): Promise<void> {
  const before = await read($, pulseA)
  const p = s.pulse
  if (before === null || before.day !== p.day || before.memories !== p.memories || before.lastSeq !== p.lastSeq || before.at !== s.writtenAt) {
    await update($, pulseA, () => ({ day: p.day, memories: p.memories, lastSeq: p.lastSeq, at: s.writtenAt }))
  }
}

/**
 * Times each mechanism fired today, as the file counted them (`firedToday`,
 * rows on the store's calendar day). A file written before this clock's
 * midnight counts a day that is over: none yet today, until the next file.
 */
async function showToday($: EngineInterface, s: Status): Promise<void> {
  const now = await $.clock.now()
  const date = dateOf(now)
  const counts: SidebarToday['counts'] = {}
  const over = dateOf(s.writtenAt) !== date
  for (const m of MECHS) {
    const v = s.today?.counts[m.id]
    counts[m.id] = typeof v === 'number' ? (over ? 0 : v) : m.notBuilt === true ? null : 0
  }
  const next: SidebarToday = { date: over || s.today === null ? date : s.today.date, counts, source: 'dashboard' as const }
  const before = await read($, todayA)
  if (before === null || JSON.stringify(before) !== JSON.stringify(next)) await update($, todayA, () => next)
}

/**
 * The newest dream, in its own voice: its first sentence and what follows. No
 * "what changed that night" counts (Mike, 2026-10-10): the room goes to the
 * dream itself.
 */
async function showDream($: EngineInterface, s: Status): Promise<void> {
  const d = s.dreams[0]
  if (d === undefined || typeof d.journal !== 'string' || d.journal.trim() === '') {
    if ((await read($, dreamA)) !== null) await update($, dreamA, () => null)
    return
  }
  const atOf = rowsNamed(s, 'dream.journaled').find(e => e.subject === d.id)?.at ?? null
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
 * One look at the status file. A new one: the pulse, today's counts and the
 * last dream as it says them; the rows newer than the last look's light the
 * header's dot and move the fox. Says whether anything new arrived.
 */
async function poll($: EngineInterface): Promise<boolean> {
  if (run.polling) return false
  run.polling = true
  try {
    const s = await readStatus($)
    if (s === null) {
      // No file yet: the first session's memory server or its first turn writes one.
      if ((await read($, dashA)) !== 'down') await update($, dashA, () => 'down')
      return false
    }
    if (!(await storeMatches($, s))) return false
    if ((await read($, dashA)) !== 'up') await update($, dashA, () => 'up')
    // Every look, the same file or not: past this clock's midnight its counts are yesterday's.
    await showToday($, s)
    if (run.lastSeq >= 0 && s.pulse.lastSeq === run.lastSeq && (await read($, pulseA))?.at === s.writtenAt) return false
    const first = run.lastSeq < 0
    const events = first ? [] : rowsSince(s, run.lastSeq)
    run.lastSeq = s.pulse.lastSeq
    await showPulse($, s)
    await showDream($, s)
    if (!run.seeded) {
      run.seeded = true
      await seedSession($, s).catch(() => undefined)
    }
    // Memories still named by the words Claude was shown: their titles, now the turn's row is in.
    const mind = await read($, mindA)
    if (mind !== null && mind.surfaced.some(r => r.id === null)) await titleSurfaced($, s, mind.turn)
    const rows = events.map(e => classify(e, run.session, run.startedAt)).filter((r): r is SidebarRow => r !== null)
    const lit = [...new Set(rows.filter(r => r.who !== 'other').sort((a, b) => b.at - a.at).flatMap(mechsOf))]
    await fire($, lit)
    // The fox dreams while a dream runs (one begun, none ended since), in any session or at night.
    const dreams = events.filter(e => e.name === 'dream.begun' || e.name === 'dream.journaled' || e.name === 'dream.changed' || e.name === 'dream.undone')
    const lastDream = dreams.sort((a, b) => a.seq - b.seq).at(-1)
    if (lastDream !== undefined) await foxEvent($, lastDream.name === 'dream.begun' ? 'dream' : 'dreamEnd')
    return first || events.length > 0
  } catch {
    return false
  } finally {
    run.polling = false
  }
}

/** The pane is placed and the one shown: the only time the status file is read. */
async function paneShown($: EngineInterface): Promise<boolean> {
  try {
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    return pane !== undefined && pane.isShown && pane.isPlaced
  } catch {
    return false
  }
}

/** Reads the status file while the pane shows, faster while things happen; stops when it doesn't (a drawing starts it again). */
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
 * turn's decision row (its `surfaced` ids) once the status file carries it,
 * at the next look. Until then the gist stands: it is the text Claude was shown.
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
  if (block.surfaced.length > 0 && run.status !== null && !run.foreign) await titleSurfaced($, run.status, block.turn)
}

/** The surfaced memories' ids and titles, from the turn's decision row in the status file, when it is there yet. */
async function titleSurfaced($: EngineInterface, s: Status, turn: number): Promise<void> {
  if (run.session === '') run.session = await $.session.id()
  const row = decisionFor(rowsNamed(s, 'recall.decision', 40), run.session, turn)
  if (row === undefined) return
  const ids = surfacedIds(row)
  const mind = await read($, mindA)
  if (mind === null || mind.turn !== turn) return
  const surfaced = mind.surfaced.map((r, i) => ({ id: ids[i] ?? r.id, title: memoryTitle(s, ids[i]) ?? r.title }))
  await update($, mindA, m => (m === null || m.turn !== turn ? m : { ...m, surfaced }))
  const first = surfaced[0]
  const latest = await read($, latestA)
  if (first !== undefined && latest !== null && latest.text.startsWith('remembered: ') && latest.at >= mind.at) {
    await update($, latestA, l => (l === null ? l : { ...l, text: words('remembered', first.title) }))
  }
}

/** A memory's title, from the status file, or null. */
function memoryTitle(s: Status | null, id: string | null | undefined): string | null {
  if (id === null || id === undefined) return null
  const m = memoryIn(s, id)
  return m !== null && m.title !== '' ? m.title : null
}

/**
 * On the first look, when this module has seen nothing of the session yet (a
 * resumed session, a pane opened after a reload that lost nothing but the
 * module): Memories, Subconscious and Saved from the status file's rows for
 * the session. The session is this one; a preview or a check may name another
 * with `COUNTERPARTS_SIDEBAR_SESSION` (the term-loop shots do, since their
 * session sends no message).
 */
async function seedSession($: EngineInterface, s: Status): Promise<void> {
  const preview = ((await $.env.get('COUNTERPARTS_SIDEBAR_SESSION')) ?? '').trim()
  // The pane can draw (and this run, once a module life) before session.start has named the session.
  const session = preview !== '' ? preview : run.session !== '' ? run.session : await $.session.id().catch(() => '')
  if (session === '') return
  const [mind0, saved0] = await Promise.all([read($, mindA), read($, savedA)])
  const ofSession = (e: DashEvent): boolean => e.detail?.some(d => (d.key === 'session' || d.key === 'actorId') && d.value === session) === true
  if (mind0 === null) {
    const decision = rowsNamed(s, 'recall.decision').filter(ofSession).find(e => classify(e)?.mechs.includes('retrieval') === true)
    if (decision !== undefined) {
      const surfaced = surfacedIds(decision)
      let footnotes: string[] = []
      try {
        const list: unknown = JSON.parse(decision.detail?.find(d => d.key === 'footnotes')?.value ?? '[]')
        if (Array.isArray(list)) footnotes = list.map(x => (x as { id?: unknown })?.id).filter((x): x is string => typeof x === 'string')
      } catch {
        footnotes = []
      }
      const ref = (id: string) => ({ id, title: memoryTitle(s, id) ?? id })
      const turn = Number(decision.detail?.find(d => d.key === 'turn')?.value ?? 0)
      const mind: SidebarMind = {
        turn: Number.isFinite(turn) ? turn : 0,
        at: decision.at,
        surfaced: surfaced.map(ref),
        footnotes: footnotes.map(ref),
      }
      if (mind.surfaced.length + mind.footnotes.length > 0) await update($, mindA, m => m ?? mind)
    }
  }
  if (saved0.length === 0) {
    const settles = rowsNamed(s, 'contradiction.settled')
    const mine = rowsNamed(s, 'gate.deposit').filter(e => ofSession(e) && Number(e.detail?.find(d => d.key === 'accepted')?.value ?? 0) > 0)
    const items = mine.slice(0, 12).map((e): SidebarSaved | null => {
      const row = classify(e)
      const id = row?.memory?.id ?? null
      if (id === null) return null
      const settle = settles.find(x => ofSession(x) && titled(x.detail?.find(d => d.key === 'holds')?.value).id === id && x.detail?.some(d => d.key === 'how' && d.value !== 'open') === true)
      const over = settle === undefined ? null : titled(settle.detail?.find(d => d.key === 'over')?.value)
      const title = memoryTitle(s, id) ?? row?.memory?.title ?? id
      const replaces = over === null || over.id === null ? null : (memoryTitle(s, over.id) ?? over.title)
      return { key: `seq:${String(e.seq)}`, id, title, at: e.at, replaces, replacesId: over?.id ?? null, kind: over === null ? 'new' : 'update' }
    })
    const list = items.filter((x): x is SidebarSaved => x !== null).sort((a, b) => b.at - a.at)
    if (list.length > 0) await update($, savedA, sv => (sv.length === 0 ? list : sv))
  }
  // The newest of what was found, as the tail says it, unless something newer is known.
  const [mind, saved] = await Promise.all([read($, mindA), read($, savedA)])
  const said = mind?.surfaced[0] !== undefined ? words('remembered', mind.surfaced[0].title) : mind?.footnotes[0] !== undefined ? words('subconscious', mind.footnotes[0].title) : null
  const first = saved[0]
  if (first !== undefined && (mind === null || first.at > mind.at)) await setLatestAt($, storedWords(first.title), 'salience', first.at, bodyOf(first))
  else if (mind !== null && said !== null) await setLatestAt($, said, 'retrieval', mind.at)
}

/** What a memory tool saved: "Saved this session", newest first; an update's old title from the status file when it has it. */
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
    const title = memoryTitle(run.foreign ? null : run.status, it.replacesId)
    if (title === null) continue
    await update($, savedA, list => list.map(x => (x.key === it.key ? { ...x, replaces: title } : x)))
  }
}

/** A `recall` that opened memories by address: the footnotes it names get `↗ opened`. */
async function onOpened($: EngineInterface, ids: readonly string[], handle: string | null): Promise<void> {
  const mind = await read($, mindA)
  if (mind === null) return
  const hit = (f: { id: string | null; title: string }): boolean => (f.id !== null && ids.includes(f.id)) || (handle !== null && f.title.trim().toLowerCase() === handle.toLowerCase())
  if (!mind.footnotes.some(hit) && !mind.surfaced.some(hit)) return
  await update($, mindA, m =>
    m === null ? m : { ...m, footnotes: m.footnotes.map(f => (hit(f) ? { ...f, opened: true } : f)), surfaced: m.surfaced.map(r => (hit(r) ? { ...r, opened: true } : r)) },
  )
  const named = mind.footnotes.find(hit) ?? mind.surfaced.find(hit)
  if (named !== undefined) await setLatest($, words('opened', named.title), 'retrieval')
}

// ── a click in the body ────────────────────────────────────────────────────

/**
 * Opens a memory in place, every time, whatever its length: its title, text
 * and kind from the status file (which carries the memories its rows name,
 * each text's start). A click never opens the dashboard by itself (Mike,
 * 2026-10-10): the layout shows up to 20 lines and ends a longer text, or one
 * the file cut, with `more`, the one link to the memory's card there. One the
 * file does not carry shows its title and that link. Clicked again, it closes.
 */
async function openMemory($: EngineInterface, key: string, id: string | null, fallback: string): Promise<void> {
  const cur = await read($, openA)
  if (cur !== null && cur.key === key) {
    await update($, openA, () => null)
    return
  }
  const at = await $.clock.now()
  if (id === null) {
    // Named only by the words Claude was shown (the turn's row not read yet): those words, in place.
    await update($, openA, () => ({ key, id: null, status: 'ready' as const, title: fallback, text: '', meta: null, at }))
    return
  }
  const s = run.foreign ? null : await readStatus($)
  const m = memoryIn(s, id)
  if (m === null) {
    const gone = s !== null && id in s.memories
    await update($, openA, () => ({ key, id, status: 'ready' as const, title: fallback, text: gone ? 'no longer in memory' : NOT_CARRIED, meta: null, at, cut: !gone }))
    return
  }
  await update($, openA, () => ({ key, id, status: 'ready' as const, title: m.title || fallback, text: m.text.trim(), meta: memoryMeta(m), at, cut: m.cut }))
}

/**
 * A mechanism in "Mechanisms today": what its recent firings were about, from
 * its panel rows in the status file, grouped by what and when: the memories
 * they name, with their titles, and for a dream's rows the dream's own changes
 * (which name the memories its row only counts). A firing that names nothing
 * is left out (`feed.ts#mechFirings`).
 */
async function openMech($: EngineInterface, id: MechId): Promise<void> {
  const cur = await read($, mechA)
  await update($, openA, o => (o !== null && o.key.startsWith('ev:') ? null : o))
  if (cur !== null && cur.id === id) {
    await update($, mechA, () => null)
    return
  }
  const at = await $.clock.now()
  const s = run.foreign ? null : await readStatus($)
  if (s === null) {
    await update($, mechA, () => ({ id, status: 'error' as const, events: [], at }))
    return
  }
  const panel = s.panels[id] ?? []
  const dreams = panel.some(e => e.name.startsWith('dream.')) ? s.dreams : []
  let firings = mechFirings(panel, id, dreams, 8)
  // The panel shows four lines, its repeats merged into one (Salience's deposits all narrate alike, so one
  // memory). A mechanism that fired today and names fewer than three there reads the file's other rows too.
  const want = Math.min(3, (await read($, todayA))?.counts[id] ?? 0)
  if (firings.length < want) firings = deeperFirings(s, id, panel, dreams)
  const titles: Record<string, string> = {}
  for (const x of new Set(firings.flatMap(firingIds))) {
    const t = memoryTitle(s, x)
    if (t !== null) titles[x] = t
  }
  const events = firings.flatMap(f => {
    const title = firingTitle(f, titles)
    return title === null ? [] : [{ key: f.key, seq: f.seq, at: f.at, word: f.word, title, memoryId: f.memoryId, text: f.text }]
  })
  await update($, mechA, () => ({ id, status: 'ready' as const, events, at }))
}

/** A mechanism's firings from its panel's rows and the file's rows of its events: only when the panel named too few. */
function deeperFirings(s: Status, id: MechId, panel: readonly DashEvent[], dreams: readonly DashDream[]): Firing[] {
  const names = new Set(RULES.filter(r => r.mech === id && !NAMES_NOTHING.has(r.name)).map(r => r.name))
  const seen = new Set<number>()
  const rows = [...panel, ...s.events.filter(e => names.has(e.name))].filter(e => (seen.has(e.seq) ? false : (seen.add(e.seq), true)))
  return mechFirings(rows, id, dreams, 8)
}

/** A click on a row of the body, by the key the layout gave it. */
async function clickBody($: EngineInterface, key: string): Promise<void> {
  // The full build's switches (`actions.tsx` draws them; never drawn in the directory's build, never acted on there).
  if (key.startsWith('set:')) {
    if (run.full !== null) await setSwitch($, key)
    return
  }
  // A command for the prompt box: `actions.tsx`'s own hook answers it, outside this one.
  if (key.startsWith('fill:')) return
  // (The `more` that ends a cut text is plain words, with no link: a click on it is its row's.)
  if (key.startsWith('head:')) {
    const section = key.slice(5)
    await update($, focusA, f => (f === section ? null : section))
    return
  }
  if (key === 'dream' || key === 'glance') {
    const at = await $.clock.now()
    const cur = await read($, openA)
    await update($, openA, () => (cur?.key === key ? null : { key, id: null, status: 'ready' as const, title: null, text: '', meta: null, at }))
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
 * on each status poll while the pane is drawn, once a minute otherwise, and
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
    const next: SidebarScope = found ?? (before.mode === 'unknown' ? { ...before, unread: 'unreadable' } : before)
    if (next.mode === before.mode && next.own === before.own && next.setBy === before.setBy && next.dir === before.dir && next.unread === before.unread && before.error === null) return
    await update($, scopeA, () => next)
    await refreshStatus($)
  } finally {
    run.scopeReading = false
  }
}

// ── views and the avatar ─────────────────────────────────────────────

/**
 * Opens (or re-opens) the pane and asks for a fresh drawing of it. Measured
 * live (v0.1): a pane closed by hand and opened again is drawn from the
 * terminal's settled evaluation, so this module's render hook never runs and
 * the fox, stopped at the close, would stay frozen.
 */
async function openPane($: EngineInterface): Promise<{ isPlaced: boolean }> {
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
  stopStage()
  await update($, placedA, () => false)
  await $.ui.close({ id: PANE })
  $.ui.invalidate('ui.render')
}

/** The view, for this session and (in `$.store`) the next. */
async function setView($: EngineInterface, view: SidebarView): Promise<void> {
  if ((await read($, viewA)) !== view) await update($, viewA, () => view)
  await $.store.set('view', view)
  if (view !== 'sidebar') stopStage()
}

/** The avatar, for every session (`$.store` `brain`, its old name): the fox or none. */
async function setAvatar($: EngineInterface, mode: SidebarAvatar): Promise<void> {
  await $.store.set('brain', mode)
  if ((await read($, brainA)) !== mode) await update($, brainA, () => mode)
  if (mode !== 'fox') stopStage()
  $.ui.invalidate('ui.render')
}

/**
 * A click on one of the full build's footer switches (2026-10-16): store-only, as `/counterparts quiet`,
 * `/counterparts` and `/counterparts avatar animal|off` do it. `set:view:quiet` closes the pane to quiet.
 */
async function setSwitch($: EngineInterface, key: string): Promise<void> {
  if (key === 'set:view:quiet') await closeQuiet($)
  else if (key === 'set:view:sidebar') await openPane($)
  else if (key === 'set:avatar:off') await setAvatar($, 'off')
  else if (key === 'set:avatar:fox') await setAvatar($, 'fox')
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

/** A refused blit is a Raster gone or not mounted yet: ask for a fresh drawing, a few times at most until one is taken. */
function redrawAfterRefusal($: EngineInterface): void {
  if (run.redraws >= 3) return
  run.redraws += 1
  $.ui.invalidate('ui.render')
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
 * refused blit stops it; an Image refused twice in a row because it draws
 * its alt here leaves `auto` drawing sextants or half-blocks for the session. Any other
 * refusal (not mounted yet, another size, the terminal not yet asked) is not
 * counted: it says nothing about pictures.
 */
/** What the engine's blit refusal says when an Image draws its alt (Claude Code 2.1.300). */
const ALT_REFUSAL = 'draws its alt'

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
          if (tier === 'image' && r.deny.includes(ALT_REFUSAL)) {
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

/** A drawing of the pane: the status file is read from here on, until the pane stops showing. */
function wake($: EngineInterface): void {
  if (run.hint) {
    run.hint = false
    $.ui.invalidate('ui.render')
  }
  armPolling($, run.lastSeq >= 0 ? POLL_MS : 0)
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
 * The body's lines, with no link on any of them (2026-10-14): the `more` that
 * ends a cut text is words, and a click on it is its row's. The rest is on the
 * dashboard, which `/counterparts:dashboard` opens (the footer says so).
 */
function plainLines(lines: readonly Line[]): Line[] {
  return lines.map(l => {
    if (l.link === undefined) return l
    const { link: _dropped, ...rest } = l
    return rest
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
      argumentHint: '[quiet | avatar animal|off | avatar detail auto|images|fine|basic | theme tron|cozy | resume]',
    })
    // (A `claudeMemory` or `claudeMemorySwitch` left in the store by an older version is never read.)
    const [viewPref, brainPref, themePref, detailPref] = await Promise.all([
      $.store.get('view'),
      $.store.get('brain'),
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
    // Pictures: tried, and the engine says. Where they can't show, whether the font draws sextants, read once (fox.ts).
    // (Each name spelled out: the engine lists the variables a module reads.)
    const envVals = await Promise.all([
      $.env.get('TERM_PROGRAM').catch(() => undefined),
      $.env.get('TERM').catch(() => undefined),
      $.env.get('KITTY_WINDOW_ID').catch(() => undefined),
      $.env.get('WEZTERM_EXECUTABLE').catch(() => undefined),
    ])
    stage.env = Object.fromEntries(TIER_ENV.map((k, i) => [k, envVals[i]]).filter(([, v]) => typeof v === 'string'))
    await update($, themeA, () => normTheme(themePref))
    await update($, viewA, () => normView(viewPref))
    await update($, brainA, () => normAvatar(brainPref))
    // Nothing is opened or drawn here, and the status file is not read. The pane
    // opens unasked from the first drawing of the band above the prompt, which
    // says whether this surface docks a pane; the fox and the status reads start
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
    // `strip` (dropped 2026-10-10) is quiet now: an older term-loop's put-back can still type it.
    if (verb === 'quiet' || verb === 'hide' || verb === 'rail' || verb === 'strip') {
      await closeQuiet($)
      return { text: 'Counterparts quiet: the newest thing shows dim after the line under the prompt. /counterparts opens the sidebar.' }
    }
    if (verb === 'avatar') {
      if (arg === 'detail') {
        const d = e.args.trim().split(/\s+/)[2] ?? ''
        if (d !== 'auto' && d !== 'images' && d !== 'fine' && d !== 'basic') {
          return { text: `counterparts avatar detail: auto, images, fine or basic (now ${stage.detail}, ${stage.tier === 'image' ? 'drawn as a picture' : stage.tier === 'fine' ? 'drawn in sextants' : stage.tier === 'svg' ? 'drawn as a drawing' : 'drawn in half-blocks'}).` }
        }
        await setDetail($, d)
        return {
          text:
            d === 'auto'
              ? 'The fox is drawn the best way this terminal shows: a picture, else sextants, else half-blocks.'
              : d === 'images'
                ? 'The fox is drawn as a picture (kitty, Ghostty); a terminal that cannot shows its name instead.'
                : d === 'fine'
                  ? 'The fox is drawn in sextants (six pixels a cell), for a font that has them.'
                  : 'The fox is drawn in half-blocks, which every terminal shows.',
        }
      }
      if (arg === 'animal' || arg === 'fox') {
        await setAvatar($, 'fox')
        return { text: 'The avatar is the fox: it sits still, now and then blinks or looks around, naps when nothing happens, and shows what memory is doing.' }
      }
      if (arg === 'off') {
        await setAvatar($, 'off')
        return { text: 'No avatar: the header is two lines.' }
      }
      return { text: 'counterparts avatar: animal or off; or detail auto, images, fine or basic.' }
    }
    if (verb === 'theme') {
      if (arg !== 'tron' && arg !== 'cozy') return { text: `counterparts theme: tron or cozy (now ${normTheme(await read($, themeA))}).` }
      await setTheme($, arg)
      return { text: arg === 'cozy' ? 'Theme cozy: walnut, parchment, leaf green and pumpkin, in every session.' : 'Theme tron: black, cyan and amber, in every session.' }
    }
    if (verb === 'resume') {
      // v1 changes no setting from here: it says where the folder stands (the registry file, read above) and how to resume.
      return { text: resumeWords(await read($, scopeA)) }
    }
    if (verb !== '' && verb !== 'open' && verb !== 'sidebar') {
      return { text: 'Usage: /counterparts [quiet | avatar animal|off | avatar detail auto|images|fine|basic | theme tron|cozy | resume]. With nothing after it, opens the sidebar.' }
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
    // Core's first-meeting tool ran: the fox says hello.
    if (ours.tool === 'meet') await foxEvent($, 'hello')
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

  // Memories and Subconscious: the recall block the classic hook injects; and the wake's store marker
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
      // The wake's store marker: which store this session's hooks opened (the status file must be the same store's).
      const storeId = parseStoreMarker(text)
      if (storeId !== null) run.wakeStore = storeId
      // The wake's onboarding marker: once the first meeting is done or skipped, the footer stops offering it.
      const glanceNow = parseGlance(text)
      if (glanceNow !== null) {
        run.glance = glanceNow
        $.ui.invalidate('ui.render')
      }
      const meet = parseOnboardingMarker(text)
      if (meet !== null && meet !== run.meet) {
        run.meet = meet
        $.ui.invalidate('ui.render')
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
      // the next session's wake says these again; until it does, nothing stale
      run.glance = null
      run.meet = 'unknown'
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // closed by hand (the pane's ✕): quiet, for this session and the next, until /counterparts opens it
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
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
    const { Box, Text } = els
    const now = await $.clock.now()
    const [pulse, dash, mind, saved, today, dreamNow, open, mech, focus, firing, scope, view, avatar, theme] = await Promise.all([
      read($, pulseA), read($, dashA), read($, mindA), read($, savedA), read($, todayA), read($, dreamA), read($, openA), read($, mechA),
      read($, focusA), read($, firingA), read($, scopeA), read($, viewA), read($, brainA), read($, themeA),
    ])
    // Every colour below (and in the body's lines) is read from the palette in use: this session's theme.
    applyTheme(normTheme(theme), e.surface)
    const paused = isPaused(scope.mode)
    const mode = normAvatar(avatar)
    // A reload keeps the state: a `firing` written by v0.1 (`{ id, at }`, no `ids`) lights nothing.
    const firingNow: readonly MechId[] =
      !paused && firing !== null && now - firing.at < FIRING_MS && Array.isArray(firing.ids) ? firing.ids : []
    const W = Math.max(e.props.bodyColumns, 1)
    prosePane.w = W
    const fill = Math.max(1, e.props.scroll?.bodyRows ?? 1)
    const inline = e.props.placement === 'inline'
    const w = Math.max(16, inline ? Math.min(W - 2, 64) : W - 2)
    run.bodyW = w
    // The fox's stage: on a pane tall and wide enough, in the tier this surface draws (fox.ts); else, or with the
    // avatar off, the header alone.
    const tier = pickTier(e.surface, stage.detail, stage.env, stage.noImages, stage.pngDir !== null)
    const drawsStage = tier === 'svg' ? 'Svg' in els : 'Raster' in els
    const hasStage = mode === 'fox' && drawsStage && !inline && fill >= STAGE_MIN_PANE_ROWS && W >= (SURFACE.prose ? STAGE_MIN_PROSE_COLS : STAGE_COLS)
    // While the pane holds the keyboard the fox holds still.
    const holding = e.props.isFocused === true
    if (!hasStage || holding || tier !== stage.tier) stopStage()
    stage.tier = tier
    if (normView(view) === 'sidebar') wake($)

    const roomy = fill >= ROOMY_ROWS
    const lit = firingNow[0] ?? (mech === null ? null : mech.id)
    const paneEls: PaneEls = { Box, Text }
    // The full build's pieces (`actions.tsx`, `run.full`); none in the directory's. The title links to the
    // dashboard only on the terminal: the desktop draws a link that is not https as plain text.
    const full = run.full
    const link = full !== null && e.surface === 'terminal' && 'Link' in els ? full.titleLink(els, run.status?.dashboard ?? null) : null
    const note = run.fillNote !== null && now - run.fillNote.at < FILL_NOTE_MS ? run.fillNote : null
    const rows: JSX.Element[] = []
    let used = 0
    if (roomy) {
      rows.push(<Text key="top"> </Text>)
      used += 1
    }

    // ── the header: the title row, with the fox's stage under it when it shows ──
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
      const [title] = header(paneEls, { w, paused, lit, day, count: countText, link })
      const png = tier === 'svg' ? await pngData($, pngName(step)) : ''
      stageTop = [...rows, ...(title === undefined ? [] : [title]), stageElement(els, tier, step, png)]
      rows.length = 0
      rows.push(SURFACE.prose ? <Text key="stage-rule"> </Text> : <Text key="stage-rule" color={P.faint}>{'─'.repeat(w)}</Text>)
      // The desktop's Svg is 180 px tall, about ten of its text rows (measured 2026-10-13), not the cells' fifteen;
      // fewer when a narrow pane scales it down (stageElement's factor).
      used += 1 + (tier === 'svg' ? (SURFACE.prose ? Math.ceil(10 * Math.min(1, (W * 7) / (STAGE_COLS * 6))) : 15) : stageRows(tier)) + 1
      if (!holding) startStage($)
    } else {
      rows.push(...header(paneEls, { w, paused, lit, day, count: countText, link }))
      used += 2
    }

    // ── a paused folder says so before anything else in the pane ──
    if (paused) {
      rows.push(...pausedBanner(paneEls, scope, w))
      used += 3
    }

    // ── the body: the five sections, folded to the room left ──
    // The desktop sets text in its own font, about a fifth narrower than the cells the pane is measured in:
    // the body wraps to that, and the footer fits its lines to it (2026-10-13, Mike: "hard to read").
    const bodyW = SURFACE.prose ? Math.floor(w * 1.2) : w
    const footShow = { intro: run.meet !== 'done' && run.meet !== 'skipped', fox: mode !== 'off' }
    // The full build: "Meet your counterpart" at the top of the body while the meeting waits (not while this
    // session's speak-first is the introduction), and a footer whose rows can be clicked. The rows that fill the
    // prompt box only on the terminal: on the desktop `$.prompt.fill` may refuse (`no_composer`, a surface that
    // draws its own composer), unmeasured, so there the footer says the commands as the directory's does.
    const fills = e.surface === 'terminal'
    const meet =
      full !== null && fills && full.meetShows(run.meet, scope.mode, firedIn(await $.store.get(MEET_FLAG)), run.session, run.meetFilledIn)
        ? full.meetLines(bodyW, note?.key === 'fill:meet' ? note.text : null)
        : []
    const foot =
      full === null
        ? null
        : full.footLines({
            fit: bodyW,
            w,
            prose: SURFACE.prose,
            paused,
            view: normView(view),
            avatar: mode,
            note: note?.key === 'fill:dash' ? note.text : null,
            // the intro line only where the meeting waits and the Meet row isn't drawn (no repeats)
            intro: meet.length === 0 && footShow.intro,
            fills,
          })
    const footRows = foot === null ? footerRows(bodyW, paused, footShow) : foot.length
    // The desktop's rows are its font's, a little taller than the cells it reports: two rows of headroom keep its
    // pane from scrolling by a line (2026-10-13).
    const bodyRows = Math.max(4, fill - used - footRows - meet.length - (SURFACE.prose ? 2 : 0))
    const laid = layoutBody({ w: bodyW, rows: bodyRows, now, mind, saved, today, dream: dreamNow, open, mech, focus, dash, prose: SURFACE.prose, cellsW: w, statusAt: pulse?.at ?? null, glance: run.glance })
    const lines = [...meet, ...laid.lines]
    // The body's surface module stays here, its module a literal on the tag's own line: the engine reads a hooks
    // module's surface modules off its own source.
    if ('Client' in els) {
      const bodyProps: BodyProps = { lines: plainLines(lines), prose: SURFACE.prose }
      rows.push(<els.Client key="body" module="./body.tsx" width={w} props={bodyProps} />)
    } else rows.push(plainBody(paneEls, lines))
    rows.push(<Box key="spacer" flexGrow={1} />)

    // ── the footer: how to do what the pane doesn't (the intro, the dashboard, a pause, hiding it) ──
    // The full build's is drawn by the body's surface module too, so its Dashboard line and its switches can be clicked.
    if (foot === null) rows.push(footer(paneEls, { w, fit: bodyW, prose: SURFACE.prose, paused, show: footShow }))
    else if ('Client' in els) {
      const footProps: BodyProps = { lines: foot, prose: SURFACE.prose }
      rows.push(<els.Client key="foot" module="./body.tsx" width={w} props={footProps} />)
    } else rows.push(plainBody(paneEls, foot))

    return frame(paneEls, W, fill, rows, stageTop)
  })
}
