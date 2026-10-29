/**
 * THE DAILY UPDATE CHECK AND ITS LINES (U1b, 2026-10-28). Design:
 * `~/counterparts-notes/2026-10-27-briefs/U1-design-note.md` rev 2, with
 * Mike's answers (10-27 20:42) over it where they differ.
 *
 * A leaf beside `update-words.ts`, because three adapters use it and adapters
 * never import each other: the detached worker makes the request
 * (`claude-code/bin/runner.ts`, after its store is closed), the session-start
 * wake and Desktop's `wake` say the lines (`claude-code/hooks.ts`,
 * `mcp/bin/serve.ts`), the MCP `scope` tool takes "stop reminding me about
 * updates" (`mcp/server.ts`), and doctor reports it all.
 *
 * **The request.** One `GET https://registry.npmjs.org/counterparts/latest`,
 * at most once a day, failures included (a failed day tries again the next). No
 * query, no cookie kept, no id, not even the installed version; the
 * User-Agent is the constant `counterparts`, and no `Accept` header asks for
 * npm's abbreviated document (which drops the release flags). It never runs
 * in a hook, so it can never hold a session up. The body is read as a stream
 * and cut at 16 KB; redirects are refused; 3 s is the limit. Only VALIDATED
 * SCALARS are copied out — version strings matching `x.y.z`, an integer, a
 * boolean — and every line is built from local templates, so no text from
 * the response can ever reach a model.
 *
 * **The switches** (the names /privacy publishes; change both together):
 *   - `"updateCheck": false` in `claude-code.json` — the durable one;
 *   - telling your Claude to stop: the `scope` tool's `updates: "off"`,
 *     recorded in the store (`UPDATE_OFF_KEY`), which every process here
 *     reads — the worker, the hook, Desktop's server and doctor;
 *   - `COUNTERPARTS_UPDATE_CHECK=off` where Counterparts runs;
 *   - Claude Code's `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
 * Any of them: no request. The first three are the person saying "no", so no
 * wake says anything about updates either (Mike's must-have, Q4: "stop
 * reminding me" must be enough). Only the last — which asked for no traffic,
 * not for silence — keeps the local "a newer one may be out" line.
 *
 * **Once-ness.** What has been told lives in one store meta key
 * (`UPDATE_TOLD_KEY`), claimed with `Store.updateMeta` the way
 * `stale-windows.ts` claims its line: two windows starting together say it
 * once, and a told line writes nothing.
 */
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";

import { lastOffer, offerDue } from "../core/onboarding.js";
import { shortDay, yearOf } from "../core/time.js";
import type { Store } from "../core/store/index.js";
import type { AdapterConfig } from "./config.js";
import { sidebarPluginRecorded } from "./host-wiring.js";
import type { InstallRoute } from "./plugin.js";
import { PLUGIN_ROOT_ENV, recordedForThisCopy } from "./plugin.js";
import { TRANSPILED } from "./runtime.js";
import type { RuntimeKind } from "./runtime.js";
import { installedVersion } from "./sessions.js";
import { PLUGIN_UPDATE_COMMUNITY, PLUGIN_UPDATE_STEP, PLUGIN_UPDATE_SYNCED, npmUpdateCommand, reloadStep } from "./update-words.js";

// ── names ─────────────────────────────────────────────────────────────────

/**
 * THE DAY THIS VERSION WAS RELEASED, `YYYY-MM-DD` — moved with
 * `SERVER_VERSION` (`mcp/server-words.ts`) in the release commit
 * (docs/RELEASING.md §1). A copy that makes no check (the directory flavor,
 * Claude Code's no-traffic switch, a check failing for weeks) says it is over
 * 30 days old from this alone, with nothing fetched. `test/update-check.test.ts`
 * holds it to CHANGELOG's heading for `SERVER_VERSION` once there is one.
 */
export const RELEASE_DATE = "2026-10-29";

export const UPDATE_CHECK_ENV = "COUNTERPARTS_UPDATE_CHECK";
export const NONESSENTIAL_TRAFFIC_ENV = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC";
/** Claude Code's switches that hide the plugin manager's Enable auto-update toggle (loading.md). */
export const HIDES_AUTO_UPDATE_ENV: readonly string[] = [NONESSENTIAL_TRAFFIC_ENV, "DISABLE_UPDATES", "DISABLE_AUTOUPDATER"];
export const FORCE_AUTO_UPDATE_ENV = "FORCE_AUTOUPDATE_PLUGINS";

export const LATEST_URL = "https://registry.npmjs.org/counterparts/latest";
export const UPDATE_CHECK_TIMEOUT_MS = 3_000;
export const LATEST_BODY_CAP = 16 * 1024;

/** The worker's record, beside the configuration (`npm-live.json`'s neighbour). */
export const UPDATES_FILE = "updates.json";
/** The day's try latches. */
export const UPDATES_DIR = "updates";
const STATE_CAP = 16 * 1024;

