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

Then restart Claude Code. The first session creates your memory in `~/.counterparts`, and
Claude offers a short first meeting: a few skippable questions to get to know you (where
memory should be on, what you're working on, something you've loved, how you like to be
talked to). Your answers become ordinary memories; a question you skip stores nothing.
In that first session the sidebar starts it: it sends one message, shown as from the
plugin, and Claude introduces itself (once per install, never in a `claude -p` run, a
paused folder, or after you've typed).
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
- **A sidebar** in the terminal showing what came to mind and what was saved.
- **Commands:** `/counterparts:doctor` (a health check), `/counterparts:dashboard` (opens the
  dashboard), `/counterparts:meet` (the first meeting) and `/counterparts:uninstall`.

## What the sidebar does

The sidebar is a Claude Code mod (`hooks/sidebar/`). It shows what memory is doing; apart
from one message on a new install (below), it doesn't act on its own. It runs no command,
calls no tool, starts no process, makes no network request, and has no buttons: a click
on a row opens or folds it, and four kinds of row do one thing more when you click them.

- **Meet your counterpart**, on the terminal, at the top while the first meeting isn't
  done or skipped, puts `/counterparts:meet` in your prompt box; you press Enter. It only
  fills an empty box and never writes over what is there: with a draft it says so under
  the row, as it does when the box won't take it (a dialog is open).
- **The footer's Dashboard line**, on the terminal, puts `/counterparts:dashboard` in your
  prompt box the same way (it starts the dashboard, or opens your browser on one already
  running). In the desktop app neither row fills the box: the footer says both commands
  instead.
- **COUNTERPARTS ↗**, on the terminal, is a link to the dashboard: your terminal opens it
  (⌘-click in iTerm2) while the dashboard runs. The address is the one Counterparts writes
  in its status file (`http://127.0.0.1:4747`, or `COUNTERPARTS_DASHBOARD_PORT`'s port);
  the sidebar draws a link only to `http://127.0.0.1` on a port, no other. The desktop app
  shows it as words.
- **The view and avatar switches** in the footer: `view` closes the pane to quiet (the
  tail under the prompt; `/counterparts` opens it again), `avatar` turns the fox on or off.
  Each sets one choice in Claude Code's per-plugin storage, as `/counterparts quiet` and
  `/counterparts avatar` do.

The footer also says how to pause memory in a folder: say "pause memory here" to Claude.

### What it can reach

This is everything it reaches outside its own pane.

- **Reads.**
  - `sidebar.json`, the status file Counterparts writes for it (what it holds: "The
    sidebar's status file" below), every 15 to 30 seconds while the pane is open. It checks
    the file was written by the memory this session uses, so it never shows another one.
  - Where Counterparts' configuration is, found as the hooks find it: the `--config` on
    Counterparts' own hook line in Claude Code's user settings or this project's
    `.claude/settings.json` and `settings.local.json`, else `COUNTERPARTS_CONFIG`, else
    `~/.counterparts/claude-code.json`. It looks at session start, every five minutes, and
    on `/counterparts`, and uses nothing else in those files.
  - The scope file beside that configuration, to say when memory is paused or off in this
    folder.
  - The fox's PNG frames, from the plugin's own folder.
  - Nine environment variables: `TERM_PROGRAM`, `TERM`, `KITTY_WINDOW_ID` and
    `WEZTERM_EXECUTABLE` once at session start, to draw the finest fox the terminal's font
    has; `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR` and `COUNTERPARTS_CONFIG` whenever it
    looks for the configuration (above); and `COUNTERPARTS_SIDEBAR_SESSION`, which only a
    preview or a test sets, to show another session.
  - The text hooks add to the session (any plugin's), to find what Counterparts' own hooks
    marked in it: the memories that came to mind, which memory this session uses, the
    first lines of the wake (Last here, Coming up, Yesterday) and where the first meeting
    stands. It keeps nothing else of that text.
  - The name of each tool call, to find Counterparts' own; of those, the arguments and the
    result, to show what was saved. Of each prompt, where it came from (typed, or sent by
    a plugin), so the fox looks up.
  - When each of Claude's turns in the main session starts, takes a step and ends, so the
    fox is at work while a turn runs. Nothing of the turn's content.
  - Of a prompt a plugin sent, whether it is its own "Meet your new counterpart.". Before
    it speaks first (below): whether you have run a slash command or sent a prompt, how
    many turns the session has, and whether your prompt box holds a draft, so it never
    speaks over you. Before it fills the prompt box on a click, whether it holds a draft.
  - The dashboard's address, from the status file, for the title's link.
- **Runs.** No process, no command, no tool call. One message: in a session of a new
  memory, before you type anything (once per memory: a new install, or after
  `start-fresh`), it sends "Meet your new counterpart." so Claude can introduce itself
  (see Install). On a click on Meet or Dashboard, it puts that command in your empty
  prompt box, and sends nothing: you do.
- **Sends.** Nothing over the network. The title's link is your terminal's to open.
- **Keeps.** In Claude Code's per-plugin storage, the view, theme, avatar and avatar detail
  you choose with `/counterparts` or the footer's switches, and where the first meeting
  stands, so it speaks first once per memory. Everything else it holds ends with the
  session.
- **Hostile input.** It approves, denies and changes nothing: every command, prompt and
  tool call passes on as it came (its own `/counterparts` it answers itself, and its own
  "Meet your new counterpart." it drops when you typed first), and it never changes a
  setting. Text another hook adds can make it do one thing at most: a forged Counterparts
  marker can change what the pane shows, and can make it send "Meet your new
  counterpart." at most once a session. The dashboard address in the status file is drawn
  as a link only when it is `http://127.0.0.1` on a port; anything else there draws plain
  words.

`claude plugin validate` says that where an organization manages Claude Code, the hooks
that read what other hooks add to the session don't run in a plugin a person installs.
There the pane can't see the wake or what comes to mind at each prompt: the glance and
Memories and Subconscious stay empty (a resumed session shows what the status file held when the pane
first looked), it can't check the status file is this session's memory's, and
it never speaks first.

The sidebar's lines from `claude plugin validate`, Claude Code 2.1.306:

    ❯ ./sidebar/hooks/full.tsx hooks: ui.message{data has {click=fill:meet|fill:dash}}, session.start, command.run{command=counterparts}, tool.call, prompt.submit, turn.start, turn.step, turn.complete, session.append{door=hook-context}, session.end, ui.close{id=counterparts}, ui.message, ui.render{component=PromptHint}, ui.render{component=AbovePrompt}, ui.render{component=Pane, requestId=counterparts}, session.start{isInteractive=true}, command.run{origin has {kind=/"^(composer|bridge)$"/}}, prompt.submit{origin has {kind=/"^(composer|bridge|plugin)$"/}}, session.append{door=hook-context, origin has {kind=hook, event=SessionStart}}
    ❯ ./sidebar/hooks/full.tsx calls: $.clock.after, $.clock.every, $.clock.now, $.command.register, $.env.get, $.fs.exists (via findPngDir, readScopeFile, readStatus, readText), $.fs.read (via pngData, readScopeFile, readStatus, readText), $.fs.stat (via canonicalPath, readStatus), $.prompt.fill (via fillPrompt), $.prompt.read (via draftNow, fillPrompt), $.prompt.submit (via speakFirst), $.session.id, $.session.turns (via turnsSoFar), $.state.get, $.state.set, $.store.get, $.store.set (via setAvatar, setDetail, setTheme, setView, speakFirst, takeMeet), $.ui.blit (via stageStep), $.ui.close (via closeQuiet), $.ui.invalidate, $.ui.open (via openPane), $.ui.panes (via paneShown), $.ui.resolve, $.ui.status (via refreshStatus)
    ❯ ./sidebar/hooks/full.tsx env writes: nothing
    ❯ ./sidebar/hooks/full.tsx env reads: CLAUDE_CONFIG_DIR, COUNTERPARTS_CONFIG, COUNTERPARTS_SIDEBAR_SESSION, HOME, KITTY_WINDOW_ID, TERM, TERM_PROGRAM, USERPROFILE, WEZTERM_EXECUTABLE

`$.state` is the pane's own memory for the session; `$.store` is the per-plugin storage
above. Run `claude plugin validate .` in the plugin's folder to see the same.

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
its text. Never conversation
text. It is rewritten as memory changes; removing a memory removes it from there too,
`start-fresh` rewrites it for the new store, and once the plugin is gone the next
Counterparts process deletes it. An npm-only install never writes it.

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
permissions, and its hooks never block, change or approve a tool call (what the sidebar
watches: "What it can reach" above). It leaves Claude Code's own
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
Font License and three.js under MIT; their licence texts sit beside them.
