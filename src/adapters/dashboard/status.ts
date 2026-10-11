/**
 * `status` — the brain at a glance, in the brain's own voice.
 *
 * This is the view the totality guarantee is really about (CONTRACT §3/§5 [M]).
 * Three registries are enumerated here and every member of each gets a line:
 * every KIND physics knows, every BAND, every PHASE of the cycle. A member with
 * nothing to report prints an absence marker rather than vanishing, because a
 * vanished row reads as "quiet" and quiet is how v1's starved curation path hid
 * for months (scar §2.17).
 *
 * Narration is first person and plain (CONTRACT §3, "narration in the system's
 * own voice") — the owner's fastest read is a sentence, not a legend.
 *
 * One honesty constraint shapes the cycle block. There is no durable per-cycle
 * outcome record: `CycleReport` is returned to its caller and then gone, and the
 * promotion / prune / merge records live under meta keys nothing can enumerate
 * (`INTERFACE-GAPS.md` §2). What IS durable is each phase's completion marker and
 * each row's archived-with-reason state. So the phase table carries the per-cycle
 * truth — *which lived day did this last finish* — and the exit counts are
 * labelled SINCE BIRTH. A number invented to look like "last cycle" would be scar
 * §2.17 committed by the very view that exists to prevent it.
 */
import { band, strength, symmetryCheck } from "../../core/physics/index.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../../core/schemas/index.js";
import {
  MARKER_UNSET,
  MERGE_ARCHIVE_REASON,
  PRUNE_ARCHIVE_REASON,
  isJournal,
  readMarker,
} from "../../core/sleep/index.js";
import type { Band, Kind } from "../../core/types.js";
import { PLAIN } from "./ansi.js";
import type { Style } from "./ansi.js";
import {
  NEVER,
  NONE,
  heading,
  indent,
  meter,
  num,
  plural,
  stack,
  subheading,
  table,
} from "./layout.js";
import { BANDS, CYCLE_PHASES, KINDS, countBy } from "./registries.js";
import { contestedBeliefs } from "./stories.js";
import type { DashboardSource } from "./source.js";

export interface StatusOptions {
  readonly style?: Style;
}

interface Tally {
  readonly byKind: Map<Kind, number>;
  readonly byBand: Map<Band, number>;
  readonly meanStrength: Map<Kind, number>;
  readonly exits: Map<string, number>;
  promoted: number;
  guarded: number;
  /** Rows carrying pressure right now. */
  contested: number;
  /** Beliefs that have EVER taken a credited challenge — a different question. */
  everContested: number;
  /** Memories AND schemas together — the population the kind and band tables
   *  are over. Kept because those tables walk both, and split below because a
   *  belief is not a memory and the wake preface counts only memories. */
  live: number;
  /** `type: "memory"` rows. THE number the wake preface states
   *  (`self/briefing.ts#prefaceLine`), so the number this view must lead with:
   *  one demo store reported 143 here and 121 there on 2026-09-05, and both
   *  were right about different populations. */
  memories: number;
  /** `type: "schema"` rows — the entities and beliefs. */
  schemas: number;
  archived: number;
  /** Journal entries — episodes. NOT counted in `live`: an episode is the
   *  SOURCE a memory was made from, not a memory, and it is outside every
   *  sleep phase (`sleep/types.ts#isJournal`). Counted here so excluding it
   *  from the census is visible rather than silent (constitution 16). */
  journal: number;
}

function tally(src: DashboardSource, day: number): Tally {
  const store = src.store;
  const out: Tally = {
    byKind: new Map(),
    byBand: new Map(),
    meanStrength: new Map(),
    exits: new Map(),
    promoted: 0,
    guarded: 0,
    contested: 0,
    everContested: contestedBeliefs(src).length,
    live: 0,
    memories: 0,
    schemas: 0,
    archived: 0,
    journal: 0,
  };
  const strengths = new Map<Kind, number[]>();

  for (const id of store.list()) {
    const row = store.row(id);
    if (row === undefined) continue;
    if (row.archived === 1) {
      out.archived += 1;
      const reason = row.archived_reason ?? "no reason recorded";
      out.exits.set(reason, (out.exits.get(reason) ?? 0) + 1);
      continue;
    }
    if (isJournal(row)) {
      out.journal += 1;
      continue;
    }
    out.live += 1;
    if (row.type === "schema") out.schemas += 1;
    else out.memories += 1;
    out.byKind.set(row.kind, (out.byKind.get(row.kind) ?? 0) + 1);
    if (row.promoted_identity === 1) out.promoted += 1;
    if (row.protected === 1) out.guarded += 1;
    if (row.pressure > 0) out.contested += 1;
    // The stored band column is a birth fossil — episodic at mint, identity at
    // promotion, never "semantic" (replay review F6). The census a glance
    // trusts must be the LIVE band: arithmetic over the row's physics.
    let liveBand = row.band;
    try {
      const physics = store.physicsOf(id);
      liveBand = band(physics, day);
      const list = strengths.get(row.kind) ?? [];
      list.push(strength(physics, day));
      strengths.set(row.kind, list);
    } catch {
      // A row whose physics will not read is not worth failing a glance over;
      // its recorded band is the honest fallback.
    }
    out.byBand.set(liveBand, (out.byBand.get(liveBand) ?? 0) + 1);
  }
  for (const [kind, list] of strengths) {
    out.meanStrength.set(kind, list.reduce((a, b) => a + b, 0) / Math.max(1, list.length));
  }
  return out;
}

