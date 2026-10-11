/**
 * The worker's two vector jobs — the half of the semantic channel that is
 * allowed to take a second.
 *
 * **The finding, 2026-09-04, on the live store.** `RecallTurn.vector` has been
 * an input since `recall/` was written and NEITHER live path set it: the
 * UserPromptSubmit hook built its turn without one and the MCP recall tool built
 * its own. So the 13,862 embeddings the store had paid for were consulted by
 * nothing live — the semantic channel existed in tests and in the sweep's card
 * preselection and nowhere a person could feel it. And only the sweep ever
 * warmed a vector, so 40 authored notes, 224 episodes and 288 migrated memories
 * had none at all: the channel was blind to the first-person material even where
 * it did fire.
 *
 * **The ruling (Mike, 2026-09-04): do not embed on the hot path.** Every hook is
 * a fresh process that already spends 700-1000 ms cold against a 1200 ms recall
 * budget, and `recall.build` is a synchronous pass with checkpoints — an overrun
 * does not degrade the channel, it aborts the whole turn. So the cue is computed
 * AFTER a turn and used on the NEXT one, the way carried cues already work.
 *
 * **And the RANK travels with it, not the vector.** Measured hermetically at the
 * live index's size, `Store.nearestTo` over 13,862 vectors costs 590-1040 ms:
 * `cache.nearest` reads and JSON-parses every row.
 *
 * **Amended 2026-09-05, and the conclusion survives.** Box 3 now stores vectors
 * as float32 BLOBs, and the same scan measures ~50 ms at 14,000×1,024
 * (`store/NOTES.md`) — so the SCAN half of this argument is largely paid off.
 * The other half is not: the network call is still a network call, and it is
 * the one that cannot be raced against a 1200 ms synchronous budget. Ranking
 * stays in the worker for that reason alone.
 *
 * Handing the hot path a vector
 * would have moved the network call off it and left that scan on it — the same
 * abort one layer down. So this file embeds AND ranks, and stores the top-M
 * `{id, score}` slice as per-session gate state (`recall/session.ts`).
 *
 * Both jobs run in the detached worker, and neither may fail the run: an
 * embedder that cannot embed costs a cue, never a day. (Since 2026-09-24 the
 * only embedder is the local table — the network half of the argument above is
 * history, and the jobs stay here because they already work here.)
 */
import { EMBED_BACKFILL_EVENT, SEMANTIC_LAG_EVENT } from "../../core/counterpart.js";
import type { Counterpart } from "../../core/counterpart.js";
import { stripBoilerplate } from "../../core/recall/index.js";
import type { SemanticReason } from "../../core/recall/index.js";
import { EMBED_FAILED_PREFIX, indexTextOf } from "../../core/store/index.js";

import type { LiveEmbedder } from "./embed-client.js";

export type Emit = (name: string, data: Record<string, string | number | boolean | null>) => void;

/**
 * How much of the just-finished turn becomes the next turn's cue.
 *
 * **The conversation side in full (to a cap), a SHORT tail of the reply.** The
 * prompt is what the next turn continues from — topic continuity is the thing
 * being cued. Precisely: the conversation-side SPAN, which `SpanBuffer.capture`
 * builds by joining every non-assistant turn of the window `enters()` kept. That
 * is mostly the owner's own words, and since 2026-09-04 it may also carry a peer
 * session's message — rewritten in place to name its speaker, and therefore
 * legible in the cue rather than mistakable for the owner (CONTRACT G12). It
 * cannot carry this system's own asks: those are `ritual` and enter nothing
 * (G11), which is what keeps the cue from being an embedding of our own
 * boilerplate. The reply is included because a turn is an
 * exchange and the material actually discussed often appears only there; it is
 * bounded hard because an assistant turn can be twenty times the prompt and a
 * long one would drown the prompt in the embedding, which is the semantic
 * analogue of the cue-flood scar (§2.4). 2000/800 bytes: CAL, chosen so the
 * prompt keeps at least ~70% of the joined text at typical lengths and the whole
 * cue stays inside one embedding call. Not measured against surfacing quality
 * yet — the day-1 watch is whether `semantic: "lagged"` turns into surfaced
 * items that were not already lexically cued.
 */
export const LAG_PROMPT_BYTES = 2000;
export const LAG_REPLY_BYTES = 800;

