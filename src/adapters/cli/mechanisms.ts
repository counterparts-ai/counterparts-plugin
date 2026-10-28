/**
 * `mechanisms` — the short answer to "is my memory working?", one line per
 * memory mechanism the site names.
 *
 * **Why it exists** (2026-09-25). The owner ran `counterparts fired` and got 57
 * rows mixing the eleven mechanisms with plumbing, sorted by state, in code
 * words — and rows like "NEVER: a copy of the store could not be made" read as
 * alarms when they are good news. This view is the page a regular user reads;
 * `--all` still prints the full `fired` report, unchanged, for the diagnosis.
 *
 * **Whether a mechanism fired is not this file's call** (2026-09-26, an
 * experiment). It asks `mechanism-evidence.ts`, the one judgement the dashboard's
 * lights ask too, so the two can no longer disagree about which rows count. The
 * WORDS and the WINDOW stay this console's own: seven calendar days, the same
 * window the `fired` report counts over, and its own phrasing.
 *
 * The plumbing line still reads the `fired` report's rows.
 *
 * The truth per mechanism is `docs/research/mechanism-audit-2026-09-24.md`.
 */
import type { EventRow, ReadOnlyStore } from "../../core/store/index.js";
// The settled-things measure's three borrowed rules: one reader of what a row
// was made from, the token cosine `updates` and the reflection use, and the
// reflection's negation test beside its same-claim bar.
import { derivedFrom } from "../../core/fit/index.js";
import { tokenize } from "../../core/store/cache.js";
import { negationDiffers } from "../../core/dream/reflect.js";
import { TUNABLES as SCHEMAS_TUNABLES } from "../../core/schemas/tunables.js";
import { addDays, startOfLocalDay } from "../../core/time.js";
import { FIRED_DAYS, daysBefore, rowDate } from "../fired.js";
import type { FiredReport, FiredRow } from "../fired.js";
import { mechanismEvidence, payloadOf } from "../mechanism-evidence.js";
import type { EvidenceWindow, Verdict } from "../mechanism-evidence.js";

/** The three lights. */
export const LIGHT = {
  working: "●",
  idle: "◐",
  notBuilt: "○",
} as const;
export type Light = (typeof LIGHT)[keyof typeof LIGHT];

export type Group = "Encoding" | "Storage" | "Retrieval" | "Transformation";

/** The `fired` report's rows, by `MECHANISMS` id — for totals the words carry. */
type Rows = (id: string) => FiredRow | undefined;

export interface MemoryMechanism {
  readonly name: string;
  readonly group: Group;
  /** The `mechanism-evidence.ts` id whose verdict decides the light. */
  readonly id: string;
  /** `MECHANISMS` ids this line accounts for — kept off the plumbing line. */
  readonly evidence: readonly string[];
  /** The light and one plain line, from the shared verdict (and the report's
   *  totals, for the words only). */
  readonly read: (v: Verdict, rows: Rows) => { light: Light; says: string };
}

/** A proof's count inside the window, summed over the named keys. */
function part(v: Verdict, ...keys: string[]): number {
  let n = 0;
  for (const p of v.parts) if (keys.includes(p.key)) n += p.count;
  return n;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * THE CONSOLE'S WINDOW: seven CALENDAR days, today included, in the store's
 * zone — the same window the `fired` report counts over. The lived-day bound
 * only keeps the read cheap (a lived day is never longer than a calendar day).
 * A census has no row to date and counts from its bound alone, so it is given
 * the dashboard's: seven lived days, today included (2026-10-26, review of
 * #629 — at `- 7` a belief born eight lived days back lit the console's
 * Schemas row while the dashboard and `fired` called it quiet).
 */
export function calendarWindow(store: ReadOnlyStore, today: string): EvidenceWindow {
  let livedDay = 0;
  try {
    livedDay = store.livedDay();
  } catch {
    livedDay = 0;
  }
  const from = daysBefore(today, FIRED_DAYS - 1);
  const zone = store.zone();
  return {
    sinceDay: Math.max(0, livedDay - FIRED_DAYS),
    censusSinceDay: Math.max(0, livedDay - (FIRED_DAYS - 1)),
    today: livedDay,
    contains: (row: EventRow) => {
      const date = rowDate(row, payloadOf(row), zone);
      return date >= from && date <= today;
    },
  };
}

/** The shared verdicts over the console's window. */
export function consoleVerdicts(store: ReadOnlyStore, today: string): Verdict[] {
  return mechanismEvidence(store, calendarWindow(store, today)).verdicts;
}

/**
 * THE TWELVE (Dreaming joined the eleven on 2026-09-26, beside Consolidation),
 * in the site's four groups and its order. Whether each one fired
 * is `mechanism-evidence.ts`'s call, shared with the dashboard; the words are
 * this console's own.
 */
