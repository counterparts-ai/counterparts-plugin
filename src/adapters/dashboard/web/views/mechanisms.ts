/**
 * `/api/mechanisms` — the eleven memory mechanisms the site names, each with a
 * light:
 *
 *   - grey: not built;
 *   - green: built, and fired in the last 7 LIVED days;
 *   - waiting: built, and not due — a scheduled phase that ran on time and
 *     comes round again in N days, or a mechanism holding nothing to act on;
 *   - amber: built, and quiet when it should not be.
 *
 * The list, its order and its four families are the site's
 * (`counterparts-site/features/home-v2/content/regions.ts`, minus the two it
 * parks). WHICH ROWS COUNT AS A FIRING, and how much of each is built, is
 * `adapters/mechanism-evidence.ts` — shared with `counterparts mechanisms`, so
 * the two cannot judge a mechanism differently. This file owns only the window
 * (lived days) and the dashboard's words. What each one says about Counterparts
 * lives beside the page, in `web/mechanisms/<id>/index.js`.
 *
 * Read-only, like everything in this directory. Rules 1–4 of `views.ts` apply;
 * no row text is emitted, only counts and event `seq`s the page can open with
 * `/api/event`.
 */
import {
  FAMILIES,
  MECHANISM_EVIDENCE,
  RECENT_IDS,
  amount,
  counted,
  builtCount,
  mechanismEvidence,
  payloadOf,
} from "../../../mechanism-evidence.js";
import type { Build, Family, MechanismEvidence, Payload, Proof, Verdict } from "../../../mechanism-evidence.js";
import type { DashboardSource } from "../../source.js";
import { localDate } from "../../../../core/time.js";

export { FAMILIES, RECENT_IDS, amount, builtCount, counted, payloadOf };
export type { Build, Family, Payload, Proof };

/** The one table, under the name this directory has always read it by. */
export const MECHANISM_PROOFS: readonly MechanismEvidence[] = MECHANISM_EVIDENCE;

/** The window: today's lived day and the six before it. */
export const MECHANISM_DAYS = 7;

export type MechanismStatus = "grey" | "green" | "waiting" | "amber";

export interface MechanismLight {
  readonly id: string;
  readonly family: Family;
  /** How much of it is built: the pill's tag (none / "partly built"). */
  readonly build: Build;
  readonly status: MechanismStatus;
  /** One plain-English line. */
  readonly evidence: string;
  /** The newest few event `seq`s that back a green light. Empty otherwise. */
  readonly events: readonly number[];
  /** A scheduled mechanism's next run, in lived days (0 = at the next session's end). */
  readonly nextInDays: number | null;
  /**
   * The panel's one big number about us (home round 3b, 2026-09-27 — a try):
   * one part of the evidence line, "16" + "memories a matching mood brought
   * closer this week". Null for a mechanism that is not built.
   */
  readonly lead: Lead | null;
  /**
   * Times it fired TODAY, the person's calendar day (`MechanismsView.today`):
   * rows that proved it, not amounts, a dream's rows once
   * (`mechanism-evidence.ts#Verdict.firedToday`). The sidebar's "Mechanisms
   * today" bars (2026-10-10). Null when not built.
   */
  readonly firedToday: number | null;
}

/** One number and a few words. */
export interface Lead {
  readonly n: number;
  readonly words: string;
}

export interface MechanismsView {
  readonly livedDay: number;
  /** The first lived day inside the window. */
  readonly fromDay: number;
  readonly days: number;
  /** The person's calendar day, `YYYY-MM-DD` (`store.today()`): the day each light's `firedToday` counts. */
  readonly today: string;
  readonly mechanisms: readonly MechanismLight[];
  /** A read hit its ceiling, so some counts are floors. */
  readonly truncated: boolean;
}

const plural = (n: number, says: readonly [string, string]): string => `${n} ${n === 1 ? says[0] : says[1]}`;

/** "in 2 lived days" / "at the next session's end". */
export function nextRunWords(nextInDays: number): string {
  if (nextInDays <= 0) return "at the next session's end";
  return `in ${nextInDays} lived ${nextInDays === 1 ? "day" : "days"}`;
}

/** Returns in the window, by source (`store.returnCounts`; `legacy` rows are never among them). */
export interface ReturnsBySource {
  readonly awake: number;
  readonly dream: number;
}

/**
 * THE RETURNS PART, SPLIT (2026-09-27, home round 3 — a try): "33 returns"
 * beside candidates that each "came back on 0 days" read as a contradiction,
 * because the core lanes count only a return in conversation and most of the
 * 33 were dream replays. So the two are said apart, conversation first.
 */
