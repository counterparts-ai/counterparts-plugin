/**
 * THE CALENDAR DAY A PERSON LIVES ON — moved to `core/time.ts` (2026-09-25).
 *
 * This file was B3's local-day helper (owner's ruling 2026-09-23: the ask cap
 * and the nightly page writer take their day in the machine's LOCAL zone; self
 * NOTES §22). docs/time.md then made one module own every conversion, and that
 * module is `core/time.ts`. The two names this file exported stay importable
 * from here and from `self/index.ts`, so no caller had to move.
 */
export { calendarDate, readableDate } from "../time.js";
