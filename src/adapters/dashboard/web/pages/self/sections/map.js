/* THE SELF MAP (round 3b, item 4 — an experiment: Mike "wouldn't know until I
   saw it", so all of it is in this one module and `views/self-map.ts`).

   One question, answered at a glance: what is becoming part of who I am?
   (Round 4 of the map, 2026-09-28: the test is whether someone who knows
   roughly what this is, and none of the details, can read it unexplained.)
   - three rings, each NAMED ON THE MAP (no legend): "who I am" (the core, in
     the middle), "almost there" (ready to cross, or one awake return away —
     the engine's verdicts, `views/mind.ts#coreCandidates`), and "about me and
     us" (every other memory about me or about us, nearer the middle the closer
     it is to the core by the engine's own `closeness`);
   - each memory is a dot, as bright as it is firmly held; the core and the
     almost-there ones carry a short title (a few words, cut at a whole word),
     the firmest first, and where room runs out the rest are counted ("+N
     more") rather than overlapped; every other dot is unnamed and fainter;
   - the association links are hidden until a dot is hovered, focused or
     tapped: then only that dot's links show, and the dots at their other ends
     light up.
   Click (or Enter) opens a dot's memory card; on a touch screen the first tap
   shows its links and words, the second opens the card.

   The layout and the labels are pure functions of the data and the width
   (angles seeded from each id, fixed steps, text widths ESTIMATED from a
   table rather than measured, so a first draw before the font loads is the
   same picture as the next), so a live refresh of unchanged data draws the
   same picture. The home tab draws it too; each box keeps its own last
   drawing. To take the map out: this file, `views/self-map.ts`, the `map`
   field in `mindView` and `overviewView`, its lines in `settling.js` and the
   home tab's `sections/map.js`. */
import { esc } from "../../../shared/dom.js";
import { headline } from "../../../shared/format.js";
import { hideTip, showTip } from "../../../shared/tip.js";

const TAU = Math.PI * 2;

/** The rings' names, written on the map itself. */
export const RING_WORDS = { core: "who I am", near: "almost there", about: "about me and us" };

/** The one line under the map. */
export const CAPTION = "Memories about me and us. The closer to the middle, the closer to being part of who I am.";

/** FNV-1a over the id → [0, 1): where on the circle a dot starts. */
export function seedOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 4294967296;
}

/** "Almost there": ready to cross at the next check, or one awake return away. */
export const isNear = (n) => !n.core && (n.ready === true || n.oneReturnAway === true);

/** The memory labels' and the ring names' font sizes (self.css says the same). */
export const LABEL_PX = 11.5;
export const RING_PX = 11;

/**
 * A text's width in px, ESTIMATED from a per-character table (a little wide
 * for the dashboard's sans), so the labels are placed the same whether or not
 * the font has loaded. Pure.
 */
export function textWidth(s, px) {
  let em = 0;
  for (const ch of String(s)) {
    if ("ijlI.,;:'!|’".includes(ch)) em += 0.29;
    else if ("ftr ()-".includes(ch)) em += 0.37;
    else if ("mwMW".includes(ch)) em += 0.84;
    else if (ch === "…") em += 0.82;
    else if (ch >= "A" && ch <= "Z") em += 0.66;
    else em += 0.56;
  }
  return em * px;
}

const TAIL_WORDS = /\s+(a|an|the|of|to|and|or|but|in|on|at|for|with|by|from|when|what|that|which|is|are|was|I|we|my|our|it|its|as|if)$/i;

/**
 * A memory's short title: its first sentence, cut at a whole word to at most
 * `max` characters (and not left ending on "of" or "the"), "…" where it was
 * cut. Pure.
 */
