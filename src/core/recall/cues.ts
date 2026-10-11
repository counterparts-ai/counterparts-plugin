/**
 * Cues — what the turn is *about*, before anything is looked up.
 *
 * Two rules do most of the work here, both measured in v1:
 *
 *   §9 G3 — **host boilerplate is stripped before cue extraction and before
 *   embedding.** Injected context, image placeholders and command echoes are not
 *   experience. (Measured: an image placeholder token surfaced an unrelated
 *   image-cache memory.) The strippers are a NAMED TABLE so a test can enumerate
 *   them; a regex buried in a function is not an auditable rule.
 *
 *   §9 G4 — **cue matching is word-bounded and rarity-weighted.** A distinctive
 *   proper noun fires strongly; a name spanning the whole store contributes
 *   nothing. *Informativeness weighting replaces stop-lists* — there is no stop
 *   list in this file, deliberately: "the" scores zero because it is everywhere,
 *   which is the same reason a project name scores zero once every memory
 *   mentions it.
 *
 * Word-boundedness is inherited, not re-implemented: `tokenize` comes from the
 * store's cache module, so a cue is tokenized byte-for-byte the way the index was
 * built. A second tokenizer here would be the observer-predicate mistake in
 * miniature (observer-mode.md G7).
 *
 * NO MODEL CALLS. Vectors are inputs (contract §5 G1) — this file has no network
 * import and no client; the turn's embedding arrives from the caller or not at all,
 * and its absence degrades to lexical-only rather than failing.
 */
import { tokenize } from "../store/index.js";
import type { RecallTunables } from "./tunables.js";

/** One host-boilerplate stripper. Named, so the totality test can enumerate them. */
export interface Stripper {
  readonly name: string;
  readonly why: string;
  readonly pattern: RegExp;
}

/**
 * The strip table. Order is irrelevant (each pass is independent); membership is
 * the point. `counterparts-injection` is the self-reference guard: recall's own
 * render lands in the transcript, and re-cueing on it would make every surfaced
 * memory permanently self-confirming.
 */
export const STRIPPERS: readonly Stripper[] = [
  {
    name: "system-reminder",
    why: "Host-injected context. Not the user's experience.",
    pattern: /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  },
  {
    name: "command-echo",
    why: "Slash-command echoes and their stdout are the tool talking, not the turn.",
    pattern:
      /<(command-name|command-message|command-args|local-command-stdout|local-command-stderr)>[\s\S]*?<\/\1>/gi,
  },
  {
    name: "image-placeholder",
    why: "MEASURED (v1 §9 G3): an image placeholder token surfaced an unrelated image-cache memory.",
    pattern: /\[(?:image|screenshot|attachment)[^\]]*\]/gi,
  },
  {
    name: "data-uri",
    why: "Base64 payloads mint thousands of junk tokens and no meaning.",
    pattern: /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi,
  },
  {
    name: "counterparts-injection",
    why: "Recall's own render. Re-cueing on it makes every surfaced memory self-confirming.",
    pattern: /<!--\s*counterparts:recall[\s\S]*?counterparts:recall\/end[^>]*-->/gi,
  },
  {
    name: "tool-result-block",
    why: "Tool output is the environment answering, not the user speaking.",
    pattern: /<(function_results|tool_result)>[\s\S]*?<\/\1>/gi,
  },
];

/** Strip host boilerplate. Returns the text and which strippers actually fired. */
export function stripBoilerplate(text: string): { text: string; stripped: string[] } {
  let out = text;
  const fired: string[] = [];
  for (const s of STRIPPERS) {
    const next = out.replace(s.pattern, " ");
    if (next !== out) fired.push(s.name);
    out = next;
  }
  return { text: out, stripped: fired };
}

