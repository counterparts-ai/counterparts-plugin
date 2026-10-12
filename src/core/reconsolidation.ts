/**
 * RECONSOLIDATION (2026-09-29 as `contradictions.ts`; renamed 2026-10-11,
 * Group 2: noticing and updating are one process). Reconsolidation and
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
 * **One door for "A over B"** (2026-10-11, Group 2b; review 10 C1, R7).
 * Every path that marks one memory as standing in place of another calls
 * `supersede`: a settle, a write's `updates`, a slot confirmed, a dream merge
 * (source `dream-merge`), the core's pressure crossing (`pressure`), a
 * fulfilled plan (`fulfilled`), a moved reminder (`reminder-moved`), and next
 * Group 3's folds. It writes the pair and the trail and takes the effect from
 * `how` alone (decided by random-06, 2026-10-11, lightly held: no fourth
 * relation — a merge's originals and a crossed core memory fade, stay live and
 * are labelled earlier, like any `changed`). A core memory a change reaches
 * (only the core path's doors get there) leaves the core as it fades. A
 * memory that leaves recall (`corrected`) hands its links to the holder; a
 * pending reminder moves to it. `settle` reads its input and keeps the
 * guards, then goes through the same door. Not here: a
 * chapter's regrown copy (`episode-regrown`, one chapter's text re-rendered,
 * not one memory over another) and the schema belief / current-state arms
 * (no live producer).
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

import { Associate } from "./associate/index.js";
import { lineOf } from "./fit/index.js";
import { band, changedFade, cosine, fadeOf, strength, unfade } from "./physics/index.js";
import { CUE_MODE_META, DATE_FROM_META, DATE_MOVED_TO_META, cueModeOf, recurrenceOf } from "./prospective/index.js";
import { earlierMark, headOf, isHandoff } from "./recall/index.js";
import { similarity } from "./remember/index.js";
import { RECURRING_META, isStoreError, rowTombstoned, statusOf } from "./store/index.js";
import type { ContradictionRow, MemoryRow, Store } from "./store/index.js";
import { SETTLE_HOWS } from "./types.js";
import type { Band, MemoryPhysics, SettleHow } from "./types.js";

export { SETTLE_HOWS } from "./types.js";
export type { SettleHow } from "./types.js";

/** Who settled: the trail's `actor`. */
export const SETTLE_ACTORS = ["session", "dream", "reflection", "page-writer", "owner", "dream-undo", "detector"] as const;
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
  /**
   * THE GUARD'S BAR IS THE STORE'S (2026-10-11, Group 2; review 10 C3): an
   * `updates` is held when the pair is no closer than a typical random pair
   * IN THIS STORE — this quantile of `GUARD_BAR_PAIRS` random live pairs,
   * never under `UPDATE_COSINE`. 0.30 was the demo store's; on the owner's
   * one-topic store 81% of random pairs clear it (median 0.41), and the 60th
   * percentile, about 0.44, holds ~63% of random wrong pointers while every
   * one of 92 genuine pairs (lowest 0.50) passes. Measured once per lived day
   * and kept in `meta` (`GUARD_BAR_META`). CAL.
   */
  GUARD_BAR_QUANTILE: 0.6,
  /** Random pairs measured for the bar. */
  GUARD_BAR_PAIRS: 2000,
  /** Memories whose vectors the pairs are drawn from (one read each). */
  GUARD_BAR_SAMPLE: 400,
  /** Fewer memories with vectors than this, and the bar is `UPDATE_COSINE`: too few to say what is typical. */
  GUARD_BAR_MIN_VECTORS: 50,
  /** Characters of a held memory's text shown back to the writer: enough to judge by. */
  HELD_TEXT_CHARS: 600,
  /** Most rows `heldCorrections` reads of each name (holds newest first). */
  HELD_READ_ROWS: 5000,
  /**
   * THE SLOT DETECTOR's meaning bar (2026-10-11, Group 2; reviews 04 and 10
   * C2): a new memory is proposed as the newer state of an older one of the
   * same kind and the same `about` at the embedder's cosine of this or more.
   * Reviewer 10: 15 of 15 nearest-older pairs at 0.85 were the same slot; on
   * the 10-11 copy most fires at 0.85+ were. CAL.
   */
  SLOT_COSINE: 0.85,
  /**
   * The lower bar, when something else says it is one thing: the older was
   * `planned` and the newer is `done` (status lineage: 7 of 7 at 0.80, review
   * 10), or the two TITLES read as one at `SLOT_TITLE_COSINE`. CAL.
   */
  SLOT_LINEAGE_COSINE: 0.8,
  /**
   * Two titles this close name the same thing (2026-10-11): the bench's
   * "1250 followers" / "close to 1300" pair is 0.82 by its whole text and 0.89
   * by its titles, and on the 10-11 copy this arm added 2 proposals to 27. CAL.
   */
  SLOT_TITLE_COSINE: 0.85,
  /** Candidates are no older than this many lived days before the new memory ("recent similar traces interfere most"). */
  SLOT_WINDOW_DAYS: 7,
  /** Stored neighbours read per new memory, nearest first. */
  SLOT_CANDIDATES: 12,
  /**
   * The provisional cut on the older (`fade` x this) until the dream or the
   * writer confirms it (to `CHANGED_FADE` in all) or says they are two things
   * (put back). Mild, because cosine alone is not a reader (04 D1). CAL.
   */
  SLOT_FADE: 0.8,
  /** Proposals shown to one night's dream to confirm or undo, oldest first; the rest wait. CAL. */
  SLOT_PER_NIGHT: 4,
  /**
   * With dreaming OFF only (2026-10-11, Group 2b): lived days a proposal waits
   * for an answer before it is withdrawn and its cut put back. Two weeks: room
   * for the writer to settle it awake, short enough that cuts do not pile up. CAL.
   */
  SLOT_EXPIRY_DAYS: 14,
} as const;

/** Where the store's guard bar is kept, with the lived day it was measured (`guardBar`). */
export const GUARD_BAR_META = "reconsolidation.guardBar";

/** The `source` of a pair the slot detector proposed (no DDL: a TEXT value). */
export const SLOT_SOURCE = "slot";

/** The archive reason a `corrected` memory carries. */
export const CORRECTED_REASON = "corrected";

/** The `source` of the pair a declared `done` writes over the core plan it fulfils (2026-10-11, Group 2b; `revision.ts#fulfil`). */
export const FULFILLED_SOURCE = "fulfilled";

/** The `source` of the pairs a dream merge writes, one per original (`dream/index.ts#DREAM_MERGE_REASON`, spelled here: this file sits below `dream/`). */
export const DREAM_MERGE_SOURCE = "dream-merge";

/**
 * The `source` of the pairs a dream FOLD writes, one per source it fades
 * (2026-10-11, Group 3 part B; item 15): the fold holds over each part,
 * `changed`, through the one door — never a new path or a fourth relation.
 */
export const FOLD_SOURCE = "fold";

/**
 * The `source` of the flag a CORRECTION to a fold's source raises between the
 * fold and the memory that corrects it (2026-10-11, Group 3 part B): the fold
 * said what its parts added up to, and one of them was wrong. A question for
 * the waking self (or the dream), never a settle.
 */
export const FOLD_SOURCE_CORRECTED = "fold-source-corrected";

/** The archive reason of the successor a pressure crossing minted, when that crossing is undone (2026-10-11, Group 2b). */
export const PRESSURE_UNDONE_REASON = "pressure-undone";

/** Durable event names (`dashboard/registries.ts` and `fired.ts` read them). */
export const CONTRADICTION_FLAGGED_EVENT = "contradiction.flagged";
export const CONTRADICTION_SETTLED_EVENT = "contradiction.settled";
export const CONTRADICTION_UNDONE_EVENT = "contradiction.undone";
/** A write's `updates` that looked unrelated, so nothing was settled (2026-10-09). */
export const CONTRADICTION_HELD_EVENT = "contradiction.held";
/** The slot detector proposed a pair as one thing's earlier and later state (2026-10-11). */
export const CONTRADICTION_PROPOSED_EVENT = "contradiction.proposed";

/** The one line a write's result carries beside its neighbours. */
export const NEIGHBOURS_HINT =
  "These existing memories are close to what you just wrote. Is the new one the newer state of the same thing as one of them (a status moved on, a decision made, the latest release or result)? Then settle it now: remember with settle {holds: the new id, over: the old id, how: changed, why}. If it corrects one, how: corrected; if they disagree and you can't tell which holds, how: open. Otherwise do nothing.";

/** The line a write's result carries beside a slot the detector proposed (2026-10-11). */
export const SLOT_HINT =
  "This reads as the newer state of the same thing as the memory in `slot`, so that one was marked as possibly out of date and faded a little, provisionally; tonight's dream confirms or undoes it. If it is, settle it now: remember with settle {holds, over, how: changed, why}. If they are two different things, do nothing.";

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
  | "pending-date"
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