export const MEMORY_MECHANISMS: readonly MemoryMechanism[] = [
  // ── Encoding ──
  {
    name: "Salience",
    group: "Encoding",
    id: "salience",
    evidence: ["deposit", "chunk-gate"],
    read: (v) => {
      const n = part(v, "deposit", "chunk");
      return v.fired
        ? { light: LIGHT.working, says: `${plural(n, "memory", "memories")} written and scored` }
        : { light: LIGHT.idle, says: "built, not firing yet: no memories written this week" };
    },
  },
  {
    name: "Emotion",
    group: "Encoding",
    id: "emotional",
    evidence: ["feelings", "emotion-weight", "mood-match"],
    // Emotion part A (2026-09-26): a memory's strongest feeling lifts it and
    // slows its fading. Since 2026-10-14 it fires when a memory is saved with
    // a feeling or one carrying a feeling comes to mind; the mood match (off
    // by decision since 2026-10-10) is said only when it counted.
    read: (v, rows) => {
      const weighted = rows("emotion-weight")?.total ?? 0;
      const withFeelings = rows("feelings")?.total ?? 0;
      const felt = part(v, "felt");
      const feltRecalled = part(v, "feltRecalled");
      const newWeighted = part(v, "weighted");
      const matched = part(v, "moodMatched");
      const held = `${plural(weighted, "memory", "memories")} held higher and fading slower (${String(withFeelings)} with recorded feelings)`;
      if (v.fired) {
        const parts: string[] = [];
        // Saved with a feeling and new memories carrying one overlap: the first is said when it counted.
        if (felt > 0) parts.push(`${plural(felt, "memory", "memories")} saved with a feeling`);
        else if (newWeighted > 0) parts.push(`${plural(newWeighted, "new memory", "new memories")} carrying feeling`);
        if (feltRecalled > 0) parts.push(`${plural(feltRecalled, "turn", "turns")} brought one carrying a feeling to mind`);
        if (matched > 0) parts.push(`${plural(matched, "memory", "memories")} a matching mood brought closer`);
        return { light: LIGHT.working, says: `${parts.join("; ")}; ${held}` };
      }
      return {
        light: LIGHT.idle,
        says:
          weighted > 0
            ? `built, not firing yet this week: ${held}`
            : "built, not firing yet: no memory carries a feeling",
      };
    },
  },
  // ── Storage ──
  {
    name: "Forgetting",
    group: "Storage",
    id: "decay",
    evidence: ["decay", "prune", "fade", "sleep-cycle"],
    read: (v) => {
      if (!v.fired) return { light: LIGHT.idle, says: "built, not firing yet: nothing faded this week" };
      const letGo = part(v, "pruned");
      const dropped = part(v, "faded");
      const cards = part(v, "cards");
      const below = part(v, "belowReach");
      const parts: string[] = [];
      // Below reach and exited, counted apart (2026-10-10, review 03 C3).
      if (below > 0) parts.push(`${plural(below, "memory", "memories")} below reach now`);
      if (letGo > 0) parts.push(`${plural(letGo, "memory", "memories")} exited (archived at the floor)`);
      if (dropped > 0) parts.push(`${plural(dropped, "memory", "memories")} faded a band`);
      if (cards > 0) parts.push("unused names faded");
      if (letGo === 0) parts.push("nothing at the floor yet");
      return { light: LIGHT.working, says: parts.join("; ") };
    },
  },
  {
    name: "Interference",
    group: "Storage",
    id: "interference",
    evidence: ["dream-changes", "contradictions"],
    read: (v) => {
      const merged = part(v, "dreamMerged");
      const folded = part(v, "folded");
      const flagged = part(v, "flagged");
      const proposed = part(v, "proposed");
      const faded = part(v, "faded");
      const said = [
        ...(merged > 0 ? [`${plural(merged, "near-copy", "near-copies")} merged in a dream`] : []),
        ...(folded > 0 ? [`${plural(folded, "fold")} in a dream`] : []),
        ...(flagged > 0 ? [`${plural(flagged, "pair")} that disagree flagged`] : []),
        ...(proposed > 0 ? [`${plural(proposed, "memory", "memories")} read as the newer state of an older one`] : []),
        ...(faded > 0 ? [`${plural(faded, "earlier memory", "earlier memories")} faded under a newer one`] : []),
      ];
      return v.fired && said.length > 0
        ? { light: LIGHT.working, says: `partly built: ${said.join("; ")}` }
        : { light: LIGHT.idle, says: "partly built, not firing this week: similar memories meet in a dream and when a new one reads as the newer state of an older one; they do not compete at recall yet" };
    },
  },
  // ── Retrieval ──
  {
    name: "Retrieval",
    group: "Retrieval",
    id: "retrieval",
    evidence: ["recall-decision", "credit"],
    read: (v) => {
      if (!v.fired) return { light: LIGHT.idle, says: "built, not firing yet: nothing came to mind this week" };
      const turns = part(v, "turns");
      const lookups = part(v, "lookups");
      const credited = part(v, "credited");
      const parts: string[] = [];
      if (turns > 0) parts.push(`${plural(turns, "turn")} brought memories to mind`);
      if (lookups > 0) parts.push(plural(lookups, "deliberate look-up"));
      parts.push(
        credited > 0
          ? `${plural(credited, "memory", "memories")} used and strengthened`
          : "nothing used yet, so nothing strengthened",
      );
      return { light: LIGHT.working, says: parts.join("; ") };
    },
  },
  {
    name: "Association",
    group: "Retrieval",
    id: "association",
    evidence: ["association-saved", "association"],
    read: (v, rows) => {
      // Links LAID, and memories links brought to mind (2026-10-11, Group 4):
      // laid with none reaching recall is not working yet.
      const saved = part(v, "links", "replayed");
      const reached = part(v, "reached");
      const held = rows("association")?.total ?? 0;
      if (v.fired) {
        return {
          light: LIGHT.working,
          says: `${plural(reached, "memory", "memories")} links brought to mind this week; ${plural(saved, "link")} laid; ${plural(held, "link")} held`,
        };
      }
      if (v.starved !== undefined) {
        return { light: LIGHT.idle, says: `${plural(saved, "link")} laid this week, but none brought a memory to mind (${plural(held, "link")} held)` };
      }
      if (v.young !== undefined) {
        return { light: LIGHT.working, says: `${plural(saved, "link")} laid this week; too early for one to bring a memory to mind (${plural(held, "link")} held)` };
      }
      return {
        light: LIGHT.idle,
        says:
          held > 0
            ? `built, not firing yet: no new links this week (${plural(held, "link")} held)`
            : "built, not firing yet: no links formed",
      };
    },
  },
  {
    name: "Prospective",
    group: "Retrieval",
    id: "prospective",
    evidence: ["prospective-dated", "prospective-fired", "prospective-plain"],
    // Built end to end since 2026-09-26. With nothing dated it is still built,
    // just holding nothing — so it is idle, never "not built" (2026-09-26).
    read: (v, rows) => {
      const dated = v.held ?? rows("prospective-dated")?.total ?? 0;
      const quiet = part(v, "quiet");
      const plain = part(v, "plain");
      const held = `${plural(dated, "dated memory", "dated memories")} held`;
      // A PLAIN REMINDER DUE AND NOT SAID (2026-10-09): the `fired` report's
      // occasion check, so "nothing due this week" is never said of a week
      // when something was due and went unsaid.
      const missed = rows("prospective-plain")?.occasionMissed ?? 0;
      const unsaid = missed > 0 ? `; ${plural(missed, "plain reminder")} due on a day a session ran and not said` : "";
      if (v.fired) {
        const parts: string[] = [];
        if (plain > 0) parts.push(`${String(plain)} said plainly`);
        if (quiet > 0) parts.push(`${String(quiet)} as quiet footnotes`);
        return {
          light: LIGHT.working,
          says: `${plural(quiet + plain, "reminder")} came back (${parts.join(", ")}); ${held}${unsaid}`,
        };
      }
      if (missed > 0) return { light: LIGHT.idle, says: `built, but not firing: ${held}${unsaid}` };
      return dated > 0
        ? { light: LIGHT.idle, says: `built, nothing due this week: ${held}` }
        : { light: LIGHT.idle, says: "built, nothing dated yet: a note with a date comes back around that day" };
    },
  },
  // ── Transformation ──
  {
    name: "Consolidation",
    group: "Transformation",
    id: "consolidation",
    evidence: ["sleep-cycle", "promotion", "dedup", "returns", "dream-replays", "core-demote", "upgrade-census"],
    read: (v) => {
      if (v.fired) {
        const parts: string[] = [];
        const returns = part(v, "returns");
        const promoted = part(v, "promoted");
        const merged = part(v, "merged") + part(v, "dreamMerged");
        const folded = part(v, "folded");
        const rose = part(v, "rose");
        if (returns > 0) parts.push(`${plural(returns, "return")} made memories fade more slowly`);
        if (promoted > 0) parts.push(`${plural(promoted, "memory", "memories")} became core`);
        if (merged > 0) parts.push(`${plural(merged, "near-copy", "near-copies")} merged`);
        if (folded > 0) parts.push(`${plural(folded, "fold")} in a dream`);
        if (rose > 0) parts.push(`${plural(rose, "memory", "memories")} settled a band higher`);
        return { light: LIGHT.working, says: parts.join("; ") };
      }
      const s = v.schedule;
      if (s !== null && s.onTime && s.lastRanDay !== null) {
        const next = s.nextInDays <= 0 ? "at the next session's end" : `in ${plural(s.nextInDays, "day of use", "days of use")}`;
        return { light: LIGHT.idle, says: `built, ran on schedule with nothing to change; next run ${next}` };
      }
      return { light: LIGHT.idle, says: "built, not firing yet: nothing consolidated this week" };
    },
  },
  {
    name: "Dreaming",
    group: "Transformation",
    id: "dreaming",
    evidence: ["dream", "dream-changes", "dream-ask"],
    read: (v) => {
      const dreams = part(v, "dreams");
      const changes = part(v, "changes");
      // Said apart from the changes: a nomination moves nothing until a lane promotes it awake.
      const suggestions = part(v, "suggestions");
      const made = [...(changes > 0 ? [plural(changes, "change")] : []), ...(suggestions > 0 ? [plural(suggestions, "core suggestion")] : [])];
      const reflections = part(v, "reflections");
      if (v.fired) {
        return {
          light: LIGHT.working,
          says: `${plural(dreams, "dream")} this week${made.length > 0 ? ` (${made.join(", ")})` : ""}${
            reflections > 0 ? `; ${plural(reflections, "reflection")} afterwards` : ""
          }`,
        };
      }
      return {
        light: LIGHT.idle,
        says:
          v.lastFiredDay === null
            ? "built, not firing yet: no dream yet (a session asks, once a day, and you say yes or not today)"
            : `built, not firing this week: the last dream was on day ${String(v.lastFiredDay)} of use`,
      };
    },
  },
  {
    name: "Reconsolidation",
    group: "Transformation",
    id: "reconsolidation",
    evidence: ["revision", "accommodation", "contradictions"],
    read: (v) => {
      const pressed = part(v, "pressure");
      const settled = part(v, "settled");
      const said = [
        ...(pressed > 0 ? [`${plural(pressed, "correction")} weighed against old memories`] : []),
        ...(settled > 0 ? [`${plural(settled, "contradiction")} settled`] : []),
      ];
      return v.fired && said.length > 0
        ? { light: LIGHT.working, says: said.join("; ") }
        : { light: LIGHT.idle, says: "built, not firing yet: nothing corrected or settled this week" };
    },
  },
  {
    name: "Schemas",
    group: "Transformation",
    id: "schema",
    // Built since wave 2 (0.3.31): the night's reflection forms beliefs about
    // me, us and the people and projects in play, adopts a dream's
    // candidates, and files the memories that back or go against them; a
    // session may form one about me awake. Read off the rows (the census).
    evidence: ["entity-birth", "belief-birth", "belief-support"],
    read: (v) => {
      const born = part(v, "born");
      const adopted = part(v, "adopted");
      const support = part(v, "support");
      const contrary = part(v, "contrary");
      const held = v.held === null ? "" : `; ${plural(v.held, "belief")} held`;
      if (v.fired) {
        const parts: string[] = [];
        if (born > 0) parts.push(`${plural(born, "belief")} formed`);
        if (adopted > 0) parts.push(`${plural(adopted, "belief")} adopted from a dream`);
        parts.push(`${plural(support, "memory", "memories")} filed as support (${String(contrary)} against)`);
        return { light: LIGHT.working, says: `${parts.join(", ")}${held}` };
      }
      return {
        light: LIGHT.idle,
        says:
          (v.held ?? 0) > 0
            ? `built, not firing this week: no belief formed and no memory filed for or against one${held}`
            : "built, not firing yet: no beliefs yet (the night's reflection forms one when lived memories back it)",
      };
    },
  },
  {
    name: "Gist",
    group: "Transformation",
    id: "episodic-semantic",
    evidence: ["gist"],
    // PARTLY (2026-09-26): a dream can write the pattern it sees as a gist.
    read: (v) =>
      v.fired
        ? { light: LIGHT.working, says: `${plural(part(v, "gist"), "pattern")} dreamed into a memory of its own` }
        : { light: LIGHT.idle, says: "partly built, not firing this week: only a dream writes a gist so far" },
  },
];

