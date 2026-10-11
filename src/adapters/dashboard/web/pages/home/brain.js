/* The home page's brain: the site's hologram (counterparts-site
   features/home-v2/components/Brain.tsx — the same point cloud, shader and
   deterministic seed, first drawn for this dashboard's old /brain page), with
   its regions mapped BY MECHANISM (mechanisms/regions.js).

   What it shows is this store's, not a demo's: a region glows steadily while
   one of its mechanisms is working (green on /api/mechanisms), and flares, with
   a signal travelling into it, when the page sees that mechanism fire. Nothing
   is invented: no ambient arcs, no pretend activity.

   Drag to rotate; click (or tap) a region's point to open its mechanism on the
   Health tab (home round 4, 2026-09-28: the brain no longer drives a panel on
   Home). A point's name shows only while it is hovered or focused. three.js is
   vendored (shared/vendor/, MIT) and served from this origin — nothing leaves
   the machine. Without WebGL the picture is replaced by a calm sentence; the
   Health tab's mechanisms reach everything it does. */
import * as THREE from "../../shared/vendor/three.module.min.js";
import { REGIONS } from "../../mechanisms/regions.js";

const N = REGIONS.length;

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**

 * Mount the brain into `wrap`. Returns a controller:
 *   levels({ key: 0..1 })    — each region's steady glow (its mechanisms' lights)
 *   pulse(key)               — one real firing: a flare and a signal into the region
 * `onPick(key)` is called when a region is clicked on the brain; `nameOf(key)`
 * is the words its point shows on hover.
 */
