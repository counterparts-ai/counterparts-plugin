/**
 * Every number `coverage/` has, in one place. Working defaults agreed with the
 * owner on 2026-09-30, held lightly: each is here to be read against how the
 * ledger behaves on a real store and moved when it fights that.
 */
export const COVERAGE_TUNABLES = {
  /** The pacer's third way to an ask: a session holding at least this many
   *  pieces that are not written up... */
  ASK_PIECES: 3,
  /** ...once this long has passed since the later of the stretch's first piece
   *  and the session's last ask. Pieces AND time, so one huge paste is never an
   *  ask on its own. */
  ASK_AFTER_MS: 30 * 60_000,
  /** A session owes a write-up when what it has not written up is at least this
   *  many pieces... */
  OWED_PIECES: 3,
  /** ...spanning at least this long, first piece to last. Under both, a closing
   *  turn's tail owes nothing. */
  OWED_SPAN_MS: 15 * 60_000,
  /**
   * An owed stretch is LET GO — lost to memory, said as a loss — at the first
   * turn-end of this many days of use after the day its latest piece was
   * lived. Days of USE: a weekend away lets nothing go.
   *
   * 3 until 2026-10-10. Measured on the 10-10 snapshot: 18 owed stretches (153
   * pieces, several from 2–4-hour sessions) lapsed unwritten, because the
   * nightly write-up — four sessions a night, oldest first — and the next
   * session's pointer did not reach them in two days of use. Review 01 C4: an
   * owed stretch stays owed until it is written; the night takes the oldest
   * first and carries the rest. Retention keeps an owed session's text until
   * then, so this is the outer bound on how long it may hold it: twice the
   * ordinary week, counted in days of use. Decided by g1c-builder, 2026-10-10,
   * lightly held; revisit after ~5 lived days. Why: 01 says lapse only when
   * the text must go, and nothing else bounds how long an owed session's text
   * is kept.
   */
  LAPSE_DAYS_OF_USE: 14,
  /** An owed stretch under this many pieces is small: the pointer says one line
   *  is enough. */
  SMALL_STRETCH_PIECES: 6,
} as const;

export type CoverageTunables = typeof COVERAGE_TUNABLES;
