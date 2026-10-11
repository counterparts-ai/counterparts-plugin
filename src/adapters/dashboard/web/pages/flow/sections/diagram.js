/* The architecture diagram: fourteen nodes on a canvas (a list below ~900px),
   static edges, and particles that ride ONLY on real new events. */
import { FACE, clip, fit, roundRect, wrapText } from "../../../shared/canvas.js";
import { ACCENT, COL } from "../../../shared/colors.js";
import { $, esc } from "../../../shared/dom.js";
import { tabs } from "../../../shared/state.js";
import { flow } from "../state.js";

export const markup = `
    <div class="card" id="flowbox">
      <canvas id="flowcv" height="560"></canvas>
      <div id="flowlist" hidden></div>
    </div>`;

let flowBoxes = [];
/** Curves the last frame drew, so a particle rides the edge it belongs to. */
let edgePaths = {};
const particles = [];
const flashes = {};
let animating = false;
/** How many fading samples make the comet's tail. */
const TRAIL = 11;

/** A click on a box selects its node; `onSelect` is the detail panel's. */
export function mount(onSelect) {
  $("flowcv").addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const b of flowBoxes) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { onSelect(b.n.key); return; }
    }
  });
}

function nodeCentre(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }

/** Under ~900px of container the diagram is a list. Above it, a canvas. */
const FLOW_CANVAS_MIN = 900;

