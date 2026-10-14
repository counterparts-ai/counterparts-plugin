export const SHORT_LIMIT = 75;
const NAME_COLUMN = 14;
const ADVANCED_NAME_COLUMN = 24;
export const PENDING_COMMANDS = [];
export const SHORT = {
  ask: "Ask memory a question",
  status: "Memories held and recent activity",
  doctor: "Check that everything is working",
  dashboard: "Open the dashboard in your browser",
  "self-page": "See what it knows about you",
  install: "First-time setup: your memory and Claude Code — safe to run again",
  connect: "Connect an AI to your memory (Claude Code today; more soon)",
  disconnect: "Disconnect an AI",
  scope: "Choose which folders it remembers",
  uninstall: "Remove Counterparts; keeps your memory unless you say otherwise",
  export: "A copy of your memory you can take anywhere, encrypted by default",
  backup: "Save a snapshot of your memory to a folder",
  remove: "Delete one memory for good",
  delete: "Delete one kind of data: conversation text, backups or the activity log",
  note: "Remember something on purpose, right now",
  mechanisms: "Which parts of memory are working, one line each",
  log: "What happened today, in order, one line each (kept 7 days)",
  dream: "What each dream did — and undo one",
  core: "What became part of who I am — and send one back",
  settle: "Two memories that disagree: which holds — and undo one",
  about: "What a memory is about — and change it",
  coverage: "What is written up, and what is not yet, for a date",
  "catch-up": "Write up, now, sessions that ended unwritten (the night does it too)",
  init: "Make a second, separate memory store — a scratch one",
  "start-fresh": "Set this memory aside and start blank; --undo brings it back",
  rollback: "Put memory back as it was before an upgrade; --undo brings it forward",
  verify: "Count the search index against what is actually stored",
  rebrief: "Rebuild what the next session wakes up with, now",
  "migrate-cache": "Convert the search index to the newer, smaller format",
  "backfill-claims": "One-off repair: give old memories their default footing",
  "repair-dates": "One-off repair: give imported memories their real dates",
  "repair-merged-beliefs": "One-off repair: put back beliefs a cleanup pass filed away",
  "claims-era": "Old claims read as defaults: on or off, and how many",
  "probe-oq4": "A measurement: which footnotes were opened again later",
  help: "What it does, and every flag it takes",
  recall: "Ask memory a question",
  fired: "Which parts of memory are working, one line each",
  version: "The version of Counterparts you have"
};
export const GROUPS = [
  { title: "Everyday", commands: ["ask", "status", "doctor", "dashboard", "self-page"] },
  {
    title: "Setup",
    commands: ["install", "connect", "disconnect", "scope", "uninstall"]
  },
  { title: "Your data", commands: ["export", "backup", "remove"] }
];
export const ADVANCED = [
  "note",
  "mechanisms",
  "log",
  "dream",
  "core",
  "settle",
  "about",
  "coverage",
  "catch-up",
  "init",
  "delete",
  "start-fresh",
  "rollback",
  "verify",
  "rebrief",
  "migrate-cache",
  "backfill-claims",
  "repair-dates",
  "repair-merged-beliefs",
  "claims-era",
  "probe-oq4"
];
export const UNLISTED = {
  help: "printed in the footer of both pages rather than as a row in a group",
  recall: "the unlisted spelling of `ask` — it still dispatches, and always will",
  fired: "the older name of `mechanisms` — it still dispatches, the same command",
  version: "reached as `counterparts --version`, which is how anybody asks it"
};
export const GLOBAL_FLAGS = [
  { flag: "--dir <path>", said: "Look at a different memory store than the configured one" },
  { flag: "--config <path>", said: "Use a different configuration file" },
  { flag: "--observer", said: "Read only: look at memory and change nothing" }
];
export function linesOf(name) {
  const said = SHORT[name];
  if (said === undefined)
    return [];
  return typeof said === "string" ? [said] : said;
}
function shortLine(name, column) {
  const said = linesOf(name);
  const first = said[0] ?? "";
  const hanging = " ".repeat(2 + column);
  const rest = said.slice(1).map((line) => `${hanging}${line}`);
  if (name.length >= column)
    return [`  ${name}`, `${hanging}${first}`, ...rest];
  return [`  ${name.padEnd(column)}${first}`, ...rest];
}
const ASK_A_COMMAND = "counterparts help <command>   everything a command can do";
const ASK_ADVANCED = "counterparts help advanced    maintenance and developer commands";
const HOME_PAGE = "https://www.npmjs.com/package/counterparts";
export function shortHelp() {
  const lines = ["counterparts — a memory layer for AI"];
  for (const group of GROUPS) {
    lines.push("", group.title);
    for (const name of group.commands)
      lines.push(...shortLine(name, NAME_COLUMN));
  }
  lines.push("", ASK_A_COMMAND, ASK_ADVANCED, HOME_PAGE);
  return lines.join(`
`);
}
export function advancedHelp() {
  const lines = ["counterparts help advanced — maintenance and developer commands", ""];
  for (const name of ADVANCED)
    lines.push(...shortLine(name, ADVANCED_NAME_COLUMN));
  lines.push("", "Options every command takes");
  for (const { flag, said } of GLOBAL_FLAGS) {
    lines.push(`  ${flag.padEnd(ADVANCED_NAME_COLUMN)}${said}`);
  }
  lines.push("", ASK_A_COMMAND, HOME_PAGE);
  return lines.join(`
`);
}
export const COMMAND_DETAIL = {
  install: [
    "At a terminal it asks your name, makes the store, turns on recall by",
    "meaning (a local table that ships with the package — nothing leaves this",
    "machine; --no-embedder leaves it off) and connects Claude Code (a backup of",
    "~/.claude/settings.json is kept; `counterparts disconnect` undoes it;",
    "--no-connect skips it). Run it again any time: it keeps what is there and",
    "says `Welcome back`. If ~/.counterparts is gone and",
    "a ~/.counterparts.parked-<date> is beside it, it asks first whether to bring",
    "that memory back or start blank.",
    "",
    "Recall by meaning is also on wherever a configuration names no embedder —",
    "an install made before it existed included. --no-embedder switches it",
    "off; `install --force --embedder` switches it back on, keeping every other",
    "setting.",
    "",
    "Each session opens with a short briefing from memory, capped by",
    '"injectionBudgetBytes" in claude-code.json (9000 unless --budget says',
    "otherwise). --dir moves the STORE only. --config <absolute path> moves the",
    "CONFIG and the default store beneath it, and the lines this command prints",
    "then carry it.",
    "",
    "--host claude-desktop connects Claude Desktop's chat instead of Claude",
    "Code: the same store and configuration, then one `counterparts` entry in",
    "~/Library/Application Support/Claude/claude_desktop_config.json (backed up",
    "first; every other server left as it was). Quit Claude Desktop BEFORE you",
    "run it — Desktop rewrites that file while it runs — then open Desktop and",
    'start a chat with the "Start with Counterparts" prompt, or ask it to',
    "call the counterparts wake tool. In Claude Desktop, set the counterparts",
    "tools to Always allow, or a chat cannot wake on its own.",
    "",
    "Once Desktop is connected, `install` at a terminal brings that entry's",
    "command up to date the way `counterparts connect` does, keeping the store",
    "it names. Not while Desktop is open: it asks you to quit Desktop and run",
    "connect again."
  ],
  init: [
    "No host config, nothing under ~/.counterparts/ — that",
    "is what install is for."
  ],
  verify: [
    "--rebuild refuses while the cache holds embeddings this console has no",
    "embedder to recompute, unless --drop-vectors says to lose them or",
    "--keep-vectors says to leave every one of them where it is."
  ],
  "migrate-cache": [
    "--apply needs the store NAMED by --dir — never the default, and never",
    "resolved from COUNTERPARTS_DATA_DIR — and asks unless --yes."
  ],
  "repair-dates": [
    "It reads the evidence each row already holds: an engram-era id that is a",
    "millisecond timestamp, a v1 date field, a session reference, a source path.",
    "It prints counts by confidence and a sample of the proposed dates.",
    "--apply needs the store NAMED by --dir, never resolved for it: this is the",
    "one owner operation that rewrites thousands of canonical documents."
  ],
  rebrief: [
    "It advances no sleep marker and runs no other sleep phase.",
    "",
    "It needs an injection ceiling, and says which of these gave it one:",
    "--budget <bytes>, else the config named by --config / $COUNTERPARTS_CONFIG,",
    "else <dir>/../claude-code.json (beside the store), else",
    "~/.counterparts/claude-code.json (where the hooks read). A config found",
    "there without the key gives Claude Code's 9000, as the hooks use. Never a",
    "config INSIDE the data dir — that store stops opening (§5 G11)."
  ],
  "probe-oq4": [
    "recall CONTRACT §7. The footnote header is the one string the probe varies",
    "(recall/render.ts)."
  ],
  mechanisms: [
    "One line per memory mechanism: ● working this week, ◐ built but not firing,",
    "○ not built yet, each with the count behind it; then the plumbing in one",
    "line, naming only what is failing. `counterparts fired` is its older name.",
    "",
    "--all prints the full report, SILENT FIRST: when each part last fired, how",
    "many times in the last 7 days, what it turned away, and — for the ones",
    "nothing durable records — which row would fix that."
  ],
  dream: [
    "Once a day the first session starts the nightly run in the background —",
    "the page writer, then a dream, then a reflection — and says so in one",
    "line (--setting ask makes it ask you first; --setting off, or saying 'no",
    "dreams' in a session, turns it off). Every change a dream makes is",
    "recorded under its id, so --undo can reverse the whole batch. Its journal",
    "lives with the dream, never as a memory. The reflection leaves a lived",
    "entry, maybe a new self page, and a short morning share the session tells you."
  ],
  core: [
    "The core does not fade. Only a memory about me or about us gets there —",
    "what a memory is about is marked by meaning, by the writer or a",
    "reflection — and never a fact, a skill or a plan: by the fast lane",
    "(strongly felt, and it came back after a gap) or the slow lane (it, or its",
    "earlier and later states, kept coming back on several days in several",
    "sessions), at most a few a night. A dream can nominate one; only a lane",
    "promotes it. Nothing leaves without a decision: one that no longer fits,",
    "or stops coming back, is listed as being reconsidered until --reaffirm",
    "or --demote (or my own decision) settles it."
  ],
  fired: [
    "`counterparts mechanisms` is the same command, and it is the listed",
    "spelling; this one stays so scripts that call it keep working."
  ],
  "self-page": [
    "With no flags it prints the page, its size, its version and the date it was",
    "last revised, and says when that has gone stale. A page written here reaches",
    "the wake at the next boundary (or 'rebrief')."
  ],
  scope: [
    "With a mode flag it writes <config dir>/scopes.json; with none it says what",
    "the directory resolves to and which entry decided."
  ],
  ask: [
    "`counterparts recall` is the same command under its older name — the word",
    `the memory tools and doctor's "recall by meaning" still use. Both dispatch.`
  ],
  recall: [
    "`counterparts ask` is the same command, and it is the listed spelling: this",
    "one stays because the memory tool, doctor and every note written before",
    "2026-09-22 call it recall."
  ],
  dashboard: [
    "It reads the store your CONFIGURATION names — the one the hooks and the",
    "memory tools open — so it needs no --dir. The page is served on 127.0.0.1",
    "and nowhere else. Looking is observer mode: it strengthens nothing and",
    "deposits nothing. What you do there on purpose — a note, a removal, a",
    "backup, an export, a scope, a rebrief, a verify, an ask — runs through",
    "these same commands, and a removal asks you to type the id back."
  ],
  help: [
    "With no command it prints the short map — the same page `counterparts",
    "--help` and a bare `counterparts` print. With `advanced`, the maintenance",
    "shelf and the three flags every command takes. With a command name, that",
    "command's own page: `counterparts help doctor` and `counterparts doctor",
    "--help` are the same page, and it works for every command, listed or not.",
    "It opens no store and reads no configuration."
  ],
  version: [
    "The version FLAG on a bare `counterparts` prints the same line, and that is",
    "how most people ask; this command is for anybody who types the verb. It is",
    "the check to run straight after installing: it opens no store and reads no",
    'configuration, so it answers "is the program here and runnable" and',
    "nothing else. `counterparts doctor`, after an install and a restart, is the",
    "one that says whether it WORKS."
  ],
  connect: [
    "It backs ~/.claude/settings.json up beside itself before a byte changes,",
    "and says so; --dry-run shows what would change and changes nothing. The",
    "five hooks go BESIDE anything already on those events — another tool's",
    "hook keeps its place and every one of its own settings — and an entry of",
    "ours that names a path that has moved is repaired rather than duplicated.",
    "A settings file it cannot parse is a refusal: it changes nothing and",
    "prints the block for you to merge by hand.",
    "",
    "The MCP server is registered by running `claude mcp add`; it never edits",
    "Claude Code's user configuration file itself, because Claude Code owns it.",
    "If `claude` is not on your PATH the hooks still go in and the line is",
    "printed for you.",
    "",
    "Claude Code is the one host it knows today, so `counterparts connect` and",
    "`counterparts connect claude-code` are the same thing and any other name",
    "is refused. It does not ask first: naming the verb is the yes.",
    "",
    "Hooks start with your next turn in any open session; the memory tools",
    "appear after you restart Claude Code.",
    "",
    "If you connected Claude Desktop (see `counterparts help install`), connect",
    "brings its entry's command up to date too, keeping the store it names. Not",
    "while Desktop is open: Desktop rewrites that file while it runs, so",
    "connect leaves it alone and asks you to quit Desktop and connect again."
  ],
  disconnect: [
    "It removes only the entries it recognises as its own — another tool's hooks",
    "are never candidates — and runs `claude mcp remove`. It backs the settings",
    "file up first, exactly as `connect` does. Your memory is not touched, and",
    "this one works even if the configuration is already gone."
  ],
  uninstall: [
    "It disconnects the host, then says where your memory still is, how many",
    "memories are in it, and the one command that removes the package:",
    "`bun remove -g counterparts` (a program does not delete itself).",
    "",
    'At a terminal it then asks: "Also delete all memories and related data?',
    `This can't be undone. [y/N]" — after printing every path that would go and`,
    "what it leaves (Claude Code's own files). Enter, Esc and n keep it; a yes",
    "asks you to type DELETE MEMORIES, as --delete-memories does. It is not asked",
    "with --keep-memories or --yes, from a pipe, or while a session, memory",
    "server, dashboard or worker has the store open.",
    "",
    "~/.counterparts is left exactly where it is unless you say otherwise.",
    "--park renames the whole directory to <dir>.parked-<date> — one rename,",
    "nothing copied, nothing deleted, the store never opened. To bring it back,",
    "run `counterparts install`: it finds the parked folder and asks. By hand,",
    "it is one rename, guarded so it cannot nest one folder inside another:",
    "",
    '  if [ -e ~/.counterparts ]; then echo "REFUSING: ~/.counterparts exists"; \\',
    "  else mv ~/.counterparts.parked-<date> ~/.counterparts; fi",
    "",
    "--delete-memories destroys it, after counting what is about to go and",
    "asking you to type DELETE MEMORIES exactly (Esc, Enter or `cancel` stops);",
    "there is no --yes for that one.",
    "",
    "Both of those refuse while a Counterparts MCP server, worker or dashboard",
    "is running, and name what they found; a delete also refuses while a",
    "Claude Code session's hooks ran on the store in the last ten minutes.",
    "",
    "--json is for the plugin's own command: alone it prints the plan as JSON",
    "and changes nothing; with --keep-memories it uninstalls and keeps. It never",
    "deletes: the phrase is typed by you, at a terminal, with Claude Code closed.",
    "",
    "The sizes they print are every byte under each path, taken just before the",
    "plan is shown. Part of a store's size can be its database log (the -wal file",
    "beside it), which shrinks by itself once it is folded into the database, so",
    "when that part is a megabyte or more the plan says how much of it is log."
  ]
};
export const CONSOLE_FOOTER = [
  "Any other flag is refused before the store is opened.",
  "Owner operations never run under observer, and the ones that delete or move",
  "memory ask a person first (CONTRACT §5 G12: owner-in-the-loop is a short, named list)."
];
