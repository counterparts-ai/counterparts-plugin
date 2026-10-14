import { addDays, daysBetween, isDay, localDate, parseCalendarDate } from "../time.js";
import { readRecencyAsk } from "./recency-ask.js";
export const FUZZY_STRETCH_DAYS = 2;
export const NEAR_STRETCH_DAYS = 1;
export const OPEN_START = "0001-01-01";
export const OPEN_END = "9999-12-31";
const MONTH_NAMES = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sept", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"]
];
const MONTH_ALT = MONTH_NAMES.flat().sort((a, b) => b.length - a.length).join("|");
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const BOUND_ALT = "prior to|up until|up to|before|after|since|until|till|by";
const QUANTITY_AFTER = new RegExp("^(?:\\.\\d+)?\\s*(?:%|(?:" + [
  "seconds?",
  "secs?",
  "minutes?",
  "mins?",
  "hours?",
  "hrs?",
  "hr",
  "days?",
  "nights?",
  "weeks?",
  "wks?",
  "months?",
  "mos",
  "years?",
  "yrs?",
  "decades?",
  "a\\.?m\\.?",
  "p\\.?m\\.?",
  "o['’]clock",
  "percent",
  "pct",
  "times",
  "x",
  "reps",
  "sets",
  "laps",
  "pages?",
  "words",
  "steps",
  "people",
  "persons?",
  "kids",
  "items",
  "points?",
  "pts",
  "km",
  "kms",
  "kilomet(?:er|re)s?",
  "miles?",
  "mi",
  "met(?:er|re)s?",
  "ft",
  "feet",
  "foot",
  "inch(?:es)?",
  "cm",
  "mm",
  "yards?",
  "yds?",
  "kg",
  "kgs",
  "kilos?",
  "grams?",
  "lbs?",
  "pounds?",
  "oz",
  "ounces?",
  "cups?",
  "tbsp",
  "tsp",
  "teaspoons?",
  "tablespoons?",
  "lit(?:er|re)s?",
  "ml",
  "gallons?",
  "gal",
  "pints?",
  "quarts?",
  "servings?",
  "slices?",
  "pieces?",
  "dollars?",
  "bucks",
  "cents?",
  "euros?",
  "k",
  "mph",
  "kph",
  "bpm",
  "rpm",
  "mg",
  "of"
].join("|") + ")(?![a-z]))", "i");
const FRACTION_BEFORE = new RegExp("\\b(?:" + [
  "cut",
  "cuts",
  "cutting",
  "halve[sd]?",
  "halving",
  "reduc(?:e|es|ed|ing)",
  "increas(?:e|es|ed|ing)",
  "decreas(?:e|es|ed|ing)",
  "divid(?:e|es|ed|ing)",
  "multipl(?:y|ies|ied|ying)",
  "grow",
  "grows",
  "grew",
  "grown",
  "growing",
  "shr(?:ink|inks|ank|unk|inking)",
  "rais(?:e|es|ed|ing)",
  "lower(?:s|ed|ing)?",
  "trim(?:s|med|ming)?",
  "slash(?:es|ed|ing)?",
  "boost(?:s|ed|ing)?",
  "scal(?:e|es|ed|ing)",
  "drop(?:s|ped|ping)?",
  "fall",
  "falls",
  "fell",
  "fallen",
  "falling",
  "rise",
  "rises",
  "rose",
  "risen",
  "rising"
].join("|") + ")\\b(?:\\s+[a-z'’]+){0,3}\\s+(?:by|to)\\s*$", "i");
const NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  "a couple": 2,
  "a couple of": 2,
  few: 3,
  "a few": 3
};
const NUMBER_ALT = "\\d{1,3}|a couple of|a couple|a few|couple|few|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|an|a";
const RANGE_FROM = "(?:(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\\s*(?:-|–|/|\\sor\\s|\\sto\\s)\\s*)?";
const PHRASE_STOP = new Set([
  "what",
  "when",
  "where",
  "who",
  "why",
  "how",
  "which",
  "did",
  "do",
  "does",
  "was",
  "were",
  "is",
  "are",
  "we",
  "i",
  "you",
  "he",
  "she",
  "they",
  "have",
  "had",
  "has",
  "and",
  "or",
  "but",
  "so"
]);
const NOT_EVENTS = new Set([
  "then",
  "time",
  "that time",
  "now",
  "noon",
  "midnight",
  "the time",
  "this time",
  "that",
  "same time",
  "day",
  "days",
  "week",
  "weeks",
  "weekend",
  "month",
  "months",
  "year",
  "morning",
  "afternoon",
  "evening",
  "night"
]);
const SESSION_PHRASES = [
  "where did we leave off",
  "where we left off",
  "where were we",
  "pick up where",
  "left off",
  "leave off",
  "our most recent session",
  "most recent session",
  "our last session",
  "last session",
  "previous session",
  "earlier session",
  "our last conversation",
  "last conversation",
  "previous conversation",
  "last chat",
  "last time"
];
function monthOf(word) {
  const w = word.toLowerCase().replace(/\.$/, "");
  const i = MONTH_NAMES.findIndex((names) => names.includes(w));
  return i < 0 ? null : i + 1;
}
function numberOf(word) {
  const w = word.toLowerCase().trim();
  if (/^\d+$/.test(w))
    return Number(w);
  return NUMBER_WORDS[w] ?? null;
}
const pad = (n) => String(n).padStart(2, "0");
function lastDayOf(year, month) {
  return parseCalendarDate(`${String(year)}-${pad(month)}`)?.last ?? `${String(year)}-${pad(month)}-28`;
}
function mondayOf(ymd) {
  const since = daysBetween("1970-01-05", ymd);
  return addDays(ymd, -((since % 7 + 7) % 7));
}
function lastWeekday(today, weekday) {
  const todays = (daysBetween("1970-01-04", today) % 7 + 7) % 7;
  const back = (todays - weekday + 7) % 7;
  return addDays(today, -(back === 0 ? 7 : back));
}
function stretched(said, days) {
  if (days <= 0)
    return said;
  return {
    from: said.from === OPEN_START ? OPEN_START : addDays(said.from, -days),
    to: said.to === OPEN_END ? OPEN_END : addDays(said.to, days)
  };
}
function boundOf(text, found) {
  const m = new RegExp(`\\b(${BOUND_ALT})\\s+(the\\s+)?${escape(found)}(['’]s\\b)?`, "i").exec(text);
  if (m === null)
    return null;
  const word = m[1].toLowerCase().replace(/\s+/g, " ");
  const bound = word === "before" || word === "prior to" ? "before" : word === "after" ? "after" : word === "since" ? "since" : "through";
  const next = /^\s+([a-z]+)/i.exec(text.slice(m.index + m[0].length))?.[1];
  const possessive = m[3] !== undefined || /['’]s$/i.test(found);
  const named = m[2] !== undefined && next !== undefined && !PHRASE_STOP.has(next.toLowerCase());
  const date = `${found}${m[3] ?? ""}`;
  return { bound, word, phrase: m[0], event: possessive || named ? { cue: `${word} ${m[2] !== undefined ? "the " : ""}${date}`, date } : null };
}
function dated(text, found, firstDay, lastDay, stretch, today, opts = {}) {
  const cue = opts.cue ?? found;
  const b = boundOf(text, found);
  if (b === null)
    return ask(cue, { from: firstDay, to: lastDay }, stretch, without(text, found));
  const roll = opts.yearless === true && (b.bound === "since" || b.bound === "after") && firstDay > today;
  const moved = opts.yearless === true && (b.bound === "before" || b.bound === "through") ? nearestYear(firstDay, today) : firstDay;
  const first = roll ? lastCome(firstDay, today) : moved;
  const last = roll || moved !== firstDay ? first : lastDay;
  if (b.event !== null) {
    const said = b.bound === "since" ? { from: first, to: today } : b.bound === "after" ? { from: first, to: OPEN_END } : { from: OPEN_START, to: last };
    return ask(b.event.cue, said, b.bound === "since" ? stretch : 0, without(text, b.event.date));
  }
  const said = b.bound === "since" ? { from: first, to: today } : b.bound === "before" ? { from: OPEN_START, to: addDays(first, -1) } : b.bound === "after" ? { from: addDays(last, 1), to: OPEN_END } : { from: OPEN_START, to: last };
  return ask(`${b.word} ${cue}`, said, b.bound === "since" ? stretch : 0, without(text, b.phrase));
}
function yearFor(month, today) {
  const [y, m] = today.split("-").map(Number);
  return month <= m ? y : y - 1;
}
function nearestYear(day, today) {
  const year = Number(today.slice(0, 4));
  let best = day;
  let gap = Number.POSITIVE_INFINITY;
  for (const y of [year - 1, year, year + 1]) {
    const candidate = `${String(y).padStart(4, "0")}${day.slice(4)}`;
    if (!isDay(candidate))
      continue;
    const away = Math.abs(daysBetween(candidate, today));
    if (away <= gap) {
      best = candidate;
      gap = away;
    }
  }
  return best;
}
function lastCome(day, today) {
  const monthDay = day.slice(4);
  for (let y = Number(day.slice(0, 4)) - 1;y >= 1; y--) {
    const back = `${String(y).padStart(4, "0")}${monthDay}`;
    if (back <= today && isDay(back))
      return back;
  }
  return day;
}
function isQuantity(text, m) {
  if (/^0\d$/.test(m[1]) || /^0\d$/.test(m[2]))
    return false;
  const before = text.slice(0, m.index);
  if (/[$£€]$/.test(before))
    return true;
  if (QUANTITY_AFTER.test(text.slice(m.index + m[0].length)))
    return true;
  const over = Number(m[1]);
  const under = Number(m[2]);
  return m[3] === undefined && m[0].includes("/") && over < under && under <= 10 && FRACTION_BEFORE.test(before);
}
function firstShortDate(text) {
  const re = /\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?\b/g;
  for (let m = re.exec(text);m !== null; m = re.exec(text)) {
    if (!isQuantity(text, m))
      return m;
  }
  return null;
}
function without(text, found) {
  const at = text.toLowerCase().indexOf(found.toLowerCase());
  if (at < 0)
    return text;
  let start = at;
  const before = text.slice(0, at);
  const prep = /\b(?:on|in|from|since|around|during|at|of|over|for)\s+$/i.exec(before);
  if (prep !== null)
    start = at - prep[0].length;
  return `${text.slice(0, start)} ${text.slice(at + found.length)}`.replace(/\s+/g, " ").trim();
}
function ask(cue, said, stretch, rest, extra = {}) {
  return {
    cue,
    said,
    window: said === null ? null : stretched(said, stretch),
    stretch,
    clock: extra.clock ?? null,
    anchor: extra.anchor ?? null,
    rest
  };
}
export function readTimeAsk(text, clock) {
  const today = localDate(clock.now, clock.zone);
  const lower = text.toLowerCase().replace(/[’]/g, "'");
  const event = /\b(around|during|at the time of)\s+((?:the|our|that|my)\s+(?!\d)[^?.!,;:]+)/i.exec(text);
  if (event !== null) {
    const words = (event[2] ?? "").trim().split(/\s+/);
    const kept = [];
    for (const w of words) {
      if (PHRASE_STOP.has(w.toLowerCase()))
        break;
      kept.push(w);
      if (kept.length >= 6)
        break;
    }
    const phrase = kept.join(" ").replace(/^(the|a|an|our|my|that|this)\s+/i, "").trim();
    if (phrase.length >= 2 && !NOT_EVENTS.has(phrase.toLowerCase()) && monthOf(phrase) === null && !/^(today|yesterday|last|this|next|early|mid|late)\b/i.test(phrase)) {
      const said = `${event[1]} ${kept.join(" ")}`;
      return ask(said.trim(), null, FUZZY_STRETCH_DAYS, without(text, said.trim()), { anchor: { kind: "event", phrase } });
    }
  }
  const plain = ` ${lower.replace(/'/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
  const session = SESSION_PHRASES.find((p) => plain.includes(` ${p} `));
  if (session !== undefined) {
    return ask(session, null, 0, removeWords(text, session), { anchor: { kind: "session" } });
  }
  const iso = /\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/.exec(text);
  if (iso !== null) {
    const found = iso[0];
    const parsed = parseCalendarDate(found);
    if (parsed !== null) {
      return dated(text, found, parsed.first, parsed.last, parsed.precision === "day" ? 0 : FUZZY_STRETCH_DAYS, today);
    }
  }
  const short = firstShortDate(text);
  if (short !== null) {
    const m = Number(short[1]);
    const d = Number(short[2]);
    const y = short[3] !== undefined ? Number(short[3]) : m >= 1 && m <= 12 ? yearFor(m, today) : 0;
    const day = m >= 1 && m <= 12 ? `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}` : null;
    if (day !== null && parseCalendarDate(day)?.precision === "day") {
      return dated(text, short[0], day, day, 0, today, { yearless: short[3] === undefined });
    }
  }
  const named = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b(?:,?\\s+(\\d{4})\\b)?`, "i").exec(text);
  if (named !== null) {
    const month = monthOf(named[1] ?? named[5]);
    const d = Number(named[2] ?? named[4]);
    const year = named[3] ?? named[6];
    if (month !== null) {
      const day = `${String(year !== undefined ? Number(year) : yearFor(month, today)).padStart(4, "0")}-${pad(month)}-${pad(d)}`;
      if (parseCalendarDate(day)?.precision === "day") {
        return dated(text, named[0], day, day, 0, today, { yearless: year === undefined });
      }
    }
  }
  const [ty, tm] = today.split("-").map(Number);
  if (/\blast month\b/i.test(text)) {
    const y = tm === 1 ? ty - 1 : ty;
    const m = tm === 1 ? 12 : tm - 1;
    return ask("last month", { from: `${String(y)}-${pad(m)}-01`, to: lastDayOf(y, m) }, FUZZY_STRETCH_DAYS, without(text, "last month"));
  }
  if (/\bthis month\b/i.test(text)) {
    return ask("this month", { from: `${String(ty)}-${pad(tm)}-01`, to: today }, FUZZY_STRETCH_DAYS, without(text, "this month"));
  }
  const part = new RegExp(`\\b(early|mid|late|the start of|the beginning of|the end of|the middle of)[\\s-]+(${MONTH_ALT})\\b`, "i").exec(text);
  if (part !== null) {
    const month = monthOf(part[2]);
    if (month !== null) {
      const y = yearFor(month, today);
      const last = lastDayOf(y, month);
      const which = part[1].toLowerCase();
      const first = `${String(y)}-${pad(month)}-01`;
      const said = which === "early" || which === "the start of" || which === "the beginning of" ? { from: first, to: `${String(y)}-${pad(month)}-10` } : which === "mid" || which === "the middle of" ? { from: `${String(y)}-${pad(month)}-11`, to: `${String(y)}-${pad(month)}-20` } : { from: `${String(y)}-${pad(month)}-21`, to: last };
      return ask(part[0], said, FUZZY_STRETCH_DAYS, without(text, part[0]));
    }
  }
  const inMonth = new RegExp(`\\b(in|during|since|through|throughout|over)\\s+(${MONTH_ALT})\\b(?:\\s+(\\d{4}))?|\\b(${MONTH_ALT})\\s+(\\d{4})\\b`, "i").exec(text);
  if (inMonth !== null) {
    const name = inMonth[2] ?? inMonth[4];
    const month = monthOf(name);
    const mayOk = name.toLowerCase() !== "may" || /\bMay\b/.test(inMonth[0]);
    if (month !== null && mayOk) {
      const yearText = inMonth[3] ?? inMonth[5];
      const y = yearText !== undefined ? Number(yearText) : yearFor(month, today);
      const first = `${String(y)}-${pad(month)}-01`;
      const isSince = (inMonth[1] ?? "").toLowerCase() === "since";
      const found = inMonth[1] !== undefined ? inMonth[0].slice(inMonth[1].length).trim() : inMonth[0];
      return ask(inMonth[0].trim(), isSince ? { from: first, to: today } : { from: first, to: lastDayOf(y, month) }, FUZZY_STRETCH_DAYS, without(text, found));
    }
  }
  if (/\blast week\b/i.test(text)) {
    const monday = addDays(mondayOf(today), -7);
    return ask("last week", { from: monday, to: addDays(monday, 6) }, FUZZY_STRETCH_DAYS, without(text, "last week"));
  }
  if (/\bthis week\b/i.test(text)) {
    return ask("this week", { from: mondayOf(today), to: today }, FUZZY_STRETCH_DAYS, without(text, "this week"));
  }
  const pastWeek = /\b(the\s+)?(past|last)\s+(7 days|seven days|week)\b/i.exec(text);
  if (pastWeek !== null) {
    return ask(pastWeek[0], { from: addDays(today, -6), to: today }, 0, without(text, pastWeek[0]));
  }
  const weeksAgo = new RegExp(`\\b${RANGE_FROM}(${NUMBER_ALT})\\s+weeks?\\s+ago\\b`, "i").exec(text);
  if (weeksAgo !== null) {
    const n = numberOf(weeksAgo[2]) ?? 1;
    const near = weeksAgo[1] === undefined ? n : Math.min(n, numberOf(weeksAgo[1]) ?? n);
    const far = weeksAgo[1] === undefined ? n : Math.max(n, numberOf(weeksAgo[1]) ?? n);
    const monday = addDays(mondayOf(today), -7 * far);
    return ask(weeksAgo[0], { from: monday, to: addDays(mondayOf(today), -7 * near + 6) }, FUZZY_STRETCH_DAYS, without(text, weeksAgo[0]));
  }
  const fewWeeks = /\b(the\s+)?(past|last)\s+(few|couple of|two|three)\s+weeks\b/i.exec(text);
  if (fewWeeks !== null) {
    const n = numberOf(fewWeeks[3]) ?? 3;
    return ask(fewWeeks[0], { from: addDays(today, -7 * n + 1), to: today }, 0, without(text, fewWeeks[0]));
  }
  const weekday = new RegExp(`(?<!\\bthe\\s)\\b(?:last|this past)\\s+(${WEEKDAY_NAMES.join("|")})\\b(?:['’]s\\b)?`, "i").exec(text);
  if (weekday !== null) {
    const day = lastWeekday(today, WEEKDAY_NAMES.indexOf(weekday[1].toLowerCase()));
    return dated(text, weekday[0], day, day, 0, today, { cue: weekday[0].replace(/['’]s$/i, "") });
  }
  const dayBefore = /\bthe day before yesterday\b/i.exec(text);
  if (dayBefore !== null) {
    const day = addDays(today, -2);
    return ask(dayBefore[0], { from: day, to: day }, 0, without(text, dayBefore[0]));
  }
  const daysAgo = new RegExp(`\\b${RANGE_FROM}(${NUMBER_ALT})\\s+days?\\s+ago\\b`, "i").exec(text);
  if (daysAgo !== null) {
    const word = daysAgo[2].toLowerCase();
    if (word === "few" || word === "a few" || word === "couple" || word === "a couple" || word === "a couple of") {
      return ask(daysAgo[0], { from: addDays(today, -5), to: addDays(today, -2) }, NEAR_STRETCH_DAYS, without(text, daysAgo[0]));
    }
    const n = numberOf(word) ?? 1;
    const near = daysAgo[1] === undefined ? n : Math.min(n, numberOf(daysAgo[1]) ?? n);
    const far = daysAgo[1] === undefined ? n : Math.max(n, numberOf(daysAgo[1]) ?? n);
    return ask(daysAgo[0], { from: addDays(today, -far), to: addDays(today, -near) }, NEAR_STRETCH_DAYS, without(text, daysAgo[0]));
  }
  if (/\bthe other day\b/i.test(text)) {
    return ask("the other day", { from: addDays(today, -5), to: addDays(today, -2) }, NEAR_STRETCH_DAYS, without(text, "the other day"));
  }
  const pastDays = new RegExp(`\\b(the\\s+)?(past|last)\\s+(${NUMBER_ALT})\\s+days\\b`, "i").exec(text);
  if (pastDays !== null) {
    const n = Math.max(1, numberOf(pastDays[3]) ?? 3);
    return ask(pastDays[0], { from: addDays(today, -(n - 1)), to: today }, 0, without(text, pastDays[0]));
  }
  if (/\b(recently|lately)\b/i.test(text)) {
    const found = /\b(recently|lately)\b/i.exec(text)?.[0] ?? "recently";
    return ask(found, { from: addDays(today, -6), to: today }, 0, without(text, found));
  }
  const recency = readRecencyAsk(text, clock);
  if (recency !== null && recency.window !== null) {
    const from = recency.window.from.slice(0, 10);
    const to = recency.window.to.slice(0, 10);
    const cue = recency.cue;
    const rest = cue === "a clock time" ? text : removeWords(text, cue);
    const whole = recency.window.from.endsWith("00:00") && recency.window.to.endsWith("23:59");
    return ask(cue, { from, to }, 0, rest, whole ? {} : { clock: { from: recency.window.from, to: recency.window.to } });
  }
  return null;
}
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function removeWords(text, phrase) {
  const pattern = phrase.split(" ").map((w) => escape(w).split("").join("['’]?")).join("[^a-z0-9]+");
  const re = new RegExp(`\\b${pattern}\\b`, "i");
  const m = re.exec(text);
  return m === null ? text : without(text, m[0]);
}
