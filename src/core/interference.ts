/**
 * INTERFERENCE FOR ROUTINE WORK EVENTS (2026-11-07, FD1 step 3; Mike's
 * ruling mem_dc74aa500871, lightly held: "wherever something is growing,
 * consider fading more"). A newer routine work event on the same subject fades
 * the older one, the way a write's `updates` already does: "0.3.50 released"
 * fades "0.3.46 ready to publish" and "0.3.47 after-publish steps". Three
 * quarters of a working store is `about: work`, mostly status events, and
 * each one used to take its whole slow curve to leave.
 *
 * **The route: subject tokens, through the one door.** No model and no
 * vectors. The subject is what a status event names exactly — a release in a
 * version series (`0.3.46`, series `0.3`) — in the
 * same folder, read in each memory's HEADLINE (its title, or its first words:
 * `headline`), never a version named in passing further down. Each night
 * (`sleep/interfere.ts`, a phase of the cycle) an
 * older memory that names the same series at a version no higher than a newer
 * one's (the same version only as a real advance: a step before final, then
 * final), and was written on an EARLIER lived day,
 * is settled `changed` under the nearest such memory (fewest patches on, then
 * the newest written) through
 * `reconsolidation.ts#supersede`, source `interference`, reason
 * `superseded-by-newer`: its fade multiplier takes `CHANGED_FADE` (×0.5,
 * what an `updates` revision gives), it stays live, labelled earlier, and it
 * is SETTLED OVER (`self#settledOver`): out of the wake's lines and cues, a
 * handoff's "since" line and the self lists, and folded into its holder in
 * recall's facts — which is why the subject rule is strict. Every fade can be
 * undone like any settle. (`SETTLE` off is the plain-fade fallback: the cut
 * and a `memory.interfered` row, no pair, nothing hidden.) The prune is not touched:
 * a faded memory still waits `D_FLOOR_DAYS` under the floor before it leaves,
 * and is counted then as an age prune. Not the slot detector (it needs
 * vectors, reads only 7 lived days back, and waits on the dream, 4 a night)
 * nor the dream's fold (a model's call): neither scales to thousands of
 * status notes, and "#760 merged" / "#772 merged" are near-identical by
 * meaning yet two subjects, which tokens tell apart.
 *
 * **Only what nobody leaned on (the scope guard).** The older memory must be
 * a `fact` about `work`, written by a session in a folder, `done` or unmarked,
 * in the episodic band, never protected or core, not a belief, with no date
 * to be reminded on, not an open item (`unresolved` / `settlesWhen`: "Still
 * open" is the review's item 3, a later PR — this sweep never closes one),
 * not said by the owner, with no feeling (none recorded, no emotional
 * salience), unsalient (`sal` at most `SAL_MAX`), never really used (uses
 * under `W_USEFUL`: one open, quote, or rating of 2 or 3 is past it), reading
 * as a status event AT its subject (a status verb beside the version in its
 * headline, never a plan: `subjectKeys`), never faded before (`fade` 1), not
 * the faded side of a pair nor under an open question (holding a pair is no
 * reason: a chain's middle link fades in its turn), and never in an
 * interference pair the owner undid. Anything the owner said, anything felt,
 * and anything about the owner, us or me keeps the slow curve. The newer
 * memory must be live work in the same folder, `done` or unmarked, and say
 * the thing was DONE at that subject (released, published, merged, shipped,
 * deployed, tagged, installed, landed, closed), for an equal version too.
 *
 * Measured on a copy of the owner's store (lived day 47, 5,798 live authored
 * work rows), after round 3 of the review of #777: 67 fade the first night,
 * observer and applied alike, all by version, ~70 ms; `settledOver` p50 27.7
 * → 29.1 ms with them added. The guards held the rest (most: `no-subject`
 * 1,783, `not-done` 1,628, `salient` 827, `owner-said` 464, `not-an-event`
 * 140). A different series errs safe: 0.4.0 does not fade 0.3.x.
 *
 * Counted apart from the prune (the roadmap's condition): the cycle's durable
 * `sleep.cycle` row carries `interfered` beside `pruned`, each fade writes a
 * `contradiction.settled` row with `source: interference` and `reason`, and
 * the trail's `why` names the newer memory.
 */
