/* Band symmetry — the UP-ratchet tripwire, read by reason (2026-10-10: fading down is the curve, never an alarm). */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>Band symmetry <small>— the up-ratchet tripwire, read by reason</small></h2>
        <div class="card tablewrap" id="h-symmetry"></div>
        <p class="foot">A counter nobody feeds is a tripwire that cannot trip. <b style="color:var(--dim);font-weight:400">never-asked</b>
          is reported as itself and never as health. Fading down a band is the curve working; only a climb no
          use, return, feeling or promotion explains — or climbs far outnumbering falls — trips it.</p>`;

export function paint(d) {
  $("h-symmetry").innerHTML =
    "<table><thead><tr><th>kind</th><th class='num'>up</th><th class='num'>down</th><th>verdict</th></tr></thead><tbody>" +
    d.symmetry.map((s) =>
      "<tr><td>" + esc(s.kind) + "</td><td class='num dimtd'>" + s.up + "</td><td class='num dimtd'>" + s.down + "</td>" +
      "<td style='color:" + (s.ok ? "var(--teal)" : "var(--amber)") + "'>" +
        esc(s.reason === "ratchet-suspected" ? "up-ratchet suspected" + (s.unexplained > 0 ? " (" + s.unexplained + " unexplained)" : "") : s.reason) +
        "</td></tr>"
    ).join("") + "</tbody></table>";
}
