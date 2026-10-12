/**
 * The adapter's configuration and its CAPABILITY REPORT.
 *
 * This file is where scar §2.18 lives — "a guarantee carried by something you
 * don't own is not a guarantee". v1 encoded one host's 9,000-byte injection
 * cliff as though it were physiology and discovered its socket ceiling by
 * watching calls die. Both are host facts. Here they are named, reported, and
 * CHECKABLE — and the core is told what they are rather than assuming them.
 *
 * The rule the CONTRACT states and this file mechanizes:
 *
 *   §4 G4 — every host-dependent limit is discovered or asserted at runtime and
 *   surfaced as a checkable value. `capabilities()` returns one row per limit
 *   with `reported: false` where the host said nothing, so "we never asked" and
 *   "the host said zero" are different records (scar §2.4).
 *
 * KEYLESS (owner, 2026-09-24). The package reads no API key and calls no model
 * API of its own: the Anthropic write-up of crashed sessions, the Voyage
 * embedder, the credentials file and the model seats that fed them were
 * removed. A configuration that still names one of them is read, not refused —
 * the setting is ignored and named in `retired` (see `loadConfig`).
 *
 * And one from observer-mode G5: an unreadable configuration resolves to
 * OBSERVER, never to "encode anyway". `loadConfig` never throws.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { isZone } from "../core/time.js";

import { PAGE_HOST_BUDGET_BYTES, PAGE_WRITER_MODES } from "../core/self/index.js";
import type { PageWriterMode } from "../core/self/index.js";
import { DEFAULT_KEEP as SNAPSHOT_DEFAULT_KEEP } from "./snapshots.js";


/** Every host-dependent limit this adapter depends on. One row each. */
export const CAPABILITIES = [
  "injectionBudgetBytes",
  "executionCeilingMs",
  "socketLifetimeMs",
] as const;
export type CapabilityName = (typeof CAPABILITIES)[number];

export interface CapabilityReport {
  readonly name: CapabilityName;
  /** False when the host told us nothing. Never silently defaulted. */
  readonly reported: boolean;
  readonly value: number | boolean | null;
  readonly why: string;
}

/**
 * The adapter's own tunables, in one visible place (the shape every core module
 * uses). Nothing here is a memory property; all of it is host trivia.
 */
