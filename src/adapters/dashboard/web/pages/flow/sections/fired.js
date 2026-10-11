/* What fired — every mechanism by name, silent first. Constitution 11's last
   sentence as one panel: what fired, what went quiet, and what nothing records
   at all. Its own fetch (`/api/fired`) and its own table. */
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>What fired <small>— every mechanism by name, silent first</small></h2>
        <div class="card tablewrap" id="h-fired"></div>
        <p class="foot" id="h-fired-foot"></p>`;

export async function render() {
  let d;
  try { d = await api("/api/fired"); } catch (e) { return fail("The what-fired panel", e); }
  const rows = [];
  for (const { state, meaning } of d.vocabulary) {
    const group = d.rows.filter((r) => r.state === state);
    if (group.length === 0) continue;
    rows.push("<tr><th colspan='3' class='dayhdr'>" + esc(state) + " (" + group.length + ") — " + esc(meaning) + "</th></tr>");
    for (const r of group) {
      rows.push(
        "<tr><td><div class='lead'>" + esc(r.label) + "</div>" +
        "<div class='ident'>" + esc(r.evidence) + "</div>" +
        (r.note ? "<div class='ident'>" + esc(r.note) + "</div>" : "") + "</td>" +
        "<td class='num" + (r.lastFired ? "" : " dimtd") + "'>" + esc(r.lastFired || "never") + "</td>" +
        "<td class='num" + (r.firedInWindow ? "" : " dimtd") + "'>" + r.firedInWindow +
        (r.refusedInWindow ? "<div class='ident'>refused " + r.refusedInWindow + (r.topRefusal ? " · " + esc(r.topRefusal) : "") + "</div>" : "") +
        "</td></tr>",
      );
    }
  }
  $("h-fired").innerHTML =
    "<table><thead><tr><th>what it does</th><th class='num'>last fired</th><th class='num'>7 days</th></tr></thead><tbody>" +
    rows.join("") + "</tbody></table>";
  $("h-fired-foot").textContent =
    d.from + "→" + d.today + (d.zone ? " (" + d.zone + ")" : "") + ", against " + d.previousFrom + "→" + d.previousTo + ". " +
    (d.missedOccasion && d.missedOccasion.length ? "Its occasion came this week and it did not fire: " + d.missedOccasion.join("; ") + ". " : "") +
    (d.wentQuiet.length ? "Fired last week and not once this week: " + d.wentQuiet.join("; ") + ". "
                        : "Nothing that fired last week has fallen silent this week. ") +
    (d.truncated ? "The event read hit its ceiling, so every count is a floor. " : "") +
    "A row marked blind is one nothing durable records — its line says which row would fix it.";
}
