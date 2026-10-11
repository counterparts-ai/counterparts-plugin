/**
 * THE JOURNAL'S MARKDOWN COPY — the one file the owner can open in any editor.
 *
 * Constitution line 6 promises "memories kept as prose the owner can view".
 * Since the floor (schema v6) every body is a column, so that promise is kept
 * in two named places and nowhere else: `counterparts export --markdown`, and
 * this — a `.md` per episode under `<store>/journal/`, written as each chapter
 * lands. It is here rather than in an adapter because the owner ruled it so
 * (decision 2, 2026-09-17 §15 item 9: "the self is being recovered from v1
 * right now because its pages and journal were plain files that outlived their
 * system").
 *
 * **BY OWNER DECISION 2 THIS IS THE ONE `self/` MODULE THAT TREATS `Store.dir`
 * AS A FILESYSTEM ROOT.** Said at the top rather than left for a reviewer to
 * find. `remember/spans.ts` is the precedent: a core module that owns one
 * directory inside the store and nothing else.
 *
 * Four properties, and each one is a decision somebody can reverse:
 *
 *   - **DERIVED AND WRITE-ONLY.** The row is the truth. Nothing in this
 *     codebase ever reads a journal file back into the store — there is no
 *     parser here, on purpose, and `render.ts` says the same from its side.
 *     Deleting `journal/` loses nothing: the next chapter, or the background
 *     worker's next backfill pass, writes it again.
 *   - **WRITTEN AS IS** (owner ruling 2, 2026-09-18). No summary, no
 *     re-rendering of the words, no second renderer: `render.ts#renderMarkdown`
 *     is what export writes and it is what this writes, byte for byte. The
 *     front matter identifies the episode — id, session, dates, chapter count —
 *     and carries nothing the row does not hold. Credentials were redacted at
 *     the gate before the row was written (`self/index.ts#appendChapter`); this
 *     copies the row and cannot un-redact anything.
 *   - **IT NEVER FAILS A SESSION.** Nothing here throws. A copy that cannot be
 *     written is a `journal.copy.failed` row with a reason code; the chapter is
 *     already committed and is not at risk. A `chapter` call, a Stop hook and a
 *     boundary must not be able to fail because a disk was full.
 *   - **THE REMOVAL CHASE REACHES IT.** A file holding a removed memory's words
 *     while the console prints `unchased: nothing` is the finding F5's reviews
 *     raised twice (B MAJOR-1, C NEW-MAJOR-1) and the span buffer's scar before
 *     that. `syncJournalCopy` is the executable form of the invariant: a live
 *     episode row gets a file that matches it, and anything else gets no file.
 *     The owner's destruction console calls it as a named surface. (Named
 *     obliquely on purpose: a test greps every file under `src/` for that
 *     module's own filename and fails on a mention, which is how the
 *     one-importer rule is kept honest.)
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { renderMarkdown, rowTombstoned } from "../store/index.js";
import type { ProseDoc, Store } from "../store/index.js";

/** The directory, spelled once. `store/paths.ts#LAYOUT` classified it before
 *  this file existed — scar §2.11, and the reason that entry carries a date. */
export const JOURNAL_DIR = "journal";

/** A copy landed. Payload: the episode id, the store-relative file, bytes. */
export const JOURNAL_COPY_WRITTEN_EVENT = "journal.copy.written";
/** A copy did not land, with the reason code. The row is safe either way. */
export const JOURNAL_COPY_FAILED_EVENT = "journal.copy.failed";

