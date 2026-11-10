/* The page registry: which tabs exist, in nav order. Each page module's
   default export is
     { name, mount(sectionEl), render(),            — required
       refresh?(), show?(), resize?(), redraw?(),     — optional
       onEvents?(fresh), onDeposit?() }               — optional, the pulse
   and `app.html` carries one `<section class="tab" id="tab-<name>">` for it. */
import home from "../pages/home/index.js";
import memories from "../pages/memories/index.js";
import subjects from "../pages/subjects/index.js";
import self from "../pages/self/index.js";
import flow from "../pages/flow/index.js";
import health from "../pages/health/index.js";
import { esc } from "../shared/dom.js";
import { NOT_HERE, showsTab } from "../shared/host.js";

/** A tab this host doesn't show (shared/host.js): it stays in the nav and says
 *  so in one line, and fetches nothing. */
function notHere(name) {
  return {
    name,
    mount(section) { section.innerHTML = '<p class="empty not-here">' + esc(NOT_HERE) + "</p>"; },
    render() {},
  };
}

export const PAGES = [home, memories, subjects, self, flow, health].map((p) => (showsTab(p.name) ? p : notHere(p.name)));
export const TABS = PAGES.map((p) => p.name);
export const PAGE = Object.fromEntries(PAGES.map((p) => [p.name, p]));