export function shortTitle(text, max = 28) {
  const first = (String(text).split(/(?<=[.!?])\s/)[0] || String(text)).trim().replace(/[.!?]+$/, "");
  if (first.length <= max) return first;
  const sl = first.slice(0, max + 1);
  const sp = sl.lastIndexOf(" ");
  let cut = sp > 0 ? sl.slice(0, sp) : first.slice(0, max);
  for (let i = 0; i < 4 && TAIL_WORDS.test(cut); i++) cut = cut.replace(TAIL_WORDS, "");
  cut = cut.replace(/[\s,;:—–-]+$/, "");
  return (cut.length > 0 ? cut : first.slice(0, max)) + "…";
}

/**
 * A title as one line when it is at most `per` characters, else as two,
 * broken between the words nearest its middle. Pure.
 */
export function wrapTitle(title, per) {
  const t = String(title);
  if (t.length <= per) return [t];
  let best = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === " " && (best < 0 || Math.abs(i - t.length / 2) < Math.abs(best - t.length / 2))) best = i;
  }
  return best < 0 ? [t] : [t.slice(0, best), t.slice(best + 1)];
}

/** Narrower than this, a name takes two short lines rather than one long one. */
export const NARROW = 520;

/** How tall the picture is for a box `w` wide: a phone gets a taller one, so there is room above and below the rings for names. */
export function heightFor(w) {
  return w < NARROW ? Math.round(w * 1.6) : Math.round(Math.max(300, Math.min(440, w * 0.64)));
}

/** A ring name's box: centred on `x`, its baseline at `y`. */
function ringBox(text, x, y) {
  const half = textWidth(text, RING_PX) / 2 + 2;
  return { x0: x - half, x1: x + half, y0: y - RING_PX * 0.82 - 1, y1: y + RING_PX * 0.26 + 1 };
}

/**
 * Where every dot goes, in a `w` × `h` box, and where the rings' names sit.
 * Pure. Three zones, so the names on the map are true:
 *   - the core in a small disc at the middle (a sunflower spiral, so any
 *     number of them packs evenly), "who I am" written just above it;
 *   - the almost-there ones evenly round a ring just outside it (ready ones
 *     first, firmest first), leaving the top clear for "almost there";
 *   - every other dot in the outer band at the radius its closeness gives it —
 *     nearer the middle the closer it is to the core — and only its ANGLE
 *     moves: links pull linked dots together, and dots too close push apart.
 *     "about me and us" is written above the outer ring.
 */
