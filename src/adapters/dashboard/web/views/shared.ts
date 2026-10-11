/**
 * Shared shaping: the census and the small counters every view leans on.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { band, sal, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import type { DashboardSource } from "../../source.js";
import { gistOfDoc, reveal } from "../reveal.js";

/** How many rows a feed hands back unless asked otherwise. */
export const FEED_LIMIT = 40;
/** The event-log read ceiling. The log is bounded-retention anyway. */
export const LOG_CEILING = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// shared shaping
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryLine {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly kind: Kind;
  readonly band: Band;
  /** The band column as recorded — a birth fossil, kept beside the live one. */
  readonly recordedBand: Band;
  readonly strength: number;
  readonly salience: number;
  readonly uses: number;
  readonly bornDay: number;
  readonly lastUsedDay: number;
  readonly ageDays: number;
  readonly protected: boolean;
  readonly promoted: boolean;
  readonly pressure: number;
  readonly archived: string | null;
  /**
   * True for a `schema` row — an entity, or a belief about one.
   *
   * It is in this census because the physics runs on it like anything else and
   * every distribution on the memories page should cover it. It is NOT a
   * memory, and counting it as one made the overview's headline disagree with
   * the console: 145 against `counterparts status`'s 121 memories plus 24
   * beliefs and entities, on the same store, at the same moment.
   */
  readonly schema: boolean;
  /** True when the row would not read at all — listed, never dropped. */
  readonly unreadable: boolean;
}

interface CensusOptions {
  readonly includeArchived?: boolean;
}

/**
 * Every live memory, with its physics computed for today. One pass; every panel
 * on the memories page is a fold over this array, so the page cannot disagree
 * with itself about how many memories there are.
 */
export function census(src: DashboardSource, opts: CensusOptions = {}): MemoryLine[] {
  const store = src.store;
  const day = store.livedDay();
  const filter = opts.includeArchived === true ? {} : { archived: false };
  const out: MemoryLine[] = [];
  for (const id of store.list(filter)) {
    const row = store.row(id);
    if (row === undefined) continue;
    // The journal is not a memory. See the file header.
    if (isJournal(row)) continue;
    try {
      const physics = store.physicsOf(id);
      const doc = store.readProse(id);
      const g = gistOfDoc(doc, 96);
      const live = band(physics, day);
      out.push({
        id,
        text: g.text,
        confidential: g.confidential,
        kind: row.kind,
        band: live,
        recordedBand: row.band,
        strength: strength(physics, day),
        salience: sal(physics.salience),
        uses: physics.uses,
        bornDay: physics.birthDay,
        lastUsedDay: physics.lastUsedDay,
        ageDays: Math.max(0, day - physics.birthDay),
        protected: physics.protected === true,
        promoted: physics.promotedIdentity === true,
        pressure: physics.pressure,
        archived: row.archived === 1 ? (row.archived_reason ?? "archived") : null,
        schema: row.type === "schema",
        unreadable: false,
      });
    } catch {
      // A removed row, or prose that will not read. It is still a real row, so
      // it is a named absence in the list rather than a silent subtraction.
      out.push({
        id,
        text: reveal(store, id, 96).label,
        confidential: false,
        kind: row.kind,
        band: row.band,
        recordedBand: row.band,
        strength: 0,
        salience: 0,
        uses: 0,
        bornDay: 0,
        lastUsedDay: 0,
        ageDays: 0,
        protected: row.protected === 1,
        promoted: row.promoted_identity === 1,
        pressure: row.pressure,
        archived: row.archived === 1 ? (row.archived_reason ?? "archived") : null,
        schema: row.type === "schema",
        unreadable: true,
      });
    }
  }
  // Strongest first, ties by id — the same order `browse.ts` lists in, so the
  // two surfaces answer "what is strong today" the same way, and so a caller
  // that takes the head of this list gets a defined row rather than whatever
  // SQLite happened to return first.
  out.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  return out;
}

export function countMap<T extends string>(rows: readonly { readonly [K in keyof MemoryLine]: MemoryLine[K] }[], key: "kind" | "band"): Map<T, number> {
  const m = new Map<T, number>();
  for (const r of rows) {
    const v = r[key] as unknown as T;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

/** The absence word for a count. Two words, deliberately (`NOTES.md`). */
export function absenceFor(count: number, everAsked: boolean): string | null {
  if (count > 0) return null;
  return everAsked ? NONE : NEVER;
}

/** Live memories, journal and schema rows excluded. The number the console
 *  prints after `Memories:`, and the number every surface here must agree on. */
export function memoriesHeld(src: DashboardSource): number {
  return census(src).filter((r) => !r.schema).length;
}

/**
 * THE DASHBOARD'S ONE MEMORY COUNT (2026-09-26, an experiment): every live row
 * but the journal's episodes — memories, and the cards for people and projects
 * with their beliefs. It is what the memories list's "live" chip counts, and
 * what the home page and the memories header say.
 *
 * NOT the console's `Memories:` (`memoriesHeld` above, memory rows only), which
 * is also doctor's and the wake preface's; the two differ by the schema rows,
 * a known gap, left open for now.
 */
export function memoriesLive(src: DashboardSource): number {
  return census(src).length;
}

/**
 * Every event name's row count, in ONE grouped query (`Store.eventCounts`,
 * INTERFACE-GAPS §5) — where this used to read up to `LOG_CEILING` rows per
 * name and take the length. Exact, not capped. A name absent from the map has
 * no rows; the caller reads the miss as 0.
 */
export function eventCountsByName(src: DashboardSource): ReadonlyMap<string, number> {
  return new Map(src.store.eventCounts().map((c) => [c.name, c.count]));
}
