/**
 * Windows — the arithmetic of "has the remembered future arrived yet".
 *
 * **Precision is carried by the date's own shape, never rounded** (§12 G4): a
 * `2026-09` stays a month for its whole life and is never quietly turned into
 * `2026-09-01`. A month *means* early month more than the 29th, so the
 * precisions get different ramps rather than the same ramp on a rounded date.
 *
 * **The firing key IS the window** (§12 G9), which buys two properties without
 * any extra machinery: a clock repair cannot re-arm a spent window, because the
 * key never depended on the clock; and a reschedule opens a fresh key that owes
 * nothing to the old one's spent budget, because a different date is a different
 * key.
 *
 * **Calendar days here, lived days elsewhere** — deliberately (NOTES.md §1). The
 * event is a calendar fact and "three days before September 4th" is not
 * computable in lived days for a day nobody has lived yet. The once-per-lived-day
 * brake and `last_fired_day` are lived-day integers, and they live in `index.ts`.
 *
 * Pure: no ambient clock read anywhere in this file. The caller supplies `at`.
 * Every date is read by `core/time.ts#parseCalendarDate` (docs/time.md rule 1).
 */
import { addDays, daysBetween, isDay, monthBounds, occurrenceOf, occurrenceOnOrAfter, parseCalendarDate } from "../time.js";
import type { Recurrence } from "../time.js";
import type { ProspectiveTunables } from "./tunables.js";

/** As stated. `2026` / `2026-08` / `2026-08-25` / `2026-10-20..2026-10-31` —
 *  the four shapes a reminder date carries (`core/time.ts`, schema v7). */
export type DatePrecision = "day" | "month" | "year" | "range";

/** The precisions that can tactfully arrive. Year-only never does (§12 G3): a
 *  year names no day it could mean, so it has no window at all. */
export type WindowPrecision = "day" | "month" | "range";

export type Phase = "pending" | "arrived" | "passed";

export interface Window {
  /** `d:2026-08-25`, `m:2026-08` or `r:2026-10-20..2026-10-31`. The date is IN
   *  the key, on purpose (G9) — and ONLY the date: a month's stagger (below) is
   *  never part of it, so a clock repair still cannot re-arm a spent window. */
  readonly key: string;
  /** The event date exactly as stated — never widened, never narrowed. */
  readonly eventDate: string;
  readonly precision: WindowPrecision;
  /** First calendar day the window is open. */
  readonly opensOn: string;
  /** The day the ramp reaches full intensity: the date itself, the first day of
   *  a range, or a month's first day plus its stagger (`MONTH_STAGGER_DAYS`). */
  readonly peakOn: string;
  /** The last day the ramp stays at full intensity: `peakOn` for a day and a
   *  month, a range's LAST day — a range means all of itself. */
  readonly peakUntil: string;
  /** The first and last day the stated date covers — the span a person named,
   *  lead and grace excluded. After `lastDay` is "after" (tune question b). */
  readonly firstDay: string;
  readonly lastDay: string;
  /** Last calendar day the window is open (grace included). */
  readonly closesOn: string;
  /**
   * A RECURRING date's window (2026-10-09) is one occurrence of it: `eventDate`
   * is that occurrence, and these two say what it is an occurrence OF — the
   * day as stated and how often it comes round. Absent on a date that does
   * not repeat.
   */
  readonly anchor?: string;
  readonly recurring?: Recurrence;
}

/**
 * The calendar arithmetic is `core/time.ts`'s (2026-09-25, docs/time.md rule 1).
 * It used to live here on the UTC getters — correct, since a stated day is a
 * label and not a moment, but a second copy of the one conversion module's job.
 * Re-exported so `prospective/`'s public surface is unchanged.
 */
export { addDays, daysBetween, monthBounds };

/**
 * The precision a date STATES. Null means "not a date this module understands",
 * which the deriver reports as `malformed-date` — a refusal with a name, never a
 * silent skip (scar §2.4). EXACT: text that only reads once trimmed is not the
 * date as stated.
 */
export function precisionOf(date: string): DatePrecision | null {
  const c = parseCalendarDate(date);
  return c === null || c.text !== date ? null : c.precision;
}

const TAG: Readonly<Record<WindowPrecision, string>> = { day: "d:", month: "m:", range: "r:" };

export function windowKey(eventDate: string, precision: WindowPrecision): string {
  return `${TAG[precision]}${eventDate}`;
}

/** The inverse. Null for a key this module did not mint — refused, never guessed. */
export function parseWindowKey(key: string): { eventDate: string; precision: WindowPrecision } | null {
  const tag = key.slice(0, 2);
  const date = key.slice(2);
  const want: WindowPrecision | null =
    tag === "d:" ? "day" : tag === "m:" ? "month" : tag === "r:" ? "range" : null;
  if (want === null) return null;
  return precisionOf(date) === want ? { eventDate: date, precision: want } : null;
}

/**
 * Tune question (a) from v1's July gate (bansai `eval/replay/GATES.md` finding
 * 3): STAGGER MONTH WARMTH. Every month-dated item used to peak on the 1st, so a
 * month-heavy store spent its whole prospective pressure on the first boundaries
 * of the month. A STABLE per-memory offset of `0..MONTH_STAGGER_DAYS - 1` days
 * spreads the peaks across the early month instead. Stable, so a memory peaks on
 * the same day every time it is asked; derived from its id and nothing else, so
 * it is not a stored property either (§12 G2).
 */
export function staggerDays(salt: string, t: ProspectiveTunables): number {
  const n = Math.max(0, Math.floor(t.MONTH_STAGGER_DAYS));
  if (n <= 1 || salt.length === 0) return 0;
  // FNV-1a, 32-bit: a fixed spread, not a secret.
  let h = 0x811c9dc5;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % n;
}