export function layout(map, w, h) {
  const TOP = 24; // room above the outer ring for its name
  const avail = h - TOP - 10;
  const R = Math.max(40, Math.min(w / 2 - 12, avail / 2));
  const cx = w / 2, cy = TOP + avail / 2;
  const cores = map.nodes.filter((n) => n.core);
  const near = map.nodes.filter(isNear);
  const others = map.nodes.filter((n) => !n.core && !isNear(n));
  // The core: one in the very middle; a few evenly round a small circle, so
  // each has a way out for its name; many packed in a sunflower spiral.
  const coreRing = cores.length < 2 ? 0 : Math.max(16, (cores.length * 29) / TAU);
  const packed = coreRing + 15 > R * 0.34;
  const rc = cores.length === 0 ? Math.min(24, R * 0.18)
    : cores.length === 1 ? 20
    : packed ? R * 0.34 : coreRing + 15;
  // The almost-there ring leaves gaps between its dots, so the core's names
  // can reach out between them.
  const nNear = map.nodes.filter(isNear).length;
  const rA = Math.min(R * 0.62, Math.max(rc + 26, (nNear * 31) / (TAU - 1.2)));
  const rO = Math.min(rA + 24, R * 0.85);
  const pos = new Map();
  const golden = Math.PI * (3 - Math.sqrt(5));
  cores.forEach((n, i) => {
    if (cores.length === 1) { pos.set(n.id, { x: cx, y: cy, r: 0, fixed: true }); return; }
    const rr = packed ? Math.max(0, rc - 11) * Math.sqrt((i + 0.5) / cores.length) : coreRing;
    const a = packed ? i * golden + seedOf(cores[0].id) * TAU : (i + 0.5) * TAU / cores.length + seedOf(cores[0].id) * TAU;
    pos.set(n.id, { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), r: rr, fixed: true });
  });

  // The rings' names (the core's inside its disc when it is empty).
  const rings = [
    cores.length === 0
      ? { key: "core", text: RING_WORDS.core, x: cx, y: cy + 4 }
      : { key: "core", text: RING_WORDS.core, x: cx, y: cy - rc - 5 },
    { key: "near", text: RING_WORDS.near, x: cx, y: cy - rA - 4 },
    { key: "about", text: RING_WORDS.about, x: cx, y: cy - R - 8 },
  ].map((t) => ({ ...t, box: ringBox(t.text, t.x, t.y) }));

  // Almost there: evenly round their ring, the top left clear for its name.
  const hw = Math.min(0.9, (textWidth(RING_WORDS.near, RING_PX) / 2 + 14) / rA);
  const nearOrder = [...near].sort((a, b) =>
    (b.ready === true ? 1 : 0) - (a.ready === true ? 1 : 0) || (b.strength || 0) - (a.strength || 0) || (a.id < b.id ? -1 : 1));
  nearOrder.forEach((n, i) => {
    const a = -Math.PI / 2 + hw + (i + 0.5) * (TAU - 2 * hw) / nearOrder.length;
    pos.set(n.id, { x: cx + rA * Math.cos(a), y: cy + rA * Math.sin(a), r: rA, fixed: true });
  });

  // The rest: start evenly around the circle, in an order the ids fix (so no
  // side of the picture is crowded by chance); the links then pull the angles.
  const order = others.map((n) => n.id).sort((a, b) => seedOf(a) - seedOf(b));
  const turn = seedOf(order.join("|"));
  for (const n of others) {
    const c = Math.max(0, Math.min(2, Number(n.closeness) || 0));
    const r = rO + (1 - c / 2) * (R - rO);
    const a = (order.indexOf(n.id) / Math.max(1, others.length) + turn) * TAU;
    pos.set(n.id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), r, fixed: false });
  }
  const maxW = Math.max(1e-9, ...map.links.map((l) => l.weight));
  const links = map.links.filter((l) => pos.has(l.a) && pos.has(l.b));
  const STEPS = 160, GAP = 17;
  for (let s = 0; s < STEPS; s++) {
    const cool = 1 - s / STEPS;
    const push = new Map(others.map((n) => [n.id, { x: 0, y: 0 }]));
    // Links pull their two ends together (a fixed end stays put).
    for (const l of links) {
      const p = pos.get(l.a), q = pos.get(l.b);
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = 0.04 * (0.35 + 0.65 * l.weight / maxW) * Math.max(0, d - GAP) / d;
      if (!p.fixed) { const f = push.get(l.a); f.x += dx * k; f.y += dy * k; }
      if (!q.fixed) { const f = push.get(l.b); f.x -= dx * k; f.y -= dy * k; }
    }
    // Dots too close push apart.
    for (let i = 0; i < others.length; i++) {
      const p = pos.get(others[i].id);
      for (let j = i + 1; j < others.length; j++) {
        const q = pos.get(others[j].id);
        let dx = q.x - p.x, dy = q.y - p.y;
        let d = Math.hypot(dx, dy);
        if (d >= GAP * 1.6) continue;
        if (d < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
        const k = 0.5 * (GAP * 1.6 - d) / d;
        const a = push.get(others[i].id), b = push.get(others[j].id);
        a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k;
      }
    }
    // Move, then put each dot back on its own ring: only the angle is free.
    for (const n of others) {
      const p = pos.get(n.id), f = push.get(n.id);
      const x = p.x + f.x * cool, y = p.y + f.y * cool;
      const a = Math.atan2(y - cy, x - cx);
      p.x = cx + p.r * Math.cos(a);
      p.y = cy + p.r * Math.sin(a);
    }
  }
  spread(nearOrder.map((n) => pos.get(n.id)), cx, cy);
  spread(others.map((n) => pos.get(n.id)), cx, cy);
  return { pos, cx, cy, R, rc, rA, rO, rings };
}

