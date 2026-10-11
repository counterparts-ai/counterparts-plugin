/* The memory mechanisms, in the site's order (counterparts-site
   features/home-v2/content/regions.ts, the two parked ones left out), and the
   four families they are grouped by. One folder per mechanism; each module's
   default export is { id, family, name, short, tagline, does, explainer,
   built, inDevelopment } (`does`: the panel's one short line; the last two:
   plain-word bullets, behind the panel's "how it works" fold).
   Whether it is firing, and how much of it is built (the pill's "partly built"
   tag), come from `/api/mechanisms` — one table, `adapters/mechanism-evidence.ts`.

   A mechanism with a picture of this store's own data has a `panel.js` beside
   its `index.js` (export `picture(payload)`, pure markup from
   `/api/mechanism?id=`); PANELS below is the one place they are gathered, so a
   mechanism built later ships its folder and one line here. Since home round 3b
   (2026-09-27) every built mechanism has one: the memories behind its number. */
import salience from "./salience/index.js";
import emotional from "./emotional/index.js";
import decay from "./decay/index.js";
import interference from "./interference/index.js";
import retrieval from "./retrieval/index.js";
import association from "./association/index.js";
import prospective from "./prospective/index.js";
import consolidation from "./consolidation/index.js";
import dreaming from "./dreaming/index.js";
import reconsolidation from "./reconsolidation/index.js";
import episodic_semantic from "./episodic-semantic/index.js";
import schema from "./schema/index.js";
import * as associationPanel from "./association/panel.js";
import * as consolidationPanel from "./consolidation/panel.js";
import * as decayPanel from "./decay/panel.js";
import * as dreamingPanel from "./dreaming/panel.js";
import * as emotionalPanel from "./emotional/panel.js";
import * as gistPanel from "./episodic-semantic/panel.js";
import * as prospectivePanel from "./prospective/panel.js";
import * as reconsolidationPanel from "./reconsolidation/panel.js";
import * as interferencePanel from "./interference/panel.js";
import * as retrievalPanel from "./retrieval/panel.js";
import * as saliencePanel from "./salience/panel.js";

export const MECHANISMS = [salience, emotional, decay, interference, retrieval, association, prospective, consolidation, dreaming, reconsolidation, episodic_semantic, schema];

/** The four stages, in the order a memory lives through them — the site's colours
 *  (since home round 3b, a small colour mark on each pill, not a heading). */
export const FAMILIES = [
  { key: "encoding", label: "Encoding", color: "#00e5ff" },
  { key: "storage", label: "Storage", color: "#80a8ff" },
  { key: "retrieval", label: "Retrieval", color: "#ffc94d" },
  { key: "transformation", label: "Transformation", color: "#b387ff" },
];

/** Each mechanism's picture, by id. A mechanism missing here shows no picture. */
export const PANELS = {
  salience: saliencePanel,
  emotional: emotionalPanel,
  decay: decayPanel,
  retrieval: retrievalPanel,
  association: associationPanel,
  prospective: prospectivePanel,
  consolidation: consolidationPanel,
  dreaming: dreamingPanel,
  reconsolidation: reconsolidationPanel,
  interference: interferencePanel,
  "episodic-semantic": gistPanel,
};

/**
 * "See how it works": the mechanism's plate in the site's Field Guide
 * (counterparts.ai/ecosystem, each plate carries its mechanism id as its
 * anchor). The Field Guide has no association plate, so that one links the
 * home page's own mechanism panel instead.
 */
const SITE = "https://counterparts.ai";
const NO_PLATE = { association: SITE + "/#brain" };
export function guideUrl(id) {
  return NO_PLATE[id] || SITE + "/ecosystem/#" + id;
}