/**
 * How many missing copies one backfill pass writes.
 *
 * WHERE IT ACTUALLY RUNS, checked rather than assumed: `Self.boundary()` is the
 * consolidation cycle's last content write, reached through
 * `core/briefing.ts#selfRenderer` (SEAMS G), so the backfill runs in the
 * DETACHED WORKER — not in the session's Stop hook, which calls
 * `Counterpart.boundary` (a different method: it appends spans and thinks about
 * nothing). The owner's `counterparts rebrief` is the other door.
 *
 * It is still bounded twice, by this count and by the deadline below, for the
 * same reason every other phase in that worker is: the worker is watchdogged
 * and shares a cycle with decay, dedup and the prune, and a file loop with no
 * ceiling is how one phase eats another's budget. The cost of the bound is
 * honest: a store with a thousand episodes and no `journal/` fills over forty
 * WORKER RUNS, which on the owner's cadence is weeks, not minutes. The chapter
 * door is what keeps a live store's copies current; this is for a store whose
 * episodes predate the feature, or whose `journal/` was deleted.
 */
export const JOURNAL_BACKFILL_PER_PASS = 25;

/**
 * …and the bound for a store that has NO copies at all.
 *
 * The case is a restore. Since 2026-09-20 `journal/` is not in the backup set
 * (f6f7 review MAJOR-5: copying it put removed episodes' words into every
 * rotating snapshot as plain markdown), so a restored store has the rows and
 * none of the files — and "a restored snapshot brings the copies back" must not
 * mean "over the next forty worker runs". The wall clock below is the real
 * protection and it still applies; this only stops the COUNT from being the
 * thing that makes a restore take weeks.
 */
export const JOURNAL_BACKFILL_COLD_PASS = 1_000;

/** …and the wall-clock half of that bound. A slow disk stops the pass, not the
 *  cycle; whatever is left is the next run's work. It is what bounds the cold
 *  pass above, so a restore of a very large store is still many passes — just
 *  passes measured by the clock rather than by a count chosen for a warm one. */
export const JOURNAL_BACKFILL_BUDGET_MS = 250;

/**
 * How old an abandoned `.tmp-*` must be before a later pass removes it.
 *
 * Same shape and the same reasoning as `cli/export.ts#EXPORT_SCRATCH_STALE_MS`:
 * the bound is what keeps a sweep from taking a CONCURRENT writer's temp file
 * mid-rename. A crashed rename leaves a file holding a chapter's words, and
 * a crashed rename otherwise leaves a chapter's words in a file nothing owns,
 * inside the store, for ever.
 */
export const JOURNAL_TEMP_STALE_MS = 60 * 60_000;

/** The date part of a path when the row carries no date at all. A row with no
 *  `learned_on` is real (`self/briefing.ts` writes one), and "undated" is a
 *  better answer in a filename than an invented day. */
export const UNDATED = "undated";

export type JournalCopyOutcome =
  /** The file was written (or rewritten) and now matches the row. */
  | "written"
  /** The file already matched the row. Nothing was touched. */
  | "unchanged"
  /** The row is gone, tombstoned or denied, so its file was removed. */
  | "removed"
  /** There was nothing to write and nothing to remove. */
  | "absent"
  /** Named, never silent. The row is canonical and is not at risk. */
  | "failed";

export interface JournalCopyResult {
  readonly episodeId: string;
  readonly outcome: JournalCopyOutcome;
  /** Store-RELATIVE, always — an absolute path in a durable row says more about
   *  the machine than the owner typed (§5 G10). Null when there is no file. */
  readonly file: string | null;
  readonly bytes: number;
  /** A CODE, never a message that could carry body text. */
  readonly reason: string | null;
}

/** The store-relative directory. */
export function journalDir(storeDir: string): string {
  return join(storeDir, JOURNAL_DIR);
}

/**
 * `journal/<YYYY>/<YYYY-MM-DD>-<episodeId>.md`.
 *
 * **One file per episode, not per chapter and not per day.** An episode is one
 * row that every chapter is appended into (`episodes.ts#appendChapter`), so a
 * per-chapter file would have to take the row apart to write it and a per-day
 * file would have to join two sessions' accounts into one document. Neither is
 * the thing the row is. A whole-file rewrite per append is idempotent, which is
 * what makes "delete it and it comes back" true.
 *
 * The DATE is the row's `learnedOn` — when the session lived, which is what a
 * reader browsing `journal/2026/` is looking for. `happenedOn` is deliberately
 * not used: it is stated at whatever precision the author gave (`2026`,
 * `2026-08`), and a filename that is sometimes a year is not a filename.
 */
