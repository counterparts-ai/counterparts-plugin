/** What a memory is marked with — who said it, its status, what it is about — and how a fold or a copy inherits the marks (moved out of `store/index.ts`, 2026-10-11). */
import { parseCalendarDate } from "../time.js";
import type { Db } from "./db.js";
import { eraCarriedFrom } from "./operational.js";
import type { MemoryRow } from "./operational.js";

/**
 * v12 (2026-10-03): WHO SAID IT — the owner, me (`self`), or my inference
 * (`inferred`). Not which channel wrote the row (`source` says that): a note
 * I write can record something the owner said.
 */
export const SAID_BY = ["owner", "self", "inferred"] as const;

export type SaidBy = (typeof SAID_BY)[number];

/**
 * v12 (2026-10-03): WHAT KIND OF THING IT IS — `done` (it happened),
 * `planned` (decided, not yet done), `proposed` (put forward, not decided),
 * `asked` (a question or request still open). `kind` is taken (physics kind).
 */
export const STATUSES = ["done", "planned", "proposed", "asked"] as const;

export type MemoryStatus = (typeof STATUSES)[number];

/** The writer's three fields, as one value (v12). Each one optional. */
export interface WriteFacts {
  readonly occurredOn?: string;
  readonly saidBy?: SaidBy;
  readonly status?: MemoryStatus;
}

/** A value read as who-said-it: anything else is unknown (null). */
export function saidByOf(v: unknown): SaidBy | null {
  return typeof v === "string" && (SAID_BY as readonly string[]).includes(v) ? (v as SaidBy) : null;
}

/** A value read as a status: anything else is unknown (null). */
export function statusOf(v: unknown): MemoryStatus | null {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v) ? (v as MemoryStatus) : null;
}

/** An occurred-on date as stored — the `time.ts` reading's text — or null when unreadable. */
export function occurredOnOf(v: unknown): string | null {
  return parseCalendarDate(v)?.text ?? null;
}

/**
 * A memory's confidentiality class, from its `meta`.
 *
 * The truth table lives HERE, beside the writes that carry it, because it is a
 * gate: `recall/activate.ts#isConfidential` is the same answer by the same
 * function, so the surfacing boundary and `StoredMemory.confidential` can never
 * disagree. Since the floor it is also evaluated ONCE PER WRITE and stored in
 * `memories.confidential`, so the gate no longer parses JSON on every read —
 * a gate that re-parses at every call site is a gate that will one day fail
 * open. The function stays the single definition both the column and the
 * boundary are computed from.
 */
export function confidentialByMeta(meta: Readonly<Record<string, unknown>>): boolean {
  if (meta["confidential"] === true) return true;
  const klass = meta["confidentiality"];
  return typeof klass === "string" && klass !== "" && klass !== "open" && klass !== "normal";
}

/**
 * v9 (2026-09-27): WHAT A MEMORY IS ABOUT — a neutral, descriptive mark, so a
 * writer is not nudged toward "core-eligible": `me` (who I am), `us` (the
 * owner and me together), `owner` (the owner himself), `work` (the craft: how
 * a job is done), `world` (anything else). Set by an awake model that read the
 * words — the writer at `note` / `session_end`, or the reflection — or by the
 * v9 upgrade carrying the old kind rule. It is not a topic (a separate axis,
 * later). Only `me`, `us` and `owner` are core candidates
 * (`CORE_ABOUT_MARKS`, `sleep/consolidate.ts#aboutMe`).
 */
export const ABOUT_MARKS = ["me", "us", "owner", "work", "world"] as const;

export type AboutMark = (typeof ABOUT_MARKS)[number];

/**
 * The PERSONAL marks: a merge or gist never loses one to a work mark
 * (`inheritFrom`), a dream's or a reflection's own words may not be given one
 * by self, and "About me, from another directory" reads them. Since
 * 2026-10-11 (Group 3 part A, review 08 C2) they are NOT the core's test:
 * `owner` is about him, and feeds his card, not who I am — the core reads
 * `IDENTITY_ABOUT_MARKS`.
 */
export const CORE_ABOUT_MARKS: readonly AboutMark[] = ["me", "us", "owner"];

/**
 * WHAT THE CORE IS FOR (2026-10-11, Group 3 part A; review 08 C2, item 14):
 * a memory about me or about us — marked `me` or `us`, of one of
 * `IDENTITY_KINDS`, and not a plan (`PLAN_STATUSES`). Facts about the owner
 * and plans stay out of identity (`sleep/consolidate.ts#aboutMe`).
 */
