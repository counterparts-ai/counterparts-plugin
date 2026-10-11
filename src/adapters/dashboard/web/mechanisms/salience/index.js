/* Encoding & salience. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "salience",
  family: "encoding",
  name: "Encoding & salience",
  short: "Salience",
  tagline: "Not everything that happens is worth keeping. Something has to decide.",
  does: "Scores each new memory as it is written; what mattered more is held more firmly.",
  explainer: "Every memory gets an importance score as it is written, set by the AI that lived the conversation, and now also by how new it is next to what is already stored. Small stuff fades fast; what mattered sticks.",
  built: ["Every memory is scored as it is written: importance from the AI that lived the conversation, plus how new it is next to what is already stored (computed locally, no key)."],
  inDevelopment: ["Novelty is blank while the store has no neighbours yet.", "Diary entries become memories without this scoring, by design."],
};