import { TUNABLES as PHYSICS, changedFade, fadeOf, sal } from "./physics/index.js";
import { supersede } from "./reconsolidation.js";
import { SETTLES_WHEN_META_KEY } from "./types.js";
import type { Store, WorkEventRow } from "./store/index.js";

/** The pair `source` this sweep writes (no DDL: a TEXT value). */
export const INTERFERENCE_SOURCE = "interference";

/** The reason every interference fade records, on the event and the trail. */
export const INTERFERENCE_REASON = "superseded-by-newer";

/**
 * Working defaults, held lightly (2026-11-07). Read at use, never copied at
 * load. (Not in the harness's `--set` list: that reads only the package's
 * public seams, and this file is not one; `physics.CHANGED_FADE` is.) The cut
 * itself is `physics.CHANGED_FADE` (×0.5), the fade a write's `updates` gives
 * the memory it revises: one number for every `changed`.
 */
export const INTERFERENCE_TUNABLES = {
  /** The switch. Off: the phase runs and counts `switched-off`. */
  ON: true as boolean,
  /**
   * How the cut lands. True: a settled `changed` pair through the one door
   * (labelled earlier, undoable — and hidden as settled over in the wake,
   * cues and lists). False: a plain fade, ×`CHANGED_FADE` with a
   * `memory.interfered` row, no pair. Chosen by the roadmap's bar for #777
   * (19 of 20 hand-checked pairs right, and no material per-turn cost).
   */
  SETTLE: true as boolean,
  /**
   * The most salience an older memory may carry and still fade: at or under
   * `DEFAULT_CLAIM_PERSONAL` (0.4). A defaulted work event is 0.20, other
   * unclaimed work 0.25; a writer who claimed more than 0.4 said it mattered. CAL.
   */
  SAL_MAX: 0.4 as number,
  /** A memory with no title is read by this many characters of its words: about a title's worth. CAL. */
  HEADLINE_CHARS: 120 as number,
};

/**
 * A STATUS EVENT, NAMED AT ITS SUBJECT (2026-11-07, the reviews of #777): a
 * version counts as the memory's subject only when a status verb stands right
 * beside it in the headline — "0.3.46 released", "ready to publish 0.3.47",
 * "installed 0.3.43" — with at most two small words between ("0.3.46 fully
 * released"). A verb elsewhere in the line ("Release branch scan … 0.3.44"),
 * a dotted event name ("memory.merged"), a noun phrase ("during the 0.3.46
 * cut") and a plan ("0.3.41 cut tomorrow", "will cut 0.3.47", "to cut
 * 0.3.47") name no event. Three verb sets: what an OLDER memory may be (any
 * step on the way: ready, queued, packed, cut, tagged, after-publish, …);
 * what a NEWER one must be to stand over it (the thing done); and, for the
 * SAME version, the FINAL states (released, published, shipped, deployed,
 * installed, landed) — an equal version is a later state only when the older
 * was a step before them and the newer is one of them; both final is a
 * duplicate, not a later state.
 *
 * No pull-request rule (round 3 of the review): on the owner's copy all three
 * same-PR fades were wrong ("merged" under "merged", and a slash list's verb
 * credited to its last number). A later rule could take a PR's not-done →
 * done advance (opened → merged) once it can be read reliably.
 */
const FILLER = String.raw`(?:is|was|has|have|been|now|fully|finally|all|just|also|then|got|being|and|officially)`;
const FINAL = String.raw`released|published|shipped|deployed|installed|landed`;
const DONE = String.raw`${FINAL}|merged|tagged`;
const STEP = String.raw`${DONE}|ready|queued|pushed|approved|reviewed|built|packed|cut|after-publish`;
/** A plan, not an event: the verb followed by when it is still to come. */
const LATER = String.raw`(?!\s+(?:tomorrow|tonight|next|later|soon|on\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day|after\s+(?:the|this)))`;
/** …or preceded by what makes it one: `will cut`, `to cut`, `plan to ship`. */
const PLANNED = String.raw`(?<!\b(?:will|to|shall|would|should|could|can|must|gonna|going\s+to|plan\s+to|about\s+to|then)\s+)`;
const NOT_PLANNED_AFTER = String.raw`(?<!\b(?:to|will|shall|would|should|could|can|must)\s+)`;
/** After the version: `0.3.46 released`, `0.3.47-dev is tagged`. */
const after = (verbs: string): RegExp =>
  new RegExp(String.raw`^(?:-[\w]+)?\s*[:,]?(?:\s+${FILLER}){0,2}\s+${NOT_PLANNED_AFTER}(?:${verbs})(?![\w.@/-])${LATER}`, "i");
