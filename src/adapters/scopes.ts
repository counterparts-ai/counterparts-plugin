/**
 * THE SCOPE REGISTRY — which directories this memory is for, and in what stance.
 *
 * **The ask (owner, 2026-09-10; `claude-code/INTERFACE-GAPS.md` host gaps 6–8).**
 * The hooks are registered globally, so a directory that has never heard of
 * Counterparts inherits capture, deposit and the wake the first time a session
 * opens in it. Until today the only way to say "not here" was a project
 * `.claude/settings.json` with an `env` block naming a second, observer-stanced
 * `claude-code.json` through `COUNTERPARTS_CONFIG` — a JSON file, a second
 * config file and two environment variables to say one word. Three private
 * directories run that way today and MUST KEEP RUNNING that way: nothing here
 * relaxes a stance, it only ever adds one.
 *
 * **Where it lives: beside the configuration, never inside the store.** A store
 * is memory; this is host state about which directories memory is for, and it
 * has to be readable by a process that has not opened a store yet — the hook
 * decides `off` BEFORE anything opens, which is what makes "no output, no
 * write" structural rather than promised. So the file sits next to
 * `claude-code.json`: under `COUNTERPARTS_CONFIG` or `--config`, beside THAT
 * file, so a scratch install's scopes are that install's own
 * (`scopesPath(choice.path)` at every entry point, and `config-path.ts` is
 * still the one rule for which config).
 *
 * **Longest prefix wins, and the match is segment-aware.** A subdirectory
 * inherits its nearest ancestor's entry, so a project turned off is off in
 * every worktree under it, and `/a/b` never matches `/a/bc` — the same class of
 * bug `assertSafeDataDir` resolves both sides to avoid. Both sides go through
 * `canonicalScope` (`sessions.ts`), which is where the `/tmp` vs `/private/tmp`
 * lesson on this host was already paid for.
 *
 * **Absent, unknown or UNREADABLE all mean `unset`, and `unset` means ON.**
 * That is a deliberate choice and the one the owner is asked to confirm: every
 * directory the parallel run touches is unset today, and a registry that
 * defaulted to observer would silently mute the live run on the day it shipped.
 * The fail direction for a CORRUPT file is the same "never fail the host" rule
 * the hooks live by (`claude-code/CONTRACT.md` §5 G2) — never a thrown hook —
 * and the console refuses to overwrite a file it could not parse without
 * `--force`, so the corruption is loud on the one surface that has a person in
 * front of it.
 *
 * **And because that fail direction is ON, a file in trouble is never SILENT**
 * (#92 review, F2). A bad entry is refused BY NAME rather than failing the whole
 * file — whole-file-fail turned every correctly typed `off` in the file on, to
 * protect the one that was typed badly — and `describeScopeTrouble` is the one
 * sentence the two processes with an operator print: the hook's stderr at
 * SessionStart and the server's at launch. The console prints the same facts its
 * own way, a line per entry, because it is talking to somebody who can fix them.
 * "`off` is silent" (§5 G19) and "a corrupt registry is silent" are different
 * exceptions, and only the first was ever ruled.
 *
 * **This module never throws at a reader.** `readScopes` returns a reading;
 * only `writeScopes`, which is a console command with an owner watching, is
 * allowed to fail out loud.
 */
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { defaultConfigPath } from "./config-path.js";
import { isPseudoScope } from "./hosts.js";

/**
 * `sessions.ts#canonicalScope`, extended by one step this rule needs and that
 * one does not.
 *
 * `canonicalScope` realpaths a path that EXISTS and falls back to `resolve`
 * otherwise, which is exactly right for comparing two directories a session is
 * actually running in. A PREFIX rule needs more: on this host a registry key
 * written from `/tmp/x` canonicalises to `/private/tmp/x`, while a query for a
 * subdirectory that does not exist yet stays `/tmp/x/sub` — and an ancestor
 * that governs the parent but not the child is the one answer a prefix rule may
 * never give. So the deepest EXISTING ancestor is realpathed and the rest is
 * appended, which makes both sides land in the same tree whether or not the
 * leaf has been created.
 */
