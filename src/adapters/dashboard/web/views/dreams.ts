/**
 * THE DREAM JOURNAL and THE CORE'S HISTORY, as the owner reads them
 * (2026-09-26, dreaming + consolidation).
 *
 *   dreams      — each dream, newest first: its date, its state (begun,
 *                 journaled, undone), its title and journal — the dream's own
 *                 words, kept in the `dreams` table and never as a memory — and
 *                 every change it made, in order, each naming the memories it
 *                 touched (clickable) and marked when it was undone.
 *   coreHistory — the recent crossings into the core with the LANE that carried
 *                 each, the owner's demotions with the reason he gave, and the
 *                 memories dreams nominated (a nomination is not a promotion;
 *                 only a lane at consolidation promotes).
 *
 * Read-only, like everything in this directory: `dreams`, `dreamChanges` and
 * `coreEvents` are reads. Memory words go through `reveal` (a merged original
 * through `revealHere`, so it reads as it stood, not as what it became), so a
 * confidential memory is withheld here exactly as everywhere else.
 */
import type { CoreEventRow, DreamChangeRow, DreamRow } from "../../../../core/store/index.js";
import type { DashboardSource } from "../../source.js";
import { reveal, revealHere } from "../reveal.js";

/** How many dreams the journal carries; the rest are counted, not sent. */
export const DREAM_LIMIT = 12;
/** How many rows of core history each list carries. */
export const CORE_HISTORY_LIMIT = 8;

export interface DreamMemoryRef {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  /**
   * What a merge or a gist was made FROM (`dream_changes.detail.fidelity`,
   * #277): how the dream had this original in front of it, in words, when it
   * was less than whole ("seen only as a line"). Absent when whole, or when
   * the change recorded nothing.
   */
  readonly seen?: string;
}

/** `fit/fidelityOf`'s words, for an original seen less than whole. */
const SEEN_WORDS: Readonly<Record<string, string>> = {
  excerpt: "seen as an excerpt",
  line: "seen only as a line",
  id: "seen only by its id",
  unseen: "not in that night's bundle",
};

export interface DreamChangeView {
  readonly seq: number;
  readonly action: string;
  /** The change in plain words ("merged 2 near-copies into one"). */
  readonly said: string;
  /** The memories it touched: the one it made or changed first, then the rest. */
  readonly memories: readonly DreamMemoryRef[];
  readonly undone: boolean;
}

export interface DreamView {
  readonly id: string;
  readonly date: string | null;
  readonly day: number;
  readonly state: string;
  readonly title: string | null;
  /** The journal entry, whole. Null while the dream has not written one. */
  readonly journal: string | null;
  /** Changes still standing, by action. */
  readonly counts: Readonly<Record<string, number>>;
  readonly changes: readonly DreamChangeView[];
}

export interface DreamsView {
  readonly dreams: readonly DreamView[];
  /** Every dream the store holds. */
  readonly total: number;
  /** Dreams past the ones sent. */
  readonly more: number;
  /** The day of the newest dream, or null when this store has never dreamed. */
  readonly lastDreamed: string | null;
}

export interface CoreHistoryRow {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly day: number;
  /** promoted: the lane; demoted: null; nominated: null. */
  readonly lane: string | null;
  /** The owner's reason (demoted) or the dream's (nominated). */
  readonly reason: string | null;
  /** nominated: the dream that nominated it. */
  readonly dream: string | null;
}

export interface CoreHistory {
  readonly promoted: readonly CoreHistoryRow[];
  readonly demoted: readonly CoreHistoryRow[];
  readonly nominated: readonly CoreHistoryRow[];
}

function ref(src: DashboardSource, id: string | null, here = false): DreamMemoryRef | null {
  if (id === null) return null;
  const r = here ? revealHere(src.store, id, 90) : reveal(src.store, id, 90);
  return { id, text: r.text ?? r.label, confidential: r.confidential };
}

