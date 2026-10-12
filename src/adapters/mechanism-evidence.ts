/**
 * Did a memory mechanism fire, and which rows say so — the ONE judgement the
 * dashboard's lights (`dashboard/web/views/mechanisms.ts`) and the console's
 * short view (`cli/mechanisms.ts`) both call.
 *
 * **Why it exists** (2026-09-26, an experiment). The two surfaces kept their
 * own rules and disagreed on five of the eleven: the console called a bare
 * sleep-cycle row consolidation AND forgetting, counted a deposit row that
 * accepted nothing as salience, and a flush that wrote no link as association.
 * Now the rules are here, once. Each surface keeps its own table of WORDS and
 * its own window (lived days on the dashboard, calendar days in the console),
 * and both hand the window in.
 *
 * **Where it sits.** Beside `fired.ts`, for the reason that file gives: two
 * adapters need it and adapters never import each other. It imports
 * `dashboard/registries.ts` for the same reason `fired.ts` does — a registry,
 * not a view — and nothing else of the dashboard's, so the console loads no
 * dashboard code.
 *
 * **Built / partly / not** is `build` below, one table: the pills' tags and the
 * home page's "N of 11 built" read it. The calls are from
 * `docs/research/mechanism-audit-2026-09-24.md` plus what shipped since (emotion
 * part A, prospective reminders, the entity-card fade). A working default,
 * revisable.
 *
 * Read-only: `eventLog`, two counts and one meta read. No row text.
 */
import { cadenceFor, readMarker, MARKER_UNSET } from "../core/sleep/index.js";
import type { Phase } from "../core/sleep/index.js";
import type { EventRow, ReadOnlyStore } from "../core/store/index.js";
import type { DurableEventName } from "./dashboard/registries.js";

/** How many backing event seqs a verdict keeps. */
export const RECENT_IDS = 3;
/** Ceiling on one name's read inside a window — reported, never silent. */
const WINDOW_CEILING = 50_000;
/** How far back "last fired" looks, per event name, newest first. */
const LOOKBACK = 500;

export type Family = "encoding" | "storage" | "retrieval" | "transformation";
export const FAMILIES: readonly Family[] = ["encoding", "storage", "retrieval", "transformation"];

/** How much of a mechanism is built. Grey with no tag, a "partly built" tag, no tag. */
export type Build = "built" | "partly" | "not";

export type Payload = Record<string, unknown>;

/** One kind of row that proves a mechanism fired. */
export interface Proof {
  /** A name the surfaces can ask for this proof's count by. */
  readonly key: string;
  readonly event: DurableEventName;
  /** The dashboard's words for a unit of it — [one, many]. */
  readonly says: readonly [string, string];
  /** Sum this numeric payload field instead of counting rows; a row whose field
   *  is not a number above zero does not count at all (`fired.ts`'s `positive`
   *  rule: a row that lands whether or not the mechanism acted is not a firing). */
  readonly sum?: string;
  /** With `sum`: these numeric payload fields are taken off it first — a part
   *  of the total that another proof says in words of its own. */
  readonly less?: readonly string[];
  /** Only rows this accepts count. */
  readonly where?: (p: Payload) => boolean;
  /**
   * Only rows whose act STILL STANDS count — for an act the owner can take
   * back after it fired (a dream, undone). Read against the store, so it is
   * asked of a row only after `where` and `sum` said it counts.
   */
  readonly stands?: (store: ReadOnlyStore, row: EventRow) => boolean;
}

