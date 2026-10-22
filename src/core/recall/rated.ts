/**
 * RATINGS OF WHAT A SESSION WAS SHOWN (2026-10-14; Mike's call, lightly held).
 *
 * At the boundary the model scores the memories it was shown, so every
 * footnote gets a feedback signal and not only the few a reply opened or
 * quoted. The anchors, as the tool field states them:
 *
 *   0 — noise (unrelated)
 *   1 — on topic, but not needed
 *   2 — useful background
 *   3 — changed what was done or said
 *
 * Tracking only from 2026-10-14. AN EXPERIMENT SINCE 2026-10-19 (the feedback
 * loop; Mike: "err on too strong, so we can see what it looks like when it's
 * actually happening"): trying the scores as use, over the STRETCH since the
 * session's previous rating row (`planRatedUse`), to see whether the day
 * starts teaching the system. Check on ~10-22; revert by reverting the PR
 * (or, part by part, the knobs named in `docs/decisions.d`):
 *
 *   - each rating is a use at its tier (`RATING_TIER`): 0 none, 1 `ontopic`,
 *     2 `useful`, 3 `referenced` (a full use); an ambient showing in the
 *     stretch left unrated is a glimpse (`shown`). Weights are physics'
 *     (`W_ONTOPIC`, `W_USEFUL`, `W_SHOWN`); the once-a-lived-day rule holds;
 *   - what was co-used in the stretch (rated `CO_USE_MIN_SCORE` or more, or
 *     otherwise used there) is linked at `CO_USE_DEPOSIT`, and what was shown
 *     on the same turn (none of it rated 0) at `SHOWN_TOGETHER_DEPOSIT`
 *     (`associate/tunables.ts`);
 *   - a memory rated 0 in `HABITUATION_MIN_SESSIONS` sessions shows less
 *     readily for a while (`habituation.ts`), read from these same rows.
 *
 * Still one durable row per call (`RECALL_RATED_EVENT`), read by
 * `probe.ts#probeRatings`; it now also says what the call credited and linked.
 *
 * What may be rated: what this session was SHOWN — the ambient lanes in the
 * gate state's `surfaced` (loud, footnotes, quiet pointers), a deliberate
 * question's answer (`asked` records), and what the session OPENED through
 * the tools (the adapter's per-session seen set: by-address opens, and the
 * neighbours a `remember` result named), and since 2026-10-22 (wave 2 lane
 * E) what the beliefs slot showed (`GateState.beliefs`, lane `beliefs`: a
 * use, never support; no glimpse; never co-used). An id in more than one is
 * filed under the first of: ambient lane, `beliefs`, `asked`, `opened`.
 *
 * This file is pure: the lanes, the validation, the row and the plan of what
 * a call credits and links. The reads and the writes are `Counterpart#rateShown`'s.
 */
import type { UseTier } from "../physics/index.js";

/** The lane a rated memory reached the session through. */
export type RatedLane = "loud" | "footnotes" | "pointers" | "asked" | "opened" | "beliefs";

/**
 * `beliefs` (wave 2 lane E, 2026-10-22): a line of the beliefs slot. A rating
 * of one is a USE at its tier — once a lived day, as any memory, through the
 * one door the store opens for it (`Store#reinforce`'s `beliefSlot`) — and
 * NEVER a support filing; for a belief about me or us it counts for nothing
 * at all (`Counterpart#useRatings`). Being shown credits nothing (it is no
 * glimpse lane), and a belief is never in the co-used or shown-together set.
 */
export const RATED_LANES: readonly RatedLane[] = ["loud", "footnotes", "pointers", "asked", "opened", "beliefs"];

/** The scores, lowest first. */
export const RATING_SCORES = [0, 1, 2, 3] as const;
export type RatingScore = (typeof RATING_SCORES)[number];

/** What each score means, as the field states it. */
export const RATING_ANCHORS: Readonly<Record<RatingScore, string>> = {
  0: "noise (unrelated)",
  1: "on topic but I didn't need it",
  2: "useful background",
  3: "changed what I did or said",
};

/**
 * **CAL.** How many ratings one call may carry. Loose (guards loose-first,
 * 2026-09-28): a long session can be shown well over a hundred footnotes. Past
 * it, each extra is refused `capped`. The row lists at most this many.
 */
export const RATED_MAX_PER_CALL = 200;

