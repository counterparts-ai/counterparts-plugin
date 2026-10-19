/**
 * HABITUATION, LIGHT — AN EXPERIMENT (2026-10-19, the feedback loop). Trying
 * a raised bar for memories the sessions keep calling noise, to see whether
 * the footnotes' noise share (47% rated 0 on 10-19) drops without losing what
 * was useful. Check on ~10-22; revert by setting `HABITUATION_BAR_LIFT` to 0
 * (the note in box 3 is then read and ignored) or reverting the PR.
 *
 * A memory rated 0 ("noise") in `HABITUATION_MIN_SESSIONS` or more sessions
 * over the last `HABITUATION_WINDOW_DAYS` lived days shows less readily in
 * ambient recall: the gate raises the bar it faces by `HABITUATION_BAR_LIFT`
 * (`gate.ts`). A penalty on its chance to show, never on its strength, its
 * credit or its links; a deliberate question is not this module's and is not
 * touched. It recovers by itself as those ratings age out of the window, and
 * a later rating of `HABITUATION_CLEAR_SCORE` or more clears it at once.
 *
 * WHERE THE COUNT LIVES: the `recall.rated` rows are the truth. What the
 * prompt path reads is a derived note in box 3 (`Store#cacheNote`): the
 * window's rows reduced to the ids each rated 0 or useful, and the newest
 * row's `seq` it was built through. The window is applied when it is READ, so
 * a memory recovers on a later day without a new rating. A note older than
 * the newest rating row, or missing (a cache reset), is rebuilt from the rows
 * on the spot — a bounded read of one week's rating rows — so the count is
 * never wrong, only sometimes slower. Written after each rating
 * (`Counterpart#rateShown`), never on the prompt path.
 *
 * Never throws: an unreadable note or row reads as nothing habituated.
 */
import type { Store } from "../store/index.js";
import type { RecallTunables } from "./tunables.js";

/** The rating rows' event name (`counterpart-events.ts#RECALL_RATED_EVENT`; a test holds them equal — `recall/` does not import the composition root). */
export const RATED_EVENT_NAME = "recall.rated";

/** The box-3 note's key. */
export const HABITUATION_NOTE_KEY = "habituation";

/** One rating row, reduced to what habituation reads. */
export interface HabituationRow {
  readonly seq: number;
  readonly day: number;
  readonly session: string;
  /** Ids this row rated 0. */
  readonly zero: readonly string[];
  /** Ids this row rated `HABITUATION_CLEAR_SCORE` or more. */
  readonly cleared: readonly string[];
}

interface Note {
  readonly through: number;
  readonly rows: readonly HabituationRow[];
}

/** The rating rows inside the window ending on `day`, reduced, oldest first. */
export function habituationRows(store: Pick<Store, "eventLog">, day: number, t: RecallTunables): Note {
  const since = day - t.HABITUATION_WINDOW_DAYS + 1;
  const rows: HabituationRow[] = [];
  let through = 0;
  for (const row of store.eventLog({ name: RATED_EVENT_NAME, sinceDay: since, order: "asc" })) {
    through = Math.max(through, row.seq);
    let p: unknown;
    try {
      p = JSON.parse(row.payload ?? "null");
    } catch {
      continue;
    }
    if (p === null || typeof p !== "object") continue;
    const o = p as { session?: unknown; ratings?: unknown };
    const session = typeof o.session === "string" ? o.session : row.ref ?? "";
    if (!Array.isArray(o.ratings)) continue;
    const zero: string[] = [];
    const cleared: string[] = [];
    for (const r of o.ratings) {
      if (r === null || typeof r !== "object") continue;
      const { id, score } = r as { id?: unknown; score?: unknown };
      if (typeof id !== "string" || typeof score !== "number") continue;
      if (score === 0) zero.push(id);
      else if (score >= t.HABITUATION_CLEAR_SCORE) cleared.push(id);
    }
    if (zero.length > 0 || cleared.length > 0) rows.push({ seq: row.seq, day: row.day, session, zero, cleared });
  }
  return { through, rows };
}

/**
 * Who is habituated on `day`, and in how many sessions each was rated 0: the
 * rows inside the window, in order, a useful rating clearing the zeros before
 * it. Pure.
 */
export function habituatedFrom(rows: readonly HabituationRow[], day: number, t: RecallTunables): Map<string, number> {
  const since = day - t.HABITUATION_WINDOW_DAYS + 1;
  const zeros = new Map<string, Set<string>>();
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (r.day < since || r.day > day) continue;
    for (const id of r.cleared) zeros.delete(id);
    for (const id of r.zero) {
      const s = zeros.get(id) ?? new Set<string>();
      s.add(r.session);
      zeros.set(id, s);
    }
  }
  const out = new Map<string, number>();
  for (const [id, s] of zeros) if (s.size >= t.HABITUATION_MIN_SESSIONS) out.set(id, s.size);
  return out;
}

/** The newest rating row's `seq`, or 0. */
function newestSeq(store: Pick<Store, "eventLog">): number {
  return store.eventLog({ name: RATED_EVENT_NAME, order: "desc", limit: 1 })[0]?.seq ?? 0;
}

function readNote(store: Pick<Store, "cacheNote">): Note | null {
  const raw = store.cacheNote(HABITUATION_NOTE_KEY);
  if (raw === null) return null;
  try {
    const n = JSON.parse(raw) as Partial<Note>;
    if (typeof n.through !== "number" || !Array.isArray(n.rows)) return null;
    return { through: n.through, rows: n.rows };
  } catch {
    return null;
  }
}

/**
 * THE PROMPT PATH'S READ: who is habituated on `day`. The note when it is
 * current, else the rows themselves (and nothing is written here). Never throws.
 */
export function habituatedIds(store: Pick<Store, "eventLog" | "cacheNote">, day: number, t: RecallTunables): Map<string, number> {
  try {
    const note = readNote(store);
    const current = note !== null && note.through === newestSeq(store) ? note : habituationRows(store, day, t);
    return habituatedFrom(current.rows, day, t);
  } catch {
    return new Map();
  }
}

/**
 * Rebuild the note from the rows (after a rating row lands). Returns how many
 * memories are habituated on `day`, or null when the note could not be written
 * (an observer's store, a busy cache) — the prompt path then reads the rows.
 */
export function refreshHabituation(store: Pick<Store, "eventLog" | "setCacheNote">, day: number, t: RecallTunables): number | null {
  try {
    const note = habituationRows(store, day, t);
    store.setCacheNote(HABITUATION_NOTE_KEY, JSON.stringify(note));
    return habituatedFrom(note.rows, day, t).size;
  } catch {
    return null;
  }
}
