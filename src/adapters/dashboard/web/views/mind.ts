/**
 * `/api/mind` — identity, the briefing, the journal, the revision stories.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { TUNABLES as PHYSICS, promotionEligibility, sal } from "../../../../core/physics/index.js";
import type { PromotionVerdict } from "../../../../core/physics/index.js";
import { isConfidential } from "../../../../core/recall/index.js";
import {
  FRAMING,
  LANE_ORDER,
  collapsedLane,
  SELF_PAGE_REVISED_EVENT,
  chapterModels,
  dayBefore,
  pageSections,
  readChapterLead,
  readPageTooLargeDetail,
} from "../../../../core/self/index.js";
import type { PageVersion, PageWriterRun, PageWriterStatus } from "../../../../core/self/index.js";
import { TUNABLES as SLEEP, coreContextFor, isJournal } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import { localDate } from "../../../../core/time.js";
import type { DashboardSource } from "../../source.js";
import { WITHHELD, reveal } from "../reveal.js";
// @ts-expect-error — a plain browser module, no declarations
import { dateOr } from "../shared/dates.js";
import { chapters, contestedRows, livedDays } from "./rows.js";
import { coreHistory, dreamsView } from "./dreams.js";
import type { CoreHistory, DreamsView } from "./dreams.js";
import { selfMap } from "./self-map.js";
import type { SelfMap } from "./self-map.js";
import { traitsView } from "./traits.js";
import type { TraitsView } from "./traits.js";
import type { ChapterRow, ContestedRow } from "./rows.js";

// ─────────────────────────────────────────────────────────────────────────────
// mind — identity, the briefing, the journal, the revision stories
// ─────────────────────────────────────────────────────────────────────────────

export interface WakeLane {
  /** The lane's own heading, as the briefing writes it. */
  readonly heading: string;
  /** The lane name, when this is one of `self/`'s lanes; null for the preface. */
  readonly lane: string | null;
  /** One element per line, bullets stripped. Verbatim otherwise. */
  readonly items: string[];
}

export interface StoryBeat {
  readonly day: number;
  readonly challenger: string;
  readonly force: number;
  readonly pressureAfter: number;
  readonly bar: number;
  readonly fraction: number;
  /** One clause, in prose. Never an id: an id in a sentence is a leak. */
  readonly verdict: string;
  /** What it became, when it became something — as words, resolved now. */
  readonly became: string | null;
  /** The successor's address, for a link. Kept OUT of `verdict`. */
  readonly becameId: string | null;
  readonly crossed: boolean;
}

export interface StoryView extends ContestedRow {
  readonly beats: StoryBeat[];
  readonly beatsAbsent: string | null;
}

export interface MindView {
  readonly opening: string;
  readonly identity: { id: string; text: string; kind: Kind; band: Band; strength: number; bytes: number; bornDay: number; lastUsedDay: number; confidential: boolean }[];
  readonly identityAbsent: string | null;
  readonly guarded: { id: string; text: string; kind: Kind; band: Band; strength: number; bytes: number; bornDay: number; lastUsedDay: number; confidential: boolean }[];
  readonly guardedAbsent: string | null;
  readonly both: string[];
  readonly protectedOutsideIdentity: { id: string; text: string }[];
  readonly unreadable: { id: string; label: string }[];
  readonly wake: {
    readonly ok: boolean;
    readonly reason: string;
    readonly bytes: number;
    readonly preface: string | null;
    readonly lanes: WakeLane[];
    readonly absent: string | null;
  };
  /**
   * THE WRITTEN PAGE, and what it used to say (2026-09-18, S1). Read-only, like
   * everything else here: the dashboard shows the page and its versions and
   * offers no door to write one — the doors are the MCP tool and the console.
   *
   * The BODIES ride along; the self tab draws them as a timeline and diffs
   * neighbouring versions in the browser (`pages/self/diff.js`).
   */
  readonly page: {
    readonly present: boolean;
    readonly body: string;
    readonly bytes: number;
    readonly revisedOn: string;
    readonly by: string | null;
    readonly reason: string | null;
    readonly version: number;
    readonly stale: boolean;
    /** Calendar days without a rewrite past which `stale` turns true (`self/`'s PAGE_STALE_DAYS). */
    readonly staleAfter: number;
    readonly core: string;
    readonly lately: string;
    readonly headed: boolean;
    /** Every `#`-headed section, in order — any heading, not only Core and Lately (2026-09-28). */
    readonly sections: readonly { readonly heading: string; readonly body: string }[];
  } | null;
  /** The honest absence line when no page has been written. */
  readonly pageAbsent: string | null;
  /**
   * HOW FAR BEHIND THE PAGE IS (round 3, S1): once it is `PAGE_BEHIND_LIVED_DAYS`
   * lived days old, what has been lived since, in one calm line shown above it.
   * Null while it is fresher than that, or when it has no lived day to count from.
   */
  readonly pageBehind: PageBehind | null;
  /** Each body labelled with the write that PRODUCED it, and with what replaced
   *  it named separately — `store.revise` stores the replacing reason on the row
   *  it archives, so the two must not share a word (adversarial review M3). */
  readonly pageVersions: PageVersion[];
  readonly chapters: ChapterRow[];
  readonly chaptersAbsent: string | null;
  readonly stories: StoryView[];
  readonly storiesAbsent: string | null;
  /** The page's whole life, OLDEST first, the standing page last. */
  readonly pageHistory: PageStep[];
  /**
   * THE PAGE'S HISTORY AS ONE STRIP (round 3b, item 1): one entry per lived day
   * from the page's first dated version to today, oldest first — rewritten that
   * day, or not and why.
   */
  readonly pageDays: PageDay[];
  /** Versions whose lived day was never recorded, so no dot can carry them (counted, not dropped). */
  readonly pageDaysUndated: number;
  /** Lived days older than the strip carries (`PAGE_DAYS_MAX`), counted, not dropped silently. */
  readonly pageDaysEarlier: number;
  /** What is settling into the core, and what is closest to it. */
  readonly settling: SettlingView;
  /**
   * THE SELF MAP (round 3b, item 4; an experiment): the memories about me or
   * about us as dots and the links between them (`views/self-map.ts`).
   */
  readonly map: SelfMap;
  /**
   * HOW I ACT (2026-09-27, a try): the seven trait axes, each with its
   * firmness-weighted balance and a week-ago one (`views/traits.ts`).
   */
  readonly traits: TraitsView;
  /**
   * WHAT THE NEXT WAKE STARTS WITH (round 3b, item 2), as a short list: the
   * page and its age, the nearby memories by title, anything arriving. Its size
   * against the budget is the health tab's now (`healthView#wake`).
   */
  readonly wakeList: WakeList;
  /** The journal by lived day, newest first. */
  readonly journal: JournalDay[];
  readonly journalAbsent: string | null;
  /** Chapters past the ones sent. 0 when all of them are here. */
  readonly journalMore: number;
  /** What the nightly page writer did on the newest night it has a row for. */
  readonly writer: WriterLine;
  /**
   * THE DREAM JOURNAL (2026-09-26): each dream with its journal and its
   * changes. The owner's to read — a dream is not a memory and never becomes
   * one (`views/dreams.ts`).
   */
  readonly dreams: DreamsView;
  /** `(never run)` when this store has never dreamed; null otherwise. */
  readonly dreamsAbsent: string | null;
}

/**
 * The page writer's newest night, in plain words (2026-09-26, the self tab's
 * side column; an experiment). Read from the newest `self.page.writer.ran` row
 * through `self/`'s own `pageWriterStatus`, so a claim whose day has passed
 * reads the way doctor reads it, and a derived reading is worded as ours.
 */
