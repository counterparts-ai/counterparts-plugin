/**
 * TWO CHEAP READINGS OF THE SELF (2026-10-20, wave 1 of the 10-20 roadmap; an
 * experiment, lightly held). Nothing measured the self: the benchmarks test
 * question answering, and the page is rewritten nightly from core nominations
 * in a model's prose. These two give wave 2 a before and after that is not
 * taste alone.
 *
 *   - **Traceability** (`pageTrace`): what the page's claims rest on. A claim
 *     is a sentence (`page.ts#pageClaims`); one with no memory behind it is a
 *     hypothesis, counted and shown as one, never removed.
 *   - **Support** (`coreSupport`): what stands behind each core element —
 *     returns, derivations and links as three separate counts — and how many
 *     lived days and contexts they span. One from day 1 is a hypothesis;
 *     twelve across six weeks is earned.
 *
 * READINGS ONLY. Nothing promotes, demotes, refuses or rewrites on either;
 * that is wave 2's and the rules audit's business. Ids and numbers, no words
 * but the page's own sentences. Never throws.
 */
import { derivedFrom } from "../fit/index.js";
import { strength } from "../physics/index.js";
import { headOf } from "../recall/standing.js";
import type { ReadOnlyStore } from "../store/index.js";
import { pageClaims } from "./page.js";
import type { SelfPage } from "./page.js";
import { SELF_TUNABLES } from "./tunables.js";

/** Where a cited memory stands now. */
export type CitedState = "live" | "archived" | "missing";

export interface PageTraceReading {
  /** Sentences on the page (`pageClaims`). */
  readonly claims: number;
  /**
   * Where the whole-page list came from: `page` — stored with this text;
   * `reflection` — a page from before, read off the reflection that wrote it
   * (its entry's ids and the page's together); `none` — nothing recorded.
   */
  readonly source: "page" | "reflection" | "none";
  /** The distinct memories cited, and where each stands now. */
  readonly cites: number;
  /** Live, or settled under a later memory that is (`throughLater`). */
  readonly live: number;
  readonly archivedOrMissing: number;
  /**
   * THROUGH A LATER MEMORY (2026-10-23, lane D1's check (d)): cites whose own
   * memory a dream merged or a settle put under a newer one, read through to
   * that one (`recall/standing.ts#headOf`) — the cite stays as written, and
   * counts as live while what stands for it does. A merge's original stays
   * live, faded, until its own curve archives it; without this the page's
   * cite then read as archived though its merged memory stood.
   */
  readonly throughLater: number;
  /** Claims with no memory behind them; null when cites were not kept per claim for this text. */
  readonly uncited: number | null;
  /** Those claims' words, in page order (the hypotheses), or null with `uncited`. */
  readonly hypotheses: readonly string[] | null;
}

/** The reflection a page's reason names (`reflection rfl_…`), as `Self#pageCovers` reads it. */
const REFLECTION_REF = /\breflection (rfl_[0-9a-f]+)/;

/**
 * THE PAGE'S TRACEABILITY: its claims, the memories it cites and where they
 * stand, and its claims with none behind them. A page written before cites
 * were kept with it (2026-10-20) falls back to its reflection's record, said
 * so in `source`, and reads `uncited: null` — never "all hypotheses".
 */
export function pageTrace(store: Pick<ReadOnlyStore, "row" | "reflection" | "contradictionsOf">, page: SelfPage): PageTraceReading {
  const claims = pageClaims(page.body);
  let source: PageTraceReading["source"] = "none";
  let ids: string[] = [];
  if (page.trace !== null) {
    source = "page";
    ids = [...page.trace.cites];
  } else {
    const ref = REFLECTION_REF.exec(page.reason ?? "")?.[1];
    if (page.by === "reflection" && ref !== undefined) {
      try {
        const raw: unknown = JSON.parse(store.reflection(ref)?.cites ?? "[]");
        if (Array.isArray(raw)) {
          ids = raw.filter((x): x is string => typeof x === "string");
          source = "reflection";
        }
      } catch {
        /* a record that will not read cites nothing */
      }
    }
  }
  const distinct = [...new Set(ids)];
  let live = 0;
  let throughLater = 0;
  for (const id of distinct) {
    // Its own memory first; only one gone is read through what merged it
    // (review of D1: not a correction's, which says the cite was wrong).
    if (citedState(store, id) === "live") {
      live += 1;
      continue;
    }
    const later = laterHead(store, id);
    if (later !== null && citedState(store, later) === "live" && mergedFrom(store, later, id)) {
      live += 1;
      throughLater += 1;
    }
  }
  const perClaim = page.trace?.claims ?? null;
  const hypotheses = perClaim === null ? null : perClaim.filter((c) => c.cites.length === 0).map((c) => c.text);
  return {
    claims: claims.length,
    source,
    cites: distinct.length,
    live,
    archivedOrMissing: distinct.length - live,
    throughLater,
    uncited: hypotheses === null ? null : hypotheses.length,
    hypotheses,
  };
}

