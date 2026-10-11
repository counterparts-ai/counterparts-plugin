/**
 * Identity elements: ranking them for the briefing, enumerating them for the
 * owner, and the standing byte counter that trips before the self-schema can
 * dominate a prompt again.
 *
 * **Ranking is by strength, and that is the whole structure.** v1 kept a separate
 * derived identity *index* — its own budget, its own warmth ordering, its own
 * promotion path with zero production callers, and no reconciler — and it went
 * stale on the day it was seeded (contract §4, behavioral-spec §1 known gap). Here
 * identity elements are ordinary memories carrying strength, the briefing ranks
 * them, and there is no second structure to go stale. Identity-band memories are
 * decay-exempt in `physics/`, so their strength is their earned base: waking as
 * yourself is not a competition, but the order of the telling is.
 *
 * Nothing in this file reads a body into a decision record. Ranking works on rows
 * and physics; prose is read only for the `unresolved` flag (which the store has
 * no index for — INTERFACE-GAPS #2) and text arrives at render time through the
 * `Resolve` seam.
 */
import { createHash } from "node:crypto";
import type { Band, Kind, MemoryPhysics } from "../types.js";
import { strength } from "../physics/index.js";
import type { ProseDoc, ReadOnlyStore, Store, WakeDisplayRow } from "../store/index.js";
import type { SelfTunables } from "./tunables.js";
import { isWorkMemory } from "./work.js";

export type LaneName = "identity" | "craft" | "threads" | "hints" | "horizon";

/** One candidate line. Ids only — text is resolved at render time. */
export interface Ranked {
  readonly id: string;
  readonly lane: LaneName;
  readonly kind: Kind;
  readonly band: Band;
  readonly strength: number;
  readonly protected: boolean;
  readonly bornDay: number;
  /**
   * The last tie-break before the id: a hash of the memory's words, so two
   * memories tied on everything else order the same way in every store that
   * holds them. Ids are random (`store/index.ts#newId`), so an id tie-break is
   * stable within one store but not across two built alike (the demo seed's
   * two runs). A hash, not the text: this stays an ids-and-numbers structure.
   * Absent on a line with no memory behind it (the horizon lane).
   */
  readonly tieKey?: string;
  /** Threads only: person-scoped debts trim last (behavioral-spec §1 G4). */
  readonly personScoped: boolean;
  /** Lived day this element last rendered in a wake; -1 never. Identity only. */
  readonly lastRendered: number;
  /** Hints only: why it ranked where it did (`hintReading`). */
  readonly hint?: HintReading;
  /**
   * Horizon only (2026-10-10): a plain reminder due the day this wake is
   * read (`HorizonItem.plainDue`). It leads the lane, and it outranks the
   * self page's borrowing (`briefing.ts#ROOM_ORDER`'s `due`).
   */
  readonly due?: boolean;
}

/**
 * HOW A HINT RANKS (2026-09-26, the owner's "rich get richer"; harvested from
 * #238 and reworked after its review). The hints ("Nearby, if it helps:")
 * lane used to be "strongest first", so one strong memory held it nearly
 * every session: it was shown, mentioned, credited, still strongest, shown
 * again. Two changes break the loop, and both are here:
 *
 *   - **ORGANIC strength.** A hint is scored on its strength decayed since its
 *     last ORGANIC use — its last counted awake return, or any use from before
 *     it was ever shown — not since its last use of any kind. A use while it
 *     was showing is exactly the use the display may have prompted, so it
 *     keeps the memory's own strength up (it credits, as always) but buys it
 *     no advantage here, and it is not a return (physics §5.11).
 *   - **HABITUATION.** Each published showing adds `HINT_STEP` to a load that
 *     recovers as `exp(-days / HINT_RECOVERY_DAYS)` once it stops showing; the
 *     pull left is `1 / (1 + HINT_HABITUATION x load)`. Used or not while it
 *     was shown, the step is the same. A return AFTER it left the wake — the
 *     memory reached for without the prompt — resets the load outright.
 *
 * The score is `organic x habituation`; the warm floor still reads the
 * memory's own strength. Pure: the caller hands in the display row.
 */