export interface WriterLine {
  /** False when the log holds no run at all. */
  readonly ran: boolean;
  /** The night's date (the day the run read), "" when none. */
  readonly about: string;
  readonly outcome: string | null;
  /** True when no row says this: it is read from a claim whose day is over. */
  readonly derived: boolean;
  /** True when that night is last night. */
  readonly lastNight: boolean;
  /** "Last night", "The night of Jul 9", or "" when nothing ran. */
  readonly when: string;
  /** What it did — or what did not happen, and why — in plain words. */
  readonly what: string;
  /**
   * WHAT WOULD MAKE IT HAPPEN (round 3, S2), when a night did not: one short
   * sentence, or null when the night went as it should or nothing honest can
   * be said. Never a guess about the store's settings.
   */
  readonly next: string | null;
  /** `when: what`, and `next` after it, as the page prints it: one line. */
  readonly line: string;
  /** The longer story, for the line's `?`: what the writer is, what the record says. */
  readonly more: string;
  /** `(never run)` when the log holds no run; null otherwise. */
  readonly absent: string | null;
}

/** One state of the page: an archived version, or the one standing now. */
export interface PageStep {
  /** 1-based, oldest first — the number a person would count. */
  readonly n: number;
  /** The store's version seq; for the standing page, its `version` + 1. */
  readonly seq: number;
  readonly current: boolean;
  /** The lived day of the write that produced it (not the day it was replaced); null when unrecorded. */
  readonly day: number | null;
  /** Calendar date of the write that produced it (the durable row's clock); null when unrecorded. */
  readonly date: string | null;
  readonly by: string | null;
  readonly reason: string | null;
  readonly body: string | null;
  readonly bytes: number | null;
}

/**
 * One memory about me or about us, on its way to the core (2026-09-26): how far
 * along each lane it is. Fast: how strongly it was felt against the bar, and
 * whether it has come back after a gap. Slow: on how many separate lived days
 * it came back, over how many.
 */
export interface Candidate {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly kind: Kind;
  readonly feeling: number;
  readonly needFeeling: number;
  readonly returned: boolean;
  readonly days: number;
  readonly requiredDays: number;
  readonly span: number;
  readonly needSpan: number;
  /** The lane that is met, when one is: the next consolidation crosses it (the nightly cap permitting). */
  readonly lane: "fast" | "slow" | null;
  readonly eligible: boolean;
  /**
   * THE FAST LANE'S ROAD (round 3, S3): felt strongly enough, and nothing but
   * a lane stands in the way, so ONE awake return after the gap makes it core.
   * Read off the engine's own verdict (`oneReturnAway`), never re-derived here.
   */
  readonly oneReturnAway: boolean;
}

export interface SettlingRow {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly kind: Kind;
}

export interface SettlingView {
  /** The identity band — the core. */
  readonly core: SettlingRow[];
  /** Protected (permanent) rows. */
  readonly guarded: SettlingRow[];
  /** Beliefs under challenge, or already revised. */
  readonly contested: { id: string; about: string; now: string; revised: boolean; fraction: number; pressure: number; bar: number }[];
  /** Permanent rows that do not stand in the band. */
  readonly outside: SettlingRow[];
  /** Identity-band rows that would not read. Shown whenever there are any. */
  readonly unreadable: { id: string; label: string }[];
  /** The closest candidates, closest first. */
  readonly candidates: Candidate[];
  /** Memories about me or about us that have come back at least once. */
  readonly onTheWay: number;
  /** Memories about me or about us that have not come back yet. */
  readonly unused: number;
  /** Memories that are not about me or about us: the core is not for them. */
  readonly outOfReach: number;
  /** Memories about me or about us the owner sent back from the core: out of it, and not on the way. */
  readonly sentBack: number;
  /**
   * WHAT CROSSED LATELY (2026-09-26): the newest promotions with their lane
   * ("became core last night"), the owner's demotions with his reason, and the
   * memories dreams nominated. From `core_events`.
   */
  readonly history: CoreHistory;
  /** The rule, as numbers, so the page states it rather than restating it. */
  readonly rule: {
    needFeeling: number;
    needGap: number;
    days: number;
    span: number;
    everyDays: number;
    cap: number;
  };
  /** Two-word absences, for each list that is empty. */
  readonly coreAbsent: string | null;
  readonly guardedAbsent: string | null;
  readonly contestedAbsent: string | null;
}

export interface WakePart {
  readonly label: string;
  /** The lane name, "page", "furniture" — a stable key for colour. */
  readonly key: string;
  readonly bytes: number;
}

export interface JournalChapter {
  readonly id: string;
  /** The chapter number inside its session's entry. */
  readonly chapter: number;
  readonly title: string;
  readonly model: string | null;
  readonly first: string;
  /** The chapter's own text, headings off. Null when withheld. */
  readonly text: string | null;
  readonly bytes: number;
  readonly confidential: boolean;
}

export interface JournalDay {
  readonly day: number;
  /** As the chapter heading wrote it (`Wed 23 Sep 2026`); null when it named none. */
  readonly date: string | null;
  /**
   * The day's calendar date as `YYYY-MM-DD` (round 3, S4): the heading's date,
   * else the entry's own, so the strip shows every day in one format. Null
   * only when neither reads.
   */
  readonly iso: string | null;
  readonly chapters: JournalChapter[];
}

export function mindView(src: DashboardSource): MindView {
  const store = src.store;
  const day = store.livedDay();
  const e = src.self.enumerate(day);
  const wake = src.self.wake();
  const page = src.self.page();
  const sections = pageSections(page?.body ?? "");
  const everLived = day > 0 || store.list().length > 0;
  const seen = new Set(e.identity.map((el) => el.id));
  const unreadable = store
    .list({ band: "identity", archived: false })
    .filter((id) => !seen.has(id))
    .map((id) => ({ id, label: reveal(store, id, 72).label }));

  const shape = (el: { id: string; kind: Kind; band: Band; strength: number; bytes: number }): MindView["identity"][number] => {
    const r = reveal(store, el.id, 120);
    return {
      id: el.id,
      text: r.text ?? r.label,
      kind: el.kind,
      band: el.band,
      strength: el.strength,
      bytes: el.bytes,
      ...livedDays(src, el.id),
      confidential: r.confidential,
    };
  };

  const identity = e.identity.map(shape);
  const guarded = e.protected.map(shape);
  const outside = e.protectedOutsideIdentity.map((id) => {
    const r = reveal(store, id, 90);
    return { id, text: r.text ?? r.label };
  });
  const stories = storyViews(src);
  const read = journalChapters(src);
  const history = pageHistory(src, page);
  const candidates = coreCandidates(src, page?.id ?? null);

  return {
    opening: `Day ${day} · Who I am`,
    identity,
    identityAbsent: e.identity.length === 0 ? (everLived ? NONE : NEVER) : null,
    guarded,
    guardedAbsent: e.protected.length === 0 ? (everLived ? NONE : NEVER) : null,
    both: e.both,
    protectedOutsideIdentity: outside,
    unreadable,
    wake: {
      ok: wake.ok,
      reason: wake.reason,
      bytes: wake.bytes,
      preface: wake.preface,
      lanes: wake.ok ? wakeLanes(wake.text) : [],
      absent: wake.ok ? null : everLived ? NONE : NEVER,
    },
    page:
      page === null
        ? null
        : {
            present: true,
            body: page.body,
            bytes: page.bytes,
            revisedOn: page.revisedOn,
            by: page.by,
            reason: page.reason,
            version: page.version,
            stale: src.self.pageStale(page),
            staleAfter: src.self.tunables.PAGE_STALE_DAYS,
            // The three the type declares, NAMED — a spread of `pageSections`
            // also carried `preamble` into the JSON, which `tsc` cannot catch
            // through a spread (adversarial review n2).
            core: sections.core,
            lately: sections.lately,
            headed: sections.headed,
            // EVERY SECTION, in the page's order (2026-09-28): "Us" and "How
            // I work" are sections too, not only the Core/Lately convention.
            sections: sections.sections.map((x) => ({ heading: x.heading, body: x.body })),
          },
    pageAbsent: page === null ? (everLived ? NONE : NEVER) : null,
    // NOT guarded on the live page: a CLEARED page has no live row and still has
    // a history, and the console lists it. Two surfaces answering "what did the
    // page used to say" differently is the same class of mismatch the version
    // reasons were (M3). `pageVersions` handles the no-live-row case itself.
    pageVersions: src.self.pageVersions(),
    chapters: chapters(src, 12),
    chaptersAbsent: chapters(src, 1).length === 0 ? (everLived ? NONE : NEVER) : null,
    stories,
    storiesAbsent: stories.length === 0 ? (everLived ? NONE : NEVER) : null,
    pageHistory: history,
    ...pageDays(src, history),
    settling: settlingView(src, {
      core: identity,
      guarded,
      outside,
      unreadable,
      stories,
      candidates,
      absent: everLived ? NONE : NEVER,
    }),
    map: selfMap(src, identity, candidates.raw),
    traits: traitsView(src),
    wakeList: wakeList(src, wake.ok ? wake.text : null, page),
    ...journal(read, JOURNAL_LIMIT, everLived ? NONE : NEVER),
    pageBehind: pageBehind(src, page, read),
    writer: writerLine(src),
    ...dreamsPart(src),
  };
}

