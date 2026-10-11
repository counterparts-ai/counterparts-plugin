/**
 * Per-session gate state — PERSISTED (owner ruling, `docs/module-map.md` Rulings §3).
 *
 * This file exists because of the harvest's most consequential single finding:
 * in v1 the object holding "what surfaced this session", the refractory countdown
 * and the carried cues was constructed fresh every turn and thrown away, because
 * the turn path is a new process per turn and nothing serialized it. Session
 * dedup, the emotional refractory, refractory suppression of arrival cues and
 * cue carry-over were therefore **specified, implemented, tested, and inert on
 * the live path** — exercised only by an in-process replay loop.
 *
 * The generalized lesson, and the reason this module is a file rather than a
 * parameter: **a pure function over caller-owned state is only as real as its
 * caller.** So the state lives in box 2 (canonical operational SQLite, the store's
 * `meta` seam), keyed by session id, and `test/recall.test.ts` asserts that two
 * separate `Recall` instances over two separate `Store` handles — a fresh process,
 * for all this module can tell — share it.
 *
 * **Store:** the `gate_session` TABLE in box 2 — ONE ROW PER RECORD, keyed
 * `(session_id, kind, ref)`. It replaced the single JSON `meta` row at
 * `recall.gate.<sessionId>` on 2026-08-25 (SEAMS item B), which was the fix
 * INTERFACE-GAPS.md #1 asked for and the reason it asked:
 *
 *   > `setMeta` is transactional per call, but `load → mutate → save` is not, so
 *   > two writers on one session — a turn's `recall()` and a late `resolveUse()`
 *   > from the boundary, in different processes — can have the second save drop
 *   > the first's records.
 *
 * That is scar §2.1's own sentence arriving inside a transactional database,
 * because the transaction was around the wrong span. With a row per record the
 * late writer inserts ITS record and cannot touch anybody else's. A merge-on-save
 * would have been the sidecar-plus-discipline answer the scar rejects.
 *
 * **Lifetime:** the session, then `Store.pruneGateSessions()` — a real retention
 * sweep beside `pruneSupersededVersions`, which a meta keyspace could never have.
 * `MAX_SESSION_RECORDS` still bounds the per-session record maps, applied on the
 * write AND on the read, so neither direction can exceed it.
 * **Observer:** never written. An instrument deposits nothing, so its gate state
 * lives and dies in the process (`Recall` holds it in memory and stands down at
 * the write).
 */
import type { GateRecordInput, Store } from "../store/index.js";
import { parseIdentityTag } from "../store/index.js";
import type { UseTier } from "../physics/index.js";

export const GATE_STATE_VERSION = 1;

/** The `gate_session.kind` vocabulary this module owns. `window` is
 *  `prospective/`'s (INTERFACE-GAPS.md §3) and is deliberately not read here. */
export const GATE_KINDS = ["surfaced", "credited", "scalar", "semantic", "asked", "judged"] as const;
/**
 * `asked` (Release B, 2026-10-03): a memory a deliberate QUESTION's answer
 * showed with its words, for this session — quotable at the boundary
 * (`Counterpart#creditReferences`), as a loud surfacing is. Its own kind, so
 * the ambient gate never reads it: `loadGateState` takes `surfaced` and
 * `credited` only, and a deliberate answer must not dedup or train the
 * ambient turn. `turn` holds the moment it was shown, in seconds, so the
 * newest come first; `ASKED_MAX` of them are read.
 */
export const ASKED_KIND = "asked";
/** How many `asked` records the boundary reads, newest first. */
export const ASKED_MAX = 200;

/** An `asked` record's `turn`: the moment, in whole seconds (ms do not fit the column's meaning). */
export function askedTurn(nowMs: number): number {
  return Math.floor(nowMs / 1000);
}
/**
 * `judged` (2026-10-09): how far the boundary's credit pass has scored this
 * session's ambient showings. One row (`ref` `JUDGED_REF`) whose `turn` is the
 * last recall turn a boundary judged, so each showing is scored once, at the
 * first boundary after it: used (expanded or quoted) or shown and not used, on
 * that boundary's `recall.credit` row. Measurement only. Its own kind, written
 * only by the credit pass: recall's save names its own rows and cannot drop
 * this one, and the ambient gate never reads it.
 */
