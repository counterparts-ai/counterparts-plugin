import { Buffer } from "node:buffer";
import { keyFor } from "../remember/spans.js";
import { localDate } from "../time.js";
import { isKnownSession } from "../types.js";
import { COVERAGE_TUNABLES } from "./tunables.js";
export { COVERAGE_TUNABLES } from "./tunables.js";
function stretchOf(pieces) {
  if (pieces.length === 0)
    return null;
  let firstAt = 1 / 0;
  let lastAt = -1 / 0;
  let bytes = 0;
  const scopes = new Set;
  for (const p of pieces) {
    firstAt = Math.min(firstAt, p.at);
    lastAt = Math.max(lastAt, p.at);
    bytes += p.bytes;
    scopes.add(p.scope);
  }
  return {
    pieces: pieces.length,
    bytes,
    firstAt,
    lastAt,
    minutes: Math.floor((lastAt - firstAt) / 60000),
    scopes: [...scopes].sort(),
    times: pieces.map((p) => p.at).sort((a, b) => a - b)
  };
}
const atOf = (s) => typeof s.at === "number" && Number.isFinite(s.at) ? s.at : 0;
function piecesIn(buffer, scope) {
  const seen = new Set;
  const out = [];
  for (const s of [...buffer.spans(scope), ...buffer.claimedSpans(scope).filter((x) => x.kind !== "assistant")]) {
    if (seen.has(s.hash))
      continue;
    seen.add(s.hash);
    out.push(s);
  }
  return out;
}
export function sessionStretch(buffer, session, scopes) {
  const pieces = [];
  for (const scope of scopes ?? buffer.scopes()) {
    const covered = buffer.coveredHashes(scope);
    for (const s of piecesIn(buffer, scope)) {
      if (s.session !== session || covered.has(s.hash))
        continue;
      pieces.push({ at: atOf(s), bytes: Buffer.byteLength(s.text, "utf8"), scope });
    }
  }
  return stretchOf(pieces);
}
export function askFromStretch(stretch, lastAskAt, now, t = COVERAGE_TUNABLES) {
  if (stretch === null)
    return false;
  const fresh = lastAskAt === null ? stretch.pieces : stretch.times.filter((at) => at > lastAskAt).length;
  if (fresh < t.ASK_PIECES)
    return false;
  return now - Math.max(stretch.firstAt, lastAskAt ?? -1 / 0) >= t.ASK_AFTER_MS;
}
export function overFloor(stretch) {
  if (stretch === null)
    return false;
  return stretch.pieces >= COVERAGE_TUNABLES.OWED_PIECES && stretch.lastAt - stretch.firstAt >= COVERAGE_TUNABLES.OWED_SPAN_MS;
}
export function daysOfUse(buffer, zone) {
  const dates = new Set;
  for (const scope of buffer.scopes()) {
    for (const b of buffer.boundaries(scope)) {
      if (b.kind !== "stop" || typeof b.at !== "number" || !Number.isFinite(b.at))
        continue;
      const d = localDate(b.at, zone);
      if (d.length > 0)
        dates.add(d);
    }
  }
  return [...dates].sort();
}
function usesAfter(uses, date) {
  let n = 0;
  for (const d of uses)
    if (d > date)
      n += 1;
  return n;
}
export function ledger(buffer, opts) {
  const today = localDate(opts.now, opts.zone);
  const uses = daysOfUse(buffer, opts.zone);
  const tallies = new Map;
  const tally = (session) => {
    if (typeof session !== "string" || session.length === 0)
      return null;
    let t = tallies.get(session);
    if (t === undefined) {
      t = { scopes: new Set, all: [], unwritten: [], pieces: 0, lastCaptureAt: 0, endAt: null, writtenUpAt: null };
      tallies.set(session, t);
    }
    return t;
  };
  for (const scope of buffer.scopes()) {
    const covered = buffer.coveredHashes(scope);
    for (const s of piecesIn(buffer, scope)) {
      const t = tally(s.session);
      if (t === null)
        continue;
      const at = atOf(s);
      t.scopes.add(scope);
      t.pieces += 1;
      t.lastCaptureAt = Math.max(t.lastCaptureAt, at);
      const piece = { at, bytes: Buffer.byteLength(s.text, "utf8"), scope };
      t.all.push(piece);
      if (!covered.has(s.hash))
        t.unwritten.push(piece);
    }
    for (const s of buffer.assistantSpans(scope)) {
      const t = tally(s.session);
      if (t !== null)
        t.lastCaptureAt = Math.max(t.lastCaptureAt, atOf(s));
    }
    for (const b of buffer.boundaries(scope)) {
      if (b.kind !== "session-end" || typeof b.at !== "number")
        continue;
      const t = tally(b.session);
      if (t !== null)
        t.endAt = Math.max(t.endAt ?? 0, b.at);
    }
    for (const w of buffer.writeUps(scope)) {
      const t = tally(w.session);
      if (t !== null)
        t.writtenUpAt = Math.max(t.writtenUpAt ?? 0, w.at);
    }
  }
  const out = [];
  for (const [session, t] of [...tallies.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (t.pieces === 0)
      continue;
    let hostEnd = null;
    try {
      hostEnd = opts.host?.(session).endedAt ?? null;
    } catch {
      hostEnd = null;
    }
    const endAt = maxOf(t.endAt, hostEnd);
    const ended = endAt !== null && endAt >= t.lastCaptureAt;
    const state = ended ? "ended" : localDate(t.lastCaptureAt, opts.zone) < today ? "quiet" : "active";
    const unwritten = t.writtenUpAt === null ? t.unwritten : t.unwritten.filter((p) => p.at > t.writtenUpAt);
    const stretch = stretchOf(unwritten);
    const floor = overFloor(stretch);
    const since = stretch === null ? 0 : usesAfter(uses, localDate(stretch.lastAt, opts.zone));
    const lapsed = floor && since >= COVERAGE_TUNABLES.LAPSE_DAYS_OF_USE;
    const owed = floor && state !== "active" && !lapsed;
    const perDate = {};
    const open = new Set(unwritten);
    for (const p of t.all) {
      const d = localDate(p.at, opts.zone);
      const cell = perDate[d] ??= { pieces: 0, written: 0 };
      cell.pieces += 1;
      if (!open.has(p))
        cell.written += 1;
    }
    out.push({
      session,
      scopes: [...t.scopes].sort(),
      state,
      lastCaptureAt: t.lastCaptureAt,
      endedAt: ended ? endAt : null,
      pieces: t.pieces,
      written: t.pieces - unwritten.length,
      stretch,
      overFloor: floor,
      owed,
      lapsed,
      small: owed && (stretch?.pieces ?? 0) < COVERAGE_TUNABLES.SMALL_STRETCH_PIECES,
      daysOfUseSince: since,
      perDate
    });
  }
  return out;
}
function maxOf(a, b) {
  if (a === null)
    return b;
  if (b === null)
    return a;
  return Math.max(a, b);
}
export const CLAIM_NOTHING_NEW = "nothing-new";
export const CLAIM_CHAPTER = "chapter";
export const CLAIM_WRITE_UP = "writeup";
export function claimUnwritten(buffer, input) {
  try {
    const marks = buffer.claimCoverage({
      scope: input.scope,
      session: input.session,
      proposalId: `${input.by}:${input.ref}:${String(buffer.now())}`
    });
    return { pieces: marks.length };
  } catch {
    return { pieces: 0 };
  }
}
function writerOf(claim, markSession, proposalSession) {
  if (claim.startsWith(`${CLAIM_NOTHING_NEW}:`))
    return "nothing-new";
  if (claim.startsWith(`${CLAIM_CHAPTER}:`))
    return "chapter";
  if (claim.startsWith(`${CLAIM_WRITE_UP}:`))
    return "next-session";
  if (claim.startsWith("prp_")) {
    return proposalSession === undefined || proposalSession === markSession ? "session" : "next-session";
  }
  return "other";
}
export function workSince(buffer, scope, since, opts = {}) {
  const norm = (s) => s.trim().replace(/\/+$/, "");
  let pieces = 0;
  let unwritten = 0;
  let firstAt = null;
  let lastAt = null;
  let latest = null;
  const unwrittenAt = [];
  for (const held of buffer.scopes()) {
    if (norm(held) !== norm(scope))
      continue;
    const writer = opts.writer ?? null;
    let writerUntil = -1 / 0;
    if (writer !== null) {
      const next = buffer.boundaries(held).filter((b) => b.session === writer && typeof b.at === "number" && b.at >= since).map((b) => b.at);
      writerUntil = next.length === 0 ? 1 / 0 : Math.min(...next);
    }
    const marks = new Map(buffer.coverage(held).map((m) => [m.spanHash, m]));
    for (const s of piecesIn(buffer, held)) {
      const at = atOf(s);
      if (at <= since)
        continue;
      if (s.session === writer && at <= writerUntil)
        continue;
      pieces += 1;
      const mark = marks.get(s.hash);
      if (mark === undefined) {
        unwritten += 1;
        unwrittenAt.push(at);
      } else if (latest === null || at > latest.at) {
        latest = { at, claim: mark.proposalId, session: mark.session, scope: held };
      }
      firstAt = Math.min(firstAt ?? 1 / 0, at);
      lastAt = Math.max(lastAt ?? 0, at);
    }
  }
  const floor = firstAt !== null && lastAt !== null && overFloor({ pieces, firstAt, lastAt });
  const upTo = latest?.at ?? null;
  return {
    pieces,
    unwritten,
    firstAt,
    lastAt,
    overFloor: floor,
    writtenUpTo: upTo,
    writtenUpBy: latest === null ? null : writtenUpWords(writerOf(latest.claim, latest.session, proposalSession(buffer, latest.scope, latest.claim))),
    unwrittenAfter: upTo === null ? unwritten : unwrittenAt.filter((at) => at > upTo).length
  };
}
function proposalSession(buffer, scope, claim) {
  if (!claim.startsWith("prp_"))
    return;
  try {
    for (const p of buffer.proposalRecords(scope)) {
      if (p?.id === claim && typeof p.session === "string")
        return p.session;
    }
  } catch {}
  return;
}
export function chapterClaims(buffer, scope) {
  const norm = (s) => s.trim().replace(/\/+$/, "");
  const out = new Set;
  try {
    for (const held of buffer.scopes()) {
      if (norm(held) !== norm(scope))
        continue;
      for (const m of buffer.coverage(held)) {
        if (typeof m.proposalId !== "string" || !m.proposalId.startsWith(`${CLAIM_CHAPTER}:`))
          continue;
        const id = m.proposalId.slice(CLAIM_CHAPTER.length + 1).split("#")[0];
        if (id !== undefined && id.length > 0)
          out.add(id);
      }
    }
  } catch {
    return out;
  }
  return out;
}
function writtenUpWords(w) {
  switch (w) {
    case "session":
      return "memories";
    case "chapter":
      return "chapter";
    case "nothing-new":
      return "nothing new";
    case "next-session":
      return "write-up";
    default:
      return null;
  }
}
export function sessionsHere(buffer, scope, opts = {}) {
  const norm = (s) => s.trim().replace(/\/+$/, "");
  const seen = new Map;
  const wanted = (session) => typeof session === "string" && isKnownSession(session) && (opts.only === undefined || opts.only.has(session));
  const note = (session, at) => {
    if (!Number.isFinite(at) || at <= 0)
      return;
    const held = seen.get(session);
    if (held === undefined)
      seen.set(session, { session, firstAt: at, lastAt: at, ended: false });
    else {
      held.firstAt = Math.min(held.firstAt, at);
      held.lastAt = Math.max(held.lastAt, at);
    }
  };
  const ended = new Set;
  try {
    for (const held of buffer.scopes()) {
      if (norm(held) !== norm(scope))
        continue;
      for (const b of buffer.boundaries(held)) {
        if (!wanted(b.session))
          continue;
        if (b.kind === "stop")
          note(b.session, b.at);
        else if (b.kind === "session-end")
          ended.add(b.session);
      }
      for (const s of piecesIn(buffer, held))
        if (wanted(s.session))
          note(s.session, atOf(s));
    }
  } catch {
    return [];
  }
  for (const s of seen.values())
    s.ended = ended.has(s.session);
  return [...seen.values()].sort((a, b) => b.lastAt - a.lastAt);
}
export const COVERAGE_OWED_EVENT = "coverage.owed";
export const COVERAGE_WRITTEN_EVENT = "coverage.written";
export const COVERAGE_LAPSED_EVENT = "coverage.lapsed";
export const COVERAGE_WRITTEN_THROUGH_KEY = "coverage.written.through";
const WRITTEN_SLACK_MS = 10 * 60000;
const KNOWN_ROW_CEILING = 5000;
export function recordCoverage(buffer, store, opts) {
  if (buffer.observer)
    return { reason: "observer", owed: 0, lapsed: 0, written: 0, rows: 0 };
  let rows = 0;
  let owed = 0;
  let lapsed = 0;
  let written = 0;
  try {
    const day = store.livedDay();
    const known = new Set;
    for (const name of [COVERAGE_OWED_EVENT, COVERAGE_LAPSED_EVENT]) {
      for (const row of store.eventLog({ name, order: "desc", limit: KNOWN_ROW_CEILING })) {
        if (row.dedup_key !== null)
          known.add(row.dedup_key);
      }
    }
    for (const row of store.eventLog({ name: COVERAGE_WRITTEN_EVENT, order: "desc", limit: KNOWN_ROW_CEILING })) {
      try {
        const p = JSON.parse(row.payload ?? "{}");
        known.add(writtenKey(String(p["scope"] ?? ""), String(p["session"] ?? ""), row.ref ?? ""));
      } catch {}
    }
    const append = (name, key, payload, opts) => {
      if (known.has(key))
        return;
      known.add(key);
      const seq = store.appendEvent({
        name,
        day,
        payload,
        ...opts.dedup ? { dedupKey: key } : {},
        ...opts.ref === undefined ? {} : { ref: opts.ref }
      });
      if (seq !== 0)
        rows += 1;
    };
    for (const e of ledger(buffer, opts)) {
      const s = e.stretch;
      if (s === null || !(e.owed || e.lapsed))
        continue;
      const payload = {
        session: e.session,
        scope: keyFor(s.scopes[0] ?? ""),
        scopes: s.scopes.length,
        pieces: s.pieces,
        minutes: s.minutes,
        from: localDate(s.firstAt, opts.zone),
        to: localDate(s.lastAt, opts.zone),
        state: e.state
      };
      if (e.owed) {
        owed += 1;
        append(COVERAGE_OWED_EVENT, `${COVERAGE_OWED_EVENT}:${e.session}:${String(s.firstAt)}`, payload, { dedup: true });
      } else {
        lapsed += 1;
        append(COVERAGE_LAPSED_EVENT, `${COVERAGE_LAPSED_EVENT}:${e.session}:${String(s.firstAt)}`, { ...payload, daysOfUse: e.daysOfUseSince }, { dedup: true });
      }
    }
    const through = Number(store.getMeta(COVERAGE_WRITTEN_THROUGH_KEY) ?? "NaN");
    if (Number.isFinite(through))
      written = writtenRows(buffer, through - WRITTEN_SLACK_MS, opts, append);
    if (!Number.isFinite(through) || opts.now - through >= WRITTEN_SLACK_MS) {
      store.setMeta(COVERAGE_WRITTEN_THROUGH_KEY, String(opts.now));
    }
    return { reason: "recorded", owed, lapsed, written, rows };
  } catch {
    return { reason: "failed", owed, lapsed, written, rows };
  }
}
function writtenKey(scopeKey, session, claim) {
  return `${COVERAGE_WRITTEN_EVENT}:${scopeKey}:${session}:${claim}`;
}
function writtenRows(buffer, from, opts, append) {
  let n = 0;
  for (const scope of buffer.scopes()) {
    const marks = buffer.coverage(scope).filter((m) => typeof m.at === "number" && m.at > from && m.at <= opts.now);
    if (marks.length === 0)
      continue;
    const pieceAt = new Map(buffer.spans(scope).map((s) => [s.hash, atOf(s)]));
    const proposals = new Map;
    for (const p of buffer.proposalRecords(scope)) {
      if (typeof p?.id === "string" && typeof p.session === "string")
        proposals.set(p.id, p.session);
    }
    const groups = new Map;
    for (const m of marks) {
      if (typeof m.session !== "string" || typeof m.proposalId !== "string")
        continue;
      const key = `${m.session}\x00${m.proposalId}`;
      const g = groups.get(key) ?? { session: m.session, claim: m.proposalId, hashes: [] };
      g.hashes.push(m.spanHash);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const times = g.hashes.map((h) => pieceAt.get(h)).filter((t) => t !== undefined);
      const minutes = times.length === 0 ? 0 : Math.floor((Math.max(...times) - Math.min(...times)) / 60000);
      append(COVERAGE_WRITTEN_EVENT, writtenKey(keyFor(scope), g.session, g.claim), {
        session: g.session,
        scope: keyFor(scope),
        pieces: g.hashes.length,
        minutes,
        by: writerOf(g.claim, g.session, proposals.get(g.claim))
      }, { ref: g.claim, dedup: false });
      n += 1;
    }
  }
  return n;
}
export function lapsesSince(store, sinceAt) {
  try {
    const out = [];
    for (const row of store.eventLog({ name: COVERAGE_LAPSED_EVENT, order: "desc", limit: 5000 })) {
      if (row.at < sinceAt)
        break;
      let p = {};
      try {
        p = JSON.parse(row.payload ?? "{}");
      } catch {
        continue;
      }
      out.push({
        session: typeof p["session"] === "string" ? p["session"] : "",
        pieces: typeof p["pieces"] === "number" ? p["pieces"] : 0,
        minutes: typeof p["minutes"] === "number" ? p["minutes"] : 0,
        at: row.at
      });
    }
    return out;
  } catch {
    return [];
  }
}
