/**
 * `recall/` — retrieval and priming. Cues → activation → the surfacing gate → a
 * bounded injection, plus the footnote tier, plus noticing afterwards whether a
 * surfaced memory was actually used.
 *
 * The module's spine, and where each piece lives:
 *
 *   `cues.ts`      strip host boilerplate, then rarity-weighted, word-bounded cues
 *   `feeling-ask.ts` a deliberate question about feeling, and what a stamp answers to
 *   `activate.ts`  three channels — cue, semantic, arrival — against the cache box
 *   `gate.ts`      the hard gates, this turn's own background bar, the tiers
 *   `session.ts`   per-session gate state, PERSISTED (the ruling this module exists to honor)
 *   `prime.ts`     context priming, an experiment (2026-10-19): the session's train of thought and sources
 *   `render.ts`    composed budget, explicit trim order, tail sentinel
 *   `tunables.ts`  every knob, in one visible place
 *
 * Two properties are structural here and worth stating at the top:
 *
 * **BUILD and RECORD are separate steps** (contract §5 G3). `build()` is pure with
 * respect to durable state: it reads, scores, gates and composes, and writes
 * nothing — not gate state, not telemetry. `recall()` calls it and then records.
 * That split is what makes guarantee 2 achievable: **a latency-budget abort has
 * zero side effects** — nothing injected, nothing buffered, no telemetry, no fire
 * budget spent. *A slow subconscious is worse than a quiet one.*
 *
 * **NO GENERATIVE MODEL CALL, EVER, on this path.** There is no client, no fetch,
 * no URL in this directory, and a test enumerates that. An embedding may be
 * consulted — but only as an INPUT the caller supplies, and its absence degrades
 * to lexical-only rather than failing (contract §5 G1).
 */
import type { Kind } from "../types.js";
import { TUNABLES as PHYSICS, USE_TIER_WEIGHT, strength } from "../physics/index.js";
import type { CreditOutcome, UseTier } from "../physics/index.js";
import type { ProseDoc, Store } from "../store/index.js";
import { isChapterSummary, stemTerm, tokenize } from "../store/index.js";
import { activate, isBeliefRow, primeOf } from "./activate.js";
import type { Candidate, LearnedCuesFn, SpreadFn, SpreadStats } from "./activate.js";
import type { FeelingAskInput } from "./feeling-ask.js";
import { buildCues, detectAffect, stripBoilerplate } from "./cues.js";
import type { Cue } from "./cues.js";
import { floorUnit, gate } from "./gate.js";
import { habituatedIds } from "./habituation.js";
import { planPrime, saveTrain } from "./prime.js";
import type { PrimeInput, PrimePlan, TrainState } from "./prime.js";
import type { Background, CandidateVerdict, Verdict } from "./gate.js";
import { NO_MOOD, currentMood } from "./mood.js";
import { ASKED_KIND, askedCueRef, boundTurnCues, loadCueTrained, loadGateState, loadTurnCues, saveCueTrained, saveGateState, saveTurnCues, turnCueRecord, turnCueRef } from "./session.js";
import type { GateRecordInput } from "../store/index.js";
import type { CueWord, GateState, SemanticSource } from "./session.js";
import { beliefLine, render } from "./render.js";
import type { BeliefLine } from "./render.js";
import { headOf, standingOf, unsettledCompetition } from "./standing.js";
import type { RenderResult, Resolve, Resolved } from "./render.js";
import { withTunables } from "./tunables.js";
import type { RecallTunables } from "./tunables.js";

/** At most this many mood-lifted ids on a decision (`moodMatchedIds`) — the
 *  same cap the credit row puts on `shownNotUsed` (2026-10-14). */
export const MOOD_MATCHED_IDS_CAP = 64;

/** A turn priming ran on and touched nothing (a quiet turn's numbers). */
const NO_PRIME: PrimeSummary = {
  sources: { used: 0, wrote: 0, open: 0 },
  train: false,
  candidates: 0,
  cut: 0,
  capped: 0,
  trainCentre: null,
  shown: 0,
  lifted: 0,
  byLink: 0,
  byTrain: 0,
  byTag: 0,
};

export * from "./cues.js";
export * from "./feeling-ask.js";
export * from "./gate.js";
export * from "./mood.js";
export * from "./rated.js";
export * from "./habituation.js";
export * from "./prime.js";
export * from "./render.js";
export * from "./session.js";
export * from "./standing.js";
export * from "./recency-ask.js";
export * from "./time-ask.js";
export * from "./tunables.js";
export { activate, isBeliefRow, isHandoff, isSelfPage, gatedSal, primeChannel, primeOf, recordedIdentity, salienceRank } from "./activate.js";
export type { CandidatePrime, FeelingLane, LearnedCuesFn, PrimeStats, SpreadFn, SpreadStats } from "./activate.js";
export type { Candidate, ActivationResult } from "./activate.js";
import type { ActivationResult } from "./activate.js";

/** Telemetry: ids, counts, scores, tiers, reasons. NEVER body text or turn text. */
export interface RecallEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface RecallOptions {
  store: Store;
  /** Overrides on the CAL table. Every one is a calibration claim (scar §2.8). */
  tunables?: Partial<RecallTunables>;
  /** The host's injection ceiling (scar §2.18 — the ceiling is a host capability). */
  budgetBytes?: number;
  /** Latency budget for the build pass, ms. */
  budgetMs?: number;
  onEvent?: (e: RecallEvent) => void;
  /** Injectable clock, so the latency budget is testable without sleeping. */
  now?: () => number;
}

export interface Turn {
  sessionId: string;
  text: string;
  /** The turn's embedding, supplied by the caller. NEVER fetched here. */
  vector?: readonly number[];
  /**
   * The semantic channel ALREADY RANKED — the lagged cue the detached worker
   * resolved after the previous turn (`session.ts`). It exists because ranking
   * WAS the expensive half: `Store.nearestTo` measured 590-1040 ms over v1's
   * 13,862 JSON-stored vectors (2026-09-04). Since box 3 went to float32 BLOBs
   * (2026-09-05) the same rank measures ~2 ms warm and ~18 ms cold in a fresh
   * hook process on the live store's 2,207 vectors, and ~60 ms p50 / ~160 ms
   * p95 cold at 22,207 (2026-10-19, 25 fresh processes per number, bun on
   * macOS; ~/counterparts-notes/2026-10-19-first-prompt-recall-diagnosis.md).
   * Supplied hits replace the scan; an empty array means "nothing was near"
   * and degrades.
   */
  semanticHits?: readonly { id: string; score: number }[];
  /** Where the semantic input came from, for the decision record. Defaults to
   *  `in-line` when a vector is supplied and `none` when nothing is. */
  semanticSource?: SemanticSource;
  /** The turn a lagged cue was computed from. Provenance, not a knob. */
  semanticFromTurn?: number;
  /** handle -> memory ids; >= 2 ids makes the handle ambiguous (INTERFACE-GAPS #2). */
  aliases?: ReadonlyMap<string, readonly string[]>;
  /** Temporal cues — `prospective.arrivals()`, mapped to `{id, weight}` at the
   *  composition root (`src/core/retrieval.ts`, SEAMS item D). They enter through
   *  the CUE channel and no other; see `activate.ts`'s header for why the word
   *  "arrival" means two different things on the two sides of this seam. */
  temporal?: readonly { id: string; weight: number }[];
  /** Spreading activation (SEAMS item L), injected at the composition root.
   *  Hops MODULATE candidates the conversation already reached, and may add a
   *  few QUIET POINTERS — memories only links reached, footnote tier only
   *  (2026-09-28; the gate's one named lane past hard gate (a)). */
  spread?: SpreadFn;
  /**
   * CUE LEARNING'S READ (2026-10-24, R3 — an experiment): the learned
   * word-to-memory pairs out of some index terms, faded to a lived day,
   * injected at the composition root (`retrieval.ts`, from `associate/`)
   * only while `physics.CUE_LEARNING` is on. A learned pair is one more cue
   * (`activate.ts`). Absent: nothing learned is read.
   */
  learned?: LearnedCuesFn;
  /** Lived day. Defaults to the store's clock (scar E8 — lived, not calendar). */
  day?: number;
  budgetBytes?: number;
  /**
   * Per-turn override of the LATENCY budget. It exists for one caller: the
   * deliberate ask, which is "a deeper effort with different thresholds, on
   * purpose" (§9.1) and has no host turn waiting on it. The ambient budget is a
   * promise to a person mid-sentence; a question someone typed and is waiting
   * for is a different promise. (It was written when the semantic channel's
   * vector scan cost 590-1040 ms on a live-sized index; that scan is now tens
   * of ms — see `semanticHits` above — and the deliberate ask's longer budget
   * stands on its deeper effort, not on the scan.)
   */
  budgetMs?: number;
  /**
   * A DELIBERATE question, which may be about feeling (2026-09-30, U13): who is
   * asking, and the owner's names. Set only by the deliberate ask
   * (the old `mcp/deliberate.ts#answerQuestion` until 2026-10-03; meaning
   * mode's now, when it asks); absent on every ambient turn, so the
   * feeling lane (`activate.ts`, `feeling-ask.ts`) never runs there and the
   * ambient affect gates (§9 G10/G11) are untouched.
   */
  feeling?: FeelingAskInput;
  /**
   * THE ECHO SET (2026-10-19, feedback-loop part C, an experiment): memories
   * this session wrote (since its last compaction, when the host knows one),
   * which are already in its context. Ambient only — set by
   * `Counterpart#recallForTurn` and by nothing on the deliberate path — and
   * the gate turns each away as `echo-skipped` where it would have been shown
   * (`gate.ts`). Absent or empty: nothing is skipped.
   */
  echo?: ReadonlySet<string>;
  /**
   * ANOTHER PROJECT'S WORK (2026-10-21, wave 2 lane G): is this id work from
   * a project other than the turn's folder's? Ambient only — bound by
   * `Counterpart#recallForTurn`. With `RECALL_BY_PROJECT` on the gate turns
   * such a memory away as `project-skipped`; else, with
   * `CROSS_PROJECT_BAR_LIFT` above 1, it faces that lift on its bars.
   */
  elsewhere?: (id: string) => boolean;
  /**
   * CONTEXT PRIMING (an experiment, 2026-10-19; `prime.ts`): this turn's own
   * vector for the train of thought, one hop along links, and what is open in
   * this folder. Ambient only — set by `Counterpart#recallForTurn` and by
   * nothing on the deliberate path. Absent: priming does not run.
   */
  prime?: PrimeInput;
  /**
   * THE BELIEFS SLOT'S LOOKUP (wave 2 lane E, 2026-10-22): the current
   * beliefs about the subjects this turn's words name, bound by the
   * composition root from `schemas/` (`Schemas#beliefsNamedIn`). Ambient
   * only. Absent, or `BELIEFS_IN_RECALL` off: no slot, and the turn is what it was.
   */
  beliefs?: BeliefsFn;
}

