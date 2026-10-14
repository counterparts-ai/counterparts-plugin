import { spawnSync } from "node:child_process";
import { addDays, isDay, localDate, resolveZone, startOfLocalDay } from "../../core/time.js";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADAPTER_ASK_EVENT,
  BOUNDARY_EVENT,
  EMBED_BACKFILL_EVENT,
  ENVELOPE_GAVE_WAY_EVENT,
  ENVELOPE_OVERCAP_EVENT,
  INJECTION_OVERBUDGET_EVENT,
  NOTICE_DROPPED_EVENT,
  GATE_CHUNK_EVENT,
  GATE_DEPOSIT_EVENT,
  HOOK_CLAIM_LOST_EVENT,
  MCP_OVERSIZE_EVENT,
  MCP_PART_EVENT,
  MCP_SPILLED_EVENT,
  RECALL_CREDIT_EVENT,
  RUNNER_FAILED_EVENT,
  SELF_BRIEFING_EVENT,
  SLEEP_CYCLE_EVENT,
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_TAKEN_EVENT,
  SPAWN_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  SPAWN_STARTED_EVENT,
  SWEEP_GATE_EVENT,
  WAKE_DELIVERED_EVENT
} from "../../core/counterpart.js";
import { Counterpart } from "../../core/counterpart.js";
import {
  STORE_CREATED_KEY,
  Store,
  isSelfRelevantFeeling,
  paths
} from "../../core/store/index.js";
import { heldCorrections } from "../../core/reconsolidation.js";
import { bundledModelDir } from "../runtime.js";
import { acceptsReflectedFeeling, laterFeelingWasAwake, laterFeelingWasReflections, selfRelevantFeeling } from "../../core/sleep/index.js";
import { TUNABLES as ASSOCIATE_TUNABLES, isDead, pairKey } from "../../core/associate/index.js";
import { SELF_TUNABLES } from "../../core/self/tunables.js";
import { WORK_OVERFLOW_EVENT } from "../../core/self/work.js";
import { HANDOFF_REFUSED_EVENT } from "../../core/handoff/index.js";
import { LAST_HERE_NOROOM_EVENT } from "../../core/handoff/last-here.js";
import { TOOL_RESULT_CEILING } from "../../core/fit/index.js";
import { awakeFeelingCounts, nightRunOf } from "../../core/dream/index.js";
import { STATE_MEANING, daysBetween, firedReport } from "../fired.js";
import { CONFIG_ENV } from "../config-path.js";
import {
  DEFAULT_KEEP,
  futureNamesIn,
  keepOf,
  readSnapshotsDir,
  resolveSnapshotsDir
} from "../snapshots.js";
import { TUNABLES, resolveEmbedder, retentionClocks, withEmbedderDefault } from "../config.js";
import { MODEL_FILE, STATIC_WEIGHTS_ENV, STATIC_WEIGHTS_PACKAGE, resolveStaticWeights } from "../../core/embed/static.js";
import { DATABASE_FILE, heldExits, readRollbackHold, rollbackHeld } from "../../core/store/index.js";
import { TUNABLES as REMEMBER_TUNABLES, lastRetentionRun } from "../../core/remember/index.js";
import { DESKTOP_HOST } from "../hosts.js";
import { localStamp } from "../../core/time.js";
import { CLAIMS_DIR, claimsSetAside } from "./claim.js";
import { LOG_DAYS, logReading } from "../log/index.js";
import { finding, tilde, payloadOf, str, num, off, newestRows, undetermined } from "./doctor-finding.js";
import { checkoutFindings } from "./doctor-checkout.js";
import { openFindings, journalFindings, journalCopyFindings } from "./doctor-open.js";
import {
  metaJson,
  metaNum,
  MARK_ROWS,
  upgradeV8Findings,
  upgradeV9Findings,
  upgradeV10Findings,
  upgradeV11Findings
} from "./doctor-upgrades.js";
import {
  selfPageFindings,
  pageWriterFindings,
  dreamingFindings,
  nightRunFindings
} from "./doctor-self-page.js";
import { hostFindings, runtimeFindings, desktopFindings } from "./doctor-host.js";
import { readOwed, crashWriteUpFindings } from "./doctor-write-ups.js";
import { worstFirst } from "./doctor-report.js";
export { SEVERITIES } from "./doctor-finding.js";
export {
  CHECKOUT_TIMEOUT_MS,
  CHECKOUT_BUDGET_MS,
  ORIGIN_MASTER,
  readCheckout,
  checkoutIsGraded
} from "./doctor-checkout.js";
export { probePreMigration, readCounterpartOpen, journalCopyFindings } from "./doctor-open.js";
export {
  upgradeV8Findings,
  upgradeV9Findings,
  upgradeV10Findings,
  upgradeV11Findings
} from "./doctor-upgrades.js";
export {
  dreamingFindings,
  nightRunFindings,
  selfPageFindings,
  pageWriterFindings,
  PAGE_WRITER_STALE_DAYS
} from "./doctor-self-page.js";
export { WRITE_UP_LAPSE_WINDOW_DAYS } from "./doctor-write-ups.js";
export {
  tierOf,
  worstFirst,
  gradeWord,
  tally,
  summaryLine,
  reportLines,
  findingLines,
  reportJson,
  anyRed,
  NOTICE_TAIL,
  NOTICE_MAX_CHARS,
  noticeMessage
} from "./doctor-report.js";
export const SESSION_NOTICE_BUDGET_MS = 150;
const PLUGIN_UPDATE = "in Claude Code, /plugin → Installed → counterparts → Update now (or uninstall it and install it again)";
function byInstall(input, npm, plugin = PLUGIN_UPDATE) {
  const route = input.install ?? "either";
  if (route === "npm")
    return npm;
  if (route === "plugin")
    return plugin;
  return `npm: ${npm} · plugin: ${plugin}`;
}
function behindFinding(dir, m) {
  if (rollbackHeld(dir) !== null) {
    return finding("store", "amber", MEMORY_TITLE, `${tilde(dir)} is on schema v${m.found}, rolled back; this version leaves it alone (see Rollback)`, "", { dir, exists: true, found: m.found, expected: m.expected, rolledBack: true });
  }
  return finding("store", "amber", MEMORY_TITLE, `${tilde(dir)} is on schema v${m.found}; this build reads it once a session has upgraded it (see Store open)`, "", { dir, exists: true, found: m.found, expected: m.expected });
}
let readingZone = resolveZone(undefined);
function rowDate(row) {
  if (row === undefined)
    return null;
  const p = payloadOf(row);
  return typeof p["date"] === "string" && p["date"].length > 0 ? p["date"] : localDate(row.at, readingZone);
}
function budgetTruncatedPhases(p) {
  const phases = p["phases"];
  if (!Array.isArray(phases))
    return [];
  const out = [];
  for (const entry of phases) {
    if (entry === null || typeof entry !== "object")
      continue;
    const e = entry;
    if (e["budgetExhausted"] !== true)
      continue;
    const name = str(e, "phase") ?? "a phase";
    const left = num(e, "skippedForBudget");
    out.push(left === null ? `${name} ran out of budget` : `${name} ran out of budget (${String(left)} rows not reached this run)`);
  }
  return out;
}
function unreadableClause(keys) {
  if (keys === undefined || keys.length === 0)
    return "";
  const known = keys.map((k) => k === "embedder.kind" ? 'embedder.kind — it must be "static"' : k === "embedder.enabled" ? "embedder.enabled — it must be true or false" : k === "embedder" ? "embedder — it must be an object" : k);
  return ` (${known.join("; ")})`;
}
function ceilingClause(config) {
  const bytes = config.injectionBudgetBytes;
  if (bytes === undefined)
    return "; no wake ceiling, so no wake is composed";
  return config.injectionBudgetDefaulted === true ? `; wake ceiling ${String(bytes)} bytes, Claude Code's default (the file sets no injectionBudgetBytes)` : `; wake ceiling ${String(bytes)} bytes`;
}
function configFindings(input) {
  const out = [];
  const reason = input.configReason;
  if (reason === "not-read") {
    out.push(finding("config", "amber", "Config", `not read — you named a store with --dir and no configuration, so nothing here grades ${input.configPath}: no embedder setting, no snapshot policy, no stance`, `To grade those too: counterparts doctor --config <absolute path> (or set ${CONFIG_ENV}).`, { path: input.configPath, reason }));
    const held = input.store === null ? null : memoryCount(input.store);
    const behind = input.store === null ? input.open?.migration : undefined;
    out.push(behind !== undefined ? behindFinding(input.dir, behind) : input.store === null && rollbackHalfway(input.dir) ? halfwayMemoryFinding(input.dir) : input.store === null ? finding("store", "red", MEMORY_TITLE, `no store at ${tilde(input.dir)}`, "Check the path you gave --dir.", {
      dir: input.dir,
      exists: false
    }) : finding("store", "green", MEMORY_TITLE, memoryDetail(input, held), "", {
      dir: input.dir,
      exists: true,
      memories: held
    }));
    return out;
  }
  if (reason === "absent" || reason === "unreadable") {
    out.push(finding("config", "red", "Config", `${input.configPath} — ${reason === "absent" ? "no such file" : `unreadable${unreadableClause(input.configUnreadableKeys)}, so every entry point stands down to observer`}`, reason === "absent" ? "Run: counterparts install (or point --config at the file you meant)." : "Fix the JSON, or restore it from claude-code.json.bak beside it.", {
      path: input.configPath,
      reason,
      ...reason === "unreadable" && (input.configUnreadableKeys ?? []).length > 0 ? { keys: (input.configUnreadableKeys ?? []).join(",") } : {}
    }));
  } else {
    out.push(finding("config", "green", "Config", `${input.configPath} — read; dataDir ${input.config.dataDir ?? "(unset: the default store)"}${ceilingClause(input.config)}`, "", {
      path: input.configPath,
      reason: reason ?? "read-by-caller",
      dataDir: input.config.dataDir ?? null,
      ceiling: input.config.injectionBudgetBytes ?? null,
      ceilingDefaulted: input.config.injectionBudgetDefaulted === true
    }));
    const retired = input.config.retired ?? [];
    if (retired.length > 0) {
      out.push(finding("retired", "green", "Old settings", `${retired.join("; ")} — ignored; you may remove ${retired.length === 1 ? "it" : "them"} from ${tilde(input.configPath)}`, "", { count: retired.length }));
    }
  }
  const named = input.config.dataDir;
  if (input.store === null && input.open?.migration !== undefined) {
    out.push(behindFinding(input.dir, input.open.migration));
  } else if (input.store === null && rollbackHalfway(input.dir)) {
    out.push(halfwayMemoryFinding(input.dir));
  } else if (input.store === null) {
    out.push(finding("store", "red", MEMORY_TITLE, `no store at ${tilde(input.dir)}`, "Run: counterparts install, or name the store with --dir.", {
      dir: input.dir,
      exists: false
    }));
  } else if (named !== undefined && named !== input.dir) {
    out.push(finding("store", "amber", MEMORY_TITLE, `read ${tilde(input.dir)}, but ${tilde(input.configPath)} names ${tilde(named)} — the hooks read the second one`, "Drop --dir (and COUNTERPARTS_DATA_DIR) to read the store the hooks use.", { dir: input.dir, named, exists: true }));
  } else {
    const held = memoryCount(input.store);
    out.push(finding("store", "green", MEMORY_TITLE, memoryDetail(input, held), "", {
      dir: input.dir,
      exists: true,
      memories: held
    }));
  }
  if (input.config.observer === true) {
    out.push(finding("stance", "amber", "Mode", "observer — reads memory, writes nothing", 'Remove "observer" from the config to remember again.', {
      observer: true
    }));
  } else {
    const owner = input.config.owner === true;
    out.push(finding("stance", "green", "Mode", owner ? "remembering; your Claude Code sessions are the owner's (confidential memories are said in them, and an open question can be closed from any directory); a Claude Desktop chat is not; COUNTERPARTS_OWNER=0 on the memory server's launch turns it off for the memory server, and the hooks follow this configuration" : `remembering; no session is the owner's (the configuration has no "owner": true), so confidential memories stay out of the tools' answers`, "", { observer: false, owner }));
  }
  return out;
}
const MEMORY_TITLE = "Memory";
function memoryCount(store) {
  try {
    return store.countMemories({ type: "memory", archived: false });
  } catch {
    return null;
  }
}
function memoryDetail(input, n) {
  const held = n === null ? "" : ` — ${String(n)} ${n === 1 ? "memory" : "memories"}`;
  const opens = input.open?.ok === true ? ", opens fine" : "";
  return `${tilde(input.dir)}${held}${opens}`;
}
function embedderFindings(input, history, source) {
  const enabled = input.config.embedder?.enabled === true;
  const data = { enabled, everEmbedded: history.embedded, source };
  const turnOn = `Turn on: ${EMBEDDER_ON_COMMAND}`;
  if (enabled) {
    const withdrawn = withdrawnFinding(input);
    if (withdrawn !== null)
      return [withdrawn];
    return [staticFinding(input, data)];
  }
  if (history.embedded) {
    return [
      finding("embedder", "amber", RECALL_TITLE, "off — and this store HAS embedded before, so something that was running has stopped. " + "Recall still matches on words; what is gone is finding a memory that says the same thing in different words", turnOn, data)
    ];
  }
  return [
    off("embedder", RECALL_TITLE, "switched off in the configuration. Recall works on words; the local table lets it match meaning too, and nothing leaves this machine.", turnOn, data)
  ];
}
const RECALL_TITLE = "Recall by meaning";
export const EMBEDDER_ON_COMMAND = "counterparts install --force --embedder";
function weightsFrom(source) {
  if (source === "package")
    return `the ${STATIC_WEIGHTS_PACKAGE} package`;
  if (source === "env")
    return STATIC_WEIGHTS_ENV;
  if (source === "option")
    return "a directory named by the caller";
  return source;
}
function withdrawnFinding(input) {
  let v;
  try {
    v = input.store?.embedderVerdict;
  } catch {
    return null;
  }
  if (v === undefined)
    return null;
  if (v.kind === "held") {
    const from = v.recorded ?? "an older build that did not tag them (0.2.0 or earlier)";
    return finding("embedder", "amber", RECALL_TITLE, `held — the store holds ${v.rows} vectors from ${from}, and the configuration asks for ${v.configured ?? "another model"}; ` + "nothing is embedded or matched by meaning until they are dropped. Recall still matches on words", `To match by meaning again, ${heldExits(v.recorded).replace("<store>", tilde(input.dir))}.`, { held: true, recorded: v.recorded, configured: v.configured, rows: v.rows });
  }
  if (v.kind === "cache-ahead") {
    return finding("embedder", "amber", RECALL_TITLE, `off in this process — the store's cache was written by a newer Counterparts (cache v${v.found}; this build reads v${v.expected}). Recall still matches on words`, `Either install the newer build again (${byInstall(input, "bun add -g counterparts@latest", "in Claude Code, /plugin → Installed → counterparts → Update now")}), or, to stay on this one, delete ${tilde(input.dir)}/cache/cache.sqlite* (the search cache alone; no memory is kept there, and it is rebuilt) — then in Claude Code run /mcp → Reconnect so the server opens it.`, { cacheAhead: true, found: v.found, expected: v.expected });
  }
  return null;
}
function staticFinding(input, data) {
  const install = `Install the table: ${byInstall(input, `bun add -g ${STATIC_WEIGHTS_PACKAGE}`, `${PLUGIN_UPDATE}; the plugin installs the table with npm, so with no npm on this computer install Node.js (https://nodejs.org) first`)} — or set ${STATIC_WEIGHTS_ENV} in the environment Claude Code starts hooks with`;
  const row = newestBackfill(input);
  if (row !== null && str(row, "reason") === "embedder-unavailable") {
    const code = str(row, "codes") ?? "NO_WEIGHTS";
    return finding("embedder", "amber", RECALL_TITLE, `on (a local table), but the worker could not load its weights (${code}) — nothing is embedded; recall still matches on words`, code === "HASH_MISMATCH" ? `The table on disk is not the one its package declares. Reinstall it: ${byInstall(input, `bun add -g ${STATIC_WEIGHTS_PACKAGE}`)}` : install, { ...data, kind: "static", code });
  }
  if (row !== null && str(row, "kind") === "static" && str(row, "weights") !== null) {
    return finding("embedder", "green", RECALL_TITLE, `on — a local table (${str(row, "model") ?? "static"}, weights from ${weightsFrom(String(str(row, "weights")))}); nothing leaves this machine`, "", { ...data, kind: "static", weights: str(row, "weights") });
  }
  const bundled = bundledModelDir();
  const found = resolveStaticWeights(bundled === undefined ? {} : { packageDir: bundled });
  if (found === null || !existsSync(join(found.dir, MODEL_FILE))) {
    return finding("embedder", "amber", RECALL_TITLE, found === null ? "on (a local table), but its weights were not found — nothing will be embedded; recall still matches on words" : `on (a local table), but its weights were not found in ${tilde(found.dir)} (named by ${weightsFrom(found.source)}) — nothing will be embedded; recall still matches on words`, install, { ...data, kind: "static", weights: null });
  }
  return finding("embedder", "green", RECALL_TITLE, `on — a local table (weights from ${weightsFrom(found.source)}); nothing leaves this machine (the hooks confirm it when a session ends)`, "", { ...data, kind: "static", weights: found.source });
}
function newestBackfill(input) {
  const store = input.store;
  if (store === null)
    return null;
  try {
    const read = newestRows(store, EMBED_BACKFILL_EVENT, 1, store.livedDay());
    const row = read.rows[0];
    return row === undefined ? null : payloadOf(row);
  } catch {
    return null;
  }
}
export function keyHistory(store) {
  if (store === null)
    return { embedded: false };
  try {
    return {
      embedded: store.eventLog({ name: EMBED_BACKFILL_EVENT, limit: KEY_HISTORY_ROWS }).some((r) => (num(payloadOf(r), "embedded") ?? 0) > 0)
    };
  } catch {
    return { embedded: false };
  }
}
function livedABoundary(store) {
  try {
    return store.eventLog({ name: EMBED_BACKFILL_EVENT, limit: 1 }).length > 0 || store.eventLog({ name: SWEEP_GATE_EVENT, limit: 1 }).length > 0;
  } catch {
    return true;
  }
}
const KEY_HISTORY_ROWS = 200;
function retentionFindings(input, store) {
  const TITLE = "Raw transcripts";
  const clocks = retentionClocks(input.config);
  const days = clocks.afterWriteUpDays;
  const policy = `deleted ${String(days)} day${days === 1 ? "" : "s"} after a session is written up and ended, never kept more than ${String(clocks.maxDays)} · never in backups`;
  const run = lastRetentionRun(store);
  const base = { retentionDays: days, maxDays: clocks.maxDays };
  const ignored = input.config.retention?.ignored ?? [];
  if (ignored.length > 0) {
    return [
      finding("retention", "amber", TITLE, `${policy} · the configuration's retention block was partly ignored: ${ignored.join("; ")}`, `Fix "retention" in ${tilde(input.configPath)}: whole days, at least 1.`, { ...base, ran: run !== null, ignored: ignored.length })
    ];
  }
  if (run === null) {
    return [finding("retention", "green", TITLE, `${policy} · not run yet`, "", { ...base, ran: false })];
  }
  const data = {
    ...base,
    ran: true,
    date: run.date,
    reason: run.reason,
    deleted: run.deleted,
    keptOwed: run.keptOwed,
    keptYoung: run.keptYoung,
    keptLive: run.keptLive,
    failed: run.failed
  };
  const unfinished = run.reason === "STARTED" || run.reason === "LATCH_HELD";
  if (unfinished && run.date < input.today) {
    return [
      finding("retention", "amber", TITLE, `${policy} · the pass on ${run.date} started and did not finish, and none has run since`, "Nothing is deleted without a finished pass. It runs again when a session ends; to watch it: counterparts doctor --all", data)
    ];
  }
  if (unfinished) {
    return [finding("retention", "green", TITLE, `${policy} · a pass started today`, "", data)];
  }
  const counts = `${String(run.deleted)} pruned ${run.date} · ${String(run.keptOwed)} kept until written up · ${String(run.keptLive)} still open`;
  if (run.failed > 0) {
    return [
      finding("retention", "amber", TITLE, `${policy} · ${counts} · ${String(run.failed)} could not be deleted`, `The next pass tries again. Check the folder is writable: ls -ld ${tilde(input.dir)}/spans`, data)
    ];
  }
  return [finding("retention", "green", TITLE, `${policy} · ${counts}`, "", data)];
}
function zoneNote(input) {
  const unknown = input.config.timeZoneUnknown;
  return unknown === undefined ? `(${readingZone})` : `(${readingZone}; timeZone "${unknown}" in the config is not a zone this machine knows, so it was ignored)`;
}
function clockFindings(input, store) {
  const livedDay = store.livedDay();
  const raw = store.getMeta("lastActiveDate");
  const lastActive = raw === undefined || raw.length === 0 ? null : raw;
  const read = newestRows(store, BOUNDARY_EVENT, 1, livedDay);
  const boundary = rowDate(read.rows[0]);
  const data = { livedDay, lastActiveDate: lastActive, newestBoundary: boundary, today: input.today };
  if (read.unknown) {
    const facts = `day ${livedDay} of use, lastActiveDate ${lastActive ?? "(unset)"}, today ${input.today} ${zoneNote(input)} — ` + undetermined(BOUNDARY_EVENT);
    return [finding("clock", "green", "Clock", facts, "", data)];
  }
  const facts = `day ${livedDay} of use, lastActiveDate ${lastActive ?? "(unset)"}, ` + `last session end ${boundary ?? "(none)"}, today ${input.today} ${zoneNote(input)}`;
  if (boundary !== null && (lastActive === null || lastActive < boundary)) {
    return [
      finding("clock", "amber", "Clock", `${facts} — sessions are reaching boundaries and the clock is not advancing: the worker is not running`, "Read the Spawn line below; a refused spawn is the usual cause.", data)
    ];
  }
  return [finding("clock", "green", "Clock", facts, "", data)];
}
function boundaryAge(store, today) {
  const rows = store.eventLog({ name: BOUNDARY_EVENT, limit: 4000 });
  if (rows.length === 0)
    return "never";
  if (rows.length >= 4000)
    return "earlier";
  return rows.some((r) => {
    const d = rowDate(r);
    return d !== null && d < today;
  }) ? "earlier" : "today";
}
function rowFindings(input, store) {
  const livedDay = store.livedDay();
  const out = [];
  const age = boundaryAge(store, input.today);
  const absent = (key, title, what, fix) => age === "earlier" ? finding(key, "amber", title, what, fix, { rows: 0 }) : finding(key, "green", title, age === "today" ? `${what} — the first night run starts today and writes this when it finishes` : `${what} — and no session has ended here yet`, "", { rows: 0 });
  const unread = (key, title, name) => finding(key, "green", title, undetermined(name), "", { unknown: true });
  const sweepRead = newestRows(store, SWEEP_GATE_EVENT, 1, livedDay);
  const sweep = sweepRead.rows[0];
  if (sweepRead.unknown) {
    out.push(unread("sweep", "Sweep", SWEEP_GATE_EVENT));
  } else if (sweep === undefined) {
    out.push(absent("sweep", "Sweep", "no sweep.gate row — no worker has reached the crash sweep here", "Read the Spawn line below."));
  } else {
    const p = payloadOf(sweep);
    const reason = str(p, "reason") ?? "(none)";
    const detail = `newest sweep.gate ${rowDate(sweep) ?? "?"}: reason ${reason}, ran ${num(p, "ran") ?? 0} of ${num(p, "scopes") ?? 0} scopes`;
    const nextSession = reason === "not-opted-in" || reason === "no-credential";
    out.push(reason === "ran" ? finding("sweep", "green", "Sweep", detail, "", { reason, ran: num(p, "ran"), date: rowDate(sweep) }) : nextSession ? finding("sweep", "green", "Sweep", `${detail} — a session that ended unwritten is caught up later (counterparts catch-up)`, "", { reason, ran: num(p, "ran"), date: rowDate(sweep) }) : finding("sweep", "amber", "Sweep", detail, "The sweep stood down; the reason names why.", {
      reason,
      ran: num(p, "ran"),
      date: rowDate(sweep)
    }));
  }
  const cycleRead = newestRows(store, SLEEP_CYCLE_EVENT, 1, livedDay);
  const cycle = cycleRead.rows[0];
  if (cycleRead.unknown) {
    out.push(unread("sleep", "Sleep", SLEEP_CYCLE_EVENT));
  } else if (cycle === undefined) {
    out.push(absent("sleep", "Sleep", "no sleep.cycle row — no cycle has run here since the rows existed", "Read the Spawn line below."));
  } else {
    const p = payloadOf(cycle);
    const reason = str(p, "reason") ?? "(none)";
    const failed = num(p, "failed") ?? 0;
    const truncated = budgetTruncatedPhases(p);
    const detail = `newest sleep.cycle ${rowDate(cycle) ?? "?"}: reason ${reason}, ${failed} failed phase${failed === 1 ? "" : "s"}` + (str(p, "failedPhase") === null ? "" : `, died in ${String(str(p, "failedPhase"))}`) + (truncated.length === 0 ? "" : `; ${truncated.join(", ")}`);
    const data = { reason, failed, date: rowDate(cycle), budgetTruncated: truncated.length };
    out.push(reason !== "ran" ? finding("sleep", "red", "Sleep", detail, "The nightly cycle is not completing — decay, prune, dedup and consolidate are not running.", data) : failed > 0 ? finding("sleep", "amber", "Sleep", detail, "A phase failed; the row names it.", data) : finding("sleep", "green", "Sleep", detail, "", data));
  }
  const backfillRead = newestRows(store, EMBED_BACKFILL_EVENT, 2, livedDay);
  const backfills = backfillRead.rows;
  const newest = backfills[backfills.length - 1];
  if (backfillRead.unknown) {
    out.push(unread("backfill", "Backfill", EMBED_BACKFILL_EVENT));
  } else if (newest === undefined) {
    out.push(absent("backfill", "Backfill", "no adapter.embed.backfill row — nothing has been embedded here", "Read the Recall by meaning line."));
  } else {
    const p = payloadOf(newest);
    const embedded = num(p, "embedded") ?? 0;
    const failed = num(p, "failed") ?? 0;
    const detail = `newest backfill ${rowDate(newest) ?? "?"}: embedded ${embedded}, failed ${failed}, ` + `remaining ${num(p, "remaining") ?? 0}, skipped ${num(p, "skipped") ?? 0}` + (str(p, "codes") === null || str(p, "codes") === "" ? "" : `, codes ${String(str(p, "codes"))}`);
    const prior = backfills.length > 1 ? payloadOf(backfills[0]) : null;
    const stalledTwice = embedded === 0 && failed > 0 && prior !== null && (num(prior, "embedded") ?? 0) === 0 && (num(prior, "failed") ?? 0) > 0;
    const data = { embedded, failed, remaining: num(p, "remaining"), skipped: num(p, "skipped"), codes: str(p, "codes"), date: rowDate(newest) };
    const why = str(p, "reason");
    const idle = why === "vectors-withdrawn" || why === "embedder-unavailable";
    out.push(idle ? finding("backfill", "amber", "Backfill", `${detail} — ${why === "vectors-withdrawn" ? "the store has withdrawn the vector channel" : "the embedder could not be built"}, so nothing was tried`, "Read the Recall by meaning line.", { ...data, reason: why }) : stalledTwice ? finding("backfill", "red", "Backfill", `${detail} — and the run before it embedded nothing too`, "The backfill is head-of-line blocked; the codes name the fault (see I33).", data) : failed > 0 ? finding("backfill", "amber", "Backfill", detail, "Some chunks failed; the codes name why.", data) : finding("backfill", "green", "Backfill", detail, "", data));
  }
  const creditRead = newestRows(store, RECALL_CREDIT_EVENT, CREDIT_ROWS_BACK, livedDay);
  const credit = [...creditRead.rows].reverse().find((r) => payloadOf(r)["source"] !== DREW_ON_SOURCE) ?? creditRead.rows[creditRead.rows.length - 1];
  if (creditRead.unknown) {
    out.push(unread("credit", "Credit", RECALL_CREDIT_EVENT));
  } else if (credit !== undefined) {
    const p = payloadOf(credit);
    const reason = str(p, "reason") ?? "(none)";
    const drewOn = drewOnWeek(store, livedDay);
    const detail = `newest recall.credit ${rowDate(credit) ?? "?"}: reason ${reason}, credited ${num(p, "credited") ?? 0} of ${num(p, "considered") ?? 0} considered` + (drewOn.calls === 0 ? "" : `; drewOn ${drewOn.credited} credited of ${drewOn.named} named in ${drewOn.calls} call${drewOn.calls === 1 ? "" : "s"} over ${DREW_ON_DAYS} days`);
    const data = {
      reason,
      credited: num(p, "credited"),
      considered: num(p, "considered"),
      date: rowDate(credit),
      drewOnCalls: drewOn.calls,
      drewOnNamed: drewOn.named,
      drewOnCredited: drewOn.credited
    };
    out.push(reason === "failed" ? finding("credit", "amber", "Credit", detail, "The credit seam threw; the row names the reason.", data) : finding("credit", "green", "Credit", detail, "", data));
  }
  return out;
}
const DREW_ON_SOURCE = "drewOn";
const CREDIT_ROWS_BACK = 20;
const DREW_ON_DAYS = 7;
function drewOnWeek(store, livedDay) {
  let calls = 0;
  let named = 0;
  let credited = 0;
  try {
    for (const row of store.eventLog({ name: RECALL_CREDIT_EVENT, sinceDay: Math.max(0, livedDay - (DREW_ON_DAYS - 1)), order: "desc", limit: 5000 })) {
      const p = payloadOf(row);
      if (p["source"] !== DREW_ON_SOURCE)
        continue;
      calls += 1;
      named += num(p, "considered") ?? 0;
      credited += num(p, "credited") ?? 0;
    }
  } catch {}
  return { calls, named, credited };
}
export const AUTHORSHIP_DAYS = 7;
const SESSION_ASK_CAP = "session-ask-cap";
const DAY_CHAPTER_CAP = "day-chapter-cap";
const AUTHORSHIP_LIMIT = 20000;
const STORE_STARTED_META = "store.started";
function storeFirstDay(store) {
  let first = null;
  for (const key of [STORE_CREATED_KEY, STORE_STARTED_META]) {
    const said = store.getMeta(key);
    if (said === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(said))
      continue;
    if (first === null || said < first)
      first = said;
  }
  if (first !== null)
    return first;
  const readings = [oldestEventDay(store), databaseBirthDay(store.dir)].filter((d) => d !== null);
  return readings.length === 0 ? null : readings.reduce((a, b) => b < a ? b : a);
}
function oldestEventDay(store) {
  try {
    const at = store.eventLogCensus().oldestAt;
    return typeof at === "number" && Number.isFinite(at) && at > 0 ? localDate(at, readingZone) : null;
  } catch {
    return null;
  }
}
function databaseBirthDay(dir) {
  try {
    const stat = statSync(paths.operational(dir));
    const born = stat.birthtimeMs;
    return Number.isFinite(born) && born > 0 && born < stat.ctimeMs ? localDate(born, readingZone) : null;
  } catch {
    return null;
  }
}
function windowShown(windowStart, today, firstDay) {
  if (firstDay === null)
    return windowStart;
  return firstDay > windowStart && firstDay <= today ? firstDay : windowStart;
}
function windowPhrase(shown, today) {
  return shown === today ? `since ${today}` : `${shown}→${today}`;
}
function daysBefore(today, back) {
  return isDay(today) ? addDays(today, -back) : today;
}
function rowsInWindow(store, name, livedDay, from) {
  const all = store.eventLog({
    name,
    sinceDay: Math.max(0, livedDay - AUTHORSHIP_DAYS),
    order: "desc",
    limit: AUTHORSHIP_LIMIT
  });
  return {
    rows: all.filter((r) => {
      const date = rowDate(r);
      return date !== null && date >= from;
    }),
    truncated: all.length >= AUTHORSHIP_LIMIT
  };
}
function authorshipFindings(input, store, owedReading) {
  const livedDay = store.livedDay();
  const from = daysBefore(input.today, AUTHORSHIP_DAYS - 1);
  const asks = rowsInWindow(store, ADAPTER_ASK_EVENT, livedDay, from);
  const deposits = rowsInWindow(store, GATE_DEPOSIT_EVENT, livedDay, from);
  let asked = 0;
  let capped = 0;
  let cappedBySession = 0;
  let cappedByDay = 0;
  let paced = 0;
  let unlabelled = 0;
  for (const row of asks.rows) {
    const payload = payloadOf(row);
    switch (str(payload, "outcome")) {
      case "asked":
        asked += 1;
        break;
      case "capped": {
        capped += 1;
        const reason = str(payload, "reason");
        if (reason === SESSION_ASK_CAP)
          cappedBySession += 1;
        else if (reason === DAY_CHAPTER_CAP)
          cappedByDay += 1;
        break;
      }
      case "paced":
        paced += 1;
        break;
      default:
        unlabelled += 1;
    }
  }
  const authored = store.countMemories({
    type: "memory",
    archived: false,
    source: "authored",
    learnedOnFrom: from
  });
  const fallback = store.countMemories({
    type: "memory",
    archived: false,
    source: "fallback",
    learnedOnFrom: from
  });
  const shown = windowShown(from, input.today, storeFirstDay(store));
  const span = shown === from ? "of that week" : "in that time";
  const plural = (n, one, many) => `${String(n)} ${n === 1 ? one : many}`;
  const owed = owedReading();
  const read = owed !== null && owed !== "failed" ? owed : null;
  const owedPhrase = owed === null ? "" : owed === "failed" ? "; sessions awaiting catch-up: unknown (could not be read)" : owed.waiting === 0 ? "" : `; ${plural(owed.waiting, "session", "sessions")} awaiting catch-up` + (owed.stale === 0 ? "" : `, ${String(owed.stale)} from yesterday or earlier`);
  const detail = `${windowPhrase(shown, input.today)}: invited to write ${plural(asked, "time", "times")}, ` + `${plural(paced, "Stop", "Stops")} paced out, ${String(capped)} over the day's allowance` + `${unlabelled === 0 ? "" : ` (${String(unlabelled)} older rows name no outcome)`}; ` + `${plural(deposits.rows.length, "deposit", "deposits")}; ` + `${String(authored)} live ${authored === 1 ? "memory" : "memories"} ${span} ${authored === 1 ? "is" : "are"} its own, ` + `${String(fallback)} the fallback sweep's` + owedPhrase + `${asks.truncated || deposits.truncated ? " (counts are a floor: the event read hit its limit)" : ""}`;
  const data = {
    from,
    shownFrom: shown,
    to: input.today,
    asked,
    capped,
    cappedBySession,
    cappedByDay,
    paced,
    unlabelled,
    deposits: deposits.rows.length,
    authored,
    fallback,
    owedWaiting: read?.waiting ?? null,
    owedStale: read?.stale ?? null,
    truncated: asks.truncated || deposits.truncated,
    livedDay
  };
  return [finding("authorship", "green", "Authorship", detail, "", data)];
}
function firedFindings(input, store) {
  if (input.budgetMs !== undefined) {
    return [
      finding("fired", "green", "Fired", "the roll-call of mechanisms is not read at session start: it walks the whole event log, " + "and a hook is not the place to pay for that", "", { read: false })
    ];
  }
  const report = firedReport(store, input.today);
  const c = report.counts;
  const blocked = c.blocked === 0 ? "" : `, ${String(c.blocked)} ${c.blocked === 1 ? "was" : "were"} stopped by something that said so`;
  const shown = windowShown(report.from, report.today, storeFirstDay(store));
  const roll = `${windowPhrase(shown, report.today)}: ${String(c.firing)} of ${String(report.rows.length)} mechanisms fired ` + `${shown === report.from ? "this week" : "in that time"}${blocked}, ` + `${String(c.quiet)} ${c.quiet === 1 ? "has" : "have"} gone quiet, ` + `${String(c.never)} ${c.never === 1 ? "has" : "have"} never fired, ` + `${String(c.waiting)} ${c.waiting === 1 ? "is" : "are"} waiting for an occasion (an owner's action, a failure, a reminder falling due), ` + `${String(c.done)} one-time ${c.done === 1 ? "job is" : "jobs are"} done, ` + `${String(c.new)} ${c.new === 1 ? "is" : "are"} too new to grade, ` + `${String(c.blind)} ${c.blind === 1 ? "records" : "record"} nothing durable at all` + `${c.disabled + c.retired === 0 ? "" : ` (${String(c.disabled)} stood down, ${String(c.retired)} retired)`}` + `${report.notRead.length === 0 ? "" : `; ${String(report.notRead.length)} whose evidence is a table were not read on this pass`}` + `${report.truncated ? "; counts are a floor — the event read hit its limit" : ""}`;
  const data = {
    from: report.from,
    to: report.today,
    firing: c.firing,
    blocked: c.blocked,
    quiet: c.quiet,
    never: c.never,
    new: c.new,
    waiting: c.waiting,
    done: c.done,
    blind: c.blind,
    disabled: c.disabled,
    retired: c.retired,
    notRead: report.notRead.join(","),
    truncated: report.truncated,
    wentQuiet: report.wentQuiet.join("; "),
    wentBlocked: report.wentBlocked.join("; "),
    missedOccasion: report.missedOccasion.join("; "),
    young: report.young,
    livedDay: report.livedDay
  };
  if (report.young) {
    return [
      finding("fired", "green", "Fired", `Too new to judge yet: nothing has run because you've only just started` + (c.blocked === 0 ? "" : `, though ${String(c.blocked)} was already stopped by something`), c.blocked === 0 ? "" : "Run: counterparts mechanisms --all — the blocked rows say by what.", data)
    ];
  }
  if (report.wentQuiet.length === 0 && report.wentBlocked.length === 0 && report.missedOccasion.length === 0) {
    return [
      finding("fired", "green", "Fired", `${roll}. Nothing that fired last week has fallen silent this week.`, "", data)
    ];
  }
  const changed = [
    report.wentBlocked.length === 0 ? "" : `Fired last week and STOPPED this week: ${report.wentBlocked.join("; ")}`,
    report.missedOccasion.length === 0 ? "" : `Its occasion came this week and it did not fire: ${report.missedOccasion.join("; ")}`,
    report.wentQuiet.length === 0 ? "" : `Fired last week and not once this week: ${report.wentQuiet.join("; ")}`
  ].filter((s) => s.length > 0);
  return [
    finding("fired", "amber", "Fired", `${roll}. ${changed.join(". ")}`, report.wentBlocked.length > 0 ? `Run: counterparts mechanisms --all — ${STATE_MEANING.blocked}, and the reason on the row names what to fix.` : report.missedOccasion.length > 0 ? "Run: counterparts mechanisms --all — the row says what was due and not said; its occasion came, so this silence is the mechanism failing, not resting." : `Run: counterparts mechanisms --all — ${STATE_MEANING.quiet}, which is a wiring fault more often than a verdict.`, data)
  ];
}
function spawnFindings(input, store) {
  const livedDay = store.livedDay();
  const entries = Object.entries(input.refusals).filter(([, n]) => n > 0);
  entries.sort((a, b) => b[1] - a[1]);
  const worst = entries[0];
  const clause = (name) => {
    const read = newestRows(store, name, 1, livedDay);
    if (read.unknown)
      return undetermined(name);
    const row = read.rows[0];
    return row === undefined ? null : `newest ${name} ${rowDate(row) ?? "?"} (${str(payloadOf(row), "reason") ?? "?"})`;
  };
  const rowClause = [clause(SPAWN_REFUSED_EVENT), clause(SPAWN_FAILED_EVENT), clause(RUNNER_FAILED_EVENT)].filter((s) => s !== null).join("; ");
  const counts = entries.map(([reason, n]) => `${reason} ×${n}`).join(", ");
  const starts = input.starts !== undefined && input.starts.date === input.today && input.starts.count > 0 ? input.starts.count : null;
  const startClause = starts === null ? "" : `; started ${String(starts)} ${starts === 1 ? "time" : "times"} today`;
  const data = {
    counters: counts,
    escalateAfter: TUNABLES.ESCALATE_AFTER,
    worstReason: worst?.[0] ?? null,
    worstCount: worst?.[1] ?? 0
  };
  if (worst !== undefined && worst[1] >= TUNABLES.ESCALATE_AFTER) {
    return [
      finding("spawn", "red", "Spawn", `the background worker has been refused ${worst[1]} times in a row (${worst[0]})${rowClause === "" ? "" : ` — ${rowClause}`}`, "Read the newest adapter.spawn.refused row; its reason names the door.", data)
    ];
  }
  if (entries.length > 0) {
    return [
      finding("spawn", "amber", "Spawn", `spawn refusals standing: ${counts}${rowClause === "" ? "" : ` — ${rowClause}`}`, "A spawn that starts clears every counter.", data)
    ];
  }
  let failures = [];
  try {
    failures = store.eventLog({ name: RUNNER_FAILED_EVENT, sinceDay: Math.max(0, livedDay - 2), order: "desc", limit: RUNNER_FAILED_ROWS }).reverse();
  } catch {
    failures = [];
  }
  const failed = failures[failures.length - 1];
  const failedOn = rowDate(failed);
  const started = newestRows(store, SPAWN_STARTED_EVENT, 1, livedDay).rows[0];
  const yesterday = addDays(input.today, -1);
  const stepOn = (step, date) => failures.some((r) => str(payloadOf(r), "step") === step && rowDate(r) === date);
  const repeated = failed !== undefined && stepOn(str(payloadOf(failed), "step"), input.today) && stepOn(str(payloadOf(failed), "step"), yesterday);
  const sinceStart = failed !== undefined && (failedOn === input.today || failedOn === yesterday) && (started === undefined || failed.seq > started.seq);
  if (failed !== undefined && failedOn !== null && (repeated || sinceStart)) {
    const fp = payloadOf(failed);
    return [
      finding("spawn", "amber", "Spawn", `the background worker started${startClause === "" ? "" : ` (${startClause.slice(2)})`} but failed at its ${str(fp, "step") ?? "?"} step on ${failedOn} (${str(fp, "code") ?? "?"})${rowClause === "" ? "" : ` — ${rowClause}`}`, "Nothing to do by hand: the next boundary runs the worker again. If it repeats, the process log (the Log line) has the error.", { ...data, startsToday: starts, failedStep: str(fp, "step"), failedOn })
    ];
  }
  return [
    finding("spawn", "green", "Spawn", `no spawn refusals standing${startClause}${rowClause === "" ? "" : ` (${rowClause})`}`, "", { ...data, startsToday: starts })
  ];
}
export function rollbackFindings(dir) {
  const hold = readRollbackHold(dir);
  if (hold === null)
    return [];
  const release = `counterparts rollback --dir ${dir} --upgrade-again`;
  if (rollbackHalfway(dir)) {
    return [
      finding("rollback", "red", "Rollback", `a rollback stopped before its copy went in: there is no database in ${tilde(dir)}` + (hold === "unreadable" ? "" : `; the newer store is whole in ${tilde(hold.aside)}`), `Run: counterparts rollback --dir ${dir} --undo (it puts the newer store back as it was), then roll back again if you still mean to. Don't install the older version first: it would start a blank store here.`, { dir, holds: true, halfway: true })
    ];
  }
  if (hold === "unreadable") {
    return [
      finding("rollback", "amber", "Rollback", `${tilde(dir)} carries a rollback hold that cannot be read; this version leaves the store alone while it is behind`, `Run: counterparts rollback --dir ${dir} --undo, or ${release}`, { dir, holds: true })
    ];
  }
  const day = localDate(hold.at);
  const holds = rollbackHeld(dir) !== null;
  return [
    holds ? finding("rollback", "amber", "Rollback", `rolled back from v${hold.from} to v${hold.to} on ${day} (from ${hold.snapshot}); this version neither upgrades nor reads it, so sessions on it stand down. The newer store is in ${tilde(hold.aside)}`, `Install the version you went back to, then: counterparts connect && counterparts doctor. Or, to stay on this one: ${release} (upgrades it again; what was written since the rollback is kept) or counterparts rollback --dir ${dir} --undo (the newer store comes back).`, { dir, holds: true, from: hold.from, to: hold.to, snapshot: hold.snapshot, aside: hold.aside }) : finding("rollback", "amber", "Rollback", `a rollback hold from ${day} is here, but the store is on this version's schema, so it holds nothing`, `Run: ${release} to remove it.`, { dir, holds: false, from: hold.from, to: hold.to })
  ];
}
function rollbackHalfway(dir) {
  return readRollbackHold(dir) !== null && !existsSync(join(dir, DATABASE_FILE));
}
function halfwayMemoryFinding(dir) {
  return finding("store", "red", MEMORY_TITLE, `no database at ${tilde(dir)}: a rollback stopped halfway (see Rollback)`, "", {
    dir,
    exists: false,
    rolledBack: true
  });
}
function vectorFindings(input, store) {
  if (input.config.embedder?.enabled !== true)
    return [];
  const unembedded = store.unembeddedCount();
  const skipped = store.skippedVectorIds().length;
  const detail = `${unembedded} live memories with no vector, ${skipped} skipped after repeated embed failures`;
  const data = { unembedded, skipped };
  const verdict = store.embedderVerdict.kind;
  const newest = newestBackfill(input);
  if (newest !== null && str(newest, "reason") === "embedder-unavailable") {
    const code = str(newest, "codes") ?? "NO_WEIGHTS";
    return [
      finding("vectors", "amber", "Vectors", `${detail} — the embedder could not be built (${code}), so this will not fall until it can`, "Read the Recall by meaning line.", { ...data, unavailable: code })
    ];
  }
  if (verdict === "held" || verdict === "cache-ahead") {
    return [
      finding("vectors", "amber", "Vectors", `${detail} — the vector channel is withdrawn (${verdict}), so this will not fall until that is resolved`, "Read the Recall by meaning line.", { ...data, withdrawn: verdict })
    ];
  }
  if (skipped > 0) {
    return [finding("vectors", "amber", "Vectors", detail, "counterparts verify --dir <store> --retry-skipped puts the skipped ids back in the rotation.", data)];
  }
  if (unembedded > 0 && !livedABoundary(store)) {
    const memories = unembedded === 1 ? "1 memory" : `${unembedded} memories`;
    return [finding("vectors", "green", "Vectors", `${memories} not searchable by meaning yet — this builds after your first session`, "", data)];
  }
  if (unembedded > 0) {
    return [finding("vectors", "amber", "Vectors", detail, "The backfill embeds up to 1,000 per boundary; this number must fall run over run.", data)];
  }
  return [finding("vectors", "green", "Vectors", detail, "", data)];
}
export function logFindings(input) {
  const r = logReading(input.dir, input.today);
  const failures = `${String(r.failuresToday)} failure${r.failuresToday === 1 ? "" : "s"} today`;
  const detail = r.days === 0 ? `${tilde(r.dir)} · nothing written yet` : `${tilde(r.dir)} · holds ${String(r.days)} day${r.days === 1 ? "" : "s"} (kept ${String(LOG_DAYS)}) · ${failures}`;
  return [
    finding("log", "green", "Log", detail, r.failuresToday > 0 ? "Read them: counterparts log" : "", {
      dir: r.dir,
      days: r.days,
      failuresToday: r.failuresToday,
      linesToday: r.linesToday
    })
  ];
}
const V12_UPGRADE_META = "recall.v12.upgrade";
export function writeFieldFindings(store) {
  let share = null;
  let links = null;
  const upgrade = metaJson(store, V12_UPGRADE_META);
  const since = upgrade === null ? null : metaNum(upgrade["at"]) || null;
  try {
    share = store.writeFieldShare(since);
    links = store.subjectLinkCount();
  } catch {
    return [];
  }
  if (share === null)
    return [];
  const pct = (n) => share === null || share.written === 0 ? "0%" : `${String(Math.round(100 * n / share.written))}%`;
  const when = since === null ? "" : ` since the v12 upgrade (${localDate(since, readingZone)})`;
  const linked = links === null ? "" : `; subject links: ${String(links.links)} on ${String(links.memories)} ${links.memories === 1 ? "memory" : "memories"}`;
  const detail = share.written === 0 ? `no memory written${when} by remember, session_end or a dream gist yet${linked}` : `of ${String(share.written)} ${share.written === 1 ? "memory" : "memories"} written${when} by remember, session_end or a dream gist — when it happened ${pct(share.occurredOn)}, who said it ${pct(share.saidBy)}, what kind ${pct(share.status)}, all three ${pct(share.all)}${linked}`;
  return [
    finding("write-fields", "green", "Write fields", detail, "", {
      written: share.written,
      occurredOn: share.occurredOn,
      saidBy: share.saidBy,
      status: share.status,
      all: share.all,
      since: since ?? 0,
      links: links?.links ?? 0,
      linkedMemories: links?.memories ?? 0
    })
  ];
}
export function claimsEraFindings(store) {
  let era;
  try {
    era = store.claimsEra();
  } catch {
    return [];
  }
  if (era.cutoff === null && era.recorded === null)
    return [];
  const n = (k) => `${String(k)} ${k === 1 ? "memory" : "memories"}`;
  const split = era.affected === 0 ? "" : ` (${String(era.down)} lower than stored, ${String(era.up)} higher)`;
  const detail = era.cutoff === null ? "off: every claim reads as stored (counterparts claims-era --on reads the old ones at today's default again)" : `on since ${localDate(era.cutoff, readingZone)}: ${n(era.affected)} written before it read at today's default for what ${era.affected === 1 ? "it is" : "they are"} about${split}; nothing rewritten (counterparts claims-era --off reads them as stored again; any let go meanwhile stay archived)`;
  return [
    finding("claims-era", "green", "Old claims", detail, "", {
      on: era.cutoff !== null,
      cutoff: era.cutoff,
      affected: era.affected,
      down: era.down,
      up: era.up
    })
  ];
}
export function recognitionLaneFindings(store) {
  let count = 0;
  try {
    const door = acceptsReflectedFeeling(store);
    const seen = new Set;
    for (const f of store.feelingsLive()) {
      if (seen.has(f.memory_id) || !isSelfRelevantFeeling(f.emotion, f.other_word))
        continue;
      seen.add(f.memory_id);
      const row = store.row(f.memory_id);
      if (row === undefined || row.promoted_identity === 1)
        continue;
      if (selfRelevantFeeling(store, row, door))
        count += 1;
    }
  } catch {
    return [];
  }
  if (count === 0)
    return [];
  return [
    finding("recognition-lane", "green", "Recognition", `${String(count)} unmarked ${count === 1 ? "memory is" : "memories are"} on the core's fast lane because I recognised myself in ${count === 1 ? "it" : "them"} (a mark would decide instead)`, "", { candidates: count })
  ];
}
export const CONTRADICTION_WINDOW_DAYS = 7;
export function heldLine(held, settledAfter) {
  if (held <= 0)
    return "";
  const one = held === 1;
  const left = held - settledAfter;
  const head = `; ${String(held)} ${one ? "correction" : "corrections"} held because ${one ? "it" : "they"} didn't look related to the memory ${one ? "it" : "they"} named`;
  if (left <= 0)
    return `${head}, ${one ? "settled" : "all settled"} by hand since`;
  const since = settledAfter > 0 ? `, ${String(settledAfter)} settled by hand since` : "";
  const them = left === 1 ? "it" : "them";
  const was = left > 1 ? "any were" : one ? "it was" : held === 2 ? "the other was" : "the one left was";
  return `${head}${since}; if ${was} meant, settle ${them} with counterparts settle, which lists ${them}`;
}
export function contradictionFindings(store) {
  let pairs;
  let trail;
  let today;
  try {
    pairs = store.contradictions({ limit: 1e5 });
    trail = store.contradictionSettles({ limit: 1e5 });
    today = store.livedDay();
  } catch {
    return [];
  }
  const since = today - CONTRADICTION_WINDOW_DAYS + 1;
  const flagged = pairs.filter((p) => (p.source === "dream" || p.source === "pressure") && p.flagged_day >= since).length;
  const settles = trail.filter((s) => s.action === "settle" && s.day >= since);
  const kept = settles.filter((s) => s.undone === 0);
  const by = (list, key) => {
    const out = {};
    for (const x of list) {
      const k = String(x[key] ?? "?");
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const how = by(kept, "how");
  const who = by(kept, "actor");
  const undone = trail.filter((s) => s.action === "undo" && s.day >= since).length;
  const live = (id) => {
    const r = store.row(id);
    return r !== undefined && r.archived === 0 && r.superseded_by === null && r.body !== "";
  };
  const open = pairs.filter((p) => p.state === "settled" && p.how === "open" && p.via === null).length;
  const unsettled = pairs.filter((p) => p.state === "unsettled" && p.source !== "slot" && live(p.a) && live(p.b)).length;
  const proposed = pairs.filter((p) => p.state === "unsettled" && p.source === "slot" && live(p.a) && live(p.b)).length;
  const kinds = ["changed", "corrected", "open"].map((k) => `${String(how[k] ?? 0)} ${k}`).join(", ");
  const whoWords = Object.entries(who).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k === "owner" ? "you" : k} ${String(n)}`).join(", ");
  let heldWords = "";
  let heldData = { held: 0, heldSettledAfter: 0, heldByMeaning: 0, heldByWords: 0 };
  try {
    const h = heldCorrections(store, { sinceDay: since });
    heldData = { held: h.held, heldSettledAfter: h.settledAfter, heldByMeaning: h.byMeaning, heldByWords: h.byWords };
    heldWords = heldLine(h.held, h.settledAfter);
  } catch {}
  return [
    finding("contradictions", "green", "Contradictions", `last ${String(CONTRADICTION_WINDOW_DAYS)} lived days: ${String(flagged)} flagged, ${String(kept.length)} settled (${kinds})${kept.length > 0 ? ` by ${whoWords}` : ""}${undone > 0 ? `, ${String(undone)} undone` : ""}; standing: ${String(open)} open, ${String(unsettled)} unsettled${unsettled > 0 ? " (counterparts settle lists them)" : ""}${proposed > 0 ? `, ${String(proposed)} proposed as a newer state (the dream confirms)` : ""}${heldWords}`, "", {
      ...heldData,
      flagged,
      settled: kept.length,
      changed: how["changed"] ?? 0,
      corrected: how["corrected"] ?? 0,
      open: how["open"] ?? 0,
      undone,
      bySession: who["session"] ?? 0,
      byDream: who["dream"] ?? 0,
      byReflection: who["reflection"] ?? 0,
      byPageWriter: who["page-writer"] ?? 0,
      byOwner: who["owner"] ?? 0,
      standingOpen: open,
      standingUnsettled: unsettled,
      standingProposed: proposed
    })
  ];
}
export const PROMOTED_ROWS = 5000;
export function reflectionFindings(input, store) {
  let last;
  let returns;
  let alone = 0;
  let relabeled = 0;
  let movedIn = 0;
  let later = 0;
  let laterAwake = 0;
  let laterBoth = 0;
  let promotionsUnread = false;
  let marksUnread = false;
  let awake = { total: 0, fast: 0, owner: 0 };
  try {
    awake = awakeFeelingCounts(store);
    last = store.reflections({ limit: 5 }).find((r) => r.state === "reflected");
    returns = store.returnCounts({ sinceAt: startOfLocalDay(addDays(input.today, -6), readingZone) });
    const promotions = store.eventLog({ name: "band.promoted", order: "desc", limit: PROMOTED_ROWS });
    promotionsUnread = promotions.length >= PROMOTED_ROWS;
    for (const row of promotions) {
      try {
        const p = JSON.parse(row.payload ?? "{}");
        if (p.reflectionOnly === true)
          alone += 1;
        const byReflection = laterFeelingWasReflections(p);
        const byAwake = laterFeelingWasAwake(p);
        if (byReflection && byAwake)
          laterBoth += 1;
        else if (byReflection)
          later += 1;
        else if (byAwake)
          laterAwake += 1;
      } catch {
        continue;
      }
    }
    const marks = store.coreEvents({ action: "about", limit: MARK_ROWS });
    marksUnread = marks.length >= MARK_ROWS;
    for (const e of marks) {
      if (e.actor !== "reflection")
        continue;
      const m = /^(\w+) \(was (\w+)\)/.exec(e.reason ?? "");
      if (m === null || m[1] === m[2])
        continue;
      relabeled += 1;
      const core = (x) => x === "me" || x === "us" || x === "owner";
      if (core(m[1]) && !core(m[2]))
        movedIn += 1;
    }
  } catch {
    return [];
  }
  const share = {
    none: "no share",
    offered: "its morning share not told yet",
    carried: "its morning share carried to a later session",
    told: "its morning share told"
  };
  const carriedOn = last?.share_state !== "carried" ? null : typeof last.share_at === "number" ? localDate(last.share_at, readingZone) : last.date ?? null;
  const carriedDays = carriedOn !== null && isDay(carriedOn) && isDay(input.today) ? Math.max(0, daysBetween(carriedOn, input.today)) : null;
  if (carriedDays !== null && carriedDays > 0) {
    share["carried"] = `its morning share carried to a later session ${String(carriedDays)} ${carriedDays === 1 ? "day" : "days"} ago and never told`;
  }
  const what = last === undefined ? "has not reflected yet" : `last reflected ${last.date ?? `lived day ${String(last.day)}`} (${last.dream_id === null ? "on its own" : "after a dream"}): ${last.entry_id === null ? "nothing much" : "an entry"}${last.page_version === null ? "" : ", the self page rewritten"}, ${share[last.share_state] ?? last.share_state}`;
  const byHow = `returns this week — awake ${String(returns.awake)}, reflection ${String(returns.reflection)}, dream ${String(returns.dream)}`;
  const aloneLine = (promotionsUnread ? `; how many became core on reflection alone is unknown: more than ${String(PROMOTED_ROWS)} promotions in the log, and only the newest ${String(PROMOTED_ROWS)} were read` : "") + (!promotionsUnread && alone > 0 ? `; ${String(alone)} ${alone === 1 ? "memory" : "memories"} became core on reflection alone` : "") + (!promotionsUnread && later > 0 ? `; ${String(later)} ${later === 1 ? "memory" : "memories"} became core on a feeling a reflection recorded later` : "") + (!promotionsUnread && laterAwake > 0 ? `; ${String(laterAwake)} ${laterAwake === 1 ? "memory" : "memories"} became core on a feeling recorded looking back in a session` : "") + (!promotionsUnread && laterBoth > 0 ? `; ${String(laterBoth)} ${laterBoth === 1 ? "memory" : "memories"} became core on a feeling recorded later, both a reflection's and a session's` : "") + (relabeled > 0 ? `; ${marksUnread ? "at least " : ""}${String(relabeled)} ${relabeled === 1 ? "mark" : "marks"} changed by a reflection, ${String(movedIn)} of them into me, us or the owner${marksUnread ? ` (only the newest ${String(MARK_ROWS)} mark changes were read)` : ""}` : "") + (awake.total > 0 ? `; in all, ${String(awake.total)} ${awake.total === 1 ? "feeling" : "feelings"} recorded looking back in a session, ${String(awake.fast)} at the core's fast-lane strength, ${String(awake.owner)} the owner's` : "");
  return [
    finding("reflection", "green", "Reflection", `${what}; ${byHow}${aloneLine}`, "", {
      last: last?.date ?? null,
      reflection: last?.id ?? null,
      page: last?.page_version !== null && last?.page_version !== undefined,
      share: last?.share_state ?? null,
      carriedDays,
      returnsAwake: returns.awake,
      returnsReflection: returns.reflection,
      returnsDream: returns.dream,
      promotedOnReflectionAlone: promotionsUnread ? null : alone,
      promotedOnFeelingRecordedLater: promotionsUnread ? null : later,
      promotedOnAwakeFeeling: promotionsUnread ? null : laterAwake,
      promotedOnBothLaterFeelings: promotionsUnread ? null : laterBoth,
      relabeledByReflection: relabeled,
      relabeledIntoCore: movedIn,
      relabeledFloor: marksUnread,
      awakeFeelings: awake.total,
      awakeFeelingsFast: awake.fast,
      awakeFeelingsOwner: awake.owner
    })
  ];
}
const RUNNER_FAILED_ROWS = 20;
const LOOKUP_WINDOW_DAYS = 14;
export function lookupFindings(store) {
  const since = Math.max(0, store.livedDay() - LOOKUP_WINDOW_DAYS);
  const offered = { dream: 0, reflection: 0 };
  const runs = { dream: 0, reflection: 0 };
  const looked = { dream: 0, reflection: 0 };
  let unread = false;
  try {
    const begun = store.eventLog({ name: "dream.begun", sinceDay: since, order: "desc", limit: LOOKUP_ROWS });
    const recalls = store.eventLog({ name: "mcp.recall", sinceDay: since, order: "desc", limit: LOOKUP_ROWS });
    unread = begun.length >= LOOKUP_ROWS || recalls.length >= LOOKUP_ROWS;
    for (const row of begun) {
      const n = num(payloadOf(row), "offered");
      if (n === null)
        continue;
      runs.dream += 1;
      offered.dream += n;
    }
    for (const r of store.reflections({ limit: 60 })) {
      if (r.day < since)
        continue;
      try {
        const fit = JSON.parse(r.detail).fit;
        if (typeof fit?.offered !== "number")
          continue;
        runs.reflection += 1;
        offered.reflection += fit.offered;
      } catch {
        continue;
      }
    }
    for (const row of recalls) {
      const from = payloadOf(row)["fromIndex"];
      if (from === null || typeof from !== "object")
        continue;
      for (const m of ["dream", "reflection"]) {
        const v = from[m];
        if (typeof v === "number")
          looked[m] += v;
      }
    }
  } catch {
    return [];
  }
  const say = (m, runWord) => runs[m] === 0 ? `${m}: no ${runWord} measured yet` : `${m}: ${String(looked[m])} looked up of ${String(offered[m])} offered in part, over ${String(runs[m])} ${runWord}${runs[m] === 1 ? "" : "s"}`;
  const none = runs.dream + runs.reflection > 0 && offered.dream + offered.reflection > 0 && looked.dream + looked.reflection === 0;
  return [
    finding("lookups", "green", "Lookups", `last ${String(LOOKUP_WINDOW_DAYS)} lived days — ${say("dream", "night")}; ${say("reflection", "reflection")}` + (none ? ". None looked up yet: if that holds, the lines may be too thin or the lookup unclear" : "") + (unread ? ". More rows than were read: the counts are a floor" : ""), "", {
      dreamOffered: offered.dream,
      dreamLooked: looked.dream,
      dreamNights: runs.dream,
      reflectionOffered: offered.reflection,
      reflectionLooked: looked.reflection,
      reflections: runs.reflection,
      floor: unread
    })
  ];
}
const LOOKUP_ROWS = 2000;
const WAKE_WINDOW_DAYS = 7;
const CLAIM_WINDOW_DAYS = 7;
const CLAIM_ROWS = 500;
export function claimFindings(store, plugin = null) {
  return [...setAsideFindings(store), ...twiceFindings(store, plugin)];
}
function setAsideFindings(store) {
  const aside = claimsSetAside(store.dir);
  if (aside === null)
    return [];
  if (store.now() - aside.at > CLAIM_WINDOW_DAYS * 86400000)
    return [];
  return [
    finding("claim", "amber", "Hook claims", `the claims file could not be read as a database on ${localStamp(aside.at, store.zone())}; a hook set it aside as sessions/${CLAIMS_DIR}/${aside.name} and made a new one, and every event was still delivered`, `Nothing to do if it does not happen again. The copy can be deleted; if it comes back, check the disk the store is on.`, { setAside: aside.name, setAsideAt: aside.at })
  ];
}
function twiceFindings(store, plugin) {
  let rows;
  try {
    rows = store.eventLog({
      name: HOOK_CLAIM_LOST_EVENT,
      sinceDay: Math.max(0, store.livedDay() - (CLAIM_WINDOW_DAYS - 1)),
      order: "desc",
      limit: CLAIM_ROWS
    });
  } catch {
    return [];
  }
  const newest = rows[0];
  if (newest === undefined)
    return [];
  const sides = new Set;
  const hooks = new Set;
  for (const row of rows) {
    const p = payloadOf(row);
    for (const side of [str(p, "lost"), str(p, "won")])
      if (side !== null)
        sides.add(side);
    const hook = str(p, "hook");
    if (hook !== null)
      hooks.add(hook);
  }
  const who = sides.has("plugin") && sides.has("settings") ? "the Claude Code plugin's hooks and the hooks in your settings" : sides.has("plugin") ? "the Claude Code plugin's hooks, twice" : "two sets of hooks in your settings";
  const count = rows.length >= CLAIM_ROWS ? `${String(CLAIM_ROWS)}+` : String(rows.length);
  const fix = sides.has("plugin") ? `Keep one: to keep only the plugin, run \`counterparts disconnect\` and restart Claude Code; to keep only the npm install, run \`claude plugin uninstall ${plugin?.id ?? "counterparts@<marketplace>"}\`. Same memory either way.` : "Keep one: remove the extra Counterparts hook lines from ~/.claude/settings.json or the project's .claude/settings.json or .claude/settings.local.json (or run `counterparts disconnect` and then `counterparts connect`), then restart Claude Code.";
  return [
    finding("claim", "amber", "Installed twice", `two Counterparts wirings are live (${who}): ${count} hook ${rows.length === 1 ? "run" : "runs"} in the last ${String(CLAIM_WINDOW_DAYS)} days found the event already taken and stood down by claim (the claim is a backstop: it counts the twins it stopped, not one that came too late for it); newest ${localStamp(newest.at, store.zone())} (${[...hooks].sort().join(", ")})`, fix, { stoodDown: rows.length, sides: [...sides].sort().join(","), hooks: [...hooks].sort().join(","), newestAt: newest.at })
  ];
}
export function wakeArrivalFindings(store) {
  const since = Math.max(0, store.livedDay() - WAKE_WINDOW_DAYS);
  let wakes;
  let room;
  try {
    wakes = store.eventLog({ name: WAKE_DELIVERED_EVENT, sinceDay: since, order: "desc", limit: RESULTS_ROWS });
    room = wakeRoom(store, since);
  } catch {
    return [];
  }
  const counts = {};
  let unread = 0;
  let noFile = 0;
  let unreadable = 0;
  for (const row of wakes) {
    const p = payloadOf(row);
    const o = str(p, "outcome") ?? "unknown";
    const transcript = str(p, "transcript");
    if (o === "not-found" && transcript === "absent") {
      if (str(p, "checkedAt") === "stop")
        noFile += 1;
      else
        unread += 1;
    } else if (o === "not-found" && transcript === "unreadable") {
      unreadable += 1;
    } else {
      counts[o] = (counts[o] ?? 0) + 1;
    }
  }
  const expected = wakes.length - (counts["no-wake-expected"] ?? 0) - unread;
  if (expected <= 0 && unread === 0 && !room.any)
    return [];
  const whole = counts["delivered"] ?? 0;
  const cut = counts["truncated"] ?? 0;
  const mismatched = counts["mismatch"] ?? 0;
  const unverified = counts["printed-unverified"] ?? 0;
  const missing = counts["not-found"] ?? 0;
  const window = `last ${String(WAKE_WINDOW_DAYS)} lived days`;
  const floor = wakes.length >= RESULTS_ROWS || room.floor;
  const rest = (mismatched > 0 ? `; ${String(mismatched)} carried another wake's mark (a session resumed after its record was let go)` : "") + (unverified > 0 ? `; ${String(unverified)} printed but not verifiable on this host build` : "") + (missing > 0 ? `; ${String(missing)} not found in the transcript` : "") + (noFile > 0 ? `; ${String(noFile)} had no transcript even at the end of the first turn` : "") + (unreadable > 0 ? `; ${String(unreadable)} ${unreadable === 1 ? "transcript" : "transcripts"} could not be read` : "") + (unread > 0 ? `; ${String(unread)} not checked (no transcript to read)` : "") + room.clauses + (floor ? ". More rows than were read: the counts are a floor" : "");
  const data = {
    wakes: expected,
    delivered: whole,
    cut,
    mismatch: mismatched,
    unverified,
    notFound: missing,
    noTranscriptAtStop: noFile,
    unreadable,
    notChecked: unread,
    overBudget: room.overBudget,
    overCap: room.overCap,
    noticeDropped: room.noticeDropped,
    gaveWay: Object.values(room.gaveWay).reduce((n, k) => n + k, 0),
    handoffNoRoom: room.handoffNoRoom,
    lastHereNoRoom: room.lastHereNoRoom,
    workNoRoom: room.workNoRoom,
    datedUnlisted: room.datedUnlisted,
    steppedDown: room.steppedDown,
    untold: room.untold,
    floor
  };
  const head = expected <= 0 ? `${window} — no wake checked on arrival (an opt-in check: COUNTERPARTS_WAKE_CHECK=1 in Claude Code's environment)` : `${window} — ${String(whole)} of ${String(expected)} ${expected === 1 ? "wake" : "wakes"} arrived whole`;
  if (room.red !== null) {
    return [finding("wake", "red", "Wake", `${head}${rest}`, room.red, data)];
  }
  if (cut === 0 && room.amber !== null) {
    return [
      finding("wake", "amber", "Wake", `${head}${rest}`, room.amber, data)
    ];
  }
  if (cut > 0) {
    const newest = wakes.find((r) => str(payloadOf(r), "outcome") === "truncated");
    return [
      finding("wake", "amber", "Wake", `${window} — ${String(cut)} of ${String(expected)} ${expected === 1 ? "wake" : "wakes"} reached the session cut short (newest ${rowDate(newest) ?? "?"}); ${String(whole)} arrived whole${rest}`, "A wake cut short loses its end, and the write-up and handoff pointers ride there. Nothing to do by hand; if it repeats, the wake is over what the host takes in one — worth reporting with this line.", data)
    ];
  }
  return [finding("wake", "green", "Wake", `${head}${rest}`, "", data)];
}
function wakeRoom(store, since) {
  let floor = false;
  const read = (name) => {
    const rows = store.eventLog({ name, sinceDay: since, order: "desc", limit: RESULTS_ROWS });
    if (rows.length >= RESULTS_ROWS)
      floor = true;
    return rows;
  };
  const overBudget = read(INJECTION_OVERBUDGET_EVENT).length;
  const overCap = read(ENVELOPE_OVERCAP_EVENT).length;
  const noticeDropped = read(NOTICE_DROPPED_EVENT).length;
  const gaveWay = {};
  for (const row of read(ENVELOPE_GAVE_WAY_EVENT)) {
    const part = str(payloadOf(row), "part") ?? "?";
    gaveWay[part] = (gaveWay[part] ?? 0) + 1;
  }
  const handoffNoRoom = read(HANDOFF_REFUSED_EVENT).filter((r) => str(payloadOf(r), "reason") === "no-room").length;
  const lastHereNoRoom = read(LAST_HERE_NOROOM_EVENT).length;
  const workNoRoom = read(WORK_OVERFLOW_EVENT).filter((r) => str(payloadOf(r), "cause") === "room").length;
  const briefings = read(SELF_BRIEFING_EVENT);
  const datedRows = briefings.filter((r) => datedUnlisted(payloadOf(r)) > 0);
  const datedUnlistedRenders = datedRows.length;
  const datedNewest = rowDate(datedRows[0]);
  const steppedDown = briefings.filter((r) => (num(payloadOf(r), "counted") ?? 0) + (num(payloadOf(r), "quiet") ?? 0) > 0).length;
  const untoldRows = briefings.filter((r) => (num(payloadOf(r), "untold") ?? 0) > 0);
  const untold = untoldRows.length;
  const untoldNewest = rowDate(untoldRows[0]);
  const parts = Object.entries(gaveWay).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([part, n]) => `${part} ${String(n)}`);
  const times = (n) => `${String(n)} ${n === 1 ? "time" : "times"}`;
  const clauses = (overBudget > 0 ? `; a session start sent a little more than the reported ceiling (the lines above the wake) ${times(overBudget)}` : "") + (overCap > 0 ? `; a hook's output passed the host's cap and was shown only as a preview ${times(overCap)}` : "") + (noticeDropped > 0 ? `; a notice for you was left off to keep the wake under the cap ${times(noticeDropped)}` : "") + (parts.length > 0 ? `; waited for room: ${parts.join(", ")}` : "") + (handoffNoRoom + lastHereNoRoom > 0 ? `; no room for ${[
    handoffNoRoom > 0 ? `the handoff pointer ${times(handoffNoRoom)}` : "",
    lastHereNoRoom > 0 ? `the "Last here" line ${times(lastHereNoRoom)}` : ""
  ].filter((s) => s.length > 0).join(" and ")}` : "") + (workNoRoom > 0 ? `; "Work here" lines that did not fit, in ${String(workNoRoom)} ${workNoRoom === 1 ? "directory-day" : "directory-days"}` : "") + (datedUnlistedRenders > 0 ? `; a dated item under "Coming up:" was counted, not listed, for want of room in ${String(datedUnlistedRenders)} ${datedUnlistedRenders === 1 ? "render" : "renders"} of the wake${datedNewest === null ? "" : ` (newest ${datedNewest})`}` : "") + (untold > 0 ? `; something the wake chose went unsaid — in no line, not even a count — in ${String(untold)} ${untold === 1 ? "render" : "renders"}${untoldNewest === null ? "" : ` (newest ${untoldNewest})`}` : "");
  const remedies = [
    ...datedUnlistedRenders > 0 ? [
      'A dated item takes its room from "Work here", the Yesterday line\'s titles, "Last here" and the handoffs before it goes unlisted. A self page past its own room keeps what it borrowed from "Work here" ahead of an ordinary dated item, and steps down to its short version only for a plain reminder due that day. So an unlisted one means a page over its room or a full wake: bring the page under its room or give it a short version (`counterparts self-page`), or raise `injectionBudgetBytes`. The item is still a memory, and recall finds it.'
    ] : [],
    ...overCap > 0 ? ["Claude Code shows a hook's output past 10,000 characters only as a preview, so that output did not reach the session whole. Nothing to do by hand; if it repeats, worth reporting with this line."] : []
  ];
  const amber = remedies.length === 0 ? null : remedies.join(" ");
  const red = untold === 0 ? null : "Every lane the wake chose is meant to show whole, shortened, or as a count with its ids, so an id in no line is a bug in Counterparts, or a ceiling too small for the wake's own furniture. Worth reporting with this line; recall still finds the memories.";
  const any = clauses.length > 0;
  return { overBudget, overCap, noticeDropped, gaveWay, handoffNoRoom, lastHereNoRoom, workNoRoom, datedUnlisted: datedUnlistedRenders, steppedDown, untold, red, clauses, amber, any, floor };
}
function datedUnlisted(p) {
  const lanes = p["trimmedLanes"];
  if (typeof lanes === "object" && lanes !== null) {
    const n = lanes["horizon"];
    return typeof n === "number" ? n : 0;
  }
  const trimmed = p["trimmed"];
  if (!Array.isArray(trimmed))
    return 0;
  return trimmed.filter((e) => typeof e === "object" && e !== null && e["lane"] === "horizon").length;
}
const RESULTS_WINDOW_DAYS = 14;
const RESULTS_ROWS = 2000;
export function resultFindings(store) {
  const since = Math.max(0, store.livedDay() - RESULTS_WINDOW_DAYS);
  let oversize;
  let spilled;
  const runs = new Map;
  let largest = 0;
  let floor = false;
  const open = new Set;
  try {
    oversize = store.eventLog({ name: MCP_OVERSIZE_EVENT, sinceDay: since, order: "desc", limit: RESULTS_ROWS });
    spilled = store.eventLog({ name: MCP_SPILLED_EVENT, sinceDay: since, order: "desc", limit: RESULTS_ROWS });
    const parts = store.eventLog({ name: MCP_PART_EVENT, sinceDay: since, order: "asc", limit: RESULTS_ROWS });
    floor = oversize.length >= RESULTS_ROWS || parts.length >= RESULTS_ROWS || spilled.length >= RESULTS_ROWS;
    for (const row of parts) {
      const p = payloadOf(row);
      const ref = str(p, "ref");
      const part = num(p, "part");
      const of = num(p, "of");
      if (ref === null || part === null || of === null)
        continue;
      largest = Math.max(largest, num(p, "chars") ?? 0);
      if (part === 1)
        runs.set(ref, { mechanism: str(p, "mechanism") ?? "dream", of, fetched: new Set([1]), date: rowDate(row) });
      else
        runs.get(ref)?.fetched.add(part);
    }
    for (const d of store.dreams({ limit: RESULTS_ROWS }))
      if (d.state === "begun")
        open.add(d.id);
    for (const r of store.reflections({ limit: RESULTS_ROWS }))
      if (r.state !== "reflected")
        open.add(r.id);
  } catch {
    return [];
  }
  if (oversize.length === 0 && runs.size === 0 && spilled.length === 0)
    return [];
  const ceiling = TOOL_RESULT_CEILING.CHARS;
  const inParts = [...runs.entries()].filter(([, r]) => r.of > 1);
  const unread = inParts.filter(([ref]) => !open.has(ref)).map(([ref, r]) => {
    const missing = [];
    for (let k = 2;k <= r.of; k += 1)
      if (!r.fetched.has(k))
        missing.push(k);
    return { ref, ...r, missing };
  }).filter((r) => r.missing.length > 0);
  const window = `last ${String(RESULTS_WINDOW_DAYS)} lived days`;
  const newest = oversize[0];
  const np = payloadOf(newest);
  const overSaid = newest === undefined ? "" : `${String(oversize.length)} ${oversize.length === 1 ? "result" : "results"} came to more than the ${String(ceiling)} characters one answer carries — the newest, ${str(np, "tool") ?? "a tool"}${str(np, "phase") === null ? "" : ` ${str(np, "phase")}`} on ${rowDate(newest) ?? "an unknown day"}, at ${String(num(np, "chars") ?? 0)}, ${np["cut"] === true ? `cut to ${String(num(np, "cutTo") ?? 0)} with a note saying so` : "shipped whole (nothing in it to cut)"}`;
  const unreadSaid = unread.length === 0 ? "" : unread.map((r) => `${r.mechanism === "reflection" ? "reflection" : "dream"} ${r.ref}${r.date === null ? "" : ` (${r.date})`} was handed in ${String(r.of)} parts and finished without part${r.missing.length === 1 ? "" : "s"} ${r.missing.join(", ")}`).join("; ");
  const newestSpill = spilled[0];
  const sp = payloadOf(newestSpill);
  const spillTool = (str(sp, "tool") ?? "a tool").replace(/^mcp__counterparts__/, "");
  const spillRuns = new Set(spilled.map((r) => str(payloadOf(r), "run") ?? "")).size;
  const spillSaid = newestSpill === undefined ? "" : `${String(spilled.length)} ${spilled.length === 1 ? "result" : "results"} of the nightly run${spillRuns > 1 ? ` (${String(spillRuns)} runs)` : ""} reached the model only as Claude Code's short preview — the newest, ${spillTool}${str(sp, "phase") === null ? "" : ` ${str(sp, "phase")}`} on ${rowDate(newestSpill) ?? "an unknown day"}${str(sp, "said") === null ? "" : `, at ${str(sp, "said")}`}`;
  let checked = "";
  let lastTranscript = null;
  try {
    const last = nightRunOf(store);
    lastTranscript = last?.transcript ?? null;
    if (last !== null && last.transcript !== undefined && !(last.transcript === "read" && (last.spills ?? 0) > 0)) {
      checked = last.transcript === "read" ? `; the ${last.date} run's output showed none of our results cut by Claude Code` : `; the ${last.date} run's output ${last.transcript === "absent" ? "was not kept" : "could not be read"}, so Claude Code's cut was not checked`;
    }
  } catch {}
  const spillShape = str(sp, "shape");
  const spillFix = spillShape === "turn-budget" ? "Nothing to do by hand: the run fetched several results in one turn, and together they passed Claude Code's budget for one turn, so it cut the largest to a preview. Worth reporting with this line." : spillShape === "tokens" || spillShape === "token-cut" ? `Nothing to do by hand: Claude Code's token limit on one tool result came out lower than the ${String(TOOL_RESULT_CEILING.HOST_TOKENS)} tokens the nightly run sets it to, so the night read through a keyhole. Worth reporting with this line.` : `Nothing to do by hand: Claude Code's limit on one tool result is lower than the ${String(ceiling)} characters Counterparts keeps them under, so the night read through a keyhole. Worth reporting with this line — the ceiling has to come down to meet it.`;
  const data = {
    ceiling,
    oversize: oversize.length,
    newestOversizeTool: str(np, "tool"),
    newestOversizeChars: num(np, "chars"),
    runsInParts: inParts.length,
    runsUnread: unread.length,
    largestPart: largest,
    spilled: spilled.length,
    newestSpillTool: str(sp, "tool"),
    lastTranscript,
    floor
  };
  if (spillSaid.length > 0 || overSaid.length > 0 || unreadSaid.length > 0) {
    return [
      finding("results", "amber", "Tool results", `${window} — ${[spillSaid, overSaid, unreadSaid].filter((x) => x.length > 0).join("; ")}${checked}${floor ? ". More rows than were read: the counts are a floor" : ""}`, spillSaid.length > 0 ? spillFix : overSaid.length > 0 ? "Nothing to do by hand: the model was told the answer was cut. It means a cap upstream lets a result grow past the ceiling — worth reporting with this line." : "Nothing to do by hand: the next night reads its own bundle. If it repeats, the run is skipping parts — worth reporting with this line.", data)
    ];
  }
  return [
    finding("results", "green", "Tool results", `${window} — every result under ${String(ceiling)} characters; ${inParts.length === 0 ? "no bundle came in parts" : `${String(inParts.length)} ${inParts.length === 1 ? "bundle" : "bundles"} came in parts, every part read`}; the largest part handed was ${String(largest)} characters${checked}${floor ? ". More rows than were read: the counts are a floor" : ""}`, "", data)
  ];
}
const ASSOCIATION_WINDOW_DAYS = 7;
export function associationFindings(store) {
  const day = store.livedDay();
  const since = Math.max(0, day - ASSOCIATION_WINDOW_DAYS);
  let turns = 0;
  let deep = 0;
  let nodeLimit = 0;
  let landed = 0;
  let computed = 0;
  let dropped = 0;
  let allTurns = 0;
  let unread = false;
  let pointersShown = 0;
  let pointersExpanded = 0;
  let contiguityPairs = 0;
  let contiguityLanded = 0;
  let contiguityEvictedOther = 0;
  let contiguityScaled = 0;
  let contiguityExcluded = 0;
  let contiguityLost = 0;
  let contiguityFailed = 0;
  const census = { total: 0, conducting: 0, gist: 0, dream: 0, hebbian: 0 };
  try {
    const rows = store.eventLog({ name: "recall.decision", sinceDay: since, order: "desc", limit: ASSOCIATION_ROWS });
    unread = rows.length >= ASSOCIATION_ROWS;
    allTurns = rows.length;
    for (const row of rows) {
      const p = payloadOf(row);
      const d = num(p, "dropped");
      if (d !== null)
        dropped += d;
      const s = p["spread"];
      if (s === null || typeof s !== "object")
        continue;
      const sp = s;
      turns += 1;
      if (typeof sp["depth"] === "number" && sp["depth"] >= 2)
        deep += 1;
      if (sp["stop"] === "node-limit")
        nodeLimit += 1;
      if (typeof sp["landed"] === "number")
        landed += sp["landed"];
      if (typeof sp["computed"] === "number")
        computed += sp["computed"];
      if (typeof sp["pointersShown"] === "number")
        pointersShown += sp["pointersShown"];
    }
    for (const row of store.eventLog({ name: "recall.credit", sinceDay: since, order: "desc", limit: ASSOCIATION_ROWS })) {
      const n = num(payloadOf(row), "pointersExpanded");
      if (n !== null)
        pointersExpanded += n;
    }
    for (const row of store.eventLog({ name: "associate.flush", sinceDay: since, order: "desc", limit: ASSOCIATION_ROWS })) {
      const c = payloadOf(row)["contiguity"];
      if (c === null || typeof c !== "object")
        continue;
      const cr = c;
      contiguityPairs += num(cr, "buffered") ?? 0;
      contiguityLanded += num(cr, "landed") ?? 0;
      contiguityEvictedOther += num(cr, "evictedOther") ?? 0;
      contiguityScaled += num(cr, "renormalizedNodes") ?? 0;
      contiguityExcluded += num(cr, "excluded") ?? 0;
      contiguityLost += num(cr, "lostEarlier") ?? 0;
      if (cr["reason"] === "failed")
        contiguityFailed += 1;
    }
    const dreamed = new Set;
    const dreamPairs = new Set;
    for (const dream of store.dreams({ limit: 1e4 })) {
      for (const c of store.dreamChanges(dream.id)) {
        if (c.undone !== 0 || c.ref === null)
          continue;
        if (c.action === "gist")
          dreamed.add(c.ref);
        if (c.action === "link" && c.ref2 !== null)
          dreamPairs.add(pairKey(c.ref, c.ref2));
      }
    }
    for (const e of store.allEdges()) {
      census.total += 1;
      if (!isDead({ src: e.src, dst: e.dst, weight: e.weight, lastDay: e.last_day }, day, ASSOCIATE_TUNABLES))
        census.conducting += 1;
      if (dreamed.has(e.src) || dreamed.has(e.dst))
        census.gist += 1;
      else if (dreamPairs.has(pairKey(e.src, e.dst)))
        census.dream += 1;
      else
        census.hebbian += 1;
    }
  } catch {
    return [];
  }
  const pct = (n) => turns === 0 ? "0%" : `${String(Math.round(100 * n / turns))}%`;
  const spreadSaid = turns === 0 ? `last ${String(ASSOCIATION_WINDOW_DAYS)} lived days — no spreading measured yet` : `last ${String(ASSOCIATION_WINDOW_DAYS)} lived days — spread got past its seeds (depth 2) on ${pct(deep)} of ${String(turns)} turns it ran; stopped at the node limit on ${pct(nodeLimit)}; ${String(landed)} of ${String(computed)} contributions landed on a candidate the cut kept; ${String(pointersShown)} quiet ${pointersShown === 1 ? "pointer" : "pointers"} shown (memories only links reached), ${String(pointersExpanded)} later expanded`;
  return [
    finding("association", "green", "Association", `${spreadSaid}. Edges: ${String(census.total)} rows, ${String(census.conducting)} conducting — ${String(census.hebbian)} learned from use or contiguity, ${String(census.dream)} dream links, ${String(census.gist)} gist ties (derived: a row touching a dream's gist is a gist tie, a pair a dream linked is a dream link, the rest were learned from use or from memories made next to each other)` + `. Temporal contiguity buffered ${String(contiguityPairs)} ${contiguityPairs === 1 ? "pair" : "pairs"} of neighbouring memories at the boundaries, ${String(contiguityLanded)} landed as links; it pushed out ${String(contiguityEvictedOther)} other ${contiguityEvictedOther === 1 ? "link" : "links"} and scaled back ${String(contiguityScaled)} ${contiguityScaled === 1 ? "memory's" : "memories'"} links at full memories; ${String(contiguityExcluded)} ${contiguityExcluded === 1 ? "memory" : "memories"} the nightly run wrote left out` + (contiguityFailed > 0 ? `; the pass failed at ${String(contiguityFailed)} ${contiguityFailed === 1 ? "boundary" : "boundaries"}` : "") + (contiguityLost > 0 ? `; ${String(contiguityLost)} planned ${contiguityLost === 1 ? "pair was" : "pairs were"} lost before a flush recorded them` : "") + (dropped > 0 ? `. The candidate cut left out ${String(dropped)} scored memories, summed over all ${String(allTurns)} recall turns in the window` : "") + (unread ? ". More turns than were read: the counts are a floor" : ""), "", {
      turns,
      deep,
      nodeLimit,
      landed,
      computed,
      dropped,
      allTurns,
      pointersShown,
      pointersExpanded,
      contiguityPairs,
      contiguityLanded,
      contiguityEvictedOther,
      contiguityScaled,
      contiguityExcluded,
      contiguityLost,
      contiguityFailed,
      edges: census.total,
      conducting: census.conducting,
      hebbian: census.hebbian,
      dreamLinks: census.dream,
      gistTies: census.gist,
      floor: unread
    })
  ];
}
const ASSOCIATION_ROWS = 5000;
export const RESTORE_STEPS = "To restore: stop every session, copy a snapshot directory to the store's path, " + "then counterparts verify --dir <store> --rebuild (with the embed key exported, or " + "the vectors are dropped and refilled over the following days). Everything comes back " + "with the copy — the memories, their versions and the journal are all in the database; " + "the search index and the vectors are rebuilt. A copy holding operational.sqlite or " + "prose/ is from BEFORE the floor changed and this build cannot open it: it is kept and " + "counted, never rotated, and the build tagged floor/v5-last reads it.";
export const SNAPSHOT_STALE_DAYS = 2;
function snapshotFindings(input, store) {
  const livedDay = store.livedDay();
  const resolved = resolveSnapshotsDir(input.dir, input.config.snapshots?.dir);
  const keep = keepOf(input.config.snapshots?.keep);
  const ignored = input.config.snapshots?.ignored ?? [];
  const misread = ignored.length === 0 ? "" : ` — ${ignored.join("; ")}`;
  const data = {
    keep,
    where: resolved.reason,
    ignored: ignored.length === 0 ? null : ignored.join("; ")
  };
  if (resolved.dir === null) {
    return [
      finding("snapshot", "amber", "Snapshots", `no daily snapshot is being taken: this store is not inside a base directory, so there is no default place to keep copies${misread}`, 'Add "snapshots": { "dir": "<an absolute path outside the store>" } to the configuration.', data)
    ];
  }
  const disk = readSnapshotsDir(resolved.dir);
  const onDisk = disk.names.length;
  const newest = disk.names[onDisk - 1] ?? null;
  const oldest = disk.names[0] ?? null;
  const future = futureNamesIn(disk.names, Date.parse(`${input.today}T00:00:00Z`)).length;
  const strange = disk.unrecognised.length === 0 ? "" : `; ${String(disk.unrecognised.length)} director${disk.unrecognised.length === 1 ? "y is" : "ies are"} named like snapshots but do not look like copies of a store, so they are not counted and will never be rotated: ${disk.unrecognised.slice(0, 3).join(", ")}${disk.unrecognised.length > 3 ? ` and ${String(disk.unrecognised.length - 3)} more` : ""}`;
  const older = disk.preRows.length === 0 ? "" : `; ${String(disk.preRows.length)} older-format cop${disk.preRows.length === 1 ? "y" : "ies"} this build cannot open — kept, never rotated, read by the build tagged floor/v5-last: ${disk.preRows.slice(0, 3).join(", ")}${disk.preRows.length > 3 ? ` and ${String(disk.preRows.length - 3)} more` : ""}`;
  const lastUpgrade = disk.preMigration[disk.preMigration.length - 1] ?? null;
  const upgrade = lastUpgrade === null ? "" : `; before the last schema upgrade: ${lastUpgrade}`;
  const held = {
    ...data,
    onDisk,
    newest,
    oldest,
    readable: disk.readable,
    future,
    unrecognised: disk.unrecognised.length,
    preRows: disk.preRows.length,
    preMigration: lastUpgrade
  };
  const read = newestRows(store, SNAPSHOT_TAKEN_EVENT, 1, livedDay);
  const row = read.unknown ? undefined : read.rows[0];
  const rowDated = rowDate(row);
  if (onDisk === 0 && (rowDated !== null || read.unknown)) {
    return [
      finding("snapshot", "amber", "Snapshots", `${disk.readable ? "the snapshots directory is empty" : "the snapshots directory is missing or unreadable"} — but a snapshot.taken row says one was made${rowDated === null ? "" : ` on ${rowDated}`}. There is nothing to restore from.${strange}${upgrade}`, RESTORE_STEPS, { ...held, rows: 1 })
    ];
  }
  if (onDisk === 0) {
    const age = boundaryAge(store, input.today);
    const lived = age === "earlier";
    const failed = newestRows(store, SNAPSHOT_FAILED_EVENT, 1, livedDay);
    const failedRow = failed.rows[0];
    const why = failedRow === undefined ? "" : ` — newest ${SNAPSHOT_FAILED_EVENT} ${rowDate(failedRow) ?? "?"} (${str(payloadOf(failedRow), "step") ?? "?"}: ${str(payloadOf(failedRow), "reason") ?? "?"})`;
    return [
      lived ? finding("snapshot", "amber", "Snapshots", `no snapshot has ever been taken here${why}${strange}${upgrade}${misread}`, "The worker takes one after the sleep cycle; the next boundary should leave a snapshot.taken row.", { ...held, rows: 0 }) : finding("snapshot", "green", "Snapshots", `no snapshot yet — ${age === "today" ? "the first night run starts today and takes one when it finishes" : "and no boundary has been reached here yet"}${strange}${upgrade}${misread}`, "", { ...held, rows: 0 })
    ];
  }
  const newestDate = (newest ?? "").slice(0, 10);
  const detail = `last ${newestDate}, ${onDisk} kept` + (keep === DEFAULT_KEEP ? "" : ` (keeping ${keep})`) + (future === 0 ? "" : `; ${future} dated in the future, holding a slot each`) + (rowDated !== null && rowDated > newestDate ? `; the newest snapshot.taken row says ${rowDated}, which is not on disk` : "") + strange + older + upgrade + misread;
  const stale = newestDate === "" || newestDate <= daysBefore(input.today, SNAPSHOT_STALE_DAYS);
  const disagrees = rowDated !== null && rowDated > newestDate;
  return [
    stale || disagrees || future > 0 || disk.unrecognised.length > 0 || ignored.length > 0 ? finding("snapshot", "amber", "Snapshots", stale ? `${detail} — ${SNAPSHOT_STALE_DAYS} days ago or more` : detail, stale ? "The copy is taken by the worker after a boundary; read the Spawn line below." : RESTORE_STEPS, held) : finding("snapshot", "green", "Snapshots", detail, "", held)
  ];
}
export function doctorFindings(input) {
  readingZone = resolveZone(input.config.timeZone);
  const now = input.now ?? (() => Date.now());
  const deadline = input.budgetMs === undefined ? null : now() + input.budgetMs;
  const unread = input.configReason === "not-read";
  const history = unread ? { embedded: false } : keyHistory(input.store);
  const embedderSource = unread ? "explicit" : resolveEmbedder(input.config).source;
  if (!unread)
    input = { ...input, config: withEmbedderDefault(input.config) };
  const out = [
    ...configFindings(input),
    ...unread ? [] : embedderFindings(input, history, embedderSource),
    ...input.checkout === undefined ? [] : checkoutFindings(input.checkout),
    ...input.open === undefined ? [] : openFindings(input.open),
    ...rollbackFindings(input.dir),
    ...input.host === undefined ? [] : hostFindings(input.host),
    ...input.host === undefined ? [] : runtimeFindings(input.host),
    ...input.desktop === undefined ? [] : desktopFindings(input.desktop, input.store, input.dir)
  ];
  const store = input.store;
  if (store === null)
    return worstFirst(out);
  const owedAllowed = !unread && input.budgetMs === undefined;
  let owedCache = null;
  const owedReading = () => {
    if (!owedAllowed)
      return null;
    owedCache ??= { value: readOwed(store, input.today) };
    return owedCache.value;
  };
  const groups = [
    ["spawn", () => spawnFindings(input, store)],
    ["clock", () => clockFindings(input, store)],
    ["rows", () => rowFindings(input, store)],
    ["authorship", () => authorshipFindings(input, store, owedReading)],
    ["journal", () => journalFindings(store)],
    ["vectors", () => vectorFindings(input, store)],
    ...unread ? [] : [["snapshot", () => snapshotFindings(input, store)]],
    ["self-page", () => selfPageFindings(store)],
    ["page-writer", () => pageWriterFindings(store, input.config)],
    ...unread || input.budgetMs !== undefined ? [] : [["crash-write-up", () => crashWriteUpFindings(input, store, owedReading)]],
    ["journal-copy", () => journalCopyFindings(store)],
    ...input.budgetMs !== undefined ? [] : [["log", () => logFindings(input)]],
    ["retention", () => retentionFindings(input, store)],
    ["upgrade-v8", () => upgradeV8Findings(store)],
    ["dreaming", () => dreamingFindings(input, store)],
    ["night-run", () => nightRunFindings(input, store)],
    ["upgrade-v9", () => upgradeV9Findings(store)],
    ["reflection", () => reflectionFindings(input, store)],
    ["upgrade-v10", () => upgradeV10Findings(store)],
    ["upgrade-v11", () => upgradeV11Findings(store)],
    ["write-fields", () => writeFieldFindings(store)],
    ["claims-era", () => claimsEraFindings(store)],
    ["recognition-lane", () => recognitionLaneFindings(store)],
    ["contradictions", () => contradictionFindings(store)],
    ["lookups", () => lookupFindings(store)],
    ["results", () => resultFindings(store)],
    ["wake", () => wakeArrivalFindings(store)],
    ["claim", () => claimFindings(store, input.host?.plugin ?? null)],
    ["association", () => associationFindings(store)],
    ["fired", () => firedFindings(input, store)]
  ];
  const skipped = [];
  for (const [name, read] of groups) {
    if (deadline !== null && now() > deadline) {
      skipped.push(name);
      continue;
    }
    out.push(...read());
  }
  if (skipped.length > 0) {
    out.push(finding("budget", "amber", "Budget", `the session-start reading stopped after ${String(input.budgetMs)} ms and did not read: ${skipped.join(", ")}`, "Run: counterparts doctor — the console reads without a budget.", { skipped: skipped.join(","), budgetMs: input.budgetMs ?? 0 }));
  }
  return worstFirst(out);
}
