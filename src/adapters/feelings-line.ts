/**
 * A memory's feelings as ONE plain line, for the surfaces where a memory's
 * detail is shown (the dashboard's memory view, `counterparts ask --full`):
 *
 *     you: worried 0.6 (now 0.3) · me: tender 0.4
 *
 * "you" is the owner — the person reading — and "me" is the counterpart
 * (emotion part A, owner decision 6). The number is the strength as recorded;
 * "now" is the same feeling softened by the lived days since (physics §5.10;
 * an unpleasant one softens faster), shown only when it has moved. The word is the wheel word, or the writer's own
 * for an `other`. `carried_by` is not shown: it is a pointer at the moment,
 * and it stays with the export.
 */
import { softenedFeeling } from "../core/physics/index.js";
import { feelingValence } from "../core/store/index.js";
import type { FeelingRow } from "../core/store/index.js";

/** What a feeling line reads off a row: the word, the strength, and what its valence comes from. */
type LineRow = Pick<FeelingRow, "whose" | "core" | "emotion" | "other_word" | "strength"> & { valence?: number | null };

/** What each `whose` is called on a surface the owner reads. */
export function whoseLabel(whose: string): string {
  return whose === "owner" ? "you" : whose === "self" ? "me" : whose;
}

/** The word a feeling is shown as: the wheel word (unqualified), or the writer's own. */
export function feelingWord(row: Pick<FeelingRow, "emotion" | "other_word">): string {
  if (row.emotion === "other") return row.other_word ?? "other";
  const dot = row.emotion.indexOf(".");
  return dot >= 0 ? row.emotion.slice(dot + 1) : row.emotion;
}

export interface ShownFeeling {
  readonly who: string;
  readonly word: string;
  readonly strength: number;
  readonly now: number;
}

export function shownFeelings(
  rows: readonly LineRow[],
  ageDays: number,
): ShownFeeling[] {
  return rows.map((r) => ({
    who: whoseLabel(r.whose),
    word: feelingWord(r),
    strength: r.strength,
    now: softenedFeeling(r.strength, ageDays, feelingValence(r)),
  }));
}

const n1 = (x: number): string => x.toFixed(1);

/**
 * The line, grouped by person — the owner's first, then the counterpart's, then
 * anyone else — or "" when there are no feelings.
 */
export function feelingsLine(
  rows: readonly LineRow[],
  ageDays: number,
): string {
  const shown = shownFeelings(rows, ageDays);
  if (shown.length === 0) return "";
  const order = (who: string): number => (who === "you" ? 0 : who === "me" ? 1 : 2);
  const people = [...new Set(shown.map((s) => s.who))].sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1));
  return people
    .map((who) => {
      const words = shown
        .filter((s) => s.who === who)
        .map((s) => {
          const at = n1(s.strength);
          const now = n1(s.now);
          return now === at ? `${s.word} ${at}` : `${s.word} ${at} (now ${now})`;
        });
      return `${who}: ${words.join(", ")}`;
    })
    .join(" · ");
}