/** One belief the lookup offers the slot (lane E). Reads only. */
export interface BeliefOffer {
  readonly id: string;
  /** The subject's name as the slot says it ("" for a nameless one). */
  readonly subject: string;
  readonly statement: string;
  /** Physics' strength today. */
  readonly strength: number;
  /** Memories counted for it. */
  readonly support: number;
  readonly contested: boolean;
}

/** Text (stripped of host boilerplate) and the lived day → the beliefs on the subjects it names. */
export type BeliefsFn = (text: string, day: number) => readonly BeliefOffer[];

/**
 * What the beliefs slot did on one turn (lane E), on the durable decision row:
 * how many beliefs the subjects named offered, which the turn showed (after
 * the floor, the session's dedup, the cap and the render's trim), and their
 * bytes. Null when the slot did not run (off, no lookup, a quiet turn).
 */
export interface BeliefSlotSummary {
  readonly offered: number;
  readonly shown: readonly string[];
  readonly bytes: number;
}

/**
 * What priming did on one turn (2026-10-19, an experiment), on the durable
 * decision row: which kinds of source counted (so "on, nothing primed" reads
 * apart from "off"), whether a train of thought existed, and of the memories
 * SHOWN, how many were primed, by which channel, and how many only because of
 * it (`lifted`). Counts only; which ones are on the rows of `surfaced` and
 * `footnotes` (`primed` there). Null when priming did not run.
 */
export interface PrimeSummary {
  readonly sources: { readonly used: number; readonly wrote: number; readonly open: number };
  readonly train: boolean;
  /** Candidates the cut kept that priming reached. */
  readonly candidates: number;
  /** Of those, kept only because of it. */
  readonly cut: number;
  /** How many the ceiling (`PRIME_CEILING`) bound. */
  readonly capped: number;
  /** The cosine with the train a candidate had to beat for a train head start
   *  (the candidates' mean under centring, or the floor), rounded; null when
   *  no candidate was scored against a train. */
  readonly trainCentre: number | null;
  readonly shown: number;
  readonly lifted: number;
  readonly byLink: number;
  readonly byTrain: number;
  /** Of the shown, how many a source's TAGS primed (lane E, `TAGS_PRIME`;
   *  part of `byLink`, whose channel tag partners ride). */
  readonly byTag: number;
}

export type DecisionReason =
  | "rendered"
  | "empty-turn"
  | "no-candidates"
  | "all-gated"
  | "budget-quiet"
  | "latency-abort";

/**
 * The per-turn surfacing decision record — content-by-reference from day one
 * (contract §5 G14, scar §2.20). Ids, counts, scores, reasons. No bodies, and no
 * cue TOKENS either: a cue token is a word the user typed, and turn text is
 * exactly what telemetry may not carry.
 */
export interface RecallDecision {
  readonly sessionId: string;
  readonly turn: number;
  readonly day: number;
  readonly observer: boolean;
  readonly reason: DecisionReason;
  readonly aborted: boolean;
  readonly storeSize: number;
  readonly background: Background;
  /** Which boilerplate strippers fired, by NAME (§9 G3). */
  readonly stripped: string[];
  readonly cueCount: number;
  readonly ambiguousCueCount: number;
  readonly carriedCueCount: number;
  readonly semanticUsed: boolean;
  readonly semanticDegraded: boolean;
  /**
   * WHERE the semantic channel's input came from, by name — including every way
   * it was dark. The measured failure this closes: both live paths built their
   * turn without a vector, so `semanticUsed: false` was written on every real
   * turn and said nothing about why (scar §2.4 — "did not fire" and "was never
   * asked" are different records).
   *
   * NOT in `RECALL_DECISION_FIELDS`: the durable surface set is hashed to decide
   * whether a human rating carries across a code change (parallel §5 G12), and
   * moving it mid-run would invalidate every carried verdict. This rides the
   * adapter's own `adapter.recall` row instead, like `semanticUsed` before it.
   */
  readonly semanticSource: SemanticSource;
  /** For a lagged cue: the turn it was computed from. Null otherwise. */
  readonly semanticFromTurn: number | null;
  readonly candidates: number;
  readonly verdicts: CandidateVerdict[];
  readonly surfaced: string[];
  readonly footnotes: string[];
  readonly affectFlag: boolean;
  readonly affectReason: string;
  /**
   * How many memories this turn admitted (loud or quiet) that the current mood
   * had lifted (recall G18) — a memory that carried a feeling matching how someone
   * feels now. Counts only; which feeling is never named. 0 on a turn with no
   * mood, and on every quiet turn.
   */
  readonly moodMatched: number;
  /**
   * WHICH admitted memories the mood lifted (2026-10-14, lightly held): the ids
   * behind `moodMatched`, in verdict order, at most `MOOD_MATCHED_IDS_CAP` (the
   * cap `shownNotUsed` has on the credit row) — so a later re-test with mood
   * matching on can compare their use. Ids only; empty whenever `moodMatched`
   * is 0, which is every turn while the mood weights stay 0.
   */
  readonly moodMatchedIds: string[];
  /**
   * How many memories this turn would have shown (loud, footnote or quiet
   * pointer) but did not because this session wrote them — the echo skip
   * (2026-10-19, part C; `Turn.echo`). A count, so a review can see what a
   * long session lost. 0 when no echo set was given.
   */
  readonly echoSkipped: number;
  /** How many this turn would have shown but did not because they are another
   *  project's work (`Turn.elsewhere`, `RECALL_BY_PROJECT`, 2026-10-21). 0 when off. */
  readonly projectSkipped: number;
  /** How many only `CROSS_PROJECT_BAR_LIFT` kept below their bar this turn —
   *  another project's work that would otherwise have shown (2026-10-21). */
  readonly crossProjectLifted: number;
  /** How many olders of an unsettled pair counted at a weight this turn, their
   *  newer a candidate too (E3, 2026-10-24; which ones: `competed` on their
   *  verdicts and shown tier rows). Absent when `UNSETTLED_COMPETES` is off or
   *  the turn never reached the gate, so an off turn's row is as before. */
  readonly pairsCompeted?: number;
  /** What context priming did this turn (2026-10-19, `PrimeSummary`); null when it did not run. */
  readonly primed: PrimeSummary | null;
  /** What the beliefs slot did this turn (lane E, `BeliefSlotSummary`); null when it did not run. */
  readonly beliefs: BeliefSlotSummary | null;
  /**
   * What spreading did this turn (association build 1, 2026-09-28): seeds,
   * nodes expanded, where and why it stopped, contributions computed and how
   * many LANDED on a candidate. Null when it did not run. Counts only. On the
   * durable `recall.decision` row (`RECALL_DECISION_FIELDS`), added to the
   * surface set the way `moodMatched` was — the parallel run it was frozen for
   * is over.
   */
  readonly spread: SpreadStats | null;
  /** Scored candidates the candidate cut left out (never a silent cut). */
  readonly dropped: number;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly sentinel: string | null;
  readonly trimmed: { lane: string; id: string | null }[];
  readonly elapsedMs: number;
}