/** **CAL.** How many refused ids, and named-in-`drewOn`-but-unrated ids, the row lists (as `drewOn`'s row does). */
export const RATED_ROW_IDS_MAX = 64;

/** One rating as it is stored. */
export interface StoredRating {
  readonly id: string;
  readonly score: RatingScore;
  readonly lane: RatedLane;
  /** Also named in `drewOn` at this boundary (this call's field, or credited
   *  as drawn on at this boundary by `chapter`). */
  readonly drewOn: boolean;
}

/** Why a rating was not kept. Closed set. */
export type RatingRefusal =
  | "observer"
  | "id-not-a-string"
  | "score-not-an-integer"
  | "score-out-of-range"
  | "not-shown"
  | "capped";

export interface RatedResult {
  readonly day: number;
  /** Entries sent. */
  readonly sent: number;
  /** Kept, one per id, in the order first given. */
  readonly rated: StoredRating[];
  /** Refused, by name, in the order given; `id` is "" when the entry had none. */
  readonly refused: { id: string; index: number; reason: RatingRefusal }[];
  /** Ids rated more than once in this call: the LAST valid score counted. */
  readonly replaced: string[];
  /** Ambient showings since this session's previous rating row, and how many of
   *  those this call rated — the coverage the row records. */
  readonly coverage: { readonly shown: number; readonly rated: number };
  /** Ids named in `drewOn` at this boundary that this call did not rate. */
  readonly drewOnUnrated: string[];
  /** Whether the row reached the store. */
  readonly recorded: boolean;
  /** What the scores did (2026-10-19). */
  readonly used: RatedUseSummary;
}

/** What one `rated` call credited and linked (2026-10-19), as its row records it. */
export interface RatedUseSummary {
  /** Uses credited, by tier: glimpses (`shown`), rated 1 (`ontopic`), 2 (`useful`), 3 (`referenced`). */
  readonly credited: { readonly shown: number; readonly ontopic: number; readonly useful: number; readonly referenced: number };
  /** Uses not credited, by reason (once-a-day, birth day, archived, …). */
  readonly notCredited: Readonly<Record<string, number>>;
  /** The stretch's co-used set, and the pairs it sent to be linked at `CO_USE_DEPOSIT`. */
  readonly coUse: {
    readonly members: number;
    readonly capped: number;
    readonly pairs: number;
    /** The co-used ids (at most `CO_USE_MAX_MEMBERS`), so a later call on the same turn links each pair once. */
    readonly ids: readonly string[];
  };
  /** Pairs shown on the same turn sent to be linked at `SHOWN_TOGETHER_DEPOSIT`. */
  readonly together: number;
  /** Memories habituated after this row (`habituation.ts`); null when the note could not be written. */
  readonly habituated: number | null;
}

/** Nothing credited or linked: what an observer's or a refused call reports. */
export const NO_RATED_USE: RatedUseSummary = {
  credited: { shown: 0, ontopic: 0, useful: 0, referenced: 0 },
  notCredited: {},
  coUse: { members: 0, capped: 0, pairs: 0, ids: [] },
  together: 0,
  habituated: null,
};

/** One shown memory, keyed by id: its lane and, for an ambient showing, its turn. */
export interface ShownEntry {
  readonly lane: RatedLane;
  /** The recall turn of an ambient showing; null for `asked` and `opened`. */
  readonly turn: number | null;
}

/**
 * The rateable set, with precedence: ambient first, then the beliefs slot,
 * then `asked`, then `opened`. `surfaced` is the gate state's record (tier
 * `surfaced` is loud; a footnote with `via: "link"` is a quiet pointer);
 * `beliefs` the slot's (`GateState.beliefs`, belief id → turn; lane E).
 */
export function rateableSet(
  surfaced: Readonly<Record<string, { turn: number; tier: "surfaced" | "footnoted"; via?: "link" }>>,
  asked: Iterable<string>,
  opened: Iterable<string>,
  beliefs: Readonly<Record<string, number>> = {},
): Map<string, ShownEntry> {
  const out = new Map<string, ShownEntry>();
  for (const [id, rec] of Object.entries(surfaced)) {
    const lane: RatedLane = rec.tier === "surfaced" ? "loud" : rec.via === "link" ? "pointers" : "footnotes";
    out.set(id, { lane, turn: rec.turn });
  }
  for (const [id, turn] of Object.entries(beliefs)) if (!out.has(id)) out.set(id, { lane: "beliefs", turn });
  for (const id of asked) if (!out.has(id)) out.set(id, { lane: "asked", turn: null });
  for (const id of opened) if (!out.has(id)) out.set(id, { lane: "opened", turn: null });
  return out;
}

