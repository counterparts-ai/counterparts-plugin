/**
 * `fit/` — fitting what a mechanism has into the room it has (2026-09-28).
 * CONTRACT.md states the principle; this file is the arithmetic. Working
 * defaults, held lightly.
 *
 * The shape: a mechanism hands N candidates, each with a PRIORITY it computed
 * itself (the dream ranks by replay priority, the reflection by feeling), a
 * one-line form and a whole form, and a ROOM in characters. It gets back, in
 * priority order, what each candidate is shown as — its whole text, an
 * excerpt, its line, or only its id — with the whole length beside every one,
 * and the ids that did not fit at all, which WAIT. Breadth first: every
 * candidate gets its id, then its line, before any gets its whole text; then
 * the whole texts go to the most important, filling past a misfit (a smaller
 * one later may still fit). Nothing is cut without its length being said.
 *
 * Three small readers ride along, because every mechanism needs them the same
 * way: `lineOf` (what a memory is called, in one line), `derivedFrom` (what a
 * row was made from), and `packParts` (a result too long for one tool answer,
 * in parts). And the LOOKUP LEDGER: each fit's index — which ids were offered
 * as lines, which whole — kept in one meta row per mechanism, so the recall
 * tool can count how often a receiver fetched what an index offered
 * (`noteLookups`). That count is the check against "just truncated again".
 *
 * Arithmetic and bookkeeping only; nothing here calls a model.
 */
import type { Store } from "../store/index.js";

/** How a candidate was shown. */
export type Fidelity = "whole" | "excerpt" | "line" | "id";

export const FIT_TUNABLES = {
  /** Bytes of a line (`lineOf`'s default). */
  LINE_BYTES: 160,
  /** A placed item's fixed cost beside its words: the id, the numbers, the keys. CAL. */
  OVERHEAD: 120,
  /** A fitted index counts lookups for this long after it was made (a night's run takes minutes). */
  LOOKUP_WINDOW_MS: 12 * 60 * 60 * 1000,
  /**
   * …and only while its run is open: the dream not yet journaled, the
   * reflection not yet finished — or finished less than this long ago (a
   * receiver's last lookups may land just after). Past it, a lookup of the
   * same id is an ordinary session's, not the index's. CAL.
   */
  LOOKUP_GRACE_MS: 10 * 60 * 1000,
  /** The meta prefix of each mechanism's latest index (one row per mechanism, overwritten). */
  INDEX_PREFIX: "fit.index.",
} as const;

export interface FitCandidate {
  readonly id: string;
  /** Higher first. The caller's own ranking; the fitter computes none. */
  readonly priority: number;
  /** The one line (`lineOf`). */
  readonly line: string;
  /** The whole text. */
  readonly whole: string;
}

export interface Placed {
  readonly id: string;
  readonly fidelity: Fidelity;
  /** What is shown: the whole text, an excerpt (ending "…"), the line, or "" (id only). */
  readonly text: string;
  /** The whole text's length in characters — "there is more" as a number. */
  readonly chars: number;
}

/**
 * WHAT DIDN'T FIT, in one shape for every mechanism (the audit's
 * `{shown, lined, waiting, agedOut}`): `whole + excerpt + lined + ids` were
 * shown; `waiting` were not, and carry over; `agedOut` is the caller's count of
 * what left its queue by age since the last fit (the fitter has no queue).
 */
export interface FitReport {
  readonly candidates: number;
  readonly whole: number;
  readonly excerpt: number;
  readonly lined: number;
  readonly ids: number;
  readonly waiting: number;
  readonly agedOut: number;
}