export const TUNABLES = {
  /** Detached-worker watchdog, ms. Validated against `remember/`'s staleness
   *  window by `validateWatchdog` before any spawn (scars E4/E5). */
  WATCHDOG_MS: 5 * 60_000,
  /**
   * THE HEADLESS NIGHTLY RUN'S WATCHDOG (2026-09-29), ms: `claude -p` running
   * the page writer, the dream and the reflection in one windowless session.
   * A run measured ~4.5 minutes on 2026-09-29; this is generous on purpose.
   * `dreaming.timeoutMs` in the configuration overrides it.
   */
  NIGHT_RUN_MS: 20 * 60_000,
  /**
   * A headless run that exits non-zero sooner than this "could not start"
   * (not logged in, a bad flag) rather than failed partway: the next prompt
   * falls back to asking, with the reason.
   */
  NIGHT_QUICK_EXIT_MS: 60_000,
  /**
   * The headless run's turn ceiling (`claude -p --max-turns`), beside its
   * watchdog (owner decision B, 2026-09-29). A night is some tens of tool calls;
   * this is generous. `dreaming.maxTurns` overrides it.
   */
  NIGHT_MAX_TURNS: 60,
  /**
   * THE CATCH-UP (2026-10-01, build 3; unbounded 2026-10-11): before the page
   * writer, the nightly run writes up EVERYTHING owed in any directory, and
   * `counterparts catch-up` does the same on demand
   * (`night-catch-up.ts#runCatchUp`). It runs as a series of short `claude -p`
   * children, each a fresh context, until nothing is owed. One child takes at
   * most this many bytes of words (whole ~24 KB parts; the first part is taken
   * whatever its size) — about 50k tokens, so no child's context grows past a
   * 200k-token model's...
   */
  NIGHT_WRITE_UP_BYTES: 192 * 1024,
  /** ...and at most this many parts: two tool calls a part, so the child's
   *  turn ceiling below holds. */
  NIGHT_WRITE_UP_BATCH_PARTS: 16,
  /**
   * THE SANITY CEILINGS, parts a run, against runaway cost — not pacers. A
   * part costs about 7k tokens of new work (its ~5k tokens of words written to
   * the cache, the memories it writes, a share of each child's start) and two
   * tool calls; the nightly run's measured baseline is 246k new work and 20
   * calls (2026-10-10). A typical morning owes 20–40 parts; a heavy day owed
   * in full is about 200 (on 10-11, 30 pieces of one session were 16 parts;
   * 10-10 had 404 pieces).
   *
   * THE NIGHT'S (decided by Mike, 2026-10-11, lightly held; it was 400): 100
   * parts is about 700k tokens and 200 calls, roughly 3× the baseline, so a
   * typical morning clears in one night and a heavy day takes two. What is
   * left stays owed for the next night, and the row says how much.
   */
  NIGHT_WRITE_UP_PARTS: 100,
  /** ...and `counterparts catch-up`'s, which the owner runs on purpose
   *  (decided by Mike, 2026-10-11, lightly held): 400 parts, about 2.8M
   *  tokens and 800 calls, roughly 11× the baseline — about twice a heavy
   *  day. What is left stays owed: run it again, or the nights take it. */
  CATCH_UP_COMMAND_PARTS: 400,
  /** One child's watchdog, ms — inside `WRITE_UP_CLAIM_MS`, so its claims
   *  outlive it. A batch measured 4–8 s a part on 2026-10-11. */
  NIGHT_WRITE_UP_MS: 10 * 60_000,
  /** THE WHOLE RUN'S WATCHDOG, ms, the night's and the command's alike: no
   *  child starts that could end past it. The command's 400 parts at the
   *  measured 4–8 s is 27–53 minutes; the night's 100 is 7–13. The night's
   *  row carries it from the start (`night-run.ts#nightRowTimeoutMs`), so a
   *  long catch-up is never read as a lost run. */
  NIGHT_WRITE_UP_TOTAL_MS: 60 * 60_000,
  /** One child's turn ceiling: two calls a part for the most parts a child
   *  takes (2 × 16), and 16 more — room to look a tool up and for the odd
   *  re-sent answer (one in five parts on 2026-10-11). A child that hits it
   *  ends short, and the run starts no further batch. */
  NIGHT_WRITE_UP_MAX_TURNS: 48,
  /** Reference resolution at a session-ending boundary (recall §9.2), ms. The
   *  resolver stops between candidates past it and the row says so
   *  (`recall.credit` reason `budget-exceeded`); nothing is truncated silently. */
  CREDIT_BUDGET_MS: 150,
  /** Identical consecutive spawn failures before the worker ESCALATES instead
   *  of re-logging the same line forever (scar E4's widening). */
  ESCALATE_AFTER: 3,
  /**
   * THE NEXT-SESSION WRITE-UP (roadmap C2, owner 2026-09-23). How many sessions
   * may be pointed at an ended session's words in one calendar day (local
   * time, `self/calendar.ts`). A sibling of the page writer's
   * `PAGE_WRITER_ASKS_PER_DAY` and the same number: the owner's ruling is that
   * the write-up SHARES the day's allowance rather than growing a pacer of its
   * own — and nothing here is at the Stop, where §13 G3's one pacer lives.
   */
  WRITE_UP_ASKS_PER_DAY: 2,
  /**
   * A plain reminder's handle — the memory's title or first line — is clipped
   * to this many characters in the line a person reads (2026-09-26). One
   * glance's worth: a longer title is a paragraph, and the memory's id rides
   * beside it in the model's copy.
   */
  PLAIN_WHAT_MAX_CHARS: 120,
  /**
   * HOW OFTEN AN OPEN SESSION MAY BE TOLD WHAT CHANGED ELSEWHERE (2026-10-11,
   * option C of the fresh-wake brief; Mike approved the option 2026-10-10,
   * the number is the brief's): at most one "Since you started" line an hour
   * per session (`lifecycle.ts#sinceLine`). The wake is not a line, so the
   * first can come at the second prompt; a line that did not fit spends none.
   */
  SINCE_LINE_EVERY_MS: 60 * 60 * 1000,
  /**
   * ONE BUDGET PER HOOK ENVELOPE (2026-09-29, audit item 9): the host's cap on
   * a hook's whole output, in characters. The host's own words: "Hook output
   * strings, including `additionalContext`, `systemMessage`, and plain stdout,
   * are capped at 10,000 characters. Output that exceeds this limit is saved to
   * a file and replaced with a preview and file path." Past it, what the
   * session would read is a preview — of the WAKE, or of the turn's recall.
   *
   * Everything one SessionStart or one UserPromptSubmit prints is measured
   * against this one number, in a stated order of what gives way first
   * (`hooks.ts#sessionStart`, `hooks.ts#userPromptSubmit`; adapter NOTES
   * 2026-09-29). Measured in BYTES (bytes ≥ characters), the safe direction.
   * With no owner notice the hook prints PLAIN text; with one, the JSON form,
   * where each field is held to this same number on its own and the escaping
   * costs nothing (`bin/hook.ts#fieldsFit`; it was a 9,500-character bound on
   * the whole envelope, `ENVELOPE_CHARS`, until the measurement below). It is
   * also why the write-up's words travel through the MCP door.
   *
   * MEASURED AGAIN on Claude Code 2.1.296, 2026-10-10 (notes:
   * `~/counterparts-notes/2026-10-10-session-start-limits.md`): the cap is
   * per STRING FIELD (`additionalContext`, `systemMessage`), in CHARACTERS —
   * exactly 10,000 passes, 10,001 is replaced — and per HOOK: two SessionStart
   * hooks of 7,000 each both arrived whole. SessionStart and UserPromptSubmit
   * behave alike. An over-long JSON envelope is no longer fatal (a
   * 10,488-character envelope carrying a 9,910-character wake arrived whole).
   * Bytes stay the safe measure here: bytes ≥ characters.
   */
  HOST_OUTPUT_CHARS: 10_000,
  /**
   * WHAT THE MODEL SEES OF A FIELD PAST `HOST_OUTPUT_CHARS`, in characters —
   * measured on Claude Code 2.1.296, 2026-10-10 (same notes): a "too large,
   * saved to <path>" line, then the field's first ≤ 2,000 characters cut back
   * to a line end, about 2,300 in all. Nothing tells the model to read the
   * file, which holds all of it. So whatever must survive such a cut sits in
   * the field's first 2,000 characters: the wake's preface says to read that
   * file (`self/briefing.ts#WAKE_WHOLE_SENTENCE`), and the self page's top
   * line names its end line and both doors to it (`pageTopLine`). Nothing
   * composes against this number; tests simulate the cut with it.
   */
  HOST_PREVIEW_CHARS: 2_000,
  /**
   * WHAT ONE MCP TOOL RESULT IS MEASURED AGAINST, in characters (2026-09-30):
   * the room Claude Desktop's `wake` has for the wake and what rides beside it
   * (the write-up pointer is measured against this, not `HOST_OUTPUT_CHARS`,
   * which is Claude Code's cap on a HOOK's output). No host documents a cap on
   * a tool result that this package has measured; this is the size the
   * write-up door already hands over in one part (`WRITE_UP_PART_BYTES`, ~24
   * KB), so a wake plus a pointer is never the first thing to find the real one.
   * (2026-10-02: the real one is measured now — `fit/TOOL_RESULT_CEILING`,
   * 40,000 under Claude Code's 50,000 — and this sits under it by choice.)
   */
  TOOL_RESULT_CHARS: 24_000,
  /**
   * CLAUDE DESKTOP'S WRITE-UP ASK (2026-09-30): it rides on a tool result once
   * a Desktop session has made this many tool calls AND `DESKTOP_ASK_AFTER_MS`
   * has passed since the later of its wake, its last `session_end`/`chapter`,
   * and its last ask (`sessions.ts#touchDesktopSession`). Desktop has no Stop
   * and no transcript, so calls and time are the only measure a server has;
   * three calls is `core/coverage/`'s `ASK_PIECES`, and the time is shorter
   * than its 30 minutes because a Desktop chat has no crash fallback — what is
   * not written up during the chat is never written up.
   */
  DESKTOP_ASK_CALLS: 3,
  DESKTOP_ASK_AFTER_MS: 20 * 60_000,
  // The Stop ask's pacing is NOT here: two pacers on one blocked moment drew
  // about a dozen asks in 13 owner turns (2026-09-04). The one pacer lives in
  // `self/tunables.ts` (FIRST_ASK_* / REASK_*).
} as const;

