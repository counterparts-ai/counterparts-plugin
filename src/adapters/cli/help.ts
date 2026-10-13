/**
 * `adapters/cli/help.ts` — the console's map, and the one rule that shapes it.
 *
 * ── The finding ─────────────────────────────────────────────────────────────
 *
 * New-user findings #4 (2026-09-21), in the owner's words: "running help command
 * after installing to verify is clunky, it spits out a ton of help commands with
 * very verbose summarys, basically a wall of text." `counterparts --help` was 129
 * lines of dense paragraphs. Splitting it into a short map and a page per command
 * fixed the wall; the 0.2.0 trial (findings #17, #18) found what was left:
 * the map was still a list of every command this package has, written in the
 * builder's words — "Is the background half alive? Worst first, with fixes",
 * "Just a store — a second one, or a scratch one" ("what does that even mean and
 * when would a user use it?").
 *
 * ── The split, as the owner drew it on 2026-09-22 ───────────────────────────
 *
 * THREE pages now, and each answers exactly one question:
 *
 *   - **`counterparts --help` / `help` / no arguments** → this file's
 *     `shortHelp()`: what this is, then the fourteen commands a person actually
 *     reaches for, grouped by what they came to do, ONE short line each.
 *   - **`counterparts help advanced`** → `advancedHelp()`: the maintenance and
 *     developer shelf, plus the three flags every command takes. A command that
 *     exists and is written down nowhere is a command nobody can ask for; a
 *     command on the first page a person will never type is a wall of text.
 *   - **`counterparts help <command>` / `<command> --help`** →
 *     `commands.ts#commandHelp`: that command's blurb, its invocation, the
 *     paragraphs below, and every flag it takes with a sentence each. It works
 *     for EVERY command, listed or not.
 *
 * NOTHING WAS DELETED to make the short page short. Every sentence the old
 * `usage()` carried is either in `COMMAND_BLURB`, in `FLAG_HELP` (so it prints
 * beside the flag it is about), or in `COMMAND_DETAIL` below — the table this
 * file exists to hold. `test/help.test.ts` walks a list of phrases out of the
 * old page and asserts each one still prints somewhere a reader can ask for it.
 *
 * ── Three rules for whoever adds a command next ─────────────────────────────
 *
 *   1. **Every command has a short line here and a page there.**
 *      `test/help.test.ts` walks `COMMANDS` and fails on a command that has
 *      neither, so a command cannot be added without help for it.
 *   2. **Every command is accounted for in exactly one of three places**:
 *      `GROUPS` (the short map), `ADVANCED` (the shelf), or `UNLISTED` — which
 *      demands a REASON in words for why a dispatched command is on neither
 *      page. The test holds all four tables to `COMMANDS` in both directions.
 *   3. **The short line is SHORT**: `SHORT_LIMIT` characters of description,
 *      mechanized by the same test. The long version has a place to live.
 *
 * ── No value import from `commands.ts` ──────────────────────────────────────
 *
 * `commands.ts` imports this file, so this one imports nothing but TYPES back
 * (erased at compile time; the same stance `ui.ts` takes). The tables here are
 * keyed by plain strings for that reason, and the totality check that ties them
 * to `COMMANDS` lives in the test, where both sides can be named at once.
 */

/**
 * The longest a short line's DESCRIPTION may be. Mechanized in the test.
 *
 * It was 60 until 2026-09-22, when the owner wrote the fourteen lines of the
 * short page himself and the longest of them — `install`'s — came to 73. The
 * limit is a tripwire against a description growing into a paragraph, not a
 * layout rule, so it moved to fit the page he wrote rather than the page being
 * re-wrapped to fit it. `self-page` is the one line he wrote as TWO, and
 * `SHORT` therefore takes an array where a single line will not do.
 */
export const SHORT_LIMIT = 75;

/** Where the description starts on the short page, after two spaces of indent
 *  and the name. Wide enough for the longest name on it, with room to spare. */
const NAME_COLUMN = 14;

/** The same, for the advanced page, where `repair-merged-beliefs` lives. */
const ADVANCED_NAME_COLUMN = 24;

