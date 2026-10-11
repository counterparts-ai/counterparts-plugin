/**
 * Deliberate recall's ADDRESS paths — a memory asked for by id or by its exact
 * title — and the pieces the two question modes share (Release B, 2026-10-03).
 *
 * A QUESTION is not answered here any more. `recall` with a question takes a
 * required `mode`: `facts` (`facts.ts`) or `meaning` (`meaning.ts`), each its
 * own path with its own ranking and its own result, so tuning one cannot leak
 * into the other. What was here — the question re-tiered off `Recall.build()`
 * into vivid / quiet / dim, the hard gates effort could not overturn, the dim
 * cap, the recent-session lead — is retired with it (the build plan,
 * `~/counterparts-notes/2026-10-03-deliberate-recall-build-plan.md`).
 *
 * **The two kinds of ask never blur** (§9.1 G1). A handle EXPANDS:
 * `store.resolve`, exact title match, and if neither answers, not-found —
 * there is no search fallback in this file, and a test asserts a near-miss
 * handle returns nothing rather than the memory a fuzzy match would have
 * found. Expansion degrading into fuzzy search is how a precise question
 * quietly becomes a vibe.
 *
 * Shared: `embedQuestion` (both modes and the console's `ask`), `provenanceOf`
 * / `provenanceParts` (where a row came from), the size constants, the
 * journal gloss.
 */
import { homedir } from "node:os";

import type { Counterpart } from "../../core/counterpart.js";
import { sessionsHere } from "../../core/coverage/index.js";
import { wireChars } from "../../core/fit/index.js";
import { handoffAuthorship, sessionWords } from "../../core/handoff/index.js";
import { belowReach, strength } from "../../core/physics/index.js";
import type { MemoryPhysics } from "../../core/types.js";
import { isConfidential, isSelfPage, standingOf } from "../../core/recall/index.js";
import { parseChapterAddress, resolveChapter } from "../../core/self/chapter-address.js";
import { localStamp } from "../../core/time.js";
import { UNBOUND_SESSION } from "../../core/types.js";
import type { SemanticSource } from "../../core/recall/index.js";

// ── the result's size, which is a capability of the HOST, not a preference ──
//
// MEASURED 2026-09-04: three `recall` calls in one session returned 7, 8 and 12
// memories as FULL BODIES — 73,000 to 122,000 characters — and every one of the
// three overflowed the host's tool-result ceiling. An answer the host truncates
// is not a smaller answer, it is no answer, and the model that asked cannot tell
// the difference between "nothing came" and "too much came".
//
// This is scar §2.18's rule (the injection ceiling is a host capability) applied
// to the OTHER direction of the same wire. The ambient path has had a byte
// budget since day one (`BUDGET_BYTES`); the deliberate path had none.
//
// The numbers: a LIST answers "which memories", so 300 characters is enough to
// recognize one and decide whether to ask for it; the id path answers "what did
// it say", so it gets an order of magnitude more each; and the total is bounded
// below the smallest tool-result ceiling this package has met.

/** Characters of body per memory in a LIST answer (facts mode's excerpts). */
export const RECALL_EXCERPT_CHARS = 300;
/**
 * Characters of body per memory when the caller asked for it BY ID: ONE PART
 * of it (2026-09-28, build B: was 4,000 with no way to read further). A longer
 * body comes in parts — `part: 2`, `3`, … — so a dream's merge, a journal or a
 * multi-chapter episode can be read whole through this door.
 */
