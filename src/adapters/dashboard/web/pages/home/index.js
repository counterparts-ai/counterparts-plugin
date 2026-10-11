/* The home tab (round 4, 2026-09-28 — a try, judged when seen): the best
   pictures from the other tabs, for someone who knows roughly what this is
   and none of the details. Clicking anything takes you to that thing on its
   own tab. Top to bottom:
     - one headline ("Day 7 with Mike · 306 memories · 13 new today") and a
       small health dot, linked to Health;
     - "Today", a few plain lines about memory, with the brain on its right (a
       region opens its mechanism on Health; Mike, 2026-09-28: the brain back
       on the right);
     - "How it feels" (the memories tab's radar) beside "Around the core" (the
       Self tab's map).
   The mechanism pills and panel moved to Health; the tiles, the written-vs-
   came-back chart, Tonight and the live feed went.

   Two fetches: `/api/overview` for the words and pictures, `/api/mechanisms`
   for the brain's lights. */
import { api, fail } from "../../shared/api.js";
import * as brain from "./sections/brain.js";
import * as feel from "./sections/feel.js";
import * as hero from "./sections/hero.js";
import * as map from "./sections/map.js";
import * as today from "./sections/today.js";

const markup = `
    ${hero.markup}
    <div class="home-row home-row-a">
      ${today.markup}
      ${brain.markup}
    </div>
    <div class="home-row home-row-b">
      ${feel.markup}
      ${map.markup}
    </div>
  `;

/** Draw the home page's words and pictures from one `/api/overview` payload. */
export function paintHome(d) {
  hero.paint(d);
  today.paint(d);
  feel.paint(d);
  map.paint(d);
}

async function render() {
  await Promise.all([brain.refresh(), (async () => {
    let d;
    try { d = await api("/api/overview"); } catch (e) { return fail("The home page", e); }
    paintHome(d);
  })()]);
}

/**
 * The store moved: re-read the overview and the brain's lights. THE FLOW PAGE
 * WAS NOT THE ONLY PAGE COUNTING — the home page's counts used to stay frozen
 * at boot while the flow tab beside them moved. The lights' refresh is also
 * what flares the brain: a mechanism whose newest row moved lights its region.
 */
async function refresh() {
  void brain.refresh();
  const fresh = await api("/api/overview");
  paintHome(fresh);
}

export default {
  name: "home",
  mount(section) {
    section.innerHTML = markup;
    hero.mount();
    today.mount();
    feel.mount();
    brain.mount();
  },
  render,
  refresh,
  /** Built while hidden, the map drew at a guessed width: coming back redraws it to fit. */
  show: map.resize,
  resize: map.resize,
};
