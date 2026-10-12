/**
 * `associate/` — Hebbian linking and spreading activation.
 *
 * Memories credited together in one turn become linked; recall spreads activation
 * across those links. The module's spine:
 *
 *   `tunables.ts`  every knob, in one visible place (CAL where uncalibrated)
 *   `edges.ts`     the edge arithmetic — increment, cap, lived-day decay, homeostasis
 *   `buffer.ts`    the DECLARED durability exemption: per-turn deltas in memory
 *   `spread.ts`    a pure traversal `recall/` consumes as its hop channel
 *   `contiguity.ts` a pure planner: memories a session made next to each other
 *                  (temporal contiguity, 2026-09-28)
 *   `at-write.ts`  a pure planner: a new memory's faint links to what was in
 *                  mind when it was written (2026-10-11)
 *   `index.ts`     the binding: observer stance, the flush ordering, telemetry
 *
 * Three properties are structural here and worth stating at the top:
 *
 * **OBSERVERS TRAIN NOTHING, checked before any other work** (contract G7, scar
 * E7). `coactivate()` under an observer stance does not evaluate eligibility, does
 * not compute a delta, and does not touch the buffer — an instrument leaves the
 * graph exactly as it found it. The stand-down is EVENTED, because a stood-down
 * instrument must be distinguishable from a broken hook.
 *
 * **AT MOST ONCE, and the direction of the failure is CHOSEN** (contract G4).
 * `flush()` drains the buffer FIRST and publishes SECOND, and it never restores a
 * drained batch. A crash between the two loses one flush's deltas; there is no
 * ordering in which the same delta lands twice. Restore-on-failure is precisely
 * the trap — if the write landed and the throw came afterwards, a restored buffer
 * double-applies on retry, which is the inversion v1 shipped. Bounded loss is
 * inside tolerance; doubling is what the contract rules out.
 *
 * **A FAILED PUBLISH EMITS NO SUCCESS EVENT** (contract G6, scar §2.4). The
 * `associate.flush.done` event is emitted after `linkMany` returns, never before,
 * and the failure arm emits `associate.flush.failed` with the dropped count.
 */
import type { EdgeInput, EdgeRow, MemoryRow } from "../store/index.js";
import type { UseTier } from "../physics/index.js";
import { DeltaBuffer } from "./buffer.js";
import { conducts, edgeWeightAt, isDead, planFlush, planProposal } from "./edges.js";
import type { EdgeState, Eviction, PairDelta } from "./edges.js";
import { spread } from "./spread.js";
import type { Seed, SpreadResult } from "./spread.js";
import { pairCredit, tierFactor, withTunables } from "./tunables.js";
import type { AssociateTunables } from "./tunables.js";

export * from "./at-write.js";
export * from "./buffer.js";
export * from "./contiguity.js";
export * from "./edges.js";
export * from "./pending.js";
export * from "./spread.js";
export * from "./tunables.js";

/**
 * The narrow store seam this module needs — six members, all of which `Store`
 * already has, plus one optional sweep. Narrow on purpose: it names the whole
 * surface associate can reach (the only removal on it is the sweep of rows that
 * already carry nothing), and it makes the crash points reachable in a test
 * without a real database standing in for one.
 */
export interface AssociateStore {
  /** The ONE observer predicate, already derived by the store. Never re-derived
   *  here — a second definition is the leak `docs/observer-mode.md` G7 names. */
  readonly observer: boolean;
  livedDay(): number;
  row(id: string): MemoryRow | undefined;
  deniedIds(): string[];
  edgesFrom(src: string): EdgeRow[];
  linkMany(edges: readonly EdgeInput[]): void;
  /**
   * Remove the edge rows `dead` says carry nothing (2026-09-28): the zeroed rows
   * an eviction leaves and the ones decayed to the floor. Optional on the seam,
   * so a store without it simply keeps its dead rows — they conduct nothing
   * either way. Returns how many rows went.
   */
  sweepEdges?(filter: { floor: number; staleOnOrBefore: number }, dead: (e: EdgeRow) => boolean): number;
  /**
   * Remove the rows with an endpoint archived for one of `reasons`
   * (2026-10-11, `TERMINAL_ARCHIVE_REASONS`). Optional, like the sweep: a
   * store without it keeps those rows, which conduct nothing either way.
   */
  sweepArchivedEdges?(reasons: readonly string[], graceMs?: number): number;
}

