/* "Check the index" — `counterparts verify`, through the actions seam. A read:
   it compares the search index with the memories and changes nothing (the
   repairing flags are the terminal's). */
import { act, resultHtml } from "../../../shared/actions.js";
import { $, esc } from "../../../shared/dom.js";

export const markup = `
    <div class="card pad hv" id="h-verify">
      <div class="hv-head">
        <div><div class="hv-title">The search index</div>
          <div class="hv-sub" id="hv-sub">Compares what recall searches with what is actually stored. Changes nothing.</div></div>
        <button type="button" class="act-btn hv-btn" id="hv-go">Check the index</button>
      </div>
      <div id="hv-out"></div>
    </div>`;

/** The console's lines, read for the three facts a person wants. */
function summarise(out) {
  const text = out.join("\n");
  const live = /live rows:\s*(\d+)/.exec(text);
  const indexed = /indexed documents:\s*(\d+)/.exec(text);
  const stale = /indexed but not live[^:]*:\s*(\d+)/.exec(text);
  const verdict = out.length ? out[out.length - 1].trim() : "";
  const facts = [];
  if (live) facts.push(live[1] + " live memories");
  if (indexed) facts.push(indexed[1] + " in the index");
  if (stale && Number(stale[1]) > 0) facts.push(stale[1] + " indexed but no longer live");
  return { verdict, facts };
}

export function mount() {
  $("hv-go").onclick = async () => {
    const btn = $("hv-go");
    btn.disabled = true;
    btn.textContent = "Checking…";
    $("hv-out").innerHTML = "";
    const r = await act("verify", {});
    btn.disabled = false;
    btn.textContent = "Check again";
    if (r.error || !r.out) {
      $("hv-out").innerHTML = '<div class="hv-res">' + '<span class="hc-dot hc-amber"></span><span>' +
        esc(r.error || "verify gave no reading.") + "</span></div>";
      return;
    }
    const s = summarise(r.out);
    const ok = r.ok === true;
    $("hv-out").innerHTML =
      '<div class="hv-res"><span class="hc-dot hc-' + (ok ? "green" : "amber") + '"></span><span>' +
      esc(ok ? (s.verdict || "The index matches the memories.") : "The index needs a look: " + (s.verdict || "see the full report")) +
      "</span></div>" +
      (s.facts.length ? '<div class="hv-facts">' + esc(s.facts.join(" · ")) + "</div>" : "") +
      '<details class="hv-full"><summary>The full report</summary>' + resultHtml(r) + "</details>";
  };
}