/** How many unembedded memories one worker run may embed, for an injected
 *  embedder that is not the static table. CAL. */
export const BACKFILL_LIMIT = 64;

/**
 * The same bound for the STATIC table, which pays nothing and needs no
 * network: one worker run may embed this many. It is a bound at all only
 * because each `embedOne` is its own box-3 commit (`synchronous = FULL`), and a
 * detached worker shares that file with the next hook. CAL: measured
 * 2026-09-23 (`docs/research/static-embedder-trial-2026-09-23.md`).
 */
export const STATIC_BACKFILL_LIMIT = 1000;

/** The local table: deterministic, free, in-process. */
function isStatic(embedder: LiveEmbedder | null): boolean {
  return embedder?.kind === "static";
}

/**
 * Has the store taken the vector channel away from this handle? `held` (box 3
 * holds another PAID model's vectors, awaiting the owner's confirm) and
 * `cache-ahead` (box 3 is a newer build's) both withdraw the store's embedder
 * and answer every ranking with nothing (store CONTRACT, cache v5). Anything
 * this worker embedded then could never land and never be ranked — so it must
 * not embed at all.
 */
function vectorsWithdrawn(counterpart: Counterpart): string | null {
  const kind = counterpart.store.embedderVerdict.kind;
  return kind === "held" || kind === "cache-ahead" ? kind : null;
}

export interface LagReport {
  readonly reason: SemanticReason;
  readonly stored: boolean;
  readonly hits: number;
  /** Bytes of turn text embedded. Never the text itself. */
  readonly bytes: number;
}

/**
 * Compute the next turn's semantic cue for one session.
 *
 * It reads the session's own last exchange out of the span buffer — which is why
 * it must run BEFORE the sweep, whose claim moves those spans out of the live
 * buffer. The text is stripped of host boilerplate first: recall's §9 G3 says
 * "before cue extraction AND before embedding", and it was measured — an image
 * placeholder token surfaced an unrelated image-cache memory.
 *
 * It ALWAYS records something. A run with no embedder writes `embedder-off`,
 * and the next turn's decision says so by name rather than looking identical to
 * a session nobody has spoken in yet (scar §2.4).
 */
export async function laggedSemantic(input: {
  counterpart: Counterpart;
  sessionId: string;
  scope: string;
  embedder: LiveEmbedder | null;
  onEvent?: Emit;
}): Promise<LagReport> {
  const { counterpart, sessionId, scope } = input;
  const emit = input.onEvent ?? ((): void => {});
  const note = (
    reason: SemanticReason,
    vector: number[] | null,
    bytes: number,
    detail: Record<string, string> = {},
  ): LagReport => {
    const out = counterpart.noteSessionSemantic({
      sessionId,
      reason,
      vector,
      model: input.embedder?.model ?? null,
    });
    emit("vectors.lag", { reason: out.reason, hits: out.hits, stored: out.stored, bytes, ...detail });
    // Durable through `noteAdapterEvent`, the ONE seam an adapter may write the
    // event log through — so tomorrow's coverage watch can count the turns whose
    // cue never got computed, and why, after this process is gone.
    if (!counterpart.observer) {
      counterpart.noteAdapterEvent(SEMANTIC_LAG_EVENT, {
        session: sessionId,
        reason: out.reason,
        hits: out.hits,
        stored: out.stored,
        turn: out.turn,
        bytes,
        ...detail,
      });
    }
    return { reason: out.reason, stored: out.stored, hits: out.hits, bytes };
  };

  if (input.embedder === null) return note("embedder-off", null, 0);
  // Asked for and not here (a static table whose weights were not found): the
  // code rides beside the reason, durably.
  if (input.embedder.unavailable !== undefined) {
    return note("embed-failed", null, 0, { unavailable: input.embedder.unavailable });
  }
  // Before any text: a withdrawn channel is not worth one call. `embed-failed` is the closest word recall's closed vocabulary has;
  // `withdrawn` names the store's verdict beside it, durably.
  const withdrawn = vectorsWithdrawn(counterpart);
  if (withdrawn !== null) return note("embed-failed", null, 0, { withdrawn });

  const text = lagText(counterpart, sessionId, scope);
  if (text.length === 0) return note("no-text", null, 0);

  let vector: number[] | null = null;
  try {
    vector = await input.embedder.vector(text);
  } catch {
    // `LiveEmbedder.vector` is documented never to throw; if a future one does,
    // a cue is still not worth a failed run.
    vector = null;
  }
  return note(vector === null ? "embed-failed" : "ok", vector, text.length);
}

