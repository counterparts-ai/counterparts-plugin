import { softenedFeeling } from "../physics/index.js";
import { feelingValence, feltDay } from "../store/index.js";
export const NO_MOOD = { byPerson: new Map, sinceMs: Number.POSITIVE_INFINITY };
const HOUR_MS = 3600000;
export function currentMood(store, nowMs, t) {
  const sinceMs = nowMs - t.MOOD_WINDOW_HOURS * HOUR_MS;
  const byPerson = new Map;
  let rows;
  try {
    rows = store.feelingsSince(sinceMs);
  } catch {
    return NO_MOOD;
  }
  for (const r of rows) {
    if (!(r.strength >= t.MOOD_MIN_STRENGTH))
      continue;
    const list = byPerson.get(r.whose) ?? [];
    list.push(feelingValence(r));
    byPerson.set(r.whose, list);
  }
  return { byPerson, sinceMs };
}
export function hasMood(mood) {
  return mood.byPerson.size > 0;
}
export function moodMatch(valence, now, span, lowLow = 1) {
  if (!(span > 0))
    return 0;
  let best = 0;
  for (const v of now) {
    const close = Math.max(0, 1 - Math.abs(valence - v) / span);
    best = Math.max(best, valence < 0 && v < 0 ? close * lowLow : close);
  }
  return best;
}
export function moodLift(feelings, mood, day, t) {
  if (feelings === undefined || feelings.length === 0 || !hasMood(mood))
    return 0;
  let best = 0;
  for (const f of feelings) {
    if (f.created_at >= mood.sinceMs)
      continue;
    const valence = feelingValence(f);
    const felt = softenedFeeling(f.strength, day - feltDay(f), valence);
    for (const [person, now] of mood.byPerson) {
      const match = moodMatch(valence, now, t.MOOD_VALENCE_SPAN, t.MOOD_LOW_LOW_WEIGHT);
      if (match <= 0)
        continue;
      const w = f.whose === person ? t.MOOD_SAME_WEIGHT : t.MOOD_CROSS_WEIGHT;
      if (w * match * felt > best)
        best = w * match * felt;
    }
  }
  return best;
}
