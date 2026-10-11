/**
 * The handle-resolution log — what a deliberate expansion BY HANDLE actually
 * reached, left where the credit pass can read it.
 *
 * **The gap it closes (LAUNCH-STATUS G50).** `recall/reference.ts` credits an
 * expansion from the recall tool call's own input, and it resolves NOTHING: an
 * `ids`/`handle` value that is not literally a `mem_…` address is counted
 * `unresolvedHandles` and credits nothing. But `mcp/tools.ts` documents `handle`
 * as "a memory id or exact handle", and `mcp/deliberate.ts#expandHandle` answers
 * a TITLE with the whole body. So the most deliberate thing a session can do —
 * name a memory and read it — earned no credit at all. Under-credit, and
 * invisible: the boundary row said `expanded: 0, unresolvedHandles: 1`.
 *
 * **Why a log and not a session field.** There is no per-session "expanded ids"
 * state the credit pass reads; `lifecycle.ts#creditAtBoundary` takes its
 * expansions from the TRANSCRIPT (`transcript.ts#expansionIdsOf`) and slices
 * them by the same turn cursor capture uses. That is the thing to preserve: the
 * transcript already decides WHICH handles this session used and WHEN. This file
 * supplies only the translation — what the tool resolved that handle to.
 *
 * **That is not the same as "credit is not widened", which is what the first two
 * commits of this leaf claimed.** The transcript says which handle and when; it
 * cannot say whose ANSWER resolved it, and this table is shared. So the honest
 * statement is narrower: the boundary credits a memory only for a handle THIS
 * session's transcript carries, translated through an answer given in THIS
 * PROJECT (`readHandleResolutions`'s scope filter) and no earlier than THIS
 * SESSION's own start (its `since` floor). What remains is stated where the
 * filters are: two sessions running at once in one project directory share one
 * table.
 *
 * A list of ids keyed by session would fail twice over: this host launches the MCP
 * server from a static config, so it is usually UNBOUND and has no session id to
 * key by (mcp/INTERFACE-GAPS §6, §8), and a flat list cannot be positioned
 * against the turn cursor, so an expansion from turn 3 would be re-credited at
 * every later boundary.
 *
 * **Neither adapter imports the other.** The MCP tool writes, the host
 * lifecycle's boundary reads (`lifecycle.ts`, driven by the Claude Code hook),
 * and they meet here — the same shape, and for the same reason, as
 * `adapters/sessions.ts` (mcp/INTERFACE-GAPS §7: adapters are leaves, a shared
 * sibling is what that rule allows).
 *
 * **Host state, not memory, and it says so on disk.** The record is a HASH of
 * the handle, the id it reached (or `null` — see `HandleResolution.id`), a
 * timestamp, and the scope that asked —
 * deliberately no handle text, because a handle IS a memory's title and
 * `store/paths.ts` classifies `sessions/` as carrying no content (`backup:
 * false`). Hashing is what keeps that classification true without editing it.
 *
 * **And the hash is SALTED, per store** (G58, review of #112). An unsalted
 * sha256 prefix is not the absence of content, it is a MEMBERSHIP ORACLE: a
 * title is short and guessable, so anyone holding the file can hash a candidate
 * and learn whether this memory has been asked for by that name — the exact
 * thing the no-content classification promises the file cannot tell. One random
 * per-store value, written once beside the log, turns the oracle back into what
 * the classification already claims: a key that means nothing outside the store
 * that made it. See `expansionSalt`.
 *
 * **A LOST WRITE IS NOT ALWAYS THE SAFE DIRECTION, and saying it was is what the
 * first draft got wrong.** Losing a RESOLUTION costs one handle's credit —
 * under-credit, the direction this repo errs in on purpose. Losing a REFUSAL is
 * the opposite: the shadow that should have overridden an earlier resolution
 * never lands, and the next asking of that handle is translated through an
 * answer it was never given. So the whole file being lost is under-credit only
 * because the resolutions go with the refusals; a file that can be READ but not
 * APPENDED to is the dangerous shape, and it is one of the three in
 * `readHandleResolutions`'s list. That is why the scope filter, and not the
 * shadow, is the confidentiality boundary here: across projects a lost refusal
 * cannot reach another project's boundary at all. Within ONE project directory
 * it still can, and that residual is recorded rather than papered over.
 *
 * Three rules, mechanized below, inherited from `sessions.ts`:
 *
 *   1. **Nothing here ever throws at a caller.** A tool may not fail on host
 *      bookkeeping and a hook may not fail the host. Every entry point returns
 *      a falsy answer instead.
 *   2. **Appends are appends.** One line per resolution, `O_APPEND`, so two
 *      servers writing at once interleave lines rather than clobbering a file.
 *   3. **Compaction is atomic** — temp file beside the target, then `rename`,
 *      so a reader never sees half a log.
 */
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SESSIONS_DIR, canonicalScope } from "./sessions.js";

