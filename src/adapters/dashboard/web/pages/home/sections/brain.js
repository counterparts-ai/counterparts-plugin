/* The brain on the home tab, and what lights it (round 4, 2026-09-28). The
   picture is `../brain.js`; this is its data. `/api/mechanisms` gives every
   mechanism's light: a region glows steadily while one of its mechanisms is
   working, and flares when the page sees one of them fire (a newest backing
   row it had not seen). The first paint flares each working region once.

   The brain no longer drives a panel here: clicking a region opens the Health
   tab's "How the memory works" with that region's first mechanism picked. */
import { MECHANISMS } from "../../../mechanisms/index.js";
import { REGIONS, regionOf } from "../../../mechanisms/regions.js";
import { api } from "../../../shared/api.js";
import { $ } from "../../../shared/dom.js";
import { mountBrain } from "../brain.js";
import { go } from "../go.js";

export const markup = `<div class="home-brain" id="home-brain"></div>`;

const shortOf = Object.fromEntries(MECHANISMS.map((m) => [m.id, m.short]));
const ORDER = MECHANISMS.map((m) => m.id);

/** The mechanism a click on a region opens: the region's first. */
export function mechanismOf(key) {
  const region = REGIONS.find((r) => r.key === key);
  return region && region.mechanisms.length > 0 ? region.mechanisms[0] : null;
}

/** Where a click on a region goes. */
export function routeOf(key) {
  const id = mechanismOf(key);
  return id === null ? null : "health/mechanisms?id=" + encodeURIComponent(id);
}

let brain = { levels() {}, pulse() {} };
let lastSeen = null; // id → newest backing seq, as of the previous paint

/** Build the brain once; a failure to start is a calm sentence in its place. */
export function mount() {
  const wrap = $("home-brain");
  try {
    brain = mountBrain(wrap, (key) => {
      const to = routeOf(key);
      if (to !== null) go(to);
    }, (key) => shortOf[mechanismOf(key)] || key);
  } catch (e) {
    wrap.classList.add("is-nogl");
    wrap.innerHTML = '<div class="brain-off"><p>The brain picture could not start in this browser.</p>' +
      "<p>Everything it shows is on the Health tab, under how the memory works.</p></div>";
    wrap.dataset.ready = "1";
  }
}

function paint(view) {
  const status = Object.fromEntries(view.mechanisms.map((l) => [l.id, l.status]));
  const levels = {};
  for (const r of REGIONS) {
    levels[r.key] = Math.max(0, ...r.mechanisms.map((id) => {
      const s = status[id];
      return s === "green" ? 1 : s === "waiting" ? 0.45 : s === "amber" ? 0.25 : 0;
    }));
  }
  brain.levels(levels);
  const newest = Object.fromEntries(view.mechanisms.map((l) => [l.id, l.events[0] ?? null]));
  if (lastSeen === null) {
    let k = 0;
    for (const r of REGIONS) {
      if (levels[r.key] === 1) setTimeout(() => brain.pulse(r.key), 400 + 450 * k++);
    }
  } else {
    for (const id of ORDER) {
      if (newest[id] !== null && newest[id] !== lastSeen[id]) {
        const r = regionOf(id);
        if (r) brain.pulse(r.key);
      }
    }
  }
  lastSeen = newest;
}

/** Read the lights (at boot, and whenever the store moves). */
export async function refresh() {
  let view;
  try { view = await api("/api/mechanisms"); } catch (e) { return; }
  paint(view);
}
