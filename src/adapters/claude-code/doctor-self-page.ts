/** `doctor`'s findings on dreaming, the night run, the self page and its writer (moved out of `doctor.ts`, 2026-10-11). */
import { SELF_BRIEFING_EVENT } from "../../core/counterpart.js";
import { Store } from "../../core/store/index.js";
// The ask allowance the amber hint names, read rather than retyped: a number in
// a diagnostic's prose is a number that goes stale silently.
import { SELF_TUNABLES } from "../../core/self/tunables.js";
import {
  dreamSkippedOf,
  dreamSkippedWords,
  dreamingSetting,
  nightPartsWords,
  nightRunLost,
  nightRunOf,
  nightRunWords,
} from "../../core/dream/index.js";
import type { DreamingSetting } from "../../core/dream/index.js";
// The page's own reader, so this line cannot drift from what the wake prints.
import { clearedMarker, findPageRow, readSelfPage } from "../../core/self/page.js";
import {
  dayBefore,
  hasDayBefore,
  lastPageWriterRun,
  pageWriterDue,
  pageWriterNight,
  pageWriterStatus,
} from "../../core/self/writer.js";
// The what-fired reading, shared with the console's `fired` command and the
// dashboard's health panel so the three cannot disagree about what "silent"
// means (constitution 16, the same rule this module already keeps for "healthy").
import { daysBetween } from "../fired.js";
import { pageWriterMode } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { catchUpOf, catchUpWords } from "./night-catch-up.js";
import type { DoctorInput } from "./doctor.js";
import { finding } from "./doctor-finding.js";
import type { Finding } from "./doctor-finding.js";

/** How many dreams the Dreaming line reads, newest first, to find the last one that stands. */
const DREAM_ROWS = 200;

/**
 * DREAMING, informational (2026-09-26): the owner's setting (2026-09-28:
 * auto, ask or off), when the counterpart last dreamed, and what today's line
 * did — started the nightly run, asked, or was declined. Never amber: not
 * dreaming is the owner's choice, and a quiet week is not a fault.
 */
export function dreamingFindings(input: DoctorInput, store: Store): Finding[] {
  let last: ReturnType<Store["dreams"]>[number] | undefined;
  let ask: ReturnType<Store["dreamAsk"]>;
  let setting: DreamingSetting;
  try {
    // Past any run of undone dreams (2026-10-02): five newest undone read as
    // "has not dreamed yet" when the read stopped at five.
    last = store.dreams({ limit: DREAM_ROWS }).find((d) => d.state !== "undone");
    ask = store.dreamAsk(input.today);
    setting = dreamingSetting(store);
  } catch {
    return [];
  }
  const when = last === undefined ? null : (last.date ?? `lived day ${String(last.day)}`);
  const today =
    setting === "off"
      ? "off — no dreams (counterparts dream --setting ask turns it back on)"
      : ask === undefined
        ? "not started today"
        : ask.state === "declined"
          ? "asked today; the owner said not today"
          : ask.state === "launched"
            ? "started today, in the background"
            : "asked today";
  const unfinished = last !== undefined && last.state === "begun" ? `; dream ${last.id} is begun and not yet journaled` : "";
  // `auto` SAYS WHAT IT WILL DO, AND HOW TO STOP IT (2026-10-11): it is a new
  // install's default now, so the person reading this line may never have
  // chosen it.
  const said =
    setting === "auto"
      ? 'auto (the first session of each day starts the nightly run in the background; say "no dreams", or counterparts dream --setting off, to turn it off)'
      : setting;
  return [
    finding(
      "dreaming",
      "green",
      "Dreaming",
      `${said}; ${when === null ? "has not dreamed yet" : `last dreamed ${when}${last?.title ? ` — "${last.title}"` : ""}`}; ${today}${unfinished}`,
      "",
      { setting, last: when, dream: last?.id ?? null, ask: ask?.state ?? null },
    ),
  ];
}

/**
 * THE NIGHTLY RUN, headless (2026-09-29): what became of the latest run the
 * host started itself (setting `auto`) — the store's one-row record
 * (`dream/#nightRunOf`). Silent when no run was ever started and the setting
 * is not `auto`. AMBER only while the setting is `auto` and the latest run
 * did not finish (could not start, failed, timed out, or started and never
 * reported an end past its watchdog): a mechanism the owner chose is not
 * working. The fix says what to look at.
 */
