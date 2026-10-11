/* Association. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "association",
  family: "retrieval",
  name: "Association",
  short: "Association",
  tagline: "Recalling one thing pulls its neighbours along with it.",
  does: "Links memories used in the same turn, so one can bring its neighbour along.",
  explainer: "Memories used together in the same turn get linked, and a link can lift its partner later. It only lifts a memory the conversation already reached; a link cannot bring one to mind by itself.",
  built: ["Memories used together in the same turn get linked after the session."],
  inDevelopment: ["A link only lifts a memory the turn already reached; it cannot bring one to mind on its own.", "Links form only from use, so on most stores there are few."],
};