/** The dream journal, and its absence line when there has never been a dream. */
function dreamsPart(src: DashboardSource): { dreams: DreamsView; dreamsAbsent: string | null } {
  const dreams = dreamsView(src);
  return { dreams, dreamsAbsent: dreams.dreams.length === 0 ? NEVER : null };
}

// ─────────────────────────────────────────────────────────────────────────────
// the page writer's last night, in plain words
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a run did not happen or did not finish, in words — and, round 3 (S2),
 * what would make it happen, and the longer story for the `?`. Only `no-room`
 * and `scope-question` ever reach a durable `skipped` row (the hooks'
 * `noteWriterDeferred`); the rest arrive as a `failed`/`refused` detail. A code
 * nobody mapped keeps its own words (hyphens read as spaces) and gets no
 * `next`, rather than being guessed at.
 */
interface WriterReasonWords {
  /** The cause, as a clause. */
  readonly why: string;
  /** What would make it happen, as a sentence; `lastNight` = the night is still today's to catch. */
  readonly next?: (lastNight: boolean) => string;
  /** One or two sentences for the `?`. */
  readonly more?: (lastNight: boolean) => string;
}

const TONIGHT = "Tonight's run tries again.";

const WRITER_REASON: Record<string, WriterReasonWords> = {
  watchdog: { why: "it ran out of time", next: () => TONIGHT },
  // The two reasons of the RETIRED session-start ask (2026-09-28): rows
  // written before still carry them. The writer runs inside the nightly run
  // now, which has neither limit.
  "no-room": {
    why: "the session start had no room left to ask (the old way)",
    next: () => "It runs inside the nightly run now, where there is room.",
    more: () =>
      "Until 2026-09-28 the page writer was asked at the start of a session, beside the wake, and only when the ask fitted what the host lets a session start with. " +
      "This night it did not fit, so it was held back rather than cut short. The writer runs inside the nightly run now, handed its day in a tool result, with no such limit.",
  },
  "scope-question": {
    why: "the first-launch question took its turn (the old way)",
    next: () => "It runs inside the nightly run now, and waits for no question.",
    more: () => "Until 2026-09-28 a session start carried one question at most, and the first-launch question could go first. The writer runs inside the nightly run now.",
  },
  off: {
    why: "the writer is switched off",
    next: () => "Turning it on (pageWriter.mode in claude-code.json) brings it back.",
  },
  "host-mode": { why: "it runs in host mode, from its own windowless session" },
  observer: { why: "the session was read-only", next: () => "An ordinary session will be asked." },
  "no-previous-day": { why: "there was no earlier day to read" },
  "already-claimed": { why: "that night was already handled" },
  "asks-spent": { why: "it had already been asked as often as it may", next: () => TONIGHT },
  "no-memories": { why: "nothing was remembered that day" },
  "not-host-mode": { why: "it is not set to run on its own" },
};

export function writerReason(detail: string): string {
  const d = detail.trim();
  if (d === "") return "no reason was recorded";
  const known = WRITER_REASON[d];
  if (known !== undefined) return known.why;
  const exit = /^exit (\S+)$/.exec(d);
  if (exit !== null) return `it stopped with an error (exit ${exit[1] as string})`;
  // A page refused for length carries its numbers (review of #358).
  const large = readPageTooLargeDetail(d);
  if (large !== null) {
    return `the page it sent was ${String(large.bytes)} bytes, ${String(large.over)} over the ${String(large.limit)}-byte limit${large.then === "" ? "" : `, and was ${large.then}`}`;
  }
  return d.replace(/[-_]+/g, " ");
}

/** What would make a night that did not happen happen; null when nothing honest can be said. */
function writerNext(detail: string, lastNight: boolean): string | null {
  const d = detail.trim();
  const known = WRITER_REASON[d];
  if (known !== undefined) return known.next === undefined ? null : known.next(lastNight);
  if (/^exit \S+$/.test(d)) return TONIGHT;
  if (readPageTooLargeDetail(d) !== null) return TONIGHT;
  return null;
}

const WRITER_IS =
  "The page writer reads the day just gone, once a night — the first part of the nightly run, before the dream and the reflection — and rewrites the page when something about who I am moved.";
const WRITER_ABOUT = `${WRITER_IS} This is its newest night.`;

/** "2026-07-09" → "Jul 9th" (the dashboard's one date style); anything else as it came. */
const shortDay = (iso: string): string => dateOr(iso) as string;

/** What `writerWords` reads: `pageWriterStatus`'s answer, or null when the log
 *  holds no run at all. */
export type WriterReading =
  | (Pick<PageWriterStatus, "about" | "outcome" | "derived"> & {
      readonly run: (Pick<PageWriterRun, "detail"> & Partial<Pick<PageWriterRun, "on">>) | null;
    })
  | null;

/** The words for one night. Pure, so every outcome is tested without a store. */
export function writerWords(status: WriterReading, yesterday: string): WriterLine {
  if (status === null) {
    const none = "No run recorded yet";
    return {
      ran: false, about: "", outcome: null, derived: false, lastNight: false, when: "", what: none, next: null, line: none,
      more: `${WRITER_IS} It has not run on this store yet.`, absent: NEVER,
    };
  }
  const detail = status.run?.detail ?? "";
  const lastNight = status.about !== "" && status.about === yesterday;
  // The reason's own words and remedy apply only where the row's detail IS a
  // reason: a skip, a failure the writer reported, a refusal.
  let what: string;
  let next: string | null = null;
  let reasoned = false;
  switch (status.outcome) {
    case "revised":
      what = "rewrote it";
      break;
    case "nothing-to-say":
      // A derived reading is OURS: the session was handed the day and nothing
      // came back. It must not read as something the writer reported.
      what = status.derived ? "was handed the day and left it as is" : "read the day and kept it as is";
      break;
    case "refused":
      what = `tried, but the rewrite was turned away — ${writerReason(detail)}`;
      reasoned = true;
      break;
    case "failed":
      // Derived: a `started` claim still standing once its day was over.
      if (status.derived) {
        what = "started and never finished";
        next = TONIGHT;
      } else {
        what = `couldn't rewrite it — ${writerReason(detail)}`;
        next = writerNext(detail, lastNight);
        reasoned = true;
      }
      break;
    case "asked":
      what = "was handed the day in today's nightly run; no answer yet";
      break;
    case "started":
      what = "is running now";
      break;
    default:
      if (status.run === null) {
        what = "nothing ran, and nothing says why";
      } else {
        what = `not rewritten — ${writerReason(detail)}`;
        next = writerNext(detail, lastNight);
        reasoned = true;
      }
  }
  const when = lastNight ? "Last night" : status.about === "" ? "Its last run" : `The night of ${shortDay(status.about)}`;
  const on = status.run?.on ?? "";
  const recorded = isIsoDay(on) ? ` Recorded ${shortDay(on)}.` : "";
  const story = reasoned ? WRITER_REASON[detail.trim()]?.more?.(lastNight) : undefined;
  const more = WRITER_ABOUT + (story === undefined ? "" : ` ${story}`) + recorded;
  const line = `${when}: ${what}.` + (next === null ? "" : ` ${next}`);
  return { ran: true, about: status.about, outcome: status.outcome, derived: status.derived, lastNight, when, what, next, line, more, absent: null };
}

