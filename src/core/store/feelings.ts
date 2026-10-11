/**
 * FEELINGS ON A MEMORY — the `feelings` table's shape and the one check every
 * write of it crosses (schema v7, owner-approved 2026-09-25; the seven cores
 * and the numbers, v11, 2026-09-30).
 *
 * One row per feeling. A memory can hold several: mixed feelings are several
 * rows, and the owner's and this self's feelings about the same moment sit side
 * by side, told apart by `whose`. Each names a `core` (one of seven) and an
 * `emotion` from the wheel (`core/feelings-wheel.ts`), or `other` with the
 * person's own word kept in `other_word`. `strength` is the INTENSITY,
 * recorded as felt and never rewritten — softening with time is for a reader
 * to compute. `valence` (v11) is the writer's own reading of how pleasant it
 * was, NULL when the writer gave none: a reader then takes the word's default
 * (`feelingValence`), so the defaults can be tuned without rewriting a row. A
 * feeling can sit on top of another on the same memory (`beneath_id`: angry
 * over afraid). `carried_by` says briefly what in the moment carried it — the
 * words, what happened — and need not be a statement of feeling.
 *
 * READ SINCE 2026-09-26 (emotion part A). The strongest recorded strength on
 * a memory joins its numeric `emotional` score as its emotional intensity,
 * which lifts its height and slows its decay (physics §5.10, read beside the row
 * by `Store.row()`); a feeling recorded in the last few hours sets the mood
 * that recall matches against (recall G18). The `meta.feeling` label is still
 * only a label.
 *
 * THE WRITER'S CORE WINS (owner, 2026-09-30). A wheel word named under a core
 * it does not sit under is stored under the core the writer named, with the
 * word and the word's numbers — `hurt` under sad stays sad. (From 2026-09-28
 * it was moved to the word's own core and the move reported; before that,
 * refused.) Only a feeling sent with no core takes its word's home core. A
 * first-wheel core name (`fear`, `anger`, `surprise`, `disgust`) still
 * reads, as the v11 upgrade would have filed it, and the caller is told.
 */
import {
  CORE_EMOTIONS,
  OTHER_EMOTION,
  V10_CORES,
  closestKeys,
  feelingNumbers,
  isCoreEmotion,
  lookupWord,
  remapV10Feeling,
  resolveEmotion,
} from "../feelings-wheel.js";
import type { CoreEmotion } from "../feelings-wheel.js";
/** Re-exported for `sleep/`, which reads the wheel only through the store (the
 *  recognition lane, `sleep/consolidate.ts#selfRelevantFeeling`). */
export { isSelfRelevantFeeling } from "../feelings-wheel.js";
import type { Row } from "./db.js";
import { StoreError } from "./errors.js";

/** Whose feeling it is. Two today; the column is TEXT so a person (an entity
 *  id) can join later without a migration. */
export const FEELING_WHOSE = ["owner", "self"] as const;
export type FeelingWhose = (typeof FEELING_WHOSE)[number];

/**
 * v9 (2026-09-27): WHO RECORDED A FEELING. `session` — a writer in a session,
 * at the moment or at its end (every feeling before v9 but a dream's); `dream`
 * — a dream's feeling-now, capped at the memory's peak; `reflection` — the
 * waking self's feeling-now, which may be stronger than anything written at
 * the time and is marked `recorded_later` with its date. The core's fast lane
 * reads only the first two unless `CORE_FAST_ACCEPTS_REFLECTED_FEELING` is set
 * (physics §5.3).
 *
 * `awake` (2026-10-02, lane B): the same feeling-now, recorded in an ordinary
 * session when an old memory came up and felt different (`note`'s
 * `feelingsNow`, `dream/reflect.ts#feelAgain`). No schema change — the column
 * is TEXT. It is a LATER feeling exactly as a reflection's is: marked
 * `recorded_later`, and read by the fast lane only through the same door
 * (`LATER_FEELING_SOURCES`).
 */
export const FEELING_SOURCES = ["session", "dream", "reflection", "awake"] as const;
export type FeelingSource = (typeof FEELING_SOURCES)[number];
/**
 * The sources of a feeling recorded LATER, looking back — the ones the core's
 * fast lane reads only when `CORE_FAST_ACCEPTS_REFLECTED_FEELING` is open
 * (`store.row()`'s `feeling_peak_lived`, `sleep/consolidate.ts#selfRelevantFeeling`).
 */
