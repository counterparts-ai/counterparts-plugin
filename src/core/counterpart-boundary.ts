/** `Counterpart` at a boundary: the session's end, the contiguity pass, re-briefing and the wake's refresh, and the records the sleep cycle and the briefing file (bodies moved out of `counterpart.ts`, 2026-10-11; the class keeps a delegate for each). */
import { planContiguity, planAtWrite, pairKey } from "./associate/index.js";
import type { PairDelta, FlushReport } from "./associate/index.js";
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
  BRIEFING_TRIM_LOG_CAP,
} from "./self/index.js";
import type { WakeTrigger } from "./self/index.js";
import { runCycle, cyclePartial } from "./sleep/index.js";
import type { CycleReport, CyclePartial } from "./sleep/index.js";
import { boundedIds, isKnownSession } from "./types.js";
import type {
  SessionEndInput,
  SessionEndReport,
  SweepEntry,
  PendingApplyReport,
  EpisodeReconcileReport,
  ContiguityPass,
  AtWritePass,
  RebriefReport,
  WakeRefreshReport,
  CounterpartEvent,
} from "./counterpart-types.js";
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
  stringField,
} from "./counterpart-events.js";
import type { Counterpart } from "./counterpart.js";

/** `boundedIds`, or nothing at all when there are none (a flush that linked nothing). */
export function rowIds(ids: readonly string[]): { ids?: string[]; idCount?: number } {
  return ids.length === 0 ? {} : boundedIds(ids);
}

/** The contiguity cursor, read leniently: anything unreadable is "no cursor",
 *  which re-reads only the current lived day's memories — never a history. */
function readContiguityCursor(raw: string | undefined): { at: number; ids: string[]; pending: number } | null {
  if (raw === undefined) return null;
  try {
    const v = JSON.parse(raw) as { at?: unknown; ids?: unknown; pending?: unknown };
    if (typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    const ids = Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === "string") : [];
    const pending = typeof v.pending === "number" && Number.isFinite(v.pending) && v.pending > 0 ? Math.floor(v.pending) : 0;
    return { at: v.at, ids, pending };
  } catch {
    return null;
  }
}