function writerLine(src: DashboardSource): WriterLine {
  try {
    const today = src.self.calendarToday();
    const last = src.self.pageWriterRuns()[0];
    if (last === undefined) return writerWords(null, dayBefore(today));
    return writerWords(src.self.pageWriterStatus(last.about, today), dayBefore(today));
  } catch {
    return writerWords(null, "");
  }
}

/** How many chapters the journal sends. The rest are counted, not dropped silently. */
const JOURNAL_LIMIT = 60;

// ─────────────────────────────────────────────────────────────────────────────
// how far behind the page is (round 3, S1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lived days since the page's last rewrite at which the self tab says so above
 * it. A dashboard choice about WHEN TO MENTION it, not a rule about the page:
 * the writer runs nightly, so one day behind is ordinary and two is worth a
 * line. (`self/`'s own `PAGE_STALE_DAYS` is calendar days and drives doctor and
 * the side column's chip; the two answer different questions and both stand.)
 */
export const PAGE_BEHIND_LIVED_DAYS = 2;

export interface PageBehind {
  /** The page's `revisedOn`, `YYYY-MM-DD`, or "" when it recorded none. */
  readonly date: string;
  /** The lived day it was written on. */
  readonly writtenDay: number;
  readonly livedDays: number;
  /** Chapters written on a lived day after the page's. */
  readonly chapters: number;
  /** Dreams dreamed on a lived day after the page's. */
  readonly dreams: number;
  /** The whole line, as the tab prints it. */
  readonly line: string;
}

/** "a dream" / "3 dreams" — `a` for one, the number otherwise. */
function countOf(n: number, one: string, many: string): string {
  return n === 1 ? `a ${one}` : `${String(n)} ${many}`;
}

/**
 * The line, in words: "Written Sep 24th — 3 lived days, 14 chapters and a dream
 * since." Calm on purpose: a page a few days behind is information, not an
 * alarm. Pure, so every shape is tested without a store.
 */
export function pageBehindWords(x: { date: string; writtenDay: number; livedDays: number; chapters: number; dreams: number }): string {
  const when = isIsoDay(x.date) ? shortDay(x.date) : `on lived day ${String(x.writtenDay)}`;
  const parts = [x.livedDays === 1 ? "1 lived day" : `${String(x.livedDays)} lived days`];
  if (x.chapters > 0) parts.push(countOf(x.chapters, "chapter", "chapters"));
  if (x.dreams > 0) parts.push(countOf(x.dreams, "dream", "dreams"));
  const list = parts.length === 1 ? parts[0] as string : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] as string}`;
  return `Written ${when} — ${list} since.`;
}

/** How many dreams a store is asked for when counting the ones since the page. */
const DREAMS_COUNTED = 1_000;

function pageBehind(
  src: DashboardSource,
  page: ReturnType<DashboardSource["self"]["page"]>,
  chapters: readonly ReadChapter[],
): PageBehind | null {
  if (page === null || page.revisedDay === null) return null;
  const writtenDay = page.revisedDay;
  const livedDays = src.store.livedDay() - writtenDay;
  if (livedDays < PAGE_BEHIND_LIVED_DAYS) return null;
  let dreams = 0;
  try {
    dreams = src.store.dreams({ limit: DREAMS_COUNTED }).filter((d) => d.day > writtenDay).length;
  } catch {
    /* no dreams table to read: none are counted, and none are claimed */
  }
  const x = {
    date: page.revisedOn.trim(),
    writtenDay,
    livedDays,
    chapters: chapters.filter((c) => c.day > writtenDay).length,
    dreams,
  };
  return { ...x, line: pageBehindWords(x) };
}

// ─────────────────────────────────────────────────────────────────────────────
// the page's history — a timeline, oldest first
// ─────────────────────────────────────────────────────────────────────────────

/** The person's calendar day for a clock reading, in the store's zone (`core/time.ts`). */
function dateOfMs(at: number, zone: string): string | null {
  if (!Number.isFinite(at) || at <= 0) return null;
  return localDate(at, zone);
}

/**
 * Every state the page has been in, OLDEST first, the standing page last.
 *
 * `pageVersions()` already says who wrote each archived body and why; the
 * calendar date comes from the same durable `self.page.revised` rows, matched
 * the same way (the write that produced version `seq` recorded `version: seq - 1`).
 * A cleared page has no standing row and keeps its history, so the timeline
 * still draws.
 */
function pageHistory(src: DashboardSource, page: ReturnType<DashboardSource["self"]["page"]>): PageStep[] {
  const versions = src.self.pageVersions().slice().sort((a, b) => a.seq - b.seq);
  const at = new Map<number, number>();
  const onDay = new Map<number, number>();
  const pageId = page?.id ?? null;
  const zone = src.store.zone();
  try {
    // NEWEST first (2026-10-09, audit #1's last caller): past `LOG_LIMIT` an
    // ascending read kept the oldest rows, and the newest versions — the ones
    // the timeline ends on — lost their dates. The first row seen for a version
    // is its newest, as the last one seen was when this read ascended.
    const rows = pageId === null
      ? src.store.eventLog({ name: SELF_PAGE_REVISED_EVENT, order: "desc", limit: LOG_LIMIT })
      : src.store.eventLog({ name: SELF_PAGE_REVISED_EVENT, ref: pageId, order: "desc", limit: LOG_LIMIT });
    for (const row of rows) {
      const payload = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
      const v = payload["version"];
      if (typeof v === "number" && !at.has(v)) {
        at.set(v, row.at);
        onDay.set(v, row.day);
      }
    }
  } catch {
    /* unreadable log: every date reads as unrecorded, never as a guess */
  }
  // THE LIVED DAY A VERSION WAS WRITTEN ON (round 3b). `PageVersion.day` is
  // the day the version was ARCHIVED — the day the next write replaced it — so
  // the write that produced version `seq` is the one that archived `seq - 1`,
  // on that version's `day`. The durable row's own day says it directly and
  // wins; the first version has only the row.
  const steps: PageStep[] = versions.map((v, i) => ({
    n: i + 1,
    seq: v.seq,
    current: false,
    day: onDay.get(v.seq - 1) ?? (i > 0 ? (versions[i - 1] as PageVersion).day : null),
    date: at.has(v.seq - 1) ? dateOfMs(at.get(v.seq - 1) as number, zone) : null,
    by: v.by,
    reason: v.reason,
    body: v.body,
    bytes: v.bytes,
  }));
  if (page !== null) {
    steps.push({
      n: steps.length + 1,
      seq: page.version + 1,
      current: true,
      day: page.revisedDay,
      date: page.revisedOn.length > 0 ? page.revisedOn : at.has(page.version) ? dateOfMs(at.get(page.version) as number, zone) : null,
      by: page.by,
      reason: page.reason,
      body: page.body,
      bytes: page.bytes,
    });
  }
  return steps;
}

/** Rows the page's history and its day strip read per event name, newest first. */
export const LOG_LIMIT = 2_000;

// ─────────────────────────────────────────────────────────────────────────────
// the page's history as one strip of lived days (round 3b, item 1)
// ─────────────────────────────────────────────────────────────────────────────

/** One lived day on the page's strip. */
export interface PageDay {
  readonly day: number;
  /** Its calendar date (`YYYY-MM-DD`) when the record gives one; null otherwise. */
  readonly date: string | null;
  readonly today: boolean;
  /** The seqs of the versions written that day, oldest first; empty when it was not rewritten. */
  readonly seqs: number[];
  /** Who wrote the newest of them, and the reason it gave. */
  readonly by: string | null;
  readonly reason: string | null;
  /** A day not rewritten: what happened, and what would make it happen, in one line. Null on a rewritten day. */
  readonly why: string | null;
  /** The longer story behind `why`, for its `?`. */
  readonly more: string | null;
}

/** How many lived days the strip carries at most, the newest kept. */
export const PAGE_DAYS_MAX = 90;
/** How many writer runs are read to word the days. */
const WRITER_RUNS_READ = 500;

/**
 * A day's words from the writer's own reading of its night: the S2 words
 * (`writerWords`), led by what happened rather than by the night it was about,
 * since the dot is the day the run happened on. Pure.
 */
export function pageDayWords(w: Pick<WriterLine, "what" | "next">): string {
  const what = w.what;
  const lead = /^(not |nothing )/.test(what) ? what.charAt(0).toUpperCase() + what.slice(1) : `The page writer ${what}`;
  return `${lead}.` + (w.next === null ? "" : ` ${w.next}`);
}

/** The words for a lived day nothing in the record speaks for. Pure. */
export function pageDayUnrecorded(today: boolean): { why: string; more: string } {
  return today
    ? { why: "Not rewritten today; the page writer has not run yet.", more: `${WRITER_IS} It runs at most once a night, when a session starts.` }
    : { why: "Not rewritten, and the page writer left no record that day.", more: `${WRITER_IS} Nothing in the record says it ran on this lived day.` };
}

/**
 * One entry per lived day from the page's first dated version to today. A day
 * with versions is "rewritten" and carries their seqs (the strip opens the
 * newest, diffed against the one before it). Any other day is worded from the
 * newest page-writer run that HAPPENED on it (`run.day`), read through `self/`'s
 * own `pageWriterStatus`, so a claim whose day is over reads as doctor reads
 * it; a day with no run says so, never a guess.
 */
function pageDays(src: DashboardSource, history: readonly PageStep[]): { pageDays: PageDay[]; pageDaysUndated: number; pageDaysEarlier: number } {
  const dated = history.filter((s) => s.day !== null);
  const undated = history.length - dated.length;
  if (dated.length === 0) return { pageDays: [], pageDaysUndated: undated, pageDaysEarlier: 0 };
  const today = src.store.livedDay();
  const first = Math.max(Math.min(...dated.map((s) => s.day as number)), today - (PAGE_DAYS_MAX - 1));
  let calendar = "";
  let runs: PageWriterRun[] = [];
  try {
    calendar = src.self.calendarToday();
    runs = src.self.pageWriterRuns({ limit: WRITER_RUNS_READ });
  } catch {
    /* no runs to read: every day without a version says it has no record */
  }
  const yesterday = calendar === "" ? "" : dayBefore(calendar);
  // The newest lived day is the store's last active date — today only when a
  // session has run today; otherwise it is the day the store last lived.
  const lastActive = src.store.getMeta("lastActiveDate") ?? "";
  const newestDate = isIsoDay(lastActive) ? lastActive : null;
  // A day nothing else dates is dated by its sleep cycle's own row, which
  // records the calendar date it closed.
  const cycleDate = new Map<number, string>();
  try {
    // NEWEST first, so past `LOG_LIMIT` it is the oldest days that go undated,
    // not today's (one row per session end; 2026-10-09). Each day keeps its
    // OLDEST row's date, as before: the last one seen wins.
    for (const row of src.store.eventLog({ name: "sleep.cycle", sinceDay: first, order: "desc", limit: LOG_LIMIT })) {
      const date = (JSON.parse(row.payload ?? "{}") as Record<string, unknown>)["date"];
      if (typeof date === "string" && isIsoDay(date)) cycleDate.set(row.day, date);
    }
  } catch {
    /* undated days stay undated */
  }
  const newestRun = new Map<number, PageWriterRun>();
  for (const r of runs) if (!newestRun.has(r.day)) newestRun.set(r.day, r);

  const out: PageDay[] = [];
  for (let d = first; d <= Math.max(first, today); d += 1) {
    const steps = dated.filter((s) => s.day === d);
    const isToday = d === today && calendar !== "" && newestDate === calendar;
    const run = newestRun.get(d);
    const runDate = run !== undefined && isIsoDay(run.on) ? run.on : null;
    if (steps.length > 0) {
      const last = steps[steps.length - 1] as PageStep;
      out.push({
        day: d,
        date: last.date ?? runDate ?? (d === today ? newestDate : null) ?? cycleDate.get(d) ?? null,
        today: isToday,
        seqs: steps.map((s) => s.seq),
        by: last.by,
        reason: last.reason,
        why: null,
        more: null,
      });
      continue;
    }
    let words: { why: string; more: string };
    if (run === undefined) {
      words = pageDayUnrecorded(isToday);
    } else {
      let w: WriterLine;
      try {
        w = writerWords(src.self.pageWriterStatus(run.about, calendar || undefined), yesterday);
      } catch {
        w = writerWords({ about: run.about, outcome: run.outcome, derived: false, run }, yesterday);
      }
      words = { why: pageDayWords(w), more: w.more };
    }
    out.push({
      day: d,
      date: runDate ?? (d === today ? newestDate : null) ?? cycleDate.get(d) ?? null,
      today: isToday,
      seqs: [],
      by: null,
      reason: null,
      ...words,
    });
  }
  return { pageDays: out, pageDaysUndated: undated, pageDaysEarlier: first - Math.min(...dated.map((s) => s.day as number)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// what it's settling into — the core, and what is closest to it
// ─────────────────────────────────────────────────────────────────────────────

type Shaped = MindView["identity"][number];

/**
 * One memory about me or about us on its way to the core, in physics' own
 * terms (2026-09-26): how far along each lane it is.
 */
export interface CoreCandidate {
  readonly id: string;
  readonly kind: Kind;
  /** Fast lane: how strongly it was felt, and whether it has come back after a gap. */
  readonly feeling: number;
  readonly returned: boolean;
  /** Slow lane: awake returns on this many distinct lived days, over `span` of them. */
  readonly days: number;
  readonly span: number;
  /** The lane that is met, when one is. */
  readonly lane: "fast" | "slow" | null;
  readonly eligible: boolean;
  /** The better of the two lanes' progress, 0..2. */
  readonly closeness: number;
  /** One awake return away, by the fast lane (see `oneReturnAway`). */
  readonly oneReturnAway: boolean;
}

/**
 * "ONE RETURN AWAY" (round 3; home, memories and self read it the same way):
 * the verdict says it is felt strongly enough for the fast lane, the fast lane
 * is not met yet, and the ONLY thing blocking it is that no lane is met — so a
 * single awake return after the gap is all it needs. Every part of this comes
 * from `promotionEligibility`'s verdict; no threshold, kind or tunable is read
 * here, so when the engine's rule changes this follows it.
 */
export function oneReturnAway(v: Pick<PromotionVerdict, "fast" | "blockedBy">): boolean {
  return (
    v.fast.intensity >= v.fast.needIntensity &&
    !v.fast.met &&
    v.blockedBy.length === 1 &&
    v.blockedBy[0] === "no-lane-yet"
  );
}

/**
 * The memories that can still reach the core, closest first, and how many never
 * can (see `settlingView`). Shared with the home page's core tile, so "closest:
 * 1 of 5 days" there is the head of the list the self tab draws.
 */
export function coreCandidates(src: DashboardSource, pageId: string | null): { raw: CoreCandidate[]; outOfReach: number; sentBack: number } {
  const store = src.store;
  const day = store.livedDay();
  const raw: CoreCandidate[] = [];
  let outOfReach = 0;
  let sentBack = 0;
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row) || row.type === "schema" || id === pageId) continue;
    let p;
    try {
      p = store.physicsOf(id);
    } catch {
      continue;
    }
    if (p.promotedIdentity) continue;
    // Exactly the context sleep's consolidate builds (`coreContextFor`, #262).
    const ctx = coreContextFor(store, row, day);
    if (!ctx.aboutMe && ctx.selfRelevantFeeling !== true) {
      outOfReach += 1;
      continue;
    }
    // The engine's own context, computed the way every tab computes the core
    // road (round 3): who it is about, and today's lived day (the slow lane
    // checks the memory's strength today) — plus, as sleep passes it, whether
    // the owner sent it back, so a demoted memory is never "one return away".
    const v = promotionEligibility(p, ctx);
    // SENT BACK BY THE OWNER: out of the core, and not on its way there — the
    // engine refuses it whatever its lanes say, so it is counted apart rather
    // than drawn as close (it is listed under "Sent back to ordinary fading").
    if (v.blockedBy.includes("demoted-by-owner")) {
      sentBack += 1;
      continue;
    }
    const returned = v.fast.gap !== null && v.fast.gap >= v.fast.needGap;
    const fast = Math.min(1, v.fast.intensity / v.fast.needIntensity) + (returned ? 1 : 0);
    const slow = Math.min(1, v.slow.days / v.slow.needDays) + Math.min(1, v.slow.span / v.slow.needSpan);
    raw.push({
      id,
      kind: p.kind,
      feeling: v.fast.intensity,
      returned,
      days: v.slow.days,
      span: v.slow.span,
      lane: v.lane,
      eligible: v.eligible,
      closeness: Math.max(fast, slow),
      oneReturnAway: oneReturnAway(v),
    });
  }
  // Closest first: the better of the two lanes' progress; ties by return days.
  raw.sort((a, b) => b.closeness - a.closeness || b.days - a.days || (a.id < b.id ? -1 : 1));
  return { raw, outOfReach, sentBack };
}

/**
 * The core as it stands, and — the part a young store needs — what is on its way.
 *
 * The candidates are computed with physics' OWN rule, `promotionEligibility`
 * (2026-09-26: only memories about me or about us, by the fast lane or the slow
 * lane), and sleep's own "about me" reading; nothing here restates a
 * threshold. Memories that are not about me or about us can never become core
 * and are counted apart. Schema rows (the page, the identity core, beliefs)
 * are not memories and are left out, as are journal rows.
 */
function settlingView(
  src: DashboardSource,
  x: {
    core: Shaped[];
    guarded: Shaped[];
    outside: { id: string; text: string }[];
    unreadable: { id: string; label: string }[];
    stories: StoryView[];
    candidates: ReturnType<typeof coreCandidates>;
    absent: string;
  },
): SettlingView {
  const store = src.store;
  const { raw, outOfReach, sentBack } = x.candidates;
  const candidates: Candidate[] = raw.slice(0, CANDIDATE_LIMIT).map((r) => {
    const t = reveal(store, r.id, 110);
    return {
      id: r.id,
      text: t.text ?? t.label,
      confidential: t.confidential,
      kind: r.kind,
      feeling: r.feeling,
      needFeeling: PHYSICS.CORE_FAST_FEELING,
      returned: r.returned,
      days: r.days,
      requiredDays: PHYSICS.CORE_SLOW_DAYS,
      span: r.span,
      needSpan: PHYSICS.CORE_SLOW_SPAN_DAYS,
      lane: r.lane,
      eligible: r.eligible,
      oneReturnAway: r.oneReturnAway,
    };
  });
  const row = (el: { id: string; text: string; confidential?: boolean; kind?: Kind }): SettlingRow => ({
    id: el.id,
    text: el.text,
    confidential: el.confidential === true,
    kind: el.kind ?? "fact",
  });
  return {
    core: x.core.map(row),
    guarded: x.guarded.map(row),
    contested: x.stories.map((s) => ({
      id: s.id,
      about: s.about,
      now: s.nowFull,
      revised: s.revised,
      fraction: s.fraction,
      pressure: s.pressure,
      bar: s.bar,
    })),
    outside: x.outside.map((o) => ({ id: o.id, text: o.text, confidential: false, kind: "fact" as Kind })),
    unreadable: x.unreadable,
    candidates,
    onTheWay: raw.filter((r) => r.days > 0).length,
    unused: raw.filter((r) => r.days === 0).length,
    outOfReach,
    sentBack,
    history: coreHistory(src),
    rule: {
      needFeeling: PHYSICS.CORE_FAST_FEELING,
      needGap: PHYSICS.CORE_FAST_GAP_DAYS,
      days: PHYSICS.CORE_SLOW_DAYS,
      span: PHYSICS.CORE_SLOW_SPAN_DAYS,
      everyDays: SLEEP.CADENCE.consolidate,
      cap: SLEEP.CORE_MAX_PER_SLEEP,
    },
    coreAbsent: x.core.length === 0 ? x.absent : null,
    guardedAbsent: x.guarded.length === 0 ? x.absent : null,
    contestedAbsent: x.stories.length === 0 ? x.absent : null,
  };
}

const CANDIDATE_LIMIT = 5;

// ─────────────────────────────────────────────────────────────────────────────
// the wake, in parts
// ─────────────────────────────────────────────────────────────────────────────

const PART_LABEL: Record<string, string> = {
  furniture: "headers",
  page: "self page",
  identity: "who I am",
  craft: "how I work",
  threads: "still open",
  hints: "nearby memories",
  horizon: "arriving",
};

/**
 * The published bundle cut at its OWN lane headings (`FRAMING`, from `self/`),
 * measured in raw bytes, so the parts add up to `wake.bytes` exactly. Unlike
 * `wakeLanes`, a markdown heading does NOT start a part here: the page carries
 * `## Core` and `## Lately`, and those belong to the page's slice. Everything
 * outside a lane (the framing line, the comments, the sentinel) is "headers".
 */
