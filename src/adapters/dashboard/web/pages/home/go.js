/* Where a click on the home tab goes: a hash route (`shell/tabs.js#parseRoute`)
   — the tab, and the place on it. A second click on the same place changes no
   hash, so it re-announces the hash itself, or the click would do nothing. */
export function go(hash) {
  if (location.hash === "#" + hash) dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}
