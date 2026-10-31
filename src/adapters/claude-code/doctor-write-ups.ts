/** `doctor`'s finding on write-ups a crash or a lapse left owed (moved out of `doctor.ts`, 2026-10-11). */
import { addDays, isDay, localDate } from "../../core/time.js";
import { Store } from "../../core/store/index.js";
import { dreamingSetting } from "../../core/dream/index.js";
import { TUNABLES } from "../config.js";
// Retention's own reading and its own week, so the Raw transcripts line cannot
// promise a different number from the job that does the deleting. READ-ONLY:
// `remember/index.ts` re-exports the plan and the readers, never the deleter.
import { SpanBuffer } from "../../core/remember/index.js";
import { COVERAGE_TUNABLES, lapsesSince, ledger } from "../../core/coverage/index.js";
import type { LedgerEntry } from "../../core/coverage/index.js";
import {
  folderSetAside,
  hostOf,
  hostSessionEvidence,
  listSessions,
  lapsingWords,
  notPointableWhy,
  progressKey,
  readWriteUpPointer,
  readWriteUpProgress,
  sameScope,
  writeUpEntries,
  writeUpPlan,
} from "../sessions.js";
import type { FolderOn } from "../sessions.js";
import { foldersOn, readScopes, scopesPath } from "../scopes.js";
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
 * how many stretches lapsed in the last week. AMBER when an owed stretch is
 * OVERDUE (`overdue`, S2c 2026-10-26): the catch-up had its chance and it is
 * still here. Until S2c it was amber for any stretch from yesterday or
 * earlier — and once a short check-in owed its write-up (S2), that was every
 * morning before the first prompt, which is where the night runs. Never red: nothing is deleted while a stretch is owed, and a lapse
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
  /** ...of which are OVERDUE (`overdue`): the catch-up had its chance and the
   *  debt is still here. The field keeps its old name; until S2c it counted
   *  every stretch from yesterday or earlier. */
  readonly stale: number;
  /** Short debts the pointer never offers (`sessions.ts#notPointableWhy`):
   *  they owe, and lapse with their days of use. */
  readonly unpointed: number;
  /** ...of which from a headless run (`claude -p`, the Agent SDK). */
  readonly unpointedHeadless: number;
  /** ...of which from a session with no registry record. */
  readonly unpointedNoRecord: number;
  /** The newest catch-up row's time (`catchUpOf`, any age), or null. */
  readonly lastCatchUpAt: number | null;
  /** The folder setting these counts were read under, when one was. */
  readonly folders?: FolderOn;
}

/** "1 overdue (a catch-up has run since, or 2 days of use)": the clause the
 *  Catch-up and Authorship lines add after the owed count. */
export function overdueWords(n: number): string {
  return `${String(n)} overdue (a catch-up has run since, or ${String(OVERDUE_DAYS_OF_USE)} days of use)`;
}

/** Days of use after a stretch's date, with no catch-up run since, that make
 *  it overdue: the person came back on a later day and nothing cleared it. */
export const OVERDUE_DAYS_OF_USE = 2;

/**
 * OVERDUE (S2c, 2026-10-26): a debt the catch-up had its chance at and did
 * not clear — not a debt waiting for its first night. The night runs at the
 * next day of use's first prompt, so yesterday's check-ins are owed every
 * morning until then; that is the ordinary state, not a problem.
 *
 * Overdue when a catch-up ran on a LATER DATE than the stretch's latest piece
 * (dates in the store's zone: the night is launched from the morning session's
 * first prompt, so that session's own pieces land around the run's row, and a
 * second run the same day — a whole night after a catch-up-only one — is not
 * a chance at that day's sessions in any way a person could tell apart); or
 * when `OVERDUE_DAYS_OF_USE` days of use came after it and no catch-up has run
 * since — where nights never run (dreaming off, or a night that never starts),
 * the next session's pointer had a whole day of use to offer it. Loose on
 * purpose (guards loose-first): a run that was bounded and left a part counts
 * as a chance too.
 */
export function overdue(e: LedgerEntry, zone: string, lastCatchUpAt: number | null): boolean {
  if (e.stretch === null) return false;
  const day = localDate(e.stretch.lastAt, zone);
  if (lastCatchUpAt !== null && localDate(lastCatchUpAt, zone) > day) return true;
  // No catch-up on a later date (the arm above), so none since that counts.
  return e.daysOfUseSince >= OVERDUE_DAYS_OF_USE;
}

/** The newest catch-up row's time, or null when none ran (or it cannot be read). */
function lastCatchUpAt(store: Store): number | null {
  try {
    return catchUpOf(store)?.at ?? null;
  } catch {
    return null;
  }
}

/**
 * THE FOLDER SETTING DOCTOR COUNTS UNDER. A file that will not read is no
 * setting here: the catch-up takes nothing while it is broken (`scopes.ts#foldersOn`),
 * and a count of what it can't take is what shows that, rather than a reading of
 * "nothing owed" over a night that could not run. `counterparts coverage` reads
 * the same.
 */
export function owedFolders(configPath: string): FolderOn | undefined {
  const file = scopesPath(configPath);
  return readScopes(file).error === null ? foldersOn(file) : undefined;
}

