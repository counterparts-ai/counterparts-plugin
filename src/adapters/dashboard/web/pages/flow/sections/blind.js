/* What I cannot see — named, so an absence is a claim and not a gap. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
    <h2>What I cannot see <small>— named, so an absence is a claim and not a gap</small></h2>
    <div class="card pad" id="h-blind"></div>`;

export function paint(d) {
  $("h-blind").innerHTML = d.blind.map((b) =>
    '<div class="blind"><span class="w">' + esc(b.what) + '</span> <span class="y">' + esc(b.why) + "</span></div>"
  ).join("");
}
