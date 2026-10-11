/**
 * CONTRADICTIONS — the mechanism (2026-09-29). Reconsolidation and
 * interference: two memories that disagree are noticed, settled, and the
 * settlement is kept and can be undone. A file beside `revision.ts`, not a
 * module, for the reason `revision.ts` is one: it is the seam where a memory
 * that argues with another one lands, and every door reaches it. Its docs sit
 * with the revision dispatch (`schemas/CONTRACT.md` §5 and `schemas/NOTES.md`),
 * its table with the store (`contradictions`, `contradiction_settles`, schema
 * v10), its labels with recall (`recall/standing.ts`).
 *
 * **Three kinds, each with its own outcome** (`SETTLE_HOWS`, working
 * defaults from the 2026-09-29 brief, held lightly):
 *
 *   | how         | the memory it is over                                    |
 *   |-------------|----------------------------------------------------------|
 *   | `changed`   | its fade multiplier x CHANGED_FADE (`changedFade`), stays |
 *   |             | recallable, labelled `earlier`; a use leaves the fade     |
 *   | `corrected` | archived `corrected` — out of recall, readable by its own |
 *   |             | id, never deleted                                         |
 *   | `open`      | nothing moves; both are shown with each other             |
 *
 * **One way to settle, from anywhere.** A new memory settles the one it
 * `updates` as it is written (`settleOnWrite`, called by `revision.ts` in
 * place of the ordinary-memory "link-only" arm); a pair that already exists —
 * a dream's flag, where both memories are old — is settled by `settle`, which
 * the awake `note` tool, the dream's `settle` action, the reflection and the
 * owner's `counterparts settle` all reach. No gate on who: a TRAIL instead
 * (`contradiction_settles`: who, the kind, why, the ids, when), and every
 * settle can be undone (`undo`): the fade divided back out for `changed`, back
 * into recall for `corrected`, and the pair unsettled again when it was a flag
 * — withdrawn when nobody had flagged it (review of #284, S5).
 *
 * **Settling an existing pair rewrites no body.** Appending the journey line
 * to the winner would be a revision (a supersede, a forwarding address), which
 * fights the rule that an old id reads as itself. The record of an existing
 * pair is its trail row's `why` and the link; recall reads the rest off the
 * pair (`recall/standing.ts`). A new memory carries its journey line in its
 * own words, written by the model — the tool descriptions ask for it.
 *
 * **Noticing at write time** (`writeNeighbours`): the nearest few live
 * memories of one just written, above a similarity bar, handed back with the
 * write so the writer can settle there and then. No model call.
 *
 * **A write's word is checked before it settles** (`updateRelatedness`,
 * 2026-10-09). A `changed` or `corrected` declared by id moves the old
 * memory on the writer's word alone, and a weaker writer points at the wrong
 * one: in a 10-02 benchmark read, a Haiku writer named an unrelated memory in
 * about two thirds of 149 pairs (a mole removal retired a passport name
 * change). So the pair is read first — by meaning when the embedder can read
 * both, by shared content words when it cannot — and a pair that looks
 * unrelated is HELD: the new memory lands, the old one is not settled and
 * not linked, the writer is shown the old one's words and asked to settle it
 * itself if it meant to (`HELD_HINT`), and the hold is recorded
 * (`CONTRADICTION_HELD_EVENT`). No pair is written: an unrelated pair shown
 * as a disagreement would be noise. `Counterpart#deposit` decides when the
 * guard applies (a close or a redate goes straight through); this file reads
 * the pair. No model call.
 *
 * Arithmetic and bookkeeping only. Refusals are RETURNED with a reason and a
 * sentence, never thrown; an observer writes nothing and says so.
 */
import { randomBytes } from "node:crypto";

import { lineOf } from "./fit/index.js";
import { changedFade, cosine, unfade } from "./physics/index.js";
import { isHandoff } from "./recall/index.js";
import { similarity } from "./remember/index.js";
import { isStoreError, rowTombstoned } from "./store/index.js";
import type { ContradictionRow, MemoryRow, Store } from "./store/index.js";
import { SETTLE_HOWS } from "./types.js";
import type { SettleHow } from "./types.js";

export { SETTLE_HOWS } from "./types.js";
export type { SettleHow } from "./types.js";

/** Who settled: the trail's `actor`. */
export const SETTLE_ACTORS = ["session", "dream", "reflection", "page-writer", "owner", "dream-undo"] as const;
export type SettleActor = (typeof SETTLE_ACTORS)[number];

