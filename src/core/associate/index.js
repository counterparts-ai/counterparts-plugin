import { DeltaBuffer } from "./buffer.js";
import { conducts, edgeWeightAt, isDead, planFlush, planProposal } from "./edges.js";
import { spread } from "./spread.js";
import { pairCredit, tierFactor, withTunables } from "./tunables.js";

export * from "./at-write.js";
export * from "./buffer.js";
export * from "./contiguity.js";
export * from "./edges.js";
export * from "./pending.js";
export * from "./spread.js";
export * from "./tunables.js";
export const TERMINAL_ARCHIVE_REASONS = ["episode-regrown", "dream-merge", "corrected"];
export const TERMINAL_ARCHIVE_LATCHES = {
  "episode-regrown": "associate.regrown.relink",
  corrected: "associate.corrected.relink"
};
export function sweepableReasons(getMeta) {
  return TERMINAL_ARCHIVE_REASONS.filter((r) => {
    const latch = TERMINAL_ARCHIVE_LATCHES[r];
    if (latch === undefined)
      return true;
    try {
      return getMeta !== undefined && getMeta(latch) !== undefined;
    } catch {
      return false;
    }
  });
}
export const TERMINAL_ARCHIVE_GRACE_MS = 10 * 60000;
function codeOf(err) {
  if (err !== null && typeof err === "object") {
    const code = err.code;
    if (typeof code === "string")
      return code;
    const name = err.name;
    if (typeof name === "string")
      return name;
  }
  return "UNKNOWN";
}
const EVENT_RING = 200;
export function fadeHorizon(t) {
  for (let h = 1;h < 1e5; h++) {
    if (!conducts(edgeWeightAt({ src: "", dst: "", weight: t.EDGE_CAP, lastDay: 0 }, h, t), t))
      return h;
  }
  return 1e5;
}