/** One line's reading: the shared verdict for its id, in the console's words. */
export function readMechanism(
  m: MemoryMechanism,
  verdicts: readonly Verdict[],
  rows: Rows,
): { light: Light; says: string } {
  const v = verdicts.find((x) => x.id === m.id);
  if (v === undefined) return { light: LIGHT.notBuilt, says: "not built yet" };
  return m.read(v, rows);
}

/**
 * THE PLUMBING ROWS WHOSE FIRING MEANS SOMETHING FAILED, with the words to say
 * it in. Every other plumbing row — a failure that never happened, an owner
 * action never taken, a part blind by design — is not a problem, and the one
 * line never makes it read like one.
 */
const TROUBLE: Readonly<Record<string, string>> = {
  "worker-trouble": "the background worker failed or was refused",
  "snapshot-trouble": "a copy of the store could not be made",
};

/** Every `MECHANISMS` id the eleven account for; the rest are plumbing. */
export function mechanismIds(): Set<string> {
  return new Set(MEMORY_MECHANISMS.flatMap((m) => m.evidence));
}

/** The plumbing line: how many parts ran this week, and only what failed. */
export function plumbingLine(report: FiredReport): string {
  const mine = mechanismIds();
  const plumbing = report.rows.filter((r) => !mine.has(r.id));
  const running = plumbing.filter((r) => r.state === "firing" && TROUBLE[r.id] === undefined).length;
  const failing: string[] = [];
  for (const r of plumbing) {
    const words = TROUBLE[r.id];
    // No count: some of these rows are latched one per reason per day, so a
    // number here would read as attempts and understate them.
    if (words !== undefined && r.firedInWindow > 0) failing.push(words);
  }
  const head = `Plumbing: ${plural(running, "part")} running`;
  return failing.length === 0
    ? `${head}, none failing.`
    : `${head}; failing this week: ${failing.join("; ")}.`;
}

