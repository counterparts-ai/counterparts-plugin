/**
 * `prospective/` — remembering to act. Know that the remembered future has
 * arrived, and be *inclined* rather than *reminded*.
 *
 * The module's spine:
 *
 *   `windows.ts`   precision, window bounds, the ramp, the firing KEY
 *   `derive.ts`    the eligibility predicate — derived, never stored
 *   `tunables.ts`  every knob, in one visible place
 *   `index.ts`     arrivals (read) + the firing-state transitions (write)
 *
 * Three properties are structural here and worth stating at the top:
 *
 * **ARRIVAL IS A CUE, NOT A COMMAND. THERE IS NO BYPASS LANE.** The calendar
 * turning to June is treated exactly like the user saying "Portland": one more
 * cue offered into `recall/`'s ordinary activation → gate → tier competition,
 * under the same floors, refractory, dedup and footnote-first tiering as
 * everything else. This module therefore has **no export that produces text** —
 * no render, no injection, no wording, not even a template. It hands out
 * candidates and weights; whether anything is ever said is entirely `recall/`'s
 * decision, made against the same bars as every other memory. A test enumerates
 * this module's exports and asserts the absence (contract §5 G1).
 *
 * **The tact principle IS the spec.** A system that surfaces every stored
 * commitment at first retrievability is a task queue wearing memory's clothes.
 * Hold debts, lose deadlines. Every brake here answers one question: *is this the
 * moment it MEANS something, or merely the first moment it's retrievable?*
 *
 * **Firing state is not canonical memory** (§12 G12). Losing a row risks one
 * extra polite mention, never a memory — so the write budget is small and loud:
 * transitions never stall a host-facing path, and every refusal has a name.
 */
import type { Kind } from "../types.js";
import { isKnownSession } from "../types.js";
import { strength } from "../physics/index.js";
import type { UseTier } from "../physics/index.js";
import type { ProseDoc, ProspectiveInput, ProspectiveRow, Store } from "../store/index.js";
import { RECURRING_META } from "../store/index.js";
import { addDays, daysBetween, isDay, isRecurrence, occurrenceBetween } from "../time.js";
import type { Recurrence } from "../time.js";
import { derive } from "./derive.js";
import type { DerivableMemory, DeriveReason, ExtractedDate, Prospectivity } from "./derive.js";
import { TEMPORAL_MAX_TIER, withTunables } from "./tunables.js";
import type { ProspectiveTunables } from "./tunables.js";
import { imminence, parseWindowKey, phaseOf, precisionOf, rampAt, recurringWindowAt, windowFor } from "./windows.js";
import type { DatePrecision, Phase, Window, WindowPrecision } from "./windows.js";

export * from "./derive.js";
export * from "./tunables.js";
export * from "./windows.js";

/**
 * The durable lifecycle, in the store's own four-value vocabulary:
 *
 *   `armed`      a derived window with no fires spent
 *   `fired`      at least one ambient fire spent this window; budget may remain
 *   `suppressed` TERMINAL by referenced-stop — the decisive brake (§12 G6)
 *   `expired`    TERMINAL because the window closed, or a reschedule replaced it
 *
 * `expired` is also the DERIVED reading of a row nobody stamped: a passed window
 * needs no cleanup pass to stop mattering (§12 G2). Nothing here sweeps.
 */
export type WindowState = ProspectiveInput["state"];

/**
 * THE TWO DURABLE ROWS (2026-09-20, E2).
 *
 * This module had none. `fires` and `last_fired_day` are columns on a row, so
 * the store could say a window had ever fired and never when, or why one did
 * not — the 2026-09-17 inventory marked the whole mechanism RING-ONLY, "zero
 * `appendEvent` in the module", with fourteen rows whose counters came from a
 * v1 import and `last_fired_day` null on every one of them.
 *
 * TWO NAMES, not one with an `outcome`. A refusal counted as a firing is the
 * bug the fired view exists to catch, and the two names keep them apart in
 * every reader by construction (the `snapshot.taken` / `snapshot.failed` split,
 * for the same reason).
 *
 * The refusal is LATCHED per memory, window, reason and lived day: eligibility
 * is re-derived every turn, so `not-eligible` on a memory whose date has passed
 * would otherwise write a row every turn for the rest of the store's life. A
 * fire needs no latch — `FIRES_PER_WINDOW` already bounds it.
 *
 * Ids, a window key, a reason and a day. Never a date the memory is about and
 * never a word of it.
 */
export const PROSPECTIVE_FIRE_EVENT = "prospective.fire";
export const PROSPECTIVE_REFUSED_EVENT = "prospective.fire.refused";

/**
 * THE THIRD DURABLE ROW (2026-09-26): a PLAIN item was told to the person —
 * one row per memory, window and beat, latched by `dedupKey`, so it doubles as
 * the once-only mark two hook processes race for (`claimPlain`). Ids, the
 * window key, the beat and today's calendar date; never a word of the memory.
 */
export const PROSPECTIVE_PLAIN_EVENT = "prospective.plain";

/**
 * PLAIN OR QUIET (owner decision 2026-09-25/26, a working default). The author
 * of a dated memory says which, on the same `note` / `session_end` entry that
 * carries the date, and it lives in the memory's `meta` bag under this key — no
 * column, no schema bump. Anything but `"plain"` reads as quiet, which is the
 * default and the whole of the tact principle: a quiet item is one more cue,
 * capped at the footnote tier. A plain one is also SAID, plainly, on its day —
 * the one deliberate exception to "no bypass lane", recorded in CONTRACT §3.
 */
export type CueMode = "plain" | "quiet";
export const CUE_MODE_META = "remind";

export function cueModeOf(doc: Pick<ProseDoc, "meta">): CueMode {
  return doc.meta[CUE_MODE_META] === "plain" ? "plain" : "quiet";
}

/**
 * A PLAIN REMINDER DUE THE DAY A WAKE COMPOSED FOR `at` IS READ (2026-10-10):
 * plain, and dated `at` or the day after — the evening boundary's wake is
 * read the next morning, so a reminder due tomorrow is due the morning its
 * wake is read. The wake's horizon lane puts these first, before its count
 * (`horizon`), and the wake ranks them above everything but the self page in
 * its own room (`self/briefing.ts#ROOM_ORDER`'s `due`). Pure.
 */
export function plainDueOn(item: { readonly eventDate?: string; readonly mode?: CueMode }, at: string): boolean {
  if (item.mode !== "plain" || item.eventDate === undefined || !isDay(item.eventDate) || !isDay(at)) return false;
  return item.eventDate === at || item.eventDate === addDays(at, 1);
}

/**
 * THE ORDER OF THE WAKE'S "ARRIVING:" LANE (2026-10-11, decided by random-06,
 * lightly held), so the count (`HORIZON_ITEMS`) cuts from the bottom of it:
 *
 *   1. plain and due the day the wake is read (`plainDueOn`);
 *   2. every other plain one;
 *   3. the quiet ones.
 *
 * Within a tier, the nearest date first, in whole days either side of `at`: a
 * date in its grace days is as near as one the same number of days ahead. A
 * tie keeps the order it came in (the sort is stable; `arrivals()` hands them
 * by ramp x strength). Day dates only — `horizon()` offers nothing else; a
 * date that will not count sorts last in its tier. Pure.
 */
export function byArrivingOrder(at: string): (a: Arrival, b: Arrival) => number {
  const tier = (x: Arrival): number => (plainDueOn(x, at) ? 0 : x.mode === "plain" ? 1 : 2);
  const away = (x: Arrival): number => {
    const d = isDay(x.eventDate) && isDay(at) ? daysBetween(at, x.eventDate) : Number.POSITIVE_INFINITY;
    return Math.abs(d);
  };
  return (a, b) => tier(a) - tier(b) || away(a) - away(b);
}