export const IDENTITY_ABOUT_MARKS: readonly AboutMark[] = ["me", "us"];

/** The kinds a core memory may be: never a fact, a skill or a place. */
export const IDENTITY_KINDS: readonly string[] = ["self", "person", "entity"];

/** The statuses that make a memory a plan, not who I am: planned, proposed, asked. */
export const PLAN_STATUSES: readonly MemoryStatus[] = ["planned", "proposed", "asked"];

/**
 * Who set a mark. `self` (2026-10-11): the counterpart awake, re-marking an
 * existing memory in a session (`remember`'s `remark`) — `writer` is the mark
 * given at birth; `owner` is the owner's door (`counterparts about`, and the
 * dashboard through it).
 */
export const ABOUT_SETTERS = ["writer", "reflection", "owner", "upgrade", "self"] as const;

export type AboutSetter = (typeof ABOUT_SETTERS)[number];

/** A column value read as a mark: anything else is unmarked. */
export function aboutMarkOf(v: unknown): AboutMark | null {
  return typeof v === "string" && (ABOUT_MARKS as readonly string[]).includes(v) ? (v as AboutMark) : null;
}

/** What `inheritFrom` reads of a source: its mark, and — for `era` — its moment and meta. */
export type InheritSource = Pick<MemoryRow, "id" | "about" | "about_by"> & Partial<Pick<MemoryRow, "created_at" | "meta">>;

/** What a new row takes from the rows it is made from (`inheritFrom`). */
export interface Inherited {
  /**
   * What it is about, who set that mark (`about_by`), and which source gave
   * it. Null: no source was marked.
   */
  readonly about: { readonly about: AboutMark; readonly aboutBy: AboutSetter | null; readonly from: string } | null;
  /**
   * The best source's era standing, as meta keys (`operational.ts
   * #eraCarriedFrom`) — for a row that takes the best source's STORED claim
   * (a dream merge) and only for one: a row with a claim of its own (a
   * revision, a gist) is new, and the era reads it as new. Empty without a
   * `cutoff`.
   */
  readonly era: Record<string, unknown>;
}

/**
 * WHAT A NEW ROW MADE FROM EXISTING ONES INHERITS (2026-10-11; decided by
 * random-06, 2026-10-11, lightly held): one model for "this replaces that",
 * so each path that makes a row out of others reads it the same way — the
 * dream's merge and gist (D6 closed by Mike, 2026-10-11, lightly held), a
 * revision by `updates:` (its one source, the memory it revises). `best` is
 * the source whose words and claim the new row takes; absent, the first in
 * order.
 *
 * WHAT IT IS ABOUT: the best source's mark unless that is not personal and
 * another source is (`CORE_ABOUT_MARKS`: me, us, owner): a personal mark is
 * never lost to a work one, or to none. Of several personal marks, the best
 * source's when it is one, else the first in order. An unmarked best source
 * with only work or world marks beside it takes the first of those — what
 * `Store#supersedeInto`'s fill-if-unmarked carry would give it anyway, named
 * here so a caller's note says what lands. The mark keeps who set it.
 *
 * The caller with no explicit claim reads its default BY THAT mark
 * (`physics.defaultClaimFor`), with its own row's status, said-by and kind:
 * the revision's door hands the mark to `mint.ts`, which already asks.
 *
 * A dream FOLD does not read it this way (`foldMarkFrom`, decided by
 * random-06, 2026-10-11, lightly held): "personal wins by one" is right where
 * the sources are one memory said again (a merge, a revision, a pattern drawn
 * from them), but a fold summarises many parts, and one `us` part among work
 * must not make the whole stretch of work personal.
 */
export function inheritFrom(
  sources: readonly InheritSource[],
  opts: {
    best?: InheritSource;
    /** The era's cutoff (or its first recorded moment), for `era`. */
    cutoff?: string | number | null;
  } = {},
): Inherited {
  const best = opts.best ?? sources[0];
  if (best === undefined) return { about: null, era: {} };
  const personal = (r: Pick<MemoryRow, "about">): boolean => {
    const m = aboutMarkOf(r.about);
    return m !== null && CORE_ABOUT_MARKS.includes(m);
  };
  const marked = (r: Pick<MemoryRow, "about">): boolean => aboutMarkOf(r.about) !== null;
  const chosen = personal(best) ? best : (sources.find(personal) ?? (marked(best) ? best : (sources.find(marked) ?? best)));
  const mark = aboutMarkOf(chosen.about);
  const by = chosen.about_by;
  const about =
    mark === null
      ? null
      : { about: mark, aboutBy: typeof by === "string" && (ABOUT_SETTERS as readonly string[]).includes(by) ? (by as AboutSetter) : null, from: chosen.id };
  return {
    about,
    era: opts.cutoff === undefined ? {} : eraCarriedFrom({ created_at: best.created_at ?? null, meta: best.meta ?? "" }, opts.cutoff),
  };
}