/**
 * The embedder `embedder.kind` can name — one since 2026-09-24, when the Voyage
 * seat was removed. `"voyage"` in a configuration is read as this, with a note
 * in `retired` (see `loadConfig`).
 */
export type EmbedderKind = "static";
export const EMBEDDER_KINDS: readonly EmbedderKind[] = ["static"];

export interface AdapterConfig {
  /** Where the memory lives. Pinned onto the child's environment LAST. */
  readonly dataDir?: string;
  /** The host's reported injection ceiling, in bytes. The core has no default
   *  (scar §2.18); Claude Code's loaders fill an absent one with that host's
   *  (`withBudgetDefault`, 2026-10-12). */
  readonly injectionBudgetBytes?: number;
  /** Set by `withBudgetDefault` alone, never read from a file: the ceiling above
   *  is Claude Code's default because the file named none. Runtime only. */
  readonly injectionBudgetDefaulted?: true;
  /** How long the host lets a foreground hook run, ms. Reported, not assumed. */
  readonly executionCeilingMs?: number;
  /** How long a socket survives in this host, ms. The reason E3 rescoped here. */
  readonly socketLifetimeMs?: number;
  /** The detached worker's watchdog, ms. */
  readonly watchdogMs?: number;
  /**
   * RECALL BY MEANING — the local potion-base-8M table (`core/embed/static.ts`):
   * no key, no network, nothing leaves the machine. Its weights come from
   * `COUNTERPARTS_STATIC_WEIGHTS_DIR` or the installed `counterparts-model-potion`
   * package.
   *
   * An ABSENT block reads as the table, on (`resolveEmbedder`, roadmap C3);
   * `{ "enabled": false }` is how somebody says no. `kind` has one value,
   * `"static"`, and may be left out. It had a second — `"voyage"`, a paid remote
   * seat — until 2026-09-24; a configuration that still names it gets the local
   * table and a note in `retired`. Any OTHER kind on an enabled block is still
   * unreadable rather than guessed at.
   */
  readonly embedder?: { readonly enabled: boolean; readonly kind?: EmbedderKind };
  /**
   * THE DAILY ROTATING SNAPSHOT (owner ruling 3, 2026-09-18).
   *
   * All three sub-keys are optional and the block as a whole may be absent: the
   * worker then keeps the newest `DEFAULT_KEEP` copies in a `snapshots/`
   * directory beside the store. `dir` names one explicitly — required when the
   * store is not the `store/` subdirectory of a base directory this package
   * created, because in that case there is no base directory to put copies
   * beside and helping ourselves to a sibling of somebody's own directory is not
   * this package's to do (`adapters/snapshots.ts#resolveSnapshotsDir`).
   *
   * `mirror` is a second location that receives the same copy and rotates on its
   * own terms; a mirror failure is reported and never fatal.
   *
   * **THIS ONE BLOCK IS READ LENIENTLY, AND IT IS THE ONLY ONE** (F2 review,
   * MAJOR-2, coordinator's ruling 2026-09-18). Everything else in this file
   * stands the whole configuration down to observer on a value it cannot read,
   * and that is right for a knob whose wrong answer would make the adapter act:
   * an egress switch, a path this package opens. It is wrong here. Measured on
   * the branch: `"keep": 0` — or `"14"` with quotes, which is the likelier typo
   * — returned `{ observer: true }` with `dataDir` GONE, so from the next hook on
   * nothing was captured, nothing recalled, no row written, and the one stderr
   * line a hook produces goes nowhere (I32). A backup preference is not worth
   * memory. Each bad field falls back to its default, `ignored` records which and
   * why, and doctor's Snapshot line says it out loud.
   */
  readonly snapshots?: {
    readonly dir?: string;
    readonly keep?: number;
    readonly mirror?: string;
    /**
     * What this file could not read inside the block, phrased for a person —
     * "snapshots.keep was 0; using 14". Empty is absent. It is a REPORT, not a
     * stance: nothing here changes what the adapter does beyond the default it
     * fell back to, and doctor is what puts it in front of somebody.
     */
    readonly ignored?: readonly string[];
  };
  /**
   * THE NIGHTLY PAGE WRITER (2026-09-20, S2), and it defaults to `session`.
   *
   * `session` — the page writer runs as the first part of the nightly run
   * (the dream tool's `writer` phase, since 2026-09-28). `off` — nothing runs
   * and nothing is written. (`host` — a windowless `claude -p` the boundary's
   * worker started for the writer alone — was removed on 2026-09-29: the
   * nightly run does that job now. A configuration that still names it loads;
   * the value is ignored and named among the old settings, as is
   * `pageWriter.timeoutMs`, which only that mode read.)
   *
   * **Absent means `session`, not off**: S2 is how a new user's page forms at
   * all (plan §3), and a mechanism that only works for people who found a
   * configuration key is not the product. `"mode": "off"` is one line.
   *
   * **Read LENIENTLY** (S2 review, 2026-09-20): a bad field costs that field,
   * the fallback is `session`, each bad field names itself in `ignored`, and
   * doctor's Page writer line says so.
   */
  readonly pageWriter?: {
    readonly mode: PageWriterMode;
    /** What this file could not read inside the block, phrased for a person.
     *  Empty is absent. A REPORT, not a stance — doctor is what puts it in
     *  front of somebody. */
    readonly ignored?: readonly string[];
  };
  /**
   * THE HEADLESS NIGHTLY RUN (2026-09-29), read leniently like `pageWriter`:
   * `model` pins the model the run uses (`claude -p --model …`; absent, the
   * user's default), `timeoutMs` its watchdog (absent, `TUNABLES.NIGHT_RUN_MS`).
   * Whether the run is headless at all is the dreaming SETTING (`auto`), which
   * lives in the store, not here.
   */
  readonly dreaming?: {
    readonly model?: string;
    readonly timeoutMs?: number;
    /** The run's turn ceiling; absent, `TUNABLES.NIGHT_MAX_TURNS`. */
    readonly maxTurns?: number;
    /** What this file could not read inside the block, phrased for a person. */
    readonly ignored?: readonly string[];
  };
  /**
   * SETTINGS THIS BUILD NO LONGER READS, phrased for a person — e.g.
   * `"credentialsFile" is no longer used …`. Present only when the file named
   * one. A REPORT, not a stance: the setting was ignored and nothing else
   * changed. Doctor prints it as a quiet note, never a warning — a key the
   * owner's configuration still carries from an older install is not a fault.
   */
  readonly retired?: readonly string[];
  /** Is this the owner's own session? Withholding is the safe direction. */
  readonly owner?: boolean;
  /**
   * THE PERSON'S ZONE, an IANA name (`"America/Denver"`), when it should not
   * follow the computer — a server set to UTC (docs/time.md rule 2). Absent,
   * every local date follows the machine's current zone. Optional, and not
   * asked at install: install prints the zone it detected in one line.
   */
  readonly timeZone?: string;
  /**
   * A `timeZone` this machine does not know, as written. It is IGNORED — the
   * machine's zone is used — and doctor names it; a misspelt zone must not
   * stand anybody's memory down the way an unreadable setting does.
   */
  readonly timeZoneUnknown?: string;
  /** An instrument stands down. Fail direction: an unreadable config lands here. */
  readonly observer?: boolean;
  /** The identity core's name is the OWNER's; there is no default. */
  readonly identity?: { readonly name: string; readonly aliases?: readonly string[] };
}