export function nightRunFindings(input: DoctorInput, store: Store): Finding[] {
  let setting: DreamingSetting;
  let run: ReturnType<typeof nightRunOf>;
  let now: number;
  try {
    setting = dreamingSetting(store);
    run = nightRunOf(store);
    now = store.now();
  } catch {
    return [];
  }
  if (run === null) {
    if (setting !== "auto") return [];
    return [finding("night-run", "green", "Nightly run", "auto; no headless run yet — the first session of a day with enough new memory, or with write-ups owed from an earlier day, starts one", "", { setting, state: null })];
  }
  // ITS MORNING CATCH-UP (2026-10-01, build 3), when it had anything owed.
  const cu = catchUpOf(store, run.run);
  const caught = cu === null ? "" : `; catch-up: ${catchUpWords(cu)}`;
  const data = {
    setting,
    run: run.run,
    state: run.state,
    date: run.date,
    reason: run.reason,
    code: run.code,
    dream: run.dream,
    reflection: run.reflection,
    ...(cu === null ? {} : { catchUp: cu.state, writtenUp: cu.written, writeUpParts: cu.parts, leftOwed: cu.left }),
  };
  const mins = (ms: number): string => `${String(Math.max(1, Math.round(ms / 60_000)))} min`;
  const took = run.endedAt === null ? "" : ` after ${mins(run.endedAt - run.startedAt)}`;
  const skipped = dreamSkippedOf(run);
  const what = run.kind === "reflection" ? "the reflection alone" : skipped !== null ? `the catch-up alone; ${dreamSkippedWords(skipped)}` : "the whole night";
  if (run.state === "done") {
    const ids = [run.dream, run.reflection].filter((x): x is string => x !== null).join(", ");
    return [finding("night-run", "green", "Nightly run", `${setting}; last run ${run.date} (${what}) finished${took}${ids.length > 0 ? ` — ${ids}` : ""}${caught}`, "", data)];
  }
  if (run.state === "partial") {
    // PART OF THE RUN RAN (2026-09-29, owner): which parts, and — when the
    // exit said more than "it stopped" — why.
    const why = run.reason === "unfinished" ? "" : ` (${nightRunWords(run)})`;
    return [
      finding(
        "night-run",
        setting === "auto" ? "amber" : "green",
        "Nightly run",
        `${setting}; the run of ${run.date} (${what}) was partial${took}: ${nightPartsWords(run)}${why}${caught}`,
        "Nothing to do by hand: a later session picks up what did not run — a dream cut off is resumed, a reflection cut off runs alone.",
        { ...data, parts: (run.parts ?? []).join(",") },
      ),
    ];
  }
  if (run.state === "started") {
    const lost = nightRunLost(run, now);
    return [
      finding(
        "night-run",
        lost && setting === "auto" ? "amber" : "green",
        "Nightly run",
        lost
          ? `${setting}; the run of ${run.date} started ${mins(now - run.startedAt)} ago and never reported an end — its process went away (a sleep, a restart, a kill)`
          : `${setting}; running now (${what}), started ${mins(now - run.startedAt)} ago`,
        lost ? "The next session asks instead of starting another headless run. If this repeats, run claude -p once by hand in a terminal to see whether it hangs (a login, an update prompt)." : "",
        data,
      ),
    ];
  }
  const words = nightRunWords(run);
  const ended = run.state === "could-not-start" ? "could not start" : run.state === "timed-out" ? "timed out" : "failed";
  const fix =
    run.reason === "no-claude"
      ? "The headless run starts claude -p: put the claude command on the PATH the hooks see, or set dreaming to ask (counterparts dream --setting ask)."
      : run.reason === "quick-exit"
        ? "Run claude -p once by hand in a terminal to see why it stops (a login, an update prompt). Meanwhile the session asks instead."
        : run.reason === "nothing-ran"
          ? "The headless run needs the counterparts MCP server registered for claude at user scope (claude mcp list shows it); the server's own mcp.session rows say whether it refused the session."
          : "A later session starts it again, or asks when it cannot. counterparts dream --setting ask stops the headless runs.";
  return [finding("night-run", setting === "auto" ? "amber" : "green", "Nightly run", `${setting}; the run of ${run.date} (${what}) ${ended}${took}: ${words}${caught}`, fix, data)];
}

