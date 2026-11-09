/**
 * OPEN ITEMS A WRITE LOOKS LIKE IT SETTLES (2026-11-07, SO1 step 1b; decided by
 * the roadmap seat with Mike, lightly held). The night can't close most open
 * items: the proof lives in the session that did the work, and that session
 * never knew the item existed (10-30: sessions only close their own items; of
 * 32 items closed by hand on 11-07, the night's rule closed 0). So when a
 * `remember` or a `session_end` entry is stored, its result lists the open
 * items, from ANY folder, whose subject the entry names — and the writing
 * model, which knows what it just did, decides. Nothing is closed here; there
 * is no precision bar, only a short list.
 *
 * **What matches** (the entry read by its HEADLINE, `interference.ts#headline`):
 *   - `version`: the same version series, the entry saying a version at or
 *     past the item's was DONE (`subjectKeys` / `sameSubject`: "0.3.47
 *     published" over "0.3.46 ready to publish");
 *   - `settles-when`: the item's `settlesWhen` names a version the entry's
 *     done version reaches (the same one included: "0.3.46 published" settles
 *     "settles when 0.3.46 published"), or a pull request the entry says was
 *     merged — read with every version in it, since it is a trigger stated
 *     on purpose;
 *   - `pr`: the entry says `#N merged` (a done verb beside the number,
 *     `prKeys`), and the item's headline names `#N` — an item in the
 *     writer's own project only, since a PR number belongs to one repository.
 *
 * **What is listed:** open items only — flagged `unresolved`, not parked
 * (`self/identity.ts#carriesOpen`), not settled over (`recall/standing.ts#headOf`),
 * never the entry itself or what it updates — at most `SHOWN`, nearest first
 * (fewest patches on, then the newest item). Never a check or a follow-up
 * (`CHECK_ITEM`), a protected row (its close would be refused), nor one whose
 * folder the folder setting has off, paused or observer. Nothing for an entry about the
 * owner, us or me, nor for a plan (`planned`, `proposed`, `asked`): neither is
 * evidence something got done. An item `asked` is listed with a note that only
 * the owner's answer closes it.
 *
 * **The cost:** one read of every open item's head (`Store#openItemHeads`,
 * the `memories_open` index's clause), pure matching, then a parked read and a
 * settled-over walk for the few that matched.
 *
 * **Counted** (no DDL: two event names): each entry that listed any writes
 * `CLOSE_HINT_SHOWN_EVENT` (ref the entry, payload the ids and the ms); a
 * later close of one of those ids through `updates` + `unresolved: false`
 * within `CLOSE_WINDOW_DAYS` lived days writes `CLOSE_HINT_CLOSED_EVENT` (ref
 * the item) — so a CHECK-AFTER read is two `eventCounts` rows: hints shown
 * against closes made.
 */
import { headline, prKeys, sameSubject, subjectKeys } from "./interference.js";
import type { SubjectKeys } from "./interference.js";
import { headOf } from "./recall/standing.js";
import { carriesOpen } from "./self/identity.js";
import { projectFolder } from "./self/work.js";
import type { Store } from "./store/index.js";
import { SETTLES_WHEN_META_KEY } from "./types.js";
import { INTERFERENCE_TUNABLES } from "./interference.js";

/** Working defaults, held lightly (2026-11-07). Read at use. */
export const CLOSE_HINT_TUNABLES = {
  /** The switch. Off: no list, nothing counted. */
  ON: true as boolean,
  /** At most this many items listed beside one entry. */
  SHOWN: 3 as number,
  /** A close counts as following a hint when it lands within this many lived days of it. CAL. */
  CLOSE_WINDOW_DAYS: 7 as number,
};

/** Each entry that listed any (ref: the entry). */
export const CLOSE_HINT_SHOWN_EVENT = "open.close-hint.shown";
/** A close of an item a hint listed, within the window (ref: the item). */
export const CLOSE_HINT_CLOSED_EVENT = "open.close-hint.closed";

/** Entries about these are never read as settling a work item. */
const PERSONAL = new Set(["owner", "us", "me"]);
/** A plan says nothing got done. */
const PLANS = new Set(["planned", "proposed", "asked"]);

export type CloseHintRule = "version" | "settles-when" | "pr";

export interface CloseHint {
  readonly id: string;
  readonly title: string;
  /** The folder that wrote it; absent when none was recorded. */
  readonly folder?: string;
  readonly settlesWhen?: string;
  /** True for an item `asked`: the caller says only the owner's answer closes it. */
  readonly asked?: true;
  readonly rule: CloseHintRule;
  /** What matched: `0.3.46→0.3.47`, `#760`. */
  readonly key: string;
}

