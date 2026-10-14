import { addDays, localDate, localStamp } from "../time.js";
export const RECENCY_PHRASES = [
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
  "recently"
];
const ASKS_NOTHING = new Set([
  "a",
  "about",
  "after",
  "again",
  "ago",
  "all",
  "an",
  "and",
  "any",
  "anything",
  "are",
  "as",
  "at",
  "back",
  "be",
  "been",
  "before",
  "between",
  "can",
  "chat",
  "conversation",
  "could",
  "did",
  "discuss",
  "discussed",
  "do",
  "does",
  "doing",
  "done",
  "during",
  "earlier",
  "else",
  "for",
  "from",
  "get",
  "go",
  "going",
  "got",
  "had",
  "happen",
  "happened",
  "has",
  "have",
  "here",
  "how",
  "i",
  "in",
  "is",
  "it",
  "just",
  "last",
  "me",
  "most",
  "my",
  "now",
  "of",
  "on",
  "or",
  "our",
  "previous",
  "recall",
  "recent",
  "recently",
  "remember",
  "said",
  "say",
  "session",
  "sessions",
  "so",
  "talk",
  "talked",
  "tell",
  "that",
  "the",
  "then",
  "there",
  "this",
  "time",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "whatever",
  "when",
  "where",
  "which",
  "while",
  "who",
  "with",
  "work",
  "worked",
  "working",
  "you",
  "your",
  "am",
  "pm"
]);
const CLOCK_RANGE = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\s*(?:–|—|-|to|until|and)\s*(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\b/i;
const CLOCK_ONE = /\b(?:at\s+(\d{1,2}):(\d{2})\s?(am|pm)?|(\d{1,2})(?::(\d{2}))?\s?(am|pm))\b/i;
function words(text) {
  return ` ${text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}
export function localKey(at, zone) {
  return `${localDate(at, zone)} ${localStamp(at, zone).split(" ")[1] ?? "00:00"}`;
}
const pad = (n) => String(n).padStart(2, "0");
function hour(h, m, ampm, fallback) {
  if (h === undefined)
    return null;
  let hh = Number(h);
  const half = (ampm ?? fallback)?.toLowerCase();
  if (half === "pm" && hh < 12)
    hh += 12;
  if (half === "am" && hh === 12)
    hh = 0;
  const mm = m === undefined ? 0 : Number(m);
  if (hh > 23 || mm > 59)
    return null;
  return hh * 60 + mm;
}
const at = (date, minutes) => `${date} ${pad(Math.floor(Math.max(0, Math.min(minutes, 1439)) / 60))}:${pad(Math.max(0, Math.min(minutes, 1439)) % 60)}`;
export function readRecencyAsk(text, clock) {
  const said = words(text);
  const cue = RECENCY_PHRASES.find((p) => said.includes(` ${p} `)) ?? null;
  const matched = CLOCK_RANGE.exec(text);
  const range = matched !== null && (matched[2] !== undefined && matched[5] !== undefined || matched[3] !== undefined || matched[6] !== undefined) ? matched : null;
  const one = range === null ? CLOCK_ONE.exec(text) : null;
  if (cue === null && range === null && one === null)
    return null;
  let rest = said;
  if (cue !== null)
    rest = rest.replace(` ${cue} `, " ");
  const left = rest.split(" ").filter((w) => w.length > 0 && !/^\d+(?:am|pm)?$/.test(w) && !ASKS_NOTHING.has(w) && !RECENCY_PHRASES.includes(w));
  const thin = left.length === 0;
  let window = null;
  if (clock !== undefined) {
    const today = localDate(clock.now, clock.zone);
    const yesterday = addDays(today, -1);
    const date = cue === "yesterday" || cue === "last night" ? yesterday : today;
    if (range !== null) {
      const to = hour(range[4], range[5], range[6]);
      const from = hour(range[1], range[2], range[3], range[6]);
      if (from !== null && to !== null && from <= to)
        window = { from: at(date, from), to: at(date, to) };
    } else if (one !== null) {
      const t = one[1] !== undefined ? hour(one[1], one[2], one[3]) : hour(one[4], one[5], one[6]);
      if (t !== null)
        window = { from: at(date, t - 60), to: at(date, t + 60) };
    } else if (cue === "today" || cue === "earlier today")
      window = { from: at(today, 0), to: at(today, 1439) };
    else if (cue === "this morning")
      window = { from: at(today, 5 * 60), to: at(today, 12 * 60 - 1) };
    else if (cue === "this afternoon")
      window = { from: at(today, 12 * 60), to: at(today, 17 * 60 - 1) };
    else if (cue === "this evening" || cue === "tonight")
      window = { from: at(today, 17 * 60), to: at(today, 1439) };
    else if (cue === "yesterday")
      window = { from: at(yesterday, 0), to: at(yesterday, 1439) };
    else if (cue === "last night")
      window = { from: at(yesterday, 17 * 60), to: at(today, 5 * 60 - 1) };
  }
  return { cue: cue ?? "a clock time", window, thin };
}
