import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_DIR, canonicalScope } from "./sessions.js";
export const EXPANSIONS_FILE = "expansions.jsonl";
export const EXPANSION_TTL_MS = 24 * 60 * 60 * 1000;
export const EXPANSIONS_MAX_BYTES = 64 * 1024;
export const EXPANSIONS_KEEP = 256;
export function expansionsPath(dataDir) {
  return join(dataDir, SESSIONS_DIR, EXPANSIONS_FILE);
}
export const EXPANSIONS_SALT_FILE = "expansions.salt";
const SALT_BYTES = 16;
export function expansionsSaltPath(dataDir) {
  return join(dataDir, SESSIONS_DIR, EXPANSIONS_SALT_FILE);
}
export function expansionSalt(dataDir) {
  return saltFrom(dataDir, true);
}
export function readExpansionSalt(dataDir) {
  return saltFrom(dataDir, false);
}
function saltFrom(dataDir, mint) {
  const path = expansionsSaltPath(dataDir);
  for (let attempt = 0;attempt < 2; attempt += 1) {
    let salt = null;
    try {
      salt = readFileSync(path, "utf8").trim();
    } catch {}
    if (salt !== null)
      return salt.length === SALT_BYTES * 2 ? salt : null;
    if (attempt === 1 || !mint)
      return null;
    try {
      mkdirSync(join(dataDir, SESSIONS_DIR), { recursive: true });
      writeFileSync(path, `${randomBytes(SALT_BYTES).toString("hex")}
`, {
        encoding: "utf8",
        mode: 384,
        flag: "wx"
      });
    } catch {}
  }
  return null;
}
export function handleKey(handle, salt) {
  return createHash("sha256").update(salt).update("\x00").update(handle.trim().toLowerCase()).digest("hex").slice(0, 16);
}
export function recordHandleResolution(dataDir, input) {
  const handle = input.handle.trim();
  if (handle.length === 0)
    return false;
  if (input.id !== null && input.id.length === 0)
    return false;
  const salt = expansionSalt(dataDir);
  if (salt === null)
    return false;
  const record = {
    key: handleKey(handle, salt),
    id: input.id,
    at: input.at ?? Date.now(),
    ...input.scope === undefined || input.scope.length === 0 ? {} : { scope: canonicalScope(input.scope) }
  };
  const path = expansionsPath(dataDir);
  try {
    mkdirSync(join(dataDir, SESSIONS_DIR), { recursive: true });
    const line = `${JSON.stringify(record)}
`;
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {}
    if (size + line.length > EXPANSIONS_MAX_BYTES)
      compactExpansions(path, record.at);
    appendFileSync(path, line, { encoding: "utf8", mode: 384 });
  } catch {
    return false;
  }
  return true;
}
export function readHandleResolutions(dataDir, opts = {}) {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? EXPANSION_TTL_MS;
  const since = opts.since;
  const want = opts.scope === undefined || opts.scope.length === 0 ? null : canonicalScope(opts.scope);
  const map = new Map;
  const salt = expansionSalt(dataDir);
  if (salt === null)
    return { map, salt: "", ok: false, reason: "unreadable" };
  let raw;
  try {
    raw = readFileSync(expansionsPath(dataDir), "utf8");
  } catch (err) {
    const absent = err?.code === "ENOENT";
    return { map, salt, ok: false, reason: absent ? "absent" : "unreadable" };
  }
  const parsed = parseLines(raw);
  for (const record of parsed.records) {
    if (now - record.at > ttl)
      continue;
    if (want !== null && !scopeMatches(record.scope, want))
      continue;
    if (since !== undefined && record.at < since)
      continue;
    map.set(record.key, record.id);
  }
  if (parsed.lines > 0 && parsed.records.length === 0) {
    return { map, salt, ok: false, reason: "corrupt" };
  }
  return { map, salt, ok: true, reason: "ok" };
}
function scopeMatches(scope, want) {
  if (scope === undefined)
    return false;
  return scope === want || canonicalScope(scope) === want;
}
export function translateExpansions(expansions, resolutions, salt) {
  if (resolutions.size === 0)
    return [...expansions];
  return expansions.map((raw) => resolutions.get(handleKey(raw, salt)) ?? raw);
}
export function countTranslated(expansions, resolutions, salt) {
  let n = 0;
  for (const raw of expansions) {
    const to = resolutions.get(handleKey(raw, salt));
    if (to !== undefined && to !== null && to !== raw.trim())
      n += 1;
  }
  return n;
}
export function compactExpansions(path, now, duringWindow) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch {
    return;
  }
  const offset = buf.length;
  const live = new Map;
  for (const record of parseLines(buf.toString("utf8")).records) {
    if (now - record.at > EXPANSION_TTL_MS)
      continue;
    live.set(record.key, record);
  }
  const keep = [...live.values()].sort((a, b) => a.at - b.at).slice(-EXPANSIONS_KEEP);
  const tmp = `${path}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(tmp, keep.map((r) => `${JSON.stringify(r)}
`).join(""), {
      encoding: "utf8",
      mode: 384
    });
    duringWindow?.();
    const after = readFileSync(path);
    if (after.length > offset)
      appendFileSync(tmp, after.subarray(offset), { mode: 384 });
    renameSync(tmp, path);
  } catch {}
}
function parseLines(raw) {
  const records = [];
  let lines = 0;
  for (const line of raw.split(`
`)) {
    if (line.trim().length === 0)
      continue;
    lines += 1;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = parseRecord(parsed);
    if (record !== null)
      records.push(record);
  }
  return { records, lines };
}
function parseRecord(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const rec = raw;
  const key = rec["key"];
  const id = rec["id"];
  const at = rec["at"];
  if (typeof key !== "string" || key.length === 0)
    return null;
  if (id !== null && (typeof id !== "string" || id.length === 0))
    return null;
  if (typeof at !== "number" || !Number.isFinite(at))
    return null;
  const scope = rec["scope"];
  return {
    key,
    id,
    at,
    ...typeof scope === "string" && scope.length > 0 ? { scope } : {}
  };
}
