import { SELF_BRIEFING_EVENT } from "../../core/counterpart.js";
import { Store } from "../../core/store/index.js";
import { SELF_TUNABLES } from "../../core/self/tunables.js";
import {
  dreamSkippedOf,
  dreamSkippedWords,
  dreamingSetting,
  nightPartsWords,
  nightRunLost,
  nightRunOf,
  nightRunWords
} from "../../core/dream/index.js";
import { clearedMarker, findPageRow, readSelfPage } from "../../core/self/page.js";
import {
  dayBefore,
  hasDayBefore,
  lastPageWriterRun,
  pageWriterDue,
  pageWriterNight,
  pageWriterStatus
} from "../../core/self/writer.js";
import { daysBetween } from "../fired.js";
import { pageWriterMode } from "../config.js";
import { catchUpOf, catchUpWords } from "./night-catch-up.js";
import { finding } from "./doctor-finding.js";
const DREAM_ROWS = 200;
export function dreamingFindings(input, store) {
  let last;
  let ask;
  let setting;
  try {
    last = store.dreams({ limit: DREAM_ROWS }).find((d) => d.state !== "undone");
    ask = store.dreamAsk(input.today);
    setting = dreamingSetting(store);
  } catch {
    return [];
  }
  const when = last === undefined ? null : last.date ?? `lived day ${String(last.day)}`;
  const today = setting === "off" ? "off — no dreams (counterparts dream --setting ask turns it back on)" : ask === undefined ? "not started today" : ask.state === "declined" ? "asked today; the owner said not today" : ask.state === "launched" ? "started today, in the background" : "asked today";
  const unfinished = last !== undefined && last.state === "begun" ? `; dream ${last.id} is begun and not yet journaled` : "";
  const said = setting === "auto" ? 'auto (the first session of each day starts the nightly run in the background; say "no dreams", or counterparts dream --setting off, to turn it off)' : setting;
  return [
    finding("dreaming", "green", "Dreaming", `${said}; ${when === null ? "has not dreamed yet" : `last dreamed ${when}${last?.title ? ` — "${last.title}"` : ""}`}; ${today}${unfinished}`, "", { setting, last: when, dream: last?.id ?? null, ask: ask?.state ?? null })
  ];
}
export function nightRunFindings(input, store) {
  let setting;
  let run;
  let now;
  try {
    setting = dreamingSetting(store);
    run = nightRunOf(store);
    now = store.now();
  } catch {
    return [];
  }
  if (run === null) {
    if (setting !== "auto")
      return [];
    return [finding("night-run", "green", "Nightly run", "auto; no headless run yet — the first session of a day with enough new memory, or with write-ups owed from an earlier day, starts one", "", { setting, state: null })];
  }
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
    ...cu === null ? {} : { catchUp: cu.state, writtenUp: cu.written, writeUpParts: cu.parts, leftOwed: cu.left }
  };
  const mins = (ms) => `${String(Math.max(1, Math.round(ms / 60000)))} min`;
  const took = run.endedAt === null ? "" : ` after ${mins(run.endedAt - run.startedAt)}`;
  const skipped = dreamSkippedOf(run);
  const what = run.kind === "reflection" ? "the reflection alone" : skipped !== null ? `the catch-up alone; ${dreamSkippedWords(skipped)}` : "the whole night";
  if (run.state === "done") {
    const ids = [run.dream, run.reflection].filter((x) => x !== null).join(", ");
    return [finding("night-run", "green", "Nightly run", `${setting}; last run ${run.date} (${what}) finished${took}${ids.length > 0 ? ` — ${ids}` : ""}${caught}`, "", data)];
  }
  if (run.state === "partial") {
    const why = run.reason === "unfinished" ? "" : ` (${nightRunWords(run)})`;
    return [
      finding("night-run", setting === "auto" ? "amber" : "green", "Nightly run", `${setting}; the run of ${run.date} (${what}) was partial${took}: ${nightPartsWords(run)}${why}${caught}`, "Nothing to do by hand: a later session picks up what did not run — a dream cut off is resumed, a reflection cut off runs alone.", { ...data, parts: (run.parts ?? []).join(",") })
    ];
  }
  if (run.state === "started") {
    const lost = nightRunLost(run, now);
    return [
      finding("night-run", lost && setting === "auto" ? "amber" : "green", "Nightly run", lost ? `${setting}; the run of ${run.date} started ${mins(now - run.startedAt)} ago and never reported an end — its process went away (a sleep, a restart, a kill)` : `${setting}; running now (${what}), started ${mins(now - run.startedAt)} ago`, lost ? "The next session asks instead of starting another headless run. If this repeats, run claude -p once by hand in a terminal to see whether it hangs (a login, an update prompt)." : "", data)
    ];
  }
  const words = nightRunWords(run);
  const ended = run.state === "could-not-start" ? "could not start" : run.state === "timed-out" ? "timed out" : "failed";
  const fix = run.reason === "no-claude" ? "The headless run starts claude -p: put the claude command on the PATH the hooks see, or set dreaming to ask (counterparts dream --setting ask)." : run.reason === "quick-exit" ? "Run claude -p once by hand in a terminal to see why it stops (a login, an update prompt). Meanwhile the session asks instead." : run.reason === "nothing-ran" ? "The headless run needs the counterparts MCP server registered for claude at user scope (claude mcp list shows it); the server's own mcp.session rows say whether it refused the session." : "A later session starts it again, or asks when it cannot. counterparts dream --setting ask stops the headless runs.";
  return [finding("night-run", setting === "auto" ? "amber" : "green", "Nightly run", `${setting}; the run of ${run.date} (${what}) ${ended}${took}: ${words}${caught}`, fix, data)];
}
export function selfPageFindings(store) {
  const page = readSelfPage(store);
  if (page === null) {
    const cleared = clearedPage(store);
    if (cleared !== null) {
      return [
        finding("self-page", "green", "Self page", `cleared ${cleared.on === "" ? "(date unrecorded)" : `on ${cleared.on}`}` + `${cleared.reason === "" ? "" : ` — ${cleared.reason}`}; ${cleared.versions} version${cleared.versions === 1 ? "" : "s"} kept`, cleared.versions > 0 ? `Put one back with: counterparts self-page --restore ${cleared.newest}.` : "", { present: false, cleared: true, on: cleared.on, versions: cleared.versions })
      ];
    }
    return [
      finding("self-page", "green", "Self page", "not written yet — still forming", "", { present: false, cleared: false })
    ];
  }
  const stale = pageStaleOn(page.revisedOn, store.today(), SELF_TUNABLES.PAGE_STALE_DAYS);
  const room = SELF_TUNABLES.PAGE_ROOM_BYTES;
  const overRoom = page.bytes > room;
  const shown = lastPageRung(store);
  const said = shown === null ? "" : `; the last wake showed ${PAGE_RUNG_WORDS[shown] ?? shown}`;
  const detail = `${page.bytes} bytes${overRoom ? ` (past its ${String(room)}-byte room)` : ""}, version ${page.version}` + `${page.short === null ? "" : `, with a ${String(page.short.bytes)}-byte short version`}, last revised ${page.revisedOn === "" ? "(unrecorded)" : page.revisedOn}` + `${page.by === null ? "" : ` by ${page.by}`}${said}`;
  const data = {
    present: true,
    bytes: page.bytes,
    version: page.version,
    revisedOn: page.revisedOn,
    stale,
    wakeShowsAll: !overRoom,
    room,
    hasShort: page.short !== null,
    rung: shown,
    daysSince: calendarDaysSince(page.revisedOn, store.today()),
    staleAfter: SELF_TUNABLES.PAGE_STALE_DAYS
  };
  const short = shown === "outline" || shown === "headings" || shown === "line" || shown === "none";
  const fix = !short ? "" : overRoom ? `Sessions are not reading the page whole. Give it a short version under ${String(room)} bytes (the self_page tool's \`short\`), or bring it under ${String(room)} bytes: counterparts self-page --write.` : `The page is within its room, so the wake's ceiling is too small for it: raise injectionBudgetBytes in the configuration (9000 is the default), or give the page a short version.`;
  return [
    stale ? finding("self-page", "amber", "Self page", `${detail} — stale (over ${SELF_TUNABLES.PAGE_STALE_DAYS} days)`, `Nothing has revised it lately: check the page writer, or amend it yourself with counterparts self-page --write.${fix === "" ? "" : ` ${fix}`}`, data) : short ? finding("self-page", "amber", "Self page", detail, fix, data) : finding("self-page", "green", "Self page", detail, "", data)
  ];
}
const PAGE_RUNG_WORDS = {
  whole: "it whole",
  short: "its short version",
  outline: "only each section's heading and first sentence",
  headings: "only its section headings",
  line: "one line about it",
  none: "nothing of it — no room even for a line"
};
function lastPageRung(store) {
  try {
    const row = store.eventLog({ name: SELF_BRIEFING_EVENT, order: "desc", limit: 1 })[0];
    if (row === undefined)
      return null;
    const page = JSON.parse(row.payload ?? "{}")["page"];
    if (typeof page !== "object" || page === null)
      return null;
    const rung = page["rung"];
    return typeof rung === "string" && rung.length > 0 ? rung : null;
  } catch {
    return null;
  }
}
export function pageWriterFindings(store, config) {
  const mode = pageWriterMode(config);
  const { today, about } = pageWriterNight(store);
  const last = lastPageWriterRun(store);
  const page = readSelfPage(store);
  const data = {
    mode,
    lastAbout: last?.about ?? "",
    lastOutcome: last?.outcome ?? "",
    ran: last !== null
  };
  const ignored = config.pageWriter?.ignored ?? [];
  if (ignored.length > 0) {
    return [
      finding("page-writer", "amber", "Page writer", `${mode} mode; ${ignored.join("; ")}`, "Fix the pageWriter block in claude-code.json. Nothing else in the file was affected, and memory is unaffected.", { ...data, ignored: ignored.join(" | ") })
    ];
  }
  if (mode === "off") {
    return [
      finding("page-writer", "green", "Page writer", page === null ? "off — nothing writes the self page on its own, and nothing has been written by hand either" : "off — the page stands, and from here it changes only when somebody writes it", "", data)
    ];
  }
  if (last === null) {
    const young = !hasDayBefore(store, dayBefore(about, -1));
    return [
      finding("page-writer", "green", "Page writer", young ? `${mode} mode; never run — this store has no day before ${today} yet` : `${mode} mode; never run — it is the first part of the next nightly run, before the dream (${about})${dreamingSetting(store) === "off" ? "; dreaming is off, so the nightly run does not start" : ""}`, "", { ...data, young })
    ];
  }
  const status = pageWriterStatus(store, last.about, today);
  const when = `last ran for ${last.about}${last.on === "" ? "" : ` on ${last.on}`}`;
  const owed = pageWriterDue(store, {
    mode,
    today,
    about,
    observer: store.observer,
    asksPerDay: SELF_TUNABLES.PAGE_WRITER_ASKS_PER_DAY
  });
  const staleFor = last.on === "" ? 0 : daysBetween(last.on, today);
  const ranSince = last.on !== "" ? dreamsBetween(store, last.on, today) : 0;
  const overdue = owed.due && staleFor > PAGE_WRITER_STALE_DAYS && ranSince > 0;
  const bad = status.outcome === "failed" || status.outcome === "refused";
  const detail = `${mode} mode; ${when} — ${status.outcome}` + (status.derived ? " (derived: it was handed the day and wrote nothing)" : "") + (status.run !== null && status.run.detail.length > 0 && !status.derived ? `, ${status.run.detail}` : "") + (owed.due ? `; ${owed.about} is owed` : "") + (overdue ? ` and nothing has been delivered for ${String(staleFor)} days` : "");
  return [
    finding("page-writer", bad || overdue ? "amber" : "green", "Page writer", detail, bad || overdue ? "counterparts mechanisms --all --dir <store> --observer shows the run's own row. The page writer is the first part of the nightly run, before the dream: counterparts dream shows whether the runs are happening and how each ended. counterparts self-page --write amends the page by hand meanwhile." : "", {
      ...data,
      outcome: status.outcome,
      derived: status.derived,
      owedFor: owed.due ? owed.about : "",
      staleFor
    })
  ];
}
export const PAGE_WRITER_STALE_DAYS = 2;
function dreamsBetween(store, after, before) {
  try {
    return store.dreams({ limit: 50 }).filter((d) => d.state !== "undone" && d.date !== null && d.date > after && d.date < before).length;
  } catch {
    return 0;
  }
}
function clearedPage(store) {
  const id = findPageRow(store);
  if (id === null)
    return null;
  let marker = null;
  try {
    marker = clearedMarker(store.readProse(id).meta);
  } catch {
    return null;
  }
  if (marker === null)
    return null;
  const versions = store.versions(id);
  const newest = versions.reduce((n, v) => Math.max(n, v.seq), 0);
  return { ...marker, versions: versions.length, newest };
}
function pageStaleOn(revisedOn, today, limit) {
  const days = calendarDaysSince(revisedOn, today);
  return days === null ? true : days > limit;
}
function calendarDaysSince(revisedOn, today) {
  const on = revisedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || !/^\d{4}-\d{2}-\d{2}$/.test(today))
    return null;
  const a = Date.parse(`${on}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b))
    return null;
  return Math.round((b - a) / 86400000);
}