export const LATER_FEELING_SOURCES: readonly FeelingSource[] = ["reflection", "awake"];

/**
 * `carried_by` is the nuance in the writer's own words — what in the moment
 * carried it. Raised 280 → 1,000 (owner direction 2026-09-28: loosen the
 * limits); longer is kept to this length with a repair notice, never refused.
 */
export const CARRIED_BY_MAX_CHARS = 1_000;
/**
 * The free word kept when the emotion is not on the wheel. Raised 40 → 80
 * (2026-09-28). An emotion longer than this, or one that carries a phrase
 * (`steadied: the guard held`), is SPLIT, never refused (`repairEmotion`).
 */
export const OTHER_WORD_MAX_CHARS = 80;

/**
 * The most a feeling's strength can be when the writer left it out and the
 * word's default stood in (the review of #301, m2): below the core's fast lane
 * (`CORE_FAST_FEELING = 0.6`, physics §5.3), so a feeling nobody weighed can
 * never by itself make a memory "strongly felt". Terrified's 0.9 written
 * without a strength is stored at this. CAL.
 */
export const DEFAULT_STRENGTH_CAP = 0.55;

/** The strength a feeling written without one gets: its word's intensity (its core's for a word of the writer's own), capped. */
export function defaultStrength(core: string, emotion: string, otherWord?: string | null): number {
  return Math.min(feelingNumbers(core, emotion, otherWord).intensity, DEFAULT_STRENGTH_CAP);
}

export interface FeelingInput {
  readonly whose: string;
  /** One of the seven. Left out (or empty), the word's home core — only for a
   *  word on the wheel. A first-wheel name reads as v11 filed it. */
  readonly core?: string;
  /** A wheel key or bare word (`furious`, `caught out`), or `other`. */
  readonly emotion: string;
  /** The person's word, when `emotion` is `other`. */
  readonly otherWord?: string;
  /** The intensity, 0..1, as recorded. Left out: the word's default. */
  readonly strength?: number;
  /** v11: how pleasant, −1..+1. Left out: the word's default, read when needed. */
  readonly valence?: number;
  /** What carried it. May be empty. */
  readonly carriedBy?: string;
  /**
   * The feeling this one sits on top of: an existing feeling's id on the SAME
   * memory, or the index of another input in the same call.
   */
  readonly beneath?: string | number;
}

export interface FeelingRow extends Row {
  id: string;
  memory_id: string;
  whose: string;
  core: string;
  emotion: string;
  other_word: string | null;
  strength: number;
  beneath_id: string | null;
  carried_by: string;
  model: string | null;
  created_at: number;
  updated_at: number;
  /** v9: who recorded it (`FEELING_SOURCES`); null only on a bare test row. */
  source: string | null;
  /** v9: the calendar date it was recorded after the moment; null = felt at the time. */
  recorded_later: string | null;
  /** v11: the writer's valence, −1..+1; null = the word's default (`feelingValence`). */
  valence: number | null;
  /** v11: the core and the emotion the first wheel stored, kept by the upgrade
   *  on every row it re-filed (null on the rest) — so it can be undone. */
  core_v10: string | null;
  emotion_v10: string | null;
  /**
   * v13 (2026-10-10, review 02 C5): the LIVED day the feeling was recorded —
   * what its softening counts from, so a feeling a reflection added weeks after
   * the memory reads fresh the morning after. The upgrade backfilled it
   * (`operational.ts#backfillRecordedDays`); undefined on a v12 file read
   * before its upgrade, and then the memory's birth day stands in.
   */
  recorded_day: number | null;
}

/** The lived day a feeling softens from: when it was recorded (v13), else its memory's birth. */
export function feltDay(row: { readonly recorded_day?: number | null; readonly birth_day: number }): number {
  return typeof row.recorded_day === "number" && Number.isFinite(row.recorded_day) ? row.recorded_day : row.birth_day;
}

/**
 * A recorded feeling's valence: the writer's, else its word's default (an
 * `other` whose own word is on the wheel reads as that word), else its core's.
 * Tolerates a row read without the v11 column.
 */