/**
 * The smallest store on which "this token spans the whole store" says anything.
 *
 * Rarity is a statement about ALTERNATIVES — a token is uninformative because
 * the memories it does not distinguish exist. With one memory there are no
 * alternatives, so "in every memory" and "in the only memory there is" are the
 * same sentence, and reading the first one is a category error rather than a
 * measurement. Below this size the store is read as one of exactly this size:
 * the smallest store where the zero means what §9 G4 says it means.
 *
 * Definitional, not tunable — it is the domain of the rule, not a dial — so it
 * lives here beside the function and not in `tunables.ts`.
 */
export const MIN_RARITY_STORE = 2;

/**
 * Informativeness (inverse document frequency), smoothed so it is defined for a
 * two-document store and EXACTLY ZERO for a token that spans the whole store
 * (for `storeSize >= MIN_RARITY_STORE` — see the constant for the one-memory
 * degeneracy and why it is not an exception to the rule but its domain).
 * That zero is the point: it is what replaces the stop list.
 *
 * MEASURED 2026-09-04, the bug that named the constant: on a store of ONE the
 * literal reading returns `log((1 + 1) / (2 * 1))` = `log(1)` = exactly zero for
 * every token, `buildCues` drops every zero-weight cue, and the index is never
 * probed — so the first memory anyone writes was uncueable until a second,
 * unrelated one arrived. `recall` answered `nothing-came, considered: 0,
 * storeSize: 1` while the `handle` and `ids` paths returned the same memory.
 */
export function informativeness(df: number, storeSize: number): number {
  if (df <= 0 || storeSize <= 0) return 0;
  return Math.max(0, Math.log((Math.max(storeSize, MIN_RARITY_STORE) + df) / (2 * df)));
}

/** Saturating term frequency: a word repeated ten times is not ten cues. */
export function tfFactor(tf: number): number {
  if (tf <= 0) return 0;
  return (2 * tf) / (tf + 1);
}

export interface Cue {
  readonly token: string;
  /** Rarity weight, after ambiguity discount and carry-over decay. */
  readonly weight: number;
  /** Occurrences in the turn (pre-saturation). */
  readonly tf: number;
  /** A handle pointing at more than one memory: fires at reduced weight AND
   *  trains nothing. Both halves — the training half is enforced in
   *  `Recall.resolveUse`, which is a real consumer, not a comment (scar §2.6). */
  readonly ambiguous: boolean;
  /** Carried from the previous turn at CARRY_DECAY, for one turn only. */
  readonly carried: boolean;
}

export interface CueInput {
  /** Already stripped. */
  readonly text: string;
  /** Cues carried from the previous turn (see `GateState.carriedCues`). */
  readonly carried?: readonly string[];
  /** handle -> memory ids. Caller-supplied until `encode/` owns an alias index
   *  (INTERFACE-GAPS.md #2). A handle with >= 2 ids is ambiguous. */
  readonly aliases?: ReadonlyMap<string, readonly string[]>;
  /** Live memory count, for informativeness. */
  readonly storeSize: number;
  /** token -> document frequency, measured against the index. */
  readonly df: ReadonlyMap<string, number>;
}

/**
 * Turn text -> weighted cues. Pure: every corpus statistic it needs arrives in
 * `CueInput`, so this function is testable without a store and cannot smuggle in
 * an I/O call on the hot path.
 */
