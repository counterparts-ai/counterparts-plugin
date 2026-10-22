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
 * PROJECTS, AND CRAFT THAT TRAVELS (2026-10-21, wave 2 lane G, design §8;
 * `SelfTunables.PROJECTS_TRAVEL`, on, lightly held). Two changes, one switch:
 *
 *   - work stays inside its PROJECT, not its folder: a folder belongs to a
 *     project (`folder_projects`, v14), by default its own, and the owner joins
 *     related folders into one (`counterparts project join`). "Work here" reads
 *     every folder of the project (`projectFolders`, `workHere`'s `folders`);
 *   - an UNMARKED SKILL IS NO LONGER WORK (`craftTravels`): craft learned in one
 *     folder was stuck there, conflating craft with project. A skill marked
 *     `work` still stays with its project; any other skill is CRAFT
 *     (`isCraft`), and the "Work here" lines of every folder may carry a few,
 *     from any folder whose host setting lets it be named elsewhere
 *     (`WORK_HERE_CRAFT_MAX`). `about` still says personal or work, and the
 *     project says which work; no sub-labels for now.
 *
 * Off, both are as before: a folder is its own project, and an unmarked skill
 * is work in the folder it was written in.
 *
 * Pure: the caller hands in the row's facts.
 */
import type { Kind, MemoryPhysics } from "../types.js";
import { belowReach, strength } from "../physics/index.js";
import { CRAFT_BORN_META } from "../store/index.js";
import type { ProseDoc, Store } from "../store/index.js";
import { datePrefix, flatten } from "./briefing.js";

export interface WorkFacts {
  readonly about: string | null;
  readonly kind: Kind;
  /** The directory it was written in, or null/empty when unknown. */
  readonly originScope: string | null;
  /** A journal chapter's copy (`meta.episodeId` set). */
  readonly journal: boolean;
  /** Its lived birth day, for craft's start (`WorkRule.craftSince`). Absent: day 0. */
  readonly bornDay?: number;
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

export interface WorkRule {
  /**
   * Craft travels (`PROJECTS_TRAVEL`, 2026-10-21): an unmarked skill is craft,
   * not work. Absent or false: the rule before, an unmarked skill is work —
   * what the nightly reflection's offer and its folder-off guard still read
   * (`dream/reflect.ts`), since a skill is still the craft it may pin to a
   * project with a `work` mark.
   */
  readonly craftTravels?: boolean;
  /**
   * The lived day craft started travelling on this store (`craftSince`,
   * review of #572: GRANDFATHERED). A skill born before it keeps the rule it
   * was written under — an unmarked one is its folder's work — until a mark
   * moves it. Absent: day 0, every skill.
   */
  readonly craftSince?: number;
}

export function isWorkMemory(m: WorkFacts, rule: WorkRule = {}): boolean {
  if (m.journal) return false;
  if (m.about === "work") return true;
  if (m.about !== null) return false;
  if (m.kind === "skill") return !(rule.craftTravels === true && isCraft(m, rule));
  return UNMARKED_WORK_IN_A_DIRECTORY.has(m.kind) && isDirectoryScope(m.originScope);
}

/**
 * IS THIS CRAFT THAT TRAVELS (2026-10-21, `PROJECTS_TRAVEL`): a skill with no
 * mark, or marked `world` — how a job is done, wherever it was learned — born
 * on or after `craftSince`. A skill marked `work` is its project's; one marked
 * me, us or owner is personal, never a work line (review of #572). Never a
 * journal copy. Pure.
 */
export function isCraft(m: WorkFacts, rule: WorkRule = {}): boolean {
  if (m.journal || m.kind !== "skill") return false;
  if (m.about !== null && m.about !== "world") return false;
  return (m.bornDay ?? 0) >= (rule.craftSince ?? 0);
}

/**
 * WHEN CRAFT STARTED TRAVELLING ON THIS STORE (review of #572, the
 * coordinator's ruling: grandfather the old skills): the lived day, written
 * once, the first time a writable open runs with `PROJECTS_TRAVEL` on
 * (`Counterpart`'s open). Unset — a store never opened so, or an observer's
 * read of one — no skill travels yet.
 */
export const CRAFT_SINCE_KEY = "projects.craft.since";

/** A skill's birth for craft's rule: the day it was first learned, across
 *  revisions (`CRAFT_BORN_META`), else its own. */
export function craftBornDay(meta: Readonly<Record<string, unknown>>, bornDay: number): number {
  const carried = meta[CRAFT_BORN_META];
  return typeof carried === "number" && Number.isFinite(carried) ? Math.min(carried, bornDay) : bornDay;
}

export function craftSince(store: Pick<Store, "getMeta">): number {
  try {
    const raw = store.getMeta(CRAFT_SINCE_KEY);
    const day = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(day) ? day : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// ── projects ────────────────────────────────────────────────────────────────

/**
 * A folder as `folder_projects` keys it: trimmed, no trailing slash — the form
 * `origin_scope` and the elsewhere gate's `norm` already use. The adapter
 * resolves a typed path to the real directory first (`scopes.ts`).
 */
export function projectFolder(scope: string): string {
  const trimmed = scope.trim();
  const bare = trimmed.replace(/\/+$/, "");
  return bare.length > 0 ? bare : trimmed;
}

/**
 * THE FOLDERS OF `scope`'s PROJECT, `scope` first, the rest sorted
 * (2026-10-21): with no row for it, or with `PROJECTS_TRAVEL` off (`travel`
 * false), the folder alone — a folder is its own project by default, and no
 * row or card is written to say so (the wake writes nothing). Reads only;
 * a store that will not answer is the folder alone.
 */
export function projectFolders(
  store: Pick<Store, "projectOfFolder" | "foldersOfProject">,
  scope: string,
  travel: boolean,
  from?: (scope: string) => boolean,
): string[] {
  const here = projectFolder(scope);
  if (!travel || here.length === 0) return here.length === 0 ? [] : [here];
  try {
    const row = store.projectOfFolder(here);
    if (row === null) return [here];
    // ONLY THE FOLDERS THAT MAY BE NAMED ELSEWHERE (review of #572, privacy):
    // a joined folder set off or paused keeps its work, craft and sessions to
    // itself; this folder is always here. `from` absent: every one (a
    // boundary's reserve, which cannot ask the host).
    const ok = (f: string): boolean => {
      if (from === undefined) return true;
      try {
        return from(f);
      } catch {
        return false;
      }
    };
    return [here, ...store.foldersOfProject(row.project_id).filter((f) => f !== here && ok(f))];
  } catch {
    return [here];
  }
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
  /** The calendar year the lines are read in (`YYYY`): a date in it prints
   *  short (`briefing.ts#shortDay`, 2026-10-16). Absent: whole. */
  readonly year?: string;
  /** Every folder of `scope`'s project (`projectFolders`, 2026-10-21): their
   *  work is all "here". Absent: `scope` alone. */
  readonly folders?: readonly string[];
  /** Craft travels (`PROJECTS_TRAVEL`): an unmarked skill is craft, not work
   *  (`isWorkMemory`'s `craftTravels`). Absent: the rule before. */
  readonly craftTravels?: boolean;
  /** The lived day craft started travelling (`craftSince`); absent: day 0. */
  readonly craftSince?: number;
  /** Craft written in the project's own folders is a line here too. Absent:
   *  with `craftTravels`. False while the store-wide "How I work" lane carries it (`CRAFT_IN_WAKE`). */
  readonly craftHere?: boolean;
  /**
   * CRAFT FROM OUTSIDE THE PROJECT (2026-10-21, with `craftTravels`): `max`
   * places of the pool (`WORK_HERE_CRAFT_MAX`), taking turns by lived day
   * among the newest, each from a folder `from` lets be named elsewhere (the
   * host's setting; a memory with no folder has none to keep it). Craft
   * written in the project's own folders is here already and takes no place
   * of these. Absent: none.
   */
  readonly craft?: { readonly max: number; readonly from: (scope: string) => boolean };
}

interface Candidate {
  readonly id: string;
  readonly touched: number;
  readonly strength: number;
  readonly doc: ProseDoc;
  readonly bounded: boolean;
  /** The folder it was written in, as `projectFolder` keys it ("" for none). */
  readonly origin: string;
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
 * the horizon's), or in `skip`. Ordered by the lived day it was
 * last touched — born or used, the later — newest first, then by strength,
 * then by id. No warm floor: a lesson written yesterday is worth a line here
 * however lightly it is held yet.
 *
 * Since 2026-10-21 (`PROJECTS_TRAVEL`): "here" is every folder of the
 * project (`folders`), and with craft travelling a skill not marked `work`
 * is craft — here when written in the project, and up to `craft.max` more
 * from elsewhere, ranked with the rest.
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
  store: Pick<Store, "workCandidates" | "craftCandidates" | "row" | "readProse" | "physicsOf">,
  scope: string,
  opts: WorkHereOptions,
): string[] {
  const pool = Math.max(opts.max, opts.pool ?? opts.max);
  if (opts.max <= 0 || scope.trim().length === 0) return [];
  const travels = opts.craftTravels === true;
  const folders = opts.folders !== undefined && opts.folders.length > 0 ? opts.folders : [scope];
  const ours = new Set(folders.map(projectFolder));
  const self = projectFolder(scope);
  const seen = new Set<string>();
  const found: Candidate[] = [];
  /** The candidate, when `id` may be a line and `accept` takes its facts; null when not. */
  const read = (id: string, accept: (facts: WorkFacts) => boolean): Candidate | null => {
    if (seen.has(id) || opts.skip?.has(id) === true) return null;
    seen.add(id);
    const row = store.row(id);
    if (row === undefined || row.band === "identity" || row.event_date !== null) return null;
    let doc: ProseDoc;
    let physics: MemoryPhysics;
    try {
      doc = store.readProse(id);
      physics = store.physicsOf(id);
    } catch {
      return null;
    }
    if (doc.meta["unresolved"] === true) return null;
    // BELOW REACH (2026-10-10, Group 1, review 03 C2): the wake's work lines
    // are an ambient channel, so a memory that has faded below physics'
    // `REACH` is not offered here; deliberate recall still finds it.
    if (belowReach(physics, opts.day)) return null;
    const journal = typeof doc.meta["episodeId"] === "string";
    if (!accept({ about: row.about ?? null, kind: row.kind as Kind, originScope: row.origin_scope, journal, bornDay: craftBornDay(doc.meta, row.birth_day) })) return null;
    if (flatten(doc.body).length === 0) return null;
    return {
      id,
      touched: Math.max(doc.bornDay, physics.lastUsedDay),
      strength: strength(physics, opts.day),
      doc,
      bounded: row.source === "migrated",
      origin: row.origin_scope === null ? "" : projectFolder(row.origin_scope),
    };
  };
  // THE PROJECT'S OWN (2026-10-21): the work written in any of its folders,
  // and with craft travelling, the craft written there too — both are here.
  const rule: WorkRule = { craftTravels: travels, ...(opts.craftSince === undefined ? {} : { craftSince: opts.craftSince }) };
  const craftHere = travels && opts.craftHere !== false;
  const here = (f: WorkFacts): boolean => isWorkMemory(f, rule) || (craftHere && isCraft(f, rule));
  for (const folder of folders) {
    for (const where of scopesFor(folder)) {
      for (const id of store.workCandidates(where, pool * WORK_HERE_READ_PER_LINE)) {
        const c = read(id, here);
        if (c !== null) found.push(c);
      }
    }
  }
  const byTouched = (a: Candidate, b: Candidate): number =>
    b.touched - a.touched || b.strength - a.strength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  found.sort(byTouched);
  // CRAFT FROM ELSEWHERE (2026-10-21): written outside the project in a
  // folder the host lets be named elsewhere, or in none. Up to `pool` of the
  // newest are read, and `craft.max` of them TAKE TURNS by lived day, as the
  // work lines do (`rotateWork`), so all the craft comes round, not only the
  // newest. They hold their places in the pool: ranked by date against a busy
  // project's newest work, craft would never be offered there.
  const craftMax = travels && opts.craft !== undefined ? Math.max(0, Math.floor(opts.craft.max)) : 0;
  let craft: Candidate[] = [];
  if (craftMax > 0 && opts.craft !== undefined) {
    const from = opts.craft.from;
    const travelsFrom = (f: WorkFacts): boolean => {
      if (!isCraft(f, rule)) return false;
      const origin = f.originScope === null ? "" : projectFolder(f.originScope);
      if (origin.length === 0) return true;
      if (ours.has(origin)) return false;
      try {
        return from(origin);
      } catch {
        return false;
      }
    };
    const ready: Candidate[] = [];
    for (const id of store.craftCandidates(pool * WORK_HERE_READ_PER_LINE, opts.craftSince ?? 0)) {
      if (ready.length >= pool) break;
      const c = read(id, travelsFrom);
      if (c !== null) ready.push(c);
    }
    const k = Math.min(craftMax, ready.length, pool);
    // Turns by lived day, and by folder too, so one day's folders do not all
    // show the same craft (review of #572).
    const turn = Math.floor(opts.day) * k + folderTurn(self);
    const offset = ready.length === 0 ? 0 : ((turn % ready.length) + ready.length) % ready.length;
    craft = Array.from({ length: k }, (_, i) => ready[(offset + i) % ready.length] as Candidate);
  }
  // THIS FOLDER KEEPS HALF (2026-10-21): the project's other folders take at
  // most half of the places left, unless this one has too little to fill its
  // half — measured on a copy of the owner's store, a joined ~/counterparts-site
  // ranked none of its own work beside ~/counterparts' newest.
  const room = pool - craft.length;
  const own = found.filter((c) => c.origin === self);
  const rest = found.filter((c) => c.origin !== self);
  const restTake = Math.min(rest.length, Math.max(Math.floor(room / 2), room - own.length));
  const ranked = [...own.slice(0, room - restTake), ...rest.slice(0, restTake), ...craft].sort(byTouched);
  // A line from another folder says which (review of #572).
  return ranked.map((c) => workLine(c.id, c.doc, opts.excerpt, c.bounded, opts.year, c.origin.length > 0 && c.origin !== self ? c.origin : undefined));
}

/** A small, stable number per folder: where its craft rotation starts. */
function folderTurn(folder: string): number {
  let h = 0;
  for (let i = 0; i < folder.length; i++) h = (h * 31 + folder.charCodeAt(i)) % 9973;
  return h;
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
export function workLine(id: string, doc: ProseDoc, excerpt: number, bounded = false, year?: string, from?: string): string {
  const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
  const title = flatten(doc.title ?? "");
  const date = datePrefix({
    statement: "",
    learnedOn: doc.learnedOn,
    ...(doc.happenedOn === undefined ? {} : { happenedOn: doc.happenedOn }),
    boundedDate: bounded,
    ...(year === undefined ? {} : { year }),
  });
  const words = title.length === 0 ? excerptOf(paragraph, excerpt + 40) : `${title} — ${excerptOf(paragraph, excerpt)}`;
  const where = from === undefined ? "" : ` (from ${folderName(from)})`;
  return `- ${date}${words}${where} (${id})`;
}

/** A folder as a work line names it: `~/name` under a home directory, else its last part. */
export function folderName(folder: string): string {
  const home = /^\/(?:Users|home)\/[^/]+\/(.+)$/.exec(folder);
  if (home !== null) return `~/${home[1] as string}`;
  const parts = folder.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? folder;
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