export interface LoadedConfig {
  readonly config: AdapterConfig;
  readonly ok: boolean;
  readonly reason: "loaded" | "absent" | "unreadable";
  /**
   * The keys that made it unreadable, where the reader can name them (today:
   * `embedder.enabled`, `embedder.kind`). Absent when it cannot, or when
   * nothing was wrong. A reason that names its key is one a person can fix
   * without reading this file.
   */
  readonly unreadableKeys?: readonly string[];
}

/**
 * Read the host's configuration object. Never throws, and FAILS TOWARD STANDING
 * DOWN: anything unreadable resolves to observer, because "encode anyway" on a
 * configuration we could not read is how an instrument writes to a live store
 * (observer-mode G5, scar E7).
 */
export function loadConfig(raw: unknown): LoadedConfig {
  if (raw === undefined || raw === null) {
    return { config: {}, ok: true, reason: "absent" };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { config: { observer: true }, ok: false, reason: "unreadable" };
  }
  const rec = raw as Record<string, unknown>;
  const out: {
    dataDir?: string;
    injectionBudgetBytes?: number;
    executionCeilingMs?: number;
    socketLifetimeMs?: number;
    watchdogMs?: number;
    embedder?: { enabled: boolean; kind?: EmbedderKind };
    snapshots?: { dir?: string; keep?: number; mirror?: string; ignored?: string[] };
    pageWriter?: { mode: PageWriterMode; ignored?: string[] };
    dreaming?: { model?: string; timeoutMs?: number; maxTurns?: number; ignored?: string[] };
    retired?: string[];
    owner?: boolean;
    timeZone?: string;
    timeZoneUnknown?: string;
    observer?: boolean;
    identity?: { name: string; aliases?: readonly string[] };
  } = {};
  let unreadable = false;
  const badKeys: string[] = [];
  // The settings the keyless build dropped (2026-09-24). Each is IGNORED and
  // named — never a reason to stand the configuration down, because the owner's
  // own live configuration carries `credentialsFile` from the install that
  // wrote it, and an old key must not cost anybody their memory.
  const retired: string[] = [];

  const num = (key: string): number | undefined => {
    const value = rec[key];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      unreadable = true;
      return undefined;
    }
    return value;
  };

  if (typeof rec["dataDir"] === "string") out.dataDir = rec["dataDir"];
  else if (rec["dataDir"] !== undefined) unreadable = true;

  if (rec["credentialsFile"] !== undefined) {
    const named = typeof rec["credentialsFile"] === "string" ? ` (${rec["credentialsFile"]})` : "";
    retired.push(
      `"credentialsFile" is no longer used — Counterparts reads no API keys; the file it names${named} can be deleted`,
    );
  }
  if (rec["models"] !== undefined) {
    retired.push(`"models" is no longer used — there is no model seat to configure; it was ignored`);
  }
  if (rec["crashWriteUp"] !== undefined && rec["crashWriteUp"] !== "next-session") {
    retired.push(
      `"crashWriteUp" is no longer used — a session that ended before it was written up is always written up by the next session in its project`,
    );
  }
  // The Stop ask's switch (B1, 2026-09-23), retired the next day when the ask
  // moved to the host's non-error route (`bin/hook.ts#HOST_STOP`). Any value —
  // the owner's own configuration says `"stderr"` — is read, ignored and named.
  if (rec["stopAskShape"] !== undefined) {
    retired.push(`"stopAskShape" is no longer used — the end-of-session ask has one shape now, shown as hook feedback`);
  }

  const injection = num("injectionBudgetBytes");
  if (injection !== undefined) out.injectionBudgetBytes = injection;
  const exec = num("executionCeilingMs");
  if (exec !== undefined) out.executionCeilingMs = exec;
  const socket = num("socketLifetimeMs");
  if (socket !== undefined) out.socketLifetimeMs = socket;
  const watchdog = num("watchdogMs");
  if (watchdog !== undefined) out.watchdogMs = watchdog;

  if (rec["owner"] !== undefined) {
    if (typeof rec["owner"] !== "boolean") unreadable = true;
    else out.owner = rec["owner"];
  }
  if (rec["observer"] !== undefined) {
    if (typeof rec["observer"] !== "boolean") unreadable = true;
    else out.observer = rec["observer"];
  }
  // Read LENIENTLY, unlike the stance keys above: a zone that is not one is
  // ignored and named, never a reason to stand the configuration down.
  if (rec["timeZone"] !== undefined) {
    if (isZone(rec["timeZone"])) out.timeZone = rec["timeZone"];
    else out.timeZoneUnknown = String(rec["timeZone"]).slice(0, 64);
  }
  const embedder = rec["embedder"];
  if (embedder !== undefined) {
    // The egress knob is read STRICTLY. A misspelled or half-written `embedder`
    // block must not resolve to "on" by accident, and the unreadable rule below
    // sends the whole configuration to observer rather than guessing.
    // `kind` is read INSIDE the object check (re-review MINOR A): `"embedder":
    // null` reached `e["kind"]` first and threw, which stood a hook down with a
    // TypeError and crashed doctor. Now it is what every other malformed block
    // is — unreadable, the whole configuration to observer, the key named.
    const e = (typeof embedder === "object" && embedder !== null && !Array.isArray(embedder)
      ? embedder
      : {}) as Record<string, unknown>;
    // `"voyage"` NAMED THE REMOVED SEAT (2026-09-24): read as the local table,
    // and said so, rather than standing the configuration down over a choice
    // this build no longer offers.
    const voyage = e["kind"] === "voyage";
    if (voyage) {
      retired.push(`"embedder.kind" "voyage" is no longer available — recall by meaning uses the local table, where nothing leaves this machine`);
    }
    const kind = voyage ? "static" : e["kind"];
    const kindOk = kind === undefined || (typeof kind === "string" && (EMBEDDER_KINDS as readonly string[]).includes(kind));
    if (typeof embedder !== "object" || embedder === null || Array.isArray(embedder)) {
      unreadable = true;
      badKeys.push("embedder");
    } else if (typeof e["enabled"] !== "boolean") {
      unreadable = true;
      badKeys.push("embedder.enabled");
    } else if (e["enabled"] === false) {
      // OFF MEANS OFF, WHATEVER `kind` SAYS (review of #190, MINOR 5). A typo in
      // a knob that is switched off must not stand every memory down: `kind`
      // chooses an embedder, and with none running there is nothing for it to
      // choose. A valid kind is kept; an invalid one is dropped.
      out.embedder = { enabled: false, ...(kind !== undefined && kindOk ? { kind: kind as EmbedderKind } : {}) };
    } else if (!kindOk) {
      // On, and naming no embedder this build knows: unreadable, never a
      // default.
      unreadable = true;
      badKeys.push("embedder.kind");
    } else {
      out.embedder = { enabled: e["enabled"], ...(kind === undefined ? {} : { kind: kind as EmbedderKind }) };
    }
  }
  // `parallel` — the parallel run's knob — was removed 2026-10-12 (the run
  // ended 2026-09-21). A configuration that still carries it, in any shape, is
  // read as if it did not: never refused, never observer, nothing said. It
  // switched on a stand-down only the run used, so ignoring it changes nothing.
  // THE SECOND LENIENT BLOCK, and it became one under review (S2, 2026-09-20).
  //
  // It was written strict, beside the egress knob, on the argument that `host`
  // STARTS A PROCESS and a half-written block must not resolve to it. The
  // adversarial review took that argument apart on its own terms: `mode` is
  // matched against an exact-string allowlist, so a typo cannot resolve to
  // `host` under a lenient reading either — it can only resolve to the
  // fallback. Strictness bought no protection against the stated risk and cost
  // the owner his memory for one misspelling in an OPTIONAL block:
  // `{"mode": "sesion"}` stood the whole configuration down to observer,
  // `dataDir` went with it, and every session in that directory silently
  // stopped remembering with one doctor line about the file as a whole.
  // That is precisely the failure the F2 ruling moved `snapshots` out of
  // strictness to avoid.
  //
  // So it falls back, to `session`. Each bad field names itself in `ignored`,
  // and doctor's Page writer line prints it. Nothing in here ever sets
  // `unreadable`.
  const pageWriter = rec["pageWriter"];
  if (pageWriter !== undefined) {
    out.pageWriter = readPageWriter(pageWriter);
    // THREE KEYS FROM THE REMOVED HOST MODE, each read as an OLD SETTING —
    // ignored and named, never a reason to refuse the file. `command` went on
    // 2026-09-24 (a "runs a command named by config" finding); `mode: "host"`
    // and `timeoutMs`, its child's watchdog, went with the mode on 2026-09-29.
    const w = pageWriter as Record<string, unknown> | null;
    if (typeof w === "object" && w !== null && !Array.isArray(w)) {
      if (w["command"] !== undefined) {
        retired.push(`"pageWriter.command" is no longer used — the page writer runs inside the nightly run`);
      }
      if (w["mode"] === "host") {
        retired.push(`"pageWriter.mode" "host" is no longer used — the page writer runs inside the nightly run (mode session)`);
      }
      if (w["timeoutMs"] !== undefined) {
        retired.push(`"pageWriter.timeoutMs" is no longer used — the nightly run's watchdog is "dreaming.timeoutMs"`);
      }
    }
  }
  // THE THIRD LENIENT BLOCK (2026-09-29): the headless nightly run's model pin
  // and watchdog. A bad field costs that field and is named; nothing here
  // ever sets `unreadable`.
  const dreaming = rec["dreaming"];
  if (dreaming !== undefined) {
    out.dreaming = readDreaming(dreaming);
  }
  // THE FIRST LENIENT BLOCK. See the `snapshots` knob above for why: a backup
  // preference that could not be read must cost the backup preference and
  // nothing else. Nothing in here ever sets `unreadable`.
  const snapshots = rec["snapshots"];
  if (snapshots !== undefined) {
    out.snapshots = readSnapshots(snapshots);
  }
  const identity = rec["identity"];
  if (identity !== undefined) {
    const i = identity as Record<string, unknown>;
    if (typeof i?.["name"] === "string" && i["name"].trim().length > 0) {
      const aliases = i["aliases"];
      out.identity = {
        name: i["name"],
        ...(Array.isArray(aliases)
          ? { aliases: aliases.filter((a): a is string => typeof a === "string") }
          : {}),
      };
    } else {
      unreadable = true;
    }
  }

  if (unreadable) {
    // Everything we did read is discarded along with the stance: a partially
    // understood configuration is not a configuration.
    return {
      config: { observer: true },
      ok: false,
      reason: "unreadable",
      ...(badKeys.length === 0 ? {} : { unreadableKeys: badKeys }),
    };
  }
  // A longer line cap than the lenient blocks': these phrases are this file's
  // own words plus, at most, the one path the owner wrote.
  if (retired.length > 0) out.retired = tidy(retired, RETIRED_LINE_CHARS);
  return { config: out, ok: true, reason: "loaded" };
}

