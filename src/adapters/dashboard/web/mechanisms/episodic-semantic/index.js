/* Episodic ↔ semantic. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "episodic-semantic",
  family: "transformation",
  name: "Episodic ↔ semantic",
  short: "Gist",
  tagline: "“I met her on Tuesday” slowly becomes “I know her” — the event fades, the meaning stays.",
  does: "Turns a pattern across many memories into one memory of its own.",
  explainer: "Partly built. A dream can write the pattern it sees across several memories as a memory of its own, citing them — it starts lower than anything lived, and rises only if it proves true awake.",
  built: ["A dream's gist: a pattern in its own words, labelled dreamed, linked to what it came from."],
  inDevelopment: ["Nothing distils many sessions into general knowledge while awake, or on a schedule."],
};
