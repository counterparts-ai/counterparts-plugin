export const CORE_EMOTIONS = ["happy", "warm", "calm", "curious", "sad", "uneasy", "angry"];
export const V10_CORES = ["happy", "sad", "fear", "anger", "surprise", "disgust"];
export const OTHER_EMOTION = "other";
export const CORE_NUMBERS = {
  happy: { valence: 0.7, intensity: 0.5 },
  warm: { valence: 0.7, intensity: 0.5 },
  calm: { valence: 0.5, intensity: 0.35 },
  curious: { valence: 0.3, intensity: 0.45 },
  sad: { valence: -0.6, intensity: 0.45 },
  uneasy: { valence: -0.5, intensity: 0.4 },
  angry: { valence: -0.7, intensity: 0.55 }
};
const TREE = {
  happy: [
    ["hopeful", ["encouraged", "optimistic", "open"]],
    ["eager", ["anticipating", "excited", "energetic"]],
    ["amused", ["playful", "delighted"]],
    ["joyful", ["glad", "ecstatic", "liberated"]],
    ["engaged", ["absorbed", "inspired"]],
    ["proud", ["confident", "accomplished", "courageous", "powerful", "important", "provocative"]]
  ],
  warm: [
    ["fond", ["affectionate", "loving"]],
    ["grateful", ["appreciated"]],
    ["trusted", ["entrusted", "respected", "validated"]],
    ["close", ["kinship", "belonging", "intimate", "accepted"]],
    ["moved", ["tender", "sensitive"]]
  ],
  calm: [
    ["steadied", ["settled", "grounded"]],
    ["relieved", ["reassured", "unburdened"]],
    ["content", ["completion", "fulfilled", "satisfied"]],
    ["peaceful", ["serene", "relaxed", "at ease"]]
  ],
  curious: [
    ["interested", ["intrigued", "inquisitive"]],
    ["recognized", ["that's me", "familiar"]],
    ["clarified", ["realized", "it clicked"]],
    ["amazed", ["awe", "wonder", "surprised", "astonished"]],
    ["confused", ["perplexed", "puzzled"]]
  ],
  sad: [
    ["wistful", ["bittersweet"]],
    ["rueful", ["sorry", "regretful"]],
    ["disappointed", ["bummed", "let down", "disillusioned", "bored", "apathetic", "indifferent"]],
    ["lonely", ["isolated", "abandoned", "ignored", "victimized", "rejected", "alienated"]],
    ["grieving", ["heartbroken", "despair", "empty", "depressed", "powerless"]],
    ["wounded", ["stung"]]
  ],
  uneasy: [
    ["caught out", ["sheepish", "caught", "exposed", "seen", "embarrassed", "humiliated", "ridiculed", "disrespected", "vulnerable"]],
    ["guilty", ["remorseful", "ashamed"]],
    ["unsettled", ["disoriented", "uncertain"]],
    ["insecure", ["inadequate", "inferior", "incompetent", "worthless", "insignificant", "submissive"]],
    ["wary", ["cautious", "suspicious", "avoidance", "hesitant"]],
    ["worried", ["anxious", "nervous", "overwhelmed"]],
    ["afraid", ["scared", "startled", "frightened", "terrified", "shocked", "dismayed"]]
  ],
  angry: [
    ["frustrated", ["annoyed", "irritated", "infuriated", "mad", "furious", "enraged", "aggressive", "provoked", "hostile", "threatened"]],
    ["hurt", ["betrayed", "resentful", "devastated", "jealous", "violated"]],
    ["critical", ["disapproval", "judgmental", "skeptical", "sarcastic", "distant", "withdrawn"]],
    ["disgusted", ["revolted", "contempt", "aversion", "repugnant", "revulsion", "loathing", "detestable", "awful", "hateful"]]
  ]
};
const NUMBERS = {
  excited: [null, 0.65],
  ecstatic: [0.9, 0.85],
  content: [null, 0.25],
  serene: [null, 0.25],
  confused: [-0.2, null],
  surprised: [0, 0.5],
  amazed: [null, 0.6],
  wistful: [-0.3, 0.35],
  bittersweet: [0, 0.4],
  rueful: [-0.4, 0.35],
  bored: [-0.3, 0.2],
  apathetic: [-0.3, 0.2],
  indifferent: [-0.2, 0.15],
  grieving: [-0.8, 0.7],
  guilty: [-0.6, 0.5],
  humiliated: [-0.7, 0.7],
  afraid: [null, 0.6],
  terrified: [-0.8, 0.9],
  overwhelmed: [null, 0.65],
  annoyed: [-0.5, 0.35],
  irritated: [-0.5, 0.35],
  furious: [-0.8, 0.85],
  enraged: [-0.8, 0.9],
  infuriated: [-0.8, 0.85]
};
const BLENDS = {
  recognized: "warm",
  tender: "sad",
  bittersweet: "happy",
  hurt: "sad",
  wounded: "angry"
};
const SELF_RELEVANT = new Set(["recognized"]);
const LABELS = { wounded: "hurt" };
function build() {
  const out = [];
  const seen = new Set;
  const add = (e) => {
    if (seen.has(e.key))
      throw new Error(`feelings wheel: "${e.key}" is placed twice`);
    seen.add(e.key);
    out.push(e);
  };
  const numbers = (word, from) => {
    const own = NUMBERS[word];
    return own === undefined ? from : { valence: own[0] ?? from.valence, intensity: own[1] ?? from.intensity };
  };
  for (const core of CORE_EMOTIONS) {
    const base = CORE_NUMBERS[core];
    add({ key: core, word: core, core, ring: "core", parent: null, ...base });
    for (const [middle, outer] of TREE[core]) {
      const group = numbers(middle, base);
      const blend = BLENDS[middle];
      const self = SELF_RELEVANT.has(middle);
      const marks = { ...blend === undefined ? {} : { alsoCore: blend }, ...self ? { selfRelevant: true } : {} };
      const label = LABELS[middle];
      add({ key: middle, word: middle, core, ring: "middle", parent: null, ...group, ...marks, ...label === undefined ? {} : { label } });
      for (const word of outer) {
        const own = BLENDS[word];
        add({
          key: word,
          word,
          core,
          ring: "outer",
          parent: middle,
          ...numbers(word, group),
          ...marks,
          ...own === undefined ? {} : { alsoCore: own }
        });
      }
    }
  }
  return out;
}
export const FEELINGS_WHEEL = build();
const BY_KEY = new Map(FEELINGS_WHEEL.map((e) => [e.key, e]));
export const ALIASES = {
  thankful: "grateful",
  touched: "moved",
  nostalgic: "wistful",
  inquiring: "curious",
  trust: "trusted",
  recognition: "recognized",
  realised: "realized",
  sceptical: "skeptical",
  disapproving: "disapproval",
  fear: "afraid",
  anger: "angry",
  surprise: "surprised",
  disgust: "disgusted"
};
export function isCoreEmotion(value) {
  return typeof value === "string" && CORE_EMOTIONS.includes(value);
}
export function wheelEntry(key) {
  return BY_KEY.get(key);
}
export function lookupWord(word) {
  const raw = word.trim().toLowerCase();
  const direct = BY_KEY.get(raw);
  if (direct !== undefined)
    return { entry: direct };
  const dot = raw.indexOf(".");
  const prefix = raw.slice(0, Math.max(0, dot));
  if (dot > 0 && (V10_CORES.includes(prefix) || isCoreEmotion(prefix))) {
    const bare = BY_KEY.get(raw.slice(dot + 1));
    if (bare !== undefined)
      return { entry: bare };
  }
  const aliased = Object.hasOwn(ALIASES, raw) ? BY_KEY.get(ALIASES[raw]) : undefined;
  return aliased === undefined ? undefined : { entry: aliased, alias: word.trim() };
}
export function coresOfFeeling(core, emotion) {
  const entry = BY_KEY.get(emotion);
  const out = isCoreEmotion(core) ? [core] : [];
  if (entry !== undefined) {
    if (!out.includes(entry.core))
      out.push(entry.core);
    if (entry.alsoCore !== undefined && !out.includes(entry.alsoCore))
      out.push(entry.alsoCore);
  }
  return out;
}
function entryOfFeeling(emotion, otherWord) {
  if (emotion !== OTHER_EMOTION)
    return lookupWord(emotion)?.entry;
  return otherWord === null || otherWord === undefined ? undefined : lookupWord(otherWord)?.entry;
}
export function feelingNumbers(core, emotion, otherWord) {
  const entry = entryOfFeeling(emotion, otherWord);
  const stored = isCoreEmotion(core) ? CORE_NUMBERS[core] : undefined;
  if (entry !== undefined) {
    const sits = stored === undefined || entry.core === core || entry.alsoCore === core;
    return { valence: sits ? entry.valence : stored.valence, intensity: entry.intensity };
  }
  return stored ?? { valence: 0, intensity: CORE_NUMBERS.curious.intensity };
}
export function isSelfRelevantFeeling(emotion, otherWord) {
  return entryOfFeeling(emotion, otherWord)?.selfRelevant === true;
}
function underCore(e, core) {
  return e.core === core || e.alsoCore === core;
}
export function resolveEmotion(core, emotion) {
  const found = lookupWord(emotion);
  if (found !== undefined) {
    return { kind: "wheel", entry: found.entry, home: underCore(found.entry, core), ...found.alias === undefined ? {} : { alias: found.alias } };
  }
  const raw = emotion.trim().toLowerCase();
  return { kind: "other", word: emotion.trim(), closest: closestKeys(core, raw) };
}
export function closestKeys(core, word, n = 3) {
  const w = word.trim().toLowerCase();
  if (w.length === 0)
    return [];
  const limit = w.length >= 6 ? 2 : 1;
  const fits = (e) => e.ring !== "core" && underCore(e, core);
  const best = new Map;
  const offer = (key, d) => {
    if (d > limit)
      return;
    const had = best.get(key);
    if (had === undefined || d < had)
      best.set(key, d);
  };
  for (const e of FEELINGS_WHEEL)
    if (fits(e))
      offer(e.key, editDistance(w, e.word));
  for (const [alias, key] of Object.entries(ALIASES)) {
    const e = BY_KEY.get(key);
    if (e !== undefined && fits(e))
      offer(key, editDistance(w, alias));
  }
  return [...best.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([key]) => key);
}
const GUILT = new Set(["guilty", ...TREE.uneasy.find(([m]) => m === "guilty")?.[1] ?? []]);
const V10_FALLBACK = {
  happy: "happy",
  sad: "sad",
  fear: "uneasy",
  anger: "angry",
  surprise: "curious",
  disgust: "angry"
};
export function remapV10Feeling(core, emotion, otherWord) {
  const entry = entryOfFeeling(emotion, otherWord);
  const key = emotion === OTHER_EMOTION || entry === undefined ? emotion : entry.key;
  if (!V10_CORES.includes(core))
    return { core, emotion: key };
  const old = core;
  const byWord = () => {
    if (entry === undefined)
      return null;
    if (isCoreEmotion(old) && underCore(entry, old))
      return old;
    return entry.core;
  };
  let now;
  if (old === "happy" || old === "surprise")
    now = byWord() ?? V10_FALLBACK[old];
  else if (old === "sad")
    now = entry !== undefined && GUILT.has(entry.key) ? "uneasy" : "sad";
  else
    now = V10_FALLBACK[old];
  return { core: now, emotion: key };
}
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1;i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1;j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(up + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}