/**
 * THE FALLBACK MODE: what a block this could not read resolves to. "Fall back
 * to the safe thing" and "fall back to the default" happen to be the same value
 * today; they are written as one constant so they stay the same value if the
 * default moves.
 */
export const PAGE_WRITER_FALLBACK_MODE: PageWriterMode = "session";

/**
 * The `pageWriter` block, read leniently — every rejection names the field,
 * what was in it, and what is being used instead. The removed host mode's keys
 * (`mode: "host"`, `timeoutMs`, `command`) are named by `loadConfig` among the
 * old settings instead, and not twice.
 */
function readPageWriter(raw: unknown): {
  mode: PageWriterMode;
  ignored?: string[];
} {
  const raws: string[] = [];
  const out: { mode: PageWriterMode } = {
    mode: PAGE_WRITER_FALLBACK_MODE,
  };
  const done = (): typeof out & { ignored?: string[] } =>
    raws.length === 0 ? out : { ...out, ignored: tidy(raws) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    raws.push(`"pageWriter" was not an object; using mode ${PAGE_WRITER_FALLBACK_MODE}`);
    return done();
  }
  const w = raw as Record<string, unknown>;
  const mode = w["mode"];
  if (typeof mode === "string" && (PAGE_WRITER_MODES as readonly string[]).includes(mode)) {
    out.mode = mode as PageWriterMode;
  } else if (mode !== undefined && mode !== "host") {
    raws.push(
      `"pageWriter.mode" was ${JSON.stringify(mode)}, which is not ${PAGE_WRITER_MODES.join(", ")}; using ${PAGE_WRITER_FALLBACK_MODE}`,
    );
  }
  // A key nobody here knows is named rather than passed over: a person who
  // typed `"modes"` gets told so instead of watching the block do nothing.
  // (`command` and `timeoutMs` are named by `loadConfig`, among the old settings.)
  for (const key of Object.keys(w)) {
    if (key !== "mode" && key !== "command" && key !== "timeoutMs") {
      raws.push(`"pageWriter.${key}" is not a setting this reads; it was ignored`);
    }
  }
  return done();
}

