import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { ownerNames } from "../../../core/sleep/index.js";
import { onboardingView } from "../../../core/onboarding.js";
import { dataDir, isStoreError } from "../../../core/store/index.js";
import { zoneBeside, zoneOfConfig } from "../../config.js";
import { Dashboard } from "../index.js";
import { upgradePending, upgradePendingSentence } from "../upgrade.js";
import {
  MAX_BODY_BYTES,
  TOKEN_HEADER,
  TOKEN_META,
  checkActionRequest,
  newActionToken,
  runAction
} from "./actions.js";
import { firedPanel } from "./fired.js";
import { mechanismPanel } from "./views/mechanism-panel.js";
import { mechanismsView } from "./views/mechanisms.js";
import { DREAM_LIMIT, dreamsView } from "./views/dreams.js";
import { resolveStatic } from "./static.js";
import { packagePath } from "../../runtime.js";
import { installedVersion } from "../../sessions.js";
import { storeId } from "../../store-id.js";
import {
  activityView,
  eventDetail,
  flowView,
  healthView,
  memoriesView,
  memoryListView,
  memoryDetail,
  metaView,
  mindView,
  nodeDetail,
  overviewView,
  pulse,
  searchView
} from "./views.js";
export const DEFAULT_PORT = 4747;
export const PORT_ENV = "COUNTERPARTS_DASHBOARD_PORT";
const HERE = packagePath("src/adapters/dashboard/web");
const APP_PATH = join(HERE, "app.html");
const NO_STORE = { "cache-control": "no-store" };
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` + `<rect width="64" height="64" rx="13" fill="#0a0e14"/>` + `<path d="M14 46 L32 32 L50 18" stroke="#00e5ff" stroke-opacity=".35" stroke-width="2.5" fill="none" stroke-linecap="round"/>` + `<circle cx="14" cy="46" r="4.5" fill="#00bfa5"/>` + `<circle cx="32" cy="32" r="7" fill="#00e5ff"/>` + `<circle cx="50" cy="18" r="4.5" fill="#b388ff"/></svg>`;
const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export function isAllowedHost(host) {
  if (typeof host !== "string" || host.length === 0)
    return false;
  const match = /^(\[[^\]]+\]|[^:]+)(:\d+)?$/.exec(host.trim());
  if (match === null)
    return false;
  const hostname = (match[1] ?? "").toLowerCase();
  return ALLOWED_HOSTNAMES.has(hostname);
}
function json(body, status = 200) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE },
    body: JSON.stringify(body)
  };
}
const NO_FRAMES = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'"
};
function html(body) {
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE, ...NO_FRAMES },
    body
  };
}
function page(file, token) {
  try {
    const text = readFileSync(file, "utf8");
    if (token === undefined || !/^[0-9a-f]+$/.test(token))
      return html(text);
    return html(text.replace(`<meta name="${TOKEN_META}" content="">`, `<meta name="${TOKEN_META}" content="${token}">`));
  } catch {
    return json({ error: `the dashboard page is missing from the install (${file}). Reinstall, or run from a checkout.` }, 500);
  }
}
function staticFile(path) {
  const found = resolveStatic(path, HERE);
  if (found === null)
    return null;
  const headers = { "content-type": found.contentType, ...NO_STORE };
  try {
    if (found.text)
      return { status: 200, headers, body: readFileSync(found.file, "utf8") };
    return { status: 200, headers, body: "", bytes: readFileSync(found.file) };
  } catch {
    return json({ error: `not found: ${path}` }, 404);
  }
}
function intParam(url, name, fallback) {
  const raw = url.searchParams.get(name);
  if (raw === null)
    return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function forbiddenHost() {
  return json({ error: "forbidden: this dashboard answers only to localhost, 127.0.0.1 or [::1]" }, 403);
}
export function router(url, host, src, opts = {}) {
  if (!isAllowedHost(host))
    return forbiddenHost();
  const path = url.pathname;
  try {
    if (path === ACTION_PREFIX.slice(0, -1) || path.startsWith(ACTION_PREFIX)) {
      return json({ error: "an action is a POST from the dashboard's own page; nothing was done" }, 405);
    }
    if (path === "/" || path === "/index.html")
      return page(APP_PATH, opts.token);
    if (path === "/brain")
      return { status: 302, headers: { location: "/#home", ...NO_STORE }, body: "" };
    if (path === "/favicon.svg" || path === "/favicon.ico") {
      return {
        status: 200,
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
        body: FAVICON_SVG
      };
    }
    if (path === "/api/meta")
      return json(metaView(src));
    if (path === "/api/onboarding")
      return json({ ...onboardingView(src.store), store: storeId(src.store.dir) });
    if (path === "/api/whoami")
      return json({ store: storeId(src.store.dir), version: installedVersion() });
    if (path === "/api/pulse")
      return json(pulse(src));
    if (path === "/api/overview")
      return json(overviewView(src, intParam(url, "limit", 40)));
    if (path === "/api/memories")
      return json(memoriesView(src, { limit: intParam(url, "limit", 4000) }));
    if (path === "/api/memories/list") {
      const q = url.searchParams;
      return json(memoryListView(src, {
        state: q.get("state"),
        kind: q.get("kind"),
        band: q.get("band"),
        core: q.get("core") === "1",
        journal: q.get("journal") === "1",
        hold: q.get("hold"),
        feeling: q.get("feeling"),
        whose: q.get("whose"),
        feelingCore: q.get("feelingCore"),
        sort: q.get("sort"),
        offset: intParam(url, "offset", 0),
        limit: intParam(url, "limit", 50)
      }));
    }
    if (path === "/api/memory") {
      const id = url.searchParams.get("id") ?? "";
      if (id.length === 0)
        return json({ error: "id is required" }, 400);
      return json(memoryDetail(src, id));
    }
    if (path === "/api/search") {
      return json(searchView(src, url.searchParams.get("q") ?? "", intParam(url, "limit", 25)));
    }
    if (path === "/api/mind")
      return json(mindView(src));
    if (path === "/api/dreams")
      return json(dreamsView(src, intParam(url, "limit", DREAM_LIMIT)));
    if (path === "/api/flow")
      return json(flowView(src, intParam(url, "limit", 24)));
    if (path === "/api/node") {
      const key = url.searchParams.get("key") ?? "";
      const detail = nodeDetail(src, key, intParam(url, "limit", 8));
      return detail.found ? json(detail) : json({ error: `no such node: ${key}` }, 404);
    }
    if (path === "/api/health")
      return json(healthView(src));
    if (path === "/api/fired")
      return json(firedPanel(src, src.store.today()));
    if (path === "/api/mechanisms")
      return json(mechanismsView(src));
    if (path === "/api/mechanism") {
      const panel = mechanismPanel(src, url.searchParams.get("id") ?? "");
      return panel.found ? json(panel) : json({ error: `no such mechanism: ${panel.id}` }, 404);
    }
    if (path === "/api/activity") {
      const sinceRaw = url.searchParams.get("sinceSeq");
      const opts = {
        limit: intParam(url, "limit", 40)
      };
      const name = url.searchParams.get("name");
      if (name !== null && name.length > 0)
        opts.name = name;
      if (sinceRaw !== null)
        opts.sinceSeq = intParam(url, "sinceSeq", 0);
      return json(activityView(src, opts));
    }
    if (path === "/api/event") {
      const seq = intParam(url, "seq", -1);
      if (seq < 0)
        return json({ error: "seq is required" }, 400);
      const detail = eventDetail(src, seq);
      return detail.found ? json(detail) : json({ error: "no event with that seq in the kept window" }, 404);
    }
    const asset = staticFile(path);
    if (asset !== null)
      return asset;
    return json({ error: `not found: ${path}` }, 404);
  } catch (err) {
    if (isStoreError(err))
      return json({ error: `${err.code}: ${JSON.stringify(err.detail)}` }, 500);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
const upgradePendingPage = (sentence) => `<!doctype html>
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
function upgradePendingReply(path, sentence) {
  if (path.startsWith("/api/")) {
    return json({ error: "upgrade-pending", message: sentence }, 503);
  }
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE }, body: upgradePendingPage(sentence) };
}
export const ACTION_PREFIX = "/api/action/";
function resolvePort(opts) {
  if (opts.port !== undefined)
    return opts.port;
  const fromEnv = Number.parseInt(process.env[PORT_ENV] ?? "", 10);
  return Number.isInteger(fromEnv) && fromEnv >= 0 && fromEnv < 65536 ? fromEnv : DEFAULT_PORT;
}
export function startDashboard(opts = {}) {
  const timeZone = (opts.config === undefined ? undefined : zoneOfConfig(opts.config)) ?? (opts.dir === undefined ? undefined : zoneBeside(opts.dir));
  const openOpts = {
    ...opts.dir === undefined ? {} : { dir: opts.dir },
    ...timeZone === undefined ? {} : { timeZone }
  };
  let dashboard;
  try {
    dashboard = Dashboard.open(openOpts);
  } catch (err) {
    if (!upgradePending(err))
      throw err;
    dashboard = null;
  }
  const pendingAtStart = dashboard === null;
  const current = () => {
    if (dashboard !== null)
      return dashboard;
    try {
      dashboard = Dashboard.open(openOpts);
    } catch (err) {
      if (!upgradePending(err))
        throw err;
    }
    return dashboard;
  };
  const dir = dashboard === null ? opts.dir ?? dataDir() : dashboard.store.dir;
  const token = newActionToken();
  const actionContext = {
    dir,
    ...opts.config === undefined ? {} : { config: opts.config }
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
      const ctx = name === "ask" ? { ...actionContext, ownerName: ownerNameOf(dashboard.source) } : actionContext;
      handleAction(req, res, name, token, boundPort, ctx);
      return;
    }
    let reply;
    if (method !== "GET" && method !== "HEAD") {
      reply = json({ error: `${method} is not something this dashboard answers; nothing was done` }, 405);
      res.writeHead(reply.status, { ...reply.headers, allow: "GET, HEAD" });
      res.end(reply.body);
      return;
    }
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const open = current();
      reply = open === null ? isAllowedHost(req.headers.host ?? null) ? upgradePendingReply(url.pathname, upgradePendingSentence(dir)) : forbiddenHost() : router(url, req.headers.host ?? null, open.source, { token });
    } catch (err) {
      reply = {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE },
        body: JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      };
    }
    res.writeHead(reply.status, reply.headers);
    res.end(reply.bytes ?? reply.body);
  });
  return new Promise((ok, fail) => {
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
        stop: () => new Promise((done) => {
          server.close(() => {
            dashboard?.close();
            done();
          });
          server.closeAllConnections?.();
        })
      });
    });
  });
}
function ownerNameOf(source) {
  try {
    return ownerNames(source.store)[0] ?? null;
  } catch {
    return null;
  }
}
function header(req, name) {
  const v = req.headers[name];
  if (Array.isArray(v))
    return v.length === 1 ? v[0] ?? null : null;
  return typeof v === "string" ? v : null;
}
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...NO_STORE });
  res.end(JSON.stringify(body));
}
async function handleAction(req, res, name, token, boundPort, ctx) {
  const refused = checkActionRequest({
    method: req.method ?? "",
    host: header(req, "host"),
    origin: header(req, "origin"),
    contentType: header(req, "content-type"),
    token: header(req, TOKEN_HEADER),
    fetchSite: header(req, "sec-fetch-site")
  }, token, boundPort);
  if (refused !== null) {
    req.resume();
    send(res, refused.status, { error: refused.error });
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    const tooBig = err instanceof Error && err.message === "too-large";
    send(res, tooBig ? 413 : 400, {
      error: tooBig ? `an action's body is at most ${String(MAX_BODY_BYTES)} bytes; nothing was done` : "an action's body is JSON; nothing was done"
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
function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done)
        return;
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
      if (done)
        return;
      done = true;
      ok(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (done)
        return;
      done = true;
      fail(err);
    });
  });
}
