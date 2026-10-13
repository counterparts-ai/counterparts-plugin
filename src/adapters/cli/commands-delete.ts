/**
 * `delete <kind>` — DELETE ONE KIND OF DATA, AND NOTHING ELSE (Mike, 2026-10-13).
 *
 * Three kinds, each one sentence of the policy:
 *
 *   - `conversation-text` — every word of conversation the store still holds
 *     (the span buffer: conversation, the assistant's turns, jots, quarantine,
 *     claims in flight), through `remember/`'s own strike — the one door that
 *     destroys a span. Sessions still owed a write-up are counted first and
 *     said out loud: their text is lost with the rest.
 *   - `backups` — every daily snapshot and every pre-migration copy this
 *     package wrote, in the snapshots directory and its mirror, taken apart by
 *     name (`snapshots.ts#deleteAllCopies`). Rollback has nothing to go back to
 *     afterwards, and the console says so before it asks.
 *   - `activity-log` — the process log's dated files (`sessions/log/`).
 *
 * Memories have `start-fresh`, and are not a kind here; nor are the dream
 * journal and the self page (lightly held: not unless asked).
 *
 * **One shape for all three.** No `--yes`: the plan, in counts, and "Nothing has
 * changed". A terminal is then asked once; anything that cannot ask (a pipe, a
 * script, the dashboard, which asks in the browser first) passes `--yes`. Each
 * delete that ran leaves one `owner.deleted` row — the kind and counts, never a
 * word, a hash or a path. Under observer it refuses (`OWNER_OPS`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SpanBuffer } from "../../core/remember/index.js";
// The buffer's destruction seam — this directory may import it, and
// `test/cli.test.ts` pins that nothing outside it does.
import { strikeSpans } from "../../core/remember/owner-strike-seam.js";
import type { Store } from "../../core/store/index.js";
import { loadConfig } from "../config.js";
import type { AdapterConfig } from "../config.js";
import { clearLog, logDates } from "../log/index.js";
import { writeUpPlan } from "../sessions.js";
import { deleteAllCopies, readSnapshotsDir, resolveSnapshotsDir } from "../snapshots.js";

import { EXIT, openStoreAt } from "./commands-shared.js";
import type { Io } from "./commands-shared.js";
import { confirm, isInteractive, isPromptAborted } from "./ui.js";
import type { UiEnv } from "./ui.js";

export const DELETE_KINDS = ["conversation-text", "backups", "activity-log"] as const;
export type DeleteKind = (typeof DELETE_KINDS)[number];

/** The row each delete that ran leaves. Kind and counts only. */
export const OWNER_DELETED_EVENT = "owner.deleted";

const NOTHING_CHANGED = "Nothing has changed.";

// ── conversation text ───────────────────────────────────────────────────────

/** Every hash and session the buffer holds text for, from the four readers
 *  retention counts. Naming hashes as well as sessions means a line that
 *  carries no session is not missed. */
function heldText(buffer: SpanBuffer): { hashes: string[]; sessions: string[] } {
  const hashes = new Set<string>();
  const sessions = new Set<string>();
  for (const scope of buffer.scopes()) {
    for (const span of [
      ...buffer.spans(scope),
      ...buffer.assistantSpans(scope),
      ...buffer.quarantined(scope),
      ...buffer.claimedSpans(scope),
    ]) {
      if (typeof span.hash === "string") hashes.add(span.hash);
      if (typeof span.session === "string" && span.session.length > 0) sessions.add(span.session);
    }
  }
  return { hashes: [...hashes], sessions: [...sessions] };
}

/** What the store holds of conversation text now. Counts, never words. */
export function planConversationText(store: Store): { sessions: number; owed: number; lines: number } {
  const buffer = new SpanBuffer({ dir: store.dir, observer: true, day: () => store.livedDay() });
  const plan = writeUpPlan({ store, spans: buffer });
  return {
    sessions: plan.length,
    owed: plan.filter((h) => h.owes).length,
    lines: plan.reduce((n, h) => n + h.lines, 0),
  };
}

/** Strike every line of text the buffer holds, recorded `by: "owner"`. */
export function deleteConversationText(store: Store): { ok: boolean; lines: number; reason: string } {
  const buffer = new SpanBuffer({ dir: store.dir, day: () => store.livedDay() });
  const held = heldText(buffer);
  if (held.hashes.length === 0 && held.sessions.length === 0) return { ok: true, lines: 0, reason: "NOTHING" };
  const report = strikeSpans(buffer, { scope: null, hashes: held.hashes, sessions: held.sessions, by: "owner" });
  return {
    ok: report.reason !== "OBSERVER" && report.reason !== "IO_FAILED",
    lines: report.struck,
    reason: report.reason,
  };
}

// ── backups ─────────────────────────────────────────────────────────────────

/** The configuration beside the store (`<base>/claude-code.json`), or none. */
function configBeside(dir: string): AdapterConfig {
  const beside = join(dir, "..", "claude-code.json");
  if (!existsSync(beside)) return {};
  try {
    return loadConfig(JSON.parse(readFileSync(beside, "utf8"))).config;
  } catch {
    return {};
  }
}

/** The directories copies live in: the snapshots directory and its mirror. */
function backupDirs(dir: string): string[] {
  const config = configBeside(dir);
  const out: string[] = [];
  const primary = resolveSnapshotsDir(dir, config.snapshots?.dir).dir;
  if (primary !== null) out.push(primary);
  const mirror = config.snapshots?.mirror;
  if (mirror !== undefined && !out.includes(mirror)) out.push(mirror);
  return out;
}