/**
 * The last exchange of one session, bounded and stripped — the string this cue
 * is computed from.
 *
 * Exported for the test that asserts the bound and the strip, because "we
 * embedded the right thing" is not observable from a vector.
 */
export function lagText(counterpart: Counterpart, sessionId: string, scope: string): string {
  const mine = (kind: string): string | null => {
    const spans = counterpart.spans.spans(scope);
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const s = spans[i];
      if (s !== undefined && s.session === sessionId && s.kind === kind) return s.text;
    }
    return null;
  };
  const prompt = clip(strip(mine("conversation")), LAG_PROMPT_BYTES);
  // The assistant's words live in their own stream (`assistantSpans`), captured
  // beside the conversation ones.
  const replies = counterpart.spans.assistantSpans(scope).filter((s) => s.session === sessionId);
  const reply = clip(strip(replies.at(-1)?.text ?? null), LAG_REPLY_BYTES);
  return [prompt, reply].filter((s) => s.length > 0).join("\n\n");
}

function strip(text: string | null): string {
  if (text === null) return "";
  return stripBoilerplate(text).text.trim();
}

/** Head, not tail: a prompt states its subject first, and a truncated cue that
 *  kept only the closing courtesy is a cue for nothing. */
function clip(text: string, bytes: number): string {
  return text.length <= bytes ? text : text.slice(0, bytes);
}

export interface BackfillReport {
  readonly embedded: number;
  readonly failed: number;
  /** Live memories still without a vector AFTER this run, EXCLUDING the ones the
   *  store has given up on. The number that must fall run over run, and the one
   *  a coverage watch reads; `skipped` is the other half of the same sum. */
  readonly remaining: number;
  readonly attempted: number;
  /**
   * `vectors-withdrawn`: the store took the vector channel away at open (a HELD
   * paid-model mismatch, or a cache from a newer build) — nothing was embedded,
   * nothing was paid for, and `codes` names which verdict.
   * `embedder-unavailable`: an embedder was asked for and could not be built
   * (a static table whose weights were not found) — `codes` names the refusal.
   */
  readonly reason:
    | "ran"
    | "embedder-off"
    | "nothing-missing"
    | "observer"
    | "vectors-withdrawn"
    | "embedder-unavailable";
  /**
   * WHICH EMBEDDER this row is about (`static`, null when none or unnamed) and,
   * for the static table, which rule found its weights. Durable, so doctor can
   * say what the WORKER'S process saw — the environment a hook inherits is not
   * the console's (I32).
   */
  readonly kind: string | null;
  readonly weights: string | null;
  /** The embedder's model name (content-derived for the static table). */
  readonly model: string | null;
  /**
   * WHY the failures failed: the distinct `code[:status]` pairs of this run,
   * joined by commas, or `""` when nothing failed.
   *
   * I33's whole shape was that this field did not exist. The backfill row said
   * `embedded: 0, failed: 64, reason: ran` for 32 consecutive runs; the HTTP 400
   * that explained all of them lived in a detached process's ring, and the run
   * read like a flaky provider rather than like two poisoned rows.
   */
  readonly codes: string;
  /** Live memories the store has stopped offering: `embed.failed.<id>` at or
   *  past `EMBED_SKIP_AFTER`. Named by `store.skippedVectorIds()`. */
  readonly skipped: number;
}

/**
 * Give vectors to memories that have none — up to `BACKFILL_LIMIT` per run,
 * **first-person material first**.
 *
 * `Store.missingVectors` owns the order and states why: what the experiencer
 * authored (`source = 'authored'`) and its own episodes come before everything else,
 * oldest first inside each group. A bounded backfill that only ever reaches N
 * per run should reach the memories this brain wrote about itself.
 *
 * **This is the GUARANTEED path, not the only one.** The authored door already
 * warms its own vector when a `vectors` socket is wired — `submitJot` runs the
 * battery gate, which embeds the GATED text, and `Store.put` then finds it in
 * the same cache. But that only helps a deposit made while an embedder was
 * configured; every memory that predates the embedder, arrived by migration, or
 * was minted by a process with no embedder has nothing, and no future deposit
 * will ever come back for it. This does.
 *
 * The two-step is the seam that makes it work and the one that can silently
 * break: `warm()` fills the live embedder's cache keyed by
 * `indexTextOf(title, body)`, and `Store.embedOne` looks it up by exactly that
 * string. `embedOne` reports `vector: false` on a miss, so a backfill that
 * warmed the wrong text reports zero embedded — never a success count over an
 * empty `embeddings` table, which is the shape of the run this whole PR exists
 * to stop repeating.
 */
