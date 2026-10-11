/**
 * Terminal cells, not string length: a CJK character or an emoji takes two
 * cells, a combining mark or a zero-width joiner none. The lists lay out rows
 * by line, so a title that took more cells than counted would wrap on screen
 * and shift every click row under it. Pure; shared by the hooks module's
 * wrapping and the list surface module.
 */

/** The cells one code point takes. */
export function charCells(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (
    (cp >= 0x0300 && cp <= 0x036f) || // combining marks
    (cp >= 0x200b && cp <= 0x200f) || // zero-width spaces and marks
    cp === 0x2060 ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0x1f3fb && cp <= 0x1f3ff) // skin-tone modifiers
  ) {
    return 0
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // kana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1faff) || // emoji and pictographs
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

/** The cells a string takes. */
export function cells(s: string): number {
  let n = 0
  for (const ch of s) n += charCells(ch.codePointAt(0) ?? 0)
  return n
}

/** The longest head of `s` that fits `w` cells. */
export function headCells(s: string, w: number): string {
  let n = 0
  let out = ''
  for (const ch of s) {
    const c = charCells(ch.codePointAt(0) ?? 0)
    if (n + c > w) break
    n += c
    out += ch
  }
  return out
}

/** `s` cut to `w` cells, an ellipsis standing for what was cut. */
export function ellipsizeCells(s: string, w: number): string {
  return cells(s) <= w ? s : `${headCells(s, Math.max(0, w - 1))}…`
}

/** `s` padded with spaces to `w` cells. */
export function padCells(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - cells(s)))
}