/** The settle's ask of whoever settled over a felt memory (2026-10-11): how does it sit now? */
export function feelingInvite(over: string, felt: number): string {
  return `${over} still carries a feeling (${String(round(felt))}, its latest). If it sits differently now that this holds, record how it feels now — a feeling-now on ${over} (remember's feelingsNow, a dream's feeling-now, a reflection's feelings); its weight follows the latest, and the first is kept.`;
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
 * What every door checks of both memories: there, not removed, a memory row,
 * not replaced, not archived. A refusal or null.
 */
function doorRefusal(store: Store, id: string): SettleOutcome | null {
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
  return null;
}

/**
 * The checks a memory in a SETTLE must pass, as a refusal or null: the
 * door's, and for the memory a `changed` / `corrected` settle is OVER
 * (`moves`) — the one whose standing changes — the owner's protection and the
 * core's slower path (`revision.ts`'s dispatch: protected refuses, identity
 * takes pressure). The doors that ARE the core's path (pressure, a fulfilled
 * plan) and the dream merge (its own refusals) call `supersede` directly.
 */
function memoryRefusal(store: Store, id: string, moves: boolean): SettleOutcome | null {
  const door = doorRefusal(store, id);
  if (door !== null) return door;
  const row = store.row(id) as MemoryRow;
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
 * SETTLE A PAIR — the settle, whoever calls it. An existing pair by `pair` (a
 * dream's flag, say), or two memories by `holds` and `over` (a standing pair
 * between them is found and used). Reads the input, refuses what a settle may
 * not do (the guards, the owner's protection, the core), then goes through
 * the one door (`supersede`): `changed` cuts the strength of the one it is
 * over, `corrected` archives it, `open` moves nothing.
 */
export function settle(store: Store, input: SettleInput, opts: { closeFlags?: boolean; source?: string; howSent?: boolean; retarget?: Retarget } = {}): SettleOutcome {
  if (store.observer) return refuse("observer", "This session is an observer: it reads the store and writes nothing. Nothing was settled.");
  const asked = readHow(input.how);
  if (asked === null) return refuse("how-unknown", `how is one of ${SETTLE_HOWS.join(", ")}.`);
  let how: SettleHow = asked;
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
  const reversalNotes: string[] = [];
  // THE OWNER'S SETTLE IS HIS RULING (decided by the coordinator, 2026-10-11,
  // lightly held): only he reverses a pair he settled; anyone else is told so.
  if (pair !== undefined && pair.state === "settled" && input.actor !== "owner" && isReversal(store, pair, holds, over, how, "owner") && settledByOwner(store, pair.id)) {
    return refuse(
      "already-settled",
      `${pair.id} is already settled: the owner settled ${over} over ${holds}, so it stands as his. Tell him: he can settle ${holds} over ${over} himself (counterparts settle --holds ${holds} --against ${over} --how changed --why "...") or undo it (counterparts settle --undo ${pair.id}).`,
    );
  }
  if (pair !== undefined && pair.state === "settled" && isReversal(store, pair, holds, over, how, input.actor)) {
    // AN EXPLICIT REVERSAL (2026-10-11, review of #432; random-06's ride-along,
    // lightly held): "B over C" while "C over B" stands names the same pair,
    // the other way — the way to say "B is current again". The standing settle
    // is undone (C's cut lifted, its trail kept), then B settles over C below.
    // Nothing half-done: what the reordered settle would refuse is refused
    // before anything is undone.
    const bad = memoryRefusal(store, over, true) ?? memoryRefusal(store, holds, false);
    if (bad !== null) return bad;
    const was = pair.id;
    const u = undo(store, { pair: pair.id, actor: input.actor, actorId: input.actorId ?? null, why: `reversed: ${holds} holds again over ${over}`, day }, opts.retarget === undefined ? {} : { retarget: opts.retarget });
    if (!u.ok) return refuse("already-settled", `${pair.id} is already settled (${over} over ${holds}) and could not be reversed: ${u.detail}`);
    reversalNotes.push(`${over} had held over ${holds} (${was}); that settle was undone and the two reordered.`);
    pair = store.contradictionBetween(holds, over);
  }
  if (pair !== undefined && pair.state === "settled") {
    // Said in the caller's own terms (review of #284, M3): the owner has the
    // undo; anyone else is told to raise it with the owner.
    const again =
      input.actor === "owner"
        ? `Undo it first — counterparts settle --undo ${pair.via ?? pair.id} — then settle again.`
        : `If it is settled wrongly, tell the owner: undoing a settle is theirs (counterparts settle --undo ${pair.via ?? pair.id}).`;
    // Which way it stands, so the writer knows what it would be asking.
    const stands = pair.holds !== null && pair.over !== null ? `: ${pair.holds} holds over ${pair.over}` : "";
    return refuse("already-settled", `${pair.id} is already settled (${pair.how ?? "settled"}${pair.via === null ? "" : `, through ${pair.via}`})${stands}. ${again}`);
  }
  // THE GUARDS (2026-10-11, Group 2; reviews 04, 07 and 10 C3), for every
  // settler but the owner, whose door has none:
  const guardNotes: string[] = [];
  if (how !== "open" && input.actor !== "owner") {
    const o = store.row(over);
    const h = store.row(holds);
    // A READING OR A WORLD MEMORY is not faded by a work or owner fact: the
    // one wrong settle reviews 04 and 10 found was a reading faded whole by a
    // fact about the owner that shared its topic. Kept side by side instead.
    if (o !== undefined && h !== undefined && slotExempt(o) && !slotExempt(h)) {
      how = "open";
      guardNotes.push(
        `${over} is a reading or a world memory and ${holds} is not, so it was not faded: the two were kept side by side (open). If one claim in it was wrong, write that claim, corrected, as a memory of its own.`,
      );
    }
  }
  const bad = memoryRefusal(store, over, how !== "open") ?? memoryRefusal(store, holds, false);
  if (bad !== null) return bad;
  return supersede(
    store,
    {
      holds,
      over,
      how,
      source: opts.source ?? "settle",
      actor: input.actor,
      actorId: input.actorId ?? null,
      why: input.why ?? null,
      day,
      ...(pair === undefined ? {} : { pair }),
      ...(how !== asked ? { asked } : {}),
      ...(opts.closeFlags === undefined ? {} : { closeFlags: opts.closeFlags }),
      ...(opts.howSent === undefined ? {} : { howSent: opts.howSent }),
      notes: [...reversalNotes, ...guardNotes],
    },
    opts.retarget === undefined ? {} : { retarget: opts.retarget },
  );
}

/** Was the standing settle on this pair the owner's (its newest settle not undone)? Never throws. */
function settledByOwner(store: Store, pairId: string): boolean {
  try {
    const last = store
      .contradictionSettles({ pairId })
      .filter((x) => x.action === "settle" && x.undone === 0)
      .pop();
    return last?.actor === "owner";
  } catch {
    return false;
  }
}

/**
 * IS "holds over over" THE STANDING `pair` THE OTHER WAY ROUND? (2026-10-11,
 * review of #432) — a settle the owner or a session may make to reorder the
 * pair it names (a session only when the owner did not settle it,
 * `settledByOwner`): `changed` (a `corrected` one archived what would hold now),
 * not closed through another, not a pressure crossing (its undo puts the
 * successor away), and not a reading the guard would keep side by side. A
 * dream or a reflection is still told to raise it (an undo of its batch could
 * not stand the old settle back up).
 */
function isReversal(store: Pick<Store, "row">, pair: ContradictionRow, holds: string, over: string, how: SettleHow, actor: SettleActor): boolean {
  if (actor !== "owner" && actor !== "session") return false;
  if (how === "open" || pair.via !== null || pair.how !== "changed" || pair.source === "pressure") return false;
  if (pair.holds !== over || pair.over !== holds) return false;
  if (actor === "owner") return true;
  const o = store.row(over);
  const h = store.row(holds);
  return !(o !== undefined && h !== undefined && slotExempt(o) && !slotExempt(h));
}

// ── THE ONE DOOR (2026-10-11, Group 2b; review 10 C1, R7) ───────────────────

/** Carries a memory's links to the one that holds over it: `Associate.retargetOnSupersede`, injected (SEAMS E). */
export type Retarget = (oldId: string, newId: string, day: number) => void;

/** One "A over B", whoever writes it. */
export interface SupersedeInput {
  /** The memory that holds now. */
  readonly holds: string;
  /** The memory it is over (for `open`, the other one). */
  readonly over: string;
  /** The effect, from this alone: `changed` fades, `corrected` archives, `open` moves nothing. */
  readonly how: SettleHow;
  /**
   * What made it (no DDL: a TEXT value): `write`, `settle`, `slot`, `pressure`,
   * `fulfilled`, `dream-merge`, `reminder-moved`, `fold` (Group 3 part B). The
   * dashboard counts by it.
   */
  readonly source: string;
  readonly actor: SettleActor;
  readonly actorId?: string | null;
  readonly why?: string | null;
  readonly day?: number;
  /** An existing pair to settle (a flag, a proposal, the pressure pair). Absent: a new one. */
  readonly pair?: ContradictionRow;
  /** `changed`'s cut on the memory it is over; absent, `CHANGED_FADE`. */
  readonly factor?: number;
  /** A write's `how`: sent by the writer (true) or defaulted (false). Absent: not a write's. */
  readonly howSent?: boolean;
  /** Close the unsettled pairs on the memory it is over (default: when it moves). */
  readonly closeFlags?: boolean;
  /** What the settler asked for, when a guard changed it. */
  readonly asked?: SettleHow;
  readonly notes?: readonly string[];
}

/** Where a reminder a `done` holder SPENT records who spent it (2026-10-11, review of #427): the date leaves the memory, kept in its version row. */
export const REMINDER_SPENT_BY_META = "reminderSpentBy";

/** A reminder a door moves: to the one that holds, or (`to` null) spent by a `done` holder. */
type ReminderMove = { from: string; fromMeta: Record<string, unknown>; to: string | null; eventDate: string; toMeta: Record<string, unknown> };

/** A `done` holder spends the memory's reminder: the date goes, so it does not fire on a plan already carried out; an undo puts it back. */
function reminderSpend(store: Store, from: string, by: string): ReminderMove | null {
  const date = store.row(from)?.event_date ?? null;
  return date === null ? null : { from, fromMeta: { [REMINDER_SPENT_BY_META]: by }, to: null, eventDate: date, toMeta: {} };
}

/** A reminder a door carries: from the memory it is over, to the one that holds. */
function reminderCarry(store: Store, from: string, to: string): ReminderMove | null {
  const date = store.row(from)?.event_date ?? null;
  if (date === null) return null;
  let mode: string = "quiet";
  let rule: unknown = null;
  try {
    const prose = store.readProse(from);
    mode = cueModeOf(prose);
    rule = recurrenceOf(prose);
  } catch {
    // Unreadable prose: the date still carries, at the default mode, once.
  }
  return {
    from,
    fromMeta: { [DATE_MOVED_TO_META]: to },
    to,
    eventDate: date,
    toMeta: { [CUE_MODE_META]: mode, [DATE_FROM_META]: from, ...(rule === null ? {} : { [RECURRING_META]: rule }) },
  };
}

/**
 * A OVER B, THROUGH THE ONE DOOR — what every path that marks one memory as
 * standing in place of another calls: a settle (awake, dream, reflection,
 * owner), a write's `updates`, a slot confirmed, a dream merge, the core's
 * pressure crossing and a fulfilled plan, a moved reminder (and Group 3's
 * folds). It writes the pair (or settles the one named), the trail row and the
 * durable event, and applies the effect from `how` alone — `changed`: the
 * fade multiplier (`factor`, `CHANGED_FADE` unless said); `corrected`:
 * archived; `open`: nothing. A CORE memory it moves (only the core path's
 * doors reach one: `settle` refuses the core) leaves the core first, its
 * fading restarted today, so the cut lands. A memory that leaves recall
 * (`corrected`) hands its links to the holder. A pending reminder on the
 * memory it is over is CARRIED to the holder (unless the holder is `done`:
 * the reminder is spent, and goes quiet with the earlier one); a holder
 * with a date of its own refuses (`pending-date`), but for the owner. The
 * unsettled pairs on the memory it is over are closed through it, a slot
 * proposal's provisional cut lifted, and all of it recorded so `undo` is
 * exact. No guards beyond the door's own checks: `settle` keeps those.
 */
export function supersede(store: Store, input: SupersedeInput, opts: { retarget?: Retarget } = {}): SettleOutcome {
  if (store.observer) return refuse("observer", "This session is an observer: it reads the store and writes nothing. Nothing was settled.");
  const { holds, over, how } = input;
  if (holds === over) return refuse("same-memory", `holds and over are both ${holds}.`);
  const bad = doorRefusal(store, over) ?? doorRefusal(store, holds);
  if (bad !== null) return bad;
  const day = input.day ?? store.livedDay();
  const pair = input.pair;
  const notes: string[] = [...(input.notes ?? [])];
  const detail: Record<string, unknown> = {};
  if (input.asked !== undefined && input.asked !== how) detail["asked"] = input.asked;
  if (input.howSent !== undefined) detail["howSent"] = input.howSent;

  // A PENDING REMINDER is never buried (07): settled over, it would go quiet.
  // It moves to the holder, as a write's `updates` moves it; a holder that is
  // `done` has spent it.
  let reminder: ReminderMove | null = null;
  if (how !== "open" && store.physicsOf(over).hold?.state === "pending") {
    const h = store.row(holds) as MemoryRow;
    if (statusOf(h.status ?? null) === "done") {
      // SPENT (review of #427): left on the earlier memory, a settled-over
      // date still fires — `prospective/` skips only a forwarded row.
      reminder = reminderSpend(store, over, holds);
      if (reminder !== null) {
        detail["reminder"] = { from: over, to: null, eventDate: reminder.eventDate };
        notes.push(`${over}'s reminder (${reminder.eventDate}) was spent: ${holds} says it is done.`);
      }
    } else if (h.event_date !== null) {
      if (input.actor !== "owner") {
        return refuse(
          "pending-date",
          `${over} holds a date still to come (${store.row(over)?.event_date ?? "a reminder"}) and ${holds} has a date of its own, so the reminder cannot move to it: settled over, it would go quiet. Settle open, or write the newer memory with updates: ${over}.`,
        );
      }
    } else {
      reminder = reminderCarry(store, over, holds);
      if (reminder !== null) {
        detail["reminder"] = { from: over, to: holds, eventDate: reminder.eventDate };
        notes.push(`${over}'s reminder (${reminder.eventDate}) moved to ${holds}.`);
      }
    }
  }

  // A FLAG CLOSES WHEN ITS QUESTION IS ANSWERED ELSEWHERE: every door that
  // moves the memory closes the unsettled pairs on it (Group 2; review 10 C5),
  // so it is not labelled twice. NOT a slot proposal in which this memory is
  // the NEWER (2026-10-11, Group 2b; review of #420 (a)): "B is the newer state
  // of A" is still a question when C settles over B — closing it lifted A's
  // cut and stood A back up as current. It stays for the dream; settles are
  // ordered by when they were raised (`recall/standing.ts#pairOrder`), so a
  // late confirmation cannot re-affirm B over C. A replaced B's proposal is
  // carried to what replaced it (`releaseOrphanSlots`).
  const closes =
    input.closeFlags === true || (input.closeFlags !== false && how !== "open")
      ? (store.contradictionsOf([over]).get(over) ?? [])
          .filter((c) => c.state === "unsettled" && c.id !== pair?.id)
          .filter((c) => !(c.source === SLOT_SOURCE && provisionalOf(store, c)?.holds === over))
          .map((c) => c.id)
      : [];
  // A SLOT PROPOSAL'S PROVISIONAL CUT (2026-10-11) is lifted by whatever
  // answers it — this settle, or one that closes it — so the settle's own
  // effect is the whole effect: confirmed `changed` lands at `CHANGED_FADE`,
  // not that times the provisional cut; `open` and `corrected` put it back.
  // Recorded (`lifts`), so an undo puts it on again with the pair unsettled.
  const answered = [...(pair === undefined ? [] : [pair]), ...closes.map((c) => store.contradiction(c)).filter((c): c is ContradictionRow => c !== undefined)];
  const lifts = answered.map((c) => provisionalOf(store, c)?.fade ?? null).filter((f): f is { id: string; factor: number } => f !== null);
  const lifted = new Map<string, number>();
  for (const l of lifts) lifted.set(l.id, unfade(lifted.get(l.id) ?? fadeOf(store.physicsOf(l.id)), l.factor));
  if (lifts.length > 0) detail["lifts"] = lifts;

  // OUT OF THE CORE (2026-10-11, Group 2b; review 10 C4): a core memory the
  // core path moves (a crossing's old memory, a fulfilled plan) goes back to
  // ordinary fading first, restarted today as the owner's demotion restarts
  // it, so the cut lands on it like any `changed`. Recorded, so an undo puts
  // it back in the core exactly. Not the owner's demotion: nothing sticky is
  // written, and the event says which door did it.
  const overRow = store.row(over) as MemoryRow;
  let leaveCore: { id: string; band: Band; lastUsedDay: number } | null = null;
  let decored: MemoryPhysics | null = null;
  if (how !== "open" && (overRow.promoted_identity === 1 || overRow.band === "identity")) {
    const lastUsedDay = Math.max(overRow.last_used_day, day);
    decored = { ...store.physicsOf(over), promotedIdentity: false, lastUsedDay };
    leaveCore = { id: over, band: band(decored, day), lastUsedDay };
    detail["core"] = { band: overRow.band, bandDay: overRow.band_day ?? null, lastUsedDay: overRow.last_used_day, promoted: overRow.promoted_identity === 1 };
    notes.push(`${over} left the core: it fades now like any memory, earlier under ${holds}.`);
  }

  let fade: { id: string; fade: number } | null = null;
  let faded: { id: string; before: number; after: number } | null = null;
  if (how === "changed") {
    const physics = decored ?? store.physicsOf(over);
    const base = lifted.has(over) ? { ...physics, fade: lifted.get(over) as number } : physics;
    const cut = changedFade(base, day, input.factor);
    if (cut === null) {
      notes.push(`${over} has nothing to cut; it keeps its place as the earlier one.`);
    } else {
      // THE FADE MULTIPLIER (review of #284, B1): the cut is a factor on
      // strength, recorded so an undo divides exactly that factor back out —
      // in any order, whatever uses came since. `lastUsedDay` is not touched.
      fade = { id: over, fade: cut.fade };
      faded = { id: over, before: round(strength(physics, day)), after: round(cut.after) };
      detail["fade"] = { id: over, factor: cut.factor, before: faded.before, after: faded.after };
    }
  }
  const liftPatches = [...lifted].filter(([id]) => fade === null || id !== fade.id).map(([id, f]) => ({ id, fade: f }));
  // HOW IT SITS NOW (2026-10-11, Group 2, Mike): a memory's weight follows
  // its latest feeling, so whoever settles over a felt memory is asked to say
  // how it sits now that the newer one holds. The first feeling is kept. Not
  // for a merge (its feelings travelled to the merged memory) nor a moved
  // reminder's row (bookkeeping nobody wrote), nor a fold (a dream cannot
  // answer it; a strongly felt self or person part is kept out of the fold).
  if (how !== "open" && input.source !== DREAM_MERGE_SOURCE && input.source !== REMINDER_MOVED_SOURCE && input.source !== FOLD_SOURCE) {
    const felt = store.row(over)?.feeling_peak ?? null;
    if (typeof felt === "number" && felt > 0) notes.push(feelingInvite(over, felt));
  }
  // OUT OF RECALL: archived `corrected`. The reason is recorded, so an undo
  // brings it back, and its links go to the holder (`retarget`), so the sweep
  // of rows archived for good drops nothing that was not carried (Group 4).
  const archive = how === "corrected" ? { id: over, reason: CORRECTED_REASON } : null;
  const leaves = archive !== null;
  if (leaves) {
    detail["archived"] = over;
    detail["archivedReason"] = CORRECTED_REASON;
    detail["links"] = true;
  }
  const holdsCol = how === "open" ? null : holds;
  const overCol = how === "open" ? null : over;
  let pairId: string;
  try {
    const out = store.settleContradiction({
      ...(pair === undefined ? { newId: newPairId(), x: holds, y: over, source: input.source } : { pairId: pair.id }),
      how,
      holds: holdsCol,
      over: overCol,
      actor: input.actor,
      actorId: input.actorId ?? null,
      why: cleanWhy(input.why),
      day,
      fade,
      archive,
      leaveCore,
      reminder,
      closes,
      lifts: liftPatches,
      detail,
    });
    pairId = out.pairId;
  } catch (err) {
    return refuse("failed", `Nothing was settled: ${isStoreError(err) ? err.code : String((err as Error).message ?? err)}.`);
  }
  if (leaves) carryLinks(store, over, holds, day, opts.retarget);
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
      // Which door (2026-10-11, Group 2b): the dashboard counts detected
      // doors (slot, dream-merge) apart from declared ones (review 10 C6).
      source: pair?.source ?? input.source,
      ...(input.howSent === undefined ? {} : { howSent: input.howSent }),
      faded: faded !== null,
      archived: archive !== null,
      leftCore: leaveCore !== null,
      reminder: reminder !== null,
      closed: closes.length,
      day,
    },
  });
  // A CORRECTION TO A FOLD'S SOURCE FLAGS THE FOLD (2026-10-11, Group 3 part
  // B; item 15, review 12 C5): what the parts added up to may be wrong now.
  if (how === "corrected" && input.source !== FOLD_SOURCE) {
    const flagged = flagFoldsOf(store, over, holds, day);
    if (flagged.length > 0) notes.push(`${flagged.join(", ")} ${flagged.length === 1 ? "was" : "were"} folded from ${over}: flagged beside ${holds}, to read again.`);
  }
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
 * The live folds made from `source` (`Store#foldsCiting`: a query over
 * `meta.sources`, no table), each flagged against `corrector` — unsettled,
 * source `FOLD_SOURCE_CORRECTED`. A courtesy: never throws, never undoes the
 * settle. The folds flagged.
 */
function flagFoldsOf(store: Store, source: string, corrector: string, day: number): string[] {
  const out: string[] = [];
  try {
    for (const fold of store.foldsCiting(source)) {
      if (fold === corrector) continue;
      const f = flag(store, { x: fold, y: corrector, source: FOLD_SOURCE_CORRECTED, day });
      if (f.ok && f.created) out.push(fold);
    }
  } catch {
    /* the flag is a courtesy; the settle stands */
  }
  return out;
}

/** `flagFoldsOf` reversed: each still-unsettled flag it raised is withdrawn. Never throws. */
function withdrawFoldFlags(store: Store, source: string, corrector: string): void {
  try {
    for (const fold of store.foldsCiting(source)) {
      const p = store.contradictionBetween(fold, corrector);
      if (p !== undefined && p.state === "unsettled" && p.source === FOLD_SOURCE_CORRECTED) store.withdrawContradiction(p.id);
    }
  } catch {
    /* the flag stays; a waking read can answer it */
  }
}

/** A memory leaving recall hands its links to `to`. A courtesy: never throws, never undoes the settle. */
function carryLinks(store: Store, from: string, to: string, day: number, retarget: Retarget | undefined): void {
  try {
    if (retarget !== undefined) retarget(from, to, day);
    else new Associate({ store }).retargetOnSupersede(from, to, day);
  } catch {
    /* the links are a courtesy; the settle stands */
  }
}

/**
 * A NEW MEMORY SETTLES THE ONE IT `updates`, as it is written — the arm of
 * `revision.ts` that used to be "link only" for an ordinary memory. `holds`
 * is the new memory; `over` the one it updates. Closes any unsettled pair
 * that named the old one. The link itself is already written (`meta.updates`).
 */
export function settleOnWrite(
  store: Store,
  input: { newId: string; targetId: string; how: SettleHow; actorId: string | null; day: number; howSent?: boolean; retarget?: Retarget },
): SettleOutcome {
  return settle(
    store,
    { holds: input.newId, over: input.targetId, how: input.how, actor: "session", actorId: input.actorId, day: input.day },
    { closeFlags: true, source: "write", ...(input.howSent === undefined ? {} : { howSent: input.howSent }), ...(input.retarget === undefined ? {} : { retarget: input.retarget }) },
  );
}

/** The `source` of a pair written because a memory's reminder moved to a newer one (2026-10-11, Group 2b). */
export const REMINDER_MOVED_SOURCE = "reminder-moved";

/** Where the once-only pass over moved-reminder remnants records that it ran (`settleMovedReminders`). */
export const REMINDERS_MOVED_META = "reconsolidation.remindersMoved";

/**
 * A MEMORY WHOSE REMINDER MOVED STEPS BACK (2026-10-11, Group 2b; review 07
 * §4.3, C2): the newer memory that took the reminder holds over it `changed`,
 * source `reminder-moved`, through the settle (its guards: the core and a
 * protected memory are left alone). Only when the two are not already a pair
 * (the write's own `updates` settles it first, in the writer's words) and the
 * remnant holds no date of its own. Null when nothing was written.
 */
export function settleMovedReminder(
  store: Store,
  input: { remnant: string; holder: string; actor: SettleActor; actorId?: string | null; day?: number },
  opts: { retarget?: Retarget } = {},
): SettleOutcome | null {
  if (store.observer || input.remnant === input.holder) return null;
  const r = store.row(input.remnant);
  if (r === undefined || r.event_date !== null || r.archived === 1 || r.superseded_by !== null) return null;
  if (store.contradictionBetween(input.holder, input.remnant) !== undefined) return null;
  const out = settle(
    store,
    { holds: input.holder, over: input.remnant, how: "changed", why: "its reminder moved to the newer memory", actor: input.actor, actorId: input.actorId ?? null, ...(input.day === undefined ? {} : { day: input.day }) },
    { source: REMINDER_MOVED_SOURCE, ...(opts.retarget === undefined ? {} : { retarget: opts.retarget }) },
  );
  return out.ok ? out : null;
}

/**
 * THE REMNANTS FROM BEFORE (2026-10-11, Group 2b): every live memory whose
 * reminder moved (`meta.reminderMovedTo`) and that nothing settled over yet
 * gets its row once — the holder is where the reminder went, followed to its
 * live end. Idempotent (a remnant already settled over, or already a pair
 * with its holder, is passed by), never a memory that still holds a date.
 * Latched in meta (`REMINDERS_MOVED_META`); a moved reminder writes its own
 * row from now on. Never throws; the number written.
 */
export function settleMovedReminders(store: Store, opts: { retarget?: Retarget; force?: boolean } = {}): number {
  if (store.observer) return 0;
  try {
    if (opts.force !== true && store.getMeta(REMINDERS_MOVED_META) !== undefined) return 0;
    const day = store.livedDay();
    let written = 0;
    let passed = 0;
    for (const id of store.idsWithMetaKey(DATE_MOVED_TO_META)) {
      let to: unknown;
      try {
        to = store.readProse(id).meta[DATE_MOVED_TO_META];
      } catch {
        continue;
      }
      if (typeof to !== "string" || headOf(store, id) !== null) {
        passed += 1;
        continue;
      }
      let holder: string;
      try {
        holder = store.resolve(to);
      } catch {
        passed += 1;
        continue;
      }
      const h = store.row(holder);
      if (h === undefined || h.archived === 1 || h.superseded_by !== null || rowTombstoned(h)) {
        passed += 1;
        continue;
      }
      if (settleMovedReminder(store, { remnant: id, holder, actor: "detector", day }, opts) !== null) written += 1;
      else passed += 1;
    }
    store.setMeta(REMINDERS_MOVED_META, JSON.stringify({ day, written, passed }));
    return written;
  } catch {
    return 0;
  }
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
  opts: { retarget?: Retarget } = {},
): UndoOutcome {
  if (store.observer) return { ok: false, reason: "observer", detail: "This session is an observer: nothing was undone." };
  const day = input.day ?? store.livedDay();
  const pair = store.contradiction(input.pair.trim());
  if (pair === undefined) return { ok: false, reason: "pair-unknown", detail: `There is no contradiction ${input.pair}.` };
  if (pair.via !== null) {
    return { ok: false, reason: "closed-through", detail: `${pair.id} was closed through ${pair.via}; undo that one.` };
  }
  // A SLOT PROPOSAL nobody has answered yet (2026-10-11): its undo is its
  // withdrawal — the two were not one thing's earlier and later state.
  if (pair.state === "unsettled" && pair.source === SLOT_SOURCE && provisionalOf(store, pair) !== null) {
    const w = withdrawSlot(store, { pair: pair.id, actor: input.actor, actorId: input.actorId ?? null, why: input.why ?? null, day });
    if (!w.ok) return { ok: false, reason: w.reason, detail: w.detail };
    return { ok: true, pair: pair.id, how: null, state: "withdrawn", restored: w.restored, unarchived: null, reopened: [] };
  }
  if (pair.state !== "settled") return { ok: false, reason: "not-settled", detail: `${pair.id} is ${pair.state}; there is no settle to undo.` };
  const last = store
    .contradictionSettles({ pairId: pair.id })
    .filter((s) => s.action === "settle" && s.undone === 0)
    .pop();
  if (last === undefined) return { ok: false, reason: "no-settle", detail: `${pair.id} has no settle on its trail to undo.` };
  const d = settleDetail(last.detail);
  const notes: string[] = [];
  // The settle's cut divided back out, and any provisional cut it lifted put
  // back on (2026-10-11), per memory, from the fade it has now.
  const next = new Map<string, number>();
  const current = (id: string): number | null => {
    if (next.has(id)) return next.get(id) as number;
    const r = store.row(id);
    return r === undefined ? null : typeof r.fade === "number" ? r.fade : 1;
  };
  if (d.fade !== null) {
    const f = current(d.fade.id);
    if (f !== null) next.set(d.fade.id, unfade(f, d.fade.factor));
  }
  for (const l of d.lifts) {
    const f = current(l.id);
    if (f !== null) next.set(l.id, Math.min(1, f * l.factor));
  }
  const restore: { id: string; fade: number } | null =
    d.fade !== null && next.has(d.fade.id) ? { id: d.fade.id, fade: next.get(d.fade.id) as number } : null;
  const reapply = [...next].filter(([id]) => d.fade === null || id !== d.fade.id).map(([id, fade]) => ({ id, fade }));
  const reopen = d.closes.filter((c) => store.contradiction(c)?.via === pair.id);
  // A PRESSURE CROSSING UNDONE (2026-10-11, Group 2b): its pair was the
  // crossing's own, never raised as a question — withdrawn, and the pressure
  // pair it closed reopens. The successor it minted (the challenger's words,
  // core) is put away with it, so the old memory back in the core does not
  // stand beside a core copy of the words that were weighed against it.
  const crossing = pair.source === "pressure" && last.holds !== null && last.over !== null && mintedByCrossing(store, last.holds, last.over);
  const back = !crossing && wasFlagged(pair) ? "unsettled" : "withdrawn";
  // A REMINDER THE SETTLE CARRIED goes back (2026-10-11, Group 2b) — while the
  // holder still has that date and the memory it came from has none since.
  let reminderBack: ReminderMove | null = null;
  if (d.reminder !== null) {
    const r = d.reminder;
    const to = r.to === null ? null : store.row(r.to);
    const from = store.row(r.from);
    if (r.to === null && from !== undefined && from.event_date === null) {
      reminderBack = { to: null, toMeta: {}, from: r.from, eventDate: r.eventDate, fromMeta: { [REMINDER_SPENT_BY_META]: null } };
    } else if (r.to !== null && to !== undefined && to !== null && from !== undefined && to.event_date === r.eventDate && from.event_date === null) {
      reminderBack = { to: r.to, toMeta: { [DATE_FROM_META]: null, [CUE_MODE_META]: null, [RECURRING_META]: null }, from: r.from, eventDate: r.eventDate, fromMeta: { [DATE_MOVED_TO_META]: null } };
    } else {
      notes.push(`${r.to ?? r.from}'s date has moved on since, so the reminder stayed where it is.`);
    }
  }
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
      reapply,
      unarchive: d.archived === null ? null : { id: d.archived, reason: d.archivedReason },
      rejoinCore: d.core === null || last.over === null ? null : { id: last.over, band: d.core.band, bandDay: d.core.bandDay, lastUsedDay: d.core.lastUsedDay, promoted: d.core.promoted },
      reopen,
      reminderBack,
      detail: { restored: restore?.id ?? null, archived: d.archived, reopened: reopen, state: back, ...(reminderBack === null ? {} : { reminder: true }) },
    });
    unarchived = out.unarchived;
  } catch (err) {
    return { ok: false, reason: "failed", detail: `Nothing was undone: ${isStoreError(err) ? err.code : String((err as Error).message ?? err)}.` };
  }
  // Back in recall, it takes back the links it handed the holder (the dream
  // merge's undo has done this since Group 4): the holder's, `max`, both ways.
  if (unarchived && d.links && last.holds !== null && d.archived !== null) carryLinks(store, last.holds, d.archived, day, opts.retarget);
  if (crossing && last.holds !== null) {
    try {
      if (store.row(last.holds)?.archived === 0) store.archive(last.holds, PRESSURE_UNDONE_REASON);
    } catch {
      notes.push(`${last.holds} could not be put away; it stands beside ${String(last.over)}.`);
    }
  }
  // A reopened question starts fresh on "my mind" (review of #284, M5).
  for (const id of back === "unsettled" ? [pair.id, ...reopen] : reopen) resetHabituation(store, id, day);
  if (d.archived !== null && !unarchived) notes.push(`${d.archived} has moved on since it was archived, so it was not brought back.`);
  // A correction undone takes back the flags it raised on the folds made from
  // what it corrected (2026-10-11, Group 3 part B), while still unanswered.
  if (pair.how === "corrected" && last.over !== null && last.holds !== null) withdrawFoldFlags(store, last.over, last.holds);
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
  return pair.source === "dream" || pair.source === "pressure" || pair.source === SLOT_SOURCE || pair.dream_id !== null;
}

