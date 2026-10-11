/**
 * The brain: a hologram in braille line art, a side or three-quarter view that
 * sways slowly, the way the reference icon shows it
 * (tools/brain-lab/refs/PRIMARY-i2-side-view.png, kept local).
 *
 * The shape is a handful of ellipsoids proportioned from Gray's lateral view
 * (Gray728, public domain): per hemisphere a main dome, the frontal pole and
 * the occipital pole, and the temporal lobe below the lateral (Sylvian)
 * fissure; the two halves of the cerebellum tucked under the back; the
 * brainstem dropping below as an open stalk. Each frame casts one ray per
 * braille dot (closed form, no point cloud), so every edge is exact and one dot
 * wide. What it draws, brightest first:
 *
 * - the rim: the silhouette, and the two lips of the lateral fissure, a real
 *   channel carved round the temporal lobe's top and nose;
 * - the cerebellum's folia, horizontal stripes every other dot row, lilac;
 * - about ten named sulci, each the zero line of a function on the surface
 *   (glued to the brain as it turns), long and sinuous, at 60% of the rim;
 * - a faint fill: a maze of gyri and a stipple of fixed surface points,
 *   densest near the rim, so the middle reads as dark glass;
 * - the inner structures of the near hemisphere behind glass in their region
 *   colours: the thalamus amber at the centre, the hippocampus violet curving
 *   back and up under it (the amygdala in front shows when lit, or when big
 *   enough to read).
 *
 * No background colour: a cell has one background, so any glow steps. A region
 * that fires (or a mechanism the person picks) takes its stage colour, and the
 * rest steps back while it does.
 *
 * Lineage: the API, the regions and the pulse arcs are the mockup's engine
 * (`~/counterparts-notes/mockups/2026-10-09-mod/engine.js`, class `Brain`) as
 * the first port drew it; its point cloud is gone (it read as a blob).
 *
 * Pure: no `$`, no engine. `frame()` returns the cells as `Uint32Array`
 * triplets `[codePoint, fg, bg]`, exactly what `RasterProps.cells` packs.
 */

import type { RegionKey, Rgb } from './mechanisms';

export const DEFAULT_COLOR = 0x01000000;

type V3 = readonly [number, number, number];
type Region = { readonly key: RegionKey; readonly col: Rgb; readonly anchor: V3 };

/** The regions, their resting colours, and where a tag pins to (the left side faces the default view). */
export const REGIONS: readonly Region[] = [
  { key: 'prefrontal', col: [0.16, 0.8, 1.0], anchor: [-0.4, 0.16, 0.82] },
  { key: 'amygdala', col: [1.0, 0.42, 0.6], anchor: [-0.32, -0.4, 0.33] },
  { key: 'hippocampus', col: [0.7, 0.5, 1.0], anchor: [-0.35, -0.38, 0.02] },
  { key: 'thalamus', col: [1.0, 0.78, 0.3], anchor: [-0.11, 0.07, -0.06] },
  { key: 'brainstem', col: [0.4, 0.46, 0.94], anchor: [0, -0.62, -0.2] },
  { key: 'cortex', col: [0.25, 1.0, 0.72], anchor: [-0.55, 0.4, -0.35] },
  { key: 'cerebellum', col: [0.96, 0.7, 0.93], anchor: [-0.24, -0.56, -0.52] },
];
const RID: Readonly<Record<RegionKey, number>> = {
  prefrontal: 0, amygdala: 1, hippocampus: 2, thalamus: 3, brainstem: 4, cortex: 5, cerebellum: 6,
};

// ── the shape ────────────────────────────────────────────────────────────────
// Model units: the cerebrum runs z = -1 (occipital pole) to +1 (frontal pole);
// y is up; x is the person's right. The left hemisphere is x < 0.

/** Parts: each hemisphere's cerebrum and temporal lobe, the cerebellum's halves, the stem. */
const CER_L = 0, TMP_L = 2, TMP_R = 3, CBL_L = 4, CBL_R = 5, STEM = 6;
/** Not parts: the lateral fissure's channel and the gap over the cerebellum, drawn as empty. */
const CHAN = 7, GAP = 8;
/** Inner parts. */
const THAL = 0, HIP = 1, AMY = 2;
const INNER_REG = [RID.thalamus, RID.hippocampus, RID.amygdala];

type Ell = {
  readonly cx: number; readonly cy: number; readonly cz: number;
  readonly ix: number; readonly iy: number; readonly iz: number; // 1 / radii
  readonly ct: number; readonly st: number; // the tilt about x: positive raises the back end
  readonly rmax: number;
  readonly g: number;
};

function ell(c: V3, r: V3, tilt: number, g: number): Ell {
  return {
    cx: c[0], cy: c[1], cz: c[2], ix: 1 / r[0], iy: 1 / r[1], iz: 1 / r[2],
    ct: Math.cos(tilt), st: Math.sin(tilt), rmax: Math.max(r[0], r[1], r[2]), g,
  };
}

/** The temporal lobe: its frame carves the fissure and carries its sulci. */
const T_C: V3 = [0.5, -0.32, 0.03], T_R: V3 = [0.3, 0.24, 0.53], T_TILT = 0.3;
const T_CT = Math.cos(T_TILT), T_ST = Math.sin(T_TILT);

function buildOuter(): Ell[] {
  const out: Ell[] = [];
  for (const s of [-1, 1]) {
    const L = s < 0 ? 0 : 1;
    out.push(ell([0.3 * s, 0.08, -0.07], [0.52, 0.56, 0.92], 0, CER_L + L)); // the dome: one smooth arc over the top
    out.push(ell([0.3 * s, -0.02, 0.45], [0.44, 0.4, 0.55], 0, CER_L + L)); // the frontal pole and its flat underside
    out.push(ell([0.26 * s, -0.12, -0.7], [0.38, 0.26, 0.3], 0, CER_L + L)); // the occipital pole
    out.push(ell([T_C[0] * s, T_C[1], T_C[2]], T_R, T_TILT, TMP_L + L)); // the temporal lobe
    out.push(ell([0.24 * s, -0.57, -0.51], [0.3, 0.25, 0.29], 0.25, CBL_L + L)); // the cerebellum, a tenth short of the back, lowest toward its back
  }
  out.push(ell([0, -0.2, -0.12], [0.12, 0.14, 0.12], 0, STEM)); // midbrain
  out.push(ell([0, -0.44, -0.07], [0.12, 0.14, 0.12], 0, STEM)); // pons
  out.push(ell([0, -0.92, -0.15], [0.066, 0.5, 0.066], 0.2, STEM)); // medulla: one stalk about 5 dots wide, down and a little back, off the bottom
  return out;
}

