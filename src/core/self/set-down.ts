/**
 * WHAT THE PAGE SETS DOWN (PG1, 2026-11-09; Mike's decision 11-07, the
 * Fable fresh-eyes review's batch 1, lightly held).
 *
 * The page sits at its room every night, so every new line pushes an old one
 * out, and the night's page writers decide what goes. Until this, nothing
 * recorded it: nobody could tell a line folded into a story from a line gone.
 * The room stays (the pressure is what made the page stories rather than
 * stone tablets); what changes is that a nightly write says what it set down,
 * and the engine checks it.
 *
 *   1. The writer NAMES what it sets down (`setDown: [{line, why}]`, at the
 *      `self_page` door and on the reflection's `page`).
 *   2. A SENTENCE DIFF of the page before and after (`diffSetDowns`, pure)
 *      sorts every sentence gone word for word: REWORDED when most of its
 *      words are still in one new sentence (or two side by side), not a
 *      set-down; FOLDED when the writer said so and enough of its words are
 *      found across a short run of new sentences; otherwise SET DOWN, as
 *      named, or "unnamed" when the writer did not name it. A line the writer
 *      called folded that is not found is recorded anyway. So a silent drop
 *      can't happen, whatever the writer says.
 *   3. Each set-down becomes a memory (`recordSetDowns`): about me, tagged
 *      `set down`, the line word for word, the why, the version it left.
 *      Written by the night (`source: reflection`), so the night's own reads
 *      (the news since last night, the reflection's lived lists, beliefs)
 *      pass it by as they pass every night row.
 *   4. The wake says it once, the morning after (`counterpart-wake-shape.ts`).
 *   5. The way back: the night's page writers are shown the set-downs life
 *      touched since (`setDownsTouched`); nothing comes back by itself.
 *
 * Only the nightly doors are read (`writer`, `reflection`): a session's or the
 * owner's own edit is theirs and is not second-guessed here.
 *
 * Every number is in `tunables.ts#SET_DOWN_LIMITS`.
 */
import { scanSecrets } from "../encode/secrets.js";
import type { Store } from "../store/index.js";
import { stemTerm } from "../store/stem.js";
import { monthDay } from "../time.js";
import { CLAIM_PREFIX_MIN_CHARS, claimKey, pageClaims, pageSections, type StoredTrace } from "./page.js";
import type { SelfPageAuthor } from "./page.js";
import { PAGE_STORY_LIMITS as STORY, SET_DOWN_LIMITS as L } from "./tunables.js";

/** The tag every set-down memory carries, and recall's handle for them. */
export const SET_DOWN_TAG = "set down";
export const SET_DOWN_HANDLE = "set down";
/** The meta key with the set-down's facts (`SetDownFacts`): the structured truth; the tag is the index. */
export const SET_DOWN_META = "setDown";
/** One per nightly write that set anything down or kept anything by rewording or folding: counts and ids only. */
export const SET_DOWN_EVENT = "self.page.set_down";
/** The store meta key holding the night (`YYYY-MM-DD`) whose set-downs a wake has told: told once, never again. */
export const SET_DOWN_TOLD_KEY = "self.set_down.told";
/** A write that put a set-down line back on the page: the set-down's id. */
export const SET_DOWN_BACK_EVENT = "self.page.brought_back";
/** The why recorded for a line the writer did not name. */
export const UNNAMED_WHY = "set down, unnamed";
/** The why recorded for a line not accounted for that may only have been reworded: kept quietly, never quoted. */
export const UNSURE_WHY = "set down, unnamed (maybe reworded)";

/** What a writer names: the line as it was on the page, and a short why. */
export interface SetDownNamed {
  readonly line: string;
  readonly why: string;
  /** PS1: a craft practice moved off the page: its words as a skill memory (`stories.ts#pageCraftRule`). */
  readonly skill?: string;
}

/** One sentence the page had, with the heading it sat under ("" before any). */
export interface PageSentence {
  readonly text: string;
  readonly section: string;
}

/**
 * What became of one sentence gone word for word. `reworded` and `folded` are
 * kept (not set-downs); `named`, `unnamed` and `unsure` are set down, and only
 * `named` and `unnamed` (clearly gone) are quoted by the wake.
 */
export interface SetDownVerdict {
  readonly line: string;
  readonly section: string;
  readonly outcome: "reworded" | "folded" | "named" | "unnamed" | "unsure";
  readonly why: string;
  /** The best share of its words found: in one or two new sentences, or a run of three for `unnamed`/`unsure`. */
  readonly share: number;
  /** The new sentence(s) it was best matched to, for a reviewer. */
  readonly match: string | null;
  /** True when the writer's account named it (trusted, not re-judged). */
  readonly accounted: boolean;
  /** PS1: on a `named` set-down, the skill memory's words the writer moved it into. */
  readonly skill?: string;
}

