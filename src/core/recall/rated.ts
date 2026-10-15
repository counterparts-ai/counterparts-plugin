/**
 * RATINGS OF WHAT A SESSION WAS SHOWN (2026-10-14; Mike's call, tracking only,
 * lightly held).
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
 * TRACKING ONLY. A rating changes no strength, ranking, credit, decay or link:
 * nothing here reaches physics, the gate state's `credited`, the judged mark,
 * or the association buffer. It is one durable row per call
 * (`RECALL_RATED_EVENT`), read by `probe.ts#probeRatings`. How (or whether)
 * the signal is used is decided later, from those rows.
 *
 * What may be rated: what this session was SHOWN — the ambient lanes in the
 * gate state's `surfaced` (loud, footnotes, quiet pointers), a deliberate
 * question's answer (`asked` records), and what the session OPENED through
 * the tools (the adapter's per-session seen set: by-address opens, and the
 * neighbours a `remember` result named). An id in more than one is filed
 * under the first of: ambient lane, `asked`, `opened`.
 *
 * This file is pure: the lanes, the validation and the row. The reads and the
 * one write are `Counterpart#rateShown`'s.
 */

/** The lane a rated memory reached the session through. */
export type RatedLane = "loud" | "footnotes" | "pointers" | "asked" | "opened";

export const RATED_LANES: readonly RatedLane[] = ["loud", "footnotes", "pointers", "asked", "opened"];

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
}

/** One shown memory, keyed by id: its lane and, for an ambient showing, its turn. */
export interface ShownEntry {
  readonly lane: RatedLane;
  /** The recall turn of an ambient showing; null for `asked` and `opened`. */
  readonly turn: number | null;
}

/**
 * The rateable set, with precedence: ambient first, then `asked`, then
 * `opened`. `surfaced` is the gate state's record (tier `surfaced` is loud;
 * a footnote with `via: "link"` is a quiet pointer).
 */
export function rateableSet(
  surfaced: Readonly<Record<string, { turn: number; tier: "surfaced" | "footnoted"; via?: "link" }>>,
  asked: Iterable<string>,
  opened: Iterable<string>,
): Map<string, ShownEntry> {
  const out = new Map<string, ShownEntry>();
  for (const [id, rec] of Object.entries(surfaced)) {
    const lane: RatedLane = rec.tier === "surfaced" ? "loud" : rec.via === "link" ? "pointers" : "footnotes";
    out.set(id, { lane, turn: rec.turn });
  }
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