export function renderStatus(src: DashboardSource, opts: StatusOptions = {}): string {
  const style = opts.style ?? PLAIN;
  const day = src.store.livedDay();
  const t = tally(src, day);
  const lastActive = src.store.getMeta("lastActiveDate") ?? "";

  const opening =
    `I have lived ${plural(day, "day")}` +
    (lastActive === "" ? "" : ` — the last of them ${lastActive}`) +
    ". " +
    (t.live + t.archived + t.journal === 0
      ? "I am holding nothing yet."
      : `I am holding ${plural(t.memories, "memory", "memories")}` +
        // The schemas are named rather than folded in. They ARE live rows, and
        // the kind and band tables below count them — but a belief about Ada is
        // not a memory of a day, and the briefing the model wakes on says only
        // the memories. A view that added them and said "memories" is a view
        // that disagrees with the wake for a reader who checks.
        (t.schemas === 0
          ? ""
          : `, plus ${plural(t.schemas, "belief or entity", "beliefs and entities")}`) +
        (t.archived === 0 ? "" : `, and ${t.archived} more sit archived`) +
        // Said out loud because it is EXCLUDED from the count before it: the
        // journal is the source, and it is not subject to forgetting.
        (t.journal === 0
          ? "."
          : `, beside ${plural(t.journal, "journal entry", "journal entries")} that do not decay.`));

  return stack(
    heading("What I am, right now", style),
    opening,
    kindBlock(t, style),
    bandBlock(t, style),
    cycleBlock(src, day, style),
    symmetryBlock(src, style),
    keepBlock(t, style),
    briefingBlock(src, style),
  );
}

// ── by kind ──────────────────────────────────────────────────────────────────

function kindBlock(t: Tally, style: Style): string {
  const peak = Math.max(1, ...KINDS.map((k) => t.byKind.get(k) ?? 0));
  const rows = countBy(KINDS, t.byKind).map((axis) => {
    if (axis.absent) return [axis.axis, "0", style.warn(NONE), ""];
    const mean = t.meanStrength.get(axis.axis as Kind) ?? 0;
    return [axis.axis, String(axis.count), meter(axis.count / peak), `mean strength ${num(mean)}`];
  });
  return `${subheading("By kind — every kind I know how to hold", style)}\n${indent(
    table(rows, { right: [1] }),
  )}`;
}

// ── by band ──────────────────────────────────────────────────────────────────

const BAND_GLOSS: Record<Band, string> = {
  episodic: "still an episode; forgettable",
  semantic: "settled into what I know",
  identity: "constitutive, and physics can still move it",
};

function bandBlock(t: Tally, style: Style): string {
  const peak = Math.max(1, ...BANDS.map((b) => t.byBand.get(b) ?? 0));
  const rows = countBy(BANDS, t.byBand).map((axis) =>
    axis.absent
      ? [axis.axis, "0", style.warn(NONE), ""]
      : [axis.axis, String(axis.count), meter(axis.count / peak), BAND_GLOSS[axis.axis as Band]],
  );
  return `${subheading("By band — how settled each memory is", style)}\n${indent(
    table(rows, { right: [1] }),
  )}`;
}

// ── the cycle ────────────────────────────────────────────────────────────────

function cycleBlock(src: DashboardSource, day: number, style: Style): string {
  const rows = CYCLE_PHASES.map((phase) => {
    const marker = readMarker(src.store, phase);
    if (marker.health === "torn") {
      return [phase, style.warn("torn marker"), style.warn(`unreadable value ${marker.raw ?? ""}`)];
    }
    if (marker.day === MARKER_UNSET) return [phase, style.warn(NEVER), ""];
    const age = day - marker.day;
    return [phase, `last finished day ${marker.day}`, age <= 0 ? "today" : `${plural(age, "day")} ago`];
  });
  return `${subheading("My last cycle — what finished, and when", style)}\n${indent(table(rows))}`;
}

