/* Lived day × event — the last three weeks of the log. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
    <h2>Lived day × event <small>— the last three weeks of the log</small></h2>
    <div class="card pad heat" id="h-heat"></div>`;

export function paint(d) {
  const hm = d.heatmap;
  const peak = Math.max(1, ...hm.cells.map((c) => c.count));
  const byName = {};
  for (const c of hm.cells) { (byName[c.name] = byName[c.name] || {})[c.day] = c.count; }
  $("h-heat").innerHTML =
    "<table class='heatgrid'><thead><tr><th></th>" +
    hm.days.map((day) => "<td class='dayhdr'>" + day + "</td>").join("") + "</tr></thead><tbody>" +
    hm.names.map((name) =>
      "<tr><th>" + esc(name) + "</th>" +
      hm.days.map((day) => {
        const c = (byName[name] || {})[day] || 0;
        const a = c === 0 ? 0 : 0.18 + 0.82 * (c / peak);
        return "<td><div class='cell' title='" + esc(name) + " · day " + day + " · " + c + "' style='background:rgba(0,229,255," + a.toFixed(3) + ")'></div></td>";
      }).join("") + "</tr>"
    ).join("") + "</tbody></table>" +
    "<p class='foot'>An empty row is a mechanism that recorded nothing in this window — which is a fact about the log, not a gap in the table.</p>";
}