export const RECALL_BODY_CHARS = 8_000;
/** Total characters of one LIST (question) result's answer, across every memory. */
export const RECALL_RESULT_CHARS = 12_000;
/**
 * THE BY-ID RESULT'S ROOM (2026-09-28; review of #278: a 40,000-character
 * content cap came to 72,900 on the wire). Measured on the SERIALISED
 * memories, as they leave — pretty-printed JSON, a non-ASCII character
 * counted as three (`fit/wireChars`: the ceiling is in tokens) — and counted
 * TWICE, because a result carries its payload as text and as
 * `structuredContent` and a host may count both. About 19k tokens, under the
 * ~25k-token ceiling with room for the rest of the result. Ids past it WAIT,
 * named, for the next call.
 *
 * 2026-10-02: Claude Code counts only `structuredContent`, so one copy is
 * about 28,000 — under `fit/TOOL_RESULT_CEILING` (40,000) with room, and kept.
 */
export const RECALL_ID_RESULT_CHARS = 56_000;
/**
 * How many ids one `ids` call may expand (2026-09-28: was 3). An index — a
 * dream's, a reflection's — offers lines and names this lookup; a batch of
 * them is the lookup's normal shape. Still effort, not enumeration.
 */
export const RECALL_MAX_IDS = 10;

/** One memory as it goes on the wire: an excerpt, plus what was left off. */
export interface BoundedMemory {
  readonly id: string;
  readonly kind: string;
  readonly title: string | null;
  /** A journal entry, not a memory — see `Recalled.journal`. */
  readonly journal: boolean;
  /** The body, cut to the applicable budget. */
  readonly excerpt: string;
  /** The full body's length, so "there is more" is a number, not a guess. */
  readonly bodyChars: number;
  /** True when `excerpt` is shorter than the body. */
  readonly truncated: boolean;
  /** By id: which part of the body this is, and how many parts it has. */
  readonly part?: number;
  readonly parts?: number;
  /** Its standing in a contradiction, or that it was replaced (`recall/standing.ts`). */
  readonly standing?: string;
  /** Where it came from — see `Recalled.from`. */
  readonly from?: string;
  /** Asked for as one chapter: its address, and its moments' ids — see `Recalled.address`. */
  readonly address?: string;
  readonly moments?: readonly string[];
}

export interface BoundedResult {
  readonly memories: readonly BoundedMemory[];
  /** Any body was cut. */
  readonly truncated: boolean;
  /** Memories dropped whole because the total budget ran out (always 0 by
   *  id, where ids past the room WAIT instead). */
  readonly droppedForBudget: number;
  readonly chars: number;
  /** By id: the ids the result had no room for, in the order asked — ask again for them. */
  readonly waiting?: readonly string[];
}

/**
 * BY ID, IN PARTS (2026-09-28, build B). Each body is read as parts of
 * `pageChars`; `part` (from 1) picks which part of every body asked for. The
 * parts are exact slices, so they join back into the whole. Ids past the total
 * WAIT — named, in order — rather than being cut or dropped. The first always
 * fits (a part is smaller than the total).
 */
export function boundById(
  memories: readonly Recalled[],
  part: number = 1,
  pageChars: number = RECALL_BODY_CHARS,
  totalChars: number = RECALL_ID_RESULT_CHARS,
): BoundedResult {
  const out: BoundedMemory[] = [];
  const waiting: string[] = [];
  let chars = 0;
  let truncated = false;
  const p = Number.isInteger(part) && part >= 1 ? part : 1;
  let wire = 0;
  for (const m of memories) {
    const parts = Math.max(1, Math.ceil(m.body.length / pageChars));
    const excerpt = p > parts ? "" : m.body.slice((p - 1) * pageChars, p * pageChars);
    const item: BoundedMemory = {
      id: m.id,
      kind: m.kind,
      title: m.title,
      journal: m.journal,
      excerpt,
      bodyChars: m.body.length,
      truncated: parts > 1,
      part: p,
      parts,
      ...(m.standing === undefined ? {} : { standing: m.standing }),
      ...(m.from === undefined ? {} : { from: m.from }),
      ...(m.address === undefined ? {} : { address: m.address }),
      ...(m.moments === undefined ? {} : { moments: [...m.moments] }),
    };
    // As it leaves: serialised, weighted, both copies.
    const cost = 2 * wireChars(JSON.stringify(item, null, 2));
    if (waiting.length > 0 || (out.length > 0 && wire + cost > totalChars)) {
      waiting.push(m.id);
      continue;
    }
    if (parts > 1) truncated = true;
    chars += excerpt.length;
    wire += cost;
    out.push(item);
  }
  return { memories: out, truncated, droppedForBudget: 0, chars, ...(waiting.length > 0 ? { waiting } : {}) };
}