export class Associate {
  tunables;
  store;
  buffer = new DeltaBuffer;
  onEvent;
  ring = [];
  flushing = false;
  constructor(opts) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables);
    this.onEvent = opts.onEvent;
  }
  get observer() {
    return this.store.observer;
  }
  get pending() {
    return this.buffer.size;
  }
  coactivate(members) {
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "coactivate", members: members.length });
      return { reason: "observer", pairs: 0, members: [], buffered: this.buffer.size };
    }
    const verdicts = [];
    const eligible = [];
    const seen = new Set;
    const denied = new Set(this.store.deniedIds());
    for (const m of members) {
      if (seen.has(m.id))
        continue;
      seen.add(m.id);
      const reason = this.memberReason(m, denied);
      verdicts.push({ id: m.id, reason });
      if (reason === "eligible")
        eligible.push(m);
    }
    if (eligible.length < 2) {
      return {
        reason: "too-few-members",
        pairs: 0,
        members: verdicts,
        buffered: this.buffer.size
      };
    }
    let pairs = 0;
    for (let i = 0;i < eligible.length; i++) {
      for (let j = i + 1;j < eligible.length; j++) {
        const a = eligible[i];
        const b = eligible[j];
        const delta = pairCredit(a.tier, b.tier, this.tunables);
        if (delta <= 0)
          continue;
        this.buffer.add(a.id, b.id, delta);
        pairs += 1;
      }
    }
    this.emit("associate.coactivate", undefined, {
      members: members.length,
      eligible: eligible.length,
      pairs,
      buffered: this.buffer.size
    });
    return { reason: "buffered", pairs, members: verdicts, buffered: this.buffer.size };
  }
  drain() {
    return this.buffer.drain();
  }
  absorb(deltas) {
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "absorb", deltas: deltas.length });
      return 0;
    }
    let added = 0;
    for (const d of deltas) {
      if (d.delta <= 0 && (d.back ?? d.delta) <= 0 || d.a === d.b)
        continue;
      this.buffer.add(d.a, d.b, d.delta, d.back ?? d.delta);
      added += 1;
    }
    return added;
  }
  contiguity(deltas) {
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "contiguity", pairs: deltas.length });
      return { reason: "observer", pairs: 0, blocked: 0, frozen: 0, accepted: [] };
    }
    const conductor = this.conductor();
    const accepted = [];
    let blocked = 0;
    let frozen = 0;
    for (const d of deltas) {
      if (d.a === d.b)
        continue;
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
  pendingDeltas() {
    return this.buffer.pending();
  }
  flush(day) {
    const d = day ?? this.store.livedDay();
    const empty = {
      reason: "nothing-buffered",
      day: d,
      pairs: 0,
      rows: 0,
      evictions: [],
      renormalized: 0,
      nodesTouched: 0,
      blocked: 0,
      dropped: 0,
      swept: 0
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
      const deltas = this.buffer.drain();
      if (deltas.length === 0)
        return empty;
      return this.publish(deltas, d);
    } finally {
      this.flushing = false;
    }
  }
  publish(deltas, day) {
    const conductor = this.conductor();
    const trains = (id) => conductor(id) && this.store.row(id)?.protected !== 1;
    const live = [];
    let blocked = 0;
    for (const p of deltas) {
      if (trains(p.a) && trains(p.b))
        live.push(p);
      else
        blocked += 1;
    }
    const plan = planFlush(live, day, (id) => this.edgeStates(id), this.tunables);
    const rows = plan.rows.map((r) => ({
      src: r.src,
      dst: r.dst,
      weight: r.weight,
      day: r.lastDay
    }));
    if (rows.length > 0) {
      try {
        this.store.linkMany(rows);
      } catch (err) {
        this.emit("associate.flush.failed", undefined, {
          day,
          pairs: deltas.length,
          rows: rows.length,
          dropped: live.length,
          error: codeOf(err)
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
          code: codeOf(err)
        };
      }
    }
    for (const ev of plan.evictions) {
      this.emit("associate.edge.evicted", ev.src, {
        dst: ev.dst,
        priorWeight: ev.priorWeight,
        reason: ev.reason
      });
    }
    const { swept, archived: sweptArchived } = this.sweep(day);
    this.emit("associate.flush.done", undefined, {
      day,
      pairs: deltas.length,
      rows: rows.length,
      blocked,
      evicted: plan.evictions.length,
      renormalized: plan.renormalized.length,
      swept
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
      ...sweptArchived > 0 ? { sweptArchived } : {}
    };
  }
  sweep(day) {
    let dead = 0;
    let archived = 0;
    if (this.store.sweepEdges !== undefined) {
      try {
        dead = this.store.sweepEdges({ floor: this.tunables.EDGE_FLOOR, staleOnOrBefore: day - fadeHorizon(this.tunables) }, (e) => isDead({ src: e.src, dst: e.dst, weight: e.weight, lastDay: e.last_day }, day, this.tunables));
      } catch (err) {
        this.emit("associate.sweep.failed", undefined, { day, error: codeOf(err) });
      }
    }
    if (this.store.sweepArchivedEdges !== undefined) {
      try {
        const getMeta = this.store.getMeta === undefined ? undefined : (key) => this.store.getMeta?.(key);
        archived = this.store.sweepArchivedEdges(sweepableReasons(getMeta), TERMINAL_ARCHIVE_GRACE_MS);
      } catch (err) {
        this.emit("associate.sweep.failed", undefined, { day, error: codeOf(err), archived: true });
      }
    }
    return { swept: dead + archived, archived };
  }
  propose(pairs, weight, day) {
    const d = day ?? this.store.livedDay();
    const empty = {
      reason: "nothing-to-link",
      day: d,
      pairs: 0,
      landed: [],
      rows: 0,
      noRoom: 0,
      blocked: 0,
      frozen: 0
    };
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "propose", pairs: pairs.length });
      return { ...empty, reason: "observer" };
    }
    const conductor = this.conductor();
    const live = [];
    const seen = new Set;
    let blocked = 0;
    let frozen = 0;
    for (const p of pairs) {
      if (p.a === p.b)
        continue;
      const key = p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
      if (seen.has(key))
        continue;
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
    if (live.length === 0)
      return { ...empty, blocked, frozen };
    const w = weight ?? this.tunables.HEBB_RATE;
    const plan = planProposal(live, w, d, (id) => this.edgeStates(id), this.tunables);
    const landed = plan.outcomes.filter((o) => o.outcome === "landed").map((o) => ({ a: o.a, b: o.b }));
    const noRoom = plan.outcomes.length - landed.length;
    const rows = plan.rows.map((r) => ({ src: r.src, dst: r.dst, weight: r.weight, day: r.lastDay }));
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
      frozen
    });
    return {
      reason: landed.length > 0 ? "linked" : "no-room",
      day: d,
      pairs: landed.length,
      landed,
      rows: rows.length,
      noRoom,
      blocked,
      frozen
    };
  }
  spreadFrom(seeds, day) {
    const d = day ?? this.store.livedDay();
    return spread({
      seeds,
      day: d,
      edgesFrom: (id) => this.edgeStates(id),
      conducts: this.conductor()
    }, this.tunables);
  }
  weightAt(src, dst, day) {
    const d = day ?? this.store.livedDay();
    const row = this.edgeStates(src).find((e) => e.dst === dst);
    return row === undefined ? 0 : edgeWeightAt(row, d, this.tunables);
  }
  linked(a, b, day) {
    const d = day ?? this.store.livedDay();
    const live = this.conductor();
    if (!live(a) || !live(b))
      return false;
    return conducts(this.weightAt(a, b, d), this.tunables);
  }
  retargetOnSupersede(oldId, newId, day) {
    const d = day ?? this.store.livedDay();
    const empty = {
      reason: "nothing-buffered",
      day: d,
      pairs: 0,
      rows: 0,
      evictions: [],
      renormalized: 0,
      nodesTouched: 0,
      blocked: 0,
      dropped: 0,
      swept: 0
    };
    if (this.observer) {
      this.emit("associate.observer.skip", undefined, { site: "retarget" });
      return { ...empty, reason: "observer" };
    }
    const conductor = this.conductor();
    const inherited = new Map;
    for (const e of this.edgeStates(oldId)) {
      if (e.dst === newId)
        continue;
      const w = edgeWeightAt(e, d, this.tunables);
      if (!conducts(w, this.tunables) || !conductor(e.dst))
        continue;
      inherited.set(e.dst, Math.max(inherited.get(e.dst) ?? 0, w));
    }
    if (inherited.size === 0)
      return empty;
    const cap = this.tunables.EDGE_CAP;
    const forward = new Map(this.edgeStates(newId).map((e) => [e.dst, edgeWeightAt(e, d, this.tunables)]));
    const rows = [];
    for (const [dst, w] of [...inherited].sort((x, y) => x[0] < y[0] ? -1 : 1)) {
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
        error: err instanceof Error ? err.name : "UNKNOWN"
      });
      return {
        ...empty,
        reason: "failed",
        rows: 0,
        dropped: inherited.size,
        swept: 0,
        error: err instanceof Error ? err.message : String(err)
      };
    }
    this.emit("associate.retarget", oldId, { successor: newId, edges: inherited.size, day: d });
    return { ...empty, reason: "flushed", pairs: inherited.size, rows: rows.length, nodesTouched: inherited.size + 1 };
  }
  events(name) {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }
  memberReason(m, denied) {
    if (tierFactor(m.tier, this.tunables) <= 0)
      return "ignorable-tier";
    if (denied.has(m.id))
      return "removed";
    const row = this.store.row(m.id);
    if (row === undefined)
      return "unknown-id";
    if (row.superseded_by !== null)
      return "superseded";
    if (row.archived === 1)
      return "archived";
    if (row.protected === 1)
      return "frozen-protected";
    return "eligible";
  }
  conductor() {
    const denied = new Set(this.store.deniedIds());
    const memo = new Map;
    return (id) => {
      const have = memo.get(id);
      if (have !== undefined)
        return have;
      const row = denied.has(id) ? undefined : this.store.row(id);
      const ok = row !== undefined && row.archived === 0 && row.superseded_by === null;
      memo.set(id, ok);
      return ok;
    };
  }
  edgeStates(id) {
    return this.store.edgesFrom(id).map((r) => ({ src: r.src, dst: r.dst, weight: r.weight, lastDay: r.last_day }));
  }
  emit(name, ref, data) {
    const event = { at: Date.now(), name };
    if (ref !== undefined)
      event.ref = ref;
    if (data !== undefined)
      event.data = data;
    this.ring.push(event);
    if (this.ring.length > EVENT_RING)
      this.ring.shift();
    this.onEvent?.(event);
  }
}
