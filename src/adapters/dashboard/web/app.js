/* ───────────────────────────────────────────────────────────────────────────
   The dashboard's one entry module. No dependencies, no bundler, no network
   beyond this origin. Every panel is a pure function of one JSON view; nothing
   is cached between loads, because the whole point of render-time resolution
   is that a memory removed a minute ago stops resolving on the next request.

   Where things live: `README.md` beside this file.
   ─────────────────────────────────────────────────────────────────────────── */
import { api, fail } from "./shared/api.js";
import { $ } from "./shared/dom.js";
import { mountModal } from "./shared/modal.js";
import { live, tabs } from "./shared/state.js";
import { PAGE, PAGES, TABS } from "./shell/pages.js";
import { poll } from "./shell/pulse.js";
import { mountNav, showTab } from "./shell/tabs.js";

// Each page writes its own markup into its section and wires its listeners.
for (const page of PAGES) page.mount($("tab-" + page.name));
mountNav();
mountModal();

let resizeTimer = null;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const page = PAGE[tabs.current];
    if (page && page.resize) page.resize();
  }, 120);
});

(async function boot() {
  try {
    // The store's shape, for the pulse's "did anything move" (round 4,
    // 2026-09-28: the header's store and day chips went — the day is in the
    // home tab's headline, the store's path on the health tab).
    const meta = await api("/api/meta");
    live.fingerprint = { rows: meta.rows, day: meta.day };
  } catch (e) { fail("The header", e); }
  showTab(location.hash.slice(1) || "home", false);
  // Every tab is built once, up front: a screenshot of any of them should never
  // be waiting on a fetch, and the flow diagram needs its data before it can be
  // drawn at all.
  await Promise.all(TABS.filter((t) => !tabs.loaded[t]).map((t) => { tabs.loaded[t] = true; return PAGE[t].render(); }));
  // A canvas draws with whatever face is loaded at that moment; once the
  // self-hosted faces have arrived, the tab on screen is redrawn with them.
  try { await document.fonts.ready; } catch { /* no FontFaceSet: the fallback face stands */ }
  const current = PAGE[tabs.current];
  if (current.redraw) current.redraw();
  setInterval(poll, 4000);
  document.documentElement.dataset.loaded = "1";
})();
