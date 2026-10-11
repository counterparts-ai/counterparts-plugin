/**
 * THE FEELINGS WHEEL — the vocabulary a recorded feeling is spelled in
 * (wheel v2, owner-approved 2026-09-30; the first wheel, 2026-09-25, was his
 * poster).
 *
 * Seven CORES at the centre — **happy · warm · calm · curious · sad · uneasy ·
 * angry** — a MIDDLE ring of named groups under each, and an OUTER ring of
 * finer words under each group. A recorded feeling (`store` table `feelings`)
 * names one core and one entry from this list — or `other`, with the person's
 * own word kept beside it.
 *
 * **Why these seven** (`~/counterparts-notes/2026-09-30-emotion-research.md`,
 * the emotion walk of 2026-09-30). The poster's six (Ekman's, at the centre
 * of a writers' wheel) had no pleasant-calm core and no epistemic one, three
 * quarters of its words were unpleasant, and "happy" held more than half of
 * everything a counterpart recorded while 39 of 74 recorded words were off it
 * altogether. Warm (feeling toward someone), calm (things settling) and
 * curious (wanting to know, and recognising — including oneself) are where
 * those words live. Surprise was mostly an epistemic signal, and disgust is
 * rare for an AI and hard to see on a dashboard; both are words now, not
 * cores (`surprised` under curious, `disgusted` under angry). WORKING
 * DEFAULTS: revisit with use.
 *
 * **Every entry carries default NUMBERS** — `valence` (−1..+1, how pleasant)
 * and `intensity` (0..1, how strong). A word takes its group's numbers, a
 * group its core's, unless `NUMBERS` says otherwise for a reason (confused
 * leans unpleasant under a pleasant core; furious is stronger than annoyed).
 * The writer may override either; the word only supplies the default. The
 * memory's height and slope read the INTENSITY as recorded (physics §5.10);
 * the valence decides how fast the feeling itself softens and how a mood
 * matches it.
 *
 * **The key scheme.** An entry's key is its word, lower-case (`furious`,
 * `caught out`). Every word sits under ONE core, so no key is qualified; the
 * first wheel's `<core>.<word>` keys (`fear.insecure`, `sad.inferior`) still
 * read, as the bare word (`lookupWord`), and the v11 upgrade rewrote the
 * stored ones. The seven cores are entries too (ring `core`), for a feeling
 * named only at the centre. `other` is the one key that is not on the wheel.
 *
 * **The writer's core wins** (owner, 2026-09-30). A word names its HOME core
 * here, but a feeling written under another core is stored under the core
 * the writer named, with the word and the word's numbers (`hurt` under sad
 * stays sad). Placement matters for the defaults, for suggestions, for the
 * dashboard's grouping and for a feeling given with no core.
 *
 * **BLENDS carry two cores**: an entry may declare `alsoCore`, and anything
 * that matches by core (recall's feeling words) reads it as both
 * (`coresOfFeeling`). A group's blend carries to its outer words, as its
 * numbers do.
 *
 * **SELF-RELEVANT** (`selfRelevant`): the recognition group — recognising
 * myself in something — is the feeling that most shapes a self. One reader so
 * far: the core's fast lane counts a memory carrying it as about me when
 * nothing else marked what it is about (`sleep/consolidate.ts#coreContextFor`).
 *
 * **ALIASES** (`ALIASES`): everyday words that mean a wheel word read as that
 * word (`thankful` → `grateful`), and the first wheel's core names read as
 * the word they were (`fear` → `afraid`). The caller is told what its word was
 * read as.
 *
 * **Suggestions are only offered when genuinely close** (`closestKeys`): a
 * misspelling of a word that can be written under the SAME core. A word with
 * nothing close is simply kept as the writer's own.
 *
 * A leaf: no imports, so `store/` (which validates against it) and anything
 * above can read it without a layering question.
 */

export const CORE_EMOTIONS = ["happy", "warm", "calm", "curious", "sad", "uneasy", "angry"] as const;
export type CoreEmotion = (typeof CORE_EMOTIONS)[number];