export function selfPageFindings(store: Store): Finding[] {
  const page = readSelfPage(store);
  if (page === null) {
    // CLEARED is not NEVER WRITTEN. The wake says the same thing either way — it
    // has no page — but a line telling the owner nothing was ever written, about
    // a page he cleared last week, is the diagnostic getting it wrong in the one
    // place he would look to check (adversarial review MINOR-F).
    const cleared = clearedPage(store);
    if (cleared !== null) {
      return [
        finding(
          "self-page",
          "green",
          "Self page",
          `cleared ${cleared.on === "" ? "(date unrecorded)" : `on ${cleared.on}`}` +
            `${cleared.reason === "" ? "" : ` — ${cleared.reason}`}; ${cleared.versions} version${cleared.versions === 1 ? "" : "s"} kept`,
          cleared.versions > 0
            ? `Put one back with: counterparts self-page --restore ${cleared.newest}.`
            : "",
          { present: false, cleared: true, on: cleared.on, versions: cleared.versions },
        ),
      ];
    }
    return [
      finding(
        "self-page",
        "green",
        "Self page",
        "not written yet — still forming",
        "",
        { present: false, cleared: false },
      ),
    ];
  }
  const stale = pageStaleOn(page.revisedOn, store.today(), SELF_TUNABLES.PAGE_STALE_DAYS);
  const room = SELF_TUNABLES.PAGE_ROOM_BYTES;
  const overRoom = page.bytes > room;
  // WHAT THE LAST WAKE SHOWED OF IT (2026-10-02, the "nobody saw it" review;
  // a ladder of whole texts since 2026-10-10, `self/briefing.ts#PageRung`):
  // read off the newest wake render's own row. Green for the page whole or
  // the short version its writer wrote with it; amber for the outline, the
  // headings, one line or nothing — with what to do.
  const shown = lastPageRung(store);
  const said = shown === null ? "" : `; the last wake showed ${PAGE_RUNG_WORDS[shown] ?? shown}`;
  const detail =
    `${page.bytes} bytes${overRoom ? ` (past its ${String(room)}-byte room)` : ""}, version ${page.version}` +
    `${page.short === null ? "" : `, with a ${String(page.short.bytes)}-byte short version`}, last revised ${page.revisedOn === "" ? "(unrecorded)" : page.revisedOn}` +
    `${page.by === null ? "" : ` by ${page.by}`}${said}`;
  // The day count and the room ride along so a surface can say it in words
  // ("not rewritten in 16 days") without re-deriving either (dashboard health).
  const data = {
    present: true,
    bytes: page.bytes,
    version: page.version,
    revisedOn: page.revisedOn,
    stale,
    // True when the wake prints it whole at 9,000 bytes whatever it reserves.
    wakeShowsAll: !overRoom,
    room,
    hasShort: page.short !== null,
    rung: shown,
    daysSince: calendarDaysSince(page.revisedOn, store.today()),
    staleAfter: SELF_TUNABLES.PAGE_STALE_DAYS,
  };
  // WHAT TO DO when the wake stepped below the short version: give it one, or
  // bring the page under its room. A page within its room that still did not
  // fit is the ceiling's doing, not the page's.
  const short = shown === "outline" || shown === "headings" || shown === "line" || shown === "none";
  const fix = !short
    ? ""
    : overRoom
      ? `Sessions are not reading the page whole. Give it a short version under ${String(room)} bytes (the self_page tool's \`short\`), or bring it under ${String(room)} bytes: counterparts self-page --write.`
      : `The page is within its room, so the wake's ceiling is too small for it: raise injectionBudgetBytes in the configuration (9000 is the default), or give the page a short version.`;
  return [
    stale
      ? finding(
          "self-page",
          "amber",
          "Self page",
          `${detail} — stale (over ${SELF_TUNABLES.PAGE_STALE_DAYS} days)`,
          `Nothing has revised it lately: check the page writer, or amend it yourself with counterparts self-page --write.${fix === "" ? "" : ` ${fix}`}`,
          data,
        )
      : short
        ? finding("self-page", "amber", "Self page", detail, fix, data)
        : finding("self-page", "green", "Self page", detail, "", data),
  ];
}

/** How doctor names each rung the last wake printed the page on (`self/briefing.ts#PageRung`). */
const PAGE_RUNG_WORDS: Readonly<Record<string, string>> = {
  whole: "it whole",
  short: "its short version",
  outline: "only each section's heading and first sentence",
  headings: "only its section headings",
  line: "one line about it",
  none: "nothing of it — no room even for a line",
};

/**
 * THE RUNG THE NEWEST WAKE RENDER PRINTED THE PAGE ON (2026-10-10), from its
 * durable `self.briefing` row (`counterpart.ts#recordSelfBriefing`), or null
 * when no row carries one — a render before the ladder, or none yet. Never
 * throws.
 */
