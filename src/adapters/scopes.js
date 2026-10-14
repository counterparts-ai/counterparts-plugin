import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { defaultConfigPath } from "./config-path.js";
import { isPseudoScope } from "./hosts.js";
import { pluginConsoleWords } from "./runtime.js";
export function canonicalScopePath(dir) {
  if (isPseudoScope(dir))
    return dir;
  const abs = resolve(dir);
  let head = abs;
  const tail = [];
  for (;; ) {
    try {
      return tail.length === 0 ? realpathSync(head) : join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head)
        return abs;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}
export const SCOPES_FILE_NAME = "scopes.json";
export const SCOPES_VERSION = 1;
export const SCOPE_UNREADABLE_EVENT = "adapter.scope.unreadable";
export const SCOPE_EVENT = "adapter.scope";
export const SCOPE_JOINED_LATE_EVENT = "adapter.scope.joined-late";
export const SCOPE_REFUSED_EVENT = "adapter.scope.entries-refused";
export const SCOPE_MODES = ["on", "observer", "off", "paused"];
export const RESUME_MODES = ["on", "observer"];
const STANCE_ORDER = ["on", "observer", "off"];
export function scopesPath(configPath) {
  return join(dirname(configPath), SCOPES_FILE_NAME);
}
export function emptyRegistry() {
  return { version: SCOPES_VERSION, scopes: {} };
}
function isMode(value) {
  return typeof value === "string" && SCOPE_MODES.includes(value);
}
function isResumeMode(value) {
  return typeof value === "string" && RESUME_MODES.includes(value);
}
export function parseRegistry(raw) {
  const whole = (error) => ({
    registry: null,
    error,
    refused: []
  });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return whole("the file is not a JSON object");
  }
  const rec = raw;
  if (rec["version"] !== SCOPES_VERSION) {
    return whole(`"version" is ${JSON.stringify(rec["version"])}, and this reads version ${String(SCOPES_VERSION)}`);
  }
  const scopesRaw = rec["scopes"];
  if (scopesRaw === undefined)
    return { registry: emptyRegistry(), error: null, refused: [] };
  if (scopesRaw === null || typeof scopesRaw !== "object" || Array.isArray(scopesRaw)) {
    return whole('"scopes" is not an object');
  }
  const scopes = {};
  const refused = [];
  const refuse = (key, detail) => {
    refused.push({ key, detail });
  };
  for (const [path, value] of Object.entries(scopesRaw)) {
    if (!path.startsWith("/") && !isPseudoScope(path)) {
      refuse(path, "the key is not an absolute path");
      continue;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      refuse(path, "the entry is not an object");
      continue;
    }
    const entry = value;
    if (!isMode(entry["mode"])) {
      refuse(path, `mode ${JSON.stringify(entry["mode"])}; it takes ${SCOPE_MODES.join(", ")}`);
      continue;
    }
    const since = entry["since"];
    if (typeof since !== "string" || since.length === 0) {
      refuse(path, 'no "since"');
      continue;
    }
    const resumeTo = entry["resumeTo"];
    if (resumeTo !== undefined && !isResumeMode(resumeTo)) {
      refuse(path, `resumeTo ${JSON.stringify(resumeTo)}; it takes ${RESUME_MODES.join(", ")}`);
      continue;
    }
    const note = entry["note"];
    if (note !== undefined && typeof note !== "string") {
      refuse(path, 'a "note" that is not text');
      continue;
    }
    scopes[path] = {
      mode: entry["mode"],
      since,
      ...resumeTo === undefined ? {} : { resumeTo },
      ...note === undefined ? {} : { note }
    };
  }
  return { registry: { version: SCOPES_VERSION, scopes }, error: null, refused };
}
export function readScopes(path, read = (p) => readFileSync(p, "utf8")) {
  let text;
  try {
    text = read(path);
  } catch (err) {
    const code = err !== null && typeof err === "object" && typeof err.code === "string" ? err.code : "UNREADABLE";
    if (code === "ENOENT") {
      return { registry: null, present: false, error: null, refused: [], raw: null };
    }
    return {
      registry: null,
      present: true,
      error: `it could not be read (${code})`,
      refused: [],
      raw: null
    };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      registry: null,
      present: true,
      error: `it is not JSON (${err instanceof Error ? err.message : String(err)})`,
      refused: [],
      raw: text
    };
  }
  const parsed = parseRegistry(raw);
  return {
    registry: parsed.registry,
    present: true,
    error: parsed.error,
    refused: parsed.refused,
    raw: text
  };
}
export function describeScopeTrouble(read, path) {
  if (read.error !== null) {
    return `[counterparts] scope registry ${path} could not be read — ${read.error}. Every directory reads as unset (on) until it is fixed.`;
  }
  if (read.refused.length === 0)
    return null;
  const one = read.refused.length === 1;
  const list = read.refused.map((r) => `${r.key} (${r.detail})`).join("; ");
  return `[counterparts] scope registry ${path}: ${String(read.refused.length)} ${one ? "entry" : "entries"} ` + `could not be read and ${one ? "is" : "are"} IGNORED — ${list}. ` + `${one ? "That directory reads" : "Those directories read"} as unset (on); every other entry stands.`;
}
function restrictionOf(mode) {
  return rankOf(mode);
}
function under(key, dir) {
  if (key === dir)
    return true;
  const base = key.endsWith(sep) ? key : `${key}${sep}`;
  return dir.startsWith(base);
}
export function lookupScope(registry, dir) {
  if (registry === null)
    return { mode: "unset", matched: null, entry: null };
  const target = canonicalScopePath(dir);
  let best = null;
  for (const [key, entry] of Object.entries(registry.scopes)) {
    const canonical = canonicalScopePath(key);
    if (!under(canonical, target))
      continue;
    if (best === null || canonical.length > best.canonical.length) {
      best = { key, canonical, entry };
      continue;
    }
    if (canonical !== best.canonical)
      continue;
    if (restrictionOf(entry.mode) > restrictionOf(best.entry.mode))
      best = { key, canonical, entry };
  }
  if (best === null)
    return { mode: "unset", matched: null, entry: null };
  return { mode: best.entry.mode, matched: best.key, entry: best.entry };
}
export function stanceOfMode(mode) {
  switch (mode) {
    case "observer":
      return "observer";
    case "off":
    case "paused":
      return "off";
    default:
      return "on";
  }
}
export function mostRestrictiveVerdict(primary, other) {
  return rankOf(other.mode) > rankOf(primary.mode) ? other : primary;
}
function rankOf(mode) {
  return STANCE_ORDER.indexOf(stanceOfMode(mode));
}
export function effectiveStance(configObserver, mode) {
  const fromConfig = configObserver ? "observer" : "on";
  const fromScope = stanceOfMode(mode);
  return STANCE_ORDER.indexOf(fromConfig) >= STANCE_ORDER.indexOf(fromScope) ? fromConfig : fromScope;
}
export function ownEntry(registry, dir) {
  if (registry === null)
    return null;
  const key = canonicalScopePath(dir);
  for (const [existing, entry] of Object.entries(registry.scopes)) {
    if (canonicalScopePath(existing) === key)
      return entry;
  }
  return null;
}
export function resumeTarget(entry) {
  return entry?.resumeTo ?? "on";
}
export function setScope(registry, dir, mode, opts) {
  const base = registry ?? emptyRegistry();
  const key = canonicalScopePath(dir);
  const prior = ownEntry(base, dir) ?? undefined;
  const resumeTo = opts.resumeTo ?? (mode === "paused" ? prior !== undefined && (prior.mode === "on" || prior.mode === "observer") ? prior.mode : resumeTarget(prior ?? null) : undefined);
  const entry = {
    mode,
    since: opts.at,
    ...resumeTo === undefined ? {} : { resumeTo },
    ...opts.note !== undefined ? opts.note.length === 0 ? {} : { note: opts.note } : prior?.note === undefined ? {} : { note: prior.note }
  };
  const scopes = {};
  for (const [existing, value] of Object.entries(base.scopes)) {
    if (canonicalScopePath(existing) === key)
      continue;
    scopes[existing] = value;
  }
  scopes[key] = entry;
  return { version: SCOPES_VERSION, scopes };
}
export function writeScopes(path, registry, cas) {
  mkdirSync(dirname(path), { recursive: true });
  const write = (next, expect) => {
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}
`, { encoding: "utf8", mode: 384 });
    if (expect !== undefined && rawScopes(path) !== expect) {
      try {
        unlinkSync(tmp);
      } catch {}
      return false;
    }
    renameSync(tmp, path);
    return true;
  };
  if (cas === undefined) {
    write(registry, undefined);
    return;
  }
  if (write(registry, cas.basedOn.raw))
    return;
  write(cas.reapply(readScopes(path).registry), undefined);
}
function rawScopes(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
export function scopeCommandContext(input) {
  const given = input.configPath ?? "";
  const named = given.length === 0 || scopesPath(given) === scopesPath(defaultConfigPath(input.home)) ? null : given;
  const root = (input.pluginRoot ?? "").trim();
  return { home: input.home, pluginRoot: root.length === 0 ? null : root, configPath: named };
}
export function scopeCommand(folder, flag, ctx) {
  const target = shellWord(canonicalScopePath(folder), ctx.home);
  const config = ctx.configPath === null ? "" : ` --config ${shellWord(ctx.configPath, ctx.home)}`;
  return ctx.pluginRoot === null ? `counterparts scope ${target} ${flag}${config}` : `${pluginConsoleWords(ctx.pluginRoot).map((w) => shellWord(w, ctx.home)).join(" ")} scope ${target} ${flag}${config}`;
}
export function shortPath(path, home) {
  for (const h of new Set([resolve(home), canonicalScopePath(home)])) {
    if (path === h)
      return "~";
    if (path.startsWith(`${h}/`))
      return `~${path.slice(h.length)}`;
  }
  return path;
}
export function shellWord(path, home) {
  const plain = /^[A-Za-z0-9_./@%+=:,-]+$/;
  const short = shortPath(path, home);
  if (short !== path && (short === "~" || plain.test(short.slice(1))))
    return short;
  if (plain.test(path))
    return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}