/**
 * Validate a call's entries against the rateable set. Duplicates: the LAST
 * valid entry for an id wins (a model correcting itself), and the id is kept
 * at the position it was first given. A refused entry never refuses its
 * siblings.
 */
export function readRatings(
  entries: readonly unknown[],
  shown: ReadonlyMap<string, ShownEntry>,
  drewOn: ReadonlySet<string>,
): { rated: StoredRating[]; refused: RatedResult["refused"]; replaced: string[] } {
  const kept = new Map<string, StoredRating>();
  const refused: RatedResult["refused"] = [];
  const replaced = new Set<string>();
  entries.forEach((raw, index) => {
    const o = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const id = typeof o["id"] === "string" ? o["id"].trim() : "";
    if (id.length === 0) {
      refused.push({ id: "", index, reason: "id-not-a-string" });
      return;
    }
    const score = o["score"];
    if (typeof score !== "number" || !Number.isInteger(score)) {
      refused.push({ id, index, reason: "score-not-an-integer" });
      return;
    }
    if (score < 0 || score > 3) {
      refused.push({ id, index, reason: "score-out-of-range" });
      return;
    }
    const at = shown.get(id);
    if (at === undefined) {
      refused.push({ id, index, reason: "not-shown" });
      return;
    }
    if (kept.has(id)) {
      replaced.add(id);
    } else if (kept.size >= RATED_MAX_PER_CALL) {
      refused.push({ id, index, reason: "capped" });
      return;
    }
    kept.set(id, { id, score: score as RatingScore, lane: at.lane, drewOn: drewOn.has(id) });
  });
  return { rated: [...kept.values()], refused, replaced: [...replaced] };
}

/** The lanes coverage counts: footnotes, and quiet pointers (footnotes reached through links). */
export const COVERAGE_LANES = ["footnotes", "pointers"] as const;
type LaneCount = Record<(typeof COVERAGE_LANES)[number], number>;

/**
 * Coverage since the previous rating row: the footnotes (and quiet pointers)
 * whose turn is past `floor`, and how many of them this call rated. LOUD lines
 * are left out (review of #492): a "Came to mind" line shows no id, so the ask
 * does not ask for them — a loud id the session has can still be rated.
 * `asked` and `opened` are rateable but not in the denominator either.
 */
export function ratedCoverage(
  shown: ReadonlyMap<string, ShownEntry>,
  rated: readonly StoredRating[],
  floor: number,
): { shown: LaneCount; rated: LaneCount; total: { shown: number; rated: number } } {
  const s: LaneCount = { footnotes: 0, pointers: 0 };
  const r: LaneCount = { footnotes: 0, pointers: 0 };
  const ratedIds = new Set(rated.map((x) => x.id));
  for (const [id, e] of shown) {
    if (e.turn === null || e.turn <= floor) continue;
    if (e.lane !== "footnotes" && e.lane !== "pointers") continue;
    s[e.lane] += 1;
    if (ratedIds.has(id)) r[e.lane] += 1;
  }
  const sum = (c: LaneCount): number => c.footnotes + c.pointers;
  return { shown: s, rated: r, total: { shown: sum(s), rated: sum(r) } };
}

// ── what the scores do (an experiment, 2026-10-19; check ~10-22) ────────────

/**
 * The use each score is (2026-10-19). Rated 0 is no use (habituation reads
 * it); 3 is a full use, as opening it would be. The weights are physics'.
 */
export const RATING_TIER: Readonly<Record<RatingScore, UseTier | null>> = {
  0: null,
  1: "ontopic",
  2: "useful",
  3: "referenced",
};

/** The use an ambient showing left unrated in its stretch is: a glimpse (`W_SHOWN`). */
export const UNRATED_TIER: UseTier = "shown";

/** The lanes whose unrated showings are glimpses: what ambient recall showed (a
 *  footnote, a loud line, a quiet pointer). An `asked` answer or an `opened`
 *  memory is credited when it is used, as before, not for being handed over. */