/** `"off"` when the person told their Claude to stop (the `scope` tool's `updates`). */
export const UPDATE_OFF_KEY = "adapter.update.check";
/** What the wake has said, as JSON (`Told`). */
export const UPDATE_TOLD_KEY = "adapter.update.told";

/** The behind rule's N when the release says none. */
export const DEFAULT_TELL_BEHIND = 3;
/** A behind line is said again after this many days, if the gap has not grown by N first. */
export const RETELL_DAYS = 14;
/** An urgent line is said once a day on at most this many days. */
export const URGENT_DAYS = 3;
/** The age line: a copy older than this many days, said once per copy. */
export const AGE_DAYS = 30;
/** A check that has not succeeded for this many days counts as "no check" for the age line. */
export const FAILING_DAYS = 14;

/** W1's lead (`claude-code/doctor-meaning.ts#MEANING_OFF_LEAD`), the same words: one voice for maintenance lines. */
export const UPDATE_LEAD = "Counterparts — tell your person when it fits, once this session:";
/** The urgent line's lead: now, not "when it fits". */
export const UPDATE_URGENT_LEAD = "Counterparts — tell your person now:";
/**
 * Room an update line leaves under the host's ceiling for what may follow it
 * in the same envelope (the write-up pointer, the first-launch question): a
 * line that would eat into it is not composed, and waits for a wake with room.
 */
export const UPDATE_ROOM_MARGIN = 600;
/** For the model, after every non-urgent update line: how "stop reminding me" is done. */
export const STOP_HINT = 'If they say stop: scope updates "off".';

// ── the switch ────────────────────────────────────────────────────────────

/** Which switch is off, or `none`. `asked` is the person telling their Claude. */
export type UpdateSwitch = "config" | "asked" | "env" | "nonessential" | "none";

const OFF_WORDS = new Set(["off", "0", "false", "no", "disable", "disabled"]);

/** A Claude Code style boolean variable: set to anything but empty, `0` or `false`. Off is the safe direction. */
export function envSet(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && v !== "0" && v !== "false";
}

/**
 * Did the person tell their Claude to stop? Never throws. An unreadable store
 * reads as "no" for a line (saying nothing is the quiet direction anyway) and
 * as "yes" for the worker, which would otherwise make a request the person may
 * have refused (`failClosed`).
 */
export function askedOff(store: Pick<Store, "getMeta"> | null, opts: { readonly failClosed?: boolean } = {}): boolean {
  try {
    return store?.getMeta(UPDATE_OFF_KEY) === "off";
  } catch {
    return opts.failClosed === true;
  }
}

export function updateSwitch(input: {
  readonly config: Pick<AdapterConfig, "updateCheck">;
  readonly asked: boolean;
  readonly env: Record<string, string | undefined>;
}): UpdateSwitch {
  if (input.config.updateCheck === false) return "config";
  if (input.asked) return "asked";
  const own = input.env[UPDATE_CHECK_ENV];
  if (own !== undefined && OFF_WORDS.has(own.trim().toLowerCase())) return "env";
  if (envSet(input.env[NONESSENTIAL_TRAFFIC_ENV])) return "nonessential";
  return "none";
}

/** The person said no (any switch but Claude Code's traffic one): silence, the age line included. */
export function personSaidNo(sw: UpdateSwitch): boolean {
  return sw === "config" || sw === "asked" || sw === "env";
}

// ── versions ──────────────────────────────────────────────────────────────

const PLAIN = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const PRERELEASE = /^\d{1,4}\.\d{1,4}\.\d{1,6}-[0-9A-Za-z.-]{1,40}$/;