export interface RecallResult {
  /** The empty string on a quiet turn — never an empty block. */
  readonly injection: string;
  readonly decision: RecallDecision;
}

export type CreditReason =
  | "credited"
  | "observer"
  | "ambiguous-handle-trains-nothing"
  | "already-credited-at-or-above"
  | "physics-refused";

export interface CreditResult {
  readonly credited: boolean;
  readonly reason: CreditReason;
  readonly tier: UseTier;
  readonly w: number;
  /** Physics' own verdict, when it was consulted. */
  readonly outcome: CreditOutcome | null;
  /**
   * CUE LEARNING (2026-10-24, R3): the word-to-memory deltas this use earned
   * from the turn that showed the memory — for the caller to hand to
   * `associate/` (recall does not import it). Absent when nothing trains.
   */
  readonly cues?: readonly LearnedCueDelta[];
}

/** One word-to-memory delta (R3), structurally `associate`'s `CueDelta`. `token` is an index term; signed. */
export interface LearnedCueDelta {
  readonly token: string;
  readonly id: string;
  readonly delta: number;
}

/**
 * How much of a full use a credit at this tier trains the cue pairs of the
 * turn that showed the memory (R3): opened, quoted (`referenced`), drawn on
 * (`engaged`) and rated 2–3 (`useful`, `referenced`) fully; rated 1
 * (`ontopic`) a small share; shown and unrated (`shown`), and the display
 * tiers, nothing — training on mere showing would feed the loop (surfaced →
 * wired → surfaced more).
 */
export function cueTrainShare(tier: UseTier, t: RecallTunables): number {
  switch (tier) {
    case "referenced":
    case "engaged":
    case "useful":
      return 1;
    case "ontopic":
      return t.CUE_TRAIN_RATED_ONE;
    default:
      return 0;
  }
}

/**
 * The cue words worth keeping from a turn's cues (R3): this turn's own words
 * (never carried), unambiguous, with weight — every one already a word the
 * index holds (`buildCues` drops a df-0 word: the privacy guard) — as index
 * terms, one entry per term, strongest first.
 */