export interface SetDownDiff {
  readonly verdicts: readonly SetDownVerdict[];
  /** Named lines that matched no sentence gone (still on the page, or never on it). */
  readonly unmatchedNamed: readonly SetDownNamed[];
}

/** The facts a set-down memory carries in its meta (`SET_DOWN_META`). */
export interface SetDownFacts {
  readonly line: string;
  readonly why: string;
  readonly named: boolean;
  readonly section: string;
  /** The page version it left (the one before the write), and the one written without it. */
  readonly from: number;
  readonly to: number;
  readonly by: SelfPageAuthor;
  /** The calendar date of the night (`YYYY-MM-DD`). */
  readonly date: string;
  /** The ids the line rested on, from the page's trace, when it had any. */
  readonly restedOn?: readonly string[];
  /** Its place among the lines one write set down (0 first), so a night's are told in the page's order. */
  readonly pos?: number;
  /** True when the wake does not quote it: unnamed and maybe only reworded, or the lines past a write's cap. */
  readonly quiet?: boolean;
  /** On the one memory past a write's cap: every line it holds, in full. */
  readonly lines?: readonly string[];
  /** PS1: the skill memory this practice moved into (`kind: skill`), when the writer moved it there. */
  readonly skill?: string;
}

/** A set-down memory as the readers see it. */
export interface SetDownRow extends SetDownFacts {
  readonly id: string;
  readonly createdAt: number;
  readonly birthDay: number;
  readonly uses: number;
  readonly lastUsedDay: number;
}

// ── the diff (pure) ─────────────────────────────────────────────────────────

/** The page's sentences in order, each with its section's heading (`page.ts#pageClaims`, section by section). Pure. */
export function pageSentences(body: string): PageSentence[] {
  const s = pageSections(body);
  if (!s.headed) return pageClaims(body).map((text) => ({ text, section: "" }));
  const out: PageSentence[] = pageClaims(s.preamble).map((text) => ({ text, section: "" }));
  for (const sec of s.sections) for (const text of pageClaims(sec.body)) out.push({ text, section: sec.heading });
  return out;
}

/**
 * Function words: not a stop list for search (the store has none on purpose),
 * only what tells "the same point" from "the same grammar" in this one diff.
 */
const FUNCTION_WORDS = new Set(
  (
    "the and but for nor yet not with from into onto than then that this these those there here what when where which who whom whose why how " +
    "are was were been being have has had having does did doing done will would can could should shall may might must " +
    "its it's i'm i've i'd i'll you your yours our ours his her hers him she they them their theirs mine myself " +
    "also just very more most much many some any all each every other such only own same too about over under again once " +
    "because while until though although whether both either neither"
  ).split(" "),
);

/** A sentence's content words, folded and stemmed, function words aside. Pure. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().replace(/[’‘]/g, "'").matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)) {
    const w = m[0].replace(/'s$/, "").replace(/^-+|-+$/g, "");
    if (w.length < L.WORD_MIN || FUNCTION_WORDS.has(w)) continue;
    out.add(stemTerm(w));
  }
  return out;
}

/** The share of `of`'s words found in `in`, 0..1. An empty `of` is 0. Pure. */
export function shareOf(of: ReadonlySet<string>, inWords: ReadonlySet<string>): number {
  if (of.size === 0) return 0;
  let hit = 0;
  for (const w of of) if (inWords.has(w)) hit += 1;
  return hit / of.size;
}

/** The best share of `words` in a run of at most `window` adjacent sentences of `page`, and that run. Pure. */
export function bestRun(words: ReadonlySet<string>, page: readonly { text: string; words: ReadonlySet<string> }[], window: number): { share: number; match: string | null } {
  let best = { share: 0, match: null as string | null };
  for (let i = 0; i < page.length; i += 1) {
    const run = new Set<string>();
    const texts: string[] = [];
    for (let k = 0; k < window && i + k < page.length; k += 1) {
      const s = page[i + k];
      if (s === undefined) break;
      for (const w of s.words) run.add(w);
      texts.push(s.text);
      const share = shareOf(words, run);
      if (share > best.share) best = { share, match: texts.join(" ") };
    }
  }
  return best;
}