/** The marks a fold takes only from a strict majority of its parts (`foldMarkFrom`). */
const FOLD_PERSONAL_MARKS: readonly AboutMark[] = ["me", "us"];

/**
 * WHAT A DREAM FOLD IS ABOUT (2026-10-11, Group 3 part B; decided by
 * random-06, 2026-10-11, lightly held): `me` or `us` only when MOST of its
 * parts — a strict majority of every part it cites, kept-at-weight ones
 * included — are `me` or `us`; then whichever of the two more of them carry
 * (a tie: the first in order). Otherwise the mark most of the others carry
 * (owner, work, world; a tie: the first in order; unmarked parts do not
 * vote), or none. A tie between personal and not is not a majority, so it is
 * not personal. Beside `inheritFrom`, whose "personal wins" stays for merges
 * and revisions. The mark keeps who set it.
 */
export function foldMarkFrom(sources: readonly InheritSource[]): Inherited["about"] {
  const pick = (allowed: (m: AboutMark) => boolean): InheritSource | null => {
    const counts = new Map<AboutMark, { n: number; first: InheritSource }>();
    for (const s of sources) {
      const m = aboutMarkOf(s.about);
      if (m === null || !allowed(m)) continue;
      const c = counts.get(m);
      if (c === undefined) counts.set(m, { n: 1, first: s });
      else c.n += 1;
    }
    let best: { n: number; first: InheritSource } | null = null;
    // Map keeps first-seen order, so a tie goes to the mark seen first.
    for (const c of counts.values()) if (best === null || c.n > best.n) best = c;
    return best?.first ?? null;
  };
  const personal = sources.filter((s) => {
    const m = aboutMarkOf(s.about);
    return m !== null && FOLD_PERSONAL_MARKS.includes(m);
  }).length;
  const chosen = personal * 2 > sources.length ? pick((m) => FOLD_PERSONAL_MARKS.includes(m)) : pick((m) => !FOLD_PERSONAL_MARKS.includes(m));
  if (chosen === null) return null;
  const by = chosen.about_by;
  return {
    about: aboutMarkOf(chosen.about) as AboutMark,
    aboutBy: typeof by === "string" && (ABOUT_SETTERS as readonly string[]).includes(by) ? (by as AboutSetter) : null,
    from: chosen.id,
  };
}

/** The v7 column's screen: a model id the host reported, or NULL. */
/**
 * v9: a successor takes its predecessor's about-mark (and who set it) when it
 * has none of its own — a revision or a merge is still the same memory, and a
 * mark that fell off at a supersede would quietly take it out of the core's
 * candidates. Inside the caller's transaction.
 */
export function carryAboutMark(ops: Db, fromId: string, toId: string): void {
  ops.run(
    `UPDATE memories
        SET about = (SELECT about FROM memories WHERE id = ?),
            about_by = (SELECT about_by FROM memories WHERE id = ?)
      WHERE id = ? AND about IS NULL AND (SELECT about FROM memories WHERE id = ?) IS NOT NULL`,
    fromId,
    fromId,
    toId,
    fromId,
  );
}

/**
 * v12: a successor takes each of the writer's three fields its predecessor
 * had and it was not given — a revision or a merge is still the same memory
 * (as `carryAboutMark`). Of several originals merged, the first that has one
 * gives it. Inside the caller's transaction; a file without the columns is
 * left alone.
 */
export function carryWriteFacts(ops: Db, fromId: string, toId: string): void {
  for (const col of ["occurred_on", "said_by", "status"] as const) {
    try {
      ops.run(
        `UPDATE memories SET ${col} = (SELECT ${col} FROM memories WHERE id = ?)
          WHERE id = ? AND ${col} IS NULL AND (SELECT ${col} FROM memories WHERE id = ?) IS NOT NULL`,
        fromId,
        toId,
        fromId,
      );
    } catch {
      return;
    }
  }
}