/** Before the version: `released 0.3.50`, `ready to publish 0.3.47`, `installed counterparts@0.3.14`. */
const before = (verbs: string, ready: boolean): RegExp =>
  new RegExp(
    String.raw`(?<![\w.@/-])${PLANNED}(?:${verbs}${ready ? "|ready to (?:publish|release|merge|ship|cut)" : ""})(?:\s+(?:counterparts|version|v))?\s*@?\s*$`,
    "i",
  );
/** What follows a token read verb-first: not a when-still-to-come. */
/** `ready to publish 0.3.47 tonight` is a state now (ready), whatever follows: the later check does not apply. */
const READY_HEAD = /ready to (?:publish|release|merge|ship|cut)(?:\s+(?:counterparts|version|v))?\s*@?\s*$/i;
const LATER_AFTER_TOKEN = new RegExp(String.raw`^(?:-[\w]+)?${LATER}`, "i");
const AFTER = { step: after(STEP), done: after(DONE), final: after(FINAL) } as const;
const BEFORE = { step: before(STEP, true), done: before(DONE, false), final: before(FINAL, false) } as const;
/** A noun phrase in front of the token: `the 0.3.46 cut`, `during 0.3.46`. Never an event read forward. */
const DETERMINER = /(?:^|[^\w])(?:the|a|an|this|that|its|during|of|in|for|on|from|since|until|before|with)\s+(?:counterparts@)?$/i;

/** A version, `major.minor.patch`, not part of a longer dotted run (an address, a date). */
const VERSION = /(?<![\w.])v?(\d{1,3})\.(\d{1,3})\.(\d{1,4})(?![\w]|\.\d)/g;

/** What a memory names exactly: each version series' highest patch, and whether that patch's event is FINAL. */
export interface SubjectKeys {
  readonly versions: ReadonlyMap<string, number>;
  /** For each series in `versions`: true when a final verb (released, published, …) stands beside its highest patch. */
  readonly final: ReadonlyMap<string, boolean>;
}

/**
 * The subject tokens in a headline. `as`: `any` reads every version (the raw
 * read); `step` only those a status verb of any step stands beside (what an
 * older memory is about); `done` only those the thing-done verbs stand beside
 * (what a newer memory must say). Pure.
 */
export function subjectKeys(text: string, as: "any" | "step" | "done" = "step"): SubjectKeys {
  const reads = (set: "step" | "done" | "final", start: number, end: number): boolean => {
    const head = text.slice(0, start);
    // A verb-first plan ("cut 0.3.47 tomorrow", "released 0.3.47 next week") is no event either.
    if (BEFORE[set].test(head)) return READY_HEAD.test(head) || LATER_AFTER_TOKEN.test(text.slice(end));
    return AFTER[set].test(text.slice(end)) && !DETERMINER.test(head);
  };
  const versions = new Map<string, number>();
  const final = new Map<string, boolean>();
  for (const m of text.matchAll(VERSION)) {
    const start = m.index;
    const end = start + m[0].length;
    if (as !== "any" && !reads(as, start, end)) continue;
    const series = `${Number(m[1])}.${Number(m[2])}`;
    const patch = Number(m[3]);
    const isFinal = as !== "any" && reads("final", start, end);
    const had = versions.get(series);
    if (had === undefined || patch > had) {
      versions.set(series, patch);
      final.set(series, isFinal);
    } else if (patch === had && isFinal) final.set(series, true);
  }
  return { versions, final };
}