export interface MechanismEvidence {
  readonly id: string;
  readonly family: Family;
  readonly build: Build;
  /** Empty when not built. */
  readonly proofs: readonly Proof[];
  /**
   * A mechanism whose firing is ARITHMETIC ON A ROW rather than an event (the
   * emotion lift): rows it acted on born inside the window, counted from the
   * store. Backs no event seq.
   */
  readonly census?: {
    readonly key: string;
    readonly count: (store: ReadOnlyStore, sinceDay: number) => number;
    readonly says: readonly [string, string];
  };
  /** For a mechanism that is not built: the one plain line shown instead. */
  readonly grey?: string;
  /**
   * THE PROOF THAT SAYS IT DID ITS JOB (2026-10-11, Group 4 item 7; review 06
   * C6, D7): the key of a proof that must count above zero for the mechanism
   * to have fired at all. Its other proofs firing without it is STARVED — the
   * work happened and changed nothing — which a surface shows as amber, not
   * green (Association: links laid, none reached recall).
   */
  readonly vital?: string;
  /**
   * WHEN THE VITAL PROOF'S ABSENCE STARTS TO MEAN SOMETHING (reviewer of #423,
   * 2026-10-11): the window's lived day is at least `livedDays` and the other
   * proofs counted at least `others` in it. Before that, the work happening
   * with no vital proof is YOUNG — a new store has not had time for it — and a
   * surface says so as waiting, not amber. Absent: starved from day one.
   */
  readonly vitalAfter?: { readonly livedDays: number; readonly others: number };
  /**
   * WHAT THE MECHANISM IS HOLDING, when that decides whether it can fire at all
   * (prospective: dated memories). Zero, with nothing fired, means there is
   * truly nothing for it to do.
   */
  readonly held?: {
    readonly count: (store: ReadOnlyStore) => number;
    readonly says: readonly [string, string];
    readonly none: string;
  };
  /** Also count how many firings landed TODAY (the window's `today`). */
  readonly today?: boolean;
  /**
   * The sleep phase it runs in, when it runs on a SCHEDULE rather than every
   * day (consolidation: every `CADENCE.consolidate` lived days). A quiet week
   * of a phase that ran on time is "next run in N days", not "quiet".
   */
  readonly schedule?: Phase;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ── THE TABLE ───────────────────────────────────────────────────────────────
// One row per mechanism, in the site's order. What counts as it firing, in the
// rows the store already keeps; and how much of it is built.
export const MECHANISM_EVIDENCE: readonly MechanismEvidence[] = [
  // ── Encoding ──
  {
    // Salience writes no row of its own: the score is columns on the memory.
    // Every memory is scored at the gate, so the gate's ACCEPTED count is it.
    id: "salience",
    family: "encoding",
    build: "built",
    proofs: [
      { key: "deposit", event: "gate.deposit", sum: "accepted", says: ["memory scored as it was written", "memories scored as they were written"] },
      { key: "chunk", event: "gate.chunk", sum: "accepted", says: ["memory scored from a crash write-up", "memories scored from a crash write-up"] },
    ],
  },
  {
    // PARTLY: emotion part A (2026-09-26) weighs recorded feelings — the lift
    // and the slower fade are arithmetic on the row (the census), the mood
    // match is a count on the turn's row. Nothing reads feeling from words yet.
    id: "emotional",
    family: "encoding",
    build: "partly",
    proofs: [
      { key: "moodMatched", event: "recall.decision", sum: "moodMatched", says: ["memory a matching mood brought closer", "memories a matching mood brought closer"] },
    ],
    census: {
      key: "weighted",
      count: (store, sinceDay) => store.emotionCensus({ sinceDay }).weighted,
      says: ["new memory held higher and fading slower for the feeling it carries", "new memories held higher and fading slower for the feeling they carry"],
    },
  },
  // ── Storage ──
  {
    id: "decay",
    family: "storage",
    build: "built",
    proofs: [
      // The decay site also records the CROSSING into identity (direction up),
      // which is not a fade; only a move down counts.
      { key: "faded", event: "band.transition", where: (p) => p["site"] === "decay" && p["direction"] !== "up", says: ["memory faded a band", "memories faded a band"] },
      // EXITED (2026-10-10): archived at the floor — still readable by id, never deleted.
      { key: "pruned", event: "memory.pruned", says: ["memory exited (archived at the floor)", "memories exited (archived at the floor)"] },
      // The entity-card fade has no row of its own; it is a count on the cycle row.
      { key: "cards", event: "sleep.cycle", sum: "faded", says: ["unused card faded", "unused cards faded"] },
    ],
    // BELOW REACH (2026-10-10, Group 1, review 03 C3): a state, not an event —
    // how many live memories ambient recall leaves out right now. Counted apart
    // from the exits above, which are archived.
    census: {
      key: "belowReach",
      count: (store) => store.belowReachCount(),
      says: ["memory below reach now", "memories below reach now"],
    },
  },
  {
    // PARTLY (2026-09-29, after the review of #284): similar memories meet
    // now — a dream merges near-copies into one, a dream flags two that
    // disagree, and a memory settled `changed` fades once under the one that
    // holds (physics §5.12). Not built: similar memories competing when they
    // are recalled (retrieval-induced forgetting).
    id: "interference",
    family: "storage",
    build: "partly",
    proofs: [
      { key: "dreamMerged", event: "dream.changed", sum: "merge", stands: dreamStands, says: ["near-copy merged in a dream", "near-copies merged in a dream"] },
      { key: "flagged", event: "contradiction.flagged", says: ["pair that disagrees flagged", "pairs that disagree flagged"] },
      { key: "faded", event: "contradiction.settled", where: (p) => p["how"] === "changed", stands: settleStands, says: ["earlier memory faded under a newer one", "earlier memories faded under newer ones"] },
    ],
  },
  // ── Retrieval ──
  {
    id: "retrieval",
    family: "retrieval",
    build: "built",
    proofs: [
      {
        key: "turns",
        event: "recall.decision",
        where: (p) => num(p["surfacedCount"]) + num(p["footnoteCount"]) > 0,
        says: ["turn brought memories to mind", "turns brought memories to mind"],
      },
      { key: "lookups", event: "mcp.recall", says: ["deliberate look-up", "deliberate look-ups"] },
      { key: "credited", event: "recall.credit", sum: "credited", says: ["memory strengthened by being used", "memories strengthened by being used"] },
    ],
  },
  {
    // PARTLY (audit: built but starved). Since 2026-10-11 (Group 4, review 06
    // C6) the proofs are honest: LINKS LAID is pairs that landed as a link
    // (`deposited`: co-use, contiguity, write-time links), not the rows a flush
    // rewrote, plus the replay's faint trails; and LINKS REACHED RECALL is what
    // a link put in front of the model (pointers shown, candidates a hop lifted
    // into the cut and then shown). Links laid with none reaching recall in the
    // window is amber (`vital`).
    id: "association",
    family: "retrieval",
    build: "partly",
    vital: "reached",
    // Not amber for a new store (reviewer of #423): two weeks of lived days
    // (the window, and one before it for trails to be laid and used) and 20
    // links laid this week, about three a lived day.
    vitalAfter: { livedDays: 14, others: 20 },
    proofs: [
      { key: "links", event: "associate.flush", sum: "deposited", says: ["link laid", "links laid"] },
      // Counted even when the dream is undone (reviewer of #423): an undo
      // takes back what the dreamer chose, not the replay, so the trails stay
      // in the graph and the count says what is there.
      { key: "replayed", event: "dream.begun", sum: "replayLinks", says: ["faint link a dream's replay laid", "faint links a dream's replay laid"] },
      { key: "reached", event: "recall.decision", sum: "linksReached", says: ["memory a link brought to mind", "memories links brought to mind"] },
    ],
  },
  {
    // Built end to end since 2026-09-26 (#243, #247): a date on a note or a
    // session's memories; quiet ones come back as footnotes, plain ones are said.
    id: "prospective",
    family: "retrieval",
    build: "built",
    proofs: [
      { key: "plain", event: "prospective.plain", says: ["reminder said plainly", "reminders said plainly"] },
      { key: "quiet", event: "prospective.fire", says: ["reminder came back as a quiet footnote", "reminders came back as quiet footnotes"] },
    ],
    held: {
      count: (store) => store.datedMemories("0001-01-01", "9999-12-31").length,
      says: ["dated memory held", "dated memories held"],
      none: "Nothing dated yet: a note or a memory given a date comes back around that day.",
    },
    today: true,
  },
  // ── Transformation ──
  {
    // BUILT (2026-09-26, dreaming + consolidation): durability now comes from
    // RETURNS — every spaced return makes a memory fade more slowly, credited
    // the moment it happens (the census) — and the core from its two lanes,
    // decided every three lived days (the schedule). A dream's merges are
    // consolidation too. The cycle row itself is not a proof (it lands every
    // night).
    id: "consolidation",
    family: "transformation",
    build: "built",
    proofs: [
      { key: "promoted", event: "band.promoted", says: ["memory became core", "memories became core"] },
      { key: "merged", event: "memory.merged", says: ["exact duplicate merged", "exact duplicates merged"] },
      { key: "dreamMerged", event: "dream.changed", sum: "merge", stands: dreamStands, says: ["near-copy merged in a dream", "near-copies merged in a dream"] },
      { key: "rose", event: "band.transition", where: (p) => p["site"] === "consolidate", says: ["memory rose a band", "memories rose a band"] },
    ],
    census: {
      key: "returns",
      count: (store, sinceDay) => {
        const r = store.returnCounts({ sinceDay });
        return r.awake + r.dream + r.reflection;
      },
      says: ["return that will make a memory fade more slowly", "returns that will make memories fade more slowly"],
    },
    schedule: "consolidate",
  },
  {
    // BUILT (2026-09-26): a few minutes of replay the owner says yes to, by a
    // background agent — merges, links, replays, patterns, flagged
    // contradictions, a journal. A dream is proved by its journal and the
    // changes it made; an ask alone is not a dream.
    id: "dreaming",
    family: "transformation",
    build: "built",
    proofs: [
      // An undone dream is taken back: it no longer lights the mechanism.
      { key: "dreams", event: "dream.journaled", stands: dreamStands, says: ["dream", "dreams"] },
      // A NOMINATION IS A SUGGESTION, NOT A CHANGE (2026-09-27): it moves
      // nothing until a lane promotes the memory awake, so it is said apart —
      // "60 changes dreams made, 3 core suggestions", not "63 changes".
      {
        key: "changes",
        event: "dream.changed",
        sum: "applied",
        less: ["nominate-core"],
        stands: dreamStands,
        says: ["change a dream made", "changes dreams made"],
      },
      { key: "suggestions", event: "dream.changed", sum: "nominate-core", stands: dreamStands, says: ["core suggestion", "core suggestions"] },
    ],
    // v9 (2026-09-27): the waking self after a dream (or on its own) keeps its
    // own record, the `reflections` table, not the event log — so it is
    // counted from the store, like the returns under Consolidation.
    census: {
      key: "reflections",
      count: (store, sinceDay) => store.reflections({ limit: 500 }).filter((r) => r.state === "reflected" && r.day >= sinceDay).length,
      says: ["reflection after a dream", "reflections after dreams"],
    },
  },
  {
    // BUILT (2026-09-29, owner's call after the review of #284): a belief or an
    // identity line is revised under pressure over several days, and an
    // ordinary memory is SETTLED — changed, corrected or open — by a new memory
    // that updates it, a `note` settle, a dream or reflection with a reason, or
    // the owner, with a record and an undo. Noticing a disagreement nobody
    // wrote down near the first memory is the part that stays thin (the dream
    // and the write-time list are the two ways in).
    id: "reconsolidation",
    family: "transformation",
    build: "built",
    proofs: [
      { key: "pressure", event: "revision.pressure", says: ["correction weighed against an old memory", "corrections weighed against old memories"] },
      { key: "settled", event: "contradiction.settled", stands: settleStands, says: ["contradiction settled", "contradictions settled"] },
    ],
  },
  {
    // PARTLY (2026-09-26): a dream can write the pattern it sees across
    // memories as a gist of its own (source `dreamed`, starting low). Nothing
    // does it awake yet, and many sessions are not distilled on a schedule.
    id: "episodic-semantic",
    family: "transformation",
    build: "partly",
    proofs: [{ key: "gist", event: "dream.changed", sum: "gist", stands: dreamStands, says: ["pattern dreamed into a memory of its own", "patterns dreamed into memories of their own"] }],
  },
  {
    // Entity cards exist (and fade, under Forgetting), but beliefs about them
    // have no live producer (`addBelief` is called only by the demo seeder),
    // and a card's birth leaves no durable row. Not built, for the light.
    id: "schema",
    family: "transformation",
    build: "not",
    proofs: [],
    grey: "In development: beliefs about people and projects are not formed yet.",
  },
];

/** The window a surface judges over. */
export interface EvidenceWindow {
  /** The lowest lived day a row may carry — the SQL bound, and the census's. */
  readonly sinceDay: number;
  /** The lived day that counts as today. */
  readonly today: number;
  /** Whether a row falls inside the window. Default: `row.day >= sinceDay`. */
  readonly contains?: (row: EventRow) => boolean;
  /**
   * Which of the window's rows landed TODAY, for `Verdict.firedToday`.
   * Default: `row.day === today` (the lived day). The dashboard hands in the
   * person's calendar day (`store.today()`), which is what "today" means in
   * the sidebar's "Mechanisms today" (2026-10-10). Only rows inside the
   * window are asked, so the window must reach back to the start of today.
   */
  readonly isToday?: (row: EventRow) => boolean;
}

export interface EvidencePart {
  readonly key: string;
  readonly count: number;
  readonly says: readonly [string, string];
}

/** A scheduled mechanism's clock: when its phase last ran, and when it runs next. */
export interface Schedule {
  readonly phase: Phase;
  readonly cadence: number;
  /** The lived day its phase last completed, or null when it never has. */
  readonly lastRanDay: number | null;
  /** Lived days until it is due again; 0 = due at the next session's end. */
  readonly nextInDays: number;
  /** True while the phase is on time: it ran within one cadence of today. */
  readonly onTime: boolean;
}

export interface Verdict {
  readonly id: string;
  readonly family: Family;
  readonly build: Build;
  /** Some proof counted above zero inside the window. */
  readonly fired: boolean;
  /** Every proof's count inside the window (zeros included), census last. */
  readonly parts: readonly EvidencePart[];
  /** The newest backing event seqs, newest first (at most RECENT_IDS). */
  readonly events: readonly number[];
  /** Of the window's firings, how many landed today (only when asked for). */
  readonly today: number | null;
  /**
   * TIMES IT FIRED TODAY (2026-10-10, the sidebar's "Mechanisms today"): the
   * rows that proved it and landed today (`EvidenceWindow.isToday`), counted
   * as ROWS, not amounts: a flush that wrote 8 links is one firing of
   * Association, a deposit of 3 memories one of Salience. A dream's rows (its
   * journal and its changes, `dream.*` under one `ref`) are one firing. Every
   * built mechanism has it (0 when nothing landed today); null when not built.
   */
  readonly firedToday: number | null;
  /** What it holds, when the row declares it; null when unasked or unreadable. */
  readonly held: number | null;
  /** When it did not fire in the window: the newest lived day it ever did. */
  readonly lastFiredDay: number | null;
  /** Set when its other proofs counted in the window and its `vital` one did
   *  not: that proof's key. `fired` is false then. Absent otherwise. */
  readonly starved?: string;
  /** Set instead of `starved` while the store is too young for the vital
   *  proof to be expected (`MechanismEvidence.vitalAfter`): that proof's key.
   *  `fired` is false then too. Absent otherwise. */
  readonly young?: string;
  readonly schedule: Schedule | null;
}

export function payloadOf(row: EventRow): Payload {
  if (row.payload === null) return {};
  try {
    const v: unknown = JSON.parse(row.payload);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : {};
  } catch {
    return {};
  }
}

/**
 * What makes two rows one firing: a dream's journal row and its changes row
 * are one dream (`dream.*` under the dream's id, `ref`); any other row is its
 * own.
 */
export function firingKey(row: EventRow): string {
  return row.name.startsWith("dream.") && row.ref !== null ? `dream:${row.ref}` : `seq:${row.seq}`;
}

/** The amount this row contributes, or 0 when it does not count. */
/** `amount`, and zero for a row whose act no longer stands (`Proof.stands`). */
export function counted(proof: Proof, row: EventRow, store: ReadOnlyStore): number {
  const n = amount(proof, payloadOf(row));
  if (n <= 0 || proof.stands === undefined) return n;
  try {
    return proof.stands(store, row) ? n : 0;
  } catch {
    return n;
  }
}

/** A settle's row counts while its pair is still settled — an undo takes it back. */
function settleStands(store: ReadOnlyStore, row: EventRow): boolean {
  return row.ref === null || store.contradiction(row.ref)?.state === "settled";
}

/** A dream's row counts while the dream is not undone (review of #251). */
function dreamStands(store: ReadOnlyStore, row: EventRow): boolean {
  return row.ref === null || store.dream(row.ref)?.state !== "undone";
}

export function amount(proof: Proof, p: Payload): number {
  if (proof.where !== undefined && !proof.where(p)) return 0;
  if (proof.sum === undefined) return 1;
  let v = num(p[proof.sum]);
  for (const f of proof.less ?? []) v -= num(p[f]);
  return v > 0 ? v : 0;
}

function scheduleOf(store: ReadOnlyStore, phase: Phase, today: number): Schedule {
  const cadence = cadenceFor(phase);
  let lastRanDay: number | null = null;
  try {
    const m = readMarker(store, phase);
    if (m.health === "ok" && m.day !== MARKER_UNSET) lastRanDay = m.day;
  } catch {
    lastRanDay = null;
  }
  if (lastRanDay === null) return { phase, cadence, lastRanDay, nextInDays: 0, onTime: false };
  const nextInDays = Math.max(0, lastRanDay + cadence - today);
  return { phase, cadence, lastRanDay, nextInDays, onTime: today - lastRanDay <= cadence };
}

/**
 * Every mechanism's verdict over one window. One read per event name inside the
 * window, shared by every proof that names it.
 */
export function mechanismEvidence(
  store: ReadOnlyStore,
  window: EvidenceWindow,
): { verdicts: Verdict[]; truncated: boolean } {
  const contains = window.contains ?? ((row: EventRow) => row.day >= window.sinceDay);
  const isToday = window.isToday ?? ((row: EventRow) => row.day === window.today);
  let truncated = false;
  const windowRows = new Map<string, EventRow[]>();
  const rowsFor = (name: string): EventRow[] => {
    let rows = windowRows.get(name);
    if (rows === undefined) {
      const read = store.eventLog({ name, sinceDay: window.sinceDay, limit: WINDOW_CEILING, order: "desc" });
      if (read.length >= WINDOW_CEILING) truncated = true;
      rows = read.filter(contains);
      windowRows.set(name, rows);
    }
    return rows;
  };

  const verdicts = MECHANISM_EVIDENCE.map((m): Verdict => {
    const empty = { id: m.id, family: m.family, build: m.build };
    if (m.build === "not") {
      return { ...empty, fired: false, parts: [], events: [], today: null, firedToday: null, held: null, lastFiredDay: null, schedule: null };
    }
    const parts: EvidencePart[] = [];
    const backing: EventRow[] = [];
    let today = 0;
    const firedToday = new Set<string>();
    for (const proof of m.proofs) {
      let total = 0;
      for (const row of rowsFor(proof.event)) {
        const n = counted(proof, row, store);
        if (n > 0) {
          total += n;
          backing.push(row);
          if (row.day === window.today) today += n;
          if (isToday(row)) firedToday.add(firingKey(row));
        }
      }
      parts.push({ key: proof.key, count: total, says: proof.says });
    }
    if (m.census !== undefined) {
      let count = 0;
      try {
        count = m.census.count(store, window.sinceDay);
      } catch {
        // A store that cannot answer the census simply has no census count.
      }
      parts.push({ key: m.census.key, count, says: m.census.says });
    }
    // A store that will not answer reads as unknown (null), never as zero —
    // zero turns the light grey, and a failed read is not evidence of nothing.
    let held: number | null = null;
    if (m.held !== undefined) {
      try {
        held = m.held.count(store);
      } catch {
        held = null;
      }
    }
    const anyPart = parts.some((p) => p.count > 0);
    const vitalCount = m.vital === undefined ? null : (parts.find((p) => p.key === m.vital)?.count ?? 0);
    const without = anyPart && vitalCount === 0 ? m.vital : undefined;
    const others = parts.reduce((t, p) => t + (p.key === m.vital ? 0 : p.count), 0);
    const mature = m.vitalAfter === undefined || (window.today >= m.vitalAfter.livedDays && others >= m.vitalAfter.others);
    const starved = without !== undefined && mature ? without : undefined;
    const young = without !== undefined && !mature ? without : undefined;
    const fired = anyPart && without === undefined;
    const events = backing
      .sort((a, b) => b.seq - a.seq)
      .slice(0, RECENT_IDS)
      .map((r) => r.seq);
    let lastFiredDay: number | null = null;
    if (!fired) {
      // Only the newest LOOKBACK rows of each name are searched.
      for (const proof of m.proofs) {
        for (const row of store.eventLog({ name: proof.event, order: "desc", limit: LOOKBACK })) {
          if (counted(proof, row, store) > 0) {
            if (lastFiredDay === null || row.day > lastFiredDay) lastFiredDay = row.day;
            break;
          }
        }
      }
    }
    return {
      ...empty,
      fired,
      parts,
      events,
      today: m.today === true ? today : null,
      firedToday: firedToday.size,
      held,
      lastFiredDay,
      schedule: m.schedule === undefined ? null : scheduleOf(store, m.schedule, window.today),
      ...(starved === undefined ? {} : { starved }),
      ...(young === undefined ? {} : { young }),
    };
  });
  return { verdicts, truncated };
}

/** How many of the twelve are built at all ("partly" counts), for a headline. */
export function builtCount(): number {
  return MECHANISM_EVIDENCE.filter((m) => m.build !== "not").length;
}