/**
 * The `dreaming` block, read leniently. A model name is one token that does
 * not start with a dash — it goes on a command line (`--model <name>`), and a
 * value that looked like a flag would be read as one.
 */
function readDreaming(raw: unknown): { model?: string; timeoutMs?: number; maxTurns?: number; ignored?: string[] } {
  const raws: string[] = [];
  const out: { model?: string; timeoutMs?: number; maxTurns?: number } = {};
  const done = (): typeof out & { ignored?: string[] } => (raws.length === 0 ? out : { ...out, ignored: tidy(raws) });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    raws.push(`"dreaming" was not an object; it was ignored`);
    return done();
  }
  const d = raw as Record<string, unknown>;
  const model = d["model"];
  if (typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:[\]/-]*$/.test(model.trim())) {
    out.model = model.trim();
  } else if (model !== undefined) {
    raws.push(`"dreaming.model" was ${JSON.stringify(model)}, which is not a model name; the default model is used`);
  }
  const timeoutMs = d["timeoutMs"];
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    out.timeoutMs = timeoutMs;
  } else if (timeoutMs !== undefined) {
    raws.push(`"dreaming.timeoutMs" was ${JSON.stringify(timeoutMs)}; using the default watchdog`);
  }
  const maxTurns = d["maxTurns"];
  if (typeof maxTurns === "number" && Number.isInteger(maxTurns) && maxTurns > 0) {
    out.maxTurns = maxTurns;
  } else if (maxTurns !== undefined) {
    raws.push(`"dreaming.maxTurns" was ${JSON.stringify(maxTurns)}; using the default`);
  }
  for (const key of Object.keys(d)) {
    if (key !== "model" && key !== "timeoutMs" && key !== "maxTurns") raws.push(`"dreaming.${key}" is not a setting this reads; it was ignored`);
  }
  return done();
}