export function journalRelativePath(doc: Pick<ProseDoc, "id" | "learnedOn">): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(doc.learnedOn) ? doc.learnedOn : UNDATED;
  const year = date === UNDATED ? UNDATED : date.slice(0, 4);
  return `${JOURNAL_DIR}/${year}/${date}-${doc.id}.md`;
}

/**
 * The episode id a STORE-RELATIVE journal path addresses, or null.
 *
 * It matches the temp form too (`…​.md.tmp-<rand>`), which is the point: a
 * crashed rename leaves a file holding the chapter's words, and a sweep that
 * only knew the final name would walk past it. `<date>-` is a fixed-width
 * prefix so the id comes back EXACTLY rather than by `includes`, which would
 * let `epi_ab` match `epi_abc`'s file.
 *
 * **It takes the whole path and pins the DEPTH** (review f6f7 NIT-2, and the
 * reason MAJOR-4's consequence was worse than mess): it used to match on the
 * basename, so any `.md` anywhere under `journal/` with a date-shaped name was
 * treated as a copy — including one an export smuggled in through a symlinked
 * target, which `journalFilesFor` then returned, the next append deleted as
 * "stale", and the backfill counted as a copy the episode already had.
 * Exactly `journal/<year>/<file>` is ours; anything else under that directory
 * belongs to whoever put it there.
 */
export function journalFileEpisodeId(relativePath: string): string | null {
  const m =
    /^journal\/(?:\d{4}|undated)\/(?:\d{4}-\d{2}-\d{2}|undated)-(.+?)\.md(?:\.tmp-[A-Za-z0-9]+)?$/.exec(
      relativePath,
    );
  return m === null ? null : (m[1] as string);
}

/**
 * THE SYMLINK RULE — what makes "this module owns one directory INSIDE the
 * store" true rather than intended.
 *
 * `journalFiles` used to walk with `statSync`, which FOLLOWS links, and every
 * arm downstream resolved the same path through them. So a symlink anywhere at
 * or under `journal/` turned this module into a writer and a deleter outside
 * the store. Measured by the f6f7 review: a chapter's full body landed in a
 * directory outside the store, and a removal ceremony deleted a file out there
 * and reported `chased: journal(1 markdown copy)` for it.
 *
 * It is not only an attacker's story. `journal/` is the one directory the owner
 * is INVITED to treat as files, so pointing a year at an external disk, a synced
 * folder or a vault is exactly the thing a person does with it. The answer is
 * not to follow it, and to SAY SO (`journal-symlink`) — a copy that quietly
 * wrote somewhere else would be worse than one that did not write at all.
 *
 * Every component from `journal` down to the file is `lstat`ed. A component that
 * does not exist is fine: it is about to be created, and nothing beyond it can
 * exist either. A component that IS a link is refused. `journal` itself is
 * included, because `mkdirSync(…, { recursive: true })` succeeds straight
 * THROUGH a symlinked directory — so this has to run before the mkdir, not after.
 */