/** One file, inside the registry's directory — see the header on placement. */
export const EXPANSIONS_FILE = "expansions.jsonl";

/**
 * **CAL.** How long a resolution may still translate a handle.
 *
 * It only has to outlive the gap between a `recall` call and the boundary that
 * judges it, and a boundary fires at every Stop. A day is generous by orders of
 * magnitude and still short enough that a renamed memory cannot be credited
 * under last week's title.
 */
export const EXPANSION_TTL_MS = 24 * 60 * 60 * 1000;

/** **CAL.** Compact when the file passes this. ~90 bytes a line, so ~700 lines. */
export const EXPANSIONS_MAX_BYTES = 64 * 1024;

/**
 * **CAL.** How many live resolutions a compaction keeps.
 *
 * "Newest" means newest by `at`, and that is a correction: it used to mean
 * newest by position in the file, which is not the same thing once a handle is
 * re-resolved. `compactExpansions` sorts before it slices. READING is still
 * arrival order — `readHandleResolutions` takes the LAST line for a key, which
 * is how a shadow appended a moment ago overrides the resolution above it, and
 * why the lines `compactExpansions` splices back in go after the sorted block.
 */
export const EXPANSIONS_KEEP = 256;

export interface HandleResolution {
  /** `handleKey` of the handle the model passed. Never the handle itself. */
  readonly key: string;
  /**
   * The id `expandHandle` actually reached — or NULL, which is a SHADOW: this
   * handle was asked and answered with nothing, and the newest answer wins.
   *
   * The shadow is not bookkeeping. The log is keyed by handle, not by session,
   * because the resolution is deterministic — but a refusal is not: the owner's
   * own session resolves a confidential title and a stranger's session is told
   * nothing, and without a shadow the stranger's boundary would translate the
   * same handle through the owner's entry and credit a memory it was never
   * shown. Same shape for a title that has since gone ambiguous, or been renamed
   * away.
   *
   * It is NOT the confidentiality boundary, though the first draft said so: a
   * shadow only exists where an answer was given, and three askings get none.
   * `readHandleResolutions`'s scope filter is what covers those.
   */
  readonly id: string | null;
  readonly at: number;
  /**
   * The project the resolving server was serving, canonical. It IS a filter —
   * see `readHandleResolutions` — and it is the only thing on a record that can
   * say whose asking this answer belongs to. A record without one cannot pass
   * the filter at all.
   */
  readonly scope?: string;
}

export function expansionsPath(dataDir: string): string {
  return join(dataDir, SESSIONS_DIR, EXPANSIONS_FILE);
}

/** The salt file, beside the log — see `expansionSalt`. */
export const EXPANSIONS_SALT_FILE = "expansions.salt";

/** 16 random bytes, hex. Long enough that guessing it is not the cheap attack. */
const SALT_BYTES = 16;

export function expansionsSaltPath(dataDir: string): string {
  return join(dataDir, SESSIONS_DIR, EXPANSIONS_SALT_FILE);
}