/**
 * HOW OFTEN IT COMES ROUND (2026-10-09, the owner's design, held lightly):
 * `daily | weekly | monthly | yearly`, in the meta bag beside `remind`
 * (`store`'s `RECURRING_META` — no schema bump), anchored on the event date.
 * Only a DAY repeats: on a month, a range or a year, and with no date at all,
 * this reads null and the date is once, as stated. A repeating date arrives
 * once per OCCURRENCE (`windows.ts#recurringWindowAt`) — each occurrence its
 * own window key, so every per-window brake is per occurrence.
 */
export { RECURRING_META };

export function recurrenceOf(doc: Pick<ProseDoc, "eventDate"> & { readonly meta?: ProseDoc["meta"] }): Recurrence | null {
  const rule = doc.meta?.[RECURRING_META];
  return isRecurrence(rule) && isDay(doc.eventDate) ? rule : null;
}

/**
 * A REMINDER THAT MOVED (review of #247, 2026-09-26). When a revision takes a
 * dated memory's reminder over (`Counterpart#carryReminder`), the two memories
 * point at each other in their meta bags, ids only:
 *
 *   - the successor's `reminderFrom` names the memory it took the reminder
 *     from, so what was already said or spent for the SAME window (the plain
 *     latch, the quiet fire budget, a referenced stop) is still counted — a
 *     move is not a new reminder (`lineage`);
 *   - the old memory's `reminderMovedTo` names where it went, so a later
 *     revision that addresses the OLD id (which stays live: revising an
 *     ordinary memory settles it `changed` or `open` without superseding it —
 *     a `corrected` one is archived, and a revision of it is refused) still
 *     finds the reminder to reschedule or drop, instead of finding nothing.
 */
export const DATE_FROM_META = "reminderFrom";
export const DATE_MOVED_TO_META = "reminderMovedTo";

/** How far either pointer is followed. A reminder revised this many times in a
 *  row is still found; a longer chain answers as if it ended there. */
export const DATE_LINEAGE_MAX = 16;

const WINDOW_STATES: readonly WindowState[] = ["armed", "fired", "suppressed", "expired"];

/** Box 2 hands back `state` as TEXT. An unrecognized value reads as `armed` — the
 *  direction that costs at most one polite mention, never a silent terminal. */
export function windowStateOf(row: ProspectiveRow | undefined): WindowState {
  const s = row?.state;
  return WINDOW_STATES.find((x) => x === s) ?? "armed";
}

/** Distinct reasons, because a suppressed fire and a fire that never became
 *  eligible are different records (scar §2.4). */
export type SuppressReason =
  /** Crisis deference (§12 G7). A friend doesn't pivot from the ashes to "so, June!". */
  | "refractory"
  /** The window has not opened yet. */
  | "window-not-open"
  /** The window closed, or was terminally retired. The "stale" case. */
  | "stale-window"
  /** Brake 4, the decisive one: the assistant was observed to have USED the
   *  memory, so zero further fires this window. Remembering completes by being
   *  lived, not by acknowledgment UI. */
  | "already-referenced"
  /** Brake 2: the per-window cap is spent. */
  | "over-fired"
  /** Brake 1: at most one ambient fire per occasion per LIVED day. */
  | "already-fired-today"
  /** Tune question (b), 2026-09-26: a month or range window's LAST fire is kept
   *  for after the span it names, so it gets an "after" beat instead of spending
   *  its whole budget in the first days (`HOLD_LAST_FIRE_FOR_AFTER`). */
  | "held-for-after"
  /** A PLAIN item already told outright today (`claimPlain`): the same thing
   *  as a footnote on the next turn would be saying it twice (2026-09-26). */
  | "told-plainly-today"
  /** Brake 3: already offered in this session. */
  | "session-dedup";

export type FireReason =
  | "fired"
  | "observer"
  | "unknown-memory"
  /** The memory no longer derives as prospective at all; `derivation` says why. */
  | "not-eligible"
  /** Eligible, but this key is not one of the memory's derived windows — the
   *  shape a stale caller takes after a reschedule. */
  | "window-not-derived"
  | SuppressReason;

export type TransitionReason =
  | "recorded"
  | "observer"
  | "unknown-memory"
  | "malformed-window-key";

export type RescheduleReason =
  | "rescheduled"
  | "observer"
  | "unknown-memory"
  /** The proposal named a current value that is not the current value. A stale
   *  proposal must never clobber a fresher date (§12 G8). */
  | "stale-proposal"
  | "malformed-date"
  | "unchanged";

