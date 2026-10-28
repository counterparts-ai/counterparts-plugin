/**
 * A DREAM REMEMBERED, OR GONE BY LUNCH (D1, 2026-10-27).
 *
 * Mike, 2026-10-27: "if humans remember it then so should counterparts,
 * humans talk a lot about what they dreamed and think about it during the
 * day." A journal is recalled by what it was about (the recall tool's night reader),
 * and, like a person's dream, it slips out of reach fast unless it is used:
 * recalled (read whole, or found by what it was about on a question that asks
 * about dreams) or retold (its reflection's share
 * told). Each lived day it is touched widens its reach
 * (`DREAM_TUNABLES.DREAM_RECALL_REACH_*`). A faded dream stays in the journal
 * and opens by "last dream", by its id, or by a question that asks about
 * dreams; only the reach of an ORDINARY question by what it was about
 * fades.
 *
 * No column (Mike's rule: batch store-format changes). A touch is an event
 * row, `dream.recalled`, ref the dream's id, latched once per dream per lived
 * day (`dedup_key`) — which also keeps it out of the event prune, so a dream
 * recalled often keeps its reach for as long as the store keeps its log. A
 * told share is read off the reflection's own row. Nothing is written under
 * observer stance; every read answers "not in reach" rather than throw.
 */
import type { DreamRow, Store } from "../store/index.js";
import { DREAM_TUNABLES } from "./tunables.js";

/** The event a dream's recall writes (one per dream per lived day). */
export const DREAM_RECALLED_EVENT = "dream.recalled";

/** How a dream was touched: read whole, or matched by a question that asked about dreams (or asked when). */
export type DreamTouch = "read" | "asked";

/**
 * Note that a dream was recalled today. Latched per dream per lived day, so a
 * dream asked about ten times in a day widens its reach once — spacing, not
 * repetition. Returns whether a row was written. Never throws.
 */
export function noteDreamRecalled(store: Store, observer: boolean, dreamId: string, how: DreamTouch): boolean {
  if (observer) return false;
  try {
    const day = store.livedDay();
    const seq = store.appendEvent({
      name: DREAM_RECALLED_EVENT,
      day,
      ref: dreamId,
      dedupKey: `${DREAM_RECALLED_EVENT}:${dreamId}:${String(day)}`,
      payload: { how },
    });
    return seq > 0;
  } catch {
    return false;
  }
}

/** A dream's reach today: its last touch, how many lived days it was touched, and whether it is still reached. */
export interface DreamReach {
  /** The lived day of its last touch: the day it was dreamed, or the last day it was recalled or retold. */
  readonly lastTouchDay: number;
  /** Lived days it was recalled or retold (not counting the day it was dreamed). */
  readonly touches: number;
  /** Lived days past its last touch it stays reachable by what it was about. */
  readonly reachDays: number;
  /** Lived days since its last touch. */
  readonly since: number;
  readonly inReach: boolean;
}

/**
 * How far a dream reaches today. Its touches: the lived days a
 * `dream.recalled` row names, and the lived day its reflection's share was
 * told (`share_at`, read as the reflection's day — the share is told the
 * morning after, within a day of it). Never throws: a read that fails answers
 * out of reach, so a broken log never floods an answer with old dreams.
 */
export function dreamReach(store: Store, dream: Pick<DreamRow, "id" | "day">, today: number = store.livedDay()): DreamReach {
  const t = DREAM_TUNABLES;
  try {
    const days = new Set<number>();
    for (const e of store.eventLog({ name: DREAM_RECALLED_EVENT, ref: dream.id })) if (e.day > dream.day) days.add(e.day);
    for (const r of store.reflections({ dreamId: dream.id, limit: 5 })) {
      if (r.share_state === "told" && r.day >= dream.day) days.add(Math.max(r.day, dream.day + 1));
    }
    const lastTouchDay = Math.max(dream.day, ...days);
    const touches = days.size;
    const reachDays = Math.min(t.DREAM_RECALL_REACH_MAX_DAYS, t.DREAM_RECALL_REACH_DAYS * t.DREAM_RECALL_REACH_GROWTH ** touches);
    const since = Math.max(0, today - lastTouchDay);
    return { lastTouchDay, touches, reachDays, since, inReach: since <= reachDays };
  } catch {
    return { lastTouchDay: dream.day, touches: 0, reachDays: 0, since: Number.POSITIVE_INFINITY, inReach: false };
  }
}
