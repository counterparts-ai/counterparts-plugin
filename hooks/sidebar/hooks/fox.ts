/**
 * The fox at the top of the sidebar (2026-10-12): which way this surface
 * draws it, what it does when, and each frame in that way. Pure: no `$`, no
 * engine. The timer that drives it lives in `register.tsx`.
 *
 * ONE DESIGN, FOUR WAYS TO DRAW IT. The art (`fox-art.ts`, the art agent's
 * data module, and the PNGs in `../art/fox/`, built from its export by
 * `tools/fox-art/build.ts`) holds every frame three times over, and the
 * moments and schedule once:
 *
 * - `image`: an `Image` of the PNG file, which the terminal reads itself
 *   (`{ file, format: 'png' }`), where the terminal draws pictures
 *   (kitty, Ghostty). Elsewhere an Image draws its alt text, dim, so `auto`
 *   tries it first and a blit refused because the Image draws its alt drops
 *   to `fine` or `basic` for the session (register.tsx).
 * - `fine`: sextants (U+1FB00, 2 x 3 pixels a cell, two colours a cell), where a
 *   picture can't show and the font has them (iTerm2, WezTerm, VS Code, Ghostty, kitty).
 *   A `Raster` takes only BMP code points and sextants are not BMP, so this
 *   tier is rows of `Text` runs, and a frame change is a redraw of the pane.
 * - `basic`: half-blocks (`▀`, two pixels a cell) on a `Raster`, everywhere
 *   else (Apple Terminal, tmux, anything unknown). A frame change is a blit.
 * - `svg`: the desktop app (no Raster, no Image): an `Svg` of rects from the
 *   half-block pixels, with the PNG frame over them as a data URI (the rects
 *   are what shows if the surface drops the image, or the file can't be read);
 *   the hooks module reads each PNG's bytes once (`$.fs.read`) and keeps them.
 *
 * `/counterparts avatar detail auto|images|fine|basic` overrides the choice.
 */

import { encodeCells } from './cells'
import { FOX_FINAL } from './fox-art'

const ART = FOX_FINAL

/** A Raster cell's colour that means the terminal's own default (RasterProps). */
const DEFAULT_COLOR = 0x01000000

// ── which way to draw it ────────────────────────────────────────────────────

/** `svg`: the desktop and the other remote surfaces, drawn as an Svg (`fox-svg.ts`). */
export type FoxTier = 'image' | 'fine' | 'basic' | 'svg'

/** The person's override (`$.store` `avatarDetail`): `auto` tries a picture and lets the engine say. */
export type FoxDetail = 'auto' | 'images' | 'fine' | 'basic'

export function normDetail(v: unknown): FoxDetail {
  return v === 'images' || v === 'fine' || v === 'basic' ? v : 'auto'
}

/**
 * The environment variables the fallback reads, once at session start: which
 * terminals' fonts draw sextants. Pictures need none (the engine says); these
 * four only choose sextants over half-blocks where a picture can't show
 * (Mike, 2026-10-15: the best fox each terminal can draw).
 */
export const TIER_ENV = ['TERM_PROGRAM', 'TERM', 'KITTY_WINDOW_ID', 'WEZTERM_EXECUTABLE'] as const

export type TierEnv = Partial<Record<(typeof TIER_ENV)[number], string>>

const present = (v: string | undefined): boolean => v !== undefined && v !== ''

/** Whether this terminal's font has sextants: the ones known to draw them. */
export function sextantsLikely(env: TierEnv): boolean {
  const p = env.TERM_PROGRAM ?? ''
  if (p === 'iTerm.app' || p === 'WezTerm' || p === 'vscode' || p === 'ghostty') return true
  return env.TERM === 'xterm-kitty' || env.TERM === 'xterm-ghostty' || present(env.KITTY_WINDOW_ID) || present(env.WEZTERM_EXECUTABLE)
}

/**
 * The tier for a drawing: the desktop and the other remote surfaces draw the
 * Svg (`fox-svg.ts`, a file of its own); a terminal, the override or else a
 * picture first. Whether pictures show is not guessed: the engine
 * draws an `Image`'s pixels where the terminal can and its alt elsewhere, and
 * says so by refusing the blit. `noImages`: an Image here drew its alt, so
 * `auto` draws the next best: sextants where the terminal's font is known to
 * have them (`sextantsLikely`), else half-blocks, which every terminal draws.
 * `hasPngs` false (no PNG folder found): never a picture, whatever was asked.
 */
export function pickTier(surface: string, detail: FoxDetail, env: TierEnv = {}, noImages = false, hasPngs = true): FoxTier {
  if (surface !== 'terminal') return 'svg'
  if (detail === 'images' && hasPngs) return 'image'
  if (detail === 'fine') return 'fine'
  if (detail === 'basic') return 'basic'
  if (detail === 'auto' && !noImages && hasPngs) return 'image'
  return sextantsLikely(env) ? 'fine' : 'basic'
}

// ── the stage's footprint ───────────────────────────────────────────────────

