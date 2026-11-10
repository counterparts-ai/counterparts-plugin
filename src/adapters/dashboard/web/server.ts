/**
 * The local web dashboard's server — `node:http`, one page (and the static
 * modules it is built from), JSON under `/api`.
 *
 * CONTRACT OQ1 asked terminal or local web and the build answered "terminal, for
 * now" with a named revision condition: *the moment the owner wants to click.*
 * That moment arrived (owner ruling 2026-09-04, `NOTES.md`), and nothing in the
 * answer's reasoning is discarded here — the guarantees the terminal shape made
 * cheap to prove are the ones this file is built to keep provable:
 *
 *   - **`router()` is a pure function of an opened observer source.** It takes
 *     the source, returns a plain `{status, headers, body}`, and binds no
 *     socket. Every endpoint is therefore testable exactly the way a view
 *     function was — including "the data dir is byte-identical after every
 *     endpoint", which is the observer guarantee restated for a web adapter.
 *   - **One source, opened once, in observer mode by construction.**
 *     `Dashboard.open` sets `observer: true` itself and `sourceOf` refuses a
 *     Counterpart that is not one, so a request cannot reach a writable brain
 *     even by mistake. SQLite readers see committed writes, so a long-lived
 *     handle is fresh without reopening the store on every request.
 *   - **`node:http`, not `Bun.serve`.** The core targets Node and Bun both; a
 *     dashboard that only starts under one runtime would foreclose the other for
 *     no gain (owner ruling, same date).
 *
 * ## The two refusals
 *
 * **127.0.0.1 only.** The model of you stays on your machine. (This server. The
 * same page and views, read-only, are also served by the hosted server to a
 * person signed in there, over their hosted store: `respond.ts` is the shared
 * half, `hosted/src/dashboard.ts` that door.)
 *
 * **A Host-header allowlist**, checked before any view is computed. Binding to
 * loopback stops remote connections; it does NOT stop a page in the owner's own
 * browser rebinding its origin to 127.0.0.1 and issuing same-origin fetches with
 * an attacker Host header (v1's audit finding #30, inherited as a scar rather
 * than as code). Only `localhost`, `127.0.0.1` and `[::1]`, with an optional
 * port, are accepted.
 *
 * ## The filesystem exception, named
 *
 * This is the ONE file in `adapters/dashboard/` that imports `node:fs`, and it
 * imports exactly `readFileSync`, to serve the static files that ship beside
 * it: the HTML page, and the page's own `.js`/`.css` modules under `web/`
 * — only the paths `static.ts` resolves (a fixed set of folders, an allow-listed
 * set of extensions, no traversal). The directory-wide ban exists to mechanize
 * "no memory body text is persisted into dashboard state" — there is no state
 * file because nothing here can open one — and a read-only import preserves
 * that exactly.
 * `test/dashboard.test.ts` encodes the exception per-file and asserts the
 * binding, so it cannot quietly widen into a write.
 *
 * ## Looking, and managing (2026-09-25)
 *
 * `router()` is LOOKING: GET only, over the observer source, and it stays a
 * pure function of that source. MANAGING — a note, a removal, a backup, … —
 * is a POST to `/api/action/<name>`, handled by `actions.ts` through the
 * console's own `run()`. That path is never handed the observer source, only
 * the store's directory and the configuration's path, and it answers only a
 * request that passes `checkActionRequest` (same origin, the per-launch token
 * the page carries, JSON). A GET to an action path is refused here, so no
 * link, image or prefetch can act.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { ownerNames } from "../../../core/sleep/index.js";
import { onboardingView } from "../../../core/onboarding.js";
import { dataDir, isStoreError } from "../../../core/store/index.js";
import { zoneBeside, zoneOfConfig } from "../../config.js";
import { Dashboard } from "../index.js";
import { upgradePending, upgradePendingSentence } from "../upgrade.js";
import type { DashboardSource } from "../source.js";
import {
  ACTION_HEADER_NAME,
  ACTION_META_NAME,
  MAX_BODY_BYTES,
  checkActionRequest,
  newActionToken,
  runAction,
} from "./actions.js";
import type { ActionContext } from "./actions.js";
import { BRAIN_LIBRARY, LOCAL_HOST, json, staticReply, viewReply, withBrainSwitch as brainSwitch } from "./respond.js";
import type { Files, Reply } from "./respond.js";
import { installedVersion } from "../../sessions.js";
import { storeId } from "../../store-id.js";

export { BRAIN_LIBRARY } from "./respond.js";
export type { Reply } from "./respond.js";

/** bansai's 3737 is in use for the length of the parallel run. */
export const DEFAULT_PORT = 4747;
export const PORT_ENV = "COUNTERPARTS_DASHBOARD_PORT";

