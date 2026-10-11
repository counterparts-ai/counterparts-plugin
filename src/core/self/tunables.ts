/**
 * Every `self/` knob, in one visible place — the shape `physics/` and `recall/`
 * use, for the same reason: a threshold hiding in a function body cannot be
 * audited.
 *
 * **CAL = calibration-required** (scar §2.8). Values marked CAL are v1's live
 * calibration, inherited as the best surviving record of what real use moved.
 * They are a starting point, not a v2 measurement; `tools/replay` re-earns them.
 *
 * **The total wake budget is deliberately NOT here.** v1's 9,000 bytes was 90% of
 * one host's injection cliff; in v2 the ceiling is a host capability the caller
 * reports (contract §4, scar §2.18). `BriefingRequest.budgetBytes` is required at
 * the call, and there is no constant anywhere in this module to fall back to.
 * (`briefing.ts#PAGE_HOST_BUDGET_BYTES` sizes the page's room, the target its
 * writer is told; nothing composes against it.)
 *
 * Structural (never tunable, never ablatable): the composed budget, the
 * header/sentinel pair, the trim order existing and being declared, the freeze
 * itself, the observer refusal, pre-render-not-render-on-wake.
 */

import { PAGE_ROOM_BYTES } from "./briefing.js";

export interface SelfTunables {
  // ── briefing lanes ────────────────────────────────────────────────────────
  /** Most identity elements considered for the briefing. The BUDGET is the real
   *  bound; this only stops a pathological store from composing a megabyte to
   *  throw it away. CAL. [v1 self-index: 16 elements] */
  IDENTITY_MAX: number;
  /** The largest fraction of the COMPOSED BUDGET the identity lane may take
   *  **while the other lanes have content to spend the rest on**. Not a lane
   *  budget (contract §5 G2 — the total still governs): it is how the total is
   *  SPLIT when lanes compete, applied by whole elements and released back to
   *  identity when nothing else can use the room. CAL.
   *
   *  Measured 2026-09-03/04 on the live host: a migrated store's identity
   *  elements run ~1.1 KB each, identity trims LAST, so the wake delivered to
   *  every session was 8 identity elements filling all 9,000 bytes — craft 0,
   *  threads 0, hints 0, horizon 0 — while v1's wake the same day carried 20
   *  elements across four lanes. 0.5 leaves ~4.5 KB for the other four lanes at
   *  that ceiling, which is v1's whole non-identity wake, and still gives
   *  identity four of the long migrated elements (or ~20 v2-native ones). */
  IDENTITY_SHARE: number;
  /** Most craft (skill-kind) elements considered. CAL. Read only while
   *  `CRAFT_AT_DELIVERY` is off. */
  CRAFT_MAX: number;
  /**
   * CRAFT IS THIS DIRECTORY'S WORK, COMPOSED AT DELIVERY (2026-10-01, lane 8,
   * a working default held lightly). On: a work memory (`work.ts#isWorkMemory`)
   * is in no lane of the stored bundle, and the session's directory gets its
   * own "Work here" lines at delivery (`work.ts#workHere`). Off: craft is
   * skill-kind above the warm floor, store-wide, as before.
   */
  CRAFT_AT_DELIVERY: boolean;
  /** How many work lines one delivery shows for its directory. CAL. */
  WORK_HERE_MAX: number;
  /** How many work lines are ranked for the rotation to choose `WORK_HERE_MAX`
   *  from (`work.ts#rotateWork`, 2026-10-02). Each costs
   *  `WORK_HERE_READ_PER_LINE` prose reads per delivery. CAL. */
  WORK_HERE_POOL: number;
  /** Characters of a work line's excerpt, after its title. CAL. */
  WORK_HERE_EXCERPT: number;
  /** Most open threads considered. CAL. [v1 threads lane: count-capped at 12;
   *  5 since 2026-10-01, when a session could first set the flag — kept small] */
  THREADS_MAX: number;
  /** Most warm-shelf hints considered. CAL. */
  HINTS_MAX: number;
  /** Most arriving occasions considered. CAL. */
  HORIZON_MAX: number;
  /** A non-identity element must reach this decayed strength to be craft or a
   *  hint. Identity elements are constitutive and face no floor (contract §3:
   *  "identity is re-inhabited, not retrieved"). CAL. */
  WARM_FLOOR: number;

