---
description: Uninstall Counterparts, keeping the memories or deleting them, for an install that came as this plugin
allowed-tools: Bash(sh "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh" cli uninstall --json), Bash(sh "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh" cli uninstall --keep-memories --json)
---

This is Counterparts' own `counterparts uninstall`, launched from the plugin because a plugin install puts no `counterparts` command on the PATH. Follow these steps in order. Run only the two commands written below, each exactly as written. Run nothing else that touches Counterparts or its memory: no other flags, no `--config`, no `--delete-memories`, no `--park`, and nothing that deletes files yourself.

**Step 1: the plan.** Run this with the Bash tool, exactly as written:

```
sh "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh" cli uninstall --json
```

It changes nothing. It prints one JSON object. Show the person its `lines`, one per line, as they are, without summarizing them away. If `why` is not null, show it too, under the lines. From inside Claude Code, `deletable` is usually false and `why` usually says Counterparts is still running: this session is running it. That is expected, and it is why a delete happens in a terminal with Claude Code closed (step 4). Carry on to step 2 either way. If the command printed no JSON, or the object's `outcome` is `refused`, show what it printed, say nothing was changed, and stop.

**Step 2: the question.** Ask the person with the AskUserQuestion tool. Ask "What should happen to your memories?", with exactly these two options:

- "Keep my memories (just uninstall)"
- "Delete my memories too (can't be undone)"

Do not choose for them, and do not go on until they answer. If they answer neither, or say to stop, stop: nothing has changed.

**Step 3: they chose keep.** Run this with the Bash tool, exactly as written:

```
sh "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh" cli uninstall --keep-memories --json
```

It disconnects Counterparts from Claude Code and leaves the memories where they are. Run it as written above, not the plan's `keepArgs`: without `--config` it acts on the same configuration the plan read. Show its `lines` as they are, and its `errors` if there are any. If `outcome` is not `ok`, say that the uninstall did not finish and that its lines say why, and stop. Otherwise, tell them the last step is theirs: in Claude Code, /plugin → Installed → counterparts → Uninstall (the closing line of its output says the same). The memories stay on this machine, and installing Counterparts again later finds them.

**Step 4: they chose delete.** Do not run anything. This command cannot delete the memories, by design: a running session holds the memory open, and the confirmation has to be typed by the person, at a real terminal, not by you. Tell them plainly, in this order:

1. First, in Claude Code, disable the plugin: /plugin → Installed → counterparts → Disable plugin. Its files stay, so the command below still works, but it no longer starts with Claude Code. Without this, the next time Claude Code opens, the plugin sets Counterparts up again, with a new, empty memory folder.
2. Quit Claude Code completely, every window and session, because a running session holds the memory open.
3. In a terminal, run this one command. Build it from the plan: `sh`, then the launcher's full path, then `cli`, then every item of the plan's `terminalArgs` in order, each in double quotes. The launcher's full path is the one in the plan command you ran in Step 1, the path ending in `src/adapters/plugin-run.sh`, written out in full, with no variable in it. It looks like this, with real paths:

   ```
   sh "/full/path/to/src/adapters/plugin-run.sh" cli "uninstall" "--config" "/full/path/to/claude-code.json"
   ```

4. In the terminal it shows what it would delete and asks whether to delete it. They answer it themselves and type the confirmation it asks for. Nothing is deleted unless they type it.
5. Then remove the plugin. The command's last lines name Claude Code's terminal command for it (`claude plugin uninstall …`); they can run that in the same terminal, or open Claude Code again and use /plugin → Installed → counterparts → Uninstall. Either is safe, because step 1 disabled the plugin.

Give them the command in a code block so they can copy it. Do not offer to run it for them, and do not run it, even if they ask: tell them it has to be typed at their own terminal, with Claude Code closed.