/** Working defaults, held lightly. */
export const CONTRADICTION_TUNABLES = {
  /** Characters of a settle's `why` kept (a short reason, not an essay). */
  WHY_CHARS: 300,
  /** Most neighbours handed back with a write (the brief's "2–3"). */
  NEIGHBOURS: 3,
  /** Candidates read per neighbour search, from each channel. */
  NEIGHBOUR_CANDIDATES: 8,
  /**
   * Word-overlap bar (token cosine, `remember/similarity`) a neighbour must
   * clear. `updates:` resolution takes 0.55 as "the same memory"; a memory
   * that might disagree shares the subject, not the wording, so lower. CAL.
   */
  NEIGHBOUR_LEXICAL: 0.4,
  /**
   * Meaning bar (the embedder's cosine) a neighbour may clear instead. The
   * static table's related pairs averaged 0.58 in the 2026-09-23 trial and
   * unrelated ones 0.06; a disagreement about the same thing sits well above
   * the related mean. CAL.
   */
  NEIGHBOUR_COSINE: 0.7,
  /** Characters of each neighbour's excerpt. */
  EXCERPT_CHARS: 160,
  /** Most neighbours one `session_end` call lists across all its entries (review of #284, M1). */
  NEIGHBOURS_PER_CALL: 12,
  /**
   * THE UPDATE GUARD's meaning bar (2026-10-09): the embedder's cosine
   * between a write and the memory it says it changes or corrects, below
   * which the pair looks unrelated and the settle is held. Calibrated on 120
   * labelled pairs (61 related, 59 not: the demo store's script and
   * hand-written life and work facts) under potion-base-8M: at 0.30, 50 of 61
   * related passed and 58 of 59 unrelated were held (the one that passed, at
   * 0.37, is two demo notes about reading screens). Unrelated pairs topped
   * out at 0.29; a short mole/passport pair scored 0.28. CAL.
   */
  UPDATE_COSINE: 0.3,
  /** Characters of a held memory's text shown back to the writer: enough to judge by. */
  HELD_TEXT_CHARS: 600,
  /** Most rows `heldCorrections` reads of each name (holds newest first). */
  HELD_READ_ROWS: 5000,
} as const;

/** The archive reason a `corrected` memory carries. */
export const CORRECTED_REASON = "corrected";

/** Durable event names (`dashboard/registries.ts` and `fired.ts` read them). */
export const CONTRADICTION_FLAGGED_EVENT = "contradiction.flagged";
export const CONTRADICTION_SETTLED_EVENT = "contradiction.settled";
export const CONTRADICTION_UNDONE_EVENT = "contradiction.undone";
/** A write's `updates` that looked unrelated, so nothing was settled (2026-10-09). */
export const CONTRADICTION_HELD_EVENT = "contradiction.held";

/** The one line a write's result carries beside its neighbours. */
export const NEIGHBOURS_HINT =
  "These existing memories are close to what you just wrote. If the new memory changes, corrects or disagrees with one of them, settle it now: remember with settle {holds, over, how, why}.";

/** The same ask, for the memory a write named in `updates` that looked unrelated to it (2026-10-09). */
export const HELD_HINT =
  "The memory you named in updates looks unrelated to what you just wrote (few words in common, not close in meaning), so it was left as it was: not changed, not corrected, not linked. Its title and text are here. If the new memory does change or correct it, settle it now: remember with settle {holds, over, how, why}. If not, do nothing.";

export type SettleRefusal =
  | "observer"
  | "how-unknown"
  | "pair-unknown"
  | "pair-withdrawn"
  | "already-settled"
  | "holds-required"
  | "not-in-pair"
  | "same-memory"
  | "unknown-memory"
  | "removed"
  | "not-a-memory"
  | "moved-on"
  | "archived"
  | "protected"
  | "core-takes-pressure"
  | "failed";

export type SettleOutcome =
  | {
      readonly ok: true;
      readonly pair: string;
      readonly how: SettleHow;
      readonly holds: string | null;
      readonly over: string | null;
      /** A `changed` memory's cut: strength before and after, rounded. Null when there was nothing to cut. */
      readonly faded: { readonly id: string; readonly before: number; readonly after: number } | null;
      /** A `corrected` memory, now archived. */
      readonly archived: string | null;
      /** Unsettled pairs this settle closed through itself. */
      readonly closed: readonly string[];
      readonly note?: string;
    }
  | { readonly ok: false; readonly reason: SettleRefusal; readonly detail: string };

export interface SettleInput {
  /** An existing pair, by id (`ctr_…`). */
  readonly pair?: string;
  /** The memory that holds (changed / corrected); for `open`, one of the two. */
  readonly holds?: string;
  /** The memory it is over; for `open`, the other. */
  readonly over?: string;
  readonly how: string;
  readonly why?: string | null;
  readonly actor: SettleActor;
  /** The session, dream or reflection id. */
  readonly actorId?: string | null;
  readonly day?: number;
}