/**
 * The store's own handle salt — read if it is there, minted once if it is not.
 *
 * **Per STORE, not per process and not per project.** Both sides of this seam
 * must derive the same key from the same handle, and they are two processes
 * that share nothing but the data directory: the MCP server writes a record and
 * the Stop hook, minutes later, looks one up. So the salt lives on disk beside
 * the log it keys, inside the directory `store/paths.ts` already classifies as
 * host state, and it moves with the store the way the log does.
 *
 * **`wx`, and a re-read after it.** Two servers can reach this at once on a
 * store nobody has expanded a handle in yet; exclusive-create means exactly one
 * of them writes, and the loser reads what the winner wrote instead of racing a
 * second salt over the first. A salt that changed under a live log would orphan
 * every key already in it.
 *
 * **Null is the honest answer, and the callers fail closed on it.** A salt this
 * process cannot read or create is not a reason to fall back to the unsalted
 * key: an unsalted key written into a salted log is both a leak and a record
 * nothing will ever match. `recordHandleResolution` returns false, and
 * `readHandleResolutions` answers `unreadable` — the same shape, and the same
 * reason, as a log this process cannot open.
 */
export function expansionSalt(dataDir: string): string | null {
  const path = expansionsSaltPath(dataDir);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let salt: string | null = null;
    try {
      salt = readFileSync(path, "utf8").trim();
    } catch {
      /* Not there yet on the first pass — minted below. On the second pass this
         is a file that exists and cannot be read, and there is nothing else to
         try. */
    }
    if (salt !== null) return salt.length === SALT_BYTES * 2 ? salt : null;
    if (attempt === 1) return null;
    try {
      mkdirSync(join(dataDir, SESSIONS_DIR), { recursive: true });
      writeFileSync(path, `${randomBytes(SALT_BYTES).toString("hex")}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    } catch {
      /* EEXIST (another process won the race) or a directory this cannot write:
         either way the re-read is what decides. */
    }
  }
  return null;
}

/**
 * The lookup key: the handle, trimmed and case-folded, SALTED and hashed.
 *
 * Trim-and-fold is not a normalization of this module's invention — it is
 * EXACTLY the comparison `mcp/deliberate.ts#expandHandle` makes against a title
 * (`title.trim().toLowerCase() === handle.toLowerCase()`, on a handle the
 * dispatcher already trimmed). Two spellings that the resolver treats as the
 * same handle must land on the same key, or the translation misses the case the
 * session actually used.
 */
export function handleKey(handle: string, salt: string): string {
  // The separator is what stops `salt + handle` from being ambiguous: without
  // it a salt one character longer and a handle one shorter collide.
  return createHash("sha256")
    .update(salt)
    .update("\u0000")
    .update(handle.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/**
 * Record what a handle resolved to — an id, or `null` for "this handle was
 * asked and answered with nothing". Returns false on any failure at all.
 *
 * EVERY handle-path outcome is recorded, not only the expansions. A refusal
 * that left no trace would let an earlier session's resolution translate a
 * later session's identical handle, and the later session may have been refused
 * for a reason the earlier one was not — confidentiality above all. Writing the
 * refusal as a shadow is what keeps the log's key (the handle) honest about the
 * thing it is standing in for (what THIS asking reached).
 */
export function recordHandleResolution(
  dataDir: string,
  input: { handle: string; id: string | null; scope?: string; at?: number },
): boolean {
  const handle = input.handle.trim();
  if (handle.length === 0) return false;
  if (input.id !== null && input.id.length === 0) return false;
  // FAIL CLOSED (G58): no salt, no record. An unsalted key in a salted log is a
  // leak AND a line nothing will ever match; a missing line costs one handle's
  // credit, which is the direction this module errs in.
  const salt = expansionSalt(dataDir);
  if (salt === null) return false;
  const record: HandleResolution = {
    key: handleKey(handle, salt),
    id: input.id,
    at: input.at ?? Date.now(),
    ...(input.scope === undefined || input.scope.length === 0 ? {} : { scope: canonicalScope(input.scope) }),
  };
  const path = expansionsPath(dataDir);
  try {
    mkdirSync(join(dataDir, SESSIONS_DIR), { recursive: true });
    const line = `${JSON.stringify(record)}\n`;
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      /* no file yet */
    }
    if (size + line.length > EXPANSIONS_MAX_BYTES) compactExpansions(path, record.at);
    appendFileSync(path, line, { encoding: "utf8", mode: 0o600 });
  } catch {
    return false;
  }
  return true;
}

/**
 * Every live answer as `key → id | null`, the LAST line for a key winning — the
 * file's own arrival order, which is what makes a shadow appended a moment ago
 * override the resolution above it. (`compactExpansions` sorts by `at` when it
 * decides what to KEEP; that is a different question from what wins.) A `null`
 * value is a shadow and translates nothing (see `HandleResolution.id`).
 *
 * **FILTERED BY SCOPE when `opts.scope` is given, and the caller that credits
 * always gives it.** The first draft of this module refused to filter, reasoning
 * that a RESOLUTION is deterministic — one store, one exact-title match — so it
 * could not matter which project's server performed it, and that the refusals
 * were covered by the shadow. That reasoning has a hole, and it is the one this
 * whole leaf exists to close. The log records the last answer ANYONE got, so a
 * session that got no answer at all still reads someone else's, and there are
 * three routes to that which leave no shadow behind them:
 *
 *   - the tool call never reached `expandHandle` (the server was down, or threw
 *     before the resolver ran) — nothing is refused, so nothing is recorded;
 *   - the call was `recall { handle, question }`, which the dispatcher refuses
 *     as `both-arguments` on path `none`, before the handle path exists;
 *   - the call WAS refused `handle-confidential-withheld`, and the shadow could
 *     not be written (a read-only log, a full disk) — `recordHandleResolution`
 *     returns false, because it may not throw at a tool.
 *
 * In each of those the transcript still carries the title, so the boundary still
 * translates it — through the only line in the log, which may be the owner's
 * resolution of a CONFIDENTIAL memory. The shadow cannot cover a case in which
 * nothing was written.
 *
 * The scope is the discriminator that covers all three at once, and it is the
 * same one the server already trusts for session binding (`sessions.ts#sameScope`
 * at `server.ts#requireBoundSession`): a comparison the two adapters disagree
 * about costs a translation, which is under-credit, the safe direction. A record
 * with no scope at all is dropped for the same reason — a line that cannot say
 * where it came from cannot be matched to where this is.
 *
 * Filtering also removes the opposite race the first draft accepted: a
 * stranger's refusal landing between the owner's call and the owner's Stop cost
 * the owner that credit. The stranger's shadow now carries the stranger's scope,
 * so it never reaches the owner's boundary.
 *
 * **`opts.since` is the other half: the asking session's own start.** A project
 * is a place, not a conversation — the same directory carries Monday's session
 * and Tuesday's, and two at once — so the scope alone still lets last week's
 * resolution of a title answer today's typed guess. The credit pass passes the
 * session's `startedAt` from the live-session registry, and a record stamped
 * before it is dropped. Inclusive at the boundary: a resolution in the same
 * millisecond the session was registered is that session's own.
 *
 * What is LEFT is stated rather than hidden: two sessions running CONCURRENTLY
 * in one project directory share one table, so a call that did not reach
 * `expandHandle` can still be translated through a resolution the other one
 * made. And a session with no registry record has no floor at all.
 */
export function readHandleResolutions(
  dataDir: string,
  opts: { now?: number; ttlMs?: number; scope?: string; since?: number } = {},
): HandleResolutions {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? EXPANSION_TTL_MS;
  const since = opts.since;
  // Canonicalized ONCE: `canonicalScope` is a `realpath` syscall, and the file
  // may hold hundreds of lines.
  const want =
    opts.scope === undefined || opts.scope.length === 0 ? null : canonicalScope(opts.scope);
  const map = new Map<string, string | null>();
  // The salt comes FIRST, and its absence is `unreadable` (G58): a map handed
  // back with the wrong salt would key every lookup to nothing, and a zero that
  // cannot say why is the shape I32 is named for.
  const salt = expansionSalt(dataDir);
  if (salt === null) return { map, salt: "", ok: false, reason: "unreadable" };
  let raw: string;
  try {
    raw = readFileSync(expansionsPath(dataDir), "utf8");
  } catch (err) {
    // Absent or unreadable: no translations, which credits exactly what a
    // pre-2026-09-15 store credited. Never a reason to fail a boundary — but
    // the two are told apart, because "no file" and "a file nobody can open"
    // call for different repairs.
    const absent = (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
    return { map, salt, ok: false, reason: absent ? "absent" : "unreadable" };
  }
  const parsed = parseLines(raw);
  for (const record of parsed.records) {
    if (now - record.at > ttl) continue;
    if (want !== null && !scopeMatches(record.scope, want)) continue;
    // The session floor. INCLUSIVE, because a resolution stamped in the same
    // millisecond the session was registered is this session's own.
    if (since !== undefined && record.at < since) continue;
    map.set(record.key, record.id);
  }
  // A file with lines in it and not one of them a record: a writer on the other
  // side of this seam is producing something this side cannot read, which is
  // the one shape a filtered-to-empty read must never be confused with.
  if (parsed.lines > 0 && parsed.records.length === 0) {
    return { map, salt, ok: false, reason: "corrupt" };
  }
  return { map, salt, ok: true, reason: "ok" };
}

/**
 * Why the map came back the size it did — the shape `transcript.ts#readTranscript`
 * already uses, and for the reason I32 taught: an empty answer that cannot say
 * whether it was reading an idle table or a dead one is how a broken seam looks
 * exactly like a quiet one on the daily.
 *
 *   `ok`         — the file was read (an empty live table is still `ok`)
 *   `absent`     — no file yet; the ordinary state of a store nobody has
 *                  expanded a handle in
 *   `unreadable` — the file is there and this process cannot open it
 *   `corrupt`    — lines, and not one of them a record
 */
export type ExpansionsRead = "ok" | "absent" | "unreadable" | "corrupt";

export interface HandleResolutions {
  /** `key → id | null`, filtered by TTL, scope and the session floor. */
  readonly map: Map<string, string | null>;
  /**
   * The store's handle salt, carried so `translateExpansions` can key the
   * caller's raw handles the same way the records were keyed — without a second
   * read, and without a caller that has to remember which store it asked.
   * Empty only when the salt could not be had, and then the map is empty too.
   */
  readonly salt: string;
  readonly ok: boolean;
  readonly reason: ExpansionsRead;
}

/** Records are written canonical, so the string compare answers almost always;
 *  the `realpath` is the fallback for a line some other writer left raw. */
function scopeMatches(scope: string | undefined, want: string): boolean {
  if (scope === undefined) return false;
  return scope === want || canonicalScope(scope) === want;
}

/**
 * Translate the raw expansion strings from a transcript slice.
 *
 * A string the log resolved becomes the id it reached; everything else — a
 * handle nobody asked, and a handle whose newest answer is a SHADOW — passes
 * through UNCHANGED, so it still reaches `reference.ts` as itself and still
 * counts `unresolvedHandles`. A guess the tool answered "not-found" must go on
 * being a guess that credited nothing.
 *
 * Literal ids are looked up too, not skipped: `Store.resolve` follows forwarding
 * addresses, so a session that expanded a SUPERSEDED id by name read — and
 * should be credited for — the live head, which is what the tool recorded.
 */
export function translateExpansions(
  expansions: readonly string[],
  resolutions: ReadonlyMap<string, string | null>,
  salt: string,
): string[] {
  if (resolutions.size === 0) return [...expansions];
  return expansions.map((raw) => resolutions.get(handleKey(raw, salt)) ?? raw);
}

/** How many of `expansions` the log actually translated — the boundary row's
 *  `resolvedHandles`, and the one number that proves this seam live. */
export function countTranslated(
  expansions: readonly string[],
  resolutions: ReadonlyMap<string, string | null>,
  salt: string,
): number {
  let n = 0;
  for (const raw of expansions) {
    const to = resolutions.get(handleKey(raw, salt));
    if (to !== undefined && to !== null && to !== raw.trim()) n += 1;
  }
  return n;
}

/**
 * Rewrite the file with the newest live resolutions — newest BY `at` — and
 * nothing else.
 *
 * **The window is narrowed to re-read → rename, and that is not the same as
 * closed.** The first draft read the whole file, wrote the temp copy, and
 * renamed — so a line another process appended anywhere in between was gone,
 * and the compacted file kept the OLDER answer for that handle. For a SHADOW
 * that is not under-credit, it is the leak this module exists to prevent: the
 * refusal disappears and the resolution it was overriding stands again. So the
 * byte length read at the top is kept, the file is re-read from that offset
 * immediately before the rename, and whatever arrived is appended to the temp
 * file (in arrival order, after the sorted block — `readHandleResolutions` takes
 * the last line for a key, so a late shadow still wins).
 *
 * A line appended after THAT read and before the rename is still lost. The
 * window is now two syscalls wide instead of a whole file write, and the
 * alternative — a lock file two long-lived processes share — is a new failure
 * mode in the hot path of a tool that may not fail.
 *
 * Dropping an old entry is safe in the one direction that matters: the map is
 * keyed by handle, so a shadow and the resolution it overrides ARE one entry.
 * Compaction can drop them together; it can never drop the shadow and leave the
 * resolution standing.
 *
 * Exported for `test/sessions.test.ts`, which is the only way to stage the race
 * deterministically — see `duringWindow`.
 */
export function compactExpansions(
  path: string,
  now: number,
  /**
   * TEST SEAM, in the same spirit as the `now` injections this repo already
   * uses: called once the temp file is written and before the tail is re-read,
   * so a test can be the other process instead of hoping to be scheduled like
   * one. Nothing in `src/` passes it.
   */
  duringWindow?: () => void,
): void {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return;
  }
  // BYTES, not characters: the tail is spliced back by offset below.
  const offset = buf.length;
  const live = new Map<string, HandleResolution>();
  for (const record of parseLines(buf.toString("utf8")).records) {
    if (now - record.at > EXPANSION_TTL_MS) continue;
    live.set(record.key, record);
  }
  // SORTED BY `at`, because a Map is keyed by FIRST appearance and the slice is
  // what pays for the bound. A handle resolved long ago and re-resolved a
  // moment ago sits at the TOP of the map with the newest timestamp on it, so
  // an unsorted `slice(-KEEP)` dropped exactly the entry the next boundary was
  // about to ask for and kept 256 staler ones instead. The sort is stable, so
  // records sharing an `at` keep their arrival order.
  const keep = [...live.values()].sort((a, b) => a.at - b.at).slice(-EXPANSIONS_KEEP);
  const tmp = `${path}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(tmp, keep.map((r) => `${JSON.stringify(r)}\n`).join(""), {
      encoding: "utf8",
      mode: 0o600,
    });
    duringWindow?.();
    // Anything appended since the read at the top. A file that SHRANK was
    // replaced by another compaction; splicing its bytes at our offset would
    // produce nonsense, so nothing is carried over.
    const after = readFileSync(path);
    if (after.length > offset) appendFileSync(tmp, after.subarray(offset), { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    /* the log stays as it was, one compaction late */
  }
}

/**
 * Lines that are not a record are skipped, never thrown over: a half-written
 * line from a host that died mid-append is an ordinary thing to find here.
 *
 * `lines` counts the non-empty ones it was OFFERED, so a caller can tell a file
 * with nothing in it from a file with nothing readable in it.
 */
function parseLines(raw: string): { records: HandleResolution[]; lines: number } {
  const records: HandleResolution[] = [];
  let lines = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    lines += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = parseRecord(parsed);
    if (record !== null) records.push(record);
  }
  return { records, lines };
}

function parseRecord(raw: unknown): HandleResolution | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const key = rec["key"];
  const id = rec["id"];
  const at = rec["at"];
  if (typeof key !== "string" || key.length === 0) return null;
  // `null` is a RECORD, not a missing field: it is the shadow a refusal leaves.
  if (id !== null && (typeof id !== "string" || id.length === 0)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const scope = rec["scope"];
  return {
    key,
    id,
    at,
    ...(typeof scope === "string" && scope.length > 0 ? { scope } : {}),
  };
}