/** The stage is the pane's body width, edge to edge. */
export const STAGE_COLS = 34

/** Below this many pane rows the stage would crowd the body out: the plain header instead. */
export const STAGE_MIN_PANE_ROWS = 30

/** The Image's box in cells: the PNG's aspect at a cell twice as tall as wide, about the sextant fox's footprint. */
export const IMAGE_COLS = 30
export const IMAGE_ROWS = 16

/** Rows the stage takes in a tier. */
export function stageRows(tier: FoxTier): number {
  if (tier === 'basic') return Math.ceil(ART.half.box[1] / 2)
  if (tier === 'fine') return ART.sextant.rows
  if (tier === 'image') return IMAGE_ROWS
  return 0 // the Svg sizes itself; the desktop counts no rows
}

/** Where the fox's box starts on the 34-column stage: centred with room for the effects beside its head. */
export const HALF_X0 = 1
export const FINE_X0 = 2
export const IMAGE_X0 = 2

// ── what it does when ───────────────────────────────────────────────────────

export type FxRef = readonly [name: string, place: string]
export type Step = { frame: string; ms: number; fx: readonly FxRef[]; moment: string }

type Moment = readonly (readonly [string, number, ...FxRef[]])[]
const MOMENTS = ART.moments as unknown as Readonly<Record<string, Moment>>
const SCHEDULE = ART.schedule

/**
 * The working pose (2026-10-20, an experiment): while Claude works on a turn
 * he sits alert (`perk`'s face: eyes wide, an ear up) and keeps moving, from
 * existing frames only: short holds (WORK.holdMs) each ending in a wag of the
 * whole tail (most often), the tail tip, an ear or a glance. Never a yawn, a
 * drowsy blink, a lie-down or a nap. Its own moments live here, not in the
 * art's data module; each frame is one every tier draws.
 */
const WORK_MOMENTS: Readonly<Record<string, Moment>> = {
  workWag: [['tail1', 220], ['tail2', 300], ['tail1', 220], ['tail2', 300], ['tail1', 220]],
  workGlance: [['lookL', 900], ['perk', 300], ['lookR', 900]],
}

export const WORK = {
  /** A hold of the alert face before each moment: shorter than idle's 4–9 s. */
  holdMs: [1500, 3500],
  /** The moments he draws from while working: the tail most. */
  weights: { workWag: 4, tailSmall: 2, ear: 2, workGlance: 1.5 } as Readonly<Record<string, number>>,
  /** A prompt that never became a turn (no turn.start, no main-loop call) stops being work after this. */
  askMs: 30000,
  /** A turn whose end was never heard stops being work after this long with nothing happening and no call running. */
  quietMs: 10 * 60000,
} as const

export function momentSteps(name: string): Step[] {
  return (WORK_MOMENTS[name] ?? MOMENTS[name] ?? []).map(([frame, ms, ...fx]) => ({ frame, ms, fx, moment: name }))
}

/** A frame and its effects, as one key: what is on screen. */
export function stepKey(s: Pick<Step, 'frame' | 'fx'>): string {
  return [s.frame, ...s.fx.map(f => f[0])].join('+')
}

/**
 * The schedule (round 6's design, the art's `schedule`; round 8's polish,
 * Mike 2026-10-13): a still hold of 4–9 s, then one small moment at random by
 * weight (a blink, the tail tip's flick, an ear, a glance; rarely the whole
 * tail or a yawn). The first hold after the fox appears is short and ends in
 * the tail tip's flick. After 45 s with nothing happening (no prompt, no tool
 * call begun, ended or still running: 2026-10-20) he lies down (the
 * loaf: `lieIn`, the pose changing behind shut eyes), keeps small moments
 * lying (`lieWeights`), and at 2 min settles into a nap from there
 * (`lieNapIn`), which a prompt (or anything real) wakes. The real-state
 * moments: `came` (something came to mind), `note` (a save), `hello` (the
 * first meeting) and `dream` (while a dream runs, until it ends); each gets
 * him up first. A hold is one still frame: no breathing in between (the
 * owner's round 2: calmer).
 *
 * While Claude works on a turn (2026-10-20, an experiment) he rests in
 * `work` instead of sitting idle: the alert face, short holds, the tail going
 * (WORK). A moment still plays over it and returns to it; a dream still holds
 * the stage until it ends. The turn ends and he relaxes, behind a blink, and
 * the idle clock starts there.
 */
