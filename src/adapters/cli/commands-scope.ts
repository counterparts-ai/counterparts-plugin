/** `scope`, `rebrief`, and the host's ceiling `rebrief` reads (moved out of `commands.ts`, 2026-10-11). */
import { existsSync, readFileSync } from "node:fs";
import { localDate } from "../../core/time.js";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { LANE_ORDER, PREFACE_RESERVE_BYTES } from "../../core/self/index.js";
import { storeExists } from "../../core/store/index.js";
// The ONE rule for "which host configuration": the console resolves it with the
// same function the hook, the worker and the MCP server do.
import { defaultConfigPath } from "../config-path.js";
import { CLAUDE_CODE_BUDGET_BYTES } from "../config.js";
import type { ConfigChoice, ConfigSource } from "../config-path.js";
// The scope registry — host configuration, beside the host configuration. The
// console is the surface that WRITES it; the hooks and the MCP server only read.
import {
  canonicalScopePath,
  lookupScope,
  ownEntry,
  readScopes,
  resumeTarget,
  scopesPath,
  setScope,
  stanceOfMode,
  writeScopes,
} from "../scopes.js";
import type { ScopeMode, ScopeRegistry } from "../scopes.js";
import { EXIT, openCounterpart } from "./commands-shared.js";
import type { Io, Parsed } from "./commands-shared.js";

// ── rebrief ─────────────────────────────────────────────────────────────────

/**
 * THE OWNER'S RE-RENDER.
 *
 * The wake bundle is composed at the day's first boundary — and again when a
 * page write or a write-up puts it behind (2026-09-30) — and served unchanged
 * to every session until the next render. That is a feature — cold start
 * costs one meta read — right up until the render itself changes: the identity
 * share merged mid-day on 2026-09-04 and could not reach a single session's wake
 * until the following boundary, and an owner who wanted their wake regenerated
 * had nothing to run. This is that lever.
 *
 * Three properties, all of them the console's usual ones:
 *
 *   - It goes through the SAME renderer the sleep step uses
 *     (`core/briefing.ts#selfRenderer`, via `Counterpart.rebrief`) — a console
 *     with a second renderer is a console that can publish a bundle the
 *     boundary would never have composed.
 *   - It refuses under observer via `OWNER_OPS`: republishing is a content
 *     write, and an instrument makes none.
 *   - It advances NO sleep marker and runs no other sleep phase. Decay,
 *     consolidation, dedup and prune stay the boundary's work.
 *
 * The ceiling is the host's, never this file's (scar §2.18): `--budget`, else
 * `injectionBudgetBytes` from the host config beside the store, else Claude
 * Code's default when that config is there without the key (2026-10-12), else
 * a refusal that names both.
 */
export function rebriefCommand(
  dir: string,
  io: Io,
  budgetFlag: string | boolean | undefined,
  now: () => number,
  home?: string,
  named?: ConfigChoice,
): number {
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const ceiling =
    home === undefined
      ? hostCeiling(dir, budgetFlag, homedir(), named)
      : hostCeiling(dir, budgetFlag, home, named);
  if ("refusal" in ceiling) {
    for (const line of ceiling.refusal.split("\n")) io.err(line);
    return EXIT.refused;
  }
  const counterpart = openCounterpart(dir);
  try {
    // The horizon lane asks about a calendar date; the console's own clock is
    // the only one in the room, and tests inject it.
    const at = localDate(now(), counterpart.store.zone());
    const report = counterpart.rebrief({ budgetBytes: ceiling.bytes, at });
    if (!report.rendered) {
      io.err(`refused: the render declined (${report.reason}).`);
      return EXIT.refused;
    }
    io.out(`Re-rendered the wake bundle for ${counterpart.store.dir}.`);
    io.out(`  lived day ${report.day}, horizon asked about ${at}`);
    // THE LINE THAT MAKES THE LOOKUP HONEST. It names the file, always — a
    // ceiling read out of a configuration the user never mentioned is a
    // surprise only while nobody says where it came from.
    io.out(
      ceiling.source === "--budget"
        ? `  budget ${ceiling.bytes} bytes from --budget`
        : `  budget ${ceiling.bytes} bytes from ${ceiling.source}${
            ceiling.namedBy === undefined ? "" : ` (named by ${ceiling.namedBy})`
          }`,
    );
    io.out(
      `  composed under ${report.composeBudget} — the delivery preface reserves ${PREFACE_RESERVE_BYTES}`,
    );
    io.out(`  lanes: ${LANE_ORDER.map((l) => `${l} ${report.counts[l] ?? 0}`).join("  ")}`);
    io.out(`  elements ${report.elements}, bytes ${report.bytes}`);
    io.out(
      report.published
        ? "  published — the next session wakes on this bundle."
        : "  NOT published: the store is in observer stance.",
    );
    io.out("  No sleep marker moved and no other sleep phase ran.");
    return EXIT.ok;
  } finally {
    counterpart.close();
  }
}