export function returnWords(r: ReturnsBySource): string[] {
  const out: string[] = [];
  if (r.awake > 0) out.push(`${r.awake} came back in conversation`);
  if (r.dream > 0) out.push(`${r.dream} replayed in a dream`);
  return out;
}

/**
 * WHICH PART OF THE EVIDENCE IS THE BIG NUMBER, per mechanism: the first
 * candidate whose count is above zero, else the first one at zero. A candidate
 * sums the named parts. `awake`/`dream` are the returns part said by source
 * (`returnWords`), `held` is what the mechanism holds; `week` adds "this week"
 * (the window: the same seven lived days as the headline's "active this week").
 * Only the words are the dashboard's — the counts are the shared table's.
 */
interface LeadCandidate {
  readonly keys: readonly string[];
  readonly says: readonly [string, string];
  readonly week: boolean;
}
const lead = (keys: readonly string[], one: string, many: string, week = true): LeadCandidate => ({ keys, says: [one, many], week });
export const LEADS: Readonly<Record<string, readonly LeadCandidate[]>> = {
  salience: [lead(["deposit", "chunk"], "memory scored as it was written", "memories scored as they were written")],
  emotional: [
    lead(["moodMatched"], "memory a matching mood brought closer", "memories a matching mood brought closer"),
    lead(["weighted"], "new memory held higher for its feeling", "new memories held higher for their feeling"),
  ],
  // Below reach first, then exits, apart (2026-10-10, review 03 C3): below
  // reach is a state now; an exit is archived.
  decay: [
    lead(["belowReach"], "memory below reach now", "memories below reach now", false),
    lead(["pruned"], "memory exited (archived)", "memories exited (archived)"),
    lead(["faded"], "memory faded a band", "memories faded a band"),
    lead(["cards"], "unused card faded", "unused cards faded"),
  ],
  retrieval: [
    lead(["turns"], "turn brought memories to mind", "turns brought memories to mind"),
    lead(["lookups"], "deliberate look-up", "deliberate look-ups"),
  ],
  // What links brought to mind first; what was laid when nothing reached recall (2026-10-11).
  association: [lead(["reached"], "memory a link brought to mind", "memories links brought to mind"), lead(["links", "replayed"], "link laid", "links laid")],
  prospective: [
    lead(["plain", "quiet"], "reminder came back", "reminders came back"),
    lead(["held"], "dated memory held", "dated memories held", false),
  ],
  // Returns are counted as returns, not memories: one memory can come back on two days.
  consolidation: [
    lead(["awake"], "came back in conversation", "came back in conversation"),
    lead(["promoted"], "memory became core", "memories became core"),
    lead(["merged", "dreamMerged"], "memory merged", "memories merged"),
    lead(["dream"], "replayed in a dream", "replayed in a dream"),
  ],
  dreaming: [
    lead(["changes"], "change a dream made", "changes dreams made"),
    lead(["dreams"], "dream", "dreams"),
  ],
  reconsolidation: [
    lead(["pressure"], "correction weighed against an old memory", "corrections weighed against old memories"),
    lead(["settled"], "contradiction settled", "contradictions settled"),
  ],
  interference: [
    lead(["dreamMerged"], "near-copy merged in a dream", "near-copies merged in a dream"),
    lead(["flagged"], "pair that disagrees flagged", "pairs that disagree flagged"),
    lead(["faded"], "earlier memory faded under a newer one", "earlier memories faded under newer ones"),
  ],
  "episodic-semantic": [lead(["gist"], "pattern dreamed into a memory of its own", "patterns dreamed into memories of their own")],
};

/** The big number, from a verdict's parts (and the returns split, and what it holds). */
export function leadOf(v: Verdict, returns?: ReturnsBySource): Lead | null {
  const candidates = LEADS[v.id];
  if (v.build === "not" || candidates === undefined || candidates.length === 0) return null;
  const counts = new Map<string, number>(v.parts.map((p) => [p.key, p.count]));
  if (returns !== undefined) {
    counts.set("awake", returns.awake);
    counts.set("dream", returns.dream);
  }
  if (v.held !== null) counts.set("held", v.held);
  const sum = (c: LeadCandidate): number => c.keys.reduce((t, k) => t + (counts.get(k) ?? 0), 0);
  const pick = candidates.find((c) => sum(c) > 0) ?? candidates[0]!;
  const n = sum(pick);
  return { n, words: (n === 1 ? pick.says[0] : pick.says[1]) + (pick.week ? " this week" : "") };
}