/**
 * FADED, for both question modes (Release B, 2026-10-03; agreed between the
 * facts and meaning builders): since 2026-10-10 (Group 1, review 03 C2) a
 * memory has faded when it is BELOW REACH — strength under physics' `REACH`,
 * the one threshold ambient recall leaves out and deliberate recall labels
 * faded (facts mode ranks it with the rest, its words shown, since
 * 2026-10-10; meaning mode lists it after the arc). It replaces `FADED_RETAINED` (kept
 * 0.2 of its strength, which with S >= 60 could not fire before ~96 lived
 * days), so "faded" means one thing everywhere. The identity band is never
 * faded. A memory written low (a 0.25 note of a kind whose salience weighs
 * 0.4, about 0.10) reads faded from birth: it was never in reach.
 */
export function hasFaded(p: MemoryPhysics, day: number): boolean {
  return belowReach(p, day);
}

/**
 * A body cut to `limit` characters for a LIST (facts mode's excerpts). Cut at
 * a word boundary when one is near, so an excerpt ends as text rather than
 * mid-token; the ellipsis is part of the budget, not extra.
 */
export function cutExcerpt(body: string, limit: number): string {
  if (body.length <= limit) return body;
  const hard = body.slice(0, Math.max(0, limit - 1));
  const space = hard.lastIndexOf(" ");
  return `${space > limit * 0.6 ? hard.slice(0, space) : hard}…`;
}

/**
 * A journal entry, not a memory — the owner's ruling of 2026-09-04 (§I14).
 *
 * The chapter stays RECALLABLE: a chapter about the lighthouse conversation may
 * rightly come to mind, and filtering it would answer a question worse than
 * labelling it does. What it must never be is mistaken for a memory — it is the
 * first-person ACCOUNT a memory was made from, it sits outside every sleep phase
 * (`sleep/types.ts#isJournal`), and the physics printed beside it is recorded and
 * never acted on. The dashboard has said so on the row since #33; this is the
 * same sentence at the other two doors.
 *
 * The predicate is `ProseDoc.type`, the same field `isJournal` reads off the row,
 * so the label cannot disagree with the rest of the system about what a chapter
 * is. `kind` stays PHYSICS kind: a chapter is usually `kind: "self"`, which is
 * exactly the ambiguity this boolean resolves rather than overwrites.
 */
export const JOURNAL_GLOSS =
  "A row marked journal: true is a chapter — the first-person account a memory was made from, not a memory. It is outside decay, dedup and the prune, and it is not a claim about the world the way a memory is.";

/** One memory asked for by address, whole. */
export interface Recalled {
  readonly id: string;
  readonly kind: string;
  readonly title: string | null;
  /** True for an `epi_` chapter (`ProseDoc.type === "episode"`). See `JOURNAL_GLOSS`. */
  readonly journal: boolean;
  readonly body: string;
  /** Base-level strength today (`physics#strength`). */
  readonly strength: number;
  /**
   * Its standing (2026-09-29, `recall/standing.ts`): earlier, corrected by,
   * disagrees with, unsettled — and, asked for by id, replaced by. Read
   * before the body, so an old memory never reads as current.
   */
  readonly standing?: string;
  /**
   * WHERE IT CAME FROM (2026-09-30, the continuity test): the session that
   * wrote it, the directory, and when — `session a1b2c3d4, ~/random, 09-30
   * 17:41`. With several sessions at work at once, a session asking what
   * happened could not tell its own directory's evening from the release work
   * next door. Read off the row (`origin_session`, `origin_scope`,
   * `created_at`); a row from before any of them was recorded says less, and
   * "an earlier session" when it names none. Never backfilled.
   */
  readonly from?: string;
  /**
   * ASKED FOR AS ONE CHAPTER (`epi_…#N`, 2026-10-03): the address; the id
   * above is then the episode's, the body that chapter's words, and
   * `moments` the ids its session wrote during it (`self/chapter-address.ts`).
   */
  readonly address?: string;
  readonly moments?: readonly string[];
}

