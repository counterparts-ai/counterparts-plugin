/**
 * `/api/memory` — one memory, opened.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { TUNABLES, band, emotionalIntensity, promotionEligibility, rep, sal, strength } from "../../../../core/physics/index.js";
import type { PromotionVerdict } from "../../../../core/physics/index.js";
import { DREAM_MERGE_REASON } from "../../../../core/dream/index.js";
import { feelingsLine } from "../../../feelings-line.js";
import { coreContextFor, isJournal } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import type { DashboardSource } from "../../source.js";
import { WITHHELD, gistOfDoc, reveal, revealHere } from "../reveal.js";
import { archiveWords } from "./archive-words.js";
import { fadeCurve } from "./mechanism-panel.js";
import { chapterDate, feelingsShown, isChapterMemory, liftDate, repeatsOf, stripChapterLead } from "./memory-words.js";
import { readChapterLead } from "../../../../core/self/index.js";
import type { FeelingShown } from "./memory-words.js";
import { LOG_CEILING } from "./shared.js";
import { isDay, localClockZone, localDate } from "../../../../core/time.js";

/** One step in a memory's lineage, as the card's timeline draws it. */
export interface TimelineStep {
  /**
   * `replaced` — an older memory this one took the place of (its `superseded_by` is this id);
   * `corrects` — a memory this one argues with (`meta.updates`): a LINK, the other is untouched;
   * `revised` — this memory's own words, rewritten in place (a `versions` row with no successor);
   * `became` — the newer memory that replaced this one.
   */
  readonly rel: "replaced" | "corrects" | "revised" | "became";
  /** The other memory, when there is one (click to open it). */
  readonly id: string | null;
  readonly text: string;
  readonly confidential: boolean;
  /** The lived day it happened, when the store knows it. */
  readonly day: number | null;
  /** For `revised`: the version's number. */
  readonly seq: number | null;
  readonly reason: string | null;
  /**
   * The step was a dream folding near-copies together (`dream#DREAM_MERGE_REASON`):
   * on a `replaced` step, a near-copy merged into this one; on `became`, this
   * one merged into its near-copy. Cleanup, and the card says so (2026-09-27).
   */
  readonly dream: boolean;
}

/** The card's road to the core — see `MemoryDetail.promotion`. */
export interface CoreRoad {
  readonly byUse: boolean;
  readonly days: number;
  readonly required: number;
  readonly span: number;
  readonly needSpan: number;
  /** The slow lane's strength floor, not yet reached (its days may already be). */
  readonly holdShort: boolean;
  readonly oneReturn: boolean;
  readonly needGap: number;
  readonly lane: "fast" | "slow" | null;
  readonly eligible: boolean;
  readonly blocked: "not-about-me" | "demoted-by-owner" | null;
}

/**
 * The card's road to the core, from the engine's verdict alone. "One return
 * away" is the fast lane's feeling already there, its return not yet, and
 * nothing but "no lane yet" in the way; `byUse` is that same "nothing else in
 * the way" for the slow lane.
 */
export function coreRoad(verdict: PromotionVerdict): CoreRoad {
  const onlyNoLane = verdict.blockedBy.length === 1 && verdict.blockedBy[0] === "no-lane-yet";
  const blocked = verdict.blockedBy.includes("not-about-me")
    ? "not-about-me"
    : verdict.blockedBy.includes("demoted-by-owner")
      ? "demoted-by-owner"
      : null;
  return {
    byUse: onlyNoLane,
    days: verdict.slow.days,
    required: verdict.slow.needDays,
    span: verdict.slow.span,
    needSpan: verdict.slow.needSpan,
    holdShort: verdict.slow.strength !== null && verdict.slow.strength < verdict.slow.needStrength,
    oneReturn: onlyNoLane && !verdict.fast.met && verdict.fast.intensity >= verdict.fast.needIntensity,
    needGap: verdict.fast.needGap,
    lane: verdict.lane,
    eligible: verdict.eligible,
    blocked,
  };
}

