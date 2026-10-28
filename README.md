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

## Install

Counterparts is for Claude Code only (the terminal and the Desktop app's Code tab), on macOS
and Linux; Windows is not yet supported. The Code tab runs the same hooks and memory server
(checked with the npm install); the plugin's own install there is still being tested.

In Claude Code:

```
/plugin marketplace add mlapeter/counterparts
/plugin install counterparts@counterparts
```

That is the memory on its own. For the sidebar, a pane beside the chat that shows what
memory is doing, install it too (it is a plugin of its own, and it brings this one with it):

```
/plugin install counterparts-sidebar@counterparts
```

Then restart Claude Code. The first session creates your memory in `~/.counterparts`, and
Claude offers a short first meeting: a few skippable questions to get to know you (where
memory should be on, what you're working on, something you've loved, how you like to be
talked to). Your answers become ordinary memories; a question you skip stores nothing.
Claude offers it at the end of its first reply (with the sidebar installed, the sidebar
starts it instead, before you type).
Say "later" and it is offered again another day, on three days at most;
`/counterparts:meet` starts it any time.
A memory that already existed is never offered it. Check its health any time with
`/counterparts:doctor`.

If you already use the npm install (`counterparts install`), the plugin notices and stands
down, so the memory is never wired twice.

## What it adds

- **Hooks** on five Claude Code events (session start, each prompt, each reply, session
  end, before compaction). They read the transcript Claude Code keeps for the session,
  bring back what matters, and keep the session's turns in the memory's buffer.
- **A memory server** (MCP) with the tools Claude uses to note, recall, reflect and write
  its own pages. Recall matches by words and by meaning, on a small model on your computer:
  close paraphrases work ("my doctor" finds a note about a physician), but a description
  that never names the thing ("a pet that purrs" for a note about your cat) usually doesn't.
  Exact words are strongest.
- **Commands:** `/counterparts:doctor` (a health check), `/counterparts:dashboard` (opens the
  dashboard), `/counterparts:meet` (the first meeting) and `/counterparts:uninstall`.

The sidebar, a pane showing what came to mind and what was saved, is the
`counterparts-sidebar` plugin (Install, above). This plugin carries no mod: no hooks module,
nothing drawn in Claude Code's interface.

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

**The sidebar's status file.** While this plugin is installed (the sidebar plugin needs it),
Counterparts writes `~/.counterparts/sidebar.json`, readable only by you (mode 0600): the
day and the count, today's counts per mechanism, the last dream, the recent activity log
and the memories it names, each with its title, kind, date and the first 800 characters of
its text. Never conversation
text. It is rewritten as memory changes; removing a memory removes it from there too,
`start-fresh` rewrites it for the new store, and once the plugin is gone the next
Counterparts process deletes it. An npm-only install never writes it.

**What else it reads and writes.** Besides the session transcript, it reads
`~/.claude/settings.json`, your project's `.claude/settings.json` and `settings.local.json`,
`~/.claude.json` and Claude Code's `plugins/installed_plugins.json`, only to tell whether
the npm install is also set up and whether the plugin is on. It doesn't read Claude Code's
memory files, CLAUDE.md files or prompt history. Apart from `~/.counterparts`, it writes
only to the plugin's own data folder (the downloaded program, if any) and small first-run
files in your temp folder. The hooks start
short-lived background processes on your computer for the slower work.
`/counterparts:uninstall` lists running processes (`ps`) to find Counterparts' own before
it changes anything.

**Settings and tool calls.** The plugin never changes Claude Code's settings or
permissions, and its hooks never block, change or approve a tool call. It leaves Claude
Code's own
memory (MEMORY.md and its prompt section) as it is. At the end of a
reply the hooks may ask Claude, in a line you can see, to take one more short turn to
write the session up as memories. The one exception for settings is
`/counterparts:uninstall`, and only if you also had the npm install and removed it without
running `counterparts uninstall`: the Counterparts hook lines it left in
`~/.claude/settings.json` point at a program that is gone, so it removes them (after saving a
backup next to it), and runs `claude mcp remove counterparts -s user` for that install's
memory server. While the npm install is still there, its hooks and server keep working, and
`counterparts uninstall` is what removes them, unless you choose to delete or set aside the
memories: those both point at that memory, so then they are removed too. It touches nothing
else.

**Turning it off.** In a folder it hasn't been told about, Counterparts remembers, and the
first session there asks whether it should. Telling Claude "not here" (or "just read", or
"pause this") sets that folder; in a folder set off, the hooks keep nothing. To delete
everything, remove `~/.counterparts`.

It fetches two things, both at install time or once:

- **The embedding table.** Installing the plugin downloads one npm package,
  `counterparts-model-potion` (about 30 MB, a word-embedding table used to recall by
  meaning), from the npm registry. Claude Code installs it from the plugin's lockfile
  (`package-lock.json`, so when npm is on your PATH), at the exact version pinned there,
  with install scripts off. Without it, recall works by words rather than by meaning, and
  `/counterparts:doctor` says so.
- **A program, only when your computer has no runtime.** Counterparts runs on Bun or
  Node.js when either is installed. On a Mac or Linux computer with neither, it downloads
  one prebuilt Counterparts program for that computer (55–75 MB, from the
  github.com/mlapeter/counterparts releases, over HTTPS), checks it against a sha256 that
  ships inside the plugin (`.claude-plugin/binaries.json`), and keeps it in the plugin's
  data folder. A file that fails the check is deleted and never run. Nothing else is
  downloaded, and your memories never leave your computer. Set
  `COUNTERPARTS_BINARY_DOWNLOAD=off` to forbid the download.

**Checking for updates.** Once a day, Counterparts asks the npm registry
(`registry.npmjs.org`) for the newest version number, so it can tell you when an update is
out. The request carries no memory, no conversation, no identifier, not even which version
you have. Because it's daily, npm can see your computer's network address and that
Counterparts checked that day. It doesn't run if you've told Claude Code to make no
non-essential network requests (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`). To turn it
off yourself, tell your Claude to stop checking for updates, or set `"updateCheck": false`
in `~/.counterparts/claude-code.json` (or `COUNTERPARTS_UPDATE_CHECK=off` where
Counterparts runs).

The hooks and the memory server start through one small shell script,
`src/adapters/plugin-run.sh`, whose only job is to find that runtime (Bun, then Node.js,
then the downloaded program) and start the same entry points the npm package runs.

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

The dashboard, when you open it, is a page served on 127.0.0.1 only (port 4747 unless
you set `COUNTERPARTS_DASHBOARD_PORT`), and runs until the session that started it ends.

## Remove it

`/counterparts:uninstall` walks you through it and asks whether to keep your memory or
delete it too. Deleting can't be undone, so Claude never deletes it for you: you disable
the plugin first, quit Claude Code, and type the confirmation yourself in a terminal. Or uninstall from
`/plugin`: your memory in `~/.counterparts` is kept.

## License

MIT. See [LICENSE](LICENSE). Bundled fonts (Outfit, Courier Prime) are under the SIL Open
Font License and three.js under MIT; their licence texts sit beside them.