// ── scope ───────────────────────────────────────────────────────────────────

/**
 * `counterparts scope` — which directories this memory is for (owner asks
 * G42/G43, 2026-09-10).
 *
 * **It is a HOST-CONFIG write, not a store write**, and every rule below falls
 * out of that one sentence:
 *
 *   - it takes no `--dir` and opens no store, so it runs on a machine that has
 *     not installed one yet — which is exactly when somebody wants to say "not
 *     here";
 *   - it writes `<config dir>/scopes.json`, so `--config` (and
 *     `$COUNTERPARTS_CONFIG`) moves the registry with the configuration, and a
 *     scratch install's scopes are that install's own;
 *   - it is NOT on `OWNER_OPS`, because that list refuses a COMMAND whole and
 *     an instrument must still be able to READ this file — "why did this
 *     session record nothing" is a question a stood-down console has to be able
 *     to answer. The write half refuses in the same sentence an owner op does,
 *     one function down, beside the write it guards.
 *
 * **A relative path is never stored.** The registry is read by processes a host
 * launches from a working directory nobody chose (`config-path.ts`'s whole
 * argument about `--config`), so a relative key would name a different
 * directory in each of them. `.` is the ordinary way to say "here" and is
 * resolved before anything is written; the output always names the ABSOLUTE
 * path it wrote, so the resolution is never a silent one.
 *
 * **A registry it cannot parse is never overwritten.** `--force` is the way
 * through, and it prints what it could not read first: the alternative is a
 * console that quietly replaces a file somebody hand-edited.
 */
