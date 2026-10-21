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
import type { ReadOnlyStore } from "../store/index.js";
import { pageClaims } from "./page.js";
import type { SelfPage } from "./page.js";

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
  readonly live: number;
  readonly archivedOrMissing: number;
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
export function pageTrace(store: Pick<ReadOnlyStore, "row" | "reflection">, page: SelfPage): PageTraceReading {
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
  for (const id of distinct) if (citedState(store, id) === "live") live += 1;
  const perClaim = page.trace?.claims ?? null;
  const hypotheses = perClaim === null ? null : perClaim.filter((c) => c.cites.length === 0).map((c) => c.text);
  return {
    claims: claims.length,
    source,
    cites: distinct.length,
    live,
    archivedOrMissing: distinct.length - live,
    uncited: hypotheses === null ? null : hypotheses.length,
    hypotheses,
  };
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