/** The inner structures of one hemisphere (`s` -1 left, 1 right). */
function buildInner(s: number): Ell[] {
  const out: Ell[] = [ell([0.11 * s, 0.07, -0.06], [0.1, 0.09, 0.15], 0, THAL)];
  // the hippocampus: a tube along a curve from beside the amygdala, back and up under the thalamus
  const P0: V3 = [0.33, -0.39, 0.22], P1: V3 = [0.37, -0.45, -0.12], P2: V3 = [0.2, -0.15, -0.25];
  const at = (t: number, k: number): number => (1 - t) * (1 - t) * (P0[k] as number) + 2 * (1 - t) * t * (P1[k] as number) + t * t * (P2[k] as number);
  const N = 8;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, tm = (t0 + t1) / 2;
    const dy = at(t0, 1) - at(t1, 1), dz = at(t0, 2) - at(t1, 2); // pointing forward
    const len = Math.hypot(dy, dz);
    const r = 0.052 - 0.014 * tm;
    out.push(ell([at(tm, 0) * s, at(tm, 1), at(tm, 2)], [r, r, len * 0.7 + r * 0.4], Math.atan2(-dy, dz), HIP));
  }
  out.push(ell([0.32 * s, -0.4, 0.33], [0.075, 0.075, 0.075], 0, AMY));
  return out;
}

const OUTER = buildOuter();
const INNER_SIDE = [buildInner(-1), buildInner(1)];

/** The implicit function of ellipsoid `e` at a point: below 1 inside. */
function level(e: Ell, x: number, y: number, z: number): number {
  const dx = x - e.cx, dy = y - e.cy, dz = z - e.cz;
  const lx = dx * e.ix, ly = (dy * e.ct + dz * e.st) * e.iy, lz = (-dy * e.st + dz * e.ct) * e.iz;
  return lx * lx + ly * ly + lz * lz;
}

/** Ellipsoid `e`'s outward normal at a point, not normalised. */
function normal(e: Ell, x: number, y: number, z: number): [number, number, number] {
  const dx = x - e.cx, dy = y - e.cy, dz = z - e.cz;
  const nx = dx * e.ix * e.ix, ly = (dy * e.ct + dz * e.st) * e.iy * e.iy, lz = (-dy * e.st + dz * e.ct) * e.iz * e.iz;
  return [nx, ly * e.ct - lz * e.st, ly * e.st + lz * e.ct];
}

/** Fixed points on the outer surface: the stipple, lowest rank first, with their normals. */
type Stipple = { P: Float32Array; N: Float32Array; G: Uint8Array; rank: Float32Array; n: number };

function buildStipple(): Stipple {
  let s = 20261009;
  const rand = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const pts: { p: [number, number, number]; n: [number, number, number]; g: number; r: number }[] = [];
  for (const e of OUTER) {
    if (e.g === CBL_L || e.g === CBL_R) continue; // the cerebellum is its folia alone
    const a = 1 / e.ix, b = 1 / e.iy, c = 1 / e.iz;
    const area = 4 * Math.PI * Math.pow((Math.pow(a * b, 1.6) + Math.pow(a * c, 1.6) + Math.pow(b * c, 1.6)) / 3, 1 / 1.6);
    const n = Math.round(area * 2600);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1, ph = rand() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      const lx = rr * Math.cos(ph) * a, ly = u * b, lz = rr * Math.sin(ph) * c;
      const x = e.cx + lx, y = e.cy + ly * e.ct - lz * e.st, z = e.cz + ly * e.st + lz * e.ct;
      if (y < -1.05) continue;
      let covered = false;
      for (const o of OUTER) if (o !== e && level(o, x, y, z) < 0.998) { covered = true; break; }
      if (covered) continue;
      const nv = normal(e, x, y, z), nl = Math.hypot(nv[0], nv[1], nv[2]);
      pts.push({ p: [x, y, z], n: [nv[0] / nl, nv[1] / nl, nv[2] / nl], g: e.g, r: rand() });
    }
  }
  pts.sort((p, q) => p.r - q.r);
  const P = new Float32Array(pts.length * 3), N = new Float32Array(pts.length * 3), G = new Uint8Array(pts.length), rank = new Float32Array(pts.length);
  pts.forEach((q, k) => {
    P[k * 3] = q.p[0]; P[k * 3 + 1] = q.p[1]; P[k * 3 + 2] = q.p[2];
    N[k * 3] = q.n[0]; N[k * 3 + 1] = q.n[1]; N[k * 3 + 2] = q.n[2];
    G[k] = q.g; rank[k] = q.r;
  });
  return { P, N, G, rank, n: pts.length };
}

const STIPPLE = buildStipple();

/** A table sine: the folds' wiggles need a dot's accuracy, not Math.sin's (which costs most of a frame here). */
const SIN_N = 1024, SIN_K = SIN_N / (2 * Math.PI);
const SIN_T = Float32Array.from({ length: SIN_N }, (_, i) => Math.sin(i / SIN_K));
const fsin = (x: number): number => SIN_T[((x * SIN_K) | 0) & (SIN_N - 1)] as number;

// ── the sulci: zero lines of functions on the surface ───────────────────────
// Each is drawn where its function changes sign between neighbouring dots of
// one part, NaN where it does not run. `ax` is |x|: both hemispheres alike.

/** The central sulcus: from the top just behind the middle, down and leaning forward toward the fissure. */
const Zc = (y: number): number => -0.16 + (0.64 - y) * 0.62;
/** The temporal lobe's own frame: along its height, and along its length. */
const tY = (y: number, z: number): number => (y - T_C[1]) * T_CT + (z - T_C[2]) * T_ST;
const tZ = (y: number, z: number): number => -(y - T_C[1]) * T_ST + (z - T_C[2]) * T_CT;

