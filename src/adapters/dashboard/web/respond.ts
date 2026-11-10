/**
 * THE DASHBOARD'S HOST-AGNOSTIC HALF (HD2, 2026-11-10): a request's path and
 * query in, a plain reply out, for the local server (`server.ts`) and for the
 * hosted server (`hosted/src/dashboard.ts`) alike. One codebase: both serve the
 * same page, the same static files under `web/` and the same `/api` views, so
 * improving one improves the other.
 *
 * What a host decides is ONE value, a `DashboardHost`: where the page is
 * mounted, which tabs and `/api` views it serves, whether the page can act,
 * whether it shows the panels that are about the local machine, how often the
 * page polls. The page reads the host's name from a `<meta>` this file fills
 * (`shared/host.js`), so a panel is hidden by a capability, never by a second
 * copy of the page.
 *
 * What is NOT here, on purpose:
 *
 *   - **No actions.** This file never imports `actions.ts`; managing stays a
 *     local server's POST (`server.ts#handleAction`). The hosted server imports
 *     this file and never that one.
 *   - **No filesystem.** The caller hands in how to read a file (`Files`), so the
 *     directory's one `node:fs` import stays `server.ts`'s (test/dashboard.test.ts).
 *   - **No Host-header check, no session.** Those are each host's own door:
 *     loopback's allowlist locally, the signed-in session on hosted.
 *   - **No store opening.** Every view is a pure function of an observer source
 *     the caller opened (`source.ts`).
 */
import { join } from "node:path";

import { isStoreError } from "../../../core/store/index.js";
import type { DashboardSource } from "../source.js";
import { firedPanel } from "./fired.js";
import { mechanismPanel } from "./views/mechanism-panel.js";
import { mechanismsView } from "./views/mechanisms.js";
import { DREAM_LIMIT, dreamsView } from "./views/dreams.js";
import { resolveStatic } from "./static.js";
import { packagePath } from "../../runtime.js";
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
  searchView,
  subjectView,
  subjectsView,
  tagView,
} from "./views.js";

// From the package root rather than `import.meta.url`, which in the single
// binary is the binary's own path, not this module's (adapters/runtime.ts).
export const WEB_ROOT = packagePath("src/adapters/dashboard/web");
export const APP_PATH = join(WEB_ROOT, "app.html");
export const FAVICON_PATH = join(WEB_ROOT, "favicon.svg");
export const BRAIN_LIBRARY = join(WEB_ROOT, "shared", "vendor", "three.module.min.js");

export interface Reply {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  /** A binary static file (a font), sent instead of `body`. */
  readonly bytes?: Uint8Array;
}

/** How a host reads the files that ship beside this one. Both throw on a missing file. */
export interface Files {
  text(file: string): string;
  bytes(file: string): Uint8Array;
}

/**
 * ONE HOST'S CAPABILITIES. The page learns `name` (a `<meta>`); `shared/host.js`
 * holds the client's half of the same table, keyed by it.
 */
export interface DashboardHost {
  readonly name: "local" | "hosted";
  /** Where the page is mounted, with its trailing slash: `/` locally, `/dashboard/` on hosted. */
  readonly base: string;
  /** The `/api` paths served; `"all"` locally. Any other `/api` path is a 404 before a view is computed. */
  readonly views: "all" | ReadonlySet<string>;
  /** The page can manage (a note, a removal, …) through `actions.ts`. */
  readonly canAct: boolean;
  /** Panels and fields about the local machine are shown (the store's folder path, doctor, …). */
  readonly machine: boolean;
  /** The home tab's 3-D brain. Off on hosted for now: it is the dashboard's one large file. */
  readonly brain: boolean;
  /** A 500 says what failed. Off on hosted: a message there could name a path on the server. */
  readonly errorDetail: boolean;
}

export const LOCAL_HOST: DashboardHost = {
  name: "local",
  base: "/",
  views: "all",
  canAct: true,
  machine: true,
  brain: true,
  errorDetail: true,
};

/**
 * HOSTED, FIRST RELEASE (Mike 2026-11-10, "start with a simpler dashboard"):
 * the home, memories and self tabs, read-only. These are every view those three
 * tabs fetch (`pages/{home,memories,self}`, `shared/memory-modal.js`, the
 * pulse's `activity` + `meta`); nothing else answers. The flow, subjects and
 * health tabs say "not on hosted yet" in the page and their views 404 here.
 */