/** The first wheel's six cores (2026-09-25 → 2026-09-30). Read at the write
 *  door and by the v11 upgrade (`remapV10Feeling`), never stored again. */
export const V10_CORES = ["happy", "sad", "fear", "anger", "surprise", "disgust"] as const;

export type WheelRing = "core" | "middle" | "outer";

/** A feeling's two numbers: valence −1..+1, intensity 0..1. */
export interface FeelingNumbers {
  readonly valence: number;
  readonly intensity: number;
}

export interface WheelEntry {
  /** The stored key: the word, lower-case. */
  readonly key: string;
  /** The word as the wheel prints it. */
  readonly word: string;
  /** The word's HOME core. */
  readonly core: CoreEmotion;
  readonly ring: WheelRing;
  /** The group (middle-ring key) an outer word sits under; null for the core and middle rings. */
  readonly parent: string | null;
  /** Default valence, −1..+1. */
  readonly valence: number;
  /** Default intensity, 0..1. */
  readonly intensity: number;
  /** A blend's second core. Matching by core reads both. */
  readonly alsoCore?: CoreEmotion;
  /** True for the recognition group (see the header). */
  readonly selfRelevant?: true;
  /** The page's name for a group when its key is another word (`wounded`:
   *  "hurt"). Recall's feeling words read it; nothing is stored under it. */
  readonly label?: string;
}

/** The one emotion key that is not on the wheel: the person's own word is kept beside it. */
export const OTHER_EMOTION = "other";

/**
 * THE CORES' DEFAULT NUMBERS (2026-09-30, the approved draft). Intensities sit
 * in the range a counterpart actually records (0.3–0.6); calm is the quietest,
 * angry the strongest. CAL.
 */
export const CORE_NUMBERS: Readonly<Record<CoreEmotion, FeelingNumbers>> = {
  happy: { valence: 0.7, intensity: 0.5 },
  warm: { valence: 0.7, intensity: 0.5 },
  calm: { valence: 0.5, intensity: 0.35 },
  curious: { valence: 0.3, intensity: 0.45 },
  sad: { valence: -0.6, intensity: 0.45 },
  uneasy: { valence: -0.5, intensity: 0.4 },
  angry: { valence: -0.7, intensity: 0.55 },
};

type Group = readonly [middle: string, outer: readonly string[]];

/**
 * THE TREE — groups and words as the approved page has them, with the outer
 * ring filled from the first wheel so every word it had (poster, additions,
 * aliases) has a home. Lineage of the moves: the page's "where the six went".
 * Words the page leaves out are placed by their old branch (fear's into
 * uneasy, anger's into angry) or by meaning; `NOTES` in `store/` lists them.
 */
