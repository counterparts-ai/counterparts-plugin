/* Reconsolidation. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "reconsolidation",
  family: "transformation",
  name: "Reconsolidation",
  short: "Reconsolidation",
  tagline: "Recall makes a memory briefly editable. Then it’s re-stored, sometimes rewritten.",
  does: "An old memory changes only when enough new evidence argues with it.",
  explainer: "When a new memory says it corrects a belief or a core line, that adds pressure, and once enough builds up over several days the old one is revised, with the old version kept for 90 lived days. Remembering alone changes nothing.",
  built: ["When a new memory declares it corrects a belief or a core line, the correction adds pressure; past a bar, over several days for slow kinds, the old one is revised.", "The old version is kept for 90 lived days."],
  inDevelopment: ["Nothing detects a contradiction by itself: the writer has to declare it.", "Just remembering does not change a memory."],
};