export type Director = {
  mode: 'idle' | 'lie' | 'nap' | 'dream' | 'work'
  queue: Step[]
  cur: Step
  /** When `cur` ends. */
  until: number
  /** When `cur` itself ends, before steps showing the same thing were joined to it (`until` may be later). */
  stepEnd: number
  /**
   * Claude's turn, apart from what is on screen (a dream or a moment may hold the stage meanwhile):
   * `asked` a prompt was sent, `open` a main-loop turn began (or a main-loop call ran), `none` it ended.
   * While it is not `none` he rests in `work`, not `idle`.
   */
  turn: 'none' | 'asked' | 'open'
  /** The turn's last sign of life: the prompt, its start, a model request (`step`), a call beginning or ending. */
  turnAt: number
  /** When a turn's end was last heard: from then on only a turn's start (or a prompt) opens one. */
  endAt: number
  idleSince: number
  napSince: number
  dreamSince: number
  /** The first hold is still to come: a short one, then the tail tip's flick. */
  fresh: boolean
  /** Tool calls running now (`busy` in, `busyEnd` out): while any runs, he never lies down. */
  busy: number
  /** When the count last went up from none: a count left up BUSY_MAX_MS from there is dropped (an end never heard). */
  busySince: number
  /** When the last save's notepad began: another save inside NOTE_SPAN_MS writes no second time. */
  noteAt: number
  /** When the last save was heard, written on the notepad or folded into one already running: its rows are older. */
  saveAt: number
}

const STILL: Step = { frame: 'idle', ms: 0, fx: [], moment: 'rest' }
const STILL_LIE: Step = { frame: 'lie0', ms: 0, fx: [], moment: 'lieRest' }
const STILL_WORK: Step = { frame: 'perk', ms: 0, fx: [], moment: 'work' }
/** What the work schedule plans: the hold and the moments it draws from. */
const WORK_PLANNED = new Set(['work', ...Object.keys(WORK.weights)])

/**
 * Moments of what really happened, and the get-ups before them: a change between working and resting
 * lets these play out. The schedule's own (a hold, a blink, the tail) are cut, behind a blink.
 */
const REAL = new Set(['came', 'cameLie', 'note', 'hello', 'napOut', 'lieOut', 'bridge'])

export function newDirector(now: number): Director {
  return { mode: 'idle', queue: [], cur: STILL, until: now, stepEnd: now, turn: 'none', turnAt: -Infinity, endAt: -Infinity, idleSince: now, napSince: 0, dreamSince: 0, fresh: true, busy: 0, busySince: 0, noteAt: -Infinity, saveAt: -Infinity }
}

/** A tool call that never said it ended stops holding him awake after this long. */
export const BUSY_MAX_MS = 30 * 60000

/** How long a save's notepad runs (it writes twice): a burst of saves inside it writes once. */
export const NOTE_SPAN_MS = 2 * momentSteps('note').reduce((a, s) => a + s.ms, 0)

/**
 * When the idle clock last ran from: the last activity, or now while a tool
 * call runs (a long command or an agent is work, not nobody being there).
 */
function idleFrom(d: Director, now: number): number {
  return d.busy > 0 && now - d.busySince < BUSY_MAX_MS ? Math.max(d.idleSince, now) : d.idleSince
}

/**
 * A count up for BUSY_MAX_MS since it last rose from none is dropped: one
 * call whose end was never heard would otherwise, with any call at all every
 * half hour, keep him up for good. Calls running then end into a count of none.
 */
function expireBusy(d: Director, now: number): void {
  if (d.busy > 0 && now - d.busySince >= BUSY_MAX_MS) d.busy = 0
}

/**
 * A turn whose end was never heard (a reload as it ended, a prompt that started none) ends by itself:
 * an ask after WORK.askMs, an open turn after WORK.quietMs with no model request or call meanwhile and
 * none running. The idle clock starts there, so he sits, then lies down, then naps, as after any end.
 * Says whether it ended one.
 */
function expireWork(d: Director, now: number): boolean {
  if (d.turn === 'none') return false
  if (d.busy > 0 && now - d.busySince < BUSY_MAX_MS) return false
  if (now - d.turnAt < (d.turn === 'asked' ? WORK.askMs : WORK.quietMs)) return false
  d.turn = 'none'
  d.idleSince = now
  return true
}

/** Where he rests when nothing plays: at work while a turn runs, else sitting idle. */
function restMode(d: Director): 'work' | 'idle' {
  return d.turn === 'none' ? 'idle' : 'work'
}

/** A get-up going to work ends on its blink: the sitting face it would end on is left out, so the alert face follows the blink. */
function upTo(steps: Step[], to: Director['mode']): Step[] {
  return to === 'work' && steps.at(-1)?.frame === 'idle' ? steps.slice(0, -1) : steps
}

/** A dream that never said it ended stops after this long. */
export const DREAM_MAX_MS = 20 * 60000

function pick(rand: () => number, weights: Readonly<Record<string, number>>, fallback: string): string {
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (const [k, v] of Object.entries(weights)) {
    r -= v
    if (r < 0) return k
  }
  return fallback
}

/** How a frame holds him: sitting, lying (the loaf) or asleep. A real event gets him up from where he is. */
export function poseOf(frame: string): 'sit' | 'lie' | 'asleep' {
  if (frame === 'nap0' || frame === 'nap1') return 'asleep'
  return frame.startsWith('lie') ? 'lie' : 'sit'
}

/**
 * A still hold in `range`, then `moment`. One that would run past `deadline`
 * (the mode changes there) is the still alone, up to it: the change always
 * starts from the still frame, never from a moment's last frame.
 */
