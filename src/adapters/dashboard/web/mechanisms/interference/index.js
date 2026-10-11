/* Interference. `explainer` is what Counterparts actually does, checked against
   docs/research/mechanism-audit-2026-09-24.md; `built` / `inDevelopment` are the
   audit plus #215/#218/#220, in plain words; `tagline` is the
   site's (regions.ts). Its light comes from `/api/mechanisms`. */
export default {
  id: "interference",
  family: "storage",
  name: "Interference",
  short: "Interference",
  tagline: "New memories crowd out old ones. Old ones distort new ones. They compete.",
  does: "Near-copies merge in a dream; an earlier memory fades under the newer one.",
  explainer: "Partly built: a dream merges near-copies, and two memories that disagree are flagged and settled — the older fades, leaves recall, or both are kept. Similar memories do not yet compete when they are recalled.",
  built: [
    "A dream merges near-copies into one memory, keeping the originals readable.",
    "Two memories that disagree are flagged as a pair, and shown as unsettled until someone settles them.",
    "A memory settled as changed fades once under the one that holds.",
  ],
  inDevelopment: ["Similar memories competing when they are recalled (one pushing the other down)."],
};
