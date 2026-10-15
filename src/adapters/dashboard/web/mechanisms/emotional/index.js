/* Emotional modulation. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md, emotion part A (2026-09-26),
   the feelings wheel v2 (2026-09-30) and mood matching switched off by
   decision (2026-10-10);
   `built` / `inDevelopment` are in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "emotional",
  family: "encoding",
  name: "Emotional modulation",
  short: "Emotion",
  tagline: "The moments that mattered are the ones you keep. Feeling is the encoder’s thumb on the scale.",
  does: "A feeling on a memory holds it higher and slows its fading.",
  explainer: "The strongest feeling on a memory, yours or Claude’s, holds it higher and makes it fade more slowly. It counts as firing when a memory is saved with a feeling, and when one carrying a feeling comes to mind.",
  built: [
    "A memory’s strongest recorded feeling, or its emotional score, lifts it and slows its fading.",
    "A recorded feeling softens faster than the memory itself, and an unpleasant one faster than a pleasant one.",
  ],
  inDevelopment: [
    "Mood matching is off by decision (2026-10-10): memories that felt the way someone feels now get no extra lift in recall for now.",
    "Nothing reads feeling from the words themselves: the feeling classifier stays off, so only recorded feelings count.",
  ],
};