/** The whole short view, as plain lines: one per mechanism in the site's four
 *  groups and order, then the plumbing in one line, then — when it was read —
 *  the settled-things line (`settledReading`). */
export function mechanismsLines(report: FiredReport, verdicts: readonly Verdict[], settled?: SettledReading): string[] {
  const byId = new Map(report.rows.map((r) => [r.id, r]));
  const rows: Rows = (id) => byId.get(id);
  const width = Math.max(...MEMORY_MECHANISMS.map((m) => m.name.length)) + 2;
  const lines = [`Memory mechanisms — last 7 days (${report.from} to ${report.today}, UTC)`, ""];
  if (report.young) {
    lines.push("This memory is new, so most of these have had nothing to do yet.", "");
  }
  for (const m of MEMORY_MECHANISMS) {
    const { light, says } = readMechanism(m, verdicts, rows);
    lines.push(`${light} ${m.name.padEnd(width)}${says}`);
  }
  lines.push(
    "",
    `${LIGHT.working} working this week  ${LIGHT.idle} built, not firing  ${LIGHT.notBuilt} not built yet`,
    plumbingLine(report),
    ...(settled === undefined ? [] : settledLines(settled)),
    "Every detail: counterparts mechanisms --all",
  );
  return lines;
}

// ── settled things: drawn on again, come up again, shown ───────────────────

