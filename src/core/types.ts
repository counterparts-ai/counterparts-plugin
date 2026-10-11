/**
 * The shared seam between core modules. Deliberately minimal: fields the physics
 * contract names as inputs (physics/CONTRACT.md §5) plus the kind/band vocabulary.
 * Modules may extend with their own types; nothing here may be broken without a
 * cross-module conversation.
 */

export type Kind = "self" | "person" | "entity" | "skill" | "place" | "fact";

export type Band = "episodic" | "semantic" | "identity";

/**
 * Who minted a memory — ENGINE-SET at the mint seam, never claimable by an
 * author or an interpreter (the authorship doctrine, owner ruling 2026-08-29).
 * The first four are `mint.ts`'s `ClaimChannel` vocabulary, persisted;
 * "migrated" is the v1 importer's. An absent value (a pre-v4 row) reads as
 * "unrecorded" — a default here would fabricate provenance.
 *
 * The ARRAY is the totality anchor: a member added here without a live writer
 * fails the member-to-writer test (PR-2 review — "accommodation" shipped
 * writerless once).
 */
export const MEMORY_SOURCES = [
  "authored",
  "fallback",
  "episode",
  "accommodation",
  "migrated",
  // A dream's own words (2026-09-26, `core/dream/`): a gist or pattern the
  // dreamer wrote while replaying, citing its sources. Engine-set by the dream
  // seam alone, and it starts lower than lived testimony (physics
  // `DREAMED_CLAIM_CEILING`): it rises only if it proves true awake.
  "dreamed",
  // The waking self's words (2026-09-27, `core/dream/reflect.ts`): a
  // reflection's entry, when it cited the memories it rests on. Lived — the
  // reflection is an awake act — and labelled so recall can say where it came
  // from (its title opens "Reflected:"), the way a dream's gist opens "Dreamed:".
  "reflection",
] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/**
 * HOW A CONTRADICTION IS SETTLED (2026-09-29, `core/contradictions.ts`) — the
 * three kinds, each with its own outcome, working defaults:
 *
 *   - `changed`: both were true at their time ("used React, now Vue"). The
 *     older memory takes one strength cut and stays recallable, labelled
 *     `earlier`. The default when the kind is unclear.
 *   - `corrected`: I was wrong ("thought Google, actually Meta"). The wrong
 *     one is archived — out of recall, readable by its own id, never deleted.
 *   - `open`: a real disagreement. Both stay live, and recall shows each with
 *     the other ("disagrees with").
 *
 * Here, beside the kind and band vocabulary, because two modules read it —
 * `remember/` validates the `how` field on a draft, and the contradictions
 * mechanism acts on it — and neither should import the other for a word list.
 */
export const SETTLE_HOWS = ["changed", "corrected", "open"] as const;
export type SettleHow = (typeof SETTLE_HOWS)[number];

/**
 * THE SESSION ID OF A MEMORY SERVER THAT DOES NOT KNOW ITS SESSION YET. In
 * Claude Code the server learns its session at the first `chapter` or
 * `session_end` (the MCP server's lazy bind); a `note` before
 * that is filed under this one shared id (remember NOTES §16, n2), and so is a
 * recall's reader. It names NO session: every server that has not bound
 * shares it. A reader of `origin_session` that says who wrote a row, or
 * gathers a session's rows, treats it as unknown (2026-09-30, the 0.3.10
 * release check: 46 of ~430 authored memories on the live store carry it).
 */
export const UNBOUND_SESSION = "mcp";

/** The meta mark on a memory written up by a session that did not live it
 *  (2026-10-01, `mint.ts#MintOptions.writeUp`). */
export const SECOND_HAND_META_KEY = "secondHand";
/** Beside it: the session that wrote it up (an id). */
export const WRITTEN_UP_BY_META_KEY = "writtenUpBy";

/**
 * THE DAY A MEMORY WAS LIVED (2026-10-01): its `happened_on` when it was
 * written up second-hand, else the day it was learned. What the page writer's
 * day reads (`self/writer.ts#isOfDay`).
 */
export function livedOn(row: { learned_on: string; happened_on?: string | null; meta: string }): string {
  if (typeof row.happened_on !== "string" || row.happened_on.length === 0) return row.learned_on;
  try {
    const meta = JSON.parse(row.meta) as Record<string, unknown>;
    return meta[SECOND_HAND_META_KEY] === true ? row.happened_on : row.learned_on;
  } catch {
    return row.learned_on;
  }
}

/** Is this a real session id — not absent, empty, or the unbound server's? */
export function isKnownSession(session: string | null | undefined): session is string {
  return typeof session === "string" && session.length > 0 && session !== UNBOUND_SESSION;
}

/**
 * **CAL.** How many memory ids an event row names (2026-10-11): `mcp.recall`'s
 * delivered ids and `associate.flush`'s endpoints. A row is telemetry, not an
 * index; the true number rides beside the list as `idCount`.
 */
export const ROW_IDS_MAX = 20;

/** Distinct ids in first-seen order, cut at `ROW_IDS_MAX`, with the distinct count. */
export function boundedIds(ids: Iterable<string>): { ids: string[]; idCount: number } {
  const seen = new Set<string>();
  for (const id of ids) if (id.length > 0) seen.add(id);
  return { ids: [...seen].slice(0, ROW_IDS_MAX), idCount: seen.size };
}

/**
 * A model id as the host reports it (`claude-opus-5-5`, `claude-opus-5-5[1m]`),
 * and nothing else: it is printed into a chapter heading and stored on a row
 * (`memories.model`, schema v7), so no spaces, no `·`, no `<synthetic>`.
 * Anything that fails this is treated as unknown.
 *
 * Moved here from `self/episodes.ts` on 2026-09-25 so `store/` can screen the
 * column with the same test the chapter heading uses; `self/` re-exports it.
 */