export function wakeParts(text: string, hasPage: boolean): WakePart[] {
  const headings = new Map<string, string>();
  for (const lane of LANE_ORDER) headings.set(FRAMING[lane], lane);
  const bytes = new Map<string, number>();
  const order: string[] = [];
  const add = (key: string, n: number): void => {
    if (!bytes.has(key)) order.push(key);
    bytes.set(key, (bytes.get(key) ?? 0) + n);
  };
  let current = "furniture";
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const n = new TextEncoder().encode(raw).length + (i < lines.length - 1 ? 1 : 0);
    const line = raw.trim();
    const lane = headings.get(line);
    if (lane !== undefined) {
      current = lane === "identity" && hasPage ? "page" : lane;
      add("furniture", n);
      return;
    }
    // A lane that listed nothing is ONE line, its heading inside it
    // (`self/briefing.ts#collapsedLine`, 2026-10-09): it is that lane's.
    const collapsed = collapsedLane(line);
    if (collapsed !== null) {
      current = collapsed;
      add(collapsed, n);
      return;
    }
    if (line.startsWith("<!--") || line === FRAMING.context) {
      add("furniture", n);
      return;
    }
    add(current, n);
  });
  return order
    .map((key) => ({ key, label: PART_LABEL[key] ?? key, bytes: bytes.get(key) ?? 0 }))
    .filter((p) => p.bytes > 0);
}

