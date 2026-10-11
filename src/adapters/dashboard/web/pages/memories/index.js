/* The memories tab (round 4, 2026-09-28): who is talking and what this is, in
   one line; the count once ("320 memories · 23 new today"); two small pictures
   (how well I remember, how it feels); then every memory, with one box to find
   one. `/api/memories` feeds the top and the pictures; the list fetches its own
   page (`/api/memories/list`).

   LIVE. The pulse calls `refresh()` when the store moves. Everything is re-read
   and redrawn from `state.js`, so the chosen filters, sort and page (and any
   pinned `?`, kept by the shared tip widget) come back as they were; an open
   memory card lives in the overlay and is left alone; the scroll position is
   put back; answers in the find box stay until it is cleared. */
import { api, fail } from "../../shared/api.js";
import { $ } from "../../shared/dom.js";
import { openMemory } from "../../shared/memory-modal.js";
import { MY_NAME, ownerOr } from "../../shared/voice.js";
import * as feel from "./sections/feel.js";
import * as hold from "./sections/hold.js";
import * as list from "./sections/list.js";
import * as tools from "./sections/tools.js";
import { setFilter } from "./state.js";

const markup = `
    <div class="mem-top">
      <div class="mem-head">
        <p class="mem-count" id="mem-lede"></p>
        <p class="mem-intro" id="mem-intro"></p>
      </div>${tools.markup}
    </div>${tools.notePanel}
    <div class="glance2">${hold.markup}${feel.markup}
    </div>
    ${list.markup}
  `;

async function render() {
  let d;
  try { d = await api("/api/memories"); } catch (e) { return fail("The memories page", e); }
  const x = scrollX, y = scrollY;
  $("mem-lede").textContent = count(d);
  $("mem-intro").textContent = intro(d.owner);
  feel.paint(d); // first: the squares are laid out to the chart's height
  hold.paint(d);
  await list.render();
  if (scrollX !== x || scrollY !== y) scrollTo(x, y);
}

/** "145 memories · 12 new today" — the dashboard's one count (2026-09-26):
 *  every live row, people and project cards and journal chapters included, the
 *  same number the list's "kept" chip and the home headline say. A zero "new
 *  today" is left out, as on Home. */
export function count(d) {
  if (d.total === 0) return "Nothing held yet. Add a memory, or just talk.";
  return d.total + (d.total === 1 ? " memory" : " memories") + (d.newToday > 0 ? " · " + d.newToday + " new today" : "");
}

/** Who "I" am, once: "I'm Claude. This is what I've kept from working with Mike." */
export function intro(owner) {
  return "I'm " + MY_NAME + ". This is what I've kept from working with " + ownerOr(owner) + ".";
}

export default {
  name: "memories",
  mount(section) {
    section.innerHTML = markup;
    hold.mount();
    feel.mount();
    list.mount();
    tools.mount();
    // A note or a removal made on purpose: re-read now rather than on the next poll.
    addEventListener("counterparts:changed", () => { render(); });
  },
  render,
  /** The store moved (the pulse): re-read everything this page shows. */
  refresh: render,
  /** The squares are laid out to the width and the chart beside them: again
   *  when the tab comes back into view, the window changes or the fonts land. */
  show: hold.redraw,
  resize: hold.redraw,
  redraw: hold.redraw,
  /** `#memories?state=archived` (or live/all): open the list at that filter.
   *  `#memories?feeling=warm` (the home tab's chart): the live memories carrying
   *  a feeling under that core, as a click on this tab's chart would show them.
   *  `#memories?id=mem_…` (the sidebar, 2026-10-10): that one memory's card,
   *  opened over the list, as a click on its row would open it. */
  route({ params }) {
    const state = params.get("state");
    const feeling = params.get("feeling");
    const id = params.get("id");
    if (id) {
      openMemory(id);
      return;
    }
    if (feeling) {
      setFilter({ state: "live", kind: null, core: false, journal: false, hold: null, feeling: null, feelingCore: feeling });
    } else if (["live", "archived", "all"].includes(state)) {
      setFilter({ state, kind: null, core: false, journal: false, hold: null, feeling: null, feelingCore: null });
    } else return;
    $("mlist-h").scrollIntoView({ block: "start" });
  },
};
