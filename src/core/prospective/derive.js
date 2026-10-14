import { sal } from "../physics/index.js";
import { phaseOf, precisionOf, recurringWindowAt, windowFor } from "./windows.js";
export const EXCLUDED_KINDS = ["skill"];
function encodeDateOk(learnedOn) {
  if (learnedOn === null)
    return false;
  const p = precisionOf(learnedOn);
  return p === "day";
}
export function derive(memory, dates, at, t) {
  const blockedBy = [];
  const s = sal(memory.salience);
  if (memory.archived)
    blockedBy.push("archived");
  if (memory.journal)
    blockedBy.push("journal");
  if (EXCLUDED_KINDS.includes(memory.kind))
    blockedBy.push("excluded-kind");
  if (!encodeDateOk(memory.learnedOn))
    blockedBy.push("missing-encode-date");
  if (memory.faded === true && memory.recurring !== true)
    blockedBy.push("faded");
  if (s < t.SALIENCE_FLOOR && memory.explicitDate !== true)
    blockedBy.push("below-salience-floor");
  const windows = [];
  const rejectedDates = [];
  const seen = new Set;
  for (const d of dates) {
    const precision = precisionOf(d.date);
    if (precision === null) {
      rejectedDates.push({ date: d.date, reason: "malformed-date" });
      continue;
    }
    if (precision === "year") {
      rejectedDates.push({ date: d.date, reason: "year-only-precision" });
      continue;
    }
    const w = d.recurring !== undefined && precision === "day" ? recurringWindowAt(d.date, d.recurring, at, t, memory.id) : windowFor(d.date, precision, t, memory.id);
    if (w === null) {
      rejectedDates.push({ date: d.date, reason: "malformed-date" });
      continue;
    }
    if (seen.has(w.key))
      continue;
    seen.add(w.key);
    windows.push({ ...w, phase: phaseOf(w, at) });
  }
  windows.sort((a, b) => a.opensOn < b.opensOn ? -1 : a.opensOn > b.opensOn ? 1 : 0);
  if (windows.length === 0) {
    blockedBy.push(rejectedDates[0]?.reason ?? "no-event-date");
  } else if (windows.every((w) => w.phase === "passed")) {
    blockedBy.push("window-passed");
  }
  return {
    memoryId: memory.id,
    eligible: blockedBy.length === 0,
    reason: blockedBy[0] ?? "eligible",
    blockedBy,
    windows,
    rejectedDates,
    salience: s
  };
}