function parts(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** `a` below `b`, comparing `x.y.z` only (a `-<sha>` suffix ignored); false when either is not a version. */
export function versionBelow(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const x = parts(a);
  const y = parts(b);
  if (x === null || y === null) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!;
  return false;
}

/** How far behind: patch releases within one minor; a different major or minor counts as far (1000). */
export function releasesBehind(installed: string, latest: string): number {
  const x = parts(installed);
  const y = parts(latest);
  if (x === null || y === null || !versionBelow(installed, latest)) return 0;
  if (x[0] !== y[0] || x[1] !== y[1]) return 1000;
  return y[2] - x[2];
}

// ── the request ───────────────────────────────────────────────────────────

/** What a release says about who should hear of it (`package.json` `"counterparts": { "updates": … }`). */
export interface ReleaseFlags {
  /** Anyone below it is told once. Cumulative: only ever raised. */
  readonly tellBelow: string | null;
  /** Anyone below it is told urgently. Cumulative too. */
  readonly urgentBelow: string | null;
  /** N for the behind rule. */
  readonly tellBehind: number;
  /** False for a release whose plugin pin is not moving: plugin installs are not told about it. */
  readonly plugin: boolean;
}

export type LatestRead =
  | ({ readonly ok: true; readonly latest: string | null } & ReleaseFlags)
  | { readonly ok: false; readonly code: string };

/** Validate `/latest`'s JSON into scalars. Pure. Anything carrying text where a version belongs is a failure. */
export function readLatest(body: unknown): LatestRead {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "bad-json" };
  const rec = body as Record<string, unknown>;
  const version = rec["version"];
  if (typeof version !== "string") return { ok: false, code: "bad-version" };
  let latest: string | null;
  if (PLAIN.test(version)) latest = version;
  // A prerelease published without `--tag`: no news, not a fault.
  else if (PRERELEASE.test(version)) latest = null;
  else return { ok: false, code: "bad-version" };
  const block = (rec["counterparts"] as Record<string, unknown> | undefined)?.["updates"];
  const flags = block === undefined ? {} : block;
  if (flags === null || typeof flags !== "object" || Array.isArray(flags)) return { ok: false, code: "bad-flags" };
  const f = flags as Record<string, unknown>;
  const floor = (key: string): string | null | false => {
    const v = f[key];
    if (v === undefined || v === null) return null;
    return typeof v === "string" && PLAIN.test(v) ? v : false;
  };
  const tellBelow = floor("tellBelow");
  const urgentBelow = floor("urgentBelow");
  if (tellBelow === false || urgentBelow === false) return { ok: false, code: "bad-flags" };
  const n = f["tellBehind"];
  if (n !== undefined && (typeof n !== "number" || !Number.isInteger(n))) return { ok: false, code: "bad-flags" };
  const p = f["plugin"];
  if (p !== undefined && typeof p !== "boolean") return { ok: false, code: "bad-flags" };
  return {
    ok: true,
    latest,
    tellBelow,
    urgentBelow,
    tellBehind: n === undefined ? DEFAULT_TELL_BEHIND : Math.min(50, Math.max(1, n)),
    plugin: p !== false,
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * THE ONE REQUEST. Never throws: every failure is `{ ok: false, code }`.
 * The fetch is injected (the worker passes the runtime's own); tests pass a
 * stub, and nothing here reaches for a global.
 */
export async function fetchLatest(input: { readonly fetch: FetchLike; readonly signal?: AbortSignal; readonly timeoutMs?: number }): Promise<LatestRead> {
  // A timer of our own, not `AbortSignal.timeout`: Node unrefs that one, so a
  // request that holds nothing else open would let the loop drain before the
  // limit ever fired. Cleared in `finally`, so it never outlives the request.
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), input.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS);
  const signal = input.signal === undefined ? limit.signal : AbortSignal.any([limit.signal, input.signal]);
  try {
    const res = await input.fetch(LATEST_URL, {
      method: "GET",
      redirect: "error",
      signal,
      headers: { "user-agent": "counterparts" },
    });
    if (!res.ok) return { ok: false, code: `http-${String(res.status)}` };
    if (res.body === null) return { ok: false, code: "no-body" };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LATEST_BODY_CAP) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "too-large" };
      }
      chunks.push(value);
    }
    const all = new Uint8Array(bytes);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(all));
    } catch {
      return { ok: false, code: "bad-json" };
    }
    return readLatest(parsed);
  } catch (err) {
    if (signal.aborted) return { ok: false, code: "timeout" };
    return { ok: false, code: err instanceof Error && err.name.length > 0 ? err.name.slice(0, 40) : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

// ── the worker's record ───────────────────────────────────────────────────

/** `updates.json`: what the worker last decided and learned. Validated on every read. */
export interface UpdateState {
  /** The switch the worker last obeyed (doctor reports this, not its own environment). */
  readonly switch: UpdateSwitch;
  readonly at: string;
  /** Claude Code keeps this plugin updated itself: no check made. */
  readonly autoUpdate?: boolean;
  /** The date of the last successful check, and when. */
  readonly checkedDate?: string;
  readonly okAt?: string;
  readonly failedAt?: string;
  readonly failCode?: string;
  /** The first date of the failures since the last success; absent after a success. */
  readonly failingSince?: string;
  /** Failed days in a row since the last success (one try a day). */
  readonly failures?: number;
  /** The newest plain `x.y.z` npm reported, or null (a prerelease `latest`: no news). */
  readonly latest?: string | null;
  /** The date `latest` was first seen: a plugin install is told only from the next day on. */
  readonly latestSeen?: string;
  readonly flags?: ReleaseFlags;
}

export function updatesPath(configPath: string): string {
  return join(dirname(configPath), UPDATES_FILE);
}

const SWITCHES: readonly UpdateSwitch[] = ["config", "asked", "env", "nonessential", "none"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;
const CODE = /^[A-Za-z0-9_.-]{1,40}$/;

/** Read `updates.json`, size-bounded; anything malformed is no record at all. Never throws. */
export function readUpdateState(configPath: string): UpdateState | null {
  try {
    const file = updatesPath(configPath);
    if (statSync(file).size > STATE_CAP) return null;
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r["switch"] !== "string" || !(SWITCHES as readonly string[]).includes(r["switch"])) return null;
    if (typeof r["at"] !== "string" || !ISO.test(r["at"])) return null;
    const out: { -readonly [K in keyof UpdateState]: UpdateState[K] } = { switch: r["switch"] as UpdateSwitch, at: r["at"] };
    if (r["autoUpdate"] === true) out.autoUpdate = true;
    if (typeof r["checkedDate"] === "string" && DATE.test(r["checkedDate"])) out.checkedDate = r["checkedDate"];
    if (typeof r["okAt"] === "string" && ISO.test(r["okAt"])) out.okAt = r["okAt"];
    if (typeof r["failedAt"] === "string" && ISO.test(r["failedAt"])) out.failedAt = r["failedAt"];
    if (typeof r["failCode"] === "string" && CODE.test(r["failCode"])) out.failCode = r["failCode"];
    if (typeof r["failingSince"] === "string" && DATE.test(r["failingSince"])) out.failingSince = r["failingSince"];
    if (typeof r["failures"] === "number" && Number.isInteger(r["failures"]) && r["failures"] > 0 && r["failures"] < 100_000) out.failures = r["failures"];
    if (r["latest"] === null || (typeof r["latest"] === "string" && PLAIN.test(r["latest"]))) out.latest = r["latest"];
    if (typeof r["latestSeen"] === "string" && DATE.test(r["latestSeen"])) out.latestSeen = r["latestSeen"];
    if (r["flags"] !== undefined) {
      // The same validation as the response's, so a hand-edited file says nothing either.
      const f = readLatest({ version: "0.0.0", counterparts: { updates: r["flags"] } });
      if (f.ok) out.flags = { tellBelow: f.tellBelow, urgentBelow: f.urgentBelow, tellBehind: f.tellBehind, plugin: f.plugin };
    }
    return out;
  } catch {
    return null;
  }
}

function writeUpdateState(configPath: string, state: UpdateState): boolean {
  const file = updatesPath(configPath);
  const tmp = `${file}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // a filesystem without modes: the write stands
    }
    renameSync(tmp, file);
    return true;
  } catch {
    rmSync(tmp, { force: true });
    return false;
  }
}

// ── where this copy came from (read off its own path) ─────────────────────

/** `counterparts` (ours), `claude-community` (the directory listing), `synced` (claude.ai's directory), or null. */
export type PluginMarket = string | "synced" | null;

/**
 * The marketplace a plugin copy came through, read off `CLAUDE_PLUGIN_ROOT`
 * only — `<plugins>/cache/<marketplace>/<plugin>/<version>` or
 * `<plugins>/synced/…`. Reads no file, so the directory flavor (which reads
 * nothing of Claude Code's) may ask it too. Null outside the plugins folder.
 */
export function pluginMarket(input: { readonly home: string; readonly env: Record<string, string | undefined> }): PluginMarket {
  const root = (input.env[PLUGIN_ROOT_ENV] ?? "").trim();
  if (root.length === 0) return null;
  const moved = (input.env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  const cache = (input.env["CLAUDE_CODE_PLUGIN_CACHE_DIR"] ?? "").trim();
  const plugins = resolve(cache.length > 0 ? cache : join(moved.length > 0 ? moved : join(input.home, ".claude"), "plugins"));
  const rel = relative(plugins, resolve(root));
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return null;
  const seg = rel.split(/[\\/]/);
  if (seg[0] === "synced") return "synced";
  if (seg[0] === "cache" && (seg[1] ?? "").length > 0) return seg[1] ?? null;
  return null;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (statSync(path).size > 256 * 1024) return null;
    const v: unknown = JSON.parse(readFileSync(path, "utf8"));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * IS CLAUDE CODE'S OWN AUTO-UPDATE ON for this marketplace? (Full flavor only;
 * READ-ONLY.) Settings `extraKnownMarketplaces.<mkt>.autoUpdate` first, then
 * `known_marketplaces.json`'s `<mkt>.autoUpdate`; neither saying: off, the
 * default for a third-party marketplace. Never throws.
 */
export function claudeAutoUpdate(input: { readonly home: string; readonly env: Record<string, string | undefined>; readonly market: string }): boolean {
  try {
    const moved = (input.env["CLAUDE_CONFIG_DIR"] ?? "").trim();
    const configDir = moved.length > 0 ? moved : join(input.home, ".claude");
    const extra = readJson(join(configDir, "settings.json"))?.["extraKnownMarketplaces"];
    const fromSettings = (extra as Record<string, Record<string, unknown>> | undefined)?.[input.market]?.["autoUpdate"];
    if (typeof fromSettings === "boolean") return fromSettings;
    const cache = (input.env["CLAUDE_CODE_PLUGIN_CACHE_DIR"] ?? "").trim();
    const known = readJson(join(cache.length > 0 ? cache : join(configDir, "plugins"), "known_marketplaces.json"));
    const fromKnown = (known?.[input.market] as Record<string, unknown> | undefined)?.["autoUpdate"];
    return fromKnown === true;
  } catch {
    return false;
  }
}

/** Claude Code hides the Enable auto-update toggle: offering it would point at a menu item that is not there. */
export function autoUpdateHidden(env: Record<string, string | undefined>): boolean {
  if (envSet(env[FORCE_AUTO_UPDATE_ENV])) return false;
  return HIDES_AUTO_UPDATE_ENV.some((k) => envSet(env[k]));
}

// ── the worker's step ─────────────────────────────────────────────────────

export interface UpdateCheckReport {
  readonly ran: boolean;
  readonly reason: "observer" | "off" | "auto-update" | "checked-today" | "aborted" | "ok" | "failed";
  readonly switch: UpdateSwitch;
  readonly code?: string;
  readonly latest?: string | null;
}


/**
 * ONE WORKER'S TURN AT THE CHECK. Runs after the worker's store is closed
 * (it needs none: `asked` was read before the close). Never throws.
 *
 *   - observer: nothing, not even a record;
 *   - any switch off: no request; the switch is recorded so doctor can say
 *     which (doctor in a terminal does not share the worker's environment);
 *   - Claude Code keeps this plugin updated (`autoUpdate`): no request;
 *   - a worker already stopping (its watchdog fired): nothing, no try spent;
 *   - otherwise AT MOST ONE REQUEST A DAY, failures included (/privacy says
 *     "once a day"): the day's try is claimed with an exclusive latch file,
 *     so two workers starting together make one request, and a day that
 *     failed simply tries again the next day.
 */
export async function runUpdateCheck(input: {
  readonly configPath: string;
  readonly config: AdapterConfig;
  readonly asked: boolean;
  readonly env: Record<string, string | undefined>;
  readonly date: string;
  readonly fetch: FetchLike;
  readonly signal?: AbortSignal;
  readonly now?: number;
  readonly autoUpdate?: boolean;
}): Promise<UpdateCheckReport> {
  const sw = updateSwitch({ config: input.config, asked: input.asked, env: input.env });
  if (input.config.observer === true) return { ran: false, reason: "observer", switch: sw };
  const now = input.now ?? Date.now();
  const at = new Date(now).toISOString();
  try {
    const prev = readUpdateState(input.configPath);
    if (sw !== "none") {
      if (prev?.switch !== sw) writeUpdateState(input.configPath, { ...(prev ?? {}), switch: sw, at });
      return { ran: false, reason: "off", switch: sw };
    }
    if (input.autoUpdate === true) {
      if (prev?.autoUpdate !== true || prev.switch !== "none") writeUpdateState(input.configPath, { ...(prev ?? {}), switch: "none", at, autoUpdate: true });
      return { ran: false, reason: "auto-update", switch: sw };
    }
    if (input.signal?.aborted === true) return { ran: false, reason: "aborted", switch: sw };
    // The day's one try: its latch, every other day's swept.
    const dir = join(dirname(input.configPath), UPDATES_DIR);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(dir)) {
      const m = /^try-(\d{4}-\d{2}-\d{2})(?:-\d+)?$/.exec(name);
      if (m !== null && m[1] !== input.date) rmSync(join(dir, name), { force: true });
    }
    try {
      closeSync(openSync(join(dir, `try-${input.date}`), "wx", 0o600));
    } catch {
      // Today's try is taken — made, failed, or in flight in another worker.
      if (prev !== null && (prev.switch !== "none" || prev.autoUpdate === true)) {
        const { autoUpdate: _drop, ...rest } = prev;
        writeUpdateState(input.configPath, { ...rest, switch: "none", at });
      }
      return { ran: false, reason: "checked-today", switch: sw };
    }
    const read = await fetchLatest({ fetch: input.fetch, ...(input.signal === undefined ? {} : { signal: input.signal }) });
    const latestPrev = readUpdateState(input.configPath) ?? prev;
    if (!read.ok) {
      const { autoUpdate: _drop, ...rest } = latestPrev ?? { switch: "none" as const, at };
      writeUpdateState(input.configPath, {
        ...rest,
        switch: "none",
        at,
        failedAt: at,
        failCode: read.code,
        // Failed days in a row (one try a day), and the first of them: doctor
        // turns amber, and the age line counts this copy as unchecked, only
        // after a while.
        failures: (latestPrev?.failures ?? 0) + 1,
        failingSince: latestPrev?.failingSince ?? input.date,
      });
      return { ran: true, reason: "failed", switch: sw, code: read.code };
    }
    const seen = latestPrev?.latest === read.latest && latestPrev?.latestSeen !== undefined ? latestPrev.latestSeen : input.date;
    writeUpdateState(input.configPath, {
      switch: "none",
      at,
      checkedDate: input.date,
      okAt: at,
      latest: read.latest,
      latestSeen: seen,
      flags: { tellBelow: read.tellBelow, urgentBelow: read.urgentBelow, tellBehind: read.tellBehind, plugin: read.plugin },
    });
    return { ran: true, reason: "ok", switch: sw, latest: read.latest };
  } catch {
    return { ran: false, reason: "failed", switch: sw, code: "state" };
  }
}

// ── the lines ─────────────────────────────────────────────────────────────

/** What the wake has told (`UPDATE_TOLD_KEY`). */
interface Told {
  tell?: string;
  urgent?: { floor: string; dates: string[] };
  /** The `latest` an exhausted urgent floor was last told as an ordinary line for (design Q4: "then once per version"). */
  urgentAfter?: string;
  behind?: { latest: string; installed: string; gap: number; date: string };
  offered?: string;
  /** The release date the age line was said for: once per copy. */
  age?: string;
}

function readTold(raw: string | undefined): Told {
  if (raw === undefined) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Told) : {};
  } catch {
    return {};
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export interface UpdateLineInput {
  readonly store: Store;
  readonly configPath: string | undefined;
  readonly config: AdapterConfig;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  /** How this copy came. */
  readonly route: InstallRoute;
  /** The version a person has installed: npm's running `package.json`; for the plugin, the highest Claude Code records (an updated, unreloaded window is not told to update). */
  readonly installed: string | null;
  /** This copy's release date, `YYYY-MM-DD` (`RELEASE_DATE` above). */
  readonly released: string;
  readonly today: string;
  /** The directory flavor (`runtime.ts#TRANSPILED`): makes no check and reads nothing of Claude Code's. */
  readonly transpiled: boolean;
  /** The sidebar plugin is recorded (it and the stood-down core plugin need the plugin step too). */
  readonly sidebar?: boolean;
  readonly codeTab?: boolean;
  readonly runtime?: RuntimeKind;
  /** Today is the day the first meeting was (last) offered: that day belongs to the meeting. */
  readonly meetingDay?: boolean;
  /** This wake already carries the urgent line: no second update line beside it. */
  readonly urgentSaid?: boolean;
  /**
   * Whether this line fits the envelope it would join. A line that does not
   * fit is NOT claimed — nothing is marked told — so the next wake says it.
   * Absent: it fits.
   */
  readonly fits?: (line: string) => boolean;
}

const PLUGIN_STEP_SHORT = "/plugin → Marketplaces → counterparts → Update marketplace";

/** Steps for this install's route, lower-case, no closing stop. Short: the wake is near its ceiling. */
export function updateSteps(input: Pick<UpdateLineInput, "route" | "sidebar" | "codeTab" | "runtime"> & { readonly market: PluginMarket }): string {
  const npm = `run ${npmUpdateCommand(input.runtime)}, then restart Claude Code`;
  const reload = input.codeTab === true ? "then start a new session" : "then /reload-plugins in each open window";
  const plugin =
    input.market === "synced"
      ? PLUGIN_UPDATE_SYNCED
      : `${input.market === "claude-community" ? PLUGIN_UPDATE_COMMUNITY.replace(/^in Claude Code, /, "") : PLUGIN_STEP_SHORT}, ${reload}`;
  if (input.route === "npm") return input.sidebar === true ? `${npm}; and ${PLUGIN_STEP_SHORT}` : npm;
  if (input.route === "plugin") return plugin;
  return `npm: ${npm} · plugin: ${plugin}`;
}

/** The urgent line's step: shorter still. */
function shortStep(route: InstallRoute, market: PluginMarket, runtime: RuntimeKind | undefined): string {
  const npm = npmUpdateCommand(runtime);
  const plugin = market === "synced" ? "restart Claude Code" : `/plugin → Marketplaces → ${market === "claude-community" ? "claude-community" : "counterparts"} → Update marketplace`;
  if (route === "npm") return npm;
  if (route === "plugin") return plugin;
  return `${npm}, or ${plugin}`;
}

function marketOf(input: UpdateLineInput): PluginMarket {
  return input.route === "npm" ? null : pluginMarket({ home: input.home, env: input.env });
}

/** The person's switch, as this process sees it (config, the store's `asked`, this environment). */
function switchHere(input: UpdateLineInput): UpdateSwitch {
  return updateSwitch({ config: input.config, asked: askedOff(input.store), env: input.env });
}

/**
 * WHAT THE WORKER'S RECORD LETS THIS ROUTE BE TOLD — the wake's rule, and
 * doctor's (constitution 16: one vocabulary). A plugin install waits until the
 * day after a version was first seen (npm goes live before the plugin tag),
 * and is never told about a release whose plugin pin is held (`plugin: false`).
 */
export function knownLatestFor(route: InstallRoute, state: UpdateState | null, today: string): { latest: string; flags: ReleaseFlags } | null {
  if (state === null || state.latest === undefined || state.latest === null || state.flags === undefined) return null;
  if (route !== "npm") {
    if (state.flags.plugin === false) return null;
    if (state.latestSeen === undefined || state.latestSeen >= today) return null;
  }
  return { latest: state.latest, flags: state.flags };
}

function quiet(input: UpdateLineInput): boolean {
  return input.config.observer === true || input.meetingDay === true || input.installed === null;
}

const fitsOf = (input: UpdateLineInput) => (line: string): boolean => input.fits === undefined || input.fits(line);

/**
 * THE URGENT LINE, or null: installed below the release's `urgentBelow`.
 * Once a day on at most `URGENT_DAYS` days per floor. Claimed here, and only
 * when it fits. Never throws.
 */
export function urgentUpdateLine(input: UpdateLineInput): string | null {
  try {
    if (quiet(input) || switchHere(input) !== "none" || input.configPath === undefined) return null;
    const known = knownLatestFor(input.route, readUpdateState(input.configPath), input.today);
    const installed = input.installed as string;
    const floor = known?.flags.urgentBelow ?? null;
    if (known === null || floor === null || !versionBelow(installed, floor)) return null;
    const line = `${UPDATE_URGENT_LEAD} "Please update Counterparts soon (${installed} → ${known.latest}, a fix): ${shortStep(input.route, marketOf(input), input.runtime)}."`;
    if (!fitsOf(input)(line)) return null;
    const claimed = input.store.updateMeta(UPDATE_TOLD_KEY, (current) => {
      const told = readTold(current);
      const dates = told.urgent?.floor === floor ? told.urgent.dates : [];
      if (dates.length >= URGENT_DAYS || dates.includes(input.today)) return undefined;
      return JSON.stringify({ ...told, urgent: { floor, dates: [...dates, input.today] } });
    });
    return typeof claimed === "string" ? line : null;
  } catch {
    return null;
  }
}

/**
 * THE ONE OTHER UPDATE LINE, or null, in this order:
 *   1. **tell** (installed below `tellBelow`, once per floor), **behind**
 *      (`tellBehind` or more releases behind; again only at N more, or after
 *      `RETELL_DAYS`), or an urgent floor whose `URGENT_DAYS` are spent (once
 *      per newest version) — carrying the auto-update offer when it is due;
 *   2. **the auto-update offer**, once ever, for a plugin copy from our
 *      marketplace or the community one whose auto-update is not on and
 *      whose toggle is not hidden;
 *   3. **the age line**, for a copy that makes no check (the directory
 *      flavor, Claude Code's no-traffic switch, a check failing for
 *      `FAILING_DAYS`): over `AGE_DAYS` old, once per copy.
 * Nothing at all when the person said no (`personSaidNo`), under observer,
 * on the meeting's day, or in a wake that already carries the urgent line.
 * Claimed here, and only when it fits. Never throws.
 */
export function updateNoticeLine(input: UpdateLineInput): string | null {
  try {
    if (quiet(input) || input.urgentSaid === true) return null;
    const sw = switchHere(input);
    if (personSaidNo(sw)) return null;
    const fits = fitsOf(input);
    const installed = input.installed as string;
    const market = marketOf(input);
    const steps = updateSteps({ ...input, market });
    const state = input.configPath === undefined || input.transpiled ? null : readUpdateState(input.configPath);
    const autoOn = state?.autoUpdate === true || (!input.transpiled && market !== null && market !== "synced" && claudeAutoUpdate({ home: input.home, env: input.env, market }));
    const offerable = input.route === "plugin" && market !== null && market !== "synced" && !autoOn && !autoUpdateHidden(input.env);
    const offerStep = `/plugin → Marketplaces → ${String(market)} → Enable auto-update`;
    const known = sw === "none" ? knownLatestFor(input.route, state, input.today) : null;

    if (known !== null) {
      const gap = releasesBehind(installed, known.latest);
      let said: string | null = null;
      const claimed = input.store.updateMeta(UPDATE_TOLD_KEY, (current) => {
        const told = readTold(current);
        const tellFloor = known.flags.tellBelow;
        const urgentFloor = known.flags.urgentBelow;
        const offering = offerable && told.offered === undefined;
        const next: Told = { ...told, ...(offering ? { offered: input.today } : {}) };
        // An urgent day already told (another window, earlier today): nothing
        // ordinary beside it on the same day.
        if (urgentFloor !== null && versionBelow(installed, urgentFloor) && told.urgent?.floor === urgentFloor && told.urgent.dates.includes(input.today)) {
          return undefined;
        }
        const urgentSpent =
          urgentFloor !== null &&
          versionBelow(installed, urgentFloor) &&
          told.urgent?.floor === urgentFloor &&
          told.urgent.dates.length >= URGENT_DAYS &&
          !told.urgent.dates.includes(input.today);
        if (tellFloor !== null && versionBelow(installed, tellFloor) && told.tell !== tellFloor) {
          next.tell = tellFloor;
        } else if (urgentSpent && told.urgentAfter !== known.latest) {
          next.urgentAfter = known.latest;
        } else if (gap >= known.flags.tellBehind) {
          const b = told.behind;
          const fresh = b === undefined || b.installed !== installed;
          const due = fresh || gap >= b.gap + known.flags.tellBehind || daysBetween(b.date, input.today) >= RETELL_DAYS;
          if (!due) return undefined;
          next.behind = { latest: known.latest, installed, gap, date: input.today };
        } else {
          return undefined;
        }
        const line = `${UPDATE_LEAD} "Counterparts ${known.latest} is out (I'm on ${installed}). To update: ${steps}.${offering ? ` Or turn on auto-update: ${offerStep}.` : ""}" ${STOP_HINT}`;
        if (!fits(line)) return undefined;
        said = line;
        return JSON.stringify(next);
      });
      if (typeof claimed === "string" && said !== null) return said;
    }

    if (offerable) {
      const line = `${UPDATE_LEAD} "Claude Code can keep me current: ${offerStep}." ${STOP_HINT}`;
      if (fits(line)) {
        const claimed = input.store.updateMeta(UPDATE_TOLD_KEY, (current) => {
          const told = readTold(current);
          return told.offered === undefined ? JSON.stringify({ ...told, offered: input.today }) : undefined;
        });
        if (typeof claimed === "string") return line;
      }
    }

    const failing = state?.failingSince !== undefined && daysBetween(state.failingSince, input.today) >= FAILING_DAYS;
    const noCheck = input.transpiled || sw === "nonessential" || failing;
    if (noCheck && DATE.test(input.released) && daysBetween(input.released, input.today) > AGE_DAYS) {
      // `Oct 28`, or the date as written in another year (`time.ts#shortDay`: dates are time.ts's to format).
      const when = shortDay(input.released, yearOf(input.today));
      const line = `${UPDATE_LEAD} "This Counterparts is from ${when}; a newer one may be out. If you'd like it: ${steps}." ${STOP_HINT}`;
      if (fits(line)) {
        const claimed = input.store.updateMeta(UPDATE_TOLD_KEY, (current) => {
          const told = readTold(current);
          return told.age === input.released ? undefined : JSON.stringify({ ...told, age: input.released });
        });
        if (typeof claimed === "string") return line;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The installed version a plugin window is judged by: the highest of what it runs and what Claude Code records. */
export function installedForRoute(route: InstallRoute, running: string | null, recorded: () => string | null): string | null {
  if (route !== "plugin") return running;
  let rec: string | null = null;
  try {
    rec = recorded();
  } catch {
    rec = null;
  }
  if (rec === null) return running;
  return running === null || versionBelow(running, rec) ? rec : running;
}

/**
 * THE MEETING'S DAY: the day the first meeting was last offered, or a wake
 * that makes the offer now (re-check of #672: the offer is recorded only after
 * the wake is built, so a fresh install's first wake read as "no offer yet"
 * and carried "Enable auto-update" beside the meeting). Never throws: a store
 * that will not say is not the meeting's day.
 */
function meetingDay(store: Store, today: string, session: string): boolean {
  try {
    if (lastOffer(store)?.on === today) return true;
    return offerDue(store, { on: today, session }).due;
  } catch {
    return false;
  }
}

/**
 * THE LINES' INPUT FOR THIS PROCESS — what the session-start hook and
 * Desktop's `wake` both pass: the version this person has installed (the
 * plugin's highest record, so an updated window that has not reloaded is not
 * told to update), this copy's release date and flavor, the sidebar (npm
 * route only, full flavor only: the directory flavor reads nothing of Claude
 * Code's), and whether today is the first meeting's day (the day it was last
 * offered — not "still pending": a person who said "later" and never came back
 * must still hear of an urgent fix).
 */
export function updateLineInputHere(input: {
  readonly store: Store;
  readonly configPath: string | undefined;
  readonly config: AdapterConfig;
  readonly route: InstallRoute;
  readonly today: string;
  readonly env?: Record<string, string | undefined>;
  readonly home: string;
  readonly cwd?: string | null;
  readonly codeTab?: boolean;
  /** This session's id, for whether this very wake makes the meeting offer; absent, any session. */
  readonly session?: string;
}): UpdateLineInput {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? null;
  const installed = installedForRoute(input.route, installedVersion(), () =>
    TRANSPILED ? null : recordedForThisCopy({ home: input.home, env, cwd }),
  );
  let sidebar = false;
  if (input.route === "npm" && !TRANSPILED) {
    try {
      sidebar = sidebarPluginRecorded({ home: input.home, env, cwd });
    } catch {
      sidebar = false;
    }
  }
  return {
    store: input.store,
    configPath: input.configPath,
    config: input.config,
    env,
    home: input.home,
    route: input.route,
    installed,
    released: RELEASE_DATE,
    today: input.today,
    transpiled: TRANSPILED,
    sidebar,
    codeTab: input.codeTab === true,
    meetingDay: meetingDay(input.store, input.today, input.session ?? ""),
  };
}
