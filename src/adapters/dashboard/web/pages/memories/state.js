/* What the memories page is filtered to, kept apart from the markup so a live refresh redraws and leaves every choice as it was.
   Listeners: the list, the two pictures, the find box. */
/** `hold`: firm / settling / fading, set from the "How well I remember" bar.
 *  `feeling` ({ word, whose }) and `feelingCore`: the feeling filter — the
 *  chart and the feeling chips set `feelingCore`; `feeling` (one word from one
 *  side) is still understood by the server, and nothing on the page sets it now. */
export const filters = {
  state: "live", kind: null, core: false, journal: false, hold: null, feeling: null, feelingCore: null, sort: "newest", offset: 0,
};

/** The find box: while it holds words, its answers stand in the list's place
 *  (round 4, 2026-09-28: results REPLACE the list). Any filter change ends it.
 *  `mode`: the switch beside it, "word" or "meaning" (2026-09-30), or "facts"
 *  (2026-10-09). */
export const find = { on: false, mode: "word" };

const listeners = [];
export function onFilter(fn) { listeners.push(fn); }

/** Change some filters; any change other than the page offset starts at page one. */
export function setFilter(patch) {
  const pageOnly = Object.keys(patch).length === 1 && "offset" in patch;
  Object.assign(filters, patch);
  if (!pageOnly) filters.offset = 0;
  find.on = false;
  for (const fn of listeners) fn(filters);
}

/** A kind chip (or a part of the bar) is a toggle: click it again to
 *  show everything. Core and journal chips are on/off. */
export function toggle(key, value) {
  if (key === "core" || key === "journal") setFilter({ [key]: !filters[key] });
  else setFilter({ [key]: filters[key] === value ? null : value });
}

/** Tell the page the store changed on purpose (a note, a removal). */
export function changed() { window.dispatchEvent(new CustomEvent("counterparts:changed")); }