/**
 * The window a stated date opens. Year precision returns null on purpose — it is
 * excluded structurally, not scored down (§12 G3).
 *
 * A DAY window peaks on the day. A MONTH window peaks early in the month (the
 * 1st plus its stagger) and decays across it, because that is what a stated month
 * means; rounding it to a day would invent a precision the author never claimed.
 * A RANGE (`2026-10-20..2026-10-31`, added 2026-09-26) is the author saying
 * exactly which days — "late October" — so it is at full intensity for the whole
 * span and decays only through grace.
 *
 * `salt` is the memory id, read only for a month's stagger. Absent: no stagger.
 */
export function windowFor(
  eventDate: string,
  precision: DatePrecision,
  t: ProspectiveTunables,
  salt = "",
): Window | null {
  if (precision === "year") return null;
  const c = parseCalendarDate(eventDate);
  if (c === null || c.text !== eventDate || c.precision !== precision) return null;
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
      closesOn,
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
    closesOn,
  };
}

/**
 * THE ONE WINDOW A RECURRING DATE HAS OPEN ON `at` (2026-10-09, the owner's
 * design, held lightly) — or, when none is open, the next one, pending.
 *
 * Each occurrence is its own day window, keyed by its own date (`d:2027-05-14`),
 * so every brake that is per window — the fire cap, once per lived day, the
 * plain latch per beat, referenced-stop, and what a revision carries through
 * `lineage` — is per OCCURRENCE without a line of its own: the birthday is
 * told once each May 14, never once ever and never twice.
 *
 * **Two occurrences are never open together.** Lead and grace are a week and
 * a half wide; a weekly or a daily date would otherwise have two to eleven
 * windows open at once, each with its own fire budget. So an occurrence's
 * window is cut where its neighbours' begin: it opens no earlier than the day
 * after the previous occurrence, and closes the day before the next one opens
 * — the coming one's lead wins over the last one's grace. A daily date's
 * window is its day; a weekly one opens three days before and keeps three days
 * of grace; monthly and yearly are untouched.
 *
 * Only a DAY repeats (`time.ts#occurrenceOf`). Anything else is null, and the
 * caller treats the date as stated, once.
 */
export function recurringWindowAt(
  anchor: string,
  rule: Recurrence,
  at: string,
  t: ProspectiveTunables,
  salt = "",
): Window | null {
  if (!isDay(anchor) || !isDay(at)) return null;
  const occ = (k: number): string | null => (k < 0 ? null : occurrenceOf(anchor, rule, k));
  const opensOf = (k: number): string => {
    const o = occ(k) as string;
    const lead = addDays(o, -t.LEAD_DAYS);
    const prev = occ(k - 1);
    if (prev === null) return lead;
    const after = addDays(prev, 1);
    return lead > after ? lead : after;
  };
  const windowOf = (k: number): Window | null => {
    const o = occ(k);
    if (o === null) return null;
    const w = windowFor(o, "day", t, salt);
    if (w === null) return null;
    const grace = addDays(o, t.GRACE_DAYS);
    const nextOpens = addDays(opensOf(k + 1), -1);
    return {
      ...w,
      opensOn: opensOf(k),
      closesOn: grace < nextOpens ? grace : nextOpens,
      anchor,
      recurring: rule,
    };
  };
  const next = occurrenceOnOrAfter(anchor, rule, at);
  if (next === null) return null;
  // Still in the last occurrence's grace, and the next one's lead not begun.
  const last = windowOf(next.k - 1);
  if (last !== null && at <= last.closesOn) return last;
  return windowOf(next.k);
}

/** ISO day keys sort lexically, so the comparisons below are the calendar order. */
export function phaseOf(w: Window, at: string): Phase {
  if (at < w.opensOn) return "pending";
  return at > w.closesOn ? "passed" : "arrived";
}

/**
 * How loudly the window is arriving, 0..1 — the RAMP, not a decision. It scales a
 * cue's weight into the ordinary competition; nothing here admits anything.
 *
 * Rises from `RAMP_OPEN` on the opening day to 1 at the peak, holds 1 through
 * `peakUntil` (a range's whole span; one day otherwise), then falls to
 * `RAMP_CLOSE` on the last grace day. For a month that decline spans the rest of
 * the month plus grace, which is precisely "a stated month means early month
 * more than the 29th" expressed as arithmetic rather than as a rounded date.
 */
export function rampAt(w: Window, at: string, t: ProspectiveTunables): number {
  if (phaseOf(w, at) !== "arrived") return 0;
  if (at <= w.peakOn) {
    const toPeak = daysBetween(w.opensOn, w.peakOn);
    if (toPeak <= 0) return 1;
    return t.RAMP_OPEN + (1 - t.RAMP_OPEN) * (daysBetween(w.opensOn, at) / toPeak);
  }
  if (at <= w.peakUntil) return 1;
  const tail = daysBetween(w.peakUntil, w.closesOn);
  if (tail <= 0) return 1;
  return 1 - (1 - t.RAMP_CLOSE) * (daysBetween(w.peakUntil, at) / tail);
}

/**
 * Tune question (d): IMMINENCE, used only to break a tie. Two numbers, smaller
 * first: days until the stated span begins (0 once it has), then how many days
 * the span covers — so "today" `[0, 1]` outranks "sometime this month" `[0, 30]`
 * at equal salience. That is the owner's May-1 rating in v1's gate: the garden
 * plots happening TODAY lost the wake slot to a month-vague showcase on a
 * 0.7 = 0.7 tie.
 */
export function imminence(w: Window, at: string): readonly [number, number] {
  const until = at >= w.firstDay ? 0 : daysBetween(at, w.firstDay);
  return [until, daysBetween(w.firstDay, w.lastDay) + 1];
}
