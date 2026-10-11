/**
 * TIME — the one module that converts (docs/time.md, agreed with the owner
 * 2026-09-25).
 *
 * Two kinds of time, and they are never mixed:
 *
 *   - **A moment** — UTC milliseconds since the epoch, taken from the store's one
 *     clock (`store.now()`). `created_at`, an event's `at`, a version's
 *     `archived_at`. Shown in the person's zone, converted HERE, at display time.
 *   - **A calendar date a person says** — plain text as written: `2026-10-15`,
 *     `2026-10`, `2026`, or a range `2026-10-20..2026-10-31`. Never turned into a
 *     moment: "Oct 15" stored as midnight UTC is Oct 14 in Montana, and a month has
 *     no moment to pick at all.
 *
 * The third clock, the LIVED day (`store.livedDay()`, `physics/clock.ts`), is a
 * counter of days actually used and is not a calendar; nothing here moves it.
 *
 * Every conversion between the two kinds lives in this file: a moment's local
 * date, a moment's local clock line, "today" in a zone, and the arithmetic and
 * comparison of calendar dates. `test/time.test.ts` scans `src/` for code that
 * builds dates by hand (`toISOString().slice(0, 10)`, the `getUTC*` and local
 * `Date` getters, `Date.UTC`) outside this file and a short allow-list.
 *
 * **The zone** is an IANA name (`America/Denver`), never an offset, so daylight
 * saving is the zone rules' job. `resolveZone(configured)` is the config's
 * `timeZone` when it names a real zone, else the machine's CURRENT zone, read
 * per call: a laptop that flies to New York shows New York time the next time
 * anything asks. Pure given `(at, zone)`: nothing here reads the ambient clock
 * except `todayIn`'s default, and a store passes its own `now()`.
 *
 * Folded in 2026-09-25: `self/calendar.ts` (B3's local-day helper, 2026-09-23),
 * which re-exports from here so its callers are unchanged, and the calendar
 * arithmetic `prospective/windows.ts` did with the UTC getters.
 */

// ── zones ────────────────────────────────────────────────────────────────────

/** The zone every conversion falls back to when the machine will not say. */
export const FALLBACK_ZONE = "UTC";

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per (zone, shape), because building one costs ~50 µs. */
function formatter(zone: string, shape: "date" | "clock" | "stamp"): Intl.DateTimeFormat {
  const key = `${shape}|${zone}`;
  let f = formatters.get(key);
  if (f === undefined) {
    f =
      shape === "stamp"
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          })
        : shape === "date"
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            weekday: "short",
          })
        : new Intl.DateTimeFormat("en-US", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZoneName: "short",
          });
    formatters.set(key, f);
  }
  return f;
}

/** Is `name` an IANA zone this runtime knows? `"America/Denver"`, `"UTC"`. */
export function isZone(name: unknown): name is string {
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 64) return false;
  // A NAME, never an offset (review N5): the runtime accepts "+05:30", but an
  // offset has no daylight-saving rules, which is the reason zones are names.
  if (!/^[A-Za-z]/.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The machine's zone as it stands right now — what `TZ` sets for a process. */
export function machineZone(): string {
  try {
    const z = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isZone(z) ? z : FALLBACK_ZONE;
  } catch {
    return FALLBACK_ZONE;
  }
}

/**
 * The zone to convert in: the configured one when it is a real zone, else the
 * machine's current one. A misspelt config value is a caller's mistake, and its
 * safe reading is the machine's own day rather than a throw inside a hook — the
 * doctor line names the zone in use, which is where the owner sees it.
 */
export function resolveZone(configured?: string | null): string {
  return configured !== undefined && configured !== null && isZone(configured) ? configured : machineZone();
}

// ── a moment, in a zone ──────────────────────────────────────────────────────

interface Parts {
  year: string;
  month: string;
  day: string;
  weekday: string;
  hour: string;
  minute: string;
  dayPeriod: string;
  timeZoneName: string;
}

function partsOf(at: number, zone: string, shape: "date" | "clock" | "stamp"): Parts | null {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  let raw: Intl.DateTimeFormatPart[];
  try {
    raw = formatter(zone, shape).formatToParts(d);
  } catch {
    if (zone === FALLBACK_ZONE) return null;
    return partsOf(at, FALLBACK_ZONE, shape);
  }
  const out: Record<string, string> = {};
  for (const p of raw) out[p.type] = p.value;
  return {
    year: (out["year"] ?? "").padStart(4, "0"),
    month: out["month"] ?? "",
    day: out["day"] ?? "",
    weekday: out["weekday"] ?? "",
    hour: out["hour"] ?? "",
    minute: out["minute"] ?? "",
    dayPeriod: (out["dayPeriod"] ?? "").toLowerCase(),
    timeZoneName: out["timeZoneName"] ?? "",
  };
}

/**
 * `YYYY-MM-DD` — the calendar day the moment `at` falls on in `zone` (default:
 * the machine's current zone). Empty for a moment that is not a number. An
 * unknown zone name reads as the machine's zone, as `resolveZone` would.
 */
export function localDate(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "date");
  return p === null ? "" : `${p.year}-${p.month}-${p.day}`;
}