export type DeliberateReason =
  | "expanded"
  | "handle-unknown"
  | "handle-ambiguous"
  | "handle-confidential-withheld"
  | "no-argument"
  | "both-arguments"
  | "ids-too-many"
  /** A question alone reached the address dispatcher: it is answered by a mode (`facts.ts`, `meaning.ts`). */
  | "question-needs-mode";

export interface DeliberateResult {
  readonly path: "handle" | "none";
  /** Always `none` here: an address is not scored, so no channel is asked. */
  readonly semantic: SemanticSource;
  readonly reason: DeliberateReason;
  readonly memories: readonly Recalled[];
  /** How many ids or matches the address considered. */
  readonly considered: number;
  /**
   * LIVE ROWS in the store — the denominator an aggregation question needs, and
   * not the same number as the wake preface's "N memories".
   *
   * `store.list({ archived: false })` returns every unarchived row: memories,
   * the schemas (entities, beliefs, and the identity core `install --name`
   * mints), and the journal's episodes. A store a reader made by following the
   * documented path and then wrote two notes into answers `3 live`, not `2` —
   * the third row is the identity core (found 2026-09-04, when a captured
   * example reproduced one higher than the page said).
   *
   * The COUNT is right for what it is; the word was the problem, so every label
   * over this field says "live rows".
   */
  readonly storeSize: number;
  /** Ids a handle matched when the handle was ambiguous. Ids only, no bodies. */
  readonly ambiguous: readonly string[];
  /** The `ids` path only: what happened to each id asked for, in the order
   *  asked. A multi-id lookup is still a DIRECT lookup, so each id's refusal is
   *  stated by name rather than folded into one total (§9.1 G5). */
  readonly perId?: readonly { id: string; reason: DeliberateReason }[];
}

export interface DeliberateInput {
  readonly handle?: string;
  /** Named only so that a question sent WITH an address is refused as
   *  `both-arguments`; a question alone is a mode's (`question-needs-mode`). */
  readonly question?: string;
  /** Full bodies for memories the caller already has the ids of — the follow-up
   *  to a list, and the reason the list can afford to be excerpts. */
  readonly ids?: readonly string[];
}

export interface DeliberateOptions {
  readonly sessionId: string;
  /** The owner's own session? Confidentiality turns on this and nothing else. */
  readonly owner: boolean;
}

/**
 * ONE EMBEDDING OF A DELIBERATE QUESTION, and every way it can decline, by name
 * — the vector both modes take in their context. Shared by the callers that
 * ask deliberately: the MCP `recall` tool and the console's `ask`
 * (2026-09-24). Structural on the embedder (`vector()` is all it needs), so
 * this file still imports no other adapter. Never throws.
 */
export async function embedQuestion(
  embedder: { vector(text: string): Promise<number[] | null> } | null,
  question: string,
): Promise<{ vector: number[] | null; semantic: SemanticSource }> {
  if (embedder === null) return { vector: null, semantic: "embedder-off" };
  try {
    const vector = await embedder.vector(question);
    return vector === null || vector.length === 0
      ? { vector: null, semantic: "embed-failed" }
      : { vector, semantic: "in-line" };
  } catch {
    return { vector: null, semantic: "embed-failed" };
  }
}

const EMPTY = {
  semantic: "none" as SemanticSource,
  memories: [] as readonly Recalled[],
  considered: 0,
  storeSize: 0,
  ambiguous: [] as readonly string[],
};

