/**
 * `/api/memories` — how firmly what I hold is held, and how it feels (the two
 * pictures above the list), plus the census the other tabs' tests lean on;
 * `/api/memories/list` — every memory.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { CORE_EMOTIONS } from "../../../../core/feelings-wheel.js";
import { TUNABLES as PHYSICS, band as bandOf, strength as strengthOf } from "../../../../core/physics/index.js";
import { isEntityCard, isJournal, ownerNames } from "../../../../core/sleep/index.js";
import { rowToPhysics } from "../../../../core/store/index.js";
import type { Band, Kind, MemoryPhysics } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import { BANDS, KINDS } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import { displayName } from "../ask-voice.js";
import { WITHHELD, revealHere } from "../reveal.js";
import { archiveWords } from "./archive-words.js";
import { letGoDay } from "./mechanism-panel.js";
import { feelingsShown, firstSentence, isChapterMemory, repeatsOf, shownOf } from "./memory-words.js";
import type { DateFrom, FeelingShown } from "./memory-words.js";
import { absenceFor, census, countMap } from "./shared.js";
import { todayView } from "./today.js";
import type { MemoryLine } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// memories
// ─────────────────────────────────────────────────────────────────────────────

export interface KindRow {
  readonly kind: Kind;
  readonly count: number;
  readonly meanStrength: number;
  readonly absent: string | null;
  readonly wSal: number;
  readonly wRep: number;
  readonly kappa: number;
  readonly iota: number;
  readonly gloss: string;
  /** The kind in words, for a reader who will never see κ or ι: what it is,
   *  how fast it fades, how easily it is corrected. */
  readonly plain: { readonly label: string; readonly what: string; readonly fades: string; readonly corrects: string };
  /** Where this kind's κ sits between the slowest- and fastest-fading kinds,
   *  0.2 (slowest) to 1 (fastest). For a small five-step bar. */
  readonly fadeSpeed: number;
}

export interface MemoriesView {
  readonly day: number;
  readonly total: number;
  /** Memories written today (`todayView`'s `newToday`, the home headline's number). */
  readonly newToday: number;
  /** The owner's name as the store knows it, written as a name; null when none. */
  readonly owner: string | null;
  /** Of `total`: memories proper — the number `counterparts status` prints. */
  readonly memories: number;
  /** Of `total`: entities and beliefs about them (schema rows). */
  readonly schemas: number;
  /** How firmly what I hold is held: firm / settling / fading, over every live
   *  row but the journal's entries, which are counted apart (they aren't scored). */
  readonly hold: { readonly firm: number; readonly settling: number; readonly fading: number; readonly journal: number };
  /** How many lived days ahead "fading" looks (`NEAR_LET_GO_DAYS`). */
  readonly nearLetGoDays: number;
  /** How many lived days ahead "firm" looks (`FIRM_AHEAD_DAYS`). */
  readonly firmAheadDays: number;
  /** How it feels: the feelings on live memories, by the wheel's seven cores. */
  readonly feelings: FeelingsView;
  /** The census, strongest first. Nothing on the page draws it now; kept for the
   *  callers and tests that read it. */
  readonly points: MemoryLine[];
  readonly strengthByBand: { from: number; to: number; bands: Record<string, number> }[];
  readonly kinds: KindRow[];
  readonly pointsAbsent: string | null;
}

/** One person's side of one core feeling. */
export interface FeelingSide {
  /** How many feelings are recorded under this core. */
  readonly count: number;
  /** Their recorded strengths, summed (each 0..1, as felt). */
  readonly sum: number;
  /** The specific feelings under it, most first: `proud 3, joyful 1`. */
  readonly words: { readonly word: string; readonly count: number }[];
}

export interface FeelingsView {
  /** Live memories carrying at least one feeling. */
  readonly carrying: number;
  /** Whose "yours" is: the owner's name as the store knows it, or null
   *  (the legend then says "yours"). */
  readonly owner: string | null;
  /** In the wheel's order (`CORE_EMOTIONS`): yours (`whose = owner`) and mine (`whose = self`). */
  readonly cores: { readonly core: string; readonly yours: FeelingSide; readonly mine: FeelingSide }[];
}

/** How firmly a memory is held, in three words. */
export type Hold = "firm" | "settling" | "fading";

/** "Fading": prune would take it within this many lived days if nobody used it. */
export const NEAR_LET_GO_DAYS = 14;
/** "Firm": unused, it is still above the semantic floor (`THETA_SEM`, settled
 *  into what I know) this many lived days from now — far from the let-go line. */
