/**
 * Every colour the pane draws with, by theme (shared core, no drawing).
 * `tron` is the round-3 mockups' palette, the sidebar's look since v0.2;
 * `cozy` is the warm one proposed for the stage on 2026-10-12
 * (`~/counterparts-notes/mockups/2026-10-12-stage/cozy-theme.md`): dark
 * walnut, parchment text, leaf green and pumpkin. Neutral text everywhere;
 * `accent` (tron's cyan) for what can be pressed or is lit, `accent2` (tron's
 * amber) for a warning.
 *
 * Not here: the mechanisms' stage colours (`mechanisms.ts`, the site's own,
 * on dots, bars and the brain's lights) and the brain's own body colours
 * (`brain.ts`). A theme sets the panel and the text around them; they stay.
 *
 * `P` is the palette in use, the one every drawing reads: `applyTheme` copies
 * a theme into it. The Pane hook applies the session's theme before each
 * drawing, so a reload (which starts this module over, at tron) draws right.
 */

import type { SidebarTheme } from '../types'

export type Palette = {
  /**
   * The pane's background. The brain's cells take the terminal's default
   * background (`bg: null` in `frameCells`), so this shows through them.
   * Measured: the engine draws a Raster's colours at 4 bits a channel, and the
   * panel colour given to the cells came out `#000011`, a navy box round the
   * brain.
   */
  panel: string
  /** The brightest text: an opened item's title, a switch that is on. */
  hi: string
  text: string
  mid: string
  /** Quiet text: times, counts, what is off. */
  dim: string
  /** Rules and empty bars. */
  faint: string
  /** Section headings. */
  head: string
  /** What can be pressed, or is lit (tron's cyan). */
  accent: string
  /** A warning: paused, off (tron's amber). */
  accent2: string
  /** The search box: a shade above the panel, so it reads as a field without a border. */
  searchBg: string
  /** The brainless header's dot at rest and its `↗`. */
  accentDim: string
}

/** The mockups' palette: neutral text, stage colours only on dots and bars. */
export const tron: Palette = {
  panel: '#05080c',
  hi: '#dde3e9',
  text: '#b3bcc5',
  mid: '#8e98a2',
  dim: '#66717c',
  faint: '#1d262e',
  head: '#c9d1d8',
  accent: '#00e5ff',
  accent2: '#ffb347',
  searchBg: '#121a22',
  accentDim: '#0b6f7c',
}

/** Warm wood and lamplight: dark walnut, parchment text, leaf green and pumpkin. */
export const cozy: Palette = {
  panel: '#1a120d',
  hi: '#f7ead2',
  text: '#dccab0',
  mid: '#b49c80',
  dim: '#8a7560',
  faint: '#34261c',
  head: '#efd9b6',
  accent: '#9cc65f',
  accent2: '#f0a04b',
  searchBg: '#2a1e16',
  accentDim: '#56713a',
}

export const THEMES: Readonly<Record<SidebarTheme, Palette>> = { tron, cozy }

/**
 * A surface that draws its own page (the desktop app, VS Code): Claude Code's
 * theme keys, which follow the app's light or dark mode, and no panel of our
 * own. Measured 2026-10-13 in the Desktop app's Code tab: on tron's black
 * panel the app's native buttons (the title, the footer's switches) drew dark
 * on dark, and the `─` rules, set in the app's proportional font, ran wider
 * than the cells they were measured in and wrapped every heading.
 */
export const desk: Palette = {
  panel: '',
  hi: 'text',
  text: 'text',
  mid: 'inactive',
  dim: 'inactive',
  faint: 'subtle',
  head: 'text',
  accent: 'suggestion',
  accent2: 'warning',
  searchBg: '',
  accentDim: 'inactive',
}

/** Whether the surface in use draws text in its own (proportional) font: no rules of `─`, no panel. */
export const SURFACE = { prose: false }

/** A stored theme: a name this version knows, else tron. */
export function normTheme(v: unknown): SidebarTheme {
  return v === 'cozy' ? 'cozy' : 'tron'
}

/** The palette in use (tron until a theme is applied). */
export const P: Palette = { ...tron }

/** Makes `name` the palette in use. */
export function applyTheme(name: SidebarTheme, surface: string = 'terminal'): void {
  SURFACE.prose = surface === 'desktop' || surface === 'vscode'
  Object.assign(P, SURFACE.prose ? desk : THEMES[name])
}

/** A Box's background, only when the palette has one (a prose surface keeps the app's). */
export function bg(c: string): { backgroundColor?: string } {
  return c === '' ? {} : { backgroundColor: c }
}