/** The later memory a cited one now stands under (a merge, a settle), or null. Never throws. */
function laterHead(store: Pick<ReadOnlyStore, "row" | "contradictionsOf">, id: string): string | null {
  try {
    return headOf(store, id);
  } catch {
    return null;
  }
}

/** Was `id` merged into `into`, through a few merges (`meta.mergedFrom`, as `writer.ts#isOfDay` follows it)? Never throws. */
function mergedFrom(store: Pick<ReadOnlyStore, "row">, into: string, id: string, depth = 0): boolean {
  if (depth >= 4) return false;
  try {
    const from = (JSON.parse(store.row(into)?.meta ?? "{}") as Record<string, unknown>)["mergedFrom"];
    if (!Array.isArray(from)) return false;
    return from.some((x) => typeof x === "string" && (x === id || mergedFrom(store, x, id, depth + 1)));
  } catch {
    return false;
  }
}

/** Live, archived, or gone from the store (removed, or never there). Never throws. */
export function citedState(store: Pick<ReadOnlyStore, "row">, id: string): CitedState {
  try {
    const r = store.row(id);
    if (r === undefined) return "missing";
    return r.archived === 1 ? "archived" : "live";
  } catch {
    return "missing";
  }
}

/** What stands behind one core element. */
export interface CoreSupportRow {
  readonly id: string;
  /** Counted returns (`returns` rows: awake, dream, reflection). */
  readonly returns: number;
  /**
   * What it was made from: the ids its meta names (`fit#derivedFrom`: a merge's
   * originals, a gist's sources, its episode) and the episode it was born from
   * (`origin_ref`), each once.
   */
  readonly derivations: number;
  /** Distinct memories an association edge joins it to, either way. Its own column: it widens neither span. */
  readonly links: number;
  /** Distinct lived days across its birth, its returns, and what it was made from (never its links). */
  readonly days: number;
  /** Distinct contexts (`origin_scope`: a project, a directory) across it and what it was made from (never its links). */
  readonly contexts: number;
}

export interface CoreSupport {
  readonly elements: readonly CoreSupportRow[];
  /** Elements whose returns and derivations all sit on one lived day: one episode behind them. */
  readonly oneEpisode: number;
}

/**
 * SUPPORT, PER CORE ELEMENT (2026-10-20). A core element is a live row with
 * `promoted_identity` (the set `counterparts core --list` shows). The
 * derivations column reads the element's own meta, what it was MADE FROM,
 * because the `derivations` table is pre-provisioned and nothing writes it
 * yet (store/operational.ts, v13); when something does, this is the place to
 * read it. A memory born from an episode records it in `origin_ref`, not in
 * its meta, so that counts too: a ref naming an episode (`epi_…`, its chapter
 * after `#` set aside) or a memory row. A dream's or reflection's ref
 * (`dream:…`, `reflection:…`) and a migration's are not lived episodes and
 * are left out. LINKS ARE THEIR OWN COLUMN and widen neither span (review of
 * #550): ~9,500 exist on Mike's store, so counting what they join would make
 * nearly every element read as spanning many days, which is the early-core
 * problem this reading is meant to show. Links are also the weakest column
 * (none had brought a memory to mind as of 10-20); the 10-22 check of co-use
 * links says whether to keep them. Never throws.
 */
