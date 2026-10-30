/**
 * The surfacing gate — the one place a candidate becomes an intrusion.
 *
 * The named deviation from the brain (constitution line 12, contract §2):
 * **surfacing is judged relative to THIS TURN'S OWN BACKGROUND distribution**,
 * not against an absolute threshold. *Where a design wants `if x > threshold`,
 * suspect a flattened gradient.*
 *
 * Three hard gates salience cannot touch (§9 G7), checked in this order and no
 * other — the order IS the guarantee:
 *
 *   (a) **an uncued memory is dark**, whatever its salience: the salience
 *       arithmetic is never even evaluated — with one named lane since
 *       2026-09-28: a QUIET POINTER (`Candidate.linkOnly`, a memory only links
 *       reached) goes to its own few slots in the quiet tier and nowhere else;
 *   (b) an **absolute floor** is checked BEFORE any salience adjustment;
 *   (c) the loud tier requires a **minimum fraction of activation from cues**, so
 *       recency alone can never carry a memory there no matter how sacred it is.
 *
 * One boundary gate sits in front of all three, and salience cannot touch it
 * either: **session dedup** (this session already saw it). The confidentiality
 * gate that sat beside it was retired 2026-10-21 (recall CONTRACT §5 G9).
 *
 * `protected` grants NO surfacing privilege. A protected memory is one revision
 * may not overwrite; that is a write-side property and it buys nothing here.
 *
 * Every verdict names its REASON. A bare boolean cannot be told apart from a bug,
 * and the per-turn decision record is the richest replay comparison surface
 * (contract §5 G14, scar §2.4).
 */
import { emotionalIntensity } from "../physics/index.js";
import { tokenize } from "../store/index.js";
import type { Candidate } from "./activate.js";
import { primeChannel, primeOf } from "./activate.js";
import { MIN_RARITY_STORE, informativeness } from "./cues.js";
import type { GateState } from "./session.js";
import { strongFloor } from "./tunables.js";
import type { RecallTunables } from "./tunables.js";

export type Verdict =
  /** Admitted, loud tier: "came to mind". */
  | "surfaced"
  /** Admitted, quiet tier: "quietly available". */
  | "footnoted"
  /** Boundary: this session already saw it. */
  | "dedup-suppressed"
  /** This session WROTE it (since its last compaction), so it is already in
   *  its context: would have been shown, and was not (2026-10-19, part C). */
  | "echo-skipped"
  /** Another project's work, in a turn in this one (`GateInput.elsewhere`,
   *  `RECALL_BY_PROJECT`, 2026-10-21): would have been shown, and was not. */
  | "project-skipped"
  /** Hard gate (a). */
  | "dark-uncued"
  /** Hard gate (b), evaluated before any salience adjustment. */
  | "below-floor"
  /** Below this turn's own background bar. */
  | "below-bar"
  /** Hard gate (c): too little of the activation came from cues. */
  | "cue-fraction"
  /** The per-candidate ceiling: the only cue was a remembered date, and a date
   *  may make a memory quietly available, never loud (prospective §12 G5). */
  | "cue-only-temporal"
  /** The store is smaller than `MIN_RARITY_STORE`, so the rarity channel cannot
   *  discriminate: every token in the only memory is maximally rare and a turn
   *  sharing nothing but function words scores like a turn that is about it.
   *  Arrival makes it warm; nothing at this size can make it loud. */
  | "cold-start-undiscriminating"
  /** Reached the bar, but not the loud tier's per-kind floor. */
  | "below-strong-floor"
  /** Lateral inhibition: a near-duplicate of a stronger admitted candidate. */
  | "inhibited"
  /** Admitted but past the tier cap. An empty slot stays quiet; a full one closes. */
  | "capped";

export type Regime = "relative" | "absolute-cold-start" | "absolute-thin-background";