export function journalPathIsLinked(storeDir: string, relativePath: string): boolean {
  let at = storeDir;
  for (const part of relativePath.split("/")) {
    at = join(at, part);
    try {
      if (lstatSync(at).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** True for the temp form only — what a sweep may take and a copy may not. */
export function isJournalTempName(name: string): boolean {
  return /\.md\.tmp-[A-Za-z0-9]+$/.test(name);
}

/**
 * FAILURES THAT ARE ABOUT THE DIRECTORY, not about an episode.
 *
 * The distinction earns its keep twice (review f6f7 MAJOR-2). A `journal/` that
 * will not take a file is ONE fact about the store: saying it once a day is the
 * whole truth, and saying it once per chapter and then 25 times per worker cycle
 * — 80 rows in the review's probe, thousands a week on the owner's cadence —
 * buries every other row in the log that `fired`, the dashboard and `doctor`
 * read. And a directory-level failure must not spend the backfill's budget at
 * all: there is nothing to retry until the directory changes.
 */
export const JOURNAL_DIRECTORY_REASONS: readonly string[] = [
  "journal-symlink",
  "journal-dir-unwritable",
  "journal-unreadable",
];

export function isJournalDirectoryFailure(reason: string | null): boolean {
  return reason !== null && JOURNAL_DIRECTORY_REASONS.includes(reason);
}

export interface JournalScan {
  /** Every REAL file under `journal/`, store-relative, sorted. */
  readonly files: string[];
  /** A symlink was found at or under `journal/` and was not followed. The
   *  module stands down by name when this is true, rather than reporting an
   *  absence it cannot vouch for. */
  readonly linked: boolean;
}

/**
 * Walk `journal/` without following a single link, and say whether one was
 * there.
 *
 * The `linked` half is not decoration. Skipping what is behind a link makes
 * this module SAFE; saying so makes it HONEST — otherwise an owner who pointed
 * `journal/2026` at his vault would get `absent` and "nothing beside the row"
 * from a module that simply could not see.
 */
export function journalScan(storeDir: string): JournalScan {
  const root = journalDir(storeDir);
  const out: string[] = [];
  let linked = false;
  try {
    if (lstatSync(root).isSymbolicLink()) return { files: [], linked: true };
  } catch {
    return { files: [], linked: false };
  }
  const walk = (at: string, rel: string): void => {
    let names: string[];
    try {
      names = readdirSync(at).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(at, name);
      const next = rel === "" ? name : `${rel}/${name}`;
      try {
        // `lstat`, never `stat`: a symlink is SKIPPED, file or directory alike.
        // That one word is what keeps every arm downstream — the rewrite, the
        // removal's unlink, the temp sweep — inside the store, because a path
        // behind a link is never listed and so is never acted on.
        const st = lstatSync(full);
        if (st.isSymbolicLink()) {
          linked = true;
          continue;
        }
        if (st.isDirectory()) walk(full, next);
        else out.push(`${JOURNAL_DIR}/${next}`);
      } catch {
        /* vanished underneath the walk */
      }
    }
  };
  walk(root, "");
  return { files: out, linked };
}

/** Every real file under `journal/`, store-relative, sorted. Names only;
 *  nothing is read, and nothing behind a symlink is listed. */
export function journalFiles(storeDir: string): string[] {
  return journalScan(storeDir).files;
}

/** Every journal file that addresses `episodeId` — the current name, any name
 *  it wore under an earlier date, and any crashed temp. */
export function journalFilesFor(storeDir: string, episodeId: string): string[] {
  return journalFiles(storeDir).filter((rel) => journalFileEpisodeId(rel) === episodeId);
}

/**
 * Remove `.tmp-*` files older than the bound. Never throws.
 *
 * Bounded by mtime for the same reason `export.ts`'s temp sweep is: without it
 * a pass would delete a CONCURRENT writer's file between its write and its
 * rename. Unbounded housekeeping is how a sweep becomes the bug.
 */
export function sweepJournalTemps(storeDir: string, now = Date.now()): string[] {
  const swept: string[] = [];
  for (const rel of journalFiles(storeDir)) {
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    // OURS, at our depth, and wearing the temp form. A `.tmp-` file somebody
    // else left under `journal/` is not this sweep's to take.
    if (!isJournalTempName(name) || journalFileEpisodeId(rel) === null) continue;
    const full = join(storeDir, rel);
    try {
      if (now - statSync(full).mtimeMs < JOURNAL_TEMP_STALE_MS) continue;
      rmSync(full, { force: true });
      swept.push(rel);
    } catch {
      /* a file that will not stat or will not go is not this pass's problem */
    }
  }
  return swept;
}

/** The row's own markdown — `render.ts`, never a second renderer (§1.5). */
export function renderJournalCopy(doc: ProseDoc): string {
  return renderMarkdown(doc);
}

/**
 * MAKE THE FILES SAY WHAT THE ROWS SAY, for one episode.
 *
 * One function rather than a write and a delete, because the invariant is one
 * sentence: *a journal file exists exactly when a live episode row does, and
 * holds exactly what that row holds.* Removal calls this after the chase and
 * gets the delete for free; the chapter door calls it after the write and gets
 * the rewrite. A rule expressed twice is a rule that will be true in one place.
 *
 * NEVER THROWS. The caller has already committed the row.
 */
export function syncJournalCopy(store: Store, episodeId: string): JournalCopyResult {
  const result = (
    outcome: JournalCopyOutcome,
    extra: Partial<JournalCopyResult> = {},
  ): JournalCopyResult => ({
    episodeId,
    outcome,
    file: null,
    bytes: 0,
    reason: null,
    ...extra,
  });

  // A LINK ANYWHERE AT OR UNDER `journal/` AND THIS MODULE STANDS DOWN, BY
  // NAME. One rule rather than three: the walk already refuses to look behind
  // one, so what is left to decide is whether the outcome is an honest
  // `journal-symlink` or a misleading `absent`/`written`. It is the first,
  // every time — including the removal arm, where the review watched a file
  // outside the store get deleted and reported as chased.
  let scan: JournalScan;
  try {
    scan = journalScan(store.dir);
  } catch {
    return result("failed", { reason: "journal-unreadable" });
  }
  if (scan.linked) return result("failed", { reason: "journal-symlink" });
  // THE DIRECTORY, asked once and named as itself. Without this the chapter door
  // reported `write-failed` per episode for a store whose `journal/` is a file,
  // which is five rows for one fact (MAJOR-2).
  try {
    mkdirSync(journalDir(store.dir), { recursive: true });
  } catch {
    return result("failed", { reason: "journal-dir-unwritable" });
  }
  const existing = scan.files.filter((rel) => journalFileEpisodeId(rel) === episodeId);

  // IS THERE A LIVE EPISODE HERE? A removed row survives as a tombstone (blank
  // body, blank hash) and its id is on the deny-list, and `readProse` refuses a
  // denied id by name. Both are asked before anything is read, so the file goes
  // without this function ever holding the words again.
  let doc: ProseDoc | null = null;
  try {
    const row = store.row(episodeId);
    const live =
      row !== undefined &&
      row.type === "episode" &&
      !rowTombstoned(row) &&
      !store.deniedIds().includes(episodeId);
    if (live) doc = store.readProse(episodeId);
  } catch {
    // A row that will not read is not a row whose file may stand: fall through
    // to the removal arm, which is the safe direction for a derived copy.
    doc = null;
  }

  if (doc === null) {
    let removed = 0;
    for (const rel of existing) {
      // Never unlink THROUGH a link. `journalFiles` already refuses to list
      // what is behind one, so this is the second lock on the same door: the
      // review's probe planted a file outside the store under a copy's name and
      // watched the removal ceremony delete it, reporting it as chased.
      if (journalPathIsLinked(store.dir, rel)) {
        return result("failed", { reason: "journal-symlink", file: rel });
      }
      try {
        rmSync(join(store.dir, rel), { force: true });
        removed += 1;
      } catch {
        return result("failed", { reason: "unlink-failed", file: rel });
      }
    }
    return removed === 0 ? result("absent") : result("removed", { file: existing[0] as string });
  }

  let text: string;
  try {
    text = renderJournalCopy(doc);
  } catch {
    // `renderMarkdown` refuses meta it cannot serialize and a malformed id. The
    // CODE is what rides; its detail could name a title.
    return result("failed", { reason: "render-refused" });
  }
  const rel = journalRelativePath(doc);
  const bytes = Buffer.byteLength(text, "utf8");
  const target = join(store.dir, rel);

  // EVERY COMPONENT ON THE WAY DOWN, before the mkdir: a linked year directory
  // is how the review's probe put a chapter's whole body outside the store, and
  // `mkdirSync(…, { recursive: true })` succeeds straight through one.
  if (journalPathIsLinked(store.dir, rel)) {
    return result("failed", { reason: "journal-symlink", file: rel, bytes });
  }

  // A file this episode wore under a different date, and any crashed temp of
  // its own, go first: two files for one episode is the state where "delete
  // `journal/` and it comes back" stops being true.
  const strandedStale: string[] = [];
  for (const stale of existing) {
    if (stale === rel) continue;
    try {
      rmSync(join(store.dir, stale), { force: true });
    } catch {
      // NAMED, not swallowed (review f6f7 NIT-3). It used to carry a comment
      // promising it was "named below" and nothing below named it, so two files
      // for one episode was a state that could exist and be reported `written`.
      strandedStale.push(stale);
    }
  }

  try {
    if (
      strandedStale.length === 0 &&
      !lstatSync(target).isSymbolicLink() &&
      readFileSync(target, "utf8") === text
    ) {
      return result("unchanged", { file: rel, bytes });
    }
  } catch {
    /* not there, or unreadable: rewrite it, which is a derived copy's answer */
  }

  // ATOMIC: write a temp beside it and rename. A reader opening the file mid
  // write must see the previous chapter or this one, never half a sentence.
  // The temp is named `<final>.md.tmp-<rand>` so that ONE matcher finds the
  // file, its older date, and a crashed temp (`journalFileEpisodeId`).
  const temp = `${target}.tmp-${Math.random().toString(36).slice(2, 10)}`;
  try {
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(temp, text, "utf8");
    renameSync(temp, target);
  } catch {
    try {
      rmSync(temp, { force: true });
    } catch {
      /* the sweep takes it later; it is bounded and it is inside the store */
    }
    return result("failed", { reason: "write-failed", file: rel, bytes });
  }
  // The copy landed — and if an older name for this same episode would not go,
  // SAY SO rather than report a clean write over a store that now holds two
  // files for one episode.
  if (strandedStale.length > 0) {
    return result("failed", { reason: "stale-copy-stranded", file: strandedStale[0] as string, bytes });
  }
  return result("written", { file: rel, bytes });
}

/** How far back the standing-failure read looks. Two lived days, because a
 *  failure recorded yesterday is still standing this morning and the lived
 *  clock only moves inside the worker's own cycle. */
export const JOURNAL_FAILURE_WINDOW_DAYS = 2;

/**
 * Episodes whose copy FAILED and has not been written since — the ids the next
 * pass must not spend its budget on.
 *
 * The starvation the review reasoned and this measures: the failing ids sit at
 * the head of `store.list({type:"episode"})` and take the whole 25-slot budget
 * on every pass, so nothing behind them is ever backfilled. Not "never retry" —
 * never retry *ahead of work that has not been tried at all*. A later success
 * clears the id, exactly as it clears the doctor's line, and the window means a
 * store that was broken last week starts trying again.
 *
 * One bounded read of the event log, not a query per id. Ids only.
 *
 * THE WINDOW IS IN LIVED DAYS while the dedup key is in calendar dates, and the
 * mismatch is deliberate rather than an oversight: the lived clock only moves
 * inside the worker's own cycle, so on a store whose worker has been dead for a
 * week this window covers EVERY row since the last cycle. That is the safe
 * direction — more ids excluded from a pass, never fewer — and the alternative
 * (a calendar window) would start retrying a broken episode on a store where
 * nothing has run to fix it.
 */
export function standingJournalFailures(store: Store): Set<string> {
  const sinceDay = Math.max(0, store.livedDay() - JOURNAL_FAILURE_WINDOW_DAYS);
  const newest = (name: string): Map<string, number> => {
    const out = new Map<string, number>();
    // Newest first, and the first row seen per id is its newest: an ascending
    // read with a limit kept the OLDEST rows, so past it a copy written since
    // was never seen and a mended failure read as standing.
    for (const row of store.eventLog({ name, sinceDay, order: "desc", limit: 5_000 })) {
      if (row.ref !== null && !out.has(row.ref)) out.set(row.ref, row.seq);
    }
    return out;
  };
  const failed = newest(JOURNAL_COPY_FAILED_EVENT);
  const written = newest(JOURNAL_COPY_WRITTEN_EVENT);
  const standing = new Set<string>();
  for (const [id, seq] of failed) {
    if ((written.get(id) ?? -1) < seq) standing.add(id);
  }
  return standing;
}

/**
 * Episodes with no file — the backfill's work list, bounded by the caller.
 *
 * Ids and names only: one `SELECT id`, one directory walk, one bounded read of
 * the log, no row read and no body. That is what makes it cheap enough to ask
 * at every cycle.
 *
 * It fills what is MISSING and does not re-derive what is present. Drift within
 * a file is the chapter door's business (it rewrites on every append) and the
 * removal chase's (it syncs what it removed); a pass that re-rendered every
 * episode would read every body in the store to prove nothing had changed.
 */
export function journalBackfillTargets(store: Store, limit: number): string[] {
  let have: Set<string>;
  try {
    have = new Set(
      journalFiles(store.dir)
        .map((rel) => journalFileEpisodeId(rel))
        .filter((id): id is string => id !== null),
    );
  } catch {
    return [];
  }
  const denied = new Set(store.deniedIds());
  let standing: Set<string>;
  try {
    standing = standingJournalFailures(store);
  } catch {
    standing = new Set();
  }
  const out: string[] = [];
  for (const id of store.list({ type: "episode" })) {
    if (out.length >= limit) break;
    if (have.has(id) || denied.has(id) || standing.has(id)) continue;
    out.push(id);
  }
  return out;
}

export interface JournalBackfillReport {
  readonly written: number;
  readonly failed: number;
  /** Ids whose copy landed — the caller writes the durable rows. */
  readonly results: readonly JournalCopyResult[];
  /** True when the bound stopped the pass with work left. */
  readonly more: boolean;
  readonly sweptTemps: number;
}

/**
 * One bounded backfill pass. Never throws.
 *
 * `now` is injected so a test can age a temp file rather than wait an hour.
 */
export function backfillJournalCopies(
  store: Store,
  opts: { limit?: number; budgetMs?: number; now?: () => number } = {},
): JournalBackfillReport {
  const budget = opts.budgetMs ?? JOURNAL_BACKFILL_BUDGET_MS;
  const clock = opts.now ?? Date.now;
  const started = clock();
  // A COLD STORE GETS THE BIGGER COUNT. No copies at all and episodes to copy
  // is what a restore looks like — `journal/` is not in the backup set — and a
  // restore that took forty worker runs to become readable would have made the
  // "it costs nothing to stop copying it" argument false. The wall clock below
  // still bounds the pass either way.
  const cold = (() => {
    try {
      return journalFiles(store.dir).length === 0;
    } catch {
      return false;
    }
  })();
  const limit = opts.limit ?? (cold ? JOURNAL_BACKFILL_COLD_PASS : JOURNAL_BACKFILL_PER_PASS);
  let sweptTemps = 0;
  try {
    sweptTemps = sweepJournalTemps(store.dir, started).length;
  } catch {
    /* housekeeping never decides whether the copies get written */
  }
  const results: JournalCopyResult[] = [];
  let targets: string[];
  try {
    targets = journalBackfillTargets(store, limit);
  } catch {
    return { written: 0, failed: 0, results: [], more: false, sweptTemps };
  }
  let more = false;
  for (const id of targets) {
    if (clock() - started > budget) {
      more = true;
      break;
    }
    const result = syncJournalCopy(store, id);
    // A DIRECTORY-LEVEL FAILURE ENDS THE PASS. It is one fact about the store,
    // it is the same answer for every remaining episode, and spending 25 slots
    // and 25 rows re-discovering it is what made the log unreadable (MAJOR-2).
    // The result is carried as ITSELF, with no episode attached, so the row the
    // caller writes says what is actually wrong.
    if (isJournalDirectoryFailure(result.reason)) {
      results.push({ ...result, episodeId: "", file: null, bytes: 0 });
      return {
        written: 0,
        failed: 1,
        results,
        // There is work left, and no amount of retrying reaches it until the
        // directory changes.
        more: true,
        sweptTemps,
      };
    }
    results.push(result);
  }
  if (!more && targets.length >= limit) more = true;
  return {
    written: results.filter((r) => r.outcome === "written").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
    more,
    sweptTemps,
  };
}

/**
 * The durable row for one copy — `journal.copy.written` or `.failed`.
 *
 * Content-by-reference (§5 G10): the episode id, the store-relative file, a
 * byte count, a chapter count, a reason CODE. Never a word of the chapter. The
 * `date` field is what `adapters/fired.ts` reads to say when this mechanism
 * last fired, so it rides on every row.
 *
 * It never throws either: an observer's store refuses every write by name, and
 * a copy that could not be recorded is still a copy.
 *
 * **A FAILURE IS DEDUPED, per (episode, reason, day); a directory-level failure
 * is deduped per (reason, day) and names no episode** (review f6f7 MAJOR-2,
 * measured at 80 rows for one broken directory across five chapters and three
 * worker cycles). The latch is the store's own `dedupKey`, so the second row of
 * the same fact is refused inside the same transaction that would have written
 * it rather than by a read this function would have to get right.
 *
 * THE DAY IN THE KEY IS THE CALENDAR DATE, not the lived day, and that is a
 * deliberate divergence from the ask's wording: it is the same `date` the
 * payload carries and `doctor` prints, so the key and the row cannot disagree
 * about what a day is. The lived clock advances only inside the worker's own
 * cycle (`episodes.ts#asksSpentOn`, scar I32), so keying on it would make a
 * store whose worker has not run for a week dedup a week of failures into one.
 *
 * The cost, said out loud: dedup-keyed rows are never swept by `pruneEvents` —
 * they are the replay latch. One row per episode per reason per day is a bounded
 * price for a log that can be read; a permanently broken directory leaves one
 * row a day, for ever, and that is the point rather than an oversight.
 *
 * SUCCESSES ARE NOT DEDUPED. "The copy was written" is what the fired view
 * counts, and a mechanism that recorded one firing a day would under-report the
 * thing the owner is watching for.
 */
export function noteJournalCopy(
  store: Store,
  result: JournalCopyResult,
  opts: { day: number; chapters?: number; site: string },
): void {
  if (result.outcome === "unchanged" || result.outcome === "absent") return;
  const failed = result.outcome === "failed";
  const directory = isJournalDirectoryFailure(result.reason);
  // A directory-level row names no episode: `ref` is the subject, and the
  // subject here is the store's own directory.
  const ref = failed && directory ? null : result.episodeId === "" ? null : result.episodeId;
  const date = store.today();
  const dedupKey = failed
    ? `${JOURNAL_COPY_FAILED_EVENT}:${directory ? "dir" : String(ref)}:${String(result.reason)}:${date}`
    : undefined;
  try {
    store.appendEvent({
      name: failed ? JOURNAL_COPY_FAILED_EVENT : JOURNAL_COPY_WRITTEN_EVENT,
      day: opts.day,
      ref,
      ...(dedupKey === undefined ? {} : { dedupKey }),
      payload: {
        date,
        site: opts.site,
        outcome: result.outcome,
        file: result.file,
        bytes: result.bytes,
        ...(opts.chapters === undefined ? {} : { chapters: opts.chapters }),
        ...(result.reason === null ? {} : { reason: result.reason }),
        ...(directory ? { scope: "directory" } : {}),
      },
    });
  } catch {
    /* a row that cannot be recorded does not undo the file that was written */
  }
}