/** Live memories, the same count every answering path reports. Never throws:
 *  a refusal must not become a crash because the census failed. */
function liveCount(counterpart: Counterpart): number {
  try {
    return counterpart.store.list({ archived: false }).length;
  } catch {
    return 0;
  }
}

/**
 * The dispatcher. EXACTLY ONE argument: two is a caller who does not know which
 * question they are asking, and answering the more convenient one is how the
 * expansion path quietly becomes the search path.
 */
export function deliberateRecall(
  counterpart: Counterpart,
  input: DeliberateInput,
  opts: DeliberateOptions,
): DeliberateResult {
  const hasHandle = typeof input.handle === "string" && input.handle.trim().length > 0;
  const hasQuestion = typeof input.question === "string" && input.question.trim().length > 0;
  const askedIds = (input.ids ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  const hasIds = askedIds.length > 0;
  // THREE kinds of ask, still exactly one per call. `ids` is the follow-up to
  // a list — "give me those in full" — and mixing it with a question is the
  // same caller confusion `both-arguments` already refuses.
  if ([hasHandle, hasQuestion, hasIds].filter(Boolean).length > 1) {
    return { path: "none", reason: "both-arguments", ...EMPTY, storeSize: liveCount(counterpart) };
  }
  if (hasHandle) return expandHandle(counterpart, (input.handle as string).trim(), opts);
  if (hasIds) return expandIds(counterpart, askedIds, opts);
  // A question is a MODE's (`facts.ts`, `meaning.ts`), never this file's.
  if (hasQuestion) return { path: "none", reason: "question-needs-mode", ...EMPTY, storeSize: liveCount(counterpart) };
  // The REAL store size, even on a refusal. A caller who misspelled the argument
  // name got `storeSize: 0` here until 2026-09-04, which reads as "your store is
  // empty" — the wrong problem, stated confidently, at exactly the moment the
  // caller is already unsure what they did wrong (cold-stranger review, §6.9).
  return { path: "none", reason: "no-argument", ...EMPTY, storeSize: liveCount(counterpart) };
}

/**
 * THE EXPANSION PATH. Exact by construction: an id that resolves, or a title
 * that matches exactly after trimming and case-folding. No scoring, no cues, no
 * `store.search` — this function does not import one.
 *
 * Withholding is STATED here (§9.1 G5): a direct lookup that answers "nothing"
 * where something exists would be a lie, so the refusal names itself. In a
 * list (facts mode), the same material is dropped silently, because a list
 * that announces its gaps is a list that leaks their existence.
 */
export function expandHandle(
  counterpart: Counterpart,
  handle: string,
  opts: DeliberateOptions,
): DeliberateResult {
  const store = counterpart.store;
  const storeSize = store.list({ archived: false }).length;
  // The expansion path scores nothing, so no channel is consulted and none is
  // reported dark: `none` here means "not asked", not "asked and empty".
  const base = {
    path: "handle" as const,
    semantic: "none" as SemanticSource,
    storeSize,
    ambiguous: [] as readonly string[],
  };

  // A CHAPTER ADDRESS, `epi_…#N` (Release B, 2026-10-03): the answers name
  // chapters this way (meaning mode's arc), so the address reads that one
  // chapter — its words, and the moments its session wrote during it — by
  // `self/chapter-address.ts#resolveChapter`. Exact, like every other
  // address: an episode or a chapter that is not there is not-found.
  if (parseChapterAddress(handle) !== null) return expandChapter(counterpart, handle.trim(), opts, base);

  const matches: string[] = [];
  // AN OLD ID READS AS ITSELF (2026-09-29, contradictions): a replaced row
  // asked for by its own id is shown — its own words, with `replaced by` —
  // rather than forwarded to its successor's body. `store.resolve` still
  // follows the chain (store §5 G4 / §16 G3; every write resolution relies on
  // it); this is the display path, and only for an id that names a row.
  const own = (() => {
    try {
      return store.row(handle);
    } catch {
      return undefined;
    }
  })();
  if (own !== undefined && own.superseded_by !== null && !(own.body === "" && own.content_hash === "")) {
    matches.push(own.id);
  }
  try {
    if (matches.length === 0) matches.push(store.resolve(handle));
  } catch {
    // Not an id, or an id that no longer resolves. Fall through to titles —
    // which is NOT a fuzzy fallback: it is the other exact address a memory has.
  }
  if (matches.length === 0) {
    const wanted = handle.toLowerCase();
    for (const id of store.list({ archived: false })) {
      const row = store.row(id);
      if (row === undefined || row.superseded_by !== null) continue;
      let title: string | null = null;
      try {
        title = store.readProse(id).title ?? null;
      } catch {
        continue;
      }
      if (title !== null && title.trim().toLowerCase() === wanted) matches.push(id);
    }
  }

  if (matches.length === 0) {
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  }
  if (matches.length > 1) {
    // Ids only: an ambiguous handle names the choice without making it, and
    // returning every body would hand back the thing the ambiguity conceals.
    return {
      ...base,
      reason: "handle-ambiguous",
      memories: [],
      considered: matches.length,
      ambiguous: matches,
    };
  }

  const id = matches[0] as string;
  const read = store.read(id);
  // THE SELF PAGE IS NOT EXPANDED HERE either (2026-09-18). It is excluded from
  // activation, so it never appears in a result to be followed up — and the one
  // way left to reach it was to pass its id, which would credit a use for a row
  // that is delivered whole at every wake. `self_page` is its door, and it has
  // no cap and no tier.
  if (isSelfPage(read.doc)) {
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  }
  if (!opts.owner && isConfidential(read.doc)) {
    return { ...base, reason: "handle-confidential-withheld", memories: [], considered: 1 };
  }
  return {
    ...base,
    reason: "expanded",
    considered: 1,
    memories: [
      {
        id,
        kind: read.physics.kind,
        title: read.doc.title ?? null,
        journal: read.doc.type === "episode",
        body: read.doc.body,
        // Base-level strength from `physics/`, not a raw use count.
        strength: strength(read.physics, store.livedDay()),
        ...standingField(store, id, true),
        ...fromField(store, id, opts.sessionId, counterpart.spans),
      },
    ],
  };
}

/**
 * ONE CHAPTER, by its address `epi_…#N`. The memory it returns carries the
 * EPISODE's id (what credit, the seen set and the handle log key on), the
 * chapter's own words, `address`, and the ids of the moments its session
 * wrote during it. The episode's confidentiality applies, stated.
 */
function expandChapter(
  counterpart: Counterpart,
  address: string,
  opts: DeliberateOptions,
  base: { path: "handle"; semantic: SemanticSource; storeSize: number; ambiguous: readonly string[] },
): DeliberateResult {
  const store = counterpart.store;
  const got = resolveChapter(store, address);
  if (!got.ok) return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  const c = got.chapter;
  let read;
  try {
    read = store.read(c.episodeId);
  } catch {
    return { ...base, reason: "handle-unknown", memories: [], considered: 0 };
  }
  if (!opts.owner && isConfidential(read.doc)) {
    return { ...base, reason: "handle-confidential-withheld", memories: [], considered: 1 };
  }
  const shown = !opts.owner
    ? c.moments.filter((id) => {
        try {
          return !isConfidential(store.read(id).doc);
        } catch {
          return false;
        }
      })
    : c.moments;
  return {
    ...base,
    reason: "expanded",
    considered: 1,
    memories: [
      {
        id: c.episodeId,
        kind: read.physics.kind,
        title: `${c.title ?? "journal"} — chapter ${String(c.chapter)} of ${String(c.of)}`,
        journal: true,
        body: c.heading === null ? c.text.trim() : `${c.heading}\n\n${c.text.trim()}`,
        strength: strength(read.physics, store.livedDay()),
        address: c.address,
        moments: [...shown],
        ...fromField(store, c.episodeId, opts.sessionId, counterpart.spans),
      },
    ],
  };
}

/**
 * WHERE A ROW CAME FROM, as one short string (2026-09-30): who wrote it —
 * "this session" for the asker's own, the short id otherwise, "an earlier
 * session" when the row names none, and "a session that hadn't been
 * identified yet" for a note an unbound server wrote (`UNBOUND_SESSION`; never
 * "this session", whoever asks) — the directory with the home directory
 * as `~`, and when, in the store's zone (a chapter: its latest write). Only
 * what the row already knows; nothing is backfilled. A row the nightly run
 * made says so — "a dream launched from session …", "a reflection" — rather
 * than reading as that session's own words (review of #302, MAJOR-1), and one
 * carried over from an older store says that. Never throws.
 *
 * AN UNBOUND NOTE, PLACED BY ITS TIME (2026-10-01, random-f2's items 4 and
 * 12). A note an unbound server wrote before 2026-10-01 names no session;
 * since then the server finds its session by its host process at write time
 * (`server.ts#hostSession`). For the older rows, given `spans`, the note is
 * read as a session's when it can be no one else's — `preBindNotes`' rule: it
 * was written in that directory, inside the stretch that session was at work
 * there (turn-ends and held pieces), and inside no other session's — and the
 * words say how it was placed: "session a1b2c3d4 (placed by when it was
 * written)". Nothing is written back to the row. The registry's `startedAt`
 * is NOT a stretch: an idle tab opened early would cover a sibling's note
 * (#307, reverted).
 */
export function provenanceOf(
  store: Counterpart["store"],
  id: string,
  reader: string | null = null,
  spans?: Counterpart["spans"],
): string | null {
  const parts = provenanceParts(store, id, reader, spans);
  if (parts === null) return null;
  return [parts.who, parts.where, parts.when].filter((p): p is string => p !== null && p.length > 0).join(", ");
}

/**
 * `provenanceOf` IN ITS THREE PARTS (2026-10-03, facts mode): who wrote it,
 * the directory (home as `~`), and when, in the store's zone — so a reader
 * that prints its own date line (facts mode's `learned 09-28 in ~/x`) need
 * not re-read a stamp out of the joined string. Null when the row will not
 * read. Never throws.
 */
export function provenanceParts(
  store: Counterpart["store"],
  id: string,
  reader: string | null = null,
  spans?: Counterpart["spans"],
): { who: string; where: string | null; when: string | null } | null {
  try {
    const row = store.row(id);
    if (row === undefined) return null;
    let session = row.origin_session;
    if ((session === null || session.length === 0) && row.type === "episode") {
      const meta = JSON.parse(row.meta || "{}") as Record<string, unknown>;
      session = typeof meta["sessionId"] === "string" ? meta["sessionId"] : null;
    }
    // A HANDOFF names its writer on its meta, and its birth date is the
    // first writer's (2026-10-01): who and when come from the handoff's own
    // record, as the wake's pointer reads them.
    const handoff = row.type === "schema" ? handoffAuthorship(store, id) : null;
    if (handoff !== null) session = handoff.session;
    const placed = session === UNBOUND_SESSION && spans !== undefined ? placedByTime(spans, row) : null;
    const named =
      placed !== null
        ? `${sessionWords(placed, null, reader)} (placed by when it was written)`
        : session === null || session.length === 0
          ? null
          : sessionWords(session, null, reader);
    const made = nightlyMade(row);
    const who =
      made === "dream"
        ? named === null ? "a dream" : `a dream launched from ${named}`
        : made === "reflection"
          ? "a reflection"
          : row.source === "migrated"
            ? "carried over from an older store"
            : (named ?? "an earlier session");
    const home = homedir();
    const scope = handoff?.scope ?? row.origin_scope;
    const where =
      scope === null || scope.length === 0
        ? null
        : home.length > 1 && (scope === home || scope.startsWith(`${home}/`))
          ? `~${scope.slice(home.length)}`
          : scope;
    const at = handoff !== null ? handoff.at : row.type === "episode" ? (row.updated_at ?? row.created_at) : row.created_at;
    const learned = handoff?.on ?? (row.learned_on.length > 0 ? row.learned_on : null);
    const when = at === null ? learned : localStamp(at, store.zone());
    return { who, where, when };
  } catch {
    return null;
  }
}

/**
 * THE ONE SESSION AN UNBOUND NOTE CAN BE (see `provenanceOf`): written in a
 * directory, inside exactly one session's stretch there. Null otherwise.
 */
function placedByTime(
  spans: Counterpart["spans"],
  row: { origin_scope: string | null; created_at: number | null },
): string | null {
  const scope = row.origin_scope;
  const at = row.created_at;
  if (scope === null || scope.length === 0 || at === null) return null;
  const covering = sessionsHere(spans, scope).filter((s) => at >= s.firstAt && at <= s.lastAt);
  return covering.length === 1 ? (covering[0]?.session ?? null) : null;
}

/** Was this row made by the nightly run — a dream's, or a reflection's? */
export function nightlyMade(row: { source: string | null; origin_ref: string | null }): "dream" | "reflection" | null {
  const ref = row.origin_ref ?? "";
  if (row.source === "dreamed" || ref.startsWith("dream:")) return "dream";
  if (row.source === "reflection" || ref.startsWith("reflection:")) return "reflection";
  return null;
}

function fromField(store: Counterpart["store"], id: string, reader: string, spans?: Counterpart["spans"]): { from?: string } {
  const from = provenanceOf(store, id, reader, spans);
  return from === null ? {} : { from };
}

/** A memory's standing as a result field, or nothing. Never throws. */
function standingField(store: Counterpart["store"], id: string, byId: boolean): { standing?: string } {
  try {
    const s = standingOf(store, id, { byId });
    return s === null ? {} : { standing: s.note };
  } catch {
    return {};
  }
}

/**
 * THE ID PATH — "those three, in full", after a list.
 *
 * It is `expandHandle` in a loop and deliberately nothing more: each id crosses
 * the same exact-address resolution and the same confidentiality boundary, so
 * withholding is still STATED per id (§9.1 G5) and no id fuzzes into a search.
 * Writing a second resolver here to save a loop is how the expansion path
 * quietly becomes the search path.
 *
 * The count is capped because effort is not enumeration: a caller who wants
 * twenty bodies is asking for the store, and `status` is the tool for that.
 */
export function expandIds(
  counterpart: Counterpart,
  ids: readonly string[],
  opts: DeliberateOptions,
): DeliberateResult {
  const unique = [...new Set(ids)];
  const storeSize = counterpart.store.list({ archived: false }).length;
  // Same as `expandHandle`: an exact address consults no channel, so `none`
  // here means "not asked", never "asked and empty".
  const base = { path: "handle" as const, semantic: "none" as SemanticSource, storeSize };
  if (unique.length > RECALL_MAX_IDS) {
    return {
      ...base,
      reason: "ids-too-many",
      memories: [],
      considered: unique.length,
      ambiguous: [],
      perId: unique.map((id) => ({ id, reason: "ids-too-many" as const })),
    };
  }
  const memories: Recalled[] = [];
  const ambiguous: string[] = [];
  const perId: { id: string; reason: DeliberateReason }[] = [];
  for (const id of unique) {
    const one = expandHandle(counterpart, id, opts);
    perId.push({ id, reason: one.reason });
    memories.push(...one.memories);
    ambiguous.push(...one.ambiguous);
  }
  return {
    ...base,
    reason: memories.length > 0 ? "expanded" : (perId[0]?.reason ?? "handle-unknown"),
    memories,
    considered: unique.length,
    ambiguous,
    perId,
  };
}

