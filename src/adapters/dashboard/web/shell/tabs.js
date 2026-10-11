/* The nav strip and tab switching. A tab is built once, on first show (or at
   boot — see `app.js`); coming back to it only redraws what is laid out by
   width. */
import { $ } from "../shared/dom.js";
import { tabs } from "../shared/state.js";
import { PAGE, TABS } from "./pages.js";

/* Old hashes still land: a bookmark to `#overview` or `#mind` (and the
   `/brain` page's links) open the tab under its new name, and the address bar
   is corrected to it. */
const RENAMED = { overview: "home", mind: "self" };

/**
 * A hash is `<tab>`, optionally with an anchor (`#self/settling`) or a query
 * (`#memories?state=archived`): the tab opens and its page's `route(r)`, if it
 * has one, is handed `{ anchor, params }` once the page is drawn.
 */
export function parseRoute(hash) {
  const m = /^([^/?]*)(?:\/([^?]*))?(?:\?(.*))?$/.exec(hash || "");
  return { name: (m && m[1]) || "", anchor: (m && m[2]) || null, params: new URLSearchParams((m && m[3]) || "") };
}

export function showTab(hash, push) {
  const route = parseRoute(hash);
  let name = route.name;
  let rest = hash && hash.length > name.length ? hash.slice(name.length) : "";
  if (RENAMED[name]) { name = RENAMED[name]; push = true; }
  if (!TABS.includes(name)) { name = "home"; rest = ""; }
  tabs.current = name;
  for (const t of TABS) {
    $("tab-" + t).hidden = t !== name;
    const link = $("nav-" + t);
    if (link) link.classList.toggle("on", t === name);
  }
  if (push) history.replaceState(null, "", "#" + name + rest);
  const page = PAGE[name];
  let drawn;
  if (!tabs.loaded[name]) { tabs.loaded[name] = true; drawn = page.render(); }
  else if (page.show) drawn = page.show();
  if (page.route && (route.anchor || [...route.params].length)) {
    Promise.resolve(drawn).then(() => page.route({ anchor: route.anchor, params: route.params }));
  }
}

export function mountNav() {
  $("nav").innerHTML = TABS.map((t) => '<a id="nav-' + t + '" href="#' + t + '">' + t + "</a>").join("");
  for (const t of TABS) $("nav-" + t).onclick = (e) => { e.preventDefault(); showTab(t, true); };
  addEventListener("hashchange", () => showTab(location.hash.slice(1), false));
}