export async function sessionEnd(cp: Counterpart, input: SessionEndInput = {}): Promise<SessionEndReport> {
  const budgetBytes = input.budgetBytes ?? cp["reportedBudget"];
  if (input.budgetBytes !== undefined) cp["reportedBudget"] = input.budgetBytes;
  // The "Work here" reserve, once: part of what the composition leaves the
  // delivery, and lent back to "Still open"'s first item when that is all
  // that would otherwise go unlisted (review of #350).
  // …and the handoff pointer's with "Last here", lent after it and after the
  // Yesterday line's titles to "Arriving:" and "Still open"'s first item
  // (2026-10-10, `self/briefing.ts#ROOM_ORDER`).
  const work = budgetBytes === null ? 0 : cp["workReserveBytes"](budgetBytes);
  const handoff = budgetBytes === null ? { reserve: 0, lend: 0, keep: 0 } : cp["handoffRoom"](budgetBytes);
  const composeBudget =
    budgetBytes === null ? null : Math.max(budgetBytes - cp["wakeReserveBytes"](budgetBytes, work, handoff.reserve), 0);

  // Three states, not two (I32): swept, skipped-and-said-so, or not asked for.
  // The middle one still writes the gate row — `ran: 0, scopes: 0`, with the
  // reason — so a keyless day is an EVIDENCED quiet day rather than an absence
  // the daily cannot tell from a dead worker.
  const skipped =
    input.sweep !== undefined && "skipped" in input.sweep ? input.sweep.skipped : null;
  const sweeps =
    input.sweep === undefined || skipped !== null
      ? []
      : await cp.sweepFallback({
          ...(input.date === undefined ? {} : { date: input.date }),
          ...(input.sweep as SweepEntry),
        });
  if (skipped !== null) cp["recordSweepGate"]([], input.date ?? null, skipped);
  // TEMPORAL CONTIGUITY (2026-09-28), before the flush so its deltas go out
  // through the same plan, homeostasis and sweep as a co-use, and are
  // counted on the boundary's own `associate.flush` row.
  const planned = cp["bufferContiguity"]();
  const edges = cp.associate.flush();
  // What the buffered pairs BECAME, now the flush has landed (review of
  // #281, findings 2 and 9): links that conduct, and what they cost.
  const contiguity = cp["contiguityOutcome"](planned, edges);
  const session = isKnownSession(input.session) ? input.session : undefined;
  if (cp["recordBoundaryFlush"](edges, contiguity, session) && planned.pairs.length > 0) cp["clearContiguityPending"]();
  // The hooks' own co-activation, applied in the process that can afford to
  // wait on the write lock. After the in-process flush, so a single-process
  // caller's own deltas are not sitting in the buffer when a claim is
  // absorbed into it; fail-open, because a claim that cannot be applied is
  // still on disk and a boundary is worth more than a retry.
  let carried: PendingApplyReport | null = null;
  try {
    carried = cp.applyPendingAssociations(session === undefined ? {} : { session });
  } catch (err) {
    cp["emit"]("counterpart.associate.apply.failed", undefined, { code: errCode(err) });
  }
  // THE EPISODE DOOR, before the cycle: an episode ingested here is inside the
  // boundary that decays it, consolidates it and renders the briefing around
  // it — the same ordering the sweep gets, and for the same reason. Until
  // 2026-09-04 nothing called `ingestEpisode` at all, so the journal reached
  // memory through no door (self/CONTRACT §5 G12, §3's "which door reaches
  // this?"). Fail-open: a reconciler that threw would cost the cycle.
  let episodes: EpisodeReconcileReport = { considered: 0, ingested: 0, regrown: 0, skipped: 0 };
  try {
    episodes = cp.self.reconcileEpisodes();
  } catch (err) {
    cp["emit"]("counterpart.episode.reconcile.failed", undefined, { code: errCode(err) });
  }

  const render = selfRenderer(cp.self, {
    prospective: cp.prospective,
    ...(input.at === undefined ? {} : { at: input.at }),
    ...cp["yesterdayFor"](input.at),
    lendBytes: work,
    handoffLendBytes: handoff.lend,
    handoffKeepBytes: handoff.keep,
    // The ceiling this room was cut from, kept with what the bundle shows,
    // so a session start assembles under the same one (2026-10-10).
    ...(budgetBytes === null ? {} : { ceilingBytes: budgetBytes }),
    onEvent: (name, data) => cp["emit"](name, undefined, data),
  });
  // The PHYSICS date key, and the host's to supply — every live entry point
  // passes one (`hook.ts`, `runner.ts`, the demo seeder, the replay driver).
  // When one does not, the fallback is THIS SESSION'S clock rather than
  // `sleep/cycle.ts#todayDate()`'s ambient read: a boundary is the one place
  // the two clocks touch, and a seeded run whose caller forgot the date would
  // otherwise advance the lived-day clock with a date from a different year
  // than everything the same run wrote (§I7). Resolved ONCE and handed to both
  // the cycle and the two recorders below, so the rows cannot date themselves
  // differently from the run they describe — `sweep.gate`'s nullable `date` is
  // a hole this pair does not have.
  const date = input.date ?? cp.store.today();
  // The wake's mark as it stood BEFORE the cycle (`self/behind.ts`): a render
  // this cycle publishes has caught up to it, and a mark set while it ran has
  // not.
  const behind = wakeBehind(cp.store);
  // Armed for the cycle and taken back on BOTH exits: see the field's own
  // note. `self/`'s briefing events are the only thing it collects.
  cp["briefingEvents"] = [];
  let cycle: CycleReport;
  try {
    cycle = runCycle({
      store: cp.store,
      render,
      // schemas INTERFACE-GAPS §6: sleep owns the cadence, schemas the verdict.
      // Under observer the phase hands `apply: false` and this is a dry run.
      fade: (f) =>
        cp.schemas.fadeSweep(f.day, { date: f.date, dryRun: !f.apply, limit: f.budget }),
      // Cards are born where names are (2026-10-11, Group 3 part D): the
      // night's name tally, judged by `mention()`, a nightly budget at most.
      births: (b) => cp.schemas.birthsFromNames(b.day, { dryRun: !b.apply, limit: b.budget }),
      date,
      ...(composeBudget === null ? {} : { budgetBytes: composeBudget }),
      onEvent: (e) => cp["relay"]("sleep", e),
    });
  } catch (err) {
    // A cycle that THREW still leaves a row. `CycleKilled` — a process kill
    // wearing an exception's clothes — is the one thing `sleep/` deliberately
    // does not paper over, so the rows are written and the throw continues on
    // its way: the boundary's contract is unchanged, and the evidence that the
    // cycle started and died is no longer only in a ring that died with it.
    const collected = cp["takeBriefingEvents"]();
    cp["recordSleepCycle"](null, date, collected, errCode(err), cyclePartial(err));
    cp["recordSelfBriefing"](collected, date);
    throw err;
  }
  const briefingEvents = cp["takeBriefingEvents"]();
  cp["recordSleepCycle"](cycle, date, briefingEvents, null);
  cp["recordSelfBriefing"](briefingEvents, date);
  if (briefingEvents.some((e) => e.name === BRIEFING_PUBLISHED_EVENT)) {
    if (behind !== null) noteWakeCaught(cp.store, behind.raw);
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
    episodesIngested: episodes.ingested + episodes.regrown,
  });
  return { sweeps, edges, contiguity, carried, cycle, budgetBytes, episodes };
}

export function contiguityPass(cp: Counterpart): ContiguityPass {
  return cp["bufferContiguity"]().pass;
}

