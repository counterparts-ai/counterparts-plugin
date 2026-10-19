/**
 * `doctor`'s Feedback loop line (2026-10-19, an experiment; check on ~10-22).
 *
 * Trying ratings as use, strong co-use links and light habituation
 * (`core/recall/rated.ts`, `habituation.ts`) to see whether the day starts
 * teaching the system. This line is what the 2–3 day review reads: over the
 * last week's `recall.rated` rows, the uses credited by tier and the pairs sent
 * to be linked; the links now at or above the quiet-pointer weight; how many
 * memories are habituated now, and how many were shown anyway. Pointers shown
 * and later expanded are on the Association line. Informational: green, with
 * the numbers. Reads only.
 */
import type { Store } from "../../core/store/index.js";
import { RECALL_RATED_EVENT } from "../../core/counterpart.js";
import { TUNABLES as ASSOCIATE_TUNABLES, edgeWeightAt } from "../../core/associate/index.js";
import { TUNABLES as RECALL_TUNABLES } from "../../core/recall/tunables.js";
import { habituatedIds } from "../../core/recall/index.js";
import { finding, num, payloadOf } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

/** How far back the line reads, in lived days. */
const FEEDBACK_WINDOW_DAYS = 7;
/** Rows read per name; a full read is a floor, and says so. */
const FEEDBACK_ROWS = 5_000;

/** The single-link weight the quiet-pointer lane needs — derived, never a constant of its own. */
export function pointerLinkWeight(): number {
  return (RECALL_TUNABLES.LINK_POINTER_MIN_FRACTION * ASSOCIATE_TUNABLES.MAX_OUT_WEIGHT) / ASSOCIATE_TUNABLES.HOP_DECAY;
}

export function feedbackLoopFindings(store: Store): Finding[] {
  const day = store.livedDay();
  const since = Math.max(0, day - FEEDBACK_WINDOW_DAYS);
  const credited = { shown: 0, ontopic: 0, useful: 0, referenced: 0 };
  let notCredited = 0;
  let coUsePairs = 0;
  let together = 0;
  let calls = 0;
  let shownHabituated = 0;
  let atPointer = 0;
  let habituatedNow = 0;
  let floor = false;
  try {
    const rows = store.eventLog({ name: RECALL_RATED_EVENT, sinceDay: since, order: "desc", limit: FEEDBACK_ROWS });
    floor = rows.length >= FEEDBACK_ROWS;
    for (const row of rows) {
      const p = payloadOf(row);
      const c = p["credited"];
      if (c === null || typeof c !== "object") continue;
      calls += 1;
      const cr = c as Record<string, unknown>;
      for (const k of ["shown", "ontopic", "useful", "referenced"] as const) credited[k] += num(cr, k) ?? 0;
      const nc = p["notCredited"];
      if (nc !== null && typeof nc === "object") for (const v of Object.values(nc)) if (typeof v === "number") notCredited += v;
      const co = p["coUse"];
      if (co !== null && typeof co === "object") coUsePairs += num(co as Record<string, unknown>, "pairs") ?? 0;
      together += num(p, "together") ?? 0;
    }
    for (const row of store.eventLog({ name: "recall.decision", sinceDay: since, order: "desc", limit: FEEDBACK_ROWS })) {
      const p = payloadOf(row);
      for (const lane of ["surfaced", "footnotes"] as const) {
        const list = p[lane];
        if (Array.isArray(list)) for (const e of list) if (e !== null && typeof e === "object" && (e as { habituated?: unknown }).habituated === true) shownHabituated += 1;
      }
    }
    const w = pointerLinkWeight();
    for (const e of store.allEdges()) {
      if (edgeWeightAt({ src: e.src, dst: e.dst, weight: e.weight, lastDay: e.last_day }, day, ASSOCIATE_TUNABLES) >= w) atPointer += 1;
    }
    habituatedNow = habituatedIds(store, day, RECALL_TUNABLES).size;
  } catch {
    return [];
  }
  const total = credited.shown + credited.ontopic + credited.useful + credited.referenced;
  const detail =
    calls === 0
      ? `last ${String(FEEDBACK_WINDOW_DAYS)} lived days — no rating has counted yet (the experiment began 2026-10-19)`
      : `last ${String(FEEDBACK_WINDOW_DAYS)} lived days, ${String(calls)} rating ${calls === 1 ? "call" : "calls"} — ${String(total)} uses credited (${String(credited.shown)} glimpses, ${String(credited.ontopic)} rated 1, ${String(credited.useful)} rated 2, ${String(credited.referenced)} rated 3), ${String(notCredited)} not credited; ${String(coUsePairs)} co-use ${coUsePairs === 1 ? "pair" : "pairs"} and ${String(together)} shown-together ${together === 1 ? "pair" : "pairs"} sent to be linked`;
  return [
    finding(
      "feedback-loop",
      "green",
      "Feedback loop",
      `${detail}. ${String(atPointer)} ${atPointer === 1 ? "link" : "links"} at or above the quiet-pointer weight (${pointerLinkWeight().toFixed(2)}). ${String(habituatedNow)} ${habituatedNow === 1 ? "memory" : "memories"} habituated now; ${String(shownHabituated)} habituated ${shownHabituated === 1 ? "showing" : "showings"} got through anyway` +
        (floor ? ". More rows than were read: the counts are a floor" : ""),
      "",
      {
        calls,
        credited: total,
        glimpses: credited.shown,
        rated1: credited.ontopic,
        rated2: credited.useful,
        rated3: credited.referenced,
        notCredited,
        coUsePairs,
        together,
        atPointer,
        habituatedNow,
        shownHabituated,
        floor,
      },
    ),
  ];
}