/** How far apart two dots' centres must end up: a ringed dot is 9px across its
 *  ring, so this leaves each its own ring and a sliver of room to aim at. */
export const MIN_APART = 22;

/**
 * THE LAST PASS: no two dots on top of each other. Links can pull dots that
 * share a ring to the same spot, stronger than the push apart — six ready dots
 * ended as one overlapping clump beside the core on the owner's map
 * (2026-09-28). Each pair still too close is eased apart along its own ring,
 * so a dot keeps its distance from the middle (its closeness) and only its
 * angle moves. The passes are bounded: a ring with more dots than it has room
 * for at this spacing ends crowded rather than looping.
 */
function spread(pts, cx, cy) {
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const p = pts[i], q = pts[j];
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d >= MIN_APART - 0.01 || p.r < 1 || q.r < 1) continue;
        const ap = Math.atan2(p.y - cy, p.x - cx), aq = Math.atan2(q.y - cy, q.x - cx);
        // Which way round each goes: q ahead of p, or (on a tie) the later dot ahead.
        let diff = aq - ap;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        const dir = diff > 1e-9 ? 1 : diff < -1e-9 ? -1 : 1;
        const half = (MIN_APART - d) / 2 + 0.05;
        const np = ap - dir * half / p.r, nq = aq + dir * half / q.r;
        p.x = cx + p.r * Math.cos(np); p.y = cy + p.r * Math.sin(np);
        q.x = cx + q.r * Math.cos(nq); q.y = cy + q.r * Math.sin(nq);
        moved = true;
      }
    }
    if (!moved) return;
  }
}

/** A dot's drawn radius, and how far its mark reaches (its ring, when it wears one). */
export const dotRadius = (n) => (n.core ? 6.5 : 5.5);
export const markRadius = (n) => (n.core || isNear(n) ? dotRadius(n) + 3.5 : dotRadius(n));

/** A label box's height, and where its baseline sits in it. */
const BOX_H = LABEL_PX + 2;
const BASE = LABEL_PX * 0.84 + 1;
/** A second line's step down. */
const LINE_H = LABEL_PX + 1;

/** Overlap of two boxes, each grown by `pad`. */
const boxesMeet = (a, b, pad) => a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1;

/** Does a circle meet a box? */
function circleMeetsBox(x, y, r, b) {
  const dx = x - Math.max(b.x0, Math.min(x, b.x1)), dy = y - Math.max(b.y0, Math.min(y, b.y1));
  return dx * dx + dy * dy < r * r;
}

/** Distance from a point to a segment. */
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function segsCross(a, b) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const A = { x: a.x1, y: a.y1 }, B = { x: a.x2, y: a.y2 }, C = { x: b.x1, y: b.y1 }, D = { x: b.x2, y: b.y2 };
  return o(A, B, C) !== o(A, B, D) && o(C, D, A) !== o(C, D, B);
}

function segMeetsBox(s, b, pad) {
  const g = { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad, y1: b.y1 + pad };
  const inside = (x, y) => x > g.x0 && x < g.x1 && y > g.y0 && y < g.y1;
  if (inside(s.x1, s.y1) || inside(s.x2, s.y2)) return true;
  const edges = [
    { x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y0 }, { x1: g.x1, y1: g.y0, x2: g.x1, y2: g.y1 },
    { x1: g.x1, y1: g.y1, x2: g.x0, y2: g.y1 }, { x1: g.x0, y1: g.y1, x2: g.x0, y2: g.y0 },
  ];
  return edges.some((e) => segsCross(s, e));
}