/** Telemetry: ids, window keys, counts, states, reasons. NEVER body text. */
export interface ProspectiveEvent {
  at: number;
  name: string;
  ref?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface ProspectiveOptions {
  store: Store;
  /** Overrides on the CAL table. Every one is a calibration claim (scar §2.8). */
  tunables?: Partial<ProspectiveTunables>;
  onEvent?: (e: ProspectiveEvent) => void;
  /** Injectable wall clock, for telemetry stamps only. Never a lived day. */
  now?: () => number;
}

/**
 * One arrived window, offered as a CUE. Note what is absent: no text, no
 * phrasing, no "should surface" boolean. `cueWeight` and `maxTier` are inputs to
 * somebody else's competition.
 */
export interface Arrival {
  readonly memoryId: string;
  readonly windowKey: string;
  /** As stated. A month stays a month (§12 G4). */
  readonly eventDate: string;
  readonly precision: WindowPrecision;
  readonly opensOn: string;
  readonly peakOn: string;
  readonly closesOn: string;
  /** 0..1 — how loudly the window is arriving today. */
  readonly ramp: number;
  /** The weight this arrival offers `recall/`'s CUE stage: CUE_STRENGTH x ramp.
   *  It is one more cue token's worth of activation, not a channel of its own
   *  (INTERFACE-GAPS #1 — do NOT confuse it with recall's `ARRIVAL_WEIGHT`,
   *  which is base-level recency and something else entirely). */
  readonly cueWeight: number;
  /** §12 G5: a temporal cue alone reaches the footnote tier AT MOST. */
  readonly maxTier: UseTier;
  readonly state: WindowState;
  readonly fires: number;
  readonly lastFiredDay: number | null;
  /** Decayed strength on `day`, for ORDERING only. No decay exemption before
   *  arrival (§12 G10): a future-dated memory that faded before its window was
   *  an occasion that didn't matter — save a live repeat, which arrives faded
   *  or not (review of #341, `derive.ts`). */
  readonly strength: number;
  /** Plain or quiet, as the author said (`CUE_MODE_META`). Carried so the fire
   *  row can count the two apart; it changes nothing about the cue itself. */
  readonly mode: CueMode;
  /** A repeating date (2026-10-09): `eventDate` is this occurrence; these say
   *  the day it repeats from and how often, so a host can say "every May 14".
   *  Absent on a date that does not repeat. */
  readonly anchor?: string;
  readonly recurring?: Recurrence;
}

/** Which moment of a plain item's window it is being told on. */
export type PlainBeat =
  /** A day-dated item, on its day. */
  | "day"
  /** A month or range item, the first day it is open and seen. */
  | "opens"
  /** A month or range item, on the last day it names. */
  | "last-day";

/**
 * A plain item due to be told today. Records only — like `Arrival`, no words:
 * the adapter that talks to a person owns those (`adapters/claude-code`).
 */
export interface PlainDue {
  readonly memoryId: string;
  readonly windowKey: string;
  readonly eventDate: string;
  readonly precision: WindowPrecision;
  readonly beat: PlainBeat;
  /** The span the date names, `YYYY-MM-DD` both. */
  readonly firstDay: string;
  readonly lastDay: string;
  /**
   * A DAY item whose day passed untold, told once LATE inside its grace
   * (2026-10-11, review 07 C4). Its beat is still `day`, so its latch is the
   * day's own: whatever asks "was the day told" — the lane, the occurrence
   * credit, the doctor's reading — reads a late telling as the day told, and
   * it can never be told twice. Absent on a beat told on time.
   */
  readonly late?: true;
}

export interface SuppressionRecord {
  readonly memoryId: string;
  readonly windowKey: string;
  readonly reason: SuppressReason;
}

export interface ArrivalInput {
  /** The calendar day being asked about, `YYYY-MM-DD`. An ARGUMENT, never a
   *  clock read — "was this arriving on July 5th?" is the same code path. */
  readonly at: string;
  /** The LIVED day, for the once-per-day brake. Defaults to the store's clock. */
  readonly day?: number;
  readonly sessionId?: string;
  /** Crisis deference (§12 G7): suppress arrival cues wholesale. */
  readonly refractory?: boolean;
  /** Extra caller-extracted dates by memory id, merged with the memory's own
   *  content dates. This module does NO NLP; whoever read the sentence owns it. */
  readonly extraDates?: ReadonlyMap<string, readonly ExtractedDate[]>;
}

export interface ArrivalResult {
  readonly at: string;
  readonly day: number;
  readonly observer: boolean;
  /** Sorted by ramp x strength, descending. Candidates, not decisions. */
  readonly arrivals: Arrival[];
  /** Windows that would have arrived and did not, each with its own reason. */
  readonly suppressed: SuppressionRecord[];
  /** Live memories examined. */
  readonly considered: number;
  /** Memories whose derivation refused, by name. This is where "a row exists but
   *  the memory is no longer prospective" shows up — the row is firing state, it
   *  is never evidence of prospectivity (§12 G2). */
  readonly refused: { memoryId: string; reason: DeriveReason }[];
}

export type HorizonReason =
  | "selected"
  | "nothing-arrived"
  /** The horizon beat is suppressed WHOLESALE after a high-affect previous
   *  session (§12 G7). A window is days wide; deferring costs nothing. */
  | "high-affect-previous-session";

export interface HorizonInput extends ArrivalInput {
  readonly previousSessionHighAffect?: boolean;
}

export interface HorizonResult {
  readonly items: Arrival[];
  /**
   * WHAT THE COUNT LEFT OUT (review of #367, 2026-10-10): the arrivals that
   * would have taken a wake line but for `HORIZON_ITEMS`, in the same order.
   * The wake names them by id under the lane ("N more arriving; recall ids:
   * …") so a dated item past the count is never silently missing.
   */
  readonly more: Arrival[];
  readonly reason: HorizonReason;
  readonly suppressedWholesale: boolean;
  readonly considered: ArrivalResult;
}

export interface FireInput {
  readonly memoryId: string;
  readonly windowKey: string;
  readonly at: string;
  readonly day?: number;
  readonly sessionId?: string;
  readonly refractory?: boolean;
  readonly dates?: readonly ExtractedDate[];
}

export interface FireOutcome {
  readonly fired: boolean;
  readonly reason: FireReason;
  /** Why derivation refused, when it did. Null otherwise. */
  readonly derivation: DeriveReason | null;
  readonly fires: number;
  readonly state: WindowState;
}

export interface TransitionOutcome {
  readonly recorded: boolean;
  readonly reason: TransitionReason;
  readonly state: WindowState;
}

export interface RescheduleInput {
  readonly memoryId: string;
  /** The compare half of the compare-and-swap: the exact current event date. */
  readonly expectCurrentDate: string;
  readonly nextDate: string;
  readonly at: string;
  readonly reason?: string;
  readonly dates?: readonly ExtractedDate[];
}

export interface RescheduleOutcome {
  readonly rescheduled: boolean;
  readonly reason: RescheduleReason;
  /** The retired window's key — kept, in state `expired`, never deleted. */
  readonly retiredKey: string | null;
  /** The fresh key, which owes nothing to the old one's spent budget (§12 G9). */
  readonly armedKey: string | null;
}

/**
 * A memory's content-date: its reminder date, `ProseDoc.eventDate` (schema v7,
 * the `event_date` column), exactly as stated. SHAPE ONLY — nothing here reads
 * prose for dates; the model writes the field (INTERFACE-GAPS #2, closed
 * 2026-09-26).
 *
 * Two sources this used to read are gone on purpose. `happenedOn` is a PAST
 * date by name, and `schemas/` writes every belief's `statedOn` into it, so
 * reading it as a future occasion was a category error waiting for data. The
 * `meta.eventDate` / `meta.eventDates` convention was this module's own
 * stand-in for the column, and nothing ever wrote it; keeping it would have
 * meant a second enumeration (a scan of every memory) to find what the index
 * now answers. Caller-extracted dates still arrive through `extraDates`.
 */
export function contentDates(doc: Pick<ProseDoc, "eventDate"> & { readonly meta?: ProseDoc["meta"] }): ExtractedDate[] {
  const v = doc.eventDate;
  if (typeof v !== "string" || v === "") return [];
  // A repeating day carries its rule to `derive`, which finds the occurrence.
  const rule = recurrenceOf(doc);
  return [rule === null ? { date: v } : { date: v, recurring: rule }];
}

/** Ids of live memories whose repeating date has an occurrence from `from` to
 *  `to` — what `Store.datedMemories` cannot see, since it reads the anchor. */
function recurringIn(store: Store, from: string, to: string): string[] {
  return store
    .recurringMemories()
    .filter((r) => occurrenceBetween(r.eventDate, r.recurring, from, to) !== null)
    .map((r) => r.id);
}

/** Every memory whose stated date could have an OPEN window on `at`: the span
 *  must reach from `at - GRACE_DAYS` to `at + LEAD_DAYS`. */
function candidateSpan(at: string, t: ProspectiveTunables): { from: string; to: string } | null {
  if (!isDay(at)) return null;
  return { from: addDays(at, -t.GRACE_DAYS), to: addDays(at, t.LEAD_DAYS) };
}

/** Score, then imminence, then key — tune question (d). Scores closer than
 *  this are a TIE: two salience means 0.7 and 0.7 must not be split by a float
 *  rounding in the ramp. */
const TIE = 1e-9;

interface Loaded {
  memory: DerivableMemory;
  doc: ProseDoc;
  dates: ExtractedDate[];
  strength: number;
}

export class Prospective {
  readonly store: Store;
  readonly tunables: ProspectiveTunables;
  /** One predicate, one definition: the store's. Never re-derived here
   *  (observer-mode.md G7, recall INTERFACE-GAPS #4). */
  readonly observer: boolean;

  private readonly onEvent: ((e: ProspectiveEvent) => void) | undefined;
  private readonly now: () => number;
  private readonly ring: ProspectiveEvent[] = [];
  /** Brake 3. In-process on purpose — see INTERFACE-GAPS #3. */
  private readonly sessionFired = new Map<string, Set<string>>();

  constructor(opts: ProspectiveOptions) {
    this.store = opts.store;
    this.tunables = withTunables(opts.tunables ?? {});
    this.observer = opts.store.observer;
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => Date.now());
  }

  // ── derivation (pure, read-time, observer-safe) ───────────────────────────

  /**
   * The predicate, against a memory the caller already has. Recomputed every
   * time: there is no stored answer to go stale (§12 G2).
   */
  derive(
    memory: DerivableMemory,
    dates: readonly ExtractedDate[],
    at: string,
  ): Prospectivity {
    return derive(memory, dates, at, this.tunables);
  }

  /** The same predicate, against a memory the STORE has. Reads only. */
  deriveFor(
    memoryId: string,
    at: string,
    extra: readonly ExtractedDate[] = [],
    day?: number,
  ): Prospectivity | null {
    const loaded = this.load(memoryId, extra, day ?? this.store.livedDay());
    if (loaded === null) return null;
    return derive(loaded.memory, loaded.dates, at, this.tunables);
  }

  // ── arrivals: candidates for recall's cue stage, never an injection ───────