export const FIRM_AHEAD_DAYS = 30;

/**
 * Firm, settling or fading. Core and protected memories are firm (neither is
 * pruned). Fading is prune's own verdict within `NEAR_LET_GO_DAYS` (`letGoDay`);
 * an entity card is faded by `schemas/`, not by prune, so it is never fading
 * here. Nor is a memory whose date still repeats (`opts.recurring`, the row's
 * `recurrenceOfRow` — 2026-10-09): the prune keeps it for its next occurrence,
 * so it is firm or settling by its strength like any other, and the row says
 * how often it comes round (`ListRow.repeats`). Firm is still settled
 * `FIRM_AHEAD_DAYS` from now if unused. The rest are settling.
 */
export function holdOf(physics: MemoryPhysics, day: number, opts: { prunable: boolean; recurring?: boolean }): Hold {
  if (physics.promotedIdentity === true || physics.protected === true) return "firm";
  if (opts.prunable && letGoDay(physics, day, NEAR_LET_GO_DAYS, opts.recurring === true) !== null) return "fading";
  if (strengthOf(physics, day + FIRM_AHEAD_DAYS) >= PHYSICS.THETA_SEM) return "firm";
  return "settling";
}

const KIND_GLOSS: Record<Kind, string> = {
  self: "who I am — salience only, and the slowest to be argued out of",
  person: "someone I know — salience carries it, repetition does not",
  entity: "a thing in the world — both arms count",
  skill: "how to do something — repetition is nearly all of it, and it erodes slowest",
  place: "somewhere — repetition-driven, slow to erode",
  fact: "a plain fact — erodes fastest, and the cheapest to overturn",
};

/** Each kind, in plain words (owner, 2026-09-25: "the kinds table in words").
 *  The words are the κ/ι ordering said aloud; the numbers stay in the JSON. */
const KIND_PLAIN: Record<Kind, KindRow["plain"]> = {
  self: { label: "About me", what: "who I am", fades: "fade slowly", corrects: "hardest to argue out of" },
  person: { label: "People", what: "someone I know", fades: "fade slowly", corrects: "hard to correct" },
  entity: { label: "Things", what: "a thing in the world", fades: "fade fairly fast", corrects: "take some arguing to correct" },
  skill: { label: "Skills", what: "how to do something", fades: "fade slowest", corrects: "easy to correct" },
  place: { label: "Places", what: "somewhere", fades: "fade fairly fast", corrects: "easy to correct" },
  fact: { label: "Facts", what: "a plain fact", fades: "fade fastest", corrects: "easiest to correct" },
};

function fadeSpeed(kappa: number): number {
  const all = KINDS.map((k) => PHYSICS.KINDS[k].kappa);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return hi === lo ? 1 : 0.2 + 0.8 * ((kappa - lo) / (hi - lo));
}

export function memoriesView(src: DashboardSource, opts: { limit?: number } = {}): MemoriesView {
  const store = src.store;
  const day = store.livedDay();
  const rows = census(src);
  const limit = opts.limit ?? 4000;
  const byKind = countMap<Kind>(rows, "kind");
  const everLived = day > 0 || rows.length > 0;

  const meanByKind = new Map<Kind, number[]>();
  for (const r of rows) {
    const list = meanByKind.get(r.kind) ?? [];
    list.push(r.strength);
    meanByKind.set(r.kind, list);
  }

  const steps = 10;
  const strengthByBand = Array.from({ length: steps }, (_, i) => ({
    from: i / steps,
    to: (i + 1) / steps,
    bands: Object.fromEntries(BANDS.map((b) => [b, 0])) as Record<string, number>,
  }));
  for (const r of rows) {
    const step = strengthByBand[Math.min(steps - 1, Math.max(0, Math.floor(r.strength * steps)))];
    if (step !== undefined) step.bands[r.band] = (step.bands[r.band] ?? 0) + 1;
  }

  const hold = { firm: 0, settling: 0, fading: 0, journal: 0 };
  for (const m of rows) {
    const row = store.row(m.id);
    if (row !== undefined && isChapterMemory(row)) hold.journal += 1;
    else if (m.unreadable) hold.settling += 1;
    else {
      try {
        hold[
          holdOf(store.physicsOf(m.id), day, {
            prunable: row === undefined || !isEntityCard(row),
            recurring: row !== undefined && repeatsOf(row) !== null,
          })
        ] += 1;
      } catch {
        hold.settling += 1;
      }
    }
  }

  return {
    day,
    total: rows.length,
    newToday: newTodayOf(src),
    owner: ownerOf(src),
    memories: rows.filter((r) => !r.schema).length,
    schemas: rows.filter((r) => r.schema).length,
    hold,
    nearLetGoDays: NEAR_LET_GO_DAYS,
    firmAheadDays: FIRM_AHEAD_DAYS,
    feelings: feelingsView(src, rows),
    strengthByBand,
    points: rows.slice(0, limit),
    pointsAbsent: rows.length === 0 ? (everLived ? NONE : NEVER) : null,
    kinds: KINDS.map((kind) => {
      const count = byKind.get(kind) ?? 0;
      const list = meanByKind.get(kind) ?? [];
      const tunables = PHYSICS.KINDS[kind];
      return {
        kind,
        count,
        meanStrength: list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length,
        absent: absenceFor(count, everLived),
        wSal: tunables.wSal,
        wRep: tunables.wRep,
        kappa: tunables.kappa,
        iota: tunables.iota,
        gloss: KIND_GLOSS[kind],
        plain: KIND_PLAIN[kind] ?? { label: kind, what: KIND_GLOSS[kind] ?? kind, fades: "", corrects: "" },
        fadeSpeed: fadeSpeed(tunables.kappa),
      };
    }),
  };
}