/** Which dots get a name, most important first: the core by how firmly held, then ready, then one return away. */
export function labelOrder(map) {
  const rank = (n) => (n.core ? 0 : n.ready === true ? 1 : 2);
  return map.nodes.filter((n) => n.core || isNear(n))
    .sort((a, b) => rank(a) - rank(b) || (b.strength || 0) - (a.strength || 0) || (a.id < b.id ? -1 : 1));
}

/**
 * THE NAMES: a short title beside each core and almost-there dot, placed so
 * no name overlaps another, a dot or a ring's name, and none leaves the box.
 * Greedy, most important first; each tries spots round its dot, nearest
 * first, a thin leader line joining a name set further out. One that finds no
 * room is counted in `hidden` (the "+N more"), never drawn on top. Pure.
 */
export function placeLabels(map, L, w, h) {
  const dots = map.nodes.map((n) => ({ id: n.id, x: L.pos.get(n.id).x, y: L.pos.get(n.id).y, body: dotRadius(n), mark: markRadius(n), ringed: n.core || isNear(n) }));
  const taken = L.rings.map((r) => r.box);
  const leads = [];
  const labels = [];
  const hidden = [];
  const DIRS = 72;
  const DISTS = [13, 18, 24, 30];
  for (let d = 38; d <= 360; d += 9) DISTS.push(d);
  for (const n of labelOrder(map)) {
    const p = L.pos.get(n.id);
    const text = n.confidential ? "withheld" : shortTitle(n.text);
    // Its two forms: one line, or two short ones (a phone has only the second).
    const two = wrapTitle(text, 15);
    const forms = (w < NARROW ? [two] : two.length > 1 ? [[text], two] : [[text]]).map((lines) => ({
      lines,
      tw: Math.max(...lines.map((t) => textWidth(t, LABEL_PX))),
      th: BOX_H + (lines.length - 1) * LINE_H,
    }));
    const d0 = Math.hypot(p.x - L.cx, p.y - L.cy);
    const home = d0 < 1 ? -Math.PI / 2 + seedOf(n.id) * TAU : Math.atan2(p.y - L.cy, p.x - L.cx);
    const cands = [];
    for (let k = 0; k < DIRS; k++) {
      const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (TAU / DIRS);
      const a = home + off;
      for (const dist of DISTS) {
        const ux = Math.cos(a), uy = Math.sin(a);
        cands.push({ qx: p.x + ux * dist, qy: p.y + uy * dist, ux, uy, dist, cost: dist + Math.abs(off) * 22 });
      }
    }
    // And a column just outside the rings on each side, at any height: a
    // name out there needs only a clear line to it.
    for (const side of [-1, 1]) {
      const qx = L.cx + side * (L.R + 14);
      for (let qy = 4; qy <= h - 4; qy += 5) {
        const dist = Math.hypot(qx - p.x, qy - p.y);
        cands.push({ qx, qy, ux: side, uy: 0, dist, cost: dist + 30 + (Math.sign(p.x - L.cx) === side ? 0 : 60) });
      }
    }
    cands.sort((x, y) => x.cost - y.cost || x.qy - y.qy || x.qx - y.qx);

    /** The name in form `f` at spot `c`, or null where it would meet something. */
    const at = (c, f, loose) => {
      const { ux, uy, qx, qy } = c;
      const anchor = ux > 0.3 ? "start" : ux < -0.3 ? "end" : "middle";
      const x0 = anchor === "start" ? qx : anchor === "end" ? qx - f.tw : qx - f.tw / 2;
      const y0 = uy > 0.45 ? qy : uy < -0.45 ? qy - f.th : qy - f.th / 2;
      const box = { x0, x1: x0 + f.tw, y0, y1: y0 + f.th };
      if (box.x0 < 2 || box.x1 > w - 2 || box.y0 < 2 || box.y1 > h - 2) return null;
      if (taken.some((b) => boxesMeet(box, b, 3))) return null;
      if (dots.some((d) => circleMeetsBox(d.x, d.y, d.mark + 2, box))) return null;
      if (leads.some((s) => segMeetsBox(s, box, 1.5))) return null;
      let lead = null;
      if (c.dist > 16) {
        // From the dot's edge to the near side of the name, clear of every
        // dot's middle and every name.
        const tx = anchor === "start" ? box.x0 - 2 : anchor === "end" ? box.x1 + 2 : qx;
        const ty = anchor === "middle" ? (uy > 0 ? box.y0 - 1 : box.y1 + 1) : (box.y0 + box.y1) / 2;
        const len = Math.hypot(tx - p.x, ty - p.y) || 1;
        const edge = markRadius(n) + 1;
        lead = { x1: p.x + (tx - p.x) / len * edge, y1: p.y + (ty - p.y) / len * edge, x2: tx, y2: ty };
        if (dots.some((d) => d.id !== n.id && segDist(d.x, d.y, lead.x1, lead.y1, lead.x2, lead.y2) < (d.ringed ? d.body + 0.5 : d.body * 0.6))) return null;
        if (taken.some((b) => segMeetsBox(lead, b, 1))) return null;
        if (!loose && leads.some((s) => segsCross(s, lead))) return null;
      }
      return { id: n.id, text, lines: f.lines, anchor, x: anchor === "start" ? box.x0 : anchor === "end" ? box.x1 : (box.x0 + box.x1) / 2, y: box.y0 + BASE, box, lead };
    };

    let placed = null;
    // A core memory gets a second, looser try: its line may cross another
    // name's line rather than leave who I am unnamed.
    for (const loose of n.core ? [false, true] : [false]) {
      for (const c of cands) {
        for (const f of forms) if (placed === null) placed = at(c, f, loose);
        if (placed !== null) break;
      }
      if (placed !== null) break;
    }
    if (placed === null) { hidden.push(n.id); continue; }
    labels.push(placed);
    taken.push(placed.box);
    if (placed.lead !== null) leads.push(placed.lead);
  }
  return { labels, hidden };
}