export const HOSTED_VIEWS: ReadonlySet<string> = new Set([
  "/api/meta",
  "/api/activity",
  "/api/overview",
  "/api/memories",
  "/api/memories/list",
  "/api/memory",
  "/api/search",
  "/api/mind",
]);

export const HOSTED_HOST: DashboardHost = {
  name: "hosted",
  base: "/dashboard/",
  views: HOSTED_VIEWS,
  canAct: false,
  machine: false,
  brain: false,
  errorDetail: false,
};

const NO_STORE = { "cache-control": "no-store" } as const;

export function json(body: unknown, status = 200): Reply {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE },
    body: JSON.stringify(body),
  };
}

const BRAIN_ON = `<meta name="counterparts-brain" content="on">`;
const BRAIN_OFF = `<meta name="counterparts-brain" content="off">`;
const HOST_META = `<meta name="counterparts-host" content="local">`;

/** The page as served: its brain tag turned off when the library is not here. */
export function withBrainSwitch(page: string, served: boolean): string {
  return served ? page : page.replace(BRAIN_ON, BRAIN_OFF);
}

/**
 * Root-absolute references in the page and its stylesheets (`href="/…"`,
 * `src="/…"`, `url("/…")`) moved under the host's base. Locally the base is `/`
 * and nothing changes. The sources stay root-absolute because the plugin
 * bundle's build follows and joins them that way (README, "Serving").
 */