export function coreSupport(store: Pick<ReadOnlyStore, "row" | "list" | "allEdges" | "returnsOf">): CoreSupport {
  const elements: CoreSupportRow[] = [];
  try {
    const core = new Set<string>();
    for (const id of store.list({ archived: false })) {
      if (store.row(id)?.promoted_identity === 1) core.add(id);
    }
    if (core.size === 0) return { elements, oneEpisode: 0 };
    const linked = new Map<string, Set<string>>();
    for (const e of store.allEdges()) {
      for (const [a, b] of [
        [e.src, e.dst],
        [e.dst, e.src],
      ] as const) {
        if (!core.has(a) || a === b) continue;
        const set = linked.get(a) ?? new Set<string>();
        set.add(b);
        linked.set(a, set);
      }
    }
    for (const id of core) {
      const row = store.row(id);
      if (row === undefined) continue;
      const days = new Set<number>([row.birth_day]);
      const contexts = new Set<string>();
      const place = (r: { birth_day: number; origin_scope: string | null } | undefined): void => {
        if (r === undefined) return;
        days.add(r.birth_day);
        if (r.origin_scope !== null && r.origin_scope.length > 0) contexts.add(r.origin_scope);
      };
      place(row);
      let returns = 0;
      try {
        const rows = store.returnsOf(id);
        returns = rows.length;
        for (const r of rows) days.add(r.day);
      } catch {
        returns = 0;
      }
      // WHAT IT WAS MADE FROM, each once: an episode by its own id (a
      // chapter's `#n` set aside), anything else by its row id.
      const made = new Set<string>();
      for (const d of derivedFrom(row)) {
        const key = d.id.split("#")[0] ?? d.id;
        if (key.length > 0 && key !== id && !made.has(key)) {
          made.add(key);
          place(store.row(key));
        }
      }
      const ref = row.origin_ref ?? "";
      const refKey = ref.split("#")[0] ?? "";
      if (refKey.length > 0 && refKey !== id && !made.has(refKey) && (refKey.startsWith("epi_") || store.row(refKey) !== undefined)) {
        made.add(refKey);
        place(store.row(refKey));
      }
      const links = linked.get(id)?.size ?? 0;
      elements.push({ id, returns, derivations: made.size, links, days: days.size, contexts: contexts.size });
    }
  } catch {
    /* what was read stands */
  }
  return { elements, oneEpisode: elements.filter((e) => e.days <= 1).length };
}

// ── the core from beliefs (wave 2 lane F, 2026-10-22; design §6, lightly held) ──

/** One belief about me or us on the self subject, as the core reads it. */
export interface CoreBelief {
  readonly id: string;
  readonly statement: string;
  readonly about: "me" | "us" | null;
  /** Its strength on the day read (physics: its support arm, decayed like any memory). */
  readonly strength: number;
  /** Memories counted for it (`belief_support`, stance support, not a `link`). */
  readonly memories: number;
  /** LIVED days its support comes from (`livedSupportDays`): an un-echoed find adds none. */
  readonly days: number;
  /** Contrary pressure crossed its bar: it waits on a revision, and is not settled. */
  readonly contested: boolean;
}

/** The routes that are life itself speaking (`physics#supportCredit`'s lived routes). */
const LIVED_SUPPORT_ROUTES: ReadonlySet<string> = new Set(["testimony", "choice", "use"]);

/**
 * THE LIVED DAYS A BELIEF'S SUPPORT COMES FROM, as the core's floor reads them
 * (lane F; review of #587): the distinct days the memories counted FOR it were
 * born, over the lived filings (testimony, choice, use) and the finds life has
 * echoed — a `found` filing whose memory was born before the latest lived
 * filing's memory (`physics#supportCredit`'s echo rule). An un-echoed find
 * adds NO day, and a `link` none. Not C's `supportDays`, which gives an
 * un-echoed find its FILING day: right for resistance (one night of finds is
 * one day of hardness), wrong for this floor, where a filing day is not a day
 * anyone lived — through the reflect tool, one owner's line and four felt
 * finds from one evening read 2 days there and passed the default floors. Pure.
 */
export function livedSupportDays(rows: readonly { stance: string; route: string; bornDay: number | null }[]): number {
  const support = rows.filter((r) => r.stance === "support" && r.bornDay !== null);
  let lastLivedBorn = Number.NEGATIVE_INFINITY;
  for (const r of support) if (LIVED_SUPPORT_ROUTES.has(r.route)) lastLivedBorn = Math.max(lastLivedBorn, r.bornDay as number);
  const days = new Set<number>();
  for (const r of support) {
    const born = r.bornDay as number;
    if (LIVED_SUPPORT_ROUTES.has(r.route) || (r.route === "found" && born < lastLivedBorn)) days.add(born);
  }
  return days.size;
}

/** The floors a belief passes to be in the core; `max` is the cap. */
export interface CoreBeliefFloors {
  readonly strength: number;
  readonly memories: number;
  readonly days: number;
  readonly max: number;
}