/**
 * SETTLED THINGS DRAWN ON AGAIN (2026-10-22, lane R; a measure, lightly
 * held): how often a session draws on what was already corrected or changed,
 * or a settled question comes up again. Anthropic's suggestion for an eval
 * that does not saturate; read per window, per kind and per build, so a
 * release that shows beliefs in recall (wave 2 E) can be checked against the
 * one before.
 *
 * THE PAIRS (the denominator): every pair standing as settled `changed` or
 * `corrected` with both sides named (`holds`, `over`), whose standing settle
 * (a trail row not undone) happened before the window opened. An undone
 * settle leaves the pair unsettled, so it is not one of them. A FLIP-BACK —
 * a later standing pair where the old loser holds over the old winner — ends
 * the old pair from that moment: nothing after it counts against it, and a
 * pair flipped back before the window is not one of them.
 *
 * Each pair is read for what happened inside the window, on a lived day
 * after its settle day:
 * - DRAWN ON AGAIN (`repeats`) — the losing memory (`over`) drawn on: a
 *   `recall.credit` id earned `drewOn` or `quoted`; an id a session named in
 *   `drewOn` that was refused (it said it drew on it, whatever the credit
 *   made of that); a `recall.rated` score of 3 or `drewOn: true` (a rating is
 *   a use since 2026-10-19); or a memory a session wrote (`source =
 *   'authored'`) that cites it or is grounded in it (`fit/index.ts#derivedFrom`).
 *   `alone`: of the changed pairs, those drawn on in a row (a credit, a
 *   rating, a write) that did not carry the winner too — the one that looks
 *   like a mistake rather than history.
 * - CAME UP AGAIN (`reraised`) — a newer pair (not withdrawn) flagged on a
 *   later lived day that names the loser; or a memory born after the settle
 *   that says the loser again: token cosine at or above `BELIEF_SAME_CLAIM`
 *   (0.9, the reflection's same-claim bar), no negation added or removed, not
 *   made from either side by its meta, and nearer the loser than the winner
 *   (restating the winner is the settle holding, not the question back).
 * - THE WINNER IN A NEWER PAIR (`viaWinner`, beside, not counted as came up
 *   again) — a newer pair naming the winner where the winner is not the side
 *   that loses (the winner revised in turn — X, then Y, then Z — is the
 *   ordinary revision chain and is not counted at all).
 * - SHOWN ONLY — the loser shown (a `recall.decision` loud line or footnote,
 *   a `recall_turns` row, a rating below 3) or opened (an `expanded` credit),
 *   and not drawn on.
 *
 * BY BUILD: a row that carries JSON says its build at write time (#591):
 * event payloads and `memories.meta`; a row from before the stamp says none
 * (`pre-stamp`). A pair (no JSON column) and a `recall_turns` row take the
 * build that had the store on their lived day, from the build log. Each build
 * carries its exposure beside its counts — its recall turns in the window and
 * the lived days they fell on — so two builds' numbers can be read side by
 * side. A build's shown-only is what it showed and did not itself draw on.
 *
 * Ids only, never a body. Read-only: no row is written.
 */
export interface SettledExample {
  readonly pair: string;
  /** The losing memory. */
  readonly over: string;
  /** What showed it: an event (`ev:<seq>`), a recall turn, a memory id or a pair id. */
  readonly by: string;
}

export type SettledHow = "changed" | "corrected";

/** One kind's counts. `alone` only on the whole reading's `changed`. */
export interface SettledCounts {
  readonly pairs?: number;
  readonly repeats: number;
  readonly reraised: number;
  readonly viaWinner: number;
  readonly shownOnly: number;
  readonly alone?: number;
}

export interface SettledBucket {
  readonly build: string;
  readonly repeats: number;
  readonly reraised: number;
  readonly viaWinner: number;
  readonly shownOnly: number;
  readonly byHow: Readonly<Record<SettledHow, SettledCounts>>;
  /** The build's exposure in the window: its recall turns (`recall.decision` rows), and the lived days they fell on. */
  readonly turns: number;
  readonly days: number;
}

export interface SettledReading {
  /** The window's first and last calendar day; `from` null when the whole record was read. */
  readonly from: string | null;
  readonly to: string;
  readonly pairs: number;
  readonly repeats: number;
  /** Came up again: a newer pair naming the loser, or the loser said again. */
  readonly reraised: number;
  /** The winner in a newer pair, beside `reraised` and not in it. */
  readonly viaWinner: number;
  readonly shownOnly: number;
  readonly byHow: Readonly<Record<SettledHow, SettledCounts>>;
  /** Pairs counted by each way in (one pair may be counted under several). */
  readonly repeatVia: { readonly drewOn: number; readonly quoted: number; readonly rated: number; readonly cited: number };
  readonly reraisedVia: { readonly loser: number; readonly restated: number; readonly winner: number };
  /** Of `shownOnly`, the pairs whose loser was opened (an `expanded` credit). */
  readonly opened: number;
  /** Pairs left out because the old loser later held over the old winner before the window. */
  readonly flippedBack: number;
  readonly byBuild: readonly SettledBucket[];
  readonly examples: {
    readonly repeats: readonly SettledExample[];
    readonly reraised: readonly SettledExample[];
    readonly viaWinner: readonly SettledExample[];
    readonly shownOnly: readonly SettledExample[];
  };
}

/** The bucket of a row with no build of its own: written before the stamp (#591). */
export const PRE_STAMP = "pre-stamp";
const SETTLED_EXAMPLES = 5;

type SettledStore = Pick<
  ReadOnlyStore,
  "contradictions" | "contradictionSettles" | "eventLog" | "list" | "row" | "recallTurns" | "buildLog" | "livedDay" | "zone"
>;

interface SettledPair {
  readonly id: string;
  readonly how: SettledHow;
  readonly holds: string;
  readonly over: string;
  readonly settledDay: number;
  /** When a flip-back ended it (epoch ms); infinity when none did. */
  readonly endsAt: number;
}

function jsonObject(text: string | null | undefined): Record<string, unknown> {
  if (text === null || text === undefined) return {};
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Ids from a list of ids or of `{ id }` objects (a decision's loud lines and footnotes). */
function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.length > 0) out.push(x);
    else if (x !== null && typeof x === "object" && typeof (x as Record<string, unknown>)["id"] === "string") out.push((x as Record<string, string>)["id"] as string);
  }
  return out;
}

/**
 * `remember/updates.ts#similarity` — cosine over token counts, the store's one
 * tokenizer — with each text tokenized ONCE: the measure compares every memory
 * born in the window with every loser (1,498 × 231 on Mike's week), and
 * tokenizing both sides per pair took six seconds. Same numbers, same rule.
 */
function tokenCounts(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokenize(text)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function countsCosine(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [t, n] of a) {
    na += n * n;
    dot += n * (b.get(t) ?? 0);
  }
  for (const n of b.values()) nb += n * n;
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const xs = m.get(k);
  if (xs === undefined) m.set(k, [v]);
  else xs.push(v);
}

