/**
 * A NIGHT BY ITS ID (2026-10-20): `recall` with a dream's id (`drm_…`) or a
 * reflection's (`rfl_…`) as its handle or among its ids reads a short summary
 * of that record. The wake says "I dreamed … (drm_…)" and the morning share
 * names its reflection; until now neither id opened, and the only reader was
 * the console's `dream`, which also undoes — so a session could not review
 * last night with the owner.
 *
 * READ-ONLY, AND NOT A MEMORY. A night is a row in `dreams` / `reflections`,
 * not in `memories`, so a summary rides beside `memories` on the result
 * (`DeliberateResult.nights`), never in it: nothing that credits a use, marks
 * a memory seen, or logs a title's resolution reads this field. Opening a
 * night credits nothing; opening one of the memory ids it names is an
 * ordinary open, credited as any other.
 *
 * THE CONFIDENTIALITY BOUNDARY is the one the export and the morning share
 * already draw (`cli/export.ts#restsOnConfidential`, `dream/reflect.ts`'s
 * `touchesConfidential`): a night that was shown, changed, cited or became a
 * confidential memory is withheld WHOLE from a session that is not the owner's,
 * and the withholding is stated (`handle-confidential-withheld`), as for a
 * memory asked for by id. And in any session, a summary carries no memory's
 * body but a short gist's, and never a confidential one's: the ids are there
 * to open, and an open crosses recall's own boundary.
 *
 * Pure reads over the store; never writes, never throws past its caller.
 */
import type { Counterpart } from "../../core/counterpart.js";
import { rowTombstoned } from "../../core/store/index.js";
import type { DreamChangeRow, DreamRow, ReflectionRow, Store } from "../../core/store/index.js";

/** How many memory ids a summary names per kind of change before it counts the rest. */
export const NIGHT_IDS_PER_KIND = 12;
/** A gist is quoted when it is at most this long; a longer one is named by id. */
export const NIGHT_GIST_CHARS = 280;
/** How much of a dream's journal a summary carries (the console prints it whole). */
export const NIGHT_JOURNAL_CHARS = 1_200;
/** How much of a reflection's entry a summary carries. */
export const NIGHT_ENTRY_CHARS = 3_000;

/** Said once on a result that carries a night, so `nights` is not a bare field. */
export const NIGHTS_GLOSS =
  "A night is a dream (drm_) or a reflection (rfl_) the nightly run made: a read-only summary, not a memory. Reading it changes nothing and credits nothing; the memory ids it names open by id as usual. Undoing a dream is the owner's, in the console.";

/** Is this handle a night's id — a dream's or a reflection's? */
export function nightKindOf(handle: string): "dream" | "reflection" | null {
  const h = handle.trim();
  if (/^drm_[0-9a-f]+$/.test(h)) return "dream";
  if (/^rfl_[0-9a-f]+$/.test(h)) return "reflection";
  return null;
}

/** Memory ids, some of them, and how many more there were. */
export interface IdsCapped {
  readonly ids: readonly string[];
  readonly more: number;
}

export interface DreamSummary {
  readonly kind: "dream";
  readonly id: string;
  readonly date: string | null;
  readonly day: number;
  /** `begun`, `journaled`, `undone`, … as the row says. */
  readonly state: string;
  readonly title: string | null;
  /** Its journal, cut at `NIGHT_JOURNAL_CHARS`; `journalChars` is the whole length. */
  readonly journal?: string;
  readonly journalChars?: number;
  /** What it did that still stands, by kind (`dreams.counts`: undone changes are not counted). */
  readonly counts: Readonly<Record<string, number>>;
  /** Changes since undone, when there are any. */
  readonly undone?: number;
  /** The memory ids each kind of change touched, capped per kind. */
  readonly touched: Readonly<Record<string, IdsCapped>>;
  /** Its gists: the text when short and not confidential, else the id alone. */
  readonly gists: readonly { id: string; text?: string; chars?: number; confidential?: true }[];
  /** Gists past `NIGHT_IDS_PER_KIND`, counted rather than listed (a night of hundreds stays small). */
  readonly gistsMore?: number;
  /** The reflections after it, newest first. */
  readonly reflections: readonly string[];
}

