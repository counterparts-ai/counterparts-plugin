import { planContiguity, planAtWrite, pairKey } from "./associate/index.js";
import { selfRenderer } from "./briefing.js";
import { ASKED_KIND, askedAt } from "./recall/index.js";
import { errCode } from "./remember/index.js";
import { isHandoffRow } from "./handoff/index.js";
import {
  wakeBehind,
  noteWakeCaught,
  noteWakeBuild,
  wakeFromOtherBuild,
  BRIEFING_KEY,
  LANE_ORDER,
  BRIEFING_TRIM_LOG_CAP
} from "./self/index.js";
import { runCycle, cyclePartial } from "./sleep/index.js";
import { boundedIds, isKnownSession } from "./types.js";
import {
  BRIEFING_PUBLISHED_EVENT,
  CONTIGUITY_CURSOR_META,
  GATE_DEPOSIT_EVENT,
  ASSOCIATE_FLUSH_EVENT,
  nonzero,
  CLOCK_PHASE,
  SLEEP_CYCLE_EVENT,
  numberField,
  renderedEvent,
  TRIMMED_FIELD,
  TRIM_EVENT,
  SELF_BRIEFING_EVENT,
  stringField
} from "./counterpart-events.js";
export function rowIds(ids) {
  return ids.length === 0 ? {} : boundedIds(ids);
}
function readContiguityCursor(raw) {
  if (raw === undefined)
    return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v.at !== "number" || !Number.isFinite(v.at))
      return null;
    const ids = Array.isArray(v.ids) ? v.ids.filter((x) => typeof x === "string") : [];
    const pending = typeof v.pending === "number" && Number.isFinite(v.pending) && v.pending > 0 ? Math.floor(v.pending) : 0;
    return { at: v.at, ids, pending };
  } catch {
    return null;
  }
}
export async function sessionEnd(cp, input = {}) {
  const budgetBytes = input.budgetBytes ?? cp["reportedBudget"];
  if (input.budgetBytes !== undefined)
    cp["reportedBudget"] = input.budgetBytes;
  const work = budgetBytes === null ? 0 : cp["workReserveBytes"](budgetBytes);
  const handoff = budgetBytes === null ? { reserve: 0, lend: 0, keep: 0 } : cp["handoffRoom"](budgetBytes);
  const composeBudget = budgetBytes === null ? null : Math.max(budgetBytes - cp["wakeReserveBytes"](budgetBytes, work, handoff.reserve), 0);
  const skipped = input.sweep !== undefined && "skipped" in input.sweep ? input.sweep.skipped : null;
  const sweeps = input.sweep === undefined || skipped !== null ? [] : await cp.sweepFallback({
    ...input.date === undefined ? {} : { date: input.date },
    ...input.sweep
  });
  if (skipped !== null)
    cp["recordSweepGate"]([], input.date ?? null, skipped);
  const planned = cp["bufferContiguity"]();
  const edges = cp.associate.flush();
  const contiguity = cp["contiguityOutcome"](planned, edges);
  const session = isKnownSession(input.session) ? input.session : undefined;
  if (cp["recordBoundaryFlush"](edges, contiguity, session) && planned.pairs.length > 0)
    cp["clearContiguityPending"]();
  let carried = null;
  try {
    carried = cp.applyPendingAssociations(session === undefined ? {} : { session });
  } catch (err) {
    cp["emit"]("counterpart.associate.apply.failed", undefined, { code: errCode(err) });
  }
  let episodes = { considered: 0, ingested: 0, regrown: 0, skipped: 0 };
  try {
    episodes = cp.self.reconcileEpisodes();
  } catch (err) {
    cp["emit"]("counterpart.episode.reconcile.failed", undefined, { code: errCode(err) });
  }
  const render = selfRenderer(cp.self, {
    prospective: cp.prospective,
    ...input.at === undefined ? {} : { at: input.at },
    ...cp["yesterdayFor"](input.at),
    lendBytes: work,
    handoffLendBytes: handoff.lend,
    handoffKeepBytes: handoff.keep,
    ...budgetBytes === null ? {} : { ceilingBytes: budgetBytes },
    onEvent: (name, data) => cp["emit"](name, undefined, data)
  });
  const date = input.date ?? cp.store.today();
  const behind = wakeBehind(cp.store);
  cp["briefingEvents"] = [];
  let cycle;
  try {
    cycle = runCycle({
      store: cp.store,
      render,
      fade: (f) => cp.schemas.fadeSweep(f.day, { date: f.date, dryRun: !f.apply, limit: f.budget }),
      births: (b) => cp.schemas.birthsFromNames(b.day, { dryRun: !b.apply, limit: b.budget }),
      date,
      ...composeBudget === null ? {} : { budgetBytes: composeBudget },
      onEvent: (e) => cp["relay"]("sleep", e)
    });
  } catch (err) {
    const collected = cp["takeBriefingEvents"]();
    cp["recordSleepCycle"](null, date, collected, errCode(err), cyclePartial(err));
    cp["recordSelfBriefing"](collected, date);
    throw err;
  }
  const briefingEvents = cp["takeBriefingEvents"]();
  cp["recordSleepCycle"](cycle, date, briefingEvents, null);
  cp["recordSelfBriefing"](briefingEvents, date);
  if (briefingEvents.some((e) => e.name === BRIEFING_PUBLISHED_EVENT)) {
    if (behind !== null)
      noteWakeCaught(cp.store, behind.raw);
    noteWakeBuild(cp.store, cp["build"]);
  }
  cp["emit"]("counterpart.sessionEnd", undefined, {
    day: cycle.day,
    sweeps: sweeps.length,
    edges: edges.reason,
    carried: carried?.reason ?? "threw",
    carriedRows: carried?.rows ?? 0,
    budgetBytes,
    observer: cycle.observer,
    episodesIngested: episodes.ingested + episodes.regrown
  });
  return { sweeps, edges, contiguity, carried, cycle, budgetBytes, episodes };
}
export function contiguityPass(cp) {
  return cp["bufferContiguity"]().pass;
}
export function bufferContiguity(cp) {
  const zero = {
    reason: "nothing-new",
    sessions: 0,
    memories: 0,
    pairs: 0,
    timed: 0,
    batch: 0,
    underFloor: 0,
    buffered: 0,
    blocked: 0,
    frozen: 0,
    excluded: 0,
    lostEarlier: 0
  };
  if (cp.observer)
    return { pass: { ...zero, reason: "observer" }, pairs: [] };
  try {
    const cursor = readContiguityCursor(cp.store.getMeta(CONTIGUITY_CURSOR_META));
    const lostEarlier = cursor?.pending ?? 0;
    const day = cp.store.livedDay();
    const rows = cp.store.memoriesWrittenSince(cursor?.at ?? 0);
    if (rows.length === 0) {
      if (cursor !== null && lostEarlier > 0) {
        cp.store.setMeta(CONTIGUITY_CURSOR_META, JSON.stringify({ at: cursor.at, ids: cursor.ids }));
      }
      return { pass: { ...zero, lostEarlier }, pairs: [] };
    }
    const seen = new Set(cursor?.ids ?? []);
    const unread = rows.filter((r) => cursor === null ? r.bornDay >= day : !(r.at === cursor.at && seen.has(r.id)));
    const fresh = unread.filter((r) => !r.nightly);
    const excluded = unread.length - fresh.length;
    const newest = rows.reduce((m, r) => Math.max(m, r.at), 0);
    const freshIds = new Set(fresh.map((r) => r.id));
    const sessions = [...new Set(fresh.map((r) => r.session))].sort();
    const deltas = [];
    let timed = 0;
    let batch = 0;
    let underFloor = 0;
    for (const session of sessions) {
      const plan = planContiguity(cp.store.memoriesOfSession(session).map((r) => ({ id: r.id, at: r.at, fresh: freshIds.has(r.id) })), cp.associate.tunables);
      deltas.push(...plan.deltas);
      timed += plan.timed;
      batch += plan.batch;
      underFloor += plan.underFloor;
    }
    cp.store.setMeta(CONTIGUITY_CURSOR_META, JSON.stringify({
      at: newest,
      ids: rows.filter((r) => r.at === newest).map((r) => r.id),
      ...deltas.length > 0 ? { pending: deltas.length } : {}
    }));
    if (fresh.length === 0)
      return { pass: { ...zero, excluded, lostEarlier }, pairs: [] };
    const atWrite = cp["linkAtWrite"](fresh, day);
    const buffered = cp.associate.contiguity(deltas);
    if (buffered.pairs !== deltas.length) {
      cp.store.setMeta(CONTIGUITY_CURSOR_META, JSON.stringify({
        at: newest,
        ids: rows.filter((r) => r.at === newest).map((r) => r.id),
        ...buffered.pairs > 0 ? { pending: buffered.pairs } : {}
      }));
    }
    const out = {
      reason: buffered.pairs > 0 ? "buffered" : "nothing-new",
      sessions: sessions.length,
      memories: fresh.length,
      excluded,
      lostEarlier,
      pairs: deltas.length,
      timed,
      batch,
      underFloor,
      buffered: buffered.pairs,
      blocked: buffered.blocked,
      frozen: buffered.frozen,
      ...atWrite === null ? {} : { atWrite }
    };
    cp["emit"]("counterpart.associate.contiguity", undefined, {
      ...out,
      atWrite: atWrite === null ? null : atWrite.landed
    });
    return { pass: out, pairs: buffered.accepted };
  } catch (err) {
    const code = errCode(err);
    cp["emit"]("counterpart.associate.contiguity.failed", undefined, { code });
    return { pass: { ...zero, reason: "failed", code }, pairs: [] };
  }
}
export function linkAtWrite(cp, fresh, day) {
  const t = cp.associate.tunables;
  try {
    const memories = [];
    const jots = cp["jotsAmong"](fresh);
    const asking = t.WRITE_LINK_ASKED_MS > 0;
    const bySession = new Map;
    const handoff = new Map;
    const notHandoff = (id) => {
      let h = handoff.get(id);
      if (h === undefined) {
        h = isHandoffRow(cp.store, id);
        handoff.set(id, h);
      }
      return !h;
    };
    for (const m of fresh) {
      const jot = jots.has(m.id);
      if (!jot && !asking)
        continue;
      let mind = bySession.get(m.session);
      if (mind === undefined) {
        const state = cp.recall.gateState(m.session);
        const recent = Object.entries(state.surfaced).filter(([, rec]) => rec.trains && rec.turn > state.turn - t.WRITE_LINK_TURNS).sort((x, y) => y[1].turn - x[1].turn || (x[1].tier === y[1].tier ? 0 : x[1].tier === "surfaced" ? -1 : 1) || (x[0] < y[0] ? -1 : 1)).map(([id]) => id);
        let asked = [];
        if (asking) {
          try {
            asked = cp.store.gateRecords(m.session, ASKED_KIND).map((r) => ({ ref: r.ref, at: askedAt(r.turn) }));
          } catch {
            asked = [];
          }
        }
        mind = { recent, asked };
        bySession.set(m.session, mind);
      }
      const near = mind.asked.filter((r) => Math.abs(r.at - m.at) <= t.WRITE_LINK_ASKED_MS).sort((x, y) => y.at - x.at || (x.ref < y.ref ? -1 : 1)).map((r) => r.ref);
      const inMind = [...new Set([...near, ...jot ? mind.recent : []])].filter(notHandoff);
      if (inMind.length > 0)
        memories.push({ id: m.id, inMind });
    }
    const plan = planAtWrite(memories, t);
    if (plan.pairs.length === 0)
      return null;
    const r = cp.associate.propose(plan.pairs, t.WRITE_LINK_WEIGHT, day);
    return {
      reason: r.reason === "failed" ? "failed" : r.pairs > 0 ? "linked" : "nothing-in-mind",
      memories: plan.memories,
      pairs: plan.pairs.length,
      landed: r.pairs,
      noRoom: r.noRoom,
      blocked: r.blocked,
      frozen: r.frozen,
      ...r.code === undefined ? {} : { code: r.code }
    };
  } catch (err) {
    const code = errCode(err);
    cp["emit"]("counterpart.associate.atwrite.failed", undefined, { code });
    return { reason: "failed", memories: 0, pairs: 0, landed: 0, noRoom: 0, blocked: 0, frozen: 0, code };
  }
}
export function jotsAmong(cp, fresh) {
  const out = new Set;
  if (fresh.length === 0)
    return out;
  const want = new Set(fresh.map((m) => m.id));
  const since = fresh.reduce((d, m) => Math.min(d, m.bornDay), Number.POSITIVE_INFINITY);
  for (const row of cp.store.eventLog({ name: GATE_DEPOSIT_EVENT, sinceDay: since, order: "desc", limit: 1e4 })) {
    try {
      const p = JSON.parse(row.payload ?? "{}");
      if (p.source === "jot" && typeof p.memoryId === "string" && want.has(p.memoryId))
        out.add(p.memoryId);
    } catch {}
  }
  return out;
}
export function contiguityOutcome(cp, planned, edges) {
  const { pass, pairs } = planned;
  if (pairs.length === 0)
    return pass;
  if (edges.reason !== "flushed")
    return { ...pass, landed: 0, evictedOwn: 0, evictedOther: 0, renormalizedNodes: 0 };
  const keys = new Set(pairs.map((p) => pairKey(p.a, p.b)));
  const ends = new Set(pairs.flatMap((p) => [p.a, p.b]));
  let landed = 0;
  try {
    for (const p of pairs) {
      if (cp.associate.weightAt(p.a, p.b, edges.day) > cp.associate.tunables.EDGE_FLOOR || cp.associate.weightAt(p.b, p.a, edges.day) > cp.associate.tunables.EDGE_FLOOR)
        landed += 1;
    }
  } catch (err) {
    cp["emit"]("counterpart.associate.contiguity.outcome.failed", undefined, { code: errCode(err) });
  }
  let evictedOwn = 0;
  let evictedOther = 0;
  for (const e of edges.evictions) {
    if (keys.has(pairKey(e.src, e.dst)))
      evictedOwn += 1;
    else if (ends.has(e.src))
      evictedOther += 1;
  }
  const renormalizedNodes = (edges.renormalizedNodes ?? []).filter((n) => ends.has(n)).length;
  return { ...pass, landed, evictedOwn, evictedOther, renormalizedNodes };
}
export function recordBoundaryFlush(cp, edges, contiguity, session) {
  const flushed = edges.reason === "flushed" || edges.reason === "failed";
  const atWrite = contiguity.atWrite;
  const contiguitySays = contiguity.reason === "failed" || contiguity.buffered > 0 || contiguity.lostEarlier > 0 || atWrite !== undefined && atWrite.pairs > 0;
  if (!flushed && !contiguitySays)
    return false;
  const data = {
    reason: edges.reason,
    source: "boundary",
    day: edges.day,
    dayFrom: "clock",
    claims: 0,
    passes: 0,
    pairs: edges.pairs,
    rows: edges.rows,
    blocked: edges.blocked,
    evicted: edges.evictions.length,
    swept: edges.swept,
    ...edges.sweptArchived === undefined ? {} : { sweptArchived: edges.sweptArchived },
    dropped: edges.dropped,
    pendingDropped: 0,
    corrupt: 0,
    stuck: 0,
    oldestMs: 0,
    ...rowIds(edges.linkedIds ?? []),
    ...session === undefined ? {} : { session },
    contiguity: {
      reason: contiguity.reason,
      ...contiguity.code === undefined ? {} : { code: contiguity.code },
      sessions: contiguity.sessions,
      memories: contiguity.memories,
      excluded: contiguity.excluded,
      lostEarlier: contiguity.lostEarlier,
      pairs: contiguity.pairs,
      timed: contiguity.timed,
      batch: contiguity.batch,
      underFloor: contiguity.underFloor,
      buffered: contiguity.buffered,
      blocked: contiguity.blocked,
      frozen: contiguity.frozen,
      landed: contiguity.landed ?? 0,
      evictedOwn: contiguity.evictedOwn ?? 0,
      evictedOther: contiguity.evictedOther ?? 0,
      renormalizedNodes: contiguity.renormalizedNodes ?? 0
    },
    ...atWrite === undefined ? {} : { atWrite: { ...atWrite } },
    deposited: (contiguity.landed ?? 0) + (atWrite?.landed ?? 0) + (edges.reason === "flushed" ? Math.max(0, edges.pairs - contiguity.buffered - edges.blocked) : 0)
  };
  if (edges.code !== undefined)
    data["error"] = edges.code;
  try {
    cp.store.appendEvent({ name: ASSOCIATE_FLUSH_EVENT, day: edges.day, payload: data });
    return true;
  } catch (err) {
    cp["emit"]("counterpart.associate.flush.unrecorded", undefined, { code: errCode(err) });
    return false;
  }
}
export function clearContiguityPending(cp) {
  try {
    const cursor = readContiguityCursor(cp.store.getMeta(CONTIGUITY_CURSOR_META));
    if (cursor === null || cursor.pending === 0)
      return;
    cp.store.setMeta(CONTIGUITY_CURSOR_META, JSON.stringify({ at: cursor.at, ids: cursor.ids }));
  } catch (err) {
    cp["emit"]("counterpart.associate.contiguity.pending.failed", undefined, { code: errCode(err) });
  }
}
export function rebrief(cp, input = {}) {
  return cp["republish"](input, "rebrief", []);
}
export function refreshWake(cp, input = {}) {
  const pending = [...wakeBehind(cp.store)?.triggers ?? []];
  if (!pending.includes("version") && wakeFromOtherBuild(cp.store, BRIEFING_KEY, cp["build"]))
    pending.push("version");
  const triggers = input.trigger === undefined || pending.includes(input.trigger) ? [...pending] : [...pending, input.trigger];
  if (triggers.length === 0)
    return { reason: "current", triggers, day: cp.store.livedDay(), bytes: 0 };
  const report = cp["republish"](input, "refresh", triggers);
  return {
    reason: !report.rendered ? "no-budget" : report.published ? "rendered" : "observer",
    triggers,
    day: report.day,
    bytes: report.bytes
  };
}
export function republish(cp, input, why, triggers) {
  const budgetBytes = input.budgetBytes ?? cp["reportedBudget"];
  if (input.budgetBytes !== undefined)
    cp["reportedBudget"] = input.budgetBytes;
  const day = cp.store.livedDay();
  if (budgetBytes === null) {
    cp["emit"]("counterpart.rebrief.refused", undefined, { reason: "no-budget", day, why });
    return {
      rendered: false,
      reason: "no-budget",
      published: false,
      day,
      budgetBytes: null,
      composeBudget: null,
      bytes: 0,
      elements: 0,
      counts: {}
    };
  }
  const work = cp["workReserveBytes"](budgetBytes);
  const handoff = cp["handoffRoom"](budgetBytes);
  const composeBudget = Math.max(budgetBytes - cp["wakeReserveBytes"](budgetBytes, work, handoff.reserve), 0);
  const render = selfRenderer(cp.self, {
    prospective: cp.prospective,
    ...input.at === undefined ? {} : { at: input.at },
    ...cp["yesterdayFor"](input.at),
    lendBytes: work,
    handoffLendBytes: handoff.lend,
    handoffKeepBytes: handoff.keep,
    ceilingBytes: budgetBytes,
    onEvent: (name, data) => cp["emit"](name, undefined, data)
  });
  const behind = wakeBehind(cp.store);
  cp["briefingEvents"] = [];
  let out;
  let collected = [];
  try {
    out = render({
      store: cp.store,
      day,
      observer: cp.observer,
      budgetBytes: composeBudget
    }) ?? { bytes: 0, elements: 0 };
  } finally {
    collected = cp["takeBriefingEvents"]();
  }
  cp["recordSelfBriefing"](collected, input.at ?? cp.store.today(), why, triggers);
  if (collected.some((e) => e.name === BRIEFING_PUBLISHED_EVENT)) {
    if (behind !== null)
      noteWakeCaught(cp.store, behind.raw);
    noteWakeBuild(cp.store, cp["build"]);
  }
  const last = cp.self.events("self.briefing.rendered").pop();
  const counts = {};
  for (const lane of LANE_ORDER) {
    const n = last?.data?.[lane];
    counts[lane] = typeof n === "number" ? n : 0;
  }
  cp["emit"]("counterpart.rebrief", undefined, {
    why,
    ...triggers.length === 0 ? {} : { triggers: triggers.join(",") },
    day,
    budgetBytes,
    composeBudget,
    bytes: out.bytes ?? 0,
    elements: out.elements ?? 0,
    observer: cp.observer
  });
  return {
    rendered: true,
    reason: "rendered",
    published: !cp.observer,
    day,
    budgetBytes,
    composeBudget,
    bytes: out.bytes ?? 0,
    elements: out.elements ?? 0,
    counts
  };
}
export function takeBriefingEvents(cp) {
  const out = cp["briefingEvents"] ?? [];
  cp["briefingEvents"] = null;
  return out;
}
export function recordSleepCycle(cp, report, date, briefing, threwCode, partial = null) {
  if (cp.observer)
    return;
  const source = report?.phases ?? partial?.phases ?? [];
  const known = report !== null;
  const phases = source.map((p) => ({
    phase: p.phase,
    status: p.status,
    reason: p.reason,
    ...p.error === undefined ? {} : { code: p.error },
    ...p.reconciled === undefined ? {} : { reconciled: p.reconciled },
    ...p.status === "ran" || p.status === "ran-nothing-found" ? { budgetExhausted: p.budgetExhausted } : {},
    ...p.skippedForBudget === 0 ? {} : { skippedForBudget: p.skippedForBudget },
    ...nonzero(p.skipped) === null ? {} : { skipped: nonzero(p.skipped) }
  }));
  const clock = source.find((p) => p.phase === CLOCK_PHASE) ?? null;
  const clockFailed = clock !== null && clock.status === "failed";
  const reason = threwCode !== null ? "threw" : clockFailed ? "clock-failed" : "ran";
  const failed = phases.filter((p) => p.status === "failed").length;
  let durable = true;
  try {
    cp.store.appendEvent({
      name: SLEEP_CYCLE_EVENT,
      day: cp.store.livedDay(),
      payload: {
        reason,
        code: threwCode ?? (clockFailed ? clock.error ?? null : null),
        date,
        day: report?.day ?? cp.store.livedDay(),
        phases,
        started: (report?.order ?? partial?.order ?? []).length,
        failedPhase: partial?.phase ?? null,
        stage: partial?.stage ?? null,
        promoted: known ? report.promoted.length : null,
        pruned: known ? report.pruned.length : null,
        merged: known ? report.merged.length : null,
        faded: known ? report.faded.length : null,
        bandUp: known ? report.bandTransitions.filter((t) => t.direction === "up").length : null,
        bandDown: known ? report.bandTransitions.filter((t) => t.direction === "down").length : null,
        failed,
        trimmed: numberField(renderedEvent(briefing), TRIMMED_FIELD) ?? 0
      }
    });
  } catch (err) {
    durable = false;
    cp["emit"]("counterpart.sleep.cycle.failed", undefined, { code: errCode(err) });
  }
  cp["emit"]("counterpart.sleep.cycle", undefined, {
    reason,
    day: report?.day ?? null,
    failed,
    durable
  });
}
export function recordSelfBriefing(cp, briefing, date, reason = "rendered", triggers = []) {
  if (cp.observer)
    return;
  const rendered = renderedEvent(briefing);
  if (rendered === null)
    return;
  const trims = briefing.filter((e) => e.name === TRIM_EVENT);
  const bytes = numberField(rendered, "bytes") ?? 0;
  let durable = true;
  try {
    cp.store.appendEvent({
      name: SELF_BRIEFING_EVENT,
      day: cp.store.livedDay(),
      payload: {
        reason,
        ...triggers.length === 0 ? {} : { triggers: [...triggers] },
        date,
        day: numberField(rendered, "day") ?? cp.store.livedDay(),
        bytes,
        budget: numberField(rendered, "budget") ?? 0,
        counts: Object.fromEntries(LANE_ORDER.map((lane) => [lane, numberField(rendered, lane) ?? 0])),
        trimmed: trims.slice(0, BRIEFING_TRIM_LOG_CAP).map((e) => ({
          id: e.ref ?? null,
          lane: stringField(e, "lane")
        })),
        trimmedTotal: trims.length,
        counted: numberField(rendered, "counted") ?? 0,
        untold: numberField(rendered, "untold") ?? 0,
        quiet: numberField(rendered, "quiet") ?? 0,
        ...(stringField(rendered, "untoldLanes") ?? "") === "" ? {} : { untoldLanes: (stringField(rendered, "untoldLanes") ?? "").split(",") },
        trimmedLanes: Object.fromEntries(LANE_ORDER.map((lane) => [lane, trims.filter((e) => stringField(e, "lane") === lane).length]).filter(([, n]) => n > 0)),
        ...(stringField(rendered, "pageRung") ?? "") === "" ? {} : {
          page: {
            rung: stringField(rendered, "pageRung"),
            bytes: numberField(rendered, "page") ?? 0,
            whole: numberField(rendered, "pageWhole") ?? 0
          }
        }
      }
    });
  } catch (err) {
    durable = false;
    cp["emit"]("counterpart.self.briefing.failed", undefined, { code: errCode(err) });
  }
  cp["emit"]("counterpart.self.briefing", undefined, {
    reason,
    day: numberField(rendered, "day"),
    bytes,
    trimmed: trims.length,
    durable
  });
}