/** A pull-request number, `#760`, not part of a word, a colour or a longer number. */
const PR = /(?<![\w&#])#(\d{1,6})(?!\d)/g;
/** After the number: `#760 merged`, `PR #760 is merged`. */
const PR_AFTER = new RegExp(
  String.raw`^(?:'s)?\s*[:,]?(?:\s+${FILLER}){0,2}\s+${NOT_PLANNED_AFTER}(?:${DONE}|closed)(?![\w.@/-])${LATER}`,
  "i",
);
/** Before it: `merged #760`, `merged PR #760`. */
const PR_BEFORE = new RegExp(String.raw`(?<![\w.@/-])${PLANNED}(?:${DONE}|closed)(?:\s+(?:pr|pull request))?\s*$`, "i");

/**
 * THE PULL REQUESTS A HEADLINE NAMES (2026-11-07, SO1 step 1b, for a write's
 * close hint only): `done` — those a thing-done verb stands right beside
 * (`#760 merged`, `merged PR #760`, read as the versions are: no plan, no
 * noun phrase); `any` — every `#N` named. The sweep above takes no PR rule
 * (round 3 of #777's review): a fade there is the store's call and was wrong
 * on all three same-PR pairs. A hint is only a list the writing model judges,
 * so the loose read is fine there. Pure.
 */
export function prKeys(text: string, as: "any" | "done" = "done"): ReadonlySet<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(PR)) {
    const start = m.index;
    const end = start + m[0].length;
    if (as === "done") {
      const head = text.slice(0, start);
      const ok = PR_BEFORE.test(head) || (PR_AFTER.test(text.slice(end)) && !DETERMINER.test(head));
      if (!ok) continue;
    }
    out.add(Number(m[1]));
  }
  return out;
}

/**
 * Which version makes `newer` the later state of `older`'s subject, or null,
 * and how far on it is (`gap`: patches ahead), so the sweep can name the
 * NEAREST later state. The same version (gap 0) only as a real advance: the
 * older a step before final, the newer final. Pure.
 */
export function sameSubject(older: SubjectKeys, newer: SubjectKeys): { rule: "version"; key: string; gap: number } | null {
  let best: { rule: "version"; key: string; gap: number } | null = null;
  for (const [series, patch] of older.versions) {
    const theirs = newer.versions.get(series);
    if (theirs === undefined || theirs < patch) continue;
    if (theirs === patch && (older.final.get(series) === true || newer.final.get(series) !== true)) continue;
    if (best === null || theirs - patch < best.gap) best = { rule: "version", key: `${series}.${patch}→${series}.${theirs}`, gap: theirs - patch };
  }
  return best;
}

/** Why an older memory keeps its slow curve, one word each (the phase's `skipped`). */
export type InterferenceSkip =
  | "not-a-fact"
  | "not-done"
  | "open-item"
  | "dated"
  | "held"
  | "belief"
  | "owner-said"
  | "felt"
  | "salient"
  | "used"
  | "not-an-event"
  | "no-subject"
  | "no-newer"
  | "already-paired"
  | "already-faded"
  | "refused";

export interface InterferenceFade {
  readonly over: string;
  readonly holds: string;
  readonly rule: "version";
  readonly key: string;
}

export interface InterferenceInput {
  readonly day: number;
  /** False under observer: write nothing, count what a night would fade. */
  readonly apply: boolean;
  /** Fades a night at most; the rest wait, counted (a budget is not a debt). */
  readonly budget: number;
}

export interface InterferenceOutcome {
  /** False when the sweep is switched off. */
  readonly on: boolean;
  /** Older work memories judged. */
  readonly examined: number;
  /** Faded tonight (or, under observer, would be). */
  readonly faded: readonly InterferenceFade[];
  readonly skipped: Readonly<Record<string, number>>;
  /** Would have faded, past tonight's budget. */
  readonly skippedForLimit: number;
}

/**
 * WHAT A MEMORY IS ABOUT, IN ITS OWN HEADLINE (2026-11-07): its title, or the
 * first `HEADLINE_CHARS` of its words when it has none. A status event names
 * its release there ("0.3.25 released 10-16");
 * a version named in passing further down a note (a finding that mentions the
 * build it was seen on) is not its subject. Read on a copy of the owner's
 * store (day 47): reading the whole body, 0.3.50 named in one note's last
 * line was the "newer state" of eleven unrelated coordination notes.
 */
