/**
 * The REVISION seam — SEAMS.md item O closes here.
 *
 * `mint.ts` is where a proposal becomes a memory. This file is where a memory
 * that ARGUES WITH ANOTHER ONE actually lands. The two are deliberately
 * separate: minting is unconditional (the memory exists either way), and
 * revising is a dispatch on what the declaration hit.
 *
 * **The gap this closes, measured 2026-09-04 on the live store.** The surprise
 * pipeline dissented and the dissent went nowhere. The sweep declared a revision
 * against a shown card; `remember/` resolved it; `mint.ts` wrote
 * `doc.meta["updates"]` and routed the claim through the freeze seam — and then
 * nothing. `encode/chunk.ts` emits a `revision.challenge` DurableEffect that no
 * consumer applied, and `Schemas.challengeBelief` — the pressure accumulator,
 * the durable `revision.pressure` events, the supersede past the bar — had
 * callers only in test files. Store-wide, for the store's whole life: zero rows
 * with pressure, zero `last_challenged_day`, zero `superseded_by`, zero
 * `versions` rows, zero `revision.pressure` events. `self/freeze.ts` says a
 * softening leaves "the revision path (physics' pressure accumulator) ... the
 * caller's next stop, unimpeded". The caller was never written. This is it.
 *
 * **The dispatch table (owner ruling, Mike, 2026-09-04).** What a resolved
 * `updates:` may do depends entirely on WHAT IT HIT:
 *
 *   | target                                   | what happens                    |
 *   |------------------------------------------|---------------------------------|
 *   | schema BELIEF element                    | PRESSURE (`challengeBelief`)    |
 *   | identity element (band identity /         | PRESSURE, same arithmetic, same |
 *   |   `promoted_identity`)                    | durable event shape             |
 *   | schema CURRENT-STATE element ("now" fact) | REPLACE now, with lineage       |
 *   | schema ENTITY row                        | link only — an entity dies by   |
 *   |                                          | decay and no model rewrites one |
 *   | any other memory, AUTHORED (`how`)       | SETTLED: changed / corrected /  |
 *   |                                          | open (`contradictions.ts`)      |
 *   | any other memory, swept (no `how`)       | link only (`meta.updates`)      |
 *   | protected element                        | REFUSED, on every path          |
 *
 * **The ordinary-memory arm settles (2026-09-29, contradictions).** It was
 * link-only: the loser stayed live and in recall with nothing to say it was
 * over. An AUTHORED `updates` now carries `how` (`changed` by default) and the
 * arm hands it to `contradictions.ts#settleOnWrite`: `changed` cuts the old
 * memory's strength once and labels it earlier, `corrected` archives it,
 * `open` keeps both and shows them together. The rows above are unchanged —
 * a belief, an identity memory, a current-state fact, an entity and a
 * protected element take the arm they always did, and a `how` sent at one of
 * them is not applied (the deposit says so). A SWEPT declaration carries no
 * `how` and stays a link: a retelling of a transcript does not settle what
 * the experiencer did not.
 *
 * **An authored `changed` or `corrected` arrives here already read**
 * (2026-10-09): `Counterpart#guardUpdate` checks the pair before the mint,
 * and one that looks unrelated is minted with no `updates` at all, so this
 * seam is never called for it (`contradictions.ts#updateRelatedness`).
 *
 * "One declaration adds pressure; the element is superseded only when the bar is
 * crossed; the old version is retained with lineage" (constitution 7) — that is
 * the slow half. A current-state row is the fast half by construction: a "now"
 * fact that is corrected is simply wrong now, and world-state should flip on one
 * clear correction (§4.3). Everything else links and moves nothing, because
 * `meta.updates` already records the relation and a supersede would be a claim
 * the declaration did not make.
 *
 * **Three rules this file states, all of them inherited, none of them new:**
 *
 *   1. **A CONFIRMATION IS NOT A CHALLENGE.** The direction is read off the
 *      matcher's own verdict through `mint.directionOf` — the same function, not
 *      a second reading — and only a `soften` reaches the pressure path. Without
 *      this, the engine matching a RESTATEMENT by content (`content` /
 *      `content+hint`) would push a belief toward being superseded by its own
 *      paraphrase, and `physics.dedupVerdict`'s first check and this dispatch
 *      would disagree about what a declaration means (SEAMS N, scar §2.10).
 *   2. **Authored beats swept, through the physics and not through a second
 *      weighting.** Force is `strength(challenger) x sal(challenger)`, and a
 *      fallback challenger's claimed salience was already cut to
 *      `SWEEP_CLAIM_CEILING` at the minting seam. A sweep therefore pushes less
 *      hard than the experiencer, arithmetically, and nothing here re-weights it.
 *   3. **Refusals are RETURNED and EVENTED, never thrown.** A door that mints
 *      must not fail because a declaration pointed at nothing (§5 G10). Every
 *      outcome names its ground; the declaration itself is author content and is
 *      logged as a HASH (schemas NOTES §11).
 *
 * **Effect/apply agreement (encode §5 G3).** `encode/chunk.ts` emits one
 * `revision.challenge` effect per accepted proposal whose declaration was
 * non-null — BEFORE resolution, because encode resolves nothing. So this
 * function is called once per such declaration, resolved or not: an address that
 * resolves to nothing produces a countable `target-unresolvable` refusal rather
 * than silence, and the effect list and the applies stand one for one. A fully
 * gated chunk produces no accepted proposals, hence no effects and no applies;
 * an observer's chunk produces neither, and this function stands down on its own
 * besides.
 */