function lastPageRung(store: Store): string | null {
  try {
    const row = store.eventLog({ name: SELF_BRIEFING_EVENT, order: "desc", limit: 1 })[0];
    if (row === undefined) return null;
    const page = (JSON.parse(row.payload ?? "{}") as Record<string, unknown>)["page"];
    if (typeof page !== "object" || page === null) return null;
    const rung = (page as Record<string, unknown>)["rung"];
    return typeof rung === "string" && rung.length > 0 ? rung : null;
  } catch {
    return null;
  }
}

/**
 * THE NIGHTLY PAGE WRITER (2026-09-20, S2) — one line: has last night happened,
 * and what did it come to.
 *
 * **GREEN when it has never run on a store younger than a day**, and that is
 * the whole design of this line rather than a leniency. A mechanism that fires
 * once a night cannot have fired on a store installed this morning, and a line
 * that says something is wrong from the moment it lands is a line people learn
 * to read past — the same rule `fired.ts` states for its `blind` rows and the
 * same one `selfPageFindings` follows for an absent page.
 *
 * Green also for a night that read the day and had nothing to say: that is the
 * mechanism working, and it is stated in words rather than left as a silence.
 *
 * Green when it is OFF, too — a deliberate choice is not a fault — with the
 * line saying what off means. (This comment and the adapter CONTRACT used to
 * say "amber while a page stands"; the code has said green since the S2
 * review, and the words now follow the code, 2026-09-28.)
 *
 * AMBER, with a fix, on the readings that mean something has stopped: a run
 * that failed or was refused, a pageWriter block that could not be read, and
 * — since the writer moved into the nightly run (2026-09-28) — a night owed
 * for days while nightly runs went on without it. A night owed because no run
 * started (fewer than three new memories, dreaming off or declined) is the
 * ordinary state of a quiet week and stays green. Never red: nothing here can
 * cost a session its memory.
 */
export function pageWriterFindings(store: Store, config: AdapterConfig): Finding[] {
  const mode = pageWriterMode(config);
  // THE MECHANISM'S OWN NIGHT, not one this line derives (PR #189 review, M2):
  // the local calendar day, held back east of UTC to a provenance date that has
  // closed — the one function `Self`, the nightly run and this line all read, so the
  // claim's local `on` is never compared with a UTC `today`.
  const { today, about } = pageWriterNight(store);
  const last = lastPageWriterRun(store);
  const page = readSelfPage(store);
  const data = {
    mode,
    lastAbout: last?.about ?? "",
    lastOutcome: last?.outcome ?? "",
    ran: last !== null,
  };
  // A BLOCK THAT COULD NOT BE READ IS AMBER, AND IT SAYS WHICH KEY. The block is
  // lenient now (S2 review), so a typo costs the setting rather than the store's
  // memory — but a setting that silently did nothing is the other half of that
  // failure, and this is the line that stops it being silent.
  const ignored = config.pageWriter?.ignored ?? [];
  if (ignored.length > 0) {
    return [
      finding(
        "page-writer",
        "amber",
        "Page writer",
        `${mode} mode; ${ignored.join("; ")}`,
        "Fix the pageWriter block in claude-code.json. Nothing else in the file was affected, and memory is unaffected.",
        { ...data, ignored: ignored.join(" | ") },
      ),
    ];
  }
  if (mode === "off") {
    // GREEN, always. Off is a setting somebody chose, and a diagnostic that
    // grades a deliberate choice as a fault is the shape of line people learn to
    // read past — the same rule `fired.ts` states for a `disabled` mechanism.
    // The line still says what off MEANS, so nobody has to remember.
    return [
      finding(
        "page-writer",
        "green",
        "Page writer",
        page === null
          ? "off — nothing writes the self page on its own, and nothing has been written by hand either"
          : "off — the page stands, and from here it changes only when somebody writes it",
        "",
        data,
      ),
    ];
  }
  if (last === null) {
    // NEVER RUN. On a store with no yesterday that is the correct state and
    // says so; on one that has lived a day it is still green, because the
    // mechanism runs at the NEXT session start and has not been given a turn.
    const young = !hasDayBefore(store, dayBefore(about, -1));
    return [
      finding(
        "page-writer",
        "green",
        "Page writer",
        young
          ? `${mode} mode; never run — this store has no day before ${today} yet`
          : `${mode} mode; never run — it is the first part of the next nightly run, before the dream (${about})${dreamingSetting(store) === "off" ? "; dreaming is off, so the nightly run does not start" : ""}`,
        "",
        { ...data, young },
      ),
    ];
  }
  const status = pageWriterStatus(store, last.about, today);
  const when = `last ran for ${last.about}${last.on === "" ? "" : ` on ${last.on}`}`;
  // IS TONIGHT'S ALREADY OWED, AND HAS IT BEEN OWED FOR A WHILE? The failure
  // this catches is the one with no row at all behind it: an ask that will not
  // fit the host's ceiling is DEFERRED, and a deferral leaves only a ring event
  // that dies with the hook process. Without this line, a writer that stopped
  // being delivered on day 4 reads exactly like one that ran last night —
  // which is I32's shape, and the reason this line exists at all.
  const owed = pageWriterDue(store, {
    mode,
    today,
    about,
    observer: store.observer,
    asksPerDay: SELF_TUNABLES.PAGE_WRITER_ASKS_PER_DAY,
  });
  const staleFor = last.on === "" ? 0 : daysBetween(last.on, today);
  // OWED IS NOT OVERDUE on its own any more (2026-09-28). The writer runs
  // inside the nightly run, and a night with fewer than three new memories
  // runs nothing — the day carries over — so "owed for days" is the ordinary
  // state of a quiet week. It is amber only when nightly runs HAPPENED since
  // (a dream dated after the writer's last row, before today) and the writer
  // still left nothing: the run is going without it.
  const ranSince = last.on !== "" ? dreamsBetween(store, last.on, today) : 0;
  const overdue = owed.due && staleFor > PAGE_WRITER_STALE_DAYS && ranSince > 0;
  const bad = status.outcome === "failed" || status.outcome === "refused";
  const detail =
    `${mode} mode; ${when} — ${status.outcome}` +
    (status.derived ? " (derived: it was handed the day and wrote nothing)" : "") +
    (status.run !== null && status.run.detail.length > 0 && !status.derived
      ? `, ${status.run.detail}`
      : "") +
    (owed.due ? `; ${owed.about} is owed` : "") +
    (overdue ? ` and nothing has been delivered for ${String(staleFor)} days` : "");
  return [
    finding(
      "page-writer",
      bad || overdue ? "amber" : "green",
      "Page writer",
      detail,
      bad || overdue
        ? "counterparts mechanisms --all --dir <store> --observer shows the run's own row. The page writer is the first part of the nightly run, before the dream: counterparts dream shows whether the runs are happening and how each ended. counterparts self-page --write amends the page by hand meanwhile."
        : "",
      {
        ...data,
        outcome: status.outcome,
        derived: status.derived,
        owedFor: owed.due ? owed.about : "",
        staleFor,
      },
    ),
  ];
}