/**
 * Read the measure. `window` is calendar days ending `today` in the store's
 * zone (the console's seven); `"all"` reads the whole record — the harness:
 * every settled pair, everything after its settle day.
 */
export function settledReading(store: SettledStore, today: string, window: number | "all" = FIRED_DAYS): SettledReading {
  const all = window === "all";
  const from = all ? null : daysBefore(today, window - 1);
  const zone = store.zone();
  const startAt = from === null ? Number.NEGATIVE_INFINITY : startOfLocalDay(from, zone);
  const endAt = all ? Number.POSITIVE_INFINITY : startOfLocalDay(addDays(today, 1), zone);
  let livedNow = 0;
  try {
    livedNow = store.livedDay();
  } catch {
    livedNow = 0;
  }
  // A lived day is never shorter than a calendar day: this bound only keeps the reads cheap.
  const sinceDay = all ? 0 : Math.max(0, livedNow - (window + 1));
  const inWindow = (at: number | null | undefined): boolean => typeof at === "number" && at >= startAt && at < endAt;

  // THE PAIRS: settled changed|corrected, both sides named, a standing settle.
  const standing = new Map<string, number>();
  for (const s of store.contradictionSettles({ limit: Number.MAX_SAFE_INTEGER })) {
    if (s.action === "settle" && s.undone === 0) standing.set(s.pair_id, s.at);
  }
  const settledRows = store
    .contradictions({ state: "settled", limit: Number.MAX_SAFE_INTEGER })
    .filter((c) => (c.how === "changed" || c.how === "corrected") && c.holds !== null && c.over !== null && c.settled_day !== null && standing.has(c.id));
  // A FLIP-BACK: the old loser holding over the old winner, settled later, ends the old pair then.
  const heldOver = new Map<string, number[]>();
  for (const c of settledRows) pushTo(heldOver, `${c.holds ?? ""}>${c.over ?? ""}`, standing.get(c.id) ?? 0);
  const pairs: SettledPair[] = [];
  let flippedBack = 0;
  for (const c of settledRows) {
    const at = standing.get(c.id) ?? 0;
    // The whole record reads every standing pair; a window, those standing when it opened.
    if (!all && at >= startAt) continue;
    const flips = (heldOver.get(`${c.over ?? ""}>${c.holds ?? ""}`) ?? []).filter((t) => t > at);
    const endsAt = flips.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...flips);
    if (endsAt < startAt) {
      flippedBack += 1;
      continue;
    }
    pairs.push({ id: c.id, how: c.how as SettledHow, holds: c.holds ?? "", over: c.over ?? "", settledDay: c.settled_day ?? 0, endsAt });
  }
  const byLoser = new Map<string, SettledPair[]>();
  const byMember = new Map<string, SettledPair[]>();
  for (const p of pairs) {
    pushTo(byLoser, p.over, p);
    pushTo(byMember, p.holds, p);
    pushTo(byMember, p.over, p);
  }

  // The build that had the store on a lived day, for rows with no JSON of their own.
  let log: { build: string; since: number }[] = [];
  try {
    log = store.buildLog().flatMap((l) => (l.since === null ? [] : [{ build: l.build, since: l.since }]));
  } catch {
    log = [];
  }
  const buildOnDay = (day: number): string => {
    let b = PRE_STAMP;
    for (const l of log) if (l.since <= day) b = l.build;
    return b;
  };
  const buildOf = (said: unknown): string => (typeof said === "string" && said.length > 0 ? said : PRE_STAMP);

  type HitKind = "repeat" | "reraise" | "winner" | "shown";
  type Via = "drewOn" | "quoted" | "rated" | "cited" | "loser" | "restated" | "opened";
  interface Hit {
    readonly build: string;
    readonly by: string;
    /** A repeat in a row that did not carry the winner too. */
    readonly alone: boolean;
  }
  const hits: Record<HitKind, Map<string, Hit[]>> = { repeat: new Map(), reraise: new Map(), winner: new Map(), shown: new Map() };
  const exposure = new Map<string, { turns: number; days: Set<number> }>();
  const via: Record<Via, Set<string>> = {
    drewOn: new Set(),
    quoted: new Set(),
    rated: new Set(),
    cited: new Set(),
    loser: new Set(),
    restated: new Set(),
    opened: new Set(),
  };
  const hit = (kind: HitKind, p: SettledPair, at: number, build: string, by: string, how?: Via, alone = false): void => {
    if (at >= p.endsAt) return;
    pushTo(hits[kind], p.id, { build, by, alone });
    if (how !== undefined) via[how].add(p.id);
  };
  /** A row naming `id` on lived day `day` at `at`; `withIds` is every id the same row names (for `alone`). */
  const loserHit = (kind: HitKind, id: string, day: number, at: number, build: string, by: string, how?: Via, withIds?: ReadonlySet<string>): void => {
    for (const p of byLoser.get(id) ?? []) if (day > p.settledDay) hit(kind, p, at, build, by, how, withIds !== undefined && !withIds.has(p.holds));
  };
  const events = (name: string): EventRow[] => {
    try {
      return store.eventLog({ name, sinceDay, limit: Number.MAX_SAFE_INTEGER }).filter((e) => inWindow(e.at));
    } catch {
      return [];
    }
  };

  if (pairs.length > 0) {
    for (const e of events("recall.credit")) {
      const p = jsonObject(e.payload);
      const build = buildOf(p["build"]);
      const by = `ev:${String(e.seq)}`;
      const how = Array.isArray(p["how"]) ? (p["how"] as unknown[]) : [];
      const drewOnRow = p["source"] === "drewOn";
      const ids = idList(p["ids"]);
      const refused = drewOnRow ? idList(p["refusedIds"]) : [];
      const named = new Set([...ids, ...refused]);
      ids.forEach((id, i) => {
        const h = drewOnRow ? "drewOn" : how[i];
        if (h === "drewOn") loserHit("repeat", id, e.day, e.at, build, by, "drewOn", named);
        else if (h === "quoted") loserHit("repeat", id, e.day, e.at, build, by, "quoted", named);
        else loserHit("shown", id, e.day, e.at, build, by, "opened");
      });
      for (const id of refused) loserHit("repeat", id, e.day, e.at, build, by, "drewOn", named);
    }
    for (const e of events("recall.rated")) {
      const p = jsonObject(e.payload);
      const build = buildOf(p["build"]);
      const ratings = (Array.isArray(p["ratings"]) ? (p["ratings"] as unknown[]) : []).filter(
        (r): r is Record<string, unknown> => r !== null && typeof r === "object" && typeof (r as Record<string, unknown>)["id"] === "string",
      );
      const named = new Set(ratings.map((o) => o["id"] as string));
      for (const o of ratings) {
        const id = o["id"] as string;
        if (o["score"] === 3 || o["drewOn"] === true) loserHit("repeat", id, e.day, e.at, build, `ev:${String(e.seq)}`, "rated", named);
        else loserHit("shown", id, e.day, e.at, build, `ev:${String(e.seq)}`);
      }
    }
    for (const e of events("recall.decision")) {
      const p = jsonObject(e.payload);
      const build = buildOf(p["build"]);
      // Each build's exposure: its recall turns in the window, and the lived days they fell on.
      const x = exposure.get(build) ?? { turns: 0, days: new Set<number>() };
      x.turns += 1;
      x.days.add(e.day);
      exposure.set(build, x);
      for (const id of [...idList(p["surfaced"]), ...idList(p["footnotes"])]) loserHit("shown", id, e.day, e.at, build, `ev:${String(e.seq)}`);
    }
    try {
      for (const t of store.recallTurns({ sinceDay })) {
        if (!inWindow(t.at)) continue;
        let shown: unknown = [];
        try {
          shown = JSON.parse(t.shown);
        } catch {
          shown = [];
        }
        for (const id of idList(shown)) loserHit("shown", id, t.day, t.at, buildOnDay(t.day), `turn:${t.session_id}#${String(t.turn)}`);
      }
    } catch {
      /* a store before v14 keeps no per-turn rows: the decision rows above stand */
    }

    // Newer pairs naming either side.
    for (const n of store.contradictions({ limit: Number.MAX_SAFE_INTEGER })) {
      if (n.state === "withdrawn" || !inWindow(n.created_at)) continue;
      const seen = new Set<string>();
      for (const m of [n.a, n.b]) {
        for (const p of byMember.get(m) ?? []) {
          if (p.id === n.id || seen.has(p.id) || n.flagged_day <= p.settledDay) continue;
          const loser = n.a === p.over || n.b === p.over;
          // The winner revised in turn is the chain going on, not the question back.
          if (!loser && n.over === p.holds) continue;
          seen.add(p.id);
          if (loser) hit("reraise", p, n.created_at, buildOnDay(n.flagged_day), n.id, "loser");
          else hit("winner", p, n.created_at, buildOnDay(n.flagged_day), n.id);
        }
      }
    }

    // Memories born in the window: a session citing a loser, or a loser said again.
    const text = new Map<string, { body: string; counts: Map<string, number> } | null>();
    const textOf = (id: string): { body: string; counts: Map<string, number> } | null => {
      if (!text.has(id)) {
        const row = store.row(id);
        text.set(id, row === undefined || row.body.length === 0 ? null : { body: row.body, counts: tokenCounts(row.body) });
      }
      return text.get(id) ?? null;
    };
    const losers: { id: string; body: string; counts: Map<string, number> }[] = [];
    for (const id of byLoser.keys()) {
      const t = textOf(id);
      if (t !== null) losers.push({ id, ...t });
    }
    let born: string[] = [];
    try {
      born = store.list({ bornFromDay: sinceDay });
    } catch {
      born = [];
    }
    for (const id of born) {
      const row = store.row(id);
      if (row === undefined || !inWindow(row.created_at) || row.type === "episode" || row.source === "episode") continue;
      const at = row.created_at ?? 0;
      const build = buildOf(jsonObject(row.meta)["build"]);
      const made = derivedFrom(row);
      const madeFrom = new Set(made.map((d) => d.id));
      if (row.source === "authored") {
        for (const d of made) if (d.how === "cites" || d.how === "grounded-in") loserHit("repeat", d.id, row.birth_day, at, build, id, "cited", madeFrom);
      }
      if (row.body.length === 0) continue;
      const counts = tokenCounts(row.body);
      for (const l of losers) {
        if (l.id === id || madeFrom.has(l.id)) continue;
        const toLoser = countsCosine(counts, l.counts);
        if (toLoser < SCHEMAS_TUNABLES.BELIEF_SAME_CLAIM || negationDiffers(row.body, l.body)) continue;
        for (const p of byLoser.get(l.id) ?? []) {
          if (row.birth_day <= p.settledDay || p.holds === id || madeFrom.has(p.holds)) continue;
          // Saying the WINNER again is the settle holding, not the question back.
          const winner = textOf(p.holds);
          if (winner !== null && countsCosine(counts, winner.counts) >= toLoser) continue;
          hit("reraise", p, at, build, id, "restated");
        }
      }
    }
  }

  const kindOf = new Map(pairs.map((p) => [p.id, p.how]));
  const repeated = new Set(hits.repeat.keys());
  const shownOnly = new Set([...hits.shown.keys()].filter((id) => !repeated.has(id)));
  const aloneChanged = new Set([...hits.repeat].filter(([id, xs]) => kindOf.get(id) === "changed" && xs.some((x) => x.alone)).map(([id]) => id));
  const countOf = (ids: Iterable<string>, how: SettledHow): number => [...ids].filter((id) => kindOf.get(id) === how).length;
  const kinds = (sets: { repeats: Iterable<string>; reraised: Iterable<string>; winner: Iterable<string>; shown: Iterable<string> }, withPairs: boolean): Record<SettledHow, SettledCounts> => {
    const one = (how: SettledHow): SettledCounts => ({
      ...(withPairs ? { pairs: pairs.filter((p) => p.how === how).length } : {}),
      repeats: countOf(sets.repeats, how),
      reraised: countOf(sets.reraised, how),
      viaWinner: countOf(sets.winner, how),
      shownOnly: countOf(sets.shown, how),
      ...(withPairs && how === "changed" ? { alone: aloneChanged.size } : {}),
    });
    return { changed: one("changed"), corrected: one("corrected") };
  };

  const order = [PRE_STAMP, ...log.map((l) => l.build)];
  interface Bucket {
    repeats: Set<string>;
    reraised: Set<string>;
    winner: Set<string>;
    shown: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  const bucket = (b: string): Bucket => {
    let s = buckets.get(b);
    if (s === undefined) {
      s = { repeats: new Set(), reraised: new Set(), winner: new Set(), shown: new Set() };
      buckets.set(b, s);
    }
    return s;
  };
  for (const b of exposure.keys()) bucket(b);
  for (const [pair, xs] of hits.repeat) for (const x of xs) bucket(x.build).repeats.add(pair);
  for (const [pair, xs] of hits.reraise) for (const x of xs) bucket(x.build).reraised.add(pair);
  for (const [pair, xs] of hits.winner) for (const x of xs) bucket(x.build).winner.add(pair);
  for (const [pair, xs] of hits.shown) for (const x of xs) bucket(x.build).shown.add(pair);
  const rank = (b: string): number => (order.includes(b) ? order.indexOf(b) : order.length);
  const byBuild = [...buckets.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([build, s]) => {
      // A build's shown-only: what it showed and did not itself draw on.
      const shown = [...s.shown].filter((id) => !s.repeats.has(id));
      return {
        build,
        repeats: s.repeats.size,
        reraised: s.reraised.size,
        viaWinner: s.winner.size,
        shownOnly: shown.length,
        byHow: kinds({ repeats: s.repeats, reraised: s.reraised, winner: s.winner, shown }, false),
        turns: exposure.get(build)?.turns ?? 0,
        days: exposure.get(build)?.days.size ?? 0,
      };
    });
  const loserOf = new Map(pairs.map((p) => [p.id, p.over]));
  const examples = (kind: HitKind, keep: (id: string) => boolean): SettledExample[] =>
    [...hits[kind].entries()]
      .filter(([id]) => keep(id))
      .slice(0, SETTLED_EXAMPLES)
      .map(([pair, xs]) => ({ pair, over: loserOf.get(pair) ?? "", by: xs[0]?.by ?? "" }));
  return {
    from,
    to: today,
    pairs: pairs.length,
    repeats: repeated.size,
    reraised: hits.reraise.size,
    viaWinner: hits.winner.size,
    shownOnly: shownOnly.size,
    byHow: kinds({ repeats: repeated, reraised: hits.reraise.keys(), winner: hits.winner.keys(), shown: shownOnly }, true),
    repeatVia: { drewOn: via.drewOn.size, quoted: via.quoted.size, rated: via.rated.size, cited: via.cited.size },
    reraisedVia: { loser: via.loser.size, restated: via.restated.size, winner: hits.winner.size },
    opened: [...via.opened].filter((id) => shownOnly.has(id)).length,
    flippedBack,
    byBuild,
    examples: {
      repeats: examples("repeat", () => true),
      reraised: examples("reraise", () => true),
      viaWinner: examples("winner", () => true),
      shownOnly: examples("shown", (id) => shownOnly.has(id)),
    },
  };
}

