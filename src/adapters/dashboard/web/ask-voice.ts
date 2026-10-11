/**
 * ASK, IN THE OWNER'S VOICE (memories tab, round 3b, 2026-09-27 — a try).
 *
 * The dashboard's Ask is the owner talking to me: "what have you learned about
 * yourself?", "do you remember what I said about the shed?". My memories are
 * written in MY first person — "I", "me", and the owner by name — and the small
 * static embedder weighs a question's words, pronouns included. So before the
 * question reaches `counterparts ask`, it is turned round into my voice:
 *
 *     do you remember what I said   →   do I remember what Mike said
 *
 * The rules, as built:
 *
 *   - **One pass over the ORIGINAL tokens.** Every decision reads the words as
 *     the owner typed them and writes to a separate output, so an "I" made from
 *     "you" is never turned again into the owner's name. That is the bug this
 *     shape exists to rule out.
 *   - **You → me.** you're/you've/you'd/you'll → I'm/I've/I'd/I'll; are you /
 *     you are → am I / I am; were you / you were → was I / I was (and the
 *     negated forms); yourself → myself, yours → mine, your → my. A bare "you"
 *     is "I" when it is the subject and "me" when it is the object, judged from
 *     its neighbours (`youRole`): after an auxiliary it is a subject; after a
 *     preposition or a verb that takes a person as its object it is an object;
 *     with nothing after it in its clause ("Mike and you?") it is an object;
 *     at a clause's start or after a wh-word/conjunction it is a subject; before
 *     a word that usually follows a subject ("you said", "you ever") it is a
 *     subject; anything else is an object.
 *   - **The owner's I → his name**, when the store knows it: I/me/myself → Mike,
 *     my/mine → Mike's, I'm → Mike is, I've → Mike has, I'll → Mike will, I'd →
 *     Mike'd, am I / I am → is Mike / Mike is. Verb agreement is fixed no
 *     further ("do Mike like" is fine for a search, and the page shows it).
 *   - **With no name known, the owner's I → you** — a true swap. (The spec said
 *     leave his pronouns alone; that made "do you remember what I said" into
 *     "do I remember what I said", two I's meaning two people. Changed on
 *     purpose, 2026-09-27.)
 *   - **Whole words only**, case-insensitive; straight or curly apostrophes. A
 *     hyphenated compound is one word ("you-know-who" stays), and so are
 *     yourselves, Youtube, younger. We/us/our mean both of us and stay as typed.
 *   - **Left exactly as typed:** anything in quotes ("…", “…”, '…', ‘…’, `…`),
 *     and any chunk that looks like an id, a path, an address or code (a
 *     `mem_`/`epi_`/`sch_` id, a slash, an @, an underscore, a dot inside a
 *     word). A double quote or backtick opened and never closed runs to the
 *     end; a single quote never closed is an apostrophe and quotes nothing.
 *   - **Capitals as typed.** A word keeps the leading capital it was typed
 *     with — except the owner's "I", which is always a capital and so keeps one
 *     only at a sentence's start ("what I said" → "what you said"). My "I" and
 *     a name are always capitals; an all-caps word stays all caps; a curly
 *     apostrophe stays curly.
 *
 * Pure: no store, no I/O. The page shows the result ("searched as: …") with a
 * way to search exactly as typed, so a rewrite that reads wrong is one click
 * from being undone.
 */

export interface Voiced {
  /** The question in my voice (the text `ask` searches with). */
  readonly text: string;
  /** Whether that differs from what was typed. */
  readonly changed: boolean;
}