/** One verdict → one light, in the dashboard's words. With `returns`, a
 *  mechanism's returns part is said by source (`returnWords`). */
export function lightOf(v: Verdict, returns?: ReturnsBySource): MechanismLight {
  const row = MECHANISM_EVIDENCE.find((m) => m.id === v.id);
  const base = {
    id: v.id,
    family: v.family,
    build: v.build,
    nextInDays: v.schedule?.nextInDays ?? null,
    lead: leadOf(v, returns),
    firedToday: v.firedToday,
  };
  if (v.build === "not" || row === undefined) {
    return { ...base, status: "grey", evidence: row?.grey ?? "Not built yet.", events: [] };
  }
  const heldLine = row.held === undefined || v.held === null ? "" : ` ${plural(v.held, row.held.says)}.`;
  if (v.fired) {
    const said = v.parts
      .filter((p) => p.count > 0)
      .flatMap((p) => (p.key === "returns" && returns !== undefined ? returnWords(returns) : [plural(p.count, p.says)]));
    const todayLine = v.today === null ? "" : ` ${v.today} today.`;
    return {
      ...base,
      status: "green",
      evidence: `${said.join(", ")} in the last ${MECHANISM_DAYS} lived days.${todayLine}${heldLine}`,
      events: v.events,
    };
  }
  // STARVED (2026-10-11, Group 4): it worked and changed nothing — amber, and said.
  if (v.starved !== undefined) {
    const said = v.parts.filter((p) => p.count > 0).map((p) => plural(p.count, p.says));
    const missing = v.parts.find((p) => p.key === v.starved);
    const none = missing === undefined ? "" : `, but no ${missing.says[0]}`;
    return { ...base, status: "amber", evidence: `${said.join(", ")} in the last ${MECHANISM_DAYS} lived days${none}.${heldLine}`, events: v.events };
  }
  // YOUNG (reviewer of #423): the same, on a store too new to expect it — waiting, in plain words.
  if (v.young !== undefined) {
    const said = v.parts.filter((p) => p.count > 0).map((p) => plural(p.count, p.says));
    const missing = v.parts.find((p) => p.key === v.young);
    const none = missing === undefined ? "" : ` No ${missing.says[0]} yet; that takes a few weeks of use.`;
    return { ...base, status: "waiting", evidence: `${said.join(", ")} in the last ${MECHANISM_DAYS} lived days.${none}${heldLine}`, events: v.events };
  }
  if (row.held !== undefined && v.held === 0) {
    return { ...base, status: "waiting", evidence: row.held.none, events: [] };
  }
  if (v.schedule !== null && v.schedule.onTime && v.schedule.lastRanDay !== null) {
    return {
      ...base,
      status: "waiting",
      evidence:
        `Ran on schedule on lived day ${v.schedule.lastRanDay} with nothing to change; ` +
        `next run ${nextRunWords(v.schedule.nextInDays)}.`,
      events: [],
    };
  }
  const evidence =
    v.lastFiredDay === null
      ? `Built, and no record of it firing yet.`
      : `Built, but quiet for ${MECHANISM_DAYS} lived days (last fired on lived day ${v.lastFiredDay}).`;
  return { ...base, status: "amber", evidence: `${evidence}${heldLine}`, events: [] };
}

export function mechanismsView(src: DashboardSource): MechanismsView {
  const store = src.store;
  let livedDay = 0;
  try {
    livedDay = store.livedDay();
  } catch {
    livedDay = 0;
  }
  const fromDay = Math.max(0, livedDay - (MECHANISM_DAYS - 1));
  // "Today" for `firedToday` is the person's calendar day, not the lived day:
  // a lived day can start after midnight (at the day's first sleep), and the
  // sidebar's "Mechanisms today" means the date on the clock. The window's
  // seven lived days always reach back past the start of it.
  const today = store.today();
  const zone = store.zone();
  const { verdicts, truncated } = mechanismEvidence(store, {
    sinceDay: fromDay,
    today: livedDay,
    isToday: (row) => localDate(row.at, zone) === today,
  });
  const r = store.returnCounts({ sinceDay: fromDay });
  const returns: ReturnsBySource = { awake: r.awake, dream: r.dream };
  return { livedDay, fromDay, days: MECHANISM_DAYS, today, mechanisms: verdicts.map((v) => lightOf(v, returns)), truncated };
}