// One pass sets, per dot, a bit for each fold that runs there (`FV`) and
// another for the side of it the dot is on (`FS`): bits 0-6 the cerebrum's
// sulci, 7-8 the temporal lobe's, 9 the maze of gyri, 10 the folia.
const B_NAMED = 0x1ff, B_MAZE = 0x200, B_FOLIA = 0x400;
let FS = 0, FV = 0;
function foldBits(g: number, ax: number, y: number, z: number, sv: number, mk: number): void {
  let s = 0, v = 0;
  if (g <= 1) {
    const zc = Zc(y);
    // central, and the gyri either side of it parallel: leaning back at the top, wobbling about
    // a dot and a half every eight (the wobble is what makes them gyri and not rulings)
    if (y > 0.03) { v |= 1; if (z - zc - 0.04 * fsin(y * 27 + 0.6) - 0.016 * fsin(y * 53 + 2) - 0.012 * fsin(ax * 15) >= 0) s |= 1; }
    if (y > 0.08 && y < 0.56) { v |= 2; if (z - zc - 0.2 - 0.038 * fsin(y * 25 + 2.2) - 0.015 * fsin(y * 49 + 1) >= 0) s |= 2; }
    if (y > 0.1 && y < 0.58 && z > -0.75) { v |= 4; if (z - zc + 0.19 - 0.038 * fsin(y * 26 + 4.1) - 0.015 * fsin(y * 47 + 3) >= 0) s |= 4; }
    // frontal: superior and inferior, front to back, stopping short of the precentral (no T-joins)
    if (y > 0.18 && z > zc + 0.34 && z < 0.86) { v |= 8; if (ax - 0.25 - 0.035 * fsin(z * 22 + 1) >= 0) s |= 8; }
    if (ax > 0.32 && y > -0.3 && z > zc + 0.34 && z < 0.84) { v |= 16; if (y - 0.08 - 0.12 * (z - 0.5) - 0.036 * fsin(z * 24 + 0.4) >= 0) s |= 16; }
    // parietal: intraparietal, front to back, starting clear of the postcentral
    if (ax > 0.28 && z < zc - 0.33 && z > -0.8) { v |= 32; if (y - 0.3 - 0.2 * (z + 0.45) - 0.038 * fsin(z * 21 + 2) >= 0) s |= 32; }
    // occipital: a short one, tilted like the rest rather than parallel to the back edge
    if (ax > 0.2 && y > -0.18 && y < 0.14) { v |= 64; if (z + 0.72 + 0.55 * y - 0.03 * fsin(y * 26) >= 0) s |= 64; }
  } else if (g <= 3) {
    // temporal: superior and inferior, along the lobe
    const qy = tY(y, z), qz = tZ(y, z);
    if (Math.abs(qz) < 0.4) { v |= 128; if (qy - 0.03 - 0.028 * fsin(qz * 24 + 0.5) >= 0) s |= 128; }
    if (qz > -0.36 && qz < 0.3) { v |= 256; if (qy + 0.09 - 0.026 * fsin(qz * 22 + 2) >= 0) s |= 256; }
  }
  if (g <= 3 && mk > 0) {
    v |= B_MAZE;
    if (fsin(mk * (0.8 * ax + 0.6 * y) + 1.3) + fsin(mk * (-0.45 * y + 0.89 * z) + 2.1)
      + fsin(mk * (0.55 * z - 0.83 * ax) + 0.4) + 0.8 * fsin(mk * 1.6 * (0.36 * ax + 0.66 * y - 0.66 * z) + 2.7) >= 0) s |= B_MAZE;
  } else if (g === 4 || g === 5) {
    // the folia: shallow arcs every other dot row, round a point above and in front of the
    // cerebellum, so they follow its round back and bottom like the reference's fingerprint
    v |= B_FOLIA;
    const dy = y + 0.2, dz = z + 0.36;
    if (fsin(Math.PI * sv * Math.sqrt(dy * dy + dz * dz) + 1e-3) >= 0) s |= B_FOLIA;
  }
  FS = s; FV = v;
}

// ── drawing ──────────────────────────────────────────────────────────────────

const P_STIPPLE = 1, P_FOLD = 2, P_INNER = 3, P_FISSURE = 4, P_OUTLINE = 5, P_LIT = 6, P_SIGNAL = 7;
const BRAILLE = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]; // [row][col]
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
/** Braille dots are square in the terminal: iTerm2, Menlo 13, a cell 8 x 16 (4 x 4 a dot). */
const DOT_ASPECT = 1.0;
const FAR = 4;

export function pack(r: number, g: number, b: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, v | 0));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

function dim(c: number, k: number): number {
  return pack(((c >> 16) & 255) * k, ((c >> 8) & 255) * k, (c & 255) * k);
}

function toward(c: number, t: Rgb, m: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return pack(r + (t[0] - r) * m, g + (t[1] - g) * m, b + (t[2] - b) * m);
}

const CYAN: Rgb = [0, 205, 255], TEAL: Rgb = [40, 232, 182], WHITE: Rgb = [255, 255, 255];
const RIM = pack(120, 238, 255), HOT: Rgb = [200, 250, 255];
const CBL_COL = { rim: pack(246, 182, 238), folia: pack(178, 114, 180), crease: pack(196, 128, 200) };
const STEM_COL = { rim: pack(120, 166, 255), crease: pack(112, 150, 250), stipple: pack(40, 170, 220) };
const INNER_COL = [pack(255, 196, 76), pack(176, 126, 255), pack(255, 110, 160)];
const MONO_GREY = [0, 62, 100, 112, 150, 186, 186, 200];

type Signal = { p0: V3; mid: V3; p2: V3; reg: number; col: Rgb; born: number; dur: number };

export type FrameOptions = {
  /** Paused: one grey, nothing flares. */
  mono?: boolean;
  /** A small tag beside a region's anchor: a picked or firing mechanism's name. */
  tag?: { region: RegionKey; label: string; col: Rgb } | null;
  /** The background every cell takes, 0..255 a channel; absent, the terminal's default. */
  bg?: Rgb | null;
  /**
   * How bright what is not lit draws, 0..1 (v0.2's small header brain: 0.72,
   * "dim at rest", so a lit region stands out). Absent: full.
   */
  dimRest?: number;
};

/** Scratch buffers for one frame size, reused frame to frame. */
type Scratch = {
  cols: number; rows: number; DW: number; DH: number;
  dep: Float32Array; grp: Int8Array; eid: Int8Array;
  idep: Float32Array; igrp: Int8Array;
  hx: Float32Array; hy: Float32Array; hz: Float32Array; fs: Uint16Array; fv: Uint16Array;
  near: Uint8Array; fold: Uint8Array; stack: Int32Array;
  pri: Uint8Array; col: Uint32Array;
  out: Uint32Array;
  /** What the last frame was drawn from, or '' to draw afresh. */
  key: string;
};

export class Brain {
  /** The view: yaw (0 the left side, front at screen left; pi/2 the front) and pitch (camera above). */
  rotY = 0.31;
  rotX = 0.1;
  /** The sway's centre, where it rests, and its half-width, radians: 2° to 34°, side view to three-quarters. */
  yawCentre = 0.31;
  yawSwing = 0.28;
  /**
   * The sway's phase speed, radians a millisecond: a 40 s period, so at its
   * fastest the 42 x 14 brain's poles move about a quarter of a braille dot a
   * frame at the calm rate. 0 holds the view where it is (the lab does).
   */
  spin = (2 * Math.PI) / 40000;
  /** Frames a second while it sways; a pulse's arc draws at the timer's full rate. */
  readonly calmFps = 6;
  /** With nothing firing for this long, the sway eases into its centre and nothing is drawn. */
  restAfter = 60000;
  /** The faint fill between the named folds: a maze of gyri. */
  mazeFill = true;
  gyriK = 10;
  /** Of the surface that faces away from the middle, about how much the stipple covers. */
  stippleDensity = 0.15;
  private phase = 0;
  /**
   * The brain's own time, the sum of `step`'s `dt`: the sway, the rest, the
   * glows and the arcs all run on it, so the brain moves with the ticks that
   * draw it (and a test's clock), whatever the wall clock says.
   */
  private clock = 0;
  /** Whether the last `frame()` drew afresh; false when it handed back the standing frame. */
  fresh = true;
  /** The sway's amplitude: 1 swaying, 0 at rest at the centre; eases between them over a few seconds. */
  private motion = 1;
  private lastActive = -1;
  private poked = false;
  private readonly glow = new Float32Array(REGIONS.length);
  private readonly glowTarget = new Float32Array(REGIONS.length);
  private readonly glowCol: (Rgb | null)[] = REGIONS.map(() => null);
  private signals: Signal[] = [];
  private scratch: Scratch | null = null;
  private seed = 7;
  /** Where each region's anchor fell in the last frame, in cells. */
  readonly anchors: { x: number; y: number; depth: number }[] = REGIONS.map(() => ({ x: 0, y: 0, depth: 0 }));

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** A region fires: it flares in `col`, and a signal arcs to it from `from`. (`now` is the caller's; the arc runs on the brain's own clock.) */
  pulse(region: RegionKey, col: Rgb, now: number, from: RegionKey = 'thalamus'): void {
    void now;
    const r = RID[region];
    this.lastActive = this.clock;
    this.glowTarget[r] = 1;
    this.glowCol[r] = col;
    const jit = (a: V3): V3 => [a[0] + (this.rand() - 0.5) * 0.12, a[1] + (this.rand() - 0.5) * 0.12, a[2] + (this.rand() - 0.5) * 0.12];
    const p0 = jit((REGIONS[RID[from]] as Region).anchor), p2 = jit((REGIONS[r] as Region).anchor);
    const k = 1.35 + 0.3 * this.rand();
    const mid: V3 = [((p0[0] + p2[0]) / 2) * k, ((p0[1] + p2[1]) / 2) * k + 0.3, ((p0[2] + p2[2]) / 2) * k];
    this.signals.push({ p0, mid, p2, reg: r, col, born: this.clock, dur: 1400 });
  }

