/**
 * A QUESTION ABOUT TIME — the deliberate path only (2026-09-30, the
 * continuity test).
 *
 * Recall had no sense of time. Asked "what do you remember from our most
 * recent session?", it matched "session" and "recent" as words across every
 * day the store holds, and the candidate cap filled with other sessions'
 * release work; the evening the question was about never came back. A person
 * asks this plainly, so the plain question has to work: a cue here, like the
 * feeling cues in `feeling-ask.ts`, and the caller (`mcp/deliberate.ts`) puts
 * the session the question means first.
 *
 * Three things are read off the question:
 *
 *   - **the cue**: a phrase about the recent past, or a clock time;
 *   - **the window**, when the cue names one ("this morning", "yesterday",
 *     "16:01–17:48"): which stretch of the store's local clock it means;
 *   - **whether it is THIN**: nothing left once the cue, the clock and the
 *     function words are taken out. "What do you remember from our most recent
 *     session?" is thin and its answer is that session. "What did we decide
 *     about the deploy today?" is not: it is about the deploy, and the recent
 *     session's rows only go first where the search found them too (review of
 *     #302, MINOR-1).
 *
 * Deliberate only: the ambient turn says "today" and "just now" all the time
 * without asking for anything. NO MODEL CALL: fixed lists and the store's clock.
 */
import { addDays, localDate, localStamp } from "../time.js";

/** Phrases that ask about the recent past, matched on words (lower case,
 *  apostrophes dropped, other characters a space), longest first. */
export const RECENCY_PHRASES: readonly string[] = [
  "where did we leave off",
  "where were we",
  "pick up where",
  "leave off",
  "left off",
  "most recent",
  "last session",
  "previous session",
  "earlier session",
  "last conversation",
  "previous conversation",
  "last time",
  "last chat",
  "just now",
  "a minute ago",
  "minutes ago",
  "earlier today",
  "this morning",
  "this afternoon",
  "this evening",
  "tonight",
  "last night",
  "today",
  "yesterday",
  "just did",
  "just talked",
  "recently",
];

/**
 * Words that ask nothing of their own in a question about time: function
 * words, and the words a person uses to point at a session ("what did we do",
 * "remember", "talk about"). A question with nothing else in it is thin.
 */
const ASKS_NOTHING = new Set([
  "a", "about", "after", "again", "ago", "all", "an", "and", "any", "anything", "are", "as", "at", "back",
  "be", "been", "before", "between", "can", "chat", "conversation", "could", "did", "discuss", "discussed",
  "do", "does", "doing", "done", "during", "earlier", "else", "for", "from", "get", "go", "going", "got",
  "had", "happen", "happened", "has", "have", "here", "how", "i", "in", "is", "it", "just", "last", "me",
  "most", "my", "now", "of", "on", "or", "our", "previous", "recall", "recent", "recently", "remember",
  "said", "say", "session", "sessions", "so", "talk", "talked", "tell", "that", "the", "then", "there",
  "this", "time", "to", "up", "us", "was", "we", "were", "what", "whatever", "when", "where", "which",
  "while", "who", "with", "work", "worked", "working", "you", "your", "am", "pm",
]);

/** A clock range (`16:01–17:48`, `4pm to 6pm`), a time with am/pm, or "at 16:01" —
 *  never a bare `3:16`, which is as often a verse or a ratio. */