export interface FitOptions {
  /** The room, in characters of shown text plus `overhead` per item. */
  readonly room: number;
  /** Longest detail one item may take; longer is an excerpt with its length said. */
  readonly excerptChars: number;
  /** Per-item fixed cost. Default `FIT_TUNABLES.OVERHEAD`. */
  readonly overhead?: number;
  /**
   * The least a shown item may be: `id` (default) or `line`. With `line`, a
   * candidate that cannot have its line WAITS rather than being shown as a
   * bare id — for a queue, where being shown means leaving it.
   */
  readonly least?: "id" | "line";
  /** The caller's aged-out count, carried into the report. */
  readonly agedOut?: number;
}

export interface FitOutcome {
  /** Shown, in priority order. */
  readonly placed: readonly Placed[];
  /** Not shown, in priority order: they wait. */
  readonly waiting: readonly string[];
  readonly report: FitReport;
  /** Characters of the room used. */
  readonly used: number;
}

/**
 * FIT N CANDIDATES INTO A ROOM. Ids for all (in priority order, as far as the
 * room goes — the rest wait), then lines, then whole texts, each pass in
 * priority order and filling past a misfit. A whole text longer than
 * `excerptChars` is shown as an excerpt of that length; a line that already
 * holds the whole text counts as whole.
 */
export function fit(candidates: readonly FitCandidate[], opts: FitOptions): FitOutcome {
  const over = opts.overhead ?? FIT_TUNABLES.OVERHEAD;
  const least = opts.least ?? "id";
  const order = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.priority - a.c.priority || a.i - b.i)
    .map((x) => x.c);
  const level = new Map<string, Fidelity>();
  const waiting: string[] = [];
  let used = 0;
  const lineOf = (c: FitCandidate): string => (c.whole.length <= c.line.length ? c.whole : c.line);
  const detail = (c: FitCandidate): { text: string; fidelity: Fidelity } =>
    wireChars(c.whole) <= opts.excerptChars ? { text: c.whole, fidelity: "whole" } : { text: clipWire(c.whole, opts.excerptChars), fidelity: "excerpt" };

  // 1. The least each may be, in priority order. What does not fit waits. (An
  //    id costs the same for all; a line by its length, so a shorter one
  //    later may still fit.)
  for (const c of order) {
    const cost = least === "line" ? over + wireChars(lineOf(c)) : over;
    if (used + cost > opts.room) {
      waiting.push(c.id);
      continue;
    }
    used += cost;
    level.set(c.id, least === "line" ? (lineOf(c) === c.whole ? "whole" : "line") : "id");
  }
  // 2. Lines, breadth first.
  if (least === "id") {
    for (const c of order) {
      if (level.get(c.id) !== "id") continue;
      const add = wireChars(lineOf(c));
      if (used + add > opts.room) continue;
      used += add;
      level.set(c.id, lineOf(c) === c.whole ? "whole" : "line");
    }
  }
  // 3. Whole texts (or excerpts), most important first.
  for (const c of order) {
    if (level.get(c.id) !== "line") continue;
    const d = detail(c);
    const add = wireChars(d.text) - wireChars(lineOf(c));
    if (add <= 0 || used + add > opts.room) continue;
    used += add;
    level.set(c.id, d.fidelity);
  }
  const placed: Placed[] = [];
  const counts = { whole: 0, excerpt: 0, line: 0, id: 0 };
  for (const c of order) {
    const f = level.get(c.id);
    if (f === undefined) continue;
    counts[f] += 1;
    const text = f === "id" ? "" : f === "line" ? lineOf(c) : f === "whole" ? c.whole : detail(c).text;
    placed.push({ id: c.id, fidelity: f, text, chars: c.whole.length });
  }
  return {
    placed,
    waiting,
    used,
    report: {
      candidates: candidates.length,
      whole: counts.whole,
      excerpt: counts.excerpt,
      lined: counts.line,
      ids: counts.id,
      waiting: waiting.length,
      agedOut: opts.agedOut ?? 0,
    },
  };
}

// ── the room one tool result has ────────────────────────────────────────────