import { hashText, occurredOnOf, saidByOf, statusOf } from "./store/index.js";
import type { MemoryRow, Store } from "./store/index.js";
import { applyChallenge, successorSeed, supersedeRecord } from "./physics/index.js";
import { directionOf } from "./mint.js";
import { flag, settleOnWrite } from "./contradictions.js";
import type { SettleOutcome } from "./contradictions.js";
import type { SettleHow } from "./types.js";
import type { Schemas } from "./schemas/index.js";
import type { PressureIncrement, RevisionReason } from "./schemas/index.js";

/** Which arm of the dispatch table ran. */
export type RevisionPath = "belief" | "identity" | "current-state" | "changed" | "corrected" | "open" | "link-only" | "none";

/**
 * Every ground an application can name. The pressure paths speak `schemas/`'s
 * and `physics/`' own vocabulary so the two cannot drift; the rest are this
 * dispatch's own, and each is a DISTINCT record (scar §2.4).
 */
export type RevisionApplyReason =
  | RevisionReason
  | "replaced"
  | "target-not-current-state"
  | "linked-only"
  | "settled"
  | "target-is-an-entity"
  | "confirmation-not-a-challenge"
  | "observer";

export interface RevisionInput {
  /**
   * The address as the door has it: the RESOLVED id when `remember/` resolved
   * one, else the raw declaration. Resolution of TEXT to a candidate id is
   * `remember/`'s matching problem; walking an id through the supersede chain is
   * the store's, and it happens here (schemas INTERFACE-GAPS §8).
   */
  updates: string;
  /** The minted memory that is doing the arguing. Must be in the store. */
  challengerId: string;
  day: number;
  /**
   * The matcher's verdict, passed through so `mint.directionOf` decides the
   * direction ONCE for both the freeze seam and this one.
   */
  method?: string;
  /** The successor's prose. Defaults to the challenger's own body. */
  statement?: string;
  /**
   * How an AUTHORED declaration settles an ordinary memory (2026-09-29).
   * Absent — a swept declaration — the ordinary-memory arm is a link, as before.
   */
  how?: SettleHow;
  /** The writing session, for the settle's trail. */
  session?: string | null;
}

export interface RevisionOptions {
  /** Telemetry: ids, hashes, counts, reasons. Never a statement, never a name. */
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
  /**
   * SEAMS item E, for the paths this file owns: a successor inherits the old
   * head's live edges. `schemas/` has its own injected copy for the element
   * paths; an identity memory has no module of its own, so the callback arrives
   * here too. A retarget that THROWS must not undo a revision that landed.
   */
  retarget?: (oldId: string, newId: string, day: number) => void;
}