export const JUDGED_KIND = "judged";
export const JUDGED_REF = "credit";

/** The last recall turn a boundary judged for this session; 0 when none has
 *  (including a session older than the row). */
export function judgedThrough(store: Store, sessionId: string): number {
  return store.gateRecords(sessionId, JUDGED_KIND).find((r) => r.ref === JUDGED_REF)?.turn ?? 0;
}

/** Move the session's `judged` mark to `turn`. A gate write like any other, so
 *  an observer's store refuses it; the caller moves it forward only. */
export function markJudged(store: Store, sessionId: string, turn: number, day: number): void {
  store.setGateRecords([{ sessionId, kind: JUDGED_KIND, ref: JUDGED_REF, turn, lastDay: day }]);
}
/** The one `scalar` row: the fields that are not per-memory. */
export const SCALAR_REF = "state";
/** The one `semantic` row: last turn's embedding cue, resolved to neighbours. */
export const SEMANTIC_REF = "lag";
/** A `surfaced` row's `value` when the memory was a quiet pointer (2026-09-28). */
export const POINTER_VALUE = "link";

/** What a memory got, the turn it got it, and whether it may ever train. */
export interface SurfaceRecord {
  turn: number;
  tier: "surfaced" | "footnoted";
  /** False when the memory arrived only through ambiguous handles (§9 G5). */
  trains: boolean;
  /** `"link"` when it was a QUIET POINTER — reached only through links
   *  (2026-09-28). Kept in the row's otherwise unused `value` column, so the
   *  credit pass can count pointers that were later expanded. No schema change. */
  via?: "link";
}

export interface CreditRecord {
  turn: number;
  tier: UseTier;
  /** The lived day the credit landed. Owner ruling 2026-09-14 (R2, review of
   *  #99): the never-downgrade check is per (session, memory, LIVED DAY), so a
   *  session that spans days and uses the same memory each day credits it once
   *  per day — physics' own occasion rule (§5.5) — not once ever. */
  day: number;
}

export interface GateState {
  v: number;
  sessionId: string;
  /** Turns this session has SERVED (incremented in the record step, never the build). */
  turn: number;
  /** Lived day of the last recorded turn — the handle a future meta sweep needs. */
  lastDay: number;
  /** Session dedup: what this session already saw, and must not see again. */
  surfaced: Record<string, SurfaceRecord>;
  /** Reference credit already granted, so credit never downgrades (§5 G10). */
  credited: Record<string, CreditRecord>;
  /** Emotional refractory: the turn the affect flag last fired. */
  affectFiredTurn: number | null;
  /** Cue carry-over: last turn's cue tokens, re-entering once at CARRY_DECAY. */
  carriedCues: string[];
  /** The turn `carriedCues` came from; they expire after exactly one turn. */
  carriedFromTurn: number;
}

export function freshGateState(sessionId: string): GateState {
  return {
    v: GATE_STATE_VERSION,
    sessionId,
    turn: 0,
    lastDay: 0,
    surfaced: {},
    credited: {},
    affectFiredTurn: null,
    carriedCues: [],
    carriedFromTurn: -1,
  };
}

export interface LoadResult {
  state: GateState;
  /** "loaded" | "absent" | "unreadable" — a reset is a countable event, never a
   *  silent fresh start (scar §2.4: "did not fire" and "was never asked" differ). */
  status: "loaded" | "absent" | "unreadable";
}

interface ScalarPayload {
  v: number;
  affectFiredTurn: number | null;
  carriedCues: string[];
  carriedFromTurn: number;
}