  /**
   * Which windows have arrived, as CUES. This method writes nothing — not a row,
   * not a fire, not a byte — which is what makes it safe under observer and what
   * makes "arrival is a cue, not a command" a structural property rather than a
   * promise: the caller has to go back through `fire()` to spend anything, and
   * `recall/` gets to refuse in between.
   */
  arrivals(input: ArrivalInput): ArrivalResult {
    const day = input.day ?? this.store.livedDay();
    const arrivals: Arrival[] = [];
    const suppressed: SuppressionRecord[] = [];
    const refused: { memoryId: string; reason: DeriveReason }[] = [];
    const denied = new Set(this.store.deniedIds());
    // THE INDEX, not a scan (INTERFACE-GAPS #2, closed 2026-09-26): only a
    // memory whose stated date reaches `at` through lead or grace can have an
    // open window, and `Store.datedMemories` answers exactly that. The ids a
    // caller supplied dates for ride along — the index cannot know about them.
    const span = candidateSpan(input.at, this.tunables);
    const ids = new Set<string>(
      span === null ? [] : this.store.datedMemories(span.from, span.to).map((d) => d.id),
    );
    // A repeating date is found by an occurrence in the span, not by its anchor.
    if (span !== null) for (const id of recurringIn(this.store, span.from, span.to)) ids.add(id);
    for (const id of input.extraDates?.keys() ?? []) ids.add(id);
    let considered = 0;
    const order = new Map<string, readonly [number, number]>();

    for (const id of ids) {
      if (denied.has(id)) continue;
      const row = this.store.row(id);
      // A superseded head forwards; the successor arrives on its own merits.
      if (row === undefined || row.superseded_by !== null) continue;
      const loaded = this.load(id, input.extraDates?.get(id) ?? [], day);
      if (loaded === null) continue;
      considered += 1;

      const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
      if (!p.eligible) {
        // Includes the load-bearing case: a firing-state row may well exist for
        // this memory, and it buys the memory nothing. The rows record what
        // fired; the predicate decides what is prospective.
        refused.push({ memoryId: id, reason: p.reason });
        continue;
      }

      const rows = this.firingRowsFor(id);
      const mode = cueModeOf(loaded.doc);
      // Read only for a plain item, and only once per memory per call.
      const toldToday = mode === "plain" && this.plainToldOn(id, input.at);
      for (const w of p.windows) {
        const stateRow = rows.get(w.key);
        const brake =
          this.brakeFor(w, stateRow, {
            at: input.at,
            day,
            refractory: input.refractory === true,
            sessionId: input.sessionId,
          }) ?? (toldToday ? "told-plainly-today" : null);
        if (brake !== null) {
          suppressed.push({ memoryId: id, windowKey: w.key, reason: brake });
          continue;
        }
        const ramp = rampAt(w, input.at, this.tunables);
        arrivals.push({
          memoryId: id,
          windowKey: w.key,
          eventDate: w.eventDate,
          precision: w.precision,
          opensOn: w.opensOn,
          peakOn: w.peakOn,
          closesOn: w.closesOn,
          ramp,
          cueWeight: this.tunables.CUE_STRENGTH * ramp,
          maxTier: TEMPORAL_MAX_TIER,
          state: windowStateOf(stateRow),
          fires: stateRow?.fires ?? 0,
          lastFiredDay: stateRow?.last_fired_day ?? null,
          strength: loaded.strength,
          mode,
          ...(w.anchor === undefined || w.recurring === undefined ? {} : { anchor: w.anchor, recurring: w.recurring }),
        });
        order.set(`${id} ${w.key}`, imminence(w, input.at));
      }
    }

    // Salience-weighted ramp first; a TIE goes to the more imminent window —
    // sooner, then narrower — so "today" beats "sometime this month" at equal
    // salience (tune question d); then the key, so the order is total.
    const soon = (a: Arrival): readonly [number, number] =>
      order.get(`${a.memoryId} ${a.windowKey}`) ?? [0, 0];
    arrivals.sort((a, b) => {
      const d = b.ramp * b.strength - a.ramp * a.strength;
      if (Math.abs(d) > TIE) return d;
      const [au, aw] = soon(a);
      const [bu, bw] = soon(b);
      if (au !== bu) return au - bu;
      if (aw !== bw) return aw - bw;
      return a.windowKey < b.windowKey ? -1 : a.windowKey > b.windowKey ? 1 : a.memoryId < b.memoryId ? -1 : 1;
    });

    for (const s of suppressed) {
      // A window that has not opened yet was NEVER ASKED, which is a different
      // record from a fire that was refused (scar §2.4). It stays in the returned
      // list and out of the telemetry.
      if (s.reason === "window-not-open") continue;
      this.emit("prospective.suppressed", s.memoryId, {
        window: s.windowKey,
        reason: s.reason,
        day,
      });
    }
    this.emit("prospective.arrivals", undefined, {
      day,
      considered,
      arrived: arrivals.length,
      suppressed: suppressed.length,
      refused: refused.length,
      observer: this.observer,
    });
    return { at: input.at, day, observer: this.observer, arrivals, suppressed, considered, refused };
  }

  /**
   * The wake horizon: at most `HORIZON_ITEMS` arrivals, *remembered, not tasks*.
   * Returns the SAME `Arrival` records the cue path returns — ids and weights.
   * Whatever a host eventually says about them is the host's wording and the
   * host's decision; this module owns neither (open question 1: whether the
   * post-window grace beat is warm or creepy is deliberately unanswered).
   */
  horizon(input: HorizonInput): HorizonResult {
    const considered = this.arrivals(input);
    if (input.previousSessionHighAffect === true) {
      this.emit("prospective.horizon", undefined, {
        reason: "high-affect-previous-session",
        items: 0,
        arrived: considered.arrivals.length,
      });
      return {
        items: [],
        more: [],
        reason: "high-affect-previous-session",
        suppressedWholesale: true,
        considered,
      };
    }
    // Tune question (c), 2026-09-26 — the owner's human-memory framing: people
    // date-fire DAY-precision things (trash day, a defense tomorrow). A month
    // or a range lives as footnote warmth and context corroboration only; it
    // still arrives as a cue every day of its window, it just never takes a
    // wake line.
    //
    // A PLAIN reminder that has been TOLD leaves the lane (2026-09-29): it was
    // said outright on its day, and "Arriving:" for the grace week after is the
    // same thing said again as a thing still to come. It leaves once its LAST
    // beat is told — `day` for a day item, `last-day` for a month or a range
    // (which, by the filter above, take no wake line today anyway; the rule is
    // written for both so the two cannot drift if that changes). Only the lane:
    // `arrivals()` is untouched, so recall's cue path still finds it, and a
    // quiet item is unchanged.
    //
    // A DAILY repeat takes no wake line either (review of #339, 2026-10-09). It
    // is never "arriving" — it is every day — and the lane cannot say it right:
    // the wake is rendered at the evening boundary (`runner.ts`, `at` = that
    // day) and read the next morning, so a quiet daily read "due <yesterday>,
    // every day" at every first wake, measured through the hooks, and held one
    // of the two lines for good. A one-off's date is fixed, so a day-old render
    // of it is still true. A plain daily is still said outright each day
    // (`plainDue`), and a quiet one still cues recall on every turn.
    //
    // A PLAIN REMINDER DUE THE DAY THE WAKE IS READ COMES FIRST (2026-10-10),
    // ahead of the salience order and so ahead of the count: the person asked
    // to be told, and on that day it is not a question of how warm it is —
    // `plainDue`'s own reasoning (`plainDueOn`).
    //
    // THEN EVERY OTHER PLAIN ONE, THEN THE QUIET, EACH BY NEAREST DATE
    // (2026-10-11, decided by random-06, lightly held): two quiet items due
    // the 14th took both lines from a plain tax deadline due the 15th, on the
    // 13th and the 14th. A plain reminder never loses its place to quiet ones;
    // within a tier the nearest date leads, and the salience order only
    // breaks a tie (`byArrivingOrder`).
    const offered = considered.arrivals
      .filter((a) => a.precision === "day")
      .filter((a) => a.recurring !== "daily")
      .filter((a) => !this.toldForGood(a));
    const ordered = [...offered].sort(byArrivingOrder(input.at));
    const items = ordered.slice(0, this.tunables.HORIZON_ITEMS);
    // Past the count: named by id in the wake, never silently gone (review of #367).
    const more = ordered.slice(items.length);
    const reason: HorizonReason = items.length === 0 ? "nothing-arrived" : "selected";
    this.emit("prospective.horizon", undefined, {
      reason,
      items: items.length,
      more: more.length,
      arrived: considered.arrivals.length,
      ids: items.map((i) => i.memoryId).join(","),
    });
    return { items, more, reason, suppressedWholesale: false, considered };
  }