/** `failed` when it cannot be read. It reads every scope's captured words, so
 *  the budgeted session-start reading never calls it. `folders`: the folder
 *  setting. A session whose folder is off, observer or paused is no debt the
 *  catch-up could clear, so it is in none of these counts (2026-10-30). */
export function readOwed(store: Store, folders?: FolderOn): OwedReading | "failed" {
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
    const why = new Map(all.map((e) => [e.session, notPointableWhy(e, store.dir, folders)]));
    const owed = all.filter((e) => why.get(e.session) === null);
    const night = lastCatchUpAt(store);
    const stale = owed.filter((e) => overdue(e, zone, night)).length;
    const headless = all.filter((e) => why.get(e.session) === "headless").length;
    const noRecord = all.filter((e) => why.get(e.session) === "no-record").length;
    return {
      spans,
      plan,
      entries,
      now,
      waiting: owed.length,
      stale,
      unpointed: headless + noRecord,
      unpointedHeadless: headless,
      unpointedNoRecord: noRecord,
      lastCatchUpAt: night,
      ...(folders === undefined ? {} : { folders }),
    };
  } catch {
    return "failed";
  }
}

/** The shared owed reading as a line asks for it: `null` when this reading
 *  does not take it (the budgeted session-start reading). */
export type OwedSource = () => OwedReading | "failed" | null;

/**
 * THE NIGHT, HELD (2026-10-30): red for as long as the folder setting won't read,
 * because the night isn't running at all (`night-run.ts`, the door's `nightHeld`):
 * no page, no dream, no reflection. Read from the file, so it clears when it's fixed.
 */
export function nightHeldFindings(configPath: string): Finding[] {
  const file = scopesPath(configPath);
  const read = readScopes(file);
  if (read.error === null) return [];
  return [finding("night-held", "red", "The night", `held: ${tilde(file)} will not read (${read.error}), so there is no page, dream or reflection until it does`, `Fix or remove ${tilde(file)}.`, { path: file })];
}

export function crashWriteUpFindings(input: DoctorInput, store: Store, owedReading: OwedSource): Finding[] {
  const title = "Catch-up";
  const yesterday = isDay(input.today) ? addDays(input.today, -1) : input.today;
  let waiting: number | null = null;
  let stale = 0;
  let unpointed = 0;
  let unpointedHeadless = 0;
  let unpointedNoRecord = 0;
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
    unpointedHeadless = reading.unpointedHeadless;
    unpointedNoRecord = reading.unpointedNoRecord;
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
      if (reading.folders !== undefined && folderSetAside(h, store.dir, reading.folders)) continue;
      const elsewhere = h.scopes.filter(
        (scope) =>
          !sameScope(scope, here) &&
          progress[progressKey(session, scope)]?.waiting !== true &&
          writeUpEntries(spans, { session, scopes: [scope] }).length > 0,
      );
      if (elsewhere.length === 0) continue;
      const e = entries.find((x) => x.session === session);
      // OVERDUE AS THE COUNT IS (S2c): waiting on another project is the
      // ordinary state until the catch-up has had its chance.
      shares.push({ session, here, elsewhere, stale: e !== undefined && overdue(e, store.zone(), reading.lastCatchUpAt) });
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
          (stale === 0 ? "" : `, ${overdueWords(stale)}`);
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
      lapsingWords(unpointedHeadless, unpointedNoRecord),
      lapses === 0 ? "" : `${String(lapses)} lost unwritten this week`,
    ]
      .filter((w) => w.length > 0)
      .join("; ");
  const pointer = readWriteUpPointer(store);
  // A FOLDER SETTING THAT WILL NOT READ takes nothing from the catch-up, so the
  // advice below would send a person to a command that can't help while the
  // text goes on aging. Said at once, not when it goes overdue. Asked only when
  // something is owed, so the budgeted session-start reading never reads it.
  const scopesFile = (waiting ?? 0) > 0 && input.configReason !== "not-read" ? scopesPath(input.configPath) : null;
  const scopes = scopesFile === null ? null : readScopes(scopesFile);
  const data = {
    mode: "next-session",
    waiting,
    stale,
    unpointed,
    unpointedHeadless,
    unpointedNoRecord,
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
  if (scopes !== null && scopes.error !== null) {
    return [
      finding(
        "crash-write-up",
        "amber",
        title,
        `${detail} — no write-ups are being taken: ${tilde(scopesFile ?? "")} will not read (${scopes.error})`,
        `Fix or remove ${tilde(scopesFile ?? "")}; the night and counterparts catch-up take nothing until then, and text that ages out meanwhile is lost.`,
        data,
      ),
    ];
  }
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
          ? "The nightly run had its chance at these, or has not run in two days of use, and they are still owed; counterparts catch-up does it now. "
          : "Run counterparts catch-up to write them up now, or open a session in the project each one is in: its start points at the oldest. ") +
          `counterparts coverage says which. A stretch nobody writes up lapses after ${String(COVERAGE_TUNABLES.LAPSE_DAYS_OF_USE)} days of use — nothing is deleted, it stops being owed.`,
        data,
      ),
    ];
  }
  return [finding("crash-write-up", "green", title, detail, "", data)];
}