  /** Holds a region lit while a mechanism is picked (called every frame it is). */
  light(region: RegionKey, col: Rgb, amount = 0.9): void {
    this.poked = true;
    const r = RID[region];
    this.glowCol[r] = col;
    this.glowTarget[r] = Math.max(this.glowTarget[r] ?? 0, amount);
  }

  /**
   * The still brain (v0.2): a region lit at once, no arc, no easing, so one
   * frame shows it; `dark()` puts every light out for the frame after.
   */
  flash(region: RegionKey, col: Rgb): void {
    const r = RID[region];
    this.glow[r] = 1;
    this.glowTarget[r] = 1;
    this.glowCol[r] = col;
  }

  dark(): void {
    this.glow.fill(0);
    this.glowTarget.fill(0);
    this.signals = [];
  }

  /** Holds the view at its centre (the still brain), or lets it sway again. */
  hold(still: boolean): void {
    this.spin = still ? 0 : (2 * Math.PI) / 40000;
    if (still) this.rotY = this.yawCentre;
  }

  /** Wakes it from rest (the sidebar opened full): the sway eases back in, as a pulse would make it, with no arc. */
  wake(): void {
    this.poked = true;
  }

  /** Sways the view and lets glows ease and fade; `dt` in milliseconds. */
  step(now: number, dt: number): void {
    void now;
    this.clock += dt;
    if (this.lastActive < 0 || this.poked) { this.lastActive = this.clock; this.poked = false; }
    const awake = this.clock - this.lastActive < this.restAfter ? 1 : 0;
    this.motion += (awake - this.motion) * Math.min(1, dt / 2500);
    if (awake === 0 && this.motion < 0.004) this.motion = 0; // settled at the centre: rest exactly
    if (this.spin !== 0) {
      this.phase += this.spin * dt;
      this.rotY = this.yawCentre + this.yawSwing * this.motion * Math.sin(this.phase);
    }
    for (let i = 0; i < REGIONS.length; i++) {
      const g = this.glow[i] ?? 0, tg = this.glowTarget[i] ?? 0;
      this.glow[i] = g + (tg - g) * Math.min(1, 0.012 * dt);
      this.glowTarget[i] = tg * Math.pow(0.9993, dt);
    }
    this.signals = this.signals.filter(s => this.clock - s.born < s.dur * 1.25);
  }

  /**
   * What the next tick should draw: `burst` every tick (a signal is arcing),
   * `calm` at `calmFps` (swaying, or a glow fading), `rest` nothing at all
   * (the last frame stands until something fires).
   */
  mode(): 'burst' | 'calm' | 'rest' {
    if (this.signals.length > 0) return 'burst';
    if (this.motion > 0.004) return 'calm';
    for (let i = 0; i < REGIONS.length; i++) if ((this.glow[i] ?? 0) > 0.03 || (this.glowTarget[i] ?? 0) > 0.03) return 'calm';
    return 'rest';
  }

  /**
   * Everything a frame depends on but the clock (signals aside: they move with
   * it). The view counts in steps that move the brain's poles a fifth of a dot
   * at scale `sc` (dots a unit): a turn smaller than that changes no dot worth
   * redrawing.
   */
  private frameKey(opts: FrameOptions, sc: number): string {
    const q = 0.2 / sc;
    let k = `${Math.round(this.rotY / q)},${Math.round(this.rotX / q)},${opts.mono === true ? 1 : 0},${opts.bg ? opts.bg.join('/') : '-'},${String(opts.dimRest ?? 1)},`;
    k += opts.tag ? `${opts.tag.region}:${opts.tag.label}:${opts.tag.col.join('/')}` : '-';
    for (let i = 0; i < REGIONS.length; i++) {
      const g = this.glow[i] ?? 0, c = this.glowCol[i];
      k += g < 0.005 ? ',0' : `,${g.toFixed(3)}:${c ? c.join('/') : ''}`;
    }
    return k;
  }

  private scratchFor(cols: number, rows: number): Scratch {
    const s = this.scratch;
    if (s !== null && s.cols === cols && s.rows === rows) return s;
    const DW = cols * 2, DH = rows * 4, n = DW * DH;
    const made: Scratch = {
      cols, rows, DW, DH,
      dep: new Float32Array(n), grp: new Int8Array(n), eid: new Int8Array(n),
      idep: new Float32Array(n), igrp: new Int8Array(n),
      hx: new Float32Array(n), hy: new Float32Array(n), hz: new Float32Array(n), fs: new Uint16Array(n), fv: new Uint16Array(n),
      near: new Uint8Array(n), fold: new Uint8Array(n), stack: new Int32Array(n),
      pri: new Uint8Array(n), col: new Uint32Array(n),
      out: new Uint32Array(cols * rows * 3),
      key: '',
    };
    this.scratch = made;
    return made;
  }