export function feelingValence(row: Pick<FeelingRow, "core" | "emotion" | "other_word"> & { valence?: number | null }): number {
  const own = row.valence;
  if (typeof own === "number" && Number.isFinite(own)) return Math.max(-1, Math.min(1, own));
  return feelingNumbers(row.core, row.emotion, row.other_word).valence;
}

/**
 * What the caller should hear about one input: either it was stored as `other`
 * (the word as given, and the wheel keys GENUINELY close to it — usually none),
 * or, with `readAs`, the word was an alias and was stored as that wheel key.
 */
export interface FeelingNotice {
  readonly index: number;
  readonly word: string;
  readonly core: CoreEmotion;
  readonly closest: readonly string[];
  /** Set when `word` was read as this wheel key (`thankful` → `grateful`). */
  readonly readAs?: string;
}

/**
 * ACCEPT AND REPAIR (owner direction 2026-09-28): what the check changed so
 * the feeling could be stored rather than refused — an emotion that carried a
 * phrase split into the word and the nuance, or a `carried_by` kept to its
 * length — and, since v11, a first-wheel core name read as the core it is now
 * (`fear` → `uneasy`). A wheel word under a core that is not its home is NOT
 * a repair: it is stored as written. `was` is what was sent, `now` what was
 * stored in that field.
 */
export interface FeelingRepair {
  readonly index: number;
  readonly field: "emotion" | "other_word" | "carried_by" | "core";
  readonly was: string;
  readonly now: string;
  readonly note: string;
}

export interface AddFeelingsResult {
  readonly ids: readonly string[];
  readonly notices: readonly FeelingNotice[];
  readonly repairs: readonly FeelingRepair[];
}

/** Where an emotion that carries a phrase is cut: the word before, the nuance after. */
const STRONG_BREAK = /\s*(?:[:;—–]|\s-\s)\s*/u;
const ANY_BREAK = /\s*(?:[:;,—–]|\s-\s)\s*/u;

/**
 * SPLIT AN EMOTION THAT CARRIES A PHRASE (2026-09-28). A model that writes
 * `emotion: "steadied: the guard has held every time since…"` meant the word
 * `steadied` and the nuance after it, which belongs in `carried_by`. Split
 * when the text is longer than `OTHER_WORD_MAX_CHARS`, or carries a strong
 * break (`:`, `;`, a dash): the head — up to the first `:`, `—`, `–`, `;` or
 * `,` (a comma only when over-long) — is the emotion, and the rest goes to
 * `carried_by` (set when empty, else appended). With no break, an over-long
 * phrase is cut at the last word boundary within the cap ("a deep and abiding
 * sense of gratitude for…" keeps its first words, not just "a"); punctuation
 * alone is kept to the cap. The emotion that comes back is never longer than
 * the cap. Pure; null when nothing needed splitting.
 */
export function repairEmotion(emotion: string, carriedBy: string): { emotion: string; carriedBy: string; tail: string } | null {
  const raw = emotion.trim();
  const long = raw.length > OTHER_WORD_MAX_CHARS;
  if (!long && !STRONG_BREAK.test(raw)) return null;
  const cut = (long ? ANY_BREAK : STRONG_BREAK).exec(raw);
  let head: string;
  let tail: string;
  if (cut !== null && cut.index > 0) {
    head = raw.slice(0, cut.index).trim();
    tail = raw.slice(cut.index + cut[0].length).trim();
  } else {
    // A break before any words (": steadied — …"): drop the leading
    // punctuation and read what is left. No break at all: the whole of it.
    const stripped = raw.replace(/^[\s:;,—–-]+/u, "").trim();
    if (stripped.length > 0 && stripped !== raw) {
      const again = repairEmotion(stripped, carriedBy);
      return again ?? { emotion: stripped, carriedBy: carriedBy.trim(), tail: "" };
    }
    head = stripped.length > 0 ? stripped : raw;
    tail = "";
  }
  if (head.length > OTHER_WORD_MAX_CHARS) {
    const [kept, rest] = fitWords(head, OTHER_WORD_MAX_CHARS);
    head = kept;
    tail = [rest, tail].filter((x) => x.length > 0).join(" ");
  }
  if (head.length === 0) return null;
  const carried = carriedBy.trim();
  const joined = tail.length === 0 ? carried : carried.length === 0 ? tail : `${carried}; ${tail}`;
  return { emotion: head, carriedBy: joined, tail };
}

