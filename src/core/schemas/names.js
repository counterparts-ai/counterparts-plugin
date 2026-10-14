import { nameRegex, unpossessed } from "../encode/words.js";
export const MAX_WORDS = 3;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_WORDS = new Set([
  ...WEEKDAYS,
  ...WEEKDAYS.map((d) => `${d}s`),
  "mon",
  "tue",
  "tues",
  "wed",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
  "sun",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec"
]);
const TOKEN = /[\p{L}\p{N}_'’-]+/gu;
const CAPITALIZED = /^\p{Lu}\p{Ll}/u;
const HAS_DIGIT_OR_UNDERSCORE = /[\p{N}_]/u;
const OPENERS = new Set([" ", "\t", "\r", '"', "'", "“", "‘", "(", "[", "{", "*", "_", "`", ">"]);
const BOUNDARY = new Set([".", "!", "?", ":", ";", "•", "#", "|", "-"]);
const CODE_BEFORE = /[`/.@~_\\]/u;
const CODE_AFTER = /^(?:[/@`]|\.\p{L})/u;
function startsSentence(text, at) {
  for (let i = at - 1;i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === `
`)
      return true;
    if (!OPENERS.has(ch))
      return BOUNDARY.has(ch);
  }
  return true;
}
function inCode(text, at, n) {
  return CODE_BEFORE.test(text[at - 1] ?? "") || CODE_AFTER.test(text.slice(at + n, at + n + 2));
}
function runsOf(text) {
  const runs = [];
  let words = [];
  let initial = false;
  let lastEnd = -1;
  const flush = () => {
    if (words.length > 0)
      runs.push({ words, initial });
    words = [];
  };
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0];
    const at = m.index;
    const capitalized = CAPITALIZED.test(token) && !HAS_DIGIT_OR_UNDERSCORE.test(token);
    const prev = words[words.length - 1];
    const adjacent = prev !== undefined && at === lastEnd + 1 && text[lastEnd] === " " && unpossessed(prev) === prev;
    if (!capitalized) {
      flush();
    } else if (adjacent) {
      words.push(token);
    } else {
      flush();
      words = [token];
      initial = startsSentence(text, at);
    }
    lastEnd = at + token.length;
  }
  flush();
  return runs;
}
function nameOf(words) {
  const last = unpossessed(words[words.length - 1]);
  return [...words.slice(0, -1), last].join(" ");
}
function writesOtherCase(text, name) {
  for (const m of text.matchAll(new RegExp(nameRegex(name, "iu").source, "giu"))) {
    if (unpossessed(m[0]) === name || inCode(text, m.index, m[0].length))
      continue;
    return true;
  }
  return false;
}
export function tallyNames(texts, opts) {
  const proposed = new Map;
  const capMemories = new Map;
  const byWord = new Map;
  const proseForms = new Map;
  const joined = [];
  texts.forEach((t, index) => {
    const text = t.title === null || t.title.length === 0 ? t.body : `${t.title}
${t.body}`;
    joined.push(text);
    const words = new Set;
    for (const m of text.matchAll(TOKEN)) {
      const word = unpossessed(m[0]);
      const key = word.toLowerCase();
      words.add(key);
      if (inCode(text, m.index, m[0].length))
        continue;
      let forms = proseForms.get(key);
      if (forms === undefined)
        proseForms.set(key, forms = new Map);
      const seen = forms.get(index);
      if (seen === undefined)
        forms.set(index, new Set([word]));
      else
        seen.add(word);
    }
    for (const w of words) {
      const list = byWord.get(w);
      if (list === undefined)
        byWord.set(w, [index]);
      else
        list.push(index);
    }
    const runs = new Set;
    for (const part of [t.title ?? "", t.body]) {
      for (const run of runsOf(part)) {
        if (run.words.length > MAX_WORDS)
          continue;
        for (let i = 0;i < run.words.length; i += 1) {
          for (let j = i + 1;j <= run.words.length; j += 1) {
            const name = nameOf(run.words.slice(i, j));
            runs.add(name);
            if (i === 0 && j === run.words.length && !run.initial && !proposed.has(name.toLowerCase())) {
              proposed.set(name.toLowerCase(), name);
            }
          }
        }
      }
    }
    for (const name of runs) {
      const set = capMemories.get(name) ?? new Set;
      set.add(index);
      capMemories.set(name, set);
    }
  });
  const counted = [];
  let lowerCase = 0;
  for (const name of proposed.values()) {
    if (name.split(" ").some((w) => TIME_WORDS.has(w.toLowerCase())))
      continue;
    const caps = capMemories.get(name);
    if (caps === undefined || caps.size < opts.minMemories)
      continue;
    if (new Set([...caps].map((i) => texts[i].day)).size < opts.minDays)
      continue;
    if (opts.skip?.(name) === true)
      continue;
    const anyCase = nameRegex(name, "iu");
    const lower = name.toLowerCase();
    const first = lower.split(" ")[0];
    const oneWord = first === lower;
    const memories = [];
    const days = new Set;
    const kinds = {};
    const titledKinds = {};
    let otherCase = 0;
    for (const i of byWord.get(first) ?? []) {
      const text = joined[i];
      if (!oneWord && !anyCase.test(text))
        continue;
      const t = texts[i];
      memories.push(t.id);
      days.add(t.day);
      kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
      if (t.title !== null && anyCase.test(t.title))
        titledKinds[t.kind] = (titledKinds[t.kind] ?? 0) + 1;
      const written = oneWord ? [...proseForms.get(lower)?.get(i) ?? []].some((w) => w !== name) : writesOtherCase(text, name);
      if (written)
        otherCase += 1;
    }
    if (memories.length < opts.minMemories || days.size < opts.minDays)
      continue;
    if (otherCase >= opts.lowerCaseShare * memories.length) {
      lowerCase += 1;
      continue;
    }
    counted.push({ name, memories: memories.sort(), days: days.size, kinds, titledKinds });
  }
  const names = counted.filter((short) => !counted.some((long) => long !== short && 2 * long.memories.length >= short.memories.length && long.name.split(" ").length > short.name.split(" ").length && ` ${long.name.toLowerCase()} `.includes(` ${short.name.toLowerCase()} `)));
  names.sort((a, b) => b.memories.length - a.memories.length || b.days - a.days || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { names, proposed: proposed.size, lowerCase };
}