export function headline(r: { readonly title: string | null; readonly body: string }): string {
  const t = r.title?.trim() ?? "";
  if (t.length > 0) return t;
  const max = INTERFERENCE_TUNABLES.HEADLINE_CHARS;
  if (r.body.length <= max) return r.body;
  // Cut at a space, never inside a word: `…0.3.4|6` must not read as 0.3.4, nor `#74|1` as #74.
  const cut = r.body.slice(0, max + 1);
  const at = cut.search(/\s\S*$/);
  return at > 0 ? cut.slice(0, at) : "";
}

/** The guard on the OLDER memory that needs no second read, or null when it may fade. */
function rowGuard(r: WorkEventRow): InterferenceSkip | null {
  if (r.kind !== "fact") return "not-a-fact";
  if (r.status !== null && r.status !== "done") return "not-done";
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(r.meta) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  if (meta["unresolved"] === true || (typeof meta[SETTLES_WHEN_META_KEY] === "string" && meta[SETTLES_WHEN_META_KEY] !== "")) return "open-item";
  if (r.eventDate !== null) return "dated";
  if (r.protected || r.promoted || r.band !== "episodic") return "held";
  if (r.belief) return "belief";
  if (r.saidBy === "owner") return "owner-said";
  if (r.emotional > 0) return "felt";
  if (sal({ novelty: r.novelty, relevance: r.relevance, emotional: r.emotional, predictive: r.predictive, claimed: r.claimed }) > INTERFERENCE_TUNABLES.SAL_MAX) return "salient";
  if (r.uses >= PHYSICS.W_USEFUL) return "used";
  // One cut, ever: a memory something already faded (a settle, an earlier night) keeps what it has.
  if (r.fade < 1) return "already-faded";
  return null;
}

/** The durable row a plain fade writes, one per fade: the older, the newer, the reason (`plainFade`). */
export const INTERFERENCE_EVENT = "memory.interfered";

/**
 * A PLAIN FADE (the fallback the roadmap set for #777): the older memory's
 * fade multiplier ×`CHANGED_FADE`, and one `memory.interfered` row naming the
 * newer memory and the reason — no pair, no settle, so nothing reads it as
 * settled over: it keeps its place in the wake, cues and lists and only its
 * reach drops. False when there is nothing to cut or the write fails.
 */
