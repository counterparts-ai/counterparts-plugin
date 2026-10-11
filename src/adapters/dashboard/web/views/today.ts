/**
 * "TODAY" on the home tab (2026-09-28, home round 4 — a try, judged when seen):
 * a few plain lines about MEMORY, newest first, each a link to where that
 * memory lives. It replaced the live activity feed, which spoke in event codes,
 * bytes and file paths — the plumbing is still on the flow tab.
 *
 * What a line can be, and where it goes:
 *   - a memory written that day → its words, opening its memory card;
 *   - a memory that became core → "“…” became part of who I am", the Self tab;
 *   - that day's dream → "Dreamed: <its title>", the Self tab's dream journal;
 *   - memories let go at the floor → the memories list's archived view.
 * More written than fit is one "and N more" line to the memories list.
 *
 * Every line is read from the store's own tables (the rows' `birth_day`, the
 * `core_events` promotions, the dreams, the `memory.pruned` records); nothing
 * carries an event name, a byte count or a path, and no link opens a raw
 * record. When today holds nothing, the most recent lived day that does is
 * shown instead, and the view says which.
 *
 * Read-only, like everything in this directory.
 */
import { isJournal } from "../../../../core/sleep/index.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";
import { isChapterMemory } from "./memory-words.js";

/** At most this many lines, the "and N more" line included. */
export const TODAY_LINES = 6;
/** How far back the fallback looks for a day with something in it. */
export const TODAY_LOOKBACK = 30;

/** Where a line goes: a memory's card, or a place in the dashboard (a hash route). */
export type TodayLink = { readonly memory: string } | { readonly hash: string };

export interface TodayLine {
  readonly kind: "written" | "core" | "dream" | "let-go" | "more";
  /** The words, ready to show. For "written" and "core", the memory's own words. */
  readonly text: string;
  /** True when the memory's words are withheld: the line says so and shows none. */
  readonly confidential: boolean;
  readonly to: TodayLink;
}

export interface TodayView {
  /** The lived day the lines are about. */
  readonly day: number;
  /** "Today", "Yesterday" or "Day N": which day that is, in words. */
  readonly label: string;
  /** True when today was empty and an earlier day is shown. */
  readonly fallback: boolean;
  readonly lines: readonly TodayLine[];
  /** Memories written on TODAY (not the fallback day) — the headline's "N new today". */
  readonly newToday: number;
}

interface Dated {
  readonly line: TodayLine;
  /** For newest-first: a wall-clock instant where the store has one. */
  readonly at: number;
}

/** Memories written on a lived day: live, prose memories, not the journal and not its chapters. */
function writtenOn(src: DashboardSource, from: number): Map<number, { id: string; at: number }[]> {
  const out = new Map<number, { id: string; at: number }[]>();
  for (const id of src.store.list({ archived: false })) {
    const row = src.store.row(id);
    if (row === undefined || row.type !== "memory" || isJournal(row) || isChapterMemory(row)) continue;
    if (row.birth_day < from) continue;
    const list = out.get(row.birth_day) ?? [];
    list.push({ id, at: typeof row.created_at === "number" ? row.created_at : 0 });
    out.set(row.birth_day, list);
  }
  return out;
}

/** The words for a memory on a line: its title where it has one (as the
 *  memories list and its card lead with), else its own words; nothing when withheld. */
function words(src: DashboardSource, id: string): { text: string; confidential: boolean } {
  const r = reveal(src.store, id, 90);
  if (r.confidential) return { text: "", confidential: true };
  const title = r.headId === null ? null : (src.store.row(r.headId)?.title ?? "").trim();
  return { text: title || wordEnd(r.text ?? r.label), confidential: false };
}

/** A clipped text ends at a whole word ("…the cheapest…", never "…whethe…"). */
export function wordEnd(text: string): string {
  if (!text.endsWith("…")) return text;
  const cut = text.slice(0, -1).replace(/\s+\S*$/, "").replace(/[\s,;:—-]+$/, "");
  return cut.length > 0 ? `${cut}…` : text;
}

export function todayView(src: DashboardSource): TodayView {
  const store = src.store;
  const today = store.livedDay();
  const from = Math.max(0, today - TODAY_LOOKBACK);
  const written = writtenOn(src, from);
  const promoted = store.coreEvents({ action: "promoted", limit: 200 }).filter((e) => e.day >= from);
  const dreams = store.dreams({ limit: 40 }).filter((d) => d.state === "journaled" && d.day >= from);
  const pruned = store.eventLog({ name: "memory.pruned", sinceDay: from, order: "desc", limit: 2000 });

  const specialsOn = (day: number): Dated[] => {
    const out: Dated[] = [];
    for (const e of promoted) {
      if (e.day !== day) continue;
      const w = words(src, e.memory_id);
      out.push({
        line: {
          kind: "core",
          text: w.confidential ? "A private memory became part of who I am" : `“${w.text}” became part of who I am`,
          confidential: w.confidential,
          to: { hash: "self/settling" },
        },
        at: e.at,
      });
    }
    const dream = dreams.find((d) => d.day === day);
    if (dream !== undefined) {
      const title = (dream.title ?? "").trim();
      out.push({
        line: { kind: "dream", text: title ? `Dreamed: ${title}` : "Dreamed", confidential: false, to: { hash: "self/dreams" } },
        at: dream.finished_at ?? dream.started_at,
      });
    }
    const gone = pruned.filter((e) => e.day === day);
    if (gone.length > 0) {
      const w = gone.length === 1 && gone[0]!.ref !== null ? words(src, gone[0]!.ref) : null;
      out.push({
        line: {
          kind: "let-go",
          text: gone.length > 1
            ? `Let go of ${gone.length} memories that had faded`
            : w !== null && !w.confidential && w.text
              ? `Let go of “${w.text}” — it had faded`
              : "Let go of a memory that had faded",
          confidential: false,
          to: { hash: "memories?state=archived" },
        },
        at: gone[0]!.at,
      });
    }
    return out;
  };

  // Today, or else the newest lived day with anything in it.
  let day = today;
  let specials = specialsOn(today);
  let mine = written.get(today) ?? [];
  if (specials.length === 0 && mine.length === 0) {
    for (let d = today - 1; d >= from; d--) {
      const s = specialsOn(d);
      const w = written.get(d) ?? [];
      if (s.length > 0 || w.length > 0) {
        day = d;
        specials = s;
        mine = w;
        break;
      }
    }
  }

  // The rare lines always stay; written memories fill what is left, newest first.
  const newestFirst = [...mine].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const room = Math.max(0, TODAY_LINES - specials.length - (newestFirst.length > TODAY_LINES - specials.length ? 1 : 0));
  const shown: Dated[] = newestFirst.slice(0, room).map((m) => {
    const w = words(src, m.id);
    return { line: { kind: "written", text: w.text, confidential: w.confidential, to: { memory: m.id } }, at: m.at };
  });
  const lines = [...specials, ...shown].sort((a, b) => b.at - a.at).map((d) => d.line);
  const rest = newestFirst.length - shown.length;
  if (rest > 0) {
    lines.push({ kind: "more", text: `and ${rest} more`, confidential: false, to: { hash: "memories?state=live" } });
  }

  return {
    day,
    label: day === today ? "Today" : day === today - 1 ? "Yesterday" : `Day ${day}`,
    fallback: day !== today,
    lines,
    newToday: (written.get(today) ?? []).length,
  };
}
