/* Who is talking (round 4, 2026-09-28). The dashboard speaks as the AI, "I",
   and says who that is once. Its name lives HERE and nowhere else, so choosing
   another one later is a one-line change (Mike: "maybe later we can pick a name
   for you together"). */

/** The name "I" goes by on the dashboard. */
export const MY_NAME = "Claude";

/** The owner as a possessive — "Mike's" — or "yours" when the store has no name for him. */
export function ownersWord(owner) {
  if (!owner) return "yours";
  return owner + (/s$/i.test(owner) ? "'" : "'s");
}

/** The owner by name, or "you" when the store has none. */
export function ownerOr(owner) {
  return owner || "you";
}