function holdThen(d: Director, still: Step, moment: string, now: number, deadline: number, range: readonly number[], rand: () => number): void {
  const lo = range[0] ?? 0, hi = range[1] ?? lo
  const hold = Math.round(lo + rand() * (hi - lo))
  const steps = momentSteps(moment)
  const end = now + hold + steps.reduce((a, s) => a + s.ms, 0)
  if (end >= deadline) d.queue.push({ ...still, ms: Math.max(1, deadline - now) })
  else d.queue.push({ ...still, ms: hold }, ...steps)
}

function plan(d: Director, now: number, rand: () => number): void {
  if (d.mode === 'dream') {
    if (now - d.dreamSince > DREAM_MAX_MS) {
      d.mode = restMode(d)
      d.idleSince = now
      d.queue.push(...upTo(momentSteps('napOut'), d.mode))
      return
    }
    d.queue.push(...momentSteps('dream'))
    return
  }
  if (d.mode === 'nap') {
    if (now - d.napSince > SCHEDULE.napMaxMs) {
      d.mode = 'idle'
      d.idleSince = now
      d.queue.push(...momentSteps('napOut'))
      return
    }
    d.queue.push(...momentSteps('nap'))
    return
  }
  if (d.mode === 'work') {
    expireWork(d, now)
    if (d.turn === 'none') {
      d.mode = 'idle'
      d.queue.push(...momentSteps('bridge'))
      return
    }
    // From any face but the alert one or a blink (a moment ended on the sitting face, the notepad or hello, or
    // work began from a still hold), a blink first, never a cut. The work schedule's own moments go on as they are.
    if (!WORK_PLANNED.has(d.cur.moment) && d.cur.frame !== 'blink' && d.cur.frame !== 'perk') d.queue.push(...momentSteps('bridge'))
    holdThen(d, STILL_WORK, pick(rand, WORK.weights, 'workWag'), now, Infinity, WORK.holdMs, rand)
    return
  }
  const since = idleFrom(d, now)
  const napAt = since + SCHEDULE.napAfterMs
  if (d.mode === 'lie') {
    if (now >= napAt) {
      d.mode = 'nap'
      d.napSince = now
      d.queue.push(...momentSteps('lieNapIn'))
      return
    }
    holdThen(d, STILL_LIE, pick(rand, SCHEDULE.lieWeights, 'lieBlink'), now, napAt, SCHEDULE.holdMs, rand)
    return
  }
  // Sitting. Straight to a nap only when lying down was skipped (a pane hidden a long while, catching up).
  if (now >= napAt) {
    d.mode = 'nap'
    d.napSince = now
    d.queue.push(...momentSteps('napIn'))
    return
  }
  const lieAt = since + SCHEDULE.lieAfterMs
  if (now >= lieAt) {
    d.mode = 'lie'
    d.queue.push(...momentSteps('lieIn'))
    return
  }
  if (d.fresh) {
    d.fresh = false
    holdThen(d, STILL, SCHEDULE.first, now, lieAt, SCHEDULE.firstMs, rand)
    return
  }
  holdThen(d, STILL, pick(rand, SCHEDULE.weights, 'blink'), now, lieAt, SCHEDULE.holdMs, rand)
}

/**
 * The step on screen at `now`, and when what is on screen next changes (the
 * timer's one wake). Steps that end in the past are skipped, not replayed.
 */
export function advance(d: Director, now: number, rand: () => number = Math.random): { step: Step; next: number } {
  let guard = 0
  while (now >= d.until && guard++ < 200) {
    if (d.queue.length === 0) plan(d, now, rand)
    const s = d.queue.shift()
    if (s === undefined) break
    d.cur = s
    d.until = Math.max(d.until, now - 1) + s.ms
    d.stepEnd = d.until
  }
  // The next change: queued steps that show the same thing join `cur`. What follows is planned ahead
  // from when `cur` ends, so a moment that ends on the frame the next hold shows (`came`'s idle,
  // `lieIn`'s lie0) is one wake, not two.
  const key = stepKey(d.cur)
  let ahead = 0
  while (ahead++ < 20) {
    if (d.queue.length === 0) plan(d, d.until, rand)
    const s = d.queue[0]
    if (s === undefined || stepKey(s) !== key) break
    d.queue.shift()
    d.until += s.ms
  }
  return { step: d.cur, next: d.until }
}

/**
 * `busy` and `busyEnd`: a tool call began or ended, any tool, ours or not, a
 * subagent's too (2026-10-20). Activity, not a moment: the idle clock starts
 * over and a lie-down or nap on its way is called off, as a prompt does, but
 * nothing plays.
 *
 * `turn` and `turnEnd`: the main loop's turn began or ended, for any reason,
 * whatever its id. A `prompt` (not a slash command) puts him to work at once,
 * ahead of the turn's start (WORK.askMs bounds one that starts none).
 * `turnCall`: a main-loop tool call began. It opens a turn only while no
 * turn's end has been heard in this module's life (a reload mid-turn): once
 * one has, every new turn's start is heard, so a call arriving after an end
 * (an Esc during its dispatch) is that turn's straggler, not a new turn.
 * `step`: a main-loop model request began or ended; a sign of life only, so a
 * turn that writes for a long while without calling a tool stays at work.
 * `look`: the person ran a slash command: someone is there, so he gets up
 * and the idle clock starts over, as for a prompt, but it is not work.
 */