const CLOCK_RANGE = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\s*(?:–|—|-|to|until|and)\s*(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\b/i;
const CLOCK_ONE = /\b(?:at\s+(\d{1,2}):(\d{2})\s?(am|pm)?|(\d{1,2})(?::(\d{2}))?\s?(am|pm))\b/i;

export interface RecencyAsk {
  /** The phrase that asked, or `"a clock time"`. */
  readonly cue: string;
  /** The stretch of the store's local clock the question names, as
   *  `YYYY-MM-DD HH:MM` bounds (inclusive); null when it names none. */
  readonly window: { readonly from: string; readonly to: string } | null;
  /** Nothing asked beyond the time: the session's own rows are the answer. */
  readonly thin: boolean;
}

function words(text: string): string {
  return ` ${text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** `YYYY-MM-DD HH:MM` in `zone` — the key windows are compared in. */
export function localKey(at: number, zone: string): string {
  return `${localDate(at, zone)} ${localStamp(at, zone).split(" ")[1] ?? "00:00"}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

function hour(h: string | undefined, m: string | undefined, ampm: string | undefined, fallback?: string): number | null {
  if (h === undefined) return null;
  let hh = Number(h);
  const half = (ampm ?? fallback)?.toLowerCase();
  if (half === "pm" && hh < 12) hh += 12;
  if (half === "am" && hh === 12) hh = 0;
  const mm = m === undefined ? 0 : Number(m);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

const at = (date: string, minutes: number): string =>
  `${date} ${pad(Math.floor(Math.max(0, Math.min(minutes, 1439)) / 60))}:${pad(Math.max(0, Math.min(minutes, 1439)) % 60)}`;

/**
 * IS THIS QUESTION ABOUT THE RECENT PAST — and if so, which stretch of it, and
 * is it about anything else? Null when it is not about time. `now` and `zone`
 * are the store's, for the window; without them no window is read. Pure.
 */
export function readRecencyAsk(text: string, clock?: { now: number; zone: string }): RecencyAsk | null {
  const said = words(text);
  const cue = RECENCY_PHRASES.find((p) => said.includes(` ${p} `)) ?? null;
  // A range is a clock only with minutes on both ends or an am/pm: "1-2" and
  // a date's "09-30" are not.
  const matched = CLOCK_RANGE.exec(text);
  const range =
    matched !== null && ((matched[2] !== undefined && matched[5] !== undefined) || matched[3] !== undefined || matched[6] !== undefined)
      ? matched
      : null;
  const one = range === null ? CLOCK_ONE.exec(text) : null;
  if (cue === null && range === null && one === null) return null;

  // Thin: drop the cue, the clock and the words that ask nothing.
  let rest = said;
  if (cue !== null) rest = rest.replace(` ${cue} `, " ");
  const left = rest
    .split(" ")
    .filter((w) => w.length > 0 && !/^\d+(?:am|pm)?$/.test(w) && !ASKS_NOTHING.has(w) && !RECENCY_PHRASES.includes(w));
  const thin = left.length === 0;

  let window: RecencyAsk["window"] = null;
  if (clock !== undefined) {
    const today = localDate(clock.now, clock.zone);
    const yesterday = addDays(today, -1);
    const date = cue === "yesterday" || cue === "last night" ? yesterday : today;
    if (range !== null) {
      const to = hour(range[4], range[5], range[6]);
      const from = hour(range[1], range[2], range[3], range[6]);
      if (from !== null && to !== null && from <= to) window = { from: at(date, from), to: at(date, to) };
    } else if (one !== null) {
      const t = one[1] !== undefined ? hour(one[1], one[2], one[3]) : hour(one[4], one[5], one[6]);
      if (t !== null) window = { from: at(date, t - 60), to: at(date, t + 60) };
    } else if (cue === "today" || cue === "earlier today") window = { from: at(today, 0), to: at(today, 1439) };
    else if (cue === "this morning") window = { from: at(today, 5 * 60), to: at(today, 12 * 60 - 1) };
    else if (cue === "this afternoon") window = { from: at(today, 12 * 60), to: at(today, 17 * 60 - 1) };
    else if (cue === "this evening" || cue === "tonight") window = { from: at(today, 17 * 60), to: at(today, 1439) };
    else if (cue === "yesterday") window = { from: at(yesterday, 0), to: at(yesterday, 1439) };
    else if (cue === "last night") window = { from: at(yesterday, 17 * 60), to: at(today, 5 * 60 - 1) };
  }
  return { cue: cue ?? "a clock time", window, thin };
}