/** The console's line, and the split by build when any build said anything. Pure. */
export function settledLines(r: SettledReading): string[] {
  if (r.pairs === 0) {
    return [`Settled things drawn on again: nothing was settled before ${r.from === null ? "the record ended" : "this week"}, so nothing to read yet.`];
  }
  const span = r.from === null ? "in the record" : "this week";
  const ch = r.byHow.changed;
  const co = r.byHow.corrected;
  const lines = [
    `Settled things drawn on again: ${String(r.repeats)} of ${plural(r.pairs, "pair")} ${span} (changed ${String(ch.repeats)} of ${String(ch.pairs ?? 0)}, corrected ${String(co.repeats)} of ${String(co.pairs ?? 0)} — a corrected one is archived, so only a drewOn, a cite or a restatement can reach it); came up again ${String(r.reraised)}; shown only ${String(r.shownOnly)}`,
  ];
  if (r.viaWinner > 0 || (ch.alone ?? 0) > 0) {
    lines.push(`  beside it: the winner in a newer pair ${String(r.viaWinner)}; changed ones drawn on without their winner in the same row ${String(ch.alone ?? 0)}`);
  }
  if (r.byBuild.length > 0) {
    const k = (c: SettledCounts): string => `${String(c.repeats)}/${String(c.reraised)}/${String(c.shownOnly)}`;
    lines.push(
      `  by build (drawn on / came up again / shown only): ${r.byBuild.map((b) => `${b.build} changed ${k(b.byHow.changed)}, corrected ${k(b.byHow.corrected)} (${plural(b.turns, "turn")} on ${plural(b.days, "lived day")})`).join("; ")}`,
    );
  }
  return lines;
}
