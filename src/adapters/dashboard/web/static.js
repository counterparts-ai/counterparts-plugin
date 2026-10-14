import { resolve, sep } from "node:path";
export const STATIC_TOP_FILES = ["app.js"];
export const STATIC_DIRS = ["shared", "shell", "pages", "mechanisms"];
export const STATIC_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2"
};
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export function resolveStatic(pathname, root) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/"))
    return null;
  const rel = decoded.slice(1);
  if (rel.length === 0 || rel.includes("\x00") || rel.includes("\\"))
    return null;
  const segments = rel.split("/");
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment.includes(".."))
      return null;
  }
  if (segments.length === 1) {
    if (!STATIC_TOP_FILES.includes(rel))
      return null;
  } else if (!STATIC_DIRS.includes(segments[0])) {
    return null;
  }
  const last = segments[segments.length - 1];
  const dot = last.lastIndexOf(".");
  if (dot <= 0)
    return null;
  const contentType = STATIC_TYPES[last.slice(dot).toLowerCase()];
  if (contentType === undefined)
    return null;
  const base = resolve(root);
  const file = resolve(base, ...segments);
  if (!file.startsWith(base + sep))
    return null;
  return { file, contentType, text: contentType.includes("charset=") };
}
