import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
const SESSIONS_DIR = "sessions";
export const ASSOCIATION_DIR = "association";
export const PENDING_FILE = "pending.jsonl";
export const CLAIMS_DIR = "claims";
export const PENDING_PAIRS_PER_LINE = 16;
export const PENDING_MAX_BYTES = 1024 * 1024;
export const PENDING_MARKER_SLACK_BYTES = 16 * 1024;
export const PENDING_STALE_CLAIM_MS = 10 * 60000;
export function associationDir(dataDir) {
  return join(dataDir, SESSIONS_DIR, ASSOCIATION_DIR);
}
export function pendingPath(dataDir) {
  return join(associationDir(dataDir), PENDING_FILE);
}
export function claimsDir(dataDir) {
  return join(associationDir(dataDir), CLAIMS_DIR);
}
function codeOf(err) {
  if (err !== null && typeof err === "object") {
    const code = err.code;
    if (typeof code === "string")
      return code;
    const name = err.name;
    if (typeof name === "string")
      return name;
  }
  return "UNKNOWN";
}
function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
export function appendPendingDeltas(dataDir, deltas, opts) {
  if (deltas.length === 0)
    return { ok: true, lines: 0, pairs: 0, droppedPairs: 0, code: null };
  const path = pendingPath(dataDir);
  try {
    mkdirSync(associationDir(dataDir), { recursive: true });
    const size = sizeOf(path);
    if (size >= PENDING_MAX_BYTES) {
      if (size >= PENDING_MAX_BYTES + PENDING_MARKER_SLACK_BYTES) {
        return { ok: false, lines: 0, pairs: 0, droppedPairs: deltas.length, code: "PENDING_FULL" };
      }
      const marker = JSON.stringify({ at: opts.at, day: opts.day, dropped: deltas.length });
      appendFileSync(path, `${marker}
`, { encoding: "utf8", mode: 384 });
      return { ok: true, lines: 1, pairs: 0, droppedPairs: deltas.length, code: "PENDING_FULL" };
    }
    let lines = 0;
    for (let i = 0;i < deltas.length; i += PENDING_PAIRS_PER_LINE) {
      const chunk = deltas.slice(i, i + PENDING_PAIRS_PER_LINE);
      const line = JSON.stringify({
        at: opts.at,
        day: opts.day,
        p: chunk.map((d) => d.back === undefined ? [d.a, d.b, d.delta] : [d.a, d.b, d.delta, d.back])
      });
      appendFileSync(path, `${line}
`, { encoding: "utf8", mode: 384 });
      lines += 1;
    }
    return { ok: true, lines, pairs: deltas.length, droppedPairs: 0, code: null };
  } catch (err) {
    return { ok: false, lines: 0, pairs: 0, droppedPairs: deltas.length, code: codeOf(err) };
  }
}
function parseLine(raw) {
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (entry === null || typeof entry !== "object" || Array.isArray(entry))
    return null;
  const rec = entry;
  const at = typeof rec["at"] === "number" ? rec["at"] : null;
  const day = typeof rec["day"] === "number" && Number.isFinite(rec["day"]) && rec["day"] >= 0 ? Math.floor(rec["day"]) : null;
  if (at === null || day === null)
    return null;
  const dropped = typeof rec["dropped"] === "number" ? rec["dropped"] : 0;
  const pairs = [];
  const p = rec["p"];
  if (Array.isArray(p)) {
    for (const item of p) {
      if (!Array.isArray(item) || item.length < 3)
        continue;
      const [a, b, delta, back] = item;
      if (typeof a !== "string" || typeof b !== "string" || typeof delta !== "number")
        continue;
      if (a.length === 0 || b.length === 0 || !Number.isFinite(delta) || delta <= 0)
        continue;
      if (typeof back === "number" && Number.isFinite(back) && back >= 0 && back !== delta)
        pairs.push({ a, b, delta, back });
      else
        pairs.push({ a, b, delta });
    }
  }
  return { at, day, pairs, dropped };
}
function readClaim(path) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { path, passes: 0, deltas: [], day: null, oldestAt: null, droppedPairs: 0, corrupt: 0 };
  }
  const deltas = [];
  let passes = 0;
  let corrupt = 0;
  let droppedPairs = 0;
  let day = null;
  let oldestAt = null;
  for (const raw of text.split(`
`)) {
    if (raw.trim().length === 0)
      continue;
    const line = parseLine(raw);
    if (line === null) {
      corrupt += 1;
      continue;
    }
    passes += 1;
    droppedPairs += line.dropped;
    for (const d of line.pairs)
      deltas.push(d);
    day = day === null ? line.day : Math.max(day, line.day);
    oldestAt = oldestAt === null ? line.at : Math.min(oldestAt, line.at);
  }
  return { path, passes, deltas, day, oldestAt, droppedPairs, corrupt };
}
function touch(path, now) {
  try {
    utimesSync(path, now / 1000, now / 1000);
  } catch {}
}
export function claimPending(dataDir, opts = {}) {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? PENDING_STALE_CLAIM_MS;
  const id = `apc_${randomBytes(6).toString("hex")}`;
  const dir = claimsDir(dataDir);
  const claims = [];
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return claims;
  }
  try {
    renameSync(pendingPath(dataDir), join(dir, `${id}.jsonl`));
    touch(join(dir, `${id}.jsonl`), now);
    claims.push(readClaim(join(dir, `${id}.jsonl`)));
  } catch {}
  let orphans = [];
  try {
    orphans = readdirSync(dir);
  } catch {
    return claims;
  }
  let taken = 0;
  for (const name of orphans) {
    if (!name.endsWith(".jsonl") || name.startsWith(`${id}.`) || name === `${id}.jsonl`)
      continue;
    const from = join(dir, name);
    try {
      if (now - statSync(from).mtimeMs < staleMs)
        continue;
      taken += 1;
      const to = join(dir, `${id}.carried${taken}.jsonl`);
      renameSync(from, to);
      touch(to, now);
      claims.push(readClaim(to));
    } catch {}
  }
  return claims.sort((x, y) => (x.oldestAt ?? 0) - (y.oldestAt ?? 0));
}
export function releasePending(claim) {
  try {
    rmSync(claim.path, { force: true });
    return { released: true, stuck: false, code: null };
  } catch (err) {
    const code = codeOf(err);
    try {
      renameSync(claim.path, `${claim.path}.applied`);
      return { released: true, stuck: false, code };
    } catch {
      return { released: false, stuck: true, code };
    }
  }
}
