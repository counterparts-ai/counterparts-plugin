/* The page registry: which tabs exist, in nav order. Each page module's
   default export is
     { name, mount(sectionEl), render(),            — required
       refresh?(), show?(), resize?(), redraw?(),     — optional
       onEvents?(fresh), onDeposit?() }               — optional, the pulse
   and `app.html` carries one `<section class="tab" id="tab-<name>">` for it. */
import home from "../pages/home/index.js";
import memories from "../pages/memories/index.js";
import self from "../pages/self/index.js";
import flow from "../pages/flow/index.js";
import health from "../pages/health/index.js";

export const PAGES = [home, memories, self, flow, health];
export const TABS = PAGES.map((p) => p.name);
export const PAGE = Object.fromEntries(PAGES.map((p) => [p.name, p]));