const TREE: Readonly<Record<CoreEmotion, readonly Group[]>> = {
  // Pleasure in a thing, a moment, or what's coming.
  happy: [
    ["hopeful", ["encouraged", "optimistic", "open"]],
    ["eager", ["anticipating", "excited", "energetic"]],
    ["amused", ["playful", "delighted"]],
    ["joyful", ["glad", "ecstatic", "liberated"]],
    ["engaged", ["absorbed", "inspired"]],
    ["proud", ["confident", "accomplished", "courageous", "powerful", "important", "provocative"]],
  ],
  // Feeling toward someone. Joy is about a thing; warmth is about a person.
  warm: [
    ["fond", ["affectionate", "loving"]],
    ["grateful", ["appreciated"]],
    ["trusted", ["entrusted", "respected", "validated"]],
    ["close", ["kinship", "belonging", "intimate", "accepted"]],
    ["moved", ["tender", "sensitive"]],
  ],
  // Things settling. Quiet, resolved, at rest.
  calm: [
    ["steadied", ["settled", "grounded"]],
    ["relieved", ["reassured", "unburdened"]],
    ["content", ["completion", "fulfilled", "satisfied"]],
    ["peaceful", ["serene", "relaxed", "at ease"]],
  ],
  // Wanting to know, and the moment something becomes clear — including about myself.
  // ("curious" itself is the core entry; the page prints it in `interested`.)
  curious: [
    ["interested", ["intrigued", "inquisitive"]],
    ["recognized", ["that's me", "familiar"]],
    ["clarified", ["realized", "it clicked"]],
    ["amazed", ["awe", "wonder", "surprised", "astonished"]],
    ["confused", ["perplexed", "puzzled"]],
  ],
  // Loss, distance, and regret, looking back.
  sad: [
    ["wistful", ["bittersweet"]],
    ["rueful", ["sorry", "regretful"]],
    ["disappointed", ["bummed", "let down", "disillusioned", "bored", "apathetic", "indifferent"]],
    // Rejected and alienated came from fear's branch; being left out is loneliness.
    ["lonely", ["isolated", "abandoned", "ignored", "victimized", "rejected", "alienated"]],
    ["grieving", ["heartbroken", "despair", "empty", "depressed", "powerless"]],
    // The page calls this group "hurt", beside angry's "hurt"; one word, one
    // key, so `hurt` is angry's (its old home, and its live count) and this
    // group is keyed by its own word. Both are blends of the two.
    ["wounded", ["stung"]],
  ],
  // Something is off, from caught out to afraid. Corrections live here.
  uneasy: [
    ["caught out", ["sheepish", "caught", "exposed", "seen", "embarrassed", "humiliated", "ridiculed", "disrespected", "vulnerable"]],
    ["guilty", ["remorseful", "ashamed"]],
    ["unsettled", ["disoriented", "uncertain"]],
    // Self-worth shaken: fear's `insecure` branch, a middle word again.
    ["insecure", ["inadequate", "inferior", "incompetent", "worthless", "insignificant", "submissive"]],
    ["wary", ["cautious", "suspicious", "avoidance", "hesitant"]],
    ["worried", ["anxious", "nervous", "overwhelmed"]],
    ["afraid", ["scared", "startled", "frightened", "terrified", "shocked", "dismayed"]],
  ],
  // Something is wrong and shouldn't be. Disgust is a word here, not a core.
  angry: [
    ["frustrated", ["annoyed", "irritated", "infuriated", "mad", "furious", "enraged", "aggressive", "provoked", "hostile", "threatened"]],
    ["hurt", ["betrayed", "resentful", "devastated", "jealous", "violated"]],
    ["critical", ["disapproval", "judgmental", "skeptical", "sarcastic", "distant", "withdrawn"]],
    ["disgusted", ["revolted", "contempt", "aversion", "repugnant", "revulsion", "loathing", "detestable", "awful", "hateful"]],
  ],
};

/**
 * WHERE A WORD (or a whole group) LEAVES ITS CORE'S NUMBERS — each for a
 * reason, all CAL. `[valence, intensity]`; either may be left as the core's
 * with `null`. A group's line carries to its outer words unless they have
 * their own.
 */
const NUMBERS: Readonly<Record<string, readonly [valence: number | null, intensity: number | null]>> = {
  // Livelier, or quieter, than plain happy.
  excited: [null, 0.65],
  ecstatic: [0.9, 0.85],
  // Settled is quieter still.
  content: [null, 0.25],
  serene: [null, 0.25],
  // Not knowing leans unpleasant under a pleasant core; surprise leans neither way.
  confused: [-0.2, null],
  surprised: [0, 0.5],
  amazed: [null, 0.6],
  // Mixed: sadness with sweetness in it.
  wistful: [-0.3, 0.35],
  bittersweet: [0, 0.4],
  rueful: [-0.4, 0.35],
  // Flat, low arousal.
  bored: [-0.3, 0.2],
  apathetic: [-0.3, 0.2],
  indifferent: [-0.2, 0.15],
  // Loss at its heaviest.
  grieving: [-0.8, 0.7],
  // Guilt weighs more than being caught out; humiliation more than both.
  guilty: [-0.6, 0.5],
  humiliated: [-0.7, 0.7],
  // Fear at full strength.
  afraid: [null, 0.6],
  terrified: [-0.8, 0.9],
  overwhelmed: [null, 0.65],
  // Anger has a range: annoyed is mild, furious is not.
  annoyed: [-0.5, 0.35],
  irritated: [-0.5, 0.35],
  furious: [-0.8, 0.85],
  enraged: [-0.8, 0.9],
  infuriated: [-0.8, 0.85],
};