function plainFade(store: Store, f: InterferenceFade, day: number): boolean {
  try {
    const physics = store.physicsOf(f.over);
    const cut = changedFade(physics, day);
    if (cut === null) return false;
    store.updatePhysics(f.over, { fade: cut.fade });
    store.appendEvent({
      name: INTERFERENCE_EVENT,
      day,
      ref: f.over,
      payload: {
        over: f.over,
        holds: f.holds,
        reason: INTERFERENCE_REASON,
        rule: f.rule,
        key: f.key,
        factor: cut.factor,
        fadeBefore: fadeOf(physics),
        fadeAfter: cut.fade,
        strengthBefore: Math.round(cut.before * 1e4) / 1e4,
        strengthAfter: Math.round(cut.after * 1e4) / 1e4,
        day,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * THE NIGHT'S INTERFERENCE SWEEP: every older routine work memory a newer one
 * in the same folder reads as the later state of, faded through the one door
 * (`supersede`, `changed`, source `interference`, reason
 * `superseded-by-newer`), oldest first, `budget` a night. Under observer it
 * counts and writes nothing. A fade the door refuses is counted `refused`
 * and the sweep goes on.
 */
export function interferenceSweep(store: Store, input: InterferenceInput): InterferenceOutcome {
  const skipped: Record<string, number> = {};
  const skip = (why: InterferenceSkip): void => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  if (!INTERFERENCE_TUNABLES.ON) return { on: false, examined: 0, faded: [], skipped, skippedForLimit: 0 };
  const rows = store.workEventRows();
  // The newer side, by folder and subject: what each memory says was DONE to
  // a version, beside it in its headline.
  const keysOf = new Map<string, SubjectKeys>();
  const doneOf = new Map<string, SubjectKeys>();
  const index = new Map<string, WorkEventRow[]>();
  const slot = (scope: string, k: string): string => `${scope}\u0000${k}`;
  for (const r of rows) {
    const h = headline(r);
    keysOf.set(r.id, subjectKeys(h, "step"));
    if (r.status !== null && r.status !== "done") continue;
    const done = subjectKeys(h, "done");
    doneOf.set(r.id, done);
    const at = [...done.versions.keys()].map((s) => `v:${s}`);
    for (const k of at) {
      const list = index.get(slot(r.scope, k)) ?? [];
      list.push(r);
      index.set(slot(r.scope, k), list);
    }
  }
  // Every memory an interference pair ever named as the older, a withdrawn
  // one included: the owner's undo stands, and one cut is all a memory gets.
  const once = new Set<string>(store.contradictionOlders(INTERFERENCE_SOURCE));

  const faded: InterferenceFade[] = [];
  let examined = 0;
  let skippedForLimit = 0;
  for (const r of rows) {
    const guard = rowGuard(r);
    if (guard !== null) {
      skip(guard);
      continue;
    }
    const keys = keysOf.get(r.id) as SubjectKeys;
    if (keys.versions.size === 0) {
      const raw = subjectKeys(headline(r), "any");
      skip(raw.versions.size === 0 ? "no-subject" : "not-an-event");
      continue;
    }
    examined += 1;
    // The NEAREST later state, written on a later lived day: the fewest patches
    // on (the same version first, as a real advance), then the newest written.
    let best: { row: WorkEventRow; rule: "version"; key: string; gap: number } | null = null;
    const seen = new Set<string>();
    for (const k of [...keys.versions.keys()].map((s) => `v:${s}`)) {
      for (const n of index.get(slot(r.scope, k)) ?? []) {
        if (seen.has(n.id) || n.id === r.id || n.birthDay <= r.birthDay) continue;
        seen.add(n.id);
        const same = sameSubject(keys, doneOf.get(n.id) as SubjectKeys);
        if (same === null) continue;
        const nearer =
          best === null ||
          same.gap < best.gap ||
          (same.gap === best.gap && (n.createdAt > best.row.createdAt || (n.createdAt === best.row.createdAt && n.id > best.row.id)));
        if (nearer) best = { row: n, ...same };
      }
    }
    if (best === null) {
      skip("no-newer");
      continue;
    }
    // Second reads only for a match: a feeling recorded on it, a pair it is
    // already the faded side of, or a question still open about it. HOLDING a
    // settled pair is no reason (review of #777: a chain's middle link holds
    // the one before it, and must still fade under the one after).
    const standing = store.contradictionsOf([r.id]).get(r.id) ?? [];
    if (once.has(r.id) || standing.some((p) => p.over === r.id || p.state === "unsettled")) {
      skip("already-paired");
      continue;
    }
    const peak = store.row(r.id)?.feeling_peak ?? null;
    if (typeof peak === "number" && peak > 0) {
      skip("felt");
      continue;
    }
    if (faded.length >= input.budget) {
      skippedForLimit += 1;
      continue;
    }
    const fade: InterferenceFade = { over: r.id, holds: best.row.id, rule: best.rule, key: best.key };
    if (!input.apply) {
      faded.push(fade);
      continue;
    }
    if (INTERFERENCE_TUNABLES.SETTLE) {
      const out = supersede(store, {
        holds: best.row.id,
        over: r.id,
        how: "changed",
        source: INTERFERENCE_SOURCE,
        actor: "detector",
        why: `${INTERFERENCE_REASON}: ${best.row.id} (${best.key})`,
        reason: INTERFERENCE_REASON,
        day: input.day,
        closeFlags: false,
      });
      if (!out.ok) {
        skip("refused");
        continue;
      }
    } else if (!plainFade(store, fade, input.day)) {
      skip("refused");
      continue;
    }
    once.add(r.id);
    faded.push(fade);
  }
  return { on: true, examined, faded, skipped, skippedForLimit };
}
