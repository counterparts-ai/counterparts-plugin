import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SpanBuffer } from "../../core/remember/index.js";
import { strikeSpans } from "../../core/remember/owner-strike-seam.js";
import { loadConfig } from "../config.js";
import { clearLog, logDates } from "../log/index.js";
import { writeUpPlan } from "../sessions.js";
import { deleteAllCopies, readSnapshotsDir, resolveSnapshotsDir } from "../snapshots.js";
import { EXIT, openStoreAt } from "./commands-shared.js";
import { confirm, isInteractive, isPromptAborted } from "./ui.js";
export const DELETE_KINDS = ["conversation-text", "backups", "activity-log"];
export const OWNER_DELETED_EVENT = "owner.deleted";
const NOTHING_CHANGED = "Nothing has changed.";
function heldText(buffer) {
  const hashes = new Set;
  const sessions = new Set;
  for (const scope of buffer.scopes()) {
    for (const span of [
      ...buffer.spans(scope),
      ...buffer.assistantSpans(scope),
      ...buffer.quarantined(scope),
      ...buffer.claimedSpans(scope)
    ]) {
      if (typeof span.hash === "string")
        hashes.add(span.hash);
      if (typeof span.session === "string" && span.session.length > 0)
        sessions.add(span.session);
    }
  }
  return { hashes: [...hashes], sessions: [...sessions] };
}
export function planConversationText(store) {
  const buffer = new SpanBuffer({ dir: store.dir, observer: true, day: () => store.livedDay() });
  const plan = writeUpPlan({ store, spans: buffer });
  return {
    sessions: plan.length,
    owed: plan.filter((h) => h.owes).length,
    lines: plan.reduce((n, h) => n + h.lines, 0)
  };
}
export function deleteConversationText(store) {
  const buffer = new SpanBuffer({ dir: store.dir, day: () => store.livedDay() });
  const held = heldText(buffer);
  if (held.hashes.length === 0 && held.sessions.length === 0)
    return { ok: true, lines: 0, reason: "NOTHING" };
  const report = strikeSpans(buffer, { scope: null, hashes: held.hashes, sessions: held.sessions, by: "owner" });
  return {
    ok: report.reason !== "OBSERVER" && report.reason !== "IO_FAILED",
    lines: report.struck,
    reason: report.reason
  };
}
function configBeside(dir) {
  const beside = join(dir, "..", "claude-code.json");
  if (!existsSync(beside))
    return {};
  try {
    return loadConfig(JSON.parse(readFileSync(beside, "utf8"))).config;
  } catch {
    return {};
  }
}
function backupDirs(dir) {
  const config = configBeside(dir);
  const out = [];
  const primary = resolveSnapshotsDir(dir, config.snapshots?.dir).dir;
  if (primary !== null)
    out.push(primary);
  const mirror = config.snapshots?.mirror;
  if (mirror !== undefined && !out.includes(mirror))
    out.push(mirror);
  return out;
}
export function planBackups(dir) {
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
function plural(n, one, many = `${one}s`) {
  return `${String(n)} ${n === 1 ? one : many}`;
}
function describe(kind, dir) {
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
      p.owed === 0 ? "None of it is still owed a write-up." : `${plural(p.owed, "session is", "sessions are")} still owed a write-up; ${p.owed === 1 ? "its" : "their"} text is lost if you delete now.`,
      "Memories already made from it are not touched."
    ];
    return { lines, question: "Delete all conversation text now?", empty: p.lines === 0 };
  }
  if (kind === "backups") {
    const p = planBackups(dir);
    const lines = [
      `Backups held: ${plural(p.daily, "daily copy", "daily copies")} and ${plural(p.preMigration, "copy", "copies")} taken before an upgrade.`,
      "After this, rollback has nothing to go back to until the next daily copy."
    ];
    if (p.left > 0)
      lines.push(`${plural(p.left, "other folder")} in the backups directory ${p.left === 1 ? "is" : "are"} not ours and will be left.`);
    return { lines, question: "Delete all backups now?", empty: p.daily + p.preMigration === 0 };
  }
  const days = logDates(dir).length;
  return {
    lines: [`Activity log: ${plural(days, "day")} of files.`, "It holds what the processes did, never what was said."],
    question: "Delete the activity log now?",
    empty: days === 0
  };
}
function act(kind, dir, store) {
  if (kind === "conversation-text") {
    const before = planConversationText(store);
    const r = deleteConversationText(store);
    return {
      ok: r.ok,
      said: r.ok ? [`Deleted ${plural(r.lines, "line")} of conversation text from ${plural(before.sessions, "session")}.`] : [`The delete did not finish (${r.reason}); ${plural(r.lines, "line")} went. Run it again.`],
      counts: { sessions: before.sessions, owed: before.owed, lines: r.lines }
    };
  }
  if (kind === "backups") {
    let copies = 0;
    let left = 0;
    const errors = [];
    for (const d of backupDirs(dir)) {
      try {
        const r = deleteAllCopies(dir, d);
        copies += r.deleted.length;
        left += r.left.length;
        errors.push(...r.errors);
      } catch (err) {
        errors.push(String(err.message ?? err));
      }
    }
    const said = [`Deleted ${plural(copies, "backup")}.`];
    if (left > 0)
      said.push(`Left ${plural(left, "folder")} that ${left === 1 ? "is" : "are"} not ours.`);
    for (const e of errors.slice(0, 5))
      said.push(`  could not: ${e}`);
    return { ok: errors.length === 0, said, counts: { copies, left, errors: errors.length } };
  }
  const r = clearLog(dir);
  return {
    ok: r.failed === 0,
    said: [`Deleted ${plural(r.removed, "day")} of activity log.${r.failed > 0 ? ` ${plural(r.failed, "file")} would not go.` : ""}`],
    counts: { files: r.removed, failed: r.failed }
  };
}
export async function deleteCommand(dir, io, env, positional, flags) {
  const kind = positional[0];
  if (kind === undefined || !DELETE_KINDS.includes(kind) || positional.length > 1) {
    io.err(`delete takes one kind: ${DELETE_KINDS.join(", ")}.`);
    return EXIT.usage;
  }
  const k = kind;
  const plan = describe(k, dir);
  for (const line of plan.lines)
    io.out(line);
  if (plan.empty) {
    io.out(`There is nothing to delete. ${NOTHING_CHANGED}`);
    return EXIT.ok;
  }
  if (flags["yes"] !== true) {
    if (!isInteractive(io, env)) {
      io.out(`${NOTHING_CHANGED} To delete: counterparts delete ${k} --yes`);
      return EXIT.ok;
    }
    let go;
    try {
      go = await confirm(io, plan.question, { default: false });
    } catch (err) {
      if (!isPromptAborted(err))
        throw err;
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
    for (const line of done.said)
      io.out(line);
    try {
      store.appendEvent({
        name: OWNER_DELETED_EVENT,
        day: store.livedDay(),
        payload: { kind: k, ok: done.ok, ...done.counts }
      });
    } catch {
      io.err("(the record of this delete could not be written)");
    }
    return done.ok ? EXIT.ok : EXIT.failed;
  } finally {
    store.close();
  }
}
