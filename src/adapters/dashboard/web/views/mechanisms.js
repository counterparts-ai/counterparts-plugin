import {
  FAMILIES,
  MECHANISM_EVIDENCE,
  RECENT_IDS,
  amount,
  counted,
  builtCount,
  mechanismEvidence,
  payloadOf
} from "../../../mechanism-evidence.js";
import { localDate } from "../../../../core/time.js";

export { FAMILIES, RECENT_IDS, amount, builtCount, counted, payloadOf };
export const MECHANISM_PROOFS = MECHANISM_EVIDENCE;
export const MECHANISM_DAYS = 7;
const plural = (n, says) => `${n} ${n === 1 ? says[0] : says[1]}`;
export function nextRunWords(nextInDays) {
  if (nextInDays <= 0)
    return "at the next session's end";
  return `in ${nextInDays} ${nextInDays === 1 ? "day" : "days"} of use`;
}
export function returnWords(r) {
  const out = [];
  if (r.awake > 0)
    out.push(`${r.awake} came back in conversation`);
  if (r.dream > 0)
    out.push(`${r.dream} replayed in a dream`);
  return out;
}
const lead = (keys, one, many, week = true) => ({ keys, says: [one, many], week });
export const LEADS = {
  salience: [lead(["deposit", "chunk"], "memory scored as it was written", "memories scored as they were written")],
  emotional: [
    lead(["moodMatched"], "memory a matching mood brought closer", "memories a matching mood brought closer"),
    lead(["weighted"], "new memory held higher for its feeling", "new memories held higher for their feeling")
  ],
  decay: [
    lead(["belowReach"], "memory below reach now", "memories below reach now", false),
    lead(["pruned"], "memory exited (archived)", "memories exited (archived)"),
    lead(["faded"], "memory faded a band", "memories faded a band"),
    lead(["cards"], "unused card faded", "unused cards faded")
  ],
  retrieval: [
    lead(["turns"], "turn brought memories to mind", "turns brought memories to mind"),
    lead(["lookups"], "deliberate look-up", "deliberate look-ups")
  ],
  association: [lead(["reached"], "memory a link brought to mind", "memories links brought to mind"), lead(["links", "replayed"], "link laid", "links laid")],
  prospective: [
    lead(["plain", "quiet"], "reminder came back", "reminders came back"),
    lead(["held"], "dated memory held", "dated memories held", false)
  ],
  consolidation: [
    lead(["awake"], "came back in conversation", "came back in conversation"),
    lead(["promoted"], "memory became core", "memories became core"),
    lead(["merged", "dreamMerged"], "memory merged", "memories merged"),
    lead(["dream"], "replayed in a dream", "replayed in a dream")
  ],
  dreaming: [
    lead(["changes"], "change a dream made", "changes dreams made"),
    lead(["dreams"], "dream", "dreams")
  ],
  reconsolidation: [
    lead(["pressure"], "correction weighed against an old memory", "corrections weighed against old memories"),
    lead(["settled"], "contradiction settled", "contradictions settled")
  ],
  interference: [
    lead(["dreamMerged"], "near-copy merged in a dream", "near-copies merged in a dream"),
    lead(["flagged"], "pair that disagrees flagged", "pairs that disagree flagged"),
    lead(["proposed"], "memory read as the newer state of an older one", "memories read as the newer state of older ones"),
    lead(["faded"], "earlier memory faded under a newer one", "earlier memories faded under newer ones")
  ],
  "episodic-semantic": [lead(["gist"], "pattern dreamed into a memory of its own", "patterns dreamed into memories of their own")]
};
export function leadOf(v, returns) {
  const candidates = LEADS[v.id];
  if (v.build === "not" || candidates === undefined || candidates.length === 0)
    return null;
  const counts = new Map(v.parts.map((p) => [p.key, p.count]));
  if (returns !== undefined) {
    counts.set("awake", returns.awake);
    counts.set("dream", returns.dream);
  }
  if (v.held !== null)
    counts.set("held", v.held);
  const sum = (c) => c.keys.reduce((t, k) => t + (counts.get(k) ?? 0), 0);
  const pick = candidates.find((c) => sum(c) > 0) ?? candidates[0];
  const n = sum(pick);
  return { n, words: (n === 1 ? pick.says[0] : pick.says[1]) + (pick.week ? " this week" : "") };
}
export function lightOf(v, returns) {
  const row = MECHANISM_EVIDENCE.find((m) => m.id === v.id);
  const base = {
    id: v.id,
    family: v.family,
    build: v.build,
    nextInDays: v.schedule?.nextInDays ?? null,
    lead: leadOf(v, returns),
    firedToday: v.firedToday
  };
  if (v.build === "not" || row === undefined) {
    return { ...base, status: "grey", evidence: row?.grey ?? "Not built yet.", events: [] };
  }
  const heldLine = row.held === undefined || v.held === null ? "" : ` ${plural(v.held, row.held.says)}.`;
  if (v.fired) {
    const said = v.parts.filter((p) => p.count > 0).flatMap((p) => p.key === "returns" && returns !== undefined ? returnWords(returns) : [plural(p.count, p.says)]);
    const todayLine = v.today === null ? "" : ` ${v.today} today.`;
    return {
      ...base,
      status: "green",
      evidence: `${said.join(", ")} in the last ${MECHANISM_DAYS} days of use.${todayLine}${heldLine}`,
      events: v.events
    };
  }
  if (v.starved !== undefined) {
    const said = v.parts.filter((p) => p.count > 0).map((p) => plural(p.count, p.says));
    const missing = v.parts.find((p) => p.key === v.starved);
    const none = missing === undefined ? "" : `, but no ${missing.says[0]}`;
    return { ...base, status: "amber", evidence: `${said.join(", ")} in the last ${MECHANISM_DAYS} days of use${none}.${heldLine}`, events: v.events };
  }
  if (v.young !== undefined) {
    const said = v.parts.filter((p) => p.count > 0).map((p) => plural(p.count, p.says));
    const missing = v.parts.find((p) => p.key === v.young);
    const none = missing === undefined ? "" : ` No ${missing.says[0]} yet; that takes a few weeks of use.`;
    return { ...base, status: "waiting", evidence: `${said.join(", ")} in the last ${MECHANISM_DAYS} days of use.${none}${heldLine}`, events: v.events };
  }
  if (row.held !== undefined && v.held === 0) {
    return { ...base, status: "waiting", evidence: row.held.none, events: [] };
  }
  if (v.schedule !== null && v.schedule.onTime && v.schedule.lastRanDay !== null) {
    return {
      ...base,
      status: "waiting",
      evidence: `Ran on schedule on day ${v.schedule.lastRanDay} of use with nothing to change; ` + `next run ${nextRunWords(v.schedule.nextInDays)}.`,
      events: []
    };
  }
  const evidence = v.lastFiredDay === null ? `Built, and no record of it firing yet.` : `Built, but quiet for ${MECHANISM_DAYS} days of use (last fired on day ${v.lastFiredDay} of use).`;
  return { ...base, status: "amber", evidence: `${evidence}${heldLine}`, events: [] };
}
export function mechanismsView(src) {
  const store = src.store;
  let livedDay = 0;
  try {
    livedDay = store.livedDay();
  } catch {
    livedDay = 0;
  }
  const fromDay = Math.max(0, livedDay - (MECHANISM_DAYS - 1));
  const today = store.today();
  const zone = store.zone();
  const { verdicts, truncated } = mechanismEvidence(store, {
    sinceDay: fromDay,
    today: livedDay,
    isToday: (row) => localDate(row.at, zone) === today
  });
  const r = store.returnCounts({ sinceDay: fromDay });
  const returns = { awake: r.awake, dream: r.dream };
  return { livedDay, fromDay, days: MECHANISM_DAYS, today, mechanisms: verdicts.map((v) => lightOf(v, returns)), truncated };
}