/** A settle's trail detail, read tolerantly: the fade it applied, the memory it archived, the flags it closed. */
export function settleDetail(raw: string): {
  fade: { id: string; factor: number } | null;
  archived: string | null;
  /** Why it was archived (2026-10-11, Group 2b): `corrected`, or a replacing door's reason. Older rows: `corrected`. */
  archivedReason: string;
  /** Its links went to the holder, so an undo brings them back. */
  links: boolean;
  /** A reminder the settle carried (`to` null: spent by a `done` holder). */
  reminder: { from: string; to: string | null; eventDate: string } | null;
  /** The core standing the memory it was over had before it left the core (2026-10-11, Group 2b). */
  core: { band: Band; bandDay: number | null; lastUsedDay: number; promoted: boolean } | null;
  closes: string[];
  /** Provisional cuts the settle lifted (2026-10-11): an undo puts them back on. */
  lifts: { id: string; factor: number }[];
} {
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
    archivedReason: typeof d["archivedReason"] === "string" ? (d["archivedReason"] as string) : CORRECTED_REASON,
    links: d["links"] === true,
    reminder: reminderOf(d["reminder"]),
    core: coreOf(d["core"]),
    closes: Array.isArray(d["closes"]) ? (d["closes"] as unknown[]).filter((x): x is string => typeof x === "string") : [],
    lifts: Array.isArray(d["lifts"]) ? (d["lifts"] as unknown[]).flatMap(fadeFactorOf) : [],
  };
}