function refuse(reason: SettleRefusal, detail: string): SettleOutcome {
  return { ok: false, reason, detail };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function newPairId(): string {
  return `ctr_${randomBytes(6).toString("hex")}`;
}

/** A settle's reason, trimmed and kept to its length; null when empty. */
export function cleanWhy(why: string | null | undefined): string | null {
  const t = (why ?? "").replace(/\s+/g, " ").trim();
  return t.length === 0 ? null : t.slice(0, CONTRADICTION_TUNABLES.WHY_CHARS);
}

/** Read a `how` field: a known kind, or null. */
export function readHow(v: unknown): SettleHow | null {
  return typeof v === "string" && (SETTLE_HOWS as readonly string[]).includes(v) ? (v as SettleHow) : null;
}

/** Can this pair show — both its memories live, un-superseded, with words? */
export function pairStanding(store: Pick<Store, "row">, pair: ContradictionRow): boolean {
  const live = (id: string): boolean => {
    const r = store.row(id);
    return r !== undefined && r.archived === 0 && r.superseded_by === null && !rowTombstoned(r);
  };
  return live(pair.a) && live(pair.b);
}

/**
 * The checks a memory in a settle must pass, as a refusal or null. `moves` is
 * true for the memory a `changed` / `corrected` settle is OVER — the one whose
 * standing changes, which the owner's protection and the core's slower path
 * guard (`revision.ts`'s dispatch: protected refuses, identity takes pressure).
 */
function memoryRefusal(store: Store, id: string, moves: boolean): SettleOutcome | null {
  const row = store.row(id);
  if (row === undefined) return refuse("unknown-memory", `There is no memory ${id}.`);
  if (rowTombstoned(row)) return refuse("removed", `${id} was removed by the owner.`);
  if (row.type !== "memory") {
    return refuse(
      "not-a-memory",
      `${id} is not a memory (a ${row.type} row): a belief or an entity changes through a new memory that updates it, and a journal chapter is not a claim.`,
    );
  }
  if (row.superseded_by !== null) {
    return refuse("moved-on", `${id} was replaced by ${row.superseded_by}; settle with that one.`);
  }
  if (row.archived === 1) return refuse("archived", `${id} is archived (${row.archived_reason ?? "archived"}), so it is out of recall already.`);
  if (moves && row.protected === 1) return refuse("protected", `${id} is protected by the owner: it can be marked open, never changed or corrected.`);
  if (moves && (row.band === "identity" || row.promoted_identity === 1)) {
    return refuse(
      "core-takes-pressure",
      `${id} is a core memory: it changes only slowly, through a new memory that updates it (pressure over days). It can be marked open now.`,
    );
  }
  return null;
}

/**
 * SETTLE A PAIR — the one settle, whoever calls it. An existing pair by
 * `pair` (a dream's flag, say), or two memories by `holds` and `over` (a
 * standing pair between them is found and used). `changed` cuts the strength
 * of the one it is over through physics; `corrected` archives it; `open`
 * moves nothing. Writes the pair, the trail row and a durable event.
 */
export function settle(store: Store, input: SettleInput, opts: { closeFlags?: boolean; source?: string } = {}): SettleOutcome {
  if (store.observer) return refuse("observer", "This session is an observer: it reads the store and writes nothing. Nothing was settled.");
  const how = readHow(input.how);
  if (how === null) return refuse("how-unknown", `how is one of ${SETTLE_HOWS.join(", ")}.`);
  const day = input.day ?? store.livedDay();

  let pair: ContradictionRow | undefined;
  let holds = input.holds?.trim() || undefined;
  let over = input.over?.trim() || undefined;
  if (input.pair !== undefined && input.pair.trim().length > 0) {
    pair = store.contradiction(input.pair.trim());
    if (pair === undefined) return refuse("pair-unknown", `There is no contradiction ${input.pair}.`);
    if (pair.state === "withdrawn") return refuse("pair-withdrawn", `${pair.id} was withdrawn: the dream that flagged it was undone.`);
    const members = [pair.a, pair.b];
    if (holds !== undefined && !members.includes(holds)) return refuse("not-in-pair", `${holds} is not one of ${pair.id}'s two memories (${pair.a}, ${pair.b}).`);
    if (over !== undefined && !members.includes(over)) return refuse("not-in-pair", `${over} is not one of ${pair.id}'s two memories (${pair.a}, ${pair.b}).`);
    if (holds === undefined && over !== undefined) holds = over === pair.a ? pair.b : pair.a;
    if (holds === undefined) {
      if (how !== "open") return refuse("holds-required", `Say which memory holds now: holds is ${pair.a} or ${pair.b}.`);
      holds = pair.b;
    }
    over = holds === pair.a ? pair.b : pair.a;
  } else {
    if (holds === undefined || over === undefined) {
      return refuse("holds-required", "Name the pair (pair: its id), or both memories: holds (the one that holds now) and over (the one it changes, corrects or disagrees with).");
    }
    if (holds === over) return refuse("same-memory", `holds and over are both ${holds}.`);
    pair = store.contradictionBetween(holds, over);
  }
  if (pair !== undefined && pair.state === "settled") {
    // Said in the caller's own terms (review of #284, M3): the owner has the
    // undo; anyone else is told to raise it with the owner.
    const again =
      input.actor === "owner"
        ? `Undo it first — counterparts settle --undo ${pair.via ?? pair.id} — then settle again.`
        : `If it is settled wrongly, tell the owner: undoing a settle is theirs (counterparts settle --undo ${pair.via ?? pair.id}).`;
    return refuse("already-settled", `${pair.id} is already settled (${pair.how ?? "settled"}${pair.via === null ? "" : `, through ${pair.via}`}). ${again}`);
  }
  const moves = how !== "open";
  const bad = memoryRefusal(store, over, moves) ?? memoryRefusal(store, holds, false);
  if (bad !== null) return bad;

  const why = cleanWhy(input.why);
  let fade: { id: string; fade: number } | null = null;
  let faded: { id: string; before: number; after: number } | null = null;
  const notes: string[] = [];
  const detail: Record<string, unknown> = {};
  if (how === "changed") {
    const physics = store.physicsOf(over);
    const cut = changedFade(physics, day);
    if (cut === null) {
      notes.push(`${over} has nothing to cut; it keeps its place as the earlier one.`);
    } else {
      // THE FADE MULTIPLIER (review of #284, B1): the cut is a factor on
      // strength, recorded so an undo divides exactly that factor back out —
      // in any order, whatever uses came since. `lastUsedDay` is not touched.
      fade = { id: over, fade: cut.fade };
      faded = { id: over, before: round(cut.before), after: round(cut.after) };
      detail["fade"] = { id: over, factor: cut.factor, before: faded.before, after: faded.after };
    }
  }
  const archive = how === "corrected" ? { id: over, reason: CORRECTED_REASON } : null;
  if (archive !== null) detail["archived"] = over;
  // A FLAG CLOSES WHEN ITS QUESTION IS ANSWERED ELSEWHERE (write-time): a new
  // memory that settles one of an unsettled pair's two closes that pair
  // through its own, so the older memory is not labelled twice.
  const closes =
    opts.closeFlags === true
      ? (store.contradictionsOf([over]).get(over) ?? []).filter((c) => c.state === "unsettled" && c.id !== pair?.id).map((c) => c.id)
      : [];
  const holdsCol = how === "open" ? null : holds;
  const overCol = how === "open" ? null : over;
  let pairId: string;
  try {
    const out = store.settleContradiction({
      ...(pair === undefined ? { newId: newPairId(), x: holds, y: over, source: opts.source ?? "settle" } : { pairId: pair.id }),
      how,
      holds: holdsCol,
      over: overCol,
      actor: input.actor,
      actorId: input.actorId ?? null,
      why,
      day,
      fade,
      archive,
      closes,
      detail,
    });
    pairId = out.pairId;
  } catch (err) {
    return refuse("failed", `Nothing was settled: ${isStoreError(err) ? err.code : String((err as Error).message ?? err)}.`);
  }
  store.appendEvent({
    name: CONTRADICTION_SETTLED_EVENT,
    day,
    ref: pairId,
    payload: {
      pair: pairId,
      how,
      holds: holdsCol,
      over: overCol,
      actor: input.actor,
      actorId: input.actorId ?? null,
      faded: faded !== null,
      archived: archive !== null,
      closed: closes.length,
      day,
    },
  });
  return {
    ok: true,
    pair: pairId,
    how,
    holds: holdsCol,
    over: overCol,
    faded,
    archived: archive?.id ?? null,
    closed: closes,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/**
 * A NEW MEMORY SETTLES THE ONE IT `updates`, as it is written — the arm of
 * `revision.ts` that used to be "link only" for an ordinary memory. `holds`
 * is the new memory; `over` the one it updates. Closes any unsettled pair
 * that named the old one. The link itself is already written (`meta.updates`).
 */
export function settleOnWrite(
  store: Store,
  input: { newId: string; targetId: string; how: SettleHow; actorId: string | null; day: number },
): SettleOutcome {
  return settle(
    store,
    { holds: input.newId, over: input.targetId, how: input.how, actor: "session", actorId: input.actorId, day: input.day },
    { closeFlags: true, source: "write" },
  );
}

/** FLAG A PAIR that disagrees (a dream's `contradiction`, today): unsettled, idempotent. */
export function flag(
  store: Store,
  input: { x: string; y: string; source: string; day?: number; dreamId?: string | null; dreamSeq?: number | null },
): { ok: true; pair: string; created: boolean; state: string } | { ok: false; reason: string; detail: string } {
  if (store.observer) return { ok: false, reason: "observer", detail: "This session is an observer: nothing was flagged." };
  const day = input.day ?? store.livedDay();
  try {
    const out = store.flagContradiction({
      id: newPairId(),
      x: input.x,
      y: input.y,
      source: input.source,
      day,
      dreamId: input.dreamId ?? null,
      dreamSeq: input.dreamSeq ?? null,
    });
    if (out.created) {
      store.appendEvent({
        name: CONTRADICTION_FLAGGED_EVENT,
        day,
        ref: out.id,
        payload: { pair: out.id, source: input.source, dream: input.dreamId ?? null, day },
      });
    }
    return { ok: true, pair: out.id, created: out.created, state: out.state };
  } catch (err) {
    return { ok: false, reason: "failed", detail: isStoreError(err) ? err.code : String((err as Error).message ?? err) };
  }
}

export type UndoOutcome =
  | {
      readonly ok: true;
      readonly pair: string;
      readonly how: string | null;
      /** Where the pair went: `unsettled` (it was a flag) or `withdrawn` (it never was). */
      readonly state: "unsettled" | "withdrawn";
      /** The `changed` memory's strength was put back. */
      readonly restored: string | null;
      /** The `corrected` memory is back in recall. */
      readonly unarchived: string | null;
      /** Pairs the settle had closed, unsettled again. */
      readonly reopened: readonly string[];
      readonly note?: string;
    }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

/**
 * UNDO A SETTLE: a `changed` memory's fade has this settle's factor divided
 * back out (exact, in any order, whatever uses came since — review of #284,
 * S4), a `corrected` memory comes back into recall, and the pair goes back to
 * where it came from: UNSETTLED when it was a flag (a dream's, or one that
 * pressure recorded), so it is raised afresh with its habituation reset, and
 * WITHDRAWN when it was never flagged — a write-time or a direct settle, which
 * nobody raised as a question (S5). Flags the settle closed through itself
 * are unsettled again. Recorded on the trail.
 */
export function undo(
  store: Store,
  input: { pair: string; actor: SettleActor; actorId?: string | null; why?: string | null; day?: number },
): UndoOutcome {
  if (store.observer) return { ok: false, reason: "observer", detail: "This session is an observer: nothing was undone." };
  const day = input.day ?? store.livedDay();
  const pair = store.contradiction(input.pair.trim());
  if (pair === undefined) return { ok: false, reason: "pair-unknown", detail: `There is no contradiction ${input.pair}.` };
  if (pair.via !== null) {
    return { ok: false, reason: "closed-through", detail: `${pair.id} was closed through ${pair.via}; undo that one.` };
  }
  if (pair.state !== "settled") return { ok: false, reason: "not-settled", detail: `${pair.id} is ${pair.state}; there is no settle to undo.` };
  const last = store
    .contradictionSettles({ pairId: pair.id })
    .filter((s) => s.action === "settle" && s.undone === 0)
    .pop();
  if (last === undefined) return { ok: false, reason: "no-settle", detail: `${pair.id} has no settle on its trail to undo.` };
  const d = settleDetail(last.detail);
  const notes: string[] = [];
  let restore: { id: string; fade: number } | null = null;
  if (d.fade !== null) {
    const now = store.row(d.fade.id);
    if (now !== undefined) restore = { id: d.fade.id, fade: unfade(typeof now.fade === "number" ? now.fade : 1, d.fade.factor) };
  }
  const reopen = d.closes.filter((c) => store.contradiction(c)?.via === pair.id);
  const back = wasFlagged(pair) ? "unsettled" : "withdrawn";
  let unarchived = false;
  try {
    const out = store.undoContradictionSettle({
      pairId: pair.id,
      settleSeq: last.seq,
      actor: input.actor,
      actorId: input.actorId ?? null,
      why: cleanWhy(input.why),
      day,
      state: back,
      restore,
      unarchive: d.archived === null ? null : { id: d.archived, reason: CORRECTED_REASON },
      reopen,
      detail: { restored: restore?.id ?? null, archived: d.archived, reopened: reopen, state: back },
    });
    unarchived = out.unarchived;
  } catch (err) {
    return { ok: false, reason: "failed", detail: `Nothing was undone: ${isStoreError(err) ? err.code : String((err as Error).message ?? err)}.` };
  }
  // A reopened question starts fresh on "my mind" (review of #284, M5).
  for (const id of back === "unsettled" ? [pair.id, ...reopen] : reopen) resetHabituation(store, id, day);
  if (d.archived !== null && !unarchived) notes.push(`${d.archived} has moved on since it was archived, so it was not brought back.`);
  store.appendEvent({
    name: CONTRADICTION_UNDONE_EVENT,
    day,
    ref: pair.id,
    payload: { pair: pair.id, how: pair.how, actor: input.actor, restored: restore !== null, unarchived, reopened: reopen.length, state: back, day },
  });
  return {
    ok: true,
    pair: pair.id,
    how: pair.how,
    state: back,
    restored: restore?.id ?? null,
    unarchived: unarchived ? d.archived : null,
    reopened: reopen,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/** Was this pair a question somebody raised — a dream's flag, or one pressure recorded — rather than a settle's own row? */
export function wasFlagged(pair: Pick<ContradictionRow, "source" | "dream_id">): boolean {
  return pair.source === "dream" || pair.source === "pressure" || pair.dream_id !== null;
}

/** A settle's trail detail, read tolerantly: the fade it applied, the memory it archived, the flags it closed. */
export function settleDetail(raw: string): { fade: { id: string; factor: number } | null; archived: string | null; closes: string[] } {
  let d: Record<string, unknown> = {};
  try {
    d = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    d = {};
  }
  const f = d["fade"] as { id?: unknown; factor?: unknown } | undefined;
  return {
    fade: f !== undefined && typeof f.id === "string" && typeof f.factor === "number" ? { id: f.id, factor: f.factor } : null,
    archived: typeof d["archived"] === "string" ? (d["archived"] as string) : null,
    closes: Array.isArray(d["closes"]) ? (d["closes"] as unknown[]).filter((x): x is string => typeof x === "string") : [],
  };
}

/** "My mind"'s habituation for a pair, back to none. Bookkeeping only; never throws. */
function resetHabituation(store: Store, pairId: string, day: number): void {
  try {
    if (store.getMeta(`${MIND_SEEN_KEY_PREFIX}${pairId}`) !== undefined) {
      store.setMeta(`${MIND_SEEN_KEY_PREFIX}${pairId}`, JSON.stringify({ times: 0, day }));
    }
  } catch {
    /* bookkeeping */
  }
}

/** `dream/mind.ts#MIND_SEEN_PREFIX`, spelled here because this file sits below `dream/`. */
const MIND_SEEN_KEY_PREFIX = "mind.seen.";

/** One neighbour of a memory just written: enough to recognise it and decide. */
export interface Neighbour {
  readonly id: string;
  readonly title: string | null;
  readonly excerpt: string;
}

function excerptOf(body: string, chars: number): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= chars) return flat;
  const hard = flat.slice(0, Math.max(0, chars - 1));
  const space = hard.lastIndexOf(" ");
  return `${space > chars * 0.6 ? hard.slice(0, space) : hard}…`;
}

/**
 * THE NEAREST FEW LIVE MEMORIES of one just written (2026-09-29), for the
 * writer to settle there and then. Candidates from both channels — the
 * embedder's nearest vectors when there are any, and the token index — and a
 * candidate is kept when it clears either bar: word overlap
 * (`NEIGHBOUR_LEXICAL`) or meaning (`NEIGHBOUR_COSINE`). Only what could
 * surface for this writer: live, un-superseded memory rows with words — not a
 * journal chapter, a handoff, a schema row, the memory it `updates`, or a
 * confidential one outside the owner's session. No model call; bounded.
 */
export function writeNeighbours(
  store: Store,
  input: { id: string; exclude?: readonly string[]; owner: boolean; limit?: number },
): Neighbour[] {
  const T = CONTRADICTION_TUNABLES;
  const row = store.row(input.id);
  if (row === undefined || rowTombstoned(row)) return [];
  const text = `${row.title ?? ""}\n${row.body}`;
  const skip = new Set<string>([input.id, ...(input.exclude ?? [])]);
  const vec = (() => {
    try {
      return store.vectorOf(input.id);
    } catch {
      return null;
    }
  })();
  const cosByHit = new Map<string, number>();
  const candidates: string[] = [];
  if (vec !== null) {
    try {
      for (const h of store.nearestTo(vec, T.NEIGHBOUR_CANDIDATES + skip.size)) {
        cosByHit.set(h.id, h.score);
        candidates.push(h.id);
      }
    } catch {
      /* no vectors to rank: the words decide */
    }
  }
  try {
    for (const h of store.search(text, T.NEIGHBOUR_CANDIDATES + skip.size)) candidates.push(h.id);
  } catch {
    /* an unreadable index answers nothing */
  }
  const scored: { id: string; score: number; row: MemoryRow }[] = [];
  const seen = new Set<string>();
  for (const id of candidates) {
    if (seen.has(id) || skip.has(id)) continue;
    seen.add(id);
    const c = store.row(id);
    if (c === undefined || c.type !== "memory" || c.archived === 1 || c.superseded_by !== null || rowTombstoned(c)) continue;
    if (c.confidential === 1 && !input.owner) continue;
    try {
      if (isHandoff(store.readProse(id))) continue;
    } catch {
      continue;
    }
    const lex = similarity(text, `${c.title ?? ""}\n${c.body}`);
    let cos = cosByHit.get(id) ?? null;
    if (cos === null && vec !== null) {
      const other = store.vectorOf(id);
      if (other !== null && other.length === vec.length) cos = cosine(vec, other);
    }
    if (lex < T.NEIGHBOUR_LEXICAL && (cos === null || cos < T.NEIGHBOUR_COSINE)) continue;
    scored.push({ id, score: Math.max(lex, cos ?? 0), row: c });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return scored.slice(0, input.limit ?? T.NEIGHBOURS).map((s) => ({
    id: s.id,
    title: s.row.title === null || s.row.title.trim().length === 0 ? lineOf({ body: s.row.body }) || null : s.row.title,
    excerpt: excerptOf(s.row.body, T.EXCERPT_CHARS),
  }));
}

// ── THE UPDATE GUARD (2026-10-09) ───────────────────────────────────────────

/**
 * Words every memory shares, so sharing one says nothing: function words,
 * the words a writer uses about writing ("updated", "corrected", "user"),
 * and dates' words. The benchmark harness's list (`tools/longmemeval/store.ts`
 * on `bench/longmemeval`, 10-02), kept as it was.
 */
const GUARD_STOP: ReadonlySet<string> = new Set(
  (
    "the and for with that this from have has had was were are been being its it's his her hers their theirs they them " +
    "she he him you your yours our ours who what when where which while about into onto over under after before again " +
    "also just very more most some any all each every other another than then there here not but can could would should " +
    "will did does doing done one two three new old now still only same such per via upon user user's users assistant " +
    "said says say mentioned mentions told tell asked asks noted shared memory memories conversation today yesterday " +
    "week weeks month months year years day days time times date dated " +
    "change changed changes changing update updated updates updating correct corrected correction latest current " +
    "january february march april may june july august september october november december " +
    "monday tuesday wednesday thursday friday saturday sunday"
  ).split(" "),
);

/**
 * A text's content words, the benchmark harness's loose rule: letters only
 * (numbers and dates are shared by everything), three or more long, no
 * stopword and nothing in `ignore` (the owner's names, which half the store
 * says), cut to a five-letter stem.
 */
export function contentWords(text: string, ignore: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z']+/)) {
    const t = w.replace(/^'+|'+$/g, "").replace(/'s$/, "");
    if (t.length < 3 || GUARD_STOP.has(t) || ignore.has(t)) continue;
    out.add(t.replace(/(ing|ed|es|s)$/, "").slice(0, 5));
  }
  return out;
}

/** How a write and the memory it `updates` read against each other. */
export interface UpdateRelatedness {
  /** True: settle as declared. False: hold. */
  readonly related: boolean;
  /** Which reading decided: `meaning` when there were two vectors to compare, `words` otherwise. */
  readonly by: "meaning" | "words";
  /** The embedder's cosine, rounded, when there were two vectors. */
  readonly cosine: number | null;
  /** The content words the two share (stems). */
  readonly shared: readonly string[];
}

/**
 * IS THIS THE MEMORY THE WRITE IS ABOUT? Read by MEANING when both vectors
 * are there: the cosine clears `UPDATE_COSINE` or the pair looks unrelated.
 * The words do not vote then: on the labelled pairs they added nothing but
 * mistakes — as a second requirement they held 20 related pairs where meaning
 * alone held 11, and as a second way in they passed 12 unrelated pairs that
 * shared a common word ("back", "because", "staff"). Read by WORDS when the
 * embedder cannot read both (no embedder, or two widths): related when the
 * two share a content word, or when the old memory has none to share. Pure.
 */
export function updateRelatedness(input: {
  /** The memory named in `updates`: its title and text. */
  readonly over: string;
  /** The memory being written: its title and text. */
  readonly text: string;
  readonly overVec?: readonly number[] | null;
  readonly textVec?: readonly number[] | null;
  /** Names that say nothing here — the owner's (`sleep/consolidate.ts#ownerNames`), any case. */
  readonly ignoreNames?: readonly string[];
}): UpdateRelatedness {
  const ignore = new Set((input.ignoreNames ?? []).flatMap((n) => n.toLowerCase().split(/[^a-z']+/)).filter((w) => w.length >= 3));
  const a = contentWords(input.over, ignore);
  const b = contentWords(input.text, ignore);
  const shared = [...a].filter((w) => b.has(w));
  const x = input.overVec ?? null;
  const y = input.textVec ?? null;
  if (x !== null && y !== null && x.length > 0 && x.length === y.length) {
    const cos = cosine(x, y);
    return { related: cos >= CONTRADICTION_TUNABLES.UPDATE_COSINE, by: "meaning", cosine: round(cos), shared };
  }
  return { related: a.size === 0 || shared.length > 0, by: "words", cosine: null, shared };
}

/** A held `updates`, as the write's result carries it: the memory, in its own words. */
export interface HeldUpdate {
  /** The memory named in `updates`, left as it was. */
  readonly over: string;
  readonly title: string | null;
  /** Its text, cut at `HELD_TEXT_CHARS`; null when this session may not read it (confidential, not the owner's). */
  readonly text: string | null;
  /** The settle the writer declared. */
  readonly how: SettleHow;
  readonly by: UpdateRelatedness["by"];
  readonly cosine: number | null;
  /** How many content words the two share. */
  readonly shared: number;
}

/** A held memory's title and text, shaped for the writer (`HeldUpdate`). */
export function heldView(row: Pick<MemoryRow, "title" | "body" | "confidential">, owner: boolean): { title: string | null; text: string | null } {
  if (row.confidential === 1 && !owner) return { title: null, text: null };
  const title = row.title === null || row.title.trim().length === 0 ? lineOf({ body: row.body }) || null : row.title;
  return { title, text: excerptOf(row.body, CONTRADICTION_TUNABLES.HELD_TEXT_CHARS) };
}

/** One held `updates`, as its durable row recorded it (`CONTRADICTION_HELD_EVENT`). */
export interface HeldPair {
  readonly seq: number;
  /** The lived day it was held. */
  readonly day: number;
  /** The new memory, which said it changed or corrected… */
  readonly holds: string;
  /** …this one, which looked unrelated and was left as it was. */
  readonly over: string;
  readonly how: string;
  /** Which reading decided: `meaning` or `words`. */
  readonly by: string;
  /** Settled by hand afterwards (a `contradiction.settled` row naming the same two). */
  readonly settledAfter: boolean;
}

/**
 * HOW OFTEN THE GUARD FIRED — doctor's Contradictions line reads it
 * (2026-10-09). Holds since `sinceDay`, by which reading, and how many of them
 * the writer settled by hand afterwards (a `contradiction.settled` row naming
 * the same two memories): a hold later settled is most likely a related pair
 * the guard got wrong; one never settled is a wrong pointer caught, or a
 * writer that had no one to read its result (a write-up, the nightly
 * catch-up). `settledAfter / held` is the number that says whether the bar
 * (`UPDATE_COSINE`) holds back real corrections.
 */
export function heldCorrections(
  store: Pick<Store, "eventLog">,
  opts: { sinceDay?: number } = {},
): { held: number; settledAfter: number; byMeaning: number; byWords: number } {
  const holds = heldPairs(store, opts);
  return {
    held: holds.length,
    settledAfter: holds.filter((h) => h.settledAfter).length,
    byMeaning: holds.filter((h) => h.by === "meaning").length,
    byWords: holds.filter((h) => h.by === "words").length,
  };
}

/**
 * Every hold since `sinceDay`, NEWEST first, each with whether it was settled
 * by hand afterwards — what `counterparts settle` lists, so the owner can
 * settle one the guard held and was meant (`--holds <new> --against <old>`).
 */
export function heldPairs(store: Pick<Store, "eventLog">, opts: { sinceDay?: number } = {}): HeldPair[] {
  const limit = CONTRADICTION_TUNABLES.HELD_READ_ROWS;
  const read = (raw: string | null): Record<string, unknown> => {
    try {
      return JSON.parse(raw ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  // The newest holds, and the settles from the day of the oldest of them on —
  // both read NEWEST first (`eventLog` reads 500 rows unless told otherwise,
  // oldest first). Past the limit an ascending settle read kept the oldest
  // and dropped the newest, so the newest holds read as never settled
  // (2026-10-09, audit #1's last caller). Under the limit the same rows come
  // back, and `settledAfter` does not depend on their order.
  const holds = store
    .eventLog({ name: CONTRADICTION_HELD_EVENT, ...(opts.sinceDay === undefined ? {} : { sinceDay: opts.sinceDay }), order: "desc", limit })
    .map((e) => ({ seq: e.seq, day: e.day, p: read(e.payload) }));
  const from = holds.reduce((d, h) => Math.min(d, h.day), Number.POSITIVE_INFINITY);
  const settles =
    holds.length === 0
      ? []
      : store.eventLog({ name: CONTRADICTION_SETTLED_EVENT, sinceDay: from, order: "desc", limit }).map((e) => ({ seq: e.seq, p: read(e.payload) }));
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return holds.map((h) => ({
    seq: h.seq,
    day: h.day,
    holds: str(h.p["holds"]),
    over: str(h.p["over"]),
    how: str(h.p["how"]),
    by: str(h.p["by"]),
    settledAfter: settles.some((s) => s.seq > h.seq && s.p["holds"] === h.p["holds"] && s.p["over"] === h.p["over"]),
  }));
}
