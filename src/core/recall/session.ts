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
 * write AND on the read, so neither direction can exceed it. (As of 2026-10-13
 * nothing on a live path calls `pruneGateSessions`; the one piece that is the
 * person's words, the carried cues, is emptied by `clearIdleCarries` below.)
 * **Observer:** never written. An instrument deposits nothing, so its gate state
 * lives and dies in the process (`Recall` holds it in memory and stands down at
 * the write).
 */
import type { GateRecordInput, Store } from "../store/index.js";
import { parseIdentityTag } from "../store/index.js";
import { stripBoilerplate } from "./cues.js";
import { PRIME_KIND, TRAIN_REF } from "./prime.js";
import type { UseTier } from "../physics/index.js";

export const GATE_STATE_VERSION = 1;

/** The `gate_session.kind` vocabulary this module owns. `window` is
 *  `prospective/`'s (INTERFACE-GAPS.md §3) and is deliberately not read here. */
export const GATE_KINDS = ["surfaced", "credited", "scalar", "semantic", "asked", "judged", "folded", "prime", "belief"] as const;
/**
 * `belief` (wave 2 lane E, 2026-10-22): a belief the beliefs slot showed this
 * session — `ref` the belief, `turn` the turn. Its own kind, never `surfaced`:
 * the footnote numbers (the credit pass, rating coverage, habituation) read
 * `surfaced`, and a belief must not move them. Read into `GateState.beliefs`
 * (the slot's session dedup) and by `rateShown` (a shown belief is rateable).
 */
export const BELIEF_KIND = "belief";
/**
 * `prime` (2026-10-19, context priming — an experiment): the session's train
 * of thought and the open threads its wake listed (`prime.ts`). Its own kind,
 * never read by `loadGateState`, so a train written before the session's first
 * scalar row cannot make the gate state read `unreadable`.
 */
/**
 * `folded` (2026-10-15): a journal row (a chapter's summary, or a frozen
 * copy) recall folded into a chapter it showed — `ref` the row, `value` the
 * chapter. A use of the chapter credits these and no others.
 */
export const FOLDED_KIND = "folded";
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

/** An `asked` record's moment back in UTC ms (the start of its second). */
export function askedAt(turn: number): number {
  return turn * 1000;
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
  /** Journal rows recall folded into a chapter it showed: row id → chapter id (2026-10-15). */
  folded?: Record<string, string>;
  /** Beliefs the beliefs slot showed this session: belief id → turn (lane E, `BELIEF_KIND`). */
  beliefs?: Record<string, number>;
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
  /** When this row was saved, wall-clock ms (2026-10-13). Read only by
   *  `clearIdleCarries`; absent on rows saved before it, which it treats as old. */
  at?: number;
}

export function loadGateState(store: Store, sessionId: string, max = Infinity): LoadResult {
  // `asked` rows (a deliberate answer's, 2026-10-03) are not the ambient
  // gate's: a session whose only rows are those has no gate state yet, and
  // must read `absent`, not `unreadable`. The credit pass's `judged` mark
  // (2026-10-09) is not the gate's either.
  // Priming's rows (2026-10-19) are not the gate's either.
  const rows = store.gateRecords(sessionId).filter((r) => r.kind !== ASKED_KIND && r.kind !== JUDGED_KIND && r.kind !== PRIME_KIND);
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
  const foldedRows: Record<string, string> = {};
  const beliefRows: Record<string, { turn: number }> = {};
  for (const row of rows) {
    if (row.kind === FOLDED_KIND && typeof row.value === "string" && row.value.length > 0) foldedRows[row.ref] = row.value;
    if (row.kind === BELIEF_KIND) beliefRows[row.ref] = { turn: row.turn };
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

  const kept = bound(surfaced, max);
  // A fold is kept while the chapter it was folded into is: the same bound.
  const folded = Object.fromEntries(Object.entries(foldedRows).filter(([, chapter]) => kept[chapter] !== undefined));
  const beliefs = Object.fromEntries(Object.entries(bound(beliefRows, max)).map(([id, r]) => [id, r.turn]));
  return {
    state: {
      v: GATE_STATE_VERSION,
      sessionId,
      turn: scalarRow.turn,
      lastDay: scalarRow.last_day,
      surfaced: kept,
      credited: bound(credited, max),
      affectFiredTurn: scalar.affectFiredTurn,
      carriedCues: scalar.carriedCues,
      carriedFromTurn: scalar.carriedFromTurn,
      ...(Object.keys(folded).length === 0 ? {} : { folded }),
      ...(Object.keys(beliefs).length === 0 ? {} : { beliefs }),
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
        at: store.now(),
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
  const keptSurfaced = bound(state.surfaced, max);
  for (const [id, chapter] of Object.entries(state.folded ?? {})) {
    const at = keptSurfaced[chapter];
    if (at === undefined) continue;
    rows.push({ sessionId: state.sessionId, kind: FOLDED_KIND, ref: id, turn: at.turn, lastDay: state.lastDay, value: chapter });
  }
  // The beliefs slot's showings (lane E): their own kind, never `surfaced`.
  const shownBeliefs = Object.fromEntries(Object.entries(state.beliefs ?? {}).map(([id, turn]) => [id, { turn }]));
  for (const [id, rec] of Object.entries(bound(shownBeliefs, max))) {
    rows.push({ sessionId: state.sessionId, kind: BELIEF_KIND, ref: id, turn: rec.turn, lastDay: state.lastDay });
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

/**
 * TYPED WORDS LEAVE A QUIET SESSION (2026-10-13). `carriedCues` is the one
 * piece of gate state that is the person's own words (up to `MAX_CUES` tokens
 * from the last turn). It is overwritten every turn, but a session that ends,
 * or is killed, keeps its last turn's tokens in the scalar row — and in every
 * backup — for as long as the row lives. The policy is that what the person
 * typed is never kept more than the retention ceiling (`retention.maxDays`,
 * default 14, `remember/tunables.ts#RETENTION_MAX_MS`), so this empties the
 * carry of every session whose row was last saved that long ago. Only the
 * carry: the turn count, refractory and per-memory records (ids, not text)
 * stay, so a session that comes back keeps its dedup and loses one turn of
 * carry, which expires after a turn anyway. A row saved before `at` existed
 * counts as old. An unreadable row is left as it is (it reads `unreadable`).
 *
 * Whole-store and cheap: only rows whose carry is non-empty are read.
 * Called by the worker (`claude-code/bin/runner.ts`) before its daily copy.
 */
export function clearIdleCarries(store: Store, maxMs: number): number {
  const cutoff = store.now() - maxMs;
  // The train of thought (context priming, 2026-10-19) is a running vector of
  // what the person typed, so it leaves a quiet session on the same clock.
  const trains = store.rewriteGateValues(PRIME_KIND, TRAIN_REF, '"vec":[', (value) => {
    let parsed: { vec?: unknown; at?: unknown };
    try {
      parsed = JSON.parse(value) as { vec?: unknown; at?: unknown };
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.vec)) return null;
    // `last` is the newest prompt's own vector: cleared with the train.
    const last = (parsed as { last?: unknown }).last;
    if (parsed.vec.length === 0 && !(Array.isArray(last) && last.length > 0)) return null;
    if (typeof parsed.at === "number" && parsed.at > cutoff) return null;
    return JSON.stringify({ ...parsed, vec: [], last: [], mass: 0 });
  });
  return trains + store.rewriteGateValues("scalar", SCALAR_REF, '"carriedCues":["', (value) => {
    let parsed: Partial<ScalarPayload>;
    try {
      parsed = JSON.parse(value) as Partial<ScalarPayload>;
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || parsed.v !== GATE_STATE_VERSION) return null;
    if (!Array.isArray(parsed.carriedCues) || parsed.carriedCues.length === 0) return null;
    if (typeof parsed.at === "number" && parsed.at > cutoff) return null;
    return JSON.stringify({ ...parsed, carriedCues: [] });
  });
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
 * store's size then: `Store.nearestTo` over 13,862 stored vectors cost 590-1040 ms,
 * because `cache.nearest` read and `JSON.parse`d every row. (History: box 3 has
 * stored float32 BLOBs since 2026-09-05, and the scan is now a few ms — see the
 * 2026-10-19 amendment below.) Carrying the raw
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
 *
 * **Amended 2026-10-19: in line when no fresh cue is ready** (`inLineSemantic`
 * below). The 2026-09-04 ruling's reasons were a network call and a 590-1040 ms
 * scan; since 2026-09-24 the only embedder is the local table (~0.5 ms, no
 * socket), and the scan measured ~18 ms cold at the live store's 2,207 vectors
 * (~/counterparts-notes/2026-10-19-first-prompt-recall-diagnosis.md). So a turn
 * with NO usable lag row — a session's first prompt (`none`), a row from an
 * earlier turn (`stale`, ~21% of live turns), or one the worker could not use —
 * embeds its own text and ranks it in line, instead of going dark. A fresh lag
 * row is still used exactly as before; this only fills the turns it never
 * reached. It RETIRES the owner ruling above (Mike, 2026-10-19, lightly held)
 * (`docs/decisions.d/fix-first-prompt-meaning-1019.md`).
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
 *   `in-line`     THIS text was embedded now: by the caller (the deliberate
 *                 ask, which has no latency budget), or, since 2026-10-19, by
 *                 the ambient turn itself when no fresh lag row was ready
 *                 (`inLineSemantic`).
 *   `in-line-skipped` no fresh lag row, and box 3 holds more vectors than an
 *                 ambient turn may rank in line (`SEMANTIC_INLINE_MAX_VECTORS`).
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
  | "in-line-skipped"
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

/**
 * THE AMBIENT TURN'S OWN VECTOR, for the turns the lag never reached
 * (2026-10-19): `none` (a session's first prompt) and `stale`. The text is
 * stripped of host boilerplate first, as the worker strips it (§9 G3: before
 * cue extraction AND before embedding), and embedded by the store's own SYNC
 * embedder (`Store.textVector`: null with no embedder, or when nothing ranks
 * against box 3, and never throws). An observer opened through a host's wiring
 * has no embedder (`embed-client.ts#openEmbedder`), so it stays dark; a core
 * caller that hands an observer one embeds and ranks here, which reads box 3
 * and writes nothing (the turn's gate writes stand down as before). The rank itself is
 * `activate()`'s, on its in-line path and profile: the vector IS this turn's
 * question, so the lagged profile's caution about the previous subject does not
 * apply.
 *
 * GUARDED BY COUNT, BEFORE THE RANK: the rank runs inside `activate()`, ahead of
 * `build()`'s first time check, so a clock could only notice an overrun after it
 * had already aborted the turn. Above `maxVectors` it answers `skipped`, and the
 * turn records `in-line-skipped` by name.
 */
export function inLineSemantic(
  store: Store,
  text: string,
  maxVectors: number,
): { vector: number[] } | { skipped: true; vectors: number } | null {
  // The embed first (~0.5 ms on the local table), so a handle with no embedder
  // keeps the lag's own word rather than claiming a skip it never faced.
  const vector = store.textVector(stripBoilerplate(text).text.trim().slice(0, IN_LINE_TEXT_CHARS));
  if (vector === null || vector.length === 0) return null;
  let vectors: number;
  try {
    vectors = store.embeddingCount();
  } catch {
    return null;
  }
  if (vectors === 0) return null;
  return vectors > maxVectors ? { skipped: true, vectors } : { vector };
}

/** Head, not tail, as the worker clips (`vectors.ts#LAG_PROMPT_BYTES`, the same
 *  2000): a prompt states its subject first. */
const IN_LINE_TEXT_CHARS = 2000;
