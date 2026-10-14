import { BOUNDARY_HOUR_DEFAULT } from "./clock.js";
export { dayKey, livedDay, livedDaysBetween } from "./clock.js";
export const TUNABLES = {
  REP_PER_USE: 0.12,
  REP_SCALE_USES: 3,
  REP_CAP: 0.5,
  CONS_BONUS: 0.2,
  THETA_SEM: 0.5,
  RETURN_SPACING_DAYS: 7,
  RETURN_GAIN: 1,
  DREAM_RETURN_WEIGHT: 0.5,
  REFLECTION_RETURN_WEIGHT: 1,
  ENGAGED_RETURN_WEIGHT: 0.5,
  ENGAGED_RECURRENCE_WEIGHT: 0.5,
  REFLECTION_SPACING_DAYS: 7,
  DREAMED_CLAIM_CEILING: 0.3,
  FOLD_CLAIM_CEILING: 0.6,
  CORE_FAST_FEELING: 0.6,
  CORE_FAST_ABOVE_DEFAULT: 0.1,
  CORE_FAST_RELATIVE_FLOOR: 0.5,
  CORE_FAST_ACCEPTS_REFLECTED_FEELING: true,
  CORE_FAST_GAP_DAYS: 2,
  CORE_SLOW_DAYS: 4,
  CORE_SLOW_SESSIONS: 3,
  CORE_SLOW_SPAN_DAYS: 7,
  CORE_SLOW_WINDOW_DAYS: 30,
  SWEEP_CLAIM_CEILING: 0.6,
  AUTHORED_DEFAULT_CLAIM: 0.25,
  DEFAULT_CLAIM_WORK_EVENT: 0.2,
  DEFAULT_CLAIM_WORLD: 0.35,
  DEFAULT_CLAIM_PERSONAL: 0.4,
  S0: 0.4,
  STABILITY_GAIN: 8,
  EMO_Q: 0.5,
  BETA: 0.5,
  BOUNDARY_HOUR: BOUNDARY_HOUR_DEFAULT,
  DECAY_SHAPE: "power-law",
  POWER_LAW_PSI: 1,
  REACH: 0.15,
  HOLD_GRACE_DAYS: 7,
  HOLD_LEAD_DAYS: 3,
  K_NEAREST: 8,
  EMO_LIFT: 0.15,
  FELT_HEIGHT_CAP: 0.49,
  S_FEELING: 20,
  S_FEELING_NEGATIVE: 14,
  S_FEELING_POSITIVE: 28,
  W_REFERENCED: 1,
  W_ENGAGED: 0.5,
  W_SURFACED: 0.25,
  W_FOOTNOTED: 0,
  S_PRESSURE: 60,
  F_DAY_CAP_SLOW: 0.35,
  SLOW_KIND_IOTA: 0.8,
  H_SUPERSEDED_DAYS: 90,
  TAU_DUP: 0.95,
  PHI_PRUNE: 0.02,
  D_FLOOR_DAYS: 14,
  SYMMETRY_MAX_UP_DOWN_RATIO: 4,
  SYMMETRY_MIN_SAMPLE: 20,
  CHANGED_FADE: 0.5,
  KINDS: {
    self: { wSal: 1, wRep: 0, kappa: 0.7, iota: 0.9 },
    person: { wSal: 1, wRep: 0, kappa: 0.75, iota: 0.8 },
    entity: { wSal: 1, wRep: 1, kappa: 0.85, iota: 0.5 },
    skill: { wSal: 1, wRep: 1, kappa: 0.5, iota: 0.25 },
    place: { wSal: 1, wRep: 1, kappa: 0.85, iota: 0.25 },
    fact: { wSal: 1, wRep: 1, kappa: 1, iota: 0.2 }
  }
};
export function kindPhysics(kind) {
  return TUNABLES.KINDS[kind];
}
export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
export function reinforcedDays(m) {
  return m.reinforcedDays ?? 0;
}
export function cosine(a, b) {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0;i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0)
    return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
