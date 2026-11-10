/* Every fetch goes through here. No network beyond this origin; GET only. */
import { $, esc } from "./dom.js";

/** Where the page is mounted: `/` locally, `/dashboard/` on hosted. This file
 *  is `<base>shared/api.js`, so its own address says it. */
const BASE = new URL("../", import.meta.url).pathname;

/** A root-relative `/api/…` path, under the page's base. */
export function apiUrl(path) {
  return BASE + String(path).replace(/^\//, "");
}

/** Every fetch goes through here so one failure is a sentence, never a blank
 *  page and never an unhandled rejection in the console. */
export async function api(path) {
  let res = await fetch(apiUrl(path), { headers: { accept: "application/json" } });
  // A host that bounds how many views one person has in flight (hosted: two)
  // answers the rest 429; the page's boot asks for several at once, so a 429
  // waits a little and asks again. Locally there is no such answer.
  for (let wait = 200; res.status === 429 && wait <= 3200; wait *= 2) {
    await new Promise((r) => setTimeout(r, wait));
    res = await fetch(apiUrl(path), { headers: { accept: "application/json" } });
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body && body.error ? body.error : ("HTTP " + res.status));
  return body;
}
export function fail(where, err) {
  const box = $("err");
  box.style.display = "block";
  box.innerHTML = "<b>" + esc(where) + " did not load.</b> " + esc(err && err.message ? err.message : String(err)) +
    " &nbsp;The rest of this page is unaffected — it is built one panel at a time on purpose.";
}