  /**
   * One frame of `cols` x `rows` cells. The returned array is reused by the
   * next call of the same size: encode it before asking for another.
   */
  frame(cols: number, rows: number, now: number, opts: FrameOptions = {}): Uint32Array {
    const S = this.scratchFor(cols, rows);
    // nothing that shapes the picture has moved since the last frame of this size: it stands
    const key = this.frameKey(opts, Math.min(cols * 2 / 2.1, (rows * 4) / 1.58));
    if (this.signals.length === 0 && key === S.key) { this.fresh = false; return S.out; }
    this.fresh = true;
    S.key = this.signals.length === 0 ? key : '';
    void now;
    const clock = this.clock;
    const { DW, DH, dep, grp, eid, idep, igrp, hx, hy, hz, fs, fv, near, fold, stack, pri, col, out } = S;
    const N = DW * DH;
    const mono = opts.mono === true;
    const glow = this.glow;

    // the view: orthographic, yaw about y then pitch
    const th = this.rotY, ph = this.rotX;
    const fx = Math.cos(th) * Math.cos(ph), fy = -Math.sin(ph), fz = -Math.sin(th) * Math.cos(ph); // into the screen
    const rx = -Math.sin(th), ry = 0, rz = -Math.cos(th); // screen right
    const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx; // screen up
    const SC = Math.min(DW / 2.1, DH / 1.58 / DOT_ASPECT), SV = SC * DOT_ASPECT;
    const midX = DW / 2, midY = DH / 2 - 0.1 * SV;
    const toX = (x: number, y: number, z: number): number => midX + (x * rx + y * ry + z * rz) * SC;
    const toY = (x: number, y: number, z: number): number => midY - (x * ux + y * uy + z * uz) * SV;

    // 1. rays: the nearest outer surface per dot, and the nearest inner one
    dep.fill(Infinity); grp.fill(-1); idep.fill(Infinity); igrp.fill(-1);
    const cast = (list: readonly Ell[], D: Float32Array, Gb: Int8Array, E: Int8Array | null): void => {
      for (let k = 0; k < list.length; k++) {
        const e = list[k] as Ell;
        const loc = (x: number, y: number, z: number): [number, number, number] =>
          [x * e.ix, (y * e.ct + z * e.st) * e.iy, (-y * e.st + z * e.ct) * e.iz];
        const [lrx, lry, lrz] = loc(rx, ry, rz), [lux, luy, luz] = loc(ux, uy, uz), [lfx, lfy, lfz] = loc(fx, fy, fz);
        const [lox, loy, loz] = loc(-FAR * fx - e.cx, -FAR * fy - e.cy, -FAR * fz - e.cz);
        const a = lfx * lfx + lfy * lfy + lfz * lfz;
        const su = e.cx * rx + e.cy * ry + e.cz * rz, sv = e.cx * ux + e.cy * uy + e.cz * uz, R = e.rmax * 1.02;
        const X0 = Math.max(0, Math.floor(midX + (su - R) * SC)), X1 = Math.min(DW - 1, Math.ceil(midX + (su + R) * SC));
        const Y0 = Math.max(0, Math.floor(midY - (sv + R) * SV)), Y1 = Math.min(DH - 1, Math.ceil(midY - (sv - R) * SV));
        for (let Y = Y0; Y <= Y1; Y++) {
          const v = (midY - (Y + 0.5)) / SV;
          const bx = lox + v * lux, by = loy + v * luy, bz = loz + v * luz;
          for (let X = X0; X <= X1; X++) {
            const u = (X + 0.5 - midX) / SC;
            const ox = bx + u * lrx, oy = by + u * lry, oz = bz + u * lrz;
            const hb = ox * lfx + oy * lfy + oz * lfz, c = ox * ox + oy * oy + oz * oz - 1;
            const disc = hb * hb - a * c;
            if (disc < 0) continue;
            const d = (-hb - Math.sqrt(disc)) / a - FAR;
            const i = Y * DW + X;
            if (d < (D[i] as number)) { D[i] = d; Gb[i] = e.g; if (E !== null) E[i] = k; }
          }
        }
      }
    };
    cast(OUTER, dep, grp, eid);
    const nearSide = fx > 0 ? 0 : 1; // the camera looks from the left (x < 0) while fx > 0
    cast(INNER_SIDE[nearSide] as Ell[], idep, igrp, null);

    // 2. hit points; the lateral fissure carved as a channel; the gap over the cerebellum
    const W = Math.max(0.05, 2.6 / SC);
    for (let Y = 0; Y < DH; Y++) {
      const v = (midY - (Y + 0.5)) / SV;
      for (let X = 0; X < DW; X++) {
        const i = Y * DW + X, g = grp[i] as number;
        if (g < 0) continue;
        const u = (X + 0.5 - midX) / SC, d = dep[i] as number;
        const x = rx * u + ux * v + fx * d, y = ry * u + uy * v + fy * d, z = rz * u + uz * v + fz * d;
        hx[i] = x; hy[i] = y; hz[i] = z;
        if (g > TMP_R || Math.abs(x) < 0.3) continue;
        // the temporal lobe's profile from the side: inside it is temporal; a band above and before it is the fissure
        const qy = tY(y, z), qz = tZ(y, z);
        const sy = qy / T_R[1], sz = qz / T_R[2], Q = sy * sy + sz * sz;
        if (Q < 1) { grp[i] = TMP_L + (x < 0 ? 0 : 1); continue; }
        if (qy > -0.35 * T_R[1] && qz > -0.5 * T_R[2]) {
          // the channel narrows to nothing at its back end, so its lips meet as a fissure's do
          const t0 = Math.min(1, (qz + 0.5 * T_R[2]) / (0.5 * T_R[2])), taper = t0 * (2 - t0);
          const gy = (2 * qy) / (T_R[1] * T_R[1]), gz = (2 * qz) / (T_R[2] * T_R[2]);
          if ((Q - 1) / Math.sqrt(gy * gy + gz * gz) < W * taper) grp[i] = CHAN;
        }
      }
    }
    const GAPN = Math.max(2, Math.round(SC / 18));
    for (let X = 0; X < DW; X++) {
      let last = -1000;
      for (let Y = 0; Y < DH; Y++) {
        const i = Y * DW + X, g = grp[i] as number;
        if ((g >= 0 && g <= TMP_R) || g === CHAN) last = Y;
        else if ((g === CBL_L || g === CBL_R) && Y - last <= GAPN) grp[i] = GAP;
      }
    }
    const outside = (i: number): boolean => { const g = grp[i] as number; return g < 0 || g === CHAN || g === GAP; };
    const isPart = (g: number): boolean => g >= 0 && g <= STEM;

    // how far each dot is from the outside, up to 3 (the canvas edge is not outside: the stalk runs off it)
    for (let i = 0; i < N; i++) near[i] = outside(i) ? 0 : 3;
    // the top and side edges close the shape; the bottom one is open, the stalk runs off it
    for (let i = 0; i < N; i++) { const X = i % DW; if (near[i] === 3 && (i < DW || X === 0 || X === DW - 1)) near[i] = 1; }
    for (let pass = 1; pass <= 2; pass++) {
      for (let Y = 0; Y < DH; Y++) for (let X = 0; X < DW; X++) {
        const i = Y * DW + X;
        if ((near[i] as number) !== 3) continue;
        if ((X > 0 && near[i - 1] === pass - 1) || (X < DW - 1 && near[i + 1] === pass - 1)
          || (Y > 0 && near[i - DW] === pass - 1) || (Y < DH - 1 && near[i + DW] === pass - 1)) near[i] = pass;
      }
    }

    // colours and regions
    pri.fill(0); col.fill(0);
    const put = (i: number, p: number, c: number): void => {
      if (p < P_SIGNAL && outside(i) && (grp[i] as number) >= 0) return; // the channel and the gap stay empty
      if (p > (pri[i] as number)) { pri[i] = p; col[i] = c; }
    };
    const lit = (reg: number): number => (mono ? 0 : (glow[reg] ?? 0));
    const flare = (reg: number, base: number): number => {
      const g = lit(reg), gc = this.glowCol[reg];
      if (g < 0.05 || !gc) return base;
      return toward(base, [gc[0] * 255, gc[1] * 255, gc[2] * 255], Math.min(1, g * 1.4));
    };
    const fade = Math.max(1, 2.6 / SC);
    /** The prefrontal cortex: the frontal lobe in front of the precentral gyrus, its edge dithered over 2–3 dots. */
    const regionAt = (g: number, y: number, z: number, X: number, Y: number): number => {
      if (g <= CER_L + 1) {
        const w = (z - (Zc(y) + 0.36)) / fade;
        return w > (BAYER4[(Y & 3) * 4 + (X & 3)] as number) ? RID.prefrontal : RID.cortex;
      }
      return g <= TMP_R ? RID.cortex : g <= CBL_R ? RID.cerebellum : RID.brainstem;
    };
    const cortexCol = (y: number, z: number, k: number): number => {
      const w = Math.max(0, Math.min(1, 0.45 + 0.85 * y - 0.3 * z));
      return pack((CYAN[0] + (TEAL[0] - CYAN[0]) * w) * k, (CYAN[1] + (TEAL[1] - CYAN[1]) * w) * k, (CYAN[2] + (TEAL[2] - CYAN[2]) * w) * k);
    };
    /** The stem fades as it drops, to nothing at the bottom row. */
    /** The stalk keeps its strength down to the last row of cells, where it fades out. */
    const stemFade = (Y: number): number => (Y >= DH - 4 ? 0.5 : 1);
    type Kind = 'rim' | 'crease' | 'fold' | 'maze';
    const lineCol = (g: number, i: number, kind: Kind): number => {
      if (g === STEM) return dim(kind === 'rim' ? STEM_COL.rim : STEM_COL.crease, stemFade(Math.floor(i / DW)));
      if (g === CBL_L || g === CBL_R) return kind === 'rim' ? CBL_COL.rim : kind === 'crease' ? CBL_COL.crease : CBL_COL.folia;
      if (kind === 'rim') return rimCol(i);
      return cortexCol(hy[i] as number, hz[i] as number, kind === 'maze' ? 0.34 : kind === 'crease' ? 0.8 : 0.62);
    };
    const mark = (i: number, p: number, kind: Kind): void => {
      const g = grp[i] as number;
      const reg = regionAt(g, hy[i] as number, hz[i] as number, i % DW, Math.floor(i / DW));
      if (lit(reg) >= 0.05) put(i, P_LIT, flare(reg, lineCol(g, i, kind)));
      else put(i, p, lineCol(g, i, kind));
    };

    /** How squarely the surface under dot `i` faces us, 0 edge-on to 1 head-on; `nX nY nZ` hold its normal. */
    let nX = 0, nY = 0, nZ = 0;
    const facing = (i: number): number => {
      const e = OUTER[eid[i] as number] as Ell;
      const dx = (hx[i] as number) - e.cx, dy = (hy[i] as number) - e.cy, dz = (hz[i] as number) - e.cz;
      const nx = dx * e.ix * e.ix, ly = (dy * e.ct + dz * e.st) * e.iy * e.iy, lz = (-dy * e.st + dz * e.ct) * e.iz * e.iz;
      const ny = ly * e.ct - lz * e.st, nz = ly * e.st + lz * e.ct, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nX = nx / l; nY = ny / l; nZ = nz / l;
      return Math.abs(nX * fx + nY * fy + nZ * fz);
    };
    /** The rim runs white-hot where it turns most edge-on toward the upper left, light cyan elsewhere. */
    const LX = -0.55, LY = 0.83;
    const rimCol = (i: number): number => {
      const face = facing(i);
      const sx = nX * rx + nY * ry + nZ * rz, sy = nX * ux + nY * uy + nZ * uz;
      const sl = Math.sqrt(sx * sx + sy * sy) || 1;
      const lit2 = Math.max(0, (sx * LX + sy * LY) / sl);
      return toward(RIM, HOT, Math.min(1, lit2 * lit2 * 1.3 * (1 - face)));
    };

    // 3. the rim, then the edges inside it
    const JUMP = 3.5 / SC;
    for (let Y = 0; Y < DH; Y++) {
      for (let X = 0; X < DW; X++) {
        const i = Y * DW + X, g = grp[i] as number;
        if (!isPart(g)) continue;
        if (near[i] === 1) { mark(i, P_OUTLINE, 'rim'); continue; }
        for (let jj = 0; jj < 2; jj++) {
          if (jj === 0 ? X === DW - 1 : Y === DH - 1) continue;
          const j = jj === 0 ? i + 1 : i + DW, gj = grp[j] as number;
          if (!isPart(gj)) continue;
          const di = dep[i] as number, dj = dep[j] as number;
          const nr = di < dj ? i : j, fr = nr === i ? j : i;
          const gn = grp[nr] as number, gf = grp[fr] as number;
          if (Math.abs(di - dj) > JUMP) {
            if ((near[nr] as number) <= 2) continue; // an inner edge hugging the rim would double it
            if (gn <= TMP_R && gf <= TMP_R) {
              // cortex before cortex: the midline cleft, or the temporal pole before the frontal lobe, quiet;
              // one lobe's piece before another of the same lobe is no edge at all (it drew ghost arcs)
              if (((gn & 1) !== (gf & 1) && facing(nr) > 0.35) || (gn >= TMP_L) !== (gf >= TMP_L)) mark(nr, P_FOLD, 'fold');
            } else mark(nr, P_OUTLINE, 'rim');
          } else if (gj !== g) {
            const lo = Math.min(g, gj), hi = Math.max(g, gj);
            if (hi <= TMP_R) { const m = g & 1 ? i : j; if ((g & 1) !== (gj & 1) && (near[m] as number) >= 3 && facing(m) > 0.35) mark(m, P_FOLD, 'fold'); } // the midline, where it faces us; temporal-to-cerebrum is the channel's
            else if (lo === CBL_L && hi === CBL_R) mark(g === CBL_R ? i : j, P_FOLD, 'crease');
            else mark(g === hi ? i : j, P_FISSURE, 'crease'); // the stem's and the cerebellum's edges against the rest
          }
        }
      }
    }

    // 4. the folds: named sulci, long and curved; the maze of gyri, faint; the folia
    fold.fill(0);
    const mk = this.mazeFill && SC >= 50 ? this.gyriK * Math.sqrt(SC / 35) : 0; // below that the maze is dashes; the named folds carry it
    for (let i = 0; i < N; i++) {
      const g = grp[i] as number;
      if (g < 0 || g > CBL_R) { fv[i] = 0; continue; }
      foldBits(g, Math.abs(hx[i] as number), hy[i] as number, hz[i] as number, SV, mk);
      fs[i] = FS; fv[i] = FV;
    }
    const CLASSES = [[B_NAMED, 1, 3, 0.25], [B_FOLIA, 3, 2, 0.12], [B_MAZE, 2, 3, 0.4]] as const; // folds keep off surfaces seen edge-on (they ran parallel to the top rim)
    for (let i = 0; i < N; i++) {
      const vi = fv[i] as number;
      if (vi === 0) continue;
      const X = i % DW;
      for (let jj = 0; jj < 2; jj++) {
        if (jj === 0 ? X === DW - 1 : i + DW >= N) continue;
        const j = jj === 0 ? i + 1 : i + DW;
        if (grp[j] !== grp[i]) continue;
        const diff = ((fs[i] as number) ^ (fs[j] as number)) & vi & (fv[j] as number);
        if (diff === 0) continue;
        for (const [mask, tag, nearMin, minFacing] of CLASSES) {
          const d = diff & mask;
          if (d === 0) continue;
          const m = ((fs[i] as number) & (d & -d)) !== 0 ? i : j;
          if ((near[m] as number) >= nearMin && (fold[m] as number) === 0 && facing(m) > minFacing) fold[m] = tag; // folds keep off the rim
        }
      }
    }
    /** Drops fold pieces shorter than `min` dots (they read as dashes), and marks the rest. */
    const keepLong = (tag: number, min: number, p: number, kind: Kind): void => {
      for (let s0 = 0; s0 < N; s0++) {
        if (fold[s0] !== tag) continue;
        // a flood fill: the stack's slots below `top` are pending, and each popped dot is kept from the end down
        let top = 0, n = 0, kept = N;
        stack[top++] = s0; fold[s0] = 200;
        while (top > 0) {
          const i = stack[--top] as number;
          stack[--kept] = i; n++;
          const X = i % DW, Y = (i - X) / DW;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x2 = X + dx, y2 = Y + dy;
            if (x2 < 0 || y2 < 0 || x2 >= DW || y2 >= DH) continue;
            const j = y2 * DW + x2;
            if (fold[j] === tag) { fold[j] = 200; stack[top++] = j; }
          }
        }
        for (let k = kept; k < N; k++) { const i = stack[k] as number; fold[i] = 201; if (n >= min) mark(i, p, kind); }
      }
    };
    keepLong(1, Math.max(7, Math.round(SC / 5)), P_FOLD, 'fold');
    keepLong(3, 3, P_FOLD, 'fold');
    keepLong(2, 6, P_STIPPLE, 'maze');

