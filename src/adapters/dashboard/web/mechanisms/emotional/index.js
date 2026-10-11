/* Emotional modulation. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md, emotion part A (2026-09-26) and
   the feelings wheel v2 (2026-09-30);
   `built` / `inDevelopment` are in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "emotional",
  family: "encoding",
  name: "Emotional modulation",
  short: "Emotion",
  tagline: "The moments that mattered are the ones you keep. Feeling is the encoder’s thumb on the scale.",
  does: "A feeling on a memory holds it higher and slows its fading.",
  explainer: "The strongest feeling on a memory, yours or Claude’s, holds it higher and makes it fade more slowly. Memories that felt the way one of you feels now come to mind a little more easily.",
  built: [
    "A memory’s strongest recorded feeling, or its emotional score, lifts it and slows its fading.",
    "A recorded feeling softens faster than the memory itself, and an unpleasant one faster than a pleasant one.",
    "Memories that carried a feeling close to how someone feels now come up more easily — more for the same person, a little for the other.",
  ],
  inDevelopment: ["Nothing reads feeling from the words themselves: the feeling classifier stays off, so only recorded feelings count."],
};