/**
 * The moment as a person reads it on a clock: `Thu 25 Sep 2026, 1:40 pm MDT`.
 * The zone's own short name (`MDT`, `EDT`, or `GMT+2` where the runtime has no
 * abbreviation), so a reader who travelled can see which clock it is.
 */
export function localClock(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "clock");
  if (p === null) return "";
  const mo = MONTHS[Number(p.month) - 1] ?? p.month;
  return `${p.weekday} ${String(Number(p.day))} ${mo} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`.trim();
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * `HH:MM:SS` on a 24-hour clock — the time of day the moment falls on in
 * `zone`. A log line's spelling, where the date is the file's and the seconds
 * are what tell two lines apart (`adapters/log/`, 2026-09-30). Empty for a
 * moment that is not a number.
 */
export function localTime(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  let f = timeFormatters.get(z);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    timeFormatters.set(z, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(d)) out[p.type] = p.value;
  return `${out["hour"] ?? ""}:${out["minute"] ?? ""}:${out["second"] ?? ""}`;
}

/**
 * The moment as a short stamp: `09-29 12:47` — month, day and a 24-hour clock
 * in `zone`. For a line that says when something was written, where the year
 * and the zone's name would be noise (the handoff pointer, 2026-09-30).
 */
export function localStamp(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  if (p === null) return "";
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * The time of day with the zone's short name: `17:47 MDT` — a 24-hour clock
 * in `zone`, and the name of the clock it is on (`MDT`, or `GMT+14` where the
 * runtime has no abbreviation). For a line whose date is printed beside it in
 * the reader's own style (the dashboard card's "written" row, 2026-10-09,
 * which said "17:47 UTC" until then). Empty for a moment that is not a number.
 */
export function localClockZone(at: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  const q = partsOf(at, z, "clock");
  if (p === null) return "";
  return `${p.hour}:${p.minute}${q === null || q.timeZoneName === "" ? "" : ` ${q.timeZoneName}`}`;
}

/**
 * The same stamp, shortened to the clock (`13:02`) when the moment falls on
 * the same date as `after` in `zone` — a time in a run of times that already
 * named its day (the handoff pointer's "work here 13:02–15:41", 2026-09-30).
 */
export function localStampAfter(at: number, after: number, zone?: string): string {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const p = partsOf(at, z, "stamp");
  const q = partsOf(after, z, "stamp");
  if (p === null) return "";
  const clock = `${p.hour}:${p.minute}`;
  return q !== null && q.month === p.month && q.day === p.day ? clock : `${p.month}-${p.day} ${clock}`;
}

/**
 * The first moment of the calendar day `ymd` in `zone` — local midnight, as an
 * instant (2026-10-09). A window over moments that is meant to be a person's
 * days starts here, never at `${ymd}T00:00:00Z`, which is the UTC day: in
 * Denver that opens the window six hours early, in Kiritimati fourteen hours
 * late. Found by a search over `localDate` rather than by offset arithmetic, so
 * a day a clock change starts at 01:00 still starts where the zone says it
 * does. Throws on a malformed day — a caller's bug, as `addDays` does.
 */