/**
 * THE CEILING ON ONE TOOL RESULT (2026-10-02), the one number every tool
 * result's cap derives from — the dream's and the reflection's parts, the
 * nightly writer's day, and the MCP server's last-resort cut.
 *
 * MEASURED, not guessed: the night of 2026-10-02 (and of 10-01) Claude Code
 * handed the model a 2 KB preview of every result over the line and saved the
 * rest to a file the headless run cannot open, so the dream saw a third of
 * its bundle. Read from Claude Code 2.1.287 itself, there are three lines:
 *
 *   - `HOST_CHARS`: a result whose text runs past 50,000 characters (the
 *     host's global persist threshold, under the MCP tool's own 100,000) is
 *     saved to a file — "Output too large (51.5KB)". The text it measures is
 *     `structuredContent` serialized compact, when a result carries one.
 *   - `HOST_TOKENS`: an MCP result past 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`)
 *     is saved the same way — "result (51,306 characters) exceeds maximum
 *     allowed tokens". It is counted for real only when the estimate
 *     (length / 4) passes 12,500, that is past 50,000 characters, so under
 *     the char line it never applies.
 *   - `HOST_MESSAGE_CHARS`: 200,000 characters across one assistant turn's
 *     results together (parts 2 and 3 fetched in parallel are one turn).
 *
 * `CHARS` is the room: 20% under the char line, so a result measured by
 * `wireChars` (a non-ASCII character as three) under it reaches the model
 * whole. RESIDUAL RISK: the host can lower either line by a remote flag
 * (`tengu_velvet_ibis`); the nightly run pins the token line with the env var
 * (`night-run.ts`), and nothing pins the char line. What it does instead
 * (2026-10-09): the nightly run reads its child's transcript for the host's
 * marker on our results (`claude-code/transcript.ts#readToolSpills`), so a
 * lowered line shows up in doctor and in the morning, not in nothing. CAL.
 *
 * Re-measured on Claude Code 2.1.296, 2026-10-10: 25,000 tokens and 50,000
 * characters, as here (a hook field's own cap and preview are
 * `adapters/config.ts#HOST_OUTPUT_CHARS` and `HOST_PREVIEW_CHARS`).
 */
export const TOOL_RESULT_CEILING = {
  HOST_CHARS: 50_000,
  HOST_TOKENS: 25_000,
  HOST_MESSAGE_CHARS: 200_000,
  CHARS: 40_000,
} as const;

// ── what a text costs on the wire ───────────────────────────────────────────

/**
 * A TEXT'S COST AGAINST A TOKEN CEILING, in ASCII-character equivalents
 * (2026-09-28, review of build B). The host's ceilings are in tokens, and
 * the budgets here are in characters sized at about three characters a token
 * — true of English, not of every script: a CJK character is about a token by
 * itself. So a character outside ASCII counts as three. Used for every room
 * and every part, so a page in another script is measured, not guessed.
 */
export function wireChars(text: string): number {
  let extra = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) > 0x7f) extra += 1;
  return text.length + 2 * extra;
}

/** `text` kept to a wire cost of `max` (`wireChars`), cut at a character with "…"; the text itself when it fits. */
export function clipWire(text: string, max: number): string {
  if (wireChars(text) <= max) return text;
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = ch.length === 1 && ch.charCodeAt(0) <= 0x7f ? 1 : 3 * ch.length;
    if (used + w > max - 3) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}

// ── a line ──────────────────────────────────────────────────────────────────

/** A chapter heading as `self/episodes.ts` writes it — a poor line for what the chapter says. */
const CHAPTER_HEADING = /^#{1,6}\s*chapter\s+\d+\b/i;

/**
 * WHAT A MEMORY IS CALLED, IN ONE LINE (audit #2): its title when it has one,
 * else its first substantive line — markdown markers and chapter headings
 * passed over — flattened, and kept to `bytes` UTF-8 bytes with "…" when cut.
 * Derived at read; nothing is stored.
 */