  // ── plain items: the one exception to "a cue, not a command" ──────────────

  /**
   * PLAIN items due to be told today, not yet told (owner decision 2026-09-25/26,
   * a working default — CONTRACT §3 names it as the deliberate exception to "no
   * bypass lane"). A person who said "don't let me forget to pay taxes before Oct
   * 15th!" asked to be told, and a footnote the model may or may not raise is not
   * telling them.
   *
   * SPARING, by construction — at most two beats per window, each once ever:
   *
   *   - a DAY item on its day (`day`);
   *   - a MONTH or RANGE item the first day it is open and seen (`opens`), and
   *     again on the last day it names (`last-day`) — the deadline end of
   *     "before the 15th". Seen first ON its last day, it gets that beat only.
   *
   * Only the stated span counts — no lead days: "on the day" is what was
   * asked. A YEAR has no day it could mean, so it is never told (the same
   * structural exclusion as a window, §12 G3).
   *
   * ONE LATE BEAT, AND ONLY FOR A DAY (2026-10-11, review 07 C4; decided by
   * the group-5 builder, lightly held). A day item whose day passed with
   * nothing told — no session that day, or none with room for the line — is
   * told once at the first session inside its grace (`GRACE_DAYS`; for a
   * repeat, its occurrence's own grace), marked `late` so the host says which
   * day it was for. It shares the day's latch, so it is never told twice, and
   * after the grace it is never told at all. A memory written after its day
   * was never missed, so it gets no late beat (nor one with no written date:
   * fail closed, §12 G3). A month or a range keeps its two beats and no late
   * one: its span already gave it two chances.
   *
   * It does NOT run the eligibility predicate. The salience floor is the tact
   * principle's gate on UNASKED surfacing; this is asked-for, and an ordinary
   * note sits at the authored default (0.25) under a 0.6 floor, so gating here
   * would make a plain reminder dead for most notes. What still refuses: an
   * archived, superseded, removed or journal row, and an observer.
   *
   * A read — `claimPlain` is the write, and the caller shows a line only for a
   * claim that landed. Records only; the words are the adapter's.
   */
  plainDue(input: { at: string }): PlainDue[] {
    if (this.observer || !isDay(input.at)) return [];
    const at = input.at;
    const denied = new Set(this.store.deniedIds());
    const out: PlainDue[] = [];
    // A REPEATING date is due on each occurrence (2026-10-09): the occurrence
    // that falls on `at` stands in for the date, so its window key — and with
    // it the latch per beat — is that occurrence's own.
    // A LATE candidate (`late`) is a day already past, carried with the last
    // day its grace allows.
    const due: { id: string; eventDate: string; lateUntil?: string }[] = [];
    const repeating = new Set<string>();
    for (const r of this.store.recurringMemories()) {
      repeating.add(r.id);
      const occurrence = occurrenceBetween(r.eventDate, r.recurring, at, at);
      if (occurrence !== null) {
        due.push({ id: r.id, eventDate: occurrence });
        continue;
      }
      // Still in the last occurrence's grace (cut short where the next one's
      // lead begins, `recurringWindowAt`): that occurrence may be owed late.
      const last = recurringWindowAt(r.eventDate, r.recurring, at, this.tunables, r.id);
      if (last !== null && last.eventDate < at && at <= last.closesOn) {
        due.push({ id: r.id, eventDate: last.eventDate, lateUntil: last.closesOn });
      }
    }
    for (const d of this.store.datedMemories(at, at)) if (!repeating.has(d.id)) due.push(d);
    for (const d of this.store.datedMemories(addDays(at, -this.tunables.GRACE_DAYS), addDays(at, -1))) {
      if (repeating.has(d.id) || !isDay(d.eventDate)) continue;
      due.push({ ...d, lateUntil: addDays(d.eventDate, this.tunables.GRACE_DAYS) });
    }
    for (const dated of due) {
      const id = dated.id;
      if (denied.has(id)) continue;
      const row = this.store.row(id);
      if (row === undefined || row.superseded_by !== null) continue;
      let doc: ProseDoc;
      try {
        doc = this.store.read(id).doc;
      } catch {
        continue;
      }
      if (doc.type === "episode" || cueModeOf(doc) !== "plain") continue;
      const precision = precisionOf(dated.eventDate);
      if (precision === null || precision === "year") continue;
      const w = windowFor(dated.eventDate, precision, this.tunables, id);
      if (w === null) continue;
      const late = dated.lateUntil !== undefined;
      if (late) {
        // Missed, and still inside its grace; written by its day (else it was never missed).
        const written = doc.learnedOn.slice(0, 10);
        if (w.precision !== "day" || at <= w.lastDay || at > (dated.lateUntil as string)) continue;
        if (!isDay(written) || written > w.eventDate) continue;
      } else if (at < w.firstDay || at > w.lastDay) continue;
      const beat: PlainBeat =
        w.precision === "day" ? "day" : at === w.lastDay ? "last-day" : "opens";
      if (this.plainTold(id, w.key, beat)) continue;
      out.push({
        memoryId: id,
        windowKey: w.key,
        eventDate: w.eventDate,
        precision: w.precision,
        beat,
        firstDay: w.firstDay,
        lastDay: w.lastDay,
        ...(late ? { late: true as const } : {}),
      });
    }
    // What is due today first; what is owed late after it.
    return [...out.filter((d) => d.late !== true), ...out.filter((d) => d.late === true)];
  }

  /**
   * Mark one plain beat as told. TRUE only when this call wrote the mark: the
   * `dedupKey` latch is the whole lock, so two hook processes racing for the
   * same beat cannot both win, and the caller shows the line only on true —
   * the update notice's "mark first, show only if marked" (roadmap E). An
   * observer marks nothing and is therefore told nothing.
   */
  claimPlain(due: PlainDue, opts: { at: string; day?: number; session?: string }): boolean {
    if (this.observer) return false;
    const day = opts.day ?? this.store.livedDay();
    try {
      const seq = this.store.appendEvent({
        name: PROSPECTIVE_PLAIN_EVENT,
        day,
        ref: due.memoryId,
        payload: {
          window: due.windowKey,
          beat: due.beat,
          precision: due.precision,
          date: opts.at,
          mode: "plain",
          // Told after its day, inside its grace (2026-10-11): same latch, marked.
          ...(due.late === true ? { late: true } : {}),
          // The session it was told in, when the caller knows (2026-10-11).
          ...(isKnownSession(opts.session) ? { session: opts.session } : {}),
        },
        dedupKey: `${PROSPECTIVE_PLAIN_EVENT}:${due.memoryId}:${due.windowKey}:${due.beat}`,
      });
      if (seq > 0) {
        this.emit("prospective.plain", due.memoryId, { window: due.windowKey, beat: due.beat, day });
      }
      return seq > 0;
    } catch {
      // A lost mark costs this line, never the turn (§12 G12's budget).
      return false;
    }
  }

