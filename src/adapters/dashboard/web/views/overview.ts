/**
 * `/api/overview` — the page the dashboard opens on.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { MARKER_UNSET, isJournal, ownerNames, readMarker } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import { BANDS, CYCLE_PHASES } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import type { NarratedEvent } from "../narrate.js";
import { displayName } from "../ask-voice.js";
import { reveal } from "../reveal.js";
import { activityView } from "./activity.js";
import { feelingsView } from "./memories.js";
import type { FeelingsView } from "./memories.js";
import { lastActive } from "./meta.js";
import { coreCandidates } from "./mind.js";
import { BAND_GLOSS, chapters, contestedRows, livedDays } from "./rows.js";
import type { BarRow, ChapterRow, ContestedRow } from "./rows.js";
import { FEED_LIMIT, LOG_CEILING, absenceFor, census, countMap } from "./shared.js";
import { selfMap } from "./self-map.js";
import type { SelfMap } from "./self-map.js";
import { todayView } from "./today.js";
import type { TodayView } from "./today.js";

// ─────────────────────────────────────────────────────────────────────────────
// overview
// ─────────────────────────────────────────────────────────────────────────────

export interface Tile {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly accent: "cyan" | "purple" | "amber" | "teal" | "red";
  /** True when the value is an absence marker, not a number. */
  readonly absent: boolean;
}


/**
 * The home page's headline (round 4, 2026-09-28): whose memory this is, how
 * many it holds, how many are new today — "Day 7 with Mike · 306 memories · 13
 * new today". The mechanism score went (it is the developers', on Health), and
 * so did the four tiles under it: they repeated the headline or needed words.
 */
export interface Hero {
  readonly headline: string;
  /** The one memory count (`memoriesLive`): what the memories list's "live" chip counts. */
  readonly memories: number;
  /** Memories written today (`todayView`'s `newToday`). */
  readonly newToday: number;
}

/** The headline, in short parts joined by a dot. A zero "new today" is left out. */
export function heroHeadline(x: { day: number; lived: boolean; owner: string | null; memories: number; newToday: number }): string {
  const parts = [
    x.lived ? `Day ${x.day}${x.owner === null ? "" : ` with ${x.owner}`}` : "Nothing lived yet",
    `${x.memories} ${x.memories === 1 ? "memory" : "memories"}`,
  ];
  if (x.newToday > 0) parts.push(`${x.newToday} new today`);
  return parts.join(" · ");
}

/** The owner's name as the store knows it (sleep's `ownerNames`, first entry), written as a name; null when none. */
export function ownerName(src: DashboardSource): string | null {
  try {
    return displayName(ownerNames(src.store)[0] ?? null);
  } catch {
    return null;
  }
}

/**
 * The self map, as the Self tab draws it (`views/self-map.ts`): the core and
 * the memories about me or about us closest to it. The home tab draws the
 * same picture.
 */
function homeMap(src: DashboardSource, identity: readonly { id: string; strength: number }[]): SelfMap {
  const core = identity.map((el) => {
    const r = reveal(src.store, el.id, 120);
    return { id: el.id, text: r.text ?? r.label, confidential: r.confidential, strength: el.strength };
  });
  return selfMap(src, core, coreCandidates(src, src.self.page()?.id ?? null).raw);
}