/** Memories written today, as the home headline counts them; 0 when that read fails. */
function newTodayOf(src: DashboardSource): number {
  try {
    return todayView(src).newToday;
  } catch {
    return 0;
  }
}

/** The owner's name (sleep's `ownerNames`, first entry), written as a name; null when none.
 *  The same reading as `overview.ts#ownerName`, spelled here because that
 *  module imports this one. */
export function ownerOf(src: DashboardSource): string | null {
  try {
    return displayName(ownerNames(src.store)[0] ?? null);
  } catch {
    return null;
  }
}

/**
 * How it feels: the feelings recorded on `rows` (the live census), by the
 * wheel's seven cores, yours and mine. The memories tab's radar draws it, and
 * the home tab draws the same radar from the same numbers.
 */
export function feelingsView(src: DashboardSource, rows: readonly { readonly id: string }[] = census(src)): FeelingsView {
  const sides = new Map<string, { yours: Side; mine: Side }>(
    CORE_EMOTIONS.map((c) => [c, { yours: side(), mine: side() }]),
  );
  let carrying = 0;
  for (const m of rows) {
    const felt = feelingsShown(src.store, m.id);
    if (felt.length > 0) carrying += 1;
    for (const f of felt) {
      const at = sides.get(f.core);
      const s = f.whose === "owner" ? at?.yours : f.whose === "self" ? at?.mine : undefined;
      if (s === undefined) continue;
      s.count += 1;
      s.sum += Math.max(0, Math.min(1, f.strength));
      s.words.set(f.word, (s.words.get(f.word) ?? 0) + 1);
    }
  }
  return {
    carrying,
    owner: ownerOf(src),
    cores: CORE_EMOTIONS.map((core) => {
      const at = sides.get(core) ?? { yours: side(), mine: side() };
      return { core, yours: sideOut(at.yours), mine: sideOut(at.mine) };
    }),
  };
}