// `daysBetween` is `fired.ts`'s (E2, 2026-09-20) and is imported at the top of
// this file rather than written twice. S2 landed a local copy of the same four
// lines and the merge put them side by side; one definition is the rule this
// module already keeps for every other reading it shares with the fired view.
// The one behavioural difference is deliberate: the shared one can return a
// NEGATIVE when a clock has moved backwards, and `overdue` below compares with
// `>`, so a future date reads "not overdue" rather than being clamped to today.

/** Calendar days a night may be owed before the line says so. A writer that
 *  missed last night has not failed; one that has missed three has. */
export const PAGE_WRITER_STALE_DAYS = 2;

/** Dreams begun on a calendar date after `after` and before `before` (not undone). Never throws. */
function dreamsBetween(store: Store, after: string, before: string): number {
  try {
    return store.dreams({ limit: 50 }).filter((d) => d.state !== "undone" && d.date !== null && d.date > after && d.date < before).length;
  } catch {
    return 0;
  }
}

/** A page that was written and then cleared: when, why, and what is restorable.
 *  Null when no page row exists at all. */
function clearedPage(
  store: Store,
): { on: string; reason: string; versions: number; newest: number } | null {
  const id = findPageRow(store);
  if (id === null) return null;
  let marker: { on: string; reason: string } | null = null;
  try {
    marker = clearedMarker(store.readProse(id).meta);
  } catch {
    return null;
  }
  if (marker === null) return null;
  const versions = store.versions(id);
  const newest = versions.reduce((n, v) => Math.max(n, v.seq), 0);
  return { ...marker, versions: versions.length, newest };
}

/**
 * Calendar days, like every other window here. A date that is absent or does
 * not READ reads as stale — the same direction `self/#pageStale` takes, and the
 * two are asserted to agree.
 */
function pageStaleOn(revisedOn: string, today: string, limit: number): boolean {
  const days = calendarDaysSince(revisedOn, today);
  return days === null ? true : days > limit;
}

/** Calendar days from `revisedOn` to `today`; null when either does not read. */
function calendarDaysSince(revisedOn: string, today: string): number | null {
  const on = revisedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const a = Date.parse(`${on}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