export function rebase(text: string, base: string): string {
  if (base === "/") return text;
  const b = base.replace(/\/$/, "");
  return text
    .replace(/\b(href|src)="\/(?!\/)/g, `$1="${b}/`)
    .replace(/url\("\/(?!\/)/g, `url("${b}/`);
}

/** The page for one host: the brain switch, the host's name, the base. */
export function pageFor(raw: string, host: DashboardHost, brainServed: boolean): string {
  const named = raw.replace(HOST_META, `<meta name="counterparts-host" content="${host.name}">`);
  return rebase(withBrainSwitch(named, brainServed && host.brain), host.base);
}

/**
 * The page's own files: the HTML at `/` (and `/index.html`), the favicon, and
 * what `static.ts` resolves. `path` is relative to the host's base, starting
 * `/`. Null: not one of these. Needs no store.
 */
export function staticReply(path: string, host: DashboardHost, files: Files, brainServed: boolean): Reply | null {
  if (path === "/" || path === "/index.html") {
    try {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE },
        body: pageFor(files.text(APP_PATH), host, brainServed),
      };
    } catch {
      return json(
        { error: host.errorDetail ? `the dashboard page is missing from the install (${APP_PATH}). Reinstall, or run from a checkout.` : "the dashboard page is missing" },
        500,
      );
    }
  }
  if (path === "/favicon.svg" || path === "/favicon.ico") {
    try {
      return {
        status: 200,
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
        body: files.text(FAVICON_PATH),
      };
    } catch {
      return json({ error: `not found: ${path}` }, 404);
    }
  }
  const found = resolveStatic(path, WEB_ROOT);
  if (found === null) return null;
  const headers = { "content-type": found.contentType, ...NO_STORE };
  try {
    if (!found.text) return { status: 200, headers, body: "", bytes: files.bytes(found.file) };
    const text = files.text(found.file);
    return { status: 200, headers, body: found.file.endsWith(".css") ? rebase(text, host.base) : text };
  } catch {
    return json({ error: `not found: ${path}` }, 404);
  }
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Is this `/api` path one this host serves? */
export function servesView(host: DashboardHost, path: string): boolean {
  return host.views === "all" || host.views.has(path);
}

/**
 * One `/api` view over an already-open observer source. `url`'s path is
 * relative to the host's base. Null: not a view this file knows (or not one
 * this host serves). Read-only by construction and by scan. Every throw becomes
 * a 500 JSON body: an instrument that crashes on a broken store is the one
 * moment the owner most needs it to render (scar E7).
 */
export function viewReply(url: URL, src: DashboardSource, host: DashboardHost): Reply | null {
  const path = url.pathname;
  if (!path.startsWith("/api/") || !servesView(host, path)) return null;
  try {
    return view(url, path, src, host);
  } catch (err) {
    if (!host.errorDetail) return json({ error: "this view could not be read just now" }, 500);
    // A store refusal reaches the page as its code and its detail — ids and
    // counts, never prose, so both are safe to print (`bin/dashboard.ts` makes
    // the same argument for the terminal).
    if (isStoreError(err)) return json({ error: `${err.code}: ${JSON.stringify(err.detail)}` }, 500);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** A `limit` a non-local host bounds (a huge one only makes a bigger reply on a shared server). */
function cap(host: DashboardHost, n: number, max: number): number {
  return host.machine ? n : Math.max(0, Math.min(n, max));
}

function view(url: URL, path: string, src: DashboardSource, host: DashboardHost): Reply | null {
  if (path === "/api/meta") {
    const meta = metaView(src);
    if (host.machine) return json(meta);
    // The store's folder is a path on the server, nothing of the person's.
    const { dir: _dir, ...rest } = meta;
    return json(rest);
  }
  if (path === "/api/pulse") return json(pulse(src));
  if (path === "/api/overview") {
    const overview = overviewView(src, cap(host, intParam(url, "limit", 40), 100));
    if (host.machine) return json(overview);
    // Home no longer draws the feed (round 4); off the wire where nothing reads it.
    const { feed: _feed, ...rest } = overview;
    return json(rest);
  }
  if (path === "/api/memories") return json(memoriesView(src, { limit: intParam(url, "limit", 4000) }));
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
      limit: cap(host, intParam(url, "limit", 50), 200),
    }));
  }
  if (path === "/api/memory") {
    const id = url.searchParams.get("id") ?? "";
    if (id.length === 0) return json({ error: "id is required" }, 400);
    return json(memoryDetail(src, id));
  }
  if (path === "/api/search") {
    return json(searchView(src, url.searchParams.get("q") ?? "", cap(host, intParam(url, "limit", 25), 50)));
  }
  if (path === "/api/mind") return json(mindView(src));
  // THE SUBJECTS TAB (wave 2 lane D, 2026-10-21): the cloud and every
  // subject; one subject's page (`me` is the subject that is me); one tag.
  if (path === "/api/subjects") return json(subjectsView(src));
  if (path === "/api/subject") {
    const id = url.searchParams.get("id") ?? "";
    if (id.length === 0) return json({ error: "id is required" }, 400);
    // Not a subject (or not one yet) is `found: false` with its absence named, as `/api/memory` answers.
    return json(subjectView(src, id));
  }
  if (path === "/api/tag") {
    const tag = url.searchParams.get("tag") ?? "";
    if (tag.trim().length === 0) return json({ error: "tag is required" }, 400);
    return json(tagView(src, tag));
  }
  if (path === "/api/dreams") return json(dreamsView(src, intParam(url, "limit", DREAM_LIMIT)));
  if (path === "/api/flow") return json(flowView(src, intParam(url, "limit", 24)));
  if (path === "/api/node") {
    const nodeKey = url.searchParams.get("key") ?? "";
    const detail = nodeDetail(src, nodeKey, intParam(url, "limit", 8));
    return detail.found ? json(detail) : json({ error: `no such node: ${nodeKey}` }, 404);
  }
  if (path === "/api/health") return json(healthView(src));
  if (path === "/api/fired") return json(firedPanel(src, src.store.today()));
  if (path === "/api/mechanisms") return json(mechanismsView(src));
  if (path === "/api/mechanism") {
    const panel = mechanismPanel(src, url.searchParams.get("id") ?? "");
    return panel.found ? json(panel) : json({ error: `no such mechanism: ${panel.id}` }, 404);
  }
  if (path === "/api/activity") {
    const sinceRaw = url.searchParams.get("sinceSeq");
    const opts: { limit: number; name?: string; sinceSeq?: number } = {
      limit: cap(host, intParam(url, "limit", 40), 100),
    };
    const name = url.searchParams.get("name");
    if (name !== null && name.length > 0) opts.name = name;
    if (sinceRaw !== null) opts.sinceSeq = intParam(url, "sinceSeq", 0);
    const activity = activityView(src, opts);
    if (host.machine) return json(activity);
    // The page on this host reads only `lastSeq` (the pulse: did the store move?).
    // The narrated rows and their details (session ids, the server's build)
    // stay off the wire; nothing on its tabs draws a feed.
    return json({ ...activity, events: [], vocabulary: [] });
  }
  if (path === "/api/event") {
    const seq = intParam(url, "seq", -1);
    if (seq < 0) return json({ error: "seq is required" }, 400);
    const detail = eventDetail(src, seq);
    return detail.found ? json(detail) : json({ error: "no event with that seq in the kept window" }, 404);
  }
  return null;
}
