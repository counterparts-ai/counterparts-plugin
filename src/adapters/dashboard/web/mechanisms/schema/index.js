/* Schema & assimilation. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "schema",
  family: "transformation",
  name: "Schema & assimilation",
  short: "Schemas",
  tagline: "New facts don’t land on blank ground. They’re folded into what you already believe.",
  does: "Would fold new facts into what I already believe about people and projects. Not built yet.",
  explainer: "Not built yet. It keeps cards for the people and projects it knows, but does not form beliefs about them from many memories.",
  built: ["Cards for the people, projects and places it knows, which fade and come back with use."],
  inDevelopment: ["Beliefs about them, weighed against new evidence, have no live producer yet."],
};