/**
 * COMMANDS THIS CONSOLE DOES NOT DISPATCH YET, listed anyway.
 *
 * Empty as of 2026-09-21: `wire`, `unwire` and `uninstall` were the three names
 * on it, they landed with piece A+B, and the tripwire in `test/help.test.ts`
 * is what made taking them off a step nobody could forget. The mechanism stays
 * for the next time a map is written ahead of a command — it holds this list to
 * `COMMANDS` in both directions, so a name listed and not dispatched must be
 * HERE, and a name here that has arrived must be taken out.
 */
export const PENDING_COMMANDS: readonly string[] = [];

/** One heading and the commands under it, in the order they are printed. */
export interface HelpGroup {
  readonly title: string;
  readonly commands: readonly string[];
}

/**
 * WHAT EACH COMMAND IS, in one line a person can scan.
 *
 * Not a second copy of `COMMAND_BLURB` — a different job. The blurb is the lede
 * of a page somebody has already asked for and can be a sentence long; this is
 * a row in a list, and its whole value is that the eye can cross it without
 * stopping.
 *
 * The fourteen lines of `GROUPS` are the owner's own words, 2026-09-22, and
 * `docs/new-user-findings.md` § "The screens" renders them as the acceptance
 * criterion — a builder matches that page, then keeps the facts the old one
 * carried. An entry is an ARRAY only where he wrote two lines.
 */
export const SHORT: Record<string, string | readonly string[]> = {
  // ── everyday ──
  ask: "Ask memory a question",
  status: "Memories held and recent activity",
  doctor: "Check that everything is working",
  dashboard: "Open the dashboard in your browser",
  "self-page": "See what it knows about you",
  // ── setup ──
  install: "First-time setup: your memory and Claude Code — safe to run again",
  connect: "Connect an AI to your memory (Claude Code today; more soon)",
  disconnect: "Disconnect an AI",
  scope: "Choose which folders it remembers",
  uninstall: "Remove Counterparts; keeps your memory unless you say otherwise",
  // ── your data ──
  export: "A copy of your memory you can take anywhere, encrypted by default",
  backup: "Save a snapshot of your memory to a folder",
  remove: "Delete one memory for good",
  delete: "Delete one kind of data: conversation text, backups or the activity log",
  // ── advanced: the maintenance shelf, in a person's words rather than the
  //    build's. Finding #18 is exactly this list read by somebody who had just
  //    installed the package.
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
  // ── the ones that are on no page, and `UNLISTED` says why ──
  help: "What it does, and every flag it takes",
  recall: "Ask memory a question",
  fired: "Which parts of memory are working, one line each",
  version: "The version of Counterparts you have",
};

/**
 * THE GROUPS, and they are about the PERSON rather than the architecture.
 *
 * "Everyday" is what somebody does with a memory; "Setup" is the half-hour they
 * spend once; "Your data" is every door out of the store, together, because a
 * person who wants to leave should not have to read the whole page to find out
 * they can.
 */
export const GROUPS: readonly HelpGroup[] = [
  { title: "Everyday", commands: ["ask", "status", "doctor", "dashboard", "self-page"] },
  {
    title: "Setup",
    commands: ["install", "connect", "disconnect", "scope", "uninstall"],
  },
  { title: "Your data", commands: ["export", "backup", "remove"] },
];

/**
 * THE MAINTENANCE SHELF — listed in full, one page away.
 *
 * These are real, dispatched commands, and every one of them is written down:
 * a command that exists and is documented nowhere is a command nobody can ask
 * for. They are not on the first page because the first page is read by
 * somebody thirty seconds after installing, and none of these is what they
 * came for. `repair-*` and `backfill-claims` in particular are one-off repairs
 * for stores migrated out of v1 — there are two of those in the world.
 */
export const ADVANCED: readonly string[] = [
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
  "probe-oq4",
];

/**
 * THE COMMANDS ON NEITHER PAGE, each with the reason it is off both.
 *
 * A dispatched command that nothing lists is how a console grows a hidden
 * surface. So the omission is declared, in words, and the test reads this table
 * as the third of the three places a command may be accounted for — which means
 * hiding one costs a sentence that a reviewer will see.
 */
