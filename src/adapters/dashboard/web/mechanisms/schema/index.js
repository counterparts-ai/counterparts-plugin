/* Schema & assimilation. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md and wave 2's beliefs (lane C, 0.3.31);
   `built` / `inDevelopment` are in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "schema",
  family: "transformation",
  name: "Schema & assimilation",
  short: "Schemas",
  tagline: "New facts don’t land on blank ground. They’re folded into what you already believe.",
  does: "Forms beliefs about me, you, and the people and projects we know, and weighs new memories for or against them.",
  explainer: "Built. At night the reflection forms beliefs about me, us, and the people and projects the day’s memories name, or adopts one a dream suggested; each starts weak, grows only as lived memories are filed for it, and is pressed to change by one filed against it.",
  built: [
    "Cards for the people, projects and places it knows, which fade and come back with use.",
    "Beliefs born weak, earned by the memories filed for them, pressed by the ones against.",
  ],
  inDevelopment: ["Awake, a session forms beliefs only about me or us; the rest wait for the night."],
};
