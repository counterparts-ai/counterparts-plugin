import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isZone } from "../core/time.js";
import { TUNABLES as REMEMBER_TUNABLES } from "../core/remember/tunables.js";
import { PAGE_HOST_BUDGET_BYTES, PAGE_WRITER_MODES } from "../core/self/index.js";
import { DEFAULT_KEEP as SNAPSHOT_DEFAULT_KEEP } from "./snapshots.js";
export const CAPABILITIES = [
  "injectionBudgetBytes",
  "executionCeilingMs",
  "socketLifetimeMs"
];
export const TUNABLES = {
  WATCHDOG_MS: 5 * 60000,
  NIGHT_RUN_MS: 20 * 60000,
  NIGHT_QUICK_EXIT_MS: 60000,
  NIGHT_MAX_TURNS: 60,
  NIGHT_WRITE_UP_BYTES: 192 * 1024,
  NIGHT_WRITE_UP_BATCH_PARTS: 16,
  NIGHT_WRITE_UP_PARTS: 100,
  CATCH_UP_COMMAND_PARTS: 400,
  NIGHT_WRITE_UP_MS: 10 * 60000,
  NIGHT_WRITE_UP_TOTAL_MS: 60 * 60000,
  NIGHT_WRITE_UP_MAX_TURNS: 48,
  CREDIT_BUDGET_MS: 150,
  ESCALATE_AFTER: 3,
  WRITE_UP_ASKS_PER_DAY: 2,
  PLAIN_WHAT_MAX_CHARS: 120,
  SINCE_LINE_EVERY_MS: 60 * 60 * 1000,
  HOST_OUTPUT_CHARS: 1e4,
  HOST_PREVIEW_CHARS: 2000,
  TOOL_RESULT_CHARS: 24000,
  DESKTOP_ASK_CALLS: 3,
  DESKTOP_ASK_AFTER_MS: 20 * 60000
};
export const EMBEDDER_KINDS = ["static"];
export function loadConfig(raw) {
  if (raw === undefined || raw === null) {
    return { config: {}, ok: true, reason: "absent" };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { config: { observer: true }, ok: false, reason: "unreadable" };
  }
  const rec = raw;
  const out = {};
  let unreadable = false;
  const badKeys = [];
  const retired = [];
  const num = (key) => {
    const value = rec[key];
    if (value === undefined)
      return;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      unreadable = true;
      return;
    }
    return value;
  };
  if (typeof rec["dataDir"] === "string")
    out.dataDir = rec["dataDir"];
  else if (rec["dataDir"] !== undefined)
    unreadable = true;
  if (rec["credentialsFile"] !== undefined) {
    const named = typeof rec["credentialsFile"] === "string" ? ` (${rec["credentialsFile"]})` : "";
    retired.push(`"credentialsFile" is no longer used — Counterparts reads no API keys; the file it names${named} can be deleted`);
  }
  if (rec["models"] !== undefined) {
    retired.push(`"models" is no longer used — there is no model seat to configure; it was ignored`);
  }
  if (rec["crashWriteUp"] !== undefined && rec["crashWriteUp"] !== "next-session") {
    retired.push(`"crashWriteUp" is no longer used — a session that ended before it was written up is always written up by the next session in its project`);
  }
  if (rec["stopAskShape"] !== undefined) {
    retired.push(`"stopAskShape" is no longer used — the end-of-session ask has one shape now, shown as hook feedback`);
  }
  const injection = num("injectionBudgetBytes");
  if (injection !== undefined)
    out.injectionBudgetBytes = injection;
  const exec = num("executionCeilingMs");
  if (exec !== undefined)
    out.executionCeilingMs = exec;
  const socket = num("socketLifetimeMs");
  if (socket !== undefined)
    out.socketLifetimeMs = socket;
  const watchdog = num("watchdogMs");
  if (watchdog !== undefined)
    out.watchdogMs = watchdog;
  if (rec["owner"] !== undefined) {
    if (typeof rec["owner"] !== "boolean")
      unreadable = true;
    else
      out.owner = rec["owner"];
  }
  if (rec["observer"] !== undefined) {
    if (typeof rec["observer"] !== "boolean")
      unreadable = true;
    else
      out.observer = rec["observer"];
  }
  if (rec["timeZone"] !== undefined) {
    if (isZone(rec["timeZone"]))
      out.timeZone = rec["timeZone"];
    else
      out.timeZoneUnknown = String(rec["timeZone"]).slice(0, 64);
  }
  const embedder = rec["embedder"];
  if (embedder !== undefined) {
    const e = typeof embedder === "object" && embedder !== null && !Array.isArray(embedder) ? embedder : {};
    const voyage = e["kind"] === "voyage";
    if (voyage) {
      retired.push(`"embedder.kind" "voyage" is no longer available — recall by meaning uses the local table, where nothing leaves this machine`);
    }
    const kind = voyage ? "static" : e["kind"];
    const kindOk = kind === undefined || typeof kind === "string" && EMBEDDER_KINDS.includes(kind);
    if (typeof embedder !== "object" || embedder === null || Array.isArray(embedder)) {
      unreadable = true;
      badKeys.push("embedder");
    } else if (typeof e["enabled"] !== "boolean") {
      unreadable = true;
      badKeys.push("embedder.enabled");
    } else if (e["enabled"] === false) {
      out.embedder = { enabled: false, ...kind !== undefined && kindOk ? { kind } : {} };
    } else if (!kindOk) {
      unreadable = true;
      badKeys.push("embedder.kind");
    } else {
      out.embedder = { enabled: e["enabled"], ...kind === undefined ? {} : { kind } };
    }
  }
  const pageWriter = rec["pageWriter"];
  if (pageWriter !== undefined) {
    out.pageWriter = readPageWriter(pageWriter);
    const w = pageWriter;
    if (typeof w === "object" && w !== null && !Array.isArray(w)) {
      if (w["command"] !== undefined) {
        retired.push(`"pageWriter.command" is no longer used — the page writer runs inside the nightly run`);
      }
      if (w["mode"] === "host") {
        retired.push(`"pageWriter.mode" "host" is no longer used — the page writer runs inside the nightly run (mode session)`);
      }
      if (w["timeoutMs"] !== undefined) {
        retired.push(`"pageWriter.timeoutMs" is no longer used — the nightly run's watchdog is "dreaming.timeoutMs"`);
      }
    }
  }
  const dreaming = rec["dreaming"];
  if (dreaming !== undefined) {
    out.dreaming = readDreaming(dreaming);
  }
  const snapshots = rec["snapshots"];
  if (snapshots !== undefined) {
    out.snapshots = readSnapshots(snapshots);
  }
  const retention = rec["retention"];
  if (retention !== undefined) {
    out.retention = readRetention(retention);
  }
  const identity = rec["identity"];
  if (identity !== undefined) {
    const i = identity;
    if (typeof i?.["name"] === "string" && i["name"].trim().length > 0) {
      const aliases = i["aliases"];
      out.identity = {
        name: i["name"],
        ...Array.isArray(aliases) ? { aliases: aliases.filter((a) => typeof a === "string") } : {}
      };
    } else {
      unreadable = true;
    }
  }
  if (unreadable) {
    return {
      config: { observer: true },
      ok: false,
      reason: "unreadable",
      ...badKeys.length === 0 ? {} : { unreadableKeys: badKeys }
    };
  }
  if (retired.length > 0)
    out.retired = tidy(retired, RETIRED_LINE_CHARS);
  return { config: out, ok: true, reason: "loaded" };
}
export const PAGE_WRITER_FALLBACK_MODE = "session";
function readPageWriter(raw) {
  const raws = [];
  const out = {
    mode: PAGE_WRITER_FALLBACK_MODE
  };
  const done = () => raws.length === 0 ? out : { ...out, ignored: tidy(raws) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    raws.push(`"pageWriter" was not an object; using mode ${PAGE_WRITER_FALLBACK_MODE}`);
    return done();
  }
  const w = raw;
  const mode = w["mode"];
  if (typeof mode === "string" && PAGE_WRITER_MODES.includes(mode)) {
    out.mode = mode;
  } else if (mode !== undefined && mode !== "host") {
    raws.push(`"pageWriter.mode" was ${JSON.stringify(mode)}, which is not ${PAGE_WRITER_MODES.join(", ")}; using ${PAGE_WRITER_FALLBACK_MODE}`);
  }
  for (const key of Object.keys(w)) {
    if (key !== "mode" && key !== "command" && key !== "timeoutMs") {
      raws.push(`"pageWriter.${key}" is not a setting this reads; it was ignored`);
    }
  }
  return done();
}
function readDreaming(raw) {
  const raws = [];
  const out = {};
  const done = () => raws.length === 0 ? out : { ...out, ignored: tidy(raws) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    raws.push(`"dreaming" was not an object; it was ignored`);
    return done();
  }
  const d = raw;
  const model = d["model"];
  if (typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:[\]/-]*$/.test(model.trim())) {
    out.model = model.trim();
  } else if (model !== undefined) {
    raws.push(`"dreaming.model" was ${JSON.stringify(model)}, which is not a model name; the default model is used`);
  }
  const timeoutMs = d["timeoutMs"];
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    out.timeoutMs = timeoutMs;
  } else if (timeoutMs !== undefined) {
    raws.push(`"dreaming.timeoutMs" was ${JSON.stringify(timeoutMs)}; using the default watchdog`);
  }
  const maxTurns = d["maxTurns"];
  if (typeof maxTurns === "number" && Number.isInteger(maxTurns) && maxTurns > 0) {
    out.maxTurns = maxTurns;
  } else if (maxTurns !== undefined) {
    raws.push(`"dreaming.maxTurns" was ${JSON.stringify(maxTurns)}; using the default`);
  }
  for (const key of Object.keys(d)) {
    if (key !== "model" && key !== "timeoutMs" && key !== "maxTurns")
      raws.push(`"dreaming.${key}" is not a setting this reads; it was ignored`);
  }
  return done();
}
function readRetention(raw) {
  const raws = [];
  const out = {};
  const done = () => raws.length === 0 ? out : { ...out, ignored: tidy(raws) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    raws.push(`"retention" was not an object; the defaults are used`);
    return done();
  }
  const r = raw;
  const defaults = retentionDefaults();
  for (const key of ["afterWriteUpDays", "maxDays"]) {
    const value = r[key];
    if (value === undefined)
      continue;
    if (typeof value === "number" && Number.isInteger(value) && value > 0)
      out[key] = value;
    else
      raws.push(`"retention.${key}" was ${JSON.stringify(value)}; using ${String(defaults[key])}`);
  }
  for (const key of Object.keys(r)) {
    if (key !== "afterWriteUpDays" && key !== "maxDays")
      raws.push(`"retention.${key}" is not a setting this reads; it was ignored`);
  }
  return done();
}
const DAY_MS = 86400000;
export function retentionDefaults() {
  return {
    afterWriteUpDays: Math.round(REMEMBER_TUNABLES.RETENTION_MS / DAY_MS),
    maxDays: Math.round(REMEMBER_TUNABLES.RETENTION_MAX_MS / DAY_MS)
  };
}
export function retentionClocks(config) {
  const d = retentionDefaults();
  const afterWriteUpDays = config.retention?.afterWriteUpDays ?? d.afterWriteUpDays;
  const maxDays = config.retention?.maxDays ?? d.maxDays;
  return { afterWriteUpDays, maxDays, retentionMs: afterWriteUpDays * DAY_MS, maxMs: maxDays * DAY_MS };
}
const IGNORED_LINE_CHARS = 120;
const IGNORED_LINES = 8;
const RETIRED_LINE_CHARS = 240;
function tidy(lines, lineChars = IGNORED_LINE_CHARS) {
  const clean = lines.map((line) => {
    const stripped = line.replace(/[\u0000-\u001f\u007f]/g, "");
    return stripped.length > lineChars ? `${stripped.slice(0, lineChars - 1)}…` : stripped;
  });
  if (clean.length <= IGNORED_LINES)
    return clean;
  return [
    ...clean.slice(0, IGNORED_LINES),
    `and ${String(clean.length - IGNORED_LINES)} more`
  ];
}
function readSnapshots(raw) {
  const raws = [];
  const ignored = (line) => {
    raws.push(line);
  };
  const out = {};
  const done = () => raws.length === 0 ? out : { ...out, ignored: tidy(raws) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    ignored('"snapshots" was not an object; the whole block was ignored');
    return done();
  }
  const sn = raw;
  const known = new Set(["dir", "keep", "mirror"]);
  for (const key of Object.keys(sn)) {
    if (!known.has(key))
      ignored(`"snapshots.${key}" is not a setting this reads`);
  }
  for (const key of ["dir", "mirror"]) {
    const value = sn[key];
    if (value === undefined)
      continue;
    if (typeof value !== "string") {
      ignored(`"snapshots.${key}" was not a path; using the default location`);
      continue;
    }
    if (value.trim().length === 0) {
      ignored(`"snapshots.${key}" was blank; using the default location`);
      continue;
    }
    if (!isAbsolute(value)) {
      ignored(`"snapshots.${key}" must be an absolute path; using the default location`);
      continue;
    }
    out[key] = value;
  }
  const keep = sn["keep"];
  if (keep !== undefined) {
    if (typeof keep !== "number" || !Number.isInteger(keep) || keep <= 0) {
      ignored(`"snapshots.keep" was ${JSON.stringify(keep)}; using ${String(SNAPSHOT_DEFAULT_KEEP)}`);
    } else {
      out.keep = keep;
    }
  }
  return done();
}
export function pageWriterMode(config) {
  if (config.observer === true)
    return "off";
  return config.pageWriter?.mode ?? "session";
}
export function capabilities(config) {
  return [
    {
      name: "injectionBudgetBytes",
      reported: config.injectionBudgetBytes !== undefined && config.injectionBudgetDefaulted !== true,
      value: config.injectionBudgetBytes ?? null,
      why: "The host's injection cliff. v1 hardcoded 90% of one host's, as though it were physiology."
    },
    {
      name: "executionCeilingMs",
      reported: config.executionCeilingMs !== undefined,
      value: config.executionCeilingMs ?? null,
      why: "How long a foreground hook may run before the host gives up on it."
    },
    {
      name: "socketLifetimeMs",
      reported: config.socketLifetimeMs !== undefined,
      value: config.socketLifetimeMs ?? null,
      why: "Why long calls stream (scar E3, rescoped to the adapter that owns the host)."
    }
  ];
}
export const DEFAULT_EMBEDDER = {
  enabled: true,
  kind: "static"
};
export function resolveEmbedder(config) {
  if (config.embedder !== undefined)
    return { block: config.embedder, source: "explicit" };
  if (config.observer === true)
    return { block: undefined, source: "absent-observer" };
  return { block: { ...DEFAULT_EMBEDDER }, source: "default-static" };
}
export function withEmbedderDefault(config) {
  const { block, source } = resolveEmbedder(config);
  return source === "explicit" || block === undefined ? config : { ...config, embedder: block };
}
export const CLAUDE_CODE_BUDGET_BYTES = PAGE_HOST_BUDGET_BYTES;
export function withBudgetDefault(config) {
  if (config.injectionBudgetBytes !== undefined)
    return config;
  return { ...config, injectionBudgetBytes: CLAUDE_CODE_BUDGET_BYTES, injectionBudgetDefaulted: true };
}
export function zoneOfConfig(path) {
  if (!existsSync(path))
    return;
  try {
    return loadConfig(JSON.parse(readFileSync(path, "utf8"))).config.timeZone;
  } catch {
    return;
  }
}
export function zoneBeside(dir) {
  return zoneOfConfig(join(dir, "..", "claude-code.json"));
}
