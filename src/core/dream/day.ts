/**
 * THE DAY THE DREAM REPLAYS (2026-10-19, feedback-loop build part E). An
 * experiment: trying the day's own use as the dream's replay signal, to see
 * whether the night starts reinforcing what the day actually used. Check on
 * ~10-22; revert by zeroing `DAY_LIFT` and `TODAY_COUNT` (or the commit).
 *
 * What the day since the last dream did with its memories, read back from the
 * rows it already leaves, so the dream can replay it: which were USED (opened
 * by id, quoted, a lived return), which were RATED useful, which were named in
 * `drewOn` or rated 3 (the REWARD tag: "replay me"), and which were only SHOWN.
 * And which were used together in one session (the co-used pairs).
 *
 * Read, never written: `recall.credit` rows (the boundary's and the tools'
 * `drewOn`, `ids` aligned with `how`), `recall.rated` rows (`ratings[]`),
 * `returns` rows of every waking source (`store.livedReturnsSince`, a denylist,
 * so a source a later build adds for waking use is read as it lands — each
 * mapped by its meaning, `returnMark`: a glimpse or a rating of 1 is shown, not
 * used), and
 * `recall.decision` rows (`surfaced` / `footnotes`, each `{id, …}`). Since part
 * F the nightly run's own prompts write no decision rows, so "shown" is the
 * day's alone; a night child's boundary credits nothing (its cursor never
 * moves), so "used" is too.
 *
 * The event names are the composition root's (`counterpart-events.ts`),
 * restated here as `recall/probe.ts` does, so `dream/` imports no root; a test
 * holds them equal.
 */
import type { EventRow, Store } from "../store/index.js";
import { DREAM_TUNABLES } from "./tunables.js";

export const DAY_CREDIT_EVENT = "recall.credit";
export const DAY_RATED_EVENT = "recall.rated";
export const DAY_DECISION_EVENT = "recall.decision";

/**
 * How the day marked a memory, strongest first. `reward`: named in `drewOn`,
 * or rated 3 ("changed what I did or said"). `used`: opened by id, quoted, or
 * a lived return. `useful`: rated 2. `shown`: footnoted, came to mind, or
 * rated 1 — and never rated 0 in the same stretch.
 */
export type DayMark = "reward" | "used" | "useful" | "shown";

const RANK: Readonly<Record<DayMark, number>> = { reward: 3, used: 2, useful: 1, shown: 0 };

/** True when `a` is a stronger mark than `b` (absent is weakest). */
export function strongerMark(a: DayMark, b: DayMark | undefined): boolean {
  return b === undefined || RANK[a] > RANK[b];
}

export interface DayRead {
  /** Every memory the stretch marked, with its strongest mark. */
  readonly marks: ReadonlyMap<string, DayMark>;
  /**
   * Memories used together — each `useful` or stronger in the same session —
   * one list per session, the session with the most such memories first.
   * `pairsAmong` makes the pairs, among what the bundle shows (review of
   * #523: pairs capped before that filter came out empty on a busy day).
   */
  readonly together: readonly (readonly string[])[];
}

/**
 * The co-used pairs among the memories `keep` admits (the bundle's), each
 * pair once, the busiest session first, at most `cap` — pairs whose both
 * memories `prefer` admits (the ones listed as `today`) ahead of the rest.
 */
export function pairsAmong(
  together: readonly (readonly string[])[],
  keep: (id: string) => boolean,
  prefer: (id: string) => boolean = () => true,
  cap: number = DREAM_TUNABLES.TODAY_PAIRS,
): [string, string][] {
  const pairs: [string, string][] = [];
  const seen = new Set<string>();
  for (const admit of [(id: string) => keep(id) && prefer(id), keep]) {
    for (const ids of together) {
      const list = ids.filter(admit);
      for (let i = 0; i < list.length && pairs.length < cap; i++) {
        for (let j = i + 1; j < list.length && pairs.length < cap; j++) {
          const a = list[i] as string;
          const b = list[j] as string;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push([a, b]);
        }
      }
    }
  }
  return pairs;
}

/** One payload, parsed; an unreadable one is an empty object. */
function payloadOf(e: EventRow): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(e.payload ?? "{}");
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function idsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.length > 0) out.push(x);
    else if (x !== null && typeof x === "object" && typeof (x as Record<string, unknown>)["id"] === "string") out.push((x as Record<string, string>)["id"] as string);
  }
  return out;
}

