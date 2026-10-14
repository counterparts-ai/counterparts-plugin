# Counterparts for Claude Code

Counterparts gives Claude its own long-term memory, modeled on human memory. After the
first few sessions, each session opens with a short "who I am, who you are, where we left
off" that it wrote itself. As you talk, related memories come to mind. At the end of a
session it writes down what it learned, in its own words, and memories fade unless they
come up again. The memory is kept on your computer; Claude sees the parts it brings into a
session, like anything else in its context.

This is the Claude Code plugin. The source, the documentation and the npm package live at
[github.com/mlapeter/counterparts](https://github.com/mlapeter/counterparts); this
repository is generated from it at each release (`tools/plugin-bundle/build.ts` there), so
please open issues and pull requests there.

**Requires Bun 1.3+.** Install it from [bun.sh](https://bun.sh), then open a new terminal
and start Claude Code from it, so `bun` is on the PATH Claude Code starts the plugin with.

## Install

Counterparts is for Claude Code only (the terminal and the Desktop app's Code tab), on macOS
and Linux; Windows is not yet supported. The Code tab runs the same hooks and memory server
(checked with the npm install); the plugin's own install there is still being tested.

In Claude Code:

```
/plugin marketplace add mlapeter/counterparts
/plugin install counterparts@counterparts
```

Then restart Claude Code. The first session creates your memory in `~/.counterparts`, and
Claude offers a short first meeting: a few skippable questions to get to know you (where
memory should be on, what you're working on, something you've loved, how you like to be
talked to). Your answers become ordinary memories; a question you skip stores nothing.
Nothing sends a message for you: type `/counterparts:meet` to start it (the sidebar's
footer says so).
Say "later" and it is offered again another day, on three days at most;
`/counterparts:meet` starts it any time.
A memory that already existed is never offered it. Check its health any time with
`/counterparts:doctor`.

If you also use the npm install (`counterparts install`), keep one or the other. This
version of the plugin doesn't read Claude Code's user configuration file, where that
install registers its memory server, so it doesn't notice the npm install and doesn't stand
down for it: both run, on the same memory, and Claude is offered the memory tools twice.
To keep only the plugin, run `counterparts disconnect` and restart Claude Code; to keep only
the npm install, uninstall the plugin.

## What it adds

- **Hooks** on five Claude Code events (session start, each prompt, each reply, session
  end, before compaction). They read the transcript Claude Code keeps for the session,
  bring back what matters, and keep the session's turns in the memory's buffer.
- **A memory server** (MCP) with the tools Claude uses to note, recall, reflect and write
  its own pages. Recall matches by words and by meaning, on a small model on your computer:
  close paraphrases work ("my doctor" finds a note about a physician), but a description
  that never names the thing ("a pet that purrs" for a note about your cat) usually doesn't.
  Exact words are strongest.
- **A sidebar** in the terminal showing what came to mind and what was saved.
- **Commands:** `/counterparts:doctor` (a health check), `/counterparts:dashboard` (opens the
  dashboard), `/counterparts:meet` (the first meeting) and `/counterparts:uninstall`.

## What the sidebar does

The sidebar is a Claude Code mod (`hooks/sidebar/`). It shows what memory is doing; it
doesn't act. It runs no command, calls no tool, starts no process, makes no network
request, and has no buttons and no links. Its
footer says how to do the rest yourself: `/counterparts:meet` for the 5-minute intro,
`/counterparts:dashboard` for the dashboard, say "pause memory here" to Claude to pause
memory in a folder, and `/counterparts quiet` to hide it (`/counterparts` opens it again).
This is everything it reaches outside its own pane:

- **A status file Counterparts writes for it, in `~/.counterparts`.** Counterparts' own
  background processes (the one after each reply, and the memory server) write
  `sidebar.json` beside `~/.counterparts/claude-code.json`: the day and the count, today's
  counts, the last dream, recent activity and the memories it names (titles and the start
  of their text, as much as the pane shows). They write it only while this plugin is
  installed. The sidebar reads that file every 15 to 30 seconds while it is open,
  checks it was written by the memory this session uses (so it never shows another
  one), and sends nothing anywhere. Before the first reply of a new install it says it
  is waiting for the first session.
- **Where this folder stands.** It reads the scope file the hooks read (beside
  `~/.counterparts/claude-code.json`), to say when memory is paused or off here.
- **What it watches.** It sees your slash commands and Counterparts' own tool calls only to
  update what it shows, and passes every one on unchanged: it never approves, denies or
  alters a command or a tool call, and never changes a setting.

## What it runs, sends and fetches

Counterparts runs on your computer. Its hooks read the transcript Claude Code keeps for
each session and store memories in the `~/.counterparts` folder. Counterparts itself sends
nothing anywhere: no accounts, no API keys, no telemetry. The one exception is your own
Claude: memories, and the turns being written up, go into the sessions you run, and into
the background `claude -p` dreaming run (below).

**What it keeps of your conversations.** The hooks keep the text of each turn (your
prompt and Claude's reply) in `~/.counterparts/store/spans/`, so the session can be
written up as memories, at the session's end, by a later session, or by the nightly run.
Tool inputs and outputs, images and attached files are not kept. That text is deleted 3
days after the session is written up and has ended, and never kept more than 14 days
after the session's last activity, written up or not. Counterparts runs only when you use
Claude Code, so if you stop, the deletion happens the next time it runs. The daily backups
in `~/.counterparts/snapshots/` never include it. Both numbers can be changed in
`~/.counterparts/claude-code.json` (`"retention": {"afterWriteUpDays": 3, "maxDays": 14}`).
You can delete any one kind of data at any time without touching the rest, from the
dashboard or with `counterparts delete conversation-text`, `delete backups` or
`delete activity-log`. It never leaves your computer except as above.

**The sidebar's status file.** While this plugin (and so the sidebar) is installed,
Counterparts writes `~/.counterparts/sidebar.json`, readable only by you (mode 0600): the
day and the count, today's counts per mechanism, the last dream, the recent activity log
and the memories it names, each with its title, kind, date and the first 800 characters of
its text (a confidential memory's text is withheld, as everywhere). Never conversation
text. It is rewritten as memory changes; removing a memory removes it from there too,
`start-fresh` rewrites it for the new store, and once the plugin is gone the next
Counterparts process deletes it. An npm-only install never writes it.

**What else it reads and writes.** Besides the session transcript, it reads
`~/.claude/settings.json` and `settings.local.json`, your project's `.claude/settings.json`
and `settings.local.json`, Claude Code's `plugins/installed_plugins.json` and (for
`/counterparts:doctor`, on a Mac) Claude Desktop's `claude_desktop_config.json`, only to
tell whether the plugin is on, whether the npm install or Claude Desktop is also set up, and
(for the sidebar) which configuration the hooks use. This version doesn't read Claude
Code's user configuration file (its MCP servers and per-project state), and none of these
files is read by the hooks or the memory server of an installed plugin. It doesn't read
Claude Code's memory files, CLAUDE.md files or prompt history. Apart from `~/.counterparts`,
it writes only to Claude Code's per-plugin storage (sidebar
preferences) and small first-run files in your temp folder. The hooks start
short-lived background processes on your computer for the slower work.
`/counterparts:uninstall` lists running processes (`ps`) to find Counterparts' own before
it changes anything.

**Settings and tool calls.** The plugin never changes Claude Code's settings or
permissions, and its hooks never block, change or approve a tool call (the sidebar only
watches Counterparts' own tool calls to show what was saved). It leaves Claude Code's own
memory (MEMORY.md and its prompt section) as it is. At the end of a
reply the hooks may ask Claude, in a line you can see, to take one more short turn to
write the session up as memories. The one exception for settings is
`/counterparts:uninstall`, and only if you also had the npm install: it removes that
install's own Counterparts hook lines from `~/.claude/settings.json` (after saving a backup
next to it) and runs `claude mcp remove counterparts -s user`. It touches nothing else.

**Turning it off.** In a folder it hasn't been told about, Counterparts remembers, and the
first session there asks whether it should. Telling Claude "not here" (or "just read", or
"pause this") sets that folder; in a folder set off, the hooks keep nothing. To delete
everything, remove `~/.counterparts`.

It fetches one thing, at install time:

- **The embedding table.** Installing the plugin downloads one npm package,
  `counterparts-model-potion` (about 30 MB, a word-embedding table used to recall by
  meaning), from the npm registry. Claude Code installs it from the plugin's lockfile
  (`package-lock.json`, so when npm is on your PATH), at the exact version pinned there,
  with install scripts off. Without it, recall works by words rather than by meaning, and
  `/counterparts:doctor` says so.

Nothing else is downloaded, and your memories never leave your computer.

The hooks, the memory server and the commands run the plugin's own entry points with Bun,
each by its path (`src/adapters/claude-code/bin/hook.js`, `src/adapters/mcp/bin/serve.js`,
`src/adapters/cli/bin/counterparts.js`), whose first line starts Bun with your project's
`.env` and `bunfig.toml` left unread and Bun's automatic package install off. They are the
same code the npm package runs, transpiled from its TypeScript sources at each release
(types and comments removed, one file for each).

Dreaming, the daily consolidation, is on by default for a new install (a memory that
already existed keeps its own setting): the first session of each day starts a background
run with your own Claude Code and your own plan's usage. It is up to three `claude -p`
processes in a row (one writes up any sessions not yet written up, one dreams, one
reflects). Each is started in the memory folder, with only the Counterparts memory server
loaded (`--strict-mcp-config`), only its memory tools allowed, file, shell, web and agent
tools denied, a turn limit, and normal permission mode. It says so in one line when it
starts. Saying "no dreams" in a session turns it off (with the npm install,
`counterparts dream --setting off` does too).

**Token use.** Estimated from measurements on one real store (the author's, October
2026): for a moderate day (about 5 sessions and 60 prompts), Counterparts adds roughly 60k
tokens of context and 25k generated tokens, on your Claude plan. The daily dream adds
roughly 20k generated tokens and 155k of fresh input, plus about 1M tokens read from
cache, on your default model. Turning dreaming off removes that part. Your numbers will
differ with how much you use it.

The sidebar's fox is drawn from small PNG files in the plugin's own folder
(`hooks/sidebar/art/fox/`): a terminal that shows pictures (kitty, Ghostty) reads them
itself, and the desktop app's sidebar reads each one once. The script that builds them
from the art is in the source repository (`tools/fox-art/`).

The sidebar runs no programs, fetches nothing and holds no links: COUNTERPARTS and the
`more` after a long memory are plain words. `/counterparts:dashboard` starts the
dashboard, or opens your browser on it when it is already running for your memory (it
asks the page on 127.0.0.1 which memory it serves).

The dashboard, when you open it, is a page served on 127.0.0.1 only (port 4747 unless
you set `COUNTERPARTS_DASHBOARD_PORT`), and runs until the session that started it ends.
The sidebar doesn't need it running.

## Remove it

`/counterparts:uninstall` walks you through it and asks whether to keep your memory or
delete it too. Deleting can't be undone, so Claude never deletes it for you: you disable
the plugin first, quit Claude Code, and type the confirmation yourself in a terminal. Or uninstall from
`/plugin`: your memory in `~/.counterparts` is kept.

## License

MIT. See [LICENSE](LICENSE). Bundled fonts (Outfit, Courier Prime) are under the SIL Open
Font License; their licence texts sit beside them.