export function loadGateState(store: Store, sessionId: string, max = Infinity): LoadResult {
  // `asked` rows (a deliberate answer's, 2026-10-03) are not the ambient
  // gate's: a session whose only rows are those has no gate state yet, and
  // must read `absent`, not `unreadable`. The credit pass's `judged` mark
  // (2026-10-09) is not the gate's either.
  const rows = store.gateRecords(sessionId).filter((r) => r.kind !== ASKED_KIND && r.kind !== JUDGED_KIND);
  if (rows.length === 0) return { state: freshGateState(sessionId), status: "absent" };

  const scalarRow = rows.find((r) => r.kind === "scalar" && r.ref === SCALAR_REF);
  if (scalarRow === undefined) return { state: freshGateState(sessionId), status: "unreadable" };
  let scalar: ScalarPayload;
  try {
    const parsed = JSON.parse(scalarRow.value ?? "") as Partial<ScalarPayload>;
    if (parsed === null || typeof parsed !== "object" || parsed.v !== GATE_STATE_VERSION) {
      return { state: freshGateState(sessionId), status: "unreadable" };
    }
    scalar = {
      v: GATE_STATE_VERSION,
      affectFiredTurn: parsed.affectFiredTurn ?? null,
      carriedCues: parsed.carriedCues ?? [],
      carriedFromTurn: parsed.carriedFromTurn ?? -1,
    };
  } catch {
    return { state: freshGateState(sessionId), status: "unreadable" };
  }

  const surfaced: Record<string, SurfaceRecord> = {};
  const credited: Record<string, CreditRecord> = {};
  for (const row of rows) {
    if (row.kind === "surfaced") {
      surfaced[row.ref] = {
        turn: row.turn,
        tier: row.tier === "footnoted" ? "footnoted" : "surfaced",
        trains: row.trains !== 0,
        ...(row.value === POINTER_VALUE ? { via: "link" as const } : {}),
      };
    } else if (row.kind === "credited") {
      credited[row.ref] = { turn: row.turn, tier: (row.tier ?? "referenced") as UseTier, day: row.last_day };
    }
  }

  return {
    state: {
      v: GATE_STATE_VERSION,
      sessionId,
      turn: scalarRow.turn,
      lastDay: scalarRow.last_day,
      surfaced: bound(surfaced, max),
      credited: bound(credited, max),
      affectFiredTurn: scalar.affectFiredTurn,
      carriedCues: scalar.carriedCues,
      carriedFromTurn: scalar.carriedFromTurn,
    },
    status: "loaded",
  };
}

/** Keep the newest `max` records by turn — the row bounds itself (see header). */
function bound<T extends { turn: number }>(rows: Record<string, T>, max: number): Record<string, T> {
  const entries = Object.entries(rows);
  if (entries.length <= max) return rows;
  entries.sort((a, b) => b[1].turn - a[1].turn);
  return Object.fromEntries(entries.slice(0, max));
}

/**
 * The RECORD half of the build/record split (contract §5 G3). It writes through
 * the store seam, so under observer it refuses there — `Recall` never calls it in
 * that case, and if a future caller does, the refusal is inherited rather than
 * remembered.
 */
export function saveGateState(store: Store, state: GateState, max: number): void {
  const rows: GateRecordInput[] = [
    {
      sessionId: state.sessionId,
      kind: "scalar",
      ref: SCALAR_REF,
      turn: state.turn,
      lastDay: state.lastDay,
      value: JSON.stringify({
        v: GATE_STATE_VERSION,
        affectFiredTurn: state.affectFiredTurn,
        carriedCues: state.carriedCues,
        carriedFromTurn: state.carriedFromTurn,
      } satisfies ScalarPayload),
    },
  ];
  for (const [id, rec] of Object.entries(bound(state.surfaced, max))) {
    rows.push({
      sessionId: state.sessionId,
      kind: "surfaced",
      ref: id,
      turn: rec.turn,
      lastDay: state.lastDay,
      tier: rec.tier,
      trains: rec.trains,
      ...(rec.via === "link" ? { value: POINTER_VALUE } : {}),
    });
  }
  for (const [id, rec] of Object.entries(bound(state.credited, max))) {
    rows.push({
      sessionId: state.sessionId,
      kind: "credited",
      ref: id,
      turn: rec.turn,
      // The credit's OWN day, not the state's: this is what keys the gate.
      lastDay: rec.day,
      tier: rec.tier,
    });
  }
  store.setGateRecords(rows);
}

