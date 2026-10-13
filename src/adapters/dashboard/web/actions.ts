/**
 * THE MANAGEMENT SEAM — what the owner does on purpose from the dashboard
 * (owner, 2026-09-25; CONTRACT §5, `docs/observer-mode.md` §1).
 *
 * Looking and managing are kept apart by WHICH DOOR a request goes through, not
 * by a mode:
 *
 *   - **Looking** is `server.ts#router` over the observer source, and nothing
 *     in this file can reach that source: no function here takes a
 *     `DashboardSource`, a `Dashboard` or a `Store`. It is handed the store's
 *     DIRECTORY and the configuration's PATH — two strings, exactly what a
 *     person types after `--dir` and `--config` — and, for `ask`, the owner's
 *     NAME, a third string the server reads off the identity core per request
 *     (`ask-voice.ts` turns the owner's question into my voice with it).
 *   - **Managing** is the console's own `run()` — the function
 *     `bin/counterparts.ts` calls — with an argv array built here from
 *     validated fields. Every check, refusal and sentence is the CLI's; this
 *     file adds guards in front of it and never a way around one.
 *
 * ## Why in-process, and not a child process
 *
 * A child process running `bin/counterparts.ts` would be the most literal
 * reading of "the CLI's own door", and it CANNOT REMOVE: `remove --confirm`
 * asks the person to type the id back through `io.prompt`, the bin binds a
 * prompt only when stdin is a terminal, and a pipe gets "refused: removal
 * requires an interactive confirmation" — deliberately, with no `--yes`.
 * In-process, the prompt is a seam `run()` already has (`Io.prompt`): the
 * browser asks the owner to type the id, and the string they typed is what the
 * CLI's own prompt receives, so the CLI's own comparison is what refuses a
 * mismatch. `io.tty` is left absent, so `isInteractive` is false and removal
 * takes the scripted door (`--confirm`) exactly as a script would.
 *
 * What that costs, said plainly: a command running in this process cannot be
 * killed. The timeout below stops WAITING and says so; the command finishes in
 * the background, and the queue holds every other action until it has.
 *
 * The CLI module is imported LAZILY, on the first action, so a dashboard that
 * is only looked at never loads a line of code that can write.
 *
 * ## Which commands
 *
 * `note`, `remove`, `delete` (one kind of data, 2026-10-13), `about` (what a
 * memory is about, 2026-10-11), `backup`,
 * `export`, `scope`, `rebrief`, `verify`, and the
 * read-only `ask` and `doctor` (the health tab's checklist: `doctor --json`,
 * the console's own reading, so the page and the terminal cannot disagree
 * about what "healthy" means). `install`, `uninstall` and `start-fresh` stay terminal-only
 * (owner, 2026-09-25) — they are not in `ACTIONS`, so no argv for them can be
 * built here.
 */
import { isAbsolute } from "node:path";

import { REQUIRE_EXPLICIT_DIR_ENV } from "../../../core/store/paths.js";
import { CONFIG_ENV } from "../../config-path.js";
import { toMyVoice } from "./ask-voice.js";

/**
 * THE HOME A BARE-STORE ACTION RESOLVES CONFIGURATIONS UNDER: a path that does
 * not exist, so the console's default configuration (`<home>/.counterparts/
 * claude-code.json`) is simply absent and every knob takes its default. See
 * `bareStore` below.
 */
export const NO_CONFIG_HOME = "/nonexistent/counterparts-dashboard-bare-store";

/** The actions, in the order a reader meets them. */
export const ACTIONS = ["ask", "note", "remove", "delete", "about", "backup", "export", "scope", "rebrief", "verify", "doctor"] as const;
export type ActionName = (typeof ACTIONS)[number];

/** The kinds `delete` takes — `cli/commands-delete.ts#DELETE_KINDS`, spelled
 *  again so this file imports nothing of the console up front. */
const DELETE_KINDS: readonly string[] = ["conversation-text", "backups", "activity-log"];

export function isActionName(name: string): name is ActionName {
  return (ACTIONS as readonly string[]).includes(name);
}

/** The header every action must echo the page's token in. */
export const TOKEN_HEADER = "x-counterparts-token";
/** The `<meta name>` the served page carries the token in. */
export const TOKEN_META = "counterparts-action-token";

