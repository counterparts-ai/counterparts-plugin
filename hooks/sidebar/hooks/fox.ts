/**
 * The fox at the top of the sidebar (2026-10-12): which way this surface
 * draws it, what it does when, and each frame in that way. Pure: no `$`, no
 * engine. The timer that drives it lives in `register.tsx` beside the brain's.
 *
 * ONE DESIGN, FOUR WAYS TO DRAW IT. The art (`fox-art.ts`, the art agent's
 * data module, and `fox-png.ts`, generated from its PNGs by
 * `tools/fox-art/build.ts`) holds every frame three times over, and the
 * moments and schedule once:
 *
 * - `image`: an `Image` of the PNG frame, where the terminal draws pictures
 *   (kitty, Ghostty). Elsewhere an Image draws its alt text, dim, so this is
 *   chosen only where the environment says so, and a blit refused because the
 *   Image draws its alt drops to `fine` for the session (register.tsx).
 * - `fine`: sextants (U+1FB00, 2 x 3 pixels a cell, two colours a cell), in
 *   terminals whose font has them (iTerm2, WezTerm, VS Code, Ghostty, kitty).
 *   A `Raster` takes only BMP code points and sextants are not BMP, so this
 *   tier is rows of `Text` runs, and a frame change is a redraw of the pane.
 * - `basic`: half-blocks (`▀`, two pixels a cell) on a `Raster`, everywhere
 *   else (Apple Terminal, tmux, anything unknown). A frame change is a blit.
 * - `svg`: the desktop app (no Raster, no Image): an `Svg` of rects from the
 *   half-block pixels, with the PNG frame over them as a data URI (the rects
 *   are what shows if the surface drops the image).
 *
 * `/counterparts avatar detail auto|images|fine|basic` overrides the choice.
 */

import { DEFAULT_COLOR } from './brain'
import { encodeCells } from './cells'
import { FOX_FINAL } from './fox-art'
import { FOX_PNG, FOX_PNG_SIZE } from './fox-png'

const ART = FOX_FINAL

// ── which way to draw it ────────────────────────────────────────────────────

export type FoxTier = 'image' | 'fine' | 'basic' | 'svg'

/** The person's override (`$.store` `avatarDetail`): `auto` lets the environment decide. */
export type FoxDetail = 'auto' | 'images' | 'fine' | 'basic'

export function normDetail(v: unknown): FoxDetail {
  return v === 'images' || v === 'fine' || v === 'basic' ? v : 'auto'
}