export interface CloseHintEntry {
  readonly id: string;
  readonly title: string | null;
  readonly body: string;
  /** Its `about` mark, as stored; null when unmarked. */
  readonly about: string | null;
  /** Its `status`, as sent or stored; null when none. */
  readonly status: string | null;
}

export interface CloseHintOptions {
  /** The lived day (`Store#livedDay`). */
  readonly day: number;
  /** `SelfTunables.OPEN_CARRY_DAYS` and `OPEN_CARRY_GLIMPSE_TOUCH`: the parking rule. */
  readonly carryDays: number;
  readonly glimpses: boolean;
  /** Ids never listed: what the write updates, a dump's siblings, what it closed. */
  readonly exclude?: readonly string[];
  /**
   * The writer's project folders (`self/work.ts#projectFolders`, the join
   * Still open reads): a pull-request number belongs to one repository, so the
   * `pr` rule matches only an item written in one of these. Absent: no `pr`
   * matches (fail closed).
   */
  readonly projectFolders?: ReadonlySet<string>;
  /**
   * The folder setting's fence (`dream/slices.ts#memoryClosedTo`): true for
   * an item whose folder is off, paused or observer, whose title must not
   * reach another folder's result. Absent: none closed.
   */
  readonly closed?: (row: OpenItemHead) => boolean;
}

/** One row of `Store#openItemHeads`. */
export type OpenItemHead = ReturnType<Store["openItemHeads"]>[number];

/**
 * A CHECK OR A FOLLOW-UP, NOT A DEBT A DONE SETTLES (review of #783): a
 * CHECK-AFTER read, a dated check, an experiment's check, a re-read. A merge
 * or a release is when such a read comes due, never its answer.
 */
const CHECK_ITEM = /CHECK-AFTER|\bcheck due\b|\bcheck ~|\bexperiment check\b|\bre-read\b/i;

const TITLE_CHARS = 90;

function short(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_CHARS ? flat : `${flat.slice(0, TITLE_CHARS - 1).trimEnd()}…`;
}

/** The version rule for a trigger stated on purpose: the entry's done version at or past the one it names. */
function reaches(named: SubjectKeys, done: SubjectKeys): { key: string; gap: number } | null {
  let best: { key: string; gap: number } | null = null;
  for (const [series, patch] of named.versions) {
    const theirs = done.versions.get(series);
    if (theirs === undefined || theirs < patch) continue;
    if (best === null || theirs - patch < best.gap) best = { key: `${series}.${patch}→${series}.${theirs}`, gap: theirs - patch };
  }
  return best;
}

/**
 * WHETHER A WRITE COULD LIST ANY, from the words as sent, before any store
 * read: its headline says a version or a pull request was done. False for
 * nearly every write, which then costs nothing. Pure.
 */
export function mayCloseSubject(title: unknown, text: unknown): boolean {
  if (!CLOSE_HINT_TUNABLES.ON || typeof text !== "string") return false;
  const head = headline({ title: typeof title === "string" ? title : null, body: text });
  return subjectKeys(head, "done").versions.size > 0 || prKeys(head, "done").size > 0;
}

/**
 * The open items `entry` looks like it settles, nearest first, at most
 * `SHOWN`. Empty when nothing matches, the switch is off, or the entry is
 * personal or a plan. Reads only; never throws.
 */