  // ── the hints ("Nearby") lane's rotation (2026-09-26, harvested from #238) ─
  /**
   * What one published showing in the hints lane adds to a memory's
   * habituation load — the SAME whether or not it was used while shown (#238's
   * review: a half step for "used on display" barely habituated, and a use the
   * display may have prompted is not evidence the hint was wanted). CAL.
   */
  HINT_STEP: number;
  /** Lived days for the load to fall to 1/e once it stops being shown. CAL. */
  HINT_RECOVERY_DAYS: number;
  /** The pull a load leaves: `1 / (1 + HINT_HABITUATION x load)`. CAL. */
  HINT_HABITUATION: number;

  // ── the self page (plan 2026-09-18, S1) ───────────────────────────────────
  /**
   * THE WRITE CEILING, in BYTES (UTF-8): a sanity bound, not the page's room.
   * A revision larger than this is refused with a durable row rather than cut,
   * because the thing that gets cut at write time is the only copy.
   *
   * 16,384 — as it was until 2026-10-09, when #358 lowered it to the room the
   * wake guarantees (6,078) as a stopgap and the writer kept missing it by a
   * few hundred bytes. Since 2026-10-10 the room is a TARGET
   * (`PAGE_ROOM_BYTES`) and a page past it is kept whole: the wake steps down
   * a ladder of whole texts instead (`briefing.ts#PageRung`).
   */
  PAGE_MAX_BYTES: number;
  /**
   * THE PAGE'S ROOM, in BYTES (UTF-8), the target its writer is told: "aim
   * under N; past it, sessions read a short version instead". Defaults to
   * `briefing.ts#PAGE_ROOM_BYTES`, the page the wake prints whole — top and
   * end lines included — at the 9,000-byte ceiling under the widest delivery
   * reserves. A page past it is kept; a short version is kept with it only
   * then, and only within this same number. Overridden only by tests; a value
   * above the default gives up the guarantee that a page within it prints
   * whole on every day.
   */
  PAGE_ROOM_BYTES: number;
  /** Calendar days after which the wake says the page has not been revised.
   *  CALENDAR, not lived: the lived clock has run seven days across fifteen
   *  calendar ones on the owner's own store, so a lived window would report a
   *  fortnight of silence as three days (`adapters/fired.ts`, same reasoning). */
  PAGE_STALE_DAYS: number;
  /**
   * WHAT "WHO I AM" SHOWS WHILE NO PAGE HAS BEEN WRITTEN — the owner's choice,
   * and he has not made it yet, so it is one switch with two values.
   *
   * `true` (the default): the rotating identity list still renders, exactly as
   * it does today, until a page exists. Deploying the page therefore changes
   * nothing in the owner's wake until he or a session writes one, and on a
   * brand-new store the list is empty anyway, so a new user meets the day-0 line
   * either way.
   *
   * `false`: the list is gone the moment this ships, and "Who I am" says the
   * page is still forming until one is written.
   *
   * A page that EXISTS replaces the list under both values (spec §15 item 4).
   */
  PAGE_EMPTY_SHOWS_LIST: boolean;
  /**
   * DOES THE PAGE LEAVE THE MACHINE with a composition that filters?
   *
   * `true` (the default): the crash-fallback interpreter is woken WITH the page.
   * That is the owner's own decision of 2026-09-17 (spec §15 item 3) — the
   * background writer gets as much of the self as is reasonable before it reads
   * a transcript, so what it writes is not a stranger's paraphrase — and the
   * transcript it is being handed already goes to the same provider on the same
   * call. What goes out is exactly the page: the owner's and the session's own
   * standing account of the self, whole, by the same rule the wake uses.
   *
   * `false`: a filtering composition gets NO page, and its "Who I am" falls back
   * to the identity list the `omit` predicate left standing — which is what that
   * composition carried before the page existed.
   *
   * It is a switch and not an inference because the page is born `protected`,
   * and `sweepFallback`'s own predicate holds protected rows back. The flag is
   * the PRUNE's vocabulary (see `page.ts`), so it does not decide this by
   * itself — but it is close enough to the question that the answer has to be
   * written down rather than read off a flag that means something else.
   */
  PAGE_ON_EGRESS: boolean;

  // ── the nightly page writer (S2, `self/writer.ts`) ────────────────────────
  /**
   * How much of the day's memories the writer is handed, in bytes. The writer
   * reads one day, not a life, and the page it produces is capped at
   * `PAGE_MAX_BYTES` — handing it more than it can use costs tokens and buys
   * nothing. The cut is by salience, from the end, and what did not fit is
   * COUNTED on the run's row, so a page written from half a day says so. CAL.
   */
  PAGE_WRITER_MEMORY_BYTES: number;
  /** ...and a ceiling on the COUNT, so one day of very short memories cannot
   *  become a hundred bullets. CAL. */
  PAGE_WRITER_MEMORY_MAX: number;
  /**
   * How many SESSIONS may be asked to do one day's writing, in session mode.
   *
   * Not a pacer — the scar this package carries about pacers is about the
   * BLOCKED MOMENT at Stop, where one ask on one conjunction is the rule
   * (CONTRACT §3). This ask rides beside the wake at SessionStart, the way the
   * first-launch scope question does, and its cadence is the day boundary
   * itself. The count exists because the first session of a morning may be deep
   * in something else and never get to it; two is enough to make that survivable
   * and small enough that a page nobody wants is not asked for all day. CAL.
   */
  PAGE_WRITER_ASKS_PER_DAY: number;

