/**
 * The wake-briefing composition root — SEAMS item G closes here.
 *
 * `sleep/` guarantees ORDER (the re-render is the cycle's LAST content write, so
 * it sees this boundary's own supersedes, promotions, merges and prunes) and
 * nothing else; the atomic publish, the trim order and the sentinel counts stay
 * `self/`'s. Neither module imports the other, and a test on each side asserts
 * the absence. This file is the one line between them.
 *
 * Two numbers arrive from outside both modules, and that is the point:
 *
 *   - **`budgetBytes` is the HOST's reported injection ceiling** (scar §2.18 —
 *     the ceiling is a host capability, not a constant either module may invent).
 *     It rides in `SleepOptions.budgetBytes` so a wrong value is an argument
 *     somebody can see, and `self/` requires it: absent, this adapter REFUSES to
 *     render rather than guessing, because an invented ceiling is exactly the
 *     failure the scar names.
 *   - **`horizon` comes from `prospective/`**, never from `sleep/`
 *     (`self/INTERFACE-GAPS.md` §3: the lane, its heading and its trim position
 *     are already built; only the source was borrowed).
 */
import { plainDueOn } from "./prospective/index.js";
import type { RenderFn } from "./sleep/index.js";
import { isDay, readableRecurrence } from "./time.js";
import type { Recurrence } from "./time.js";

/** Structurally `Self`, so this file imports no class. */
export interface BriefingRenderer {
  boundary(req: {
    day: number;
    budgetBytes: number;
    ceilingBytes?: number;
    horizon?: readonly { id: string }[];
    horizonMore?: readonly string[];
    yesterday?: string;
  }): { briefing: { bytes: number; elements: number } };
}

/** Structurally `Prospective.horizon()`. */
export interface HorizonSource {
  horizon(input: { at: string; day?: number }): {
    items: readonly { memoryId: string; eventDate?: string; anchor?: string; recurring?: Recurrence; mode?: "quiet" | "plain" }[];
    /** Past `HORIZON_ITEMS`, by id (review of #367). */
    more?: readonly { memoryId: string }[];
  };
}

export interface RendererOptions {
  /** The calendar date the horizon asks about. Without it, no horizon lane. */
  at?: string;
  prospective?: HorizonSource;
  /** The "Yesterday" line, composed and dated by the root from yesterday's
   *  chapters (2026-10-01). Absent: no line. */
  yesterday?: string;
  /** Its shorter forms, widest first (review of #350): stepped down only to
   *  make room for "Still open"'s first item. */
  yesterdayShorter?: readonly string[];
  /** The room the delivery holds for "Work here", lent to the lanes above it
   *  (`self/briefing.ts#ROOM_ORDER`, review of #350). */
  lendBytes?: number;
  /** The room the delivery holds for "Last here" and the handoff pointer,
   *  lent after "Work here" and the Yesterday line's titles to "Arriving:"
   *  and "Still open"'s first item (`self/briefing.ts#ROOM_ORDER`,
   *  2026-10-10). */
  handoffLendBytes?: number;
  /** The rest of that room, the newest handoff's own block: lent to a plain
   *  reminder due the day the wake is read and nothing else
   *  (`self/briefing.ts#ROOM_ORDER`'s `handoffsKept`, review of #367). */
  handoffKeepBytes?: number;
  /** The host's reported budget the composition's was cut from, recorded with
   *  what the bundle showed so a session start can assemble its wake under the
   *  same ceiling (`self/#WAKE_SHOWN_KEY`, 2026-10-10). */
  ceilingBytes?: number;
  /** Telemetry only. A refusal must be loud, never a silently empty briefing. */
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}

export function selfRenderer(self: BriefingRenderer, opts: RendererOptions = {}): RenderFn {
  return (ctx) => {
    if (ctx.budgetBytes === undefined) {
      // Fail toward saying so. An invented ceiling would publish a briefing the
      // host silently truncates, which is the failure mode scar §2.18 records.
      opts.onEvent?.("briefing.no-budget", { day: ctx.day });
      return;
    }
    const asked = opts.prospective === undefined || opts.at === undefined ? undefined : horizonFor(opts.prospective, opts.at, ctx.day);
    const horizonMore = asked?.more ?? [];
    const horizon = asked?.items;
    const result = self.boundary({
      day: ctx.day,
      budgetBytes: ctx.budgetBytes,
      ...(opts.ceilingBytes === undefined ? {} : { ceilingBytes: opts.ceilingBytes }),
      ...(horizon === undefined ? {} : { horizon }),
      ...(horizonMore.length === 0 ? {} : { horizonMore }),
      ...(opts.yesterday === undefined ? {} : { yesterday: opts.yesterday }),
      ...(opts.yesterday === undefined || opts.yesterdayShorter === undefined ? {} : { yesterdayShorter: opts.yesterdayShorter }),
      ...(opts.lendBytes === undefined || opts.lendBytes <= 0 ? {} : { lendBytes: opts.lendBytes }),
      ...(opts.handoffLendBytes === undefined || opts.handoffLendBytes <= 0 ? {} : { handoffLendBytes: opts.handoffLendBytes }),
      ...(opts.handoffKeepBytes === undefined || opts.handoffKeepBytes <= 0 ? {} : { handoffKeepBytes: opts.handoffKeepBytes }),
    });
    return { bytes: result.briefing.bytes, elements: result.briefing.elements };
  };
}

/** One arriving item as the wake's "Arriving:" lane is handed it (`self/#HorizonItem`). */
export interface HorizonLine {
  readonly id: string;
  readonly due?: string;
  readonly every?: string;
  readonly past?: boolean;
  readonly plainDue?: boolean;
}

/**
 * THE "ARRIVING:" LANE'S ITEMS FOR THE DATE `at`, and the ids past
 * `prospective/`'s count (review of #367) — asked by the turn-end render
 * (`selfRenderer`) and, since 2026-10-10, by the wake assembled at session
 * start for the session's own date (`Counterpart#assembleWake`), so the two
 * hand the lane the same thing.
 */
export function horizonFor(prospective: HorizonSource, at: string, day?: number): { items: HorizonLine[]; more: string[] } {
  const asked = prospective.horizon({ at, ...(day === undefined ? {} : { day }) });
  // What the count left out, by id: the lane names them in its "N more"
  // line rather than leave a dated item silently missing (review of #367).
  const more = (asked.more ?? []).map((i) => i.memoryId);
  // The date it is due rides along, so the line can say it (2026-10-01),
  // how often it comes round when it repeats (2026-10-09), and whether
  // that date is already behind the day asked about — a one-off in its
  // grace days says it WAS due (2026-10-09). Both are `YYYY-MM-DD`
  // here, so the strings compare as the dates do.
  const items = asked.items.map((i): HorizonLine => {
    if (i.eventDate === undefined) return { id: i.memoryId };
    const every = i.anchor === undefined || i.recurring === undefined ? "" : readableRecurrence(i.anchor, i.recurring);
    return {
      id: i.memoryId,
      due: i.eventDate,
      ...(every === "" ? {} : { every }),
      ...(isDay(i.eventDate) && isDay(at) && i.eventDate < at ? { past: true } : {}),
      // A plain reminder due the day this wake is read (2026-10-10):
      // it leads the lane and outranks the page's borrowing.
      ...(plainDueOn(i, at) ? { plainDue: true } : {}),
    };
  });
  return { items, more };
}