function detailOf(c: DreamChangeRow): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(c.detail);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const idList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function changeView(src: DashboardSource, c: DreamChangeRow): DreamChangeView {
  const d = detailOf(c);
  const memories: DreamMemoryRef[] = [];
  const fidelity = d["fidelity"] !== null && typeof d["fidelity"] === "object" ? (d["fidelity"] as Record<string, unknown>) : {};
  const push = (m: DreamMemoryRef | null): void => {
    if (m === null || memories.some((x) => x.id === m.id)) return;
    const f = fidelity[m.id];
    const seen = typeof f === "string" ? SEEN_WORDS[f] : undefined;
    memories.push(seen === undefined ? m : { ...m, seen });
  };
  let said: string;
  switch (c.action) {
    case "merge": {
      // Destructured, not indexed: this directory's import scan reads a quote
      // straight after the word it looks for as a module path.
      const { from: merged } = d as { from?: unknown };
      const originals = idList(merged);
      push(ref(src, c.ref));
      for (const f of originals) push(ref(src, f, true));
      said = `merged ${originals.length} near-copies into one`;
      break;
    }
    case "link":
      push(ref(src, c.ref));
      push(ref(src, c.ref2));
      said = "linked two memories";
      break;
    case "replayed":
      push(ref(src, c.ref));
      said = d["counted"] === true ? "replayed it (a return: it fades a little more slowly)" : "replayed it";
      break;
    case "gist":
      push(ref(src, c.ref));
      for (const s of idList(d["sources"])) push(ref(src, s));
      said = "wrote down a pattern, in its own words (dreamed; it starts low)";
      break;
    case "contradiction":
      push(ref(src, c.ref));
      push(ref(src, c.ref2));
      said = "flagged two memories that disagree (not settled — raised awake)";
      break;
    case "feeling-now":
      push(ref(src, c.ref));
      said = "recorded how an old feeling sits now";
      break;
    case "nominate-core":
      push(ref(src, c.ref));
      said = "nominated it for the core (only a lane promotes)";
      break;
    default:
      push(ref(src, c.ref));
      push(ref(src, c.ref2));
      said = c.action;
  }
  return { seq: c.seq, action: c.action, said, memories, undone: c.undone === 1 };
}

function dreamView(src: DashboardSource, row: DreamRow): DreamView {
  const changes = src.store.dreamChanges(row.id);
  const counts: Record<string, number> = {};
  for (const c of changes) if (c.undone === 0) counts[c.action] = (counts[c.action] ?? 0) + 1;
  return {
    id: row.id,
    date: row.date,
    day: row.day,
    state: row.state,
    title: row.title,
    journal: row.journal,
    counts,
    changes: changes.map((c) => changeView(src, c)),
  };
}

export function dreamsView(src: DashboardSource, limit = DREAM_LIMIT): DreamsView {
  const shown = src.store.dreams({ limit });
  // Counted in SQL, so the page can say "the newest 12 of N".
  const total = Math.max(shown.length, src.store.dreamCount());
  return {
    dreams: shown.map((r) => dreamView(src, r)),
    total,
    more: total - shown.length,
    lastDreamed: shown[0] === undefined ? null : (shown[0].date ?? `lived day ${String(shown[0].day)}`),
  };
}

function historyRow(src: DashboardSource, e: CoreEventRow): CoreHistoryRow {
  const r = reveal(src.store, e.memory_id, 90);
  return {
    id: e.memory_id,
    text: r.text ?? r.label,
    confidential: r.confidential,
    day: e.day,
    lane: e.lane,
    reason: e.reason,
    dream: e.dream_id,
  };
}

export function coreHistory(src: DashboardSource, limit = CORE_HISTORY_LIMIT): CoreHistory {
  const of = (action: string): CoreHistoryRow[] =>
    src.store.coreEvents({ action, limit }).map((e) => historyRow(src, e));
  return { promoted: of("promoted"), demoted: of("demoted"), nominated: of("nominated") };
}