export interface RevisionApplication {
  path: RevisionPath;
  reason: RevisionApplyReason;
  /** True when durable state moved: pressure credited, or a supersede landed. */
  moved: boolean;
  /** Did the pressure field on the target row actually move? */
  credited: boolean;
  verdict: "revise" | "replace" | "hold" | "none";
  /** The id the declaration resolved to after the supersede chain. */
  targetId: string | null;
  /** True when the declaration named a superseded element and was forwarded. */
  retargeted: boolean;
  successorId: string | null;
  force: number;
  pressureBefore: number;
  pressureAfter: number;
  bar: number;
  increment: PressureIncrement | null;
  /** The ordinary-memory arm's settle, when `how` reached it: done, or refused and why. */
  settle?: SettleOutcome;
  /** The identity arm, with a `how`: the pair recorded unsettled while pressure builds. */
  pressurePair?: string;
}

const NOTHING = {
  moved: false,
  credited: false,
  verdict: "none",
  retargeted: false,
  successorId: null,
  force: 0,
  pressureBefore: 0,
  pressureAfter: 0,
  bar: 0,
  increment: null,
} as const;

/** The durable increment's event name — one spelling, owned by `schemas/`. */
export const PRESSURE_EVENT = "revision.pressure";

/**
 * One declared revision, applied to whatever it hit. Called from EVERY mint
 * door (`deposit` for the session-end dump and the note, `applySweep` for the
 * crash fallback), once per declaration.
 */
