/**
 * WORK MEMORIES — what the wake's craft lane carries, and what the Nearby lane
 * leaves out (2026-10-01, lane 8, held lightly: try, watch, iterate).
 *
 * Measured on the owner's store that morning: the craft lane took only kind
 * `skill` above the warm floor, the skill memories were all young and barely
 * used, so craft had never carried anything; the technical knowledge was kind
 * `fact` and competed in Nearby with the personal memories, so a session
 * opened in a reading directory woke to plumbing from another project. The
 * owner's intent: craft holds the technical memories, so they do not clutter
 * the personal self.
 *
 * So the split is by what a memory is ABOUT (`store/index.ts#ABOUT_MARKS`),
 * and, for a memory nobody has marked, by its kind:
 *
 *   - marked `work`, any kind                   → work
 *   - marked `me`, `us`, `owner` or `world`     → personal (Nearby)
 *   - unmarked `skill`                          → work
 *   - unmarked `fact`, `entity` or `place`      → work when it was written in a
 *     DIRECTORY (`origin_scope` an absolute path), personal otherwise — a name
 *     scope such as Desktop chat's `claude-desktop:` is not a directory
 *     (review of #313, HIGH 1: Desktop chat notes vanished from Nearby)
 *   - unmarked `self` or `person`               → personal, wherever written
 *     (review of #313, HIGH 2)
 *
 * The brief offered "an unmarked fact is craft only in its own directory, else
 * Nearby as today". The store said otherwise: both technical lines a reading
 * directory woke to were UNMARKED facts written in the build directory, so
 * that rule would have left them exactly where they were. An unmarked fact
 * with a directory is therefore work, shown in its own directory and not in
 * anyone's Nearby; the reflection's marks move it when it is really personal.
 *
 * The writer is ASKED to mark anything personal `owner` or `us` (the `about`
 * field's description, review of #313), and the nightly reflection's marks
 * correct what is still unmarked: an unmarked personal fact written in a
 * project waits in that project's work lines until one of them does.
 *
 * A journal copy (`meta.episodeId`) is never work, whatever its mark: "Last
 * here" already names the chapter in its directory, and its copy crossing
 * directories is decided by a core mark (`counterpart.ts#selfChapterElsewhere`).
 *
 * Pure: the caller hands in the row's facts.
 */
import type { Kind, MemoryPhysics } from "../types.js";
import { belowReach, strength } from "../physics/index.js";
import type { ProseDoc, Store } from "../store/index.js";
import { datePrefix, flatten } from "./briefing.js";

export interface WorkFacts {
  readonly about: string | null;
  readonly kind: Kind;
  /** The directory it was written in, or null/empty when unknown. */
  readonly originScope: string | null;
  /** A journal chapter's copy (`meta.episodeId` set). */
  readonly journal: boolean;
}

const UNMARKED_WORK_IN_A_DIRECTORY: ReadonlySet<Kind> = new Set<Kind>(["fact", "entity", "place"]);

/**
 * IS THIS SCOPE A DIRECTORY — an absolute path (`/…`, or a Windows drive
 * `C:\…`)? A name scope (`claude-desktop:`, `adapters/hosts.ts#isPseudoScope`)
 * is not: it names a host, and has no work of its own to be shown in.
 */
export function isDirectoryScope(scope: string | null): boolean {
  if (scope === null) return false;
  const s = scope.trim();
  return s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s);
}

export function isWorkMemory(m: WorkFacts): boolean {
  if (m.journal) return false;
  if (m.about === "work") return true;
  if (m.about !== null) return false;
  if (m.kind === "skill") return true;
  return UNMARKED_WORK_IN_A_DIRECTORY.has(m.kind) && isDirectoryScope(m.originScope);
}

// ── the craft lane, composed at delivery ────────────────────────────────────

/**
 * The lane's heading at delivery. Not `FRAMING.craft` ("How I work:"): the
 * self page has a "How I work" section of its own, and what these lines carry
 * is the work done in this directory, offered the way Nearby is.
 */
export const WORK_HERE_HEADING = "Work here, if it helps:";

/**
 * MORE WORK THAN THE WAKE SHOWED (2026-10-02): one durable row per directory
 * per lived day when a delivery had more work lines than it carried — more
 * than `WORK_HERE_MAX` (`cause: "cap"`, so the lines rotate), or fewer fitted
 * the room the handoff and "Last here" left (`cause: "room"`, none at all
 * when `shown` is 0). Counts and bytes, the directory as `scope`; never text.
 */
export const WORK_OVERFLOW_EVENT = "self.work.overflow";

export interface WorkHereOptions {
  /** The lived day strength is read at. */
  readonly day: number;
  /** How many lines (`SelfTunables.WORK_HERE_MAX`). */
  readonly max: number;
  /** Characters of each excerpt (`SelfTunables.WORK_HERE_EXCERPT`). */
  readonly excerpt: number;
  /** Ids no lane here may show: what a later memory settled over. */
  readonly skip?: ReadonlySet<string>;
  /** How many lines to rank, best first, for the caller to rotate through
   *  (`SelfTunables.WORK_HERE_POOL`). Absent: `max`. */
  readonly pool?: number;
}

interface Candidate {
  readonly id: string;
  readonly touched: number;
  readonly strength: number;
  readonly doc: ProseDoc;
  readonly bounded: boolean;
}

/** `/a/b/` and `/a/b` name one directory, as the handoff pointer reads them. */
function scopesFor(scope: string): string[] {
  const trimmed = scope.trim();
  const bare = trimmed.replace(/\/+$/, "");
  return bare.length > 0 && bare !== trimmed ? [trimmed, bare] : [trimmed];
}

