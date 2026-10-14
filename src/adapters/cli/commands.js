import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { localDate } from "../../core/time.js";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { CLAIMED_DEFAULT_META_KEY } from "../../core/mint.js";
import {
  ID_PREFIX,
  Store,
  storeExists
} from "../../core/store/index.js";
import { defaultSnapshotsDir } from "../../core/store/paths.js";
import { MERGED_ARCHIVE_REASON, unarchiveMerged } from "../../core/store/owner-op-seam.js";
import { readProseWalking } from "../../core/store/walk-seam.js";
import {
  implicitConfigRefusal,
  resolveConfigPath
} from "../config-path.js";
import { OBSERVER_ENV, observerFromEnv, unreadableStanceLine } from "../stance-env.js";
import { zoneBeside } from "../config.js";
import { openEmbedder } from "../claude-code/embed-client.js";
import { exportStore } from "./export.js";
import {
  BIN,
  HOST_EVENTS
} from "./install.js";
import { repairDates } from "./repair-dates.js";
import { settleListLines } from "./settle.js";
import { coverageLines } from "./coverage.js";
import { REFLECTED_FEELING_KEY } from "../../core/sleep/index.js";
import { confirm, isInteractive, isPromptAborted } from "./ui.js";
import { BINARY, packagePath } from "../runtime.js";
import { installRoute } from "../plugin.js";
import { DESKTOP_HOST } from "../hosts.js";
import { NO_PAGE_VERSION } from "../../core/self/index.js";
import { feelingsLine } from "../feelings-line.js";
import { COMMAND_DETAIL, CONSOLE_FOOTER, advancedHelp, shortHelp } from "./help.js";
import {
  EXIT,
  parse,
  describeDirRefusal,
  resolveDir,
  upgradePending,
  requireDirFlagForBulkWrite,
  openStoreAt
} from "./commands-shared.js";
import {
  doctorCommand,
  statusCommand,
  probeCommand,
  firedCommand,
  logCommand,
  coverageCommand
} from "./commands-readings.js";
import {
  catchUpEntry,
  selfPageCommand,
  dreamCommand,
  coreCommand,
  claimsEraCommand,
  settleCommand,
  aboutCommand
} from "./commands-self.js";
import {
  installCommand,
  installDesktop,
  installInteractive,
  hostWiringCommand,
  initCommand
} from "./commands-install.js";
import { dashboardCommand } from "./commands-dashboard.js";
import { startFreshCommand, rollbackCommand } from "./commands-start-fresh.js";
import { noteCommand, recallCommand, backupCommand, exportCommand } from "./commands-note.js";
import { removeCommand } from "./commands-remove.js";
import { deleteCommand } from "./commands-delete.js";
import {
  verifyCommand,
  migrateCacheCommand,
  backfillClaimsCommand,
  repairDatesCommand
} from "./commands-verify.js";
import { scopeCommand, rebriefCommand } from "./commands-scope.js";
export { EXIT, parse, openCounterpart, snapshotsDirBeside } from "./commands-shared.js";
export { logEntryLine, firedLines, DOCTOR_RED_EXIT } from "./commands-readings.js";
export { carryForward, KNOWN_HOSTS } from "./commands-install.js";
export { DASHBOARD_DEFAULT_PORT, dashboardLine } from "./commands-dashboard.js";
export {
  STORE_STARTED_KEY,
  STORE_STARTED_BY_KEY,
  STORE_PREVIOUS_PARKED_KEY
} from "./commands-start-fresh.js";
export { askEmbedder, ASK_SHOWN, ASK_GIST_CHARS, askGist, askMeta, printAskList } from "./commands-note.js";
export { eventLogLines } from "./commands-verify.js";
export { hostCeiling } from "./commands-scope.js";
export const COMMANDS = [
  "status",
  "install",
  "connect",
  "disconnect",
  "uninstall",
  "init",
  "start-fresh",
  "rollback",
  "note",
  "ask",
  "recall",
  "export",
  "backup",
  "remove",
  "delete",
  "verify",
  "migrate-cache",
  "backfill-claims",
  "repair-dates",
  "repair-merged-beliefs",
  "claims-era",
  "rebrief",
  "probe-oq4",
  "mechanisms",
  "fired",
  "log",
  "doctor",
  "scope",
  "self-page",
  "dream",
  "core",
  "settle",
  "about",
  "coverage",
  "catch-up",
  "dashboard",
  "version",
  "help"
];
export const OWNER_OPS = [
  "install",
  "connect",
  "disconnect",
  "uninstall",
  "init",
  "start-fresh",
  "rollback",
  "note",
  "backup",
  "remove",
  "delete",
  "verify",
  "migrate-cache",
  "backfill-claims",
  "repair-dates",
  "repair-merged-beliefs",
  "rebrief",
  "catch-up"
];
export const BINARY_CONNECT_REFUSAL = "This is Counterparts' single program, the one the Claude Code plugin downloads when a computer has no Bun or Node.js. " + "It doesn't connect hosts itself: the plugin already runs the hooks and the memory server, and anything wired to this file " + "would stop working when the plugin is uninstalled. To wire Claude Code or Claude Desktop by hand, install Counterparts with " + "npm (`npm i -g counterparts`) and run `counterparts connect` from that install.";
export function usage() {
  return shortHelp();
}
const VERSION_UNKNOWN = "(version unknown — package.json is not beside the running code)";
let readVersion = null;
export function packageVersion() {
  if (readVersion !== null)
    return readVersion;
  try {
    const raw = readFileSync(packagePath("package.json"), "utf8");
    const said = JSON.parse(raw)["version"];
    readVersion = typeof said === "string" && said.length > 0 ? said : VERSION_UNKNOWN;
  } catch {
    readVersion = VERSION_UNKNOWN;
  }
  return readVersion;
}
export function versionLine() {
  return `${BIN.cli} ${packageVersion()}`;
}
async function bareConsole(io, env, opts) {
  const named = resolveConfigPath([], env, opts.home ?? homedir());
  const unnameable = named.refusal !== null || implicitConfigRefusal(named, env) !== null;
  const configured = !unnameable && existsSync(named.path);
  if (isInteractive(io, env) && !unnameable && !configured) {
    let go;
    try {
      go = await confirm(io, "No memory here yet. Set it up now?", { default: true });
    } catch (err) {
      if (!isPromptAborted(err))
        throw err;
      io.err("");
      io.err("stopped; nothing was changed.");
      return EXIT.refused;
    }
    if (go) {
      io.out("");
      return await run(["install"], opts);
    }
    io.out(usage());
    return EXIT.ok;
  }
  io.out(usage());
  if (!isInteractive(io, env)) {
    io.out(`Not set up yet? \`${BIN.cli} install\` does it, and it is safe to run again.`);
  }
  return EXIT.ok;
}
export const COMMON_FLAGS = ["dir", "observer", "help"];
export const COMMAND_FLAGS = {
  status: ["layout"],
  install: ["budget", "name", "embedder", "no-embedder", "force", "config", "no-connect", "yes", "host"],
  connect: ["config", "dry-run"],
  disconnect: ["config", "dry-run"],
  uninstall: ["config", "yes", "park", "delete-memories", "keep-memories", "nothing-is-open", "json"],
  init: ["name"],
  "start-fresh": ["config", "dry-run", "yes", "nothing-is-open", "name", "undo"],
  rollback: ["config", "to", "undo", "upgrade-again", "dry-run", "yes"],
  note: ["kind", "title", "salience", "config"],
  ask: ["id", "json", "full", "page", "mode", "config", "voiced"],
  recall: ["id", "json", "full", "page", "mode", "config", "voiced"],
  export: [
    "out",
    "passphrase",
    "plaintext",
    "markdown",
    "include-confidential",
    "with-versions",
    "into-non-empty",
    "overwrite"
  ],
  backup: ["out"],
  remove: ["confirm", "reason", "strike-by-content-across-scopes", "echo-scan"],
  delete: ["yes"],
  verify: ["rebuild", "drop-vectors", "prune-index", "keep-vectors", "retry-skipped"],
  "migrate-cache": ["apply", "batch", "yes"],
  "backfill-claims": ["apply"],
  "repair-dates": ["apply", "dry-run", "confidence", "import-day", "sample"],
  "repair-merged-beliefs": ["apply", "dry-run"],
  "claims-era": ["on", "off"],
  rebrief: ["budget", "config"],
  "probe-oq4": [],
  mechanisms: ["all"],
  fired: ["all"],
  log: ["date"],
  doctor: ["config", "json", "all"],
  scope: ["on", "off", "pause", "resume", "list", "note", "force", "config"],
  "self-page": ["write", "file", "stdin", "short", "reason", "versions", "version", "restore", "clear", "if-version"],
  dream: ["list", "show", "undo", "all", "setting"],
  core: ["list", "demote", "reaffirm", "reason", "reflected-feeling"],
  settle: ["list", "pair", "holds", "against", "how", "why", "undo"],
  about: ["why"],
  coverage: ["date"],
  "catch-up": ["config", "reowe", "dry-run", "yes"],
  dashboard: ["config", "port", "no-open"],
  version: [],
  help: []
};
export const COMMAND_BLURB = {
  status: "What is held, what left, what was removed. Read-only.",
  install: "Cold start: create the store and write claude-code.json under ~/.counterparts/ (the path the hooks read unless --config names another). At a terminal it asks your name, turns on recall by meaning (a local table — nothing leaves this machine), connects Claude Code (counterparts disconnect undoes that), and offers back any memory a parked uninstall set aside. Anywhere else — a pipe, a script, a CI job — and with --no-connect it prints the host's hooks block and MCP line and changes nothing of the host's.",
  connect: "Connect an AI to your memory: put the five hooks in the host's settings file and register the memory tools. It backs the settings file up first and says the path, keeps every other tool's hooks exactly where they are, repairs an entry of ours that names a path that is gone, and refuses a settings file it cannot parse. Claude Code is the one host it knows today.",
  disconnect: "Disconnect an AI: take the Counterparts hooks back out of the host's settings file and deregister the memory server. It removes only what it recognises as ours; another tool's hooks are never candidates. Your memory is not touched.",
  uninstall: "Leave: disconnect Claude Code, then say where your memory still is and how to remove the package. At a terminal it then asks whether to delete your memory too (Enter keeps it; a yes asks you to type a phrase). Otherwise it never touches your memory unless you say --park (one rename, dated) or --delete-memories (which counts first and asks you to type a phrase).",
  init: "Just a store: create a data dir and PRINT the install steps. For a second store or a scratch one.",
  "start-fresh": "Begin again as a stranger (or --undo to put the parked store back): park the store your configuration names beside itself under a dated name, park its snapshots the same way, and create a blank store at the same path. One atomic rename each — it never copies, never deletes, and never opens the old store, not even read-only. The configuration is kept byte for byte.",
  rollback: "Go back to the version before an upgrade: put the store back from the copy the upgrade took first (the newest one unless --to names another), after saying what would be lost and asking you to type a word. The upgraded database and its cache are set aside beside the store, never deleted, and a hold keeps this version from upgrading or reading the store again until you install the older version, run --upgrade-again, or --undo it. It refuses while a session, a memory server or the dashboard has the store open.",
  note: "Remember this, deliberately — the same two doors the MCP tool uses.",
  ask: "Ask memory a question. Read-only.",
  recall: "Ask memory a question — the same command as `ask`, under its older name. Read-only.",
  export: "A portable copy of the store, encrypted unless you say otherwise.",
  backup: "Snapshot: the canonical DB via VACUUM INTO. The cache is excluded, and so is conversation text: backups never hold it.",
  remove: "The loud removal. With nothing after it, at a terminal, it asks for a memory id or for words to search for, numbers what it finds, lets you pick one or several (or name several ids outright), shows the plan for each, and asks once before it deletes them. --confirm is the scripted door: that exact id, confirmed by typing it back. Anywhere a person cannot be asked — a pipe, a redirect, a CI job — and without --confirm, it prints the plan and changes nothing.",
  delete: "Delete one kind of data, and nothing else: conversation-text (every word of conversation still held — sessions still owed a write-up lose theirs, and it says how many first), backups (every daily copy and every copy taken before an upgrade — rollback then has nothing to go back to) or activity-log (what the processes did, never what was said). Memories are not touched; start-fresh is their door. It prints what it would delete, then asks once at a terminal; anywhere else it changes nothing without --yes. Refuses under observer.",
  verify: "Census of the cache against canonical state. Read-only unless --rebuild, --prune-index or --retry-skipped. --rebuild, --prune-index, --retry-skipped and --drop-vectors require --dir.",
  "migrate-cache": "Convert the cache's vectors from JSON text to float32 BLOBs, in place, and compact the file. Dry run — read-only — unless --apply. --apply requires --dir.",
  "backfill-claims": "Give unclaimed AUTHORED memories the default claimed floor. Dry run unless --apply. --apply requires --dir.",
  "repair-dates": "Give MIGRATED memories carrying the import day their true `learned` date, read off evidence each row already holds — an engram-era id that is a millisecond timestamp, a v1 date field, a session reference, a source path. Counts by confidence and the proposed dates by count. Dry run unless --apply. --apply requires --dir.",
  "repair-merged-beliefs": "Put back beliefs and current-state rows the nightly dedup pass archived as duplicates of an ordinary memory. Dry run unless --apply. --apply requires --dir.",
  "claims-era": "The old-claims era: memories written before this build reached the store are read by the curve at today's default for what they are about (work, the world, me, the owner or us). A default the old build filled in reads at today's, higher or lower; a claim made under the old field text reads at it only when that is lower, and the core, memories about the owner or us, said by the owner, protected, and dated ones still ahead or repeating keep their claim. No claim is rewritten. With no flags it says whether the era is on, since when, and how many memories it reads lower and higher; --off reads every claim as stored again (a memory let go at the floor meanwhile stays archived, readable by id), --on puts the same cutoff back. Reading works under observer; the switch refuses there.",
  rebrief: "Re-render and republish the wake bundle NOW, through the boundary's own renderer.",
  "probe-oq4": "The OQ4 probe: footnotes delivered vs. later expanded, by calendar date, from recall.decision and recall.credit rows, then recall's hit rate — of what it showed, how much a reply expanded or quoted, loud, footnoted and pointer. Read-only.",
  mechanisms: "Is each memory mechanism working? One line per mechanism, with a light (● working this week, ◐ built but not firing, ○ not built yet) and the count from the store behind it, then the plumbing in one line that names only what is failing. --all prints the full report: every part, silent first, when it last fired, how often in the last 7 days, what it turned away, and why the store cannot tell for the ones nothing records. Read-only.",
  fired: "The older name of `mechanisms` — the same command, the same output. --all prints the full report. Read-only.",
  log: "What happened today, in order: one line per thing the hooks, the background worker, the nightly run and the memory tools did — failures, stand-downs, each turn's end, write-ups, the nightly run, the wake. Kept 7 days. Read-only.",
  doctor: "Is the background half alive? The config, the two clocks, the newest sweep, sleep, backfill and credit rows, the spawn refusals and the vector coverage — worst first, each with the line that fixes it. Read-only; exit 1 if anything is red.",
  scope: "Which directories this memory is for: on, observer, off, or paused until you resume it. It writes the host's own registry beside claude-code.json, opens no store, and needs no --dir. A subdirectory inherits its nearest ancestor's entry. On this one command --observer names the MODE, not the console's stance.",
  "self-page": "The written page the wake opens with. With no flags it prints the page, its date and its size; --write --file <path> or --write --stdin replaces it whole, keeping every earlier version; --short <file> beside them gives a page past its room the short version sessions read on a day the wake has no room for it whole (alone, with --write, it is added to the page as it stands); --versions lists those and --version <seq> prints one. Reading works under observer; writing refuses there.",
  dream: "What each dream did, and its undo — and what the waking self made of it. With no flags (or --list), the newest 20 dreams (--list --all for every one): date, state, title and what changed, then the recent reflections; --show <id> prints one dream's journal, every change it made and the reflection after it (--show <rfl_…> prints one reflection: its questions, entry, what it rests on and its morning share); --undo <id> reverses that dream's whole batch (merges come apart, links and gists go, replays and nominations are taken back) and keeps its journal, marked undone — a reflection is lived and stays. Reading works under observer; --undo refuses there.",
  core: 'The core — the memories about me and about us that do not fade. With no flags (or --list), what it holds and which lane carried each one there, what dreams have nominated, what is being reconsidered, and what was sent back; --demote <id> --reason "..." sends one back to ordinary fading from today, records why, and keeps the lanes from promoting it again; --reaffirm <id> --reason "..." keeps one that is being reconsidered (it is not flagged again for what it is); --reflected-feeling on|off opens or closes the core to reflection alone. On (the default): a feeling a reflection records later and a reflection citing a memory both count toward the fast lane, and a reflection may re-label what a memory is about either way — each re-label is recorded with its reason, and one into me, us or the owner is told in the next morning share. Off: nothing reaches the core on a reflection alone — the fast lane needs a feeling felt at the time (not one a reflection recorded later) and an ordinary use after a gap (not a reflection citing it), and a reflection may only move what a memory is about toward work or world. Reading works under observer; the changes refuse there.',
  settle: `Two memories that disagree. With no flags (or --list), the pairs nobody has settled — a dream flags them — and the ones settled lately: how, which holds, who settled it and why; and the corrections held in the last 7 lived days (a memory said it changes or corrects one that didn't look related, so nothing was settled) that nobody has settled since, each with the command that settles it. --pair <id> --holds <memory id> --how changed|corrected|open --why "..." settles one as you (or --holds <id> --against <id> for two memories no dream flagged): changed — both were true at their time, the older fades once and is shown as earlier; corrected — the older was wrong, it leaves recall and stays readable by its id; open — a real disagreement, both kept and shown together. No memory is rewritten. --undo <pair> reverses a settle: the strength comes back, a corrected memory comes back into recall, and the pair is unsettled again. Reading works under observer; the two changes refuse there.`,
  about: "What a memory is about — me (who I am), us (the two of us), owner (you, as a person), work (the craft) or world (anything else). With an id alone, its mark and who set it; with an id and a mark, it changes the mark as you, keeps --why with it, and records it the way a nightly reflection's re-mark is recorded. Unmarked, a fact written in a project (or a skill) counts as that project's work and is shown only there; me, us and owner are shown everywhere and can become part of who I am. An archived memory can be marked too (the mark counts if it comes back); an earlier version's id marks the current one. Reading works under observer; the change refuses there.",
  coverage: "What is written up, and what is not yet, for one date (default today): each session that captured something that day, how much of it is written up, and what is not yet written up — how many pieces, over how long, since when — and whether that is owed (the nightly run catches it up, or counterparts catch-up does now), lapsed (let go unwritten after fourteen days of use — lost to memory; its text is deleted with the rest, never more than 14 days after the session), under the floor, or still at work. Read-only.",
  "catch-up": "Write up, now, every session that ended before it was written up — what the nightly run does each morning, on demand. Oldest first, in batches, each a windowless claude -p of its own allowed one tool (session_end); it prints each batch, then what it caught up and what is left. Sessions may be open meanwhile: one still at work is left for later, one being written up elsewhere is passed over. It uses your Claude subscription like any session. At most 400 parts and an hour a run; what is left stays owed. A part whose every word the session's own chapters or notes already wrote up is passed over, and a part answered with nothing kept and no reason why stays owed. --reowe <run> owes again the parts a run (cup_… or nrn_…) closed with nothing kept, when their words were not yet written up: it prints the plan, then asks for the run's id typed back (--yes skips that, --dry-run stops at the plan); it reads the run from the log, which keeps a week, and refuses by name what it cannot do. Refuses under observer.",
  dashboard: "Open the dashboard in your browser: the web view of the store your configuration names, served on 127.0.0.1 and nowhere else. Ctrl-C stops it. Looking is read-only — it strengthens nothing and deposits nothing. What you do there on purpose (write a note, remove a memory, back up, …) runs through these same commands, and a removal asks you to type the id back.",
  version: "The version of Counterparts you have. It opens nothing.",
  help: "The console's own map. With no argument, the commands a person reaches for, one short line each; with 'advanced', the maintenance shelf and the three flags every command takes; with a command name, that command's whole page."
};
const COMMAND_ARGS = {
  note: ' "<text>"',
  ask: ' "<question>"',
  recall: ' "<question>"',
  remove: " [<id>… | <words>]",
  delete: " conversation-text|backups|activity-log",
  scope: " <path|.>",
  connect: " [claude-code]",
  disconnect: " [claude-code]",
  help: " [advanced | <command>]",
  dream: " [--list [--all] | --show <id> | --undo <id>]",
  core: ' [--demote <id> --reason "..." | --reaffirm <id> --reason "..." | --reflected-feeling on|off]',
  settle: ' [--list | --pair <id> --holds <id> --how changed|corrected|open --why "..." | --undo <pair>]',
  about: ' <id> [me|us|owner|work|world] [--why "..."]',
  coverage: " [--date YYYY-MM-DD]"
};
const NO_DIR_IN_SYNOPSIS = [
  "start-fresh",
  "help",
  "version",
  "connect",
  "disconnect",
  "uninstall"
];
const FLAG_HELP = {
  dir: "the data directory (default: $COUNTERPARTS_DATA_DIR, else ~/.counterparts/store)",
  observer: "stand down: read-only, and every owner operation refuses",
  help: "this page — it opens nothing and writes nothing",
  budget: "the injection ceiling, in bytes",
  name: "the owner's name; it seeds the identity core",
  embedder: "turn recall by meaning on — the local table that ships with the package, where nothing leaves this machine. It is on by default; this is how to turn it back on after --no-embedder",
  "no-embedder": "switch recall by meaning off: recall matches on words alone",
  force: "overwrite configuration this command already wrote once",
  kind: "self, person, entity, skill, place or fact",
  title: "a title for the memory, instead of one taken from its first line",
  salience: "0..1 — how much this one matters",
  id: "one memory, by id, instead of a question",
  full: "the whole facts answer, as the model reads it: a count header and every result's labeled lines (who said it, its status, when it happened and was learned, whether it still holds) — not just the top five, one line each",
  page: "which page of the answer (ten results a page; in meaning mode, eight entries of the arc), with --full or --json",
  mode: "facts (the default): every memory that answers the question, counted and paged — or meaning: what a person, a project or a feeling has been over time, the chapters that hold it in time order",
  json: "machine-readable output — the structured payload rather than the console's rendering",
  voiced: `the question is already in the counterpart's own voice (the dashboard's rewrite): in meaning mode its "I" is the counterpart, so a question about feeling asks about the counterpart's feelings; a facts answer reads no feelings and is the same either way`,
  out: "the directory to write into",
  passphrase: "encrypt the export with this secret",
  plaintext: "do not encrypt the export (said on purpose, never by default)",
  markdown: "export the readable markdown tree instead of the database file: memories, the journal, the self page, and a file per dream and per reflection (its README says what is where)",
  "include-confidential": "include confidential memories in the markdown tree, and the dreams and reflections that rest on one (they are omitted, and counted, by default)",
  "with-versions": "also write out every earlier wording of every memory (markdown only)",
  "into-non-empty": "write into a directory that already holds something",
  overwrite: "replace the files this export's own paths collide with (it says which); without it a collision is a refusal",
  confirm: "the scripted door: this exact id, no search and no picking, confirmed by typing the id back. Without it, a terminal asks and anything else prints the plan and changes nothing",
  reason: "the reason, recorded with the change it makes",
  "strike-by-content-across-scopes": "for a memory whose provenance records no project: chase its words through EVERY project's capture buffer (an exact jot, never a substring). Look at what the dry run lists first",
  "echo-scan": "how many episodes the journal-echo check reads before it stops and says so (default 2000)",
  rebuild: "drop and rebuild the cache instead of counting it",
  "drop-vectors": "let the rebuild lose vectors this console has no embedder to recompute",
  "prune-index": "take the archived and superseded rows out of the text index, keeping the embeddings",
  "keep-vectors": "rebuild the text index and leave every vector where it is",
  "retry-skipped": "put the ids the backfill gave up on back in the rotation: it clears every embed.failed counter and changes nothing else",
  apply: "actually do it — without this, it is a dry run",
  layout: "also print which directories the store keeps and which of them a backup carries",
  all: "print every line in full, including the parts a store this new has had nothing to do with yet",
  config: "an absolute path to the host configuration, instead of ~/.counterparts/claude-code.json ($COUNTERPARTS_CONFIG says the same); install WRITES it there, rebrief reads it, ask and note read whether recall by meaning is on from it, and counterparts-hook and counterparts-mcp take the same flag (the server, the same variable)",
  batch: "rows per transaction while converting (default 500)",
  "dry-run": "say the default out loud: plan and print, change nothing",
  confidence: "high, medium or low — the weakest evidence --apply is allowed to write (default high)",
  "import-day": "YYYY-MM-DD — the day the import ran, instead of the one the store recorded or shows",
  sample: "how many proposed rows to print (default 20)",
  date: "YYYY-MM-DD — another day instead of today, in the store's zone (the log keeps 7 days; coverage reads what is still held)",
  yes: "skip the typed confirmation, and nothing else — it never stands in for --dir, which --apply requires",
  stdin: "read it from standard input (the default whenever stdin is not a terminal)",
  write: "replace the page with what --file or --stdin gives, keeping every earlier version",
  restore: "put an earlier version back, by its seq — itself a new version, itself undoable",
  clear: "unwrite the page: it is kept as a version and the wake goes back to having none",
  "if-version": "only write if the page is still at this version (or 'none' if there was no page); otherwise refuse and change nothing",
  short: "a file holding the page's short version, read on a day the wake has no room for a page past its room; with --write alone, added to the page as it stands",
  file: "the file to read the page from",
  versions: "list the earlier versions, newest first",
  version: "print one earlier version in full, by its seq from --versions",
  on: "remember here: capture, deposit, wake and recall, as everywhere else",
  off: "nothing here: the hooks produce no output and write nothing, and the tools refuse",
  pause: "off for now, remembering what to go back to",
  resume: "undo a pause (or an off): back to what it was, or on",
  list: "print the whole registry, and the file it came from",
  note: "free text recorded beside the entry, for why",
  "no-connect": "do not touch the host at all: print the hooks block and the registration line, and change nothing of theirs — which is also what a pipe, a script and a CI job get",
  port: "the port to serve the dashboard on (default 4747, or $COUNTERPARTS_DASHBOARD_PORT)",
  "no-open": "do not open a browser — just print the address and serve it",
  park: "move the whole directory aside under a dated name — one rename, nothing copied, nothing deleted, and the store is never opened",
  "delete-memories": "destroy it. It counts what is about to go, says the number, and takes a typed phrase; there is no way to answer it from a script",
  "keep-memories": "keep your memory and do not ask: without it, at a terminal, uninstall asks whether to delete it too once Claude Code is disconnected (Enter keeps it)"
};
const INSTALL_FLAG_HELP = {
  host: "claude-desktop connects Claude Desktop's chat instead of Claude Code: the store and configuration as usual, then a counterparts entry merged into Desktop's claude_desktop_config.json (backed up first, other servers untouched). Quit Claude Desktop before running it: Desktop rewrites that file while it runs. claude-code, or no --host, is the ordinary install",
  yes: "kept so a scripted caller need not change, and it answers nothing this command asks: your name and a memory a parked uninstall set aside are questions only a person can answer, and moving somebody's data is never something a flag decides"
};
const HOST_FLAG_HELP = {
  yes: "do not ask: take the ordinary answer to every question this command would put (for uninstall's question about deleting your memory, that answer is keep)",
  json: "for uninstall: one JSON object instead of the screen. Alone it is the plan — what a delete would remove and leave, and whether it can go ahead now — and changes nothing; with --keep-memories it uninstalls. It never deletes: that is typed by a person, at a terminal",
  "nothing-is-open": "you are asserting you have closed every session, dashboard and worker. It is the way past a check that could NOT LOOK — no usable `ps` — and never past one that found something",
  "dry-run": "print what would change and change nothing (this command is NOT dry by default)",
  dir: "REFUSED on this command: what it acts on is decided by the configuration, not by a path on this line. Name the configuration instead, with --config"
};
const SCOPE_FLAG_HELP = {
  observer: "reads and recalls here, records nothing — the mode, not this console's stance",
  dir: "not consulted: this command writes host configuration, never a store",
  force: "overwrite a registry this could not parse (it prints what it could not read first)"
};
const START_FRESH_FLAG_HELP = {
  undo: "put the parked store back: park the blank one, restore the parked one and its snapshots. One rename each, nothing deleted, nothing opened, and a destination that exists is a refusal",
  "nothing-is-open": "with --yes on a store that has something in it: you are asserting you have closed every session, dashboard and MCP server, because nothing here can check that",
  "dry-run": "print every rename and every file this would write, and change nothing (this command is NOT dry by default)",
  dir: "REFUSED on this command: the store parked is the one your configuration names, because that is the one the hooks and the MCP server open. Name the configuration instead, with --config",
  yes: "skip the typed confirmation, and nothing else — it never stands in for closing your sessions first",
  name: "the owner's name; it seeds the NEW store's identity core, exactly as 'install --name' does"
};
const DREAM_FLAG_HELP = {
  list: "the recent dreams, newest first — the default",
  all: "with --list: every dream the store holds, not only the newest 20",
  show: "one dream, by id: its journal and every change it made",
  undo: "reverse one dream's whole batch, by id (the id follows the flag); its journal is kept, marked undone",
  setting: 'auto, ask or off — the nightly run (page writer, dream, reflection). ask (the default): the first session of a day shows you the question in the terminal and waits for you to say "dream" (or "dream on your own", which turns on auto); auto: the first session of a day starts it by itself, in a separate windowless claude -p in the background, and says so in one line; off: no dreams. `counterparts dream` prints the setting.'
};
const SETTLE_FLAG_HELP = {
  list: "what is unsettled, and what was settled lately — the default",
  pair: "the pair to settle, by its id (ctr_…), as the list shows it",
  holds: "the memory that holds now (changed, corrected); with --pair, one of its two",
  against: "without --pair: the memory it changes, corrects or disagrees with",
  how: "changed (both were true at their time: the older fades once, shown as earlier), corrected (the older was wrong: out of recall, readable by its id) or open (both kept, shown together)",
  why: "why, in a short line — kept on the pair's record",
  undo: "reverse one settle, by the pair's id (the id follows the flag): strength back, a corrected memory back in recall, the pair unsettled again"
};
const ABOUT_FLAG_HELP = {
  why: "why, in a short line — kept with the mark's record"
};
const CORE_FLAG_HELP = {
  list: "what the core holds, with lanes, nominations and demotions — the default",
  demote: "send one core memory back to ordinary fading from today, by id; needs --reason",
  reaffirm: "keep one core memory that is being reconsidered, by id; needs --reason. It is not flagged again for what it is",
  reason: "why — recorded with the demotion, and shown by --list",
  "reflected-feeling": "on or off — can a memory reach the core on reflection alone? On (the default): a feeling a reflection records later and a reflection citing a memory both count toward the fast lane, and a reflection may re-label what a memory is about either way — each re-label is recorded with its reason, and one into me, us or the owner is told in the next morning share. Off: nothing reaches the core on a reflection alone — the fast lane needs a feeling felt at the time (not one a reflection recorded later) and an ordinary use after a gap (not a reflection citing it), and a reflection may only move what a memory is about toward work or world."
};
const CLAIMS_ERA_FLAG_HELP = {
  on: "read old claims and defaults at today's default again, from the same cutoff as before",
  off: "read every claim as stored again (no claim was rewritten); a memory let go at the floor while it was on stays archived, readable by id"
};
const ROLLBACK_FLAG_HELP = {
  to: "the pre-migration copy to put back, by its name in the snapshots folder or an absolute path; the default is the newest one taken before the upgrade to the store's version",
  undo: "put the set-aside store back and remove the hold — only while nothing has written to the restored one",
  "upgrade-again": "remove the hold and let this version upgrade the store now, from a new pre-migration copy",
  "dry-run": "print what it would do and what would be lost, and change nothing (this command is NOT dry by default)",
  yes: "for a script or a pipe, where nothing can be typed; refused at a terminal, where you type the word instead",
  dir: "the store to roll back; without it, the one your configuration names"
};
const CATCH_UP_FLAG_HELP = {
  reowe: "a run's id (cup_… or nrn_…): owe again the parts it closed with nothing kept while their words were not yet written up — the plan first, then the id typed back. It reads the run from the log, which keeps a week",
  "dry-run": "with --reowe: print the plan and change nothing",
  yes: "with --reowe: skip typing the run's id back, for a script or a pipe"
};
const DELETE_FLAG_HELP = {
  yes: "delete without asking — for a script or a pipe, which otherwise get the counts and nothing changed"
};
const DASHBOARD_FLAG_HELP = {
  dir: "a store to look at instead of the one your configuration names"
};
export function commandHelp(command) {
  const own = COMMAND_FLAGS[command] ?? [];
  const override = command === "scope" ? SCOPE_FLAG_HELP : command === "start-fresh" ? START_FRESH_FLAG_HELP : command === "rollback" ? ROLLBACK_FLAG_HELP : command === "install" ? INSTALL_FLAG_HELP : command === "dashboard" ? DASHBOARD_FLAG_HELP : command === "catch-up" ? CATCH_UP_FLAG_HELP : command === "connect" || command === "disconnect" || command === "uninstall" ? HOST_FLAG_HELP : command === "dream" ? DREAM_FLAG_HELP : command === "core" ? CORE_FLAG_HELP : command === "claims-era" ? CLAIMS_ERA_FLAG_HELP : command === "settle" ? SETTLE_FLAG_HELP : command === "about" ? ABOUT_FLAG_HELP : command === "delete" ? DELETE_FLAG_HELP : {};
  const flagLine = (name) => {
    const shown = `--${name}${VALUED_FLAGS.includes(name) ? " <value>" : ""}`;
    return `  ${shown.padEnd(20)} ${override[name] ?? FLAG_HELP[name] ?? "(undocumented)"}`;
  };
  const detail = COMMAND_DETAIL[command] ?? [];
  return [
    `counterparts ${command} — ${COMMAND_BLURB[command]}`,
    "",
    `  counterparts ${command}${COMMAND_ARGS[command] ?? ""}${own.length === 0 ? "" : " [flags]"}${NO_DIR_IN_SYNOPSIS.includes(command) ? "" : " [--dir <path>]"}`,
    ...detail.length === 0 ? [] : ["", ...detail],
    "",
    ...own.length === 0 ? ["This command takes no flags of its own."] : [`Flags for ${command}:`, ...own.map(flagLine)],
    "",
    "Options every command takes:",
    ...COMMON_FLAGS.map(flagLine),
    "",
    ...CONSOLE_FOOTER
  ].join(`
`);
}
const VALUED_FLAGS = [
  "dir",
  "reowe",
  "config",
  "port",
  "out",
  "reason",
  "passphrase",
  "name",
  "kind",
  "title",
  "salience",
  "id",
  "budget",
  "batch",
  "confidence",
  "import-day",
  "sample",
  "note",
  "file",
  "version",
  "restore",
  "if-version",
  "mode",
  "show",
  "demote",
  "pair",
  "holds",
  "against",
  "how",
  "why",
  "date",
  "host",
  "to"
];
function editDistance(a, b) {
  const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1;i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1;j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min((row[j - 1] ?? 0) + 1, (rows[i - 1]?.[j] ?? 0) + 1, (rows[i - 1]?.[j - 1] ?? 0) + cost));
    }
    rows.push(row);
  }
  return rows[a.length]?.[b.length] ?? Math.max(a.length, b.length);
}
export function unknownFlag(command, argv) {
  const allowed = [...COMMON_FLAGS, ...COMMAND_FLAGS[command] ?? []];
  for (const token of argv) {
    if (!token.startsWith("--") || token === "--")
      continue;
    const [rawName, inline] = token.slice(2).split("=", 2);
    const name = rawName ?? "";
    if (name.length === 0)
      continue;
    if (!allowed.includes(name)) {
      const near = allowed.map((f) => ({ f, d: editDistance(name, f) })).filter((x) => x.d <= Math.max(2, Math.floor(x.f.length / 3))).sort((a, b) => a.d - b.d)[0];
      return `unknown flag --${name}` + (near === undefined ? "" : `; did you mean --${near.f}?`) + `
  '${command}' takes: ${allowed.map((f) => `--${f}`).join(" ")}` + `
  Nothing was opened and nothing was written.`;
    }
    if (VALUED_FLAGS.includes(name) && inline === undefined) {
      const next = argv[argv.indexOf(token) + 1];
      if (next === undefined || next.startsWith("--")) {
        return `--${name} needs a value, and none followed it.` + `
  Nothing was opened and nothing was written.`;
      }
    }
  }
  return null;
}
export async function run(argv, opts) {
  const { io } = opts;
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => Date.now());
  const parsed = parse(argv);
  if (parsed.flags["help"] === true) {
    const named = parsed.command;
    if (named !== undefined && COMMANDS.includes(named)) {
      io.out(commandHelp(named));
      return EXIT.ok;
    }
    io.out(usage());
    return EXIT.ok;
  }
  if (parsed.command === undefined && parsed.flags["version"] === true) {
    io.out(versionLine());
    return EXIT.ok;
  }
  if (parsed.command === undefined) {
    return await bareConsole(io, env, opts);
  }
  if (!COMMANDS.includes(parsed.command)) {
    io.err(`unknown command: ${parsed.command}`);
    io.out(usage());
    return EXIT.usage;
  }
  const command = parsed.command;
  const badFlag = unknownFlag(command, argv);
  if (badFlag !== null) {
    for (const line of `refused: ${badFlag}`.split(`
`))
      io.err(line);
    return EXIT.refused;
  }
  if (command === "version") {
    io.out(versionLine());
    return EXIT.ok;
  }
  if (command === "help") {
    const asked = parsed.positional[0];
    if (asked === undefined) {
      io.out(usage());
      return EXIT.ok;
    }
    if (asked === "advanced") {
      io.out(advancedHelp());
      return EXIT.ok;
    }
    if (COMMANDS.includes(asked)) {
      io.out(commandHelp(asked));
      return EXIT.ok;
    }
    io.err(`no such command: ${asked}`);
    io.out(usage());
    return EXIT.usage;
  }
  const observerReading = observerFromEnv(env, parsed.flags["observer"] === true && command !== "scope");
  const observer = observerReading.on;
  if (observerReading.malformed !== null) {
    io.err(unreadableStanceLine(OBSERVER_ENV, observerReading.malformed, "standing down to observer stance"));
  }
  if (observer && OWNER_OPS.includes(command)) {
    io.err(`refused: '${command}' is an owner operation and this console is in observer stance. An instrument reads; it does not change the store.`);
    return EXIT.refused;
  }
  const readsConfig = command === "install" || command === "connect" || command === "disconnect" || command === "uninstall" || command === "dashboard" || command === "catch-up" || command === "start-fresh" || command === "rollback" || command === "rebrief" || command === "doctor" || command === "scope";
  const named = readsConfig ? resolveConfigPath(typeof parsed.flags["config"] === "string" ? [`--config=${parsed.flags["config"]}`] : [], env, opts.home ?? homedir()) : undefined;
  if (named !== undefined && named.refusal !== null) {
    io.err(named.refusal);
    return EXIT.refused;
  }
  if (command === "install") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    const binary = opts.binary === undefined ? BINARY : opts.binary;
    if (binary !== null) {
      const hostAsked = parsed.flags["host"];
      if (hostAsked !== undefined && hostAsked !== "claude-code") {
        io.err(BINARY_CONNECT_REFUSAL);
        return EXIT.refused;
      }
      try {
        const code = installCommand(parsed, io, env, opts.home, named, { hostSteps: false });
        if (code === EXIT.ok) {
          io.out("");
          io.out("Claude Code runs this memory through the Counterparts plugin, so there is nothing to connect.");
        }
        return code;
      } catch (err) {
        io.err(`install failed: ${describeDirRefusal(err)}`);
        return EXIT.failed;
      }
    }
    const hostFlag = parsed.flags["host"];
    if (hostFlag !== undefined && hostFlag !== "claude-code") {
      if (hostFlag !== DESKTOP_HOST) {
        io.err(`--host takes claude-code or ${DESKTOP_HOST}; got ${JSON.stringify(hostFlag)}.`);
        return EXIT.usage;
      }
      try {
        return installDesktop(parsed, io, env, opts.home, named, now);
      } catch (err) {
        io.err(`install failed: ${describeDirRefusal(err)}`);
        return EXIT.failed;
      }
    }
    try {
      const interactive = isInteractive(io, env, {
        nonInteractive: parsed.flags["no-connect"] === true
      });
      return interactive ? await installInteractive(parsed, io, env, opts, named, now) : installCommand(parsed, io, env, opts.home, named);
    } catch (err) {
      io.err(`install failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }
  if (command === "connect" && (opts.binary === undefined ? BINARY : opts.binary) !== null) {
    io.err(BINARY_CONNECT_REFUSAL);
    return EXIT.refused;
  }
  if (command === "connect" || command === "disconnect" || command === "uninstall") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await hostWiringCommand(command, parsed, io, env, opts, named, now);
    } catch (err) {
      if (isPromptAborted(err)) {
        io.err("");
        io.err("stopped; nothing else was changed.");
        return EXIT.refused;
      }
      io.err(`${command} failed: ${String(err.message ?? err)}`);
      io.err("Anything already done is named above, the backup path included. " + `'${BIN.cli} doctor' says what the host reads now.`);
      return EXIT.failed;
    }
  }
  if (command === "start-fresh") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await startFreshCommand(parsed, io, env, opts.home, named, now);
    } catch (err) {
      io.err(`start-fresh failed: ${String(err.message ?? err)}`);
      return EXIT.failed;
    }
  }
  if (command === "scope") {
    const implicit = named === undefined ? null : implicitConfigRefusal(named, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return scopeCommand(parsed, io, observer, named, now);
    } catch (err) {
      io.err(`scope failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }
  if (command === "doctor") {
    const named_ = typeof parsed.flags["dir"] === "string" ? undefined : named;
    const implicit = named_ === undefined ? null : implicitConfigRefusal(named_, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return doctorCommand(parsed, io, env, named, opts.checkout, opts.home);
    } catch (err) {
      io.err(`doctor failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }
  if (command === "rollback") {
    const named_ = typeof parsed.flags["dir"] === "string" ? undefined : named;
    const implicit = named_ === undefined ? null : implicitConfigRefusal(named_, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await rollbackCommand(parsed, io, env, opts, named, now);
    } catch (err) {
      io.err(`rollback failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }
  if (command === "catch-up") {
    const named_ = typeof parsed.flags["dir"] === "string" ? undefined : named;
    const implicit = named_ === undefined ? null : implicitConfigRefusal(named_, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await catchUpEntry(parsed, io, env, opts, named, now);
    } catch (err) {
      io.err(`catch-up failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }
  if (command === "dashboard") {
    const named_ = typeof parsed.flags["dir"] === "string" ? undefined : named;
    const implicit = named_ === undefined ? null : implicitConfigRefusal(named_, env);
    if (implicit !== null) {
      io.err(implicit);
      return EXIT.refused;
    }
    try {
      return await dashboardCommand(parsed, io, env, opts, named);
    } catch (err) {
      io.err(`dashboard failed: ${describeDirRefusal(err)}`);
      return EXIT.failed;
    }
  }
  let dir;
  try {
    dir = typeof parsed.flags["dir"] === "string" ? parsed.flags["dir"] : resolveDir(env);
  } catch (err) {
    io.err(describeDirRefusal(err));
    return EXIT.refused;
  }
  try {
    switch (command) {
      case "status":
        return statusCommand(dir, io, typeof parsed.flags["dir"] === "string", localDate(now(), zoneBeside(dir)), parsed.flags["layout"] === true, env);
      case "init":
        return initCommand(dir, io, opts.home, typeof parsed.flags["name"] === "string" ? parsed.flags["name"] : undefined);
      case "note":
        return await noteCommand(dir, io, parsed, env, opts.home ?? homedir(), opts.scope);
      case "ask":
      case "recall":
        return await recallCommand(dir, io, parsed, env, opts.home ?? homedir());
      case "verify":
        return verifyCommand(dir, io, parsed.flags);
      case "migrate-cache":
        return await migrateCacheCommand(dir, io, parsed.flags);
      case "backup":
        return await backupCommand(dir, io, parsed.flags["out"], now);
      case "export":
        return exportCommand(dir, io, parsed.flags, observer);
      case "remove":
        return await removeCommand(dir, io, env, parsed.positional, parsed.flags, now);
      case "delete":
        return await deleteCommand(dir, io, env, parsed.positional, parsed.flags);
      case "backfill-claims":
        return backfillClaimsCommand(dir, io, parsed.flags);
      case "repair-dates":
        return repairDatesCommand(dir, io, parsed.flags);
      case "repair-merged-beliefs":
        return repairMergedBeliefsCommand(dir, io, parsed.flags);
      case "rebrief":
        return rebriefCommand(dir, io, parsed.flags["budget"], now, opts.home, named);
      case "probe-oq4":
        return probeCommand(dir, io, typeof parsed.flags["dir"] === "string");
      case "mechanisms":
      case "fired":
        return firedCommand(dir, io, typeof parsed.flags["dir"] === "string", now, parsed.flags["all"] === true);
      case "log":
        return await logCommand(dir, io, parsed.flags["date"], now);
      case "self-page":
        return await selfPageCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string", opts.stdin);
      case "dream":
        return dreamCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "core":
        return coreCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "claims-era":
        return claimsEraCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "settle":
        return settleCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "about":
        return aboutCommand(dir, io, parsed, observer, typeof parsed.flags["dir"] === "string");
      case "coverage":
        return coverageCommand(dir, io, parsed, now, typeof parsed.flags["dir"] === "string");
    }
  } catch (err) {
    io.err(upgradePending(err) ?? `${command} failed: ${describeDirRefusal(err)}`);
    return EXIT.failed;
  }
}
const STATEMENT_PREVIEW = 60;
const MERGE_LOG_CEILING = 1e5;
function repairMergedBeliefsCommand(dir, io, flags) {
  const apply = flags["apply"] === true;
  if (apply) {
    const refusal = requireDirFlagForBulkWrite(dir, io, flags, "repair-merged-beliefs --apply", "un-archives every belief and current-state row the dedup pass took");
    if (refusal !== null)
      return refusal;
  }
  if (!storeExists(dir)) {
    io.err(`no store at ${dir}`);
    return EXIT.failed;
  }
  const planning = openStoreAt({ dir, observer: true });
  let targets;
  try {
    targets = mergedBeliefs(planning);
  } finally {
    planning.close();
  }
  const open = targets.filter((t) => t.archived);
  io.out(`Store: ${dir}`);
  io.out(`Beliefs and current-state rows archived as duplicates: ${open.length}`);
  if (targets.length > open.length) {
    io.out(`Already restored (a merge record with a live row): ${targets.length - open.length}`);
  }
  for (const t of targets) {
    const where = t.entityName === null ? t.entityId ?? "no entity" : t.entityName;
    const day = t.mergedOnDay === null ? "day unrecorded" : `lived day ${t.mergedOnDay}`;
    io.out(`  ${t.id}  ${where}  ${day}${t.archived ? "" : "  [already live]"}`);
    io.out(`    "${t.statement}"`);
    io.out(t.originalId === null ? "    merged into an original the log no longer names" : `    merged into ${t.originalId}${t.originalPreview === null ? "" : `  "${t.originalPreview}"`}`);
  }
  if (!apply) {
    io.out("");
    io.out(open.length === 0 ? "Dry run. Nothing to repair on this store." : "Dry run. Nothing has changed. Re-run with --apply to put these back.");
    return EXIT.ok;
  }
  if (open.length === 0) {
    io.out("");
    io.out("Nothing to do.");
    return EXIT.ok;
  }
  const store = openStoreAt({ dir });
  let restored = 0;
  const failures = [];
  try {
    for (const target of mergedBeliefs(store)) {
      if (!target.archived)
        continue;
      try {
        const report = unarchiveMerged(store, target.id);
        if (!report.noop)
          restored += 1;
      } catch (err) {
        failures.push(`${target.id}: ${describeDirRefusal(err)}`);
      }
    }
  } finally {
    store.close();
  }
  io.out("");
  io.out(`Put ${restored} elements back. The uses each merge credited stand, and are recorded.`);
  for (const failure of failures)
    io.err(`  FAILED ${failure}`);
  return failures.length === 0 ? EXIT.ok : EXIT.failed;
}
function mergedBeliefs(store) {
  const denied = new Set(store.deniedIds());
  const ids = new Set;
  const schemaPrefix = `${ID_PREFIX["schema"]}_`;
  for (const id of store.list({ type: "schema", archived: true })) {
    const row = store.row(id);
    if (row === undefined || denied.has(id))
      continue;
    if (row.archived_reason === MERGED_ARCHIVE_REASON)
      ids.add(id);
  }
  for (const event of store.eventLog({ name: "memory.merged", limit: MERGE_LOG_CEILING })) {
    if (event.ref === null || !event.ref.startsWith(schemaPrefix) || denied.has(event.ref))
      continue;
    const row = store.row(event.ref);
    if (row === undefined)
      continue;
    if (row.archived === 1 && row.archived_reason !== MERGED_ARCHIVE_REASON)
      continue;
    ids.add(event.ref);
  }
  const out = [];
  for (const id of [...ids].sort()) {
    const row = store.row(id);
    if (row === undefined)
      continue;
    let doc = null;
    try {
      doc = readProseWalking(store, id, row);
    } catch {
      doc = null;
    }
    const entityId = typeof doc?.meta["entityId"] === "string" ? doc.meta["entityId"] : null;
    const merge = mergeRecordOf(store, id);
    out.push({
      id,
      entityId,
      entityName: entityId === null ? null : entityNameOf(store, entityId),
      statement: doc === null ? "(prose unreadable)" : oneLine(doc.body, STATEMENT_PREVIEW),
      originalId: merge.originalId,
      originalPreview: merge.originalId === null ? null : previewOf(store, merge.originalId, STATEMENT_PREVIEW),
      mergedOnDay: merge.day,
      archived: row.archived === 1
    });
  }
  return out;
}
function mergeRecordOf(store, id) {
  const [last] = store.eventLog({ name: "memory.merged", ref: id, order: "desc", limit: 1 });
  if (last === undefined || last.payload === null)
    return { originalId: null, day: null };
  try {
    const parsed = JSON.parse(last.payload);
    return {
      originalId: typeof parsed["originalId"] === "string" ? parsed["originalId"] : null,
      day: last.day
    };
  } catch {
    return { originalId: null, day: last.day };
  }
}
function entityNameOf(store, entityId) {
  try {
    const name = readProseWalking(store, entityId).meta["name"];
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
function previewOf(store, id, max) {
  try {
    return oneLine(readProseWalking(store, id).body, max);
  } catch {
    return null;
  }
}
function oneLine(body, max) {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

export { zoneBeside };