export type FoxEvent = 'came' | 'note' | 'hello' | 'dream' | 'dreamEnd' | 'prompt' | 'busy' | 'busyEnd' | 'turn' | 'turnEnd' | 'turnCall' | 'step' | 'look'

/**
 * What gets him up from the pose on screen, so an event's first frame never
 * jumps: from the nap a stretch (`napOut`), from lying a blink up to sitting
 * (`lieOut`), and mid-moment sitting (a glance, the tail) a blink back to the
 * sitting face (`bridge`).
 */
function getUp(d: Director): Step[] {
  const pose = poseOf(d.cur.frame)
  if (pose === 'asleep') return momentSteps('napOut')
  if (pose === 'lie') return momentSteps('lieOut')
  const f = d.cur.frame
  return f === 'idle' || f === 'blink' || f === 'drowsy' ? [] : momentSteps('bridge')
}

/**
 * Something real happened: its moment plays at once, once he is up (from a nap or lying down); a dream holds until it ends.
 * Says whether what is on screen next changed (false: the timer already waiting still stands).
 */
export function trigger(d: Director, ev: FoxEvent, now: number): boolean {
  const pose = poseOf(d.cur.frame)
  if (ev === 'busy' || ev === 'busyEnd') expireBusy(d, now)
  expireWork(d, now)
  if (ev === 'busy') {
    if (d.busy === 0) d.busySince = now
    d.busy += 1
  } else if (ev === 'busyEnd') d.busy = Math.max(0, d.busy - 1)
  else if (ev === 'note') d.saveAt = now
  // The turn: a prompt asks, a start (or a main-loop call) opens it, any main-loop end closes it, whatever its id.
  if (ev === 'turn') d.turn = 'open'
  else if (ev === 'turnCall' && d.turn !== 'open' && (d.turn === 'asked' || d.endAt === -Infinity)) d.turn = 'open'
  else if (ev === 'prompt' && d.turn === 'none') d.turn = 'asked'
  else if (ev === 'turnEnd') {
    d.turn = 'none'
    d.endAt = now
  }
  const life = ev === 'busy' || ev === 'busyEnd' || ev === 'turnCall' || ev === 'step'
  if (ev === 'turn' || ev === 'prompt' || (life && d.turn !== 'none')) d.turnAt = now
  // A model request is a sign of life only: nothing on screen changes for it.
  if (ev === 'step') return false
  if (ev === 'dream') {
    if (d.mode === 'dream') return false
    d.queue = pose === 'asleep' ? [] : momentSteps(pose === 'lie' ? 'lieNapIn' : 'napIn')
    d.mode = 'dream'
    d.dreamSince = now
    d.until = now
    return true
  }
  if (ev === 'dreamEnd') {
    if (d.mode !== 'dream') return false
    d.mode = restMode(d)
    d.idleSince = now
    d.queue = upTo(momentSteps('napOut'), d.mode)
    d.until = now
    return true
  }
  // While a dream runs, it is what the fox does.
  if (d.mode === 'dream') return false
  d.idleSince = now
  // A save while the last one's notepad still runs: it is the same burst, written once.
  if (ev === 'note' && now - d.noteAt < NOTE_SPAN_MS) return false
  if (ev === 'prompt' || ev === 'busy' || ev === 'busyEnd' || ev === 'turn' || ev === 'turnEnd' || ev === 'turnCall' || ev === 'look') {
    // Awake and where he should be (sitting, or at work), it stands: only the clock starts over.
    const to = restMode(d)
    if (d.mode === to) return false
    const from = d.mode
    d.mode = to
    // A lie-down or nap, or one on its way, is called off.
    if (from === 'lie' || from === 'nap') {
      d.queue = pose === 'sit' ? [] : upTo(getUp(d), to)
      d.until = now
      return true
    }
    // Between resting and working: a moment of what really happened (a save, a get-up) plays out first;
    // the schedule's own is cut, behind a blink where the face is not the sitting one.
    const real = d.queue.filter(s => REAL.has(s.moment))
    if (REAL.has(d.cur.moment)) {
      d.queue = real
      if (d.until <= d.stepEnd) return false
      d.until = Math.max(now, d.stepEnd)
      return true
    }
    d.queue = real.length > 0 ? real : getUp(d)
    d.until = now
    return true
  }
  if (ev === 'note') d.noteAt = now
  // Lying, something coming to mind perks him up where he lies, then he sits up (round 8's lab).
  const moment = ev === 'came' && pose === 'lie' ? [...momentSteps('cameLie'), ...momentSteps('lieOut')] : [...getUp(d), ...momentSteps(ev)]
  d.queue = [...moment, ...(ev === 'note' ? momentSteps('note') : [])]
  d.mode = restMode(d)
  d.until = now
  return true
}

