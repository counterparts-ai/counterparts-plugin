/**
 * A Raster's `cells`: standard padded base64 of little-endian u32 triplets
 * `[codePoint, foreground, background]`, row-major (RasterProps).
 *
 * The environment has `Uint8Array.prototype.toBase64` at run time but the
 * declarations do not, and the test kit's environment is not promised to: a
 * small encoder of our own is cheaper than finding out (a 42 x 14 frame is
 * 7 KB). Every platform Claude Code ships on is little-endian, so the bytes of
 * a `Uint32Array` are already in the order the Raster reads.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(v >> 18) & 63]! + ALPHABET[(v >> 12) & 63]! + ALPHABET[(v >> 6) & 63]! + ALPHABET[v & 63]!;
  }
  if (i < n) {
    const a = bytes[i] ?? 0, b = i + 1 < n ? (bytes[i + 1] ?? 0) : 0;
    const v = (a << 16) | (b << 8);
    out += ALPHABET[(v >> 18) & 63]! + ALPHABET[(v >> 12) & 63]!;
    out += i + 1 < n ? ALPHABET[(v >> 6) & 63]! + '=' : '==';
  }
  return out;
}

export function encodeCells(cells: Uint32Array): string {
  return base64(new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength));
}

/** The reverse, for tests: base64 cells back to triplets. */
export function decodeCells(b64: string): Uint32Array {
  const clean = b64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (ALPHABET.indexOf(clean[i] ?? 'A') << 18) | (ALPHABET.indexOf(clean[i + 1] ?? 'A') << 12)
      | (Math.max(0, ALPHABET.indexOf(clean[i + 2] ?? 'A')) << 6) | Math.max(0, ALPHABET.indexOf(clean[i + 3] ?? 'A'));
    if (o < bytes.length) bytes[o++] = (v >> 16) & 255;
    if (o < bytes.length) bytes[o++] = (v >> 8) & 255;
    if (o < bytes.length) bytes[o++] = v & 255;
  }
  return new Uint32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
}

/** One printable width-1 BMP code point, the rule a Raster cell is held to. */
export function isRasterSafe(cp: number): boolean {
  if (cp < 0x20 || cp > 0xffff) return false;
  if (cp >= 0x7f && cp < 0xa0) return false;
  if (cp >= 0x0300 && cp <= 0x036f) return false; // combining marks
  if (cp >= 0x1100 && cp <= 0x115f) return false; // wide jamo
  if (cp >= 0x2e80 && cp <= 0xa4cf) return false; // CJK and wide symbols
  if (cp >= 0xac00 && cp <= 0xd7a3) return false; // Hangul syllables
  if (cp >= 0xd800 && cp <= 0xdfff) return false; // surrogates
  if (cp >= 0xf900 && cp <= 0xfaff) return false;
  if (cp >= 0xfe30 && cp <= 0xfe4f) return false;
  if (cp >= 0xff00 && cp <= 0xff60) return false;
  if (cp >= 0xffe0 && cp <= 0xffe6) return false;
  return true;
}