/** A request body larger than this is refused before it is parsed. */
export const MAX_BODY_BYTES = 64 * 1024;
/** How much console output one action may return (both streams together). */
export const MAX_OUTPUT_BYTES = 256 * 1024;

/** How long the page waits for an action before it says it stopped waiting. */
export const TIMEOUT_MS: Record<ActionName, number> = {
  ask: 120_000,
  note: 120_000,
  remove: 120_000,
  // Deleting backups takes every copy apart file by file.
  delete: 10 * 60_000,
  about: 30_000,
  scope: 30_000,
  rebrief: 120_000,
  // The three that walk the whole store: a backup and an export copy it, and
  // `verify --rebuild` re-embeds it.
  backup: 30 * 60_000,
  export: 30 * 60_000,
  verify: 30 * 60_000,
  // A read, but a wide one: the whole event log, every scope's captured words,
  // and a few bounded `git` calls.
  doctor: 60_000,
};

/**
 * A fresh token for one launch of the dashboard. `crypto.getRandomValues` is
 * the platform's CSPRNG (bun and Node both), reached without importing a
 * module the adapter's import scan would have to learn about.
 */
export function newActionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Equal strings, compared in time that does not depend on where they differ. */
export function tokensMatch(given: string, expected: string): boolean {
  if (given.length !== expected.length || expected.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ── the request guard ───────────────────────────────────────────────────────

export interface ActionRequest {
  readonly method: string;
  readonly host: string | null;
  readonly origin: string | null;
  readonly contentType: string | null;
  readonly token: string | null;
  /** `Sec-Fetch-Site`, when the browser sends one. */
  readonly fetchSite: string | null;
}

export interface Refusal {
  readonly status: number;
  readonly error: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * EVERY ACTION PASSES THIS FIRST, before its body is read. It is what stands
 * between a page on some other website and the owner's memory: loopback alone
 * stops remote machines, not the owner's own browser being told to POST to
 * 127.0.0.1 (CSRF), nor a hostile name rebound to 127.0.0.1 (DNS rebinding —
 * the Host allowlist, v1 audit #30).
 *
 *   - POST only. A GET never acts, so a link, an <img>, a prefetch cannot.
 *   - Host is loopback, on the port this server is bound to.
 *   - Origin is REQUIRED and must be this same origin. A browser sends it on
 *     every POST; a request without one is not from this page.
 *   - `Sec-Fetch-Site`, when present, must say same-origin.
 *   - `Content-Type: application/json`, which a cross-site form cannot send
 *     and a cross-site fetch cannot send without a preflight this server never
 *     answers.
 *   - The per-launch token, which only a page served by THIS process holds:
 *     another origin cannot read the page it is embedded in.
 */
export function checkActionRequest(
  req: ActionRequest,
  expectedToken: string,
  boundPort: number,
): Refusal | null {
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
  let origin: URL;
  try {
    origin = new URL(req.origin);
  } catch {
    return { status: 403, error: "forbidden: an unreadable Origin" };
  }
  const originHost = hostPort(origin.host);
  if (
    origin.protocol !== "http:" ||
    originHost === null ||
    originHost.name !== host.name ||
    originHost.port !== host.port
  ) {
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

function hostPort(raw: string | null): { name: string; port: number } | null {
  if (raw === null) return null;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(raw.trim());
  if (m === null) return null;
  const port = m[2] === undefined ? 80 : Number(m[2]);
  return { name: (m[1] ?? "").toLowerCase(), port };
}

// ── validation and argv ─────────────────────────────────────────────────────

/** Where the command runs: the store and configuration the dashboard was opened on. */
export interface ActionContext {
  /** The store's directory — what the dashboard's own `--dir` resolved to. */
  readonly dir: string;
  /** The host configuration, when the dashboard was opened through one. */
  readonly config?: string;
  /** The console's environment. Real runs pass nothing and get `process.env`. */
  readonly env?: Record<string, string | undefined>;
  /** The home the console resolves configurations under (tests only). */
  readonly home?: string;
  /** The owner's name as the store knows it (`sleep#ownerNames`, first entry),
   *  or null: what `ask` puts in place of his "I" (`ask-voice.ts`). */
  readonly ownerName?: string | null;
}

/** What `ask` searched with: the question in my voice, unless asked exactly. */
export interface Searched {
  /** The text handed to `counterparts ask`. */
  readonly text: string;
  /** Whether it differs from what the owner typed. */
  readonly changed: boolean;
  /** The owner asked for it exactly as typed (nothing turned round). */
  readonly exact: boolean;
}

export interface Built {
  readonly argv: string[];
  /** What the CLI's confirmation prompt receives — the owner's own typing. */
  readonly answer?: string;
  /** Variables laid over the console's environment for this one run
   *  (`undefined` removes one). */
  readonly env?: Record<string, string | undefined>;
  /** The home the console resolves configurations under, for this one run. */
  readonly home?: string;
  /** `ask` by question: what it searched with. */
  readonly searched?: Searched;
}

/** The marks `about` takes (`store/index.ts#ABOUT_MARKS`, said again so this file imports no store). */
const ABOUT_CHOICES: readonly string[] = ["me", "us", "owner", "work", "world"];

/** A memory id as the store accepts one: its family prefix, no whitespace, no slash. */
const ID = /^(mem|epi|sch)_[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 20_000;
const MAX_LINE = 2_000;

type Body = Record<string, unknown>;

class Invalid extends Error {}

function text(body: Body, key: string, max: number, required: boolean): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new Invalid(`${key} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new Invalid(`${key} must be text`);
  if (v.includes("\0")) throw new Invalid(`${key} may not contain a NUL`);
  if (v.length > max) throw new Invalid(`${key} is longer than ${String(max)} characters`);
  if (v.trim().length === 0) {
    if (required) throw new Invalid(`${key} is required`);
    return undefined;
  }
  return v;
}

function flag(body: Body, key: string): boolean {
  const v = body[key];
  if (v === undefined || v === null || v === false) return false;
  if (v === true) return true;
  throw new Invalid(`${key} is true or false`);
}

function memoryId(body: Body, key: string, required: boolean): string | undefined {
  const v = text(body, key, 80, required);
  if (v === undefined) return undefined;
  const id = v.trim();
  if (!ID.test(id)) throw new Invalid(`${key} is not a memory id (mem_…)`);
  return id;
}

/** An absolute path, no NUL, no control characters. Where it may go is the CLI's call. */
function absPath(body: Body, key: string): string {
  const v = text(body, key, 4096, true) as string;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(v)) throw new Invalid(`${key} may not contain control characters`);
  if (!isAbsolute(v)) throw new Invalid(`${key} must be an absolute path`);
  return v;
}

/** A positional the console must read as words, never as a flag. */
function words(value: string, key: string): string {
  if (value.trimStart().startsWith("--")) {
    throw new Invalid(`${key} may not begin with "--" (the console would read it as a flag)`);
  }
  return value;
}

function withConfig(ctx: ActionContext): string[] {
  return ctx.config === undefined ? [] : ["--config", ctx.config];
}

/**
 * THE ARGV, from validated fields only. `--dir` is always the dashboard's own
 * store (never a field of the request), and every positional comes after `--`,
 * so no text the owner typed can be read as a flag.
 */
export function buildArgv(name: ActionName, body: Body, ctx: ActionContext): Built {
  const built = argvFor(name, body, ctx);
  return ctx.config === undefined ? { ...built, ...bareStore(name) } : built;
}

/**
 * A DASHBOARD OPENED ON A BARE STORE NEVER REACHES A DEFAULT CONFIGURATION.
 *
 * With no `--config` to pass, the console would resolve one on its own —
 * `COUNTERPARTS_CONFIG`, else `~/.counterparts/claude-code.json` — and on this
 * machine that is possibly the owner's live install: `rebrief` took its budget
 * from it, `ask` its recall-by-meaning setting. That is not the store this page
 * is looking at. So every action from a bare-store dashboard runs with:
 *
 *   - the explicit-dir guard armed, so any door that checks it refuses rather
 *     than falls back;
 *   - `COUNTERPARTS_CONFIG` removed, so a stale one in the server's shell names
 *     nothing;
 *   - a home that does not exist, so the default configuration is ABSENT and
 *     every knob takes its default — except `doctor`, whose host reading needs
 *     the real home (`~/.claude`, not ours) and which, under the guard with a
 *     `--dir`, declines to read the configuration at all and says so in its
 *     `config` line (doctor.ts, "not-read").
 *
 * An action that genuinely needs a configuration (`scope`) refuses in
 * `argvFor` before any of this.
 */
function bareStore(name: ActionName): Pick<Built, "env" | "home"> {
  const env = { [REQUIRE_EXPLICIT_DIR_ENV]: "1", [CONFIG_ENV]: undefined };
  return name === "doctor" ? { env } : { env, home: NO_CONFIG_HOME };
}

function argvFor(name: ActionName, body: Body, ctx: ActionContext): Built {
  const dir = ["--dir", ctx.dir];
  switch (name) {
    case "ask": {
      const question = text(body, "question", MAX_LINE, false);
      const id = memoryId(body, "id", false);
      if ((question === undefined) === (id === undefined)) {
        throw new Invalid("ask takes a question or an id — one of them");
      }
      const argv = ["ask", ...dir, ...withConfig(ctx)];
      if (flag(body, "full")) argv.push("--full");
      // The answers as data, so the page can list them and open each one.
      if (flag(body, "json")) argv.push("--json");
      if (id !== undefined) return { argv: [...argv, "--id", id] };
      // THE MODE (2026-10-09): facts is the console's default and adds
      // nothing; meaning is asked for by name. And which page of the answer.
      const mode = body["mode"];
      if (mode !== undefined && mode !== null && mode !== "facts" && mode !== "meaning") {
        throw new Invalid("mode is facts or meaning");
      }
      if (mode === "meaning") argv.push("--mode", "meaning");
      const page = body["page"];
      if (page !== undefined && page !== null) {
        if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 10_000) {
          throw new Invalid("page is a whole number from 1");
        }
        argv.push("--page", String(page));
      }
      // THE OWNER'S VOICE, TURNED INTO MINE (memories round 3b): "what have you
      // learned about yourself?" searches as "what have I learned about
      // myself?". The page shows what was searched and can ask again with
      // `exact: true`. The CLI's own `ask` is untouched.
      const typed = words(question as string, "question");
      const exact = flag(body, "exact");
      // In MEANING mode his "I" becomes "you", never his name (review of #333):
      // meaning then took the card with the most memories as its subject, so
      // "what has Ilya been to me" turned into "… to Rosalind" answered about
      // Rosalind. Since 2026-10-09 meaning picks the card the question is
      // about (`meaning.ts#subjectOf`), and in my voice (`--voiced`) "you" is
      // the owner to it: his feelings stay his, and "what have you been like"
      // is his own card.
      const owner = mode === "meaning" ? null : ctx.ownerName ?? null;
      const voiced = exact ? { text: typed, changed: false } : toMyVoice(typed, owner);
      // In MY voice, "I" is me: a question about feeling asks about the
      // counterpart's own feelings (`--voiced`, U13). `exact` keeps the owner's
      // words, and his "I".
      if (!exact) argv.push("--voiced");
      return {
        argv: [...argv, "--", words(voiced.text, "question")],
        searched: { text: voiced.text, changed: voiced.changed, exact },
      };
    }
    case "note": {
      const content = text(body, "text", MAX_TEXT, true) as string;
      const argv = ["note", ...dir, ...withConfig(ctx)];
      const kind = text(body, "kind", 40, false);
      if (kind !== undefined) {
        if (!/^[a-z][a-z_-]*$/.test(kind)) throw new Invalid("kind is one word");
        argv.push("--kind", kind);
      }
      const title = text(body, "title", 200, false);
      if (title !== undefined) argv.push(`--title=${title}`);
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
      const id = memoryId(body, "id", true) as string;
      const argv = ["remove", ...dir];
      const reason = text(body, "reason", 500, false);
      if (reason !== undefined) argv.push(`--reason=${reason}`);
      // WITHOUT a typed confirmation this is the CLI's dry run: the plan, and
      // "Nothing has changed". WITH one it is `--confirm`, and what the owner
      // typed is handed to the CLI's own prompt — the CLI compares it.
      const typed = body["confirm"];
      if (typed === undefined || typed === null) return { argv: [...argv, "--", id] };
      if (typeof typed !== "string" || typed.length > 80 || typed.includes("\0")) {
        throw new Invalid("confirm is the id, typed back");
      }
      return { argv: [...argv, "--confirm", "--", id], answer: typed };
    }
    case "delete": {
      // ONE KIND OF DATA (2026-10-13): the console's `delete <kind>`. WITHOUT
      // `confirm` it is the console's own dry run — the counts, and "Nothing
      // has changed"; WITH it, `--yes`, after the page asked plainly. The
      // kinds are spelled here, not imported: this file loads nothing of the
      // console until an action runs, and the console refuses any other word.
      const kind = body["kind"];
      if (typeof kind !== "string" || !DELETE_KINDS.includes(kind)) {
        throw new Invalid(`kind is one of ${DELETE_KINDS.join(", ")}`);
      }
      return { argv: ["delete", ...dir, ...(flag(body, "confirm") ? ["--yes"] : []), "--", kind] };
    }
    case "about": {
      // WHAT A MEMORY IS ABOUT (2026-10-11): the console's `about`, as the
      // owner — one store function behind both doors (`Counterpart.markAbout`).
      const id = memoryId(body, "id", true) as string;
      const mark = body["about"];
      if (typeof mark !== "string" || !ABOUT_CHOICES.includes(mark)) {
        throw new Invalid(`about is one of ${ABOUT_CHOICES.join(", ")}`);
      }
      const argv = ["about", ...dir];
      const why = text(body, "why", 500, false);
      if (why !== undefined) argv.push(`--why=${why}`);
      return { argv: [...argv, "--", id, mark] };
    }
    case "backup":
      return { argv: ["backup", ...dir, "--out", absPath(body, "out")] };
    case "export": {
      const argv = ["export", ...dir, "--out", absPath(body, "out")];
      const passphrase = text(body, "passphrase", 1024, false);
      if (passphrase !== undefined) argv.push(`--passphrase=${passphrase}`);
      const booleans: [string, string][] = [
        ["plaintext", "--plaintext"],
        ["markdown", "--markdown"],
        ["includeConfidential", "--include-confidential"],
        ["withVersions", "--with-versions"],
        ["intoNonEmpty", "--into-non-empty"],
        ["overwrite", "--overwrite"],
      ];
      for (const [key, f] of booleans) if (flag(body, key)) argv.push(f);
      return { argv };
    }
    case "scope": {
      // The registry sits beside a CONFIGURATION, and a dashboard opened on a
      // bare `--dir` has none to name. The console would fall back to the
      // default one — on this machine, possibly the owner's live install — so
      // this door asks for the configuration to be named instead of guessing.
      if (ctx.config === undefined) {
        throw new Invalid(
          "scope writes the registry beside a configuration, and this dashboard was opened on a store " +
            "without one. Open it with `counterparts dashboard` (or serve --config <path>).",
        );
      }
      const argv = ["scope", ...withConfig(ctx)];
      if (flag(body, "list")) return { argv: [...argv, "--list"] };
      const path = absPath(body, "path");
      const mode = body["mode"];
      const MODES: Record<string, string> = {
        on: "--on",
        observer: "--observer",
        off: "--off",
        pause: "--pause",
        resume: "--resume",
      };
      if (mode !== undefined && mode !== null && mode !== "") {
        if (typeof mode !== "string" || !(mode in MODES)) {
          throw new Invalid("mode is one of on, observer, off, pause, resume");
        }
        argv.push(MODES[mode] as string);
        const note = text(body, "note", 500, false);
        if (note !== undefined) argv.push(`--note=${note}`);
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
      const booleans: [string, string][] = [
        ["rebuild", "--rebuild"],
        ["dropVectors", "--drop-vectors"],
        ["keepVectors", "--keep-vectors"],
        ["pruneIndex", "--prune-index"],
        ["retrySkipped", "--retry-skipped"],
      ];
      for (const [key, f] of booleans) if (flag(body, key)) argv.push(f);
      return { argv };
    }
    case "doctor":
      // No fields: the reading is the dashboard's own store, and its own
      // configuration when it was opened through one.
      return { argv: ["doctor", ...dir, ...withConfig(ctx), "--json"] };
  }
}

/** The command line, as a person would read it — the passphrase withheld. */
export function displayCommand(argv: readonly string[]): string {
  const shown = argv.map((a) => (a.startsWith("--passphrase=") ? "--passphrase=…" : a));
  return ["counterparts", ...shown.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a)))].join(" ");
}

// ── running ─────────────────────────────────────────────────────────────────

export interface ActionResult {
  readonly status: number;
  readonly body: {
    readonly action?: string;
    readonly command?: string;
    readonly exit?: number;
    readonly ok?: boolean;
    readonly out?: string[];
    readonly err?: string[];
    readonly truncated?: boolean;
    readonly error?: string;
    /** `ask` by question: what it searched with. */
    readonly searched?: Searched;
  };
}

/** The console's `run`, as this file needs to see it. */
export type Run = (
  argv: readonly string[],
  opts: {
    io: { out(line: string): void; err(line: string): void; prompt?: (q: string) => Promise<string> };
    env?: Record<string, string | undefined>;
    home?: string;
    scope?: string;
  },
) => Promise<number>;

let runner: Run | null = null;
async function cliRun(): Promise<Run> {
  if (runner === null) {
    const mod = (await import("../../cli/index.js")) as unknown as { run: Run };
    runner = mod.run;
  }
  return runner;
}

/**
 * ONE AT A TIME. Two writable opens racing each other is a thing the console
 * never does from one terminal, and a double click on "remove" must not become
 * two removals. The slot is held until the command has REALLY finished, even
 * after a timeout has stopped waiting for it.
 */
let running: Promise<unknown> | null = null;

export function actionInFlight(): boolean {
  return running !== null;
}

/**
 * Validate, build, run through the console's `run()`, and report what it said.
 *
 * A refusal by THE CONSOLE (exit 1–3) is an answer, not a failure of this door:
 * it comes back 200 with the exit code and the console's own sentences.
 */
export async function runAction(
  name: string,
  body: unknown,
  ctx: ActionContext,
  opts: {
    timeoutMs?: number;
    /** The console's `run`, replaced — tests only, to prove the timeout and the queue. */
    run?: Run;
  } = {},
): Promise<ActionResult> {
  if (!isActionName(name)) {
    return { status: 404, body: { error: `no such action: ${name}. The dashboard offers ${ACTIONS.join(", ")}.` } };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: 400, body: { error: "an action's body is a JSON object" } };
  }
  let built: Built;
  try {
    built = buildArgv(name, body as Body, ctx);
  } catch (err) {
    if (err instanceof Invalid) return { status: 400, body: { action: name, error: err.message } };
    throw err;
  }
  if (running !== null) {
    return {
      status: 409,
      body: { action: name, error: "another action is still running; nothing was done. Try again when it finishes." },
    };
  }

  const out: string[] = [];
  const err: string[] = [];
  let bytes = 0;
  let truncated = false;
  const keep = (into: string[]) => (line: string): void => {
    if (truncated) return;
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
    // THE CLI'S OWN PROMPT, answered with what the owner typed — once. A
    // second question is not one the owner saw, so it is refused, not answered.
    ...(built.answer === undefined
      ? {}
      : {
          prompt: async (): Promise<string> => {
            if (asked) throw new Error("the dashboard answers one confirmation per action");
            asked = true;
            return built.answer as string;
          },
        }),
  };

  // THE SLOT IS CLAIMED BEFORE ANY AWAIT. Everything above is synchronous, so
  // two requests in the same tick cannot both pass the check above and both
  // run: the second sees `running` set here. (The first version claimed it
  // after `await cliRun()`, and two notes sent together were both written.)
  const work = (async (): Promise<number> => {
    const run = opts.run ?? (await cliRun());
    const env =
      built.env === undefined ? ctx.env : { ...(ctx.env ?? (process.env as Record<string, string | undefined>)), ...built.env };
    return run(built.argv, {
      io,
      ...(env === undefined ? {} : { env }),
      ...(built.home !== undefined ? { home: built.home } : ctx.home === undefined ? {} : { home: ctx.home }),
      // A note from the browser is filed under the store itself, not under
      // whatever directory this server was launched from (see `RunOptions.scope`).
      scope: ctx.dir,
    });
  })();
  const slot = work.then(
    () => undefined,
    () => undefined,
  );
  running = slot;
  void slot.then(() => {
    if (running === slot) running = null;
  });

  const command = displayCommand(built.argv);
  const limit = opts.timeoutMs ?? TIMEOUT_MS[name];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((done) => {
    timer = setTimeout(() => done("timeout"), limit);
  });
  let exit: number | "timeout";
  try {
    exit = await Promise.race([work, timedOut]);
  } catch (e) {
    return {
      status: 500,
      body: { action: name, command, out, err, error: e instanceof Error ? e.message : String(e) },
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (exit === "timeout") {
    return {
      status: 504,
      body: {
        action: name,
        command,
        out: [...out],
        err: [...err],
        error:
          `still running after ${String(Math.round(limit / 1000))}s. It cannot be stopped from here, ` +
          "so it is finishing in the background; no other action runs until it has.",
      },
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
      ...(built.searched === undefined ? {} : { searched: built.searched }),
    },
  };
}