export function novelty(v, context) {
  if (context.length === 0)
    return null;
  let best = -1;
  for (const e of context)
    best = Math.max(best, cosine(v, e));
  return clamp01(1 - best);
}
export function isBlindEncoding(s) {
  return s.novelty === null;
}
export function sal(s) {
  const dims = [s.relevance, s.predictive];
  if (s.novelty !== null)
    dims.unshift(s.novelty);
  let sum = 0;
  for (const x of dims)
    sum += clamp01(x);
  const mean = sum / dims.length;
  return clamp01(Math.max(mean, s.claimed ?? 0));
}
export function curveSal(m) {
  const era = m.eraClaim;
  return typeof era === "number" && Number.isFinite(era) ? sal({ ...m.salience, claimed: era }) : sal(m.salience);
}
export function computedSal(s) {
  return sal({ ...s, claimed: null });
}
export function defaultClaimFor(input) {
  const about = input.about ?? null;
  if (about === "owner" || about === "us" || about === "me" || input.saidBy === "owner" || input.kind === "self" || input.kind === "person") {
    return { claim: TUNABLES.DEFAULT_CLAIM_PERSONAL, class: "personal" };
  }
  if (about === "world")
    return { claim: TUNABLES.DEFAULT_CLAIM_WORLD, class: "world" };
  if (about === "work") {
    return input.status === "done" ? { claim: TUNABLES.DEFAULT_CLAIM_WORK_EVENT, class: "work-event" } : { claim: TUNABLES.AUTHORED_DEFAULT_CLAIM, class: "work" };
  }
  return { claim: TUNABLES.AUTHORED_DEFAULT_CLAIM, class: "unmarked" };
}
export function clampSalienceAtSeam(dims, claimedSal, ceiling = 1, defaultClaim = null) {
  const raw = claimedSal === null ? null : clamp01(claimedSal);
  const capped = raw !== null && raw > ceiling;
  const defaulted = raw === null && defaultClaim !== null;
  const claimed = raw === null ? defaultClaim === null ? null : clamp01(defaultClaim) : Math.min(raw, ceiling);
  const salience = { ...dims, claimed };
  const computed = computedSal(salience);
  const lifted = !defaulted && claimed !== null && claimed > computed;
  return {
    salience,
    lifted,
    blind: isBlindEncoding(salience),
    capped,
    defaulted,
    rawClaim: capped ? raw : null,
    event: lifted || capped ? {
      event: "salience.lifted",
      computed,
      claimed: raw,
      applied: sal(salience),
      ceiling,
      capped
    } : null,
    defaultEvent: defaulted ? {
      event: "salience.defaulted",
      computed,
      floor: claimed,
      applied: sal(salience)
    } : null
  };
}
export function rep(m) {
  if (!(m.uses > 0))
    return 0;
  return TUNABLES.REP_CAP * (1 - Math.exp(-m.uses / TUNABLES.REP_SCALE_USES));
}
export function cons(m) {
  return m.consolidated ? TUNABLES.CONS_BONUS : 0;
}
export function base(m) {
  const k = kindPhysics(m.kind);
  return Math.max(k.wSal * salArm(m), k.wRep * rep(m)) + cons(m);
}
export function emotionalIntensity(m) {
  const peak = m.feelingPeak;
  return Math.max(clamp01(m.salience.emotional), typeof peak === "number" && Number.isFinite(peak) ? clamp01(peak) : 0);
}
export function salArm(m) {
  const own = curveSal(m);
  const lifted = clamp01(own + TUNABLES.EMO_LIFT * emotionalIntensity(m));
  return own >= TUNABLES.THETA_SEM ? lifted : Math.min(lifted, Math.max(own, TUNABLES.FELT_HEIGHT_CAP));
}
export function softenedFeeling(strength, ageDays, valence) {
  const age = Number.isFinite(ageDays) ? Math.max(0, ageDays) : 0;
  return clamp01(strength) * Math.exp(-age / feelingSofteningDays(valence));
}
export function feelingSofteningDays(valence) {
  const v = typeof valence === "number" && Number.isFinite(valence) ? Math.max(-1, Math.min(1, valence)) : 0;
  const end = v < 0 ? TUNABLES.S_FEELING_NEGATIVE : TUNABLES.S_FEELING_POSITIVE;
  return TUNABLES.S_FEELING + Math.abs(v) * (end - TUNABLES.S_FEELING);
}
export function steepnessInput(m) {
  return clamp01(curveSal(m) + TUNABLES.EMO_Q * emotionalIntensity(m));
}
export function stability(m) {
  const kappa = kindPhysics(m.kind).kappa;
  if (m.promotedIdentity === true || !(kappa > 0))
    return Number.POSITIVE_INFINITY;
  const q = steepnessInput(m);
  return TUNABLES.S0 * Math.exp(TUNABLES.STABILITY_GAIN * q) * (1 + TUNABLES.BETA * Math.log(1 + Math.max(0, m.uses))) * returnFactor(m.returns ?? 0) / kappa;
}
export function returnFactor(returns) {
  const r = Number.isFinite(returns) ? Math.max(0, returns) : 0;
  return 1 + TUNABLES.RETURN_GAIN * Math.log(1 + r);
}
export function decayCurve(elapsedDays, s, shape = TUNABLES.DECAY_SHAPE) {
  const dt = Math.max(0, elapsedDays);
  if (s === Number.POSITIVE_INFINITY)
    return 1;
  switch (shape) {
    case "flat":
      return Math.max(0, 1 - dt / s);
    case "power-law":
      return Math.pow(1 + dt / s, -TUNABLES.POWER_LAW_PSI);
    case "exponential":
    default:
      return Math.exp(-dt / s);
  }
}
export function decayAnchor(m) {
  return Math.max(m.lastUsedDay, m.lastReturnDay ?? Number.NEGATIVE_INFINITY, m.lastDreamDay ?? Number.NEGATIVE_INFINITY);
}
export function elapsed(m, d) {
  return m.hold?.state === "pending" ? 0 : Math.max(0, d - decayAnchor(m));
}
export function decay(m, d, shape = TUNABLES.DECAY_SHAPE) {
  if (m.promotedIdentity)
    return 1;
  return decayCurve(elapsed(m, d), stability(m), shape);
}
export function height(m) {
  return clamp01(base(m) * fadeOf(m));
}
export function strength(m, d, shape = TUNABLES.DECAY_SHAPE) {
  return clamp01(base(m) * decay(m, d, shape) * fadeOf(m));
}
export function belowReach(m, d, shape = TUNABLES.DECAY_SHAPE) {
  if (m.promotedIdentity)
    return false;
  return strength(m, d, shape) < TUNABLES.REACH;
}
export function daysUntilBelow(m, theta, shape = TUNABLES.DECAY_SHAPE) {
  if (m.promotedIdentity)
    return null;
  const h = height(m);
  if (h < theta)
    return 0;
  if (m.hold?.state === "pending")
    return null;
  const S = stability(m);
  if (S === Number.POSITIVE_INFINITY)
    return null;
  if (shape === "power-law" && TUNABLES.POWER_LAW_PSI === 1) {
    return Math.floor(S * (h / theta - 1)) + 1;
  }
  for (let t = 1;t <= 1e5; t++)
    if (h * decayCurve(t, S, shape) < theta)
      return t;
  return null;
}
export const NEVER_CHANGES = 1e9;
export function nextChangeDay(m, d, shape = TUNABLES.DECAY_SHAPE) {
  if (m.promotedIdentity)
    return NEVER_CHANGES;
  if ((m.hold ?? null) !== null)
    return d + 1;
  const anchor = decayAnchor(m);
  const now = strength(m, d, shape);
  const candidates = [];
  for (const theta of [TUNABLES.THETA_SEM, TUNABLES.REACH]) {
    if (now < theta)
      continue;
    const t = daysUntilBelow(m, theta, shape);
    if (t !== null)
      candidates.push(anchor + t);
  }
  const floor = now < TUNABLES.PHI_PRUNE ? 0 : daysUntilBelow(m, TUNABLES.PHI_PRUNE, shape);
  if (floor !== null)
    candidates.push(anchor + Math.max(floor, TUNABLES.D_FLOOR_DAYS));
  const next = candidates.filter((x) => x > d).sort((a, b) => a - b)[0];
  return next === undefined ? NEVER_CHANGES : next;
}
export function fadeOf(m) {
  const f = m.fade;
  return typeof f === "number" && Number.isFinite(f) && f > 0 && f < 1 ? f : 1;
}
export function changedFade(m, d, factor = TUNABLES.CHANGED_FADE, shape = TUNABLES.DECAY_SHAPE) {
  if (m.promotedIdentity)
    return null;
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1)
    return null;
  const fade = fadeOf(m) * factor;
  return {
    fade,
    factor,
    before: strength(m, d, shape),
    after: strength({ ...m, fade }, d, shape)
  };
}
export function unfade(fade, factor) {
  if (!Number.isFinite(factor) || factor <= 0)
    return fade;
  const next = fade / factor;
  return next >= 1 - 0.000000001 ? 1 : next;
}
export function band(m, d, shape = TUNABLES.DECAY_SHAPE) {
  if (m.promotedIdentity)
    return "identity";
  return strength(m, d, shape) >= TUNABLES.THETA_SEM ? "semantic" : "episodic";
}
export function rowRecurrence(m) {
  const days = m.returnDays ?? 0;
  return {
    days,
    fullDays: days,
    sessions: days,
    first: m.firstReturnDay ?? null,
    last: m.lastReturnDay ?? null,
    anchored: days > 0,
    lastEver: m.lastReturnDay ?? null
  };
}
export function promotionEligibility(m, ctx) {
  const accepts = ctx.acceptsReflectedFeeling ?? TUNABLES.CORE_FAST_ACCEPTS_REFLECTED_FEELING;
  const intensity = accepts || m.feelingPeakLived === undefined ? emotionalIntensity(m) : emotionalIntensity({ ...m, feelingPeak: m.feelingPeakLived });
  const days = m.returnDays ?? 0;
  const last = m.lastReturnDay ?? null;
  const gap = last === null ? null : last - m.birthDay;
  const fastLast = !accepts && ctx.organicReturnDay !== undefined ? ctx.organicReturnDay : last;
  const fastGap = fastLast === null ? null : fastLast - m.birthDay;
  const felt = intensity >= TUNABLES.CORE_FAST_FEELING || ctx.stronglyFelt === true;
  const fastMet = felt && fastGap !== null && fastGap >= TUNABLES.CORE_FAST_GAP_DAYS;
  const now = ctx.day === undefined ? null : strength(m, ctx.day);
  const rec = ctx.recurrence ?? rowRecurrence(m);
  const span = rec.first === null || rec.last === null ? 0 : rec.last - rec.first;
  const slowMet = rec.days >= TUNABLES.CORE_SLOW_DAYS - 0.000000001 && rec.fullDays >= 1 && rec.sessions >= TUNABLES.CORE_SLOW_SESSIONS && span >= TUNABLES.CORE_SLOW_SPAN_DAYS && rec.anchored && rec.earlier !== true && (now === null || now >= TUNABLES.REACH);
  const blockedBy = [];
  if (m.promotedIdentity)
    blockedBy.push("already-identity");
  if (!ctx.aboutMe && !(ctx.selfRelevantFeeling === true && fastMet))
    blockedBy.push("not-about-me");
  if (ctx.demoted === true)
    blockedBy.push("demoted-by-owner");
  if (!fastMet && !slowMet)
    blockedBy.push("no-lane-yet");
  return {
    eligible: blockedBy.length === 0,
    reason: blockedBy[0] ?? "eligible",
    blockedBy,
    lane: fastMet ? "fast" : slowMet ? "slow" : null,
    fast: {
      met: fastMet,
      intensity,
      needIntensity: TUNABLES.CORE_FAST_FEELING,
      gap: fastGap,
      needGap: TUNABLES.CORE_FAST_GAP_DAYS
    },
    slow: {
      met: slowMet,
      days: rec.days,
      needDays: TUNABLES.CORE_SLOW_DAYS,
      sessions: rec.sessions,
      needSessions: TUNABLES.CORE_SLOW_SESSIONS,
      span,
      needSpan: TUNABLES.CORE_SLOW_SPAN_DAYS,
      anchored: rec.anchored,
      strength: now,
      needStrength: TUNABLES.REACH
    },
    base: base(m),
    returnDays: days
  };
}
export function consolidationEligibility(m, d, opts = {}, shape = TUNABLES.DECAY_SHAPE) {
  const b = band(m, d, shape);
  const blockedBy = [];
  if (m.legacy !== true)
    blockedBy.push("not-legacy");
  if (opts.archived === true)
    blockedBy.push("archived");
  if (m.consolidated)
    blockedBy.push("already-consolidated");
  if (d <= m.birthDay)
    blockedBy.push("born-today");
  if (b !== "semantic" && !m.promotedIdentity)
    blockedBy.push("below-semantic-floor");
  return {
    eligible: blockedBy.length === 0,
    reason: blockedBy[0] ?? "eligible",
    blockedBy,
    band: b,
    birthDay: m.birthDay
  };
}
export function promote(m, d, ctx) {
  const verdict = promotionEligibility(m, { ...ctx, day: d });
  if (!verdict.eligible || verdict.lane === null)
    return { promoted: false, verdict, crossing: null, next: null };
  return {
    promoted: true,
    verdict,
    crossing: {
      event: "band.promoted",
      day: d,
      kind: m.kind,
      lane: verdict.lane,
      base: verdict.base,
      intensity: verdict.fast.intensity,
      returnDays: verdict.returnDays,
      reinforcedDays: verdict.returnDays
    },
    next: { promotedIdentity: true }
  };
}
export function spacingWeight(gap) {
  if (!Number.isFinite(gap) || gap <= 0)
    return 0;
  return 1 - Math.exp(-gap / TUNABLES.RETURN_SPACING_DAYS);
}
export function lastReturnAnchor(m) {
  return Math.max(m.birthDay, m.lastReturnDay ?? -1 / 0, m.lastDreamDay ?? -1 / 0);
}
export function creditReturn(m, d, opts) {
  const unchanged = {
    returns: m.returns ?? 0,
    returnDays: m.returnDays ?? 0,
    firstReturnDay: m.firstReturnDay ?? null,
    lastReturnDay: m.lastReturnDay ?? null,
    lastDreamDay: m.lastDreamDay ?? null
  };
  const gap = d - Math.max(lastReturnAnchor(m), opts.since ?? -1 / 0);
  const refuse = (reason) => ({
    counted: false,
    reason,
    source: opts.source,
    gap,
    weight: 0,
    next: unchanged
  });
  const tier = opts.source === "dream" ? TUNABLES.DREAM_RETURN_WEIGHT : opts.source === "reflection" ? TUNABLES.REFLECTION_RETURN_WEIGHT : opts.source === "engaged" ? TUNABLES.ENGAGED_RETURN_WEIGHT : opts.tierWeight ?? TUNABLES.W_REFERENCED;
  if (tier <= 0)
    return refuse("ignorable-tier");
  if (opts.source === "awake" && tier < TUNABLES.W_REFERENCED)
    return refuse("not-referenced");
  if (d <= m.birthDay)
    return refuse("birth-day");
  if (opts.source === "awake" && opts.onDisplay === true)
    return refuse("on-display");
  if (opts.source === "engaged") {
    if (gap <= 0)
      return refuse("already-returned-today");
    const weight = tier * spacingWeight(gap);
    return {
      counted: true,
      reason: "counted",
      source: "engaged",
      gap,
      weight,
      next: { ...unchanged, returns: unchanged.returns + weight }
    };
  }
  const sameKindGap = opts.source !== "dream" ? d - Math.max(m.birthDay, m.lastReturnDay ?? -1 / 0) : gap;
  if (sameKindGap <= 0)
    return refuse("already-returned-today");
  if (opts.source === "reflection" && opts.lastReflectionDay !== null && opts.lastReflectionDay !== undefined && d - opts.lastReflectionDay < TUNABLES.REFLECTION_SPACING_DAYS) {
    return refuse("reflection-spaced");
  }
  if (opts.source === "dream" && m.lastDreamDay !== null && m.lastDreamDay !== undefined && d - m.lastDreamDay < TUNABLES.RETURN_SPACING_DAYS) {
    return refuse("dream-spaced");
  }
  const weight = (opts.source === "awake" ? 1 : tier) * spacingWeight(gap);
  const next = { ...unchanged, returns: unchanged.returns + weight };
  if (opts.source === "dream") {
    next.lastDreamDay = d;
  } else {
    next.lastReturnDay = d;
    next.returnDays = unchanged.returnDays + 1;
    if (next.firstReturnDay === null)
      next.firstReturnDay = d;
  }
  return { counted: true, reason: "counted", source: opts.source, gap, weight, next };
}
const BAND_RANK = { episodic: 0, semantic: 1, identity: 2 };
export function bandMove(from, to) {
  const delta = BAND_RANK[to] - BAND_RANK[from];
  return delta > 0 ? "up" : delta < 0 ? "down" : "none";
}
export function symmetryCheck(kind, counts) {
  const { up, down } = counts;
  const unexplained = Math.max(0, counts.unexplained ?? 0);
  const ratio = down === 0 ? up === 0 ? 0 : 1 / 0 : up / down;
  const expectedMax = TUNABLES.SYMMETRY_MAX_UP_DOWN_RATIO;
  const shape = { kind, up, down, ratio, expectedMax, unexplained };
  if (unexplained > 0)
    return { ok: false, reason: "ratchet-suspected", ...shape };
  if (up + down < TUNABLES.SYMMETRY_MIN_SAMPLE) {
    return { ok: true, reason: "never-asked", ...shape };
  }
  if (ratio > expectedMax)
    return { ok: false, reason: "ratchet-suspected", ...shape };
  return { ok: true, reason: "within-expectation", ...shape };
}
export const USE_TIER_WEIGHT = {
  referenced: TUNABLES.W_REFERENCED,
  engaged: TUNABLES.W_ENGAGED,
  surfaced: TUNABLES.W_SURFACED,
  footnoted: TUNABLES.W_FOOTNOTED
};
export function creditUse(m, d, tier, opts = {}) {
  const w = USE_TIER_WEIGHT[tier];
  const days = reinforcedDays(m);
  const unchanged = { uses: m.uses, lastUsedDay: m.lastUsedDay, reinforcedDays: days };
  if (w <= 0)
    return { credited: false, reason: "ignorable-tier", w, next: unchanged };
  if (d === m.birthDay)
    return { credited: false, reason: "birth-day", w, next: unchanged };
  if (d < m.lastUsedDay)
    return { credited: false, reason: "stale-day", w, next: unchanged };
  if (d === m.lastUsedDay) {
    const from = opts.upgradeFrom === undefined ? 0 : USE_TIER_WEIGHT[opts.upgradeFrom];
    if (from > 0 && from < w) {
      return { credited: true, reason: "credited", w, next: { uses: m.uses + (w - from), lastUsedDay: d, reinforcedDays: days } };
    }
    return { credited: false, reason: "already-credited-today", w, next: unchanged };
  }
  return {
    credited: true,
    reason: "credited",
    w,
    next: { uses: m.uses + w, lastUsedDay: d, reinforcedDays: days + 1 }
  };
}
export function challengeForce(challenger, d, shape = TUNABLES.DECAY_SHAPE) {
  return strength(challenger, d, shape) * sal(challenger.salience);
}
export function pressureAt(m, d, shape = "exponential") {
  if (m.pressure <= 0 || m.lastChallengedDay === null)
    return 0;
  return m.pressure * decayCurve(d - m.lastChallengedDay, TUNABLES.S_PRESSURE, shape);
}
export function revisionBar(target, d, shape = TUNABLES.DECAY_SHAPE) {
  return kindPhysics(target.kind).iota * strength(target, d, shape);
}
export function applyChallenge(targetId, target, challenge, d, shape = TUNABLES.DECAY_SHAPE) {
  const bar = revisionBar(target, d, shape);
  const pressureBefore = pressureAt(target, d);
  const unchanged = { pressure: target.pressure, lastChallengedDay: target.lastChallengedDay };
  const refuse = (reason) => ({
    verdict: "hold",
    credited: false,
    reason,
    force: 0,
    pressureBefore,
    pressureAfter: pressureBefore,
    bar,
    next: unchanged,
    log: null
  });
  if (challenge.declaredUpdates === null)
    return refuse("no-declared-target");
  if (challenge.declaredUpdates !== targetId)
    return refuse("target-mismatch");
  if (target.lastChallengedDay !== null && d === target.lastChallengedDay) {
    return refuse("already-challenged-today");
  }
  if (target.lastChallengedDay !== null && d < target.lastChallengedDay)
    return refuse("stale-day");
  const rawForce = Math.max(challengeForce(challenge.physics, d, shape), challenge.floor ?? 0);
  const slow = kindPhysics(target.kind).iota >= TUNABLES.SLOW_KIND_IOTA;
  const force = slow ? Math.min(rawForce, TUNABLES.F_DAY_CAP_SLOW) : rawForce;
  const pressureAfter = pressureBefore + force;
  const revise = pressureAfter > bar;
  return {
    verdict: revise ? "revise" : "hold",
    credited: true,
    reason: revise ? "revised" : "below-bar",
    force,
    pressureBefore,
    pressureAfter,
    bar,
    next: { pressure: pressureAfter, lastChallengedDay: d },
    log: {
      event: "revision.pressure",
      day: d,
      challengerId: challenge.id,
      force,
      pressureAfter,
      bar
    }
  };
}
export function supersedeRecord(predecessorId, successorId, d) {
  return {
    event: "memory.superseded",
    predecessorId,
    successorId,
    day: d,
    resolvableUntilDay: d + TUNABLES.H_SUPERSEDED_DAYS
  };
}
export function supersededResolvable(supersededOnDay, d) {
  return d - supersededOnDay <= TUNABLES.H_SUPERSEDED_DAYS;
}
export function successorSeed(target, opts = {}) {
  const inherit = opts.inheritIdentity ?? true;
  return {
    promotedIdentity: inherit ? target.promotedIdentity : false,
    pressure: 0,
    lastChallengedDay: null
  };
}
export function dedupVerdict(input) {
  if (input.declaredUpdates !== null && input.declaredUpdates === input.originalId) {
    return { verdict: "leave-alone", reason: "declared-revision-never-merged", effect: null };
  }
  if (input.revisionSuccessorPair === true) {
    return { verdict: "leave-alone", reason: "revision-successor-never-merged", effect: null };
  }
  if (input.sameContentHash === true) {
    return { verdict: "merge", reason: "identical-content-hash", effect: { usesDelta: 1 } };
  }
  const cos = input.cosine ?? null;
  if (cos === null) {
    return { verdict: "leave-alone", reason: "no-similarity-supplied", effect: null };
  }
  if (cos >= TUNABLES.TAU_DUP) {
    return { verdict: "merge", reason: "cosine-at-or-above-tau", effect: { usesDelta: 1 } };
  }
  return { verdict: "leave-alone", reason: "below-tau", effect: null };
}
export function pruneVerdict(m, d, ctx, shape = TUNABLES.DECAY_SHAPE) {
  const s = strength(m, d, shape);
  const b = band(m, d, shape);
  const dwellDays = d - decayAnchor(m);
  const blockedBy = [];
  if (s >= TUNABLES.PHI_PRUNE)
    blockedBy.push("above-floor");
  if (dwellDays < TUNABLES.D_FLOOR_DAYS)
    blockedBy.push("dwell-too-short");
  if (b !== "episodic")
    blockedBy.push("band-not-episodic");
  const floorLetsGo = blockedBy.length === 0;
  if (m.protected && floorLetsGo)
    blockedBy.push("protected");
  if (ctx.inLiveRevisionChain && floorLetsGo)
    blockedBy.push("in-live-revision-chain");
  if (ctx.recurring === true && floorLetsGo)
    blockedBy.push("recurring");
  const prune = blockedBy.length === 0;
  return {
    prune,
    reason: blockedBy[0] ?? "prunable",
    blockedBy,
    strength: s,
    band: b,
    dwellDays,
    record: prune ? {
      event: "memory.pruned",
      day: d,
      kind: m.kind,
      band: b,
      birthDay: m.birthDay,
      lastUsedDay: m.lastUsedDay,
      uses: m.uses,
      strength: s
    } : null
  };
}