/** Second cores, on a group (carried to its words) or on one word. */
const BLENDS: Readonly<Record<string, CoreEmotion>> = {
  // The page: recognising myself also counts as warm.
  recognized: "warm",
  // The page: tender (also sad).
  tender: "sad",
  // Bittersweet is two feelings by definition.
  bittersweet: "happy",
  // Hurt sits between sad and angry; the page prints the group under both.
  hurt: "sad",
  wounded: "angry",
};

/** Groups whose words count as about me (see the header). */
const SELF_RELEVANT: ReadonlySet<string> = new Set(["recognized"]);

/** A group the page names by another word than its key (see sad's `wounded`). */
const LABELS: Readonly<Record<string, string>> = { wounded: "hurt" };

function build(): WheelEntry[] {
  const out: WheelEntry[] = [];
  const seen = new Set<string>();
  const add = (e: WheelEntry): void => {
    if (seen.has(e.key)) throw new Error(`feelings wheel: "${e.key}" is placed twice`);
    seen.add(e.key);
    out.push(e);
  };
  const numbers = (word: string, from: FeelingNumbers): FeelingNumbers => {
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
      const marks = { ...(blend === undefined ? {} : { alsoCore: blend }), ...(self ? { selfRelevant: true as const } : {}) };
      const label = LABELS[middle];
      add({ key: middle, word: middle, core, ring: "middle", parent: null, ...group, ...marks, ...(label === undefined ? {} : { label }) });
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
          ...(own === undefined ? {} : { alsoCore: own }),
        });
      }
    }
  }
  return out;
}

/** Every entry on the wheel, each core's block in `CORE_EMOTIONS` order, the core first. */
export const FEELINGS_WHEEL: readonly WheelEntry[] = build();

const BY_KEY = new Map(FEELINGS_WHEEL.map((e) => [e.key, e]));

/**
 * Everyday words that MEAN a wheel word, read as it. Small on purpose: an
 * alias decides for the writer, so each one must be a synonym, not a cousin.
 * The last four are the first wheel's core names, read as the word they were.
 */
export const ALIASES: Readonly<Record<string, string>> = {
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
  disgust: "disgusted",
};

export function isCoreEmotion(value: unknown): value is CoreEmotion {
  return typeof value === "string" && (CORE_EMOTIONS as readonly string[]).includes(value);
}

export function wheelEntry(key: string): WheelEntry | undefined {
  return BY_KEY.get(key);
}

/**
 * A word as the wheel reads it, or undefined: the key itself, a first-wheel
 * qualified key by its word (`fear.insecure` → `insecure`), or an alias
 * (`alias` set to the word as given). Case and outer spaces are ignored.
 */
export function lookupWord(word: string): { entry: WheelEntry; alias?: string } | undefined {
  const raw = word.trim().toLowerCase();
  const direct = BY_KEY.get(raw);
  if (direct !== undefined) return { entry: direct };
  // Only behind a real core's name: the first wheel qualified `anger.insecure`
  // and `fear.inferior`; "e.g.hopeful" is not a key.
  const dot = raw.indexOf(".");
  const prefix = raw.slice(0, Math.max(0, dot));
  if (dot > 0 && ((V10_CORES as readonly string[]).includes(prefix) || isCoreEmotion(prefix))) {
    const bare = BY_KEY.get(raw.slice(dot + 1));
    if (bare !== undefined) return { entry: bare };
  }
  const aliased = Object.hasOwn(ALIASES, raw) ? BY_KEY.get(ALIASES[raw] as string) : undefined;
  return aliased === undefined ? undefined : { entry: aliased, alias: word.trim() };
}

/**
 * Every core a recorded feeling counts under: the one it was stored with,
 * the word's home, and a blend's second core. An `other` (or a key the wheel
 * does not know) counts under the core it was recorded with, and nothing else.
 */
