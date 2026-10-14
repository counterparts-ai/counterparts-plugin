import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from "node:fs";
import { basename } from "node:path";
const GRANTS = new WeakMap;
export function grantSpanStrike(buffer, access) {
  GRANTS.set(buffer, access);
}
const TEXT_STREAMS = ["conversation", "jot", "assistant"];
const EMPTY = {
  reason: "NOTHING",
  struck: 0,
  files: [],
  scopes: 0,
  ledgered: 0,
  touchedClaim: false,
  recovered: 0
};
export function strikeSpans(buffer, request) {
  const access = GRANTS.get(buffer);
  if (access === undefined)
    throw new Error("SPAN_STRIKE_UNGRANTED");
  if (access.observer) {
    access.mutate("strike", () => {
      return;
    });
    return { ...EMPTY, reason: "OBSERVER" };
  }
  const hashes = new Set(request.hashes ?? []);
  const sessions = new Set(request.sessions ?? []);
  const predicate = request.predicate;
  const by = request.by ?? "owner";
  if (hashes.size === 0 && sessions.size === 0 && predicate === undefined)
    return EMPTY;
  const matches = (span) => {
    if (hashes.has(span.hash))
      return true;
    if (typeof span.session === "string" && sessions.has(span.session))
      return true;
    if (predicate === undefined || typeof span.text !== "string")
      return false;
    return span.kind === "jot" && predicate(span.text);
  };
  const scopes = request.scope === null ? access.scopes() : [request.scope];
  const files = [];
  let struck = 0;
  let ledgered = 0;
  let touchedClaim = false;
  let recovered = 0;
  let failed = false;
  let observed = false;
  for (const scope of scopes) {
    if (!existsSync(access.scopeDir(scope)))
      continue;
    const targets = [
      ...TEXT_STREAMS.map((kind) => access.streamPath(scope, kind)),
      access.path(scope, "quarantine.jsonl"),
      ...access.claimFiles(scope)
    ];
    for (const file of targets) {
      const back = access.mutate("strike", () => foldAside(file));
      if (back.ok)
        recovered += back.value;
      else if (back.reason === "OBSERVER")
        observed = true;
      else
        failed = true;
    }
    const doomed = new Set;
    for (const file of targets) {
      for (const span of access.readLines(file)) {
        if (typeof span.hash === "string" && matches(span))
          doomed.add(span.hash);
      }
      for (const span of access.readLines(`${file}.striking`)) {
        if (typeof span.hash === "string" && matches(span))
          doomed.add(span.hash);
      }
    }
    if (doomed.size === 0)
      continue;
    const ledger = access.mutate("strike", () => {
      access.ensureScope(scope);
      const file = access.path(scope, "consumed.jsonl");
      const held = new Set(access.readLines(file).map((l) => l.hash));
      const fresh = [...doomed].filter((h) => !held.has(h));
      if (fresh.length > 0) {
        const at = access.now();
        appendFileSync(file, `${fresh.map((hash) => JSON.stringify({ hash, at })).join(`
`)}
`, "utf8");
        if (by === "retention")
          access.trimLedger(file);
      }
      return fresh.length;
    });
    if (!ledger.ok) {
      if (ledger.reason === "OBSERVER")
        observed = true;
      else
        failed = true;
      continue;
    }
    ledgered += ledger.value;
    let scopeStruck = 0;
    let scopeFiles = 0;
    for (const file of targets) {
      const outcome = access.mutate("strike", () => rewrite(access, file, matches));
      if (!outcome.ok) {
        if (outcome.reason === "OBSERVER")
          observed = true;
        else
          failed = true;
        continue;
      }
      if (outcome.value === 0)
        continue;
      struck += outcome.value;
      scopeStruck += outcome.value;
      scopeFiles += 1;
      files.push({ file: relName(access, scope, file), struck: outcome.value });
      if (file.includes(`${sep}claims${sep}`))
        touchedClaim = true;
    }
    access.mutate("strike", () => {
      access.ensureScope(scope);
      appendFileSync(access.path(scope, "strikes.jsonl"), `${JSON.stringify({
        at: access.now(),
        day: access.day(),
        by,
        files: scopeFiles,
        struck: scopeStruck,
        ledgered: ledger.value
      })}
`, "utf8");
    });
  }
  const reason = observed ? "OBSERVER" : failed ? "IO_FAILED" : struck > 0 || ledgered > 0 ? "STRUCK" : recovered > 0 ? "RECOVERED" : "NOTHING";
  if (reason !== "NOTHING") {
    access.emit("remember.span.struck", undefined, {
      by,
      reason,
      struck,
      files: files.length,
      scopes: scopes.length,
      ledgered,
      touchedClaim,
      recovered
    });
  }
  return { reason, struck, files, scopes: scopes.length, ledgered, touchedClaim, recovered };
}
const sep = "/";
function relName(access, scope, file) {
  const dir = access.scopeDir(scope);
  const rel = file.startsWith(dir) ? file.slice(dir.length + 1) : basename(file);
  return `${basename(dir)}/${rel}`;
}
function foldAside(file) {
  const aside = `${file}.striking`;
  if (!existsSync(aside))
    return 0;
  const held = new Set;
  for (const line of lines(file)) {
    const span = parse(line);
    if (span !== null)
      held.add(span.hash);
  }
  const back = [];
  for (const line of lines(aside)) {
    const span = parse(line);
    if (span !== null) {
      if (held.has(span.hash))
        continue;
      held.add(span.hash);
    }
    back.push(line);
  }
  if (back.length > 0)
    appendDurably(file, `${back.join(`
`)}
`);
  rmSync(aside, { force: true });
  return back.length;
}
function appendDurably(file, text) {
  const fd = openSync(file, "a");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function rewrite(access, file, matches) {
  const aside = `${file}.striking`;
  foldAside(file);
  if (!existsSync(file))
    return 0;
  const hits = lines(file).filter((line) => {
    const span = parse(line);
    return span !== null && matches(span);
  }).length;
  if (hits === 0)
    return 0;
  renameSync(file, aside);
  const keep = [];
  const seen = new Set;
  let struck = 0;
  for (const line of lines(aside)) {
    const span = parse(line);
    if (span === null) {
      keep.push(line);
      continue;
    }
    if (matches(span)) {
      struck += 1;
      continue;
    }
    if (seen.has(span.hash))
      continue;
    seen.add(span.hash);
    keep.push(line);
  }
  if (keep.length > 0)
    appendDurably(file, `${keep.join(`
`)}
`);
  rmSync(aside, { force: true });
  return struck;
}
function lines(file) {
  if (!existsSync(file))
    return [];
  try {
    return readFileSync(file, "utf8").split(`
`).filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}
function parse(line) {
  try {
    const span = JSON.parse(line);
    return typeof span.hash === "string" && typeof span.text === "string" ? span : null;
  } catch {
    return null;
  }
}
