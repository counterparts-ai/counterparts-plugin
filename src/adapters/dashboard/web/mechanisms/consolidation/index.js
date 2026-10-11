/* Consolidation. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "consolidation",
  family: "transformation",
  name: "Consolidation",
  short: "Consolidation",
  tagline: "Memories aren’t saved when they’re made. They’re rebuilt, offline, while you sleep.",
  does: "A memory that comes back after a gap fades more slowly; the ones about us can become core.",
  explainer: "Every time a memory comes back after a gap it fades more slowly — close-together returns count less, never against it. Every few lived days a short “sleep” decides the core: a memory about me or about us joins it when it was strongly felt and came back, or when it kept coming back over weeks, at most three a night.",
  built: [
    "Spaced returns make a memory fade more slowly; a use while it was showing in the wake's “Nearby” lane does not count.",
    "Two lanes into the core, for memories about me or about us, capped at three a night; you can send one back (counterparts core --demote).",
    "Exact duplicates merge at night; near-copies merge in a dream, with the originals kept.",
  ],
  inDevelopment: ["Facts, skills and places never become core, however often they come back — that is on purpose."],
};