export function isModelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,63}$/.test(value);
}

/** Four dimensions, 0-1, fixed at encoding. novelty is null for a blind write
 *  (no schema context existed) — recorded, never defaulted (scar §2.9). */
export interface Salience {
  novelty: number | null;
  relevance: number;
  emotional: number;
  predictive: number;
  /** The author's claimed aggregate salience, if any — a FLOOR, not a value
   *  (physics §5.1). Stored on the row so `sal(m)` stays reproducible from state
   *  alone; the dimensions above are never rewritten to satisfy it, and a null
   *  novelty is never defaulted to satisfy it. Clamped at the proposal->memory
   *  seam by `clampSalienceAtSeam()`, which emits an event on any lift. */
  claimed?: number | null;
}

/** The physics-relevant state of one memory. Days are lived-day integers
 *  (active-day clock, scar E8) — never calendar timestamps. */
/** A dated memory's hold (`MemoryPhysics.hold`). */
export type DatedHold = { readonly state: "pending" };

export interface MemoryPhysics {
  kind: Kind;
  salience: Salience;
  birthDay: number;
  uses: number;
  lastUsedDay: number;
  /** How many DISTINCT lived days credited a use. `uses` is a weighted sum
   *  (§5.5's tiers) and cannot reconstruct this, and identity promotion is gated
   *  on >= N = 3 distinct lived days (§5.3). Incremented only by `creditUse()`.
   *  Optional so this stays an extension, not a break; absent reads as 0, which
   *  is the promotion-blocking direction. */
  reinforcedDays?: number;
  /**
   * The strongest RECORDED feeling on this memory (the `feelings` table's
   * `MAX(strength)`, owner's or self's), or absent/null when it carries none.
   * Read beside the row by `store.row()`; physics folds it into the emotional
   * intensity (`physics.emotionalIntensity`, CONTRACT §5.10). As recorded, never
   * softened: the height and slope a feeling gives a memory are set by how it
   * felt, the way affect stamps a trace at encoding.
   */
  feelingPeak?: number | null;
  /**
   * v9 (2026-09-27): the strongest feeling recorded AT THE TIME — every
   * feeling but the ones a reflection recorded later (`feelings.source`). The
   * core's fast lane reads this one unless `CORE_FAST_ACCEPTS_REFLECTED_FEELING`
   * is set (physics §5.3); height and decay still read `feelingPeak`. Absent
   * (a physics object built without it) falls back to `feelingPeak`.
   */
  feelingPeakLived?: number | null;
  consolidated: boolean;
  /**
   * v10 (2026-09-29, physics §5.12): a multiplier on strength, 1 until a
   * settle marks the memory `changed` (then `CHANGED_FADE`, stacking), and
   * back when that settle is undone. A use never moves it. Absent reads 1.
   */
  fade?: number;
  /**
   * Born before schema v8 (the dreaming + consolidation redesign, 2026-09-26):
   * the one-time `+CONS_BONUS` consolidation path stays open for it, exactly as
   * it was, so the upgrade moves no memory down (physics §5.2). Absent reads
   * false — every memory made since the upgrade earns durability from RETURNS
   * instead.
   */
  legacy?: boolean;
  /**
   * RETURNS (physics §5.11): the weighted count of spaced returns — a credited
   * organic use on a lived day after the previous counted return, or a dream
   * replay at a fraction of that. Each one slows fading (stability), with
   * diminishing returns; close-together returns count less, never against.
   * Absent reads 0, which is exactly today's arithmetic.
   */
  returns?: number;
  /** Distinct lived days with a counted AWAKE return — awake use or, since
   *  v9, a reflection that cited it (the core lanes read it). */
  returnDays?: number;
  /** The first and last lived day of a counted AWAKE return (use or
   *  reflection); null when none. */
  firstReturnDay?: number | null;
  lastReturnDay?: number | null;
  /** The last lived day a dream replayed it; null when never. */
  lastDreamDay?: number | null;
  /**
   * THE DATED HOLD (2026-10-10, physics §5.4, review 07 C1/C2) — NOT a column:
   * computed at the read seam (`store/operational.ts#datedHold`) from
   * `event_date`, `learned_on`, the row's repeat rule and the store's calendar
   * today. `pending` while the memory's date (and its grace) is still ahead, or
   * inside a repeating date's window: decay reads t = 0. Absent or null: an
   * ordinary memory — which a one-off date is again once its window has closed:
   * on its own curve from its own anchor, as if it had never been held
   * (2026-10-11; the steeper "spent" slope is gone).
   */
  hold?: DatedHold | null;
  /**
   * THE OLD-CLAIMS ERA (2026-10-10, physics §5.1) — NOT a column: computed at
   * the read seam (`store/operational.ts#eraClaimOf`). For a memory written
   * before the store's `claims.era.cutoff`, the claim the CURVE reads
   * (`physics#curveSal`) in place of `salience.claimed`: today's default for
   * what it is about — for a default, either way (2026-10-11); for an explicit
   * claim, only when that is lower. The stored claim is
   * never rewritten — `updatePhysics` does not know this field, so a physics
   * object written back cannot carry it into the `claimed` column. Absent or
   * null: the curve reads the stored claim.
   */
  eraClaim?: number | null;
  /** Set only by the explicit promotion crossing or revision inheritance (§5.3). */
  promotedIdentity: boolean;
  protected: boolean;
  /** Challenge pressure — a field on the memory, never a second object (§5.6). */
  pressure: number;
  lastChallengedDay: number | null;
}
