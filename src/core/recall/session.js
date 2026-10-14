import { parseIdentityTag } from "../store/index.js";
export const GATE_STATE_VERSION = 1;
export const GATE_KINDS = ["surfaced", "credited", "scalar", "semantic", "asked", "judged"];
export const ASKED_KIND = "asked";
export const ASKED_MAX = 200;
export function askedTurn(nowMs) {
  return Math.floor(nowMs / 1000);
}
export function askedAt(turn) {
  return turn * 1000;
}
export const JUDGED_KIND = "judged";
export const JUDGED_REF = "credit";
export function judgedThrough(store, sessionId) {
  return store.gateRecords(sessionId, JUDGED_KIND).find((r) => r.ref === JUDGED_REF)?.turn ?? 0;
}
export function markJudged(store, sessionId, turn, day) {
  store.setGateRecords([{ sessionId, kind: JUDGED_KIND, ref: JUDGED_REF, turn, lastDay: day }]);
}
export const SCALAR_REF = "state";
export const SEMANTIC_REF = "lag";
export const POINTER_VALUE = "link";
export function freshGateState(sessionId) {
  return {
    v: GATE_STATE_VERSION,
    sessionId,
    turn: 0,
    lastDay: 0,
    surfaced: {},
    credited: {},
    affectFiredTurn: null,
    carriedCues: [],
    carriedFromTurn: -1
  };
}
export function loadGateState(store, sessionId, max = 1 / 0) {
  const rows = store.gateRecords(sessionId).filter((r) => r.kind !== ASKED_KIND && r.kind !== JUDGED_KIND);
  if (rows.length === 0)
    return { state: freshGateState(sessionId), status: "absent" };
  const scalarRow = rows.find((r) => r.kind === "scalar" && r.ref === SCALAR_REF);
  if (scalarRow === undefined)
    return { state: freshGateState(sessionId), status: "unreadable" };
  let scalar;
  try {
    const parsed = JSON.parse(scalarRow.value ?? "");
    if (parsed === null || typeof parsed !== "object" || parsed.v !== GATE_STATE_VERSION) {
      return { state: freshGateState(sessionId), status: "unreadable" };
    }
    scalar = {
      v: GATE_STATE_VERSION,
      affectFiredTurn: parsed.affectFiredTurn ?? null,
      carriedCues: parsed.carriedCues ?? [],
      carriedFromTurn: parsed.carriedFromTurn ?? -1
    };
  } catch {
    return { state: freshGateState(sessionId), status: "unreadable" };
  }
  const surfaced = {};
  const credited = {};
  for (const row of rows) {
    if (row.kind === "surfaced") {
      surfaced[row.ref] = {
        turn: row.turn,
        tier: row.tier === "footnoted" ? "footnoted" : "surfaced",
        trains: row.trains !== 0,
        ...row.value === POINTER_VALUE ? { via: "link" } : {}
      };
    } else if (row.kind === "credited") {
      credited[row.ref] = { turn: row.turn, tier: row.tier ?? "referenced", day: row.last_day };
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
      carriedFromTurn: scalar.carriedFromTurn
    },
    status: "loaded"
  };
}
function bound(rows, max) {
  const entries = Object.entries(rows);
  if (entries.length <= max)
    return rows;
  entries.sort((a, b) => b[1].turn - a[1].turn);
  return Object.fromEntries(entries.slice(0, max));
}
export function saveGateState(store, state, max) {
  const rows = [
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
        at: store.now()
      })
    }
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
      ...rec.via === "link" ? { value: POINTER_VALUE } : {}
    });
  }
  for (const [id, rec] of Object.entries(bound(state.credited, max))) {
    rows.push({
      sessionId: state.sessionId,
      kind: "credited",
      ref: id,
      turn: rec.turn,
      lastDay: rec.day,
      tier: rec.tier
    });
  }
  store.setGateRecords(rows);
}
export function clearIdleCarries(store, maxMs) {
  const cutoff = store.now() - maxMs;
  return store.rewriteGateValues("scalar", SCALAR_REF, '"carriedCues":["', (value) => {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || parsed.v !== GATE_STATE_VERSION)
      return null;
    if (!Array.isArray(parsed.carriedCues) || parsed.carriedCues.length === 0)
      return null;
    if (typeof parsed.at === "number" && parsed.at > cutoff)
      return null;
    return JSON.stringify({ ...parsed, carriedCues: [] });
  });
}
export const SEMANTIC_STATE_VERSION = 1;
export function saveSessionSemantic(store, input) {
  const payload = {
    v: SEMANTIC_STATE_VERSION,
    turn: input.turn,
    reason: input.reason,
    model: input.model ?? null,
    dim: input.dim ?? 0,
    hits: [...input.hits ?? []]
  };
  store.setGateRecords([
    {
      sessionId: input.sessionId,
      kind: "semantic",
      ref: SEMANTIC_REF,
      turn: input.turn,
      lastDay: input.lastDay,
      value: JSON.stringify(payload)
    }
  ]);
}
export function loadSessionSemantic(store, sessionId) {
  const rows = store.gateRecords(sessionId);
  const row = rows.find((r) => r.kind === "semantic" && r.ref === SEMANTIC_REF);
  if (row === undefined)
    return { source: "none", hits: null, fromTurn: null, model: null };
  const served = rows.find((r) => r.kind === "scalar" && r.ref === SCALAR_REF)?.turn ?? 0;
  let payload;
  try {
    const parsed = JSON.parse(row.value ?? "");
    if (parsed === null || typeof parsed !== "object" || parsed.v !== SEMANTIC_STATE_VERSION) {
      return { source: "unreadable", hits: null, fromTurn: null, model: null };
    }
    payload = {
      v: SEMANTIC_STATE_VERSION,
      turn: typeof parsed.turn === "number" ? parsed.turn : row.turn,
      reason: parsed.reason ?? "embed-failed",
      model: parsed.model ?? null,
      dim: parsed.dim ?? 0,
      hits: Array.isArray(parsed.hits) ? parsed.hits : []
    };
  } catch {
    return { source: "unreadable", hits: null, fromTurn: null, model: null };
  }
  const base = { fromTurn: payload.turn, model: payload.model };
  if (payload.reason !== "ok")
    return { source: payload.reason, hits: null, ...base };
  if (payload.turn !== served)
    return { source: "stale", hits: null, ...base };
  if (payload.model !== null && !rankedUnder(store, payload.model, payload.dim)) {
    return { source: "other-model", hits: null, ...base };
  }
  return { source: "lagged", hits: payload.hits, ...base };
}
function rankedUnder(store, model, dim) {
  let now;
  try {
    now = store.rankingIdentity();
  } catch {
    return true;
  }
  if (now === null)
    return true;
  const recorded = parseIdentityTag(now);
  if (recorded.model !== model)
    return false;
  return recorded.dim === null || dim <= 0 || recorded.dim === dim;
}
