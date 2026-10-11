/* Retrieval & strengthening. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "retrieval",
  family: "retrieval",
  name: "Retrieval & strengthening",
  short: "Retrieval",
  tagline: "Every time you remember something, you make it a little stronger.",
  does: "Brings memories to mind as we talk; the ones actually used get stronger.",
  explainer: "As you talk, it checks your words and their meaning for cues, and a few related memories come along. The ones a reply actually opens or quotes get stronger and fade more slowly; being shown alone earns nothing.",
  built: ["Each turn your words, and their meaning from the turn before, cue a few related memories.", "A memory the reply opens or quotes gets stronger and fades more slowly."],
  inDevelopment: ["Just being shown earns a memory nothing."],
};
