/**
 * THE PRIMACY RESOLVER — who delivers, for the parallel run only.
 *
 * For one or two weeks v2 runs BESIDE v1 (bansai) on the owner's real sessions.
 * The parallel-run contract's G3 is that exactly one system delivers: two wakes,
 * two recall blocks and two episode asks in the same context is not a comparison,
 * it is noise the owner has to live inside.
 *
 * v1 already owns the switch. It reads `~/.memory-ab/assignment.json` — the file
 * the retired engram pairing left behind — and MUTES its wake, its recall
 * injection and its episode ask only when the resolved system is `engram`. v2
 * occupies the slot engram vacated: `override: "engram"` means "the other one
 * delivers today", and the other one is now this.
 *
 *   {"mode":"alternate-day","anchor":"2026-07-17","override":"bansai"}
 *
 * **The rule that makes the joint failure state safe: we FAIL TOWARD MUTE.**
 * v1 fails toward INJECT — a missing, torn or unrecognized file resolves to
 * "both", and v1 speaks. So this resolver delivers on exactly ONE reading of the
 * file (it parsed, and `override` is the string `engram`) and stands down on
 * every other reading, named. Two failing resolvers therefore land on v1-only,
 * never on silence and never on a double injection.
 *
 * `assignmentHealth()` is the preflight's half. `override: null` is the state
 * that must not exist during the run: v1 would fall back to `alternate-day`
 * against a system that no longer exists and mute ITSELF every other day, while
 * v2 (reading no `engram`) mutes every day — the silence neither resolver's own
 * fail direction can produce alone. The preflight asserts it away before Phase P
 * starts rather than discovering it as a quiet day.
 *
 * Nothing here throws, nothing here caches, nothing here writes. The directory
 * is resolved AT CALL TIME so a test (and the preflight) can redirect it with
 * `MEMORY_AB_DIR` without this module having been loaded in a particular order.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The one environment variable that moves the A/B directory. Tests use it. */
export const AB_DIR_ENV = "MEMORY_AB_DIR";

/** The system v1's assignment file names when it means "stand down". */
export const V2_OVERRIDE = "engram";

/** Read at call time, never cached: the directory may move between calls. */
export function abDir(): string {
  return process.env[AB_DIR_ENV] ?? join(homedir(), ".memory-ab");
}

export function assignmentPath(): string {
  return join(abDir(), "assignment.json");
}

export type AssignmentState = "ok" | "missing" | "unreadable" | "malformed";

/** v1's file, as far as v2 is entitled to understand it. Strings or null. */
export interface Assignment {
  readonly override: string | null;
  readonly mode: string | null;
  readonly anchor: string | null;
  readonly state: AssignmentState;
}

/**
 * A pure read. Never throws — a resolver that can throw is a resolver that can
 * fail a hook, and the fail direction would then be the host's, not ours.
 */
export function readAssignment(): Assignment {
  const empty = { override: null, mode: null, anchor: null } as const;
  const path = assignmentPath();
  if (!existsSync(path)) return { ...empty, state: "missing" };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ...empty, state: "unreadable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A torn write mid-run reads as unreadable, not as an assignment.
    return { ...empty, state: "unreadable" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...empty, state: "malformed" };
  }
  const rec = parsed as Record<string, unknown>;
  const str = (key: string): string | null =>
    typeof rec[key] === "string" ? (rec[key] as string) : null;
  return { override: str("override"), mode: str("mode"), anchor: str("anchor"), state: "ok" };
}

export type PrimacyReason =
  | "override-engram"
  | "override-bansai"
  | "override-absent"
  | "file-missing"
  | "unreadable"
  | "malformed";

export interface Primacy {
  /** True on exactly one reading of the file. Everything else is a stand-down. */
  readonly deliver: boolean;
  /** Who is delivering right now, as the daily record spells it. */
  readonly system: "v1" | "v2";
  readonly reason: PrimacyReason;
}

/**
 * Should v2 deliver into this session's context?
 *
 * TRUE iff the file parses and `override === "engram"`. Every other reading is
 * a named refusal — the fail-toward-mute rule at the top of this file.
 */
export function primacy(): Primacy {
  const assignment = readAssignment();
  if (assignment.state === "missing") return mute("file-missing");
  if (assignment.state === "unreadable") return mute("unreadable");
  if (assignment.state === "malformed") return mute("malformed");
  if (assignment.override === V2_OVERRIDE) {
    return { deliver: true, system: "v2", reason: "override-engram" };
  }
  if (assignment.override === "bansai") return mute("override-bansai");
  // null, "none", "counterparts", or any other string: v1 does not read it as
  // "stand down", so v2 must not read it as "deliver".
  return mute("override-absent");
}

function mute(reason: PrimacyReason): Primacy {
  return { deliver: false, system: "v1", reason };
}

export interface AssignmentHealth {
  /** Only an EXPLICIT `bansai` or `engram` is a state the run may start in. */
  readonly healthy: boolean;
  readonly reason: PrimacyReason;
  /** Advisory: `alternate-day` against a retired engram is the latent hazard. */
  readonly mode: string | null;
  readonly override: string | null;
}

/**
 * The preflight's check. Healthy requires `override` to be exactly `bansai` or
 * `engram` — the two readings under which the two resolvers cannot both mute.
 * `mode` rides along unjudged so the preflight can note that a file whose
 * override is ever cleared falls back to day-alternation against a system that
 * is not there any more.
 */
export function assignmentHealth(): AssignmentHealth {
  const assignment = readAssignment();
  const verdict = primacy();
  const healthy =
    assignment.state === "ok" &&
    (assignment.override === V2_OVERRIDE || assignment.override === "bansai");
  return {
    healthy,
    reason: verdict.reason,
    mode: assignment.mode,
    override: assignment.override,
  };
}