export function startOfLocalDay(ymd: string, zone?: string): number {
  const z = zone === undefined || !isZoneCached(zone) ? machineZone() : zone;
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  if (!isDay(ymd) || !Number.isFinite(utcMidnight)) throw new RangeError(`startOfLocalDay: not a day: ${ymd}`);
  const minute = 60_000;
  // Every offset in use lies inside UTC−12..UTC+14, so local midnight lies
  // between these two bounds, with an hour to spare on each side: the first is
  // always the day before in `z`, the second always `ymd` or later.
  let before = Math.floor((utcMidnight - 15 * 3_600_000) / minute);
  let onOrAfter = Math.floor((utcMidnight + 13 * 3_600_000) / minute);
  while (onOrAfter - before > 1) {
    const mid = Math.floor((before + onOrAfter) / 2);
    if (localDate(mid * minute, z) < ymd) before = mid;
    else onOrAfter = mid;
  }
  return onOrAfter * minute;
}

/** Today's `YYYY-MM-DD` in `zone`. A store passes its own clock; the default is
 *  the ambient one, for an adapter with no store open. */
export function todayIn(zone?: string, at: number = Date.now()): string {
  return localDate(at, zone);
}

/**
 * The UTC calendar date of a moment. For the few places that still name things
 * by the UTC day on purpose (a snapshot folder, a parked directory's suffix —
 * each says why) and for reading rows written before 2026-09-25, whose
 * `learned_on` was UTC. A person's day is `localDate`.
 */
export function utcDate(at: number): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

/** A moment as an ISO-8601 UTC instant (`2026-09-25T19:40:00.000Z`) — a log
 *  line's or a file name's spelling of a moment, never a person's. */
export function isoInstant(at: number): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

const zoneOk = new Map<string, boolean>();
function isZoneCached(zone: string): boolean {
  let ok = zoneOk.get(zone);
  if (ok === undefined) {
    ok = isZone(zone);
    zoneOk.set(zone, ok);
  }
  return ok;
}

// ── calendar dates, as a person says them ────────────────────────────────────

/** How much a stated date says. A range is two days, inclusive. */
export type CalendarPrecision = "day" | "month" | "year" | "range";