export const UNLISTED: Record<string, string> = {
  // A list of commands whose last entry is "the command that prints this list"
  // reads as a joke at the reader's expense. It is in the footer of both pages.
  help: "printed in the footer of both pages rather than as a row in a group",
  // The MCP tool is `recall`, `doctor` says "recall by meaning", and the word is
  // the right one for what the machinery does. `ask` is the word a PERSON
  // reaches for, so that is the one on the map; both dispatch, forever.
  recall: "the unlisted spelling of `ask` — it still dispatches, and always will",
  // Renamed 2026-09-25: the owner found the old name's page a wall of text, and
  // `mechanisms` is the word the site uses. Scripts that say `fired` keep working.
  fired: "the older name of `mechanisms` — it still dispatches, the same command",
  // `counterparts --version` is what a person types; `counterparts version` is
  // the same answer for anybody who types the verb. Neither belongs on a map of
  // things to do with a memory.
  version: "reached as `counterparts --version`, which is how anybody asks it",
};

/** The three flags every command takes, said once, on the advanced page. */
export const GLOBAL_FLAGS: readonly { readonly flag: string; readonly said: string }[] = [
  { flag: "--dir <path>", said: "Look at a different memory store than the configured one" },
  { flag: "--config <path>", said: "Use a different configuration file" },
  { flag: "--observer", said: "Read only: look at memory and change nothing" },
];

/** The description of `name`, as the one or two lines it is written as. */
export function linesOf(name: string): readonly string[] {
  const said = SHORT[name];
  if (said === undefined) return [];
  return typeof said === "string" ? [said] : said;
}

/** `  name          description`, with an over-long name on its own line and a
 *  two-line description hanging under the first. */
function shortLine(name: string, column: number): string[] {
  const said = linesOf(name);
  const first = said[0] ?? "";
  const hanging = " ".repeat(2 + column);
  const rest = said.slice(1).map((line) => `${hanging}${line}`);
  if (name.length >= column) return [`  ${name}`, `${hanging}${first}`, ...rest];
  return [`  ${name.padEnd(column)}${first}`, ...rest];
}

/** The two lines both pages end on: where the detail is, and where the package
 *  lives. A stranger who wants more has somewhere to go from either page. */
const ASK_A_COMMAND = "counterparts help <command>   everything a command can do";
const ASK_ADVANCED = "counterparts help advanced    maintenance and developer commands";
const HOME_PAGE = "https://www.npmjs.com/package/counterparts";

/**
 * The console in about twenty-five lines — what `counterparts`, `--help` and
 * `help` all print.
 *
 * The first line is load-bearing in one place: `test/cli.test.ts` asserts it for
 * both `--help` and a bare invocation. It said "the owner's console for a
 * Counterparts memory store" until 2026-09-22 — a sentence about whose console
 * this is, to a reader who does not yet know what the thing is. The owner
 * replaced it with what it IS. `tools/install-loop/run.sh` used to grep the old
 * phrase as its "did the install work" check and now runs `--version` instead,
 * which is the question it was actually asking.
 */
export function shortHelp(): string {
  const lines: string[] = ["counterparts — a memory layer for AI"];
  for (const group of GROUPS) {
    lines.push("", group.title);
    for (const name of group.commands) lines.push(...shortLine(name, NAME_COLUMN));
  }
  lines.push("", ASK_A_COMMAND, ASK_ADVANCED, HOME_PAGE);
  return lines.join("\n");
}

/** `counterparts help advanced` — the shelf, and the three flags. */
export function advancedHelp(): string {
  const lines: string[] = ["counterparts help advanced — maintenance and developer commands", ""];
  for (const name of ADVANCED) lines.push(...shortLine(name, ADVANCED_NAME_COLUMN));
  // "Options every command takes", not "Everywhere" — the owner read the old
  // label as a puzzle (finding #27), and the per-command footer says the same.
  lines.push("", "Options every command takes");
  for (const { flag, said } of GLOBAL_FLAGS) {
    lines.push(`  ${flag.padEnd(ADVANCED_NAME_COLUMN)}${said}`);
  }
  lines.push("", ASK_A_COMMAND, HOME_PAGE);
  return lines.join("\n");
}

/**
 * THE PARAGRAPHS THE OLD `usage()` CARRIED AND NO BLURB OR FLAG SENTENCE DOES.
 *
 * Moved, not rewritten: each entry below is the sentence the 129-line page had,
 * minus whatever `COMMAND_BLURB[command]` or `FLAG_HELP[flag]` already says, so
 * that a reader who asks for one command's page gets everything the old page
 * told them about it and nothing twice. A command absent from this table is one
 * whose blurb and flags already said it all.
 *
 * Pre-wrapped, like the page it came from: these are printed verbatim, so what
 * is written here is what a reader sees at any width.
 */