function coreOf(x: unknown): { band: Band; bandDay: number | null; lastUsedDay: number; promoted: boolean } | null {
  if (x === null || typeof x !== "object") return null;
  const c = x as { band?: unknown; bandDay?: unknown; lastUsedDay?: unknown; promoted?: unknown };
  if (c.band !== "identity" && c.band !== "semantic" && c.band !== "episodic") return null;
  if (typeof c.lastUsedDay !== "number") return null;
  return { band: c.band, bandDay: typeof c.bandDay === "number" ? c.bandDay : null, lastUsedDay: c.lastUsedDay, promoted: c.promoted === true };
}

/** Was `holds` the successor a pressure crossing minted from `over` (the challenger's words, source `accommodation`, `revisedFrom` it)? */
function mintedByCrossing(store: Store, holds: string, over: string): boolean {
  try {
    const r = store.row(holds);
    return r !== undefined && r.source === "accommodation" && store.readProse(holds).meta["revisedFrom"] === over;
  } catch {
    return false;
  }
}

function reminderOf(x: unknown): { from: string; to: string | null; eventDate: string } | null {
  if (x === null || typeof x !== "object") return null;
  const r = x as { from?: unknown; to?: unknown; eventDate?: unknown };
  return typeof r.from === "string" && (typeof r.to === "string" || r.to === null) && typeof r.eventDate === "string" ? { from: r.from, to: r.to, eventDate: r.eventDate } : null;
}