/** `text` cut at the last word boundary within `max` (or at `max` when one word is longer), and the rest. */
function fitWords(text: string, max: number): [string, string] {
  if (text.length <= max) return [text, ""];
  const at = text.lastIndexOf(" ", max);
  if (at > 0) return [text.slice(0, at).trim(), text.slice(at).trim()];
  return [text.slice(0, max), text.slice(max)];
}

/** What a split says to the writer, so the next one is written right. */
export function splitNote(split: { emotion: string; tail: string }, field: "emotion" | "other_word" = "emotion"): string {
  return `"${split.emotion}" was kept as the ${field === "emotion" ? "emotion" : "word"}${split.tail.length > 0 ? " and the rest went to carried_by" : ""}: ${field} is one word, carried_by holds the nuance.`;
}

/** A `carried_by` kept to its length, whole where it fits. */
function keepCarried(text: string): string {
  return text.length <= CARRIED_BY_MAX_CHARS ? text : `${text.slice(0, CARRIED_BY_MAX_CHARS - 1)}…`;
}

/** One input, checked and spelled as it will be stored. `beneath` still unresolved. */
export interface CheckedFeeling {
  readonly whose: FeelingWhose;
  readonly core: CoreEmotion;
  readonly emotion: string;
  readonly otherWord: string | null;
  readonly strength: number;
  /** The writer's valence, or null for the word's default. */
  readonly valence: number | null;
  readonly carriedBy: string;
  readonly beneath: string | number | null;
}

function invalid(index: number, reason: string, extra: Record<string, string | number> = {}): never {
  throw new StoreError("FEELING_INVALID", { index, reason, ...extra });
}

/**
 * THE CHECK, pure — no store needed, so a door (the MCP tools) can run it
 * BEFORE it mints the memory the feelings belong to, and refuse the whole
 * entry rather than leave a memory whose feelings were dropped. Throws
 * `FEELING_INVALID` naming the input and the reason; returns the checked rows
 * and the `other` notices.
 */