/** A dot's brightness from how firmly it is held, 0..1 → an opacity the dimmest can still be seen at. */
export const brightness = (s) => 0.22 + 0.78 * Math.max(0, Math.min(1, Number(s) || 0));

/** What a dot says on hover, in the rings' words. Pure. */
export function nodeWords(n) {
  const where = n.core ? RING_WORDS.core
    : n.ready ? RING_WORDS.near + ": it joins who I am at the next check"
    : n.oneReturnAway ? RING_WORDS.near + ": one more return and it can join"
    : RING_WORDS.about;
  return where + " · held " + Math.round(Math.max(0, Math.min(1, n.strength)) * 100) + "%";
}

const f1 = (x) => x.toFixed(1);

/**
 * The whole drawing for a box `w` wide, as markup: the picture, its caption,
 * the "+N more" when names ran out of room, and (the Self tab's, `opts.count`
 * not false) how many memories and links it holds. Pure.
 */
export function markup(map, w, opts = {}) {
  const h = heightFor(w);
  const L = layout(map, w, h);
  const { labels, hidden } = placeLabels(map, L, w, h);
  const named = new Map(labels.map((l) => [l.id, l]));

  const ringNames = L.rings.map((r) =>
    '<text class="sm-ring-w sm-ring-w-' + r.key + '" x="' + f1(r.x) + '" y="' + f1(r.y) + '">' + esc(r.text) + "</text>").join("");
  const rings =
    '<circle class="sm-ring sm-ring-about" cx="' + L.cx + '" cy="' + f1(L.cy) + '" r="' + f1(L.R) + '"/>' +
    '<circle class="sm-ring sm-ring-near" cx="' + L.cx + '" cy="' + f1(L.cy) + '" r="' + f1(L.rA) + '"/>' +
    '<circle class="sm-core' + (map.nodes.some((n) => n.core) ? "" : " empty") + '" cx="' + L.cx + '" cy="' + f1(L.cy) + '" r="' + f1(L.rc) + '"/>';
  const lines = map.links.map((l) => {
    const p = L.pos.get(l.a), q = L.pos.get(l.b);
    if (!p || !q) return "";
    return '<line class="sm-link" data-a="' + esc(l.a) + '" data-b="' + esc(l.b) + '" x1="' + f1(p.x) + '" y1="' + f1(p.y) +
      '" x2="' + f1(q.x) + '" y2="' + f1(q.y) + '"/>';
  }).join("");
  const dots = map.nodes.map((n) => {
    const p = L.pos.get(n.id);
    const r = dotRadius(n);
    const near = isNear(n);
    const ring = n.core ? '<circle class="sm-ring-core" r="' + (r + 3.5) + '"/>'
      : n.ready ? '<circle class="sm-ring-ready" r="' + (r + 3.5) + '"/>'
      : n.oneReturnAway ? '<circle class="sm-ring-one" r="' + (r + 3.5) + '"/>' : "";
    // Unnamed dots are fainter: the named ones are the answer.
    const o = brightness(n.strength) * (n.core || near ? 1 : 0.5);
    const lab = named.get(n.id);
    const words = lab === undefined ? "" :
      (lab.lead === null ? "" : '<line class="sm-lead" x1="' + f1(lab.lead.x1 - p.x) + '" y1="' + f1(lab.lead.y1 - p.y) +
        '" x2="' + f1(lab.lead.x2 - p.x) + '" y2="' + f1(lab.lead.y2 - p.y) + '"/>') +
      '<text class="sm-label' + (n.core ? " core" : "") + '" x="' + f1(lab.x - p.x) + '" y="' + f1(lab.y - p.y) + '" text-anchor="' + lab.anchor + '">' +
        (lab.lines.length === 1 ? esc(lab.text) : lab.lines.map((t, i) =>
          '<tspan x="' + f1(lab.x - p.x) + '"' + (i === 0 ? "" : ' dy="' + LINE_H + '"') + ">" + esc(t) + "</tspan>").join("")) + "</text>";
    const label = (n.confidential ? "withheld" : headline(n.text)) + " — " + nodeWords(n);
    return '<g class="sm-node ' + (n.core ? "core" : near ? "near" : "plain") + (lab ? " named" : "") + '" data-id="' + esc(n.id) +
      '" transform="translate(' + f1(p.x) + " " + f1(p.y) + ')" tabindex="0" role="button" aria-label="' + esc(label) + '">' +
      '<circle class="sm-hit" r="12"/>' + ring +
      '<circle class="sm-dot" r="' + r + '" style="fill-opacity:' + o.toFixed(2) + '"/>' + words + "</g>";
  }).join("");

  const empty = map.nodes.length === 0
    ? '<p class="sm-empty"><b>(none yet)</b> nothing about me or about us is remembered yet; when it is, it shows here, around the middle.</p>'
    : "";
  const caption = map.nodes.length === 0 ? "" : '<p class="sm-cap">' + esc(CAPTION) + "</p>";
  const more = hidden.length === 0 ? "" :
    '<p class="sm-more">+' + hidden.length + " more not named here, for room. Hover or tap a dot to read it.</p>";
  const count = map.nodes.length === 0 || opts.count === false ? "" :
    '<p class="sm-count">' + map.nodes.length + (map.nodes.length === 1 ? " memory" : " memories") + " about me or about us" +
      (map.more > 0 ? " (the closest " + map.nodes.length + " of " + map.total + ")" : "") +
      " · " + map.links.length + (map.links.length === 1 ? " link" : " links") + " between them</p>";

  const html =
    '<svg class="sm-svg" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" role="group" aria-label="The self map: memories about me and us, who I am in the middle">' +
      rings + ringNames + '<g class="sm-links">' + lines + "</g>" + dots +
    "</svg>" + empty + caption + more + count;
  return { html, h, labels, hidden };
}