const GLIMPSE_LANES: ReadonlySet<RatedLane> = new Set(["loud", "footnotes", "pointers"]);

/**
 * The lowest score that makes a memory one of a stretch's CO-USED set (the
 * brief: "both rated ≥2 or otherwise used"). Why 2: "useful background" is
 * the first score that says the memory was used; 1 says it was not needed.
 */
export const CO_USE_MIN_SCORE: RatingScore = 2;

/**
 * How many of a session's newest rating rows `rateShown` reads for the same
 * turn's earlier calls, whose co-used pairs it does not link again (review of
 * #525: once per pair per stretch). Why 8: a turn rarely ends more than once or
 * twice; past this, a pair could be linked twice, never lost.
 */
export const RATED_SAME_TURN_ROWS = 8;

/** One graded use to credit. */
export interface RatedCredit {
  readonly id: string;
  readonly tier: UseTier;
}

export interface RatedUsePlan {
  /** Every rating with a use, then every unrated ambient showing in the stretch at `UNRATED_TIER`. */
  readonly credits: RatedCredit[];
  /** The stretch's co-used memories, strongest use first, at most `maxMembers`. */
  readonly coUse: string[];
  /** How many co-used memories the cap left out. */
  readonly coUseCapped: number;
  /** Unordered pairs shown on the same turn of the stretch, neither rated 0, each once. */
  readonly together: [string, string][];
}

/**
 * WHAT ONE `rated` CALL CREDITS AND LINKS (2026-10-19). Pure.
 *
 * The STRETCH is every ambient showing whose turn is past `floor` (the
 * session's previous rating row's turn, 0 when none) — the same window the
 * coverage counts. Scoped to the stretch, not the session, because one node
 * holds at most `MAX_EDGES_PER_NODE` links and a long session's every pair
 * would fill it in one boundary.
 *
 * `otherwiseUsed` is what the session USED in the stretch without rating it
 * (an id opened or quoted, credited at the credit pass; an id `drewOn`
 * credited), as the caller found them. Co-use order: rated 3, then otherwise
 * used, then rated 2 — so the cap leaves out the weakest uses first. An id
 * rated 0 is never co-used, whatever else said it was used.
 */
export function planRatedUse(input: {
  readonly shown: ReadonlyMap<string, ShownEntry>;
  readonly rated: readonly StoredRating[];
  readonly floor: number;
  readonly otherwiseUsed: readonly string[];
  readonly maxMembers: number;
}): RatedUsePlan {
  const credits: RatedCredit[] = [];
  const score = new Map<string, RatingScore>();
  for (const r of input.rated) {
    score.set(r.id, r.score);
    const tier = RATING_TIER[r.score];
    if (tier !== null) credits.push({ id: r.id, tier });
  }
  const byTurn = new Map<number, string[]>();
  for (const [id, e] of input.shown) {
    if (e.turn === null || e.turn <= input.floor || !GLIMPSE_LANES.has(e.lane)) continue;
    if (!score.has(id)) credits.push({ id, tier: UNRATED_TIER });
    if (score.get(id) === 0) continue;
    const ids = byTurn.get(e.turn) ?? [];
    ids.push(id);
    byTurn.set(e.turn, ids);
  }
  const ordered: string[] = [];
  const add = (id: string): void => {
    if (!ordered.includes(id)) ordered.push(id);
  };
  // A belief is never co-used (lane E): its rating is a use of it alone.
  const belief = (id: string): boolean => input.shown.get(id)?.lane === "beliefs";
  for (const r of input.rated) if (r.score === 3 && !belief(r.id)) add(r.id);
  for (const id of input.otherwiseUsed) if (score.get(id) !== 0 && !belief(id)) add(id);
  for (const r of input.rated) if (r.score >= CO_USE_MIN_SCORE && !belief(r.id)) add(r.id);
  const max = Math.max(0, Math.floor(input.maxMembers));
  const together: [string, string][] = [];
  const seen = new Set<string>();
  for (const turn of [...byTurn.keys()].sort((a, b) => a - b)) {
    const ids = [...(byTurn.get(turn) ?? [])].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i] as string;
        const b = ids[j] as string;
        const key = `${a}|${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        together.push([a, b]);
      }
    }
  }
  return { credits, coUse: ordered.slice(0, max), coUseCapped: Math.max(0, ordered.length - max), together };
}