/** Words as matched for naming: case, spacing, emphasis and curly quotes folded. */
function fold(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Does the writer's named line name this sentence? Same words, an opening of it, or most of its words. */
function names(named: string, sentence: string): boolean {
  if (claimKey(named) === claimKey(sentence)) return true;
  const a = fold(named).replace(/[.!?…"]+$/u, "");
  const b = fold(sentence).replace(/[.!?…"]+$/u, "");
  if (a.length >= CLAIM_PREFIX_MIN_CHARS && b.startsWith(a)) return true;
  if (b.length >= CLAIM_PREFIX_MIN_CHARS && a.startsWith(b)) return true;
  return shareOf(contentWords(sentence), contentWords(named)) >= L.NEAR_SHARE;
}

/** What the writer's account says of a line: its why's first word ("folded …", "reworded …"), else set down. */
export function accountOf(why: string): "folded" | "reworded" | "set down" {
  if (/^\s*fold/i.test(why)) return "folded";
  if (/^\s*re-?word/i.test(why)) return "reworded";
  return "set down";
}

/**
 * IS THE GONE SENTENCE STILL THERE, TRIMMED OR GROWN? One new sentence whose
 * content words (at least `CONTAIN_MIN`) all sit in it (a trim to a clause,
 * "not inside a mechanism" → "not in a mechanism"), or one that holds all of
 * its words. Pure.
 */
export function contained(words: ReadonlySet<string>, page: readonly { text: string; words: ReadonlySet<string> }[]): string | null {
  for (const s of page) {
    if (s.words.size >= L.CONTAIN_MIN && shareOf(s.words, words) === 1) return s.text;
    if (words.size > 0 && shareOf(words, s.words) === 1) return s.text;
  }
  return null;
}

/**
 * A CLAUSE OF THE LINE STILL ON THE PAGE: the line split at ; : — ( ) and
 * ", " — any part of at least `CONTAIN_MIN` content words found whole-ish
 * (`CLAUSE_SHARE`) in one new sentence or two side by side, or holding one
 * (`contained`). The new sentence it was found in, or null. Pure.
 */
export function clauseKept(line: string, page: readonly { text: string; words: ReadonlySet<string> }[]): string | null {
  for (const part of line.split(/[;:—()]|,\s/u)) {
    const words = contentWords(part);
    if (words.size < L.CONTAIN_MIN) continue;
    const near = bestRun(words, page, L.NEAR_WINDOW);
    if (near.share >= L.CLAUSE_SHARE) return near.match;
    const inside = contained(words, page);
    if (inside !== null) return inside;
  }
  return null;
}

/**
 * THE DIFF: every sentence of `before` not on `after` word for word, sorted
 * (see the header). `named` is the writer's account. Sentences with no
 * content word are passed by. Pure and deterministic.
 *
 * Accounted for by the writer: trusted, never re-judged — "folded …" and
 * "reworded …" are kept (logged), anything else is set down as named. Not
 * accounted for: still there trimmed or grown (`contained`), or reworded past
 * `NEAR_SHARE`: kept. Otherwise set down, unnamed — `unnamed` (quoted by the
 * wake) only when clearly gone, at most `GONE_SHARE` of its words anywhere in a
 * run of `FOLD_WINDOW` new sentences; else `unsure` (a quiet memory, never
 * quoted). Word share alone cannot tell a fold from a drop (measured on the
 * owner's page history, review of #789), so the engine only decides the plain
 * cases and the writer's account carries the rest.
 */
export function diffSetDowns(before: string, after: string, named: readonly SetDownNamed[] = []): SetDownDiff {
  const now = pageSentences(after).map((s) => ({ ...s, words: contentWords(s.text) }));
  const nowKeys = new Set(now.map((s) => claimKey(s.text)));
  const nowWords = new Set(now.flatMap((s) => [...s.words]));
  const was = pageSentences(before);
  // How many of the old page's sentences carry each word.
  const oldFreq = new Map<string, number>();
  for (const s of was) for (const w of contentWords(s.text)) oldFreq.set(w, (oldFreq.get(w) ?? 0) + 1);
  // The roots (first letters) of the words in new sentences this write changed (not word for word on the old page).
  const oldKeys = new Set(was.map((s) => claimKey(s.text)));
  const changedRoots = new Set(
    now.filter((s) => !oldKeys.has(claimKey(s.text))).flatMap((s) => [...s.words].filter((w) => w.length > L.ANCHOR_MIN).map((w) => w.slice(0, L.ANCHOR_MIN + 1))),
  );
  const seen = new Set<string>();
  const used = new Set<number>();
  const verdicts: SetDownVerdict[] = [];
  for (const s of was) {
    const key = claimKey(s.text);
    if (nowKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    const words = contentWords(s.text);
    if (words.size === 0) continue;
    const near = bestRun(words, now, L.NEAR_WINDOW);
    const at = named.findIndex((n, i) => !used.has(i) && names(n.line, s.text));
    const n = at < 0 ? undefined : named[at];
    const base = { line: s.text, section: s.section };
    if (n !== undefined) {
      used.add(at);
      const why = n.why.replace(/\s+/g, " ").trim();
      const account = accountOf(why);
      verdicts.push({
        ...base,
        outcome: account === "folded" ? "folded" : account === "reworded" ? "reworded" : "named",
        why: why.length === 0 ? "named, no why given" : why,
        share: near.share,
        match: near.match,
        accounted: true,
        ...(account === "set down" && n.skill !== undefined ? { skill: n.skill } : {}),
      });
      continue;
    }
    const inside = contained(words, now);
    if (inside !== null) {
      verdicts.push({ ...base, outcome: "reworded", why: "still on the page, trimmed or grown", share: near.share, match: inside, accounted: false });
      continue;
    }
    if (near.share >= L.NEAR_SHARE) {
      verdicts.push({ ...base, outcome: "reworded", why: "reworded", share: near.share, match: near.match, accounted: false });
      continue;
    }
    const wide = bestRun(words, now, L.FOLD_WINDOW);
    // A CLAUSE STILL THERE ("Never skip the glaze test; the kiln log proves
    // it" → "…never skip the test"): the line is not clearly gone, whatever its share.
    const clause = clauseKept(s.text, now);
    // AN ANCHOR STILL THERE: a word this line alone carried on the old page
    // (a name, "zqkiln") found anywhere on the new one says its point may
    // live on, reworded or folded: not clearly gone.
    const anchored = [...words].some((w) => w.length >= L.ANCHOR_MIN && (oldFreq.get(w) ?? 0) === 1 && nowWords.has(w));
    // A ROOT IN A REWRITTEN SENTENCE: one of its words' first `ANCHOR_MIN`+1
    // letters in a new sentence this write changed ("Glazes over guesses."
    // beside "Glaze a test tile first, with a control…"): it may have been
    // merged in. Not clearly gone.
    const rooted = [...words].some((w) => w.length > L.ANCHOR_MIN && changedRoots.has(w.slice(0, L.ANCHOR_MIN + 1)));
    verdicts.push(
      wide.share <= L.GONE_SHARE && clause === null && !anchored && !rooted
        ? { ...base, outcome: "unnamed", why: UNNAMED_WHY, share: wide.share, match: wide.match, accounted: false }
        : { ...base, outcome: "unsure", why: UNSURE_WHY, share: wide.share, match: wide.match, accounted: false },
    );
  }
  return { verdicts, unmatchedNamed: named.filter((_, i) => !used.has(i)) };
}

/** True when a verdict is a set-down (a memory is made of it). */
export function isSetDown(v: SetDownVerdict): boolean {
  return v.outcome === "named" || v.outcome === "unnamed" || v.outcome === "unsure";
}

/** True when the wake may quote it: named by the writer, or clearly gone. */
export function isQuoted(v: Pick<SetDownVerdict, "outcome">): boolean {
  return v.outcome === "named" || v.outcome === "unnamed";
}


/** A page read once for many `lineOnPage` questions. */
export interface PreparedPage {
  readonly keys: ReadonlySet<string>;
  readonly sentences: readonly { text: string; words: ReadonlySet<string> }[];
}

/** The page's sentences, keys and words, read once. Pure. */
export function preparePage(page: string): PreparedPage {
  const sentences = pageSentences(page).map((s) => ({ text: s.text, words: contentWords(s.text) }));
  return { keys: new Set(sentences.map((s) => claimKey(s.text))), sentences };
}

/** Is `line` on `page` — word for word, or reworded past `NEAR_SHARE`? Pure. */
export function lineOnPage(line: string, page: string | PreparedPage): boolean {
  const p = typeof page === "string" ? preparePage(page) : page;
  if (p.keys.has(claimKey(line))) return true;
  const words = contentWords(line);
  return words.size > 0 && bestRun(words, p.sentences, L.NEAR_WINDOW).share >= L.NEAR_SHARE;
}

/** "Set down from my page MM-DD: <line>", the line cut at a word past `TITLE_CHARS`. Pure. */
export function setDownTitle(line: string, date: string): string {
  const flat = line.replace(/\s+/g, " ").trim();
  let shown = flat;
  if (flat.length > L.TITLE_CHARS) {
    const cut = flat.slice(0, L.TITLE_CHARS);
    const space = cut.lastIndexOf(" ");
    shown = `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:—-]+$/u, "")}…`;
  }
  return `Set down from my page ${monthDay(date)}: ${shown}`;
}

/** The memory's words: the line whole, then where it left and why. Pure. */
export function setDownBody(f: Pick<SetDownFacts, "line" | "why" | "from" | "by" | "date" | "section" | "skill">): string {
  const who = f.by === "writer" ? "day's end" : "the reflection";
  const where = f.section.length === 0 ? "" : ` (under "${f.section}")`;
  const moved = f.skill === undefined ? "" : ` Moved to a skill memory: ${f.skill}.`;
  return `${f.line}\n\nSet down from my self page${where} on ${f.date}, when ${who} rewrote it (the line was on version ${String(f.from)}). Why: ${f.why}.${moved}`;
}

// ── the store's side ────────────────────────────────────────────────────────

/** A row's set-down facts, or null when it is not one. */
export function setDownFactsOf(meta: Readonly<Record<string, unknown>>): SetDownFacts | null {
  const v = meta[SET_DOWN_META];
  if (v === null || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  if (typeof f["line"] !== "string" || typeof f["why"] !== "string") return null;
  const by = f["by"] === "writer" || f["by"] === "reflection" ? f["by"] : "reflection";
  return {
    line: f["line"],
    why: f["why"],
    named: f["named"] === true,
    section: typeof f["section"] === "string" ? f["section"] : "",
    from: typeof f["from"] === "number" ? f["from"] : -1,
    to: typeof f["to"] === "number" ? f["to"] : -1,
    by,
    date: typeof f["date"] === "string" ? f["date"] : "",
    ...(Array.isArray(f["restedOn"]) ? { restedOn: (f["restedOn"] as unknown[]).filter((x): x is string => typeof x === "string") } : {}),
    ...(typeof f["pos"] === "number" ? { pos: f["pos"] } : {}),
    ...(f["quiet"] === true ? { quiet: true } : {}),
    ...(Array.isArray(f["lines"]) ? { lines: (f["lines"] as unknown[]).filter((x): x is string => typeof x === "string") } : {}),
    ...(typeof f["skill"] === "string" ? { skill: f["skill"] } : {}),
  };
}

/** `text` cut to at most `max` characters at a word, with "…". Pure. */
export function clipWords(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:—-]+$/u, "")}…`;
}

/**
 * THE LIVE SET-DOWNS, newest first, at most `limit` (`SCAN` by default):
 * tagged `set down` and carrying the facts. Never throws.
 */
export function readSetDowns(store: Store, limit: number = L.SCAN): SetDownRow[] {
  const out: SetDownRow[] = [];
  let ids: string[];
  try {
    // The tag is the index; a store without the tag table finds them by their facts.
    ids = store.memoriesTagged(SET_DOWN_TAG);
    if (ids.length === 0) ids = store.idsWithMetaKey(SET_DOWN_META);
  } catch {
    return [];
  }
  for (const id of ids) {
    try {
      const r = store.row(id);
      if (r === undefined || r.archived !== 0 || r.superseded_by !== null) continue;
      const f = setDownFactsOf(store.readProse(id).meta);
      if (f === null) continue;
      out.push({ ...f, id, createdAt: r.created_at ?? 0, birthDay: r.birth_day, uses: r.uses, lastUsedDay: r.last_used_day });
    } catch {
      /* one unreadable row is not the list */
    }
  }
  // Newest first: by write (its moment, then the version it wrote), then the page's order reversed.
  out.sort((a, b) => b.createdAt - a.createdAt || b.to - a.to || (b.pos ?? 0) - (a.pos ?? 0) || (a.id < b.id ? 1 : -1));
  return out.slice(0, limit);
}

/**
 * THE SET-DOWNS OF ONE NIGHT, by its calendar date (both doors of a night
 * write under it), oldest first: the order the page had them. Never throws.
 */
export function nightSetDowns(store: Store, date: string): SetDownRow[] {
  return readSetDowns(store)
    .filter((r) => r.date === date)
    .reverse();
}

/** What `recordSetDowns` did, for the door's answer and the event. */
export interface SetDownRecord {
  /** Memories made, one per line set down. */
  readonly ids: readonly string[];
  readonly named: number;
  /** Not accounted for and clearly gone (quoted by the wake). */
  readonly unnamed: number;
  /** Not accounted for and maybe only reworded (a quiet memory). */
  readonly unsure: number;
  readonly reworded: number;
  readonly folded: number;
  /** Set down past `MAX_PER_WRITE`: kept together in one memory, every line in full. */
  readonly over: number;
  /** Named lines that matched no sentence gone. */
  readonly unmatchedNamed: number;
  /** Set-downs this write put back on the page. */
  readonly back: readonly string[];
  /** PS1: skill memories made from practices the writer moved off the page. */
  readonly skills: readonly string[];
}

/**
 * RECORD A NIGHTLY WRITE'S SET-DOWNS: the diff of `before` and `after`, a
 * memory per line set down (at most `MAX_PER_WRITE`), the set-downs this write
 * brought back (an event each; nothing is changed on them), and one event with
 * the counts. Throws only what the store throws; the caller keeps the page
 * written either way.
 */
export function recordSetDowns(
  store: Store,
  input: {
    readonly before: { readonly body: string; readonly version: number; readonly trace: StoredTrace | null };
    readonly after: string;
    readonly version: number;
    readonly named: readonly SetDownNamed[];
    readonly by: SelfPageAuthor;
    readonly session: string | null;
    readonly date: string;
    readonly day: number;
    readonly pageId: string;
    readonly model?: string;
    /** The starting claim of a memory about me (`physics.defaultClaimFor`), from the caller. */
    readonly claim: number;
  },
): SetDownRecord {
  const diff = diffSetDowns(input.before.body, input.after, input.named);
  const down = diff.verdicts.filter(isSetDown);
  const kept = down.slice(0, L.MAX_PER_WRITE);
  const rest = down.slice(L.MAX_PER_WRITE);
  const restedOf = (line: string): string[] => {
    const claims = input.before.trace?.claims ?? null;
    if (claims === null) return [];
    const key = claimKey(line);
    return [...(claims.find((c) => c.of === key)?.cites ?? [])];
  };
  // The why is the writer's own words, never through the page's gate: through
  // the secrets scan, as a chapter title is, and cut to `WHY_CHARS`. The line was on the page.
  const whyOf = (v: SetDownVerdict): string => {
    if (v.outcome !== "named") return v.why;
    const scanned = scanSecrets(v.why, "title");
    return scanned.emptyAfterRedaction ? UNNAMED_WHY : clipWords(scanned.redacted, L.WHY_CHARS);
  };
  const put = (facts: SetDownFacts, title: string, body: string): string =>
    store.put({
      type: "memory",
      kind: "self",
      title,
      body,
      meta: { [SET_DOWN_META]: facts },
      about: "me",
      aboutBy: input.by === "writer" ? "writer" : "reflection",
      // The night's words, not a lived act: the night's own reads pass it by.
      source: "reflection",
      origin: { ...(input.session === null ? {} : { session: input.session }), ref: input.pageId },
      salience: { claimed: input.claim },
      physics: { birthDay: input.day, lastUsedDay: input.day },
      tags: [SET_DOWN_TAG],
      tagsVia: "write",
      ...(input.model === undefined ? {} : { model: input.model }),
    });
  // CRAFT MOVED TO A SKILL (PS1, `stories.ts#pageCraftRule`): the writer's
  // words for the practice, through the secrets scan, as a `kind: skill`
  // memory, unmarked (an unmarked skill is craft and reaches every folder),
  // which recall finds when the work calls for it. Null when there are no
  // words left to keep.
  const skills: string[] = [];
  const skillOf = (v: SetDownVerdict): string | null => {
    if (v.outcome !== "named" || v.skill === undefined) return null;
    const scanned = scanSecrets(v.skill, "body");
    if (scanned.emptyAfterRedaction) return null;
    const words = clipWords(scanned.redacted, STORY.SKILL_CHARS);
    const id = store.put({
      type: "memory",
      kind: "skill",
      title: clipWords(words, L.TITLE_CHARS),
      body: words,
      // The night's words, as a set-down's are: the night's own reads pass it by.
      source: "reflection",
      origin: { ...(input.session === null ? {} : { session: input.session }), ref: input.pageId },
      physics: { birthDay: input.day, lastUsedDay: input.day },
      ...(input.model === undefined ? {} : { model: input.model }),
    });
    skills.push(id);
    return id;
  };
  const ids: string[] = [];
  for (const [pos, v] of kept.entries()) {
    const restedOn = restedOf(v.line);
    const skill = skillOf(v);
    const facts: SetDownFacts = {
      line: v.line,
      why: whyOf(v),
      named: v.outcome === "named",
      section: v.section,
      from: input.before.version,
      to: input.version,
      by: input.by,
      date: input.date,
      ...(restedOn.length === 0 ? {} : { restedOn }),
      pos,
      ...(isQuoted(v) ? {} : { quiet: true }),
      ...(skill === null ? {} : { skill }),
    };
    ids.push(put(facts, setDownTitle(v.line, input.date), setDownBody(facts)));
  }
  // PAST THE CAP, NEVER SILENT (review of #789): the rest in ONE memory, every line in full.
  if (rest.length > 0) {
    const facts: SetDownFacts = {
      line: `${String(rest.length)} more lines`,
      why: "past one write's cap; each line and its why are in the body",
      named: false,
      section: "",
      from: input.before.version,
      to: input.version,
      by: input.by,
      date: input.date,
      pos: kept.length,
      quiet: true,
      lines: rest.map((v) => v.line),
    };
    const body = [
      `Set down from my self page on ${input.date}, past one write's cap (the lines were on version ${String(input.before.version)}):`,
      "",
      ...rest.map((v) => `- ${v.line} (${whyOf(v)})`),
    ].join("\n");
    ids.push(put(facts, `Set down from my page ${monthDay(input.date)}: ${String(rest.length)} more lines`, body));
  }
  // BROUGHT BACK: a set-down whose line this write put back (not on the page
  // before, on it now). Said by event; the memory stays as it was.
  const back: string[] = [];
  if (input.after !== input.before.body) {
    const was = preparePage(input.before.body);
    const now = preparePage(input.after);
    for (const r of readSetDowns(store)) {
      if (ids.includes(r.id) || r.lines !== undefined) continue;
      if (lineOnPage(r.line, now) && !lineOnPage(r.line, was)) {
        back.push(r.id);
        store.appendEvent({ name: SET_DOWN_BACK_EVENT, day: input.day, ref: r.id, payload: { by: input.by, session: input.session, version: input.version } });
      }
    }
  }
  const count = (o: SetDownVerdict["outcome"], accounted?: boolean): number =>
    diff.verdicts.filter((v) => v.outcome === o && (accounted === undefined || v.accounted === accounted)).length;
  const record: SetDownRecord = {
    ids,
    named: count("named"),
    unnamed: count("unnamed"),
    unsure: count("unsure"),
    reworded: count("reworded"),
    folded: count("folded"),
    over: rest.length,
    unmatchedNamed: diff.unmatchedNamed.length,
    back,
    skills,
  };
  if (diff.verdicts.length > 0 || input.named.length > 0 || back.length > 0) {
    // Counts and ids for what was set down: those lines are on the memories,
    // never in the log. What the writer KEPT by its own word (folded,
    // reworded) has no memory, so its claims ride here, line and why, at most
    // `AUDIT_MAX` (the rest counted): an audit reads what was claimed without
    // re-running the diff. The page it came from is a version already.
    const claimed = diff.verdicts.filter((v) => v.accounted && (v.outcome === "folded" || v.outcome === "reworded"));
    store.appendEvent({
      name: SET_DOWN_EVENT,
      day: input.day,
      ref: input.pageId,
      payload: {
        by: input.by,
        session: input.session,
        from: input.before.version,
        to: input.version,
        ids,
        named: record.named,
        unnamed: record.unnamed,
        unsure: record.unsure,
        reworded: record.reworded,
        folded: record.folded,
        // The writer's "folded" and "reworded" are trusted, not checked: counted apart, for audit.
        writerFolded: count("folded", true),
        writerReworded: count("reworded", true),
        engineReworded: count("reworded", false),
        writerClaims: claimed.slice(0, L.AUDIT_MAX).map((v) => ({ line: v.line, as: v.outcome, why: clipWords(scanSecrets(v.why, "title").redacted, L.WHY_CHARS) })),
        ...(claimed.length > L.AUDIT_MAX ? { writerClaimsMore: claimed.length - L.AUDIT_MAX } : {}),
        over: record.over,
        sentNamed: input.named.length,
        unmatchedNamed: record.unmatchedNamed,
        back,
        ...(skills.length === 0 ? {} : { skills }),
      },
    });
  }
  return record;
}

/** A set-down life touched since, and how. */
export interface SetDownTouched extends SetDownRow {
  readonly touched: "used" | "restated";
  /** On `restated`: the newer memory that says it again. */
  readonly by_memory?: string;
}

/**
 * THE WAY BACK: live set-downs that life touched since they were set down —
 * used (recalled and credited, drawn on, cited: `uses`, a later
 * `last_used_day`), or restated by a newer memory (most of the line's words in
 * one newer memory, `NEAR_SHARE`) — and not on the page now. `lane` keeps
 * them to the lane that can bring them back (`Core` for the reflection, the
 * rest for day's end; null: all). Newest first, at most `BACK_SHOWN`. Never
 * throws.
 */
export function setDownsTouched(store: Store, opts: { page: string | null; lane: "core" | "rest" | null; core: string }): SetDownTouched[] {
  try {
    const page = opts.page === null ? null : preparePage(opts.page);
    const all = readSetDowns(store).filter((r) => {
      if (r.lines !== undefined) return false;
      const isCore = r.section.toLowerCase() === opts.core.toLowerCase();
      if (opts.lane === "core" && !isCore) return false;
      if (opts.lane === "rest" && isCore) return false;
      return page === null || !lineOnPage(r.line, page);
    });
    if (all.length === 0) return [];
    const out: SetDownTouched[] = [];
    const untouched: SetDownRow[] = [];
    for (const r of all) {
      if (r.uses > 0 || r.lastUsedDay > r.birthDay) out.push({ ...r, touched: "used" });
      else untouched.push(r);
    }
    if (untouched.length > 0) {
      const oldest = untouched.reduce((m, r) => (r.createdAt < m.createdAt ? r : m));
      const newer = store
        .newMemoryIds({ sinceAt: oldest.createdAt, sinceDay: oldest.birthDay, limit: L.RESTATED_READ })
        .flatMap((id) => {
          const row = store.row(id);
          if (row === undefined || row.type !== "memory") return [];
          try {
            const p = store.readProse(id);
            if (setDownFactsOf(p.meta) !== null) return [];
            return [{ id, at: row.created_at ?? 0, words: contentWords(`${p.title ?? ""} ${p.body}`) }];
          } catch {
            return [];
          }
        });
      for (const r of untouched) {
        const words = contentWords(r.line);
        const hit = newer.find((m) => m.at > r.createdAt && shareOf(words, m.words) >= L.NEAR_SHARE);
        if (hit !== undefined) out.push({ ...r, touched: "restated", by_memory: hit.id });
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, L.BACK_SHOWN);
  } catch {
    return [];
  }
}

/**
 * THE WAY BACK, AS THE NIGHT'S WRITER READS IT: a short block, or null when
 * nothing was touched. `flat` makes a quoted line one line (the caller's
 * marker-stripping flattener).
 */
export function setDownsBackLines(touched: readonly SetDownTouched[], flat: (s: string) => string): string[] | null {
  if (touched.length === 0) return null;
  return [
    `Lines your page set down that life has touched since (used, or said again in a newer memory). You may bring one back if it holds again, in your own words or as it was; nothing comes back unless you write it:`,
    ...touched.map(
      (t) =>
        `- ${t.id} · set down ${t.date} (${flat(t.why)}); ${t.touched === "used" ? "used since" : `said again in ${t.by_memory ?? "a newer memory"}`}${
          t.restedOn === undefined || t.restedOn.length === 0 ? "" : `; it rested on ${t.restedOn.join(", ")} (cite those, or the newer memory, if it goes back)`
        }: "${flat(t.line)}"`,
    ),
  ];
}

/** What a door says back about a write's set-downs, one or two sentences; null when there is nothing to say. Pure. */
export function setDownNote(r: SetDownRecord | undefined): string | null {
  if (r === undefined) return null;
  const parts: string[] = [];
  const set = r.named + r.unnamed + r.unsure;
  if (set > 0) {
    const not = r.unnamed + r.unsure;
    const how = [r.named > 0 ? `${String(r.named)} as you named ${r.named === 1 ? "it" : "them"}` : "", not > 0 ? `${String(not)} you didn't account for, recorded as set down unnamed` : ""].filter((s) => s.length > 0).join(", ");
    parts.push(`Set down ${String(set)} ${set === 1 ? "line" : "lines"} (${how}), kept as memories${r.over > 0 ? ` (${String(r.over)} past the cap in one)` : ""}: recall "${SET_DOWN_HANDLE}".`);
  }
  if (r.folded + r.reworded > 0) parts.push(`${String(r.folded + r.reworded)} gone word for word ${r.folded + r.reworded === 1 ? "was" : "were"} folded or reworded, and not set down.`);
  if (r.unmatchedNamed > 0) parts.push(`${String(r.unmatchedNamed)} named in setDown ${r.unmatchedNamed === 1 ? "is" : "are"} still on the page or never were, and nothing was recorded for ${r.unmatchedNamed === 1 ? "it" : "them"}.`);
  if (r.back.length > 0) parts.push(`Brought back: ${r.back.join(", ")}.`);
  if (r.skills.length > 0) parts.push(`Moved to ${r.skills.length === 1 ? "a skill memory" : "skill memories"}: ${r.skills.join(", ")}.`);
  return parts.length === 0 ? null : parts.join(" ");
}

/** The why words a writer is told to use (and the field's shape), the same at both doors. */
export const SET_DOWN_RULE =
  'With the page, pass `setDown`: account for EVERY sentence of the page as it stood that you removed or changed, word for word as it was, each with a short why that says which: "reworded" (its point is still on the page in other words), "folded into <the line that carries it now>", or set down — "retired by <the newer ruling>", "no longer lived", or "room". Your account is trusted as given. A sentence you leave out of it and that is gone is recorded anyway, as set down unnamed; every set-down line is kept as a memory, so taking one out loses nothing.';