export function closeHints(store: Store, entry: CloseHintEntry, opts: CloseHintOptions): CloseHint[] {
  if (!CLOSE_HINT_TUNABLES.ON || CLOSE_HINT_TUNABLES.SHOWN <= 0) return [];
  if (entry.about !== null && PERSONAL.has(entry.about)) return [];
  if (entry.status !== null && PLANS.has(entry.status)) return [];
  try {
    const head = headline({ title: entry.title, body: entry.body });
    const done = subjectKeys(head, "done");
    const prs = prKeys(head, "done");
    if (done.versions.size === 0 && prs.size === 0) return [];
    const exclude = new Set<string>([entry.id, ...(opts.exclude ?? [])]);
    const found: { hint: CloseHint; gap: number; createdAt: number }[] = [];
    for (const r of store.openItemHeads(INTERFERENCE_TUNABLES.HEADLINE_CHARS + 1)) {
      if (exclude.has(r.id)) continue;
      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(r.meta) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (meta["unresolved"] !== true) continue;
      const raw = meta[SETTLES_WHEN_META_KEY];
      const settles = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
      const itemHead = headline({ title: r.title, body: r.body });
      if (CHECK_ITEM.test(itemHead) || (settles !== null && CHECK_ITEM.test(settles))) continue;
      const ownProject = r.scope !== null && opts.projectFolders?.has(projectFolder(r.scope)) === true;
      let match: { rule: CloseHintRule; key: string; gap: number } | null = null;
      const take = (m: { rule: CloseHintRule; key: string; gap: number }): void => {
        if (match === null || m.gap < match.gap) match = m;
      };
      if (done.versions.size > 0) {
        const v = sameSubject(subjectKeys(itemHead, "step"), done);
        if (v !== null) take({ rule: "version", key: v.key, gap: v.gap });
        if (settles !== null) {
          const s = reaches(subjectKeys(settles, "any"), done);
          if (s !== null) take({ rule: "settles-when", key: s.key, gap: s.gap });
        }
      }
      if (prs.size > 0 && ownProject) {
        for (const n of prKeys(itemHead, "any")) if (prs.has(n)) take({ rule: "pr", key: `#${String(n)}`, gap: 0 });
        if (settles !== null) for (const n of prKeys(settles, "any")) if (prs.has(n)) take({ rule: "settles-when", key: `#${String(n)}`, gap: 0 });
      }
      if (match === null) continue;
      if (opts.closed?.(r) === true) continue;
      const m = match as { rule: CloseHintRule; key: string; gap: number };
      const folder = r.scope === null ? "" : projectFolder(r.scope);
      found.push({
        hint: {
          id: r.id,
          title: short(itemHead),
          ...(folder === "" ? {} : { folder }),
          ...(settles === null ? {} : { settlesWhen: settles }),
          ...(r.status === "asked" ? { asked: true as const } : {}),
          rule: m.rule,
          key: m.key,
        },
        gap: m.gap,
        createdAt: r.createdAt,
      });
    }
    if (found.length === 0) return [];
    found.sort((a, b) => a.gap - b.gap || b.createdAt - a.createdAt || (a.hint.id < b.hint.id ? 1 : -1));
    // The parked and the settled over, read one at a time, nearest first, only
    // until the list is full (review of #783: a touch read costs ~0.5 ms a row
    // on a real store). An item asked or naming what settles it is never
    // parked (`carriesOpen`), so it needs no touch read at all.
    const out: CloseHint[] = [];
    for (const f of found) {
      if (out.length >= CLOSE_HINT_TUNABLES.SHOWN) break;
      if (f.hint.asked !== true && f.hint.settlesWhen === undefined) {
        const t = store.openThreadTouches({ glimpses: opts.glimpses, at: store.today(), ids: [f.hint.id] })[0];
        if (t !== undefined && !carriesOpen(t, opts.day, opts.carryDays)) continue;
      }
      if (headOf(store, f.hint.id) !== null) continue;
      out.push(f.hint);
    }
    return out;
  } catch {
    return [];
  }
}

/** One row for an entry that listed any (no row for none). Never throws; false when nothing was written. */
export function noteCloseHintsShown(store: Store, entryId: string, hints: readonly CloseHint[], ms: number): boolean {
  if (hints.length === 0) return false;
  try {
    return (
      store.appendEvent({
        name: CLOSE_HINT_SHOWN_EVENT,
        day: store.livedDay(),
        ref: entryId,
        payload: { ids: hints.map((h) => h.id), rules: hints.map((h) => h.rule), ms: Math.round(ms * 100) / 100 },
      }) > 0
    );
  } catch {
    return false;
  }
}

/**
 * A CLOSE THAT FOLLOWED A HINT: when `target` was listed by a hint within
 * `CLOSE_WINDOW_DAYS` lived days, one row naming the entry that listed it and
 * how many lived days later. One bounded read of the hint rows (indexed by
 * name, from the window's first day). Never throws.
 */
export function noteCloseHintTaken(store: Store, target: string, successor: string): boolean {
  if (!CLOSE_HINT_TUNABLES.ON) return false;
  try {
    const day = store.livedDay();
    const rows = store.eventLog({ name: CLOSE_HINT_SHOWN_EVENT, sinceDay: day - CLOSE_HINT_TUNABLES.CLOSE_WINDOW_DAYS, order: "desc", limit: 1000 });
    for (const row of rows) {
      let ids: unknown = null;
      try {
        ids = (JSON.parse(row.payload ?? "{}") as Record<string, unknown>)["ids"];
      } catch {
        continue;
      }
      if (!Array.isArray(ids) || !ids.includes(target)) continue;
      return (
        store.appendEvent({
          name: CLOSE_HINT_CLOSED_EVENT,
          day,
          ref: target,
          payload: { entry: row.ref, successor, shownDay: row.day, daysAfter: day - row.day },
        }) > 0
      );
    }
    return false;
  } catch {
    return false;
  }
}
