/**
 * Which URL paths are the page's own static files, and where each one lives.
 *
 * A pure function of the path — no filesystem here; `server.ts` does the one
 * `readFileSync`. The page is split into plain browser ES modules and
 * stylesheets under `web/` (see `web/README.md`), and this is the whole of what
 * the server will hand out from that tree:
 *
 *   - only `/app.js`, and files under `/shared/`, `/shell/`, `/pages/` and
 *     `/mechanisms/` — so `server.ts`, `views.ts`, the view modules and the
 *     HTML file are NOT reachable as files (the HTML has its own routes);
 *   - only an allow-listed extension: `.js`, `.css`, `.woff2`;
 *   - every path segment plain (`[A-Za-z0-9_-]` plus inner dots): no `..`, no
 *     `.`, no empty segment, no dotfile, no backslash, no NUL, no `%` left
 *     after ONE decode (so a double-encoded `%252e%252e` is refused, not
 *     decoded twice);
 *   - and the joined path must still sit under `web/`, checked after the join,
 *     as the last belt.
 *
 * Symlinks are not followed-and-checked: that would need `realpathSync`, and
 * `server.ts`'s filesystem surface is pinned to `readFileSync` alone. The tree
 * is the install's own files; `test/dashboard-web.test.ts` asserts it holds no
 * symlink at all.
 */
import { resolve, sep } from "node:path";

export const STATIC_TOP_FILES: readonly string[] = ["app.js"];
export const STATIC_DIRS: readonly string[] = ["shared", "shell", "pages", "mechanisms"];

/** Extension → content type. Text types carry a charset: the modules hold
 *  `κ ι — × ↓` literals, and a module script with the wrong MIME is refused. */
export const STATIC_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

export interface StaticFile {
  readonly file: string;
  readonly contentType: string;
  /** True for a text type, which is read and served as UTF-8. */
  readonly text: boolean;
}

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Resolve a request path against the `web/` root, or null for "not a static file". */
export function resolveStatic(pathname: string, root: string): StaticFile | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/")) return null;
  const rel = decoded.slice(1);
  if (rel.length === 0 || rel.includes("\0") || rel.includes("\\")) return null;
  const segments = rel.split("/");
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment.includes("..")) return null;
  }
  if (segments.length === 1) {
    if (!STATIC_TOP_FILES.includes(rel)) return null;
  } else if (!STATIC_DIRS.includes(segments[0] as string)) {
    return null;
  }
  const last = segments[segments.length - 1] as string;
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return null;
  const contentType = STATIC_TYPES[last.slice(dot).toLowerCase()];
  if (contentType === undefined) return null;
  const base = resolve(root);
  const file = resolve(base, ...segments);
  if (!file.startsWith(base + sep)) return null;
  return { file, contentType, text: contentType.includes("charset=") };
}
