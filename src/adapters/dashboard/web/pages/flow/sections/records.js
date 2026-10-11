/* Everything I can record durably — what each record means, and how often. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>Everything I can record durably <small>— what each record means, and how often I have made one</small></h2>
        <div class="card tablewrap" id="h-records"></div>
        <p class="foot">What has actually happened is listed first; everything below the last count has
          never been recorded. A row marked <b style="color:var(--teal);font-weight:400">host</b> is one
          an adapter wrote — counts, bytes and reasons; never text.</p>`;

export function paint(d) {
  // ONE table where there were two, and the English leads. The dotted name is
  // still on the page — it is what the owner greps the log for — but on the
  // second line, in the type an identifier deserves.
  $("h-records").innerHTML =
    "<table><thead><tr><th>what it records</th><th class='num'>kept</th></tr></thead><tbody>" +
    d.records.map((r) =>
      "<tr><td><div class='lead'>" + esc(r.gloss) + "</div>" +
      "<div class='ident'>" + esc(r.name) +
      (r.adapter ? "<span class='hostmark'>host</span>" : "") +
      (r.note ? "<span class='notemark'>" + esc(r.note) + "</span>" : "") + "</div></td>" +
      "<td class='num" + (r.absent ? " dimtd" : "") + "'>" + (r.absent ? esc(r.absent) : r.count) + "</td></tr>"
    ).join("") + "</tbody></table>";
}