export function applyRevision(
  store: Store,
  schemas: Schemas,
  input: RevisionInput,
  opts: RevisionOptions = {},
): RevisionApplication {
  const declared = input.updates.trim();
  const declaredHash = hashText(declared);

  const settle = (
    path: RevisionPath,
    reason: RevisionApplyReason,
    targetId: string | null,
    extra: Partial<RevisionApplication> = {},
  ): RevisionApplication => {
    const out: RevisionApplication = { ...NOTHING, path, reason, targetId, ...extra };
    // FOUR DISTINCT records, never one string for two facts (scar §2.4): state
    // moved; the link was the whole effect; the engine matched a restatement and
    // there was nothing to challenge; or the declaration was refused, and why.
    // A confirmation is not a refusal — filing it as one would make the refusal
    // distribution unreadable, which is the shape of v1's ambiguous zeroes.
    const name = out.moved
      ? "revision.applied"
      : path === "link-only"
        ? "revision.linked"
        : reason === "confirmation-not-a-challenge"
          ? "revision.confirmed"
          : "revision.refused";
    opts.onEvent?.(name, {
      path,
      reason,
      target: targetId,
      declaredHash,
      challenger: input.challengerId,
      day: input.day,
      credited: out.credited,
      successor: out.successorId,
      retargeted: out.retargeted,
    });
    return out;
  };

  // An instrument leaves the world as it found it (docs/observer-mode.md, scar
  // E7). The doors stand down before they mint, so nothing should reach here —
  // this is the second lock, not the first, and it says so rather than letting
  // the store's write guard throw inside a deposit.
  if (store.observer) return settle("none", "observer", null);
  if (declared.length === 0) return settle("none", "no-declared-target", null);

  // RESOLUTION FIRST, and deliberately before the direction: `remember/` reports
  // `method: "content"` both when it MATCHED a restatement and when it found no
  // candidate at all, so reading the direction first would file every dangling
  // address under "confirmation" and the countable refusal would disappear —
  // which is the failure this whole seam exists to stop being invisible.
  let targetId: string;
  try {
    targetId = store.resolve(declared);
  } catch {
    return settle("none", "target-unresolvable", null);
  }
  const retargeted = targetId !== declared;
  const row = store.row(targetId);
  if (row === undefined) return settle("none", "target-unresolvable", null, { retargeted });

  // A CONFIRMATION IS NOT A CHALLENGE (rule 1 in the header). The engine matched
  // a restatement; saying the same thing again must never push the thing it
  // restates toward being replaced by its own paraphrase.
  if (directionOf(input.method) === "confirm") {
    return settle("none", "confirmation-not-a-challenge", targetId, { retargeted });
  }

  if (!store.has(input.challengerId)) {
    return settle("none", "challenger-unknown", targetId, { retargeted });
  }

  const target = store.physicsOf(targetId);
  // Protected elements refuse EVERY revision path, always (schemas §5 G11), and
  // the check is BEFORE the arithmetic on every arm — permanence that quietly
  // accumulated a case against itself is a different, worse guarantee (NOTES
  // §10). The belief path refuses it again on its own terms; this is not a
  // substitute for that, it is the same rule stated where the dispatch is.
  if (target.protected) {
    return settle("none", "protected-refuses-revision", targetId, { retargeted });
  }
  // A superseded row resolved away above, so an archived row HERE is archived on
  // purpose — a distinct fact from "not a belief" and from "gone".
  if (row.archived === 1) return settle("none", "target-archived", targetId, { retargeted });

  const element = schemas.element(targetId);

  // ── a schema BELIEF: pressure, and supersede only past the bar ─────────────
  if (element?.role === "belief") {
    const out = schemas.challengeBelief({
      updates: targetId,
      challengerId: input.challengerId,
      day: input.day,
      ...(input.statement === undefined ? {} : { statement: input.statement }),
    });
    return settle("belief", out.reason, out.targetId, {
      moved: out.credited || out.successorId !== null,
      credited: out.credited,
      verdict: out.verdict,
      retargeted: retargeted || out.retargeted,
      successorId: out.successorId,
      force: out.force,
      pressureBefore: out.pressureBefore,
      pressureAfter: out.pressureAfter,
      bar: out.bar,
      increment: out.increment,
    });
  }

  // ── a CURRENT-STATE row: a "now" fact, replaced now ────────────────────────
  if (element?.role === "current-state") {
    const out = schemas.replaceCurrentState({
      updates: targetId,
      challengerId: input.challengerId,
      day: input.day,
      ...(input.statement === undefined ? {} : { statement: input.statement }),
    });
    return settle("current-state", out.reason, out.targetId, {
      moved: out.successorId !== null,
      verdict: out.successorId === null ? "none" : "replace",
      retargeted: retargeted || out.retargeted,
      successorId: out.successorId,
    });
  }

  // An ENTITY is not a claim: it is the place claims attach to. It dies by decay
  // and by nothing else (schemas §5 G7), so a declaration against one links and
  // stops. The link already exists — `mint.ts` wrote `meta.updates`.
  if (schemas.entity(targetId) !== undefined) {
    return settle("link-only", "target-is-an-entity", targetId, { retargeted });
  }

  // ── an IDENTITY element: the same arithmetic, on a memory row ──────────────
  // The store's own notion of identity, not a second one: the band column, or
  // the promotion flag the counted crossing sets (`sleep/consolidate.ts` writes
  // both). An identity claim is exactly the case the slow-kind daily force cap
  // exists for — three lived days of pressure, not one loud sentence.
  if (row.type === "memory" && (row.band === "identity" || target.promotedIdentity)) {
    const out = identityChallenge(store, row, input, opts, settle, retargeted);
    // WHILE PRESSURE BUILDS (review of #284, M9): an authored `how` at a core
    // memory is not applied — its path is pressure over days — but the pair is
    // recorded UNSETTLED, so recall labels the older one as possibly out of
    // date until the bar is crossed (then it is superseded and the pair stops
    // standing). Latched as raised: the writer declared it, so there is
    // nothing to raise awake.
    if (input.how !== undefined && out.successorId === null && store.has(input.challengerId)) {
      const f = flag(store, { x: row.id, y: input.challengerId, source: "pressure", day: input.day });
      if (f.ok) {
        if (f.created) store.markContradictionRaised(f.pair, input.day);
        return { ...out, pressurePair: f.pair };
      }
    }
    return out;
  }

  // An ordinary memory, AUTHORED: the settle (2026-09-29). A journal chapter
  // (`type` episode) is not a claim and stays a link.
  if (input.how !== undefined && row.type === "memory") {
    const out = settleOnWrite(store, {
      newId: input.challengerId,
      targetId,
      how: input.how,
      actorId: input.session ?? null,
      day: input.day,
    });
    if (out.ok) return settle(out.how, "settled", targetId, { moved: true, retargeted, settle: out });
    return settle("link-only", "linked-only", targetId, { retargeted, settle: out });
  }

  // Everything else: the link is the whole effect (owner ruling 2026-09-04).
  return settle("link-only", "linked-only", targetId, { retargeted });
}

/**
 * The identity arm. `physics.applyChallenge` is the same function the belief
 * path calls, the durable event is the SAME name with the SAME
 * `(target, day, challenger)` dedup latch, and the supersede carries no entity
 * meta — an identity memory belongs to no schema, and inventing one here would
 * make it appear in a slice it was never part of.
 */