export interface HintReading {
  readonly score: number;
  /** Strength decayed from the last organic use. */
  readonly organic: number;
  /** The load as it stands on `day`, before this render — and, for a hint
   *  an earlier render today showed, before today's one step. */
  readonly load: number;
  readonly habituation: number;
  readonly habit: "fresh" | "habituated" | "reset";
  /** The load to record if this render keeps it. */
  readonly nextLoad: number;
}

export function hintReading(
  physics: MemoryPhysics,
  display: WakeDisplayRow | undefined,
  day: number,
  t: Pick<SelfTunables, "HINT_STEP" | "HINT_RECOVERY_DAYS" | "HINT_HABITUATION">,
): HintReading {
  const lastReturn = physics.lastReturnDay ?? null;
  // What came back unprompted. Before it was ever shown, every use; after that,
  // only the uses it had then plus its awake returns (each return is one
  // referenced use the display did not prompt) — so a use while showing moves
  // neither the anchor nor the stability this score decays by.
  const organicUses =
    display === undefined ? physics.uses : Math.min(physics.uses, display.ever_uses + (physics.returnDays ?? 0));
  const anchor =
    display === undefined
      ? physics.lastUsedDay
      : Math.max(physics.birthDay, display.ever_last_used, lastReturn ?? -Infinity);
  const organic = strength({ ...physics, uses: organicUses, lastUsedDay: anchor }, day);
  let load = 0;
  let habit: HintReading["habit"] = "fresh";
  if (display !== undefined && display.lane === "hints") {
    const leftOn = display.closed_day;
    if (leftOn !== null && lastReturn !== null && lastReturn > leftOn) {
      habit = "reset";
    } else {
      // SHOWN BY AN EARLIER RENDER TODAY (2026-09-30): the stored load
      // already carries today's step, so a same-day re-render scoring it at
      // that would score the morning's hints at half and hand Nearby to the
      // runners-up. It is scored at the load from before the step; the step
      // itself stands (`nextLoad` below). Open or closed since: a row a later
      // render today dropped carries the same step, and scoring it at the
      // stepped load would reorder what that render left out (review of #287).
      const stepped = display.shown_day === day;
      const stored = stepped ? Math.max(0, display.load - t.HINT_STEP) : display.load;
      load = stored * Math.exp(-Math.max(0, day - display.shown_day) / t.HINT_RECOVERY_DAYS);
      habit = load > 0 ? "habituated" : "fresh";
    }
  }
  const habituation = 1 / (1 + t.HINT_HABITUATION * load);
  // A same-day re-render is one showing, not two.
  const sameDay = display !== undefined && habit !== "reset" && display.shown_day === day;
  const nextLoad = sameDay ? display.load : load + t.HINT_STEP;
  return { score: organic * habituation, organic, load, habituation, habit, nextLoad };
}

/**
 * Meta key prefix for "this identity element last rendered on lived day N".
 * Written by `Self.boundary` for the identity ids it KEPT (rendered, not
 * merely ranked), read once per scan. The rotation below is the whole
 * consumer.
 */
export const RENDERED_PREFIX = "self.rendered.";

export function lastRenderedOf(store: Store): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, value] of store.metaWithPrefix(RENDERED_PREFIX)) {
    const day = Number.parseInt(value, 10);
    if (Number.isFinite(day)) out.set(key.slice(RENDERED_PREFIX.length), day);
  }
  return out;
}

export interface Scanned {
  readonly id: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly physics: MemoryPhysics;
  readonly doc: ProseDoc;
  readonly strength: number;
  readonly unresolved: boolean;
  /** Who minted it (`mint.ts`'s channels, plus `"migrated"`). NULL on a pre-v4
   *  row whose provenance was never recorded. Carried here because the render
   *  dates a MIGRATED element differently — its encode date is an upper bound. */
  readonly source: string | null;
  readonly lastRendered: number;
  /** What the wake's hints lane last did with it (v8 `wake_display`), if anything. */
  readonly display?: WakeDisplayRow;
  /** The lived day this scan read strength at. */
  readonly day?: number;
  /** What it is about (`ABOUT_MARKS`), or null when unmarked. Absent on a
   *  hand-built test row: read as unmarked. */
  readonly about?: string | null;
  /** The directory it was written in (`origin_scope`), or null. */
  readonly originScope?: string | null;
}

/**
 * One pass over the active memories. Called once per boundary render, never on
 * the wake path (contract §5 G1: wake computes nothing).
 */
