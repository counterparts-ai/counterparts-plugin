import { isAbsolute } from "node:path";
import { REQUIRE_EXPLICIT_DIR_ENV } from "../../../core/store/paths.js";
import { CONFIG_ENV } from "../../config-path.js";
import { toMyVoice } from "./ask-voice.js";
export const NO_CONFIG_HOME = "/nonexistent/counterparts-dashboard-bare-store";
export const ACTIONS = ["ask", "note", "remove", "delete", "about", "backup", "export", "scope", "rebrief", "verify", "doctor"];
const DELETE_KINDS = ["conversation-text", "backups", "activity-log"];
export function isActionName(name) {
  return ACTIONS.includes(name);
}
export const TOKEN_HEADER = "x-counterparts-token";
export const TOKEN_META = "counterparts-action-token";
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 256 * 1024;
export const TIMEOUT_MS = {
  ask: 120000,
  note: 120000,
  remove: 120000,
  delete: 10 * 60000,
  about: 30000,
  scope: 30000,
  rebrief: 120000,
  backup: 30 * 60000,
  export: 30 * 60000,
  verify: 30 * 60000,
  doctor: 60000
};
export function newActionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function tokensMatch(given, expected) {
  if (given.length !== expected.length || expected.length === 0)
    return false;
  let diff = 0;
  for (let i = 0;i < expected.length; i++)
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function checkActionRequest(req, expectedToken, boundPort) {
  if (req.method !== "POST") {
    return { status: 405, error: "an action is a POST; nothing was done" };
  }
  const host = hostPort(req.host);
  if (host === null || !LOOPBACK.has(host.name) || host.port !== boundPort) {
    return { status: 403, error: "forbidden: an action must be addressed to this dashboard on 127.0.0.1" };
  }
  if (req.origin === null || req.origin.length === 0) {
    return { status: 403, error: "forbidden: an action must come from the dashboard's own page (no Origin)" };
  }
  let origin;
  try {
    origin = new URL(req.origin);
  } catch {
    return { status: 403, error: "forbidden: an unreadable Origin" };
  }
  const originHost = hostPort(origin.host);
  if (origin.protocol !== "http:" || originHost === null || originHost.name !== host.name || originHost.port !== host.port) {
    return { status: 403, error: "forbidden: an action must come from the dashboard's own page (cross-origin)" };
  }
  if (req.fetchSite !== null && req.fetchSite !== "same-origin") {
    return { status: 403, error: "forbidden: the browser says this request is not same-origin" };
  }
  if (req.contentType === null || !/^application\/json\s*(;|$)/i.test(req.contentType)) {
    return { status: 415, error: "an action's body is JSON (content-type: application/json)" };
  }
  if (req.token === null || !tokensMatch(req.token, expectedToken)) {
    return { status: 403, error: "forbidden: this request does not carry the page's token. Reload the dashboard." };
  }
  return null;
}
function hostPort(raw) {
  if (raw === null)
    return null;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(raw.trim());
  if (m === null)
    return null;
  const port = m[2] === undefined ? 80 : Number(m[2]);
  return { name: (m[1] ?? "").toLowerCase(), port };
}
const ABOUT_CHOICES = ["me", "us", "owner", "work", "world"];
const ID = /^(mem|epi|sch)_[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 20000;
const MAX_LINE = 2000;

class Invalid extends Error {
}
function text(body, key, max, required) {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (required)
      throw new Invalid(`${key} is required`);
    return;
  }
  if (typeof v !== "string")
    throw new Invalid(`${key} must be text`);
  if (v.includes("\x00"))
    throw new Invalid(`${key} may not contain a NUL`);
  if (v.length > max)
    throw new Invalid(`${key} is longer than ${String(max)} characters`);
  if (v.trim().length === 0) {
    if (required)
      throw new Invalid(`${key} is required`);
    return;
  }
  return v;
}
function flag(body, key) {
  const v = body[key];
  if (v === undefined || v === null || v === false)
    return false;
  if (v === true)
    return true;
  throw new Invalid(`${key} is true or false`);
}
function memoryId(body, key, required) {
  const v = text(body, key, 80, required);
  if (v === undefined)
    return;
  const id = v.trim();
  if (!ID.test(id))
    throw new Invalid(`${key} is not a memory id (mem_…)`);
  return id;
}
function absPath(body, key) {
  const v = text(body, key, 4096, true);
  if (/[\x00-\x1f\x7f]/.test(v))
    throw new Invalid(`${key} may not contain control characters`);
  if (!isAbsolute(v))
    throw new Invalid(`${key} must be an absolute path`);
  return v;
}
function words(value, key) {
  if (value.trimStart().startsWith("--")) {
    throw new Invalid(`${key} may not begin with "--" (the console would read it as a flag)`);
  }
  return value;
}
function withConfig(ctx) {
  return ctx.config === undefined ? [] : ["--config", ctx.config];
}
export function buildArgv(name, body, ctx) {
  const built = argvFor(name, body, ctx);
  return ctx.config === undefined ? { ...built, ...bareStore(name) } : built;
}
function bareStore(name) {
  const env = { [REQUIRE_EXPLICIT_DIR_ENV]: "1", [CONFIG_ENV]: undefined };
  return name === "doctor" ? { env } : { env, home: NO_CONFIG_HOME };
}
function argvFor(name, body, ctx) {
  const dir = ["--dir", ctx.dir];
  switch (name) {
    case "ask": {
      const question = text(body, "question", MAX_LINE, false);
      const id = memoryId(body, "id", false);
      if (question === undefined === (id === undefined)) {
        throw new Invalid("ask takes a question or an id — one of them");
      }
      const argv = ["ask", ...dir, ...withConfig(ctx)];
      if (flag(body, "full"))
        argv.push("--full");
      if (flag(body, "json"))
        argv.push("--json");
      if (id !== undefined)
        return { argv: [...argv, "--id", id] };
      const mode = body["mode"];
      if (mode !== undefined && mode !== null && mode !== "facts" && mode !== "meaning") {
        throw new Invalid("mode is facts or meaning");
      }
      if (mode === "meaning")
        argv.push("--mode", "meaning");
      const page = body["page"];
      if (page !== undefined && page !== null) {
        if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 1e4) {
          throw new Invalid("page is a whole number from 1");
        }
        argv.push("--page", String(page));
      }
      const typed = words(question, "question");
      const exact = flag(body, "exact");
      const owner = mode === "meaning" ? null : ctx.ownerName ?? null;
      const voiced = exact ? { text: typed, changed: false } : toMyVoice(typed, owner);
      if (!exact)
        argv.push("--voiced");
      return {
        argv: [...argv, "--", words(voiced.text, "question")],
        searched: { text: voiced.text, changed: voiced.changed, exact }
      };
    }
    case "note": {
      const content = text(body, "text", MAX_TEXT, true);
      const argv = ["note", ...dir, ...withConfig(ctx)];
      const kind = text(body, "kind", 40, false);
      if (kind !== undefined) {
        if (!/^[a-z][a-z_-]*$/.test(kind))
          throw new Invalid("kind is one word");
        argv.push("--kind", kind);
      }
      const title = text(body, "title", 200, false);
      if (title !== undefined)
        argv.push(`--title=${title}`);
      const salience = body["salience"];
      if (salience !== undefined && salience !== null && salience !== "") {
        if (typeof salience !== "number" || !Number.isFinite(salience) || salience < 0 || salience > 1) {
          throw new Invalid("salience is a number from 0 to 1");
        }
        argv.push("--salience", String(salience));
      }
      return { argv: [...argv, "--", words(content, "text")] };
    }
    case "remove": {
      const id = memoryId(body, "id", true);
      const argv = ["remove", ...dir];
      const reason = text(body, "reason", 500, false);
      if (reason !== undefined)
        argv.push(`--reason=${reason}`);
      const typed = body["confirm"];
      if (typed === undefined || typed === null)
        return { argv: [...argv, "--", id] };
      if (typeof typed !== "string" || typed.length > 80 || typed.includes("\x00")) {
        throw new Invalid("confirm is the id, typed back");
      }
      return { argv: [...argv, "--confirm", "--", id], answer: typed };
    }
    case "delete": {
      const kind = body["kind"];
      if (typeof kind !== "string" || !DELETE_KINDS.includes(kind)) {
        throw new Invalid(`kind is one of ${DELETE_KINDS.join(", ")}`);
      }
      return { argv: ["delete", ...dir, ...flag(body, "confirm") ? ["--yes"] : [], "--", kind] };
    }
    case "about": {
      const id = memoryId(body, "id", true);
      const mark = body["about"];
      if (typeof mark !== "string" || !ABOUT_CHOICES.includes(mark)) {
        throw new Invalid(`about is one of ${ABOUT_CHOICES.join(", ")}`);
      }
      const argv = ["about", ...dir];
      const why = text(body, "why", 500, false);
      if (why !== undefined)
        argv.push(`--why=${why}`);
      return { argv: [...argv, "--", id, mark] };
    }
    case "backup":
      return { argv: ["backup", ...dir, "--out", absPath(body, "out")] };
    case "export": {
      const argv = ["export", ...dir, "--out", absPath(body, "out")];
      const passphrase = text(body, "passphrase", 1024, false);
      if (passphrase !== undefined)
        argv.push(`--passphrase=${passphrase}`);
      const booleans = [
        ["plaintext", "--plaintext"],
        ["markdown", "--markdown"],
        ["includeConfidential", "--include-confidential"],
        ["withVersions", "--with-versions"],
        ["intoNonEmpty", "--into-non-empty"],
        ["overwrite", "--overwrite"]
      ];
      for (const [key, f] of booleans)
        if (flag(body, key))
          argv.push(f);
      return { argv };
    }
    case "scope": {
      if (ctx.config === undefined) {
        throw new Invalid("scope writes the registry beside a configuration, and this dashboard was opened on a store " + "without one. Open it with `counterparts dashboard` (or serve --config <path>).");
      }
      const argv = ["scope", ...withConfig(ctx)];
      if (flag(body, "list"))
        return { argv: [...argv, "--list"] };
      const path = absPath(body, "path");
      const mode = body["mode"];
      const MODES = {
        on: "--on",
        observer: "--observer",
        off: "--off",
        pause: "--pause",
        resume: "--resume"
      };
      if (mode !== undefined && mode !== null && mode !== "") {
        if (typeof mode !== "string" || !(mode in MODES)) {
          throw new Invalid("mode is one of on, observer, off, pause, resume");
        }
        argv.push(MODES[mode]);
        const note = text(body, "note", 500, false);
        if (note !== undefined)
          argv.push(`--note=${note}`);
      }
      return { argv: [...argv, "--", path] };
    }
    case "rebrief": {
      const argv = ["rebrief", ...dir, ...withConfig(ctx)];
      const budget = body["budget"];
      if (budget !== undefined && budget !== null && budget !== "") {
        if (typeof budget !== "number" || !Number.isInteger(budget) || budget <= 0) {
          throw new Invalid("budget is a whole number of bytes");
        }
        argv.push("--budget", String(budget));
      }
      return { argv };
    }
    case "verify": {
      const argv = ["verify", ...dir];
      const booleans = [
        ["rebuild", "--rebuild"],
        ["dropVectors", "--drop-vectors"],
        ["keepVectors", "--keep-vectors"],
        ["pruneIndex", "--prune-index"],
        ["retrySkipped", "--retry-skipped"]
      ];
      for (const [key, f] of booleans)
        if (flag(body, key))
          argv.push(f);
      return { argv };
    }
    case "doctor":
      return { argv: ["doctor", ...dir, ...withConfig(ctx), "--json"] };
  }
}
export function displayCommand(argv) {
  const shown = argv.map((a) => a.startsWith("--passphrase=") ? "--passphrase=…" : a);
  return ["counterparts", ...shown.map((a) => /^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))].join(" ");
}
let runner = null;
async function cliRun() {
  if (runner === null) {
    const mod = await import("../../cli/index.js");
    runner = mod.run;
  }
  return runner;
}
let running = null;
export function actionInFlight() {
  return running !== null;
}
export async function runAction(name, body, ctx, opts = {}) {
  if (!isActionName(name)) {
    return { status: 404, body: { error: `no such action: ${name}. The dashboard offers ${ACTIONS.join(", ")}.` } };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: 400, body: { error: "an action's body is a JSON object" } };
  }
  let built;
  try {
    built = buildArgv(name, body, ctx);
  } catch (err) {
    if (err instanceof Invalid)
      return { status: 400, body: { action: name, error: err.message } };
    throw err;
  }
  if (running !== null) {
    return {
      status: 409,
      body: { action: name, error: "another action is still running; nothing was done. Try again when it finishes." }
    };
  }
  const out = [];
  const err = [];
  let bytes = 0;
  let truncated = false;
  const keep = (into) => (line) => {
    if (truncated)
      return;
    bytes += line.length + 1;
    if (bytes > MAX_OUTPUT_BYTES) {
      truncated = true;
      return;
    }
    into.push(line);
  };
  let asked = false;
  const io = {
    out: keep(out),
    err: keep(err),
    ...built.answer === undefined ? {} : {
      prompt: async () => {
        if (asked)
          throw new Error("the dashboard answers one confirmation per action");
        asked = true;
        return built.answer;
      }
    }
  };
  const work = (async () => {
    const run = opts.run ?? await cliRun();
    const env = built.env === undefined ? ctx.env : { ...ctx.env ?? process.env, ...built.env };
    return run(built.argv, {
      io,
      ...env === undefined ? {} : { env },
      ...built.home !== undefined ? { home: built.home } : ctx.home === undefined ? {} : { home: ctx.home },
      scope: ctx.dir
    });
  })();
  const slot = work.then(() => {
    return;
  }, () => {
    return;
  });
  running = slot;
  slot.then(() => {
    if (running === slot)
      running = null;
  });
  const command = displayCommand(built.argv);
  const limit = opts.timeoutMs ?? TIMEOUT_MS[name];
  let timer;
  const timedOut = new Promise((done) => {
    timer = setTimeout(() => done("timeout"), limit);
  });
  let exit;
  try {
    exit = await Promise.race([work, timedOut]);
  } catch (e) {
    return {
      status: 500,
      body: { action: name, command, out, err, error: e instanceof Error ? e.message : String(e) }
    };
  } finally {
    if (timer !== undefined)
      clearTimeout(timer);
  }
  if (exit === "timeout") {
    return {
      status: 504,
      body: {
        action: name,
        command,
        out: [...out],
        err: [...err],
        error: `still running after ${String(Math.round(limit / 1000))}s. It cannot be stopped from here, so it is finishing in the background; no other action runs until it has.`
      }
    };
  }
  return {
    status: 200,
    body: {
      action: name,
      command,
      exit,
      ok: exit === 0,
      out,
      err,
      truncated,
      ...built.searched === undefined ? {} : { searched: built.searched }
    }
  };
}