/**
 * ARCHIVED FOR GOOD (2026-10-11, Group 4 item 5; review 06 C3): the archive
 * reasons whose memory never conducts again AND whose links were carried to
 * what replaced it when it was archived — a regrown chapter copy (to the live
 * copy, NOTES §15) and a dream merge's originals (to the merged memory; a
 * dream's undo carries them back). Their rows are swept after every flush.
 * NOT here: a decay archive, so a memory that comes back keeps its trails;
 * and `corrected`, whose settle does not carry its links today and whose
 * undo brings it back — sweeping it would drop them.
 */
export const TERMINAL_ARCHIVE_REASONS: readonly string[] = ["episode-regrown", "dream-merge"];

/**
 * How long ago such an end must have been archived before its rows go
 * (reviewer of #423, 2026-10-11): both paths archive first and carry the
 * links a moment later, so a flush from another process in between must not
 * take rows still to be carried. Ten minutes is far beyond that moment.
 */
export const TERMINAL_ARCHIVE_GRACE_MS = 10 * 60_000;

/** Telemetry: ids, counts, weights, reasons. NEVER body text or turn text. */
export interface AssociateEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface AssociateOptions {
  store: AssociateStore;
  /** Overrides on the CAL table. Every one is a calibration claim (scar §2.8). */
  tunables?: Partial<AssociateTunables>;
  onEvent?: (e: AssociateEvent) => void;
}

/** One memory that was credited this turn, with the tier the boundary resolved. */
export interface Credited {
  readonly id: string;
  readonly tier: UseTier;
}

export type MemberReason =
  | "eligible"
  | "ignorable-tier"
  | "unknown-id"
  | "removed"
  | "archived"
  | "superseded"
  | "frozen-protected";

export interface MemberVerdict {
  readonly id: string;
  readonly reason: MemberReason;
}

export type CoactivateReason = "buffered" | "observer" | "too-few-members";

export interface CoactivateResult {
  readonly reason: CoactivateReason;
  /** Pairs whose delta was added to the buffer. */
  readonly pairs: number;
  /** Per-member verdicts — every exclusion names WHY (scar §2.4). */
  readonly members: readonly MemberVerdict[];
  readonly buffered: number;
}

export type FlushReason = "flushed" | "observer" | "nothing-buffered" | "busy" | "failed";

export interface FlushReport {
  readonly reason: FlushReason;
  readonly day: number;
  /** Pairs drained from the buffer. */
  readonly pairs: number;
  /** Absolute edge rows written. */
  readonly rows: number;
  readonly evictions: readonly Eviction[];
  readonly renormalized: number;
  /** Which nodes were scaled back, on a flush that landed (2026-09-28) — so a
   *  caller can say which of its deltas pushed a node to its bound. */
  readonly renormalizedNodes?: readonly string[];
  /** The memories this flush wired together — both ends of every pair that
   *  passed the boundary's re-check, distinct, in first-seen order — on a
   *  flush that landed (2026-10-11, for the `associate.flush` row's `ids`). */
  readonly linkedIds?: readonly string[];
  readonly nodesTouched: number;
  /** Pairs dropped because an endpoint stopped conducting between the turn and
   *  the boundary — archived, superseded, or taken dark. */
  readonly blocked: number;
  /** Deltas that were drained and did NOT land. Non-zero only in the failure
   *  arm, where it is the chosen direction, counted rather than hidden. */
  readonly dropped: number;
  readonly error?: string;
  /** The failure's stable CODE — the store's own where it has one, the error's
   *  name otherwise. `error` above is the message, which is for a human reading
   *  a report; a durable row takes this instead (store §5 G10). */
  readonly code?: string;
  /** Dead rows (zeroed by an eviction, or decayed to the floor) the flush swept
   *  away after it landed (2026-09-28). */
  readonly swept: number;
  /** Of `swept`, rows with an endpoint archived for good
   *  (`TERMINAL_ARCHIVE_REASONS`, 2026-10-11). Absent when none went. */
  readonly sweptArchived?: number;
}