export function checkFeelings(inputs: readonly FeelingInput[]): { rows: CheckedFeeling[]; notices: FeelingNotice[]; repairs: FeelingRepair[] } {
  const rows: CheckedFeeling[] = [];
  const notices: FeelingNotice[] = [];
  const repairs: FeelingRepair[] = [];
  inputs.forEach((given, i) => {
    let f = given;
    if (f === null || typeof f !== "object") invalid(i, "not-an-object");
    if (typeof f.whose !== "string" || !(FEELING_WHOSE as readonly string[]).includes(f.whose)) {
      invalid(i, "whose-unknown", { allowed: FEELING_WHOSE.join("|") });
    }
    const sentCore: unknown = f.core ?? "";
    if (typeof sentCore !== "string") invalid(i, "core-unknown", { allowed: CORE_EMOTIONS.join("|") });
    const named = (sentCore as string).trim();
    if (named.length > 0 && !isCoreEmotion(named) && !(V10_CORES as readonly string[]).includes(named)) {
      invalid(i, "core-unknown", { allowed: CORE_EMOTIONS.join("|") });
    }
    if (f.strength !== undefined && (typeof f.strength !== "number" || !Number.isFinite(f.strength) || f.strength < 0 || f.strength > 1)) {
      invalid(i, "strength-out-of-range");
    }
    if (f.valence !== undefined && (typeof f.valence !== "number" || !Number.isFinite(f.valence) || f.valence < -1 || f.valence > 1)) {
      invalid(i, "valence-out-of-range");
    }
    if (f.carriedBy !== undefined && typeof f.carriedBy !== "string") invalid(i, "carried-by-not-a-string");
    // TYPES BEFORE ANY WORK (review S2): a non-string `otherWord` used to
    // throw a TypeError out of `.trim()`.
    if (typeof f.emotion !== "string" || f.emotion.trim().length === 0) invalid(i, "emotion-missing");
    if (f.otherWord !== undefined && typeof f.otherWord !== "string") invalid(i, "other-word-not-a-string");
    // ACCEPT AND REPAIR, never refuse for length (2026-09-28): an emotion (or
    // an `other` word) that carries a phrase is split into the word and the
    // nuance BEFORE the wheel reads it — so a huge `emotion` is still never
    // scored by edit distance (review S2's other half).
    const split = (field: "emotion" | "other_word", text: string): void => {
      const fixed = repairEmotion(text, f.carriedBy ?? "");
      if (fixed === null) return;
      f = field === "emotion" ? { ...f, emotion: fixed.emotion, carriedBy: fixed.carriedBy } : { ...f, otherWord: fixed.emotion, carriedBy: fixed.carriedBy };
      repairs.push({
        index: i,
        field,
        was: text.trim(),
        now: fixed.emotion,
        note: splitNote(fixed, field),
      });
    };
    split("emotion", f.emotion);
    if (typeof f.otherWord === "string") split("other_word", f.otherWord);
    const sentCarried = f.carriedBy ?? "";
    const carriedBy = keepCarried(sentCarried);
    if (carriedBy !== sentCarried) {
      repairs.push({
        index: i,
        field: "carried_by",
        was: sentCarried,
        now: carriedBy,
        note: `carried_by was kept to its first ${String(CARRIED_BY_MAX_CHARS)} characters.`,
      });
    }
    if (f.beneath !== undefined && typeof f.beneath !== "string" && typeof f.beneath !== "number") {
      invalid(i, "beneath-not-an-id-or-index");
    }
    // WHICH CORE. The writer's, as named; a first-wheel name, as the v11
    // upgrade files it (said, as a repair); none, the word's home — and a word
    // off the wheel with no core cannot be placed.
    const isOther = f.emotion.trim().toLowerCase() === OTHER_EMOTION;
    let core: CoreEmotion;
    if (isCoreEmotion(named)) core = named;
    else if (named.length > 0) {
      core = remapV10Feeling(named, isOther ? OTHER_EMOTION : f.emotion, f.otherWord ?? null).core as CoreEmotion;
      repairs.push({
        index: i,
        field: "core",
        was: named,
        now: core,
        note: `"${named}" is not one of the cores now (${CORE_EMOTIONS.join(", ")}); it was stored under ${core}.`,
      });
    } else {
      const home = lookupWord(isOther ? (f.otherWord ?? "") : f.emotion)?.entry.core;
      if (home === undefined) invalid(i, "core-unknown", { allowed: CORE_EMOTIONS.join("|") });
      core = home as CoreEmotion;
    }
    let emotion: string;
    let otherWord: string | null = null;
    if (isOther) {
      const word = (f.otherWord ?? "").trim();
      if (word.length === 0) invalid(i, "other-word-missing");
      emotion = OTHER_EMOTION;
      otherWord = word;
      notices.push({ index: i, word, core, closest: closestKeys(core, word.toLowerCase()) });
    } else {
      const read = resolveEmotion(core, f.emotion);
      if (read.kind === "wheel") {
        // On the wheel — under this core or not, it is stored under the
        // writer's core with its key (the writer's core wins, 2026-09-30).
        emotion = read.entry.key;
        if (read.alias !== undefined) notices.push({ index: i, word: read.alias, core, closest: [], readAs: read.entry.key });
      } else {
        // Not on the wheel: kept, as `other`, with the word — and the caller is
        // told of a wheel word only when one is genuinely close (a misspelling).
        emotion = OTHER_EMOTION;
        otherWord = read.word;
        notices.push({ index: i, word: otherWord, core, closest: read.closest });
      }
    }
    if (typeof f.beneath === "number") {
      if (!Number.isInteger(f.beneath) || f.beneath < 0 || f.beneath >= inputs.length || f.beneath === i) {
        invalid(i, "beneath-index-out-of-range");
      }
    }
    rows.push({
      whose: f.whose as FeelingWhose,
      core,
      emotion,
      otherWord,
      // Left out, the word's default intensity, capped (`defaultStrength`);
      // the writer's when given, and never rewritten.
      strength: f.strength ?? defaultStrength(core, emotion, otherWord),
      valence: f.valence ?? null,
      carriedBy,
      beneath: f.beneath ?? null,
    });
  });
  // No loop of "this sits on that" inside one call: follow each chain.
  rows.forEach((_, start) => {
    const seen = new Set<number>([start]);
    let at = rows[start]?.beneath;
    while (typeof at === "number") {
      if (seen.has(at)) invalid(start, "beneath-cycle");
      seen.add(at);
      at = rows[at]?.beneath;
    }
  });
  return { rows, notices, repairs };
}