/**
 * The home tab's brain picture is drawn with three.js, the dashboard's one
 * large file, which the plugin directory's bundle leaves out with the
 * picture's module (tools/plugin-bundle/build.ts). Whether it is here is read
 * off the file itself, per page load, and said in the page
 * (`pages/home/sections/brain.js#pictureServed`): off, the home tab draws
 * without the picture rather than ask for a module that is not there.
 */
export function withBrainSwitch(page: string, served: boolean = existsSync(BRAIN_LIBRARY)): string {
  return brainSwitch(page, served);
}

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * The directory's ONE filesystem read, handed to the shared half
 * (`respond.ts`), which serves the page, the favicon (`favicon.svg`: a missing
 * favicon is a console error, and this dashboard's bar is zero of them) and the
 * static modules with it. Read per request and never cached: a checkout edited
 * under a running server shows the edit on reload.
 */
const FILES: Files = {
  text: (file) => readFileSync(file, "utf8"),
  bytes: (file) => readFileSync(file),
};

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isAllowedHost(host: string | null | undefined): boolean {
  if (typeof host !== "string" || host.length === 0) return false;
  const match = /^(\[[^\]]+\]|[^:]+)(:\d+)?$/.exec(host.trim());
  if (match === null) return false;
  const hostname = (match[1] ?? "").toLowerCase();
  return ALLOWED_HOSTNAMES.has(hostname);
}

/**
 * No page of this dashboard may be framed. The page can now ACT (a removal is
 * two clicks and a typed id), and a page another site frames invisibly is how
 * clicks get stolen — so every HTML reply says "never inside a frame", in the
 * old header and the current one.
 */
const NO_FRAMES = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
} as const;

/**
 * The page with this launch's token. `token`, when given, fills the page's
 * `<meta name="counterparts-action-token">` — the per-launch secret every
 * action must echo. It is hex, so it needs no escaping, and it is only ever
 * sent to a request that passed the Host check. Any other reply passes through.
 */
function localPage(reply: Reply, token: string | undefined): Reply {
  if (reply.status !== 200 || reply.headers["content-type"]?.startsWith("text/html") !== true) return reply;
  const body =
    token === undefined || !/^[0-9a-f]+$/.test(token)
      ? reply.body
      : reply.body.replace(`<meta name="${ACTION_META_NAME}" content="">`, `<meta name="${ACTION_META_NAME}" content="${token}">`);
  return { ...reply, headers: { ...reply.headers, ...NO_FRAMES }, body };
}

function forbiddenHost(): Reply {
  return json({ error: "forbidden: this dashboard answers only to localhost, 127.0.0.1 or [::1]" }, 403);
}

/**
 * Resolve one request against an already-open observer source.
 *
 * Read-only by construction and by scan. The views and the static files are
 * the shared half (`respond.ts`, which the hosted server serves too); what is
 * only this door's is here: the Host check, the GET refusal of an action path,
 * the old `/brain` address, the sidebar mod's two reads, and the page's token.
 * Every throw becomes a 500 JSON body: an instrument that crashes its own loop
 * on a broken store is the one moment the owner most needs it to render (scar E7).
 */