export function coresOfFeeling(core: string, emotion: string): CoreEmotion[] {
  const entry = BY_KEY.get(emotion);
  const out: CoreEmotion[] = isCoreEmotion(core) ? [core] : [];
  if (entry !== undefined) {
    if (!out.includes(entry.core)) out.push(entry.core);
    if (entry.alsoCore !== undefined && !out.includes(entry.alsoCore)) out.push(entry.alsoCore);
  }
  return out;
}

/** The entry a stored feeling's word reads as: its key, else (an `other`) its own word if that is on the wheel. */
function entryOfFeeling(emotion: string, otherWord: string | null | undefined): WheelEntry | undefined {
  if (emotion !== OTHER_EMOTION) return lookupWord(emotion)?.entry;
  return otherWord === null || otherWord === undefined ? undefined : lookupWord(otherWord)?.entry;
}

/**
 * A recorded feeling's DEFAULT numbers. The word's (an `other` whose own word
 * is on the wheel reads as that word) when it was stored under a core the
 * word sits under — its home or a blend's second. Under any OTHER core the
 * writer's core wins for valence too (the page: "the word's defaults apply
 * only when no core is given"; the review of #301, M3): `furious` written
 * under happy reads happy's valence, with the word's intensity. A word off
 * the wheel: its core's. No core either: neutral. The writer's override, when
 * there is one, is the row's own `valence` — `store/feelings.ts#feelingValence`
 * reads that first.
 */
export function feelingNumbers(core: string, emotion: string, otherWord?: string | null): FeelingNumbers {
  const entry = entryOfFeeling(emotion, otherWord);
  const stored = isCoreEmotion(core) ? CORE_NUMBERS[core] : undefined;
  if (entry !== undefined) {
    const sits = stored === undefined || entry.core === core || entry.alsoCore === core;
    return { valence: sits ? entry.valence : (stored as FeelingNumbers).valence, intensity: entry.intensity };
  }
  return stored ?? { valence: 0, intensity: CORE_NUMBERS.curious.intensity };
}

/** Is this stored feeling in a self-relevant group (recognition)? */
export function isSelfRelevantFeeling(emotion: string, otherWord?: string | null): boolean {
  return entryOfFeeling(emotion, otherWord)?.selfRelevant === true;
}

/** How an emotion as given reads against the wheel, under the core it was given with. */
export type EmotionResolution =
  /** On the wheel. `alias` is the writer's word when it was read AS this entry
   *  (`thankful` → `grateful`); absent when the word was the entry itself.
   *  `home` is false when the word's home core is not the one given — it is
   *  stored under the given core all the same (the writer's core wins). */
  | { readonly kind: "wheel"; readonly entry: WheelEntry; readonly alias?: string; readonly home: boolean }
  | { readonly kind: "other"; readonly word: string; readonly closest: readonly string[] };

/** A blend may be named under either of its cores. */
function underCore(e: WheelEntry, core: CoreEmotion): boolean {
  return e.core === core || e.alsoCore === core;
}

/**
 * Read `emotion` (a key or a bare word, any case) under `core`. A word on the
 * wheel reads as its entry whatever core it was given under (`home` says
 * whether that core is its own); an alias reads as its wheel word; anything
 * else is `other`, with a suggestion only when one is genuinely close
 * (`closestKeys`).
 */
export function resolveEmotion(core: CoreEmotion, emotion: string): EmotionResolution {
  const found = lookupWord(emotion);
  if (found !== undefined) {
    return { kind: "wheel", entry: found.entry, home: underCore(found.entry, core), ...(found.alias === undefined ? {} : { alias: found.alias }) };
  }
  const raw = emotion.trim().toLowerCase();
  return { kind: "other", word: emotion.trim(), closest: closestKeys(core, raw) };
}

