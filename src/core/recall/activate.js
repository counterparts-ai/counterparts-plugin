import { TUNABLES as PHYSICS, belowReach, curveSal, salArm, softenedFeeling, strength } from "../physics/index.js";
import { askedNames, feelingTokens, isFeelingFrameWord, readFeelingAsk, stampCores } from "./feeling-ask.js";
import { confidentialByMeta, feelingValence, feltDay, reachExempt, rowToPhysics, tokenize } from "../store/index.js";
import { buildCues, informativeness } from "./cues.js";
import { semanticTuning } from "./tunables.js";
import { NO_MOOD, hasMood, moodLift } from "./mood.js";
export function isSelfPage(doc) {
  return doc.type === "schema" && doc.meta["role"] === "page";
}
function isPageRow(store, id) {
  try {
    return isSelfPage(store.readProse(id));
  } catch {
    return false;
  }
}
export function isHandoff(doc) {
  return doc.type === "schema" && doc.meta["role"] === "handoff";
}
function isEntityCardRow(row) {
  if (!row.meta.includes('"role"'))
    return false;
  try {
    return JSON.parse(row.meta)?.role === "entity";
  } catch {
    return false;
  }
}
function isHandoffRow(store, id) {
  try {
    return isHandoff(store.readProse(id));
  } catch {
    return false;
  }
}
export function isConfidential(doc) {
  return confidentialByMeta(doc.meta);
}
export function gatedSal(p, selfFelt) {
  return selfFelt ? salArm(p) : curveSal(p);
}
export function activate(store, input, t) {
  const storeSize = input.storeSize;
  const ambient = input.includeBelowReach !== true && input.feeling === undefined;
  const reachFilter = ambient ? { minStrength: PHYSICS.REACH } : {};
  let belowReachCount = 0;
  const searchTokens = [];
  const seenTok = new Set;
  for (const tok of tokenize(input.text)) {
    if (tok.length < t.MIN_CUE_LENGTH || seenTok.has(tok))
      continue;
    seenTok.add(tok);
    searchTokens.push(tok);
    if (searchTokens.length >= t.MAX_CUES * 3)
      break;
  }
  for (const tok of input.carried ?? []) {
    if (tok.length < t.MIN_CUE_LENGTH || seenTok.has(tok))
      continue;
    seenTok.add(tok);
    searchTokens.push(tok);
  }
  const df = store.docFrequency(searchTokens);
  const cues = buildCues({
    text: input.text,
    carried: input.carried ?? [],
    ...input.aliases !== undefined ? { aliases: input.aliases } : {},
    storeSize,
    df
  }, t);
  const postings = new Map;
  const norm = {
    k1: t.CUE_TF_SATURATION,
    b: t.CUE_LENGTH_NORM,
    oneSided: t.CUE_LENGTH_ONE_SIDED
  };
  let unfetched = 0;
  for (const cue of cues) {
    if (postings.has(cue.token))
      continue;
    const d = df.get(cue.token);
    if (d !== undefined && informativeness(d, storeSize) < t.CUE_FETCH_MIN_IDF) {
      unfetched += 1;
      postings.set(cue.token, new Map);
      continue;
    }
    const byDoc = new Map;
    for (const h of store.search(cue.token, t.PER_CUE_FETCH, norm, reachFilter))
      byDoc.set(h.id, h.score);
    postings.set(cue.token, byDoc);
  }
  const cueScore = new Map;
  const matchCount = new Map;
  const unambiguousMatch = new Set;
  const bestCue = new Map;
  for (const cue of cues) {
    const byDoc = postings.get(cue.token);
    if (byDoc === undefined)
      continue;
    for (const [id, evidence] of byDoc) {
      const add = cue.weight * evidence;
      if (add <= 0)
        continue;
      cueScore.set(id, (cueScore.get(id) ?? 0) + add);
      bestCue.set(id, Math.max(bestCue.get(id) ?? 0, add));
      matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
      if (!cue.ambiguous)
        unambiguousMatch.add(id);
    }
  }
  let capped = 0;
  if (t.CUE_DOC_CAP > 0 && Number.isFinite(t.CUE_DOC_CAP)) {
    for (const [id, sum] of cueScore) {
      const ceiling = (bestCue.get(id) ?? 0) * t.CUE_DOC_CAP;
      if (sum > ceiling) {
        cueScore.set(id, ceiling);
        capped += 1;
      }
    }
  }
  const temporalScore = new Map;
  const cueUnit = informativeness(1, storeSize);
  for (const t0 of input.temporal ?? []) {
    if (!(t0.weight > 0))
      continue;
    const w = t0.weight * cueUnit;
    temporalScore.set(t0.id, (temporalScore.get(t0.id) ?? 0) + w);
    cueScore.set(t0.id, (cueScore.get(t0.id) ?? 0) + w);
  }
  const semScore = new Map;
  let semanticDegraded = false;
  const ranked = input.hits !== undefined ? input.hits : input.vector !== undefined && input.vector.length > 0 ? store.nearestTo(input.vector, t.SEMANTIC_TOP_M, reachFilter) : null;
  const path = input.hits !== undefined ? "lagged" : "inline";
  const identity = recordedIdentity(store);
  const tuning = semanticTuning(t, identity, path);
  if (ranked !== null) {
    if (ranked.length === 0)
      semanticDegraded = true;
    const floor = tuning.floor;
    for (const h of ranked.slice(0, t.SEMANTIC_TOP_M)) {
      if (h.score < floor)
        continue;
      const scaled = floor >= 1 ? h.score : (h.score - floor) / (1 - floor);
      semScore.set(h.id, tuning.weight * scaled);
    }
  }
  const denied = new Set(store.deniedIds());
  const ids = new Set([...cueScore.keys(), ...semScore.keys()]);
  const recallable = (id) => {
    if (denied.has(id))
      return;
    const row = store.row(id);
    if (row === undefined || row.archived === 1 || row.superseded_by !== null)
      return;
    if (row.type === "schema" && row.kind === "self" && isPageRow(store, id))
      return;
    if (row.type === "schema" && row.kind === "place" && isHandoffRow(store, id))
      return;
    if (row.type === "schema" && isEntityCardRow(row))
      return;
    if (ambient && !reachExempt(row) && belowReach(rowToPhysics(row), input.day)) {
      belowReachCount += 1;
      return;
    }
    return row;
  };
  const feelingOf = new Map;
  const stampCue = new Map;
  const feelingRank = new Map;
  let feelingAsk = null;
  let rankedFrame = null;
  if (input.feeling !== undefined) {
    let stamps = [];
    try {
      stamps = store.feelingsLive();
    } catch {
      stamps = [];
    }
    const tokensOf = stamps.map((f) => feelingTokens(f));
    const stored = new Set(tokensOf.flatMap((x) => [...x]));
    const ask = readFeelingAsk(input.text, input.feeling, stored, t.MIN_CUE_LENGTH);
    if (ask.ranked)
      rankedFrame = { stored, proper: askedNames(input.text) };
    const best = new Map;
    const better = (a, b) => a.tier !== b.tier ? a.tier < b.tier : a.value !== b.value ? a.value > b.value : a.day > b.day;
    const answered = new Map;
    const everyStamp = ask.ranked && ask.named.size === 0;
    if (ask.ranked || ask.named.size > 0) {
      stamps.forEach((f, i) => {
        if (ask.whose !== null && f.whose !== ask.whose)
          return;
        const answers = tokensOf[i];
        const hit = [...ask.named].filter((w) => answers.has(w));
        const tier = everyStamp || hit.length > 0 ? 0 : ask.ranked && stampCores(f).some((c) => ask.cores.has(c)) ? 1 : null;
        if (tier === null)
          return;
        const soft = softenedFeeling(f.strength, input.day - feltDay(f), feelingValence(f));
        const value = ask.strongest && ask.ranked ? f.strength : soft;
        if (!(value > 0) || !(soft > 0))
          return;
        const mine = { tier, value, day: f.birth_day };
        const had = best.get(f.memory_id);
        if (had === undefined || better(mine, had))
          best.set(f.memory_id, mine);
        if (hit.length > 0) {
          const words = answered.get(f.memory_id) ?? new Set;
          for (const w of hit)
            words.add(w);
          answered.set(f.memory_id, words);
        }
      });
      const stampDf = new Map;
      for (const words of answered.values())
        for (const w of words)
          stampDf.set(w, (stampDf.get(w) ?? 0) + 1);
      const order = [...best].sort((a, b) => better(a[1], b[1]) ? -1 : better(b[1], a[1]) ? 1 : a[0] < b[0] ? -1 : 1);
      const slots = new Set;
      let weakestExact = Number.POSITIVE_INFINITY;
      for (const [id, { tier, value }] of order) {
        if (slots.size >= t.FEELING_CANDIDATES_MAX)
          break;
        const row = recallable(id);
        if (row === undefined)
          continue;
        if (input.feeling.owner !== true && row.confidential === 1)
          continue;
        const slot = journalCopyOf(row) ?? id;
        if (slots.has(slot))
          continue;
        const cueValue = tier === 0 ? value : Math.min(value, weakestExact);
        const add = ask.ranked ? t.FEELING_CUE_UNITS * cueUnit * cueValue : [...answered.get(id) ?? []].reduce((sum, w) => sum + informativeness(stampDf.get(w) ?? 1, storeSize), 0);
        if (!(add > 0))
          continue;
        slots.add(slot);
        if (tier === 0)
          weakestExact = Math.min(weakestExact, value);
        if (ask.ranked) {
          feelingOf.set(id, value);
          feelingRank.set(id, feelingRank.size);
        }
        stampCue.set(id, add);
        cueScore.set(id, (cueScore.get(id) ?? 0) + add);
        ids.add(id);
      }
    }
    feelingAsk = {
      ranked: ask.ranked,
      named: ask.named.size,
      pool: best.size,
      core: [...best.values()].filter((b) => b.tier === 1).length,
      strongest: ask.ranked && ask.strongest
    };
  }
  let scored = [];
  let skipped = 0;
  const copyOf = new Map;
  for (const id of ids) {
    const row = recallable(id);
    if (row === undefined) {
      skipped += 1;
      continue;
    }
    const chapter = journalCopyOf(row);
    if (chapter !== null)
      copyOf.set(id, chapter);
    const physics = rowToPhysics(row);
    const cue = cueScore.get(id) ?? 0;
    const temporal = temporalScore.get(id) ?? 0;
    const semantic = semScore.get(id) ?? 0;
    const s = strength(physics, input.day);
    const arrival = cue + semantic > 0 ? t.ARRIVAL_WEIGHT * s : 0;
    const activation = cue + semantic + arrival;
    const gatedS = gatedSal(physics, input.selfFelt);
    scored.push({
      id,
      physics,
      strength: s,
      sal: gatedS,
      cue,
      temporal,
      semantic,
      arrival,
      hops: 0,
      activation,
      cutKey: salienceRank(activation, gatedS, t),
      feeling: feelingOf.get(id) ?? 0,
      stamp: stampCue.get(id) ?? 0
    });
  }
  let collapsed = 0;
  const collapsedInto = new Map;
  const absorbed = new Map;
  if (copyOf.size > 0) {
    const byId = new Map(scored.map((c) => [c.id, c]));
    const gone = new Set;
    for (const [copyId, chapterId] of copyOf) {
      const copy = byId.get(copyId);
      const chapter = byId.get(chapterId);
      if (copy === undefined || chapter === undefined)
        continue;
      const cue = Math.max(chapter.cue, copy.cue);
      const temporal = Math.max(chapter.temporal, copy.temporal);
      const semantic = Math.max(chapter.semantic, copy.semantic);
      const arrival = cue + semantic > 0 ? t.ARRIVAL_WEIGHT * chapter.strength : 0;
      const activation = cue + semantic + arrival;
      const feeling = Math.max(chapter.feeling, copy.feeling);
      const stamp = copy.cue >= chapter.cue ? copy.stamp : chapter.stamp;
      const sal = Math.max(chapter.sal, copy.sal);
      byId.set(chapterId, { ...chapter, cue, temporal, semantic, arrival, activation, sal, cutKey: salienceRank(activation, sal, t), feeling, stamp });
      collapsedInto.set(copyId, chapterId);
      absorbed.set(chapterId, [...absorbed.get(chapterId) ?? [], copyId]);
      const rank = Math.min(feelingRank.get(chapterId) ?? Number.POSITIVE_INFINITY, feelingRank.get(copyId) ?? Number.POSITIVE_INFINITY);
      if (Number.isFinite(rank))
        feelingRank.set(chapterId, rank);
      matchCount.set(chapterId, Math.max(matchCount.get(chapterId) ?? 0, matchCount.get(copyId) ?? 0));
      if (unambiguousMatch.has(copyId))
        unambiguousMatch.add(chapterId);
      gone.add(copyId);
      collapsed += 1;
    }
    scored = scored.filter((c) => !gone.has(c.id)).map((c) => byId.get(c.id) ?? c);
  }
  const rankForCut = (list) => {
    const sample = list.filter((c) => c.cue - c.stamp + c.semantic > 0).map((c) => c.activation - c.stamp).sort((x, y) => y - x).slice(0, input.maxCandidates);
    const relative = storeSize >= t.COLD_START_MIN_STORE && sample.length >= t.MIN_BACKGROUND_SAMPLE && spreadOf(sample) > 0;
    const key = (c) => c.stamp > 0 ? salienceRank(c.activation - c.stamp, c.sal, t) : c.cutKey;
    list.sort((a, b) => relative ? key(b) - key(a) || b.activation - b.stamp - (a.activation - a.stamp) || (a.id < b.id ? -1 : 1) : b.activation - b.stamp - (a.activation - a.stamp) || (a.id < b.id ? -1 : 1));
  };
  rankForCut(scored);
  const linkOnlyScore = new Map;
  const linkOnlyFrom = new Map;
  let strongestSeed = 0;
  let hopsCapped = 0;
  let spreadRun = null;
  const preHop = input.spread === undefined ? new Set : new Set(scored.filter((c) => c.cue - c.stamp + c.semantic > 0).slice(0, input.maxCandidates).map((c) => c.id));
  if (input.spread !== undefined && scored.length > 0) {
    const seeds = scored.filter((c) => c.cue - c.stamp + c.semantic > 0).slice(0, t.SPREAD_SEEDS).flatMap((c) => [c.id, ...absorbed.get(c.id) ?? []].map((id) => ({ id, activation: c.activation })));
    const seedIds = new Set(seeds.map((s) => s.id));
    for (const s of seeds)
      strongestSeed = Math.max(strongestSeed, s.activation);
    const out = input.spread(seeds, input.day);
    const hopScore = new Map;
    for (const c of out.contributions) {
      const to = collapsedInto.get(c.id) ?? c.id;
      if (!(c.activation > 0) || seedIds.has(to))
        continue;
      if (ids.has(c.id))
        hopScore.set(to, (hopScore.get(to) ?? 0) + c.activation);
      else {
        linkOnlyScore.set(c.id, (linkOnlyScore.get(c.id) ?? 0) + c.activation);
        if (c.from !== undefined) {
          const from = {};
          for (const [id, a] of Object.entries(c.from)) {
            const k = collapsedInto.get(id) ?? id;
            from[k] = (from[k] ?? 0) + a;
          }
          linkOnlyFrom.set(c.id, from);
        }
      }
    }
    if (hopScore.size > 0) {
      scored = scored.map((c) => {
        const raw = c.cue + c.semantic > 0 ? hopScore.get(c.id) ?? 0 : 0;
        if (raw === 0)
          return c;
        const ceiling = t.HOP_CEILING * (c.cue + c.semantic);
        const hops = Math.min(raw, ceiling);
        if (raw > ceiling)
          hopsCapped += 1;
        const activation = c.activation + hops;
        return { ...c, hops, activation, cutKey: salienceRank(activation, c.sal, t) };
      });
      rankForCut(scored);
    }
    spreadRun = {
      seeds: seeds.length,
      expanded: typeof out.expanded === "number" ? out.expanded : null,
      stop: typeof out.stop === "string" ? out.stop : null,
      depth: typeof out.depth === "number" ? out.depth : null,
      computed: out.contributions.length,
      ...typeof out.waiting === "number" ? { waiting: out.waiting } : {},
      linkOnly: linkOnlyScore.size
    };
  }
  const top = scored.filter((c) => c.cue - c.stamp + c.semantic > 0).slice(0, input.maxCandidates);
  const topIds = new Set(top.map((c) => c.id));
  const kept = [...top, ...scored.filter((c) => c.stamp > 0 && !topIds.has(c.id))];
  const dropped = scored.length - kept.length;
  const mood = input.mood ?? NO_MOOD;
  const feelingsById = hasMood(mood) ? store.feelingsOn(kept.filter((c) => c.cue + c.semantic > 0).flatMap((c) => [c.id, ...absorbed.get(c.id) ?? []])) : new Map;
  const candidates = [];
  for (const c of kept) {
    const { id, physics, cue, temporal, semantic, arrival, hops, activation } = c;
    const lift = cue + semantic > 0 ? Math.max(...[id, ...absorbed.get(id) ?? []].map((x) => moodLift(feelingsById.get(x), mood, input.day, t))) : 0;
    const gated = c.sal;
    const stored = store.read(id);
    const doc = stored.doc;
    candidates.push({
      id,
      kind: physics.kind,
      doc,
      physics,
      strength: c.strength,
      sal: Math.min(1, gated + lift),
      mood: Math.min(1, gated + lift) - gated,
      cue,
      temporal,
      semantic,
      arrival,
      hops,
      activation,
      cueFraction: cue + semantic + arrival > 0 ? (cue + semantic) / (cue + semantic + arrival) : 0,
      matched: matchCount.get(id) ?? 0,
      trains: unambiguousMatch.has(id) || semantic > 0 || temporal > 0 || c.feeling > 0,
      maxTier: temporal > 0 && cue - temporal <= 0 && semantic <= 0 ? "footnoted" : "surfaced",
      confidential: stored.confidential,
      ...c.feeling > 0 ? { feeling: c.feeling } : {},
      ...c.stamp > 0 ? { stamp: c.stamp } : {},
      ...topIds.has(id) ? {} : { pastCut: true },
      ...hops > 0 && topIds.has(id) && !preHop.has(id) ? { lifted: true } : {}
    });
  }
  const threshold = strongestSeed * t.LINK_POINTER_MIN_FRACTION;
  const pool = [...linkOnlyScore].filter(([, a]) => a >= threshold).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  let pointerCandidates = 0;
  const keptIds = new Set(kept.map((c) => c.id));
  const chaptersKept = new Set(kept.map((c) => copyOf.get(c.id)).filter((x) => x !== undefined));
  for (const [id, arrived] of pool) {
    const row = recallable(id);
    if (row === undefined)
      continue;
    const chapter = journalCopyOf(row);
    if (chapter !== null && keptIds.has(chapter) || chaptersKept.has(id))
      continue;
    pointerCandidates += 1;
    const physics = rowToPhysics(row);
    const stored = store.read(id);
    candidates.push({
      id,
      kind: physics.kind,
      doc: stored.doc,
      physics,
      strength: strength(physics, input.day),
      sal: gatedSal(physics, input.selfFelt),
      mood: 0,
      cue: 0,
      temporal: 0,
      semantic: 0,
      arrival: 0,
      hops: arrived,
      activation: arrived,
      cueFraction: 0,
      matched: 0,
      trains: true,
      maxTier: "footnoted",
      confidential: stored.confidential,
      linkOnly: true,
      linkedFrom: linkOnlyFrom.get(id) ?? {}
    });
  }
  function noTopicOf(list, stored, proper) {
    const topic = cues.filter((c) => c.weight > 0 && !isFeelingFrameWord(c.token, stored, proper)).map((c) => postings.get(c.token));
    const out = new Set;
    for (const c of list) {
      if (c.feeling !== undefined || c.linkOnly === true || c.temporal > 0)
        continue;
      const reached = [c.id, ...absorbed.get(c.id) ?? []].some((id) => topic.some((byDoc) => byDoc?.has(id) === true));
      if (!reached)
        out.add(c.id);
    }
    return out;
  }
  return {
    cues,
    candidates,
    storeSize,
    skipped,
    semanticDegraded,
    capped,
    unfetched,
    semantic: ranked === null ? null : { identity, path, floor: tuning.floor, weight: tuning.weight },
    spread: spreadRun === null ? null : {
      ...spreadRun,
      landed: kept.filter((c) => c.hops > 0).length,
      lifted: candidates.filter((c) => c.lifted === true).length,
      hopsCapped,
      pointerCandidates
    },
    dropped,
    collapsed,
    belowReach: belowReachCount,
    feeling: feelingAsk === null ? null : {
      ...feelingAsk,
      strengths: new Map(candidates.filter((c) => c.feeling !== undefined).map((c) => [c.id, c.feeling])),
      order: new Map(candidates.filter((c) => c.feeling !== undefined).map((c) => [c.id, feelingRank.get(c.id) ?? Number.MAX_SAFE_INTEGER])),
      noTopic: rankedFrame === null ? new Set : noTopicOf(candidates, rankedFrame.stored, rankedFrame.proper)
    }
  };
}
export function journalCopyOf(row) {
  return row.type === "memory" && row.source === "episode" && row.origin_ref !== null && row.origin_ref.length > 0 ? row.origin_ref : null;
}
function spreadOf(xs) {
  if (xs.length === 0)
    return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / xs.length);
}
export function salienceRank(activation, sal, t) {
  const factor = 1 - t.SAL_BAR_WEIGHT * (2 * sal - 1);
  return factor > 0 ? activation / factor : activation;
}
export function recordedIdentity(store) {
  return store.rankingIdentity();
}