export function canonicalScopePath(dir: string): string {
  // A PSEUDO-SCOPE (Claude Desktop's `claude-desktop:`) is a name: it is its own
  // key, governed only by an entry under that exact name — no directory is its
  // ancestor, because it is not a path (`hosts.ts#isPseudoScope`).
  if (isPseudoScope(dir)) return dir;
  const abs = resolve(dir);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return tail.length === 0 ? realpathSync(head) : join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      // The filesystem root did not resolve either: nothing here exists, so the
      // resolved path is the best canonical form available.
      if (parent === head) return abs;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/** The file's name. It sits BESIDE the configuration, never inside a store. */
export const SCOPES_FILE_NAME = "scopes.json";

/** The only shape this reads. A file that says anything else is unreadable. */
export const SCOPES_VERSION = 1;

/**
 * The RING event a hook leaves when the registry is there and unreadable —
 * ring-only, for the same reason `adapter.config.file` is: a new DURABLE event
 * name is a core change and this one is not worth one. An ABSENT file emits
 * nothing at all; absent is the ordinary state of every machine.
 */
export const SCOPE_UNREADABLE_EVENT = "adapter.scope.unreadable";

/** The ring event naming the verdict this process ran under. */
export const SCOPE_EVENT = "adapter.scope";

/**
 * THE RING EVENT A BOUNDARY LEAVES WHEN IT JOINED THE MEMORY LATE — a session
 * whose SessionStart ran OUTSIDE it (the directory was `off` or `paused` then,
 * and has been turned back on since), so there is no session record and no span
 * cursor, and the transcript it can see covers a stretch this memory was told
 * not to have. That boundary seals the stretch — cursor forward, nothing
 * deposited — and this is the record that it did. The DURABLE half rides the
 * boundary row's own `joinedLate` field, for the reason `adapter.scope.unreadable`
 * is ring-only: a new durable event NAME is a core change (`AdapterDurableEventName`).
 */
export const SCOPE_JOINED_LATE_EVENT = "adapter.scope.joined-late";

/**
 * The RING event naming the ENTRIES a read refused (#92 review, F2). Those
 * directories read as unset, which is ON — so this is the record that a setting
 * somebody wrote is not being kept. The durable half is the wake row's
 * `scopeRegistry` field, for the same reason the unreadable one is ring-only.
 */
export const SCOPE_REFUSED_EVENT = "adapter.scope.entries-refused";

/** Every mode a directory can be put in. */
export const SCOPE_MODES = ["on", "observer", "off", "paused"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

/** What `--resume` may restore to. A pause never resumes into `off`. */
export const RESUME_MODES = ["on", "observer"] as const;
export type ResumeMode = (typeof RESUME_MODES)[number];

/** A mode, or the absence of one. `unset` is not a mode; it is a question. */
export type EffectiveMode = ScopeMode | "unset";

/**
 * THE STANCE a scope resolves to — the vocabulary the adapters act on.
 * `paused` is `off` while it lasts; `unset` is `on` until somebody answers.
 */
export type ScopeStance = "on" | "observer" | "off";

/** Most restrictive last: the combination rule is a max over this order. */
const STANCE_ORDER: readonly ScopeStance[] = ["on", "observer", "off"];

export interface ScopeEntry {
  readonly mode: ScopeMode;
  /** Where `--resume` goes. Only meaningful on a `paused` entry. */
  readonly resumeTo?: ResumeMode;
  /** ISO timestamp of the decision. Written by whoever set it. */
  readonly since: string;
  /** Free text, the owner's own. Never read by anything that decides. */
  readonly note?: string;
}

export interface ScopeRegistry {
  readonly version: number;
  readonly scopes: Readonly<Record<string, ScopeEntry>>;
}

/** One entry the file held and this could not understand. Named, never guessed. */
export interface RefusedEntry {
  /** The key exactly as the file spelled it. */
  readonly key: string;
  /** Why it was refused, in one clause. */
  readonly detail: string;
}

/**
 * What a read of the file found. It NEVER throws; `error` carries the why.
 *
 * `raw` is the bytes exactly as they were — it is what makes a write a
 * compare-and-swap rather than a hope (`writeScopes`).
 */
export interface ScopeRead {
  /** The file's text as this read saw it; null when absent or unreadable. */
  readonly raw: string | null;
  /** Null when the file is absent, or present and unreadable. */
  readonly registry: ScopeRegistry | null;
  /** True when the file exists at all — absent and corrupt are different. */
  readonly present: boolean;
  /** One sentence, when a file that IS there could not be understood AS A FILE. */
  readonly error: string | null;
  /**
   * The ENTRIES this read refused, by name. The file parsed and the other
   * entries stand; these directories read as unset. Empty on a healthy file and
   * on a file-level `error`, where there are no entries to speak of.
   */
  readonly refused: readonly RefusedEntry[];
}

/** Which entry decided, and what it said. */
export interface ScopeVerdict {
  readonly mode: EffectiveMode;
  /** The registry key that matched — the ancestor, when it is one. */
  readonly matched: string | null;
  readonly entry: ScopeEntry | null;
}

/** `<config dir>/scopes.json` — beside the file `config-path.ts` resolved. */
export function scopesPath(configPath: string): string {
  return join(dirname(configPath), SCOPES_FILE_NAME);
}

/** An empty registry, for a machine that has never answered the question. */
export function emptyRegistry(): ScopeRegistry {
  return { version: SCOPES_VERSION, scopes: {} };
}

function isMode(value: unknown): value is ScopeMode {
  return typeof value === "string" && (SCOPE_MODES as readonly string[]).includes(value);
}

function isResumeMode(value: unknown): value is ResumeMode {
  return typeof value === "string" && (RESUME_MODES as readonly string[]).includes(value);
}

/**
 * Parse a registry, or say why not — PER ENTRY.
 *
 * **The rule changed on 2026-09-15 (#92 review, F2), and this is why.** A single
 * malformed entry used to fail the WHOLE FILE: the reasoning was that an `off`
 * somebody typed badly must not silently become an `on`. The review measured
 * what that actually did — one typo'd mode in one entry turned EVERY correctly
 * typed `off` in the file on, silently, because the hook's fail direction for an
 * unreadable file is `unset` (⇒ on) and has to be, since a hook may not fail the
 * host (§5 G2). Whole-file-fail did not protect the badly typed entry; it
 * sacrificed all the good ones to it.
 *
 * So: what parses, parses. What does not is REFUSED BY NAME — that directory
 * reads as unset and the name goes out on every surface that has somebody in
 * front of it (the hook's one stderr line at SessionStart, the console, the MCP
 * tool's refusal to write). A file that is not a registry AT ALL — not JSON, not
 * an object, an unknown `version`, a `scopes` that is not an object — is still a
 * whole-file failure, because there are no entries in it to honour.
 */
export function parseRegistry(raw: unknown): {
  registry: ScopeRegistry | null;
  error: string | null;
  refused: RefusedEntry[];
} {
  const whole = (error: string): { registry: null; error: string; refused: RefusedEntry[] } => ({
    registry: null,
    error,
    refused: [],
  });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return whole("the file is not a JSON object");
  }
  const rec = raw as Record<string, unknown>;
  if (rec["version"] !== SCOPES_VERSION) {
    return whole(
      `"version" is ${JSON.stringify(rec["version"])}, and this reads version ${String(SCOPES_VERSION)}`,
    );
  }
  const scopesRaw = rec["scopes"];
  if (scopesRaw === undefined) return { registry: emptyRegistry(), error: null, refused: [] };
  if (scopesRaw === null || typeof scopesRaw !== "object" || Array.isArray(scopesRaw)) {
    return whole('"scopes" is not an object');
  }
  const scopes: Record<string, ScopeEntry> = {};
  const refused: RefusedEntry[] = [];
  const refuse = (key: string, detail: string): void => {
    refused.push({ key, detail });
  };
  for (const [path, value] of Object.entries(scopesRaw as Record<string, unknown>)) {
    // An absolute path, or a pseudo-scope (Claude Desktop's `claude-desktop:`,
    // which its `scope` tool writes under that name).
    if (!path.startsWith("/") && !isPseudoScope(path)) {
      refuse(path, "the key is not an absolute path");
      continue;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      refuse(path, "the entry is not an object");
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (!isMode(entry["mode"])) {
      refuse(
        path,
        `mode ${JSON.stringify(entry["mode"])}; it takes ${SCOPE_MODES.join(", ")}`,
      );
      continue;
    }
    const since = entry["since"];
    if (typeof since !== "string" || since.length === 0) {
      refuse(path, 'no "since"');
      continue;
    }
    const resumeTo = entry["resumeTo"];
    if (resumeTo !== undefined && !isResumeMode(resumeTo)) {
      refuse(
        path,
        `resumeTo ${JSON.stringify(resumeTo)}; it takes ${RESUME_MODES.join(", ")}`,
      );
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
      ...(resumeTo === undefined ? {} : { resumeTo }),
      ...(note === undefined ? {} : { note }),
    };
  }
  return { registry: { version: SCOPES_VERSION, scopes }, error: null, refused };
}

/**
 * Read the registry at `path`. Absent is ordinary and silent; present and
 * unreadable carries a sentence. Never throws.
 */
export function readScopes(
  path: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
): ScopeRead {
  let text: string;
  try {
    text = read(path);
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "UNREADABLE";
    // ENOENT is the ordinary state of every machine that has never answered the
    // question. Anything else — a permission bit, a directory where a file
    // should be — is a file that IS there and could not be read.
    if (code === "ENOENT") {
      return { registry: null, present: false, error: null, refused: [], raw: null };
    }
    return {
      registry: null,
      present: true,
      error: `it could not be read (${code})`,
      refused: [],
      raw: null,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      registry: null,
      present: true,
      error: `it is not JSON (${err instanceof Error ? err.message : String(err)})`,
      refused: [],
      raw: text,
    };
  }
  const parsed = parseRegistry(raw);
  return {
    registry: parsed.registry,
    present: true,
    error: parsed.error,
    refused: parsed.refused,
    raw: text,
  };
}

/**
 * THE ONE SENTENCE a registry in trouble gets, wherever there is somebody to
 * read it — the hook's stderr at SessionStart, the console, the server's launch
 * line. Null when the file is healthy or simply absent.
 *
 * It exists because `off` being silent (CONTRACT §5 G19) and a CORRUPT REGISTRY
 * being silent are different exceptions, and only the first one was ever ruled.
 * A directory the owner set `off` that quietly comes back ON because the file
 * beside it grew a typo is the failure scar §2.4 is about: the absence of the
 * stand-down and the absence of a working registry looked identical.
 */
export function describeScopeTrouble(read: ScopeRead, path: string): string | null {
  if (read.error !== null) {
    return `[counterparts] scope registry ${path} could not be read — ${read.error}. Every directory reads as unset (on) until it is fixed.`;
  }
  if (read.refused.length === 0) return null;
  const one = read.refused.length === 1;
  const list = read.refused.map((r) => `${r.key} (${r.detail})`).join("; ");
  return (
    `[counterparts] scope registry ${path}: ${String(read.refused.length)} ${one ? "entry" : "entries"} ` +
    `could not be read and ${one ? "is" : "are"} IGNORED — ${list}. ` +
    `${one ? "That directory reads" : "Those directories read"} as unset (on); every other entry stands.`
  );
}

/** How restrictive a mode is, on the same order the combination rule uses.
 *  `paused` and `off` are one rank: they differ in what `--resume` restores,
 *  not in what a session may do. */
function restrictionOf(mode: ScopeMode): number {
  return rankOf(mode);
}

/** Is `dir` at or under `key`? Segment-aware: `/a/b` never matches `/a/bc`. */
function under(key: string, dir: string): boolean {
  if (key === dir) return true;
  const base = key.endsWith(sep) ? key : `${key}${sep}`;
  return dir.startsWith(base);
}

/**
 * Which entry governs `dir` — the LONGEST matching ancestor, or `unset`.
 *
 * Both sides go through `canonicalScopePath`, so a registry written from
 * `/tmp/x` still governs a hook whose cwd arrives as `/private/tmp/x`, and a
 * subdirectory that does not exist yet still inherits its ancestor. Specificity
 * is measured on the canonical key, which is the only form the comparison saw.
 */
export function lookupScope(registry: ScopeRegistry | null, dir: string): ScopeVerdict {
  if (registry === null) return { mode: "unset", matched: null, entry: null };
  const target = canonicalScopePath(dir);
  let best: { key: string; canonical: string; entry: ScopeEntry } | null = null;
  for (const [key, entry] of Object.entries(registry.scopes)) {
    const canonical = canonicalScopePath(key);
    if (!under(canonical, target)) continue;
    if (best === null || canonical.length > best.canonical.length) {
      best = { key, canonical, entry };
      continue;
    }
    // THE TIE, AND WHY IT IS RESOLVED TOWARDS RESTRICTION (#92 review, F4).
    // Equal length here means the same canonical string — both are prefixes of
    // one target — so a tie is two KEYS for one directory, e.g. a hand-edited
    // `/tmp/x` beside a written `/private/tmp/x`, or `…/proj` beside `…/proj/.`.
    // `setScope` replaces every such key, so this only happens on a file a
    // person edited; deciding it by iteration order meant an `off` and an `on`
    // for one directory resolved by whichever JSON key happened to come first.
    // The safe half of an ambiguity is the more restrictive one.
    if (canonical !== best.canonical) continue;
    if (restrictionOf(entry.mode) > restrictionOf(best.entry.mode)) best = { key, canonical, entry };
  }
  if (best === null) return { mode: "unset", matched: null, entry: null };
  return { mode: best.entry.mode, matched: best.key, entry: best.entry };
}

/**
 * The stance a mode resolves to. `unset` is ON — today's behaviour, and the
 * choice this whole file asks the owner to confirm. `paused` is OFF while it
 * lasts; the difference between them is what `--resume` restores, not what a
 * session may do.
 */
export function stanceOfMode(mode: EffectiveMode): ScopeStance {
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

/**
 * THE SECOND COMBINATION RULE: the most restrictive of TWO VERDICTS, when one
 * event has two directories to answer for.
 *
 * A session has a stable scope — the directory it started in, which is where
 * everything it captures is filed (`claude-code/bin/hook.ts#sessionScope`) — and
 * an event has a current one, which follows the agent's shell into a worktree or
 * anywhere else it is told to go. Filing follows the first. PRIVACY MUST FOLLOW
 * BOTH: a session that starts in a directory the owner said yes to and then
 * walks into one he said `off` to has to go as quiet as the directory it walked
 * into, or the stable scope would become a way to carry capture past an opt-out.
 *
 * So the two are looked up separately and the safe half wins, on the same order
 * `effectiveStance` uses. `primary` is the SESSION's verdict and wins every tie,
 * because a tie is two directories of equal stance and the session's own is the
 * one whose entry should be named in the record — and the one the first-launch
 * question (`unset`) is about.
 */
export function mostRestrictiveVerdict(primary: ScopeVerdict, other: ScopeVerdict): ScopeVerdict {
  return rankOf(other.mode) > rankOf(primary.mode) ? other : primary;
}

/** How restrictive an effective mode is, on the one order every rule here uses. */
function rankOf(mode: EffectiveMode): number {
  return STANCE_ORDER.indexOf(stanceOfMode(mode));
}

/**
 * THE COMBINATION RULE: the MOST RESTRICTIVE of the stance the configuration
 * and the environment already produced, and the one the registry names.
 *
 * It only ever adds restriction. The three private directories running under
 * `COUNTERPARTS_CONFIG` + `COUNTERPARTS_OBSERVER` today have no registry entry
 * at all, so they combine `observer` with `unset` and stay exactly observer —
 * which is the one property this feature was not allowed to break.
 */
export function effectiveStance(configObserver: boolean, mode: EffectiveMode): ScopeStance {
  const fromConfig: ScopeStance = configObserver ? "observer" : "on";
  const fromScope = stanceOfMode(mode);
  return STANCE_ORDER.indexOf(fromConfig) >= STANCE_ORDER.indexOf(fromScope)
    ? fromConfig
    : fromScope;
}

/**
 * THIS directory's OWN entry — never an ancestor's, and found by canonical
 * path rather than by string key, so a hand-edited `/tmp/x` is the same entry
 * as a written `/private/tmp/x`.
 *
 * It is separate from `lookupScope` because the two answer different questions:
 * "what governs here" inherits, and "what did somebody set HERE" must not —
 * `--resume` on a directory that merely inherits an ancestor's pause would
 * quietly create a new entry and leave the ancestor paused.
 */
export function ownEntry(registry: ScopeRegistry | null, dir: string): ScopeEntry | null {
  if (registry === null) return null;
  const key = canonicalScopePath(dir);
  for (const [existing, entry] of Object.entries(registry.scopes)) {
    if (canonicalScopePath(existing) === key) return entry;
  }
  return null;
}

/** Where `--resume` puts this entry. A pause with no memory resumes to `on`. */
export function resumeTarget(entry: ScopeEntry | null): ResumeMode {
  return entry?.resumeTo ?? "on";
}

/**
 * Set one directory's entry. PURE — it returns the registry to write, so the
 * caller decides when a file changes and nothing here can half-write one.
 *
 * `--pause` remembers what it interrupted (`resumeTo`), which is the whole
 * difference between pausing and turning off: an afternoon that is not recorded
 * does not change what the directory thinks it is.
 */
export function setScope(
  registry: ScopeRegistry | null,
  dir: string,
  mode: ScopeMode,
  opts: { at: string; note?: string; resumeTo?: ResumeMode },
): ScopeRegistry {
  const base = registry ?? emptyRegistry();
  const key = canonicalScopePath(dir);
  const prior = ownEntry(base, dir) ?? undefined;
  const resumeTo =
    opts.resumeTo ??
    (mode === "paused"
      ? prior !== undefined && (prior.mode === "on" || prior.mode === "observer")
        ? prior.mode
        : resumeTarget(prior ?? null)
      : undefined);
  const entry: ScopeEntry = {
    mode,
    since: opts.at,
    ...(resumeTo === undefined ? {} : { resumeTo }),
    // A note is REPLACED when one is given and CARRIED when one is not: the
    // reason a directory is off outlives the flag that paused it.
    ...(opts.note !== undefined
      ? opts.note.length === 0
        ? {}
        : { note: opts.note }
      : prior?.note === undefined
        ? {}
        : { note: prior.note }),
  };
  // EVERY key that names this directory is replaced, not just the canonical
  // spelling. A registry may have been hand-edited with `/tmp/x` where this
  // writes `/private/tmp/x`; leaving the old one behind would put two entries
  // for one directory in the file, and `lookupScope` would go on honouring
  // whichever of them happened to sort first — a setting that appears to change
  // and does not.
  const scopes: Record<string, ScopeEntry> = {};
  for (const [existing, value] of Object.entries(base.scopes)) {
    if (canonicalScopePath(existing) === key) continue;
    scopes[existing] = value;
  }
  scopes[key] = entry;
  return { version: SCOPES_VERSION, scopes };
}

/**
 * Write the registry: temp file beside the target, then `rename` — the same
 * shape `sessions.ts` uses, and for the same reason (a reader never sees half a
 * file, and same directory means same filesystem means the rename is a rename).
 *
 * It is a COMPARE-AND-SWAP when the caller hands it the read it worked from:
 * the file is re-read immediately before the rename, and a file that changed
 * since sends the caller's change through `reapply` against the new content
 * rather than overwriting it. Two writers exist — the console `scope` command
 * and the MCP `scope` tool — and before this the second one to rename simply
 * deleted the first one's entry (#92 review, F3).
 *
 * This one MAY throw: its only caller is a console command with an owner
 * watching, and a write that failed silently is the failure this whole package
 * keeps recording.
 */
export function writeScopes(
  path: string,
  registry: ScopeRegistry,
  /**
   * THE COMPARE-AND-SWAP, when the caller can supply one (#92 review, F3).
   *
   * `basedOn` is the read this registry was computed from; `reapply` says how to
   * compute it again against whatever is there now. Omit them and this is the
   * plain overwrite it always was — which is right for `--force`, whose whole
   * job is to replace a file nobody could read, and wrong for everything else:
   * a caller that READ this file before computing `registry` owes the CAS, or it
   * is the lost update again under a new name.
   */
  cas?: {
    readonly basedOn: ScopeRead;
    readonly reapply: (fresh: ScopeRegistry | null) => ScopeRegistry;
  },
): void {
  mkdirSync(dirname(path), { recursive: true });
  const write = (next: ScopeRegistry, expect: string | null | undefined): boolean => {
    const tmp = `${path}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    // THE CHECK, as late as it can be: immediately before the rename, so the
    // window a change can hide in is the syscall itself rather than everything
    // the caller did between its read and this call.
    if (expect !== undefined && rawScopes(path) !== expect) {
      try {
        unlinkSync(tmp);
      } catch {
        /* a temp file that is already gone is the outcome we wanted */
      }
      return false;
    }
    renameSync(tmp, path);
    return true;
  };
  if (cas === undefined) {
    write(registry, undefined);
    return;
  }
  if (write(registry, cas.basedOn.raw)) return;
  // Somebody wrote between the caller's read and now. Their entry is IN the file
  // and this registry does not have it — writing it would delete their change,
  // which is exactly the lost update the review measured (two `scope` writers,
  // one absent file, one surviving entry). So the caller's change is re-applied
  // to what is actually there, and written once more. Once: a second loser is a
  // third writer, and a console command that spun would be worse than a console
  // command that reports.
  write(cas.reapply(readScopes(path).registry), undefined);
}

/** The file's bytes exactly as they are, or null — the CAS comparand. */
function rawScopes(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// ── the console line that changes a folder's setting, as text names it ──────

/**
 * WHAT A PRINTED `counterparts scope` LINE NEEDS TO WORK WHEREVER IT IS TYPED
 * (#362, and the follow-up of 2026-10-10 that gave the MCP refusals and the
 * first-launch question the same line). Each field is a way the line failed:
 *
 *   - `home`, to write a folder as `~/…` when that needs no quoting;
 *   - `pluginRoot`: a plugin install puts no `counterparts` on PATH
 *     (`commands/doctor.md`), so under the plugin the line is the plugin's own
 *     launcher. Null for the npm install;
 *   - `configPath`: `counterparts scope` writes the `scopes.json` beside the
 *     configuration IT resolves, so a process that read another registry
 *     (`--config`, `COUNTERPARTS_CONFIG`) names its configuration, or the line
 *     changes the default registry, or refuses, and the folder stays as it
 *     was. Null when the registry is the default's.
 */
export interface ScopeCommandContext {
  readonly home: string;
  readonly pluginRoot: string | null;
  readonly configPath: string | null;
}

/**
 * The context for a process that read `configPath`, which is kept only when its
 * registry is not the one beside `defaultConfigPath(home)`. The caller says
 * whether it is the plugin's (`plugin.ts#runningAsPlugin`), so this module
 * reads no environment. Pure.
 */
export function scopeCommandContext(input: {
  readonly configPath: string | undefined;
  readonly pluginRoot: string | null;
  readonly home: string;
}): ScopeCommandContext {
  const given = input.configPath ?? "";
  const named = given.length === 0 || scopesPath(given) === scopesPath(defaultConfigPath(input.home)) ? null : given;
  const root = (input.pluginRoot ?? "").trim();
  return { home: input.home, pluginRoot: root.length === 0 ? null : root, configPath: named };
}

/**
 * The console line that sets `folder` with `flag` (`--resume`, `--on`, …),
 * ready to print between backticks. The folder is always NAMED, never `.`:
 * `.` is wherever the line is typed — another terminal, or a shell that moved
 * — and from a subfolder of the entry that paused it `--resume` is refused. So
 * the caller passes the folder the line is for: the entry that decided
 * (`ScopeVerdict.matched`), or the folder itself. `--config <path>` is two
 * words, so an unquoted `~/…` expands (`--config=~/…` would not). Pure.
 */
export function scopeCommand(folder: string, flag: string, ctx: ScopeCommandContext): string {
  const target = shellWord(canonicalScopePath(folder), ctx.home);
  const config = ctx.configPath === null ? "" : ` --config ${shellWord(ctx.configPath, ctx.home)}`;
  return ctx.pluginRoot === null
    ? `counterparts scope ${target} ${flag}${config}`
    : `sh ${shellWord(join(ctx.pluginRoot, "src", "adapters", "plugin-run.sh"), ctx.home)} cli scope ${target} ${flag}${config}`;
}

/** `path` with the home directory as `~`, for reading. Both spellings of home
 *  are tried, since `path` often arrives canonical (realpathed). */
export function shortPath(path: string, home: string): string {
  for (const h of new Set([resolve(home), canonicalScopePath(home)])) {
    if (path === h) return "~";
    if (path.startsWith(`${h}/`)) return `~${path.slice(h.length)}`;
  }
  return path;
}

/** `path` as one shell word: `~/…` when that needs no quoting (a quoted `~`
 *  does not expand), else the absolute path, single-quoted only if it must be. */
export function shellWord(path: string, home: string): string {
  const plain = /^[A-Za-z0-9_./@%+=:,-]+$/;
  const short = shortPath(path, home);
  if (short !== path && (short === "~" || plain.test(short.slice(1)))) return short;
  if (plain.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}