/**
 * WHAT A LIVED RETURN MEANS for the day's mark, by its source (2026-10-19, the
 * feedback loop's two halves meeting; an experiment, check ~10-22). The
 * ratings' partial returns are not uses: a glimpse (`shown`, a footnote left
 * unrated) and a rating of 1 (`ontopic`) mark the memory SHOWN — null here.
 * An `engaged` return is a `drewOn`: the reward. An `awake` return the same
 * session's rating of 2 earned is that rating — `useful`; of 3, the reward;
 * any other awake return (an open, a quote) is `used`, and so is a waking
 * source a later build adds, until it is mapped here.
 */
export function returnMark(source: string, ratedScore?: unknown): DayMark | null {
  if (source === "shown" || source === "ontopic") return null;
  if (source === "engaged") return "reward";
  if (source === "awake" && ratedScore === 3) return "reward";
  if (source === "awake" && ratedScore === 2) return "useful";
  return "used";
}

/**
 * Read the stretch since `sinceAt` (epoch ms), on lived days from `sinceDay`
 * (the index bound; rows are then held to `sinceAt` by their own clock). Never
 * throws: a read that fails is an empty day, and the dream composes as before.
 */
export function readDay(store: Pick<Store, "eventLog" | "livedReturnsSince">, window: { sinceDay: number; sinceAt: number }): DayRead {
  const marks = new Map<string, DayMark>();
  const zero = new Set<string>();
  const shown = new Set<string>();
  /** session → memories it used (useful or stronger), in the order met. */
  const together = new Map<string, Set<string>>();
  const mark = (id: string, m: DayMark, session?: unknown): void => {
    if (strongerMark(m, marks.get(id))) marks.set(id, m);
    if (RANK[m] >= RANK.useful && typeof session === "string" && session.length > 0) {
      const s = together.get(session) ?? new Set<string>();
      s.add(id);
      together.set(session, s);
    }
  };
  const rows = (name: string): EventRow[] => {
    try {
      return store.eventLog({ name, sinceDay: window.sinceDay, limit: Number.MAX_SAFE_INTEGER }).filter((e) => e.at >= window.sinceAt);
    } catch {
      return [];
    }
  };
  for (const e of rows(DAY_CREDIT_EVENT)) {
    const p = payloadOf(e);
    const ids = idsOf(p["ids"]);
    const how = Array.isArray(p["how"]) ? (p["how"] as unknown[]) : [];
    ids.forEach((id, i) => mark(id, how[i] === "drewOn" || p["source"] === "drewOn" ? "reward" : "used", p["session"]));
  }
  /** `session|id` → the score that session gave it, so a return a rating earned is read as the rating. */
  const ratedBy = new Map<string, unknown>();
  for (const e of rows(DAY_RATED_EVENT)) {
    const p = payloadOf(e);
    for (const r of Array.isArray(p["ratings"]) ? (p["ratings"] as unknown[]) : []) {
      if (r === null || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const id = typeof o["id"] === "string" ? o["id"] : "";
      if (id.length === 0) continue;
      const score = o["score"];
      if (typeof p["session"] === "string") ratedBy.set(`${p["session"]}|${id}`, score);
      if (score === 3 || o["drewOn"] === true) mark(id, "reward", p["session"]);
      else if (score === 2) mark(id, "useful", p["session"]);
      else if (score === 1) shown.add(id);
      else if (score === 0) zero.add(id);
    }
  }
  try {
    for (const r of store.livedReturnsSince({ sinceAt: window.sinceAt, sinceDay: window.sinceDay })) {
      const m = returnMark(r.source, r.session === null ? undefined : ratedBy.get(`${r.session}|${r.memoryId}`));
      if (m === null) shown.add(r.memoryId);
      else mark(r.memoryId, m, r.session);
    }
  } catch {
    /* no returns read: the other rows still mark the day */
  }
  for (const e of rows(DAY_DECISION_EVENT)) {
    const p = payloadOf(e);
    for (const id of [...idsOf(p["surfaced"]), ...idsOf(p["footnotes"])]) shown.add(id);
  }
  // SHOWN, AND NOT CALLED NOISE: a memory rated 0 in the stretch is not lifted
  // for having been shown (part D handles noise on the recall side).
  for (const id of shown) if (!zero.has(id) && !marks.has(id)) marks.set(id, "shown");

  const sessions = [...together.values()].filter((s) => s.size > 1).sort((a, b) => b.size - a.size);
  return { marks, together: sessions.map((s) => [...s]) };
}
