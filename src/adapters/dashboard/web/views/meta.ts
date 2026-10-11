/**
 * `/api/meta` — what this dashboard is pointed at.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import type { DashboardSource } from "../../source.js";

// ─────────────────────────────────────────────────────────────────────────────
// meta — what this dashboard is pointed at
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaView {
  readonly dir: string;
  readonly day: number;
  readonly lastActive: string | null;
  readonly observer: true;
  readonly retentionDays: number;
  /** True when nothing has ever been stored. The page says so on purpose. */
  readonly empty: boolean;
  /**
   * HOW MANY ROWS THE STORE HOLDS RIGHT NOW — a fingerprint, not a headline.
   *
   * An open page polls the event log to know whether anything happened, and
   * that is a wrong question: a deposit that writes no durable event never moves
   * the log's sequence, so a page left open reports the old count forever
   * (design review, 2026-09-04 — the only wrong number left on any screen). This
   * is the cheap thing a poll can compare to notice a deposit that left no trace
   * in the log.
   *
   * The case that MOTIVATED it has since gone away: `counterparts note` was the
   * example, and since `gate.deposit` (2026-09-05, replay §2a) the authored door
   * writes a row like every other door, so a note moves the sequence and takes
   * the event branch. This stays as the belt it always was — a store seeded
   * around the door, a migration, any future write that leaves no row — and
   * because a fingerprint that is only correct while one particular writer
   * happens to log is not a fingerprint.
   *
   * It counts every row, including the journal and the archived, which is why
   * it is not called `held`: nothing should ever render it as a memory count.
   */
  readonly rows: number;
  readonly generatedAt: number;
}

/** An empty string is the store's "never moved", not a date. */
export function lastActive(raw: string | undefined): string | null {
  return raw === undefined || raw.trim().length === 0 ? null : raw;
}

export function metaView(src: DashboardSource): MetaView {
  const store = src.store;
  const rows = store.list().length;
  return {
    dir: store.dir,
    day: store.livedDay(),
    lastActive: lastActive(store.getMeta("lastActiveDate")),
    observer: true,
    retentionDays: store.retentionDays,
    empty: rows === 0,
    rows,
    generatedAt: Date.now(),
  };
}