export function cueWordsOf(cues: readonly Cue[]): CueWord[] {
  const byTerm = new Map<string, number>();
  for (const c of cues) {
    if (c.carried || c.ambiguous || !(c.weight > 0)) continue;
    const term = stemTerm(c.token);
    if (term.length === 0) continue;
    byTerm.set(term, Math.max(byTerm.get(term) ?? 0, c.weight));
  }
  return [...byTerm].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

interface BuildOutput {
  decision: RecallDecision;
  /**
   * Which semantic calibration this build used (`ActivationResult.semantic`),
   * when activation ran with a semantic input. NOT a decision-record field (that
   * set is hashed); it rides the recording half's telemetry instead.
   */
  semantic?: ActivationResult["semantic"];
  /**
   * The feeling lane on a deliberate ask (`ActivationResult.feeling`): whether
   * the question was about feeling, and the nominated candidates' softened
   * strengths by id. Like `semantic`, NOT a decision-record field. Absent on an
   * ambient turn and on a quiet build.
   */
  feeling?: ActivationResult["feeling"];
  /** The journal rows each chapter absorbed (`ActivationResult.folded`), for the record step. Absent on a quiet build. */
  folded?: ActivationResult["folded"];
  injection: string;
  state: GateState;
  /** Cue tokens to carry into the next turn. State, not telemetry (see NOTES.md). */
  carry: string[];
  render: RenderResult | null;
  gateStatus: "loaded" | "absent" | "unreadable";
  /** The train of thought to save at the record step (priming, 2026-10-19). Absent: none to save. */
  train?: TrainState;
  /** This turn's cue words, kept at the record step beside what it showed (R3). Absent: none. */
  cueWords?: CueWord[];
}

export class Recall {
  readonly store: Store;
  readonly tunables: RecallTunables;
  /** One predicate, one definition: the store's. Never re-derived here. */
  readonly observer: boolean;

  private readonly budgetBytes: number;
  private readonly budgetMs: number;
  private readonly onEvent: ((e: RecallEvent) => void) | undefined;
  private readonly now: () => number;
  /** Observer-only: gate state that may never be deposited, so it lives here. */
  private readonly volatile = new Map<string, GateState>();

  constructor(opts: RecallOptions) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables ?? {});
    this.observer = opts.store.observer;
    this.budgetBytes = opts.budgetBytes ?? this.tunables.BUDGET_BYTES;
    this.budgetMs = opts.budgetMs ?? this.tunables.BUDGET_MS;
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => Date.now());
  }

  // ── the hot path ─────────────────────────────────────────────────────────

  /**
   * BUILD: read, score, gate, compose. Writes nothing durable and emits nothing.
   * Exposed because "build and record are separate steps" is only a real property
   * if the build is separately callable — a private half is a promise, not a seam.
   */
  build(turn: Turn): BuildOutput {
    const started = this.now();
    const day = turn.day ?? this.store.livedDay();
    const budgetBytes = turn.budgetBytes ?? this.budgetBytes;
    const budgetMs = turn.budgetMs ?? this.budgetMs;

    const loaded = this.observer
      ? { state: this.volatileState(turn.sessionId), status: "loaded" as const }
      : loadGateState(this.store, turn.sessionId, this.tunables.MAX_SESSION_RECORDS);
    const state = loaded.state;
    const turnNo = state.turn + 1;

    // The semantic channel's input, judged ONCE: a vector this caller embedded,
    // or a ranking somebody else already did. Both are "the channel had input";
    // the SOURCE says which, and when there was none, why not.
    const semanticOffered =
      (turn.vector !== undefined && turn.vector.length > 0) || turn.semanticHits !== undefined;
    const semanticSource: SemanticSource =
      turn.semanticSource ?? (semanticOffered ? "in-line" : "none");
    const semanticFromTurn = turn.semanticFromTurn ?? null;

    const { text, stripped } = stripBoilerplate(turn.text);
    const affect = detectAffect(text);
    const carriedIn =
      state.carriedFromTurn === turnNo - 1 && state.carriedCues.length > 0
        ? state.carriedCues
        : [];
    // CONTEXT PRIMING (an experiment, 2026-10-19): planned from reads only —
    // the session's sources and its train of thought. Ambient only (the
    // deliberate path never sets `turn.prime`). A failed plan primes nothing.
    let plan: PrimePlan | null = null;
    if (turn.prime !== undefined && (this.tunables.PRIME_LINK_UNITS > 0 || this.tunables.PRIME_TRAIN_SHARE > 0)) {
      try {
        plan = planPrime({
          store: this.store,
          sessionId: turn.sessionId,
          state,
          turnNo,
          day,
          echo: turn.echo,
          prime: turn.prime,
          // The semantic channel is the worker's rank of the previous exchange.
          lagged: turn.vector === undefined && turn.semanticHits !== undefined,
          t: this.tunables,
        });
      } catch {
        plan = null;
      }
    }

    const quiet = (
      reason: DecisionReason,
      partial: Partial<RecallDecision> = {},
    ): BuildOutput => ({
      decision: {
        sessionId: turn.sessionId,
        turn: turnNo,
        day,
        observer: this.observer,
        reason,
        aborted: reason === "latency-abort",
        storeSize: 0,
        background: {
          regime: "absolute-thin-background",
          n: 0,
          mean: 0,
          sd: 0,
          // The floors are in CUE UNITS now (`gate.ts#floorUnit`), and a quiet
          // turn reports `storeSize: 0` — it never counted one. Quoting the
          // floor at that store size is the honest reading of this record: no
          // store, no unit, no bar anything was judged against.
          bar: this.tunables.FLOOR_GLOBAL_UNITS * floorUnit(0),
          strongBar: this.tunables.FLOOR_GLOBAL_UNITS * floorUnit(0),
          floor: this.tunables.FLOOR_GLOBAL_UNITS * floorUnit(0),
        },
        stripped,
        cueCount: 0,
        ambiguousCueCount: 0,
        carriedCueCount: carriedIn.length,
        semanticUsed: semanticOffered,
        semanticDegraded: false,
        semanticSource,
        semanticFromTurn,
        candidates: 0,
        verdicts: [],
        surfaced: [],
        footnotes: [],
        affectFlag: false,
        affectReason: "no-feeling-in-turn",
        moodMatched: 0,
        moodMatchedIds: [],
        echoSkipped: 0,
        projectSkipped: 0,
        crossProjectLifted: 0,
        primed: plan === null ? null : { ...NO_PRIME, sources: plan.sources, train: plan.activation.train !== null },
        beliefs: null,
        spread: null,
        dropped: 0,
        bytes: 0,
        budgetBytes,
        sentinel: null,
        trimmed: [],
        elapsedMs: this.now() - started,
        ...partial,
      },
      injection: "",
      state,
      carry: [],
      render: null,
      gateStatus: loaded.status,
      ...(plan === null ? {} : { train: plan.next }),
    });

    if (text.trim().length === 0) return quiet("empty-turn");

    // THE BELIEFS SLOT (wave 2 lane E): a subject this turn names is enough —
    // read once, before the memories, and shown whatever the footnotes do.
    const beliefPicks = this.pickBeliefs(turn, text, day, state);
    const withBeliefs = (out: BuildOutput): BuildOutput => this.beliefsOnly(out, beliefPicks, turnNo, budgetBytes);

    // Cold start is STRICTER, not looser: below a minimum store size the variance
    // estimate is meaningless and small stores over-surface (§9 G13).
    // A count, not a list of every live id (Lane 0, scale review C4: 16% of a
    // turn at 10x). The same WHERE (`memoryWhere`).
    const storeSize = this.store.countMemories({ archived: false });
    const maxCandidates =
      storeSize < this.tunables.COLD_START_MIN_STORE
        ? this.tunables.COLD_START_MAX_CANDIDATES
        : this.tunables.MAX_CANDIDATES;

    // How each person feels now — only what was RECORDED in the last few hours
    // (recall G18; no classifier). Read on the store's clock, which is the clock the
    // feelings were stamped with.
    // With both mood weights at 0 (2026-10-10, review 02 C3) a mood could lift
    // nothing, so the `feelings` scan is not run; the code stays for a re-test.
    const moodWeighs = this.tunables.MOOD_SAME_WEIGHT > 0 || this.tunables.MOOD_CROSS_WEIGHT > 0;
    const mood = moodWeighs ? currentMood(this.store, this.store.now(), this.tunables) : NO_MOOD;

    const act = activate(
      this.store,
      {
        text,
        vector: turn.vector,
        hits: turn.semanticHits,
        carried: carriedIn,
        aliases: turn.aliases,
        temporal: turn.temporal,
        spread: turn.spread,
        ...(turn.learned === undefined || !PHYSICS.CUE_LEARNING ? {} : { learned: turn.learned }),
        day,
        selfFelt: affect.selfFelt,
        mood,
        maxCandidates,
        storeSize,
        ...(turn.feeling === undefined ? {} : { feeling: turn.feeling }),
        ...(plan === null ? {} : { prime: plan.activation }),
      },
      this.tunables,
    );

    if (this.now() - started > budgetMs) return quiet("latency-abort");

    const carry = act.cues
      .filter((c) => !c.carried)
      .slice(0, this.tunables.MAX_CUES)
      .map((c) => c.token);
    const cueStats = {
      cueCount: act.cues.length,
      ambiguousCueCount: act.cues.filter((c) => c.ambiguous).length,
      carriedCueCount: carriedIn.length,
      storeSize: act.storeSize,
      semanticDegraded: act.semanticDegraded,
    };

    if (act.candidates.length === 0) {
      return withBeliefs({ ...quiet("no-candidates", cueStats), carry });
    }

    // THE CHAIN HEAD WINS (2026-10-11, Group 2): an earlier version the turn
    // reached is shown as the memory that holds now (`headsWin`).
    const candidates = headsWin(this.store, act.candidates, day);
    // HABITUATION (an experiment, 2026-10-19, light): who was rated 0 in enough
    // recent sessions. Ambient turns only: a deliberate feeling ask is untouched.
    const habituated = turn.feeling === undefined ? habituatedIds(this.store, day, this.tunables) : new Map<string, number>();
    // AN UNSETTLED PAIR COMPETES (2026-10-24, E3, an experiment): the older of
    // a standing unsettled pair, its newer reached this turn too, counts at a
    // weight in the gate. Off: nothing is read.
    const competing = this.tunables.UNSETTLED_COMPETES
      ? unsettledCompetition(this.store, candidates, day, {
          k: this.tunables.UNSETTLED_COMPETE_K,
          simFloor: this.tunables.UNSETTLED_COMPETE_SIM_FLOOR,
          windowDays: this.tunables.UNSETTLED_COMPETE_WINDOW_DAYS,
        })
      : null;

    const gated = gate(
      {
        candidates,
        state,
        storeSize: act.storeSize,
        affectStated: affect.stated,
        turn: turnNo,
        ...(turn.echo === undefined || turn.echo.size === 0 ? {} : { echo: turn.echo }),
        ...(turn.elsewhere !== undefined && this.tunables.RECALL_BY_PROJECT ? { elsewhere: turn.elsewhere } : {}),
        ...(turn.elsewhere !== undefined && !this.tunables.RECALL_BY_PROJECT && this.tunables.CROSS_PROJECT_BAR_LIFT > 1 ? { crossing: turn.elsewhere } : {}),
        ...(habituated.size === 0 ? {} : { habituated }),
        ...(competing === null || competing.size === 0 ? {} : { competing }),
      },
      this.tunables,
    );

    if (this.now() - started > budgetMs) return quiet("latency-abort");

    const docs = new Map<string, ProseDoc>();
    for (const c of candidates) docs.set(c.id, c.doc);
    // Quiet pointers render with their one-word label (`FRAMING.linked`).
    const linked = new Set(candidates.filter((c) => c.linkOnly === true).map((c) => c.id));
    const lifted = new Set(candidates.filter((c) => c.lifted === true).map((c) => c.id));
    // A memory's standing in a contradiction (2026-09-29): read once per id per
    // build — the trim loop composes more than once.
    const standings = new Map<string, { prefix: string; suffix: string } | null>();
    const standing = (id: string): { prefix: string; suffix: string } | null => {
      if (!standings.has(id)) {
        let s: { prefix: string; suffix: string } | null = null;
        try {
          s = standingOf(this.store, id);
        } catch {
          s = null;
        }
        standings.set(id, s);
      }
      return standings.get(id) ?? null;
    };
    const resolve: Resolve = (id) => {
      const r = resolveDoc(docs.get(id), id);
      const st = standing(id);
      const withStanding = st === null ? r : { ...r, standing: { prefix: st.prefix, suffix: st.suffix } };
      return linked.has(id) ? { ...withStanding, linked: true } : withStanding;
    };

    const rendered = render(
      {
        turn: turnNo,
        affectFlag: gated.affectFlag,
        surfaced: gated.surfaced.map((c) => c.id),
        footnotes: gated.footnotes.map((c) => c.id),
        ...(beliefPicks === null || beliefPicks.lines.length === 0 ? {} : { beliefs: beliefPicks.lines }),
        budgetBytes,
        gistBytes: this.tunables.GIST_BYTES,
        titleBytes: this.tunables.FOOTNOTE_TITLE_BYTES,
        pressureRatio: this.tunables.BUDGET_PRESSURE,
      },
      resolve,
    );

    const nothingAdmitted =
      gated.surfaced.length === 0 && gated.footnotes.length === 0 && !gated.affectFlag;
    // A turn that handed over only the beliefs slot (lane E) RENDERED: bytes
    // went out, and every reader of `reason` (fired.ts, the narrators, the
    // ring's `recall.quiet`) must not count it as a quiet turn (review of #588).
    const reason: DecisionReason =
      rendered.text !== "" && rendered.beliefs.length > 0
        ? "rendered"
        : nothingAdmitted
          ? "all-gated"
          : rendered.text === ""
            ? "budget-quiet"
            : "rendered";

    // The admitted memories the mood lifted, by id (2026-10-14): `moodMatched`
    // counts them all, `moodMatchedIds` names the first MOOD_MATCHED_IDS_CAP.
    const moodLifted = gated.verdicts
      .filter((v) => (v.verdict === "surfaced" || v.verdict === "footnoted") && (v.mood ?? 0) > 0)
      .map((v) => v.id);
    // What priming did to what was SHOWN (after the render's trim).
    const shownSet = new Set([...rendered.surfaced, ...rendered.footnotes]);
    const shownPrimed = gated.verdicts.filter((v) => v.primed !== undefined && shownSet.has(v.id) && (v.verdict === "surfaced" || v.verdict === "footnoted"));
    const primed: PrimeSummary | null =
      plan === null
        ? null
        : {
            sources: plan.sources,
            train: plan.activation.train !== null,
            candidates: act.prime?.primed ?? 0,
            cut: act.prime?.cut ?? 0,
            capped: act.prime?.capped ?? 0,
            trainCentre: act.prime?.trainCentre == null ? null : Math.round(act.prime.trainCentre * 10_000) / 10_000,
            shown: shownPrimed.length,
            lifted: shownPrimed.filter((v) => v.primed?.lifted === true).length,
            byLink: shownPrimed.filter((v) => (v.primed?.link ?? 0) > 0).length,
            byTrain: shownPrimed.filter((v) => (v.primed?.train ?? 0) > 0).length,
            byTag: shownPrimed.filter((v) => (v.primed?.tag ?? 0) > 0).length,
          };
    const decision: RecallDecision = {
      sessionId: turn.sessionId,
      turn: turnNo,
      day,
      observer: this.observer,
      reason,
      aborted: false,
      storeSize: act.storeSize,
      background: gated.background,
      stripped,
      cueCount: cueStats.cueCount,
      ambiguousCueCount: cueStats.ambiguousCueCount,
      carriedCueCount: cueStats.carriedCueCount,
      semanticUsed: semanticOffered,
      semanticDegraded: act.semanticDegraded,
      semanticSource,
      semanticFromTurn,
      candidates: act.candidates.length,
      verdicts: gated.verdicts,
      surfaced: rendered.surfaced,
      footnotes: rendered.footnotes,
      affectFlag: rendered.affectFlag,
      affectReason: gated.affectReason,
      moodMatched: moodLifted.length,
      moodMatchedIds: moodLifted.slice(0, MOOD_MATCHED_IDS_CAP),
      echoSkipped: gated.verdicts.filter((v) => v.verdict === "echo-skipped").length,
      projectSkipped: gated.verdicts.filter((v) => v.verdict === "project-skipped").length,
      crossProjectLifted: gated.crossLifted.length,
      ...(competing === null ? {} : { pairsCompeted: gated.competed.length }),
      primed,
      beliefs: beliefPicks === null ? null : { offered: beliefPicks.offered, shown: rendered.beliefs, bytes: rendered.beliefBytes },
      // What the gate SHOWED of the pointers activation handed it, after the
      // render's trim: the pointer lane's last number (2026-09-28).
      spread:
        act.spread === null
          ? null
          : {
              ...act.spread,
              pointersShown: rendered.footnotes.filter((id) => linked.has(id)).length,
              liftedShown: [...rendered.surfaced, ...rendered.footnotes].filter((id) => lifted.has(id)).length,
              pointersUnanchored: gated.verdicts.filter((v) => v.via === "link" && v.verdict === "dark-uncued").length,
            },
      dropped: act.dropped,
      bytes: rendered.bytes,
      budgetBytes,
      sentinel: rendered.sentinel,
      trimmed: rendered.trimmed.map((x) => ({ lane: x.lane, id: x.id })),
      elapsedMs: this.now() - started,
    };

    return {
      decision,
      injection: rendered.text,
      state,
      carry,
      render: rendered,
      gateStatus: loaded.status,
      semantic: act.semantic,
      folded: act.folded,
      ...(act.feeling === null ? {} : { feeling: act.feeling }),
      ...(plan === null ? {} : { train: plan.next }),
      ...(PHYSICS.CUE_LEARNING ? { cueWords: cueWordsOf(act.cues) } : {}),
    };
  }

  /**
   * BUILD, then RECORD. The record step is where gate state is persisted and
   * telemetry is emitted — and it is skipped entirely on a latency abort, which
   * is what makes the abort side-effect-free.
   */
  recall(turn: Turn): RecallResult {
    const built = this.build(turn);
    const d = built.decision;

    if (d.aborted) {
      // Zero side effects on loss: nothing injected, nothing buffered, no
      // telemetry, no state advanced (contract §5 G2).
      return { injection: "", decision: d };
    }

    if (built.gateStatus === "unreadable") {
      this.emit("recall.gate.reset", turn.sessionId, { status: built.gateStatus });
    }

    const next: GateState = {
      ...built.state,
      turn: d.turn,
      lastDay: d.day,
      surfaced: { ...built.state.surfaced },
      affectFiredTurn: d.affectFlag ? d.turn : built.state.affectFiredTurn,
      carriedCues: built.carry,
      carriedFromTurn: d.turn,
    };
    for (const id of d.surfaced) {
      next.surfaced[id] = { turn: d.turn, tier: "surfaced", trains: trainsOf(d.verdicts, id) };
    }
    for (const id of d.footnotes) {
      // A quiet pointer is remembered AS one (2026-09-28), so the credit pass
      // can count how many were later expanded — whether they are used at all.
      const via = d.verdicts.find((v) => v.id === id)?.via;
      next.surfaced[id] = {
        turn: d.turn,
        tier: "footnoted",
        trains: trainsOf(d.verdicts, id),
        ...(via === "link" ? { via } : {}),
      };
    }
    // THE BELIEFS THE SLOT SHOWED (lane E): their own records, so the slot
    // does not show one twice in a session and a rating may name it.
    if (d.beliefs !== null && d.beliefs.shown.length > 0) {
      const beliefs: Record<string, number> = { ...(next.beliefs ?? {}) };
      for (const id of d.beliefs.shown) beliefs[id] = d.turn;
      next.beliefs = beliefs;
    }
    // WHICH JOURNAL ROWS A SHOWN CHAPTER ABSORBED (2026-10-15): a chapter's
    // use credits these and no others (`creditCopies`) — the summaries of the
    // chapters the turn's cues actually reached, not every chapter's.
    if (built.folded !== undefined && built.folded.size > 0) {
      const folded: Record<string, string> = { ...(next.folded ?? {}) };
      for (const id of [...d.surfaced, ...d.footnotes]) for (const row of built.folded.get(id) ?? []) folded[row] = id;
      next.folded = folded;
    }
    // THE TURN'S CUE WORDS, beside what it showed (R3 cue learning): only on
    // a turn that showed a memory, never under observer — in the same write
    // as the gate state, so the record step stays one transaction.
    const cueRow: GateRecordInput[] =
      PHYSICS.CUE_LEARNING && !this.observer && built.cueWords !== undefined && built.cueWords.length > 0 && d.surfaced.length + d.footnotes.length > 0
        ? [turnCueRecord(this.store, { sessionId: turn.sessionId, ref: turnCueRef(d.turn), turn: d.turn, day: d.day, words: built.cueWords })]
        : [];
    this.persist(next, "recall", cueRow);
    if (cueRow.length > 0) {
      try {
        boundTurnCues(this.store, turn.sessionId, d.turn, this.tunables.MAX_SESSION_RECORDS);
      } catch (err) {
        this.emit("recall.cues.bound.failed", turn.sessionId, { code: err instanceof Error ? err.name : "unknown" });
      }
    }
    // The train of thought moves on with this turn (priming, 2026-10-19). An
    // observer keeps none (an instrument deposits nothing); a lost write costs
    // the train one turn, never the recall.
    if (built.train !== undefined && !this.observer) {
      try {
        saveTrain(this.store, turn.sessionId, built.train, d.day);
      } catch (err) {
        this.emit("recall.prime.save.failed", turn.sessionId, { code: err instanceof Error ? err.name : "unknown" });
      }
    }

    this.emitTelemetry(d, built.render);
    // WHICH PAIR RAN (review MINOR 2): the identity box 3 recorded at this
    // activation, the path, and the floor/weight `semanticTuning` chose — on the
    // telemetry ring, so a live row can say it, beside the decision record.
    if (built.semantic !== undefined && built.semantic !== null) {
      this.emit("recall.semantic.tuning", d.sessionId, {
        turn: d.turn,
        identity: built.semantic.identity,
        path: built.semantic.path,
        floor: built.semantic.floor,
        weight: built.semantic.weight,
        source: d.semanticSource,
      });
    }
    return { injection: built.injection, decision: d };
  }

  /**
   * THE BELIEFS SLOT'S PICK (wave 2 lane E, 2026-10-22): what the turn's
   * subjects offer, above `BELIEFS_SLOT_FLOOR` (strictly: a belief born at
   * the ceiling with nothing behind it does not show), not shown earlier this
   * session, strongest first, at most `BELIEFS_SLOT_MAX`, each composed as
   * its line. Null when the slot does not run (off, or no lookup bound). A
   * lookup that throws offers nothing. Reads only.
   */
  private pickBeliefs(turn: Turn, text: string, day: number, state: GateState): { offered: number; lines: BeliefLine[] } | null {
    if (!this.tunables.BELIEFS_IN_RECALL || turn.beliefs === undefined) return null;
    let offers: readonly BeliefOffer[] = [];
    try {
      offers = turn.beliefs(text, day);
    } catch {
      offers = [];
    }
    const seen = state.beliefs ?? {};
    const byId = new Map<string, BeliefOffer>();
    for (const b of offers) if (!byId.has(b.id)) byId.set(b.id, b);
    // HABITUATION (2026-10-19), for belief lines too: one rated 0 in enough
    // recent sessions rests, as a footnote's raised bar would — the slot has
    // no bar to raise, so it is left out until a later 2 or 3 or the week passes.
    const habituated = byId.size === 0 || !(this.tunables.HABITUATION_BAR_LIFT > 0) ? new Map<string, number>() : habituatedIds(this.store, day, this.tunables);
    const picked = [...byId.values()]
      .filter((b) => b.strength > this.tunables.BELIEFS_SLOT_FLOOR && seen[b.id] === undefined && !habituated.has(b.id))
      .sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1))
      .slice(0, Math.max(0, Math.floor(this.tunables.BELIEFS_SLOT_MAX)));
    return {
      offered: byId.size,
      lines: picked.map((b) => ({ id: b.id, text: beliefLine(b, this.tunables.BELIEF_LINE_BYTES) })),
    };
  }

  /**
   * A TURN WITH NO MEMORY TO SHOW, AND BELIEFS (lane E): the slot alone,
   * rendered under the same budget and sentinel. When it hands bytes over the
   * turn's reason is `rendered` (review of #588: a reader of the reason must
   * not count it as a quiet turn); `beliefs` on the row says it was the slot.
   */
  private beliefsOnly(
    out: BuildOutput,
    picks: { offered: number; lines: BeliefLine[] } | null,
    turnNo: number,
    budgetBytes: number,
  ): BuildOutput {
    if (picks === null) return out;
    if (picks.lines.length === 0) return { ...out, decision: { ...out.decision, beliefs: { offered: picks.offered, shown: [], bytes: 0 } } };
    const rendered = render(
      {
        turn: turnNo,
        affectFlag: false,
        surfaced: [],
        footnotes: [],
        beliefs: picks.lines,
        budgetBytes,
        gistBytes: this.tunables.GIST_BYTES,
        titleBytes: this.tunables.FOOTNOTE_TITLE_BYTES,
        pressureRatio: this.tunables.BUDGET_PRESSURE,
      },
      () => ({ title: "", gist: "" }),
    );
    return {
      ...out,
      injection: rendered.text,
      render: rendered,
      decision: {
        ...out.decision,
        bytes: rendered.bytes,
        sentinel: rendered.sentinel,
        trimmed: rendered.trimmed.map((x) => ({ lane: x.lane, id: x.id })),
        // Bytes went out, so the turn RENDERED (review of #588): the slot alone.
        ...(rendered.text === "" ? {} : { reason: "rendered" as const }),
        beliefs: { offered: picks.offered, shown: rendered.beliefs, bytes: rendered.beliefBytes },
      },
    };
  }

  /**
   * Retrospective reinforcement. Which memories the reply actually USED is the
   * caller's judgment (§9.2 owns that rule and its precision bias); this method
   * routes a decided tier to physics through the store seam and applies the two
   * refusals that belong to the gate state it owns.
   *
   * The footnoted tier is deliberately NOT short-circuited: it goes through
   * `store.reinforce` and comes back `credited: false, reason: "ignorable-tier"`,
   * so "the ignorable tier trains nothing" is proved by the seam that would have
   * trained it, not by an early return that never asked.
   */
  resolveUse(sessionId: string, memoryId: string, tier: UseTier, opts: { cued?: boolean; beliefSlot?: boolean } = {}): CreditResult {
    const w = USE_TIER_WEIGHT[tier];
    // Checked FIRST, before any other work (contract §5 G11, scar E7).
    if (this.observer) {
      this.emit("recall.observer.standdown", memoryId, { site: "resolveUse", tier });
      return { credited: false, reason: "observer", tier, w, outcome: null };
    }

    const { state } = loadGateState(this.store, sessionId, this.tunables.MAX_SESSION_RECORDS);
    const surfaced = state.surfaced[memoryId];
    if (surfaced !== undefined && !surfaced.trains) {
      // Both halves of §9 G5, and this is the consumer scar §2.6 demands: v1
      // documented "ambiguous handles train nothing" in three places, enforced it
      // in one, and a repo-wide grep found ZERO consumers of the flag.
      this.emit("recall.credit.refused", memoryId, {
        reason: "ambiguous-handle-trains-nothing",
        tier,
      });
      return { credited: false, reason: "ambiguous-handle-trains-nothing", tier, w, outcome: null };
    }
    const today = this.store.livedDay();
    const prior = state.credited[memoryId];
    // Never downgrades an already-credited item (contract §5 G10) — WITHIN A
    // LIVED DAY. Owner ruling 2026-09-14 (R2): a session that spans days and
    // uses the same memory on each is a distinct occasion each day, exactly as
    // physics §5.5 counts it; keyed to the session alone, the first consumer
    // of this gate (#99) credited a memory once EVER per session.
    if (prior !== undefined && prior.day === today && USE_TIER_WEIGHT[prior.tier] >= w) {
      this.emit("recall.credit.refused", memoryId, {
        reason: "already-credited-at-or-above",
        tier,
        prior: prior.tier,
      });
      // A cadence refusal still trains the cue pairs (R3: no once-a-day rule):
      // the showing's own record keeps it from training twice.
      const cues = this.cueTraining(sessionId, state, memoryId, cueTrainShare(tier, this.tunables), today);
      return { credited: false, reason: "already-credited-at-or-above", tier, w, outcome: null, ...(cues.length === 0 ? {} : { cues }) };
    }

    // THE CUED EXCEPTION, TIGHTENED (working default 2026-09-26, review of
    // #251): a quoted use is organic whatever the hints lane showed only when
    // recall surfaced the memory LOUD on this same turn — the cue that turn
    // brought. Surfaced earlier in the session, the quote may have come off the
    // wake, and the display decides as for any other use.
    const cued =
      opts.cued === true && surfaced !== undefined && surfaced.tier === "surfaced" && surfaced.turn === state.turn;
    // A HIGHER TIER LIFTS TODAY'S LOWER ONE (2026-10-11, `drewOn`; ported from
    // #371): an engaged credit earlier this lived day, then an expansion, is
    // one day credited at the expansion's tier — not a refusal. This
    // session's record says so here; another session's engaged credit today
    // is found by the store from its return row (`Store#reinforce`).
    const upgradeFrom = upgradeOf(prior, today, w);
    const outcome = this.store.reinforce(memoryId, today, tier, {
      ...(cued ? { cued: true } : {}),
      ...(upgradeFrom === undefined ? {} : { upgradeFrom }),
      // A rating of the beliefs slot (lane E): the one use a belief takes —
      // and only for a belief THIS SESSION'S SLOT SHOWED (review of #588, S1:
      // the public door must not credit a belief no session was shown).
      ...(opts.beliefSlot === true && state.beliefs?.[memoryId] !== undefined ? { beliefSlot: true } : {}),
      // The session it came back in (2026-10-11): the core's recurrence lane counts sessions.
      session: sessionId,
    });
    if (outcome.credited) {
      state.credited[memoryId] = { turn: state.turn, tier, day: today };
    }
    // Only when RECALL showed the chapter this session (review of #293, S4):
    // then it was the collapsed pair. A chapter credited from the wake or the
    // `chapter` tool credits the chapter alone, as before.
    const copies = surfaced !== undefined ? this.creditCopies(state, memoryId, today, tier, cued, sessionId) : 0;
    if (outcome.credited || copies > 0) this.persist(state, "resolveUse");
    this.emit("recall.credit", memoryId, {
      tier,
      w,
      credited: outcome.credited,
      reason: outcome.reason,
    });
    // CUE LEARNING (R3): a credited use trains, and so does one physics
    // refused only for its day cadence (five pings in five sessions train
    // five times). Never the writing session on the birth day (`own-write`,
    // physics' gate, not re-derived), nor an unknown writer on it
    // (`birth-day`), nor a belief, a display tier, or a stale day.
    const cues =
      outcome.credited || outcome.reason === "already-credited-today"
        ? this.cueTraining(sessionId, state, memoryId, cueTrainShare(tier, this.tunables), today)
        : [];
    return {
      credited: outcome.credited,
      reason: outcome.credited ? "credited" : "physics-refused",
      tier,
      w,
      outcome,
      ...(cues.length === 0 ? {} : { cues }),
    };
  }

  /**
   * A RATING OF 0 (R3): the pairs the turn that showed `memoryId` made are
   * depressed by `CUE_TRAIN_RATED_ZERO` of a full use — cue-specific
   * habituation. Returns the (negative) deltas for the caller to hand to
   * `associate/`; nothing under observer, with the switch off, or for a
   * memory this session never showed. Ratings of 0 never reach `resolveUse`
   * (`RATING_TIER[0]` is null), so the rating pass calls this.
   */
  cueDepress(sessionId: string, memoryId: string): LearnedCueDelta[] {
    if (this.observer || !PHYSICS.CUE_LEARNING) return [];
    const { state } = loadGateState(this.store, sessionId, this.tunables.MAX_SESSION_RECORDS);
    if (state.surfaced[memoryId]?.trains === false) return [];
    return this.cueTraining(sessionId, state, memoryId, -this.tunables.CUE_TRAIN_RATED_ZERO, this.store.livedDay());
  }

  /**
   * A DELIBERATE QUESTION'S CUE WORDS (R3): the words of a question whose
   * answer showed memories, kept as an `asked` showing's cue record
   * (`askedCueRef`), so opening one of them later trains the question's words
   * to it. The same cue rules as a turn's (`buildCues` on the question,
   * rarity measured against the index: df > 0 only), carried words none.
   * Nothing under observer or with the switch off. Never throws.
   */
  noteQuestionCues(sessionId: string, question: string, askedAt: number): number {
    if (this.observer || !PHYSICS.CUE_LEARNING) return 0;
    try {
      const { text } = stripBoilerplate(question);
      const words = this.questionCueWords(text);
      if (words.length === 0) return 0;
      saveTurnCues(this.store, { sessionId, ref: askedCueRef(askedAt), turn: askedAt, day: this.store.livedDay(), words });
      return words.length;
    } catch (err) {
      this.emit("recall.cues.save.failed", sessionId, { code: err instanceof Error ? err.name : "unknown", site: "asked" });
      return 0;
    }
  }

  /** The cue words of a text, as an ambient turn would build them (no carry, no aliases). */
  private questionCueWords(text: string): CueWord[] {
    const forms = new Map<string, string[]>();
    for (const tok of tokenize(text)) {
      if (tok.length < this.tunables.MIN_CUE_LENGTH) continue;
      const key = stemTerm(tok);
      const f = forms.get(key) ?? [];
      if (!f.includes(tok)) f.push(tok);
      forms.set(key, f);
    }
    if (forms.size === 0) return [];
    const byForms = this.store.docFrequency([...forms.values()].map((f) => f.join(" ")));
    const df = new Map<string, number>();
    for (const [key, f] of forms) {
      const n = byForms.get(f.join(" "));
      if (n !== undefined) df.set(key, n);
    }
    const storeSize = this.store.countMemories({ archived: false });
    const cues = buildCues(
      { text, carried: [], storeSize, df, term: stemTerm, wordNorm: (w: string) => this.store.wordNorm?.(w) ?? null },
      this.tunables,
    );
    return cueWordsOf(cues);
  }

  /**
   * THE TRAINING (R3): `share` of a full use (negative for a 0 rating) from
   * the showing of `memoryId` this session — the ambient turn that showed it
   * (`state.surfaced`), else the newest deliberate question whose answer did
   * (`asked`) — split over that showing's cue words in proportion to their
   * weights, `CUE_TRAIN_RATE` per full use. Each showing trains a memory at
   * most up to its best share: a second credit of the same showing (an open
   * then a 3) trains only the difference, a 0 after a 3 takes the 3 back and
   * depresses. The record of what trained is written here; the deltas go back
   * to the caller. Nothing when no showing has cue words. Never throws.
   */
  private cueTraining(sessionId: string, state: GateState, memoryId: string, share: number, day: number): LearnedCueDelta[] {
    if (this.observer || !PHYSICS.CUE_LEARNING || share === 0 || !(this.tunables.CUE_TRAIN_RATE > 0)) return [];
    try {
      let ref: string | null = null;
      const shown = state.surfaced[memoryId];
      if (shown !== undefined) {
        if (!shown.trains) return [];
        ref = turnCueRef(shown.turn);
      } else {
        const asked = this.store
          .gateRecords(sessionId, ASKED_KIND)
          .filter((r) => r.ref === memoryId)
          .sort((a, b) => b.turn - a.turn)[0];
        if (asked !== undefined) ref = askedCueRef(asked.turn);
      }
      if (ref === null) return [];
      const words = loadTurnCues(this.store, sessionId, ref);
      if (words === null) return [];
      const trained = loadCueTrained(this.store, sessionId, memoryId);
      const before = trained[ref] ?? 0;
      // Positive: up to the best share, never twice. Negative (a 0): to the
      // depression, from wherever the showing stood.
      const target = share > 0 ? Math.max(before, share) : share;
      const step = target - before;
      if (step === 0) return [];
      const total = words.reduce((s, [, w]) => s + w, 0);
      if (!(total > 0)) return [];
      const deltas = words
        .map(([token, w]) => ({ token, id: memoryId, delta: this.tunables.CUE_TRAIN_RATE * step * (w / total) }))
        .filter((x) => x.delta !== 0 && Number.isFinite(x.delta));
      saveCueTrained(this.store, sessionId, memoryId, { ...trained, [ref]: target }, day);
      this.emit("recall.cues.trained", memoryId, { ref: ref.startsWith("a") ? "asked" : "turn", words: deltas.length, step });
      return deltas;
    } catch (err) {
      this.emit("recall.cues.train.failed", memoryId, { code: err instanceof Error ? err.name : "unknown" });
      return [];
    }
  }

  /**
   * The DELIVERY-side event (scar §2.3: "we rendered it" is not "they received
   * it"). The host calls this with the last line it actually saw in context; a
   * mismatch is the only way to tell a delivered injection from a truncated one.
   */
  noteDelivered(sessionId: string, sentinelSeen: string | null, expected: string | null): boolean {
    const ok = expected !== null && sentinelSeen === expected;
    this.emit("recall.delivered", sessionId, {
      ok,
      sawSentinel: sentinelSeen !== null,
      expected: expected !== null,
    });
    return ok;
  }

  /** Read-only view of the persisted gate state — for tests, replay and the dashboard. */
  gateState(sessionId: string): GateState {
    return this.observer
      ? this.volatileState(sessionId)
      : loadGateState(this.store, sessionId, this.tunables.MAX_SESSION_RECORDS).state;
  }

  events(): RecallEvent[] {
    return this.ring.map((e) => ({ ...e }));
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * A CHAPTER'S USE IS ALSO ITS COPY'S — when recall showed it (2026-09-30,
   * U13). Recall shows a chapter and its own copy as one result — the chapter
   * (`activate.ts`, the collapse) — and a chapter's physics are recorded and
   * never acted on (`JOURNAL_GLOSS`): it sits outside decay. The copy is the
   * memory that fades, so without this the collapse would starve it of every
   * use it used to earn by being shown.
   *
   * SCOPED (review of #293, S4): the caller forwards only when this session's
   * gate state holds the chapter — recall surfaced or footnoted it, which is
   * the collapsed pair. A chapter used off the wake or the `chapter` tool
   * credits itself only, as it always did; forwarding those too would make
   * copies fade SLOWER than before. A chapter read through the deliberate ask
   * leaves no gate state (that path records nothing), so its use credits the
   * chapter only — a copy listed on its own there used to earn that use.
   *
   * Same tier, same once-a-day rule per copy, the copy's OWN `trains` check (a
   * copy this session saw only through an ambiguous handle trains nothing), and
   * physics decides; a copy that throws is skipped and the chapter's own credit
   * stands. Returns how many copies were credited.
   */
  private creditCopies(state: GateState, memoryId: string, today: number, tier: UseTier, cued: boolean, sessionId: string): number {
    let copies: string[];
    try {
      if (this.store.row(memoryId)?.type !== "episode") return 0;
      // A frozen full copy stands for the whole episode and is credited as
      // before; a chapter's SUMMARY only when recall folded it into this
      // chapter this session (2026-10-15) — one use of a long session must
      // not keep every chapter's summary from fading.
      copies = this.store
        .list({ type: "memory", source: "episode", originRef: memoryId, archived: false })
        .filter((id) => {
          const row = this.store.row(id);
          return row !== undefined && (!isChapterSummary(row) || state.folded?.[id] === memoryId);
        });
    } catch {
      return 0;
    }
    const w = USE_TIER_WEIGHT[tier];
    let n = 0;
    for (const copy of copies) {
      if (state.surfaced[copy]?.trains === false) continue;
      const prior = state.credited[copy];
      if (prior !== undefined && prior.day === today && USE_TIER_WEIGHT[prior.tier] >= w) continue;
      const upgradeFrom = upgradeOf(prior, today, w);
      try {
        const out = this.store.reinforce(copy, today, tier, {
          ...(cued ? { cued: true } : {}),
          ...(upgradeFrom === undefined ? {} : { upgradeFrom }),
          session: sessionId,
        });
        this.emit("recall.credit", copy, { tier, w, credited: out.credited, reason: out.reason, via: "chapter" });
        if (!out.credited) continue;
        state.credited[copy] = { turn: state.turn, tier, day: today };
        n += 1;
      } catch {
        continue;
      }
    }
    return n;
  }

  private readonly ring: RecallEvent[] = [];

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const e: RecallEvent = { at: this.now(), name };
    if (ref !== undefined) e.ref = ref;
    if (data !== undefined) e.data = data;
    this.ring.push(e);
    if (this.ring.length > 500) this.ring.shift();
    this.onEvent?.(e);
  }

  private volatileState(sessionId: string): GateState {
    let s = this.volatile.get(sessionId);
    if (s === undefined) {
      s = loadGateState(this.store, sessionId, this.tunables.MAX_SESSION_RECORDS).state;
      this.volatile.set(sessionId, s);
    }
    return s;
  }

  /**
   * The one write site for gate state. Under observer it stands down BEFORE the
   * store seam is touched and keeps the state in-process instead: an instrument
   * deposits nothing, and every stand-down is observable (observer-mode.md G6).
   */
  private persist(state: GateState, site: string, extra: readonly GateRecordInput[] = []): void {
    if (this.observer) {
      this.volatile.set(state.sessionId, state);
      this.emit("recall.observer.standdown", state.sessionId, { site: `persist:${site}` });
      return;
    }
    saveGateState(this.store, state, this.tunables.MAX_SESSION_RECORDS, extra);
  }

  private emitTelemetry(d: RecallDecision, r: RenderResult | null): void {
    const counts = new Map<Verdict, number>();
    for (const v of d.verdicts) counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
    for (const [verdict, count] of counts) {
      if (verdict === "surfaced" || verdict === "footnoted") continue;
      this.emit("recall.withheld", undefined, { reason: verdict, count });
    }
    for (const t of d.trimmed) this.emit("recall.trim", t.id ?? undefined, { lane: t.lane });

    if (d.reason === "rendered") {
      // §2.9: context assembly logs WHAT IT SHOWED, by id.
      this.emit("recall.rendered", d.sessionId, {
        turn: d.turn,
        regime: d.background.regime,
        candidates: d.candidates,
        surfaced: d.surfaced.length,
        footnotes: d.footnotes.length,
        affect: d.affectFlag,
        bytes: d.bytes,
        budget: d.budgetBytes,
        ids: [...d.surfaced, ...d.footnotes].join(","),
        // The beliefs slot's lines (lane E): a turn may render with these alone.
        beliefs: d.beliefs?.shown.length ?? 0,
        elapsedMs: d.elapsedMs,
      });
      if (r?.pressure === true) {
        this.emit("recall.budget.pressure", d.sessionId, {
          bytes: d.bytes,
          budget: d.budgetBytes,
        });
      }
    } else {
      this.emit("recall.quiet", d.sessionId, {
        turn: d.turn,
        reason: d.reason,
        candidates: d.candidates,
        regime: d.background.regime,
      });
    }
  }
}

