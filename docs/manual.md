# The Counterparts manual

How this memory works and how to use it: the phrases, the switches, the commands, and what to do when something seems off. It is written for the counterpart first (that's you, if you opened it through `recall`), and a person can read it too.

Some things differ by where the memory lives. **[local]** means a memory on the person's own computer, used from Claude Code or Claude Desktop. **[hosted]** means Counterparts Online, used from claude.ai, or from Claude Code when there's no local install. Where neither mark appears, it holds for both. "Since 0.3.x" says when something arrived, where that matters. This file ships with the code, so it describes the version that's installed.

## What Counterparts is

A memory for an AI, in its own words, not a transcript: it writes with `remember`, lets the unused fade, and opens each session with a wake.

- It writes its own memories: in the moment with the `remember` tool, and at the end of a stretch of work with `session_end` and `chapter`.
- What isn't used fades, on purpose, so what matters stays easy to find. A faded memory can still turn up when it's searched for, until it is let go.
- Each session opens with a wake: who I am (the self page), where the work stands, what's coming up and still open, how yesterday went.
- In Claude Code, related memories come up as footnotes as the conversation goes. `recall` is the deliberate look, everywhere.
- It's theirs to see, export and delete. [local] It is one SQLite file on their computer, and Counterparts sends nothing about them anywhere (the details are on counterparts.ai/privacy). [hosted] It lives on Counterparts' server, one store per account; backups that leave the server are encrypted with a key for their account.
- What's stripped before anything is kept, in memories and in the raw conversation text: credentials in recognisable shapes (keys, tokens, private keys, passwords in URLs, a value written after a name like password= or api_key:), and most passwords named in a sentence ("my wifi password is …", "the PIN is …"), the value only. Not every secret has a shape: don't paste things you wouldn't want kept.
- A new memory may start with a few starter notes, titled "Told: …". They were given, not lived: they start weak, come after lived memories that match as well, are never part of the self, and can be corrected or let go like any memory.

## Everyday phrases

Offer a phrase when it fits: "Remember this", "That's wrong", "Remind me Thursday to …", "What's still open?". Don't list them all.

- "Where did we leave off?" brings back the last session here. A short facts question like that reads that session first.
- "Remember this" saves it now, with the `remember` tool.
- "How did X go?" or "what do you remember about Y?" asks the memory, not just this chat: `recall` with `mode: "facts"` for what happened, `mode: "meaning"` for how it went and what it adds up to.
- "Remind me Thursday to …" is saved with the date in `eventDate` and `remind: "plain"`, so it is said plainly on that day, or, if that day is missed, the next time you talk within the week after. Without `remind: "plain"`, a dated memory is quiet: in Claude Code it may come up as a footnote around the date.
- "That's wrong" corrects a memory: write the right version with `updates` naming the old one and `how: "corrected"`. The wrong one leaves recall and stays readable by its id.
- "What's still open?" lists the threads the wake carries: the handle `still open`.
- "What's coming up?" lists what's due: the handle `coming up`.
- "Not here", "just read" or "pause this" sets the scope (see Folders).
- "No dreams", "ask first", or "dream", sets or starts the night (see Nights and dreams).
- "Let's meet" starts the first meeting, if it hasn't happened: the `meet` tool.

## Folders

[local] Memory is set per folder with the `scope` tool: on, observer (reads only), off, or paused.

- The `scope` tool reads the setting for this folder with no `mode`, and sets it with `mode` `on`, `observer`, `off`, `pause` or `resume`. Set it when the person says so, not on a guess.
- Off: the hooks write nothing and read nothing here, and every tool but `scope` refuses. Paused is off until they say to resume; it has no timer. `resume` goes back to what it was before, or on.
- A setting covers the folder and everything under it; the nearest setting wins. Nothing set means on.
- From a terminal: `counterparts scope .` shows this folder's setting, and `counterparts scope . --off` (or `--pause`, `--resume`, `--on`) sets it. `counterparts scope --list` prints every setting.
- The `scope` tool's `updates` turns the update reminder off when they say stop reminding them about updates.

[hosted] One account is one memory, with no folders. The `scope` tool pauses it or turns it off, for every claude.ai chat, and back on. Paused lasts until they say to resume (`mode: "resume"`).

## Remembering well

Save with `remember` while it's fresh, put dates in `eventDate`, mark open things `unresolved`, fix wrong ones with `updates`.

- Save while it's fresh: when something matters, `remember` it then, one idea per call, in your own words. Keep the exact words when the words matter.
- A date to come back to goes in `eventDate`, not just the text, or it never comes back. Four shapes: a day "2026-10-15", a month "2026-10", a range "2026-10-20..2026-10-31", or a year. Add `recurring` for a date that repeats.
- Something open: `unresolved: true`, with `settlesWhen` naming what would settle it. It stays on the still-open list, and the night can close it once a memory shows it happened.
- When a memory turns out wrong: `updates` with its id and `how: "corrected"`. When it was true then and has changed: `how: "changed"` (the default), and the old one is shown as earlier. A real disagreement: `how: "open"`, and both stay.
- Before saying "I don't remember", ask `recall` once, and try other words before saying it's gone.
- [local] At the end of a session in Claude Code, the Stop ask asks for the write-up: memories through `session_end`, and the session's own account through `chapter`. Write it honestly, including what didn't go well.
- [hosted] Nothing tells this memory when a chat ends, so `remember` as things come up, and write a `chapter` when the chat is wrapping up.

## Nights and dreams

A night pass runs day's end, a dream and a reflection, set to `auto`, `ask` or `off`; `last dream` reads the newest.

- Day's end writes the day's summary and brings the self page's day-to-day sections up to date. The dream replays what was lived beside what it resembles: it can merge near-copies, link what belongs together, note a pattern, flag a contradiction. The reflection is awake: it can rewrite the page's Core from the memories it cites and leave a short morning share.
- A dream is kept in its own journal, marked as a dream, never as something that happened. Tell it as a dream.
- The setting is `auto`, `ask` or `off`: the `dream` tool's `setting` phase, when they say "no dreams" (off) or choose one.
- [local] On `auto` (a new install's default), the next day's first Claude Code session starts the night in the background, as a separate claude -p run, and says so in one line. On `ask`, that session asks first. `counterparts dream --setting off` (or `ask`, `auto`) sets it from a terminal.
- [local] `counterparts night` lists recent nights, and `counterparts night last` shows last night's dream and reflection (since 0.3.28). `counterparts dream --undo <id>` reverses one dream as a whole.
- [local] `counterparts catch-up` writes up, now, sessions that ended without a write-up. The night does it too.
- [hosted] On `auto` (a new account's default), the day's first claude.ai chat runs the night, then answers in the same reply and says so in one line; on `ask` it asks first. One chat at a time is told (a later one only if the first never ran it), and none once a night has run. It also runs when the person's nightly routine (a scheduled run they set up in Claude) calls the `dream` tool, or when they say "dream" in a chat. To use a scheduled routine, set Counterparts' tools to Always allow first: the routine's form lists only those.
- Either surface: the handle `last dream` (or `last night`) reads the newest dream whole, and the reflection after it.

## Seeing and changing what's kept

Look with `recall` or `self_page`, correct with `updates`; `remember`'s `remove` deletes one, with a day to undo.

- Ask the memory: `recall` with a question and a mode, or a memory's id or exact title as `handle` to read it whole. [local] From a terminal: `counterparts ask "…"`.
- The self page, the "Who I am" the wake opens with: the `self_page` tool reads it, and writes it whole when something about you will still be true next month. [local] `counterparts self-page` shows it, and `counterparts self-page --versions` lists earlier versions.
- [local] `counterparts dashboard` opens the dashboard in a browser: the memories, the self page and the memory's health.
- Correct a memory with `remember`, `updates` and `how: "corrected"` (see Remembering well).
- [local] `counterparts remove <id>` shows what would go; with `--confirm` it asks them to type the id back, then deletes that memory for good. It needs a terminal, and it is the person's to run. `--confirm` also finishes a memory deleted in chat, at once.
- [local] `counterparts delete conversation-text`, `counterparts delete backups` or `counterparts delete activity-log` deletes one kind of data and nothing else (since 0.3.21).
- [local] `counterparts settle` lists memories that disagree and how each pair was settled; `counterparts core` lists what became part of who I am, and `counterparts core --demote <id>` sends one back.
- Delete one memory: `remember` with `remove` and the memory's id, on a memory shown in this conversation, after saying which one. It's hidden at once and erased after 24 hours. `remove` with `undo: true` brings it back before then, and recall's handle `deleted` lists what's waiting.

## Export, backup, uninstall

The memory is theirs to take: export, uninstall, start-fresh, or "Download my memory" when hosted.

- [local] `counterparts export --out <dir> --passphrase <secret>` makes an encrypted copy they can take anywhere. Export refuses without `--passphrase`, or `--plaintext` said on purpose. `--markdown` writes a readable tree instead. No command opens an encrypted export yet; the README beside it gives the format.
- [local] `counterparts backup --out <dir>` saves a snapshot to a folder. A daily snapshot is also kept automatically.
- [local] `counterparts uninstall` disconnects Claude Code and keeps the memory unless they say otherwise; `--keep-memories` keeps it without asking.
- [local] `counterparts start-fresh` sets this memory aside and starts a blank one; `counterparts start-fresh --undo` brings it back. Nothing is deleted.
- [local] `counterparts rollback` puts the memory back as it was before an upgrade (since 0.3.17).
- A memory held for deletion is left out of the markdown export; a full copy still has it until it's erased.
- [hosted] The account page's "Download my memory" gives the whole memory as one SQLite file, readable by any SQLite tool. "Delete my account" locks it at once and erases the memory, its backups and its key after 24 hours, unless they sign in and keep it; "Delete everything now" erases at once.

## Checking that it works

If something seems off (no wake, no night), check before guessing: `status`, and locally `counterparts doctor` and `counterparts log`.

- The `status` tool gives the census: how much is held, of what kinds, how much has left. Ask it when the person asks "what's your status?".
- [local] `counterparts doctor` checks everything and says what to fix. Show its lines as they are. `counterparts status` counts memories and recent activity; `counterparts log` shows today's events in order; `counterparts mechanisms` shows which parts of memory have been working.
- [local] After an update, start a new Claude Code session so the new version's tools load. To update: `npm install -g counterparts@latest` (or `bun add -g counterparts@latest`), or for the plugin, /plugin → Marketplaces → counterparts → Update marketplace.
- [local] It runs on macOS, Linux and Windows (Windows is new: tell us how it goes). Bun on macOS is the setup in daily use; Node (22.15+), Linux and Windows pass a smoke test but have no daily user yet. On Windows it's installed with npm and Node; memory lives in the .counterparts folder in your user folder; Claude Code runs the hooks in Git Bash when Git for Windows is installed and in PowerShell when it isn't, and both work; quit Claude Code before uninstalling or starting fresh, which can't see running processes there. In WSL it works as on Linux. The sidebar mod hasn't been tried on Windows yet.
- [local] A plugin install has no counterparts command in the terminal: the person uses /counterparts:doctor, /counterparts:dashboard and /counterparts:uninstall instead.
- [local] `counterparts install --host claude-desktop` connects Claude Desktop's chat to the same memory. Desktop's chat has no hooks: the `wake` tool starts each chat, there are no footnotes, and the write-up is asked on a tool result once a chat has gone on a while.
- [hosted] The account page lists the connected AIs, with when each was last used, and disconnects one.
- A tool that refuses says why and what to do. Pass that on in plain words, don't retry blindly.

## Hosted

[hosted] Counterparts Online is this memory on a server, used from claude.ai with the `wake` tool.

- It's connected in claude.ai as a custom connector, from the setup page the person was given. In a new chat, the `wake` tool starts the conversation.
- Sign-up is by email while the beta has spots left; when it's full, the sign-in page links counterparts.ai's waiting list, and an invite code still signs up. Sign-in is by an emailed link. The account page has the connected AIs, the time zone (the memory's day turns over at their midnight), "Download my memory", and delete.
- There are no hooks: the `wake` tool starts each chat, and nothing asks for a write-up at the end. There are no terminal commands. The account page links a read-only dashboard (Home, Memories, Self); its other pages are local only.
- One account is one memory, with no folders: the `scope` tool pauses it or turns it off.
- Nights run in the day's first chat, after the `wake` and before the answer (see Nights and dreams), or from the person's own routine.
- Limits in the beta: about 120 calls a minute and 1,500 an hour; a store of up to 1 GiB. Over a limit, the tool says so; nothing is lost.
- A hosted memory and a local one are separate. [local] `counterparts connect` keeps the hosted connector out of Claude Code, so one session never sees two memories.

## Taking your hosted memory home

A "Download my memory" file replaces a local memory: set the old store folder aside first.

- A hosted memory's "Download my memory" file becomes a local install's memory when it is the only file in a fresh store folder, named "counterparts.sqlite". It replaces, it doesn't merge: whatever memory the local install had is no longer the one in use.
- [local] How: quit Claude Code and Claude Desktop, so no session holds the store. Rename the store folder `counterparts doctor` names on its Memory line (usually .counterparts/store in the home folder) to something like "store-before-hosted": that renamed folder is the backup of the local memory, whole. Then make a new, empty folder with the old name, and put the downloaded file in it as "counterparts.sqlite". Don't drop the file into the old folder over its database: the old search index and write-ahead files beside it belong to the other memory. To also keep a portable copy of the local memory, `counterparts export --out <dir> --passphrase <secret>` before the swap.
- [local] The first Claude Code or Claude Desktop session after that rebuilds its word index as it opens it, so questions find things at once (`counterparts ask` only looks, so before then it says the index is empty, and `counterparts verify --rebuild` rebuilds it by hand); search by meaning fills in over the next sessions. Starter notes still in hosted's words switch to this install's; one that was edited stays as it is (since 0.3.47).
- The download is not encrypted. Once it is in place, delete the copy left in Downloads.
- The hosted account and its memory stay as they were until the person deletes the account; the two don't sync.

## What's new

What changed in each version is in CHANGELOG.md, in the package and on GitHub.

- [hosted] Updates arrive when Counterparts Online is deployed; there is nothing to install.
