/* "How it feels" on the memories tab: the shared feelings chart
   (`shared/widgets/feel-radar.js`, the same one Home draws). Here a click on a
   feeling filters the list to the memories carrying it; again shows them all.
   The axis lit is exactly the list's feeling filter — nothing else is pinned,
   so "show all" leaves nothing behind. */
import { $ } from "../../../shared/dom.js";
import { feelQ, radarHtml, wireRadar, wireTips } from "../../../shared/widgets/feel-radar.js";
import { filters, onFilter, setFilter } from "../state.js";

export const markup = `
          <div class="glance-card">
            <h2 id="feel-h">How it feels<span id="feel-q"></span></h2>
            <div class="card pad feel" id="feel"></div>
          </div>`;

let data = null;

export function mount() {
  wireRadar($("feel"), () => data, (core) => {
    setFilter({ feeling: null, feelingCore: filters.feelingCore === core ? null : core });
  });
  onFilter(draw);
}

export function paint(d) {
  data = d.feelings;
  $("feel-q").innerHTML = feelQ("feel", data.owner);
  wireTips($("feel-q"));
  draw();
}

function draw() {
  if (!data) return;
  $("feel").innerHTML = radarHtml(data, filters.feelingCore);
}