// ── the ratchet tripwire, read by REASON ────────────────────────────────────
/**
 * G12 surfaced: up-moves vs down-moves per kind from the durable
 * `band.transition` counter, judged by `physics.symmetryCheck`. The verdict is
 * arithmetic over the log — never persisted, so it cannot go stale — and it is
 * rendered by REASON, never by `ok`: "never-asked" carries ok:true, and a
 * starved counter reading as healthy is exactly the lie scar §2.4 forbids.
 */
function symmetryBlock(src: DashboardSource, style: Style): string {
  const rows = KINDS.map((kind) => {
    let up = 0;
    let down = 0;
    let unexplained = 0;
    for (const row of src.store.eventLog({ name: "band.transition", limit: 100_000 })) {
      if (row.payload === null) continue;
      try {
        const p = JSON.parse(row.payload) as { kind?: string; direction?: string; cause?: string };
        if (p.kind !== kind) continue;
        // A new curve's own moves (`recurve`, review of #372) are not counted.
        if (p.cause === "recurve") continue;
        if (p.direction === "up") {
          up += 1;
          if (p.cause === "unexplained") unexplained += 1;
        } else if (p.direction === "down") down += 1;
      } catch {
        continue;
      }
    }
    // Only an UP-ratchet is an alarm (2026-10-10): fading down a band is the
    // curve working, so downs past any ratio read as within expectation.
    const verdict = symmetryCheck(kind, { up, down, unexplained });
    const counts = `${up}\u2191/${down}\u2193${unexplained > 0 ? `, ${unexplained} unexplained` : ""}`;
    const label =
      verdict.reason === "never-asked"
        ? style.warn(`never-asked (${counts})`)
        : verdict.reason === "within-expectation"
          ? `within-expectation (${counts})`
          : style.warn(`up-ratchet suspected (${counts})`);
    return [kind, label];
  });
  return `${subheading("Band symmetry \u2014 the up-ratchet tripwire, by reason", style)}\n${indent(table(rows))}`;
}

// ── what I have kept, and what I let go ──────────────────────────────────────

function keepBlock(t: Tally, style: Style): string {
  const named: [string, string][] = [
    [PRUNE_ARCHIVE_REASON, "let go at the floor"],
    [MERGE_ARCHIVE_REASON, "merged into a duplicate"],
    [SCHEMA_TUNABLES.FADE_REASON, "faded out of my vocabulary"],
  ];
  const rows: string[][] = named.map(([reason, gloss]) => {
    const n = t.exits.get(reason) ?? 0;
    return [reason, n === 0 ? style.warn(NONE) : String(n), gloss];
  });
  for (const [reason, n] of t.exits) {
    if (named.some(([r]) => r === reason)) continue;
    // Every other reason a row carries — supersession's `revised-by-pressure`
    // among them. Listed rather than folded away: an exit I cannot gloss is
    // still an exit, and hiding it would be the silence this block prevents.
    rows.push([reason, String(n), "recorded by whatever archived it"]);
  }

  const sentence =
    `${t.promoted === 0 ? "Nothing" : plural(t.promoted, "memory", "memories")} ` +
    `${t.promoted === 1 || t.promoted === 0 ? "has" : "have"} crossed into identity; ` +
    `${t.guarded === 0 ? "nothing is" : `${plural(t.guarded, "memory", "memories")} ${t.guarded === 1 ? "is" : "are"}`} protected; ` +
    `${t.contested === 0 ? "no belief is" : `${plural(t.contested, "belief")} ${t.contested === 1 ? "is" : "are"}`} under challenge right now.`;

  // Standing pressure and having-been-argued-with are different questions, and a
  // revision resets the first — so a store can read "nothing under challenge"
  // while `stories` has a story to tell. Reconciled here rather than left as an
  // apparent contradiction between two views.
  const ever = t.everContested;
  const history =
    ever === 0
      ? "No belief has ever taken a credited challenge."
      : `${plural(ever, "belief")} ${ever === 1 ? "has" : "have"} been argued with at some point — \`stories\` tells each one.`;

  const body = [
    sentence,
    history,
    "",
    "Ways out, counted since birth — never a per-cycle number I do not durably hold:",
    indent(table(rows, { right: [1] })),
  ].join("\n");
  return `${subheading("What I have kept, and what I let go", style)}\n${indent(body)}`;
}

// ── the briefing ─────────────────────────────────────────────────────────────

function briefingBlock(src: DashboardSource, style: Style): string {
  // `self.wake()` is a pure read (self/ §1 G8: no model, no network, no write).
  // Only its SHAPE is printed — the briefing text itself belongs in the wake
  // bundle, not in an instrument's output.
  const wake = src.self.wake();
  const line = wake.ok
    ? `I have a briefing composed and waiting: ${plural(wake.bytes, "byte")}.`
    : style.warn(`I have no briefing waiting to give (${wake.reason}).`);
  return `${subheading("What I would say on waking", style)}\n${indent(line)}`;
}
