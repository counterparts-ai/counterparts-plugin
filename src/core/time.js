export const FALLBACK_ZONE = "UTC";
const formatters = new Map;
function formatter(zone, shape) {
  const key = `${shape}|${zone}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f = shape === "stamp" ? new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }) : shape === "date" ? new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    }) : new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short"
    });
    formatters.set(key, f);
  }
  return f;
}
export function isZone(name) {
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 64)
    return false;
  if (!/^[A-Za-z]/.test(name))
    return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
export function machineZone() {
  try {
    const z = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isZone(z) ? z : FALLBACK_ZONE;
  } catch {
    return FALLBACK_ZONE;
  }
}
export function resolveZone(configured) {
  return configured !== undefined && configured !== null && isZone(configured) ? configured : machineZone();
}
function partsOf(at, zone, shape) {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime()))
    return null;
  let raw;
  try {
    raw = formatter(zone, shape).formatToParts(d);
  } catch {
    if (zone === FALLBACK_ZONE)
      return null;
    return partsOf(at, FALLBACK_ZONE, shape);
  }
  const out = {};
  for (const p of raw)
    out[p.type] = p.value;
  return {
    year: (out["year"] ?? "").padStart(4, "0"),
    month: out["month"] ?? "",
    day: out["day"] ?? "",
    weekday: out["weekday"] ?? "",
    hour: out["hour"] ?? "",
    minute: out["minute"] ?? "",
    dayPeriod: (out["dayPeriod"] ?? "").toLowerCase(),
    timeZoneName: out["timeZoneName"] ?? ""
  };
}
export function localDate(at, zone) {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "date");
  return p === null ? "" : `${p.year}-${p.month}-${p.day}`;
}
export function localClock(at, zone) {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "clock");
  if (p === null)
    return "";
  const mo = MONTHS[Number(p.month) - 1] ?? p.month;
  return `${p.weekday} ${String(Number(p.day))} ${mo} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`.trim();
}
const timeFormatters = new Map;
export function localTime(at, zone) {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const d = new Date(at);
  if (!Number.isFinite(d.getTime()))
    return "";
  let f = timeFormatters.get(z);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    timeFormatters.set(z, f);
  }
  const out = {};
  for (const p of f.formatToParts(d))
    out[p.type] = p.value;
  return `${out["hour"] ?? ""}:${out["minute"] ?? ""}:${out["second"] ?? ""}`;
}
export function localStamp(at, zone) {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  if (p === null)
    return "";
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
export function localClockZone(at, zone) {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  const q = partsOf(at, z, "clock");
  if (p === null)
    return "";
  return `${p.hour}:${p.minute}${q === null || q.timeZoneName === "" ? "" : ` ${q.timeZoneName}`}`;
}
export function localStampAfter(at, after, zone) {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  const q = partsOf(after, z, "stamp");
  if (p === null)
    return "";
  const clock = `${p.hour}:${p.minute}`;
  return q !== null && q.month === p.month && q.day === p.day ? clock : `${p.month}-${p.day} ${clock}`;
}
export function startOfLocalDay(ymd, zone) {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  if (!isDay(ymd) || !Number.isFinite(utcMidnight))
    throw new RangeError(`startOfLocalDay: not a day: ${ymd}`);
  const minute = 60000;
  let before = Math.floor((utcMidnight - 15 * 3600000) / minute);
  let onOrAfter = Math.floor((utcMidnight + 13 * 3600000) / minute);
  while (onOrAfter - before > 1) {
    const mid = Math.floor((before + onOrAfter) / 2);
    if (localDate(mid * minute, z) < ymd)
      before = mid;
    else
      onOrAfter = mid;
  }
  return onOrAfter * minute;
}
export function todayIn(zone, at = Date.now()) {
  return localDate(at, zone);
}
export function utcDate(at) {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}
export function isoInstant(at) {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}
const zoneOk = new Map;
function isZoneCached(zone) {
  let ok = zoneOk.get(zone);
  if (ok === undefined) {
    ok = isZone(zone);
    zoneOk.set(zone, ok);
  }
  return ok;
}
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^(\d{4})$/;
export const RANGE_SEP = "..";
const DAY_MS = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dayNumber(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function fromDayNumber(z) {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}
function daysInMonth(y, m) {
  return dayNumber(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - dayNumber(y, m, 1);
}
function dayOf(ymd) {
  const m = DAY_RE.exec(ymd);
  if (m === null)
    return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo))
    return null;
  return dayNumber(y, mo, d);
}
export function isDay(ymd) {
  return typeof ymd === "string" && dayOf(ymd) !== null;
}
export function parseCalendarDate(text) {
  if (typeof text !== "string")
    return null;
  const s = text.trim();
  if (s.includes(RANGE_SEP)) {
    const [a, b, ...rest] = s.split(RANGE_SEP);
    if (rest.length > 0 || a === undefined || b === undefined)
      return null;
    const x = dayOf(a);
    const y = dayOf(b);
    if (x === null || y === null || y < x)
      return null;
    return { text: s, precision: "range", first: a, last: b };
  }
  if (dayOf(s) !== null)
    return { text: s, precision: "day", first: s, last: s };
  const mm = MONTH_RE.exec(s);
  if (mm !== null) {
    const [y, mo] = [Number(mm[1]), Number(mm[2])];
    if (y < 1 || mo < 1 || mo > 12)
      return null;
    return { text: s, precision: "month", first: `${mm[1]}-${mm[2]}-01`, last: `${mm[1]}-${mm[2]}-${pad2(daysInMonth(y, mo))}` };
  }
  const yy = YEAR_RE.exec(s);
  if (yy !== null && Number(yy[1]) >= 1)
    return { text: s, precision: "year", first: `${yy[1]}-01-01`, last: `${yy[1]}-12-31` };
  return null;
}
export function isCalendarDate(text) {
  return parseCalendarDate(text) !== null;
}
export function addDays(ymd, n) {
  const d = dayOf(ymd);
  if (d === null)
    throw new Error(`addDays: not a calendar day: ${ymd}`);
  return fromDayNumber(d + n);
}
export function daysBetween(a, b) {
  const x = dayOf(a);
  const y = dayOf(b);
  if (x === null || y === null)
    throw new Error(`daysBetween: not calendar days: ${a}, ${b}`);
  return y - x;
}
export function monthBounds(month) {
  const c = parseCalendarDate(month);
  return c !== null && c.precision === "month" ? { first: c.first, last: c.last } : null;
}
export function compareCalendarDates(a, b) {
  const x = parseCalendarDate(a);
  const y = parseCalendarDate(b);
  if (x === null || y === null)
    return x === null && y === null ? a.localeCompare(b) : x === null ? 1 : -1;
  if (x.first !== y.first)
    return x.first < y.first ? -1 : 1;
  if (x.last !== y.last)
    return x.last < y.last ? -1 : 1;
  return 0;
}
export function calendarOverlaps(date, from, to) {
  const c = parseCalendarDate(date);
  return c !== null && c.first <= to && c.last >= from;
}
export function calendarCovers(date, ymd) {
  return calendarOverlaps(date, ymd, ymd);
}
export function readableDate(ymd) {
  const d = dayOf(ymd.trim());
  if (d === null)
    return "";
  const [y, mo, dd] = ymd.trim().split("-").map(Number);
  const weekday = WEEKDAYS[((d + 4) % 7 + 7) % 7];
  return `${weekday} ${String(dd)} ${MONTHS[mo - 1]} ${String(y)}`;
}
export const calendarDate = localDate;
export const RECURRENCES = ["daily", "weekly", "monthly", "yearly"];
export function isRecurrence(v) {
  return typeof v === "string" && RECURRENCES.includes(v);
}
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function monthsAfter(y, m, d, k) {
  const total = y * 12 + (m - 1) + k;
  const yy = Math.floor(total / 12);
  const mm = total % 12 + 1;
  return dayNumber(yy, mm, Math.min(d, daysInMonth(yy, mm)));
}
function occurrenceNumber(y, m, d, rule, k) {
  switch (rule) {
    case "daily":
      return dayNumber(y, m, d) + k;
    case "weekly":
      return dayNumber(y, m, d) + 7 * k;
    case "monthly":
      return monthsAfter(y, m, d, k);
    case "yearly":
      return monthsAfter(y, m, d, 12 * k);
  }
}
function anchorParts(anchor) {
  if (dayOf(anchor) === null)
    return null;
  const [y, m, d] = anchor.split("-").map(Number);
  return [y, m, d];
}
export function occurrenceOf(anchor, rule, k) {
  const p = anchorParts(anchor);
  if (p === null || !Number.isInteger(k) || k < 0)
    return null;
  return fromDayNumber(occurrenceNumber(p[0], p[1], p[2], rule, k));
}
export function occurrenceOnOrAfter(anchor, rule, ymd) {
  const p = anchorParts(anchor);
  const target = dayOf(ymd);
  if (p === null || target === null)
    return null;
  const [y, m, d] = p;
  const start = dayNumber(y, m, d);
  if (target <= start)
    return { k: 0, date: anchor };
  let k = rule === "daily" ? target - start : rule === "weekly" ? Math.floor((target - start) / 7) : rule === "monthly" ? Math.max(0, (Number(ymd.slice(0, 4)) - y) * 12 + (Number(ymd.slice(5, 7)) - m) - 1) : Math.max(0, Number(ymd.slice(0, 4)) - y - 1);
  while (occurrenceNumber(y, m, d, rule, k) < target)
    k += 1;
  return { k, date: fromDayNumber(occurrenceNumber(y, m, d, rule, k)) };
}
export function occurrenceBetween(anchor, rule, from, to) {
  const next = occurrenceOnOrAfter(anchor, rule, from);
  return next !== null && next.date <= to ? next.date : null;
}
function ordinal(n) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${String(n)}${suffix}`;
}
export function readableRecurrence(anchor, rule) {
  const p = anchorParts(anchor);
  if (p === null)
    return "";
  const [, m, d] = p;
  switch (rule) {
    case "daily":
      return "every day";
    case "weekly":
      return `every ${WEEKDAY_NAMES[((dayNumber(p[0], m, d) + 4) % 7 + 7) % 7] ?? ""}`;
    case "monthly":
      return `every month on the ${ordinal(d)}`;
    case "yearly":
      return `every ${MONTH_NAMES[m - 1] ?? ""} ${String(d)}`;
  }
}
