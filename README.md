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

Counterparts is built for Claude Code in the terminal, on macOS and Linux; Windows is not yet
supported. The Code tab of the Claude desktop app runs the same hooks and memory server (checked
with the npm install); the plugin's own install there is still being tested.

In Claude Code:

```
/plugin marketplace add mlapeter/counterparts
/plugin install counterparts@counterparts
```

Then restart Claude Code. The first session creates your memory in `~/.counterparts`, and
Claude offers a short first meeting: a few skippable questions to get to know you (where
memory should be on, what you're working on, something you've loved, how you like to be
talked to). Your answers become ordinary memories; a question you skip stores nothing. In
that first session the sidebar starts it: it sends one message, shown as from the plugin,
and Claude introduces itself (once per install, never in a `claude -p` run, a paused
folder, or after you've typed). Say "later" and it is offered again another day, on three days at most; a
**Start the 5-minute intro** row in the sidebar, or `/counterparts:meet`, starts it any time.
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
- **A sidebar** in the terminal showing what came to mind and what was saved.
- **Commands:** `/counterparts:doctor` (a health check), `/counterparts:dashboard` (opens the
  dashboard), `/counterparts:meet` (the first meeting) and `/counterparts:uninstall`.

## What it runs, sends and fetches

Counterparts runs on your computer. Its hooks read the transcript Claude Code keeps for
each session and store memories in the `~/.counterparts` folder. Counterparts itself sends
nothing anywhere: no accounts, no API keys, no telemetry. The one exception is your own
Claude: memories, and the turns being written up, go into the sessions you run, and into
the background `claude -p` dreaming run (below).

**What it keeps of your conversations.** The hooks keep the text of each turn (your
prompt and Claude's reply) in `~/.counterparts/store/spans/`, so the session can be
written up as memories, at the session's end, by a later session, or by the nightly run.
Tool inputs and outputs, images and attached files are not kept. That text is deleted 7
days after the session's last activity, end or write-up, whichever comes last; a session
with something not yet written up keeps its text until it is, or until 14 days of use
(days Claude Code ran with Counterparts) pass without it, and then the 7 days count again.
The last 14 daily backups in `~/.counterparts/snapshots/` hold copies of it too, so
deleted text can stay in a backup for about 14 more days. It never leaves your
computer except as above.

**What else it reads and writes.** Besides the session transcript, it reads
`~/.claude/settings.json`, your project's `.claude/settings.json` and `settings.local.json`,
`~/.claude.json` and Claude Code's `plugins/installed_plugins.json`, only to tell whether
the npm install is also set up, whether the plugin is on, and (for the sidebar) which
configuration the hooks use. It doesn't read Claude Code's memory files, CLAUDE.md files or
prompt history. Apart from `~/.counterparts`, it writes only to the plugin's own data
folder (the downloaded program, if any), Claude Code's per-plugin storage (sidebar
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

The sidebar's fox is drawn from small PNG frames embedded as text (base64) in the
sidebar's code, so it needs no file reads; the source images and the script that embeds
them are in the source repository (`hooks/sidebar/art/fox/`, `tools/fox-art/`).

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
