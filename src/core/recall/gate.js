import { emotionalIntensity } from "../physics/index.js";
import { tokenize } from "../store/index.js";
import { MIN_RARITY_STORE, informativeness } from "./cues.js";
import { strongFloor } from "./tunables.js";
export function similarity(a, b) {
  const sa = new Set(tokenize(`${a.doc.title ?? ""}
${a.doc.body}`));
  const sb = new Set(tokenize(`${b.doc.title ?? ""}
${b.doc.body}`));
  if (sa.size === 0 || sb.size === 0)
    return 0;
  let inter = 0;
  for (const tok of sa)
    if (sb.has(tok))
      inter += 1;
  return inter / (sa.size + sb.size - inter);
}
export function floorUnit(storeSize) {
  return informativeness(1, storeSize);
}
export function background(activations, storeSize, t) {
  const n = activations.length;
  const mean = n === 0 ? 0 : activations.reduce((a, b) => a + b, 0) / n;
  const varSum = activations.reduce((acc, x) => acc + (x - mean) * (x - mean), 0);
  const sd = n === 0 ? 0 : Math.sqrt(varSum / n);
  const unit = floorUnit(storeSize);
  if (storeSize < t.COLD_START_MIN_STORE) {
    const cold = t.COLD_START_FLOOR_UNITS * unit;
    return {
      regime: "absolute-cold-start",
      n,
      mean,
      sd,
      bar: cold,
      strongBar: cold,
      floor: cold
    };
  }
  const floor = t.FLOOR_GLOBAL_UNITS * unit;
  if (n < t.MIN_BACKGROUND_SAMPLE || sd === 0) {
    return {
      regime: "absolute-thin-background",
      n,
      mean,
      sd,
      bar: floor,
      strongBar: floor,
      floor
    };
  }
  return {
    regime: "relative",
    n,
    mean,
    sd,
    bar: mean + t.SNR_GLOBAL * sd,
    strongBar: mean + t.SNR_STRONG * sd,
    floor
  };
}
function modulate(bar, sal, regime, t) {
  if (regime !== "relative")
    return bar;
  return bar * (1 - t.SAL_BAR_WEIGHT * (2 * sal - 1));
}
export function looBar(activation, sum, sumSq, n, snr) {
  const m = n - 1;
  if (m <= 0)
    return activation;
  const mean = (sum - activation) / m;
  const variance = Math.max(0, (sumSq - activation * activation) / m - mean * mean);
  return mean + snr * Math.sqrt(variance);
}
export function gate(input, t) {
  const own = (c) => c.activation - (c.stamp ?? 0);
  const inSample = (c) => c.pastCut !== true && c.standsFor === undefined && c.cue - (c.stamp ?? 0) + c.semantic > 0;
  const acts = input.candidates.filter(inSample).map(own);
  const bg = background(acts, input.storeSize, t);
  const loudUnit = floorUnit(input.storeSize);
  const sum = acts.reduce((a, b) => a + b, 0);
  const sumSq = acts.reduce((a, b) => a + b * b, 0);
  const n = acts.length;
  const barOf = (c, snr) => inSample(c) ? looBar(own(c), sum, sumSq, n, snr) : bg.mean + snr * bg.sd;
  const barsFor = (c) => bg.regime === "relative" ? {
    admit: modulate(barOf(c, t.SNR_GLOBAL), c.sal, bg.regime, t),
    loud: modulate(barOf(c, t.SNR_STRONG), c.sal, bg.regime, t)
  } : { admit: bg.bar, loud: bg.strongBar };
  const verdicts = [];
  const admitted = [];
  const loudBlock = new Map;
  const faced = new Map;
  const record = (c, verdict) => {
    const blocked = loudBlock.get(c.id);
    verdicts.push({
      bar: faced.get(c.id) ?? bg.bar,
      id: c.id,
      kind: c.kind,
      verdict,
      activation: c.activation,
      cue: c.cue,
      temporal: c.temporal,
      semantic: c.semantic,
      arrival: c.arrival,
      hops: c.hops,
      cueFraction: c.cueFraction,
      sal: c.sal,
      ...c.mood > 0 ? { mood: c.mood } : {},
      strength: c.strength,
      trains: c.trains,
      ...blocked !== undefined ? { loudBlockedBy: blocked } : {},
      ...c.linkOnly === true ? { via: "link" } : {}
    });
  };
  const pointerPool = [];
  let charged = false;
  for (const c of input.candidates) {
    if (c.confidential && !input.owner) {
      record(c, "confidential-withheld");
      continue;
    }
    if (c.cue + c.semantic <= 0) {
      if (c.linkOnly !== true) {
        record(c, "dark-uncued");
        continue;
      }
      if (input.state.surfaced[c.id] !== undefined) {
        record(c, "dedup-suppressed");
        continue;
      }
      pointerPool.push(c);
      continue;
    }
    if (emotionalIntensity(c.physics) >= t.AFFECT_MIN_EMOTION)
      charged = true;
    if (input.state.surfaced[c.id] !== undefined) {
      record(c, "dedup-suppressed");
      continue;
    }
    if (c.activation < bg.floor) {
      record(c, "below-floor");
      continue;
    }
    const bars = barsFor(c);
    faced.set(c.id, bars.admit);
    if (c.activation < bars.admit) {
      record(c, "below-bar");
      continue;
    }
    let loud = true;
    if (c.maxTier === "footnoted") {
      loud = false;
      loudBlock.set(c.id, "cue-only-temporal");
    } else if (input.storeSize < MIN_RARITY_STORE) {
      loud = false;
      loudBlock.set(c.id, "cold-start-undiscriminating");
    } else if (c.cueFraction < t.MIN_CUE_FRACTION) {
      loud = false;
      loudBlock.set(c.id, "cue-fraction");
    } else if (c.activation < strongFloor(t, c.kind, loudUnit)) {
      loud = false;
      loudBlock.set(c.id, "below-strong-floor");
    } else if (c.activation < bars.loud) {
      loud = false;
      loudBlock.set(c.id, "below-bar");
    }
    admitted.push({ c, loud });
  }
  admitted.sort((a, b) => b.c.activation - a.c.activation || (a.c.id < b.c.id ? -1 : 1));
  const admittedIds = new Set(admitted.map((a) => a.c.id));
  const kept = [];
  for (const a of admitted) {
    if (a.c.head !== undefined && (admittedIds.has(a.c.head) || input.state.surfaced[a.c.head] !== undefined)) {
      record(a.c, "inhibited");
      continue;
    }
    const dup = kept.some((k) => similarity(k.c, a.c) >= t.NEAR_DUPLICATE);
    if (dup) {
      record(a.c, "inhibited");
      continue;
    }
    kept.push(a);
  }
  const loudPool = kept.filter((k) => k.loud);
  loudPool.sort((a, b) => b.c.activation + t.SAL_SORT_WEIGHT * b.c.sal - (a.c.activation + t.SAL_SORT_WEIGHT * a.c.sal) || (a.c.id < b.c.id ? -1 : 1));
  const surfaced = loudPool.slice(0, t.MAX_SURFACED).map((k) => k.c);
  const surfacedIds = new Set(surfaced.map((c) => c.id));
  const footnotePool = kept.filter((k) => !surfacedIds.has(k.c.id));
  const cuedFootnotes = footnotePool.slice(0, t.MAX_FOOTNOTES).map((k) => k.c);
  const shownCued = [...surfaced, ...cuedFootnotes];
  const shownIds = new Set(shownCued.map((c) => c.id));
  const anchorBar = shownCued.reduce((m, c) => Math.max(m, c.activation), 0) * t.LINK_POINTER_MIN_FRACTION;
  const anchored = (p) => Object.entries(p.linkedFrom ?? {}).reduce((sum, [id, a]) => shownIds.has(id) ? sum + a : sum, 0);
  const ranked = pointerPool.map((p) => ({ p, a: anchored(p) })).sort((x, y) => y.a - x.a || (x.p.id < y.p.id ? -1 : 1));
  const pointers = [];
  for (const { p, a } of ranked) {
    if (!(a > 0) || a < anchorBar) {
      record(p, "dark-uncued");
      continue;
    }
    if (p.head !== undefined && (shownIds.has(p.head) || pointers.some((q) => q.id === p.head) || input.state.surfaced[p.head] !== undefined)) {
      record(p, "inhibited");
      continue;
    }
    if (kept.some((k) => similarity(k.c, p) >= t.NEAR_DUPLICATE) || pointers.some((q) => similarity(q, p) >= t.NEAR_DUPLICATE)) {
      record(p, "inhibited");
      continue;
    }
    if (pointers.length >= t.LINK_POINTERS_MAX) {
      record(p, "capped");
      continue;
    }
    pointers.push(p);
  }
  const footnotes = [...cuedFootnotes, ...pointers];
  const footnoteIds = new Set(cuedFootnotes.map((c) => c.id));
  for (const c of surfaced)
    record(c, "surfaced");
  for (const c of footnotes)
    record(c, "footnoted");
  for (const k of kept) {
    if (!surfacedIds.has(k.c.id) && !footnoteIds.has(k.c.id))
      record(k.c, "capped");
  }
  let affectFlag = false;
  let affectReason = "nothing-charged";
  if (!input.affectStated) {
    affectReason = "no-feeling-in-turn";
  } else if (!charged) {
    affectReason = "nothing-charged";
  } else if (input.state.affectFiredTurn !== null && input.turn - input.state.affectFiredTurn < t.AFFECT_REFRACTORY_TURNS) {
    affectReason = "refractory";
  } else {
    affectFlag = true;
    affectReason = "fired";
  }
  return { background: bg, verdicts, surfaced, footnotes, affectFlag, affectReason };
}