  // ── budget telemetry ──────────────────────────────────────────────────────
  /** Fraction of the budget at which the render reports pressure. A budget gets
   *  an event when APPROACHED and one when crossed (scar §2.4). [v1: 0.9] */
  BUDGET_PRESSURE: number;

  // ── the standing self-schema counter (contract §5 G4) ─────────────────────
  /** Total bytes of self-kind + identity-band prose at which the counter trips.
   *  v1 measured ~72 KB of accumulated `currentState` before anyone noticed
   *  (earned-mechanism #5); the tripwire exists so the next time is measured. CAL. */
  SCHEMA_BYTES_TRIP: number;
  /** Fraction of the trip point that reports pressure. */
  SCHEMA_BYTES_PRESSURE: number;

  // ── episodes (behavioral-spec §13, all TUNABLE by name) ───────────────────
  /** The first ask is due at this many turns the PERSON typed... CAL. */
  FIRST_ASK_TURNS: number;
  /** ...or at this many bytes of conversation text from both roles, whichever
   *  comes first — so a one-prompt agentic session still journals (§13 G1). CAL. */
  FIRST_ASK_TEXT_BYTES: number;
  /** A later ask is due at this many typed turns since the last one... CAL. */
  REASK_TURNS: number;
  /** ...or at this many bytes of conversation text since it, whichever comes
   *  first. CAL. */
  REASK_TEXT_BYTES: number;
  /**
   * Asks ONE SESSION may raise ON ONE CALENDAR DAY — a backstop on the count;
   * the re-ask pair sets the cadence. Per session per calendar day, so no other
   * session can spend it and a session that spans days gets it back (the
   * history is in self NOTES, "The cap moved off the lived day"). CAL.
   */
  MAX_ASKS_PER_SESSION: number;
  /** Lived days an episode may be re-ingested after its first ingest. The window
   *  CLOSES — a deliberate deviation from human reconsolidation (§13 G12). CAL. */
  REGROW_WINDOW_DAYS: number;
}

export const SELF_TUNABLES: SelfTunables = {
  IDENTITY_MAX: 24,
  IDENTITY_SHARE: 0.5,
  CRAFT_MAX: 8,
  CRAFT_AT_DELIVERY: true,
  WORK_HERE_MAX: 4,
  WORK_HERE_POOL: 8,
  WORK_HERE_EXCERPT: 60,
  THREADS_MAX: 5,
  HINTS_MAX: 8,
  HORIZON_MAX: 6,
  WARM_FLOOR: 0.35,

  HINT_STEP: 1,
  HINT_RECOVERY_DAYS: 3,
  HINT_HABITUATION: 1,

  PAGE_MAX_BYTES: 16_384,
  PAGE_ROOM_BYTES,
  PAGE_STALE_DAYS: 14,
  PAGE_EMPTY_SHOWS_LIST: true,
  PAGE_ON_EGRESS: true,

  PAGE_WRITER_MEMORY_BYTES: 8_192,
  PAGE_WRITER_MEMORY_MAX: 40,
  PAGE_WRITER_ASKS_PER_DAY: 2,

  BUDGET_PRESSURE: 0.9,

  SCHEMA_BYTES_TRIP: 72_000,
  SCHEMA_BYTES_PRESSURE: 0.75,

  FIRST_ASK_TURNS: 6,
  // 24 KB, not 12 KB: a replay showed 12 KB still fired the first ask at typed turn 1–3 in ~40% of sessions.
  FIRST_ASK_TEXT_BYTES: 24_000,
  REASK_TURNS: 8,
  // 24 KB, not 8 KB: under the OR a long reply alone should not re-ask.
  REASK_TEXT_BYTES: 24_000,
  // 12, not 6: typed-turn pacing spaces asks further apart, so the backstop can be looser.
  MAX_ASKS_PER_SESSION: 12,
  REGROW_WINDOW_DAYS: 3,
};

export function withTunables(overrides: Partial<SelfTunables>): SelfTunables {
  return { ...SELF_TUNABLES, ...overrides };
}