export function scopeCommand(
  parsed: Parsed,
  io: Io,
  observer: boolean,
  choice: ConfigChoice | undefined,
  now: () => number,
): number {
  const configPath = choice?.path ?? defaultConfigPath();
  const file = scopesPath(configPath);
  const flags = parsed.flags;
  const asked: { flag: string; mode: ScopeMode }[] = [
    { flag: "on", mode: "on" },
    { flag: "observer", mode: "observer" },
    { flag: "off", mode: "off" },
    { flag: "pause", mode: "paused" },
  ].filter((m) => flags[m.flag] === true) as { flag: string; mode: ScopeMode }[];
  const resuming = flags["resume"] === true;
  const listing = flags["list"] === true;

  if (asked.length + (resuming ? 1 : 0) > 1) {
    io.err(
      `refused: ${[...asked.map((a) => `--${a.flag}`), ...(resuming ? ["--resume"] : [])].join(" and ")} — a directory is in one mode at a time.`,
    );
    io.err("Nothing was written.");
    return EXIT.refused;
  }

  const read = readScopes(file);
  const unreadable = (): void => {
    io.err(`refused: ${file} could not be read — ${read.error ?? "unknown"}.`);
  };
  // THE ENTRIES THIS FILE HOLDS AND NOBODY CAN HONOUR (#92 review, F2). They are
  // named on every path through this command, read or write, because a refused
  // entry reads as unset — which is ON — and the person in front of this console
  // is the only one who can fix it.
  const sayRefused = (): void => {
    for (const entry of read.refused) {
      io.err(`  ignored: ${entry.key} — ${entry.detail}. It reads as unset, which is on.`);
    }
  };

  // ── --list: the whole registry, and the file it came from ─────────────────
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
      io.err(
        `warning: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in this file could not be read:`,
      );
      sayRefused();
    }
    const entries = Object.entries(read.registry?.scopes ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
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

  // ── no mode: what does this directory resolve to, and who said so ─────────
  if (asked.length === 0 && !resuming) {
    if (read.error !== null) {
      unreadable();
      io.err("Until it is fixed every directory reads as unset, which is on.");
      return EXIT.refused;
    }
    if (read.refused.length > 0) {
      io.err(
        `warning: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in ${file} could not be read:`,
      );
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
    io.out(
      verdict.matched === dir
        ? `  Decided by its own entry, set ${verdict.entry.since}.`
        : `  Decided by ${verdict.matched ?? "?"} (an ancestor), set ${verdict.entry.since}.`,
    );
    if (verdict.entry.mode === "paused") {
      io.out(`  --resume puts it back to ${resumeTarget(verdict.entry)}.`);
    }
    if (verdict.entry.note !== undefined) io.out(`  Note: ${verdict.entry.note}`);
    io.out(`  Registry: ${file}`);
    return EXIT.ok;
  }

  // ── the write half ────────────────────────────────────────────────────────
  if (observer) {
    // The same sentence an owner op gets, from the same reasoning: this console
    // is an instrument, and an instrument does not change what it is reading.
    // Note that on THIS command `--observer` is a mode and never a stance, so
    // the only thing that can have stood it down is `COUNTERPARTS_OBSERVER`.
    io.err(
      "refused: writing the scope registry changes this host's configuration, and this console is in observer stance. An instrument reads; it does not change the setting it is reading.",
    );
    return EXIT.refused;
  }
  if (read.error !== null && flags["force"] !== true) {
    unreadable();
    io.err("Nothing was written. Fix it by hand, or pass --force to replace it entirely.");
    return EXIT.refused;
  }
  // A WRITE WOULD DROP THE ENTRIES THIS READ REFUSED — every write rewrites the
  // whole file from what parsed — so it refuses instead, by name (#92 review,
  // F2). `--force` goes ahead and says which entries it is dropping: the good
  // ones are carried (they parsed), the named ones are gone.
  if (read.refused.length > 0) {
    if (flags["force"] !== true) {
      io.err(
        `refused: ${String(read.refused.length)} ${read.refused.length === 1 ? "entry" : "entries"} in ${file} could not be read, and writing would drop ${read.refused.length === 1 ? "it" : "them"}:`,
      );
      sayRefused();
      io.err("Nothing was written. Fix those by hand, or pass --force to drop them.");
      return EXIT.refused;
    }
    io.err(
      `warning: --force drops ${String(read.refused.length)} unreadable ${read.refused.length === 1 ? "entry" : "entries"}:`,
    );
    sayRefused();
  }
  // `--force` starts from EMPTY, not from a half-understood file: a registry
  // that did not parse has no entries this can honestly carry forward, and
  // silently keeping the ones that happened to be readable is the shape that
  // turns an `off` into an `on`.
  const base: ScopeRegistry | null = read.error === null ? read.registry : null;

  let mode: ScopeMode;
  if (resuming) {
    const own = ownEntry(base, dir);
    if (own === null) {
      const inherited = lookupScope(base, dir);
      io.err(
        inherited.entry === null
          ? `refused: nothing is set for ${dir}, so there is nothing to resume. It is already on.`
          : `refused: nothing is set for ${dir} itself — it inherits ${inherited.matched ?? "?"}. Resume that one, or set this one directly.`,
      );
      return EXIT.refused;
    }
    if (own.mode === "on" || own.mode === "observer") {
      io.out(`${dir} is already ${own.mode}; nothing to resume, and nothing was written.`);
      return EXIT.ok;
    }
    // `--resume` restores an `off` as well as a `paused`, which is the loop the
    // owner asked for: turn a directory off, work, turn it back on. An `off`
    // never recorded what to go back to, so it goes back to `on`.
    mode = resumeTarget(own);
  } else {
    mode = asked[0]?.mode ?? "on";
  }

  // ONE function for the change, used twice: once against the registry this
  // command read, and again — by `writeScopes` — against whatever is actually
  // on disk if somebody wrote between that read and the rename (#92 review, F3).
  // The other writer is the MCP `scope` tool, in the same directory, in another
  // process, and before this the second rename simply deleted the first entry.
  const apply = (from: ScopeRegistry | null): ScopeRegistry =>
    setScope(from, dir, mode, {
      at: new Date(now()).toISOString(),
      ...(typeof flags["note"] === "string" ? { note: flags["note"] } : {}),
    });
  const next = apply(base);
  writeScopes(file, next, {
    basedOn: read,
    // `--force` over a file nobody could read starts from empty either way:
    // there is nothing in it this can honestly carry forward.
    reapply: (fresh) => apply(read.error === null ? fresh : null),
  });

  io.out(`Scope set: ${dir} — ${mode}.`);
  if (canonicalScopePath(given) !== resolve(given) || given !== dir) {
    io.out(`  ('${given}' resolved to that path; the registry only ever holds absolute ones.)`);
  }
  io.out(`  ${scopeEffect(mode, ownEntry(next, dir)?.resumeTo)}`);
  io.out(`  Written to ${file}`);
  return EXIT.ok;
}

/** What the owner just chose, in one sentence, on the surface that chose it. */
function scopeEffect(mode: ScopeMode, resumeTo: string | undefined): string {
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

/**
 * WHERE THE CONSOLE LOOKS FOR THE HOST CONFIGURATION. One rule, and the only one.
 *
 * `injectionBudgetBytes` is a host capability, and the console has no host — so
 * a command that needs it (today: `rebrief`) has to read the file the host's own
 * adapter reads. That is a real thing the console does, and the documentation
 * said for a while that it did not; a bolded claim a stranger disproved with the
 * second command past the round trip (cold-stranger review, 2026-09-04, issue 3).
 * So it is stated once, here, and every page repeats this and nothing else:
 *
 *   1. `--budget <bytes>`, when given. Nothing is read at all.
 *   2. `<dir>/../claude-code.json` — BESIDE the store. This is the deployed
 *      layout: `~/.counterparts/claude-code.json` with the store at
 *      `~/.counterparts/store`, so for a default install (1) and (2) are the
 *      same file. For a `--dir` elsewhere it is the config that names THAT store.
 *   3. `~/.counterparts/claude-code.json` — the hooks' own hardcoded path, which
 *      is where `counterparts install` always writes, because `--dir` moves the
 *      store and never the configuration.
 *   4. One of those files there WITHOUT the key: Claude Code's default, the
 *      ceiling its hooks wake under (`config.ts#withBudgetDefault`, 2026-10-12).
 *      Only no file at all is a refusal.
 *
 * **Never `<dir>/claude-code.json`.** A file inside the data dir fails the layout
 * totality check (§5 G11) and the store stops opening; the `--help` said that
 * path for a while and it was never true.
 *
 * The caller PRINTS which of these answered, always — a number read out of a
 * file the user did not name is only a surprise while it is silent. `searched`
 * carries the paths so a refusal can name every place that was tried rather
 * than one of them.
 */
export interface CeilingFound {
  readonly bytes: number;
  /** `--budget`, or the absolute path of the file that answered. */
  readonly source: string;
  readonly searched: readonly string[];
  /** Set when a `--config` / `COUNTERPARTS_CONFIG` named the file that answered,
   *  so the printed line can say the number came from a file the caller chose. */
  readonly namedBy?: ConfigSource;
}

export interface CeilingMissing {
  readonly refusal: string;
  readonly searched: readonly string[];
}

export function hostCeiling(
  dir: string,
  flag: string | boolean | undefined,
  home = homedir(),
  /**
   * The configuration this invocation was TOLD to read, when it was told. A
   * named file replaces the two-step search entirely — a caller who said which
   * configuration to use did not ask for a fallback to another one, and falling
   * back would compose a briefing under a ceiling from a file they never named
   * (the same failure as the rest of this rule, one level up).
   */
  named?: ConfigChoice,
): CeilingFound | CeilingMissing {
  if (typeof flag === "string" && flag.length > 0) {
    const n = Number(flag);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        refusal: `refused: --budget takes a positive whole number of bytes, not '${flag}'.`,
        searched: [],
      };
    }
    return { bytes: n, source: "--budget", searched: [] };
  }
  const beside = join(dir, "..", "claude-code.json");
  const hooksConfig = defaultConfigPath(home);
  // De-duplicated, because on a default install these are the same file and a
  // refusal that named it twice would read as two separate misses.
  const searched =
    named !== undefined && named.source !== "default"
      ? [named.path]
      : beside === hooksConfig
        ? [beside]
        : [beside, hooksConfig];
  const namedBy = named !== undefined && named.source !== "default" ? named.source : undefined;
  // The first readable file with no key, for the default below.
  let keyless: string | undefined;
  for (const candidate of searched) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, unknown>;
      const value = parsed["injectionBudgetBytes"];
      if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return {
          bytes: value,
          source: candidate,
          searched,
          ...(namedBy === undefined ? {} : { namedBy }),
        };
      }
      if (value === undefined && keyless === undefined) keyless = candidate;
    } catch {
      /* an unreadable host config reports no ceiling — the refusal below says so */
    }
  }
  // A CLAUDE CODE CONFIGURATION THAT NAMES NO CEILING gets that host's default
  // (`config.ts#withBudgetDefault`, 2026-10-12), the one its hooks wake under:
  // the plugin's first run and every scripted install wrote no key before
  // 0.3.20, and a rebrief that refused them would leave those stores on the
  // bootstrap line. The printed source says the number was the default.
  if (keyless !== undefined) {
    return {
      bytes: CLAUDE_CODE_BUDGET_BYTES,
      source: `${keyless} (no injectionBudgetBytes there, so Claude Code's default)`,
      searched,
      ...(namedBy === undefined ? {} : { namedBy }),
    };
  }
  // Scar §2.18: the ceiling is a host capability. With no Claude Code
  // configuration found at all, there is no host to take one from.
  return {
    refusal: [
      'refused: no injection ceiling. Nothing set "injectionBudgetBytes" in either place',
      "this command looks, so there is no number to compose under, and a briefing never",
      "invents one (scar §2.18). Looked, in order:",
      ...searched.map((p) => `  ${p}${existsSync(p) ? "  (present, no injectionBudgetBytes)" : "  (absent)"}`),
      "Pass --budget <bytes>, or add the key to one of those files.",
    ].join("\n"),
    searched,
  };
}