/** The card's strength curve: how strong so far, and where it heads if unused. */
export interface MemoryCurve {
  readonly day: number;
  readonly from: number;
  readonly to: number;
  readonly points: readonly (readonly [number, number])[];
  /** The first lived day ahead on which it falls below the archive line if
   *  unused — the day the prune could put it away. Null for a date that still
   *  repeats: the prune keeps it for its next occurrence (2026-10-09). Null for
   *  a protected memory too: the prune never lets one go (review of #343). */
  readonly archiveDay: number | null;
  readonly archiveLine: number;
  readonly semanticFloor: number;
  /** Its date still repeats: how often, as a person says it (`every May 14`,
   *  `repeatsOf`), else null. The card says this instead of a let-go day. */
  readonly repeats: string | null;
  /** Protected (`physics.protected`): the prune refuses it however faint it
   *  grows, so the card says that instead of a let-go day (review of #343). */
  readonly protected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// one memory, opened
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryDetail {
  readonly found: boolean;
  readonly id: string;
  readonly headId: string | null;
  readonly askedFor: string | null;
  /**
   * True when this row is a JOURNAL entry rather than a memory. It matters on
   * an inspection surface: an episode is the source a memory was made from, it
   * sits outside every sleep phase, and the physics below it is recorded but
   * never acted on. Printing its strength without saying that would invite the
   * owner to read a number the engine ignores.
   */
  readonly journal: boolean;
  readonly title: string;
  readonly text: string;
  readonly confidential: boolean;
  /**
   * Which record this is — the revision it is on, and the hash of the text
   * above.
   *
   * This pair replaced the memory file's path in the modal's subtitle. The path
   * named a filesystem layout, and a store is not its layout: what identifies a
   * memory is its id, and what identifies THIS reading of it is the revision and
   * the hash. The id the copy button hands over is `id`.
   *
   * `contentHash` is blank when the body is withheld — see below.
   */
  readonly revision: number;
  readonly contentHash: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly recordedBand: string;
  readonly strength: number;
  readonly salience: { relevance: number; emotional: number; predictive: number; novelty: number | null; claimed: number | null; combined: number };
  readonly repetition: number;
  readonly uses: number;
  readonly reinforcedDays: number;
  readonly bornDay: number;
  readonly lastUsedDay: number;
  readonly learnedOn: string;
  readonly happenedOn: string | null;
  readonly consolidated: boolean;
  readonly promoted: boolean;
  readonly protected: boolean;
  readonly pressure: number;
  readonly bar: number | null;
  readonly archived: string | null;
  readonly removal: { stage: string; actor: string; reason: string | null; at: number }[];
  readonly edges: { id: string; text: string; weight: number; confidential: boolean }[];
  readonly points: { role: string; id: string; text: string }[];
  readonly versions: { seq: number; reason: string; day: number; became: string }[];
  readonly prospective: { date: string; state: string; fires: number; precision: string }[];
  /**
   * The feelings recorded on it, as one line — `you: worried 0.6 (now 0.3) ·
   * me: tender 0.4` (`adapters/feelings-line.ts`) — or "" when it has none.
   * Withheld with the body on a confidential memory: a feeling word about a
   * sensitive thing says something about the thing.
   */
  readonly feelingsLine: string;
  /** The emotional intensity physics reads (physics §5.10): 0 when unfelt. */
  readonly intensity: number;
  readonly absence: string | null;
  /** A journal-chapter memory (`isChapterMemory`): its words are a chapter, and it is not scored. */
  readonly chapter: boolean;
  /** Today's lived day, for the use strip. */
  readonly day: number;
  /** Null when there is nothing to draw — see `curveNote`. */
  readonly curve: MemoryCurve | null;
  /** Why there is no curve, in words ("in the core — it doesn't fade"), else null. */
  readonly curveNote: string | null;
  /** Lived days the log shows it being used on (`recall.credit`), ascending.
   *  The log keeps only so much, so this can be fewer than `reinforcedDays`. */
  readonly useDays: number[];
  /**
   * The road to the core (2026-09-26; both lanes on the card 2026-09-27), read
   * straight off `physics#promotionEligibility` — nothing here restates a
   * threshold, a kind or a tunable, so when the engine's rule moves the card
   * follows. `byUse`: coming back is all that stands in the way (the slow
   * lane: `days` of `required` separate return days, over `span` of
   * `needSpan`). `oneReturn`: felt strongly enough for the fast lane, so one
   * real return (`needGap` lived days or more after it was made) makes it
   * core. `lane`: the lane already met, when one is (a sleep decides).
   * `blocked`: why no lane applies at all, or null.
   */
  readonly promotion: CoreRoad;
  readonly feelings: (FeelingShown & { readonly carriedBy: string })[];
  readonly model: string | null;
  readonly eventDate: string | null;
  readonly createdAt: number | null;
  /**
   * The day it was written, `YYYY-MM-DD`, in the person's zone (`store.zone()`:
   * the configuration's `timeZone`, else the machine's) — the local date of
   * `createdAt`, else the recorded calendar day. Dated HERE, not by the
   * browser, so the card agrees with every other date the dashboard prints
   * (review of #335, 2026-10-09). Null when nothing dates it.
   */
  readonly writtenOn: string | null;
  /** The clock it was written at, in the same zone and named: `17:47 MDT`. Null without `createdAt`. */
  readonly writtenClock: string | null;
  /** Why it was archived, in plain words; null while it is live. */
  readonly archivedWords: string | null;
  /** Its lineage, oldest first: what it replaced or corrects, its own rewrites, what it became. */
  readonly timeline: TimelineStep[];
  /** The words as the card shows them: a date written at their front (or a
   *  chapter's heading) lifted off. `text` stays the stored body. */
  readonly shownText: string;
  /** The date lifted off the front (`YYYY-MM-DD`), else null. */
  readonly writtenDate: string | null;
  /**
   * What it is about (`me`, `us`, `owner`, `work`, `world`), or null when
   * nobody has marked it, and who set it (`writer`, `reflection`, `owner`,
   * `upgrade`, `self`). The card's "about" control changes it through the
   * console's `about` command (2026-10-11).
   */
  readonly about: string | null;
  readonly aboutBy: string | null;
}

export function memoryDetail(src: DashboardSource, id: string): MemoryDetail {
  const store = src.store;
  const day = store.livedDay();
  const r = reveal(store, id, 120);
  const empty = {
    found: false,
    id,
    headId: r.headId,
    askedFor: null,
    journal: false,
    title: "",
    text: "",
    confidential: false,
    revision: 0,
    contentHash: "",
    kind: "fact" as Kind,
    band: "episodic" as Band,
    recordedBand: "—",
    strength: 0,
    salience: { relevance: 0, emotional: 0, predictive: 0, novelty: null, claimed: null, combined: 0 },
    repetition: 0,
    uses: 0,
    reinforcedDays: 0,
    bornDay: 0,
    lastUsedDay: 0,
    learnedOn: "—",
    happenedOn: null,
    consolidated: false,
    promoted: false,
    protected: false,
    pressure: 0,
    bar: null,
    archived: null,
    removal: store.removalRecord(id).map((x) => ({ stage: x.stage, actor: x.actor, reason: x.reason, at: x.at })),
    edges: [],
    points: [],
    versions: [],
    prospective: [],
    feelingsLine: "",
    intensity: 0,
    absence: r.label,
    chapter: false,
    day,
    curve: null,
    curveNote: null,
    useDays: [],
    promotion: {
      byUse: false,
      days: 0,
      required: TUNABLES.CORE_SLOW_DAYS,
      span: 0,
      needSpan: TUNABLES.CORE_SLOW_SPAN_DAYS,
      holdShort: false,
      oneReturn: false,
      needGap: TUNABLES.CORE_FAST_GAP_DAYS,
      lane: null,
      eligible: false,
      blocked: null,
    },
    feelings: [],
    model: null,
    eventDate: null,
    createdAt: null,
    writtenOn: null,
    writtenClock: null,
    archivedWords: null,
    timeline: [],
    shownText: "",
    writtenDate: null,
    about: null,
    aboutBy: null,
  } satisfies MemoryDetail;

  if (!r.present || r.headId === null) return empty;
  const headId = r.headId;
  let doc;
  let row;
  let physics;
  try {
    doc = store.readProse(headId);
    row = store.row(headId);
    physics = store.physicsOf(headId);
  } catch {
    return empty;
  }
  const g = gistOfDoc(doc, 120);
  const chapter = row !== undefined && isChapterMemory(row);
  const journal = row === undefined ? false : isJournal(row);
  // The core's road, asked of the engine the way sleep asks it
  // (`sleep/consolidate.ts`): sleep's own "about me" reading of the row, and
  // the owner's last word on its core membership.
  // Exactly the context sleep's consolidate builds (`coreContextFor`, #262).
  const verdict = promotionEligibility(
    physics,
    row !== undefined ? coreContextFor(store, { ...row, id: headId }, day) : { aboutMe: false, day },
  );
  let curve: MemoryCurve | null = null;
  let curveNote: string | null = null;
  if (journal || chapter) curveNote = "a journal chapter — kept as written, not scored";
  else if (physics.promotedIdentity === true) curveNote = "in the core — it doesn't fade";
  else {
    const c = fadeCurve(physics, day);
    // A date that still repeats is kept (the prune's `recurring` gate), and so
    // is a protected memory (its `protected` gate, review of #343): neither has
    // a let-go day. A put-away row is past the question.
    const repeats = row === undefined || row.archived === 1 ? null : repeatsOf(row);
    const kept = physics.protected === true;
    curve = {
      day,
      ...c,
      archiveDay: repeats === null && !kept ? c.archiveDay : null,
      archiveLine: TUNABLES.PHI_PRUNE,
      semanticFloor: TUNABLES.THETA_SEM,
      repeats,
      protected: kept,
    };
  }

  const points: { role: string; id: string; text: string }[] = [];
  const push = (role: string, target: unknown): void => {
    if (typeof target !== "string") return;
    const rr = reveal(store, target, 80);
    points.push({ role, id: target, text: rr.text ?? rr.label });
  };
  if (row?.superseded_by !== null && row?.superseded_by !== undefined) push("became", row.superseded_by);
  push("hangs on", doc.meta["entityId"]);
  push("revised", doc.meta["updates"]);
  const grounded = doc.meta["groundedIn"];
  if (Array.isArray(grounded)) for (const gid of grounded) push("grounded in", gid);

  return {
    found: true,
    id: headId,
    headId,
    askedFor: headId === id ? null : id,
    journal,
    title: doc.title ?? "",
    // The BODY is the memory, and this is the owner's own window onto their own
    // store (constitution line 6). A confidential body is the one exception, and
    // it is withheld here exactly as it is withheld in recall.
    text: g.confidential ? WITHHELD : doc.body.trim(),
    confidential: g.confidential,
    revision: row?.revision ?? 0,
    // A hash of a withheld body is a derivative of withheld text, on the one
    // surface whose job is withholding it. It is a confirmation oracle for an
    // exactly-guessed secret rather than a way to recover one, but this is the
    // wrong place to be interesting. The modal renders `""` as `—`.
    contentHash: g.confidential ? "" : (row?.content_hash ?? ""),
    kind: physics.kind,
    band: band(physics, day),
    recordedBand: `${row?.band ?? "—"} (set day ${row?.band_day ?? "—"})`,
    strength: strength(physics, day),
    salience: {
      relevance: physics.salience.relevance,
      emotional: physics.salience.emotional,
      predictive: physics.salience.predictive,
      novelty: physics.salience.novelty,
      claimed: physics.salience.claimed ?? null,
      combined: sal(physics.salience),
    },
    repetition: rep(physics),
    uses: physics.uses,
    reinforcedDays: physics.reinforcedDays ?? 0,
    bornDay: physics.birthDay,
    lastUsedDay: physics.lastUsedDay,
    learnedOn: doc.learnedOn,
    happenedOn: doc.happenedOn ?? null,
    consolidated: physics.consolidated === true,
    promoted: physics.promotedIdentity === true,
    protected: physics.protected === true,
    pressure: physics.pressure,
    bar: physics.pressure > 0 ? barFor(src, headId) : null,
    archived: row?.archived === 1 ? (row.archived_reason ?? "archived") : null,
    removal: store.removalRecord(headId).map((x) => ({ stage: x.stage, actor: x.actor, reason: x.reason, at: x.at })),
    edges: store.edgesFrom(headId).map((edge) => {
      const rr = reveal(store, edge.dst, 72);
      return { id: edge.dst, text: rr.text ?? rr.label, weight: edge.weight, confidential: rr.confidential };
    }),
    points,
    versions: store.versions(headId).map((v) => ({
      seq: v.seq,
      reason: v.reason,
      day: v.version_day,
      became: v.successor_id === null ? "revised in place" : (reveal(store, v.successor_id, 72).label),
    })),
    prospective: store.prospectiveFor(headId).map((p) => ({
      date: p.event_date,
      state: p.state,
      fires: p.fires,
      precision: p.precision,
    })),
    feelingsLine: g.confidential ? "" : feelingsLine(store.feelingsFor(headId), day - physics.birthDay),
    intensity: emotionalIntensity(physics),
    absence: null,
    chapter,
    day,
    curve,
    curveNote,
    useDays: useDaysOf(src, headId),
    promotion: coreRoad(verdict),
    feelings: feelingsWithCarry(src, headId, g.confidential),
    model: row?.model ?? null,
    eventDate: row?.event_date ?? null,
    createdAt: row?.created_at ?? null,
    ...writtenWhen(row?.created_at ?? null, doc.learnedOn, store.zone()),
    archivedWords: row?.archived === 1 ? archiveWords(row.archived_reason ?? null, row.superseded_by !== null) : null,
    timeline: timelineOf(src, headId, doc.meta["updates"]),
    ...cardWords(doc.body.trim(), chapter, g.confidential),
    about: row?.about ?? null,
    aboutBy: row?.about === null || row?.about === undefined ? null : row.about_by ?? null,
  };
}

/** The card's "Written" day and the details row's clock, both in `zone` (`MemoryDetail.writtenOn`). */
export function writtenWhen(
  createdAt: number | null,
  learnedOn: string,
  zone: string,
): { writtenOn: string | null; writtenClock: string | null } {
  if (createdAt !== null && createdAt > 0) {
    return { writtenOn: localDate(createdAt, zone) || null, writtenClock: localClockZone(createdAt, zone) || null };
  }
  return { writtenOn: isDay(learnedOn) ? learnedOn : null, writtenClock: null };
}

/** The lived days the log shows this memory being credited for use (`recall.credit`'s `ids`). */
function useDaysOf(src: DashboardSource, id: string): number[] {
  const days = new Set<number>();
  let rows;
  try {
    // Newest first: past the ceiling it is the OLDEST days that go uncounted,
    // never the days it was used this week.
    rows = src.store.eventLog({ name: "recall.credit", order: "desc", limit: LOG_CEILING });
  } catch {
    return [];
  }
  for (const e of rows) {
    if (e.payload === null || !e.payload.includes(id)) continue;
    try {
      const p = JSON.parse(e.payload) as Record<string, unknown>;
      const ids = p["ids"];
      if (!Array.isArray(ids) || !ids.includes(id)) continue;
      days.add(typeof p["day"] === "number" ? p["day"] : e.day);
    } catch {
      /* a row that will not parse says nothing about this memory */
    }
  }
  return [...days].sort((a, b) => a - b);
}

/** Its feelings, with what carried each one — withheld with the words on a confidential memory. */
function feelingsWithCarry(src: DashboardSource, id: string, confidential: boolean): MemoryDetail["feelings"] {
  const words = feelingsShown(src.store, id);
  let rows: { carried_by: string }[] = [];
  try {
    rows = src.store.feelingsFor(id);
  } catch {
    rows = [];
  }
  return words.map((f, i) => ({ ...f, carriedBy: confidential ? "" : (rows[i]?.carried_by ?? "") }));
}

/**
 * Its lineage, oldest first. The older memories it REPLACED are found by
 * scanning the archived rows for a `superseded_by` naming it — a scan on every
 * open of a card, over the archived set only, and through `row()` (a read of an
 * archived row through `read()` is itself an event).
 */
function timelineOf(src: DashboardSource, id: string, updates: unknown): TimelineStep[] {
  const store = src.store;
  const steps: TimelineStep[] = [];
  const words = (other: string): { text: string; confidential: boolean } => {
    const rr = revealHere(store, other, 90);
    return { text: rr.text ?? rr.label, confidential: rr.confidential };
  };
  for (const other of store.list({ archived: true })) {
    if (other === id) continue;
    const o = store.row(other);
    if (o === undefined || o.superseded_by !== id) continue;
    const v = store.versions(other).find((x) => x.successor_id === id);
    steps.push({ rel: "replaced", id: other, ...words(other), day: v?.version_day ?? null, seq: null, ...why(v?.reason ?? o.archived_reason) });
  }
  if (typeof updates === "string" && updates !== id) {
    steps.push({ rel: "corrects", id: updates, ...words(updates), day: null, seq: null, reason: null, dream: false });
  }
  let became: TimelineStep | null = null;
  for (const v of store.versions(id)) {
    if (v.successor_id === null) {
      steps.push({ rel: "revised", id: null, text: "its words were rewritten in place", confidential: false, day: v.version_day, seq: v.seq, ...why(v.reason) });
    } else {
      became = { rel: "became", id: v.successor_id, ...words(v.successor_id), day: v.version_day, seq: v.seq, ...why(v.reason) };
    }
  }
  const row = store.row(id);
  if (became === null && row !== undefined && row.superseded_by !== null) {
    became = { rel: "became", id: row.superseded_by, ...words(row.superseded_by), day: null, seq: null, ...why(row.archived_reason) };
  }
  if (became !== null) steps.push(became);
  return steps;
}

/** A step's reason, and whether it was a dream's near-copy merge. */
function why(reason: string | null | undefined): { reason: string | null; dream: boolean } {
  const r = reason ?? null;
  return { reason: r, dream: r === DREAM_MERGE_REASON };
}

function barFor(src: DashboardSource, id: string): number | null {
  try {
    return src.schemas.story(id).bar;
  } catch {
    return null;
  }
}

/** The card's words with a written date lifted off the front — display only. */
function cardWords(body: string, chapter: boolean, confidential: boolean): { shownText: string; writtenDate: string | null } {
  if (confidential) return { shownText: WITHHELD, writtenDate: null };
  if (chapter) {
    const lead = readChapterLead(body);
    const bare = stripChapterLead(lead.rest.trim());
    return { shownText: bare.rest || lead.rest.trim() || body, writtenDate: chapterDate(lead.date) ?? bare.date };
  }
  const lifted = liftDate(body);
  return { shownText: lifted.rest, writtenDate: lifted.date };
}