/**
 * The `snapshots` block, read leniently — the FIRST place in this file that
 * never stands the configuration down.
 *
 * Every rejection here names the field, what was in it, and what is being used
 * instead, because "ignored silently" is the failure mode this block was moved
 * out of strictness to avoid. `adapters/snapshots.ts#keepOf` owns the numeric
 * fallback and is not restated; the two paths fall back to "no configured path",
 * which means the default location beside the store.
 */
/** How much of one ignored line, and how many lines, ever leave this function. */
const IGNORED_LINE_CHARS = 120;
const IGNORED_LINES = 8;
/** The cap for a `retired` line (see `loadConfig`). */
const RETIRED_LINE_CHARS = 240;

/**
 * The `ignored` phrases, made safe to print.
 *
 * They are built from the owner's own configuration file, and they end up on a
 * doctor line in his terminal. A key carrying ANSI escapes was measured reaching
 * that terminal raw, and a 200,000-character value made a 200,000-character line
 * (second F2 review, MINOR-d). Control characters go, each line is capped, and
 * the list is capped — sanitized HERE, at the one place the phrases are made,
 * rather than at each of the surfaces that print them.
 */
function tidy(lines: readonly string[], lineChars: number = IGNORED_LINE_CHARS): string[] {
  const clean = lines.map((line) => {
    const stripped = line.replace(/[\u0000-\u001f\u007f]/g, "");
    return stripped.length > lineChars ? `${stripped.slice(0, lineChars - 1)}…` : stripped;
  });
  if (clean.length <= IGNORED_LINES) return clean;
  return [
    ...clean.slice(0, IGNORED_LINES),
    `and ${String(clean.length - IGNORED_LINES)} more`,
  ];
}

function readSnapshots(raw: unknown): {
  dir?: string;
  keep?: number;
  mirror?: string;
  ignored?: string[];
} {
  const raws: string[] = [];
  const ignored = (line: string): void => {
    raws.push(line);
  };
  const out: { dir?: string; keep?: number; mirror?: string; ignored?: string[] } = {};
  const done = (): typeof out =>
    raws.length === 0 ? out : { ...out, ignored: tidy(raws) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    ignored('"snapshots" was not an object; the whole block was ignored');
    return done();
  }
  const sn = raw as Record<string, unknown>;
  const known = new Set(["dir", "keep", "mirror"]);
  for (const key of Object.keys(sn)) {
    // An unknown sub-key is REPORTED rather than dropped in silence: a typo'd
    // `"mirrors"` that quietly did nothing is how somebody believes they have a
    // second copy and does not.
    if (!known.has(key)) ignored(`"snapshots.${key}" is not a setting this reads`);
  }
  for (const key of ["dir", "mirror"] as const) {
    const value = sn[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      ignored(`"snapshots.${key}" was not a path; using the default location`);
      continue;
    }
    if (value.trim().length === 0) {
      // Blank meaning "the default" was measured as a surprise: somebody who
      // blanks the value to switch snapshots OFF gets the default location.
      ignored(`"snapshots.${key}" was blank; using the default location`);
      continue;
    }
    if (!isAbsolute(value)) {
      // A relative path resolves against the WORKER's current directory, which
      // is whatever directory the host session happened to be in — copies would
      // scatter one per project and rotation would run inside each.
      ignored(`"snapshots.${key}" must be an absolute path; using the default location`);
      continue;
    }
    out[key] = value;
  }
  const keep = sn["keep"];
  if (keep !== undefined) {
    if (typeof keep !== "number" || !Number.isInteger(keep) || keep <= 0) {
      ignored(
        `"snapshots.keep" was ${JSON.stringify(keep)}; using ${String(SNAPSHOT_DEFAULT_KEEP)}`,
      );
    } else {
      out.keep = keep;
    }
  }
  return done();
}

/**
 * WHICH MODE THE NIGHTLY PAGE WRITER RUNS IN — the one place the default lives.
 *
 * Absent ⇒ `session`: the fallback that needs no background process, so a store
 * a stranger installed grows a page without them configuring anything. An
 * observer is `off` whatever the file says, for the reason every stance check
 * in this package gives: an instrument does not set writers going against a
 * store it may not write.
 */
export function pageWriterMode(config: AdapterConfig): PageWriterMode {
  if (config.observer === true) return "off";
  return config.pageWriter?.mode ?? "session";
}

/**
 * The capability report — one row per host-dependent limit, each saying whether
 * the host actually reported it. This is the "surfaced as a checkable value"
 * half of §4 G4; the "exceeding one is an event" half lives at the call sites.
 */
