/**
 * The observer predicate — ONE definition, and it imports nothing.
 *
 * `docs/observer-mode.md` G2: the predicate module imports nothing that can mutate,
 * so a dashboard, a probe, or a replay scorer can report the same truth without
 * acquiring the ability to change anything. G5: fail toward standing down — an
 * unreadable stance resolves to observer, never to "encode anyway".
 *
 * HOISTED here 2026-08-25 (SEAMS item A / queued item 4). It began in `store/`,
 * where the store seam was its only consumer; `remember/`, `recall/`, `associate/`
 * and `prospective/` are now consumers too, and four modules reaching into a fifth's
 * subdirectory for the one predicate is how a second definition gets written. The
 * move was a move, not a rewrite — this file still imports nothing.
 *
 * `store/index.ts` re-exports it, so the store's public surface is unchanged.
 */
export interface Stance {
  /** Absent means "ordinary session". A non-boolean value is unreadable ⇒ observer. */
  observer?: boolean;
}

export function isObserver(stance: unknown): boolean {
  if (stance === null || typeof stance !== "object") return true;
  const value = (stance as { observer?: unknown }).observer;
  if (value === undefined) return false;
  if (typeof value !== "boolean") return true;
  return value;
}
