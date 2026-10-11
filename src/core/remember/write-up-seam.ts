/**
 * THE WRITE-UP MARK — the one way a session that owes a write-up stops owing.
 *
 * `owes.ts` keeps a session's captured text for as long as it owes a write-up.
 * This mark is what ends that: once a session is marked written up, its text
 * ages out 7 days later. So a mark is a DELETION ON A SEVEN-DAY FUSE, and the
 * PR #189 re-review (R1) found it was a public method on `SpanBuffer` — which
 * `Counterpart.spans` hands to everything that holds a `Counterpart` — taking
 * any scope (and CREATING it), any session, and free text for `by`.
 *
 * **Why it is a seam and not a method** — the strike's reason, exactly
 * (`owner-strike-seam.ts`). The buffer hands this module a capability at
 * construction (a WeakMap the rest of the program cannot see), and
 * `test/cli.test.ts` pins who may import this file: `remember/` itself, and the
 * next-session write-up's door (roadmap C2) at the one path named in that pin.
 * Nothing reaches the mark by holding a `SpanBuffer`.
 *
 * **What it refuses, by name:**
 *   - `by` outside `WRITE_UP_BY` — the record carries a fixed word, never text;
 *   - a scope the buffer has never held (`scopes.json`) — it never ADDS one;
 *   - a session that holds no text in that scope — there is nothing to write up;
 *   - anything at all under observer (the `writeup` write site's stand-down).
 */
import { appendFileSync, existsSync } from "node:fs";

import type { Span, SpanKind, WriteSite, WriteUpRecord } from "./spans.js";

/** Who may be recorded as having written a session up. A fixed set, so the
 *  record never carries a word a caller chose. `api` is the opt-in crash sweep
 *  (roadmap C2, 2026-09-23): the worker marks a crashed session only when every
 *  one of its words, in every project, was read and came back ok. A session
 *  with words in QUARANTINE — what the sweep failed to read — is NOT marked; it
 *  stays owed and is offered to the next session instead. */
export const WRITE_UP_BY = ["next-session", "owner", "api"] as const;
export type WriteUpBy = (typeof WRITE_UP_BY)[number];

export type WriteUpReason = "RECORDED" | "OBSERVER" | "BAD_BY" | "UNKNOWN_SCOPE" | "NO_TEXT" | "IO_FAILED";

/** What a `SpanBuffer` hands this module, and nothing else. */
export interface WriteUpAccess {
  readonly observer: boolean;
  scopes(): string[];
  scopeDir(scope: string): string;
  path(scope: string, name: string): string;
  streamPath(scope: string, kind: SpanKind): string;
  claimFiles(scope: string): string[];
  readLines<T>(file: string): T[];
  mutate<T>(
    site: WriteSite,
    fn: () => T,
  ): { ok: true; value: T } | { ok: false; reason: "OBSERVER" | "IO_FAILED"; code: string };
  emit(name: string, ref?: string, data?: Record<string, string | number | boolean | null>): void;
  now(): number;
}

const GRANTS = new WeakMap<object, WriteUpAccess>();

/** Called once, by `SpanBuffer`'s constructor. */
export function grantWriteUp(buffer: object, access: WriteUpAccess): void {
  GRANTS.set(buffer, access);
}

/** The text-bearing files a session's words can be in, for one scope. */
function textFiles(access: WriteUpAccess, scope: string): string[] {
  const kinds: SpanKind[] = ["conversation", "jot", "assistant"];
  return [
    ...kinds.map((kind) => access.streamPath(scope, kind)),
    access.path(scope, "quarantine.jsonl"),
    ...access.claimFiles(scope),
  ];
}

/**
 * MARK `session` WRITTEN UP in `scope`. Returns a reason, never throws on a
 * refusal: the caller — C2's door, mid-answer — must be able to say why.
 */
export function recordWriteUp(
  buffer: object,
  input: { scope: string; session: string; by: WriteUpBy },
): WriteUpReason {
  const access = GRANTS.get(buffer);
  if (access === undefined) throw new Error("WRITE_UP_UNGRANTED");
  // STANCE FIRST: an instrument refuses before it has looked at anything, and
  // the stand-down goes through `mutate` so the totality test sees this site.
  if (access.observer) {
    access.mutate("writeup", () => undefined);
    return "OBSERVER";
  }
  if (!(WRITE_UP_BY as readonly string[]).includes(input.by)) return "BAD_BY";
  if (!access.scopes().includes(input.scope) || !existsSync(access.scopeDir(input.scope))) {
    return "UNKNOWN_SCOPE";
  }
  const holds = textFiles(access, input.scope).some((file) =>
    access.readLines<Span>(file).some((s) => s.session === input.session && typeof s.text === "string"),
  );
  if (!holds) return "NO_TEXT";
  const record: WriteUpRecord = { session: input.session, at: access.now(), by: input.by };
  const out = access.mutate("writeup", () => {
    appendFileSync(access.path(input.scope, "writeups.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  });
  if (!out.ok) return out.reason === "OBSERVER" ? "OBSERVER" : "IO_FAILED";
  access.emit("remember.writeup", input.session, { by: input.by });
  return "RECORDED";
}
