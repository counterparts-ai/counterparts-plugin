/* "How it feels" on the home tab: the shared feelings chart
   (`shared/widgets/feel-radar.js`, the same one Memories draws), from the same
   numbers. A click on a feeling opens the memories tab filtered to it.

   Data: `/api/overview`'s `feelings` (`views/memories.ts#feelingsView`). */
import { $ } from "../../../shared/dom.js";
import { feelQ, radarHtml, wireRadar, wireTips } from "../../../shared/widgets/feel-radar.js";
import { go } from "../go.js";

export const markup = `
        <section class="home-card" aria-labelledby="home-feel-h">
          <h2 id="home-feel-h">How it feels<span id="home-feel-q"></span></h2>
          <div class="card pad feel home-feel" id="home-feel"></div>
        </section>`;

let data = null;

export function mount() {
  wireRadar($("home-feel"), () => data, (core) => go("memories?feeling=" + encodeURIComponent(core)));
}

export function paint(d) {
  data = d.feelings;
  $("home-feel-q").innerHTML = feelQ("home-feel", data.owner);
  wireTips($("home-feel-q"));
  $("home-feel").innerHTML = radarHtml(data, null);
}