/** What the newest durable render (`self.briefing`) recorded about its size. */
export interface LastRender {
  /** The ceiling it was composed to; null when it recorded none. */
  readonly budget: number | null;
  /** The lived day it rendered on; null when unrecorded. */
  readonly day: number | null;
  /** How many elements the trim dropped to make it fit. */
  readonly trimmed: number;
  /** The lanes they were dropped from, in order, each once. */
  readonly trimmedLanes: string[];
}

/** The newest durable render's size facts; null when no render left a row. */
export function lastRender(src: DashboardSource): LastRender | null {
  try {
    const [row] = src.store.eventLog({ name: "self.briefing", order: "desc", limit: 1 });
    if (row === undefined) return null;
    const p = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
    const budget = p["budget"];
    const day = p["day"];
    const list = Array.isArray(p["trimmed"]) ? (p["trimmed"] as unknown[]) : [];
    const total = typeof p["trimmedTotal"] === "number" ? (p["trimmedTotal"] as number) : list.length;
    const lanes: string[] = [];
    for (const t of list) {
      const lane = t !== null && typeof t === "object" ? (t as { lane?: unknown }).lane : undefined;
      if (typeof lane === "string" && !lanes.includes(lane)) lanes.push(lane);
    }
    return {
      budget: typeof budget === "number" && budget > 0 ? budget : null,
      day: typeof day === "number" ? day : null,
      trimmed: total,
      trimmedLanes: lanes,
    };
  } catch {
    return null;
  }
}