export interface OverviewView {
  readonly hero: Hero;
  /** "Today": a few plain lines about memory, newest first (`today.ts`). */
  readonly today: TodayView;
  /** "How it feels": the memories tab's radar numbers (`memories.ts#feelingsView`). */
  readonly feelings: FeelingsView;
  /** "Around the core": the Self tab's map (`self-map.ts`). */
  readonly map: SelfMap;
  readonly opening: string;
  readonly tiles: Tile[];
  readonly bands: BarRow[];
  readonly bandNote: string;
  readonly feed: NarratedEvent[];
  /**
   * `promotedDay` is the lived day this element crossed into the band, read off
   * the `band.promoted` record, or null where no such record exists (a seeded
   * or migrated core was never watched crossing). It is here because `strength`
   * on an identity row is a TAUTOLOGY: every element in the band is at 1.00 by
   * construction, so fifteen rows of `strength 1.00` said one thing fifteen
   * times (design review, 2026-09-04, ranked #2). The day it earned the band is
   * the fact that varies — and where the store never recorded one, the row says
   * nothing there rather than inventing a day or repeating the tautology.
   */
  readonly identity: { id: string; text: string; kind: Kind; band: Band; strength: number; promotedDay: number | null; bornDay: number; lastUsedDay: number; confidential: boolean }[];
  readonly identityAbsent: string | null;
  readonly guarded: { id: string; text: string; kind: Kind; bornDay: number; lastUsedDay: number; confidential: boolean }[];
  readonly guardedAbsent: string | null;
  readonly contested: ContestedRow[];
  readonly contestedAbsent: string | null;
  readonly chapters: ChapterRow[];
  readonly chaptersAbsent: string | null;
}