export function scanActive(store: Store, day: number): Scanned[] {
  const out: Scanned[] = [];
  const rendered = lastRenderedOf(store);
  const displays = store.wakeDisplays();
  for (const id of store.list({ type: "memory", archived: false })) {
    const s = scanOne(store, id, day, rendered, displays);
    if (s !== null) out.push(s);
  }
  return out;
}

/**
 * ONE memory, read as `scanActive` reads each (2026-10-10): for the wake
 * assembled at session start (`Self#assemble`), which reads the few ids its
 * lanes name rather than the whole store. Null for a row that is gone,
 * archived, or whose prose will not read. `rendered` and `displays` default to
 * none — the rotation and Nearby's showing are the turn-end render's.
 */
export function scanOne(
  store: Store,
  id: string,
  day: number,
  rendered: ReadonlyMap<string, number> = new Map(),
  displays: ReadonlyMap<string, WakeDisplayRow> = new Map(),
): Scanned | null {
  const row = store.row(id);
  if (row === undefined || row.archived !== 0) return null;
  let doc: ProseDoc;
  let physics: MemoryPhysics;
  try {
    doc = store.readProse(id);
    physics = store.physicsOf(id);
  } catch {
    // A memory whose prose has gone missing must not take the whole briefing
    // down with it (contract §5 G7: the wake never fails the session). It is
    // skipped here and stays visible in `store` telemetry.
    return null;
  }
  const display = displays.get(id);
  return {
    id,
    kind: physics.kind,
    band: row.band,
    physics,
    doc,
    strength: strength(physics, day),
    unresolved: doc.meta["unresolved"] === true,
    source: row.source,
    lastRendered: rendered.get(id) ?? -1,
    ...(display === undefined ? {} : { display }),
    day,
    about: row.about ?? null,
    originScope: row.origin_scope ?? null,
  };
}

function byStrength(a: Ranked, b: Ranked): number {
  if (b.strength !== a.strength) return b.strength - a.strength;
  if (a.bornDay !== b.bornDay) return a.bornDay - b.bornDay;
  return byContentThenId(a, b);
}