export function mountBrain(wrap, onPick, nameOf = (key) => key) {
  const noop = { levels() {}, pulse() {}, live: false };
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  wrap.innerHTML =
    '<canvas class="brain-canvas" aria-hidden="true"></canvas>' +
    REGIONS.map((r) => r.active
      ? '<button type="button" class="brain-pin" data-key="' + r.key + '" aria-label="' + esc(r.name + ": " + nameOf(r.key)) + '">' +
        '<span class="brain-pin-dot" aria-hidden="true"></span><span class="brain-pin-name" aria-hidden="true">' + esc(nameOf(r.key)) + "</span></button>"
      : "").join("") +
    '<p class="brain-hint" aria-hidden="true"><span class="hint-mouse">drag to rotate · click a point</span><span class="hint-touch">swipe sideways to rotate · tap a point</span></p>' +
    '<div class="brain-off" hidden><p>The brain picture needs WebGL, which this browser has switched off.</p><p>Everything it shows is on the Health tab, under how the memory works.</p></div>';
  const canvas = wrap.querySelector(".brain-canvas");
  const pins = [...wrap.querySelectorAll(".brain-pin")];
  const pinOf = (key) => pins.find((p) => p.dataset.key === key);
  for (const pin of pins) pin.addEventListener("click", () => onPick(pin.dataset.key));

  const calm = () => {
    wrap.classList.add("is-nogl");
    wrap.querySelector(".brain-off").hidden = false;
    wrap.dataset.ready = "1";
    return noop;
  };
  if (!webglAvailable()) return calm();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return calm();
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  camera.position.set(0, 0.18, 3.0);
  const group = new THREE.Group();
  group.position.y = 0.08;
  scene.add(group);

  // A deterministic generator: the brain looks the same every time it is drawn.
  const rand = (() => { let s = 20260904; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  const RID = Object.fromEntries(REGIONS.map((r, i) => [r.key, i]));
  const pts = [], cols = [], regs = [];
  const push = (p, region, dim = 1) => {
    pts.push(p[0], p[1], p[2]);
    const c = REGIONS[region].col;
    cols.push(c[0] * dim, c[1] * dim, c[2] * dim);
    regs.push(region);
  };
  const dir = () => {
    const u = rand() * 2 - 1, ph = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    return [r * Math.cos(ph), u, r * Math.sin(ph)];
  };
  const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

  // cerebrum: a wrinkled shell split by the longitudinal fissure, narrower at the
  // front, temporal lobes hanging low, the lateral fissure creasing above them
  for (let i = 0; i < 11000; i++) {
    const d = dir();
    const th = Math.atan2(d[2], d[0]), ph = Math.asin(d[1]);
    let r = 1 + 0.05 * Math.sin(th * 7 + 3 * Math.sin(ph * 4)) + 0.03 * Math.sin(th * 13 + ph * 9) + 0.018 * Math.sin(th * 23) * Math.sin(ph * 17);
    r *= 0.985 + 0.05 * rand();
    const [dx, dy, dz] = d;
    let z = dz * r * (dz < 0 ? 1.34 : 1.24);
    let x = dx * r * (1.0 - 0.1 * dz - 0.06 * dz * dz);
    let y;
    if (dy >= 0) {
      y = dy * r * 0.84 * (1 - 0.16 * Math.max(0, -dz) ** 2) * (1 - 0.06 * Math.max(0, dz) ** 2);
    } else {
      y = dy * r * 0.5 * (1 - 0.35 * smooth(0.45, 0.85, dz));
      const band = smooth(-0.55, -0.15, dz) * (1 - smooth(0.35, 0.7, dz));
      const hang = smooth(0.35, 0.75, Math.abs(dx)) * band * Math.min(1, -dy * 1.6);
      y -= 0.34 * hang;
      x *= 1 - 0.14 * hang;
    }
    const fissureY = -0.2 + (0.62 - z) * 0.3;
    if (Math.abs(x) > 0.55 && z < 0.62 && z > -0.45 && Math.abs(y - fissureY) < 0.028) continue;
    if (Math.abs(x) < 0.035 && y > -0.1) continue;
    x += Math.sign(x) * 0.03;
    if (y < -0.24 && z < -0.5) continue;
    push([x, y, z], z > 0.78 ? RID.prefrontal : RID.cortex, 0.75 + 0.25 * rand());
  }
  for (let i = 0; i < 2300; i++) { // cerebellum
    const d = dir();
    let r = 1 + 0.06 * Math.sin(Math.asin(d[1]) * 22);
    r *= 0.97 + 0.06 * rand();
    push([d[0] * r * 0.5, -0.58 + d[1] * r * 0.3, -0.82 + d[2] * r * 0.42], RID.cerebellum, 0.7 + 0.3 * rand());
  }
  for (let i = 0; i < 700; i++) { // brainstem
    const t = rand(), a = rand() * Math.PI * 2, rr = (0.17 - 0.06 * t) * Math.sqrt(rand());
    push([Math.cos(a) * rr, -0.4 - 0.75 * t, -0.2 - 0.3 * t + Math.sin(a) * rr], RID.brainstem, 0.6 + 0.3 * rand());
  }
  for (const s of [-1, 1]) for (let i = 0; i < 430; i++) { // thalamus
    const d = dir();
    push([s * 0.15 + d[0] * 0.13, -0.02 + d[1] * 0.11, 0.02 + d[2] * 0.16], RID.thalamus, 0.45 + 0.25 * rand());
  }
  for (const s of [-1, 1]) for (let i = 0; i < 540; i++) { // hippocampus
    const t = rand(), a = rand() * Math.PI * 2, rr = 0.055 * Math.sqrt(rand());
    const cx = s * (0.3 + 0.12 * Math.sin(Math.PI * t)), cy = -0.2 - 0.26 * t * (1 - 0.35 * t), cz = -0.38 + 0.78 * t;
    push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, cz + Math.sin(a + 1) * rr], RID.hippocampus, 0.75 + 0.25 * rand());
  }
  for (const s of [-1, 1]) for (let i = 0; i < 240; i++) { // amygdala
    const d = dir();
    push([s * 0.42 + d[0] * 0.085, -0.42 + d[1] * 0.075, 0.42 + d[2] * 0.085], RID.amygdala, 0.75 + 0.25 * rand());
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute("aColor", new THREE.Float32BufferAttribute(cols, 3));
  geo.setAttribute("aRegion", new THREE.Float32BufferAttribute(regs, 1));
  const regionVerts = REGIONS.map(() => []);
  for (let i = 0; i < regs.length; i++) regionVerts[regs[i]].push(i);
  const vAt = (i) => new THREE.Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  const randVert = (r) => vAt(regionVerts[r][Math.floor(rand() * regionVerts[r].length)]);

  const uniforms = {
    uTime: { value: 0 },
    uGlow: { value: new Array(N).fill(0) },
    uLevel: { value: new Array(N).fill(0) },
    uPx: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aColor;attribute float aRegion;
      uniform float uTime;uniform float uGlow[${N}];uniform float uLevel[${N}];uniform float uPx;
      varying vec3 vC;varying float vA;
      void main(){
        int r=int(aRegion+0.5);
        float glow=uGlow[r];
        float level=uLevel[r];
        float tw=0.82+0.18*sin(uTime*2.1+position.x*37.0+position.y*53.0+position.z*41.0);
        vC=aColor*(0.7+0.45*level+1.35*glow)*tw;
        vA=0.66+0.22*level+0.30*glow;
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=uPx*(2.6+0.6*level+2.2*glow)*(3.0/-mv.z);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: `varying vec3 vC;varying float vA;
      void main(){
        vec2 d=gl_PointCoord-vec2(0.5);
        float a=smoothstep(0.5,0.08,length(d));
        gl_FragColor=vec4(vC,a*vA);
      }`,
  });
  group.add(new THREE.Points(geo, mat));
  for (const [r, op] of [[1.45, 0.16], [1.15, 0.08], [1.75, 0.05]]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 0.012, 90),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: op, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.45;
    scene.add(ring);
  }

  // ── a signal travelling into a region that just fired ─────────────────────
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.25, "rgba(255,255,255,.6)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const arcs = [];
  function spawnArc(fromR, toR) {
    if (fromR === toR || reduced) return;
    const p0 = randVert(fromR), p2 = randVert(toR);
    const mid = p0.clone().add(p2).multiplyScalar(0.5).multiplyScalar(1.55 + 0.35 * rand());
    const c = REGIONS[toR].col;
    const color = new THREE.Color(c[0], c[1], c[2]);
    const n = 42, arr = new Float32Array(n * 3);
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
    curve.getPoints(n - 1).forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    g2.setDrawRange(0, 0);
    const line = new THREE.Line(g2, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    head.scale.setScalar(0.15);
    group.add(line); group.add(head);
    arcs.push({ line, head, curve, born: performance.now(), dur: 1500, n });
  }
  function stepArcs(now) {
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i], t = (now - a.born) / a.dur;
      if (t >= 1.25) {
        group.remove(a.line); group.remove(a.head);
        a.line.geometry.dispose(); a.line.material.dispose(); a.head.material.dispose();
        arcs.splice(i, 1);
        continue;
      }
      const tt = Math.min(t, 1), headI = Math.floor(tt * (a.n - 1)), tail = Math.max(0, headI - 14);
      a.line.geometry.setDrawRange(tail, Math.max(1, headI - tail));
      const fade = t < 1 ? 1 : 1 - (t - 1) / 0.25;
      a.line.material.opacity = 0.55 * fade;
      a.head.material.opacity = fade;
      a.head.position.copy(a.curve.getPoint(tt));
    }
  }

  const glowTarget = new Array(N).fill(0);
  const levelTarget = new Array(N).fill(0);
  let lastPulsed = RID.thalamus;

  // ── interaction: drag to rotate; a click without a drag picks a region ─────
  let dragging = false, moved = 0, px = 0, py = 0, rotY = 0.9, rotX = 0.12, autoPause = 0;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; px = e.clientX; py = e.clientY; canvas.classList.add("is-drag"); });
  addEventListener("pointerup", (e) => {
    if (dragging && moved < 5 && e.target === canvas) pickAt(e.clientX, e.clientY);
    dragging = false;
    canvas.classList.remove("is-drag");
  });
  addEventListener("pointermove", (e) => {
    if (!dragging) return;
    moved += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
    rotY += (e.clientX - px) * 0.005;
    rotX = Math.max(-0.9, Math.min(0.9, rotX + (e.clientY - py) * 0.004));
    px = e.clientX; py = e.clientY;
    autoPause = performance.now() + 3000;
    wake();
  });

  const screen = REGIONS.map(() => ({ x: 0, y: 0, depth: 0 }));
  const v = new THREE.Vector3();
  function project() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    group.updateMatrixWorld();
    REGIONS.forEach((r, i) => {
      v.set(r.anchor[0], r.anchor[1], r.anchor[2]).applyMatrix4(group.matrixWorld);
      const depth = v.distanceTo(camera.position);
      v.project(camera);
      screen[i] = { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, depth };
    });
  }
  function pickAt(cx, cy) {
    const rect = wrap.getBoundingClientRect();
    let best = -1, bestD = 90;
    screen.forEach((s, i) => {
      if (!REGIONS[i].active) return;
      const d = Math.hypot(s.x - (cx - rect.left), s.y - (cy - rect.top));
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) onPick(REGIONS[best].key);
  }

  const HALF_X = 1.25, HALF_Y = 1.1;
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    // A hidden tab lays out at zero: framing it would divide by zero.
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan((camera.fov * Math.PI) / 180 / 2);
    camera.position.z = Math.max(2.4, Math.min(7, Math.max((HALF_Y * 1.05) / t, (HALF_X * 1.05) / (t * (w / h)))));
    camera.updateProjectionMatrix();
    uniforms.uPx.value = Math.min(devicePixelRatio, 2) * Math.min(1.4, w / 700);
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  // Draw only while the brain is on screen: a hidden tab or a scrolled-past
  // hero costs nothing.
  let visible = true, raf = 0;
  function wake() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); }
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) { resize(); wake(); }
  }).observe(wrap);
  document.addEventListener("visibilitychange", wake);

  function frame(now) {
    raf = 0;
    uniforms.uTime.value = now / 1000;
    if (!reduced && now > autoPause) rotY += 0.0016;
    group.rotation.y = rotY;
    group.rotation.x = rotX;
    for (let i = 0; i < N; i++) {
      uniforms.uGlow.value[i] += (glowTarget[i] - uniforms.uGlow.value[i]) * 0.14;
      glowTarget[i] *= 0.965;
      uniforms.uLevel.value[i] += (levelTarget[i] - uniforms.uLevel.value[i]) * 0.08;
    }
    stepArcs(now);
    renderer.render(scene, camera);
    project();
    const depths = screen.map((s) => s.depth), lo = Math.min(...depths), hi = Math.max(...depths);
    REGIONS.forEach((r, i) => {
      const pin = pinOf(r.key);
      if (!pin) return;
      const s = screen[i], near = hi > lo ? 1 - (s.depth - lo) / (hi - lo) : 1;
      const x = Math.min(s.x, wrap.clientWidth - pin.offsetWidth + 11);
      pin.style.transform = "translate(" + x.toFixed(1) + "px," + s.y.toFixed(1) + "px)";
      pin.style.opacity = String(0.55 + 0.45 * near);
      pin.style.zIndex = String(Math.round(near * 10) + 1);
    });
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  wake();
  wrap.dataset.ready = "1";

  return {
    live: true,
    levels(byKey) {
      REGIONS.forEach((r, i) => { levelTarget[i] = Math.max(0, Math.min(1, byKey[r.key] || 0)); });
      wake();
    },
    pulse(key) {
      const i = RID[key];
      if (i === undefined) return;
      glowTarget[i] = 1;
      spawnArc(lastPulsed, i);
      lastPulsed = i;
      wake();
    },
  };
}