export interface ReflectionSummary {
  readonly kind: "reflection";
  readonly id: string;
  readonly date: string | null;
  readonly day: number;
  /** `begun`, `reflected`. */
  readonly state: string;
  readonly title: string | null;
  /** The dream it followed, or null when it reflected on its own. */
  readonly dream: string | null;
  readonly entry: string | null;
  readonly entryChars?: number;
  /** Set when the memory the entry became is confidential now: `entry` is then null, the owner's session included. */
  readonly entryConfidential?: true;
  /** The memory its entry became. */
  readonly entryId: string | null;
  readonly share: string | null;
  /** `none`, `offered`, `carried`, `told`. */
  readonly shareState: string;
  readonly told: boolean;
  readonly cites: IdsCapped;
  readonly closes: { readonly proposed: readonly string[]; readonly closed: readonly string[] };
  /** The self-page version it wrote, or null. */
  readonly pageVersion: number | null;
}

export type NightSummary = DreamSummary | ReflectionSummary;

export type NightRead =
  | { readonly ok: true; readonly night: NightSummary }
  | { readonly ok: false; readonly reason: "handle-unknown" | "handle-confidential-withheld" };

function ids(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function detailOf(json: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function capped(list: readonly string[], max = NIGHT_IDS_PER_KIND): IdsCapped {
  const unique = [...new Set(list)];
  return { ids: unique.slice(0, max), more: Math.max(0, unique.length - max) };
}

function cut(text: string, max: number): { text: string; chars?: number } {
  return text.length <= max ? { text } : { text: `${text.slice(0, max - 1)}…`, chars: text.length };
}

/** Does any of these memories, as it is NOW, carry the confidential mark? A removed one does not. */
function restsOnConfidential(store: Store, list: readonly (string | null)[]): boolean {
  for (const id of list) {
    if (id === null) continue;
    let row;
    try {
      row = store.row(id);
    } catch {
      continue;
    }
    if (row === undefined || rowTombstoned(row)) continue;
    if (row.confidential === 1) return true;
  }
  return false;
}

/** The memory ids one change names: its two refs, and a merge's originals. */
function changeIds(c: DreamChangeRow): string[] {
  const out: string[] = [];
  if (c.ref !== null) out.push(c.ref);
  if (c.ref2 !== null) out.push(c.ref2);
  if (c.action === "merge") out.push(...stringList(detailOf(c.detail)["from"]));
  return out;
}

/** What one change rests on, for the boundary: its ids, and a gist's or a fold's sources. */
function changeRests(c: DreamChangeRow): string[] {
  return c.action === "gist" ? [...changeIds(c), ...stringList(detailOf(c.detail)["sources"])] : changeIds(c);
}

/** The key `dreams.counts` files a change under: a fold is its own kind. */
function kindOf(c: DreamChangeRow): string {
  return c.action === "gist" && detailOf(c.detail)["fold"] === true ? "fold" : c.action;
}

function dreamSummary(counterpart: Counterpart, dream: DreamRow, changes: readonly DreamChangeRow[]): DreamSummary {
  const store = counterpart.store;
  const standing = changes.filter((c) => c.undone !== 1);
  const byKind = new Map<string, string[]>();
  for (const c of standing) {
    const k = kindOf(c);
    byKind.set(k, [...(byKind.get(k) ?? []), ...changeIds(c)]);
  }
  const touched: Record<string, IdsCapped> = {};
  for (const [k, list] of byKind) touched[k] = capped(list);
  const gists: { id: string; text?: string; chars?: number; confidential?: true }[] = [];
  let gistsMore = 0;
  for (const c of standing) {
    if ((c.action !== "gist" && c.action !== "fold") || c.ref === null) continue;
    if (gists.length >= NIGHT_IDS_PER_KIND) {
      gistsMore += 1;
      continue;
    }
    const row = store.row(c.ref);
    if (row === undefined || rowTombstoned(row)) continue;
    if (restsOnConfidential(store, [c.ref])) {
      gists.push({ id: c.ref, confidential: true });
      continue;
    }
    const body = row.body.trim();
    gists.push(body.length <= NIGHT_GIST_CHARS ? { id: c.ref, text: body } : { id: c.ref, chars: body.length });
  }
  const undone = changes.length - standing.length;
  const journal = dream.journal === null || dream.journal.trim().length === 0 ? null : cut(dream.journal.trim(), NIGHT_JOURNAL_CHARS);
  return {
    kind: "dream",
    id: dream.id,
    date: dream.date,
    day: dream.day,
    state: dream.state,
    title: dream.title,
    ...(journal === null ? {} : { journal: journal.text, ...(journal.chars === undefined ? {} : { journalChars: journal.chars }) }),
    counts: counterpart.dreams.counts(dream.id),
    ...(undone > 0 ? { undone } : {}),
    touched,
    gists,
    ...(gistsMore > 0 ? { gistsMore } : {}),
    reflections: store.reflections({ dreamId: dream.id, limit: 5 }).map((r) => r.id),
  };
}

function reflectionSummary(store: Store, r: ReflectionRow): ReflectionSummary {
  const d = detailOf(r.detail);
  const list = stringList;
  const title = typeof d["title"] === "string" ? d["title"] : null;
  // The entry IS a memory's body (`entry_id`): marked confidential since, it is
  // not quoted here in any session, as a confidential gist is not.
  const entryConfidential = r.entry_id !== null && restsOnConfidential(store, [r.entry_id]);
  const entry = r.entry === null || entryConfidential ? null : cut(r.entry, NIGHT_ENTRY_CHARS);
  return {
    kind: "reflection",
    id: r.id,
    date: r.date,
    day: r.day,
    state: r.state,
    title,
    dream: r.dream_id,
    entry: entry === null ? null : entry.text,
    ...(entry?.chars === undefined ? {} : { entryChars: entry.chars }),
    ...(entryConfidential ? { entryConfidential: true as const } : {}),
    entryId: r.entry_id,
    share: r.share,
    shareState: r.share_state,
    told: r.share_state === "told",
    cites: capped(ids(r.cites)),
    closes: { proposed: list(d["closeProposed"]), closed: list(d["closed"]) },
    pageVersion: r.page_version,
  };
}

/**
 * ONE NIGHT, by its id: a summary, or why not. `owner` is the asker's — the
 * same flag that decides a memory's confidentiality on recall's id path.
 */
export function readNight(counterpart: Counterpart, id: string, opts: { readonly owner: boolean }): NightRead {
  const kind = nightKindOf(id);
  const store = counterpart.store;
  try {
    if (kind === "dream") {
      const shown = counterpart.dreams.show(id.trim());
      if (shown === null) return { ok: false, reason: "handle-unknown" };
      const rests = [...ids(shown.dream.shown), ...shown.changes.flatMap(changeRests)];
      if (!opts.owner && restsOnConfidential(store, rests)) return { ok: false, reason: "handle-confidential-withheld" };
      return { ok: true, night: dreamSummary(counterpart, shown.dream, shown.changes) };
    }
    if (kind === "reflection") {
      const r = counterpart.reflections.show(id.trim());
      if (r === null) return { ok: false, reason: "handle-unknown" };
      const d = detailOf(r.detail);
      const rests = [...ids(r.shown), ...ids(r.cites), ...ids(r.share_cites), r.entry_id, ...stringList(d["closeProposed"]), ...stringList(d["closed"])];
      if (!opts.owner && restsOnConfidential(store, rests)) return { ok: false, reason: "handle-confidential-withheld" };
      return { ok: true, night: reflectionSummary(store, r) };
    }
  } catch {
    // A read that fails answers as not found; recall never throws at a tool.
  }
  return { ok: false, reason: "handle-unknown" };
}
