/* The brain on the home tab, and what lights it (round 4, 2026-09-28). The
   picture is `../brain.js`; this is its data. `/api/mechanisms` gives every
   mechanism's light: a region glows steadily while one of its mechanisms is
   working, and flares when the page sees one of them fire (a newest backing
   row it had not seen). The first paint flares each working region once.

   The brain no longer drives a panel here: clicking a region opens the Health
   tab's "How the memory works" with that region's first mechanism picked.

   THE PICTURE IS OPTIONAL (2026-10-14). It is the one thing on the dashboard
   drawn with three.js, and the plugin directory's bundle carries neither the
   library nor `../brain.js`. The server says which in the page
   (`<meta name="counterparts-brain" content="off">`, `server.ts#BRAIN_LIBRARY`):
   off, the box is not drawn, "Today" takes the row, and nothing asks for the
   lights. On, the picture's module is loaded here rather than imported, so a
   missing file could never take the whole home tab's modules down with it. */
import { MECHANISMS } from "../../../mechanisms/index.js";
import { REGIONS, regionOf } from "../../../mechanisms/regions.js";
import { api } from "../../../shared/api.js";
import { $ } from "../../../shared/dom.js";
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
let lastView = null; // the lights last painted, for a picture that loads after them

/** Does the server serve the picture's files? Absent tag: an older server, which always did. */
export function pictureServed(doc = document) {
  const tag = doc.querySelector('meta[name="counterparts-brain"]');
  return tag === null || tag.getAttribute("content") !== "off";
}

/** Build the brain once; a failure to start is a calm sentence in its place. */
export function mount() {
  const wrap = $("home-brain");
  if (!pictureServed()) {
    wrap.hidden = true;
    wrap.parentElement.classList.add("is-solo");
    wrap.dataset.ready = "1";
    return;
  }
  const calm = () => {
    wrap.classList.add("is-nogl");
    wrap.innerHTML = '<div class="brain-off"><p>The brain picture could not start in this browser.</p>' +
      "<p>Everything it shows is on the Health tab, under how the memory works.</p></div>";
    wrap.dataset.ready = "1";
  };
  import("../brain.js").then(({ mountBrain }) => {
    brain = mountBrain(wrap, (key) => {
      const to = routeOf(key);
      if (to !== null) go(to);
    }, (key) => shortOf[mechanismOf(key)] || key);
    // The lights may have come first: paint them again, first-paint flares and all.
    if (lastView !== null) {
      lastSeen = null;
      paint(lastView);
    }
  }).catch(calm);
}

function paint(view) {
  lastView = view;
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
  if (!pictureServed()) return;
  let view;
  try { view = await api("/api/mechanisms"); } catch (e) { return; }
  paint(view);
}