/** What buffering one pass of temporal contiguity did (2026-09-28). */
export interface ContiguityReport {
  readonly reason: "buffered" | "observer" | "nothing-to-link";
  /** Pair deltas buffered for the next flush. */
  readonly pairs: number;
  /** Pairs refused because an endpoint is not live memory. */
  readonly blocked: number;
  /** Pairs refused because an endpoint is pinned (G9). */
  readonly frozen: number;
  /** The pairs buffered, so a caller can say after the flush which landed. */
  readonly accepted: readonly PairDelta[];
}

export type ProposeReason = "linked" | "no-room" | "observer" | "nothing-to-link" | "failed";

/** What a proposed link did (a dream's `link`, a gist's sources — 2026-09-28). */
export interface ProposeReport {
  readonly reason: ProposeReason;
  readonly day: number;
  /** Pairs that LANDED (or were already at least the proposal). */
  readonly pairs: number;
  /** The pairs that landed, in the order proposed. */
  readonly landed: readonly { a: string; b: string }[];
  readonly rows: number;
  /** Pairs refused because an endpoint had no room (count cap or outgoing
   *  bound) — a proposal never evicts or scales down to make room. */
  readonly noRoom: number;
  /** Pairs refused because an endpoint is not live memory. */
  readonly blocked: number;
  /** Pairs refused because an endpoint is pinned (G9: frozen both ways). */
  readonly frozen: number;
  readonly code?: string;
}

/** A code for telemetry, never the message: the store's `code` where there is
 *  one, the error's name otherwise (store §5 G10 — messages can quote prose). */
