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
   *  identity four of the long migrated elements (or ~20 v2-native ones).
   *
   *  For now, the identity list and this share apply only while no self page
   *  exists: with a page, the page replaces the list. */
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
  /**
   * THE "HOW I WORK:" LIST IN THE WAKE (2026-10-16, the wake trims; Mike,
   * lightly held, review 2026-10-18). Off: a craft memory — skill-kind,
   * above the warm floor, not this directory's work — is in no lane of the
   * wake, listed or counted; the page's own "## How I work" says the
   * lessons, and a craft memory still comes up when a turn reaches it, as a
   * per-turn footnote ("Quietly available"), by the same gate as any other
   * kind (`recall/`). On: the lane as before (`CRAFT_MAX`).
   */
  CRAFT_IN_WAKE: boolean;
  /** How many work lines one delivery shows for its directory. CAL. */
  WORK_HERE_MAX: number;
  /** How many work lines are ranked for the rotation to choose `WORK_HERE_MAX`
   *  from (`work.ts#rotateWork`, 2026-10-02). Each costs
   *  `WORK_HERE_READ_PER_LINE` prose reads per delivery. CAL. */
  WORK_HERE_POOL: number;
  /** Characters of a work line's excerpt, after its title. CAL. */
  WORK_HERE_EXCERPT: number;
  /**
   * WORK STAYS IN ITS PROJECT, CRAFT TRAVELS (2026-10-21, wave 2 lane G,
   * design §8; on, lightly held). On: "Work here" and the elsewhere lines
   * read a folder's PROJECT (`folder_projects`; by default the folder alone),
   * and a skill nobody marked `work` is craft, not work — it may be a work
   * line in any folder (`WORK_HERE_CRAFT_MAX`) — `work.ts`. Off: a folder is
   * its own project and an unmarked skill is work where it was written.
   * Read from the copy `withTunables` makes when `Self` opens, after the
   * harness applies its settings, so `harness compare --set
   * self.PROJECTS_TRAVEL=false` sets it.
   */
  PROJECTS_TRAVEL: boolean;
  /** With `PROJECTS_TRAVEL`: how many places of the ranked work lines
   *  (`WORK_HERE_POOL`) are craft written outside the project, from a folder
   *  the host lets be named elsewhere — taking turns by lived day among the
   *  newest. 0: craft from elsewhere is in no wake. CAL. */
  WORK_HERE_CRAFT_MAX: number;
  /**
   * THE WAKE'S PROJECT LINE (wave 2 lane E, 2026-10-22; design §7, AN
   * EXPERIMENT — it has to earn its room; check 2026-10-29): in a folder whose
   * project (lane G) has beliefs, a short block of its strongest, each with
   * its strength word and support count. Composed at delivery, LAST — after
   * the handoff, "Last here" and the work lines, before the head's fields —
   * so it takes only the room everything else left, and it is the first thing
   * a wake past its room goes without (a ring event says so). Off: the wake
   * is byte for byte what it was. Read from the copy `withTunables` makes when
   * `Self` opens; `harness compare --set self.WAKE_PROJECT_LINE=false`.
   */
  WAKE_PROJECT_LINE: boolean;
  /** At most this many project beliefs on the line. Why 3: the design's "2–3 lines". CAL. */
  WAKE_PROJECT_LINE_MAX: number;
  /** The line's own byte budget, header included, under whatever room the
   *  wake has left. Why 480: three one-claim lines (recall's
   *  `BELIEF_LINE_BYTES` 200 clips each to fit) with their words and ids,
   *  about a tenth of a typical page. CAL. */
  WAKE_PROJECT_LINE_BYTES: number;
  /** A project belief shows only ABOVE this strength, as recall's slot
   *  (`BELIEFS_SLOT_FLOOR`). Why 0.3: born at 0.3, so only one life backed shows. CAL. */
  WAKE_PROJECT_LINE_FLOOR: number;
  /** Most open threads considered. CAL. [v1 threads lane: count-capped at 12;
   *  5 since 2026-10-01, when a session could first set the flag — kept small] */
  THREADS_MAX: number;
  /**
   * Of those, at most this many are core memories BEING RECONSIDERED
   * (2026-10-11, Group 3 part A), first; the rest are counted with "more
   * still open", so a night that flags several does not push the open
   * questions out. CAL.
   */
  RECONSIDERING_MAX: number;
  /**
   * "STILL OPEN" LEADS WITH WHAT IS LIVE (2026-10-18, the wake-polish
   * builder, lightly held): an open thread untouched — neither born nor used
   * — for this many lived days ranks after every one touched since, and the
   * lane's count line says how many of what it counts are that old ("41
   * untouched for 2+ weeks"). "Untouched" is read as #489 D's `staleOpen`
   * reads it (born or used), but the thresholds differ: the nightly
   * close-offer looks from `REFLECT_TUNABLES.STALE_OPEN_DAYS` (4) and offers
   * at most 5 a night, so it does not count what this counts. CAL.
   */
  STILL_OPEN_STALE_DAYS: number;
  /**
   * AN UNTOUCHED, OWNERLESS OPEN ITEM STOPS BEING CARRIED (2026-10-22, the
   * open-threads brief; Mike agreed the shape, the number is a starting
   * point, check 2026-11-05). An `unresolved` memory with no `eventDate`, not
   * `asked`, untouched — not born, used beyond a glimpse, or revised; a
   * footnote left unrated, a dream's or a reflection's return is not a touch
   * (`Store#openThreadTouches`) — for this
   * many lived days or more is not carried: it leaves "Still open" and its
   * count, and the reflection's `staleOpen`. It is NOT closed: the flag stays,
   * the memory stays in the store (in no lane of the wake), recall shows it, and any touch carries it
   * again (`identity.ts#openCarry`, the one place the rule lives). Revert:
   * very large (`Infinity` carries everything, as before). CAL.
   */
  OPEN_CARRY_DAYS: number;
  /**
   * DOES A GLIMPSE CARRY AN OPEN THREAD (2026-10-22, the coordinator's call
   * on the review of #592, lightly held, for Mike): false — an ambient
   * footnote left unrated (the store's glimpse, a use since 10-19 that
   * restarts the memory's fade) is NOT a touch for the carry, since "shown
   * again and again, never answered" is the loop the carry breaks. True is
   * the revert: every credited use carries it (`Store#openThreadTouches`).
   */
  OPEN_CARRY_GLIMPSE_TOUCH: boolean;
  /** Most warm-shelf hints considered. CAL. */
  HINTS_MAX: number;
  /** Most arriving occasions considered. CAL. */
  HORIZON_MAX: number;
  /**
   * "COMING UP" = TODAY (2026-10-16, the wake trims; Mike, lightly held,
   * review 2026-10-18). On: the lane lists what is due the day the wake is
   * for, and a plain reminder due the day it is read (whole, as before);
   * every other date — later, or past its date in its grace days (review of
   * #511) — is counted in the lane's one line with its recall ids ("(2
   * overdue, 4 more coming up; recall ids: …)", or "Coming up: 6 — none due
   * today, 2 overdue; …" when nothing is listed).
   * Those return on their own: a date cues recall around it, as a per-turn
   * footnote (`prospective.arrivals()` → recall's temporal cues), and a plain
   * reminder is said outright on its day (`Counterpart#plainDueToday`). Off:
   * the lane as before, its first `HORIZON_ITEMS` by date.
   */
  COMING_UP_TODAY_ONLY: boolean;
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
   * `briefing.ts#PAGE_ROOM_BYTES`: 4,600 since 2026-10-16 (the wake trims,
   * lightly held), under the page the wake prints whole — top and end lines
   * included — at the 9,000-byte ceiling under the widest delivery reserves
   * (`pageRoomBytes(9_000)`). A page past it is kept; a short version is kept
   * with it only then, and only within this same number. Overridden only by
   * tests; a value above `pageRoomBytes(9_000)` gives up the guarantee that a
   * page within it prints whole on every day.
   */
  PAGE_ROOM_BYTES: number;
  /**
   * THE NIGHTLY WRITERS ARE HELD TO THE ROOM (2026-10-20, Mike's go, lightly
   * held, an experiment). On: a page past `PAGE_ROOM_BYTES` from the nightly
   * page writer or the reflection (`by` `writer` / `reflection`) is refused
   * each door's first time in a night — "N bytes over; cut, don't add a short
   * version" — and that door's next send past it in the same session is
   * kept as before; a held page not sent again is kept at the
   * run's end (`Self#keepHeldPage`) — or, with no run end, at the worker's next
   * boundary once it has settled — so no night loses its rewrite to this. A
   * session's and the owner's pages are not held: the room stays their
   * target. Off: the room is every writer's target, as from 2026-10-10.
   */
  PAGE_HELD_TO_ROOM: boolean;
  /**
   * PAST THE ROOM, THE SHORT VERSION FIRST (2026-10-20, with the hold). On: the
   * wake skips the whole page's rung for a page past `PAGE_ROOM_BYTES` that
   * has a short version written with it, so the short version (within the
   * room) is what sessions read and the lanes beside it keep their room. A
   * page past it with no short version still prints whole when it fits, as
   * before. Off: the whole page whenever it fits (2026-10-10's ladder).
   */
  PAGE_SHORT_PAST_ROOM: boolean;
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
   * DAY'S END READS THE DAY AS TOLD (2026-10-23, lane D1; Mike's go, lightly
   * held). On: the nightly writer (called day's end since that day) is handed
   * every chapter of the day by its summary, a line each with its address
   * (recall opens one whole), and the day's `DAYS_END_MEMORIES` strongest
   * memories with their ids, so what it writes can cite them — the diary is
   * written from the day as it was told, not from a ranked list. Off: the
   * ranked list of the day's memories and the day's journal fitted as before,
   * exactly. Read at use.
   */
  DAYS_END_INPUT: boolean;
  /** With `DAYS_END_INPUT`: how many of the day's strongest memories day's end is handed, with their ids. CAL. */
  DAYS_END_MEMORIES: number;
  /**
   * THE DAY SUMMARY (2026-10-23, lane D2; Mike's go 15:32, lightly held).
   * Bedtime rehearsal shapes what sleep keeps: on, day's end also leaves a
   * few lines, first person — what the day was about and what is in motion —
   * with the memory ids they rest on, sent with its one closing `self_page`
   * call (with the page, or alone when the page stands). Stored on that
   * call's run row (`self.page.writer.ran`'s payload: no table, no
   * migration). The dream reads it first, as a header over its bundle, and
   * the reflection reads the last `dream.TIMELINE_DAYS` of them as a line a
   * day. Off: no summary is asked for or kept, and the dream's and the
   * reflection's bundles are exactly as before. Read at use.
   */
  DAY_SUMMARY: boolean;
  /** With `DAY_SUMMARY`: the most a day summary may be, in characters (code points: an emoji is one). Past it the call is refused with the numbers, never cut. CAL. */
  DAY_SUMMARY_CHARS: number;
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
  /**
   * "TODAY SO FAR" IN THE WAKE (2026-10-24, lane W1; Mike's go 17:45, lightly
   * held). On: a session start's wake carries one more line under the
   * Yesterday line — today's chapters written in this folder before the one
   * "Last here" names, each by time, title, id and the start of its
   * session-written summary (`handoff/last-here.ts#todaySoFarLine`). Other
   * folders stay with "Today, elsewhere". It gives way before the Yesterday
   * line (`ROOM_ORDER`'s `todaySoFar`). Off: no line, the wake exactly as
   * before. Read at use.
   */
  TODAY_SO_FAR: boolean;
  /**
   * YESTERDAY READS DAY'S END'S SUMMARY (2026-10-24, lane W1; Mike's go
   * 17:45, lightly held). On: at a session start, when day's end left a
   * summary about yesterday (`writer.ts#daySummaries`) and the privacy gate
   * lets it through (`Counterpart#daySummaryShown`: every memory it cites
   * nameable in this wake, and every chapter and memory of that day from this
   * folder or one whose scope setting is on), the Yesterday line leads with it and
   * lists the chapters after it, fewer as room asks. Otherwise, and off, the
   * chapter list exactly as before. Read at use.
   */
  YESTERDAY_FROM_SUMMARY: boolean;

  // ── list items as a line (#489 C, 2026-10-16) ───────────────────────────
  /**
   * A list item ("How I work", "Still open", "Might be relevant", "Coming
   * up") whose first paragraph is longer than this many bytes prints as a
   * line — `date · title [id]` — and recall reads it whole. Shorter items,
   * a plain reminder due the day the wake is read, and the identity list stay
   * whole. Measured 2026-10-15 on a copy of the live store: items ran 350–1,100
   * bytes and only 3–4 fit beside the page; titles average about 67. Mike,
   * 2026-10-16, lightly held. CAL.
   */
  WAKE_LINE_BYTES: number;

  // ── the core from beliefs (wave 2 lane F, 2026-10-22; design §6) ─────────
  /**
   * THE SWITCH (lightly held; default off until a `harness compare` and
   * Mike's read). On: the core the page rests on is the strongest current
   * beliefs about me and us on the self subject that pass the floors below
   * (`measures.ts#coreFromBeliefs`), at most `IDENTITY_MAX` of them — and
   * the night's reflection is shown them as the page's SPINE: it may phrase
   * and connect them, cite them on the page, and state as settled under
   * "## Core" only what one of them says (`dream/reflect.ts`). The core lanes
   * keep promoting memories alongside, unchanged; nothing is written for the
   * switch, so off is exactly as before (`test/self-core-from-beliefs.test.ts`
   * pins it byte for byte). Read at use from this object, never from a
   * `withTunables` copy, so `harness compare --set
   * self.CORE_FROM_BELIEFS=true` reaches every reader.
   *
   * ON A STORE WITH NO EARNED BELIEF THE SPINE IS EMPTY, and the reflection
   * is told the core is still forming: it HOLLOWS OUT "## Core" (the lanes'
   * core memories are said as lived or forming, not as who I am). On purpose,
   * no fallback (review of #587): a fallback would read as off on exactly the
   * young stores the compare needs. Turning it off writes nothing back: the
   * page stays hollow until a reflection rewrites "## Core". With it on, the
   * nightly page WRITER leaves "## Core" to the reflection (`writer.ts`).
   */
  CORE_FROM_BELIEFS: boolean;

  // ── the page split by section (lane N1 part 2, 2026-10-23) ───────────────
  /**
   * THE SWITCH (an experiment, very lightly held; Mike, 10-23). On, the night
   * writes the page in two lanes instead of two whole-page rewrites: the page
   * WRITER, in a child of its own and first, amends every section but
   * "## Core" from the day just lived; the REFLECTION writes "## Core" alone.
   * Held at the door (`Self#revisePage`): a writer's write takes "## Core"
   * from the page as it stands, a reflection's takes every other section from
   * it, and the answer says what was kept. A sentence kept word for word keeps
   * the ids it rested on. Off: exactly as before — the writer inside the
   * dream's child, both rewriting the whole page, no carrying. Read at use.
   * Not `pageWriter.mode: off`, which silences the reflection's page too.
   */
  PAGE_SPLIT: boolean;
  /** On: a belief's strength (physics, on the day read) at least this. CAL. */
  CORE_BELIEF_STRENGTH: number;
  /** On: at least this many memories counted FOR it (`belief_support`, stance
   *  support; another belief lent by `link` is not a memory). CAL. */
  CORE_BELIEF_MEMORIES: number;
  /**
   * On: its support from at least this many LIVED days
   * (`measures.ts#livedSupportDays`): the days its memories were born, over
   * lived filings and the finds life has echoed. An un-echoed `found` filing
   * adds no day — so one reflection's finds cannot put a belief in the core
   * before life echoes them. (Not C's `supportDays`, which counts such a find's
   * filing day, for resistance; review of #587.) CAL.
   */
  CORE_BELIEF_DAYS: number;

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
}