  /**
   * IS THIS THE FIRST TIME THIS OCCURRENCE REACHES ANYONE? (2026-10-09.) True
   * only for a memory whose date still REPEATS (`recurrenceOf`, read now — a
   * one-off, or a repeat whose `recurring` was dropped, is always false) and
   * whose `windowKey` nothing has delivered yet: no quiet fire spent on it and
   * no plain beat told, on this memory or one its reminder moved from (the
   * rows the brakes read, so a revision does not count the same occurrence
   * twice). The caller asks BEFORE its `fire` or `claimPlain`, and counts the
   * occurrence as a use of the memory only when that delivery lands
   * (`Counterpart#creditOccurrence`). A read; firing state stays what it is,
   * not canonical memory, and the physics write is the caller's.
   */
  occurrenceUndelivered(memoryId: string, windowKey: string): boolean {
    if (this.observer) return false;
    try {
      if (recurrenceOf(this.store.read(memoryId).doc) === null) return false;
      if ((this.firingRowsFor(memoryId).get(windowKey)?.fires ?? 0) > 0) return false;
      return !this.plainTold(memoryId, windowKey, "day");
    } catch {
      return false;
    }
  }

  /** A PLAIN arrival whose window's LAST beat has been told: `day` for a day
   *  item, `last-day` for a month or a range (`plainDue`'s beats). A quiet
   *  arrival never is. A read. */
  private toldForGood(a: Arrival): boolean {
    if (a.mode !== "plain") return false;
    return this.plainTold(a.memoryId, a.windowKey, a.precision === "day" ? "day" : "last-day");
  }

  /** Has this beat already been told? A read of the latch `claimPlain` writes,
   *  so a turn with nothing new to say takes no write lock at all. */
  private plainTold(memoryId: string, windowKey: string, beat: PlainBeat): boolean {
    // The memories this reminder moved through count too: a beat told on the
    // row a revision took the reminder from was TOLD (`DATE_FROM_META`).
    for (const id of this.lineage(memoryId)) {
      for (const e of this.plainRows(id)) {
        if (e.dedup_key === `${PROSPECTIVE_PLAIN_EVENT}:${id}:${windowKey}:${beat}`) return true;
      }
    }
    return false;
  }

  /** Was this memory — or one its reminder moved from — told plainly on the calendar day `at`? */
  private plainToldOn(memoryId: string, at: string): boolean {
    for (const id of this.lineage(memoryId)) {
      for (const e of this.plainRows(id)) {
        try {
          if ((JSON.parse(e.payload ?? "{}") as { date?: unknown }).date === at) return true;
        } catch {
          /* an unreadable row answers nothing */
        }
      }
    }
    return false;
  }

  /**
   * The memory, then each one its reminder moved from, newest first — read off
   * `meta.reminderFrom`, bounded, cycle-safe. A row that is gone or whose meta
   * will not parse ends the walk: losing it costs at most one extra mention
   * (§12 G12), never a memory.
   */
  private lineage(memoryId: string): string[] {
    const out = [memoryId];
    let current = memoryId;
    for (let hop = 0; hop < DATE_LINEAGE_MAX; hop++) {
      const raw = this.store.row(current)?.meta;
      if (raw === undefined) break;
      let from: unknown;
      try {
        from = (JSON.parse(raw) as Record<string, unknown>)[DATE_FROM_META];
      } catch {
        break;
      }
      if (typeof from !== "string" || out.includes(from)) break;
      out.push(from);
      current = from;
    }
    return out;
  }

  /**
   * The firing-state rows the brakes read: this memory's own, and — for a
   * window it has no row for yet — the row of the nearest memory its reminder
   * moved from, for the SAME window key. So a moved reminder keeps its spent
   * budget, its last-fired day and a referenced stop; a rescheduled one (a new
   * date, so a new key) starts fresh, exactly as `reschedule` does (§12 G9).
   * The first fire writes the successor's own row from there.
   */
  private firingRowsFor(memoryId: string): Map<string, ProspectiveRow> {
    const out = this.rowsFor(memoryId);
    for (const id of this.lineage(memoryId).slice(1)) {
      for (const [key, row] of this.rowsFor(id)) if (!out.has(key)) out.set(key, row);
    }
    return out;
  }

  /** A memory's plain rows, newest first. At most two beats per window, so a
   *  small bound is every row a live memory will ever have. */
  private plainRows(memoryId: string): { dedup_key: string | null; payload: string | null }[] {
    return this.store.eventLog({ name: PROSPECTIVE_PLAIN_EVENT, ref: memoryId, order: "desc", limit: 50 });
  }

  // ── firing-state transitions (all refuse under observer) ──────────────────

  /**
   * Record a derived window as armed. Optional: `fire()` arms lazily, because
   * losing firing state costs one extra polite mention and never a memory
   * (§12 G12). It exists so `armed` is a real state a caller can assert on.
   *
   * It NEVER resurrects a terminal window: arming a spent key keeps the spent
   * state. The firing key is the window, so a clock repair — or a caller replaying
   * an old arm — cannot re-arm what is already done (§12 G9).
   */
  arm(memoryId: string, windowKey: string): TransitionOutcome {
    return this.write("arm", memoryId, windowKey, (parsed, row) => ({
      state: windowStateOf(row),
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision,
    }));
  }