/** A stored name (the identity core's, lower-cased by `ownerNames`) as a person writes it. */
export function displayName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  return trimmed.replace(/(^|[\s-])(\p{Ll})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

// ── the word lists (each list covered by a case in the test table) ─────────

/** Words, one list as one string: `"do does did"` → a set. */
function wordSet(words: string): ReadonlySet<string> {
  return new Set(words.split(/\s+/).filter((w) => w.length > 0));
}

/** Auxiliaries (and "be"): "you" right after one is the subject of a question ("did you", "are you"). */
const AUX = wordSet(`
  do does did have has had can could will would should shall might may must don't doesn't
  didn't haven't hasn't hadn't can't cannot couldn't won't wouldn't shouldn't mightn't mustn't
  are were aren't weren't
`);

/** Prepositions: "you" after one is an object ("about you"). The words that
 *  are also conjunctions (before, after, since, until) are left out on purpose. */
const PREP = wordSet(`
  about to for with of from at on in by like than without toward towards around into onto upon
  between among against behind near beside besides beyond past through under over within via
  regarding concerning
`);

/** Verbs that take a person as their object: "tell you", "made you". */
const OBJECT_VERBS = wordSet(`
  tell tells told ask asks asked remind reminds reminded help helps helped make makes made let
  lets show shows showed shown give gives gave given teach teaches taught thank thanks thanked
  call calls called send sends sent bring brings brought need needs needed want wants wanted
  trust trusts trusted love loves loved likes liked hate hates hated see sees saw seen hear
  hears heard meet meets met know knows knew understand understands understood bother bothers
  bothered surprise surprises surprised annoy annoys annoyed hurt hurts get gets got keep
  keeps kept pay pays paid trained built named warn warned promise promised
`);

/** A clause starts after one of these, so "you" is its subject ("what you said"). */
const CLAUSE = wordSet(`
  what who when where why how which whether if that and but or so because since until while
  before after once unless though although as whenever wherever whatever whoever then
`);

/** Words that usually follow a subject: "you said", "you ever", "you'd". */
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

// ── what is left exactly as typed ──────────────────────────────────────────

/** A chunk that reads as an id, path, address or code, not as words. */
const LITERAL_CHUNK = /(?:^|[^\p{L}\p{N}])(?:mem|epi|sch)_|[/\\@=<>{}[\]#|~^*$%_]|:\/\/|[\p{L}\p{N}][.:][\p{L}\p{N}]/u;

const SPACE = /\s/u;
const CLOSE_AFTER = /[\s.,!?;:)\]}"”]/u;
const OPEN_BEFORE = /[\s([{]/u;

/** Which characters of `s` are left exactly as typed. */
function literalMask(s: string): boolean[] {
  const mask: boolean[] = new Array<boolean>(s.length).fill(false);
  const mark = (from: number, to: number): void => {
    for (let k = from; k < to; k++) mask[k] = true;
  };
  // Quotes, left to right.
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    let end = -1;
    if (c === '"' || c === "`") {
      const close = s.indexOf(c, i + 1);
      end = close === -1 ? s.length : close + 1;
    } else if (c === "“") {
      const close = s.indexOf("”", i + 1);
      end = close === -1 ? s.length : close + 1;
    } else if ((c === "'" || c === "‘") && (i === 0 || OPEN_BEFORE.test(s[i - 1] as string)) && i + 1 < s.length && !SPACE.test(s[i + 1] as string)) {
      // A single quote only quotes when it opens (start or space before, a
      // word after) and something closes it (a word before, a break after) —
      // otherwise it is an apostrophe: don't, 'cause, the kids' toys.
      for (let j = i + 1; j < s.length; j++) {
        const d = s[j] as string;
        if ((d === "'" || d === "’") && !SPACE.test(s[j - 1] as string) && (j + 1 === s.length || CLOSE_AFTER.test(s[j + 1] as string))) {
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
  // Whitespace-separated chunks that look like ids, paths, addresses, code.
  for (const m of s.matchAll(/\S+/gu)) {
    const start = m.index ?? 0;
    const chunk = m[0].replace(/[.,!?;:)\]}"'’”]+$/u, "");
    if (LITERAL_CHUNK.test(chunk)) mark(start, start + m[0].length);
  }
  return mask;
}

// ── the flip ───────────────────────────────────────────────────────────────

interface Word {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  /** Lower-cased, curly apostrophe made straight. */
  readonly key: string;
  readonly literal: boolean;
  /** The word before, when only spaces sit between (else null: a clause break). */
  prev: string | null;
  next: string | null;
  /** First word of the text or of a sentence. */
  sentenceStart: boolean;
}

const WORD = /[\p{L}\p{N}_]+(?:['’-][\p{L}\p{N}_]+)*/gu;

function words(s: string, mask: boolean[]): Word[] {
  const out: Word[] = [];
  for (const m of s.matchAll(WORD)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    let literal = false;
    for (let k = start; k < end; k++) if (mask[k] === true) literal = true;
    out.push({
      start,
      end,
      raw: m[0],
      key: m[0].toLowerCase().replace(/’/g, "'"),
      literal,
      prev: null,
      next: null,
      sentenceStart: false,
    });
  }
  for (let w = 0; w < out.length; w++) {
    const cur = out[w] as Word;
    const before = w === 0 ? null : (out[w - 1] as Word);
    const gapBefore = before === null ? s.slice(0, cur.start) : s.slice(before.end, cur.start);
    cur.sentenceStart = before === null || /[.!?\n]/.test(gapBefore);
    if (before !== null && !before.literal && /^[ \t]+$/.test(gapBefore) && !maskedIn(mask, before.end, cur.start)) {
      cur.prev = before.key;
      before.next = cur.literal ? null : cur.key;
    }
  }
  return out;
}

function maskedIn(mask: boolean[], from: number, to: number): boolean {
  for (let k = from; k < to; k++) if (mask[k] === true) return true;
  return false;
}

/** A bare "you": the subject ("I") or the object ("me")? */
function youRole(w: Word): "subject" | "object" {
  if (w.prev !== null && AUX.has(w.prev)) return "subject";
  if (w.prev !== null && (PREP.has(w.prev) || OBJECT_VERBS.has(w.prev))) return "object";
  // Nothing follows inside its clause ("Mike and you?"): nothing for it to
  // be the subject of.
  if (w.prev !== null && w.next === null) return "object";
  if (w.prev === null || CLAUSE.has(w.prev)) return "subject";
  if (w.next !== null && AFTER_SUBJECT.has(w.next)) return "subject";
  return "object";
}

const BE_AFTER_YOU: Record<string, string> = { are: "am", were: "was", "aren't": "am not", "weren't": "wasn't" };
const BE_BEFORE_YOU: Record<string, string> = { are: "am", were: "was", "aren't": "aren't", "weren't": "wasn't" };

/** A replacement and how it takes a capital. `fixedCase`: it carries its own
 *  capitals ("I…", a name) and only gains one at a sentence's start. */
interface Out {
  readonly text: string;
  readonly fixedCase: boolean;
}

/**
 * The owner's question, in my voice. `ownerName` is the store's name for him
 * (any case; `displayName` capitalises it); null when the store knows none.
 */
export function toMyVoice(question: string, ownerName: string | null): Voiced {
  const name = displayName(ownerName);
  const mask = literalMask(question);
  const list = words(question, mask);

  // The owner's first person, in my voice.
  const owner = (key: string): Out | null => {
    if (name !== null) {
      const n = (t: string): Out => ({ text: t, fixedCase: true });
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
    const SWAP: Record<string, string> = {
      i: "you", me: "you", myself: "yourself", my: "your", mine: "yours",
      "i'm": "you're", "i've": "you've", "i'll": "you'll", "i'd": "you'd",
    };
    const t = SWAP[key];
    return t === undefined ? null : { text: t, fixedCase: false };
  };

  const replace = (w: Word): Out | null => {
    const k = w.key;
    // "be" beside a pronoun turns with it: are you → am I, I am → Mike is.
    if (k === "am" || k === "was" || k === "wasn't" || k in BE_AFTER_YOU) {
      if (w.prev === "you" && k in BE_AFTER_YOU) return { text: BE_AFTER_YOU[k] as string, fixedCase: false };
      if (w.prev === "i") {
        if (name !== null) return k === "am" ? { text: "is", fixedCase: false } : null;
        const T: Record<string, string> = { am: "are", was: "were", "wasn't": "weren't" };
        return T[k] === undefined ? null : { text: T[k] as string, fixedCase: false };
      }
      if (w.next === "you" && k in BE_BEFORE_YOU) return { text: BE_BEFORE_YOU[k] as string, fixedCase: false };
      if (w.next === "i") {
        if (name !== null) {
          const T: Record<string, string> = { am: "is", "aren't": "isn't" };
          return T[k] === undefined ? null : { text: T[k] as string, fixedCase: false };
        }
        const T: Record<string, string> = { am: "are", was: "were", "wasn't": "weren't" };
        return T[k] === undefined ? null : { text: T[k] as string, fixedCase: false };
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
    if (w.literal) continue;
    const r = replace(w);
    if (r === null) continue;
    out += question.slice(at, w.start) + cased(w, r);
    at = w.end;
  }
  out += question.slice(at);
  return { text: out, changed: out !== question };
}

function cased(w: Word, r: Out): string {
  const raw = w.raw;
  // The owner's apostrophe, kept: "you’re" → "I’m".
  const text = raw.includes("’") ? r.text.replace(/'/g, "’") : r.text;
  const upper = raw.length > 1 && raw === raw.toUpperCase() && raw !== raw.toLowerCase();
  // An all-caps word stays all caps ("YOUR" → "MY"); "I" alone is not all caps.
  if (upper && w.key !== "i") return text.toUpperCase();
  const first = raw.charAt(0);
  const wasCapital = first !== first.toLowerCase();
  // The owner's "I" is always a capital, so it keeps one only where a
  // sentence starts; any other word keeps the capital it was typed with.
  const isOwnerI = w.key === "i" || w.key.startsWith("i'");
  const capital = wasCapital && (!isOwnerI || w.sentenceStart);
  if (capital) return text.charAt(0).toUpperCase() + text.slice(1);
  if (r.fixedCase) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