/** Every box a map is drawn in (the Self tab's, the home tab's), with what it
 *  last drew: `{ map, opts, width }`. */
const boxes = new Map();

/**
 * Draw the map into `el`. `opts.count`: false leaves out the line of how many
 * memories and links it holds (the home tab's).
 */
export function paint(el, map, opts = {}) {
  // A repaint writes a new slot; the old one left the page with its markup.
  for (const old of boxes.keys()) if (!old.isConnected) boxes.delete(old);
  boxes.set(el, { map, opts, width: 0 });
  draw(el);
}

/** Redraw at a new width; nothing to do where the width did not change, or
 *  in a hidden tab (no width to fit) — its tab's `show` redraws it. */
export function resize() {
  for (const [el, at] of boxes) {
    if (!el.isConnected) { boxes.delete(el); continue; }
    const w = Math.round(el.clientWidth);
    if (w > 0 && w !== at.width) draw(el);
  }
}

function draw(box) {
  const at = boxes.get(box);
  if (!at) return;
  const map = at.map;
  const w = Math.max(260, Math.round(box.clientWidth || 480));
  at.width = Math.round(box.clientWidth);
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  box.innerHTML = markup(map, w, at.opts).html;

  // Which dots each dot is linked to.
  const nbrs = new Map();
  for (const l of map.links) {
    if (!byId.has(l.a) || !byId.has(l.b)) continue;
    if (!nbrs.has(l.a)) nbrs.set(l.a, new Set());
    if (!nbrs.has(l.b)) nbrs.set(l.b, new Set());
    nbrs.get(l.a).add(l.b);
    nbrs.get(l.b).add(l.a);
  }
  const svg = box.querySelector("svg");
  let current = null;
  // Show only one dot's links, and light the dots at their other ends.
  const lit = (id) => {
    current = id;
    const near = id === null ? new Set() : nbrs.get(id) ?? new Set();
    svg.classList.toggle("focus", id !== null);
    svg.querySelectorAll(".sm-link").forEach((ln) => ln.classList.toggle("on", id !== null && (ln.dataset.a === id || ln.dataset.b === id)));
    svg.querySelectorAll(".sm-node").forEach((g) => {
      g.classList.toggle("on", g.dataset.id === id);
      g.classList.toggle("linked", near.has(g.dataset.id));
    });
  };
  svg.querySelectorAll(".sm-node").forEach((g) => {
    const n = byId.get(g.dataset.id);
    const words = '<b>' + (n.confidential ? '<span class="withheld">withheld</span>' : esc(headline(n.text))) + "</b>" +
      '<div class="dimline">' + esc(nodeWords(n)) + "</div>";
    const dot = g.querySelector(".sm-dot");
    const tipAtDot = (extra) => {
      const r = dot.getBoundingClientRect();
      showTip(r.left + r.width / 2, r.top, words + (extra || ""));
    };
    let touch = false, wasLit = false;
    g.addEventListener("pointerdown", (e) => { touch = e.pointerType === "touch" || e.pointerType === "pen"; wasLit = current === n.id; });
    g.addEventListener("mouseenter", (e) => { lit(n.id); showTip(e.clientX, e.clientY, words); });
    g.addEventListener("mousemove", (e) => { if (!touch) showTip(e.clientX, e.clientY, words); });
    g.addEventListener("mouseleave", () => { if (!touch) { lit(null); hideTip(); } });
    g.addEventListener("focus", () => { lit(n.id); tipAtDot(); });
    g.addEventListener("blur", () => { lit(null); hideTip(); });
    const open = () => { hideTip(); if (typeof window.openMemory === "function") window.openMemory(n.id); };
    g.addEventListener("click", () => {
      // A touch screen has no hover: the first tap shows the links and the words.
      if (touch && !wasLit) { lit(n.id); tipAtDot('<div class="dimline">tap again to open it</div>'); wasLit = true; return; }
      open();
    });
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}
