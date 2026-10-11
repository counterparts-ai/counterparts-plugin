/* Every date the dashboard prints itself, in ONE style (2026-09-30): "Sep 30th",
   with the year when it is not this one ("Sep 30th, 2025") or when asked for,
   and the weekday where a title wants it ("Wed, Sep 30th"). Only dates the
   dashboard formats: a date inside stored words (a memory, the journal, the
   wake) is shown as it was written. No DOM in here, so the server's views
   (`views/mind.ts`, `narrate.ts`) use the same helper. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n) {
  const tens = n % 100;
  const end = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return n + end;
}

/**
 * `2026-09-30` → "Sep 30th"; null for anything that is not a calendar day, so a
 * caller says what it shows instead (`|| "lived day 3"`, `|| x`).
 * `opts.year`: true always prints it, false never; left out, it is printed
 * only when it is not this year. `opts.weekday` puts "Wed, " in front.
 */
export function dateWords(iso, opts = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const year = opts.year === undefined ? y !== new Date().getFullYear() : opts.year;
  return (opts.weekday ? WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()] + ", " : "") +
    MONTHS[mo - 1] + " " + ordinal(d) + (year ? ", " + y : "");
}

/** The same, for a value that may be something else (a lived day's words, a
 *  month, a range): those are shown as they came. */
export function dateOr(value, opts) {
  return dateWords(value, opts) || String(value || "");
}

/* No moment is turned into a day in here (2026-10-09). `stampWords` (a UTC
   minute) and `localIso` (the browser's calendar) were removed: the server
   dates every moment in the person's zone, the one the hooks use
   (`views/memory.ts#writtenWhen`, `views/health.ts`'s `cycle.on`), and the
   page prints the day it is handed. A browser's own zone can differ from the
   configured one, and one page then showed two days for one moment. */
