/* Selected mechanism — what a node does, its brain analogy, where that analogy
   deliberately breaks, and what it has actually been doing. */
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";
import { flow } from "../state.js";
import { drawFlow } from "./diagram.js";

export const markup = `
        <h2>Selected mechanism</h2>
        <div class="card pad" id="flowdetail">
          <p style="color:var(--dim)">Loading…</p>
        </div>`;

export async function selectNode(key) {
  flow.selected = key;
  drawFlow();
  let d;
  try { d = await api("/api/node?key=" + encodeURIComponent(key)); }
  catch (e) { return fail("That node", e); }
  $("flowdetail").innerHTML =
    "<h3>" + esc(d.label) + "</h3>" +
    "<p>" + esc(d.what) + "</p>" +
    '<div class="lab">where the brain analogy holds</div>' +
    '<div class="brain">' + esc(d.analog) + "</div>" +
    '<div class="lab">where it deliberately breaks</div>' +
    '<div class="breaks">' + esc(d.breaks) + "</div>" +
    '<div class="lab">right now</div>' +
    "<p style='color:var(--dim)'>" + esc(d.state) + "</p>" +
    '<div class="lab">what it has been doing</div>' +
    (d.noEventOfItsOwn
      ? "<p style='color:var(--dim)'>" + esc(d.noEventOfItsOwn) + "</p>"
      : d.unloggedPath
        ? "<p style='color:var(--dim)'>" + esc(d.unloggedPath) + "</p>" +
          (d.recent.length === 0 ? "" : d.recent.map(nodeEvent).join(""))
      : d.recent.length === 0
        ? "<p style='color:var(--dim)'>" + esc(d.recentAbsent || "(never run)") + " — nothing of this node's has reached the log.</p>"
        : d.recent.map(nodeEvent).join(""));
}
function nodeEvent(ev) {
  return "<p class='tone-" + ev.tone + "' style='font-size:11px'>" +
    "<span style='color:var(--faint)'>day " + ev.day + " · </span>" + esc(ev.text) + "</p>";
}

// The phone list's rows select through an inline `onclick` string.
window.selectNode = selectNode;