/** `text` cut to at most `n` characters at a word, with an ellipsis when cut. */
export function excerptOf(text: string, n: number): string {
  const flat = flatten(text);
  if (flat.length <= n) return flat;
  const head = flat.slice(0, Math.max(1, n));
  const space = head.lastIndexOf(" ");
  return `${(space > n / 2 ? head.slice(0, space) : head).replace(/[\s,;:.—-]+$/, "")}…`;
}

/**
 * THIS DIRECTORY'S WORK, as wake lines, best first (2026-10-01, lane 8).
 *
 * The candidates are the live memories written in `scope` (`origin_scope`,
 * `Store#workCandidates`: filtered and capped in SQL, newest first, before any
 * prose is read) that are work (`isWorkMemory`), and not: in the
 * identity band, unresolved (a thread, shown store-wide), dated (a reminder,
 * the horizon's), confidential, or in `skip`. Ordered by the lived day it was
 * last touched — born or used, the later — newest first, then by strength,
 * then by id. No warm floor: a lesson written yesterday is worth a line here
 * however lightly it is held yet.
 *
 * Each line: `- <date> · <title> — <excerpt…> (<id>)`, or the excerpt alone
 * when the memory has no title — a pointer the recall tool expands by id, not
 * the memory whole. Read once per delivery, never at a boundary's render: the
 * stored bundle has no directory. Throws only what the store throws.
 */
/**
 * How many candidates per line `workHere` reads the prose of: the SQL already
 * ordered them newest first and left out what its columns rule out, so a few
 * per line covers the journal copies and threads only the prose can tell.
 */
export const WORK_HERE_READ_PER_LINE = 5;

export function workHere(
  store: Pick<Store, "workCandidates" | "row" | "readProse" | "physicsOf">,
  scope: string,
  opts: WorkHereOptions,
): string[] {
  const pool = Math.max(opts.max, opts.pool ?? opts.max);
  if (opts.max <= 0 || scope.trim().length === 0) return [];
  const seen = new Set<string>();
  const found: Candidate[] = [];
  for (const where of scopesFor(scope)) {
    for (const id of store.workCandidates(where, pool * WORK_HERE_READ_PER_LINE)) {
      if (seen.has(id) || opts.skip?.has(id) === true) continue;
      seen.add(id);
      const row = store.row(id);
      if (row === undefined || row.band === "identity" || row.event_date !== null || row.confidential === 1) continue;
      let doc: ProseDoc;
      let physics: MemoryPhysics;
      try {
        doc = store.readProse(id);
        physics = store.physicsOf(id);
      } catch {
        continue;
      }
      if (doc.meta["unresolved"] === true) continue;
      // BELOW REACH (2026-10-10, Group 1, review 03 C2): the wake's work lines
      // are an ambient channel, so a memory that has faded below physics'
      // `REACH` is not offered here; deliberate recall still finds it.
      if (belowReach(physics, opts.day)) continue;
      const journal = typeof doc.meta["episodeId"] === "string";
      if (!isWorkMemory({ about: row.about ?? null, kind: row.kind as Kind, originScope: row.origin_scope, journal })) continue;
      if (flatten(doc.body).length === 0) continue;
      found.push({
        id,
        touched: Math.max(doc.bornDay, physics.lastUsedDay),
        strength: strength(physics, opts.day),
        doc,
        bounded: row.source === "migrated",
      });
    }
  }
  found.sort((a, b) => b.touched - a.touched || b.strength - a.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return found.slice(0, pool).map((c) => workLine(c.id, c.doc, opts.excerpt, c.bounded));
}

/**
 * WHICH OF THE RANKED LINES SHOW TODAY (2026-10-02). With no more than `max`,
 * all of them. With more, the newest stays first — the work just done is the
 * likeliest to help — and the other `max - 1` places rotate through the rest
 * by lived day, so every session that day sees the same lines and the next
 * day shows the next ones (identity's once-a-day rule, NOTES §30). Shown in
 * ranked order. Stateless: nothing is written to remember a rotation. Pure.
 */
export function rotateWork(lines: readonly string[], max: number, day: number): string[] {
  if (max <= 0) return [];
  if (lines.length <= max) return [...lines];
  const [first, ...rest] = lines;
  const k = max - 1;
  if (first === undefined || k === 0) return first === undefined ? [] : [first];
  const offset = (((Math.floor(day) * k) % rest.length) + rest.length) % rest.length;
  const picked = new Set<number>();
  for (let i = 0; i < k; i++) picked.add((offset + i) % rest.length);
  return [first, ...rest.filter((_, i) => picked.has(i))];
}

/** One work line (see `workHere`). */
export function workLine(id: string, doc: ProseDoc, excerpt: number, bounded = false): string {
  const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
  const title = flatten(doc.title ?? "");
  const date = datePrefix({
    statement: "",
    learnedOn: doc.learnedOn,
    ...(doc.happenedOn === undefined ? {} : { happenedOn: doc.happenedOn }),
    boundedDate: bounded,
  });
  const words = title.length === 0 ? excerptOf(paragraph, excerpt + 40) : `${title} — ${excerptOf(paragraph, excerpt)}`;
  return `- ${date}${words} (${id})`;
}

/** The block for the given lines, heading included. */
export function workHereBlock(lines: readonly string[]): string {
  return [WORK_HERE_HEADING, ...lines].join("\n");
}

/** What the block costs a delivery that carries it above a handoff block:
 *  its bytes and the blank line between the two. */
export function workHereBytes(lines: readonly string[]): number {
  return new TextEncoder().encode(`${workHereBlock(lines)}\n\n`).length;
}