/** The label a wake part is shown under ("nearby memories", "arriving", …). */
export const wakePartLabel = (key: string): string => PART_LABEL[key] ?? key;

// ─────────────────────────────────────────────────────────────────────────────
// what the next wake starts with, as a short list (round 3b, item 2)
// ─────────────────────────────────────────────────────────────────────────────

export interface WakeList {
  /** False when no wake has been published: the page says so, and lists nothing. */
  readonly ok: boolean;
  /** The self page the wake leads with, and how old it is; null when the wake carries none. */
  readonly page: { date: string | null; writtenDay: number | null; livedDaysAgo: number | null; newerThanWake: boolean } | null;
  /** The nearby memories the published wake showed, by id (the hints lane's open showings). */
  readonly nearby: WakeMemory[];
  /** Their lines as the wake prints them, when no showing was recorded (a wake from before v8). */
  readonly nearbyLines: string[];
  /** What is arriving (the horizon lane): each line, with the memory it is when one is found. */
  readonly arriving: (Omit<WakeMemory, "id"> & { id: string | null })[];
  /** The other lanes it carries, counted: "how I work", "still open", "who I am". */
  readonly also: { label: string; lines: number }[];
}

/** One memory the wake list names: its words (withheld when confidential) and its title, if it has one. */
export interface WakeMemory {
  readonly id: string;
  readonly text: string;
  readonly title: string | null;
  readonly confidential: boolean;
}

/** A wake line's leading date (`2026-07-10 · `, `by Jul 9 · `) lifted off. */
const lineText = (item: string): string => item.replace(/^(\S+\s·\s|by\s\S+\s·\s)/, "");

/** A memory as the wake list shows it, by id. Null when it is gone or put away. */
function wakeMemory(store: DashboardSource["store"], id: string): WakeMemory | null {
  const row = store.row(id);
  if (row === undefined || row.archived === 1) return null;
  const t = reveal(store, id, 110);
  const title = t.confidential || row.title === null || row.title.trim() === "" ? null : row.title.trim();
  return { id, text: t.text ?? t.label, title, confidential: t.confidential };
}

/**
 * WHICH MEMORY AN ARRIVING LINE IS (2026-09-30). The published wake keeps no
 * record of its horizon lane's ids (`wake_display` is the hints lane's), so
 * the line is matched back to a dated memory by its words: the lane prints a
 * memory's first paragraph, flattened, after its date. A line nothing matches
 * is still listed, as its words. Reads rows only (`row()`, no read event).
 */
function arrivingOf(store: DashboardSource["store"], lines: readonly string[]): WakeList["arriving"] {
  if (lines.length === 0) return [];
  const known: { id: string; said: string }[] = [];
  try {
    const ids = new Set([...store.datedMemories("0000-01-01", "9999-12-31").map((d) => d.id), ...store.prospectiveMemoryIds()]);
    for (const id of ids) {
      const row = store.row(id);
      if (row === undefined || row.archived === 1) continue;
      const first = row.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? row.body;
      const said = first.replace(/\s+/g, " ").trim();
      if (said.length >= 8) known.push({ id, said });
    }
  } catch {
    /* no dated memories to read: every line is listed as its words */
  }
  return lines.map((line) => {
    const hit = known.find((k) => line === k.said) ?? known.find((k) => line.includes(k.said.slice(0, 80)));
    const m = hit === undefined ? null : wakeMemory(store, hit.id);
    return m ?? { id: null, text: line, title: null, confidential: false };
  });
}

/**
 * The wake as a list of what is in it. The nearby memories are read from the
 * `wake_display` rows the last PUBLISHED bundle left open in its hints lane
 * (v8; `store.wakeDisplays`, a read), so each can open its card; a wake from
 * before those rows existed falls back to the lane's own lines. Arriving is the
 * horizon lane's lines. Nothing here re-ranks what the wake chose.
 */
