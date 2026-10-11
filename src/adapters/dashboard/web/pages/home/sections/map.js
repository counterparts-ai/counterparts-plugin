/* The self map on the home tab (round 4, 2026-09-28): the Self tab's "Around
   the core", the same component (`../../self/sections/map.js`) — its rings
   named on the map ("who I am", "almost there", "about me and us"), the core
   and almost-there memories named, one caption — without the Self tab's line
   of counts. Click a dot for its memory card; "who I'm becoming" goes to the
   Self tab.

   Data: `/api/overview`'s `map` (`views/self-map.ts`). */
import { $ } from "../../../shared/dom.js";
import * as selfMap from "../../self/sections/map.js";

export const markup = `
        <section class="home-card" aria-labelledby="home-map-h">
          <h2 id="home-map-h">Around the core</h2>
          <div class="card pad home-map">
            <div class="sm" id="home-map"></div>
            <a class="home-more" href="#self">who I’m becoming →</a>
          </div>
        </section>`;

export function paint(d) {
  selfMap.paint($("home-map"), d.map, { count: false });
}

/** Drawn to its box's width: a new width (or a tab shown after a hidden build) redraws it. */
export const resize = () => selfMap.resize();