// ── colours ─────────────────────────────────────────────────────────────────

function hexNum(c: string): number {
  const h = c.replace('#', '')
  const full = h.length === 3 ? [...h].map(x => x + x).join('') : h
  return parseInt(full, 16)
}

export function hex6(c: string): string {
  return `#${hexNum(c).toString(16).padStart(6, '0')}`
}

const FX_PAL = ART.fxPalette as Readonly<Record<string, string>>

/** An effect sprite's pixels laid over a pixel grid at (x, y); its letters are `fxPalette`'s. */
function overlay(px: (string | null)[], W: number, H: number, rows: readonly string[], x0: number, y0: number): void {
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      const c = FX_PAL[ch]
      const X = x0 + x, Y = y0 + y
      if (c === undefined || X < 0 || X >= W || Y < 0 || Y >= H) return
      px[Y * W + X] = c
    })
  })
}

// ── basic: half-blocks on a Raster ──────────────────────────────────────────

/** The half-block tier's pixels on the stage (STAGE_COLS x rows*2), null where transparent. */
export function halfPixels(step: Pick<Step, 'frame' | 'fx'>, cols = STAGE_COLS): (string | null)[] {
  const H = stageRows('basic') * 2
  const px: (string | null)[] = new Array<string | null>(cols * H).fill(null)
  const frames = ART.half.frames as Readonly<Record<string, readonly string[]>>
  const rows = frames[step.frame] ?? frames['idle'] ?? []
  const pal = ART.half.palette as readonly (string | null)[]
  const y0 = H - rows.length
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === '.') return
      const X = HALF_X0 + x, Y = y0 + y
      if (X < 0 || X >= cols || Y < 0) return
      px[Y * cols + X] = pal[parseInt(ch, 36)] ?? null
    })
  })
  const fxRows = ART.half.fx as unknown as Readonly<Record<string, readonly string[]>>
  const places = ART.half.fxPlace as Readonly<Record<string, readonly number[]>>
  for (const [name, place] of step.fx) {
    const p = places[place]
    const r = fxRows[name]
    if (p !== undefined && r !== undefined) overlay(px, cols, H, r, HALF_X0 + (p[0] ?? 0), y0 + (p[1] ?? 0))
  }
  return px
}

/**
 * The frame as a Raster's cells: `▀` with fg the top pixel and bg the bottom.
 * A transparent pixel is the terminal's default colour, never the panel's hex:
 * a Raster's colours come out at 4 bits a channel, and a panel colour given to
 * cells shows as a box (theme.ts, `panel`). Top transparent: `▄` instead.
 */
export function halfCells(step: Pick<Step, 'frame' | 'fx'>, cols = STAGE_COLS): string {
  const rows = stageRows('basic')
  const px = halfPixels(step, cols)
  const out = new Uint32Array(cols * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < cols; x++) {
      const top = px[r * 2 * cols + x] ?? null
      const bot = px[(r * 2 + 1) * cols + x] ?? null
      const o = (r * cols + x) * 3
      if (top === null && bot === null) {
        out[o] = 0x20
        out[o + 1] = DEFAULT_COLOR
        out[o + 2] = DEFAULT_COLOR
      } else if (top === null) {
        out[o] = 0x2584
        out[o + 1] = bot === null ? DEFAULT_COLOR : hexNum(bot)
        out[o + 2] = DEFAULT_COLOR
      } else {
        out[o] = 0x2580
        out[o + 1] = hexNum(top)
        out[o + 2] = bot === null ? DEFAULT_COLOR : hexNum(bot)
      }
    }
  }
  return encodeCells(out)
}

// ── fine: sextants as Text runs ─────────────────────────────────────────────

/** A sextant pattern (bit i: row i >> 1, column i & 1) as its glyph; 0, 21, 42 and 63 are the space and the block glyphs. */
export function sextantGlyph(v: number): string {
  if (v <= 0) return ' '
  if (v >= 63) return '█'
  if (v === 21) return '▌'
  if (v === 42) return '▐'
  const idx = v - 1 - (v > 21 ? 1 : 0) - (v > 42 ? 1 : 0)
  return String.fromCodePoint(0x1fb00 + idx)
}

/** The reverse: a glyph's pattern, or null for a glyph that is not one. */
export function sextantBits(ch: string): number | null {
  if (ch === ' ') return 0
  if (ch === '█') return 63
  if (ch === '▌') return 21
  if (ch === '▐') return 42
  const cp = ch.codePointAt(0) ?? 0
  if (cp < 0x1fb00 || cp > 0x1fb3b) return null
  let v = cp - 0x1fb00 + 1
  if (v >= 21) v += 1
  if (v >= 42) v += 1
  return v
}

/** One cell: its glyph and colours; null colours are the panel's (no colour given). */
export type FineCell = { ch: string; fg: string | null; bg: string | null }

