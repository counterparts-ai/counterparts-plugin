/** `doctor`'s finding on write-ups a crash or a lapse left owed (moved out of `doctor.ts`, 2026-10-11). */
import { addDays, isDay, localDate } from "../../core/time.js";
import { Store } from "../../core/store/index.js";
import { dreamingSetting } from "../../core/dream/index.js";
import { TUNABLES } from "../config.js";
// Retention's own reading and its own week, so the Raw transcripts line cannot
// promise a different number from the job that does the deleting. READ-ONLY:
// `remember/index.ts` re-exports the plan and the readers, never the deleter.
import { SpanBuffer } from "../../core/remember/index.js";
import { lapsesSince, ledger } from "../../core/coverage/index.js";
import type { LedgerEntry } from "../../core/coverage/index.js";
import {
  hostOf,
  hostSessionEvidence,
  listSessions,
  pointable,
  progressKey,
  readWriteUpPointer,
  readWriteUpProgress,
  sameScope,
  writeUpEntries,
  writeUpPlan,
} from "../sessions.js";
import { DESKTOP_HOST } from "../hosts.js";
import { catchUpOf, CATCH_UP_RUN_PREFIX, catchUpWords } from "./night-catch-up.js";
import type { DoctorInput } from "./doctor.js";
import { tilde, finding } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

// ── rendering ───────────────────────────────────────────────────────────────

/** How far back the line counts lapses, in days. */
export const WRITE_UP_LAPSE_WINDOW_DAYS = 7;

/**
 * WRITE-UPS (2026-09-30; before it, #192's `Crash write-up`, whose key it
 * keeps) — what is not written up, read off `core/coverage/`'s ledger.
 *
 * It says yesterday's state: how many sessions captured something that date
 * and how much of it is written up; how many sessions owe a write-up now; and
 * how many stretches lapsed in the last week. AMBER when a stretch from
 * yesterday or earlier is owed — the next session in that project is pointed
 * at it, so one still owed the morning after is one whose project nobody has
 * opened. Never red: nothing is deleted while a stretch is owed, and a lapse
 * deletes nothing either. The two ambers #192 added for the pointer itself —
 * deferred for room, and a session finished here waiting on another project —
 * are kept as they were.
 */
/** The ledger and the plan, read once per reading and shared by the
 *  `Write-ups` and `Authorship` lines. */
export interface OwedReading {
  readonly spans: SpanBuffer;
  readonly plan: ReturnType<typeof writeUpPlan>;
  readonly entries: readonly LedgerEntry[];
  readonly now: number;
  /** Sessions that owe a write-up the pointer can offer (`coverage/`'s rule). */
  readonly waiting: number;
  /** ...of which the stretch is from yesterday or earlier. */
  readonly stale: number;
  /** Small debts the pointer never offers (no registry record, or not a
   *  person's session): they owe, and lapse with their days of use. */
  readonly unpointed: number;
}

/** `failed` when it cannot be read. It reads every scope's captured words, so
 *  the budgeted session-start reading never calls it. */
export function readOwed(store: Store, today: string): OwedReading | "failed" {
  try {
    const now = store.now();
    // READ-ONLY by construction: an observer buffer writes nothing, and it
    // is the ledger's own reader that opens the files.
    const spans = new SpanBuffer({ dir: store.dir, observer: true, now: () => now });
    const plan = writeUpPlan({ store, spans });
    const zone = store.zone();
    const host = hostSessionEvidence(store);
    const entries = ledger(spans, { now, zone, host: (s) => ({ endedAt: host(s).endedAt }) });
    const all = entries.filter((e) => e.owed);
    const owed = all.filter((e) => pointable(e, store.dir));
    const stale = owed.filter((e) => e.stretch !== null && localDate(e.stretch.lastAt, zone) < today).length;
    return { spans, plan, entries, now, waiting: owed.length, stale, unpointed: all.length - owed.length };
  } catch {
    return "failed";
  }
}

/** The shared owed reading as a line asks for it: `null` when this reading
 *  does not take it (the budgeted session-start reading). */
export type OwedSource = () => OwedReading | "failed" | null;