/** The final tie-break: the words' hash (`tieKey`), then the id. */
function byContentThenId(a: Ranked, b: Ranked): number {
  const ka = a.tieKey ?? "";
  const kb = b.tieKey ?? "";
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Identity ROTATES; it does not rank (CONTRACT §3: "re-inhabited, not
 * retrieved — core memories are constitutive, not competed for in a ranker").
 * Least-recently-rendered first, never-rendered ahead of everything, and only
 * then strength, born-day, id. Measured 2026-09-14 on the owner's store
 * (IMPROVEMENTS U6): eight identity elements tied at strength 1.0, the tie
 * broke oldest-born-first, the three winners were the three written on
 * migration day under a fresh clock, and 17 of 20 identity beliefs had never
 * rendered. A strength sort with a smarter tie-break would rotate the eight;
 * this rotates all of them.
 */
function byRotation(day: number | undefined): (a: Ranked, b: Ranked) => number {
  return (a, b) => {
    // RENDERED ALREADY TODAY goes first (2026-09-30): a later render the same
    // lived day — a page written, a write-up landed, the nightly run ended —
    // keeps the elements the day's first render chose, so the lane rotates
    // once a day however often the wake is rebuilt. Their order among
    // themselves falls to strength: the stamp overwrote the day each was
    // chosen by. The day's first render has nothing stamped today.
    const ta = a.lastRendered === day;
    const tb = b.lastRendered === day;
    if (ta !== tb) return ta ? -1 : 1;
    if (a.lastRendered !== b.lastRendered) return a.lastRendered - b.lastRendered;
    return byStrength(a, b);
  };
}

/**
 * Threads order: person-scoped first, then oldest-opened first. The trim eats
 * from the END of the lane, so long-held relational debts drop last
 * (behavioral-spec §1 G4 — *truncation must never be iteration luck*).
 */
function byThreadAge(a: Ranked, b: Ranked): number {
  if (a.personScoped !== b.personScoped) return a.personScoped ? -1 : 1;
  if (a.bornDay !== b.bornDay) return a.bornDay - b.bornDay;
  return byContentThenId(a, b);
}

/** Hints order: the hint score (organic strength x habituation), then as `byStrength`. */
function byHint(a: Ranked, b: Ranked): number {
  const sa = a.hint?.score ?? a.strength;
  const sb = b.hint?.score ?? b.strength;
  if (sb !== sa) return sb - sa;
  return byStrength(a, b);
}

/** One scanned memory as a line of `lane` — the shape `rankLanes` gives it.
 *  Exported for the wake assembled at session start (`Self#assemble`). */
export function rankedAs(s: Scanned, lane: LaneName, hint?: HintReading): Ranked {
  return {
    ...(hint === undefined ? {} : { hint }),
    id: s.id,
    lane,
    kind: s.kind,
    band: s.band,
    strength: s.strength,
    protected: s.physics.protected,
    bornDay: s.doc.bornDay,
    tieKey: createHash("sha256").update(s.doc.body).digest("hex"),
    personScoped: s.kind === "person",
    lastRendered: s.lastRendered,
  };
}

export interface Lanes {
  identity: Ranked[];
  craft: Ranked[];
  threads: Ranked[];
  hints: Ranked[];
  horizon: Ranked[];
  /**
   * WHAT EACH LANE'S CAP LEFT OUT, by id, in the lane's own rank order
   * (2026-09-29). The caps used to cut silently; the renderer now says, in one
   * short line per lane that lost something, how many more there are and
   * which ids recall can fetch whole — `briefing.ts#moreLine`.
   */
  overflow?: Record<LaneName, string[]>;
}

/**
 * The contract's ordering, in one place:
 *
 *   identity — every identity-band memory, least-recently-rendered first
 *              (`byRotation`); strength, born-day and id only break ties. Protected elements are INCLUDED: §14.1 G2's no-render
 *              rule guards the interpreter's schema slices — the falsification
 *              path — not the owner-facing wake (NOTES.md #2). A composition
 *              that is NOT owner-facing says so with `BoundaryRequest.omit`, and
 *              the sweep's wake copy passes exactly that predicate: protected and
 *              confidential rows never reach an interpreter's prompt, by either
 *              door.
 *   craft    — skill-kind, not already in identity, above the warm floor. The
 *              procedural self is rendered as CONTENT, never a pointer (§1).
 *              Empty under `workAtDelivery` (below): composed per directory.
 *   threads  — `unresolved` memories: person-scoped first, oldest-opened first.
 *   hints    — everything else warm enough to be worth a nudge, by `hintReading`:
 *              organic strength x habituation, so one strong memory cannot
 *              hold the lane every day (2026-09-26).
 *   horizon  — the caller's arriving occasions, in the order supplied
 *              (`prospective/` owns the ordering — INTERFACE-GAPS #3).
 *
 * A memory appears in exactly one lane: identity wins, then craft, then threads,
 * then hints. Two lanes showing the same statement is budget spent twice.
 * An ARRIVING occasion is a memory too, and it comes from the caller rather
 * than the scan, so until 2026-10-01 nothing kept it out of the other lanes:
 * the same reminder printed under "Arriving:" and "Nearby", both with its due
 * date (random-f2's item 13). The horizon is the more specific of the two — it
 * says when — so a memory arriving leaves craft, threads and hints; identity
 * still wins, and a memory there leaves the horizon instead.
 *
 * A memory a later one has SETTLED over (`settledOver`, 2026-10-01) is not in
 * craft, threads, hints or the horizon: shown alone, an answered question reads
 * as still open (random-f2's item 11). Identity keeps it — that band is earned.
 * It stays in recall, labelled by its standing.
 *
 * A hint the self page already COVERS (`coveredByPage`, `covered.ts`) is not
 * one either: Nearby is for what the page did not say (random-f2's item 5).
 *
 * WORK AT DELIVERY (`workAtDelivery`, 2026-10-01, lane 8): a work memory
 * (`work.ts#isWorkMemory`) is in no lane of the STORED composition. The
 * bundle is composed once per store and read in every directory, while work
 * belongs to the directory it was done in — so the craft lane is composed at
 * delivery, for the session's directory, beside "Last here"
 * (`handoff/work-here.ts`, `counterpart.ts#addHandoffPointer`), and Nearby is
 * left with what is personal. An unresolved work memory is still a thread:
 * an open question stays open wherever the session wakes. Off, the lanes are
 * what they were before: craft is skill-kind above the warm floor.
 */
export function rankLanes(
  scanned: readonly Scanned[],
  horizonIn: readonly Ranked[],
  t: SelfTunables,
  opts: {
    readonly settledOver?: ReadonlySet<string>;
    readonly coveredByPage?: ReadonlySet<string>;
    readonly workAtDelivery?: boolean;
    /** Arriving ids past the caller's own count (review of #367): the lane's
     *  overflow, after its cap's, filtered as the lane is. */
    readonly horizonMore?: readonly string[];
  } = {},
): Lanes {
  const identity: Ranked[] = [];
  const craft: Ranked[] = [];
  const threads: Ranked[] = [];
  const hints: Ranked[] = [];
  const settledOver = opts.settledOver ?? new Set<string>();
  const inIdentity = new Set(scanned.filter((s) => s.band === "identity").map((s) => s.id));
  const horizon = horizonIn.filter((h) => !inIdentity.has(h.id) && !settledOver.has(h.id));
  const arriving = new Set(horizon.map((h) => h.id));

  for (const s of scanned) {
    if (s.band === "identity") {
      identity.push(rankedAs(s, "identity"));
      continue;
    }
    if (arriving.has(s.id) || settledOver.has(s.id)) continue;
    if (s.unresolved) {
      threads.push(rankedAs(s, "threads"));
      continue;
    }
    if (
      opts.workAtDelivery === true &&
      isWorkMemory({
        about: s.about ?? null,
        kind: s.kind,
        originScope: s.originScope ?? null,
        journal: typeof s.doc.meta["episodeId"] === "string",
      })
    ) {
      continue;
    }
    if (s.strength < t.WARM_FLOOR) continue;
    if (s.kind === "skill") {
      craft.push(rankedAs(s, "craft"));
      continue;
    }
    // What the page already says is not "nearby" (2026-10-01, `covered.ts`).
    if (opts.coveredByPage?.has(s.id) === true) continue;
    hints.push(rankedAs(s, "hints", hintReading(s.physics, s.display, s.day ?? s.doc.bornDay, t)));
  }

  identity.sort(byRotation(scanned.find((s) => s.day !== undefined)?.day));
  craft.sort(byStrength);
  threads.sort(byThreadAge);
  hints.sort(byHint);

  const past = (lane: readonly Ranked[], cap: number): string[] => lane.slice(cap).map((r) => r.id);
  return {
    identity: identity.slice(0, t.IDENTITY_MAX),
    craft: craft.slice(0, t.CRAFT_MAX),
    threads: threads.slice(0, t.THREADS_MAX),
    hints: hints.slice(0, t.HINTS_MAX),
    horizon: horizon.slice(0, t.HORIZON_MAX),
    overflow: {
      identity: past(identity, t.IDENTITY_MAX),
      craft: past(craft, t.CRAFT_MAX),
      threads: past(threads, t.THREADS_MAX),
      hints: past(hints, t.HINTS_MAX),
      horizon: [
        ...past(horizon, t.HORIZON_MAX),
        ...(opts.horizonMore ?? []).filter((id) => !inIdentity.has(id) && !settledOver.has(id) && !arriving.has(id)),
      ],
    },
  };
}

// ── enumeration (constitution 16, scar §2.19) ───────────────────────────────

/**
 * Why an element is listed but cannot be shown.
 *
 * `removed` is the owner's erasure answering: the deny-list refuses the id by
 * name, and the tombstone says it WAS permanent. `unreadable` is everything
 * else — a row whose prose will not parse or has gone missing.
 *
 * The distinction is the whole point: an enumeration that silently dropped both
 * would make "everything permanent is enumerable" a claim about the elements
 * that happen to still work (scar §2.19), and a removed protected element would
 * leave the permanent list without leaving a trace.
 */
export type EnumeratedAbsence = "removed" | "unreadable";

/** The words an absent element carries where a title would go. */
export const ABSENT_TITLE: Record<EnumeratedAbsence, string> = {
  removed: "[removed]",
  unreadable: "[unreadable]",
};

export interface EnumeratedElement {
  readonly id: string;
  readonly kind: Kind;
  readonly band: Band;
  readonly strength: number;
  readonly protected: boolean;
  readonly promotedIdentity: boolean;
  readonly title: string | null;
  readonly bytes: number;
  /** Null when the element is present and readable. Otherwise names WHY not. */
  readonly absent: EnumeratedAbsence | null;
}

/**
 * The identity band and the protected set, SIDE BY SIDE.
 *
 * They are different populations and the difference is the point: identity is
 * what strength earned and physics can still move; protected is permanent ink no
 * revision path can reach and no schema slice will ever contradict
 * ("permanent-includes-permanently-wrong" is doctrine, §14.1 G2). Scar §2.19's
 * criterion is that everything permanent is enumerable on demand — *a list, not a
 * cadence* — and the pair read together is what makes an element that is both,
 * or neither, visible at a glance.
 *
 * Reads are pure: this writes nothing and logs nothing (§14.1 G8).
 */
export interface Enumeration {
  readonly day: number;
  readonly identity: EnumeratedElement[];
  readonly protected: EnumeratedElement[];
  /** Ids in both lists — permanent AND constitutive, the strictest class. */
  readonly both: string[];
  /** Protected elements that are NOT identity band: permanence without the band. */
  readonly protectedOutsideIdentity: string[];
  /** Ids in either half that could not be shown, with the reason. Never silent. */
  readonly absences: { id: string; where: "identity" | "protected"; why: EnumeratedAbsence }[];
}

const encoder = new TextEncoder();

export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

function enumerateOne(store: Store, id: string, day: number): EnumeratedElement | null {
  const row = store.row(id);
  if (row === undefined) return null;
  let doc: ProseDoc;
  let physics: MemoryPhysics;
  try {
    doc = store.readProse(id);
    physics = store.physicsOf(id);
  } catch {
    return null;
  }
  return {
    id,
    kind: physics.kind,
    band: row.band,
    strength: strength(physics, day),
    protected: physics.protected,
    promotedIdentity: physics.promotedIdentity,
    title: doc.title ?? null,
    bytes: byteLength(doc.body),
    absent: null,
  };
}

/**
 * The entry an element gets when it is on a list it cannot be read from. It
 * keeps its address, its family and its flags, and carries no strength and no
 * bytes: it weighs nothing, because there is nothing left of it to weigh.
 */
function absentElement(
  id: string,
  why: EnumeratedAbsence,
  was: { kind: Kind; band: Band; protected: boolean; promotedIdentity: boolean },
): EnumeratedElement {
  return {
    id,
    kind: was.kind,
    band: was.band,
    strength: 0,
    protected: was.protected,
    promotedIdentity: was.promotedIdentity,
    title: ABSENT_TITLE[why],
    bytes: 0,
    absent: why,
  };
}

export function enumerate(store: Store, day: number): Enumeration {
  const identity: EnumeratedElement[] = [];
  const guarded: EnumeratedElement[] = [];
  const absences: Enumeration["absences"] = [];
  const denied = new Set(store.deniedIds());

  const absentFromRow = (id: string, where: "identity" | "protected"): EnumeratedElement => {
    // The row is still there; the CONTENT is not. A denied id says so by name —
    // that is the deny-list answering before the prose does — and anything else
    // is honestly "unreadable", which is a different problem with a different fix.
    const why: EnumeratedAbsence = denied.has(id) ? "removed" : "unreadable";
    const row = store.row(id);
    absences.push({ id, where, why });
    return absentElement(id, why, {
      kind: (row?.kind ?? "fact") as Kind,
      band: (row?.band ?? "episodic") as Band,
      protected: row?.protected === 1,
      promotedIdentity: row?.promoted_identity === 1,
    });
  };

  for (const id of store.list({ band: "identity", archived: false })) {
    const e = enumerateOne(store, id, day);
    identity.push(e ?? absentFromRow(id, "identity"));
  }
  // Protection is a physics flag, not a band: an element can be permanent
  // without ever having been promoted, which is exactly the case the pair makes
  // visible. There is no `protected` filter on `list()` (INTERFACE-GAPS #2).
  for (const id of store.list({ archived: false })) {
    const e = enumerateOne(store, id, day);
    if (e === null) {
      // An unreadable row cannot be asked whether it was protected, so the
      // permanent half has to ask the store instead of the row. A dark-but-not-
      // yet-chased row still carries its flag; a chased one carries a tombstone.
      const row = store.row(id);
      if (row?.protected === 1) guarded.push(absentFromRow(id, "protected"));
      continue;
    }
    if (e.protected) guarded.push(e);
  }

  // The chased half: rows the owner removed keep a tombstone saying what they
  // WERE, so permanence and inspectability scale together even here (§2.19).
  // Their skeleton row carries no flags any more — the tombstone is the record.
  const listed = new Set([...identity, ...guarded].map((e) => e.id));
  for (const gone of store.tombstones()) {
    const was = {
      kind: gone.kind,
      band: gone.band,
      protected: gone.wasProtected,
      promotedIdentity: gone.wasPromotedIdentity,
    };
    if ((gone.wasPromotedIdentity || gone.band === "identity") && !listed.has(gone.id)) {
      identity.push(absentElement(gone.id, "removed", was));
      absences.push({ id: gone.id, where: "identity", why: "removed" });
    }
    if (gone.wasProtected && !guarded.some((e) => e.id === gone.id)) {
      guarded.push(absentElement(gone.id, "removed", was));
      absences.push({ id: gone.id, where: "protected", why: "removed" });
    }
  }

  identity.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  guarded.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  absences.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.where < b.where ? -1 : 1));

  const identityIds = new Set(identity.map((e) => e.id));
  return {
    day,
    identity,
    protected: guarded,
    both: guarded.filter((e) => identityIds.has(e.id)).map((e) => e.id),
    protectedOutsideIdentity: guarded.filter((e) => !identityIds.has(e.id)).map((e) => e.id),
    absences,
  };
}

