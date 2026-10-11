/**
 * MOOD-MATCHING — recall G18 (emotion part A, owner decision 4, 2026-09-26;
 * read by valence since the wheel v2, 2026-09-30).
 *
 * When a person's current feeling is known, memories that carried a feeling
 * CLOSE TO IT in valence FOR THAT SAME PERSON come up more easily; a close
 * feeling of the OTHER person gives a smaller lift. The brain analog is
 * mood-congruent recall — real but small in people (d ≈ 0.1–0.2), so this
 * stays a light tie-breaker.
 *
 * **"Current" is only what was recorded.** There is no classifier: a person's
 * mood is the valences of the feelings recorded for them in the last
 * `MOOD_WINDOW_HOURS` of the store's clock, at `MOOD_MIN_STRENGTH` or above. A
 * turn nobody recorded a feeling near has no mood, and this whole module costs
 * one query that returns nothing. That query (`Store.feelingsSince`) has no
 * index on `created_at` — adding one is a schema change this part does not make
 * — so it scans the `feelings` table, which is small (a few per memory at most).
 *
 * **It is a modulation, never an admission.** The lift is added to the
 * candidate's `sal` — the number the gate reads AFTER hard gate (a) (an uncued
 * memory is dark before salience is evaluated) and AFTER hard gate (b) (the
 * absolute floor, checked before any salience adjustment). It never touches
 * `activation`, so it cannot change which memories become candidates, and in
 * the absolute regimes `modulate` ignores `sal` entirely. `activate.ts` does
 * not even compute a mood for an uncued candidate. One place `sal` IS read in
 * every regime: the loud pool's order (`gate.ts`, `SAL_SORT_WEIGHT`), so among
 * memories already admitted loud, a lifted one can take a surfaced slot.
 *
 * **By valence, not by core** (wheel v2). The match is `1 − |Δvalence| /
 * MOOD_VALENCE_SPAN` against the closest of the person's recorded feelings —
 * so curious and confused, one core apart in feeling, no longer match as one,
 * and sad and uneasy, two cores close in feeling, match in part. A LOW mood
 * meeting a LOW feeling (both valences below 0) counts `MOOD_LOW_LOW_WEIGHT`
 * (0.25) of its match — the approved page: "so a low mood can't feed itself"
 * (the review of #301, M2). Each
 * feeling's valence is the writer's, else its word's default
 * (`store/feelings.ts#feelingValence`).
 *
 * **Past, not present.** A feeling recorded INSIDE the window is part of the
 * mood, not a memory that matches it — otherwise the note written five minutes
 * ago would match its own feeling, and session dedup would not stop it (it was
 * never surfaced). Matching reads the feeling SOFTENED by its age
 * (`physics.softenedFeeling`, an unpleasant one faster): an old match lifts
 * less than a fresh one, and an old hurt less than an old warmth.
 */
import { softenedFeeling } from "../physics/index.js";
import { feelingValence, feltDay } from "../store/index.js";
import type { FeelingRow, Store } from "../store/index.js";
import type { RecallTunables } from "./tunables.js";

export interface Mood {
  /** Per person (`whose`), the valences of what they feel now. Empty map: no mood. */
  readonly byPerson: ReadonlyMap<string, readonly number[]>;
  /** Feelings recorded at or after this instant are the mood itself, never a match. */
  readonly sinceMs: number;
}

export const NO_MOOD: Mood = { byPerson: new Map(), sinceMs: Number.POSITIVE_INFINITY };

const HOUR_MS = 3_600_000;

/** How each person feels now, from the feelings recorded in the window. */
export function currentMood(
  store: Pick<Store, "feelingsSince">,
  nowMs: number,
  t: Pick<RecallTunables, "MOOD_WINDOW_HOURS" | "MOOD_MIN_STRENGTH">,
): Mood {
  const sinceMs = nowMs - t.MOOD_WINDOW_HOURS * HOUR_MS;
  const byPerson = new Map<string, number[]>();
  let rows: FeelingRow[];
  try {
    rows = store.feelingsSince(sinceMs);
  } catch {
    // A store without the table cannot have a mood; recall goes on without one.
    return NO_MOOD;
  }
  for (const r of rows) {
    if (!(r.strength >= t.MOOD_MIN_STRENGTH)) continue;
    const list = byPerson.get(r.whose) ?? [];
    list.push(feelingValence(r));
    byPerson.set(r.whose, list);
  }
  return { byPerson, sinceMs };
}

/** True when there is anything to match against. */
export function hasMood(mood: Mood): boolean {
  return mood.byPerson.size > 0;
}

/**
 * How well one feeling's valence matches a person's mood: 0..1, the best over
 * their feelings. A low mood meeting a low feeling (both below 0) counts
 * `lowLow` of its match — "so a low mood can't feed itself" (the approved
 * page; the review of #301, M2). Pleasant and mixed matches are whole.
 */
export function moodMatch(valence: number, now: readonly number[], span: number, lowLow = 1): number {
  if (!(span > 0)) return 0;
  let best = 0;
  for (const v of now) {
    const close = Math.max(0, 1 - Math.abs(valence - v) / span);
    best = Math.max(best, valence < 0 && v < 0 ? close * lowLow : close);
  }
  return best;
}

/**
 * The salience lift ONE memory gets from the current mood: the largest of
 * `weight x match x softened strength` over its past feelings — `match` how
 * close in valence it is to someone's mood (`moodMatch`), `MOOD_SAME_WEIGHT`
 * when the feeling was that person's own, `MOOD_CROSS_WEIGHT` when it was the
 * other's. 0 when nothing matches.
 */
export function moodLift(
  feelings: readonly (FeelingRow & { birth_day: number })[] | undefined,
  mood: Mood,
  day: number,
  t: Pick<RecallTunables, "MOOD_SAME_WEIGHT" | "MOOD_CROSS_WEIGHT" | "MOOD_VALENCE_SPAN" | "MOOD_LOW_LOW_WEIGHT">,
): number {
  if (feelings === undefined || feelings.length === 0 || !hasMood(mood)) return 0;
  let best = 0;
  for (const f of feelings) {
    if (f.created_at >= mood.sinceMs) continue; // the mood itself, not a memory of one
    const valence = feelingValence(f);
    const felt = softenedFeeling(f.strength, day - feltDay(f), valence);
    for (const [person, now] of mood.byPerson) {
      const match = moodMatch(valence, now, t.MOOD_VALENCE_SPAN, t.MOOD_LOW_LOW_WEIGHT);
      if (match <= 0) continue;
      const w = f.whose === person ? t.MOOD_SAME_WEIGHT : t.MOOD_CROSS_WEIGHT;
      if (w * match * felt > best) best = w * match * felt;
    }
  }
  return best;
}