export function crashWriteUpFindings(input: DoctorInput, store: Store, owedReading: OwedSource): Finding[] {
  const title = "Catch-up";
  const yesterday = isDay(input.today) ? addDays(input.today, -1) : input.today;
  let waiting: number | null = null;
  let stale = 0;
  let unpointed = 0;
  let yesterdayWords = "";
  let yesterdayData: { sessions: number; pieces: number; written: number } | null = null;
  /** Sessions FINISHED in one project and waiting on words they left in
   *  another (the door's `written-up-here`), stale ones first. */
  const shares: { session: string; here: string; elsewhere: string[]; stale: boolean }[] = [];
  try {
    const reading = owedReading();
    if (reading === null || reading === "failed") throw new Error("owed reading unavailable");
    const { spans, plan, entries } = reading;
    waiting = reading.waiting;
    stale = reading.stale;
    unpointed = reading.unpointed;
    // YESTERDAY, keyed on the pieces' own dates in the store's zone.
    const day = entries
      .map((e) => e.perDate[yesterday])
      .filter((c): c is { pieces: number; written: number } => c !== undefined);
    yesterdayData = {
      sessions: day.length,
      pieces: day.reduce((n, c) => n + c.pieces, 0),
      written: day.reduce((n, c) => n + c.written, 0),
    };
    yesterdayWords =
      day.length === 0
        ? `yesterday (${yesterday}): nothing captured`
        : `yesterday (${yesterday}): ${String(day.length)} session${day.length === 1 ? "" : "s"}, ` +
          `${String(yesterdayData.written)} of ${String(yesterdayData.pieces)} pieces written up`;
    // CLAUDE DESKTOP'S CHATS ARE UNMEASURED, NEVER LOST (2026-10-01, as
    // `counterparts coverage` says them): nothing is captured there, so the
    // ledger holds nothing for them to owe.
    const zoneY = store.zone();
    const desk = listSessions(store.dir).filter(
      (r) => hostOf(r) === DESKTOP_HOST && (localDate(r.startedAt, zoneY) === yesterday || localDate(r.lastBoundaryAt, zoneY) === yesterday),
    ).length;
    if (desk > 0) yesterdayWords += `, and ${String(desk)} Claude Desktop chat${desk === 1 ? "" : "s"} (unmeasured: no transcript)`;
    const progress = readWriteUpProgress(store);
    for (const [key, p] of Object.entries(progress)) {
      if (p.waiting !== true) continue;
      const bar = key.indexOf("|");
      const session = key.slice(0, bar);
      const here = key.slice(bar + 1);
      const h = plan.find((x) => x.session === session);
      if (h === undefined || !h.owes) continue;
      const elsewhere = h.scopes.filter(
        (scope) =>
          !sameScope(scope, here) &&
          progress[progressKey(session, scope)]?.waiting !== true &&
          writeUpEntries(spans, { session, scopes: [scope] }).length > 0,
      );
      if (elsewhere.length === 0) continue;
      const e = entries.find((x) => x.session === session);
      const from = e?.stretch === null || e === undefined ? input.today : localDate(e.stretch.lastAt, store.zone());
      shares.push({ session, here, elsewhere, stale: from < input.today });
    }
    shares.sort((a, b) => Number(b.stale) - Number(a.stale));
  } catch {
    waiting = null;
  }
  const lapses = lapsesSince(store, store.now() - WRITE_UP_LAPSE_WINDOW_DAYS * 86_400_000).length;
  const owedWords =
    waiting === null
      ? "could not read what is written up"
      : waiting === 0
        ? "nothing owed"
        : `${String(waiting)} session${waiting === 1 ? "" : "s"} to catch up` +
          (stale === 0 ? "" : `, ${String(stale)} from yesterday or earlier`);
  // THE NIGHTLY RUN'S CATCH-UP (2026-10-01): its newest row, within two days.
  let night: ReturnType<typeof catchUpOf> = null;
  try {
    const cu = catchUpOf(store);
    night = cu !== null && store.now() - cu.at < 2 * 86_400_000 ? cu : null;
  } catch {
    night = null;
  }
  // ONE RENDERER for the run's row (2026-10-11): on 10-11 this line said
  // "wrote up 0 of 1" for a night that wrote 5 of a session's 17 parts.
  const nightWords =
    night === null ? "" : `${night.run.startsWith(CATCH_UP_RUN_PREFIX) ? "counterparts catch-up" : "the nightly run"} (${localDate(night.at, store.zone())}): ${catchUpWords(night)}`;
  // WHERE THE NIGHT CATCHES UP (dreaming `auto`, 2026-10-11) the SessionStart
  // pointer is retired: the advice is the night, or the command.
  let auto = false;
  try {
    auto = dreamingSetting(store) === "auto";
  } catch {
    auto = false;
  }
  const detail =
    [
      yesterdayWords,
      nightWords,
      owedWords,
      unpointed === 0 ? "" : `${String(unpointed)} small, not known as a person's session: left to lapse`,
      lapses === 0 ? "" : `${String(lapses)} lost unwritten this week`,
    ]
      .filter((w) => w.length > 0)
      .join("; ");
  const pointer = readWriteUpPointer(store);
  const data = {
    mode: "next-session",
    waiting,
    stale,
    unpointed,
    lapsedWeek: lapses,
    yesterday,
    yesterdaySessions: yesterdayData?.sessions ?? null,
    yesterdayPieces: yesterdayData?.pieces ?? null,
    yesterdayWritten: yesterdayData?.written ?? null,
    pointer: pointer?.outcome ?? null,
    pointerDate: pointer?.date ?? null,
    nightWrittenUp: night?.written ?? null,
    nightLeftOwed: night?.left ?? null,
    // Parts a catch-up reader was handed and did not bring back (2026-10-11):
    // they stay owed, so `waiting` already counts their sessions.
    nightUnread: night?.unread ?? null,
  };
  // THE POINTER IS NOT GETTING OUT (PR #192 review, MAJOR 1 and m4): opening a
  // session there would only defer again, so the advice says why and by how much.
  if (!auto && pointer !== null && pointer.outcome === "deferred" && (waiting ?? 0) > 0) {
    const short = Math.max(0, pointer.need - pointer.room);
    // WHAT TOOK THE ROOM, named (review of #285, M3): beside a full wake the
    // first-launch question or a plain reminder can be what left the pointer
    // no room — and then the wake's budget is not the thing to lower.
    const beside = pointer.beside ?? "";
    const cap =
      pointer.limit !== undefined && pointer.limit !== TUNABLES.HOST_OUTPUT_CHARS
        ? `the ${pointer.limit.toLocaleString("en-US")}-character envelope that carries today's reminders`
        : "the host's 10,000-character cap";
    const why =
      pointer.reason === "host-cap"
        ? `the pointer did not fit on ${pointer.date}: it needs ${String(pointer.need)} bytes and the wake${beside.length === 0 ? "" : ` and ${beside}`} left ${String(Math.max(0, pointer.room))} under ${cap} (${String(short)} short)`
        : `the pointer could not be recorded on ${pointer.date} (${pointer.reason ?? "unknown"})`;
    const hostCapFix =
      beside.length === 0
        ? `The wake is too full: lower "injectionBudgetBytes" in ${tilde(input.configPath)} by ${String(short)} or more.`
        : `It was ${beside} beside the wake that took the room that morning, not the wake alone; the pointer is offered again at the next session start with room. If it keeps deferring, lower "injectionBudgetBytes" in ${tilde(input.configPath)} by ${String(short)} or more.`;
    return [
      finding(
        "crash-write-up",
        "amber",
        title,
        `${detail} — ${why}`,
        pointer.reason === "host-cap"
          ? hostCapFix
          : "The session registry under the store could not be written; read the Store line.",
        data,
      ),
    ];
  }
  // A SHARE WAITING ON ANOTHER PROJECT (re-review, m-C): name the project, and
  // say the session is finished here — opening a session HERE does nothing.
  const share = shares.find((x) => x.stale);
  if (share !== undefined) {
    const where = share.elsewhere.map((x) => tilde(x)).join(", ");
    return [
      finding(
        "crash-write-up",
        "amber",
        title,
        `${detail} — session ${share.session} is finished in ${tilde(share.here)} and waiting on words it left in ${where}` +
          (shares.length > 1 ? ` (${String(shares.length)} such sessions)` : ""),
        auto
          ? `The next nightly run writes up the rest in ${where}; counterparts catch-up does it now.`
          : `Run counterparts catch-up, or open a session in ${where}: its start points at the rest. A directory set off never will.`,
        { ...data, sharesWaiting: shares.length },
      ),
    ];
  }
  if (stale > 0) {
    return [
      finding(
        "crash-write-up",
        "amber",
        title,
        detail,
        (auto
          ? "The nightly run catches up on everything owed each morning; counterparts catch-up does it now. "
          : "Run counterparts catch-up to write them up now, or open a session in the project each one is in: its start points at the oldest. ") +
          "counterparts coverage says which. A stretch nobody writes up lapses after two more days of use — nothing is deleted, it stops being owed.",
        data,
      ),
    ];
  }
  return [finding("crash-write-up", "green", title, detail, "", data)];
}