export function drawFlow() {
  if (!flow.data) return;
  const narrow = ($("flowbox").clientWidth || 0) < FLOW_CANVAS_MIN;
  $("flowcv").hidden = narrow;
  $("flowlist").hidden = !narrow;
  if (narrow) return renderFlowList();
  const cv = $("flowcv");
  const { ctx, w, h } = fit(cv);
  const M = 10;
  const boxes = {};
  flowBoxes = [];
  for (const n of flow.data.nodes) {
    const b = { x: M + n.x * (w - 2 * M), y: M + n.y * (h - 2 * M), w: n.w * (w - 2 * M), h: n.h * (h - 2 * M), n };
    boxes[n.key] = b;
    flowBoxes.push(b);
  }

  // Edges first, dim and static — only particles mean activity.
  //
  // Each edge is a quadratic from centre to centre, but only the part OUTSIDE
  // both boxes is drawn: a line that starts at a node's centre emerges from
  // under its own box, and a label placed at the geometric midpoint lands on
  // top of whatever box sits between the two. So the curve is sampled, clipped
  // to the first and last points in open space, and the label is placed on the
  // visible middle — or dropped when there is no room for it.
  const SAMPLES = 64;
  // Labels already placed this frame. An edge label that would land on another
  // one is dropped rather than overprinted: `at session startootnotes · one
  // loud` was two labels rendering as one string.
  const placed = [];
  const overlaps = (r, o) => r.x < o.x + o.w + 4 && r.x + r.w > o.x - 4 && r.y < o.y + o.h + 3 && r.y + r.h > o.y - 3;
  // Kept for the frame: a particle rides the same clipped curve the edge was
  // drawn along, rather than a second approximation of it.
  edgePaths = {};

  for (const e of flow.data.edges) {
    const a = boxes[e.from], z = boxes[e.to];
    if (!a || !z) continue;
    const p0 = nodeCentre(a), p1 = nodeCentre(z);
    const bow = e.bow || 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const mx = clamp((p0.x + p1.x) / 2 + bow * (p1.y - p0.y), M + 6, w - M - 6);
    const my = clamp((p0.y + p1.y) / 2 - bow * (p1.x - p0.x), M + 14, h - M - 6);
    const at = (t) => ({
      x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * mx + t * t * p1.x,
      y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * my + t * t * p1.y,
    });
    const inside = (pt, b, pad) =>
      pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad;

    let start = 0, end = 1;
    for (let i = 0; i <= SAMPLES; i++) { if (!inside(at(i / SAMPLES), a, 3)) { start = i / SAMPLES; break; } }
    for (let i = SAMPLES; i >= 0; i--) { if (!inside(at(i / SAMPLES), z, 3)) { end = i / SAMPLES; break; } }
    if (end <= start) continue;
    edgePaths[e.from + ">" + e.to] = { at, start, end };

    ctx.save();
    ctx.strokeStyle = e.dotted ? "rgba(255,215,64,.24)" : "rgba(0,229,255,.18)";
    ctx.lineWidth = 1;
    if (e.dotted) ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (let i = 0; i <= SAMPLES; i++) {
      const t = start + (end - start) * (i / SAMPLES);
      const pt = at(t);
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.restore();

    // arrowhead, on the clipped end
    const tip = at(end), back = at(Math.max(start, end - 0.05));
    const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
    ctx.fillStyle = e.dotted ? "rgba(255,215,64,.5)" : "rgba(0,229,255,.42)";
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(ang - 0.42) * 8, tip.y - Math.sin(ang - 0.42) * 8);
    ctx.lineTo(tip.x - Math.cos(ang + 0.42) * 8, tip.y - Math.sin(ang + 0.42) * 8);
    ctx.closePath();
    ctx.fill();

    if (e.label) {
      ctx.font = "10.5px " + FACE;
      const tw = ctx.measureText(e.label).width;
      // A label on top of a box says nothing and hides something. Try a few
      // places along the visible curve before giving up on it entirely.
      let at_ = null;
      for (const f of [0.5, 0.42, 0.58, 0.34, 0.66]) {
        const pt = at(start + (end - start) * f);
        const box = { x: pt.x - tw / 2 - 4, y: pt.y - 13, w: tw + 8, h: 14 };
        const clear =
          !flowBoxes.some((b) => overlaps(box, { x: b.x, y: b.y, w: b.w, h: b.h })) &&
          !placed.some((o) => overlaps(box, o));
        if (clear && box.x > M && box.x + box.w < w - M) { at_ = pt; placed.push(box); break; }
      }
      if (at_) {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(10,14,20,.92)";
        ctx.fillRect(at_.x - tw / 2 - 4, at_.y - 13, tw + 8, 14);
        ctx.fillStyle = "rgba(92,103,115,.95)";
        ctx.fillText(e.label, at_.x, at_.y - 3);
        ctx.textAlign = "left";
      }
    }
  }

  // nodes
  for (const b of flowBoxes) {
    const n = b.n;
    const col = ACCENT[n.accent] || COL.cyan;
    const glow = flashes[n.key] || 0;
    const on = flow.selected === n.key;
    ctx.fillStyle = "#0d1117";
    ctx.strokeStyle = on ? col : col + (n.silent ? "33" : "66");
    ctx.lineWidth = on ? 1.6 : 1;
    roundRect(ctx, b.x, b.y, b.w, b.h, 4);
    ctx.fill();
    if (glow > 0.02) {
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 34 * glow;
      ctx.lineWidth = 1 + 1.4 * glow;
      ctx.strokeStyle = col;
      ctx.stroke();
      ctx.stroke();
      ctx.restore();
    }
    ctx.stroke();

    ctx.fillStyle = n.silent && !on ? col + "aa" : col;
    ctx.font = "11.5px " + FACE;
    ctx.fillText(clip(ctx, n.label, b.w - 18), b.x + 9, b.y + 16);
    ctx.fillStyle = "#5c6773";
    ctx.font = "10.5px " + FACE;
    wrapText(ctx, n.sub, b.x + 9, b.y + 29, b.w - 16, 10, 2);
    ctx.fillStyle = n.silent ? "#39424d" : "#c5cdd8";
    ctx.font = "11px " + FACE;
    ctx.fillText(clip(ctx, n.state, b.w - 18), b.x + 9, b.y + b.h - 9);
  }

  // PARTICLES RIDE ONLY ON REAL NEW EVENTS — and they have to be seen to mean
  // anything. A 2.6px dot on a 1400px diagram was the entire payoff for "only
  // particles mean activity"; this is a comet with a trail, travelling the edge
  // into the node that recorded the event, ending in a flare on the box itself.
  for (const p of particles) {
    const path = edgePaths[p.key];
    const target = boxes[p.node];
    if (!target) continue;
    const point = (t) => {
      if (path) return path.at(path.start + (path.end - path.start) * Math.max(0, Math.min(1, t)));
      // No edge into this node on the diagram: orbit its own box instead.
      const c = nodeCentre(target);
      const a = p.spin + t * 4.4;
      return { x: c.x + Math.cos(a) * (target.w / 2 + 10), y: c.y + Math.sin(a) * (target.h / 2 + 10) };
    };
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = TRAIL; i >= 0; i--) {
      const t = p.t - i * 0.022;
      if (t < 0) continue;
      const q = point(t);
      const fade = 1 - i / (TRAIL + 1);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 1.2 + 3.4 * fade * fade, 0, Math.PI * 2);
      ctx.fillStyle = p.col;
      ctx.globalAlpha = 0.10 + 0.55 * fade * fade;
      ctx.fill();
    }
    // The head, with a halo, so one event is unmistakable at a glance.
    const head = point(p.t);
    ctx.globalAlpha = 1;
    ctx.shadowColor = p.col;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x, head.y, 7.5, 0, Math.PI * 2);
    ctx.fillStyle = p.col;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.restore();
  }
}