export interface CandidateVerdict {
  readonly id: string;
  readonly kind: string;
  readonly verdict: Verdict;
  readonly activation: number;
  readonly cue: number;
  /** The temporal portion of `cue` (already inside it) — SEAMS item D. */
  readonly temporal: number;
  readonly semantic: number;
  readonly arrival: number;
  /** Spreading activation (SEAMS item L) — in `activation`, not in cues. */
  readonly hops: number;
  readonly cueFraction: number;
  readonly sal: number;
  /** The part of `sal` the current mood added (recall G18). Present only when > 0. */
  readonly mood?: number;
  readonly strength: number;
  /** False ⇒ this memory may never be credited from this turn (§9 G5). */
  readonly trains: boolean;
  /** The admission bar this candidate actually faced, after leave-one-out and
   *  salience modulation. Two candidates in one turn face different numbers; a
   *  single turn-level bar in the record would be a fiction. */
  readonly bar: number;
  /** For an admitted-but-quiet candidate: which loud-tier check stopped it.
   *  "The footnote tier is where the loud tier said no" is a question replay
   *  asks constantly; a bare tier label cannot answer it. */
  readonly loudBlockedBy?: Verdict;
  /** `"link"` for a QUIET POINTER — a memory only links reached (2026-09-28,
   *  `activate.ts#Candidate.linkOnly`). Its verdict is one of the ordinary ones;
   *  this says which lane it came by. Absent for everything the conversation
   *  reached. `"see-also"` (2026-10-29, `activate.ts#seeAlso`): brought along because
   *  a memory the turn shows NAMES its id; `seeAlso.by` is that memory. */
  readonly via?: "link" | "see-also";
  /** SEE-ALSO (2026-10-29): the shown memory whose text named this one. Set
   *  only with `via: "see-also"`; its verdict is then `footnoted`, whatever
   *  the gate said of it on its own (the number fields are the gate's, or 0
   *  for a memory no channel reached). */
  readonly seeAlso?: { readonly by: string };
  /** HABITUATED (2026-10-19, `habituation.ts`): rated 0 in enough recent
   *  sessions that the bar it faced (`bar`) was raised. Absent otherwise. */
  readonly habituated?: true;
  /** COMPETED (2026-10-24, E3): the older of an unsettled pair whose newer
   *  (`with`) was a candidate too, so once admitted its activation counted
   *  at `factor` — `activation` above is the scaled number the loud tier and
   *  the rankings saw; it cleared `bar` at `activation / factor`. Absent
   *  otherwise. */
  readonly competed?: { readonly with: string; readonly factor: number };
  /**
   * PRIMED (context priming, an experiment, 2026-10-19; `prime.ts`): the head
   * start in `activation` from links (`link`) and the train of thought
   * (`train`), the kinds of source behind the link part (`from`), and
   * `lifted` when it was admitted only because of it — the cut without
   * priming left it out, or its activation without priming was under the bar
   * it faced. Absent when nothing primed it. Since lane E (2026-10-22):
   * `tag`, the part of `link` a source's tags gave (`TAGS_PRIME`); `by`, the
   * channel that gave most (`link`, `tag` or `train`); `top`, the source id
   * that gave most along links or tags.
   */
  readonly primed?: {
    readonly link: number;
    readonly train: number;
    readonly from: readonly string[];
    readonly lifted?: true;
    readonly tag?: number;
    readonly by?: "link" | "tag" | "train";
    readonly top?: string;
  };
}

export interface Background {
  readonly regime: Regime;
  readonly n: number;
  /** Whole-sample statistics — the turn-level summary the decision record
   *  reports. The bar each candidate FACES is leave-one-out (see `barsFor`). */
  readonly mean: number;
  readonly sd: number;
  /** Whole-sample admission bar, before leave-one-out and salience. Reported for
   *  replay comparison; not the number any candidate is judged against in the
   *  relative regime. */
  readonly bar: number;
  readonly strongBar: number;
  readonly floor: number;
}

export interface GateInput {
  readonly candidates: readonly Candidate[];
  readonly state: GateState;
  readonly storeSize: number;
  /** The turn stated a feeling (any subject) — the affect flag's turn gate. */
  readonly affectStated: boolean;
  readonly turn: number;
  /** Memories this session wrote — ambient recall's echo set (`Turn.echo`). */
  readonly echo?: ReadonlySet<string>;
  /** Another project's work (`Turn.elsewhere`, 2026-10-21): turned away as
   *  `project-skipped` where it would have been shown (`RECALL_BY_PROJECT`).
   *  Absent: none. */
  readonly elsewhere?: (id: string) => boolean;
  /** Another project's work, facing `CROSS_PROJECT_BAR_LIFT` (Mike, 2026-10-21).
   *  Absent: no lift. */
  readonly crossing?: (id: string) => boolean;
  /** Memories habituated this turn (`habituation.ts#habituatedIds`, 2026-10-19). Absent: none. */
  readonly habituated?: ReadonlyMap<string, number>;
  /** The olders of standing unsettled pairs whose newer is a candidate too, and
   *  the weight each counts at after the floor (`standing.ts#unsettledCompetition`,
   *  E3, 2026-10-24). Absent: none compete. */
  readonly competing?: ReadonlyMap<string, { readonly with: string; readonly factor: number }>;
}