export function capabilities(config: AdapterConfig): CapabilityReport[] {
  return [
    {
      name: "injectionBudgetBytes",
      // A defaulted ceiling is a value with no report behind it (§2.4).
      reported: config.injectionBudgetBytes !== undefined && config.injectionBudgetDefaulted !== true,
      value: config.injectionBudgetBytes ?? null,
      why: "The host's injection cliff. v1 hardcoded 90% of one host's, as though it were physiology.",
    },
    {
      name: "executionCeilingMs",
      reported: config.executionCeilingMs !== undefined,
      value: config.executionCeilingMs ?? null,
      why: "How long a foreground hook may run before the host gives up on it.",
    },
    {
      name: "socketLifetimeMs",
      reported: config.socketLifetimeMs !== undefined,
      value: config.socketLifetimeMs ?? null,
      why: "Why long calls stream (scar E3, rescoped to the adapter that owns the host).",
    },
  ];
}

/** Where an effective embedder block came from (`resolveEmbedder`). */
export type EmbedderSource =
  /** The configuration names one — on or off, either kind. Used as written. */
  | "explicit"
  /** No block: the local table, switched on. */
  | "default-static"
  /** No block, and the configuration is an observer's: nothing is assumed. */
  | "absent-observer";

/** The local table, switched on — the block an absent one reads as. */
export const DEFAULT_EMBEDDER: { readonly enabled: true; readonly kind: "static" } = {
  enabled: true,
  kind: "static",
};

/**
 * THE RUNTIME DEFAULT FOR AN ABSENT `embedder` BLOCK (roadmap C3, coordinator's
 * ruling 2026-09-23).
 *
 * Absent used to mean OFF, for a privacy reason: the only embedder was a paid
 * third party. The local table has no egress, so that reason is gone — and a
 * configuration written before C3 has no block at all. So:
 *
 *   - **A block the file writes is used exactly as written** (`explicit`),
 *     `{ "enabled": false }` included — that is how somebody says no.
 *   - **No block** → `{ enabled: true, kind: "static" }`.
 *   - **An observer** gets nothing assumed — it opens no embedder anyway, and
 *     an unreadable configuration resolves to one.
 *
 * (Until 2026-09-24 a saved Voyage key kept an absent block off; there are no
 * keys any more, so there is no such exception.) `loadConfig` stays strict and
 * pure; every entry point applies this after it.
 */
export function resolveEmbedder(
  config: AdapterConfig,
): { block: { enabled: boolean; kind?: EmbedderKind } | undefined; source: EmbedderSource } {
  if (config.embedder !== undefined) return { block: config.embedder, source: "explicit" };
  if (config.observer === true) return { block: undefined, source: "absent-observer" };
  return { block: { ...DEFAULT_EMBEDDER }, source: "default-static" };
}

/** The configuration with its effective embedder block — `resolveEmbedder`,
 *  applied. What each entry point hands on after reading its configuration. */
export function withEmbedderDefault(config: AdapterConfig): AdapterConfig {
  const { block, source } = resolveEmbedder(config);
  return source === "explicit" || block === undefined ? config : { ...config, embedder: block };
}

/**
 * CLAUDE CODE'S WAKE CEILING WHEN ITS CONFIGURATION NAMES NONE (2026-10-12).
 *
 * Scar §2.18 keeps the CORE free of a ceiling: the renderer still refuses an
 * undefined one. But this file is the Claude Code adapter's, and 9,000 bytes is
 * that host's number, measured — the one the interactive install has always
 * written and the self page's room is sized against (`PAGE_HOST_BUDGET_BYTES`).
 * The plugin's first run and every scripted install wrote no key until 0.3.20,
 * so their stores never had a wake composed at all: every session woke on the
 * bootstrap line. So the hooks, the worker, the night run and the console fill
 * an absent key with this, at load, and say so (`injectionBudgetDefaulted`;
 * doctor's Config line, `capabilities()` still `reported: false`). Nothing is
 * written back to the file. A key in the file always wins. Claude Desktop's MCP
 * server does NOT apply it: that host has no measured ceiling. But the worker
 * its `wake` starts is this adapter's runner, which does, so a keyless store a
 * Desktop chat wakes from is rendered at 9,000 too (well inside a tool result's
 * `TOOL_RESULT_CHARS`); Desktop's install writes the same file by default.
 */
export const CLAUDE_CODE_BUDGET_BYTES = PAGE_HOST_BUDGET_BYTES;

export function withBudgetDefault(config: AdapterConfig): AdapterConfig {
  if (config.injectionBudgetBytes !== undefined) return config;
  return { ...config, injectionBudgetBytes: CLAUDE_CODE_BUDGET_BYTES, injectionBudgetDefaulted: true };
}

/**
 * `timeZone` from the host configuration at `path` (docs/time.md, 2026-09-25):
 * the zone the hooks and the MCP server date the person's days in. Absent,
 * unreadable or unset: undefined, and the caller follows the machine's zone.
 * Never throws — a reader that cannot find the zone shows the machine's day,
 * which is what doctor's line names when they differ.
 */
export function zoneOfConfig(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return loadConfig(JSON.parse(readFileSync(path, "utf8"))).config.timeZone;
  } catch {
    return undefined;
  }
}

/**
 * `timeZone` from the host configuration BESIDE a store (`<dir>/../claude-code.json`,
 * the file `install` writes), for a reader handed only the store's directory —
 * the console's commands and the dashboard (moved here from `cli/commands.ts`
 * on 2026-10-09, so the dashboard reads the zone the hooks use without
 * importing the console).
 */
export function zoneBeside(dir: string): string | undefined {
  return zoneOfConfig(join(dir, "..", "claude-code.json"));
}