interface Side {
  count: number;
  sum: number;
  words: Map<string, number>;
}
const side = (): Side => ({ count: 0, sum: 0, words: new Map() });
function sideOut(s: Side): FeelingSide {
  return {
    count: s.count,
    sum: Math.round(s.sum * 1000) / 1000,
    words: [...s.words.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// the list — every memory, with its words, a page at a time
// ─────────────────────────────────────────────────────────────────────────────

export type ListState = "live" | "archived" | "all";

export interface ListRow {
  readonly id: string;
  /** The title, when the memory carries one (withheld when confidential). */
  readonly title: string | null;
  /** The first line of the memory's own words — or its named absence, or the withholding. */
  readonly line: string;
  readonly confidential: boolean;
  readonly kind: Kind;
  readonly band: Band;
  readonly strength: number;
  readonly bornDay: number;
  /** Lived days since it was born. */
  readonly livedDays: number;
  /** Why it was archived, in plain words; null while it is live. */
  readonly archived: string | null;
  /** The reason exactly as the store recorded it. */
  readonly archivedReason: string | null;
  /** An entity or a belief about one (a schema row), not a memory proper. */
  readonly schema: boolean;
  /** For a schema row: what it is — "entity", "belief", "current state". */
  readonly schemaRole: string | null;
  /** The words to show: headings dropped, a date written at their front lifted off. */
  readonly text: string;
  /** The date shown beside the row (`YYYY-MM-DD`), and where it came from. */
  readonly date: string | null;
  readonly dateFrom: DateFrom | null;
  /** In the core (promoted into identity). */
  readonly core: boolean;
  readonly protected: boolean;
  /** A journal-chapter memory (`isChapterMemory`): not scored, shown as "journal". */
  readonly journal: boolean;
  readonly feelings: FeelingShown[];
  /** v7 moment it was written (UTC ms); null on an older row. */
  readonly createdAt: number | null;
  /** How firmly it is held (`holdOf`); null for an archived row or a journal chapter. */
  readonly hold: Hold | null;
  /** A live row whose date still repeats: how often, as a person says it
   *  (`every May 14`, `repeatsOf`) — kept for its next occurrence, so never
   *  "fading" (2026-10-09). Null otherwise, and on a withheld row. */
  readonly repeats: string | null;
  /** Put-away rows only: how many put-away versions of the same memory this
   *  one row stands for (itself included) — 1 for most. See `versionKey`. */
  readonly versions: number;
}

export type ListSort = "newest" | "oldest";

export interface MemoryListView {
  readonly day: number;
  readonly state: ListState;
  readonly kind: Kind | null;
  readonly band: Band | null;
  readonly core: boolean;
  readonly journal: boolean;
  readonly hold: Hold | null;
  /** A feeling filter from the radar: one word from one side, or every feeling under one core. */
  readonly feeling: { readonly word: string; readonly whose: "owner" | "self" } | null;
  readonly feelingCore: string | null;
  readonly sort: ListSort;
  readonly offset: number;
  readonly limit: number;
  /** Rows matching every filter — what the pager pages over. */
  readonly total: number;
  /** Within the live/archived choice alone, so every chip can say its count. */
  readonly counts: {
    readonly live: number;
    readonly archived: number;
    readonly kinds: Record<string, number>;
    readonly bands: Record<string, number>;
    /** In the core, and journal chapters — each within the live/archived choice. */
    readonly core: number;
    readonly journal: number;
    /** Firm / settling / fading — live rows only, journal chapters left out. */
    readonly hold: Record<Hold, number>;
    /** Memories carrying a feeling under each of the wheel's seven cores (either
     *  side), within the live/archived choice. */
    readonly feelings: Record<string, number>;
  };
  readonly rows: ListRow[];
  readonly absent: string | null;
}

/** The archive reasons the core writes, said the way a person would say them. */
export const LIST_MAX = 200;

/** A schema row's role, from its own meta: an entity has no `entityId` to hang on. */
function schemaRole(meta: string): string {
  try {
    const m = JSON.parse(meta) as Record<string, unknown>;
    if (m["role"] === "current-state") return "current state";
    if (typeof m["entityId"] === "string") return "belief";
    return "entity";
  } catch {
    return "entity";
  }
}

/**
 * The key a put-away row's other versions share, or null when it stands alone:
 * a journal-chapter memory's episode (each regrowing puts the last reading
 * away), else the memory its `superseded_by` chain ends at. Read from the row
 * and its successors — display only.
 */
function versionKey(store: DashboardSource["store"], row: Parameters<typeof isChapterMemory>[0] & { superseded_by: string | null }): string | null {
  if (isChapterMemory(row)) {
    try {
      const ep = (JSON.parse(row.meta) as Record<string, unknown>)["episodeId"];
      if (typeof ep === "string") return `episode:${ep}`;
    } catch {
      /* no episode to group by */
    }
  }
  let next = row.superseded_by;
  if (next === null) return null;
  const seen = new Set<string>();
  for (let i = 0; i < 50 && !seen.has(next); i++) {
    seen.add(next);
    const r = store.row(next);
    if (r === undefined || r.superseded_by === null) break;
    next = r.superseded_by;
  }
  return `head:${next}`;
}

function firstLine(body: string, width: number): string {
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"));
  const t = line ?? body.trim();
  return t.length > width ? `${t.slice(0, width - 1).trimEnd()}…` : t;
}

/**
 * `/api/memories/list` — every memory, newest first, filtered and paged HERE so
 * a store of twenty thousand rows sends one page. The sort and the filters read
 * only the row columns and the physics (one row read per id); the words are
 * read for the page slice alone, through `revealHere` — an archived row's OWN
 * words, never its successor's.
 */
export function memoryListView(
  src: DashboardSource,
  opts: {
    state?: string | null;
    kind?: string | null;
    band?: string | null;
    core?: boolean;
    journal?: boolean;
    hold?: string | null;
    /** A feeling's word as shown (`proud`, or an `other`'s own word), with `whose`. */
    feeling?: string | null;
    whose?: string | null;
    /** Every feeling under this core, from either side. */
    feelingCore?: string | null;
    sort?: string | null;
    offset?: number;
    limit?: number;
  } = {},
): MemoryListView {
  const store = src.store;
  const day = store.livedDay();
  const state: ListState = opts.state === "archived" || opts.state === "all" ? opts.state : "live";
  const kind = KINDS.includes(opts.kind as Kind) ? (opts.kind as Kind) : null;
  const band = BANDS.includes(opts.band as Band) ? (opts.band as Band) : null;
  const limit = Math.max(1, Math.min(LIST_MAX, Math.floor(opts.limit ?? 50)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const onlyCore = opts.core === true;
  const onlyJournal = opts.journal === true;
  const sort: ListSort = opts.sort === "oldest" ? "oldest" : "newest";
  const word = typeof opts.feeling === "string" ? opts.feeling.trim().toLowerCase() : "";
  const feeling: MemoryListView["feeling"] =
    word.length > 0 && (opts.whose === "owner" || opts.whose === "self") ? { word, whose: opts.whose } : null;
  const feelingCore = feeling === null && (CORE_EMOTIONS as readonly string[]).includes(opts.feelingCore ?? "") ? (opts.feelingCore as string) : null;
  // Read only when a feeling filter asks for it: one feelings read per row.
  const felt = (id: string): boolean => {
    if (feeling === null && feelingCore === null) return true;
    return feelingsShown(store, id).some((f) =>
      feeling !== null ? f.whose === feeling.whose && f.word.toLowerCase() === feeling.word : f.core === feelingCore,
    );
  };
  const onlyHold: Hold | null = opts.hold === "firm" || opts.hold === "settling" || opts.hold === "fading" ? opts.hold : null;

  interface Slim {
    id: string;
    kind: Kind;
    band: Band;
    strength: number;
    bornDay: number;
    learnedOn: string;
    createdAt: number | null;
    archived: boolean;
    core: boolean;
    journal: boolean;
    hold: Hold | null;
    repeats: string | null;
    /** Put-away rows only: the key its other versions share, or null. */
    group: string | null;
    versions: number;
    cores: Set<string>;
  }
  const all: Slim[] = [];
  let live = 0;
  let archived = 0;
  for (const id of store.list({})) {
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    const isArchived = row.archived === 1;
    if (isArchived) archived += 1;
    else live += 1;
    if (state === "live" && isArchived) continue;
    if (state === "archived" && !isArchived) continue;
    let b: Band = row.band;
    let s = 0;
    const chapter = isChapterMemory(row);
    let hold: Hold | null = null;
    // Kept while it repeats (the prune's `recurring` gate): live rows only.
    const repeats = isArchived || chapter ? null : repeatsOf(row);
    try {
      const physics = rowToPhysics(row);
      b = bandOf(physics, day);
      s = strengthOf(physics, day);
      if (!isArchived && !chapter) hold = holdOf(physics, day, { prunable: !isEntityCard(row), recurring: repeats !== null });
    } catch {
      /* a row whose physics will not compute still lists, at zero */
      if (!isArchived && !chapter) hold = "settling";
    }
    all.push({
      id,
      kind: row.kind,
      band: b,
      strength: s,
      bornDay: row.birth_day,
      learnedOn: row.learned_on,
      createdAt: row.created_at ?? null,
      archived: isArchived,
      core: row.promoted_identity === 1,
      journal: chapter,
      hold,
      repeats,
      group: isArchived ? versionKey(store, row) : null,
      versions: 1,
      cores: new Set(feelingsShown(store, id).map((f) => f.core)),
    });
  }
  const kinds: Record<string, number> = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const bands: Record<string, number> = Object.fromEntries(BANDS.map((b) => [b, 0]));
  let core = 0;
  let journal = 0;
  const holds: Record<Hold, number> = { firm: 0, settling: 0, fading: 0 };
  const feelingCounts: Record<string, number> = Object.fromEntries(CORE_EMOTIONS.map((c) => [c, 0]));
  for (const r of all) {
    for (const c of r.cores) feelingCounts[c] = (feelingCounts[c] ?? 0) + 1;
    if (r.hold !== null) holds[r.hold] += 1;
    kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
    bands[r.band] = (bands[r.band] ?? 0) + 1;
    if (r.core) core += 1;
    if (r.journal) journal += 1;
  }
  const filtered = all.filter(
    (r) =>
      (kind === null || r.kind === kind) &&
      (band === null || r.band === band) &&
      (!onlyCore || r.core) &&
      (!onlyJournal || r.journal) &&
      (onlyHold === null || r.hold === onlyHold) &&
      (feelingCore !== null && feeling === null ? r.cores.has(feelingCore) : felt(r.id)),
  );
  // Newest first: the lived day it was born, then the moment it was written
  // (v7 `created_at`; a row from before v7 has none and counts as the older),
  // then the calendar day it was recorded, then the id — so the order is
  // defined, not SQLite's. Oldest first is exactly the reverse.
  const newestFirst = (a: Slim, b: Slim): number =>
    b.bornDay - a.bornDay ||
    (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity) ||
    (a.learnedOn < b.learnedOn ? 1 : a.learnedOn > b.learnedOn ? -1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  filtered.sort(newestFirst);
  // Several put-away versions of the same memory are one row: the newest
  // stands for them, with how many there are (2026-09-28, round 4).
  const lead = new Map<string, Slim>();
  const matching: Slim[] = [];
  for (const r of filtered) {
    const first = r.group === null ? undefined : lead.get(r.group);
    if (first !== undefined) {
      first.versions += 1;
      continue;
    }
    if (r.group !== null) lead.set(r.group, r);
    matching.push(r);
  }
  if (sort === "oldest") matching.reverse();
  const rows: ListRow[] = matching.slice(offset, offset + limit).map((r) => {
    const row = store.row(r.id);
    const here = revealHere(store, r.id, 160);
    let title: string | null = null;
    let line: string;
    let text: string;
    if (!here.present) line = text = here.label;
    else if (here.confidential) line = text = WITHHELD;
    else {
      const t = row?.title ?? null;
      title = t !== null && t.trim().length > 0 ? t.trim() : null;
      line = firstLine(row?.body ?? "", 160) || here.label;
      text = "";
    }
    const shown = shownOf(row?.body ?? "", {
      chapter: r.journal,
      learnedOn: r.learnedOn,
      confidential: here.confidential || !here.present,
      withheld: text,
    });
    // A journal chapter reads as its first real sentence under "Journal · <day>".
    const words = r.journal && !here.confidential && here.present ? firstSentence(shown.text) : shown.text;
    return {
      id: r.id,
      title,
      line,
      confidential: here.confidential,
      kind: r.kind,
      band: r.band,
      strength: r.strength,
      bornDay: r.bornDay,
      livedDays: Math.max(0, day - r.bornDay),
      archived: r.archived ? archiveWords(row?.archived_reason ?? null, (row?.superseded_by ?? null) !== null) : null,
      archivedReason: r.archived ? (row?.archived_reason ?? null) : null,
      schema: row?.type === "schema",
      schemaRole: row?.type === "schema" ? schemaRole(row.meta) : null,
      text: words || line,
      date: shown.date,
      dateFrom: shown.dateFrom,
      core: r.core,
      protected: row?.protected === 1,
      journal: r.journal,
      feelings: feelingsShown(store, r.id),
      createdAt: r.createdAt,
      hold: r.hold,
      // A withheld row shows no date of its own in the list, so not how often
      // its date comes round either; it is still never "fading".
      repeats: here.confidential || !here.present ? null : r.repeats,
      versions: r.versions,
    };
  });
  const everLived = day > 0 || live + archived > 0;
  return {
    day,
    state,
    kind,
    band,
    core: onlyCore,
    journal: onlyJournal,
    hold: onlyHold,
    feeling,
    feelingCore,
    sort,
    offset,
    limit,
    total: matching.length,
    counts: { live, archived, kinds, bands, core, journal, hold: holds, feelings: feelingCounts },
    rows,
    absent: matching.length === 0 ? (everLived ? NONE : NEVER) : null,
  };
}