/** One `{id, factor}` of a trail detail, as a list of none or one. */
function fadeFactorOf(x: unknown): { id: string; factor: number }[] {
  if (x === null || typeof x !== "object") return [];
  const f = x as { id?: unknown; factor?: unknown };
  return typeof f.id === "string" && typeof f.factor === "number" && f.factor > 0 && f.factor < 1 ? [{ id: f.id, factor: f.factor }] : [];
}

// ── THE SLOT DETECTOR (2026-10-11, Group 2; reviews 04 and 10 C2) ──────────

/**
 * A slot proposal still standing: the trail's newest `propose` row not undone,
 * with which memory it read as holding, which as earlier, and the provisional
 * cut it made (null when there was nothing to cut). Null for any other pair.
 */
export function provisionalOf(
  store: Pick<Store, "contradictionSettles">,
  pair: Pick<ContradictionRow, "id" | "source">,
): { seq: number; holds: string; over: string; fade: { id: string; factor: number } | null } | null {
  if (pair.source !== SLOT_SOURCE) return null;
  const row = store
    .contradictionSettles({ pairId: pair.id })
    .filter((s) => s.action === "propose" && s.undone === 0)
    .pop();
  if (row === undefined || row.holds === null || row.over === null) return null;
  let d: Record<string, unknown> = {};
  try {
    d = JSON.parse(row.detail) as Record<string, unknown>;
  } catch {
    d = {};
  }
  return { seq: row.seq, holds: row.holds, over: row.over, fade: fadeFactorOf(d["fade"])[0] ?? null };
}