  /**
   * Spend one ambient fire on one window, on one lived day.
   *
   * Eligibility is RE-DERIVED here, from the memory, every time — a row is never
   * permission. So a memory that was archived, faded below the floor, or
   * rescheduled since the row was written cannot fire, and the refusal says
   * which (§12 G2).
   *
   * A fire is a SURFACING THAT HAPPENED, not an offer that was made: the caller
   * records it after `recall/`'s gate admitted the memory. That split is the
   * whole of "arrival is a cue, not a command" — nothing in this module can
   * cause the surfacing whose budget it counts.
   */
  fire(input: FireInput): FireOutcome {
    const day = input.day ?? this.store.livedDay();
    if (this.observer) {
      // Checked FIRST, before any read or write: an evaluation must not consume
      // the real store's fire budget (scar E7, contract §5 G9).
      this.emit("prospective.observer.standdown", input.memoryId, {
        site: "fire",
        window: input.windowKey,
      });
      return { fired: false, reason: "observer", derivation: null, fires: 0, state: "armed" };
    }

    const loaded = this.load(input.memoryId, input.dates ?? [], day);
    if (loaded === null) {
      return { fired: false, reason: "unknown-memory", derivation: null, fires: 0, state: "armed" };
    }
    const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
    if (!p.eligible) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: "not-eligible",
        derivation: p.reason,
        day,
      });
      this.noteRefusal(input.memoryId, input.windowKey, "not-eligible", day, p.reason);
      return { fired: false, reason: "not-eligible", derivation: p.reason, fires: 0, state: "armed" };
    }
    const w = p.windows.find((x) => x.key === input.windowKey);
    const rows = this.firingRowsFor(input.memoryId);
    const row = rows.get(input.windowKey);
    if (w === undefined) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: "window-not-derived",
        day,
      });
      this.noteRefusal(input.memoryId, input.windowKey, "window-not-derived", day, null);
      return {
        fired: false,
        reason: "window-not-derived",
        derivation: null,
        fires: row?.fires ?? 0,
        state: windowStateOf(row),
      };
    }

    const brake = this.brakeFor(w, row, {
      at: input.at,
      day,
      refractory: input.refractory === true,
      sessionId: input.sessionId,
    });
    if (brake !== null) {
      this.emit("prospective.fire.refused", input.memoryId, {
        window: input.windowKey,
        reason: brake,
        day,
      });
      this.noteRefusal(input.memoryId, input.windowKey, brake, day, null);
      return {
        fired: false,
        reason: brake,
        derivation: null,
        fires: row?.fires ?? 0,
        state: windowStateOf(row),
      };
    }

    const fires = (row?.fires ?? 0) + 1;
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: input.windowKey,
      eventDate: w.eventDate,
      precision: w.precision,
      state: "fired",
      fires,
      lastFiredDay: day,
    });
    if (input.sessionId !== undefined) this.markSession(input.sessionId, input.windowKey);
    this.emit("prospective.fired", input.memoryId, {
      window: input.windowKey,
      precision: w.precision,
      fires,
      cap: this.tunables.FIRES_PER_WINDOW,
      ramp: rampAt(w, input.at, this.tunables),
      day,
    });
    this.note(PROSPECTIVE_FIRE_EVENT, input.memoryId, day, {
      window: input.windowKey,
      precision: w.precision,
      fires,
      cap: this.tunables.FIRES_PER_WINDOW,
      // Plain or quiet, so the gauge can count the two apart (2026-09-26).
      mode: cueModeOf(loaded.doc),
      // The calendar day the fire was ABOUT, as the plain row carries it: the
      // fired view dates a row by this field before the wall clock, so a fire
      // near midnight or far from UTC is counted on the day it was asked
      // (2026-09-26 review — the gauge test failed in Pacific/Auckland).
      date: input.at,
      // The session whose turn it came back in, when known (2026-10-11).
      ...(isKnownSession(input.sessionId) ? { session: input.sessionId } : {}),
    });
    return { fired: true, reason: "fired", derivation: null, fires, state: "fired" };
  }

  /**
   * One durable refusal row, latched per memory, window, reason and lived day.
   *
   * Eligibility is re-derived on every turn (§12 G2), so an unlatched row here
   * would write once per turn forever for a window whose date has passed. The
   * latch makes it "this window was stopped by this, on this day", which is the
   * fact the fired view needs and the smallest one that answers it.
   */
  private noteRefusal(
    memoryId: string,
    windowKey: string,
    reason: string,
    day: number,
    derivation: DeriveReason | null,
  ): void {
    this.note(
      PROSPECTIVE_REFUSED_EVENT,
      memoryId,
      day,
      { window: windowKey, reason, derivation },
      `${PROSPECTIVE_REFUSED_EVENT}:${memoryId}:${windowKey}:${reason}:${String(day)}`,
    );
  }

  /**
   * The module's one durable seam. Observer is checked by the caller before any
   * read (§5 G9), and a telemetry write may never be what stalls a host-facing
   * path (§12 G12) — so this swallows, and the ring emit beside it stands.
   */
  private note(
    name: string,
    memoryId: string,
    day: number,
    payload: Record<string, unknown>,
    dedupKey?: string,
  ): void {
    if (this.observer) return;
    try {
      this.store.appendEvent({
        name,
        day,
        ref: memoryId,
        payload,
        ...(dedupKey === undefined ? {} : { dedupKey }),
      });
    } catch {
      /* a lost row costs a line on a diagnostic, never a memory */
    }
  }

  /**
   * Brake 4, and the decisive one: the assistant was observed to have USED the
   * memory, so this window is done — zero further fires, whatever budget was
   * left. *Remembering completes by being lived, not by acknowledgment UI.*
   * Idempotent, and it does not care whether a fire ever happened: the user may
   * have raised the occasion themselves. Its live caller is `actedOn`.
   */
  reference(memoryId: string, windowKey: string, day?: number): TransitionOutcome {
    const d = day ?? this.store.livedDay();
    return this.write("reference", memoryId, windowKey, (parsed, row) => ({
      state: "suppressed",
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision,
      extra: { day: d },
    }));
  }

  /**
   * THE SESSION SAID IT ACTED ON THIS MEMORY (2026-10-11, review 07 C3; wired
   * by the group-5 builder, lightly held): it named the memory in `drewOn`
   * (`Counterpart#creditDrewOn`), which credits half a use and stops nothing
   * — so without this a reminder already dealt with still came back as a
   * footnote until its fire budget ran out. Every window of the memory OPEN
   * on `at` is referenced (`reference`), so it fires no more this window; a
   * repeat's other occurrences are untouched, and a window not yet open owes
   * this nothing.
   *
   * A PLAIN item keeps its day: until its last beat is told (`toldForGood`)
   * its window is left alone, because the person asked to be told on the day
   * and a session that drew on it the day before has not told them. The
   * plain line never reads this state anyway; leaving the window open keeps
   * the item first under "Arriving:" on its day too. Returns the keys it
   * referenced. Observer: none.
   */
  actedOn(memoryId: string, at: string, day?: number): string[] {
    if (this.observer || !isDay(at)) return [];
    const d = day ?? this.store.livedDay();
    const loaded = this.load(memoryId, [], d);
    if (loaded === null) return [];
    const p = derive(loaded.memory, loaded.dates, at, this.tunables);
    if (!p.eligible) return [];
    const mode = cueModeOf(loaded.doc);
    const out: string[] = [];
    for (const w of p.windows) {
      if (phaseOf(w, at) !== "arrived") continue;
      if (mode === "plain" && !this.plainTold(memoryId, w.key, w.precision === "day" ? "day" : "last-day")) continue;
      if (this.reference(memoryId, w.key, d).recorded) out.push(w.key);
    }
    return out;
  }

  /**
   * Retire a window terminally. The row is KEPT in state `expired` — this module
   * destroys nothing, and the exit accounting needs it (§5 G12).
   */
  expire(memoryId: string, windowKey: string, reason = "window-closed"): TransitionOutcome {
    return this.write("expire", memoryId, windowKey, (parsed, row) => ({
      state: "expired",
      fires: row?.fires ?? 0,
      lastFiredDay: row?.last_fired_day ?? null,
      eventDate: parsed.eventDate,
      precision: parsed.precision,
      extra: { why: reason },
    }));
  }

  /**
   * A rescheduled plan, corrected through a GATED COMPARE-AND-SWAP (§12 G8): the
   * proposal names the exact current value, so a stale proposal cannot clobber a
   * fresher date. The old window is retired (kept, state `expired`) and a fresh
   * key is armed — and because **the firing key is the window**, the new window
   * owes nothing to the old one's spent budget (§12 G9).
   *
   * This half is the FIRING state only. Rewriting the memory's own stated date is
   * the caller's `store.revise` — see INTERFACE-GAPS #4.
   */
  reschedule(input: RescheduleInput): RescheduleOutcome {
    if (this.observer) {
      this.emit("prospective.observer.standdown", input.memoryId, { site: "reschedule" });
      return { rescheduled: false, reason: "observer", retiredKey: null, armedKey: null };
    }
    const loaded = this.load(input.memoryId, input.dates ?? [], this.store.livedDay());
    if (loaded === null) {
      return { rescheduled: false, reason: "unknown-memory", retiredKey: null, armedKey: null };
    }
    const nextPrecision = precisionOf(input.nextDate);
    const nextWindow =
      nextPrecision === null
        ? null
        : windowFor(input.nextDate, nextPrecision, this.tunables, input.memoryId);
    if (nextWindow === null) {
      this.emit("prospective.reschedule.refused", input.memoryId, { reason: "malformed-date" });
      return { rescheduled: false, reason: "malformed-date", retiredKey: null, armedKey: null };
    }
    if (input.expectCurrentDate === input.nextDate) {
      this.emit("prospective.reschedule.refused", input.memoryId, { reason: "unchanged" });
      return { rescheduled: false, reason: "unchanged", retiredKey: null, armedKey: null };
    }

    const p = derive(loaded.memory, loaded.dates, input.at, this.tunables);
    const current = p.windows.find((w) => w.eventDate === input.expectCurrentDate);
    if (current === undefined) {
      // The compare half failing IS the guarantee working.
      this.emit("prospective.reschedule.refused", input.memoryId, {
        reason: "stale-proposal",
        expected: input.expectCurrentDate,
      });
      return { rescheduled: false, reason: "stale-proposal", retiredKey: null, armedKey: null };
    }

    const rows = this.rowsFor(input.memoryId);
    const old = rows.get(current.key);
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: current.key,
      eventDate: current.eventDate,
      precision: current.precision,
      state: "expired",
      fires: old?.fires ?? 0,
      lastFiredDay: old?.last_fired_day ?? null,
    });
    this.store.setProspective({
      memoryId: input.memoryId,
      windowKey: nextWindow.key,
      eventDate: nextWindow.eventDate,
      precision: nextWindow.precision,
      state: "armed",
      fires: 0,
      lastFiredDay: null,
    });
    this.emit("prospective.rescheduled", input.memoryId, {
      from: current.key,
      to: nextWindow.key,
      spentFiresRetired: old?.fires ?? 0,
      why: input.reason ?? "reschedule",
    });
    return {
      rescheduled: true,
      reason: "rescheduled",
      retiredKey: current.key,
      armedKey: nextWindow.key,
    };
  }

  events(name?: string): ProspectiveEvent[] {
    return this.ring.filter((e) => name === undefined || e.name === name).map((e) => ({ ...e }));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * The four once-ness brakes plus crisis deference plus the window itself, in
   * ONE place, so the read path and the write path can never disagree about what
   * a spent window is. Order is deliberate: crisis deference outranks everything
   * (§12 G7), and referenced-stop outranks the counting brakes (§12 G6).
   */
  private brakeFor(
    w: Window,
    row: ProspectiveRow | undefined,
    ctx: { at: string; day: number; refractory: boolean; sessionId?: string | undefined },
  ): SuppressReason | null {
    if (ctx.refractory) return "refractory";
    const phase = phaseOf(w, ctx.at);
    if (phase === "pending") return "window-not-open";
    if (phase === "passed") return "stale-window";
    if (row !== undefined) {
      const state = windowStateOf(row);
      if (state === "suppressed") return "already-referenced";
      if (state === "expired") return "stale-window";
      if (row.fires >= this.tunables.FIRES_PER_WINDOW) return "over-fired";
      if (row.last_fired_day !== null && row.last_fired_day === ctx.day) {
        return "already-fired-today";
      }
      // Tune question (b): the last fire of a month or range waits for after
      // the span it names. Without it, a month item spent its whole budget in
      // its first days and never knew when "after" was.
      if (
        this.tunables.HOLD_LAST_FIRE_FOR_AFTER &&
        w.precision !== "day" &&
        this.tunables.FIRES_PER_WINDOW >= 2 &&
        row.fires >= this.tunables.FIRES_PER_WINDOW - 1 &&
        ctx.at <= w.lastDay
      ) {
        return "held-for-after";
      }
    }
    if (ctx.sessionId !== undefined && this.sessionFired.get(ctx.sessionId)?.has(w.key) === true) {
      return "session-dedup";
    }
    return null;
  }

  /** `day` is the LIVED day the caller is asking about, never a clock read: the
   *  strength on the row is only as-of whatever day was asked (NOTES.md §2). */
  private load(memoryId: string, extra: readonly ExtractedDate[], day: number): Loaded | null {
    const row = this.store.row(memoryId);
    if (row === undefined) return null;
    let read;
    try {
      read = this.store.read(memoryId);
    } catch {
      // A removed memory is not an error here; it simply has no future.
      return null;
    }
    const explicit = contentDates(read.doc);
    const dates = [...explicit, ...extra];
    const seen = new Set<string>();
    const s = strength(read.physics, day);
    return {
      memory: {
        id: memoryId,
        kind: read.physics.kind as Kind,
        salience: read.physics.salience,
        archived: read.archived,
        learnedOn: read.doc.learnedOn === "" ? null : read.doc.learnedOn,
        // The same field `sleep/types.ts#isJournal` reads off the row, taken
        // from the doc already in hand. See `DerivableMemory.journal`.
        journal: read.doc.type === "episode",
        // The owner's rule (2026-09-26): an author-written date is its own
        // importance signal, so it skips the salience floor — never decay.
        explicitDate: explicit.length > 0,
        // NOT BEFORE ITS WINDOW (2026-10-10, Group 1, review 03 C4c / 07 C1):
        // a memory whose date is still ahead is HELD by decay (physics
        // `DatedHold`, t = 0), so it cannot fade on the way; and `faded` no
        // longer refuses a pending one even when its height alone sits at the
        // floor — a reminder set a month out is asked for, not decayed. G10
        // ("no decay exemption before arrival") is reversed; on the rules audit.
        faded: s <= this.tunables.FADED_STRENGTH && read.physics.hold?.state !== "pending",
        // A live repeat is exempt from `faded` (review of #341, `derive.ts`).
        recurring: recurrenceOf(read.doc) !== null,
      },
      doc: read.doc,
      dates: dates.filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true))),
      strength: s,
    };
  }

  private rowsFor(memoryId: string): Map<string, ProspectiveRow> {
    const out = new Map<string, ProspectiveRow>();
    for (const r of this.store.prospectiveFor(memoryId)) out.set(r.window_key, r);
    return out;
  }

  private markSession(sessionId: string, key: string): void {
    let set = this.sessionFired.get(sessionId);
    if (set === undefined) {
      set = new Set<string>();
      this.sessionFired.set(sessionId, set);
    }
    if (set.size >= this.tunables.MAX_SESSION_WINDOWS) {
      const oldest = set.values().next();
      if (!oldest.done) set.delete(oldest.value);
    }
    set.add(key);
  }

  /** The one shape every non-fire transition shares: observer first, then write. */
  private write(
    site: string,
    memoryId: string,
    windowKey: string,
    next: (
      parsed: { eventDate: string; precision: WindowPrecision },
      row: ProspectiveRow | undefined,
    ) => {
      state: WindowState;
      fires: number;
      lastFiredDay: number | null;
      eventDate: string;
      precision: DatePrecision;
      extra?: Record<string, string | number | boolean | null>;
    },
  ): TransitionOutcome {
    if (this.observer) {
      this.emit("prospective.observer.standdown", memoryId, { site, window: windowKey });
      return { recorded: false, reason: "observer", state: "armed" };
    }
    const parsed = parseWindowKey(windowKey);
    if (parsed === null) {
      this.emit(`prospective.${site}.refused`, memoryId, {
        window: windowKey,
        reason: "malformed-window-key",
      });
      return { recorded: false, reason: "malformed-window-key", state: "armed" };
    }
    if (!this.store.has(memoryId)) {
      this.emit(`prospective.${site}.refused`, memoryId, {
        window: windowKey,
        reason: "unknown-memory",
      });
      return { recorded: false, reason: "unknown-memory", state: "armed" };
    }
    const row = this.rowsFor(memoryId).get(windowKey);
    const v = next(parsed, row);
    this.store.setProspective({
      memoryId,
      windowKey,
      eventDate: v.eventDate,
      precision: v.precision,
      state: v.state,
      fires: v.fires,
      lastFiredDay: v.lastFiredDay,
    });
    this.emit(`prospective.${site === "arm" ? "armed" : site === "reference" ? "referenced" : "expired"}`, memoryId, {
      window: windowKey,
      state: v.state,
      fires: v.fires,
      ...(v.extra ?? {}),
    });
    return { recorded: true, reason: "recorded", state: v.state };
  }

  private emit(
    name: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const e: ProspectiveEvent = { at: this.now(), name };
    if (ref !== undefined) e.ref = ref;
    if (data !== undefined) e.data = data;
    this.ring.push(e);
    if (this.ring.length > 500) this.ring.shift();
    this.onEvent?.(e);
  }
}

export type { DerivableMemory, DeriveReason, ExtractedDate, Prospectivity };
export type { DatePrecision, Phase, Window, WindowPrecision };
export type { UseTier };