function codeOf(err: unknown): string {
  if (err !== null && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "UNKNOWN";
}

const EVENT_RING = 200;

/**
 * Lived days for a FULL-weight edge (`EDGE_CAP`) to decay to the floor: any
 * row last written this long ago is dead whatever it weighed, so the sweep's
 * SQL prefilter can name it without the curve. Found by stepping the curve,
 * so it holds for any shape.
 */
export function fadeHorizon(t: AssociateTunables): number {
  for (let h = 1; h < 100_000; h++) {
    if (!conducts(edgeWeightAt({ src: "", dst: "", weight: t.EDGE_CAP, lastDay: 0 }, h, t), t)) return h;
  }
  return 100_000;
}

export class Associate {
  readonly tunables: AssociateTunables;
  private readonly store: AssociateStore;
  private readonly buffer = new DeltaBuffer();
  private readonly onEvent: ((e: AssociateEvent) => void) | undefined;
  private readonly ring: AssociateEvent[] = [];
  private flushing = false;

  constructor(opts: AssociateOptions) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables);
    this.onEvent = opts.onEvent;
  }

  /** The stance, read from the store and never re-derived (SEAMS queued item 4). */
  get observer(): boolean {
    return this.store.observer;
  }

  get pending(): number {
    return this.buffer.size;
  }

  // ── the Hebbian update ─────────────────────────────────────────────────────

  /**
   * "Cells that fire together wire together" — the memories a single turn
   * credited become pairwise stronger.
   *
   * Deviations, named (contract §2): credit is retrospective and GRADED, resolved
   * at the boundary with the reply known, and **zero for the merely footnoted** —
   * where in humans every retrieval trains. Nothing lands durably here: this
   * accumulates into the declared buffer, and `flush()` publishes it.
   */
  coactivate(members: readonly Credited[]): CoactivateResult {
    // Guarantee 7: checked FIRST, before eligibility, before arithmetic, before
    // the buffer is even consulted.
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "coactivate", members: members.length });
      return { reason: "observer", pairs: 0, members: [], buffered: this.buffer.size };
    }

    const verdicts: MemberVerdict[] = [];
    const eligible: Credited[] = [];
    const seen = new Set<string>();
    const denied = new Set(this.store.deniedIds());
    for (const m of members) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const reason = this.memberReason(m, denied);
      verdicts.push({ id: m.id, reason });
      if (reason === "eligible") eligible.push(m);
    }

    if (eligible.length < 2) {
      return {
        reason: "too-few-members",
        pairs: 0,
        members: verdicts,
        buffered: this.buffer.size,
      };
    }

    let pairs = 0;
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i] as Credited;
        const b = eligible[j] as Credited;
        const delta = pairCredit(a.tier, b.tier, this.tunables);
        if (delta <= 0) continue;
        this.buffer.add(a.id, b.id, delta);
        pairs += 1;
      }
    }
    this.emit("associate.coactivate", undefined, {
      members: members.length,
      eligible: eligible.length,
      pairs,
      buffered: this.buffer.size,
    });
    return { reason: "buffered", pairs, members: verdicts, buffered: this.buffer.size };
  }

  /**
   * Take the buffer. **Public precisely so the crash point is reachable**: a
   * caller that drains and does not publish has DROPPED those deltas, which is
   * the chosen failure direction stated out loud rather than discovered in
   * production. `flush()` is drain + publish.
   *
   * One other caller drains: the credit pass, which writes what it took to the
   * pending file (`pending.ts`) because the process that can publish it is a
   * different one. Draining and PERSISTING is not dropping — but a drain whose
   * append then fails has dropped them, which is why that caller counts the
   * append's answer (`counterpart.ts#publishCoactivation`).
   */
  drain(): PairDelta[] {
    return this.buffer.drain();
  }

  /**
   * Take deltas another process buffered — the worker's half of the pending
   * file. They go into this process's buffer, so `flush()` publishes them
   * through exactly the same plan, eligibility re-check and eviction path as
   * deltas this process earned itself.
   *
   * An observer absorbs nothing, checked first, like `coactivate` (G7).
   */
  absorb(deltas: readonly PairDelta[]): number {
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "absorb", deltas: deltas.length });
      return 0;
    }
    let added = 0;
    for (const d of deltas) {
      // The buffer ignores these two, so counting them as absorbed would report
      // work that no flush can ever do.
      if ((d.delta <= 0 && (d.back ?? d.delta) <= 0) || d.a === d.b) continue;
      this.buffer.add(d.a, d.b, d.delta, d.back ?? d.delta);
      added += 1;
    }
    return added;
  }

  /**
   * TEMPORAL CONTIGUITY (association build 2, 2026-09-28): buffer the deltas
   * `planContiguity` made for memories one session wrote next to each other.
   * The weak, ubiquitous signal beside co-use's strong one; it goes into the
   * same buffer and out through the same flush, so the count cap, the
   * outgoing bound, decay and the sweep apply exactly as for a co-use.
   *
   * Each endpoint must be live memory and not pinned (G9: frozen both ways) —
   * checked here and again at the flush, as for any delta. An observer
   * buffers nothing, checked first (G7).
   */
  contiguity(deltas: readonly PairDelta[]): ContiguityReport {
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "contiguity", pairs: deltas.length });
      return { reason: "observer", pairs: 0, blocked: 0, frozen: 0, accepted: [] };
    }
    const conductor = this.conductor();
    const accepted: PairDelta[] = [];
    let blocked = 0;
    let frozen = 0;
    for (const d of deltas) {
      if (d.a === d.b) continue;
      if (!conductor(d.a) || !conductor(d.b)) {
        blocked += 1;
        continue;
      }
      if (this.store.row(d.a)?.protected === 1 || this.store.row(d.b)?.protected === 1) {
        frozen += 1;
        continue;
      }
      this.buffer.add(d.a, d.b, d.delta, d.back ?? d.delta);
      accepted.push(d);
    }
    const pairs = accepted.length;
    this.emit("associate.contiguity", undefined, { pairs, blocked, frozen, buffered: this.buffer.size });
    return { reason: pairs > 0 ? "buffered" : "nothing-to-link", pairs, blocked, frozen, accepted };
  }

  /** What is buffered right now — copies, for telemetry and tests. */
  pendingDeltas(): PairDelta[] {
    return this.buffer.pending();
  }

  /**
   * Publish the buffered deltas. The ordering IS the guarantee — see the header.
   *
   * Contention (contract G5) is checked BEFORE the drain, so a busy flush leaves
   * the buffer untouched and stays buffered rather than half-applying. Only
   * in-process contention is enforced here; cross-process exclusion needs a lock
   * the store does not offer (INTERFACE-GAPS.md §3).
   */
  flush(day?: number): FlushReport {
    const d = day ?? this.store.livedDay();
    const empty: FlushReport = {
      reason: "nothing-buffered",
      day: d,
      pairs: 0,
      rows: 0,
      evictions: [],
      renormalized: 0,
      nodesTouched: 0,
      blocked: 0,
      dropped: 0,
      swept: 0,
    };

    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "flush", buffered: this.buffer.size });
      return { ...empty, reason: "observer" };
    }
    if (this.flushing) {
      this.emit("associate.flush.busy", undefined, { buffered: this.buffer.size });
      return { ...empty, reason: "busy", pairs: this.buffer.size };
    }

    this.flushing = true;
    try {
      // ── the point of no return ────────────────────────────────────────────
      const deltas = this.buffer.drain();
      if (deltas.length === 0) return empty;
      return this.publish(deltas, d);
    } finally {
      this.flushing = false;
    }
  }

  private publish(deltas: readonly PairDelta[], day: number): FlushReport {
    const conductor = this.conductor();
    // Re-checked at the boundary, not only at the turn: a memory can be archived,
    // superseded, taken dark, or PINNED between the co-activation and the flush,
    // and an arc that went under audit mid-session must not change (G9).
    const trains = (id: string) => conductor(id) && this.store.row(id)?.protected !== 1;
    const live: PairDelta[] = [];
    let blocked = 0;
    for (const p of deltas) {
      if (trains(p.a) && trains(p.b)) live.push(p);
      else blocked += 1;
    }

    const plan = planFlush(live, day, (id) => this.edgeStates(id), this.tunables);
    const rows: EdgeInput[] = plan.rows.map((r) => ({
      src: r.src,
      dst: r.dst,
      weight: r.weight,
      day: r.lastDay,
    }));

    if (rows.length > 0) {
      try {
        this.store.linkMany(rows);
      } catch (err) {
        // NOT restored. If `linkMany` landed and the throw came after, a restored
        // buffer would double-apply on the next flush — the one outcome the
        // contract rules out. And NO success event: an event claiming an update
        // that never landed is worse than silence (G6).
        this.emit("associate.flush.failed", undefined, {
          day,
          pairs: deltas.length,
          rows: rows.length,
          dropped: live.length,
          error: codeOf(err),
        });
        return {
          reason: "failed",
          day,
          pairs: deltas.length,
          rows: 0,
          evictions: [],
          renormalized: 0,
          nodesTouched: plan.nodesTouched,
          blocked,
          dropped: live.length,
          swept: 0,
          error: err instanceof Error ? err.message : String(err),
          code: codeOf(err),
        };
      }
    }

    for (const ev of plan.evictions) {
      this.emit("associate.edge.evicted", ev.src, {
        dst: ev.dst,
        priorWeight: ev.priorWeight,
        reason: ev.reason,
      });
    }
    // HYGIENE, after the write has landed (2026-09-28): the rows that carry
    // nothing — an eviction's zero, an edge decayed to the floor — are swept,
    // and counted. A sweep that fails costs only the tidying: the flush stands.
    const { swept, archived: sweptArchived } = this.sweep(day);
    this.emit("associate.flush.done", undefined, {
      day,
      pairs: deltas.length,
      rows: rows.length,
      blocked,
      evicted: plan.evictions.length,
      renormalized: plan.renormalized.length,
      swept,
    });
    return {
      reason: "flushed",
      day,
      pairs: deltas.length,
      rows: rows.length,
      evictions: plan.evictions,
      renormalized: plan.renormalized.length,
      renormalizedNodes: plan.renormalized,
      linkedIds: [...new Set(live.flatMap((p) => [p.a, p.b]))],
      nodesTouched: plan.nodesTouched,
      blocked,
      dropped: 0,
      swept,
      ...(sweptArchived > 0 ? { sweptArchived } : {}),
    };
  }

  /**
   * Sweep dead edge rows, then the rows with an endpoint archived for good
   * (2026-10-11); 0 for a half the store lacks or that failed. `swept` is the
   * total, `archived` the second half's share.
   */
  private sweep(day: number): { swept: number; archived: number } {
    let dead = 0;
    let archived = 0;
    if (this.store.sweepEdges !== undefined) {
      try {
        dead = this.store.sweepEdges(
          { floor: this.tunables.EDGE_FLOOR, staleOnOrBefore: day - fadeHorizon(this.tunables) },
          (e) => isDead({ src: e.src, dst: e.dst, weight: e.weight, lastDay: e.last_day }, day, this.tunables),
        );
      } catch (err) {
        this.emit("associate.sweep.failed", undefined, { day, error: codeOf(err) });
      }
    }
    if (this.store.sweepArchivedEdges !== undefined) {
      try {
        archived = this.store.sweepArchivedEdges(TERMINAL_ARCHIVE_REASONS, TERMINAL_ARCHIVE_GRACE_MS);
      } catch (err) {
        this.emit("associate.sweep.failed", undefined, { day, error: codeOf(err), archived: true });
      }
    }
    return { swept: dead + archived, archived };
  }

  // ── proposed links (the dream's, 2026-09-28) ───────────────────────────────

  /**
   * A link somebody PROPOSES rather than one waking use earned: a dream's
   * `link`, a dreamed gist's ties to its sources. It lands now (there is no
   * turn boundary to wait for), under the rules a Hebbian flush obeys — both
   * endpoints live, a pinned memory frozen both ways (G9), each direction
   * raised to at least `weight` from its DECAYED weight — and ONLY WHERE THERE
   * IS ROOM (`planProposal`): a proposal never evicts an edge and never scales
   * one down. Where an endpoint is full (the count cap) or the raise would pass
   * the outgoing bound, that pair is refused `no-room`. The dream proposes,
   * waking use confirms: homeostasis belongs to the Hebbian flush.
   *
   * `weight` defaults to `HEBB_RATE`: about one co-activation. Decay
   * (`S_EDGE`) fades what waking use never confirms.
   */
  propose(pairs: readonly { a: string; b: string }[], weight?: number, day?: number): ProposeReport {
    const d = day ?? this.store.livedDay();
    const empty: ProposeReport = {
      reason: "nothing-to-link",
      day: d,
      pairs: 0,
      landed: [],
      rows: 0,
      noRoom: 0,
      blocked: 0,
      frozen: 0,
    };
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "propose", pairs: pairs.length });
      return { ...empty, reason: "observer" };
    }
    const conductor = this.conductor();
    const live: { a: string; b: string }[] = [];
    const seen = new Set<string>();
    let blocked = 0;
    let frozen = 0;
    for (const p of pairs) {
      if (p.a === p.b) continue;
      const key = p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!conductor(p.a) || !conductor(p.b)) {
        blocked += 1;
        continue;
      }
      if (this.store.row(p.a)?.protected === 1 || this.store.row(p.b)?.protected === 1) {
        frozen += 1;
        continue;
      }
      live.push(p);
    }
    if (live.length === 0) return { ...empty, blocked, frozen };

    const w = weight ?? this.tunables.HEBB_RATE;
    const plan = planProposal(live, w, d, (id) => this.edgeStates(id), this.tunables);
    const landed = plan.outcomes.filter((o) => o.outcome === "landed").map((o) => ({ a: o.a, b: o.b }));
    const noRoom = plan.outcomes.length - landed.length;
    const rows: EdgeInput[] = plan.rows.map((r) => ({ src: r.src, dst: r.dst, weight: r.weight, day: r.lastDay }));
    if (rows.length > 0) {
      try {
        this.store.linkMany(rows);
      } catch (err) {
        this.emit("associate.propose.failed", undefined, { day: d, pairs: live.length, error: codeOf(err) });
        return { ...empty, reason: "failed", blocked, frozen, code: codeOf(err) };
      }
    }
    this.emit("associate.propose", undefined, {
      day: d,
      pairs: live.length,
      weight: w,
      landed: landed.length,
      noRoom,
      rows: rows.length,
      blocked,
      frozen,
    });
    return {
      reason: landed.length > 0 ? "linked" : "no-room",
      day: d,
      pairs: landed.length,
      landed,
      rows: rows.length,
      noRoom,
      blocked,
      frozen,
    };
  }


  // ── spreading activation ───────────────────────────────────────────────────

  /**
   * Seeds → activation contributions, over the live graph at a lived day.
   *
   * A READ, and therefore allowed under observer: observers surface but train
   * nothing (§15). Nothing here buffers a delta or writes a row.
   */
  spreadFrom(seeds: readonly Seed[], day?: number): SpreadResult {
    const d = day ?? this.store.livedDay();
    return spread(
      {
        seeds,
        day: d,
        edgesFrom: (id) => this.edgeStates(id),
        conducts: this.conductor(),
      },
      this.tunables,
    );
  }

  /** An edge's weight as it stands at a lived day — decay applied, nothing written. */
  weightAt(src: string, dst: string, day?: number): number {
    const d = day ?? this.store.livedDay();
    const row = this.edgeStates(src).find((e) => e.dst === dst);
    return row === undefined ? 0 : edgeWeightAt(row, d, this.tunables);
  }

  /** Does this pair conduct at this lived day? (Weight above the floor, both
   *  endpoints live.) The question a dashboard asks; also the erase assertion. */
  linked(a: string, b: string, day?: number): boolean {
    const d = day ?? this.store.livedDay();
    const live = this.conductor();
    if (!live(a) || !live(b)) return false;
    return conducts(this.weightAt(a, b, d), this.tunables);
  }

  /**
   * Scar §2.2's second half: a supersede must RETARGET the edges, or the
   * successor starts cold while the old id keeps the association fingerprint.
   *
   * The old rows are not deleted — this module has no delete and the store
   * exports none — they simply stop conducting, because a superseded id is not
   * live memory. The successor INHERITS each live weight (`max`, not `+`, so a
   * re-run is idempotent), symmetrically, capped.
   *
   * Nobody calls this yet: who fires it on supersede is a seam decision
   * (INTERFACE-GAPS.md §4).
   */
  retargetOnSupersede(oldId: string, newId: string, day?: number): FlushReport {
    const d = day ?? this.store.livedDay();
    const empty: FlushReport = {
      reason: "nothing-buffered",
      day: d,
      pairs: 0,
      rows: 0,
      evictions: [],
      renormalized: 0,
      nodesTouched: 0,
      blocked: 0,
      dropped: 0,
      swept: 0,
    };
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "retarget" });
      return { ...empty, reason: "observer" };
    }

    const conductor = this.conductor();
    const inherited = new Map<string, number>();
    for (const e of this.edgeStates(oldId)) {
      if (e.dst === newId) continue;
      const w = edgeWeightAt(e, d, this.tunables);
      if (!conducts(w, this.tunables) || !conductor(e.dst)) continue;
      inherited.set(e.dst, Math.max(inherited.get(e.dst) ?? 0, w));
    }
    if (inherited.size === 0) return empty;

    const cap = this.tunables.EDGE_CAP;
    const forward = new Map(this.edgeStates(newId).map((e) => [e.dst, edgeWeightAt(e, d, this.tunables)]));
    const rows: EdgeInput[] = [];
    for (const [dst, w] of [...inherited].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const back = this.edgeStates(dst).find((e) => e.dst === newId);
      const backWeight = back === undefined ? 0 : edgeWeightAt(back, d, this.tunables);
      rows.push({ src: newId, dst, weight: Math.min(cap, Math.max(forward.get(dst) ?? 0, w)), day: d });
      rows.push({ src: dst, dst: newId, weight: Math.min(cap, Math.max(backWeight, w)), day: d });
    }
    try {
      this.store.linkMany(rows);
    } catch (err) {
      this.emit("associate.retarget.failed", oldId, {
        successor: newId,
        rows: rows.length,
        error: err instanceof Error ? err.name : "UNKNOWN",
      });
      return {
        ...empty,
        reason: "failed",
        rows: 0,
        dropped: inherited.size,
        swept: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    this.emit("associate.retarget", oldId, { successor: newId, edges: inherited.size, day: d });
    return { ...empty, reason: "flushed", pairs: inherited.size, rows: rows.length, nodesTouched: inherited.size + 1 };
  }

  // ── telemetry ──────────────────────────────────────────────────────────────

  events(name?: string): AssociateEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Why this member may (or may not) train. Every exclusion has a name. */
  private memberReason(m: Credited, denied: ReadonlySet<string>): MemberReason {
    if (tierFactor(m.tier, this.tunables) <= 0) return "ignorable-tier";
    if (denied.has(m.id)) return "removed";
    const row = this.store.row(m.id);
    if (row === undefined) return "unknown-id";
    // Superseded FIRST: `store.supersede` archives the old head as well, and
    // "superseded" is the more informative of the two true answers.
    if (row.superseded_by !== null) return "superseded";
    if (row.archived === 1) return "archived";
    // Guarantee 9: pinned memories are frozen in BOTH directions — an arc under
    // audit does not change mid-audit. `protected` is the flag v2 has; "under
    // audit" has no representation yet (NOTES.md §7).
    if (row.protected === 1) return "frozen-protected";
    return "eligible";
  }

  /**
   * The conducting predicate: live memory only. A removed, archived or superseded
   * id neither receives activation nor passes it on (contract G8) — and because
   * edges are rows in the canonical operational database rather than a
   * hand-serialized sidecar, there is no rebuild path that could reload them and
   * resurrect the conduction (contract §4, scar §2.2).
   */
  private conductor(): (id: string) => boolean {
    const denied = new Set(this.store.deniedIds());
    const memo = new Map<string, boolean>();
    return (id: string) => {
      const have = memo.get(id);
      if (have !== undefined) return have;
      const row = denied.has(id) ? undefined : this.store.row(id);
      const ok = row !== undefined && row.archived === 0 && row.superseded_by === null;
      memo.set(id, ok);
      return ok;
    };
  }

  private edgeStates(id: string): EdgeState[] {
    return this.store
      .edgesFrom(id)
      .map((r) => ({ src: r.src, dst: r.dst, weight: r.weight, lastDay: r.last_day }));
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const event: AssociateEvent = { at: Date.now(), name };
    if (ref !== undefined) event.ref = ref;
    if (data !== undefined) event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(event);
  }
}