/** The lower tier credited earlier this lived day that a use at weight `w` lifts, if any. */
function upgradeOf(prior: { tier: UseTier; day: number } | undefined, today: number, w: number): UseTier | undefined {
  if (prior === undefined || prior.day !== today) return undefined;
  const from = USE_TIER_WEIGHT[prior.tier];
  return from > 0 && from < w ? prior.tier : undefined;
}

/**
 * THE CHAIN HEAD WINS AMBIENT RECALL (2026-10-11, Group 2; review 04 change
 * 1, MOD #3). A candidate a later memory settled over (`headOf`) carries its
 * head, and the gate inhibits it when the head is admitted or already in the
 * session. When the turn did not reach the head itself (or reached it more
 * weakly than the earlier one, 2026-10-19), the head is brought
 * in to stand for it — the earlier's numbers (what came to mind), the head's
 * words, and its standing label naming the earlier one (`(earlier: [id])`) —
 * left out of the turn's background. Bounded:
 * one `headOf` per candidate (a few indexed reads); never throws.
 */
export function headsWin(store: Store, candidates: readonly Candidate[], day: number): Candidate[] {
  // A HEAD REACHED ONLY BY A LINK is not the turn reaching it (2026-10-11,
  // Group 2b, left from #420): as a quiet pointer it sat in its own slots,
  // apart from what the words found, so the earlier version the words found
  // was never inhibited and both showed. It is brought in to stand for the
  // earlier one instead, and its link-only candidate is dropped.
  //
  // A HEAD THE WORDS REACHED MORE WEAKLY than the earlier one (2026-10-19, an
  // experiment) stands in for it too, with the earlier's numbers: on its own
  // weak reach it failed its bar while the earlier passed and showed without
  // it. Its direct candidate is dropped; its own reach stays in the turn's
  // background (`directReach`, review of #526). Trying this to see the
  // earlier-shown-without-its-head count go to ~0; check ~10-22; revert by
  // skipping the head whenever `reached` has it, and dropping `directReach`
  // (docs/decisions.d/fix-head-wins-gap-1019.md).
  const reached = new Map(candidates.filter((c) => c.linkOnly !== true).map((c) => [c.id, c]));
  const heads = candidates.map((c): string | null => {
    try {
      return headOf(store, c.id);
    } catch {
      return null;
    }
  });
  // ONE EARLIER PER HEAD stands for it, the STRONGEST the words reached (review
  // of #526): candidates come in the cut's salience order, so taking the first
  // one met let the head stand in at a weaker earlier's numbers while a
  // stronger earlier (a chain A→B→C, or two memories one head settled over)
  // cleared its own bar and showed alone. A link-only earlier claims the head
  // only when no word-reached one does.
  const claimant = new Map<string, Candidate>();
  candidates.forEach((c, i) => {
    const head = heads[i];
    if (head === null || head === undefined) return;
    const prev = claimant.get(head);
    const better =
      prev === undefined ||
      (prev.linkOnly === true && c.linkOnly !== true) ||
      (prev.linkOnly !== true && c.linkOnly !== true && c.activation > prev.activation);
    if (better) claimant.set(head, c);
  });
  const out: Candidate[] = [];
  const brought = new Set<string>();
  candidates.forEach((c, i) => {
    const head = heads[i];
    if (head === null || head === undefined) {
      out.push(c);
      return;
    }
    out.push({ ...c, head });
    if (claimant.get(head) !== c) return;
    // A link-only earlier's arrival is not in the words' units (review of
    // #526): it never displaces a head the words reached.
    const direct = reached.get(head);
    if (direct !== undefined && (c.linkOnly === true || direct.activation >= c.activation)) return;
    try {
      const row = store.row(head);
      // A belief never stands in for a candidate either (lane C: invisible until lane E).
      if (row === undefined || isBeliefRow(row)) return;
      const physics = store.physicsOf(head);
      out.push({
        ...c,
        id: head,
        kind: row.kind as Kind,
        doc: store.readProse(head),
        physics,
        strength: strength(physics, day),
        standsFor: c.id,
        ...(direct !== undefined && direct.pastCut !== true && direct.cue - (direct.stamp ?? 0) + direct.semantic > 0
          ? // The words' reach only: a head start priming gave the direct
            // candidate stays out of the background (review of #530).
            { directReach: direct.activation - (direct.stamp ?? 0) - primeOf(direct), directSal: direct.sal }
          : {}),
      });
      brought.add(head);
    } catch {
      /* an unreadable head: the earlier one shows, labelled */
    }
  });
  return brought.size === 0 ? out : out.filter((c) => !(brought.has(c.id) && c.standsFor === undefined));
}

function trainsOf(verdicts: readonly CandidateVerdict[], id: string): boolean {
  return verdicts.find((v) => v.id === id)?.trains ?? true;
}

/**
 * Id → text, at render time only. A missing doc renders as its own id.
 *
 * The journal flag is read off the doc's own `type` — the same field
 * `sleep/types.ts#isJournal` reads off the row — so the label cannot disagree
 * with what the rest of the system calls a chapter, and nothing had to be added
 * to the candidate, the verdict or the decision record to carry it.
 */
function resolveDoc(doc: ProseDoc | undefined, id: string): Resolved {
  if (doc === undefined) return { title: id, gist: id };
  const firstLine = doc.body.split("\n").find((l) => l.trim().length > 0) ?? "";
  const paragraph = doc.body.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? doc.body;
  return { title: doc.title ?? firstLine, gist: paragraph, journal: doc.type === "episode" };
}

export type { Kind, CandidateVerdict, Verdict, Background, GateState, UseTier, CreditOutcome };