export async function backfillVectors(input: {
  counterpart: Counterpart;
  embedder: LiveEmbedder | null;
  /** Defaults to `STATIC_BACKFILL_LIMIT` for the table, `BACKFILL_LIMIT` otherwise. */
  limit?: number;
  onEvent?: Emit;
}): Promise<BackfillReport> {
  const { counterpart } = input;
  const emit = input.onEvent ?? ((): void => {});
  const limit = input.limit ?? (isStatic(input.embedder) ? STATIC_BACKFILL_LIMIT : BACKFILL_LIMIT);
  const store = counterpart.store;

  const done = (
    reason: BackfillReport["reason"],
    embedded: number,
    failed: number,
    attempted: number,
    codes = "",
  ): BackfillReport => {
    const remaining = store.unembeddedCount();
    // Counted every run, including the refusals: "how many has this store given
    // up on" is exactly the number a reader wants when `remaining` stops moving.
    let skipped = 0;
    try {
      skipped = store.skippedVectorIds().length;
    } catch {
      // A read that failed costs the field, never the run.
    }
    const report: BackfillReport = {
      embedded,
      failed,
      remaining,
      attempted,
      reason,
      codes,
      skipped,
      kind: input.embedder?.kind ?? null,
      weights: input.embedder?.weights ?? null,
      model: input.embedder === null || input.embedder.unavailable !== undefined ? null : input.embedder.model,
    };
    emit("vectors.backfill", { ...report });
    if (!counterpart.observer) {
      // Durable, because a coverage watch that lives in a detached process's
      // stderr is a watch nobody can read tomorrow.
      counterpart.noteAdapterEvent(EMBED_BACKFILL_EVENT, { ...report });
    }
    return report;
  };

  if (counterpart.observer) return done("observer", 0, 0, 0);
  if (input.embedder === null) return done("embedder-off", 0, 0, 0);
  if (input.embedder.unavailable !== undefined) {
    return done("embedder-unavailable", 0, 0, 0, input.embedder.unavailable);
  }
  const withdrawn = vectorsWithdrawn(counterpart);
  if (withdrawn !== null) return done("vectors-withdrawn", 0, 0, 0, withdrawn);

  const ids = store.missingVectors(limit);
  if (ids.length === 0) return done("nothing-missing", 0, 0, 0);

  const texts: string[] = [];
  const wanted: string[] = [];
  for (const id of ids) {
    let doc;
    try {
      doc = store.readProse(id);
    } catch {
      continue; // a row whose prose has gone is not a failure worth a retry
    }
    // THE SAME STRING `embedOne` will ask for. Composing it any other way
    // caches under a key the store never looks up, and the backfill becomes a
    // no-op that reports success.
    texts.push(indexTextOf(doc.title, doc.body));
    wanted.push(id);
  }
  if (wanted.length === 0) return done("nothing-missing", 0, 0, 0);

  try {
    await input.embedder.warm(texts);
  } catch {
    // One batched call; a refusal leaves the cache as it was and every
    // `embedOne` below reports `vector: false`. Counted, not thrown.
  }
  // The codes of the fill that just happened, before anything else can reset
  // them. `stats()` is a read; `lastFailures` is per-fill by construction.
  const codes = codesOf(input.embedder);

  // WHOSE FAULT WAS IT. The give-up counter may only move on a failure the
  // PROVIDER blamed on the item: a 400 the bisector narrowed to one input. A
  // 429, a 5xx, a dead socket or an aborted watchdog is a fact about the RUN,
  // and counting those was I33 inverted — three bad boundaries in a row retired
  // a whole healthy window and `unembeddedCount` then read COMPLETE while those
  // memories stayed blind.
  //
  // The gate is per FILL, not per id, because a `ChunkFailure`'s offsets are
  // into the embedder's own deduped batch and do not address these ids. So a
  // fill that mixed an isolated 400 with a 500 elsewhere still charges the 500's
  // victims — strictly better than charging every failure, and the residue is
  // bounded by a run that saw poison at all. It is named in INTERFACE-GAPS.
  //
  // A LOCAL deterministic embedder (the static table) has only one way to miss:
  // the text itself has no token it knows. Its null today is its null tomorrow,
  // so every miss is the item's — without this, one emoji-only memory would be
  // offered to every run forever and `remaining` would never reach zero.
  const itemBlamed = itemAttributable(input.embedder) || isStatic(input.embedder);
  // ONE read of the counters, not one per id — the same bargain `missingVectors`
  // makes two levels down.
  let counters: Map<string, string>;
  try {
    counters = store.metaWithPrefix(EMBED_FAILED_PREFIX);
  } catch {
    counters = new Map<string, string>();
  }

  let embedded = 0;
  let failed = 0;
  // THE PER-ID GIVE-UP COUNTER (I33). An id that fails `EMBED_SKIP_AFTER` runs
  // ON ITS OWN TEXT stops being offered by `missingVectors`, so one poisoned row
  // cannot hold the head of a stable queue forever. Cleared the moment it lands,
  // and by `verify --retry-skipped` — which is the remedy a repaired title
  // needs, because a skipped id is never offered again and so cannot clear
  // itself. Staged here and written as ONE transaction below.
  const moves: [string, string][] = [];
  const refusals = new Set<string>();
  for (const id of wanted) {
    let landed = false;
    // The FILE refused the vector (held, ahead, or now another identity's —
    // `Store.embedOne`'s `refused`): a fact about the store, never about the
    // item, so it never moves the item's give-up counter.
    let refused: string | undefined;
    try {
      const got = store.embedOne(id);
      landed = got.vector;
      refused = got.refused;
    } catch {
      landed = false;
    }
    if (landed) embedded += 1;
    else failed += 1;
    if (refused !== undefined) refusals.add(`refused:${refused}`);
    const key = `${EMBED_FAILED_PREFIX}${id}`;
    const now = Number(counters.get(key) ?? "0");
    if (landed) {
      // Zero rather than deleted: `meta` has no delete on the write seam's
      // allowlist, and a zero reads identically everywhere it is consulted.
      // Nothing is written for the healthy case, which is every id on a good day.
      if (now !== 0) moves.push([key, "0"]);
    } else if (itemBlamed && refused === undefined) {
      moves.push([key, String(now + 1)]);
    }
  }
  writeCounters(counterpart, store, moves, emit);
  const named = [codes, ...refusals].filter((c) => c.length > 0).join(",");
  return done("ran", embedded, failed, wanted.length, named);
}

