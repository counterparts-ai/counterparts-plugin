import { existsSync, readFileSync } from "node:fs";
import { localDate } from "../../core/time.js";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { LANE_ORDER, PREFACE_RESERVE_BYTES } from "../../core/self/index.js";
import { storeExists } from "../../core/store/index.js";
import { defaultConfigPath } from "../config-path.js";
import { CLAUDE_CODE_BUDGET_BYTES } from "../config.js";
import {
  canonicalScopePath,
  lookupScope,
  ownEntry,
  readScopes,
  resumeTarget,
  scopesPath,
  setScope,
  stanceOfMode,
  writeScopes
} from "../scopes.js";
import { EXIT, openCounterpart } from "./commands-shared.js";
export function rebriefCommand(dir, io, budgetFlag, now, home, named) {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const ceiling = home === undefined ? hostCeiling(dir, budgetFlag, homedir(), named) : hostCeiling(dir, budgetFlag, home, named);
  if ("refusal" in ceiling) {
    for (const line of ceiling.refusal.split(`
`))
      io.err(line);
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir);
  try {
    const at = localDate(now(), counterpart.store.zone());
    const report = counterpart.rebrief({ budgetBytes: ceiling.bytes, at });
    if (!report.rendered) {
      io.err(`refused: the render declined (${report.reason}).`);
      return EXIT.refused;
    }
    io.out(`Re-rendered the wake bundle for ${counterpart.store.dir}.`);
    io.out(`  lived day ${report.day}, horizon asked about ${at}`);
    io.out(ceiling.source === "--budget" ? `  budget ${ceiling.bytes} bytes from --budget` : `  budget ${ceiling.bytes} bytes from ${ceiling.source}${ceiling.namedBy === undefined ? "" : ` (named by ${ceiling.namedBy})`}`);
    io.out(`  composed under ${report.composeBudget} — the delivery preface reserves ${PREFACE_RESERVE_BYTES}`);
    io.out(`  lanes: ${LANE_ORDER.map((l) => `${l} ${report.counts[l] ?? 0}`).join("  ")}`);
    io.out(`  elements ${report.elements}, bytes ${report.bytes}`);
    io.out(report.published ? "  published — the next session wakes on this bundle." : "  NOT published: the store is in observer stance.");
    io.out("  No sleep marker moved and no other sleep phase ran.");
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}
export function scopeCommand(parsed, io, observer, choice, now) {
  const configPath = choice?.path ?? defaultConfigPath();
  const file = scopesPath(configPath);
  const flags = parsed.flags;
  const asked = [
    { flag: "on", mode: "on" },
    { flag: "observer", mode: "observer" },
    { flag: "off", mode: "off" },
    { flag: "pause", mode: "paused" }
  ].filter((m) => flags[m.flag] === true);
  const resuming = flags["resume"] === true;
  const listing = flags["list"] === true;
  if (asked.length + (resuming ? 1 : 0) > 1) {
    io.err(`refused: ${[...asked.map((a) => `--${a.flag}`), ...resuming ? ["--resume"] : []].join(" and ")} — a directory is in one mode at a time.`);
    io.err("Nothing was written.");
    return EXIT.refused;
  }
  const read = readScopes(file);
  const unreadable = () => {
    io.err(`refused: ${file} could not be read — ${read.error ?? "unknown"}.`);
  };
  const sayRefused = () => {
    for (const entry of read.refused) {
      io.err(`  ignored: ${entry.key} — ${entry.detail}. It reads as unset, which is on.`);
    }
  };
  if (listing) {
    if (asked.length > 0 || resuming || parsed.positional.length > 0) {
      io.err("refused: --list prints the whole registry; it takes no path and no mode.");
      return EXIT.refused;
    }
    if (read.error !== null) {
      unreadable();
      io.err("Nothing was read. Fix the file, or replace it with `scope <path> --off --force`.");
      return EXIT.refused;
    }
    io.out(`Scopes (${file}):`);
    if (read.refused.length > 0) {
      io.err(`warning: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in this file could not be read:`);
      sayRefused();
    }
    const entries = Object.entries(read.registry?.scopes ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      io.out("  Nothing is set. Every directory is on by default.");
      return EXIT.ok;
    }
    for (const [path, entry] of entries) {
      const resume = entry.mode === "paused" ? ` (resumes to ${resumeTarget(entry)})` : "";
      io.out(`  ${entry.mode.padEnd(9)} ${path}${resume}`);
      io.out(`  ${" ".repeat(9)} since ${entry.since}${entry.note === undefined ? "" : ` — ${entry.note}`}`);
    }
    return EXIT.ok;
  }
  const given = parsed.positional[0];
  if (given === undefined) {
    io.err("refused: name a directory (`.` means this one), or pass --list.");
    return EXIT.usage;
  }
  const dir = canonicalScopePath(given);
  if (asked.length === 0 && !resuming) {
    if (read.error !== null) {
      unreadable();
      io.err("Until it is fixed every directory reads as unset, which is on.");
      return EXIT.refused;
    }
    if (read.refused.length > 0) {
      io.err(`warning: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in ${file} could not be read:`);
      sayRefused();
    }
    const verdict = lookupScope(read.registry, dir);
    io.out(`${dir} — ${verdict.mode === "unset" ? "unset" : verdict.mode}`);
    if (verdict.entry === null) {
      io.out("  Nothing is set for it or for any parent, so it is on (the default).");
      io.out(`  Registry: ${file}`);
      return EXIT.ok;
    }
    io.out(`  Stance: ${stanceOfMode(verdict.mode)}.`);
    io.out(verdict.matched === dir ? `  Decided by its own entry, set ${verdict.entry.since}.` : `  Decided by ${verdict.matched ?? "?"} (an ancestor), set ${verdict.entry.since}.`);
    if (verdict.entry.mode === "paused") {
      io.out(`  --resume puts it back to ${resumeTarget(verdict.entry)}.`);
    }
    if (verdict.entry.note !== undefined)
      io.out(`  Note: ${verdict.entry.note}`);
    io.out(`  Registry: ${file}`);
    return EXIT.ok;
  }
  if (observer) {
    io.err("refused: writing the scope registry changes this host's configuration, and this console is in observer stance. An instrument reads; it does not change the setting it is reading.");
    return EXIT.refused;
  }
  if (read.error !== null && flags["force"] !== true) {
    unreadable();
    io.err("Nothing was written. Fix it by hand, or pass --force to replace it entirely.");
    return EXIT.refused;
  }
  if (read.refused.length > 0) {
    if (flags["force"] !== true) {
      io.err(`refused: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in ${file} could not be read, and writing would drop ${read.refused.length === 1 ? "it" : "them"}:`);
      sayRefused();
      io.err("Nothing was written. Fix those by hand, or pass --force to drop them.");
      return EXIT.refused;
    }
    io.err(`warning: --force drops ${String(read.refused.length)} unreadable ${read.refused.length === 1 ? "entry" : "entries"}:`);
    sayRefused();
  }
  const base = read.error === null ? read.registry : null;
  let mode;
  if (resuming) {
    const own = ownEntry(base, dir);
    if (own === null) {
      const inherited = lookupScope(base, dir);
      io.err(inherited.entry === null ? `refused: nothing is set for ${dir}, so there is nothing to resume. It is already on.` : `refused: nothing is set for ${dir} itself — it inherits ${inherited.matched ?? "?"}. Resume that one, or set this one directly.`);
      return EXIT.refused;
    }
    if (own.mode === "on" || own.mode === "observer") {
      io.out(`${dir} is already ${own.mode}; nothing to resume, and nothing was written.`);
      return EXIT.ok;
    }
    mode = resumeTarget(own);
  } else {
    mode = asked[0]?.mode ?? "on";
  }
  const apply = (from) => setScope(from, dir, mode, {
    at: new Date(now()).toISOString(),
    ...typeof flags["note"] === "string" ? { note: flags["note"] } : {}
  });
  const next = apply(base);
  writeScopes(file, next, {
    basedOn: read,
    reapply: (fresh) => apply(read.error === null ? fresh : null)
  });
  io.out(`Scope set: ${dir} — ${mode}.`);
  if (canonicalScopePath(given) !== resolve(given) || given !== dir) {
    io.out(`  ('${given}' resolved to that path; the registry only ever holds absolute ones.)`);
  }
  io.out(`  ${scopeEffect(mode, ownEntry(next, dir)?.resumeTo)}`);
  io.out(`  Written to ${file}`);
  return EXIT.ok;
}
function scopeEffect(mode, resumeTo) {
  switch (mode) {
    case "on":
      return "Sessions there capture, deposit, wake and recall, as everywhere else.";
    case "observer":
      return "Sessions there deliver the wake and recall and record nothing; the remember, session_end and chapter tools stand down.";
    case "off":
      return "The hooks there produce no output and write nothing, and every tool refuses. `--resume` turns it back on.";
    default:
      return `Off for now. \`--resume\` puts it back to ${resumeTo ?? "on"}.`;
  }
}
export function hostCeiling(dir, flag, home = homedir(), named) {
  if (typeof flag === "string" && flag.length > 0) {
    const n = Number(flag);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        refusal: `refused: --budget takes a positive whole number of bytes, not '${flag}'.`,
        searched: []
      };
    }
    return { bytes: n, source: "--budget", searched: [] };
  }
  const beside = join(dir, "..", "claude-code.json");
  const hooksConfig = defaultConfigPath(home);
  const searched = named !== undefined && named.source !== "default" ? [named.path] : beside === hooksConfig ? [beside] : [beside, hooksConfig];
  const namedBy = named !== undefined && named.source !== "default" ? named.source : undefined;
  let keyless;
  for (const candidate of searched) {
    if (!existsSync(candidate))
      continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      const value = parsed["injectionBudgetBytes"];
      if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return {
          bytes: value,
          source: candidate,
          searched,
          ...namedBy === undefined ? {} : { namedBy }
        };
      }
      if (value === undefined && keyless === undefined)
        keyless = candidate;
    } catch {}
  }
  if (keyless !== undefined) {
    return {
      bytes: CLAUDE_CODE_BUDGET_BYTES,
      source: `${keyless} (no injectionBudgetBytes there, so Claude Code's default)`,
      searched,
      ...namedBy === undefined ? {} : { namedBy }
    };
  }
  return {
    refusal: [
      'refused: no injection ceiling. Nothing set "injectionBudgetBytes" in either place',
      "this command looks, so there is no number to compose under, and a briefing never",
      "invents one (scar §2.18). Looked, in order:",
      ...searched.map((p) => `  ${p}${existsSync(p) ? "  (present, no injectionBudgetBytes)" : "  (absent)"}`),
      "Pass --budget <bytes>, or add the key to one of those files."
    ].join(`
`),
    searched
  };
}
