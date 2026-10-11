/* Decay & forgetting. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "decay",
  family: "storage",
  name: "Decay & forgetting",
  short: "Forgetting",
  tagline: "Forgetting isn’t a failure of memory. It’s one of its jobs.",
  does: "Memories we don't use fade a little each lived day, until they are set aside.",
  explainer: "Unused memories fade over the days you actually work together, not calendar days. Very faint ones are archived, not deleted, and memories in the core identity band do not fade at all.",
  built: ["Unused memories fade on the days you actually work together, and restart the curve when used.", "Very faint ones are archived, never deleted; the core identity band does not fade.", "Cards for people and projects fade gently after months of silence (people slower), and naming one again in a saved memory keeps it or brings it back."],
  inDevelopment: [],
};