// ── the identity core's HOME row (schemas/INTERFACE-GAPS #5) ────────────────

/**
 * The identity core is a PLACE, not a claim, and not a second identity surface.
 *
 * `schemas/` refuses to birth `kind: "self"` in two independent layers — "one
 * identity core; a second is a category error no evidence could justify" — so the
 * one row that says *the self exists as an entity here* can only come from this
 * module. Without it, `schemas/`'s placement rule degrades from
 * `status-on-identity-refused` to `entity-unknown`: still a refusal, but the
 * wrong one, and a silent weakening of the ~72 KB lesson (contract §5 G4) exactly
 * where it matters most.
 *
 * What this is NOT: v1's identity *index* — its own budget, warmth ordering,
 * promotion path and reconciler — which the contract drops and this build does
 * not have. Identity STATEMENTS remain ordinary memories ranked by strength; this
 * is one empty schema row carrying names, which is what "a newborn schema is
 * empty except its names" means.
 */
export const IDENTITY_CORE_ROLE = "entity";

export interface IdentityCoreSpec {
  /** The core's name. This module never invents one (INTERFACE-GAPS #8). */
  readonly name: string;
  readonly aliases?: readonly string[];
}

/** The existing core, if one has been minted. At most one may exist. */
export function findIdentityCore(store: ReadOnlyStore): string | null {
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      if (store.readProse(id).meta["role"] === IDENTITY_CORE_ROLE) return id;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * The core's NAME, for the day-0 lane (`briefing.ts#identityCoreLine`).
 *
 * `ensureIdentityCore` writes the name into three places — title, body and
 * `meta.name` — and `meta.name` is the one `schemas/` indexes, so it is read
 * first, with the title as the fallback for a row written before that shape
 * settled. Null when no core has been minted: this module invents no name
 * (INTERFACE-GAPS #8), and a store installed without `--name` renders exactly
 * what it rendered before.
 *
 * The CALLER is expected to have checked that the identity lane is empty first.
 * This reads prose, so it belongs at a boundary and never on the wake path
 * (contract §5 G1); on any store with even one identity element it is never
 * reached.
 */
export function identityCoreName(store: Store): string | null {
  const id = findIdentityCore(store);
  if (id === null) return null;
  try {
    const doc = store.readProse(id);
    const name = doc.meta["name"];
    if (typeof name === "string" && name.trim().length > 0) return name.trim();
    const title = (doc.title ?? "").trim();
    return title.length > 0 ? title : null;
  } catch {
    // A core whose prose will not read is not a reason to fail the wake (§5 G7).
    return null;
  }
}

// ── the standing self-schema byte counter (contract §5 G4) ──────────────────

export interface SchemaBytesReport {
  readonly bytes: number;
  readonly elements: number;
  readonly trip: number;
  readonly pressureAt: number;
  readonly pressure: boolean;
  readonly tripped: boolean;
  /** The heaviest elements, id + bytes, so the report names its own cause. */
  readonly heaviest: { id: string; bytes: number }[];
  /**
   * Fallback-minted self memories EXCLUDED from this weighing — the quarantine
   * (owner ruling 2026-08-29, review F8): a model reading transcripts must not
   * grow the self through the rumination pathway the CONTRACT forswears. They
   * remain ordinary, recallable memories; here they are counted, never silently
   * absent (scar §2.4). The first blind replay minted 205 of them and tripped
   * this very valve seven times.
   */
  readonly quarantined: number;
  /** The bytes those rows would have weighed — what the quarantine set aside. */
  readonly quarantinedBytes: number;
  /**
   * Episodes EXCLUDED from this weighing (day-0 finding, 2026-09-03): the journal
   * is `kind: self` prose, but it is not the self schema — v1's ~72 KB scar was
   * status accreting on `self.md`, not the diary. Weighing 224 migrated chapters
   * read the valve tripped at 3 MB on a store nobody had written to yet, and every
   * authored chapter after would have kept it tripped. Counted, never absent.
   */
  readonly episodes: number;
  readonly episodeBytes: number;
  /**
   * Migrated self rows EXCLUDED for the same reason the fallback rows are: the
   * valve watches what THIS system accumulates on the self (§5 G4: "status does
   * not accumulate"), and v1's thousand self-kind traces arrived in one write.
   * They remain ordinary, recallable memories; here they are counted.
   */
  readonly migrated: number;
  readonly migratedBytes: number;
}

/**
 * Status does not accumulate on the self. v1's `currentState` reached ~72 KB of
 * self-narration before anyone measured it — the counter exists so the next time
 * is a tripwire and not an archaeology project (earned-mechanism #5, scar §2.4:
 * an event when APPROACHED and an event when crossed).
 */
export function schemaBytes(store: Store, day: number, t: SelfTunables): SchemaBytesReport {
  const seen = new Set<string>();
  const weighed: { id: string; bytes: number }[] = [];
  let quarantined = 0;
  let quarantinedBytes = 0;
  let episodes = 0;
  let episodeBytes = 0;
  let migrated = 0;
  let migratedBytes = 0;
  for (const id of [
    ...store.list({ band: "identity", archived: false }),
    ...store.list({ kind: "self", archived: false }),
  ]) {
    if (seen.has(id)) continue;
    seen.add(id);
    // The quarantine (see the report field). Two exemptions, both earned:
    // identity-band rows got there by a counted crossing (nothing is born into
    // identity), and PROTECTED rows are a deliberate owner act — and since
    // `enumerate()` renders every protected row, exempting them here keeps the
    // measured set equal to the rendered set (PR-2 review should-fix 2: a
    // weighed prompt byte must never be invisible to the byte valve).
    const row = store.row(id);
    if (row !== undefined && row.type === "episode" && row.band !== "identity" && row.protected !== 1) {
      episodes += 1;
      const e = enumerateOne(store, id, day);
      if (e !== null) episodeBytes += e.bytes;
      continue;
    }
    if (
      row !== undefined &&
      row.source === "migrated" &&
      row.band !== "identity" &&
      row.protected !== 1
    ) {
      migrated += 1;
      const m = enumerateOne(store, id, day);
      if (m !== null) migratedBytes += m.bytes;
      continue;
    }
    if (
      row !== undefined &&
      row.source === "fallback" &&
      row.band !== "identity" &&
      row.protected !== 1
    ) {
      quarantined += 1;
      const q = enumerateOne(store, id, day);
      if (q !== null) quarantinedBytes += q.bytes;
      continue;
    }
    const e = enumerateOne(store, id, day);
    if (e !== null) weighed.push({ id, bytes: e.bytes });
  }
  const bytes = weighed.reduce((n, w) => n + w.bytes, 0);
  weighed.sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1));
  const pressureAt = Math.round(t.SCHEMA_BYTES_TRIP * t.SCHEMA_BYTES_PRESSURE);
  return {
    bytes,
    elements: weighed.length,
    trip: t.SCHEMA_BYTES_TRIP,
    pressureAt,
    pressure: bytes >= pressureAt,
    tripped: bytes >= t.SCHEMA_BYTES_TRIP,
    heaviest: weighed.slice(0, 5),
    quarantined,
    quarantinedBytes,
    episodes,
    episodeBytes,
    migrated,
    migratedBytes,
  };
}