/**
 * The same fourteen nodes, in pipeline order, as a list. Every node keeps its
 * accent, its subtitle and its state line, and clicking one opens the same
 * mechanism panel the diagram opens — so nothing is lost on a phone except the
 * arrows, which are named in the chain markers between the rows.
 */
function renderFlowList() {
  const order = ["session","spans","sweep","remember","encode","store","physics","recall","associate","schemas","prospective","sleep","wake","self"];
  const byKey = {};
  for (const n of flow.data.nodes) byKey[n.key] = n;
  $("flowlist").innerHTML = order.map((key, i) => {
    const n = byKey[key];
    if (!n) return "";
    const col = ACCENT[n.accent] || COL.cyan;
    return (i === 0 ? "" : '<div class="fchain">↓</div>') +
      '<div class="fnode' + (n.silent ? " silent" : "") + (flow.selected === n.key ? " on" : "") +
        '" onclick="selectNode(\'' + n.key + '\')">' +
        '<span><span class="nm" style="color:' + col + '">' + esc(n.label) + "</span>" +
        '<span class="sb">' + esc(n.sub) + "</span></span>" +
        '<span class="st">' + esc(n.state) + "</span></div>";
  }).join("");
}

function animate() {
  if (particles.length === 0 && Object.values(flashes).every((v) => v < 0.02)) { animating = false; return; }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += 0.014;
    if (p.t < 0) continue;
    // The tail has to finish arriving after the head does.
    if (p.t > 1 + TRAIL * 0.022) particles.splice(i, 1);
  }
  for (const k of Object.keys(flashes)) flashes[k] *= 0.96;
  if (tabs.current === "flow") drawFlow();
  requestAnimationFrame(animate);
}
export function ignite(events) {
  for (const e of events) {
    if (!e.node) continue;
    flashes[e.node] = 1;
    // Ride an edge that ENDS at this node when the diagram has one — a signal
    // arriving is the thing being drawn. Otherwise ride one leaving it, and
    // otherwise orbit the box. A caller that KNOWS the path names it in `via`,
    // because "the first edge ending here" is not always the right one: the
    // first edge into ENCODE is the dotted crash-sweep fallback, so a deposit
    // through the authored door would otherwise be drawn arriving from a crash.
    const edge = e.via
      ? null
      : (flow.data && flow.data.edges.find((x) => x.to === e.node)) ||
        (flow.data && flow.data.edges.find((x) => x.from === e.node));
    particles.push({
      node: e.node,
      key: e.via || (edge ? edge.from + ">" + edge.to : ""),
      // A negative start staggers a signal that crosses several nodes, so three
      // particles read as one thing moving rather than three things blinking.
      t: -(e.delay || 0),
      spin: Math.random() * 6.28,
      col: e.tone === "amber" ? COL.amber : e.tone === "notable" ? COL.cyan : COL.teal,
    });
  }
  if (!animating) { animating = true; requestAnimationFrame(animate); }
}

/** How many comets are in flight. A harness that wants to photograph "only
 *  particles mean activity" has to know WHEN, and a fixed sleep either misses
 *  the animation or catches an empty frame. */
window.particleCount = () => particles.length;