export function lineOf(src: { readonly title?: string | null; readonly body: string }, bytes: number = FIT_TUNABLES.LINE_BYTES): string {
  const title = (src.title ?? "").replace(/\s+/g, " ").trim();
  let line = title;
  if (line.length === 0) {
    for (const raw of src.body.split("\n")) {
      const t = raw.trim();
      if (t.length === 0 || CHAPTER_HEADING.test(t)) continue;
      const bare = t.replace(/^(?:#{1,6}|[-*>]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim();
      if (bare.length === 0 || /^[-=*_#>`~]+$/.test(bare)) continue;
      line = bare;
      break;
    }
  }
  return clipBytes(line, bytes);
}

/** `text` kept to `bytes` UTF-8 bytes, cut at a character with "…" (whose 3 bytes count). */
export function clipBytes(text: string, bytes: number): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= bytes) return text;
  let out = "";
  let size = 0;
  const room = Math.max(0, bytes - 3);
  for (const ch of text) {
    const n = enc.encode(ch).length;
    if (size + n > room) break;
    out += ch;
    size += n;
  }
  return `${out.trimEnd()}…`;
}

// ── where a row came from ───────────────────────────────────────────────────

/** How a row was made from another, by the meta key that says so. */
export type DerivedHow =
  | "merged-from"
  | "gist-of"
  | "cites"
  | "grounded-in"
  | "revised-from"
  | "updates"
  | "migrated-from"
  | "reminder-from"
  | "episode";

const DERIVED_KEYS: readonly (readonly [string, DerivedHow])[] = [
  ["mergedFrom", "merged-from"],
  ["sources", "gist-of"],
  ["cites", "cites"],
  ["groundedIn", "grounded-in"],
  ["revisedFrom", "revised-from"],
  ["updates", "updates"],
  ["migratedFrom", "migrated-from"],
  ["reminderFrom", "reminder-from"],
  ["episodeId", "episode"],
];

/**
 * WHAT A ROW WAS MADE FROM (audit #8), one reader for the nine meta keys that
 * say it: a merge's originals, a gist's sources, a reflection's cites, a
 * revision's target and grounds, an `updates:` mark, a migration's source, a
 * reminder's origin, a memory's episode. Ids only, in key order, each once per
 * way. A meta that will not parse reads as nothing.
 */
export function derivedFrom(row: { readonly meta: string | Record<string, unknown> }): { id: string; how: DerivedHow }[] {
  let meta: Record<string, unknown>;
  try {
    const v: unknown = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
    if (v === null || typeof v !== "object" || Array.isArray(v)) return [];
    meta = v as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: { id: string; how: DerivedHow }[] = [];
  const seen = new Set<string>();
  for (const [key, how] of DERIVED_KEYS) {
    const v = meta[key];
    const ids = typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    for (const id of ids) {
      if (id.length === 0 || seen.has(`${how}:${id}`)) continue;
      seen.add(`${how}:${id}`);
      out.push({ id, how });
    }
  }
  return out;
}

// ── parts ───────────────────────────────────────────────────────────────────

/**
 * A LIST TOO LONG FOR ONE RESULT, IN PARTS: the pieces in order, the first
 * part filled to `first`, each later part to `later`. A piece larger than a
 * part's room goes alone in its own part (the caller keeps pieces smaller than
 * that). One part when everything fits.
 */
export function packParts<T extends { readonly size: number }>(pieces: readonly T[], first: number, later: number): T[][] {
  const parts: T[][] = [[]];
  let room = first;
  let used = 0;
  for (const p of pieces) {
    const current = parts[parts.length - 1] as T[];
    if (used + p.size > room && (current.length > 0 || parts.length === 1)) {
      parts.push([p]);
      room = later;
      used = p.size;
      continue;
    }
    current.push(p);
    used += p.size;
  }
  return parts;
}

// ── the lookup ledger ───────────────────────────────────────────────────────

/** The mechanisms that hand an index and name the lookup (2026-09-28). */
export const FIT_MECHANISMS = ["dream", "reflection"] as const;
export type FitMechanism = (typeof FIT_MECHANISMS)[number];

/**
 * A mechanism's latest index: which ids it offered, at which fidelity, for
 * which run (`ref`), when; the parts it was delivered in (keys the mechanism
 * reads back); and which offered ids a lookup has since fetched whole.
 */
export interface FitIndex {
  readonly ref: string;
  readonly at: number;
  readonly offered: { readonly whole: readonly string[]; readonly excerpt: readonly string[]; readonly line: readonly string[]; readonly id: readonly string[] };
  readonly parts?: readonly (readonly string[])[];
  readonly looked?: readonly string[];
  /**
   * How far into each episode this run read (entries, by count) — so the next
   * run sends only what was added since. The mechanism's own bookkeeping.
   */
  readonly entries?: Readonly<Record<string, number>>;
  /** Offered ids a lookup has reached at all (counted once each). */
  readonly counted?: readonly string[];
  /** Entries below that count this run did not take — the next run sends them. */
  readonly unread?: Readonly<Record<string, readonly number[]>>;
  /**
   * The run's NEW items, by id (the dream's fresh list; Lane 0, 2026-10-10):
   * what goes back in the queue when the part that carried them never reached
   * the reader (`Dreams#requeueSpilled`).
   */
  readonly fresh?: readonly string[];
}

export function indexKey(mechanism: FitMechanism): string {
  return `${FIT_TUNABLES.INDEX_PREFIX}${mechanism}`;
}

/** Write a mechanism's index (one meta row, overwritten). Never throws: the ledger is evidence, never a reason to fail. */
export function writeIndex(store: Pick<Store, "setMeta">, mechanism: FitMechanism, index: FitIndex): void {
  try {
    store.setMeta(indexKey(mechanism), JSON.stringify(index));
  } catch {
    /* evidence only */
  }
}

/** A mechanism's latest index, or null when none (or it will not read). */
export function readIndex(store: Pick<Store, "getMeta">, mechanism: FitMechanism): FitIndex | null {
  try {
    const raw = store.getMeta(indexKey(mechanism));
    if (raw === undefined) return null;
    const v = JSON.parse(raw) as Partial<FitIndex>;
    if (typeof v.ref !== "string" || typeof v.at !== "number" || v.offered === undefined) return null;
    const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);
    const o = v.offered as Record<string, unknown>;
    return {
      ref: v.ref,
      at: v.at,
      offered: { whole: ids(o["whole"]), excerpt: ids(o["excerpt"]), line: ids(o["line"]), id: ids(o["id"]) },
      ...(Array.isArray(v.parts) ? { parts: v.parts.map(ids) } : {}),
      looked: ids(v.looked),
      counted: ids(v.counted),
      ...(Array.isArray(v.fresh) ? { fresh: ids(v.fresh) } : {}),
      ...(v.entries !== undefined && v.entries !== null && typeof v.entries === "object"
        ? { entries: Object.fromEntries(Object.entries(v.entries).filter((e): e is [string, number] => typeof e[1] === "number")) }
        : {}),
      ...(v.unread !== undefined && v.unread !== null && typeof v.unread === "object"
        ? { unread: Object.fromEntries(Object.entries(v.unread).map(([k, x]) => [k, Array.isArray(x) ? x.filter((n): n is number => typeof n === "number") : []])) }
        : {}),
    };
  } catch {
    return null;
  }
}

/** The index of placed items, by fidelity. */
export function offeredOf(placed: readonly Placed[]): FitIndex["offered"] {
  const by = (f: Fidelity): string[] => placed.filter((p) => p.fidelity === f).map((p) => p.id);
  return { whole: by("whole"), excerpt: by("excerpt"), line: by("line"), id: by("id") };
}

/** How many ids an index offered in part (excerpt, line or id alone) — what a lookup could fetch. */
export function offeredInPart(index: Pick<FitIndex, "offered">): number {
  return index.offered.excerpt.length + index.offered.line.length + index.offered.id.length;
}

/**
 * THE MEASUREMENT (2026-09-28): ids a deliberate lookup fetched whole, counted
 * against each mechanism's latest index — those it offered in part, within
 * `LOOKUP_WINDOW_MS` of the fit. The fetched ids join the index's `looked`, so
 * a change made from one reads as made from the whole text. Counts come back
 * per mechanism; zero mechanisms are left out. Never throws.
 */
export function noteLookups(
  store: Pick<Store, "getMeta" | "setMeta" | "now" | "dream" | "reflection">,
  delivered: readonly { readonly id: string; readonly whole: boolean }[],
): Partial<Record<FitMechanism, number>> {
  const out: Partial<Record<FitMechanism, number>> = {};
  if (delivered.length === 0) return out;
  let now: number;
  try {
    now = store.now();
  } catch {
    return out;
  }
  for (const m of FIT_MECHANISMS) {
    const index = readIndex(store, m);
    if (index === null || now - index.at > FIT_TUNABLES.LOOKUP_WINDOW_MS || !runOpen(store, m, index.ref, now)) continue;
    const inPart = new Set([...index.offered.excerpt, ...index.offered.line, ...index.offered.id]);
    const mine = delivered.filter((d) => inPart.has(d.id));
    if (mine.length === 0) continue;
    // COUNTED ONCE PER INDEX (review of #278): an id fetched in three parts,
    // or asked for again, is one lookup — so the rows' counts sum to the
    // distinct ids each run's index had looked up.
    const counted = new Set(index.counted ?? []);
    const fresh = [...new Set(mine.map((d) => d.id))].filter((id) => !counted.has(id));
    // FETCHED WHOLE only when its last part was delivered.
    const whole = mine.filter((d) => d.whole).map((d) => d.id);
    if (fresh.length > 0) out[m] = fresh.length;
    if (fresh.length === 0 && whole.every((id) => (index.looked ?? []).includes(id))) continue;
    writeIndex(store, m, { ...index, counted: [...counted, ...fresh], looked: [...new Set([...(index.looked ?? []), ...whole])] });
  }
  return out;
}

/**
 * IS THE RUN THAT MADE THIS INDEX STILL OPEN? A lookup counts as the index's
 * only then (review of build B): an ordinary session that later recalls the
 * same memory is not the dream reading its line.
 */
function runOpen(store: Pick<Store, "dream" | "reflection">, m: FitMechanism, ref: string, now: number): boolean {
  try {
    const row = m === "dream" ? store.dream(ref) : store.reflection(ref);
    if (row === undefined) return false;
    if (row.state === "begun") return true;
    if (row.state !== (m === "dream" ? "journaled" : "reflected")) return false;
    return row.finished_at !== null && now - row.finished_at <= FIT_TUNABLES.LOOKUP_GRACE_MS;
  } catch {
    return false;
  }
}

/**
 * WHAT A CHANGE WAS MADE FROM, as its maker saw it (the audit's fidelity):
 * each source id with the fidelity its index showed it at — `whole` when a
 * lookup fetched it since — or `unseen` when this index did not offer it.
 */
export function fidelityOf(index: FitIndex | null, ref: string, ids: readonly string[]): Record<string, Fidelity | "unseen"> {
  const out: Record<string, Fidelity | "unseen"> = {};
  const mine = index !== null && index.ref === ref ? index : null;
  for (const id of ids) {
    if (mine === null) {
      out[id] = "unseen";
      continue;
    }
    if ((mine.looked ?? []).includes(id) || mine.offered.whole.includes(id)) out[id] = "whole";
    else if (mine.offered.excerpt.includes(id)) out[id] = "excerpt";
    else if (mine.offered.line.includes(id)) out[id] = "line";
    else if (mine.offered.id.includes(id)) out[id] = "id";
    else out[id] = "unseen";
  }
  return out;
}
