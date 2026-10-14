import { CURSOR_PREFIX, MARKER_PREFIX, MARKER_UNSET, TUNABLES } from "./tunables.js";
import { PHASES } from "./types.js";
export function markerKey(phase) {
  return `${MARKER_PREFIX}${phase}`;
}
export function readMarker(store, phase) {
  const raw = store.getMeta(markerKey(phase));
  if (raw === undefined)
    return { day: MARKER_UNSET, health: "unset" };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MARKER_UNSET) {
    return { day: MARKER_UNSET, health: "torn", raw };
  }
  return { day: n, health: "ok" };
}
export function markerDue(marker, day, cadence = 1) {
  if (marker === MARKER_UNSET)
    return "due";
  if (day <= marker)
    return "already-done-today";
  return day - marker >= cadence ? "due" : "not-due-this-cadence";
}
export function advanceMarker(store, phase, day) {
  const current = readMarker(store, phase);
  if (current.health === "ok" && day <= current.day)
    return current.day;
  store.setMeta(markerKey(phase), String(day));
  return day;
}
export function initializeMarkers(store, day) {
  const touched = [];
  for (const phase of PHASES) {
    if (readMarker(store, phase).health === "unset") {
      store.setMeta(markerKey(phase), String(day));
      touched.push(phase);
    }
  }
  return touched;
}
export function cursorKey(phase) {
  return `${CURSOR_PREFIX}${phase}`;
}
export function readCursor(store, phase) {
  const raw = store.getMeta(cursorKey(phase));
  return raw === undefined || raw.length === 0 ? null : raw;
}
export function writeCursor(store, phase, id) {
  store.setMeta(cursorKey(phase), id);
}
export function resumeIndex(ids, cursor) {
  if (cursor === null || ids.length === 0)
    return 0;
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = lo + hi >>> 1;
    if (ids[mid] <= cursor)
      lo = mid + 1;
    else
      hi = mid;
  }
  return lo === ids.length ? 0 : lo;
}
export function cadenceFor(phase, override) {
  const custom = override?.[phase];
  return custom !== undefined && custom > 0 ? custom : TUNABLES.CADENCE[phase];
}
export function budgetFor(phase, override) {
  const custom = override?.[phase];
  return custom !== undefined && custom >= 0 ? custom : TUNABLES.BUDGETS[phase];
}