/** What the detector found: the older memory a new one reads as the newer state of. */
export interface SlotCandidate {
  readonly over: string;
  /** The embedder's cosine between the two, rounded. */
  readonly cosine: number;
  /** `lineage` (planned, now done) or `cosine` (very close in meaning). */
  readonly rule: "lineage" | "title" | "cosine";
  /** The older was written in the same session. */
  readonly sameSession: boolean;
}

/** A kind of memory the detector never reads as a slot: a reading, a world memory (04: consecutive readings are not states). */
export function slotExempt(row: Pick<MemoryRow, "about" | "title" | "body">): boolean {
  return row.about === "world" || /^\s*reading\b/i.test(row.title ?? row.body);
}

/**
 * IS THIS NEW MEMORY THE NEWER STATE OF THE SAME THING AS AN OLDER ONE?
 * Arithmetic, no model call (2026-10-11, Group 2). Candidates: this session's
 * own recent writes first (42 of 59 declared slots were same-session, 04), then
 * the memory's stored neighbours (box 3, written at `put`) — older than it, no
 * more than `SLOT_WINDOW_DAYS` lived days older, of the same kind and the same
 * `about`, both written by a session (`authored`). A slot when status lineage
 * holds (it was `planned`, this is `done`, cos ≥ `SLOT_LINEAGE_COSINE`), the
 * two titles read as one (`SLOT_TITLE_COSINE`, at the same lower bar), or the
 * two are very close in meaning (cos ≥ `SLOT_COSINE`). Never: a memory with a
 * date (a reminder is its own thing), a reading or world memory, one already
 * settled over (`headOf`: the head is what a newer one sits over), one the
 * owner protects or the core holds, or a pair that was ever a pair (a dream that
 * said "two things" is not asked again). The nearest qualifying one, the
 * session's first. Null when nothing qualifies or there are no vectors. Pure
 * read; never throws.
 */
export function detectSlot(store: Store, input: { id: string; exclude?: readonly string[]; session?: string | null }): SlotCandidate | null {
  const T = CONTRADICTION_TUNABLES;
  try {
    const row = store.row(input.id);
    if (row === undefined || row.type !== "memory" || row.archived === 1 || row.superseded_by !== null || rowTombstoned(row)) return null;
    if (row.source !== "authored" || slotExempt(row) || row.created_at === null) return null;
    const vec = store.vectorOf(input.id);
    if (vec === null) return null;
    const skip = new Set<string>([input.id, ...(input.exclude ?? [])]);
    const session = input.session ?? null;
    const own = session === null ? [] : store.memoriesOfSession(session).map((m) => m.id);
    const near = store.neighbourReader()(input.id, T.SLOT_CANDIDATES) ?? [];
    const found: SlotCandidate[] = [];
    const seen = new Set<string>();
    let ownTitle: number[] | null | undefined;
    for (const id of [...own, ...near]) {
      if (seen.has(id) || skip.has(id)) continue;
      seen.add(id);
      const c = store.row(id);
      if (c === undefined || c.type !== "memory" || c.archived === 1 || c.superseded_by !== null || rowTombstoned(c)) continue;
      if (c.source !== "authored" || c.kind !== row.kind || (c.about ?? null) !== (row.about ?? null) || slotExempt(c)) continue;
      if (c.confidential !== row.confidential || c.event_date !== null) continue;
      if (c.created_at === null || c.created_at >= row.created_at || row.birth_day - c.birth_day > T.SLOT_WINDOW_DAYS) continue;
      if (c.protected === 1 || c.band === "identity" || c.promoted_identity === 1) continue;
      try {
        if (isHandoff(store.readProse(id))) continue;
      } catch {
        continue;
      }
      const other = store.vectorOf(id);
      if (other === null || other.length !== vec.length) continue;
      const cos = cosine(vec, other);
      if (cos < T.SLOT_LINEAGE_COSINE) continue;
      const lineage = c.status === "planned" && row.status === "done";
      let rule: SlotCandidate["rule"] | null = cos >= T.SLOT_COSINE ? "cosine" : lineage ? "lineage" : null;
      if (rule === null && row.title !== null && c.title !== null) {
        ownTitle ??= store.textVector(row.title);
        const theirs = store.textVector(c.title);
        if (ownTitle !== null && theirs !== null && theirs.length === ownTitle.length && cosine(ownTitle, theirs) >= T.SLOT_TITLE_COSINE) rule = "title";
      }
      if (rule === null) continue;
      if (headOf(store, id) !== null || store.contradictionEverBetween(input.id, id)) continue;
      // Already waiting as the older of a proposal: one provisional cut at a time.
      if ((store.contradictionsOf([id]).get(id) ?? []).some((p) => p.state === "unsettled" && p.source === SLOT_SOURCE && p.a === id)) continue;
      found.push({ over: id, cosine: round(cos), rule, sameSession: c.origin_session !== null && c.origin_session === session });
    }
    found.sort((a, b) => Number(b.sameSession) - Number(a.sameSession) || b.cosine - a.cosine || (a.over < b.over ? -1 : 1));
    return found[0] ?? null;
  } catch {
    return null;
  }
}

export type SlotOutcome =
  | {
      readonly ok: true;
      readonly pair: string;
      readonly holds: string;
      readonly over: string;
      readonly rule: SlotCandidate["rule"];
      readonly cosine: number;
      /** The provisional cut: strength before and after, rounded. Null when there was nothing to cut. */
      readonly faded: { readonly before: number; readonly after: number } | null;
    }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

/**
 * PROPOSE A SLOT: the new memory holds, the older one is its earlier state —
 * provisionally. The pair is written UNSETTLED with source `slot`, so recall
 * labels the older "may be out of date" and the dream is shown it to confirm
 * or undo (`slotsToConfirm`); the older's fade is cut by `SLOT_FADE` meanwhile,
 * on the trail so every later step is exact. The same refusals as a settle
 * that moves it (`memoryRefusal`).
 */
