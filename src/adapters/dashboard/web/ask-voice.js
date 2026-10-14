export function displayName(name) {
  if (typeof name !== "string")
    return null;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0)
    return null;
  return trimmed.replace(/(^|[\s-])(\p{Ll})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
}
function wordSet(words) {
  return new Set(words.split(/\s+/).filter((w) => w.length > 0));
}
const AUX = wordSet(`
  do does did have has had can could will would should shall might may must don't doesn't
  didn't haven't hasn't hadn't can't cannot couldn't won't wouldn't shouldn't mightn't mustn't
  are were aren't weren't
`);
const PREP = wordSet(`
  about to for with of from at on in by like than without toward towards around into onto upon
  between among against behind near beside besides beyond past through under over within via
  regarding concerning
`);
const OBJECT_VERBS = wordSet(`
  tell tells told ask asks asked remind reminds reminded help helps helped make makes made let
  lets show shows showed shown give gives gave given teach teaches taught thank thanks thanked
  call calls called send sends sent bring brings brought need needs needed want wants wanted
  trust trusts trusted love loves loved likes liked hate hates hated see sees saw seen hear
  hears heard meet meets met know knows knew understand understands understood bother bothers
  bothered surprise surprises surprised annoy annoys annoyed hurt hurts get gets got keep
  keeps kept pay pays paid trained built named warn warned promise promised
`);
const CLAUSE = wordSet(`
  what who when where why how which whether if that and but or so because since until while
  before after once unless though although as whenever wherever whatever whoever then
`);
const AFTER_SUBJECT = wordSet(`
  am are were was aren't weren't wasn't have has had haven't do don't did didn't does can
  can't could couldn't will won't would wouldn't should shouldn't might may must said say says
  know knew think thought remember remembered recall recalled learn learned learnt like liked
  want wanted feel felt mean meant believe believed notice noticed write wrote written find
  found see saw hear heard need needed get got tell told ask asked decide decided keep kept
  forget forgot understand understood prefer preferred love loved hate hated care cared wish
  wished hope hoped guess guessed make made seem seemed noted stored saved ever never just
  still also really actually already even always usually often sometimes first last once
`);
const LITERAL_CHUNK = /(?:^|[^\p{L}\p{N}])(?:mem|epi|sch)_|[/\\@=<>{}[\]#|~^*$%_]|:\/\/|[\p{L}\p{N}][.:][\p{L}\p{N}]/u;
const SPACE = /\s/u;
const CLOSE_AFTER = /[\s.,!?;:)\]}"”]/u;
const OPEN_BEFORE = /[\s([{]/u;
function literalMask(s) {
  const mask = new Array(s.length).fill(false);
  const mark = (from, to) => {
    for (let k = from;k < to; k++)
      mask[k] = true;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    let end = -1;
    if (c === '"' || c === "`") {
      const close = s.indexOf(c, i + 1);
      end = close === -1 ? s.length : close + 1;
    } else if (c === "“") {
      const close = s.indexOf("”", i + 1);
      end = close === -1 ? s.length : close + 1;
    } else if ((c === "'" || c === "‘") && (i === 0 || OPEN_BEFORE.test(s[i - 1])) && i + 1 < s.length && !SPACE.test(s[i + 1])) {
      for (let j = i + 1;j < s.length; j++) {
        const d = s[j];
        if ((d === "'" || d === "’") && !SPACE.test(s[j - 1]) && (j + 1 === s.length || CLOSE_AFTER.test(s[j + 1]))) {
          end = j + 1;
          break;
        }
      }
    }
    if (end > i) {
      mark(i, end);
      i = end;
    } else {
      i++;
    }
  }
  for (const m of s.matchAll(/\S+/gu)) {
    const start = m.index ?? 0;
    const chunk = m[0].replace(/[.,!?;:)\]}"'’”]+$/u, "");
    if (LITERAL_CHUNK.test(chunk))
      mark(start, start + m[0].length);
  }
  return mask;
}
const WORD = /[\p{L}\p{N}_]+(?:['’-][\p{L}\p{N}_]+)*/gu;
function words(s, mask) {
  const out = [];
  for (const m of s.matchAll(WORD)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    let literal = false;
    for (let k = start;k < end; k++)
      if (mask[k] === true)
        literal = true;
    out.push({
      start,
      end,
      raw: m[0],
      key: m[0].toLowerCase().replace(/’/g, "'"),
      literal,
      prev: null,
      next: null,
      sentenceStart: false
    });
  }
  for (let w = 0;w < out.length; w++) {
    const cur = out[w];
    const before = w === 0 ? null : out[w - 1];
    const gapBefore = before === null ? s.slice(0, cur.start) : s.slice(before.end, cur.start);
    cur.sentenceStart = before === null || /[.!?\n]/.test(gapBefore);
    if (before !== null && !before.literal && /^[ \t]+$/.test(gapBefore) && !maskedIn(mask, before.end, cur.start)) {
      cur.prev = before.key;
      before.next = cur.literal ? null : cur.key;
    }
  }
  return out;
}
function maskedIn(mask, from, to) {
  for (let k = from;k < to; k++)
    if (mask[k] === true)
      return true;
  return false;
}
function youRole(w) {
  if (w.prev !== null && AUX.has(w.prev))
    return "subject";
  if (w.prev !== null && (PREP.has(w.prev) || OBJECT_VERBS.has(w.prev)))
    return "object";
  if (w.prev !== null && w.next === null)
    return "object";
  if (w.prev === null || CLAUSE.has(w.prev))
    return "subject";
  if (w.next !== null && AFTER_SUBJECT.has(w.next))
    return "subject";
  return "object";
}
const BE_AFTER_YOU = { are: "am", were: "was", "aren't": "am not", "weren't": "wasn't" };
const BE_BEFORE_YOU = { are: "am", were: "was", "aren't": "aren't", "weren't": "wasn't" };
export function toMyVoice(question, ownerName) {
  const name = displayName(ownerName);
  const mask = literalMask(question);
  const list = words(question, mask);
  const owner = (key) => {
    if (name !== null) {
      const n = (t) => ({ text: t, fixedCase: true });
      switch (key) {
        case "i":
        case "me":
        case "myself":
          return n(name);
        case "my":
        case "mine":
          return n(`${name}'s`);
        case "i'm":
          return n(`${name} is`);
        case "i've":
          return n(`${name} has`);
        case "i'll":
          return n(`${name} will`);
        case "i'd":
          return n(`${name}'d`);
        default:
          return null;
      }
    }
    const SWAP = {
      i: "you",
      me: "you",
      myself: "yourself",
      my: "your",
      mine: "yours",
      "i'm": "you're",
      "i've": "you've",
      "i'll": "you'll",
      "i'd": "you'd"
    };
    const t = SWAP[key];
    return t === undefined ? null : { text: t, fixedCase: false };
  };
  const replace = (w) => {
    const k = w.key;
    if (k === "am" || k === "was" || k === "wasn't" || k in BE_AFTER_YOU) {
      if (w.prev === "you" && k in BE_AFTER_YOU)
        return { text: BE_AFTER_YOU[k], fixedCase: false };
      if (w.prev === "i") {
        if (name !== null)
          return k === "am" ? { text: "is", fixedCase: false } : null;
        const T = { am: "are", was: "were", "wasn't": "weren't" };
        return T[k] === undefined ? null : { text: T[k], fixedCase: false };
      }
      if (w.next === "you" && k in BE_BEFORE_YOU)
        return { text: BE_BEFORE_YOU[k], fixedCase: false };
      if (w.next === "i") {
        if (name !== null) {
          const T = { am: "is", "aren't": "isn't" };
          return T[k] === undefined ? null : { text: T[k], fixedCase: false };
        }
        const T = { am: "are", was: "were", "wasn't": "weren't" };
        return T[k] === undefined ? null : { text: T[k], fixedCase: false };
      }
      return null;
    }
    switch (k) {
      case "you":
        return { text: youRole(w) === "subject" ? "I" : "me", fixedCase: youRole(w) === "subject" };
      case "you're":
        return { text: "I'm", fixedCase: true };
      case "you've":
        return { text: "I've", fixedCase: true };
      case "you'd":
        return { text: "I'd", fixedCase: true };
      case "you'll":
        return { text: "I'll", fixedCase: true };
      case "yourself":
        return { text: "myself", fixedCase: false };
      case "yours":
        return { text: "mine", fixedCase: false };
      case "your":
        return { text: "my", fixedCase: false };
      default:
        return owner(k);
    }
  };
  let out = "";
  let at = 0;
  for (const w of list) {
    if (w.literal)
      continue;
    const r = replace(w);
    if (r === null)
      continue;
    out += question.slice(at, w.start) + cased(w, r);
    at = w.end;
  }
  out += question.slice(at);
  return { text: out, changed: out !== question };
}
function cased(w, r) {
  const raw = w.raw;
  const text = raw.includes("’") ? r.text.replace(/'/g, "’") : r.text;
  const upper = raw.length > 1 && raw === raw.toUpperCase() && raw !== raw.toLowerCase();
  if (upper && w.key !== "i")
    return text.toUpperCase();
  const first = raw.charAt(0);
  const wasCapital = first !== first.toLowerCase();
  const isOwnerI = w.key === "i" || w.key.startsWith("i'");
  const capital = wasCapital && (!isOwnerI || w.sentenceStart);
  if (capital)
    return text.charAt(0).toUpperCase() + text.slice(1);
  if (r.fixedCase)
    return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