    // 5. the stipple: fixed surface points, sparse over the body so the middle reads as dark
    // glass, a little denser on the stem; lit, a region fills with them evenly
    {
      const want = Math.min(1, (this.stippleDensity * 6 * SC * SC) / (STIPPLE.n * 0.5));
      const { P, G, rank } = STIPPLE;
      let most = 0;
      for (let i = 0; i < REGIONS.length; i++) most = Math.max(most, lit(i));
      const stop = want * (1.6 + 3.2 * most);
      const eps = 1.6 / SC;
      for (let k = 0; k < STIPPLE.n && (rank[k] as number) < stop; k++) {
        const g = G[k] as number, r = rank[k] as number;
        const wgt = g === STEM ? 1.6 : 0.55;
        if (r >= want * (wgt + 3.2 * most)) continue;
        const x = P[k * 3] as number, y = P[k * 3 + 1] as number, z = P[k * 3 + 2] as number;
        const X = Math.floor(toX(x, y, z)), Y = Math.floor(toY(x, y, z));
        if (X < 0 || Y < 0 || X >= DW || Y >= DH) continue;
        const i = Y * DW + X;
        if ((near[i] as number) < 3 && g !== STEM) continue; // the band by the rim is the glow's
        if (x * fx + y * fy + z * fz > (dep[i] as number) + eps) continue;
        const reg = regionAt(g, y, z, X, Y), gl = lit(reg);
        if (r >= want * (wgt + 3.2 * gl)) continue;
        const base = g === STEM ? dim(STEM_COL.stipple, stemFade(Y)) : cortexCol(y, z, 0.42);
        if (gl >= 0.05 && r >= want * wgt) put(i, P_LIT, flare(reg, base));
        else put(i, P_STIPPLE, gl >= 0.05 ? flare(reg, base) : base);
      }
      // the rim's glow: about a fifth of the dots right inside the rim, at under half its brightness,
      // chosen by where they sit on the surface (a dot-sized cell of it), so they hold still as it turns
      const q = 1.5 / SC;
      const cellHash = (i: number): number => ((Math.imul(Math.floor((hx[i] as number) / q), 73856093) ^ Math.imul(Math.floor((hy[i] as number) / q), 19349663)
        ^ Math.imul(Math.floor((hz[i] as number) / q), 83492791)) >>> 0) & 1023;
      for (let i = 0; i < N; i++) {
        const g = grp[i] as number, nr = near[i] as number;
        if (!isPart(g) || nr < 2) continue;
        if (g === STEM) {
          // the stalk's inside: a sparse cyan fill, strong enough to share a cell with its edges, so it reads as one stalk
          if (cellHash(i) < 420) put(i, P_FISSURE, dim(STEM_COL.stipple, stemFade(Math.floor(i / DW))));
          continue;
        }
        if (nr !== 2 || cellHash(i) >= 220) continue;
        put(i, P_STIPPLE, dim(g >= CBL_L ? CBL_COL.rim : RIM, 0.45));
      }
    }