export function bufferContiguity(cp: Counterpart): { pass: ContiguityPass; pairs: readonly PairDelta[] } {
  const zero: ContiguityPass = {
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
    lostEarlier: 0,
  };
  if (cp.observer) return { pass: { ...zero, reason: "observer" }, pairs: [] };
  try {
    const cursor = readContiguityCursor(cp.store.getMeta(CONTIGUITY_CURSOR_META));
    // THE LAST PASS'S PAIRS NEVER RECORDED (review of #281, finding 3): the
    // cursor carries how many pairs its pass planned until the boundary's
    // row about them lands. Still there now means that process died between
    // moving the cursor and recording its flush — those pairs are lost (at
    // most once, by design), and this pass says so on its row. A crash
    // after the row landed but before the mark was cleared over-reports
    // one pass: the safe direction.
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
    const unread = rows.filter((r) => (cursor === null ? r.bornDay >= day : !(r.at === cursor.at && seen.has(r.id))));
    // THE NIGHTLY RUN'S ROWS ARE NOT THE SESSION'S (review of #281, finding
    // 1): a dream's gists and merges and a reflection's entry carry the
    // launching session's id, but the session did not write them. They are
    // counted (`excluded`), the cursor moves past them, and nothing links
    // to them — the dream proposes, waking use confirms.
    const fresh = unread.filter((r) => !r.nightly);
    const excluded = unread.length - fresh.length;
    const newest = rows.reduce((m, r) => Math.max(m, r.at), 0);
    // Planned first (reads only), so the cursor can carry the count.
    const freshIds = new Set(fresh.map((r) => r.id));
    const sessions = [...new Set(fresh.map((r) => r.session))].sort();
    const deltas: PairDelta[] = [];
    let timed = 0;
    let batch = 0;
    let underFloor = 0;
    for (const session of sessions) {
      const plan = planContiguity(
        cp.store.memoriesOfSession(session).map((r) => ({ id: r.id, at: r.at, fresh: freshIds.has(r.id) })),
        cp.associate.tunables,
      );
      deltas.push(...plan.deltas);
      timed += plan.timed;
      batch += plan.batch;
      underFloor += plan.underFloor;
    }
    cp.store.setMeta(
      CONTIGUITY_CURSOR_META,
      JSON.stringify({
        at: newest,
        ids: rows.filter((r) => r.at === newest).map((r) => r.id),
        ...(deltas.length > 0 ? { pending: deltas.length } : {}),
      }),
    );
    if (fresh.length === 0) return { pass: { ...zero, excluded, lostEarlier }, pairs: [] };
    // After the cursor moved, so a crash cannot propose these twice (and a
    // proposal raises to at least its weight, so a second one adds nothing).
    const atWrite = cp["linkAtWrite"](fresh, day);
    const buffered = cp.associate.contiguity(deltas);
    // The mark counts pairs that could be LOST, which is the pairs buffered:
    // a pair refused here (pinned or dead endpoint) is counted as `frozen`
    // or `blocked` on this pass and was never in the buffer to lose.
    if (buffered.pairs !== deltas.length) {
      cp.store.setMeta(
        CONTIGUITY_CURSOR_META,
        JSON.stringify({
          at: newest,
          ids: rows.filter((r) => r.at === newest).map((r) => r.id),
          ...(buffered.pairs > 0 ? { pending: buffered.pairs } : {}),
        }),
      );
    }
    const out: ContiguityPass = {
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
      ...(atWrite === null ? {} : { atWrite }),
    };
    cp["emit"]("counterpart.associate.contiguity", undefined, {
      ...out,
      atWrite: atWrite === null ? null : atWrite.landed,
    } as Record<string, string | number | boolean | null>);
    return { pass: out, pairs: buffered.accepted };
  } catch (err) {
    const code = errCode(err);
    cp["emit"]("counterpart.associate.contiguity.failed", undefined, { code });
    return { pass: { ...zero, reason: "failed", code }, pairs: [] };
  }
}

/**
 * WRITE-TIME LINKS for the memories one contiguity pass read (Group 4 item
 * 2, 2026-10-11; tightened by the reviewer of #423). Only a memory written
 * IN THE MOMENT, through the jot door (`submitJot`, the note tool), has
 * something in mind: what recall showed its session on the write's own turn
 * (the last `WRITE_LINK_TURNS` turns at the boundary, which runs at every
 * reply's end), the loud one before footnotes. A memory written in a
 * session's write-up batch, by the night catch-up, or copied from a chapter
 * gets none: what the session's last turns showed is not what each of those
 * memories was about. A memory shown only through an ambiguous handle
 * (`trains: false`, recall §9 G5) and a handoff are not in mind. What a
 * deliberate question showed within `WRITE_LINK_ASKED_MS` of the write
 * joins first, for any door, when that is above 0 (0, off, by default).
 * `planAtWrite` keeps the first `WRITE_LINK_MAX`; `Associate.propose` lands
 * them at `WRITE_LINK_WEIGHT`, room-only.
 *
 * Null when no memory had anything in mind. Fail-open: a throw is a `failed`
 * pass, and contiguity goes on.
 */
