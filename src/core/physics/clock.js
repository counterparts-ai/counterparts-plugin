export const BOUNDARY_HOUR_DEFAULT = 4;
function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}
export function dayKey(at, boundaryHour = BOUNDARY_HOUR_DEFAULT) {
  const t = typeof at === "number" ? new Date(at) : new Date(at.getTime());
  t.setHours(t.getHours() - boundaryHour);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
export function livedDay(activeDays, key) {
  let n = 0;
  for (const k of new Set(activeDays))
    if (k < key)
      n++;
  return n;
}
export function livedDaysBetween(activeDays, fromKey, toKey) {
  return Math.max(0, livedDay(activeDays, toKey) - livedDay(activeDays, fromKey));
}