export function router(
  url: URL,
  host: string | null,
  src: DashboardSource,
  opts: { readonly token?: string } = {},
): Reply {
  if (!isAllowedHost(host)) return forbiddenHost();
  const path = url.pathname;
  try {
    // LOOKING NEVER ACTS: an action path reached by GET is refused, whatever
    // follows it, before any view is computed.
    if (path === ACTION_PREFIX.slice(0, -1) || path.startsWith(ACTION_PREFIX)) {
      return json({ error: "an action is a POST from the dashboard's own page; nothing was done" }, 405);
    }
    // The brain lives on the home page now; an old bookmark lands there.
    if (path === "/brain") return { status: 302, headers: { location: "/#home", ...NO_STORE }, body: "" };
    // THE FIRST MEETING'S STATE, for the sidebar mod (2026-10-11): `{ meet,
    // where, style }`, option keys only, never an answer's words.
    // `store` (2026-10-12): which store this dashboard serves, as `/api/whoami` says it.
    if (path === "/api/onboarding") return json({ ...onboardingView(src.store), store: storeId(src.store.dir) });
    // WHICH STORE THIS IS (2026-10-12, `adapters/store-id.ts`): two stores on
    // one machine can race for one port, so the mod checks this against the
    // wake's `counterparts:store` marker before it trusts what it reads here.
    // An id, never the path; `version` is null when the manifest is unreadable.
    if (path === "/api/whoami") return json({ store: storeId(src.store.dir), version: installedVersion() });
    const viewed = viewReply(url, src, LOCAL_HOST);
    if (viewed !== null) return viewed;
    const asset = staticReply(path, LOCAL_HOST, FILES, existsSync(BRAIN_LIBRARY));
    if (asset !== null) return localPage(asset, opts.token);
    return json({ error: `not found: ${path}` }, 404);
  } catch (err) {
    // A store refusal reaches the page as its code and its detail — ids and
    // counts, never prose (as `respond.ts#viewReply` says it).
    if (isStoreError(err)) return json({ error: `${err.code}: ${JSON.stringify(err.detail)}` }, 500);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** The whole page while the store waits for its upgrade: calm, self-contained, no script. */
const upgradePendingPage = (sentence: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>counterparts</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#04070c;color:#c5cdd8;
  font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
main{max-width:34rem}
h1{font-size:13px;letter-spacing:.35em;text-transform:uppercase;color:#00e5ff;font-weight:600;margin:0 0 18px}
p{margin:0}
</style></head>
<body><main><h1>Counterparts</h1><p>${sentence}</p></main></body></html>
`;

function upgradePendingReply(path: string, sentence: string): Reply {
  if (path.startsWith("/api/")) {
    return json({ error: "upgrade-pending", message: sentence }, 503);
  }
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE }, body: upgradePendingPage(sentence) };
}

/** Every management action is a POST under here: `/api/action/<name>`. */
export const ACTION_PREFIX = "/api/action/";

export interface ServeOptions {
  /** The data dir. Always passed explicitly by every caller in this repo. */
  readonly dir?: string;
  /**
   * The host configuration this dashboard was opened through, when it was —
   * handed to the actions that read one (`scope`, `rebrief`, and the embedder
   * knob of `note`/`ask`), exactly as `--config` would be.
   */
  readonly config?: string;
  /** 0 asks the OS for a free port — what the visual loop uses. */
  readonly port?: number;
}

export interface RunningDashboard {
  readonly port: number;
  readonly url: string;
  readonly dir: string;
  /** This launch's action token (the page carries it; tests read it here). */
  readonly token: string;
  readonly server: Server;
  /** True while the store waits for its one-time upgrade (`upgradePending`):
   *  every page says so until a session has upgraded it and the store opens. */
  readonly upgradePending: boolean;
  stop(): Promise<void>;
}

function resolvePort(opts: ServeOptions): number {
  if (opts.port !== undefined) return opts.port;
  const fromEnv = Number.parseInt(process.env[PORT_ENV] ?? "", 10);
  return Number.isInteger(fromEnv) && fromEnv >= 0 && fromEnv < 65536 ? fromEnv : DEFAULT_PORT;
}

/**
 * Open the store in observer mode, bind loopback, serve. The returned handle
 * carries the BOUND port — which is not the requested one when the caller asked
 * for 0 — and closing it closes the store.
 */
export function startDashboard(opts: ServeOptions = {}): Promise<RunningDashboard> {
  // THE ZONE THE HOOKS USE (review of #335, 2026-10-09): the named
  // configuration's `timeZone`, else the one beside the store, else the
  // machine's. Every date the server sends is read in it, already local.
  const timeZone =
    (opts.config === undefined ? undefined : zoneOfConfig(opts.config)) ??
    (opts.dir === undefined ? undefined : zoneBeside(opts.dir));
  const openOpts = {
    ...(opts.dir === undefined ? {} : { dir: opts.dir }),
    ...(timeZone === undefined ? {} : { timeZone }),
  };
  // A store waiting for its upgrade is not an error to the owner: the server
  // still starts, says so on every page, and tries the store again on each
  // request, so a reload after a session has upgraded it shows the dashboard.
  let dashboard: Dashboard | null;
  try {
    dashboard = Dashboard.open(openOpts);
  } catch (err) {
    if (!upgradePending(err)) throw err;
    dashboard = null;
  }
  const pendingAtStart = dashboard === null;
  const current = (): Dashboard | null => {
    if (dashboard !== null) return dashboard;
    try {
      dashboard = Dashboard.open(openOpts);
    } catch (err) {
      if (!upgradePending(err)) throw err;
    }
    return dashboard;
  };
  const dir = dashboard === null ? (opts.dir ?? dataDir()) : dashboard.store.dir;
  const token = newActionToken();
  // What an action is told about where to run: two strings, the store's
  // directory and the configuration's path. NOT the source above.
  const actionContext: ActionContext = {
    dir,
    ...(opts.config === undefined ? {} : { config: opts.config }),
  };
  let boundPort = 0;

  const server = createServer((req, res) => {
    const method = req.method ?? "GET";
    const rawPath = (req.url ?? "/").split("?")[0] ?? "/";
    if (method === "POST" && rawPath.startsWith(ACTION_PREFIX)) {
      if (dashboard === null) {
        req.resume();
        send(res, 503, { error: "upgrade-pending", message: upgradePendingSentence(dir) });
        return;
      }
      const name = rawPath.slice(ACTION_PREFIX.length);
      // `ask` turns the owner's question into my voice, with his name read off
      // the identity core — a string handed across, never the source itself.
      const ctx = name === "ask" ? { ...actionContext, ownerName: ownerNameOf(dashboard.source) } : actionContext;
      void handleAction(req, res, name, token, boundPort, ctx);
      return;
    }
    let reply: Reply;
    if (method !== "GET" && method !== "HEAD") {
      reply = json({ error: `${method} is not something this dashboard answers; nothing was done` }, 405);
      res.writeHead(reply.status, { ...reply.headers, allow: "GET, HEAD" });
      res.end(reply.body);
      return;
    }
    try {
      // A fixed base: only the path and the query are read here; the Host header is checked on its own (`isAllowedHost`).
      const url = new URL(req.url ?? "/", "http://localhost");
      const open = current();
      reply =
        open === null
          ? isAllowedHost(req.headers.host ?? null)
            ? upgradePendingReply(url.pathname, upgradePendingSentence(dir))
            : forbiddenHost()
          : router(url, req.headers.host ?? null, open.source, { token });
    } catch (err) {
      reply = {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE },
        body: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      };
    }
    res.writeHead(reply.status, reply.headers);
    res.end(reply.bytes ?? reply.body);
  });

  return new Promise<RunningDashboard>((ok, fail) => {
    server.once("error", fail);
    server.listen(resolvePort(opts), "127.0.0.1", () => {
      server.removeListener("error", fail);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : resolvePort(opts);
      boundPort = port;
      ok({
        port,
        url: `http://127.0.0.1:${port}`,
        dir,
        token,
        server,
        upgradePending: pendingAtStart,
        stop: () =>
          new Promise<void>((done) => {
            server.close(() => {
              dashboard?.close();
              done();
            });
            // Node keeps a server open while a keep-alive socket lives; the
            // dashboard is a local tool and a hung `stop()` in a test harness is
            // worse than a dropped connection.
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

/** The owner's name as the store knows it (sleep's `ownerNames`, first entry), or null. */
function ownerNameOf(source: DashboardSource): string | null {
  try {
    return ownerNames(source.store)[0] ?? null;
  } catch {
    return null;
  }
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v.length === 1 ? (v[0] ?? null) : null;
  return typeof v === "string" ? v : null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...NO_STORE });
  res.end(JSON.stringify(body));
}

/**
 * One POST to `/api/action/<name>`: the guard, then the body (capped), then
 * `actions.ts`. The guard runs BEFORE a byte of the body is read.
 */
async function handleAction(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  token: string,
  boundPort: number,
  ctx: ActionContext,
): Promise<void> {
  const refused = checkActionRequest(
    {
      method: req.method ?? "",
      host: header(req, "host"),
      origin: header(req, "origin"),
      contentType: header(req, "content-type"),
      token: header(req, ACTION_HEADER_NAME),
      fetchSite: header(req, "sec-fetch-site"),
    },
    token,
    boundPort,
  );
  if (refused !== null) {
    req.resume();
    send(res, refused.status, { error: refused.error });
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    const tooBig = err instanceof Error && err.message === "too-large";
    send(res, tooBig ? 413 : 400, {
      error: tooBig
        ? `an action's body is at most ${String(MAX_BODY_BYTES)} bytes; nothing was done`
        : "an action's body is JSON; nothing was done",
    });
    return;
  }
  try {
    const result = await runAction(name, body, ctx);
    send(res, result.status, result.body);
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        req.resume();
        fail(new Error("too-large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      ok(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (done) return;
      done = true;
      fail(err);
    });
  });
}