export const SELF_TUNABLES: SelfTunables = {
  IDENTITY_MAX: 24,
  IDENTITY_SHARE: 0.5,
  CRAFT_MAX: 8,
  CRAFT_AT_DELIVERY: true,
  CRAFT_IN_WAKE: false,
  WORK_HERE_MAX: 4,
  WORK_HERE_POOL: 8,
  WORK_HERE_EXCERPT: 60,
  PROJECTS_TRAVEL: true,
  WORK_HERE_CRAFT_MAX: 2,
  WAKE_PROJECT_LINE: true,
  WAKE_PROJECT_LINE_MAX: 3,
  WAKE_PROJECT_LINE_BYTES: 480,
  WAKE_PROJECT_LINE_FLOOR: 0.3,
  THREADS_MAX: 5,
  RECONSIDERING_MAX: 1,
  STILL_OPEN_STALE_DAYS: 14,
  OPEN_CARRY_DAYS: 21,
  OPEN_CARRY_GLIMPSE_TOUCH: false,
  HINTS_MAX: 8,
  HORIZON_MAX: 6,
  COMING_UP_TODAY_ONLY: true,
  WARM_FLOOR: 0.35,

  HINT_STEP: 1,
  HINT_RECOVERY_DAYS: 3,
  HINT_HABITUATION: 1,

  PAGE_MAX_BYTES: 16_384,
  PAGE_ROOM_BYTES,
  PAGE_HELD_TO_ROOM: true,
  PAGE_SHORT_PAST_ROOM: true,
  PAGE_STALE_DAYS: 14,
  PAGE_EMPTY_SHOWS_LIST: true,
  PAGE_ON_EGRESS: true,

  PAGE_WRITER_MEMORY_BYTES: 8_192,
  PAGE_WRITER_MEMORY_MAX: 40,
  DAYS_END_INPUT: true,
  DAYS_END_MEMORIES: 12,
  DAY_SUMMARY: true,
  DAY_SUMMARY_CHARS: 600,
  PAGE_WRITER_ASKS_PER_DAY: 2,
  TODAY_SO_FAR: true,
  YESTERDAY_FROM_SUMMARY: true,

  WAKE_LINE_BYTES: 240,

  CORE_FROM_BELIEFS: false,
  PAGE_SPLIT: true,
  CORE_BELIEF_STRENGTH: 0.5,
  CORE_BELIEF_MEMORIES: 3,
  CORE_BELIEF_DAYS: 2,

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
};

export function withTunables(overrides: Partial<SelfTunables>): SelfTunables {
  return { ...SELF_TUNABLES, ...overrides };
}