export function linkAtWrite(cp: Counterpart, fresh: readonly { id: string; session: string; at: number; bornDay: number }[], day: number): AtWritePass | null {
  const t = cp.associate.tunables;
  try {
    const memories: { id: string; inMind: string[] }[] = [];
    const jots = cp["jotsAmong"](fresh);
    const asking = t.WRITE_LINK_ASKED_MS > 0;
    const bySession = new Map<string, { recent: string[]; asked: { ref: string; at: number }[] }>();
    const handoff = new Map<string, boolean>();
    const notHandoff = (id: string): boolean => {
      let h = handoff.get(id);
      if (h === undefined) {
        h = isHandoffRow(cp.store, id);
        handoff.set(id, h);
      }
      return !h;
    };
    for (const m of fresh) {
      const jot = jots.has(m.id);
      if (!jot && !asking) continue;
      let mind = bySession.get(m.session);
      if (mind === undefined) {
        const state = cp.recall.gateState(m.session);
        const recent = Object.entries(state.surfaced)
          .filter(([, rec]) => rec.trains && rec.turn > state.turn - t.WRITE_LINK_TURNS)
          .sort((x, y) => y[1].turn - x[1].turn || (x[1].tier === y[1].tier ? 0 : x[1].tier === "surfaced" ? -1 : 1) || (x[0] < y[0] ? -1 : 1))
          .map(([id]) => id);
        let asked: { ref: string; at: number }[] = [];
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
      const near = mind.asked
        .filter((r) => Math.abs(r.at - m.at) <= t.WRITE_LINK_ASKED_MS)
        .sort((x, y) => y.at - x.at || (x.ref < y.ref ? -1 : 1))
        .map((r) => r.ref);
      const inMind = [...new Set([...near, ...(jot ? mind.recent : [])])].filter(notHandoff);
      if (inMind.length > 0) memories.push({ id: m.id, inMind });
    }
    const plan = planAtWrite(memories, t);
    if (plan.pairs.length === 0) return null;
    const r = cp.associate.propose(plan.pairs, t.WRITE_LINK_WEIGHT, day);
    return {
      reason: r.reason === "failed" ? "failed" : r.pairs > 0 ? "linked" : "nothing-in-mind",
      memories: plan.memories,
      pairs: plan.pairs.length,
      landed: r.pairs,
      noRoom: r.noRoom,
      blocked: r.blocked,
      frozen: r.frozen,
      ...(r.code === undefined ? {} : { code: r.code }),
    };
  } catch (err) {
    const code = errCode(err);
    cp["emit"]("counterpart.associate.atwrite.failed", undefined, { code });
    return { reason: "failed", memories: 0, pairs: 0, landed: 0, noRoom: 0, blocked: 0, frozen: 0, code };
  }
}

/**
 * Which of these new memories came through the JOT door (reviewer of #423,
 * 2026-10-11), read from the gate's deposit rows (`GATE_DEPOSIT_EVENT`: its
 * `source` and `memoryId`), which a deposit writes as it mints. A memory
 * with no such row (a chapter copy, a row whose ledger write failed) reads
 * as not a jot, so it gets no write-time window: the safe direction.
 */
export function jotsAmong(cp: Counterpart, fresh: readonly { id: string; bornDay: number }[]): Set<string> {
  const out = new Set<string>();
  if (fresh.length === 0) return out;
  const want = new Set(fresh.map((m) => m.id));
  const since = fresh.reduce((d, m) => Math.min(d, m.bornDay), Number.POSITIVE_INFINITY);
  for (const row of cp.store.eventLog({ name: GATE_DEPOSIT_EVENT, sinceDay: since, order: "desc", limit: 10_000 })) {
    try {
      const p = JSON.parse(row.payload ?? "{}") as { source?: unknown; memoryId?: unknown };
      if (p.source === "jot" && typeof p.memoryId === "string" && want.has(p.memoryId)) out.add(p.memoryId);
    } catch {
      /* an unreadable row names no jot */
    }
  }
  return out;
}

/**
 * What the boundary's buffered contiguity pairs BECAME once its flush
 * landed (review of #281, findings 2 and 9). `landed`: pairs with a link
 * that conducts in at least one direction now — a pair whose new link was
 * the weakest at a full node and evicted in the same flush, or whose deltas
 * were swept under the floor, did not land. `evictedOwn`: those evictions of
 * the pair's own new link. `evictedOther`: links OTHER than a contiguity
 * pair's own that the count cap pushed out at a node contiguity touched —
 * possibly waking-learned ones, which is what the owner watches.
 * `renormalizedNodes`: nodes contiguity touched that the outgoing bound
 * scaled back. Exact when the in-process buffer held only contiguity, as it
 * does on the host (co-use arrives through the pending file and flushes on
 * its own); for a single-process caller that also co-activated in-process,
 * the eviction and scaling counts are attributed to contiguity's nodes.
 */
export function contiguityOutcome(cp: Counterpart, planned: { pass: ContiguityPass; pairs: readonly PairDelta[] }, edges: FlushReport): ContiguityPass {
  const { pass, pairs } = planned;
  if (pairs.length === 0) return pass;
  if (edges.reason !== "flushed") return { ...pass, landed: 0, evictedOwn: 0, evictedOther: 0, renormalizedNodes: 0 };
  const keys = new Set(pairs.map((p) => pairKey(p.a, p.b)));
  const ends = new Set(pairs.flatMap((p) => [p.a, p.b]));
  let landed = 0;
  try {
    for (const p of pairs) {
      if (cp.associate.weightAt(p.a, p.b, edges.day) > cp.associate.tunables.EDGE_FLOOR ||
          cp.associate.weightAt(p.b, p.a, edges.day) > cp.associate.tunables.EDGE_FLOOR) landed += 1;
    }
  } catch (err) {
    cp["emit"]("counterpart.associate.contiguity.outcome.failed", undefined, { code: errCode(err) });
  }
  let evictedOwn = 0;
  let evictedOther = 0;
  for (const e of edges.evictions) {
    if (keys.has(pairKey(e.src, e.dst))) evictedOwn += 1;
    else if (ends.has(e.src)) evictedOther += 1;
  }
  const renormalizedNodes = (edges.renormalizedNodes ?? []).filter((n) => ends.has(n)).length;
  return { ...pass, landed, evictedOwn, evictedOther, renormalizedNodes };
}

/**
 * The boundary's own flush, on the durable log (2026-09-28) — the same
 * `associate.flush` row the carried claims write, with `source: "boundary"`
 * and what contiguity did. When the flush flushed something (or failed), for
 * the reason `ASSOCIATE_FLUSH_EVENT` gives — and, since the review of #281
 * (finding 3), ALSO when contiguity itself has something to say that no
 * other row would: the pass failed, it buffered pairs this flush did not
 * write (busy), or an earlier pass's pairs were lost. The same row shape,
 * so no new event name; `rows` 0 on those. Never throws; true when a row
 * landed, which is what clears the cursor's pending mark.
 */
export function recordBoundaryFlush(cp: Counterpart, edges: FlushReport, contiguity: ContiguityPass, session?: string): boolean {
  const flushed = edges.reason === "flushed" || edges.reason === "failed";
  const atWrite = contiguity.atWrite;
  const contiguitySays =
    contiguity.reason === "failed" || contiguity.buffered > 0 || contiguity.lostEarlier > 0 || (atWrite !== undefined && atWrite.pairs > 0);
  if (!flushed && !contiguitySays) return false;
  const data: Record<string, unknown> = {
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
    // Of them, rows with an end archived for good (Group 4 item 5).
    ...(edges.sweptArchived === undefined ? {} : { sweptArchived: edges.sweptArchived }),
    dropped: edges.dropped,
    pendingDropped: 0,
    corrupt: 0,
    stuck: 0,
    oldestMs: 0,
    ...rowIds(edges.linkedIds ?? []),
    ...(session === undefined ? {} : { session }),
    contiguity: {
      reason: contiguity.reason,
      ...(contiguity.code === undefined ? {} : { code: contiguity.code }),
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
      renormalizedNodes: contiguity.renormalizedNodes ?? 0,
    },
    ...(atWrite === undefined ? {} : { atWrite: { ...atWrite } }),
    // LINKS LAID (2026-10-11, Group 4 item 7): pairs that landed as a link —
    // contiguity's, the write-time links', and any co-use this process
    // buffered itself — not `rows` (both directions, plus every sibling a
    // touched node's decay rewrote).
    deposited:
      (contiguity.landed ?? 0) +
      (atWrite?.landed ?? 0) +
      (edges.reason === "flushed" ? Math.max(0, edges.pairs - contiguity.buffered - edges.blocked) : 0),
  };
  if (edges.code !== undefined) data["error"] = edges.code;
  try {
    cp.store.appendEvent({ name: ASSOCIATE_FLUSH_EVENT, day: edges.day, payload: data });
    return true;
  } catch (err) {
    cp["emit"]("counterpart.associate.flush.unrecorded", undefined, { code: errCode(err) });
    return false;
  }
}

/** The row about this boundary's contiguity landed: clear the cursor's
 *  pending mark, so the next pass does not count these pairs as lost. A
 *  failure here over-reports one pass as lost later — the safe direction. */
export function clearContiguityPending(cp: Counterpart): void {
  try {
    const cursor = readContiguityCursor(cp.store.getMeta(CONTIGUITY_CURSOR_META));
    if (cursor === null || cursor.pending === 0) return;
    cp.store.setMeta(CONTIGUITY_CURSOR_META, JSON.stringify({ at: cursor.at, ids: cursor.ids }));
  } catch (err) {
    cp["emit"]("counterpart.associate.contiguity.pending.failed", undefined, { code: errCode(err) });
  }
}

export function rebrief(cp: Counterpart, input: { budgetBytes?: number; at?: string } = {}): RebriefReport {
  return cp["republish"](input, "rebrief", []);
}

export function refreshWake(cp: Counterpart, input: { budgetBytes?: number; at?: string; trigger?: WakeTrigger } = {}): WakeRefreshReport {
  const pending = [...(wakeBehind(cp.store)?.triggers ?? [])];
  if (!pending.includes("version") && wakeFromOtherBuild(cp.store, BRIEFING_KEY, cp["build"])) pending.push("version");
  const triggers = input.trigger === undefined || pending.includes(input.trigger) ? [...pending] : [...pending, input.trigger];
  if (triggers.length === 0) return { reason: "current", triggers, day: cp.store.livedDay(), bytes: 0 };
  const report = cp["republish"](input, "refresh", triggers);
  return {
    reason: !report.rendered ? "no-budget" : report.published ? "rendered" : "observer",
    triggers,
    day: report.day,
    bytes: report.bytes,
  };
}

/** `rebrief` and `refreshWake`, which differ only in the row's reason. */
export function republish(
  cp: Counterpart,
  input: { budgetBytes?: number; at?: string },
  why: "rebrief" | "refresh",
  triggers: readonly WakeTrigger[],): RebriefReport {
  const budgetBytes = input.budgetBytes ?? cp["reportedBudget"];
  if (input.budgetBytes !== undefined) cp["reportedBudget"] = input.budgetBytes;
  const day = cp.store.livedDay();
  if (budgetBytes === null) {
    // The §2.18 refusal, here as everywhere: an invented ceiling publishes a
    // briefing the host silently truncates.
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
      counts: {},
    };
  }
  const work = cp["workReserveBytes"](budgetBytes);
  const handoff = cp["handoffRoom"](budgetBytes);
  const composeBudget = Math.max(budgetBytes - cp["wakeReserveBytes"](budgetBytes, work, handoff.reserve), 0);
  const render = selfRenderer(cp.self, {
    prospective: cp.prospective,
    ...(input.at === undefined ? {} : { at: input.at }),
    ...cp["yesterdayFor"](input.at),
    // Lent to the lanes above them, in `self/briefing.ts#ROOM_ORDER`.
    lendBytes: work,
    handoffLendBytes: handoff.lend,
    handoffKeepBytes: handoff.keep,
    ceilingBytes: budgetBytes,
    onEvent: (name, data) => cp["emit"](name, undefined, data),
  });
  // Read before the render, as the boundary reads it (`self/behind.ts`).
  const behind = wakeBehind(cp.store);
  // The collector, armed here for the same reason it is armed at a boundary:
  // a rebrief RENDERS, TRIMS AND PUBLISHES, so without a row of its own the
  // last `self.briefing` in the store describes a bundle that is no longer the
  // published one — the log would be reporting a wake nobody is reading.
  cp["briefingEvents"] = [];
  let out: { bytes?: number; elements?: number };
  let collected: readonly CounterpartEvent[] = [];
  try {
    out = render({
      store: cp.store,
      day,
      observer: cp.observer,
      budgetBytes: composeBudget,
    }) ?? { bytes: 0, elements: 0 };
  } finally {
    collected = cp["takeBriefingEvents"]();
  }
  // `rebrief` or `refresh`, not `rendered`: the boundary's row is the DAY's
  // record, and these are the owner pulling the lever mid-day and the wake
  // catching up to a write. A reader counting wake renders per day must be
  // able to tell them apart.
  // The caller's date when it passed one: every row a run writes carries the
  // run's one date (review of #287).
  cp["recordSelfBriefing"](collected, input.at ?? cp.store.today(), why, triggers);
  if (collected.some((e) => e.name === BRIEFING_PUBLISHED_EVENT)) {
    if (behind !== null) noteWakeCaught(cp.store, behind.raw);
    noteWakeBuild(cp.store, cp["build"]);
  }
  // The lane counts as the RENDER recorded them — the one place they exist,
  // rather than a second count taken here that could disagree with the event.
  const last = cp.self.events("self.briefing.rendered").pop();
  const counts: Record<string, number> = {};
  for (const lane of LANE_ORDER) {
    const n = last?.data?.[lane];
    counts[lane] = typeof n === "number" ? n : 0;
  }
  cp["emit"]("counterpart.rebrief", undefined, {
    why,
    ...(triggers.length === 0 ? {} : { triggers: triggers.join(",") }),
    day,
    budgetBytes,
    composeBudget,
    bytes: out.bytes ?? 0,
    elements: out.elements ?? 0,
    observer: cp.observer,
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
    counts,
  };
}

/** Disarm the collector and hand back what it caught. See the field's note. */
export function takeBriefingEvents(cp: Counterpart): readonly CounterpartEvent[] {
  const out = cp["briefingEvents"] ?? [];
  cp["briefingEvents"] = null;
  return out;
}

/**
 * ONE durable row per cycle run (`SLEEP_CYCLE_EVENT`, IMPROVEMENTS U9).
 *
 * Written from the `CycleReport` and from nothing else: this root re-derives
 * no phase verdict and invents no status vocabulary — `phase`, `status` and
 * `reason` are copied off the report verbatim, so a phase whose outcome
 * `sleep/` renames renames itself here too. A failed phase carries `code`
 * beside them, because `reason` for a failure is the literal word `failed` and
 * the WHY is in the report's `error`.
 *
 * Guarded exactly as `recordSweepGate` is: an observer writes nothing, and an
 * append that fails costs the ROW and never the boundary.
 */
export function recordSleepCycle(
  cp: Counterpart,
  report: CycleReport | null,
  date: string,
  briefing: readonly CounterpartEvent[],
  threwCode: string | null,
  partial: CyclePartial | null = null,): void {
  if (cp.observer) return;
  // On the throw path there is no report, and the phases that DID reach a
  // verdict come out attached to the error (`sleep/types.ts#CyclePartial`).
  // Everything the cycle never got round to counting is written as null rather
  // than 0 below, so a night that died after seven phases can never be read as
  // a quiet clean one.
  const source = report?.phases ?? partial?.phases ?? [];
  const known = report !== null;
  const phases = source.map((p) => ({
    phase: p.phase,
    status: p.status,
    reason: p.reason,
    ...(p.error === undefined ? {} : { code: p.error }),
    // THE RECONCILIATION COUNT, on the one phase that has one (U8). Ids-only
    // like everything else here — a number of rows, never a row. It is on the
    // decay entry of every cycle that ran the phase, 0 included, because "the
    // table had nothing wrong" and "this row cannot tell you" are different
    // facts; a phase that did not run carries no field at all.
    ...(p.reconciled === undefined ? {} : { reconciled: p.reconciled }),
    // WHETHER THE PHASE RAN OUT OF ROAD. The report has carried this since the
    // budgets existed and nothing durable copied it, so the store could not
    // say that a phase had stopped at its cap — which is how a consolidate
    // pass examining a third of the store stayed invisible for two weeks
    // (`docs/promotion-diagnosis-2026-09-17.md`, scar §2.4's shape again).
    //
    // ONLY ON A PHASE THAT RAN, and `false` there is a real measurement: it
    // had room. A phase that never ran — not due this cadence, no render fn,
    // failed — has no answer to give, and `false` on it would read as "it had
    // room" when what is true is "this row cannot tell you". The cycle report
    // carries a plain boolean because its skeleton needs one; the durable row
    // is where the distinction has to survive. The count of rows not reached
    // rides only the phases that left some, so a quiet night's row stays small.
    ...(p.status === "ran" || p.status === "ran-nothing-found"
      ? { budgetExhausted: p.budgetExhausted }
      : {}),
    ...(p.skippedForBudget === 0 ? {} : { skippedForBudget: p.skippedForBudget }),
    // WHAT THE PHASE TURNED AWAY, BY REASON (2026-09-20, E2).
    //
    // `PhaseReport.skipped` has carried this since the phases had budgets —
    // consolidate mirrors physics' whole `blockedBy` vocabulary into it as
    // `promotion:<reason>` — and this row threw it away, so "why did this not
    // promote" stayed unanswerable once the worker exited (mechanism
    // inventory §1: the system records what happened and almost never records
    // what was prevented). It is the value the phase already computed; no new
    // read, nothing new on any path.
    //
    // ONLY THE NONZERO ENTRIES. Every phase pre-seeds its whole vocabulary
    // with zeroes so a category can never go missing, and writing eight zeroes
    // per phase every boundary is how a log gets too big to read. A category
    // absent here was not counted; the phase's `status` and `examined` are
    // what say whether it was reached at all.
    ...(nonzero(p.skipped) === null ? {} : { skipped: nonzero(p.skipped) }),
  }));
  const clock = source.find((p) => p.phase === CLOCK_PHASE) ?? null;
  const clockFailed = clock !== null && clock.status === "failed";
  // WHY this row exists, always present. `ran` is an ordinary cycle whatever
  // it found; `clock-failed` is a cycle that ran on the day the store already
  // believed in because the date would not advance; `threw` is a cycle that
  // died — `CycleKilled`, the watchdog's hard kill — and left this row on its
  // way out. An OBSERVER never reaches here: an instrument writes nothing.
  const reason = threwCode !== null ? "threw" : clockFailed ? "clock-failed" : "ran";
  // The failures AMONG THE PHASES THIS ROW NAMES. On the throw path that is
  // every phase that reached a verdict, which is what the row claims to be.
  const failed = phases.filter((p) => p.status === "failed").length;
  let durable = true;
  try {
    // EVERYTHING that touches the store is inside this try, the payload's own
    // `day` read included. On the throw path the caller's exception is already
    // in flight, and a recorder that threw a SECOND one here would replace the
    // `CycleKilled` the boundary is required to propagate.
    cp.store.appendEvent({
      name: SLEEP_CYCLE_EVENT,
      day: cp.store.livedDay(),
      payload: {
        reason,
        code: threwCode ?? (clockFailed ? clock.error ?? null : null),
        // The CALENDAR date, always known here: `sessionEnd` resolves it once
        // and hands the same string to the cycle and to this row, so unlike
        // `sweep.gate` there is no null hole to attribute around.
        date,
        day: report?.day ?? cp.store.livedDay(),
        // EVERY phase by name, in the order the cycle executed them, so "which
        // phase failed" is answerable from the row rather than from a ring. On
        // a throw these are the phases that finished; `started` says how many
        // the cycle had entered, so a phase that died mid-body is visible as
        // the difference rather than as an absence.
        phases,
        started: (report?.order ?? partial?.order ?? []).length,
        // WHERE THE KILL LANDED, when the thrower said (`CycleKilled` does).
        failedPhase: partial?.phase ?? null,
        stage: partial?.stage ?? null,
        // NULL, NOT 0, for anything this run never finished counting. A zero
        // here would read as "nothing was promoted, nothing failed" of a night
        // that died before it could know either (scar §2.4).
        promoted: known ? report.promoted.length : null,
        pruned: known ? report.pruned.length : null,
        merged: known ? report.merged.length : null,
        faded: known ? report.faded.length : null,
        bandUp: known ? report.bandTransitions.filter((t) => t.direction === "up").length : null,
        bandDown: known
          ? report.bandTransitions.filter((t) => t.direction === "down").length
          : null,
        failed,
        // Briefing elements trimmed, from the render's own summary — 0 when the
        // briefing phase did not render at all, which `phases` disambiguates.
        trimmed: numberField(renderedEvent(briefing), TRIMMED_FIELD) ?? 0,
      },
    });
  } catch (err) {
    durable = false;
    cp["emit"]("counterpart.sleep.cycle.failed", undefined, { code: errCode(err) });
  }
  cp["emit"]("counterpart.sleep.cycle", undefined, {
    reason,
    day: report?.day ?? null,
    failed,
    durable,
  });
}

/**
 * ONE durable row per wake render (`SELF_BRIEFING_EVENT`, IMPROVEMENTS U9).
 *
 * No render, no row: the briefing phase is cadenced daily, so a second
 * boundary on one lived day renders nothing and this writes nothing — an
 * absence that `sleep.cycle`'s own `phases` already explains by name. A
 * render between boundaries writes its own row: `rebrief` (the owner's
 * lever) or `refresh` with its `triggers` (`refreshWake`).
 *
 * Ids and counts. The trim list is capped at `self/`'s
 * `BRIEFING_TRIM_LOG_CAP` with the full number beside it, so a capped list is
 * never mistaken for the whole of it. Never briefing text.
 */
export function recordSelfBriefing(
  cp: Counterpart,
  briefing: readonly CounterpartEvent[],
  date: string,
  reason: "rendered" | "rebrief" | "refresh" = "rendered",
  triggers: readonly WakeTrigger[] = [],): void {
  if (cp.observer) return;
  const rendered = renderedEvent(briefing);
  if (rendered === null) return;
  const trims = briefing.filter((e) => e.name === TRIM_EVENT);
  const bytes = numberField(rendered, "bytes") ?? 0;
  let durable = true;
  try {
    // Same rule as the cycle row above: every store read is inside the try,
    // so a recorder can never be what throws out of a boundary.
    cp.store.appendEvent({
      name: SELF_BRIEFING_EVENT,
      day: cp.store.livedDay(),
      payload: {
        reason,
        // WHAT PUT THE WAKE BEHIND, on a `refresh` (2026-09-30): the page
        // written, a write-up landed, the nightly run ended.
        ...(triggers.length === 0 ? {} : { triggers: [...triggers] }),
        date,
        day: numberField(rendered, "day") ?? cp.store.livedDay(),
        bytes,
        budget: numberField(rendered, "budget") ?? 0,
        // What RENDERED, per lane, read off the render's own summary rather
        // than recounted here — `rebrief()` reads the same event, for the same
        // reason: one place the lane counts exist.
        counts: Object.fromEntries(
          LANE_ORDER.map((lane) => [lane, numberField(rendered, lane) ?? 0]),
        ),
        trimmed: trims.slice(0, BRIEFING_TRIM_LOG_CAP).map((e) => ({
          id: e.ref ?? null,
          lane: stringField(e, "lane"),
        })),
        trimmedTotal: trims.length,
        // PER LANE, uncapped (2026-10-10): what doctor's Wake line reads to
        // say a dated item went unlisted ("Arriving:", `horizon`) — the list
        // above is capped, and the trim order puts that lane near its end.
        trimmedLanes: Object.fromEntries(
          LANE_ORDER.map((lane) => [lane, trims.filter((e) => stringField(e, "lane") === lane).length] as const).filter(([, n]) => n > 0),
        ),
        // THE SELF PAGE'S RUNG (2026-10-10, `self/briefing.ts#PageRung`): what
        // this wake printed of the page, and its size — what doctor's Self
        // page line reports. Absent when the store has no page.
        ...((stringField(rendered, "pageRung") ?? "") === ""
          ? {}
          : {
              page: {
                rung: stringField(rendered, "pageRung"),
                bytes: numberField(rendered, "page") ?? 0,
                whole: numberField(rendered, "pageWhole") ?? 0,
              },
            }),
      },
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
    durable,
  });
}
