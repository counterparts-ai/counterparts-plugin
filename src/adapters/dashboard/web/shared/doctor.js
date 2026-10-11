/* Doctor's reading, shared (home round 4, 2026-09-28): the health tab draws it
   as a checklist (`pages/health/sections/checks.js`), and the home tab says
   it in a few words beside its headline ("● All good", "● 1 thing to look
   at"). One run serves both, so the two can never disagree about what
   "healthy" means.

   The run is `doctor --json` through the actions seam — a READ, it writes
   nothing — the console's own reading. */
import { act } from "./actions.js";

/** The last reading: `{ report, at }` or `{ problem }`; null before the first. */
let latest = null;
let running = null;
const listeners = [];

/** Be told every reading, and the last one now if there is one. */
export function onDoctor(fn) {
  listeners.push(fn);
  if (latest !== null) fn(latest);
}

/** A finding's light. `off` is an optional feature nobody turned on; `grey` a
 *  check this page could not make (no configuration named). */
export function gradeOf(f) {
  if (f.key === "config" && f.data && f.data.reason === "not-read") return "grey";
  if (f.optional) return "off";
  return f.severity;
}

/** The whole reading in a few words: its worst light and how many things want a look. */
export function verdictOf(report) {
  let look = 0;
  for (const f of report.findings) {
    const g = gradeOf(f);
    if (g === "red" || g === "amber") look += 1;
  }
  return {
    look,
    grade: look === 0 ? "green" : report.red > 0 ? "red" : "amber",
    words: look === 0 ? "All good" : look + (look === 1 ? " thing" : " things") + " to look at",
  };
}

/** Run doctor (once at a time: a second ask while one runs waits for it). */
export function runDoctor() {
  if (running) return running;
  running = (async () => {
    let reading;
    try {
      const r = await act("doctor", {});
      let report = null;
      try { report = JSON.parse((r.out || []).join("\n")); } catch (e) { report = null; }
      if (report && Array.isArray(report.findings)) reading = { report, at: new Date() };
      else reading = { problem: (r.err && r.err.length ? r.err.join(" ") : r.error) || "doctor gave no reading." };
    } catch (e) {
      reading = { problem: e && e.message ? e.message : String(e) };
    }
    latest = reading;
    for (const fn of listeners) fn(reading);
    return reading;
  })().finally(() => { running = null; });
  return running;
}

/** Run it unless it has run (or is running) already. */
export function doctorOnce() {
  return latest !== null ? Promise.resolve(latest) : runDoctor();
}