/** A stated calendar date, read: the text as written and the days it covers. */
export interface CalendarDate {
  /** Exactly as stated — never widened, never narrowed (prospective §12 G4). */
  readonly text: string;
  readonly precision: CalendarPrecision;
  /** First day covered, `YYYY-MM-DD`. */
  readonly first: string;
  /** Last day covered, inclusive. */
  readonly last: string;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^(\d{4})$/;
/** The range separator: `2026-10-20..2026-10-31`. */
export const RANGE_SEP = "..";
const DAY_MS = 86_400_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A `YYYY-MM-DD` as a count of days, for arithmetic ONLY. The day is read as
 * the label it is — never as a moment in any zone — so the arithmetic uses the
 * proleptic Gregorian day count directly and needs no `Date` at all.
 */
function dayNumber(y: number, m: number, d: number): number {
  // Days from civil, after Howard Hinnant's algorithm: exact for every year.
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(z: number): string {
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

function daysInMonth(y: number, m: number): number {
  return dayNumber(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - dayNumber(y, m, 1);
}

/** The day count of a real `YYYY-MM-DD`, or null (`2026-02-30` is not a day). */
function dayOf(ymd: string): number | null {
  const m = DAY_RE.exec(ymd);
  if (m === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return dayNumber(y, mo, d);
}

/** Is `ymd` a whole, real calendar day? */
export function isDay(ymd: unknown): ymd is string {
  return typeof ymd === "string" && dayOf(ymd) !== null;
}

/**
 * Read a stated calendar date: a day, a month, a year, or a range of two days
 * (`2026-10-20..2026-10-31`, inclusive, first ≤ last). Null for anything else —
 * a refusal with a shape, never a guess.
 */
export function parseCalendarDate(text: unknown): CalendarDate | null {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (s.includes(RANGE_SEP)) {
    const [a, b, ...rest] = s.split(RANGE_SEP);
    if (rest.length > 0 || a === undefined || b === undefined) return null;
    const x = dayOf(a);
    const y = dayOf(b);
    if (x === null || y === null || y < x) return null;
    return { text: s, precision: "range", first: a, last: b };
  }
  if (dayOf(s) !== null) return { text: s, precision: "day", first: s, last: s };
  const mm = MONTH_RE.exec(s);
  if (mm !== null) {
    const [y, mo] = [Number(mm[1]), Number(mm[2])];
    if (y < 1 || mo < 1 || mo > 12) return null;
    return { text: s, precision: "month", first: `${mm[1]}-${mm[2]}-01`, last: `${mm[1]}-${mm[2]}-${pad2(daysInMonth(y, mo))}` };
  }
  const yy = YEAR_RE.exec(s);
  if (yy !== null && Number(yy[1]) >= 1) return { text: s, precision: "year", first: `${yy[1]}-01-01`, last: `${yy[1]}-12-31` };
  return null;
}

/** Is `text` a calendar date this module can read? */
export function isCalendarDate(text: unknown): text is string {
  return parseCalendarDate(text) !== null;
}

/** `ymd` moved by `n` days. Throws on a malformed day — a caller's bug. */
export function addDays(ymd: string, n: number): string {
  const d = dayOf(ymd);
  if (d === null) throw new Error(`addDays: not a calendar day: ${ymd}`);
  return fromDayNumber(d + n);
}

/** Calendar days from `a` to `b`; negative when `b` is earlier. Throws on a malformed day. */
export function daysBetween(a: string, b: string): number {
  const x = dayOf(a);
  const y = dayOf(b);
  if (x === null || y === null) throw new Error(`daysBetween: not calendar days: ${a}, ${b}`);
  return y - x;
}

/** First and last day of a stated `YYYY-MM`, or null. */
export function monthBounds(month: string): { first: string; last: string } | null {
  const c = parseCalendarDate(month);
  return c !== null && c.precision === "month" ? { first: c.first, last: c.last } : null;
}

/**
 * Order two stated dates by the first day each covers, then by the last — so a
 * month sorts beside its first day rather than before every day of the year the
 * way the raw strings would (`'2026-10' < '2026-01-05'` is false, and
 * `'2026-10' < '2026-10-01'` is true). Unreadable text sorts last, by text.
 */
export function compareCalendarDates(a: string, b: string): number {
  const x = parseCalendarDate(a);
  const y = parseCalendarDate(b);
  if (x === null || y === null) return x === null && y === null ? a.localeCompare(b) : x === null ? 1 : -1;
  if (x.first !== y.first) return x.first < y.first ? -1 : 1;
  if (x.last !== y.last) return x.last < y.last ? -1 : 1;
  return 0;
}

/** Does the stated date cover any day from `from` to `to` (inclusive, `YYYY-MM-DD`)? */
export function calendarOverlaps(date: string, from: string, to: string): boolean {
  const c = parseCalendarDate(date);
  return c !== null && c.first <= to && c.last >= from;
}

/** Does the stated date cover the day `ymd`? */
export function calendarCovers(date: string, ymd: string): boolean {
  return calendarOverlaps(date, ymd, ymd);
}

/**
 * A `YYYY-MM-DD` as a person reads it: `Tue 23 Sep 2026`. Empty for anything
 * that is not a whole, real day — a `2026-08` or a typo is not padded into a day
 * it never named. The string is already a calendar day, so no zone is involved.
 */
export function readableDate(ymd: string): string {
  const d = dayOf(ymd.trim());
  if (d === null) return "";
  const [y, mo, dd] = ymd.trim().split("-").map(Number) as [number, number, number];
  // Day 0 of the count (1970-01-01) was a Thursday.
  const weekday = WEEKDAYS[(((d + 4) % 7) + 7) % 7];
  return `${weekday} ${String(dd)} ${MONTHS[mo - 1]} ${String(y)}`;
}

/** Legacy name (`self/calendar.ts`, 2026-09-23): the local date of a moment. */
export const calendarDate = localDate;

// ── a date that repeats (2026-10-09, the owner's design, held lightly) ───────

/**
 * How often a stated DAY comes round again, anchored on that day: a birthday
 * stored as `1990-05-14` with `yearly` is every May 14 from then on. Every
 * other week, "the first Monday" and the like are not kept (loose first), and
 * nothing finer than a day: dates and reminders here are per day.
 */
export const RECURRENCES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** Is `v` one of the four recurrence words? */
export function isRecurrence(v: unknown): v is Recurrence {
  return typeof v === "string" && (RECURRENCES as readonly string[]).includes(v);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** A month `k` months after `(y, m)`, with the day held to that month's length. */
function monthsAfter(y: number, m: number, d: number, k: number): number {
  const total = y * 12 + (m - 1) + k;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return dayNumber(yy, mm, Math.min(d, daysInMonth(yy, mm)));
}

/**
 * The `k`-th time a stated day comes round (`k = 0` is the day itself), as a
 * day count. ALWAYS counted from the anchor, never from the last occurrence,
 * so a short month cannot drag the rest of the year with it:
 *
 *   - **monthly on the 29th, 30th or 31st** falls on the LAST day of a month
 *     too short to have it (Jan 31 → Feb 28, or 29 in a leap year → Mar 31 →
 *     Apr 30 → May 31);
 *   - **yearly on Feb 29** falls on Feb 28 in a year with no Feb 29.
 */
function occurrenceNumber(y: number, m: number, d: number, rule: Recurrence, k: number): number {
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

/** The anchor read as numbers, or null when it is not one real DAY. */
function anchorParts(anchor: string): [number, number, number] | null {
  if (dayOf(anchor) === null) return null;
  const [y, m, d] = anchor.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** The `k`-th occurrence of `anchor` (k ≥ 0), `YYYY-MM-DD`; null for anything but a real day. */
export function occurrenceOf(anchor: string, rule: Recurrence, k: number): string | null {
  const p = anchorParts(anchor);
  if (p === null || !Number.isInteger(k) || k < 0) return null;
  return fromDayNumber(occurrenceNumber(p[0], p[1], p[2], rule, k));
}

/**
 * The first occurrence of `anchor` on or after `ymd`, and its index. Never one
 * before the anchor: a repeat starts on the day it was stated. Null when either
 * is not a real day.
 */
export function occurrenceOnOrAfter(anchor: string, rule: Recurrence, ymd: string): { k: number; date: string } | null {
  const p = anchorParts(anchor);
  const target = dayOf(ymd);
  if (p === null || target === null) return null;
  const [y, m, d] = p;
  const start = dayNumber(y, m, d);
  if (target <= start) return { k: 0, date: anchor };
  // A lower bound on k, then forward: at most a step or two past the estimate.
  let k =
    rule === "daily"
      ? target - start
      : rule === "weekly"
        ? Math.floor((target - start) / 7)
        : rule === "monthly"
          ? Math.max(0, (Number(ymd.slice(0, 4)) - y) * 12 + (Number(ymd.slice(5, 7)) - m) - 1)
          : Math.max(0, Number(ymd.slice(0, 4)) - y - 1);
  while (occurrenceNumber(y, m, d, rule, k) < target) k += 1;
  return { k, date: fromDayNumber(occurrenceNumber(y, m, d, rule, k)) };
}

/** Does some occurrence of `anchor` fall on a day from `from` to `to`, inclusive? The first one that does, or null. */
export function occurrenceBetween(anchor: string, rule: Recurrence, from: string, to: string): string | null {
  const next = occurrenceOnOrAfter(anchor, rule, from);
  return next !== null && next.date <= to ? next.date : null;
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${String(n)}${suffix}`;
}

/**
 * The repeat as a person says it, from the ANCHOR (so a monthly 31st reads as
 * the 31st even in a February): `every day`, `every Monday`, `every month on
 * the 14th`, `every May 14`. Empty for an anchor that is not a real day.
 */
export function readableRecurrence(anchor: string, rule: Recurrence): string {
  const p = anchorParts(anchor);
  if (p === null) return "";
  const [, m, d] = p;
  switch (rule) {
    case "daily":
      return "every day";
    case "weekly":
      return `every ${WEEKDAY_NAMES[(((dayNumber(p[0], m, d) + 4) % 7) + 7) % 7] ?? ""}`;
    case "monthly":
      return `every month on the ${ordinal(d)}`;
    case "yearly":
      return `every ${MONTH_NAMES[m - 1] ?? ""} ${String(d)}`;
  }
}