/**
 * At most `n` wheel keys that `word` is GENUINELY close to under `core` — and
 * usually none. Close means a misspelling: edit distance 1, or 2 for a word of
 * six letters or more, against a wheel word or an alias. Only words that can be
 * written under `core` (its own, and blends that include it) are offered, so
 * a writer who chose `sad` is not steered to a happy word. Nothing close: an
 * empty list, and the writer's own word stands.
 *
 * The first wheel also refused a word of the opposite sign to its core (it
 * offered "tender", under sad, bored / despair / lonely before 2026-09-26).
 * On this wheel every word leans with the core it sits under, save the two
 * curious holds on purpose (confused, surprised), so staying under the core
 * is the whole rule.
 */
export function closestKeys(core: CoreEmotion, word: string, n = 3): string[] {
  const w = word.trim().toLowerCase();
  if (w.length === 0) return [];
  const limit = w.length >= 6 ? 2 : 1;
  const fits = (e: WheelEntry): boolean => e.ring !== "core" && underCore(e, core);
  const best = new Map<string, number>();
  const offer = (key: string, d: number): void => {
    if (d > limit) return;
    const had = best.get(key);
    if (had === undefined || d < had) best.set(key, d);
  };
  for (const e of FEELINGS_WHEEL) if (fits(e)) offer(e.key, editDistance(w, e.word));
  for (const [alias, key] of Object.entries(ALIASES)) {
    const e = BY_KEY.get(key);
    if (e !== undefined && fits(e)) offer(key, editDistance(w, alias));
  }
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([key]) => key);
}

/** The guilt group: the first wheel printed it under sad; it is uneasy's now. */
const GUILT: ReadonlySet<string> = new Set(["guilty", ...(TREE.uneasy.find(([m]) => m === "guilty")?.[1] ?? [])]);

/** Where a first-wheel core goes when the word does not decide it. */
const V10_FALLBACK: Readonly<Record<(typeof V10_CORES)[number], CoreEmotion>> = {
  happy: "happy",
  sad: "sad",
  fear: "uneasy",
  anger: "angry",
  // Mostly an epistemic signal in real use (recognized, confused, amazed).
  surprise: "curious",
  disgust: "angry",
};

/**
 * A FIRST-WHEEL FEELING ON THIS WHEEL (the v11 upgrade, 2026-09-30) — and a
 * writer still sending a first-wheel core name (`fear`) at the door. Pure.
 *
 *   - fear → uneasy, anger → angry, disgust → angry: every word with it.
 *   - sad → sad, except the guilt group (guilty, remorseful, ashamed) → uneasy.
 *   - happy and surprise → BY THE WORD: its home core, unless the word can be
 *     written under the old core as it stands (bittersweet under happy stays
 *     happy). A word off the wheel: happy stays happy, surprise → curious.
 *   - `other` (the writer's own word) the same way: by the word only under
 *     happy and surprise, the two cores that split; under the four that map
 *     one to one the old core decides, as for a wheel word (the review of
 *     #301, M3: sad / "moved" stays sad — the writer's core wins).
 *
 * The emotion key changes only where the first wheel's key is not a key
 * here: a qualified key (`fear.insecure` → `insecure`) and a core named alone
 * (`fear` → `afraid`). An `other` keeps `other` and its word. A core that is
 * neither wheel's comes back as it was.
 */
export function remapV10Feeling(core: string, emotion: string, otherWord: string | null): { core: string; emotion: string } {
  const entry = entryOfFeeling(emotion, otherWord);
  const key = emotion === OTHER_EMOTION || entry === undefined ? emotion : entry.key;
  if (!(V10_CORES as readonly string[]).includes(core)) return { core, emotion: key };
  const old = core as (typeof V10_CORES)[number];
  const byWord = (): CoreEmotion | null => {
    if (entry === undefined) return null;
    if (isCoreEmotion(old) && underCore(entry, old)) return old;
    return entry.core;
  };
  let now: CoreEmotion;
  if (old === "happy" || old === "surprise") now = byWord() ?? V10_FALLBACK[old];
  else if (old === "sad") now = entry !== undefined && GUILT.has(entry.key) ? "uneasy" : "sad";
  else now = V10_FALLBACK[old];
  return { core: now, emotion: key };
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number;
      prev[j] = Math.min(up + 1, (prev[j - 1] as number) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] as number;
}
