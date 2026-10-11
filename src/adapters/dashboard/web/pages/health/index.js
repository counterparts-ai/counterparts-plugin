/* The health tab: "is it working?" first — doctor's checks as a checklist
   with lights — then the last sleep cycle as one line, whether the wake fits
   its budget as one compact row (round 3b, from the self tab), where archived
   memories went as one picture, a button that checks the search index, and,
   at the bottom, "How the memory works": the mechanism pills and panel that
   lived on the home tab until round 4 (2026-09-28). The developer panels that
   used to live here (band symmetry, what fired, every durable record, the
   heatmap, what I cannot see) are on the flow tab, under the diagram.
   `/api/health` for the cycle and the archive; `/api/mechanisms` for the
   mechanisms; doctor and verify through the actions seam (both reads). */
import { api, fail } from "../../shared/api.js";
import * as archive from "./sections/archive.js";
import * as checks from "./sections/checks.js";
import * as cycle from "./sections/cycle.js";
import * as mechanisms from "./sections/mechanisms.js";
import * as verify from "./sections/verify.js";
import * as wake from "./sections/wake.js";

const markup = `
    ${checks.markup}
    ${cycle.markup}
    ${wake.markup}
    ${archive.markup}
    ${verify.markup}
    ${mechanisms.markup}
  `;

async function paint() {
  let d;
  try { d = await api("/api/health"); } catch (e) { return fail("The health page", e); }
  cycle.paint(d);
  wake.paint(d);
  archive.paint(d);
}

async function render() {
  // Doctor runs once, when the tab is first built (at boot, with every tab);
  // "Check again" re-runs it. The home tab's health dot reads the same run.
  void checks.runOnce();
  await Promise.all([paint(), mechanisms.render()]);
}

export default {
  name: "health",
  mount(section) {
    section.innerHTML = markup;
    verify.mount();
    mechanisms.mount();
  },
  render,
  refresh: () => Promise.all([paint(), mechanisms.refresh()]),
  /** `#health/mechanisms?id=salience` (the home tab's brain): that mechanism, open. */
  route({ anchor, params }) {
    if (anchor === "mechanisms") mechanisms.open(params.get("id"));
  },
};
