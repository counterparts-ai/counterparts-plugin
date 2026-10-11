/**
 * The active-day clock — the ONE lived-day function (CONTRACT §5.4, scar E8).
 *
 * Every site that needs "which day is this" routes through here. This is the only
 * file in `physics/` allowed to touch `Date`; `test/physics.test.ts` asserts that
 * by scanning the sources (the totality test of guarantee 6 / scar §2.4).
 *
 * Rollover is at a LOCAL boundary hour, not UTC: a UTC rollover splits one lived
 * evening into two days and corrupts every occasion count downstream [v1 §11 G2].
 *
 * Pure: no I/O, no ambient clock reads. The caller supplies the instant.
 */

/** TUNABLE. Re-exported through `TUNABLES.BOUNDARY_HOUR` — this is the same number. */
export const BOUNDARY_HOUR_DEFAULT = 4;

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * The local calendar day an instant belongs to, given the boundary hour.
 * 2026-08-25 01:30 local with boundary 4 is still the lived day 2026-08-24.
 * Returns a sortable `YYYY-MM-DD` key (lexical order === chronological order).
 */
export function dayKey(at: Date | number, boundaryHour: number = BOUNDARY_HOUR_DEFAULT): string {
  const t = typeof at === "number" ? new Date(at) : new Date(at.getTime());
  t.setHours(t.getHours() - boundaryHour);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/**
 * The lived-day integer for `key`: the number of DISTINCT active days that came
 * before it. Days not lived do not advance the clock — a week away must not decay
 * a week's worth [engram E8]. A key not in `activeDays` gets the index it would
 * take if appended, so "today, first event of the day" is total, not a special case.
 */
export function livedDay(activeDays: readonly string[], key: string): number {
  let n = 0;
  for (const k of new Set(activeDays)) if (k < key) n++;
  return n;
}

/** Lived days elapsed between two active-day keys (never negative). */
export function livedDaysBetween(
  activeDays: readonly string[],
  fromKey: string,
  toKey: string,
): number {
  return Math.max(0, livedDay(activeDays, toKey) - livedDay(activeDays, fromKey));
}
