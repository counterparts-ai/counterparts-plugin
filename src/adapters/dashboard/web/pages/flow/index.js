/* The flow tab: the architecture, alive — and, below it, "Under the hood":
   the developer panels that used to sit on the health tab. One fetch
   (`/api/flow`) for the diagram and its feed; `/api/node` per selected
   mechanism; `/api/health` and `/api/fired` for the panels underneath. */
import { api, fail } from "../../shared/api.js";
import { live, tabs } from "../../shared/state.js";
import { flow } from "./state.js";
import * as detail from "./sections/detail.js";
import * as diagram from "./sections/diagram.js";
import * as feed from "./sections/feed.js";
import * as blind from "./sections/blind.js";
import * as fired from "./sections/fired.js";
import * as heatmap from "./sections/heatmap.js";
import * as records from "./sections/records.js";
import * as symmetry from "./sections/symmetry.js";

const markup = `
    <p class="lede">
      The architecture, alive. <b>Only particles mean activity</b> — nothing here drifts for decoration, so a
      still diagram is a still machine. Click any part for what it does, its brain analogy, where that analogy
      deliberately breaks, and what it has actually been doing.
    </p>${diagram.markup}
    <div class="cols">
      <div>${feed.markup}
      </div>
      <div>${detail.markup}
      </div>
    </div>
    <div id="underhood">
      <h2>Under the hood <small>— the raw readings behind the diagram, for whoever is building it</small></h2>
      <div class="cols">
        <div>${symmetry.markup}${records.markup}
        </div>
        <div>${fired.markup}
        </div>
      </div>${heatmap.markup}${blind.markup}
    </div>
  `;

/** The panels under the diagram: `/api/health`'s developer half, then the
 *  what-fired panel's own `/api/fired`. Each failure is its own sentence. */
async function renderUnderHood() {
  let d;
  try { d = await api("/api/health"); } catch (e) { return fail("The under-the-hood panels", e); }
  symmetry.paint(d);
  records.paint(d);
  heatmap.paint(d);
  blind.paint(d);
  await fired.render();
}

async function render() {
  try { flow.data = await api("/api/flow"); } catch (e) { return fail("The flow page", e); }
  feed.paint(flow.data);
  live.lastSeq = flow.data.lastSeq;
  diagram.drawFlow();
  // Open on a node rather than on "click any node in the diagram." The
  // mechanism panel is the best writing on the page and an empty box is a
  // 900×90 hole in the middle of it; sleep is the one whose brain analogy most
  // people already half-know, so it is the one worth meeting first.
  if (flow.selected === null) await detail.selectNode("sleep");
  await renderUnderHood();
}

/** The store moved: every count on the diagram moved with it. Left open, the
 *  flow page used to report yesterday's numbers beside today's feed. */
async function refresh() {
  const fresh = await api("/api/flow?limit=24");
  if (flow.data) {
    flow.data = { ...flow.data, nodes: fresh.nodes, lastSeq: fresh.lastSeq };
    if (tabs.current === "flow") diagram.drawFlow();
  }
}

/** One node's state line, for a harness that wants to prove the counters are
 *  live rather than take a screenshot's word for it. (`tools/visual-loop`.) */
window.flowState = (key) => {
  const node = flow.data && flow.data.nodes.find((n) => n.key === key);
  return node ? node.state : "";
};

export default {
  name: "flow",
  mount(section) {
    section.innerHTML = markup;
    diagram.mount(detail.selectNode);
    feed.mount();
  },
  render,
  refresh,
  show: diagram.drawFlow,
  resize: diagram.drawFlow,
  redraw: diagram.drawFlow,
  /** New durable events: particles ride the edges into the nodes that logged
   *  them. */
  onEvents(fresh) { diagram.ignite(fresh); },
  /**
   * A deposit with no event of its own. There is nothing to put in the feed —
   * the feed IS the durable log, and inventing a row there would be a lie
   * about what was recorded — but the counters moved and the diagram can say
   * so, along the path a deposit actually takes: the authored door, the gate,
   * the store. Named edges, because the first edge into ENCODE is the crash
   * fallback and an authored deposit did not crash.
   *
   * Since `gate.deposit` this is no longer the branch a note takes — a note
   * logs, so it takes the events branch and its animation is driven by the
   * row's own `node`. This is now the arm for a store that gained rows some
   * other way, which is the only thing it should ever have claimed to be.
   */
  onDeposit() {
    diagram.ignite([
      { node: "remember", via: "session>remember", tone: "calm", delay: 0 },
      { node: "encode", via: "remember>encode", tone: "calm", delay: 0.34 },
      { node: "store", via: "encode>store", tone: "calm", delay: 0.68 },
    ]);
  },
};