function wakeList(src: DashboardSource, text: string | null, page: ReturnType<DashboardSource["self"]["page"]>): WakeList {
  if (text === null) return { ok: false, page: null, nearby: [], nearbyLines: [], arriving: [], also: [] };
  const store = src.store;
  const lanes = wakeLanes(text);
  const lines = (lane: string): string[] => lanes.filter((l) => l.lane === lane).flatMap((l) => l.items);
  const hasPage = page !== null && wakeParts(text, true).some((p) => p.key === "page");
  const rendered = lastRender(src);
  const pageLine: WakeList["page"] = !hasPage || page === null
    ? null
    : {
        date: isIsoDay(page.revisedOn.trim()) ? page.revisedOn.trim() : null,
        writtenDay: page.revisedDay,
        livedDaysAgo: page.revisedDay === null ? null : Math.max(0, store.livedDay() - page.revisedDay),
        // The wake is the page as of its last publish: a page rewritten on a
        // later lived day than that render reaches the wake after the next one.
        newerThanWake: page.revisedDay !== null && rendered?.day != null && page.revisedDay > rendered.day,
      };
  let nearby: WakeList["nearby"] = [];
  try {
    const open = [...store.wakeDisplays().values()]
      .filter((r) => r.lane === "hints" && r.closed_day === null)
      .sort((a, b) => b.shown_day - a.shown_day || (a.memory_id < b.memory_id ? -1 : 1));
    nearby = open.flatMap((r) => {
      const m = wakeMemory(store, r.memory_id);
      return m === null ? [] : [m];
    });
  } catch {
    /* no showings to read (a store before v8): the lane's own lines stand in */
  }
  const also: WakeList["also"] = [];
  for (const lane of ["identity", "craft", "threads"]) {
    const n = lines(lane).length;
    if (n > 0 && !(lane === "identity" && hasPage)) also.push({ label: PART_LABEL[lane] ?? lane, lines: n });
  }
  return {
    ok: true,
    page: pageLine,
    nearby,
    nearbyLines: nearby.length > 0 ? [] : lines("hints").map(lineText),
    arriving: arrivingOf(store, lines("horizon").map(lineText)),
    also,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// the journal — chapters by lived day
// ─────────────────────────────────────────────────────────────────────────────

const CHAPTER_SPLIT = /^(?=[ \t]*#{1,6}[ \t]*chapter[ \t]+\d+)/im;

/** One chapter as the journal reads it, before it is grouped by day. */
type ReadChapter = JournalChapter & {
  day: number;
  date: string | null;
  /** The chapter's calendar date, `YYYY-MM-DD`: its heading's, else its entry's. */
  iso: string | null;
  /** True when `iso` came from the chapter's own heading. */
  isoFromHeading: boolean;
};

const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** A chapter heading's date (`Thu 16 Jul 2026`) → `2026-07-16`; null when it does not read. */
export function headingIso(date: string | null): string | null {
  if (date === null) return null;
  const m = /^[A-Za-z]{3},?\s+(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(date.trim());
  if (m === null) return null;
  const month = MONTH_INDEX[(m[2] as string).toLowerCase()];
  if (month === undefined) return null;
  return `${m[3] as string}-${String(month).padStart(2, "0")}-${(m[1] as string).padStart(2, "0")}`;
}

const isIsoDay = (s: string | null | undefined): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Every chapter the journal holds, newest first.
 *
 * One journal row is one session's entry and can hold several chapters, each
 * under its own `## chapter N — <date> · <model> · lived day D` heading, so a
 * row is split at those headings and each part read with `self/`'s own
 * `readChapterLead`. The model falls back to the entry's `meta.models`; a
 * chapter written before either existed shows none. The date falls back to the
 * entry's own (`happened_on`, then `learned_on`) when the heading named none,
 * so every day in the strip is shown in one format (round 3, S4).
 */
function journalChapters(src: DashboardSource): ReadChapter[] {
  const store = src.store;
  const all: ReadChapter[] = [];
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || !isJournal(row)) continue;
    const rowIso = isIsoDay(row.happened_on) ? row.happened_on : isIsoDay(row.learned_on) ? row.learned_on : null;
    let doc;
    try {
      doc = store.readProse(id);
    } catch {
      all.push({ id, chapter: 1, title: reveal(store, id, 60).label, model: null, first: "", text: null, bytes: 0, confidential: false, day: 0, date: null, iso: rowIso, isoFromHeading: false });
      continue;
    }
    const withheld = isConfidential(doc);
    const models = chapterModels(doc.meta ?? {});
    const parts = doc.body.split(CHAPTER_SPLIT).filter((p) => p.trim().length > 0);
    const title = doc.title ?? "an unnamed chapter";
    parts.forEach((part, i) => {
      const lead = readChapterLead(part);
      const n = lead.chapters[0] ?? i + 1;
      const rest = lead.rest.trim();
      const first = rest.split("\n").map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("<!--")) ?? "";
      const fromHeading = headingIso(lead.date);
      all.push({
        id,
        chapter: n,
        title: parts.length > 1 ? `${title} · chapter ${n}` : title,
        model: lead.model ?? models[String(n)] ?? null,
        first: withheld ? WITHHELD : first.length > 200 ? `${first.slice(0, 200).trimEnd()}…` : first,
        text: withheld ? null : rest,
        bytes: new TextEncoder().encode(rest).length,
        confidential: withheld,
        day: lead.livedDay ?? doc.bornDay,
        date: lead.date,
        iso: fromHeading ?? rowIso,
        isoFromHeading: fromHeading !== null,
      });
    });
  }
  all.sort((a, b) => b.day - a.day || (a.id < b.id ? 1 : a.id > b.id ? -1 : b.chapter - a.chapter));
  return all;
}

/** The chapters grouped by the lived day they were written on, newest first. */
function journal(all: readonly ReadChapter[], limit: number, absent: string): Pick<MindView, "journal" | "journalAbsent" | "journalMore"> {
  const sent = all.slice(0, limit);
  const days: JournalDay[] = [];
  let headed = false;
  for (const c of sent) {
    let d = days[days.length - 1];
    if (d === undefined || d.day !== c.day) {
      d = { day: c.day, date: c.date, iso: c.iso, chapters: [] };
      days.push(d);
      headed = c.isoFromHeading;
    }
    if (d.date === null && c.date !== null) (d as { date: string | null }).date = c.date;
    // A date a chapter's own heading named beats one read off its entry.
    if (c.iso !== null && (d.iso === null || (!headed && c.isoFromHeading))) {
      (d as { iso: string | null }).iso = c.iso;
      headed = c.isoFromHeading;
    }
    const { day: _day, date: _date, iso: _iso, isoFromHeading: _headed, ...chapter } = c;
    d.chapters.push(chapter);
  }
  return { journal: days, journalAbsent: all.length === 0 ? absent : null, journalMore: all.length - sent.length };
}

/**
 * The briefing as it actually renders, split at its own lane headings.
 *
 * This is the one place the dashboard shows composed TEXT rather than a shape,
 * and it is deliberate: the wake bundle is what the next session will read, so
 * "what would I say on waking" is unanswerable from a byte count. Nothing is
 * persisted — the bundle is read from the store at request time like every other
 * value on the page, and its own trailing sentinel comment is dropped because it
 * is bookkeeping, not something the assistant says.
 */
export function wakeLanes(text: string): WakeLane[] {
  // The lane names and their headings are TAKEN FROM `self/` — `LANE_ORDER` and
  // `FRAMING` — never retyped here. A renamed lane heading would otherwise leave
  // this splitter silently returning one enormous lane called "the preface",
  // which is precisely the quiet-wrong-answer shape the registries exist against.
  const headings = new Map<string, string>();
  for (const lane of LANE_ORDER) headings.set(FRAMING[lane], lane);

  const lanes: { heading: string; lane: string | null; items: string[] }[] = [];
  let current: { heading: string; lane: string | null; items: string[] } = {
    heading: "How this arrives",
    lane: null,
    items: [],
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // The sentinel is bookkeeping, not something the assistant says.
    if (line.startsWith("<!--")) continue;
    if (line.length === 0) continue;
    const lane = headings.get(line);
    // A lane that listed nothing is one line with its heading inside it
    // (`self/briefing.ts#collapsedLine`, 2026-10-09): that lane, that one item.
    const collapsed = collapsedLane(line);
    if (collapsed !== null) {
      if (current.items.length > 0) lanes.push(current);
      current = { heading: FRAMING[collapsed], lane: collapsed, items: [line.slice(FRAMING[collapsed].length).trim()] };
      continue;
    }
    // A markdown heading counts too, so a future briefing that uses one still
    // splits rather than collapsing into a single block.
    const mdHeading = /^#{1,6}\s+(.*)$/.exec(line);
    if (lane !== undefined || mdHeading !== null) {
      if (current.items.length > 0) lanes.push(current);
      current = {
        heading: lane === undefined ? (mdHeading?.[1] ?? line) : line,
        lane: lane ?? null,
        items: [],
      };
      continue;
    }
    current.items.push(line.replace(/^[-*]\s+/, ""));
  }
  if (current.items.length > 0) lanes.push(current);
  return lanes;
}

function storyViews(src: DashboardSource): StoryView[] {
  const store = src.store;
  return contestedRows(src).map((row) => {
    let story;
    try {
      story = src.schemas.story(row.id);
    } catch {
      return { ...row, beats: [], beatsAbsent: NONE };
    }

    const beats: StoryBeat[] = story.increments
      .slice()
      .sort((a, b) => a.day - b.day)
      .map((inc) => {
        const crossed = inc.pressureAfter >= inc.bar;
        const step = story.lineage.find((l) => l.id === inc.targetId && l.successorId !== null);
        const successorId = crossed ? (step?.successorId ?? null) : null;
        const became = successorId === null ? null : reveal(store, successorId, 96).text;
        // The verdict is a CLAUSE, and the numbers it is about are already in
        // their own fields: "0.598 of 0.470" beside the word REVISED read as a
        // numerator larger than its denominator with nothing saying that is
        // exactly what clearing a bar looks like.
        const verdict = crossed
          ? step === undefined || step.successorId === null
            ? "it cleared the bar — but I find no supersession recorded"
            : "it cleared the bar, and I changed my mind"
          : "under the bar — held";
        const c = reveal(store, inc.challengerId, 72);
        return {
          day: inc.day,
          challenger: c.text ?? c.label,
          force: inc.force,
          pressureAfter: inc.pressureAfter,
          bar: inc.bar,
          fraction: inc.bar > 0 ? Math.min(1.3, inc.pressureAfter / inc.bar) : 0,
          verdict,
          became,
          becameId: successorId,
          crossed,
        };
      });
    return {
      ...row,
      beats,
      beatsAbsent:
        beats.length === 0
          ? "(none yet) — this belief carries pressure but I hold no credited challenge for it: the increments predate the durable log, or were swept."
          : null,
    };
  });
}