    // 6. the inner structures, behind glass, of the near hemisphere: a ring and a light fill in
    // their own colours; lit, filled solid in the stage colour with a halo. The amygdala is too
    // small to read at the sidebar's size unless lit, and lit it is a disc big enough to see.
    const showAmy = SC >= 50;
    const halo = Math.max(2, Math.round(SC / 17));
    for (let Y = 0; Y < DH; Y++) {
      for (let X = 0; X < DW; X++) {
        const i = Y * DW + X, g = igrp[i] as number;
        if (g < 0) continue;
        if (g === AMY && (!showAmy || lit(RID.amygdala) >= 0.05)) continue;
        const reg = INNER_REG[g] as number, gl = lit(reg);
        const edge = X === 0 || Y === 0 || X === DW - 1 || Y === DH - 1 || igrp[i - 1] !== g || igrp[i + 1] !== g || igrp[i - DW] !== g || igrp[i + DW] !== g;
        const base = INNER_COL[g] as number;
        if (gl >= 0.05) {
          const core = flare(reg, base);
          put(i, P_LIT, edge ? core : toward(core, WHITE, 0.35 * Math.min(1, gl)));
          if (edge) {
            for (let dy = -halo; dy <= halo; dy++) for (let dx = -halo; dx <= halo; dx++) {
              const x2 = X + dx, y2 = Y + dy;
              if (x2 < 0 || y2 < 0 || x2 >= DW || y2 >= DH || dx * dx + dy * dy > halo * halo + 1) continue;
              const j = y2 * DW + x2;
              if (igrp[j] !== g) put(j, P_LIT, dim(core, 0.75));
            }
          }
        } else if (edge) put(i, P_INNER, base);
        else if (g === THAL && SC < 50 && !mono) put(i, P_INNER, dim(base, 0.85)); // small, a ring breaks up: a solid oval
        else if (!mono && (X + 2 * Y) % 4 === 0) put(i, P_INNER, dim(base, 0.62));
      }
    }
    const amyGlow = lit(RID.amygdala);
    if (amyGlow >= 0.05) {
      const a = (INNER_SIDE[nearSide] as Ell[])[(INNER_SIDE[nearSide] as Ell[]).length - 1] as Ell;
      const cxp = toX(a.cx, a.cy, a.cz), cyp = toY(a.cx, a.cy, a.cz);
      const R = Math.max(SC * 0.09, 4.3), core = flare(RID.amygdala, INNER_COL[AMY] as number);
      for (let Y = Math.floor(cyp - R - 1); Y <= cyp + R + 1; Y++) for (let X = Math.floor(cxp - R - 1); X <= cxp + R + 1; X++) {
        if (X < 0 || Y < 0 || X >= DW || Y >= DH) continue;
        const d2 = (X + 0.5 - cxp) ** 2 + (Y + 0.5 - cyp) ** 2;
        if (d2 > R * R) continue;
        const i = Y * DW + X;
        const inner = d2 < (R - 1.2) * (R - 1.2);
        if (pri[i] === P_SIGNAL) continue;
        pri[i] = P_LIT; col[i] = inner ? toward(core, WHITE, 0.3 * Math.min(1, amyGlow)) : core;
      }
    }