export function proposeSlot(
  store: Store,
  input: { holds: string; candidate: SlotCandidate; actorId?: string | null; day?: number; carriedFrom?: string },
): SlotOutcome {
  if (store.observer) return { ok: false, reason: "observer", detail: "This session is an observer: nothing was proposed." };
  const day = input.day ?? store.livedDay();
  const over = input.candidate.over;
  const bad = memoryRefusal(store, over, true) ?? memoryRefusal(store, input.holds, false);
  if (bad !== null && !bad.ok) return { ok: false, reason: bad.reason, detail: bad.detail };
  const physics = store.physicsOf(over);
  const cut = changedFade(physics, day, CONTRADICTION_TUNABLES.SLOT_FADE);
  const faded = cut === null ? null : { before: round(cut.before), after: round(cut.after) };
  // A PROVISIONAL CUT CAN DROP A BAND (review of #420 (e)): fine, but counted.
  const bandDrop = cut !== null && band(physics, day) === "semantic" && band({ ...physics, fade: cut.fade }, day) === "episodic";
  try {
    const out = store.proposeContradiction({
      id: newPairId(),
      holds: input.holds,
      over,
      source: SLOT_SOURCE,
      day,
      actor: "detector",
      actorId: input.actorId ?? null,
      fade: cut === null ? null : { id: over, fade: cut.fade },
      detail: {
        ...(cut === null ? {} : { fade: { id: over, factor: cut.factor, ...faded } }),
        rule: input.candidate.rule,
        cosine: input.candidate.cosine,
        sameSession: input.candidate.sameSession,
        ...(input.carriedFrom === undefined ? {} : { carriedFrom: input.carriedFrom }),
      },
    });
    if (!out.created) return { ok: false, reason: "already-a-pair", detail: `${input.holds} and ${over} are already a pair (${out.id}).` };
    // A CARRIED proposal (`releaseOrphanSlots`) is the same question asked of
    // another memory, not a new one noticed: no second durable event, so the
    // dashboard counts it once. The trail row says where it came from.
    if (input.carriedFrom === undefined) {
      store.appendEvent({
        name: CONTRADICTION_PROPOSED_EVENT,
        day,
        ref: out.id,
        payload: { pair: out.id, holds: input.holds, over, rule: input.candidate.rule, cosine: input.candidate.cosine, sameSession: input.candidate.sameSession, faded: faded !== null, bandDrop, day },
      });
    }
    return { ok: true, pair: out.id, holds: input.holds, over, rule: input.candidate.rule, cosine: input.candidate.cosine, faded };
  } catch (err) {
    return { ok: false, reason: "failed", detail: `Nothing was proposed: ${isStoreError(err) ? err.code : String((err as Error).message ?? err)}.` };
  }
}

/**
 * THE TWO ARE NOT ONE THING'S EARLIER AND LATER STATE: a slot proposal
 * withdrawn (the dream's `slot {same: false}`, or the owner's undo), its
 * provisional cut put back. A withdrawn pair is never proposed again.
 */
export function withdrawSlot(
  store: Store,
  input: { pair: string; actor: SettleActor; actorId?: string | null; why?: string | null; day?: number },
): { ok: true; pair: string; restored: string | null; seq: number } | { ok: false; reason: string; detail: string } {
  if (store.observer) return { ok: false, reason: "observer", detail: "This session is an observer: nothing was withdrawn." };
  const day = input.day ?? store.livedDay();
  const pair = store.contradiction(input.pair.trim());
  if (pair === undefined) return { ok: false, reason: "pair-unknown", detail: `There is no contradiction ${input.pair}.` };
  const p = pair.state === "unsettled" ? provisionalOf(store, pair) : null;
  if (p === null) return { ok: false, reason: "not-a-proposal", detail: `${pair.id} is not a slot proposal still waiting (${pair.source}, ${pair.state}).` };
  let restore: { id: string; fade: number } | null = null;
  if (p.fade !== null) {
    const r = store.row(p.fade.id);
    if (r !== undefined) restore = { id: p.fade.id, fade: unfade(typeof r.fade === "number" ? r.fade : 1, p.fade.factor) };
  }
  try {
    const out = store.withdrawProposal({ pairId: pair.id, proposeSeq: p.seq, actor: input.actor, actorId: input.actorId ?? null, why: cleanWhy(input.why), day, restore, detail: { restored: restore?.id ?? null } });
    store.appendEvent({
      name: CONTRADICTION_UNDONE_EVENT,
      day,
      ref: pair.id,
      payload: { pair: pair.id, how: null, actor: input.actor, restored: restore !== null, unarchived: false, reopened: 0, state: "withdrawn", proposal: true, day },
    });
    return { ok: true, pair: pair.id, restored: restore?.id ?? null, seq: out.seq };
  } catch (err) {
    return { ok: false, reason: "failed", detail: `Nothing was withdrawn: ${isStoreError(err) ? err.code : String((err as Error).message ?? err)}.` };
  }
}

/** The undo of a `withdrawSlot` (a dream's, undone with the dream): the proposal stands again, its cut back on. */
export function reinstateSlot(store: Store, input: { pair: string; withdrawSeq: number }): boolean {
  if (store.observer) return false;
  const pair = store.contradiction(input.pair);
  if (pair === undefined || pair.state !== "withdrawn" || pair.source !== SLOT_SOURCE) return false;
  const trail = store.contradictionSettles({ pairId: pair.id });
  const w = trail.find((s) => s.seq === input.withdrawSeq && s.action === "withdraw" && s.undone === 0);
  const prop = trail.filter((s) => s.action === "propose" && s.undone === 1).pop();
  if (w === undefined || prop === undefined) return false;
  let fade: { id: string; fade: number } | null = null;
  try {
    const f = fadeFactorOf((JSON.parse(prop.detail) as Record<string, unknown>)["fade"])[0];
    const r = f === undefined ? undefined : store.row(f.id);
    if (f !== undefined && r !== undefined) fade = { id: f.id, fade: (typeof r.fade === "number" ? r.fade : 1) * f.factor };
  } catch {
    fade = null;
  }
  store.reinstateProposal({ pairId: pair.id, proposeSeq: prop.seq, withdrawSeq: w.seq, fade });
  return true;
}

/**
 * PROPOSALS NOBODY CAN ANSWER ANY MORE (review of #420): a slot proposal one
 * of whose two memories is gone (archived, forgotten, merged away) is never
 * shown to confirm (`slotsToConfirm` asks for both standing), so without this
 * the older one would keep its provisional cut for good. Withdrawn, the cut
 * put back, by the detector. Run before the dream reads its proposals. Never
 * throws; the count withdrawn (carried ones included).
 *
 * CARRIED, NOT WITHDRAWN (2026-10-11, Group 2b; review of #420 (b)): when the
 * NEWER of the two was replaced — merged away by a dream, or a core memory's
 * successor — and the older still stands, the question is still open, so it
 * goes to the memory that replaced it: withdrawn and proposed again between
 * that one and the older, the cut the same (put back, then made again).
 */
export function releaseOrphanSlots(store: Store, day: number = store.livedDay()): number {
  if (store.observer) return 0;
  let n = 0;
  try {
    for (const c of store.contradictions({ state: "unsettled", limit: 100_000 })) {
      if (c.source !== SLOT_SOURCE || pairStanding(store, c)) continue;
      const p = provisionalOf(store, c);
      if (p === null) continue;
      const successor = replacedBy(store, p.holds);
      const carry = successor !== null && liveMemory(store, p.over) && !store.contradictionEverBetween(successor, p.over);
      const w = withdrawSlot(store, { pair: c.id, actor: "detector", why: carry ? `its newer memory was replaced by ${String(successor)}` : "one of the two is gone", day });
      if (!w.ok) continue;
      n += 1;
      if (carry && successor !== null) {
        let rule: SlotCandidate["rule"] = "cosine";
        let cos = 0;
        try {
          const d = JSON.parse(store.contradictionSettles({ pairId: c.id }).find((x) => x.seq === p.seq)?.detail ?? "{}") as Record<string, unknown>;
          if (d["rule"] === "lineage" || d["rule"] === "title" || d["rule"] === "cosine") rule = d["rule"];
          if (typeof d["cosine"] === "number") cos = d["cosine"];
        } catch {
          /* the carried proposal says less about how it was found */
        }
        proposeSlot(store, { holds: successor, candidate: { over: p.over, cosine: cos, rule, sameSession: false }, actorId: null, day, carriedFrom: c.id });
      }
    }
  } catch {
    /* tried again before the next dream */
  }
  return n;
}

/** A live, un-replaced memory row with words. */
function liveMemory(store: Store, id: string): boolean {
  const r = store.row(id);
  return r !== undefined && r.type === "memory" && r.archived === 0 && r.superseded_by === null && !rowTombstoned(r);
}

/** The live memory a replaced one forwards to (`superseded_by`, followed), or null: not replaced, or nothing live at the end. */
function replacedBy(store: Store, id: string): string | null {
  const r = store.row(id);
  if (r === undefined || r.superseded_by === null) return null;
  try {
    const end = store.resolve(id);
    return end !== id && liveMemory(store, end) ? end : null;
  } catch {
    return null;
  }
}

/** `dream/index.ts#DREAMING_SETTING_KEY`, spelled here because this file sits below `dream/`. */
const DREAMING_SETTING_KEY = "dream.setting";