export function overviewView(src: DashboardSource, feedLimit = FEED_LIMIT): OverviewView {
  const store = src.store;
  const day = store.livedDay();
  const rows = census(src);
  // A SCHEMA ROW IS NOT A MEMORY. The census keeps both, because the bands and
  // kinds below are true of both and the physics runs on both — but the number
  // in the headline tile is the one a person compares against the console, and
  // the console says memories. See `MemoryLine.schema`.
  const held = rows.filter((r) => !r.schema);
  const beliefs = rows.length - held.length;
  const archived = census(src, { includeArchived: true }).filter((r) => r.archived !== null);
  const journal = chapters(src, 5);
  const journalCount = store.list().filter((id) => {
    const row = store.row(id);
    return row !== undefined && isJournal(row);
  }).length;
  const e = src.self.enumerate(day);
  const wake = src.self.wake();
  const contested = contestedRows(src);
  const byBand = countMap<Band>(rows, "band");
  const peak = Math.max(1, ...BANDS.map((b) => byBand.get(b) ?? 0));
  const everLived = day > 0 || rows.length > 0 || journalCount > 0;
  // The lived day each element crossed into the identity band, where the store
  // watched it happen. Read once for the panel rather than once per row.
  const promotedDays = new Map<string, number>();
  // Newest first, and the last write wins: the earliest crossing in the read,
  // as before, but past the ceiling it is the oldest crossings that go missing
  // rather than every element promoted since.
  for (const row of store.eventLog({ name: "band.promoted", order: "desc", limit: LOG_CEILING })) {
    if (row.ref !== null) promotedDays.set(row.ref, row.day);
  }

  const tiles: Tile[] = [
    {
      label: "lived days",
      value: String(day),
      note:
        lastActive(store.getMeta("lastActiveDate")) === null
          ? "the clock has never moved"
          : `last of them ${lastActive(store.getMeta("lastActiveDate")) ?? ""}`,
      accent: "cyan",
      absent: day === 0,
    },
    { label: "memories held", value: String(held.length), note: "live, journal excluded", accent: "cyan", absent: held.length === 0 },
    {
      label: "beliefs and entities",
      value: String(beliefs),
      note: "held like memories, counted apart",
      accent: "teal",
      absent: beliefs === 0,
    },
    { label: "archived", value: String(archived.length), note: "held, not gone", accent: "teal", absent: archived.length === 0 },
    { label: "journal entries", value: String(journalCount), note: "chapters — these do not decay", accent: "purple", absent: journalCount === 0 },
    { label: "identity band", value: String(e.identity.length), note: "what strength earned", accent: "purple", absent: e.identity.length === 0 },
    { label: "protected", value: String(e.protected.length), note: "permanent ink, no revision reaches it", accent: "amber", absent: e.protected.length === 0 },
    {
      label: "contested beliefs",
      value: String(contested.length),
      note: contested.length === 0 ? "nothing has argued with me" : "arguments in progress or settled",
      accent: contested.some((c) => c.fraction >= 1) ? "amber" : "teal",
      absent: contested.length === 0,
    },
    {
      label: "last cycle",
      value: lastCycleDay(src) === null ? NEVER : `day ${lastCycleDay(src)}`,
      note: "the newest phase marker I hold",
      accent: "teal",
      absent: lastCycleDay(src) === null,
    },
    {
      label: "wake bytes",
      value: wake.ok ? String(wake.bytes) : NEVER,
      note: wake.ok ? "composed and waiting for the next session" : `nothing waiting (${wake.reason})`,
      accent: wake.ok ? "cyan" : "amber",
      absent: !wake.ok,
    },
  ];

  const opening =
    day === 0 && rows.length === 0
      ? "I have not lived a day yet. Everything below is what I would be able to tell you, and the honest word for how much of it I know is on each panel."
      : `I have lived ${day} ${day === 1 ? "day" : "days"}. I am holding ${held.length} ${held.length === 1 ? "memory" : "memories"}` +
        (beliefs === 0 ? "" : ` and ${beliefs} ${beliefs === 1 ? "belief or entity" : "beliefs and entities"}`) +
        (archived.length === 0 ? "" : `, with ${archived.length} more archived`) +
        (journalCount === 0 ? "." : `, beside ${journalCount} journal ${journalCount === 1 ? "entry" : "entries"} that do not decay.`);

  // THE ONE COUNT: what the memories list's "live" chip counts.
  const memories = rows.length;
  const today = todayView(src);
  const hero: Hero = {
    headline: heroHeadline({ day, lived: !(day === 0 && rows.length === 0), owner: ownerName(src), memories, newToday: today.newToday }),
    memories,
    newToday: today.newToday,
  };

  return {
    hero,
    today,
    feelings: feelingsView(src, rows),
    map: homeMap(src, e.identity),
    opening,
    tiles,
    bands: BANDS.map((b) => {
      const count = byBand.get(b) ?? 0;
      return {
        label: b,
        count,
        fraction: count / peak,
        note: BAND_GLOSS[b],
        absent: absenceFor(count, everLived),
      };
    }),
    bandNote:
      "Memories start episodic and climb only by being used on separate days. Most fade where they started — that is the design, not a shortfall.",
    feed: activityView(src, { limit: feedLimit, lane: "home", fold: true }).events,
    identity: e.identity.slice(0, 12).map((el) => {
      const r = reveal(store, el.id, 90);
      return {
        id: el.id,
        text: r.text ?? r.label,
        kind: el.kind,
        band: el.band,
        strength: el.strength,
        promotedDay: promotedDays.get(el.id) ?? null,
        ...livedDays(src, el.id),
        confidential: r.confidential,
      };
    }),
    identityAbsent: e.identity.length === 0 ? (everLived ? NONE : NEVER) : null,
    guarded: e.protected.slice(0, 12).map((el) => {
      const r = reveal(store, el.id, 90);
      return {
        id: el.id,
        text: r.text ?? r.label,
        kind: el.kind,
        ...livedDays(src, el.id),
        confidential: r.confidential,
      };
    }),
    guardedAbsent: e.protected.length === 0 ? (everLived ? NONE : NEVER) : null,
    contested,
    contestedAbsent: contested.length === 0 ? (everLived ? NONE : NEVER) : null,
    chapters: journal,
    chaptersAbsent: journal.length === 0 ? (everLived ? NONE : NEVER) : null,
  };
}


function lastCycleDay(src: DashboardSource): number | null {
  let newest: number | null = null;
  for (const phase of CYCLE_PHASES) {
    const marker = readMarker(src.store, phase);
    if (marker.health === "torn" || marker.day === MARKER_UNSET) continue;
    newest = newest === null ? marker.day : Math.max(newest, marker.day);
  }
  return newest;
}