function dist(a: string, b: string): number {
  const x = hexNum(a), y = hexNum(b)
  return Math.abs((x >> 16) - (y >> 16)) + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) + Math.abs((x & 255) - (y & 255))
}

/** Six pixels (null transparent) as one cell in at most two colours: the two most frequent; any third goes to the nearer. */
export function fineCell(six: readonly (string | null)[]): FineCell {
  const counts = new Map<string | null, number>()
  for (const p of six) counts.set(p, (counts.get(p) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
  const keep = ranked.slice(0, 2)
  const solid = keep.filter((c): c is string => c !== null)
  const near = (p: string | null): string | null => {
    if (keep.includes(p)) return p
    if (p === null || solid.length === 0) return solid[0] ?? null
    return solid.reduce((best, c) => (dist(p, c) < dist(p, best) ? c : best))
  }
  const px = six.map(near)
  const a = keep.find(c => c !== null) ?? null
  if (a === null) return { ch: ' ', fg: null, bg: null }
  const b = keep.find(c => c !== a) ?? null
  let v = 0
  px.forEach((p, i) => {
    if (p === a) v |= 1 << i
  })
  return { ch: sextantGlyph(v), fg: a, bg: b }
}

/**
 * A Text run's colour comes out in the 256-colour palette on the owner's iTerm
 * (fox trial, 2026-10-12): the art's rust `#a42` drew `#af5f5f`, a washed-out
 * pink, and its creams went white. That is chalk's rgb-to-256 rounding
 * (`round(c / 255 * 5)` a channel, which lifts every low channel a step). So
 * the sextant tier gives Text hand-picked xterm-256 colours (TEXT_256, the art
 * colour to the one it should land on), each spelt so that rounding lands on
 * it exactly, as does a nearest-colour mapping, and a truecolor terminal draws
 * nearly the same (`textHex`). The Raster (half-blocks) and the picture keep
 * the art's colours. A colour not in the table (black, the outline, white) is
 * passed as it is.
 */
export const TEXT_256: Readonly<Record<string, string>> = {
  '#332211': '#262626', // darkest brown (else an olive edge)
  '#443322': '#3a3a3a', // dark brown (else a grey)
  '#663322': '#5f0000', // shadow
  '#772222': '#5f0000', // shadow, red
  '#883322': '#af5f00', // fur, dark
  '#995544': '#af5f00', // fur, shaded
  '#aa4422': '#d75f00', // fur: most of the fox
  '#aa7766': '#d7875f', // fur, muted
  '#bb4422': '#d75f00', // fur, bright
  '#cc9988': '#d7af87', // light fur
  '#ccbb99': '#d7af87', // shaded cream
  '#eeddbb': '#ffd7af', // cream
  '#eeddcc': '#ffd7af', // cream chest
  '#ffbb44': '#ffaf00', // gold: the pencil
  '#ee8888': '#ffaf87', // pink: nose, tongue, inner ear
  '#775533': '#875f00', // grey-brown (else olive)
  '#99bbee': '#87afd7', // the z
  '#ffee77': '#ffd75f', // a spark
  '#ffffee': '#ffffd7', // the pencil's white
  '#cc99ff': '#af87ff', // the dream
}

/** The 256-colour cube's levels, and the value each is spelt with so chalk's rounding and the nearest both land on it. */
const LEVEL_SPELT: Readonly<Record<number, number>> = { 0: 0, 95: 76, 135: 127, 175: 175, 215: 215, 255: 255 }

/** An art colour as a Text run's colour: its TEXT_256 colour, spelt to survive a 256-colour terminal; else as it is. */
export function textHex(c: string | null): string | null {
  if (c === null) return null
  const target = TEXT_256[hex6(c)]
  if (target === undefined) return c
  const n = hexNum(target)
  const ch = [n >> 16, (n >> 8) & 255, n & 255]
  // A grey (all three equal) takes chalk's grey ramp, which lands on itself.
  if (ch[0] === ch[1] && ch[1] === ch[2]) return target
  return `#${ch.map(v => (LEVEL_SPELT[v] ?? v).toString(16).padStart(2, '0')).join('')}`
}

/** The sextant tier's cells on the stage: STAGE_COLS x the art's rows, effects laid over in sextant pixels. */
export function fineCells(step: Pick<Step, 'frame' | 'fx'>, cols = STAGE_COLS): FineCell[][] {
  const S = ART.sextant
  const rows = S.rows
  const W = cols * 2, H = rows * 3
  const px: (string | null)[] = new Array<string | null>(W * H).fill(null)
  const frames = S.frames as unknown as Readonly<Record<string, { glyphs: readonly string[]; fg: readonly string[]; bg: readonly string[] }>>
  const f = frames[step.frame] ?? frames['idle']
  const pal = S.palette as readonly string[]
  // The cells name the art's palette from 1 ('1' is the outline, `#000`; 'j', 19, the last). Read from 0
  // until 2026-10-13, every sextant colour was the next one along (the fur drew #a76, not #a42) and the
  // notepad's 'j' fell off the end and drew nothing.
  const colour = (ch: string | undefined): string | null => (ch === undefined || ch === '.' ? null : (pal[parseInt(ch, 36) - 1] ?? null))
  f?.glyphs.forEach((line, r) => {
    const glyphs = [...line]
    const fgs = [...(f.fg[r] ?? '')]
    const bgs = [...(f.bg[r] ?? '')]
    glyphs.forEach((ch, c) => {
      const bits = sextantBits(ch) ?? 0
      const fg = colour(fgs[c]), bg = colour(bgs[c])
      for (let i = 0; i < 6; i++) {
        const X = (FINE_X0 + c) * 2 + (i & 1), Y = r * 3 + (i >> 1)
        if (X < W) px[Y * W + X] = bits & (1 << i) ? fg : bg
      }
    })
  })
  const fxRows = S.fx as unknown as Readonly<Record<string, readonly string[]>>
  const places = S.fxPlace as Readonly<Record<string, readonly number[]>>
  for (const [name, place] of step.fx) {
    const p = places[place]
    const r = fxRows[name]
    if (p !== undefined && r !== undefined) overlay(px, W, H, r, FINE_X0 * 2 + (p[0] ?? 0), p[1] ?? 0)
  }
  const out: FineCell[][] = []
  for (let r = 0; r < rows; r++) {
    const line: FineCell[] = []
    for (let c = 0; c < cols; c++) {
      const six: (string | null)[] = []
      for (let i = 0; i < 6; i++) six.push(px[(r * 3 + (i >> 1)) * W + c * 2 + (i & 1)] ?? null)
      const cell = fineCell(six)
      line.push({ ch: cell.ch, fg: textHex(cell.fg), bg: textHex(cell.bg) })
    }
    out.push(line)
  }
  return out
}

/** A row of cells as runs of one colour pair: what a row of Text elements draws. */
export function runs(line: readonly FineCell[]): FineCell[] {
  const out: FineCell[] = []
  for (const cell of line) {
    const last = out[out.length - 1]
    // A blank cell (a space, no background) joins any run with no background; a run of blanks takes the next colour.
    const blank = cell.ch === ' ' && cell.bg === null
    const lastBlank = last !== undefined && last.fg === null && last.bg === null
    if (last !== undefined && last.bg === cell.bg && (last.fg === cell.fg || blank || lastBlank)) {
      last.ch += cell.ch
      if (lastBlank) last.fg = cell.fg
    } else out.push({ ...cell })
  }
  return out
}

// ── image: the PNG files ────────────────────────────────────────────────────

/**
 * The PNGs `tools/fox-art/build.ts` writes to `art/fox/<key>.png`: every frame, and every frame + effects pair a
 * moment draws (`frame+fx+fx`, as `stepKey` spells it).
 */
export const PNG_FRAMES: ReadonlySet<string> = new Set([
  ...Object.keys(ART.png.frames),
  ...Object.values(MOMENTS).flatMap(m => m.filter(s => s.length > 2).map(([frame, , ...fx]) => stepKey({ frame, fx }))),
])

/** Where the PNGs sit, from the plugin's folder: the repository's plugin, or this folder as a plugin of its own. */
export const PNG_DIRS = ['hooks/sidebar/art/fox', 'art/fox'] as const

/** The PNG's file name for a step: the frame with its effects, or the frame alone, or the idle frame. */
export function pngName(step: Pick<Step, 'frame' | 'fx'>): string {
  const key = stepKey(step)
  return `${PNG_FRAMES.has(key) ? key : PNG_FRAMES.has(step.frame) ? step.frame : 'idle'}.png`
}

/** The scale the build writes the PNGs at: art pixels x 3. */
export const PNG_SCALE = 3

/** The PNGs' pixel size, for a test. */
export const PNG_SIZE = [ART.png.box[0] * PNG_SCALE, ART.png.box[1] * PNG_SCALE] as const

// ── the module's own ────────────────────────────────────────────────────────

/**
 * Whether the stage is mounted and its timer running, what is on screen, the
 * timer's generation (a stale timer stops), the tier it was drawn in, and the
 * schedule. The timer is one `$.clock.after` per change of what is on screen.
 */
export const stage = {
  live: false,
  gen: 0,
  /** stepKey of what the mounted stage shows. */
  shown: '',
  tier: 'basic' as FoxTier,
  director: null as Director | null,
  env: {} as TierEnv,
  detail: 'auto' as FoxDetail,
  /** An Image here drew its alt: `auto` draws sextants or half-blocks for the rest of the session. */
  noImages: false,
  /** Image blits refused in a row. */
  imageDenies: 0,
  /** The folder holding the PNGs (absolute), found at session start; null: none found, no pictures. */
  pngDir: null as string | null,
  /** Each PNG's bytes (base64) once read, for the desktop's Svg; '' for one that could not be read. */
  pngData: new Map<string, string>(),
}