/** Where the dreaming-off expiry records the lived day it last ran (`expireUnanswerableSlots`). */
export const SLOT_EXPIRY_META = "reconsolidation.slotExpiry";

/**
 * WITH DREAMING OFF, NOTHING ANSWERS A PROPOSAL (2026-10-11, Group 2b;
 * review of #420 (d)): the dream is the only reader the detector hands its
 * proposals to, so on a store whose owner turned dreaming off they would
 * pile up, each older memory holding its provisional cut. There, and only
 * there — random-06: no silent expiry while a dream can answer — a proposal
 * nobody answered within `SLOT_EXPIRY_DAYS` lived days is withdrawn and its
 * cut put back (the label goes with it). Once per lived day; never throws;
 * the count withdrawn.
 */
export function expireUnanswerableSlots(store: Store, day: number = store.livedDay()): number {
  if (store.observer) return 0;
  try {
    if ((store.getMeta(DREAMING_SETTING_KEY) ?? "").trim() !== "off") return 0;
    const last = Number(store.getMeta(SLOT_EXPIRY_META) ?? "-1");
    if (last === day) return 0;
    let n = 0;
    for (const c of store.contradictions({ state: "unsettled", limit: 100_000 })) {
      if (c.source !== SLOT_SOURCE || day - c.flagged_day < CONTRADICTION_TUNABLES.SLOT_EXPIRY_DAYS || provisionalOf(store, c) === null) continue;
      if (withdrawSlot(store, { pair: c.id, actor: "detector", why: "dreaming is off, so nothing answered it", day }).ok) n += 1;
    }
    store.setMeta(SLOT_EXPIRY_META, String(day));
    return n;
  } catch {
    return 0;
  }
}

/**
 * THE PROPOSALS WAITING FOR A READER, oldest first: unsettled slot pairs whose
 * two memories both still stand. `limit` of them (the night's budget), and how
 * many more wait.
 */
export function slotsToConfirm(store: Store, limit: number = CONTRADICTION_TUNABLES.SLOT_PER_NIGHT): { pairs: { pair: string; holds: string; over: string }[]; more: number } {
  const waiting: { pair: string; holds: string; over: string }[] = [];
  try {
    for (const c of [...store.contradictions({ state: "unsettled", limit: 100_000 })].reverse()) {
      if (c.source !== SLOT_SOURCE || !pairStanding(store, c)) continue;
      const p = provisionalOf(store, c);
      if (p !== null) waiting.push({ pair: c.id, holds: p.holds, over: p.over });
    }
  } catch {
    return { pairs: [], more: 0 };
  }
  return { pairs: waiting.slice(0, Math.max(0, limit)), more: Math.max(0, waiting.length - Math.max(0, limit)) };
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
  /**
   * `earlier (now mem_…)` when a later memory has settled over this one
   * (`recall/standing.ts#headOf`, 2026-10-11): before the title, so its
   * words are not read as current. Absent: it stands.
   */
  readonly standing?: string;
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
  input: { id: string; exclude?: readonly string[]; owner: boolean; limit?: number; session?: string | null },
): Neighbour[] {
  const T = CONTRADICTION_TUNABLES;
  const row = store.row(input.id);
  if (row === undefined || rowTombstoned(row)) return [];
  // THIS SESSION'S OWN RECENT WRITES FIRST (2026-10-11, Group 2; 04: 42 of 59
  // declared slots were same-session): candidates whatever the indexes rank,
  // and ahead of the rest when they clear a bar.
  const own = new Set<string>();
  if (input.session !== undefined && input.session !== null) {
    try {
      for (const m of store.memoriesOfSession(input.session)) if (row.birth_day - m.bornDay <= T.SLOT_WINDOW_DAYS) own.add(m.id);
    } catch {
      /* no session rows: the indexes decide */
    }
  }
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
  const candidates: string[] = [...own];
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
  scored.sort((a, b) => Number(own.has(b.id)) - Number(own.has(a.id)) || b.score - a.score || (a.id < b.id ? -1 : 1));
  // SETTLED OVER (2026-10-11): a memory a later one changed is still live,
  // so it can be close — and on 10-11 its bare title was read as the rule.
  // It is listed marked with the memory that holds now; left out when that
  // one is already in view (the write itself, what it updates, a sibling, a
  // neighbour listed above) or is not this writer's to see.
  const limit = input.limit ?? T.NEIGHBOURS;
  const out: Neighbour[] = [];
  for (const s of scored) {
    if (out.length >= limit) break;
    const head = headOf(store, s.id);
    if (head !== null) {
      if (skip.has(head) || out.some((n) => n.id === head)) continue;
      const h = store.row(head);
      if (h === undefined || (h.confidential === 1 && !input.owner)) continue;
    }
    out.push({
      id: s.id,
      ...(head === null ? {} : { standing: earlierMark(head) }),
      title: s.row.title === null || s.row.title.trim().length === 0 ? lineOf({ body: s.row.body }) || null : s.row.title,
      excerpt: excerptOf(s.row.body, T.EXCERPT_CHARS),
    });
  }
  return out;
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
  /** The meaning bar (`guardBar`, the store's own); absent, `UPDATE_COSINE`. */
  readonly bar?: number;
}): UpdateRelatedness {
  const ignore = new Set((input.ignoreNames ?? []).flatMap((n) => n.toLowerCase().split(/[^a-z']+/)).filter((w) => w.length >= 3));
  const a = contentWords(input.over, ignore);
  const b = contentWords(input.text, ignore);
  const shared = [...a].filter((w) => b.has(w));
  const x = input.overVec ?? null;
  const y = input.textVec ?? null;
  if (x !== null && y !== null && x.length > 0 && x.length === y.length) {
    const cos = cosine(x, y);
    return { related: cos >= Math.max(CONTRADICTION_TUNABLES.UPDATE_COSINE, input.bar ?? 0), by: "meaning", cosine: round(cos), shared };
  }
  return { related: a.size === 0 || shared.length > 0, by: "words", cosine: null, shared };
}

/**
 * THE STORE'S GUARD BAR (2026-10-11): what a random pair of live memories
 * reads in THIS store, at `GUARD_BAR_QUANTILE`, never under `UPDATE_COSINE`.
 * Measured once per lived day — the first guarded write of the day pays a few
 * hundred vector reads — and kept in `meta` with its day. Pairs drawn by a
 * generator seeded on the day, so a day's bar is reproducible. Never throws:
 * a store that cannot be measured is held to `UPDATE_COSINE`.
 */
export function guardBar(store: Store): number {
  const T = CONTRADICTION_TUNABLES;
  try {
    const day = store.livedDay();
    const raw = store.getMeta(GUARD_BAR_META);
    if (raw !== undefined) {
      const v = JSON.parse(raw) as { day?: unknown; bar?: unknown };
      if (v.day === day && typeof v.bar === "number" && Number.isFinite(v.bar)) return Math.max(T.UPDATE_COSINE, v.bar);
    }
    const m = measureGuardBar(store, day);
    if (!store.observer) {
      try {
        store.setMeta(GUARD_BAR_META, JSON.stringify({ day, bar: m.bar, quantile: m.quantile, pairs: m.pairs, vectors: m.vectors }));
      } catch {
        /* bookkeeping: measured again next time */
      }
    }
    return m.bar;
  } catch {
    return T.UPDATE_COSINE;
  }
}

/** One day's measure of the store's random pairs (`guardBar`). */
export function measureGuardBar(store: Pick<Store, "list" | "vectorOf">, day: number): { bar: number; quantile: number | null; pairs: number; vectors: number } {
  const T = CONTRADICTION_TUNABLES;
  let seed = (day * 2654435761) >>> 0 || 1;
  const rand = (): number => {
    // xorshift32: small, seeded, enough for a sample.
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 4294967296;
  };
  const ids = store.list({ type: "memory", archived: false });
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
  }
  const vecs: number[][] = [];
  for (const id of ids) {
    if (vecs.length >= T.GUARD_BAR_SAMPLE) break;
    const v = store.vectorOf(id);
    if (v !== null && (vecs.length === 0 || v.length === (vecs[0] as number[]).length)) vecs.push(v);
  }
  if (vecs.length < T.GUARD_BAR_MIN_VECTORS) return { bar: T.UPDATE_COSINE, quantile: null, pairs: 0, vectors: vecs.length };
  const cos: number[] = [];
  for (let k = 0; k < T.GUARD_BAR_PAIRS; k++) {
    const a = Math.floor(rand() * vecs.length);
    let b = Math.floor(rand() * (vecs.length - 1));
    if (b >= a) b += 1;
    cos.push(cosine(vecs[a] as number[], vecs[b] as number[]));
  }
  cos.sort((x, y) => x - y);
  const q = cos[Math.min(cos.length - 1, Math.floor(T.GUARD_BAR_QUANTILE * cos.length))] as number;
  return { bar: Math.max(T.UPDATE_COSINE, round(q)), quantile: round(q), pairs: cos.length, vectors: vecs.length };
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