/** The environment variables the choice reads, read once at session start. */
export const TIER_ENV = ['TERM_PROGRAM', 'TERM', 'KITTY_WINDOW_ID', 'WEZTERM_EXECUTABLE', 'TMUX', 'STY', 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES'] as const

export type TierEnv = Partial<Record<(typeof TIER_ENV)[number], string>>

const set = (v: string | undefined): boolean => v !== undefined && v !== ''

/**
 * Whether this terminal draws an `Image`'s pixels. The engine says no such
 * thing to a mod (RenderViewport is columns, rows and isFullscreen only), so
 * this is the engine's own rule as its docs give it, read conservatively:
 * kitty or Ghostty, never under tmux or screen; CLAUDE_CODE_FORCE_TERMINAL_IMAGES
 * says yes or no outright.
 */
export function imagesLikely(env: TierEnv): boolean {
  const force = (env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(force)) return true
  if (['0', 'false', 'no', 'off'].includes(force)) return false
  if (set(env.TMUX) || set(env.STY)) return false
  return env.TERM_PROGRAM === 'ghostty' || env.TERM === 'xterm-ghostty' || env.TERM === 'xterm-kitty' || set(env.KITTY_WINDOW_ID)
}

/** Whether this terminal's font has sextants: the ones known to draw them; under tmux or screen the outer one is unknown. */
export function sextantsLikely(env: TierEnv): boolean {
  if (set(env.TMUX) || set(env.STY)) return false
  const p = env.TERM_PROGRAM ?? ''
  if (p === 'iTerm.app' || p === 'WezTerm' || p === 'vscode' || p === 'ghostty') return true
  return env.TERM === 'xterm-kitty' || env.TERM === 'xterm-ghostty' || set(env.KITTY_WINDOW_ID) || set(env.WEZTERM_EXECUTABLE)
}

/**
 * The tier for a drawing: the desktop and the other remote surfaces draw the
 * Svg; a terminal, the override or else the environment's answer. `noImages`:
 * an Image here drew its alt (a refused blit said so), so `auto` stops trying.
 */
export function pickTier(surface: string, detail: FoxDetail, env: TierEnv, noImages = false): FoxTier {
  if (surface !== 'terminal') return 'svg'
  if (detail === 'images') return 'image'
  if (detail === 'fine') return 'fine'
  if (detail === 'basic') return 'basic'
  if (!noImages && imagesLikely(env)) return 'image'
  return sextantsLikely(env) ? 'fine' : 'basic'
}

// ── the stage's footprint ───────────────────────────────────────────────────

/** The stage is the pane's body width, edge to edge. */
export const STAGE_COLS = 34

/** Below this many pane rows the stage would crowd the body out: the brain's header instead. */
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

export function momentSteps(name: string): Step[] {
  return (MOMENTS[name] ?? []).map(([frame, ms, ...fx]) => ({ frame, ms, fx, moment: name }))
}

/** A frame and its effects, as one key: what is on screen. */
export function stepKey(s: Pick<Step, 'frame' | 'fx'>): string {
  return [s.frame, ...s.fx.map(f => f[0])].join('+')
}

/**
 * The schedule (round 6's design, the art's `schedule`): a still hold of
 * 8–20 s, then one small moment at random by weight (a blink, a glance, an
 * ear, the tail, rarely a yawn); after three minutes with nothing happening a
 * nap, which a prompt (or anything real) wakes; and the real-state moments:
 * `came` (something came to mind), `note` (a save), `hello` (the first
 * meeting) and `dream` (while a dream runs, until it ends). The hold is one
 * still frame: no breathing in between (the owner's round 2: calmer).
 */
export type Director = {
  mode: 'idle' | 'nap' | 'dream'
  queue: Step[]
  cur: Step
  /** When `cur` ends. */
  until: number
  idleSince: number
  napSince: number
  dreamSince: number
}

const STILL: Step = { frame: 'idle', ms: 0, fx: [], moment: 'rest' }

export function newDirector(now: number): Director {
  return { mode: 'idle', queue: [], cur: STILL, until: now, idleSince: now, napSince: 0, dreamSince: 0 }
}

/** A dream that never said it ended stops after this long. */
export const DREAM_MAX_MS = 20 * 60000

function pick(rand: () => number): string {
  const w = SCHEDULE.weights as Readonly<Record<string, number>>
  const total = Object.values(w).reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (const [k, v] of Object.entries(w)) {
    r -= v
    if (r < 0) return k
  }
  return 'blink'
}

function plan(d: Director, now: number, rand: () => number): void {
  if (d.mode === 'dream') {
    if (now - d.dreamSince > DREAM_MAX_MS) {
      d.mode = 'idle'
      d.idleSince = now
      d.queue.push(...momentSteps('napOut'))
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
  if (now - d.idleSince >= SCHEDULE.napAfterMs) {
    d.mode = 'nap'
    d.napSince = now
    d.queue.push(...momentSteps('napIn'))
    return
  }
  const [lo, hi] = SCHEDULE.holdMs
  const hold = Math.round(lo + rand() * (hi - lo))
  d.queue.push({ ...STILL, ms: hold }, ...momentSteps(pick(rand)))
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
  }
  // The next change: past any queued steps that show the same thing.
  let next = d.until
  const key = stepKey(d.cur)
  for (const s of d.queue) {
    if (stepKey(s) !== key) break
    next += s.ms
  }
  return { step: d.cur, next }
}

export type FoxEvent = 'came' | 'note' | 'hello' | 'dream' | 'dreamEnd' | 'prompt'

/** Something real happened: its moment plays at once (a nap ends first); a dream holds until it ends. */
export function trigger(d: Director, ev: FoxEvent, now: number): void {
  const asleep = d.mode === 'nap' || d.mode === 'dream'
  if (ev === 'dream') {
    if (d.mode === 'dream') return
    d.queue = asleep ? [] : momentSteps('napIn')
    d.mode = 'dream'
    d.dreamSince = now
    d.until = now
    return
  }
  if (ev === 'dreamEnd') {
    if (d.mode !== 'dream') return
    d.mode = 'idle'
    d.idleSince = now
    d.queue = momentSteps('napOut')
    d.until = now
    return
  }
  // While a dream runs, it is what the fox does.
  if (d.mode === 'dream') return
  d.idleSince = now
  if (ev === 'prompt') {
    if (d.mode !== 'nap') return
    d.mode = 'idle'
    d.queue = momentSteps('napOut')
    d.until = now
    return
  }
  d.queue = [...(d.mode === 'nap' ? momentSteps('napOut') : []), ...momentSteps(ev), ...(ev === 'note' ? momentSteps('note') : [])]
  d.mode = 'idle'
  d.until = now
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
  '#aa4422': '#d75f00', // fur, bright
  '#aa7766': '#d7875f', // fur: most of the fox
  '#bb4422': '#d75f00', // fur, bright
  '#cc9988': '#d7af87', // light fur
  '#ccbb99': '#d7af87', // shaded cream
  '#eeddbb': '#ffd7af', // cream
  '#eeddcc': '#ffd7af', // cream chest
  '#ffbb44': '#ffaf00', // gold: the eyes, the notepad
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
  const colour = (ch: string | undefined): string | null => (ch === undefined || ch === '.' ? null : (pal[parseInt(ch, 36)] ?? null))
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

// ── image: the PNG ──────────────────────────────────────────────────────────

/** The PNG for a step (base64): the frame with its effects, or the frame alone, or the idle frame. */
export function pngOf(step: Pick<Step, 'frame' | 'fx'>): string {
  return FOX_PNG[stepKey(step)] ?? FOX_PNG[step.frame] ?? FOX_PNG['idle'] ?? ''
}

// ── svg: the desktop ────────────────────────────────────────────────────────

/** CSS pixels a half-block pixel takes on the desktop. */
export const SVG_PX = 6

/** The desktop's drawing: rects from the half-block pixels, run-length per row, then the PNG over them. */
export function foxSvg(step: Pick<Step, 'frame' | 'fx'>): { source: string; width: number; height: number } {
  const cols = STAGE_COLS
  const H = stageRows('basic') * 2
  const px = halfPixels(step, cols)
  const rects: string[] = []
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < cols) {
      const c = px[y * cols + x] ?? null
      if (c === null) {
        x++
        continue
      }
      let n = 1
      while (x + n < cols && px[y * cols + x + n] === c) n++
      rects.push(`<rect x="${String(x)}" y="${String(y)}" width="${String(n)}" height="1" fill="${hex6(c)}"/>`)
      x += n
    }
  }
  const png = pngOf(step)
  // The PNG's box over the half-block fox's (the art lines both up: the same footprint, feet on the bottom line).
  const [bw, bh] = ART.half.box
  const image = png === '' ? '' : `<image x="${String(HALF_X0)}" y="${String(H - bh)}" width="${String(bw + 2)}" height="${String(bh)}" preserveAspectRatio="xMidYMax meet" style="image-rendering:pixelated" href="data:image/png;base64,${png}"/>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(cols)} ${String(H)}" shape-rendering="crispEdges">${rects.join('')}${image}</svg>`
  return { source, width: cols * SVG_PX, height: H * SVG_PX }
}

/** The PNGs' pixel size, for a test. */
export const PNG_SIZE = FOX_PNG_SIZE

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
  /** An Image here drew its alt: `auto` draws sextants for the rest of the session. */
  noImages: false,
  /** Image blits refused in a row. */
  imageDenies: 0,
}