export function buildCues(input: CueInput, t: RecallTunables): Cue[] {
  const counts = new Map<string, number>();
  for (const tok of tokenize(input.text)) {
    if (tok.length < t.MIN_CUE_LENGTH) continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  const cues: Cue[] = [];
  const seen = new Set<string>();
  for (const [token, tf] of counts) {
    const df = input.df.get(token) ?? 0;
    const idf = informativeness(df, input.storeSize);
    if (idf <= 0) continue;
    const ids = input.aliases?.get(token);
    const ambiguous = ids !== undefined && ids.length >= 2;
    const weight = idf * tfFactor(tf) * (ambiguous ? t.AMBIGUOUS_WEIGHT : 1);
    if (weight <= 0) continue;
    seen.add(token);
    cues.push({ token, weight, tf, ambiguous, carried: false });
  }
  for (const token of input.carried ?? []) {
    if (seen.has(token)) continue;
    const df = input.df.get(token) ?? 0;
    const idf = informativeness(df, input.storeSize);
    if (idf <= 0) continue;
    const ids = input.aliases?.get(token);
    const ambiguous = ids !== undefined && ids.length >= 2;
    const weight = idf * t.CARRY_DECAY * (ambiguous ? t.AMBIGUOUS_WEIGHT : 1);
    if (weight <= 0) continue;
    seen.add(token);
    cues.push({ token, weight, tf: 0, ambiguous, carried: true });
  }
  cues.sort((a, b) => b.weight - a.weight || (a.token < b.token ? -1 : 1));
  return cues.slice(0, t.MAX_CUES);
}

// ---------------------------------------------------------------------------
// Affect — turn-gated, and that gate is the safety property (§9 G10, G11)
// ---------------------------------------------------------------------------

/**
 * A small, NAMED list of stated-feeling words. This is not a stop list wearing a
 * hat: informativeness weighting answers "which words are cues", and this answers
 * a different question — "does the present turn carry feeling at all". v1's
 * emotion rule is stated-only (never inferred), so a fixed vocabulary is the
 * honest implementation and its smallness is visible rather than hidden in a model.
 */
export const FEELING_WORDS: readonly string[] = [
  "afraid", "angry", "anxious", "ashamed", "bitter", "dread", "excited", "frustrated",
  "grateful", "grief", "guilty", "happy", "hurt", "lonely", "nervous", "overwhelmed",
  "proud", "regret", "relieved", "sad", "scared", "stressed", "terrified", "tired",
  "upset", "worried",
];

/**
 * SUBJECT-position first person only. "me", "us" and "our" are deliberately
 * absent: *"she told me that Robin was upset"* is a third party's feeling
 * reported to the speaker, and reading it as the speaker's own is precisely the
 * mood-congruent overgeneralization G11 exists to prevent.
 */
const FIRST_PERSON = new Set(["i", "im", "ive", "id", "my", "mine", "myself", "we", "weve"]);

/** Scanning back stops here: another subject owns the feeling. */
const THIRD_PERSON = new Set(["he", "she", "they", "her", "his", "their", "theyre", "you", "youre"]);

const FEELING = new Set(FEELING_WORDS);

export interface AffectSignal {
  /** ANY subject stated a feeling. The FLAG is subject-inclusive (§9 G11). */
  readonly stated: boolean;
  /** The speaker stated their OWN feeling. The retrieval CUE is first-person
   *  only — the guard against mood-congruent overgeneralization (§9 G11). */
  readonly selfFelt: boolean;
  /** The feeling word that fired, for telemetry. Content-by-reference: it is a
   *  vocabulary index, not turn text. */
  readonly word: string | null;
}

/** Look back this far for a first-person subject ("I have been feeling pretty tired"). */
const SUBJECT_WINDOW = 5;

/**
 * Affect detection is NOT index matching, so it does not use the store's
 * `tokenize`: that one drops tokens shorter than two characters, which throws
 * away the single most important word here — "I". The subject rule of §9 G11 is
 * unimplementable on a tokenizer that cannot see the first person.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

export function detectAffect(text: string): AffectSignal {
  const toks = words(text);
  let stated = false;
  let word: string | null = null;
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok === undefined || !FEELING.has(tok)) continue;
    stated = true;
    word ??= tok;
    // Nearest subject wins: scan backwards and stop at whichever comes first.
    for (let j = i - 1; j >= Math.max(0, i - SUBJECT_WINDOW); j--) {
      const back = toks[j];
      if (back === undefined) continue;
      if (THIRD_PERSON.has(back)) break;
      if (FIRST_PERSON.has(back)) return { stated: true, selfFelt: true, word: tok };
    }
  }
  return { stated, selfFelt: false, word };
}