/** Did the last fill blame any ONE INPUT? Only then may a counter climb. */
function itemAttributable(embedder: LiveEmbedder): boolean {
  try {
    return embedder.stats().lastFailures.some((f) => f.item === true);
  } catch {
    return false;
  }
}

/** The distinct `code[:status]` pairs of the last fill, joined. Never text. */
function codesOf(embedder: LiveEmbedder): string {
  try {
    const seen = new Set<string>();
    for (const f of embedder.stats().lastFailures) {
      seen.add(f.status === undefined ? f.code : `${f.code}:${String(f.status)}`);
    }
    return [...seen].join(",");
  } catch {
    return "";
  }
}

/**
 * The run's counter moves, as ONE box-2 transaction.
 *
 * One `setMeta` per id was one write transaction — one lock acquisition — per
 * id, at a boundary where this adapter has measured six overlapping workers
 * against a 5 s busy timeout, and on exactly the run where things are already
 * going wrong. A write that loses that lock costs the counters, never the run
 * (§5 G2), which is why the whole thing sits inside one `try`.
 */
function writeCounters(
  counterpart: Counterpart,
  store: Counterpart["store"],
  moves: readonly (readonly [string, string])[],
  emit: Emit,
): void {
  if (counterpart.observer || moves.length === 0) return;
  try {
    store.setMetaMany(moves);
  } catch (err) {
    emit("vectors.backfill.count.failed", { code: err instanceof Error ? err.name : "UNKNOWN" });
  }
}
