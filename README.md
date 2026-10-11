# Counterparts for Claude Code

Counterparts gives Claude its own long-term memory, modeled on human memory. Each session
opens with a short "who I am, who you are, where we left off" that it wrote itself. As
you talk, related memories come to mind. At the end of a session it writes down what it
learned, in its own words, and memories fade unless they come up again. Everything stays
on your computer.

This is the Claude Code plugin. The source, the documentation and the npm package live at
[github.com/mlapeter/counterparts](https://github.com/mlapeter/counterparts); this
repository is generated from it at each release (`tools/plugin-bundle/build.ts` there), so
please open issues and pull requests there.

## Install

In Claude Code:

```
/plugin marketplace add mlapeter/counterparts
/plugin install counterparts@counterparts
```

Then restart Claude Code. The first session says it is a first run and creates your memory
in `~/.counterparts`. Check it any time with `/counterparts:doctor`.

If you already use the npm install (`counterparts install`), the plugin notices and stands
down, so the memory is never wired twice.

## What it adds

- **Hooks** on five Claude Code events (session start, each prompt, each reply, session
  end, before compaction). They read the transcript Claude Code keeps for the session,
  bring back what matters, and keep the session's turns in the memory's buffer.
- **A memory server** (MCP) with the tools Claude uses to note, recall, reflect and write
  its own pages.
- **A sidebar** in the terminal showing what came to mind and what was saved.
- **`/counterparts:doctor`**, a health check.

## What it runs, sends and fetches

Counterparts runs on your computer. Its hooks read the transcript Claude Code keeps for
each session and store memories in the `~/.counterparts` folder. Counterparts itself sends
nothing anywhere: no accounts, no API keys, no telemetry. The one exception is your own
Claude: memories, and the turns being written up, go into the sessions you run, and into
the background `claude -p` run if you turn dreaming to `auto` (below).

**What it keeps of your conversations.** The hooks keep the text of each turn (your
prompt and Claude's reply) in `~/.counterparts/store/spans/`, so the session can be
written up as memories, at the session's end, by a later session, or by the nightly run.
That text is deleted 7 days after the session ends; a session not yet written up keeps
its text until it is. The last 14 daily backups in `~/.counterparts/snapshots/` hold
copies of it too. It never leaves your computer except as above.

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

Dreaming, the nightly consolidation, asks first by default. If you choose `auto`, the
first session of each day starts a background `claude -p` run: your own Claude Code and
your own plan's usage, allowed only Counterparts' memory tools, with file, shell and web
tools denied. It says so in one line when it starts. Saying "no dreams" in a session turns
it off.

The dashboard, when you open it, is a page served on `localhost` only.

## Remove it

`/plugin uninstall counterparts@counterparts`. Your memory in `~/.counterparts` is kept;
delete that folder to remove it too.

## License

MIT. See [LICENSE](LICENSE). Bundled fonts (Outfit, Courier Prime) are under the SIL Open
Font License and three.js under MIT; their licence texts sit beside them.
