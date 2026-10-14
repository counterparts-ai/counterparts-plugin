import { USE_TIER_WEIGHT, strength } from "../physics/index.js";
import { activate } from "./activate.js";
import { detectAffect, stripBoilerplate } from "./cues.js";
import { floorUnit, gate } from "./gate.js";
import { NO_MOOD, currentMood } from "./mood.js";
import { loadGateState, saveGateState } from "./session.js";
import { render } from "./render.js";
import { headOf, standingOf } from "./standing.js";
import { withTunables } from "./tunables.js";

export * from "./cues.js";
export * from "./feeling-ask.js";
export * from "./gate.js";
export * from "./mood.js";
export * from "./render.js";
export * from "./session.js";
export * from "./standing.js";
export * from "./recency-ask.js";
export * from "./time-ask.js";
export * from "./tunables.js";
export { activate, isConfidential, isHandoff, isSelfPage, gatedSal, recordedIdentity, salienceRank } from "./activate.js";

export class Recall {
  store;
  tunables;
  observer;
  defaultOwner;
  budgetBytes;
  budgetMs;
  onEvent;
  now;
  volatile = new Map;
  constructor(opts) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables ?? {});
    this.observer = opts.store.observer;
    this.defaultOwner = opts.owner === true && !this.observer;
    this.budgetBytes = opts.budgetBytes ?? this.tunables.BUDGET_BYTES;
    this.budgetMs = opts.budgetMs ?? this.tunables.BUDGET_MS;
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => Date.now());
  }
  build(turn) {
    const started = this.now();
    const day = turn.day ?? this.store.livedDay();
    const owner = (turn.owner ?? this.defaultOwner) && !this.observer;
    const budgetBytes = turn.budgetBytes ?? this.budgetBytes;
    const budgetMs = turn.budgetMs ?? this.budgetMs;
    const loaded = this.observer ? { state: this.volatileState(turn.sessionId), status: "loaded" } : loadGateState(this.store, turn.sessionId, this.tunables.MAX_SESSION_RECORDS);
    const state = loaded.state;
    const turnNo = state.turn + 1;
    const semanticOffered = turn.vector !== undefined && turn.vector.length > 0 || turn.semanticHits !== undefined;
    const semanticSource = turn.semanticSource ?? (semanticOffered ? "in-line" : "none");
    const semanticFromTurn = turn.semanticFromTurn ?? null;
    const { text, stripped } = stripBoilerplate(turn.text);
    const affect = detectAffect(text);
    const carriedIn = state.carriedFromTurn === turnNo - 1 && state.carriedCues.length > 0 ? state.carriedCues : [];
    const quiet = (reason, partial = {}) => ({
      decision: {
        sessionId: turn.sessionId,
        turn: turnNo,
        day,
        observer: this.observer,
        owner,
        reason,
        aborted: reason === "latency-abort",
        storeSize: 0,
        background: {
          regime: "absolute-thin-background",
          n: 0,
          mean: 0,
          sd: 0,
          bar: this.tunables.FLOOR_GLOBAL_UNITS * floorUnit(0),
          strongBar: this.tunables.FLOOR_GLOBAL_UNITS * floorUnit(0),
          floor: this.tunables.FLOOR_GLOBAL_UNITS * floorUnit(0)
        },
        stripped,
        cueCount: 0,
        ambiguousCueCount: 0,
        carriedCueCount: carriedIn.length,
        semanticUsed: semanticOffered,
        semanticDegraded: false,
        semanticSource,
        semanticFromTurn,
        candidates: 0,
        verdicts: [],
        surfaced: [],
        footnotes: [],
        affectFlag: false,
        affectReason: "no-feeling-in-turn",
        moodMatched: 0,
        spread: null,
        dropped: 0,
        bytes: 0,
        budgetBytes,
        sentinel: null,
        trimmed: [],
        elapsedMs: this.now() - started,
        ...partial
      },
      injection: "",
      state,
      carry: [],
      render: null,
      gateStatus: loaded.status
    });
    if (text.trim().length === 0)
      return quiet("empty-turn");
    const storeSize = this.store.countMemories({ archived: false });
    const maxCandidates = storeSize < this.tunables.COLD_START_MIN_STORE ? this.tunables.COLD_START_MAX_CANDIDATES : this.tunables.MAX_CANDIDATES;
    const moodWeighs = this.tunables.MOOD_SAME_WEIGHT > 0 || this.tunables.MOOD_CROSS_WEIGHT > 0;
    const mood = moodWeighs ? currentMood(this.store, this.store.now(), this.tunables) : NO_MOOD;
    const act = activate(this.store, {
      text,
      vector: turn.vector,
      hits: turn.semanticHits,
      carried: carriedIn,
      aliases: turn.aliases,
      temporal: turn.temporal,
      spread: turn.spread,
      day,
      selfFelt: affect.selfFelt,
      mood,
      maxCandidates,
      storeSize,
      ...turn.feeling === undefined ? {} : { feeling: { ...turn.feeling, owner } }
    }, this.tunables);
    if (this.now() - started > budgetMs)
      return quiet("latency-abort");
    const carry = act.cues.filter((c) => !c.carried).slice(0, this.tunables.MAX_CUES).map((c) => c.token);
    const cueStats = {
      cueCount: act.cues.length,
      ambiguousCueCount: act.cues.filter((c) => c.ambiguous).length,
      carriedCueCount: carriedIn.length,
      storeSize: act.storeSize,
      semanticDegraded: act.semanticDegraded
    };
    if (act.candidates.length === 0) {
      return { ...quiet("no-candidates", cueStats), carry };
    }
    const candidates = headsWin(this.store, act.candidates, day);
    const gated = gate({
      candidates,
      state,
      storeSize: act.storeSize,
      owner,
      affectStated: affect.stated,
      turn: turnNo
    }, this.tunables);
    if (this.now() - started > budgetMs)
      return quiet("latency-abort");
    const docs = new Map;
    for (const c of candidates)
      docs.set(c.id, c.doc);
    const linked = new Set(candidates.filter((c) => c.linkOnly === true).map((c) => c.id));
    const lifted = new Set(candidates.filter((c) => c.lifted === true).map((c) => c.id));
    const standings = new Map;
    const standing = (id) => {
      if (!standings.has(id)) {
        let s = null;
        try {
          s = standingOf(this.store, id);
        } catch {
          s = null;
        }
        standings.set(id, s);
      }
      return standings.get(id) ?? null;
    };
    const resolve = (id) => {
      const r = resolveDoc(docs.get(id), id);
      const st = standing(id);
      const withStanding = st === null ? r : { ...r, standing: { prefix: st.prefix, suffix: st.suffix } };
      return linked.has(id) ? { ...withStanding, linked: true } : withStanding;
    };
    const rendered = render({
      turn: turnNo,
      affectFlag: gated.affectFlag,
      surfaced: gated.surfaced.map((c) => c.id),
      footnotes: gated.footnotes.map((c) => c.id),
      budgetBytes,
      gistBytes: this.tunables.GIST_BYTES,
      titleBytes: this.tunables.FOOTNOTE_TITLE_BYTES,
      pressureRatio: this.tunables.BUDGET_PRESSURE
    }, resolve);
    const nothingAdmitted = gated.surfaced.length === 0 && gated.footnotes.length === 0 && !gated.affectFlag;
    const reason = nothingAdmitted ? "all-gated" : rendered.text === "" ? "budget-quiet" : "rendered";
    const decision = {
      sessionId: turn.sessionId,
      turn: turnNo,
      day,
      observer: this.observer,
      owner,
      reason,
      aborted: false,
      storeSize: act.storeSize,
      background: gated.background,
      stripped,
      cueCount: cueStats.cueCount,
      ambiguousCueCount: cueStats.ambiguousCueCount,
      carriedCueCount: cueStats.carriedCueCount,
      semanticUsed: semanticOffered,
      semanticDegraded: act.semanticDegraded,
      semanticSource,
      semanticFromTurn,
      candidates: act.candidates.length,
      verdicts: gated.verdicts,
      surfaced: rendered.surfaced,
      footnotes: rendered.footnotes,
      affectFlag: rendered.affectFlag,
      affectReason: gated.affectReason,
      moodMatched: gated.verdicts.filter((v) => (v.verdict === "surfaced" || v.verdict === "footnoted") && (v.mood ?? 0) > 0).length,
      spread: act.spread === null ? null : {
        ...act.spread,
        pointersShown: rendered.footnotes.filter((id) => linked.has(id)).length,
        liftedShown: [...rendered.surfaced, ...rendered.footnotes].filter((id) => lifted.has(id)).length,
        pointersUnanchored: gated.verdicts.filter((v) => v.via === "link" && v.verdict === "dark-uncued").length
      },
      dropped: act.dropped,
      bytes: rendered.bytes,
      budgetBytes,
      sentinel: rendered.sentinel,
      trimmed: rendered.trimmed.map((x) => ({ lane: x.lane, id: x.id })),
      elapsedMs: this.now() - started
    };
    return {
      decision,
      injection: rendered.text,
      state,
      carry,
      render: rendered,
      gateStatus: loaded.status,
      semantic: act.semantic,
      ...act.feeling === null ? {} : { feeling: act.feeling }
    };
  }
  recall(turn) {
    const built = this.build(turn);
    const d = built.decision;
    if (d.aborted) {
      return { injection: "", decision: d };
    }
    if (built.gateStatus === "unreadable") {
      this.emit("recall.gate.reset", turn.sessionId, { status: built.gateStatus });
    }
    const next = {
      ...built.state,
      turn: d.turn,
      lastDay: d.day,
      surfaced: { ...built.state.surfaced },
      affectFiredTurn: d.affectFlag ? d.turn : built.state.affectFiredTurn,
      carriedCues: built.carry,
      carriedFromTurn: d.turn
    };
    for (const id of d.surfaced) {
      next.surfaced[id] = { turn: d.turn, tier: "surfaced", trains: trainsOf(d.verdicts, id) };
    }
    for (const id of d.footnotes) {
      const via = d.verdicts.find((v) => v.id === id)?.via;
      next.surfaced[id] = {
        turn: d.turn,
        tier: "footnoted",
        trains: trainsOf(d.verdicts, id),
        ...via === "link" ? { via } : {}
      };
    }
    this.persist(next, "recall");
    this.emitTelemetry(d, built.render);
    if (built.semantic !== undefined && built.semantic !== null) {
      this.emit("recall.semantic.tuning", d.sessionId, {
        turn: d.turn,
        identity: built.semantic.identity,
        path: built.semantic.path,
        floor: built.semantic.floor,
        weight: built.semantic.weight,
        source: d.semanticSource
      });
    }
    return { injection: built.injection, decision: d };
  }
  resolveUse(sessionId, memoryId, tier, opts = {}) {
    const w = USE_TIER_WEIGHT[tier];
    if (this.observer) {
      this.emit("recall.observer.standdown", memoryId, { site: "resolveUse", tier });
      return { credited: false, reason: "observer", tier, w, outcome: null };
    }
    const { state } = loadGateState(this.store, sessionId, this.tunables.MAX_SESSION_RECORDS);
    const surfaced = state.surfaced[memoryId];
    if (surfaced !== undefined && !surfaced.trains) {
      this.emit("recall.credit.refused", memoryId, {
        reason: "ambiguous-handle-trains-nothing",
        tier
      });
      return { credited: false, reason: "ambiguous-handle-trains-nothing", tier, w, outcome: null };
    }
    const today = this.store.livedDay();
    const prior = state.credited[memoryId];
    if (prior !== undefined && prior.day === today && USE_TIER_WEIGHT[prior.tier] >= w) {
      this.emit("recall.credit.refused", memoryId, {
        reason: "already-credited-at-or-above",
        tier,
        prior: prior.tier
      });
      return { credited: false, reason: "already-credited-at-or-above", tier, w, outcome: null };
    }
    const cued = opts.cued === true && surfaced !== undefined && surfaced.tier === "surfaced" && surfaced.turn === state.turn;
    const upgradeFrom = upgradeOf(prior, today, w);
    const outcome = this.store.reinforce(memoryId, today, tier, {
      ...cued ? { cued: true } : {},
      ...upgradeFrom === undefined ? {} : { upgradeFrom },
      session: sessionId
    });
    if (outcome.credited) {
      state.credited[memoryId] = { turn: state.turn, tier, day: today };
    }
    const copies = surfaced !== undefined ? this.creditCopies(state, memoryId, today, tier, cued, sessionId) : 0;
    if (outcome.credited || copies > 0)
      this.persist(state, "resolveUse");
    this.emit("recall.credit", memoryId, {
      tier,
      w,
      credited: outcome.credited,
      reason: outcome.reason
    });
    return {
      credited: outcome.credited,
      reason: outcome.credited ? "credited" : "physics-refused",
      tier,
      w,
      outcome
    };
  }
  noteDelivered(sessionId, sentinelSeen, expected) {
    const ok = expected !== null && sentinelSeen === expected;
    this.emit("recall.delivered", sessionId, {
      ok,
      sawSentinel: sentinelSeen !== null,
      expected: expected !== null
    });
    return ok;
  }
  gateState(sessionId) {
    return this.observer ? this.volatileState(sessionId) : loadGateState(this.store, sessionId, this.tunables.MAX_SESSION_RECORDS).state;
  }
  events() {
    return this.ring.map((e) => ({ ...e }));
  }
  creditCopies(state, memoryId, today, tier, cued, sessionId) {
    let copies;
    try {
      if (this.store.row(memoryId)?.type !== "episode")
        return 0;
      copies = this.store.list({ type: "memory", source: "episode", originRef: memoryId, archived: false });
    } catch {
      return 0;
    }
    const w = USE_TIER_WEIGHT[tier];
    let n = 0;
    for (const copy of copies) {
      if (state.surfaced[copy]?.trains === false)
        continue;
      const prior = state.credited[copy];
      if (prior !== undefined && prior.day === today && USE_TIER_WEIGHT[prior.tier] >= w)
        continue;
      const upgradeFrom = upgradeOf(prior, today, w);
      try {
        const out = this.store.reinforce(copy, today, tier, {
          ...cued ? { cued: true } : {},
          ...upgradeFrom === undefined ? {} : { upgradeFrom },
          session: sessionId
        });
        this.emit("recall.credit", copy, { tier, w, credited: out.credited, reason: out.reason, via: "chapter" });
        if (!out.credited)
          continue;
        state.credited[copy] = { turn: state.turn, tier, day: today };
        n += 1;
      } catch {
        continue;
      }
    }
    return n;
  }
  ring = [];
  emit(name, ref, data) {
    const e = { at: this.now(), name };
    if (ref !== undefined)
      e.ref = ref;
    if (data !== undefined)
      e.data = data;
    this.ring.push(e);
    if (this.ring.length > 500)
      this.ring.shift();
    this.onEvent?.(e);
  }
  volatileState(sessionId) {
    let s = this.volatile.get(sessionId);
    if (s === undefined) {
      s = loadGateState(this.store, sessionId, this.tunables.MAX_SESSION_RECORDS).state;
      this.volatile.set(sessionId, s);
    }
    return s;
  }
  persist(state, site) {
    if (this.observer) {
      this.volatile.set(state.sessionId, state);
      this.emit("recall.observer.standdown", state.sessionId, { site: `persist:${site}` });
      return;
    }
    saveGateState(this.store, state, this.tunables.MAX_SESSION_RECORDS);
  }
  emitTelemetry(d, r) {
    const counts = new Map;
    for (const v of d.verdicts)
      counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
    for (const [verdict, count] of counts) {
      if (verdict === "surfaced" || verdict === "footnoted")
        continue;
      this.emit("recall.withheld", undefined, { reason: verdict, count });
    }
    for (const t of d.trimmed)
      this.emit("recall.trim", t.id ?? undefined, { lane: t.lane });
    if (d.reason === "rendered") {
      this.emit("recall.rendered", d.sessionId, {
        turn: d.turn,
        regime: d.background.regime,
        candidates: d.candidates,
        surfaced: d.surfaced.length,
        footnotes: d.footnotes.length,
        affect: d.affectFlag,
        bytes: d.bytes,
        budget: d.budgetBytes,
        ids: [...d.surfaced, ...d.footnotes].join(","),
        elapsedMs: d.elapsedMs
      });
      if (r?.pressure === true) {
        this.emit("recall.budget.pressure", d.sessionId, {
          bytes: d.bytes,
          budget: d.budgetBytes
        });
      }
    } else {
      this.emit("recall.quiet", d.sessionId, {
        turn: d.turn,
        reason: d.reason,
        candidates: d.candidates,
        regime: d.background.regime
      });
    }
  }
}
function upgradeOf(prior, today, w) {
  if (prior === undefined || prior.day !== today)
    return;
  const from = USE_TIER_WEIGHT[prior.tier];
  return from > 0 && from < w ? prior.tier : undefined;
}
export function headsWin(store, candidates, day) {
  const ids = new Set(candidates.filter((c) => c.linkOnly !== true).map((c) => c.id));
  const out = [];
  const brought = new Set;
  for (const c of candidates) {
    let head = null;
    try {
      head = headOf(store, c.id);
    } catch {
      head = null;
    }
    if (head === null) {
      out.push(c);
      continue;
    }
    out.push({ ...c, head });
    if (ids.has(head) || brought.has(head))
      continue;
    try {
      const row = store.row(head);
      if (row === undefined)
        continue;
      const physics = store.physicsOf(head);
      out.push({
        ...c,
        id: head,
        kind: row.kind,
        doc: store.readProse(head),
        physics,
        strength: strength(physics, day),
        confidential: row.confidential === 1,
        standsFor: c.id
      });
      brought.add(head);
    } catch {}
  }
  return brought.size === 0 ? out : out.filter((c) => !(c.linkOnly === true && brought.has(c.id) && c.standsFor === undefined));
}
function trainsOf(verdicts, id) {
  return verdicts.find((v) => v.id === id)?.trains ?? true;
}
function resolveDoc(doc, id) {
  if (doc === undefined)
    return { title: id, gist: id };
  const firstLine = doc.body.split(`
`).find((l) => l.trim().length > 0) ?? "";
  const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
  return { title: doc.title ?? firstLine, gist: paragraph, journal: doc.type === "episode" };
}