export interface GateResult {
  readonly background: Background;
  readonly verdicts: CandidateVerdict[];
  readonly surfaced: Candidate[];
  /** The quiet tier: what the conversation reached, then any quiet pointers
   *  (`linkOnly`), in that order — so a render trimming from the end drops the
   *  pointers first. */
  readonly footnotes: Candidate[];
  /** One content-free line: no ids, no bodies, no feeling named. */
  readonly affectFlag: boolean;
  readonly affectReason: "fired" | "no-feeling-in-turn" | "refractory" | "nothing-charged";
  /** Ids only `CROSS_PROJECT_BAR_LIFT` kept below their bar (2026-10-21). */
  readonly crossLifted: readonly string[];
  /** Olders of an unsettled pair that counted at a weight this turn (`GateInput.competing`, E3). Empty: none. */
  readonly competed: readonly string[];
}

/** Jaccard over indexed tokens — the similarity the cache itself would compute. */
export function similarity(a: Candidate, b: Candidate): number {
  const sa = new Set(tokenize(`${a.doc.title ?? ""}\n${a.doc.body}`));
  const sb = new Set(tokenize(`${b.doc.title ?? ""}\n${b.doc.body}`));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const tok of sa) if (sb.has(tok)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/**
 * **The unit the absolute floors are denominated in: ONE MAXIMALLY-RARE CUE.**
 *
 * `informativeness(1, storeSize)` is the weight a cue matching exactly one
 * memory carries — the largest rarity weight the model can produce, and the
 * model's own natural unit. A floor of `2.0` therefore means the same sentence
 * at every scale: *a candidate needs two maximally-rare cues' worth of evidence
 * before it may be admitted.*
 *
 * Why a unit at all (scar §2.8, CONTRACT §7 OQ5). v1's activation was a
 * normalized cosine in 0-1 and its floors were absolute numbers in that space.
 * v2's is a SUM of `idf × length-normalized evidence`, so the same numeral means
 * "everything passes" on a 15,000-memory store (where `informativeness(1, N)` is
 * 8.9) and "nothing passes" on a seventeen-memory one (where it is 2.2). The
 * floors were consequently decorative — MEASURED 2026-09-04: scaling them ×1 to
 * ×15 changed not one delivered item on `tools/recall-bench` — and the loud tier
 * fired on 13 of 13 real turns because only the RELATIVE bar was gating it, and
 * a relative bar cannot keep a low-evidence turn quiet (a thin turn's top
 * candidate stands FURTHER above its own thin background, not nearer).
 *
 * This is ACT-R's retrieval threshold τ, restored to the model's own units: below
 * τ a chunk is not retrieved however distinctive it looks against its neighbours.
 * The relative bar (contract §2's named deviation) is unchanged and still does
 * the discriminating; the floor only says how weak is too weak to be worth
 * anyone's attention.
 *
 * The one thing that made this possible is not in this file: rarity had to be
 * MEASURED before it could be a unit. `activate.ts` was reading document
 * frequency off the length of a bounded top-K, so on a large store every common
 * word looked rare and every turn's activation was inflated by roughly the same
 * amount its rare words were (`store/cache.ts#docFrequency`).
 */
export function floorUnit(storeSize: number): number {
  return informativeness(1, storeSize);
}

/**
 * The background statistic stays GLOBAL across kinds — v1 measured per-kind
 * backgrounds to rescue nothing — and so, as of 2026-09-04, is the loud-tier
 * FLOOR: see `tunables.ts#FLOOR_STRONG_BY_KIND_UNITS` for the measurement that
 * retired v1's per-kind shape without retiring the mechanism (§9 G12).
 *
 * Two degeneracies force the absolute regime, and naming them is the point:
 * a store too small for the variance estimate to mean anything (cold start —
 * *small stores over-surface*, so cold start is STRICTER, not looser), and a
 * background too thin to be a distribution at all, where `mean + k·sd` collapses
 * to the lone candidate's own activation and nothing could ever clear its own bar.
 */
export function background(
  activations: readonly number[],
  storeSize: number,
  t: RecallTunables,
): Background {
  const n = activations.length;
  const mean = n === 0 ? 0 : activations.reduce((a, b) => a + b, 0) / n;
  const varSum = activations.reduce((acc, x) => acc + (x - mean) * (x - mean), 0);
  const sd = n === 0 ? 0 : Math.sqrt(varSum / n);
  const unit = floorUnit(storeSize);

  if (storeSize < t.COLD_START_MIN_STORE) {
    const cold = t.COLD_START_FLOOR_UNITS * unit;
    return {
      regime: "absolute-cold-start",
      n,
      mean,
      sd,
      bar: cold,
      strongBar: cold,
      floor: cold,
    };
  }
  const floor = t.FLOOR_GLOBAL_UNITS * unit;
  if (n < t.MIN_BACKGROUND_SAMPLE || sd === 0) {
    return {
      regime: "absolute-thin-background",
      n,
      mean,
      sd,
      bar: floor,
      strongBar: floor,
      floor,
    };
  }
  return {
    regime: "relative",
    n,
    mean,
    sd,
    bar: mean + t.SNR_GLOBAL * sd,
    strongBar: mean + t.SNR_STRONG * sd,
    floor,
  };
}

/**
 * Two-sided salience modulation of the RELATIVE bar only. Salience lowers the bar
 * for what already passed relevance and raises it for what barely registers; it
 * never bypasses relevance and it never touches the absolute regimes, whose whole
 * purpose is to be un-negotiable.
 */
function modulate(bar: number, sal: number, regime: Regime, t: RecallTunables): number {
  if (regime !== "relative") return bar;
  return bar * (1 - t.SAL_BAR_WEIGHT * (2 * sal - 1));
}

/**
 * The bar one candidate faces, computed LEAVE-ONE-OUT: the background is the
 * turn's OTHER activations, never the candidate's own.
 *
 * This is a correction v1's shape invites and does not make. Including the
 * candidate in its own background means the strongest hit drags `mean + k·sd` up
 * by roughly the amount it stands out — so a lone, perfectly-cued memory is
 * measured against itself and can never clear its own bar. "Relative to this
 * turn's background" only means anything if the candidate is not the background.
 */
export function looBar(
  activation: number,
  sum: number,
  sumSq: number,
  n: number,
  snr: number,
): number {
  const m = n - 1;
  if (m <= 0) return activation;
  const mean = (sum - activation) / m;
  const variance = Math.max(0, (sumSq - activation * activation) / m - mean * mean);
  return mean + snr * Math.sqrt(variance);
}

export function gate(input: GateInput, t: RecallTunables): GateResult {
  // THE BACKGROUND IS WHAT THE WORDS AND MEANING FOUND (review of #293, B2).
  // A deliberate question about feeling lets stamps bring cue
  // (`Candidate.stamp`); that part is measured AGAINST this turn's background,
  // never part of it — six nominations at several cue units each raised the
  // relative bar sevenfold and dropped every answer the words had found a
  // tier. A candidate only stamps reached, or one kept only because of a stamp
  // (`pastCut` — the words reached it too weakly to make the cut), is outside
  // the sample; its bar is the whole sample's. Absent on every ambient turn, so there nothing changes.
  // PRIMING (an experiment, 2026-10-19) is measured against the background
  // the same way, never part of it: a primed cluster in the sample would raise
  // every other candidate's bar — the tunnel vision the review watches for,
  // built into the mechanism.
  const own = (c: Candidate): number => c.activation - (c.stamp ?? 0) - primeOf(c);
  // A head brought in for an earlier memory (`standsFor`, 2026-10-11) is the
  // same reach counted twice: outside the sample too — but it faces the bar
  // of the one it stands for (`barOf`), not the whole sample's.
  const inSample = (c: Candidate): boolean => c.pastCut !== true && c.standsFor === undefined && c.cue - (c.stamp ?? 0) + c.semantic > 0;
  // A stand-in the words also reached on their own keeps that reach in the
  // background (`directReach`, review of #526): what the words found, once.
  const acts = [
    ...input.candidates.filter(inSample).map(own),
    ...input.candidates.flatMap((c) => (c.standsFor !== undefined && c.directReach !== undefined ? [c.directReach] : [])),
  ];
  const bg = background(acts, input.storeSize, t);
  /** The loud-tier floors are in the same unit as hard gate (b)'s (`floorUnit`). */
  const loudUnit = floorUnit(input.storeSize);
  const sum = acts.reduce((a, b) => a + b, 0);
  const sumSq = acts.reduce((a, b) => a + b * b, 0);
  const n = acts.length;
  // A HEAD STANDING IN FACES THE BAR OF WHAT IT STANDS FOR (2026-10-19, an
  // experiment): it carries the earlier one's numbers, so with the
  // whole-sample bar a marginal earlier one cleared its leave-one-out bar and
  // showed while its head failed. Trying the earlier's own bar to see the
  // earlier-shown-without-its-head count go to ~0; check ~10-22; revert by
  // dropping this lookup (docs/decisions.d/fix-head-wins-gap-1019.md).
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const barOf = (c: Candidate, snr: number): number => {
    const basis = (c.standsFor !== undefined ? byId.get(c.standsFor) : undefined) ?? c;
    return inSample(basis) ? looBar(own(basis), sum, sumSq, n, snr) : bg.mean + snr * bg.sd;
  };
  // EITHER BAR (2026-10-19, an experiment; the coordinator's call on the
  // review of #526): a stand-in the words also reached on their own
  // (`directReach`) passes when it clears the earlier one's bar at the
  // earlier's numbers OR its own bar at its own reach and salience, so a head
  // that showed on its own before still does. Its own bar is carried in the
  // stand-in's units (shifted by the gap between the two reaches), so one
  // comparison against `activation` decides, and the bar recorded is the one
  // that let it through.
  const directBar = (c: Candidate, snr: number): number | undefined =>
    c.standsFor !== undefined && c.directReach !== undefined
      ? modulate(looBar(c.directReach, sum, sumSq, n, snr), c.directSal ?? c.sal, bg.regime, t) + (c.activation - c.directReach)
      : undefined;
  const either = (c: Candidate, snr: number): number => {
    const viaEarlier = modulate(barOf(c, snr), c.sal, bg.regime, t);
    const viaOwn = directBar(c, snr);
    return viaOwn === undefined ? viaEarlier : Math.min(viaEarlier, viaOwn);
  };
  const barsFor = (c: Candidate): { admit: number; loud: number } =>
    bg.regime === "relative" ? { admit: either(c, t.SNR_GLOBAL), loud: either(c, t.SNR_STRONG) } : { admit: bg.bar, loud: bg.strongBar };

  const verdicts: CandidateVerdict[] = [];
  const admitted: { c: Candidate; loud: boolean }[] = [];
  const loudBlock = new Map<string, Verdict>();
  const faced = new Map<string, number>();
  /** Candidates whose bar habituation raised (marked on their verdicts). */
  const habituatedIds = new Set<string>();
  /** Olders of an unsettled pair whose activation counted at a weight (E3; marked on their verdicts). */
  const competedIds = new Map<string, { with: string; factor: number }>();
  /** Admitted primed candidates priming alone put over their bar or into the cut. */
  const primeLifted = new Set<string>();
  const record = (c: Candidate, verdict: Verdict): void => {
    const blocked = loudBlock.get(c.id);
    verdicts.push({
      bar: faced.get(c.id) ?? bg.bar,
      id: c.id,
      kind: c.kind,
      verdict,
      activation: c.activation,
      cue: c.cue,
      temporal: c.temporal,
      semantic: c.semantic,
      arrival: c.arrival,
      hops: c.hops,
      cueFraction: c.cueFraction,
      sal: c.sal,
      ...(c.mood > 0 ? { mood: c.mood } : {}),
      strength: c.strength,
      trains: c.trains,
      ...(blocked !== undefined ? { loudBlockedBy: blocked } : {}),
      ...(c.linkOnly === true ? { via: "link" as const } : {}),
      ...(habituatedIds.has(c.id) ? { habituated: true as const } : {}),
      ...(competedIds.has(c.id) ? { competed: competedIds.get(c.id) as { with: string; factor: number } } : {}),
      ...(c.prime === undefined
        ? {}
        : {
            primed: {
              link: c.prime.link,
              train: c.prime.train,
              from: c.prime.from,
              ...(primeLifted.has(c.id) ? { lifted: true as const } : {}),
              ...(c.prime.tag !== undefined && c.prime.tag > 0 ? { tag: c.prime.tag } : {}),
              by: primeChannel(c.prime),
              ...(c.prime.top === undefined ? {} : { top: c.prime.top }),
            },
          }),
    });
  };

  /** In this session's echo set (`GateInput.echo`). */
  const echo = (id: string): boolean => input.echo?.has(id) === true;
  /** Another project's work (`GateInput.elsewhere`, `.crossing`). A throw reads as not. */
  const asks = (f: ((id: string) => boolean) | undefined, id: string): boolean => {
    if (f === undefined) return false;
    try {
      return f(id);
    } catch {
      return false;
    }
  };
  const elsewhere = (id: string): boolean => asks(input.elsewhere, id);
  const crossing = (id: string): boolean => asks(input.crossing, id);

  /** Candidates only `CROSS_PROJECT_BAR_LIFT` kept from showing. */
  const crossLifted = new Set<string>();

  /** Quiet pointers that passed the boundary gates, in the order activation
   *  ranked them (strongest arrival first). */
  const pointerPool: Candidate[] = [];

  /** Charged candidates feed the affect flag even when they never surface —
   *  a content-free line leaks nothing, and that is what makes it the cheapest
   *  tier. */
  let charged = false;

  for (let c of input.candidates) {
    // Hard gate (a) — uncued is dark. Salience is never evaluated below here
    // for such a candidate, which is the guarantee, not an optimization.
    // ONE LANE IS NAMED (2026-09-28, association build 2): a QUIET POINTER —
    // a memory only links reached (`linkOnly`) — is not dark. It skips the
    // floor and the bar (neither is in its units: it carries no cue), charges
    // no affect flag (the turn did not touch it), and goes to its own few
    // quiet slots below — only when a memory the turn SHOWS passed it enough
    // (the anchor), and never the loud tier. Every other uncued candidate is
    // dark, as before.
    if (c.cue + c.semantic <= 0) {
      if (c.linkOnly !== true) {
        record(c, "dark-uncued");
        continue;
      }
      if (input.state.surfaced[c.id] !== undefined) {
        record(c, "dedup-suppressed");
        continue;
      }
      if (echo(c.id)) {
        record(c, "echo-skipped");
        continue;
      }
      if (elsewhere(c.id)) {
        record(c, "project-skipped");
        continue;
      }
      pointerPool.push(c);
      continue;
    }
    // The affect flag is charged BEFORE dedup, deliberately: the flag is about
    // what THIS TURN touches, and it names nothing — no id, no body, no feeling.
    // A memory already sitting in this session's context still means the turn is
    // near something that carries weight.
    // Charged by the memory's emotional INTENSITY — its numeric score or its
    // strongest recorded feeling, whichever is stronger (physics §5.10).
    if (emotionalIntensity(c.physics) >= t.AFFECT_MIN_EMOTION) charged = true;
    // Boundary gate 2 — session dedup. It is already in this session's context.
    if (input.state.surfaced[c.id] !== undefined) {
      record(c, "dedup-suppressed");
      continue;
    }
    // Hard gate (b) — the absolute floor, BEFORE any salience adjustment.
    // On the activation WITHOUT priming (2026-10-19): the floor says how weak
    // the turn's own evidence may be, and a head start is not evidence.
    if (c.activation - primeOf(c) < bg.floor) {
      record(c, "below-floor");
      continue;
    }
    // HABITUATION (an experiment, 2026-10-19, light): a memory rated 0 in enough recent
    // sessions faces a raised bar, both tiers — after the floor, so the floor
    // still means what it meant; a lift, never a veto.
    const habituated = input.habituated?.has(c.id) === true;
    // ANOTHER PROJECT'S WORK (2026-10-21, Mike's "slightly higher bar", an
    // experiment): its bars lifted too, the same way, after the floor.
    const crosses = t.CROSS_PROJECT_BAR_LIFT > 1 && crossing(c.id);
    const crossLift = crosses ? t.CROSS_PROJECT_BAR_LIFT : 1;
    const lift = (habituated ? 1 + t.HABITUATION_BAR_LIFT : 1) * crossLift;
    const plain = barsFor(c);
    const bars = { admit: plain.admit * lift, loud: plain.loud * lift };
    if (habituated) habituatedIds.add(c.id);
    faced.set(c.id, bars.admit);
    if (c.activation < bars.admit) {
      // What the cross-project lift alone turned away, for the week's read.
      if (crosses && c.activation >= bars.admit / crossLift) crossLifted.add(c.id);
      record(c, "below-bar");
      continue;
    }
    if (c.prime !== undefined && (c.prime.cut === true || c.activation - primeOf(c) < bars.admit)) primeLifted.add(c.id);
    // THE ECHO SKIP (2026-10-19, feedback-loop part C, an experiment): a memory
    // this session wrote is already in its context, so handing it back is the
    // conversation hearing itself. Checked HERE, once it has cleared the floor
    // and its bar, so `echo-skipped` counts only what would have been shown —
    // the number a review reads to see what a long session lost. It stays in
    // the background sample, as a dedup-suppressed candidate does.
    if (echo(c.id)) {
      record(c, "echo-skipped");
      continue;
    }
    // ANOTHER PROJECT'S WORK (2026-10-21, `RECALL_BY_PROJECT`, off by
    // default): checked where the echo skip is, for its reason — the count is
    // what would have been shown.
    if (elsewhere(c.id)) {
      record(c, "project-skipped");
      continue;
    }
    // AN UNSETTLED PAIR COMPETES (2026-10-24, E3, an experiment): the older,
    // with its newer a candidate too, counts from here on at its weight
    // (`standing.ts#unsettledCompetition`) — the loud tier's checks and both
    // rankings see the scaled number, so the newer wins a close race and the
    // older can lose the loud slot or a capped one. Here, once it has cleared
    // the floor and its admission bar at its own reach: a weight, never a
    // filter — it is admitted, labelled, as before, and shows whenever there
    // is room (a wrong pair costs a place in the order, not the memory). Two
    // members that read as near-duplicates are not each other's copy while
    // they compete (below): both show.
    // Only a newer the turn really reached presses: one past the same
    // absolute floor (a stray common word reaches nearly everything).
    const competing = input.competing?.get(c.id);
    const rival = competing === undefined ? undefined : byId.get(competing.with);
    if (competing !== undefined && rival !== undefined && rival.activation - primeOf(rival) >= bg.floor) {
      c = { ...c, activation: c.activation * competing.factor };
      competedIds.set(c.id, { with: competing.with, factor: Math.round(competing.factor * 10_000) / 10_000 });
    }
    // Loud-tier eligibility. Hard gate (c) first: arrival makes a memory warm,
    // only relevance makes it loud.
    let loud = true;
    // The per-candidate ceiling is checked FIRST among the loud-tier rules, so a
    // capped candidate's record NAMES the cap rather than whichever other rule
    // happened to fire second.
    if (c.maxTier === "footnoted") {
      loud = false;
      loudBlock.set(c.id, "cue-only-temporal");
    } else if (input.storeSize < MIN_RARITY_STORE) {
      // Cold start is STRICTER, not looser — and below `MIN_RARITY_STORE` the
      // strictness the floors provide is not available, because the unit the
      // floors are denominated in is itself the thing that has stopped
      // discriminating. On a one-memory store every token the memory holds is
      // maximally rare (`cues.ts#MIN_RARITY_STORE`), so an ordinary note and a
      // turn sharing only `the`/`that`/`and`/`not` reach the loud tier:
      // MEASURED 2026-09-04, a three-sentence note against five unrelated
      // turns went `surfaced` on all five at activation 1.82-2.24 against a
      // loud floor of 4.5 x 0.4055 = 1.8246. The same five turns at N=2
      // footnote at 0.36-0.62. So the tier is capped rather than the floor
      // retuned: arrival makes a memory warm, only relevance makes it loud,
      // and at this size there is no relevance to measure.
      loud = false;
      loudBlock.set(c.id, "cold-start-undiscriminating");
    } else if (c.cueFraction < t.MIN_CUE_FRACTION) {
      loud = false;
      loudBlock.set(c.id, "cue-fraction");
    } else if (c.activation - primeOf(c) < strongFloor(t, c.kind, loudUnit)) {
      loud = false;
      loudBlock.set(c.id, "below-strong-floor");
    } else if (c.activation < bars.loud) {
      loud = false;
      loudBlock.set(c.id, "below-bar");
    }
    admitted.push({ c, loud });
  }

  // ── lateral inhibition on PURE activation (§9 G8: admission, inhibition and
  // the footnote tier never see salience — that is what keeps the footnote tier
  // a recency DISCOVERY channel rather than a second salience ranking).
  admitted.sort((a, b) => b.c.activation - a.c.activation || (a.c.id < b.c.id ? -1 : 1));
  // THE CHAIN HEAD WINS (2026-10-11, Group 2; review 04 change 1): a memory a
  // later one settled over is inhibited when the one that holds now is
  // admitted beside it or is already in this session — before the
  // near-duplicate check, so the head is never the one inhibited as a copy.
  // Measured on 10-10: earlier versions were shown 55 times after their
  // settle, 51 of them without their successor; the newer only 43.
  const admittedIds = new Set(admitted.map((a) => a.c.id));
  // HELD BACK WHENEVER ITS HEAD WAS BROUGHT IN (2026-10-19, an experiment; the
  // coordinator's call on the review of #526, and the 10-19 overdue checks'
  // "hold back the earlier one"): an earlier one a head stands in for is held
  // back whether or not the head then shows — the newer state is what counts,
  // and a head that failed (habituated, say) means this footnote was not
  // useful.
  const stoodFor = new Set(input.candidates.flatMap((c) => (c.standsFor !== undefined ? [c.standsFor] : [])));
  const kept: { c: Candidate; loud: boolean }[] = [];
  // A head this session WROTE (the echo set, part C) is in its context too:
  // the earlier version stays inhibited rather than shown in its place.
  for (const a of admitted) {
    if (a.c.head !== undefined && (stoodFor.has(a.c.id) || admittedIds.has(a.c.head) || input.state.surfaced[a.c.head] !== undefined || echo(a.c.head))) {
      record(a.c, "inhibited");
      continue;
    }
    // The two members of a COMPETING unsettled pair (E3) are never each
    // other's copy: the night has not said whether they are one thing or
    // two, so both show, the newer first and the older labelled. Otherwise
    // a wrong pair that reads alike word for word (two people, one name
    // apart) would hide the older, the memory the turn asked about, behind
    // the weight — a filter. Only while competing, so off is as before.
    const paired = (x: string, y: string): boolean => competedIds.get(x)?.with === y || competedIds.get(y)?.with === x;
    const dup = kept.some((k) => similarity(k.c, a.c) >= t.NEAR_DUPLICATE && !paired(k.c.id, a.c.id));
    if (dup) {
      record(a.c, "inhibited");
      continue;
    }
    kept.push(a);
  }

  // ── tiers: disjoint by construction, and capped ─────────────────────────
  const loudPool = kept.filter((k) => k.loud);
  loudPool.sort(
    (a, b) =>
      b.c.activation + t.SAL_SORT_WEIGHT * b.c.sal - (a.c.activation + t.SAL_SORT_WEIGHT * a.c.sal) ||
      (a.c.id < b.c.id ? -1 : 1),
  );
  const surfaced = loudPool.slice(0, t.MAX_SURFACED).map((k) => k.c);
  const surfacedIds = new Set(surfaced.map((c) => c.id));

  const footnotePool = kept.filter((k) => !surfacedIds.has(k.c.id));
  const cuedFootnotes = footnotePool.slice(0, t.MAX_FOOTNOTES).map((k) => k.c);

  // ── quiet pointers: their own slots, after what the words found ─────────
  // THE ANCHOR (2026-09-28, after the bench — working default). Pattern
  // completion completes something that came to mind: a pointer is shown only
  // when the activation that reached it FROM MEMORIES THIS TURN SHOWS (loud or
  // quiet) is at least `LINK_POINTER_MIN_FRACTION` of the strongest shown
  // memory's activation. A pointer carried there by candidates the gate turned
  // away would sit in the render with nothing visible to complete — on the
  // bench it was most of them — and it is `dark-uncued`, which is what it is
  // once its anchors went dark. Anchored pointers go strongest-anchored first.
  // Lateral inhibition applies to them as to anything admitted: a pointer that
  // is a near-duplicate of something already shown tells the reader nothing.
  // `LINK_POINTERS_MAX` slots of their own, so a pointer never displaces a
  // memory the conversation reached; the rest are `capped`, recorded.
  const shownCued = [...surfaced, ...cuedFootnotes];
  const shownIds = new Set(shownCued.map((c) => c.id));
  const anchorBar = shownCued.reduce((m, c) => Math.max(m, c.activation), 0) * t.LINK_POINTER_MIN_FRACTION;
  const anchored = (p: Candidate): number =>
    Object.entries(p.linkedFrom ?? {}).reduce((sum, [id, a]) => (shownIds.has(id) ? sum + a : sum), 0);
  const ranked = pointerPool
    .map((p) => ({ p, a: anchored(p) }))
    .sort((x, y) => y.a - x.a || (x.p.id < y.p.id ? -1 : 1));
  const pointers: Candidate[] = [];
  for (const { p, a } of ranked) {
    if (!(a > 0) || a < anchorBar) {
      record(p, "dark-uncued");
      continue;
    }
    // A pointer whose head is shown, or already in the session, is its earlier version (2026-10-11).
    if (p.head !== undefined && (stoodFor.has(p.id) || shownIds.has(p.head) || pointers.some((q) => q.id === p.head) || input.state.surfaced[p.head] !== undefined || echo(p.head))) {
      record(p, "inhibited");
      continue;
    }
    if (kept.some((k) => similarity(k.c, p) >= t.NEAR_DUPLICATE) || pointers.some((q) => similarity(q, p) >= t.NEAR_DUPLICATE)) {
      record(p, "inhibited");
      continue;
    }
    if (pointers.length >= t.LINK_POINTERS_MAX) {
      record(p, "capped");
      continue;
    }
    pointers.push(p);
  }
  const footnotes = [...cuedFootnotes, ...pointers];
  const footnoteIds = new Set(cuedFootnotes.map((c) => c.id));

  for (const c of surfaced) record(c, "surfaced");
  for (const c of footnotes) record(c, "footnoted");
  for (const k of kept) {
    if (!surfacedIds.has(k.c.id) && !footnoteIds.has(k.c.id)) record(k.c, "capped");
  }

  // ── the affect flag: turn-gated, then refractory-gated ──────────────────
  let affectFlag = false;
  let affectReason: GateResult["affectReason"] = "nothing-charged";
  if (!input.affectStated) {
    affectReason = "no-feeling-in-turn";
  } else if (!charged) {
    affectReason = "nothing-charged";
  } else if (
    input.state.affectFiredTurn !== null &&
    input.turn - input.state.affectFiredTurn < t.AFFECT_REFRACTORY_TURNS
  ) {
    affectReason = "refractory";
  } else {
    affectFlag = true;
    affectReason = "fired";
  }

  return { background: bg, verdicts, surfaced, footnotes, affectFlag, affectReason, crossLifted: [...crossLifted], competed: [...competedIds.keys()] };
}