// ═══════════════════════════════════════════════════════════════════════════
// The LAGGED SEMANTIC CUE — per-session, one turn old, on the same table
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Why this exists, and why it holds NEIGHBOURS rather than a vector.
 *
 * `Turn.vector` has been an input since this module was written and NEITHER live
 * path ever set it: the hook built its turn without one and the deliberate tool
 * built its own. Measured on the live store 2026-09-04 — 13,862 embeddings that
 * nothing live consulted, and a semantic channel that existed only in tests and
 * in the sweep's card preselection.
 *
 * The obvious fix — embed the prompt on the way in — is the one v1 shipped
 * (`~/bansai/hooks/surface.ts:82-88`: "a cold cache calls Voyage and the latency
 * race covers it"), and it is how "no second LLM call" quietly became untrue
 * there. It is also unaffordable here: every hook is a fresh process that
 * already spends 700-1000 ms cold against a 1200 ms budget, and `recall.build`
 * is a synchronous pass with checkpoints, not a race — an overrun does not
 * degrade the channel, it aborts the turn.
 *
 * **OWNER RULING (2026-09-04): do not embed on the hot path.** Compute the cue
 * after the turn, in the detached worker, and use it on the NEXT turn — exactly
 * the one-turn lag `carriedCues` already runs on.
 *
 * **And resolve it in the worker too.** Measured here, hermetically, at the live
 * store's size: `Store.nearestTo` over 13,862 stored vectors costs 590-1040 ms,
 * because `cache.nearest` reads and `JSON.parse`s every row. Carrying the raw
 * 1024-float vector across the lag would have moved the embedding call off the
 * hot path and left the SCAN on it — the same abort, one layer down. So the
 * worker embeds AND ranks, and what crosses the lag is the top-M `{id, score}`
 * slice the activation pass would have computed: ~200 bytes, already the shape
 * `activate()` consumes. (A deliberate deviation from "carry the vector": the
 * vector is not kept, because nothing on the hot path could afford to use it —
 * constitution line 15.)
 *
 * **Expiry: exactly one turn**, the same rule and for the same reason as
 * `carriedCues`. The row stamps the session's SERVED turn count at the moment it
 * was written; it is usable only while that number is still the served count,
 * i.e. on the very next turn. A second turn without a fresh row reads `stale`.
 * Retention beyond that is `Store.pruneGateSessions()`, which sweeps this row
 * with the rest of the session's.
 *
 * **A failure is a NAMED STATE, never silence** (scar §2.4). The worker writes
 * this row on every run, including the runs where it could not embed, so "the
 * embedder has no credential" is a word in the decision record rather than an
 * absence indistinguishable from "nothing was near".
 */
export const SEMANTIC_STATE_VERSION = 1;

/** One neighbour, as `Store.nearestTo` returns it. Ids and scores; no bodies. */
export interface SemanticHit {
  id: string;
  score: number;
}

/** What the WORKER managed. `ok` is the only one that yields a usable cue. */
export type SemanticReason =
  | "ok"
  | "embedder-off"
  | "no-credentials"
  | "no-text"
  | "embed-failed";

/**
 * How this turn's semantic channel got its input — a closed vocabulary, so
 * "the channel was dark" always says WHY.
 *
 *   `none`        nothing was offered and no lag row exists (a core caller, or
 *                 the first turn of a session).
 *   `lagged`      a fresh row from the immediately preceding turn was used.
 *   `in-line`     the caller embedded THIS text now (the deliberate ask, which
 *                 has no latency budget and is allowed to pay for a round trip).
 *   `stale`       a row exists but is older than one turn.
 *   `other-model` a row exists for this turn, but it was ranked under ANOTHER
 *                 embedder than the one box 3 records now (the store was reset
 *                 or switched between the worker's rank and this turn). Its
 *                 cosines are another model's, so they are neither used nor
 *                 scaled by this model's calibration (keyless/recall-tune).
 *   `unreadable`  a row exists and did not parse (a reset is countable).
 *   the four `SemanticReason` failures — what the worker said it could not do.
 */
export type SemanticSource =
  | "none"
  | "lagged"
  | "in-line"
  | "stale"
  | "other-model"
  | "unreadable"
  | Exclude<SemanticReason, "ok">;

interface SemanticPayload {
  v: number;
  turn: number;
  reason: SemanticReason;
  /** The embedding generation these hits were ranked under. Never a credential. */
  model: string | null;
  dim: number;
  hits: SemanticHit[];
}

export interface SemanticInput {
  sessionId: string;
  /** The session's SERVED turn count when this cue was computed. */
  turn: number;
  lastDay: number;
  reason: SemanticReason;
  model?: string | null;
  dim?: number;
  hits?: readonly SemanticHit[];
}

export interface SemanticLoad {
  source: SemanticSource;
  /** Present only when `source === "lagged"`. Empty is a real answer: the
   *  worker embedded fine and the index held nothing near (degraded). */
  hits: readonly SemanticHit[] | null;
  /** The turn the cue was computed from, when there was a row at all. */
  fromTurn: number | null;
  model: string | null;
}

/** Write the lag row. Refuses under observer at the store seam, like every
 *  other gate write — an instrument leaves the world as it found it. */
export function saveSessionSemantic(store: Store, input: SemanticInput): void {
  const payload: SemanticPayload = {
    v: SEMANTIC_STATE_VERSION,
    turn: input.turn,
    reason: input.reason,
    model: input.model ?? null,
    dim: input.dim ?? 0,
    hits: [...(input.hits ?? [])],
  };
  store.setGateRecords([
    {
      sessionId: input.sessionId,
      kind: "semantic",
      ref: SEMANTIC_REF,
      turn: input.turn,
      lastDay: input.lastDay,
      value: JSON.stringify(payload),
    },
  ]);
}

/**
 * Read the lag row and judge it against the session's own served-turn count —
 * both come out of ONE `gateRecords` read, so freshness is decided against the
 * same snapshot the row was found in.
 */
export function loadSessionSemantic(store: Store, sessionId: string): SemanticLoad {
  const rows = store.gateRecords(sessionId);
  const row = rows.find((r) => r.kind === "semantic" && r.ref === SEMANTIC_REF);
  if (row === undefined) return { source: "none", hits: null, fromTurn: null, model: null };
  const served = rows.find((r) => r.kind === "scalar" && r.ref === SCALAR_REF)?.turn ?? 0;

  let payload: SemanticPayload;
  try {
    const parsed = JSON.parse(row.value ?? "") as Partial<SemanticPayload>;
    if (parsed === null || typeof parsed !== "object" || parsed.v !== SEMANTIC_STATE_VERSION) {
      return { source: "unreadable", hits: null, fromTurn: null, model: null };
    }
    payload = {
      v: SEMANTIC_STATE_VERSION,
      turn: typeof parsed.turn === "number" ? parsed.turn : row.turn,
      reason: (parsed.reason ?? "embed-failed") as SemanticReason,
      model: parsed.model ?? null,
      dim: parsed.dim ?? 0,
      hits: Array.isArray(parsed.hits) ? parsed.hits : [],
    };
  } catch {
    return { source: "unreadable", hits: null, fromTurn: null, model: null };
  }

  const base = { fromTurn: payload.turn, model: payload.model };
  // The worker's own refusal outranks staleness: "there was no credential" is
  // the more useful sentence, and it is true whatever turn it happened on.
  if (payload.reason !== "ok") return { source: payload.reason, hits: null, ...base };
  // ONE TURN, exactly as `carriedCues` expires: the cue must have been computed
  // after the last turn this session served.
  if (payload.turn !== served) return { source: "stale", hits: null, ...base };
  // THE ROW'S OWN MODEL (keyless/recall-tune, review MINOR 1). The lagged path
  // never ranks, so the store's per-ranking claim check does not see it: a row
  // ranked under one table and read after the store was reset to another would
  // hand this turn another model's cosines, to be scaled by the new model's
  // calibration. The model box 3 records NOW (`Store.rankingIdentity`, read
  // fresh) must be the model the row was ranked under; when the store records
  // none this handle may rank against, there is nothing to compare, and the row
  // is used as before (the defaults then scale it).
  if (payload.model !== null && !rankedUnder(store, payload.model, payload.dim)) {
    return { source: "other-model", hits: null, ...base };
  }
  return { source: "lagged", hits: payload.hits, ...base };
}

/** Was a lag row ranked under the model box 3 records now? True when nothing is recorded. */
function rankedUnder(store: Store, model: string, dim: number): boolean {
  let now: string | null;
  try {
    now = store.rankingIdentity();
  } catch {
    return true;
  }
  if (now === null) return true;
  const recorded = parseIdentityTag(now);
  if (recorded.model !== model) return false;
  return recorded.dim === null || dim <= 0 || recorded.dim === dim;
}
