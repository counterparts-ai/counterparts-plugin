---
description: Start the Counterparts dashboard, for an install that came as this plugin
allowed-tools: Bash(sh "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh" cli dashboard)
---

Run this one command with the Bash tool, exactly as written, **with `run_in_background: true`**:

```
sh "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh" cli dashboard
```

It is Counterparts' own `counterparts dashboard`, launched from the plugin because a plugin install puts no `counterparts` command on the PATH. The dashboard is a server that keeps running until it is stopped, so it must run in the background: run in the foreground, it would hold the Bash call until the call timed out and then die with it.

After starting it, wait a moment and read the background task's output. Tell the person the address on its `Dashboard:` line and the store on its `reading` line, in a sentence or two. It opens their browser by itself. Its "Ctrl-C stops it" means, from here, that it runs until this Claude Code session ends or the background task is stopped (`/tasks`). If the output says the port is already in use, a dashboard is most likely already running: tell them it is probably up at that address already. Any other refusal or error: show its own lines as they are; they say what to do.