    // 7. signals arcing between regions
    if (!mono) {
      for (const s of this.signals) {
        const tt = Math.min(1, (clock - s.born) / s.dur);
        const fadeS = clock - s.born < s.dur ? 1 : 1 - (clock - s.born - s.dur) / (s.dur * 0.25);
        if (fadeS <= 0) continue;
        for (let k = 0; k <= 14; k++) {
          const t = tt - k * 0.022;
          if (t < 0) break;
          const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
          const x = a * s.p0[0] + b * s.mid[0] + c * s.p2[0], y = a * s.p0[1] + b * s.mid[1] + c * s.p2[1], z = a * s.p0[2] + b * s.mid[2] + c * s.p2[2];
          const X = Math.floor(toX(x, y, z)), Y = Math.floor(toY(x, y, z));
          if (X < 0 || Y < 0 || X >= DW || Y >= DH) continue;
          const kk = (1 - k / 14) * fadeS;
          put(Y * DW + X, P_SIGNAL, k === 0 ? pack(255, 255, 255) : pack(s.col[0] * 255 * (0.5 + 0.5 * kk), s.col[1] * 255 * (0.5 + 0.5 * kk), s.col[2] * 255 * (0.5 + 0.5 * kk)));
        }
      }
    }

    // where each region's anchor sits, in cells (the inner ones on the near side)
    for (let r = 0; r < REGIONS.length; r++) {
      const a = (REGIONS[r] as Region).anchor;
      const slot = this.anchors[r];
      if (slot === undefined) continue;
      const ax = nearSide === 1 && a[0] < 0 ? -a[0] : a[0];
      slot.x = toX(ax, a[1], a[2]) / 2;
      slot.y = toY(ax, a[1], a[2]) / 4;
      slot.depth = ax * fx + a[1] * fy + a[2] * fz;
    }

    // 8. cells: the strongest kind in a cell sets its colour; lines always show, the faint fill only among faint things
    let focus = 0; // a spotlight: while a region is lit the rest steps back, so even a cyan flare shows on the cyan brain
    if (!mono) for (let i = 0; i < REGIONS.length; i++) focus = Math.max(focus, glow[i] ?? 0);
    // dim at rest (`dimRest`): what is not lit draws no brighter than that, and while a region is lit, no brighter than the spotlight
    const spot = Math.min(1 - 0.4 * Math.min(1, focus), opts.dimRest ?? 1);
    const base = opts.bg ?? null;
    const bg = base === null ? DEFAULT_COLOR : pack(base[0], base[1], base[2]);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        let top = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
          const p = pri[(cy * 4 + dy) * DW + cx * 2 + dx] as number;
          if (p > top) top = p;
        }
        const o = (cy * cols + cx) * 3;
        if (top === 0) { out[o] = 0x20; out[o + 1] = DEFAULT_COLOR; out[o + 2] = bg; continue; }
        let bits = 0, n = 0, r = 0, g = 0, b = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = (cy * 4 + dy) * DW + cx * 2 + dx, p = pri[i] as number;
          if (p === 0 || (p < P_FOLD && top > P_FOLD) || (p < P_FISSURE && (top === P_OUTLINE || top === P_FISSURE))) continue;
          bits |= (BRAILLE[dy] as number[])[dx] ?? 0;
          if (p === top) { const c = col[i] as number; r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++; }
        }
        out[o] = bits ? 0x2800 + bits : 0x20;
        if (mono) { const v = MONO_GREY[top] ?? 120; out[o + 1] = pack(v, v + 3, v + 7); }
        else { const k = top >= P_LIT ? 1 : spot; out[o + 1] = pack((r / n) * k, (g / n) * k, (b / n) * k); }
        out[o + 2] = bg;
      }
    }
    if (opts.tag && !mono) this.drawTag(out, cols, rows, opts.tag, pri, DW);
    return out;
  }

  /**
   * ` Name ` on its stage colour where it covers least of the brain's
   * landmarks, and `◆` on the region's anchor, or beside it toward the name
   * when the anchor's cell is the lit structure itself.
   */
  private drawTag(out: Uint32Array, cols: number, rows: number, tag: { region: RegionKey; label: string; col: Rgb }, pri: Uint8Array, DW: number): void {
    const a = this.anchors[RID[tag.region]];
    if (a === undefined) return;
    const ax = Math.max(0, Math.min(cols - 1, Math.floor(a.x))), ay = Math.max(0, Math.min(rows - 1, Math.floor(a.y)));
    const cellTop = (x: number, y: number): number => {
      let t = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) t = Math.max(t, pri[(y * 4 + dy) * DW + x * 2 + dx] as number);
      return t;
    };
    const label = ` ${tag.label} `;
    let best: { x: number; y: number; cost: number } | null = null;
    for (const dy of [-2, -3, 2, 3, -1, 1, -4, 4, -5, 5, -6, 6]) {
      const ly = ay + dy;
      if (ly < 0 || ly >= rows) continue;
      for (const lx of [ax + 2, ax - label.length - 1, 0, cols - label.length]) {
        if (lx < 0 || lx + label.length > cols) continue;
        let cost = Math.abs(dy) * 0.6 + Math.abs(lx + label.length / 2 - ax) * 0.08;
        for (let k = 0; k < label.length; k++) {
          const t = cellTop(lx + k, ly);
          cost += t >= P_LIT ? 6 : t === P_INNER ? 4 : t >= P_FISSURE ? 3 : t > 0 ? 0.3 : 0;
        }
        if (best === null || cost < best.cost) best = { x: lx, y: ly, cost };
      }
    }
    const set = (x: number, y: number, cp: number, fg: number): void => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const o = (y * cols + x) * 3;
      out[o] = cp; out[o + 1] = fg;
    };
    let dx = 0, dy = 0;
    if (best !== null && cellTop(ax, ay) >= P_LIT) { dx = best.x > ax ? 1 : -1; dy = best.y > ay ? 1 : best.y < ay ? -1 : 0; }
    set(ax + dx, ay + dy, 0x25c6, 0xffffff);
    if (best === null) return;
    const bg = pack(tag.col[0] * 255, tag.col[1] * 255, tag.col[2] * 255);
    for (let i = 0; i < label.length; i++) {
      const o = (best.y * cols + best.x + i) * 3;
      out[o] = label.charCodeAt(i); out[o + 1] = 0x000000; out[o + 2] = bg;
    }
  }
}