export const COMMAND_DETAIL: Record<string, readonly string[]> = {
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
    "\"injectionBudgetBytes\" in claude-code.json (9000 unless --budget says",
    "otherwise). --dir moves the STORE only. --config <absolute path> moves the",
    "CONFIG and the default store beneath it, and the lines this command prints",
    "then carry it.",
    "",
    "--host claude-desktop connects Claude Desktop's chat instead of Claude",
    "Code: the same store and configuration, then one `counterparts` entry in",
    "~/Library/Application Support/Claude/claude_desktop_config.json (backed up",
    "first; every other server left as it was). Quit Claude Desktop BEFORE you",
    "run it — Desktop rewrites that file while it runs — then open Desktop and",
    "start a chat with the \"Start with Counterparts\" prompt, or ask it to",
    "call the counterparts wake tool. In Claude Desktop, set the counterparts",
    "tools to Always allow, or a chat cannot wake on its own.",
    "",
    "Once Desktop is connected, `install` at a terminal brings that entry's",
    "command up to date the way `counterparts connect` does, keeping the store",
    "it names. Not while Desktop is open: it asks you to quit Desktop and run",
    "connect again.",
  ],
  init: [
    "No host config, nothing under ~/.counterparts/ — that",
    "is what install is for.",
  ],
  verify: [
    "--rebuild refuses while the cache holds embeddings this console has no",
    "embedder to recompute, unless --drop-vectors says to lose them or",
    "--keep-vectors says to leave every one of them where it is.",
  ],
  "migrate-cache": [
    "--apply needs the store NAMED by --dir — never the default, and never",
    "resolved from COUNTERPARTS_DATA_DIR — and asks unless --yes.",
  ],
  "repair-dates": [
    "It reads the evidence each row already holds: an engram-era id that is a",
    "millisecond timestamp, a v1 date field, a session reference, a source path.",
    "It prints counts by confidence and a sample of the proposed dates.",
    "--apply needs the store NAMED by --dir, never resolved for it: this is the",
    "one owner operation that rewrites thousands of canonical documents.",
  ],
  rebrief: [
    "It advances no sleep marker and runs no other sleep phase.",
    "",
    "It needs an injection ceiling, and says which of these gave it one:",
    "--budget <bytes>, else the config named by --config / $COUNTERPARTS_CONFIG,",
    "else <dir>/../claude-code.json (beside the store), else",
    "~/.counterparts/claude-code.json (where the hooks read). A config found",
    "there without the key gives Claude Code's 9000, as the hooks use. Never a",
    "config INSIDE the data dir — that store stops opening (§5 G11).",
  ],
  "probe-oq4": [
    "recall CONTRACT §7. The footnote header is the one string the probe varies",
    "(recall/render.ts).",
  ],
  mechanisms: [
    "One line per memory mechanism: ● working this week, ◐ built but not firing,",
    "○ not built yet, each with the count behind it; then the plumbing in one",
    "line, naming only what is failing. `counterparts fired` is its older name.",
    "",
    "--all prints the full report, SILENT FIRST: when each part last fired, how",
    "many times in the last 7 days, what it turned away, and — for the ones",
    "nothing durable records — which row would fix that.",
  ],
  dream: [
    "Once a day the first session starts the nightly run in the background —",
    "the page writer, then a dream, then a reflection — and says so in one",
    "line (--setting ask makes it ask you first; --setting off, or saying 'no",
    "dreams' in a session, turns it off). Every change a dream makes is",
    "recorded under its id, so --undo can reverse the whole batch. Its journal",
    "lives with the dream, never as a memory. The reflection leaves a lived",
    "entry, maybe a new self page, and a short morning share the session tells you.",
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
    "or --demote (or my own decision) settles it.",
  ],
  fired: [
    "`counterparts mechanisms` is the same command, and it is the listed",
    "spelling; this one stays so scripts that call it keep working.",
  ],
  "self-page": [
    "With no flags it prints the page, its size, its version and the date it was",
    "last revised, and says when that has gone stale. A page written here reaches",
    "the wake at the next boundary (or 'rebrief').",
  ],
  scope: [
    "With a mode flag it writes <config dir>/scopes.json; with none it says what",
    "the directory resolves to and which entry decided.",
  ],
  // `ask` and `recall` are ONE command under two names, so this sentence is on
  // both pages: whichever a person typed, the other one is the thing they will
  // meet in somebody else's notes, in `doctor`, or as the MCP tool.
  ask: [
    "`counterparts recall` is the same command under its older name — the word",
    "the memory tools and doctor's \"recall by meaning\" still use. Both dispatch.",
  ],
  recall: [
    "`counterparts ask` is the same command, and it is the listed spelling: this",
    "one stays because the memory tool, doctor and every note written before",
    "2026-09-22 call it recall.",
  ],
  dashboard: [
    "It reads the store your CONFIGURATION names — the one the hooks and the",
    "memory tools open — so it needs no --dir. The page is served on 127.0.0.1",
    "and nowhere else. Looking is observer mode: it strengthens nothing and",
    "deposits nothing. What you do there on purpose — a note, a removal, a",
    "backup, an export, a scope, a rebrief, a verify, an ask — runs through",
    "these same commands, and a removal asks you to type the id back.",
  ],
  help: [
    "With no command it prints the short map — the same page `counterparts",
    "--help` and a bare `counterparts` print. With `advanced`, the maintenance",
    "shelf and the three flags every command takes. With a command name, that",
    "command's own page: `counterparts help doctor` and `counterparts doctor",
    "--help` are the same page, and it works for every command, listed or not.",
    "It opens no store and reads no configuration.",
  ],
  version: [
    // NOT the flag spelled out: `counterparts version` does not TAKE a version
    // flag (it takes none at all), and `test/cli.test.ts` holds every page to
    // exactly the flags its own command accepts — a page that shows a flag the
    // command would refuse is teaching a mistake. The fact still has to be here,
    // because the flag is how most people will ask, so it is named in words.
    "The version FLAG on a bare `counterparts` prints the same line, and that is",
    "how most people ask; this command is for anybody who types the verb. It is",
    "the check to run straight after installing: it opens no store and reads no",
    "configuration, so it answers \"is the program here and runnable\" and",
    "nothing else. `counterparts doctor`, after an install and a restart, is the",
    "one that says whether it WORKS.",
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
    "The MCP server is registered by running `claude mcp add`; it never writes",
    "~/.claude.json itself, because Claude Code owns that file. If `claude` is",
    "not on your PATH the hooks still go in and the line is printed for you.",
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
    "connect leaves it alone and asks you to quit Desktop and connect again.",
  ],
  disconnect: [
    "It removes only the entries it recognises as its own — another tool's hooks",
    "are never candidates — and runs `claude mcp remove`. It backs the settings",
    "file up first, exactly as `connect` does. Your memory is not touched, and",
    "this one works even if the configuration is already gone.",
  ],
  uninstall: [
    "It disconnects the host, then says where your memory still is, how many",
    "memories are in it, and the one command that removes the package:",
    "`bun remove -g counterparts` (a program does not delete itself).",
    "",
    "At a terminal it then asks: \"Also delete all memories and related data?",
    "This can't be undone. [y/N]\" — after printing every path that would go and",
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
    "  if [ -e ~/.counterparts ]; then echo \"REFUSING: ~/.counterparts exists\"; \\",
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
    "when that part is a megabyte or more the plan says how much of it is log.",
  ],
};

/**
 * The console-wide facts the old page's footer carried, printed at the foot of
 * every command's page.
 *
 * They belong on a page about ONE command because they are true of that command:
 * whether it runs under observer, and whether it will ask before it acts, are
 * questions a reader has while looking at exactly that page.
 */
export const CONSOLE_FOOTER: readonly string[] = [
  "Any other flag is refused before the store is opened.",
  // Not "removal is the only one that asks": since 2026-09-20 start-fresh asks,
  // and since 2026-09-22 so do uninstall's moving arms and install's parked
  // question. The list is still short and named (CONTRACT §5 G12).
  "Owner operations never run under observer, and the ones that delete or move",
  "memory ask a person first (CONTRACT §5 G12: owner-in-the-loop is a short, named list).",
];
