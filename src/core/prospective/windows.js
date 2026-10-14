import { addDays, daysBetween, isDay, monthBounds, occurrenceOf, occurrenceOnOrAfter, parseCalendarDate } from "../time.js";

export { addDays, daysBetween, monthBounds };
export function precisionOf(date) {
  const c = parseCalendarDate(date);
  return c === null || c.text !== date ? null : c.precision;
}
const TAG = { day: "d:", month: "m:", range: "r:" };
export function windowKey(eventDate, precision) {
  return `${TAG[precision]}${eventDate}`;
}
export function parseWindowKey(key) {
  const tag = key.slice(0, 2);
  const date = key.slice(2);
  const want = tag === "d:" ? "day" : tag === "m:" ? "month" : tag === "r:" ? "range" : null;
  if (want === null)
    return null;
  return precisionOf(date) === want ? { eventDate: date, precision: want } : null;
}
export function staggerDays(salt, t) {
  const n = Math.max(0, Math.floor(t.MONTH_STAGGER_DAYS));
  if (n <= 1 || salt.length === 0)
    return 0;
  let h = 2166136261;
  for (let i = 0;i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % n;
}
export function windowFor(eventDate, precision, t, salt = "") {
  if (precision === "year")
    return null;
  const c = parseCalendarDate(eventDate);
  if (c === null || c.text !== eventDate || c.precision !== precision)
    return null;
  const opensOn = addDays(c.first, -t.LEAD_DAYS);
  const closesOn = addDays(c.last, t.GRACE_DAYS);
  if (precision === "month") {
    const peakOn = addDays(c.first, staggerDays(salt, t));
    return {
      key: windowKey(eventDate, "month"),
      eventDate,
      precision: "month",
      opensOn,
      peakOn,
      peakUntil: peakOn,
      firstDay: c.first,
      lastDay: c.last,
      closesOn
    };
  }
  return {
    key: windowKey(eventDate, precision),
    eventDate,
    precision,
    opensOn,
    peakOn: c.first,
    peakUntil: c.last,
    firstDay: c.first,
    lastDay: c.last,
    closesOn
  };
}
export function recurringWindowAt(anchor, rule, at, t, salt = "") {
  if (!isDay(anchor) || !isDay(at))
    return null;
  const occ = (k) => k < 0 ? null : occurrenceOf(anchor, rule, k);
  const opensOf = (k) => {
    const o = occ(k);
    const lead = addDays(o, -t.LEAD_DAYS);
    const prev = occ(k - 1);
    if (prev === null)
      return lead;
    const after = addDays(prev, 1);
    return lead > after ? lead : after;
  };
  const windowOf = (k) => {
    const o = occ(k);
    if (o === null)
      return null;
    const w = windowFor(o, "day", t, salt);
    if (w === null)
      return null;
    const grace = addDays(o, t.GRACE_DAYS);
    const nextOpens = addDays(opensOf(k + 1), -1);
    return {
      ...w,
      opensOn: opensOf(k),
      closesOn: grace < nextOpens ? grace : nextOpens,
      anchor,
      recurring: rule
    };
  };
  const next = occurrenceOnOrAfter(anchor, rule, at);
  if (next === null)
    return null;
  const last = windowOf(next.k - 1);
  if (last !== null && at <= last.closesOn)
    return last;
  return windowOf(next.k);
}
export function phaseOf(w, at) {
  if (at < w.opensOn)
    return "pending";
  return at > w.closesOn ? "passed" : "arrived";
}
export function rampAt(w, at, t) {
  if (phaseOf(w, at) !== "arrived")
    return 0;
  if (at <= w.peakOn) {
    const toPeak = daysBetween(w.opensOn, w.peakOn);
    if (toPeak <= 0)
      return 1;
    return t.RAMP_OPEN + (1 - t.RAMP_OPEN) * (daysBetween(w.opensOn, at) / toPeak);
  }
  if (at <= w.peakUntil)
    return 1;
  const tail = daysBetween(w.peakUntil, w.closesOn);
  if (tail <= 0)
    return 1;
  return 1 - (1 - t.RAMP_CLOSE) * (daysBetween(w.peakUntil, at) / tail);
}
export function imminence(w, at) {
  const until = at >= w.firstDay ? 0 : daysBetween(at, w.firstDay);
  return [until, daysBetween(w.firstDay, w.lastDay) + 1];
}