/** How many copies of ours each directory holds. Read-only. */
export function planBackups(dir: string): { daily: number; preMigration: number; left: number } {
  let daily = 0;
  let preMigration = 0;
  let left = 0;
  for (const d of backupDirs(dir)) {
    const read = readSnapshotsDir(d);
    daily += read.names.length;
    preMigration += read.preMigration.length;
    left += read.preRows.length + read.unrecognised.length;
  }
  return { daily, preMigration, left };
}

// ── the command ─────────────────────────────────────────────────────────────

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** The plan, in words, and the question it ends on. Opens the store read-only
 *  and closes it before anyone is asked. */
function describe(kind: DeleteKind, dir: string): { lines: string[]; question: string; empty: boolean } {
  if (kind === "conversation-text") {
    const store = openStoreAt({ dir, observer: true });
    let p;
    try {
      p = planConversationText(store);
    } finally {
      store.close();
    }
    const lines = [
      `Conversation text held: ${plural(p.sessions, "session")}, ${plural(p.lines, "line")}.`,
      p.owed === 0
        ? "None of it is still owed a write-up."
        : `${plural(p.owed, "session is", "sessions are")} still owed a write-up; ${p.owed === 1 ? "its" : "their"} text is lost if you delete now.`,
      "Memories already made from it are not touched.",
    ];
    return { lines, question: "Delete all conversation text now?", empty: p.lines === 0 };
  }
  if (kind === "backups") {
    const p = planBackups(dir);
    const lines = [
      `Backups held: ${plural(p.daily, "daily copy", "daily copies")} and ${plural(p.preMigration, "copy", "copies")} taken before an upgrade.`,
      "After this, rollback has nothing to go back to until the next daily copy.",
    ];
    if (p.left > 0) lines.push(`${plural(p.left, "other folder")} in the backups directory ${p.left === 1 ? "is" : "are"} not ours and will be left.`);
    return { lines, question: "Delete all backups now?", empty: p.daily + p.preMigration === 0 };
  }
  const days = logDates(dir).length;
  return {
    lines: [`Activity log: ${plural(days, "day")} of files.`, "It holds what the processes did, never what was said."],
    question: "Delete the activity log now?",
    empty: days === 0,
  };
}

/** Do it, and say what happened. Returns the counts for the row. */
function act(kind: DeleteKind, dir: string, store: Store): { ok: boolean; said: string[]; counts: Record<string, number> } {
  if (kind === "conversation-text") {
    const before = planConversationText(store);
    const r = deleteConversationText(store);
    return {
      ok: r.ok,
      said: r.ok
        ? [`Deleted ${plural(r.lines, "line")} of conversation text from ${plural(before.sessions, "session")}.`]
        : [`The delete did not finish (${r.reason}); ${plural(r.lines, "line")} went. Run it again.`],
      counts: { sessions: before.sessions, owed: before.owed, lines: r.lines },
    };
  }
  if (kind === "backups") {
    let copies = 0;
    let left = 0;
    const errors: string[] = [];
    for (const d of backupDirs(dir)) {
      try {
        const r = deleteAllCopies(dir, d);
        copies += r.deleted.length;
        left += r.left.length;
        errors.push(...r.errors);
      } catch (err) {
        errors.push(String((err as Error).message ?? err));
      }
    }
    const said = [`Deleted ${plural(copies, "backup")}.`];
    if (left > 0) said.push(`Left ${plural(left, "folder")} that ${left === 1 ? "is" : "are"} not ours.`);
    for (const e of errors.slice(0, 5)) said.push(`  could not: ${e}`);
    return { ok: errors.length === 0, said, counts: { copies, left, errors: errors.length } };
  }
  const r = clearLog(dir);
  return {
    ok: r.failed === 0,
    said: [`Deleted ${plural(r.removed, "day")} of activity log.${r.failed > 0 ? ` ${plural(r.failed, "file")} would not go.` : ""}`],
    counts: { files: r.removed, failed: r.failed },
  };
}

export async function deleteCommand(
  dir: string,
  io: Io,
  env: UiEnv,
  positional: readonly string[],
  flags: Record<string, string | boolean | undefined>,
): Promise<number> {
  const kind = positional[0];
  if (kind === undefined || !(DELETE_KINDS as readonly string[]).includes(kind) || positional.length > 1) {
    io.err(`delete takes one kind: ${DELETE_KINDS.join(", ")}.`);
    return EXIT.usage;
  }
  const k = kind as DeleteKind;
  const plan = describe(k, dir);
  for (const line of plan.lines) io.out(line);
  if (plan.empty) {
    io.out(`There is nothing to delete. ${NOTHING_CHANGED}`);
    return EXIT.ok;
  }
  if (flags["yes"] !== true) {
    if (!isInteractive(io, env)) {
      io.out(`${NOTHING_CHANGED} To delete: counterparts delete ${k} --yes`);
      return EXIT.ok;
    }
    let go: boolean;
    try {
      go = await confirm(io, plan.question, { default: false });
    } catch (err) {
      if (!isPromptAborted(err)) throw err;
      go = false;
    }
    if (!go) {
      io.out(NOTHING_CHANGED);
      return EXIT.refused;
    }
  }
  const store = openStoreAt({ dir });
  try {
    const done = act(k, dir, store);
    for (const line of done.said) io.out(line);
    try {
      store.appendEvent({
        name: OWNER_DELETED_EVENT,
        day: store.livedDay(),
        payload: { kind: k, ok: done.ok, ...done.counts },
      });
    } catch {
      io.err("(the record of this delete could not be written)");
    }
    return done.ok ? EXIT.ok : EXIT.failed;
  } finally {
    store.close();
  }
}