function identityChallenge(
  store: Store,
  row: MemoryRow,
  input: RevisionInput,
  opts: RevisionOptions,
  settle: (
    path: RevisionPath,
    reason: RevisionApplyReason,
    targetId: string | null,
    extra?: Partial<RevisionApplication>,
  ) => RevisionApplication,
  retargeted: boolean,
): RevisionApplication {
  const targetId = row.id;
  const target = store.physicsOf(targetId);
  const challenger = store.physicsOf(input.challengerId);
  const outcome = applyChallenge(
    targetId,
    target,
    // The RESOLVED id is what physics is told; the raw declaration never leaves
    // the event (scar §2.5 — the model proposes semantics, the engine resolves
    // references).
    { id: input.challengerId, declaredUpdates: targetId, physics: challenger },
    input.day,
  );

  let increment: PressureIncrement | null = null;
  if (outcome.credited) {
    store.updatePhysics(targetId, outcome.next);
    const log = outcome.log;
    if (log !== null) {
      increment = {
        event: PRESSURE_EVENT,
        targetId,
        day: log.day,
        challengerId: log.challengerId,
        force: log.force,
        pressureAfter: log.pressureAfter,
        bar: log.bar,
      };
      store.appendEvent({
        name: PRESSURE_EVENT,
        day: log.day,
        ref: targetId,
        dedupKey: `${PRESSURE_EVENT}:${targetId}:${log.day}:${log.challengerId}`,
        payload: {
          targetId,
          day: log.day,
          challengerId: log.challengerId,
          force: log.force,
          pressureAfter: log.pressureAfter,
          bar: log.bar,
        },
      });
    }
  }

  let successorId: string | null = null;
  if (outcome.verdict === "revise") {
    const statement = (input.statement ?? store.readProse(input.challengerId).body).trim();
    // v12: the successor's words are the CHALLENGER's statement, so its three
    // fields are the challenger's too (which already carry over what its
    // writer left out of the target's, `Counterpart#carryFacts`). Without them
    // the supersede's carry would stamp the target's — the old fact's date,
    // speaker and kind — onto the new fact's words.
    const said = store.row(input.challengerId);
    const occurredOn = occurredOnOf(said?.occurred_on ?? null);
    const saidBy = saidByOf(said?.said_by ?? null);
    const status = statusOf(said?.status ?? null);
    successorId = store.supersede(
      targetId,
      {
        type: "memory",
        kind: row.kind,
        body: statement,
        ...(occurredOn === null ? {} : { occurredOn }),
        ...(saidBy === null ? {} : { saidBy }),
        ...(status === null ? {} : { status }),
        meta: { revisedFrom: targetId, groundedIn: [input.challengerId] },
        // Identity is entered by INHERITING it through a declared revision or by
        // the counted promotion crossing, and never otherwise (physics §5.3).
        // This is the first of those two, so the band travels with the successor
        // and `successorSeed` carries the promotion flag.
        band: row.band,
        salience: challenger.salience,
        physics: {
          birthDay: input.day,
          lastUsedDay: input.day,
          ...successorSeed(store.physicsOf(targetId)),
        },
        source: "accommodation",
        origin: { ref: input.challengerId },
      },
      "revised-by-pressure",
    );
    if (opts.retarget !== undefined) {
      try {
        opts.retarget(targetId, successorId, input.day);
      } catch (err) {
        opts.onEvent?.("revision.edges.retarget.failed", {
          target: targetId,
          successor: successorId,
          day: input.day,
          error: err instanceof Error ? err.name : "UNKNOWN",
        });
      }
    }
    const record = supersedeRecord(targetId, successorId, input.day);
    opts.onEvent?.("memory.superseded", {
      target: targetId,
      successor: successorId,
      day: record.day,
      resolvableUntilDay: record.resolvableUntilDay,
    });
  }

  return settle("identity", outcome.reason as RevisionReason, targetId, {
    moved: outcome.credited || successorId !== null,
    credited: outcome.credited,
    verdict: outcome.verdict,
    retargeted,
    successorId,
    force: outcome.force,
    pressureBefore: outcome.pressureBefore,
    pressureAfter: outcome.pressureAfter,
    bar: outcome.bar,
    increment,
  });
}