/** The floors as set now: read at use from `SELF_TUNABLES`, so a run's `--set` reaches them. */
export function coreBeliefFloors(): CoreBeliefFloors {
  return {
    strength: SELF_TUNABLES.CORE_BELIEF_STRENGTH,
    memories: SELF_TUNABLES.CORE_BELIEF_MEMORIES,
    days: SELF_TUNABLES.CORE_BELIEF_DAYS,
    // "Capped as today's core": the most identity elements the wake ever considers.
    max: SELF_TUNABLES.IDENTITY_MAX,
  };
}

/** What `beliefCoreCandidates` reads. */
export type ReadsBeliefCore = Pick<ReadOnlyStore, "selfSubject" | "list" | "row" | "readProse" | "supportOf" | "physicsOf">;

/**
 * EVERY LIVE BELIEF ON THE SELF SUBJECT, with what the core's floors read:
 * strength on `day`, memories for it, lived days of support, contested.
 * Not archived, not superseded. Strongest first. A read; [] before the self
 * subject exists. Never throws.
 */
export function beliefCoreCandidates(store: ReadsBeliefCore, day: number): CoreBelief[] {
  const out: CoreBelief[] = [];
  try {
    const me = store.selfSubject();
    if (me === null) return out;
    for (const id of store.list({ type: "schema", archived: false })) {
      const row = store.row(id);
      if (row === undefined || row.archived === 1 || row.superseded_by !== null || !row.meta.includes('"belief"')) continue;
      let meta: Record<string, unknown>;
      let statement: string;
      try {
        const doc = store.readProse(id);
        meta = doc.meta;
        statement = doc.body;
      } catch {
        continue;
      }
      if (meta["role"] !== "belief" || meta["entityId"] !== me) continue;
      const p = store.physicsOf(id);
      let memories = 0;
      let days = 0;
      try {
        const rows = store.supportOf(id);
        memories = rows.filter((r) => r.stance === "support" && r.route !== "link").length;
        days = livedSupportDays(rows);
      } catch {
        memories = 0;
        days = 0;
      }
      out.push({
        id,
        statement,
        about: row.about === "me" ? "me" : row.about === "us" ? "us" : null,
        strength: strength(p, day),
        memories,
        days,
        contested: meta["contested"] !== undefined,
      });
    }
  } catch {
    /* what was read stands */
  }
  return out.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
}

/** Which floor a belief missed first, or null when it passes all of them. Pure. */
export function coreBeliefMiss(b: CoreBelief, floors: CoreBeliefFloors): "contested" | "strength" | "memories" | "days" | null {
  if (b.contested) return "contested";
  if (b.strength < floors.strength) return "strength";
  if (b.memories < floors.memories) return "memories";
  if (b.days < floors.days) return "days";
  return null;
}

/** The core as beliefs, and what was held back by which floor. */
export interface CoreFromBeliefs {
  /** Passing every floor, strongest first, at most `floors.max`. */
  readonly elements: readonly CoreBelief[];
  /** Beliefs on the self subject read, and those held back by the first floor each missed (and the cap). */
  readonly considered: number;
  readonly held: Readonly<Record<"contested" | "strength" | "memories" | "days" | "cap", number>>;
}

/**
 * THE CORE FROM BELIEFS (wave 2 lane F, design §6; `self.CORE_FROM_BELIEFS`):
 * the strongest current beliefs about me and us on the self subject that pass
 * the floors — strength, memories for it, lived days of support (an
 * un-echoed find counts none, `livedSupportDays`) — and are not contested, at most
 * `floors.max`. A VIEW, read when asked: nothing is promoted or written, so a
 * belief leaves it as it weakens, is contested or retired, and the switch off
 * leaves nothing behind. Not `promoted_identity`: a promoted row reads
 * strength 1 for ever (`physics#strength`), which would stop a belief from
 * fading and a contest from cutting it (design §2, §5). Never throws.
 */
export function coreFromBeliefs(store: ReadsBeliefCore, day: number, floors: CoreBeliefFloors = coreBeliefFloors()): CoreFromBeliefs {
  const all = beliefCoreCandidates(store, day);
  const held = { contested: 0, strength: 0, memories: 0, days: 0, cap: 0 };
  const elements: CoreBelief[] = [];
  for (const b of all) {
    const miss = coreBeliefMiss(b, floors);
    if (miss !== null) held[miss] += 1;
    else if (elements.length >= floors.max) held.cap += 1;
    else elements.push(b);
  }
  return { elements, considered: all.length, held };
}
