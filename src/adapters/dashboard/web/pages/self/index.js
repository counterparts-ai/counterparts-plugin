/* The self tab (was "mind"): the self page on the left with a side column
   beside it (the page's history as one strip of lived days, and what the next
   wake starts with); under them, what is settling into the core — its counts
   and the self map — how I act (the trait bars), and the journal as a strip
   of days. One fetch
   (`/api/mind`).

   LIVE. The pulse calls `refresh()` when the store moves. Only the panels whose
   data changed are redrawn, each from `state.js`, so whatever was open — a
   picked day, expanded chapters, an opened version, a pinned `?`, the wake's
   text — is drawn open again, and the scroll position is put back. */
import { api, fail } from "../../shared/api.js";
import { $, esc } from "../../shared/dom.js";
import * as dreams from "./sections/dreams.js";
import * as journal from "./sections/journal.js";
import * as page from "./sections/page.js";
import * as settling from "./sections/settling.js";
import * as traits from "./sections/traits.js";
import * as wake from "./sections/wake.js";
import { q, wireTips } from "../../shared/widgets/tips.js";

const markup = `
    <h2 class="sp-title" id="mind-opening"></h2>
    <div class="self-top">
      <div class="self-main">${page.mainMarkup}
      </div>
      <aside class="self-side">${page.sideMarkup}${wake.markup}
      </aside>
    </div>
    <div class="cols self-cols">
      <div>${settling.markup}${traits.markup}
      </div>
      <div>${journal.markup}${dreams.markup}
      </div>
    </div>
  `;

/** Each panel, the slice of the view it draws from, and how it draws. */
const PANELS = [
  { name: "opening", slice: (d) => [d.opening], paint: paintOpening },
  { name: "page", slice: (d) => [d.page, d.pageAbsent], paint: page.paintPage },
  { name: "behind", slice: (d) => [d.pageBehind, d.pageAbsent], paint: page.paintBehind },
  { name: "history", slice: (d) => [d.pageHistory, d.pageDays, d.pageDaysUndated, d.pageDaysEarlier], paint: page.paintHistory },
  { name: "wake", slice: (d) => [d.wake, d.wakeList], paint: wake.paint },
  { name: "settling", slice: (d) => [d.settling, d.stories, d.map], paint: settling.paint },
  { name: "traits", slice: (d) => [d.traits], paint: traits.paint },
  { name: "journal", slice: (d) => [d.journal, d.journalAbsent, d.journalMore], paint: journal.paint },
  { name: "dreams", slice: (d) => [d.dreams, d.dreamsAbsent], paint: dreams.paint },
];

/** What each panel was last drawn from. */
const drawn = {};

function paintOpening(d) {
  $("mind-opening").innerHTML = esc(d.opening) + " " +
    q("opening", "In my own words; the next session opens with this. Under it: how it has changed, what is slowly settling into the core, what the next session will be handed, and the journal.");
  wireTips($("mind-opening"));
}

/** Draw every panel whose data moved (all of them when `force`). */
async function draw(force) {
  let d;
  try { d = await api("/api/mind"); } catch (e) { if (force) fail("The self page", e); return; }
  const x = scrollX, y = scrollY;
  for (const p of PANELS) {
    const key = JSON.stringify(p.slice(d));
    if (!force && drawn[p.name] === key) continue;
    p.paint(d);
    drawn[p.name] = key;
  }
  if (scrollX !== x || scrollY !== y) scrollTo(x, y);
}

export default {
  name: "self",
  mount(section) {
    section.innerHTML = markup;
  },
  render: () => draw(true),
  refresh: () => draw(false),
  /** The self map is drawn to its box's width: a new width redraws it. */
  resize: () => settling.resize(),
  /** A window resized while this tab was hidden left the map at its old width: coming back redraws it to fit. */
  show: () => settling.resize(),
  /** `#self/settling`, `#self/traits`, `#self/journal`: open the tab at that section. */
  route({ anchor }) {
    const h = anchor && $("self-" + anchor + "-h");
    if (h) h.scrollIntoView({ block: "start" });
  },
};
